import {
  hostHeaderValidationResponse,
  originValidationResponse,
} from "@modelcontextprotocol/server";
import {
  AccessIdentityApplication,
  AccountApplication,
  McpConnectionApplication,
  D1AccountRepository,
  PlatformAccountClock,
  PlatformAccountIds,
  PlatformPasswordPort,
  createD1ExternalIdentityRepository,
  createD1McpConnectionRepository,
  registerAccountAccessRoutes,
  registerAccountRoutes,
  registerMcpConnectionRoutes,
  type AccountRepository,
  type ExternalIdentityRepository,
  type McpConnectionRepository,
  type McpConnectionCapability,
} from "../../modules/account";
import {
  requireCsrf,
  requireSession,
  type AccessAssertionVerifier,
  type JwtEnv,
} from "../../platform/auth";
import { getDbOrApiError, type D1Database } from "../../platform/d1";
import {
  ApiError,
  apiErrorStatus,
  isApiError,
} from "../../platform/http/api-error";
import { fromApiError, json } from "../../platform/http/responses";
import { Router } from "../../platform/http/router";
import { logRequest, type RequestLogger } from "../../platform/observability/request-log";
import { systemClock } from "../../platform/runtime/clock";
import type { AccessWorkerEnv } from "./access-config";
import {
  defaultWorkerAccessRuntime,
  type WorkerAccessRuntime,
} from "./access-runtime";
import {
  handleMcpRequest,
  safeAudit,
  type McpAuditErrorClass,
  type McpAuditOutcome,
  type McpAuditSink,
  type McpCapabilities,
  type McpRequestDependencies,
} from "./mcp/server";
import { createMcpAuditSink, hashMcpPrincipal } from "./mcp/audit-log";

export interface WorkerEnv extends JwtEnv, AccessWorkerEnv {
  DB?: D1Database;
}

export interface WorkerCompositionDependencies {
  /** Isolated in tests; production uses the single bounded module-scope cache. */
  readonly accessRuntime?: WorkerAccessRuntime;
  /** Protocol seam for Worker-composition tests; authorization always precedes it. */
  readonly mcpHandler?: typeof handleMcpRequest;
  /** Account connection seam for proving request-ordering without test D1. */
  readonly mcpConnections?: Pick<McpConnectionCapability, "authorize">;
  /** Production-safe MCP audit sink; tests may inject a synchronous collector. */
  readonly mcpAudit?: McpAuditSink;
  /** Correlation seam for tests; production generates one value per request. */
  readonly mcpCorrelationId?: string | (() => string);
}

const PRIVATE_NO_STORE = "no-store, private";
const DEFAULT_MCP_AUDIT = createMcpAuditSink();

const unreachablePreflightCapability = async (): Promise<never> => {
  throw new Error("MCP preflight cannot execute tools");
};

const authorizePreflightConnection = async (): Promise<void> => undefined;

/** OPTIONS is transport-only, so these capabilities can never reach D1. */
const MCP_PREFLIGHT_CAPABILITIES: McpCapabilities = {
  account: { getBasicProfile: unreachablePreflightCapability },
};

function workerDb(env: WorkerEnv): D1Database {
  return getDbOrApiError(env);
}

function accountRepositoryFor(env: WorkerEnv): AccountRepository {
  return {
    insertUser: (user) => new D1AccountRepository(workerDb(env)).insertUser(user),
    findUserByUsername: (username) =>
      new D1AccountRepository(workerDb(env)).findUserByUsername(username),
    findUserById: (id) => new D1AccountRepository(workerDb(env)).findUserById(id),
  };
}

function externalIdentityRepositoryFor(
  env: WorkerEnv,
): ExternalIdentityRepository {
  return {
    find: (key) => createD1ExternalIdentityRepository(workerDb(env)).find(key),
    listByUser: (userId) =>
      createD1ExternalIdentityRepository(workerDb(env)).listByUser(userId),
    link: (input) => createD1ExternalIdentityRepository(workerDb(env)).link(input),
  };
}

function mcpConnectionRepositoryFor(
  env: WorkerEnv,
): McpConnectionRepository {
  return {
    authorize: (input) =>
      createD1McpConnectionRepository(workerDb(env)).authorize(input),
    listByUser: (userId) =>
      createD1McpConnectionRepository(workerDb(env)).listByUser(userId),
    setEnabled: (userId, clientKey, enabled, nowMs) =>
      createD1McpConnectionRepository(workerDb(env)).setEnabled(
        userId,
        clientKey,
        enabled,
        nowMs,
      ),
    removeDisabled: (userId, clientKey) =>
      createD1McpConnectionRepository(workerDb(env)).removeDisabled(userId, clientKey),
  };
}

function auth() {
  return {
    requireSession: (request: Request, env: WorkerEnv) => requireSession(request, env),
    requireCsrf: (request: Request, claims: Awaited<ReturnType<typeof requireSession>>) =>
      requireCsrf(request, claims),
  };
}

function createWorkerServices(env: WorkerEnv) {
  const sharedAuth = auth();
  const accountRepository = accountRepositoryFor(env);
  const accountIds = new PlatformAccountIds();
  const accountClock = new PlatformAccountClock();
  const account = new AccountApplication({
    repository: accountRepository,
    password: new PlatformPasswordPort(),
    ids: accountIds,
    clock: accountClock,
  });
  const accessIdentity = new AccessIdentityApplication({
    identities: externalIdentityRepositoryFor(env),
    accounts: accountRepository,
    ids: accountIds,
    clock: accountClock,
  });
  const mcpConnections = new McpConnectionApplication({
    repository: mcpConnectionRepositoryFor(env),
    clock: systemClock,
  });

  return {
    sharedAuth,
    account,
    accessIdentity,
    mcpConnections,
  };
}

function lazyBrowserAccessVerifier(
  env: WorkerEnv,
  accessRuntime: WorkerAccessRuntime,
): AccessAssertionVerifier {
  return {
    verify: (request) => accessRuntime.resolve(env).browser.verify(request),
  };
}

/** Build the complete API router for one Worker environment. */
export function createWorkerRouter(
  env: WorkerEnv,
  dependencies: WorkerCompositionDependencies = {},
): Router<WorkerEnv> {
  const router = new Router<WorkerEnv>();
  const services = createWorkerServices(env);
  const accessRuntime = dependencies.accessRuntime ?? defaultWorkerAccessRuntime;

  router.get("/api/health", () => json({ ok: true }));
  registerAccountRoutes(router, {
    application: services.account,
    session: services.sharedAuth,
  });
  registerAccountAccessRoutes(router, {
    application: services.accessIdentity,
    access: lazyBrowserAccessVerifier(env, accessRuntime),
    session: services.sharedAuth,
    allowedOrigin: (runtime) => accessRuntime.resolve(runtime).config.appOrigin,
  });
  registerMcpConnectionRoutes(router, {
    application: services.mcpConnections,
    session: services.sharedAuth,
  });
  return router;
}

function privateNoStore(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set("Cache-Control", PRIVATE_NO_STORE);
  headers.set("Pragma", "no-cache");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function mcpBoundaryError(error: unknown): Response {
  const safeKnownFailure =
    error instanceof ApiError &&
    (error.code === "server_misconfigured" ||
      error.code === "access_auth_unavailable");
  const response =
    isApiError(error) && (apiErrorStatus(error) < 500 || safeKnownFailure)
      ? fromApiError(error)
      : fromApiError(ApiError.internal("internal_error", "internal error"));
  return privateNoStore(response);
}

function mcpTransport(config: {
  readonly mcpOrigin: string;
  readonly mcpHostname: string;
}): McpRequestDependencies["transport"] {
  return {
    publicOrigin: config.mcpOrigin,
    allowedHostnames: [config.mcpHostname],
    allowedOriginHostnames: [config.mcpHostname],
  };
}

function mcpTransportRejection(
  request: Request,
  config: { readonly mcpHostname: string },
): Response | undefined {
  return (
    hostHeaderValidationResponse(request, [config.mcpHostname]) ??
    originValidationResponse(request, [config.mcpHostname])
  );
}

function mcpCorrelationId(
  dependency: WorkerCompositionDependencies["mcpCorrelationId"],
): string {
  if (typeof dependency === "function") return dependency();
  return dependency ?? crypto.randomUUID();
}

function mcpBoundaryErrorClass(error: unknown): McpAuditErrorClass {
  if (isApiError(error)) {
    switch (error.code) {
      case "access_unauthenticated":
      case "access_auth_unavailable":
      case "access_identity_unlinked":
        return error.code;
      default:
        break;
    }
  }
  return "internal_error";
}

function mcpBoundaryOutcome(errorClass: McpAuditErrorClass): McpAuditOutcome {
  return errorClass === "access_unauthenticated" ||
    errorClass === "access_identity_unlinked" ||
    errorClass === "transport_rejected"
    ? "client_error"
    : "internal_error";
}

async function handleExactMcpRequest(
  request: Request,
  env: WorkerEnv,
  dependencies: WorkerCompositionDependencies,
): Promise<Response> {
  const startedAt = Date.now();
  const correlationId = mcpCorrelationId(dependencies.mcpCorrelationId);
  const audit = dependencies.mcpAudit ?? DEFAULT_MCP_AUDIT;
  let handlerInvoked = false;
  try {
    const accessRuntime = dependencies.accessRuntime ?? defaultWorkerAccessRuntime;
    const access = accessRuntime.resolve(env);
    const mcpHandler = dependencies.mcpHandler ?? handleMcpRequest;
    const transport = mcpTransport(access.config);
    const transportRejection = mcpTransportRejection(request, access.config);
    if (transportRejection !== undefined) {
      safeAudit(audit, {
        correlationId,
        method: "protocol",
        outcome: "client_error",
        errorClass: "transport_rejected",
        durationMs: Math.max(0, Date.now() - startedAt),
      });
      return privateNoStore(transportRejection);
    }

    if (request.method.toUpperCase() === "OPTIONS") {
      handlerInvoked = true;
      return privateNoStore(
        await mcpHandler(request, {
          principal: { userId: "preflight-only" },
          capabilities: MCP_PREFLIGHT_CAPABILITIES,
          authorizeConnection: authorizePreflightConnection,
          transport,
          audit,
          correlationId: () => correlationId,
        }),
      );
    }

    // Access verification is intentionally first: a missing/wrong assertion,
    // including a browser-audience JWT or cookie-only request, cannot touch D1.
    const principal = await access.mcp.verify(request);
    const services = createWorkerServices(env);
    const userId = await services.accessIdentity.resolveUserId(principal);
    const principalHash = await hashMcpPrincipal(userId);
    const mcpConnections = dependencies.mcpConnections ?? services.mcpConnections;
    const capabilities: McpCapabilities = { account: services.account };

    handlerInvoked = true;
    const response = await mcpHandler(request, {
      principal: { userId },
      capabilities,
      authorizeConnection: (client, activity) =>
        mcpConnections.authorize(userId, client, activity),
      transport,
      audit,
      correlationId: () => correlationId,
      principalHash,
    });
    return privateNoStore(response);
  } catch (error) {
    if (!handlerInvoked) {
      const errorClass = mcpBoundaryErrorClass(error);
      safeAudit(audit, {
        correlationId,
        method: "protocol",
        outcome: mcpBoundaryOutcome(errorClass),
        errorClass,
        durationMs: Math.max(0, Date.now() - startedAt),
      });
    }
    return mcpBoundaryError(error);
  }
}

function requestPath(request: Request): string {
  // Do not use URL.pathname for this security dispatch: WHATWG parsing removes
  // literal and percent-encoded dot segments and normalizes backslashes. Read
  // the serialized request target without decoding so any representation that
  // still reaches the Worker remains a lookalike rather than becoming /mcp.
  const absolute = /^[A-Za-z][A-Za-z0-9+.-]*:\/\/[^/?#]*(\/[^?#]*)?(?:[?#]|$)/.exec(
    request.url,
  );
  if (absolute !== null) return absolute[1] ?? "/";
  return request.url.split(/[?#]/, 1)[0] || "/";
}

export async function handleWorkerRequest(
  request: Request,
  env: WorkerEnv,
  logger?: RequestLogger,
  dependencies: WorkerCompositionDependencies = {},
): Promise<Response> {
  const startedAt = Date.now();
  const response =
    requestPath(request) === "/mcp"
      ? await handleExactMcpRequest(request, env, dependencies)
      : await createWorkerRouter(env, dependencies).handle(request, env);
  const secured = privateNoStore(response);
  secured.headers.set("X-Content-Type-Options", "nosniff");
  logRequest(request, secured, startedAt, logger);
  return secured;
}

export default {
  fetch(request: Request, env: WorkerEnv): Promise<Response> {
    return handleWorkerRequest(request, env);
  },
};
