import { McpServer, type CallToolResult } from "@modelcontextprotocol/server";
import { createMcpHandler } from "agents/mcp/server";
import {
  getUserProfileInputSchema, MCP_EXEC_ANNOTATIONS, MCP_EXEC_TOOL_CONTRACT,
  MCP_ROUTE, MCP_TOOL_NAMES,
  type McpAuditToolName, type McpOperationName, type McpToolName,
} from "./contracts";
import {
  auditToolForExecCommand,
  executeExecCommand,
} from "./exec-command";
import {
  McpRequestBodyError,
  prepareBoundedMcpRequest,
} from "./request-body";
import { mcpClientInfoFromRequestBody } from "./client-identity";
import {
  failedToolResult,
  McpToolRequestAbortedError,
  McpToolTimeoutError,
  successfulToolResult,
} from "./tool-result";
import type {
  McpAuditErrorClass,
  McpAuditOutcome,
  McpAuditSink,
  McpCapabilities,
  McpRequestDependencies,
} from "./types";
import {
  apiErrorBody,
  apiErrorStatus,
  isApiError,
} from "../../../platform/http/api-error";

const SERVER_INFO = { name: "worker-mcp", version: "0.1.0" } as const;
export const MCP_TOOL_TIMEOUT_MS = 10_000;

export function safeAudit(
  sink: McpAuditSink | undefined,
  event: Parameters<McpAuditSink["record"]>[0],
): void {
  if (sink === undefined) return;
  try {
    Promise.resolve(sink.record(event)).catch(() => undefined);
  } catch {
    // Observability is fail-open and raw audit-sink failures are never logged.
  }
}

function sanitizedToolName(value: unknown): McpToolName | undefined {
  if (typeof value !== "string") return undefined;
  return (MCP_TOOL_NAMES as readonly string[]).includes(value)
    ? value as McpToolName
    : undefined;
}

function parsedToolsCallMetadata(value: unknown): { readonly tool?: McpToolName } | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const body = value as Record<string, unknown>;
  if (body.method !== "tools/call") return undefined;
  const params = body.params;
  if (typeof params !== "object" || params === null || Array.isArray(params)) {
    return {};
  }
  return {
    tool: sanitizedToolName((params as Record<string, unknown>).name),
  };
}

async function runWithToolTimeout<T>(
  action: (signal: AbortSignal) => Promise<T>,
  requestSignal: AbortSignal,
): Promise<T> {
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const requestAbort = new McpToolRequestAbortedError();
  const relayRequestAbort = () => {
    if (!controller.signal.aborted) controller.abort(requestAbort);
  };
  const removeRequestAbortListener = () => {
    requestSignal.removeEventListener("abort", relayRequestAbort);
  };
  if (requestSignal.aborted) relayRequestAbort();
  else requestSignal.addEventListener("abort", relayRequestAbort, { once: true });

  let rejectOnAbort: (() => void) | undefined;
  const aborted = new Promise<never>((_resolve, reject) => {
    rejectOnAbort = () => {
      const reason = controller.signal.reason;
      reject(
        reason instanceof McpToolTimeoutError || reason instanceof McpToolRequestAbortedError
          ? reason
          : requestAbort,
      );
    };
    if (controller.signal.aborted) rejectOnAbort();
    else controller.signal.addEventListener("abort", rejectOnAbort, { once: true });
  });

  const actionPromise = Promise.resolve().then(() => {
    if (controller.signal.aborted) {
      const reason = controller.signal.reason;
      throw reason instanceof McpToolTimeoutError || reason instanceof McpToolRequestAbortedError
        ? reason
        : requestAbort;
    }
    return action(controller.signal);
  });
  timeout = setTimeout(() => {
    if (!controller.signal.aborted) controller.abort(new McpToolTimeoutError());
  }, MCP_TOOL_TIMEOUT_MS);
  try {
    return await Promise.race([actionPromise, aborted]);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
    removeRequestAbortListener();
    if (rejectOnAbort !== undefined) {
      controller.signal.removeEventListener("abort", rejectOnAbort);
    }
  }
}

function createServer(
  userId: string,
  capabilities: McpCapabilities,
  audit: McpAuditSink | undefined,
  nowMs: () => number,
  correlationId: string,
  principalHash: string | undefined,
  onToolAudit: (outcome: McpAuditOutcome) => void,
): McpServer {
  const server = new McpServer(SERVER_INFO);

  async function execute(
    tool: McpAuditToolName,
    action: (signal: AbortSignal) => Promise<unknown>,
    requestSignal: AbortSignal,
  ): Promise<CallToolResult> {
    const startedAt = nowMs();
    let outcome: McpAuditOutcome = "success";
    try {
      return successfulToolResult(await runWithToolTimeout(action, requestSignal));
    } catch (error) {
      const failed = failedToolResult(error);
      outcome = failed.outcome;
      return failed.result;
    } finally {
      onToolAudit(outcome);
      safeAudit(audit, {
        correlationId,
        method: "tools/call",
        tool,
        outcome,
        durationMs: Math.max(0, nowMs() - startedAt),
        ...(principalHash === undefined ? {} : { principalHash }),
      });
    }
  }

  async function dispatchOperation(
    operation: McpOperationName,
    input: unknown,
    signal: AbortSignal,
  ): Promise<unknown> {
    signal.throwIfAborted();
    switch (operation) {
      case "get_user_profile": {
        getUserProfileInputSchema.parse(input);
        const profile = await capabilities.account.getBasicProfile(userId);
        return { username: profile.username };
      }
    }
  }

  server.registerTool(
    MCP_EXEC_TOOL_CONTRACT.name,
    {
      title: MCP_EXEC_TOOL_CONTRACT.title,
      description: MCP_EXEC_TOOL_CONTRACT.description,
      inputSchema: MCP_EXEC_TOOL_CONTRACT.inputSchema,
      annotations: MCP_EXEC_ANNOTATIONS,
    },
    ({ command }, ctx) =>
      execute(
        auditToolForExecCommand(command),
        (signal) => executeExecCommand(command, dispatchOperation, signal),
        ctx.mcpReq.signal,
      ),
  );

  return server;
}

function errorResponse(error: McpRequestBodyError): Response {
  return new Response(JSON.stringify({ error: { code: error.code } }), {
    status: error.status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function connectionErrorResponse(error: unknown): Response {
  const publicError = isApiError(error) && apiErrorStatus(error) < 500
    ? { status: apiErrorStatus(error), body: apiErrorBody(error) }
    : { status: 500, body: { code: "internal_error", message: "internal error" } };
  return new Response(JSON.stringify(publicError.body), {
    status: publicError.status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function connectionErrorClass(error: unknown): McpAuditErrorClass {
  if (isApiError(error)) {
    if (
      error.code === "mcp_client_identity_required" ||
      error.code === "mcp_connection_revoked"
    ) {
      return error.code;
    }
  }
  return "internal_error";
}

function privateResponse(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set("cache-control", "private, no-store");
  headers.set("pragma", "no-cache");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function assertTransportPolicy(dependencies: McpRequestDependencies): void {
  if (dependencies.principal.userId.trim() === "") {
    throw new TypeError("MCP principal userId must not be empty");
  }
  if (
    dependencies.transport.allowedHostnames.length === 0 ||
    dependencies.transport.allowedOriginHostnames.length === 0
  ) {
    throw new TypeError("MCP Host and Origin allowlists must be explicit");
  }
  const publicOrigin = new URL(dependencies.transport.publicOrigin);
  const loopbackHttp =
    publicOrigin.protocol === "http:" &&
    (publicOrigin.hostname === "localhost" ||
      publicOrigin.hostname === "127.0.0.1" ||
      publicOrigin.hostname === "[::1]");
  if (
    (publicOrigin.protocol !== "https:" && !loopbackHttp) ||
    dependencies.transport.publicOrigin !== publicOrigin.origin ||
    publicOrigin.username !== "" ||
    publicOrigin.password !== "" ||
    publicOrigin.search !== "" ||
    publicOrigin.hash !== ""
  ) {
    throw new TypeError("MCP publicOrigin must be an HTTPS origin (or loopback HTTP)");
  }
  if (
    !dependencies.transport.allowedHostnames.includes(publicOrigin.hostname) ||
    !dependencies.transport.allowedOriginHostnames.includes(publicOrigin.hostname)
  ) {
    throw new TypeError("MCP public hostname must be present in both allowlists");
  }
  for (const hostname of [
    ...dependencies.transport.allowedHostnames,
    ...dependencies.transport.allowedOriginHostnames,
  ]) {
    let parsed: URL;
    try {
      parsed = new URL(`https://${hostname}`);
    } catch {
      throw new TypeError("MCP Host and Origin allowlists require bare hostnames");
    }
    if (
      parsed.host !== hostname ||
      parsed.port !== "" ||
      parsed.pathname !== "/" ||
      parsed.search !== "" ||
      parsed.hash !== ""
    ) {
      throw new TypeError("MCP Host and Origin allowlists require bare hostnames");
    }
  }
}

function responseAuditOutcome(response: Response): McpAuditOutcome {
  if (response.status >= 500) return "internal_error";
  if (response.status >= 400) return "client_error";
  return "success";
}

/**
 * Serve one already-authenticated request with a request-local principal and
 * a fresh MCP handler/server factory. Access assertion validation stays in
 * the Worker composition layer and is intentionally absent here.
 */
export async function handleMcpRequest(
  request: Request,
  dependencies: McpRequestDependencies,
): Promise<Response> {
  const nowMs = dependencies.nowMs ?? Date.now;
  const startedAt = nowMs();
  const correlationId = (dependencies.correlationId ?? (() => crypto.randomUUID()))();
  const userId = dependencies.principal.userId;
  let outcome: McpAuditOutcome = "internal_error";
  let errorClass: McpAuditErrorClass | undefined;
  let response: Response | undefined;
  try {
    assertTransportPolicy(dependencies);

    let prepared;
    try {
      prepared = await prepareBoundedMcpRequest(request);
    } catch (error) {
      response = privateResponse(
        error instanceof McpRequestBodyError
          ? errorResponse(error)
          : errorResponse(new McpRequestBodyError(400, "invalid_request")),
      );
      outcome = responseAuditOutcome(response);
      return response;
    }

    const parsedToolsCall = parsedToolsCallMetadata(prepared.parsedBody);
    if (request.method.toUpperCase() === "POST") {
      try {
        const client = mcpClientInfoFromRequestBody(prepared.parsedBody);
        await dependencies.authorizeConnection(client, {
          toolCall: parsedToolsCall !== undefined,
        });
      } catch (error) {
        response = privateResponse(connectionErrorResponse(error));
        outcome = responseAuditOutcome(response);
        errorClass = connectionErrorClass(error);
        return response;
      }
    }

    let toolAuditOutcome: McpAuditOutcome | undefined;
    const handler = createMcpHandler(
      () =>
        createServer(
          userId,
          dependencies.capabilities,
          dependencies.audit,
          nowMs,
          correlationId,
          dependencies.principalHash,
          (toolOutcome) => { toolAuditOutcome = toolOutcome; },
        ),
      {
        route: MCP_ROUTE,
        corsOptions: { origin: dependencies.transport.publicOrigin },
        allowedHostnames: [...dependencies.transport.allowedHostnames],
        allowedOriginHostnames: [...dependencies.transport.allowedOriginHostnames],
        legacy: "stateless",
      },
    );

    response = privateResponse(await handler.fetch(prepared.request, {
      parsedBody: prepared.parsedBody,
    }));
    if (parsedToolsCall !== undefined && toolAuditOutcome === undefined) {
      outcome = "client_error";
      safeAudit(dependencies.audit, {
        correlationId,
        method: "tools/call",
        ...(parsedToolsCall.tool === undefined ? {} : { tool: parsedToolsCall.tool }),
        outcome,
        durationMs: Math.max(0, nowMs() - startedAt),
        ...(dependencies.principalHash === undefined
          ? {}
          : { principalHash: dependencies.principalHash }),
      });
    } else {
      outcome = toolAuditOutcome ?? responseAuditOutcome(response);
    }
    return response;
  } finally {
    safeAudit(dependencies.audit, {
      correlationId,
      method: "protocol",
      outcome,
      ...(errorClass === undefined ? {} : { errorClass }),
      durationMs: Math.max(0, nowMs() - startedAt),
      ...(dependencies.principalHash === undefined
        ? {}
        : { principalHash: dependencies.principalHash }),
    });
  }
}

export type {
  McpAuditErrorClass,
  McpAuditEvent,
  McpAuditSink,
  McpAuditOutcome,
  McpPrincipal,
  McpCapabilities,
  McpRequestDependencies,
  McpTransportPolicy,
} from "./types";
