import type { AccessAssertionVerifierConfig } from "../../platform/auth/access";
import { ApiError } from "../../platform/http/api-error";

export interface AccessWorkerEnv {
  ACCESS_ISSUER?: unknown;
  ACCESS_JWKS_URL?: unknown;
  ACCESS_BROWSER_AUDIENCE?: unknown;
  ACCESS_MCP_AUDIENCE?: unknown;
  APP_ORIGIN?: unknown;
  MCP_ORIGIN?: unknown;
}

export interface AccessWorkerConfig {
  readonly issuer: string;
  readonly jwksUrl: string;
  readonly browserAudience: string;
  readonly mcpAudience: string;
  readonly appOrigin: string;
  readonly appHostname: string;
  readonly mcpOrigin: string;
  readonly mcpHostname: string;
}

function misconfigured(): ApiError {
  return ApiError.internal(
    "server_misconfigured",
    "Access authentication is not configured",
  );
}

function requiredString(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 2_048 ||
    value.trim() !== value ||
    /[\u0000-\u001f\u007f]/.test(value)
  ) {
    throw misconfigured();
  }
  return value;
}

function canonicalAppOrigin(value: unknown): { origin: string; hostname: string } {
  const configured = requiredString(value);
  let url: URL;
  try {
    url = new URL(configured);
  } catch {
    throw misconfigured();
  }

  const localHttp =
    url.protocol === "http:" &&
    (url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]");
  if (
    (url.protocol !== "https:" && !localHttp) ||
    url.username !== "" ||
    url.password !== "" ||
    url.pathname !== "/" ||
    url.search !== "" ||
    url.hash !== "" ||
    url.origin !== configured
  ) {
    throw misconfigured();
  }
  return { origin: url.origin, hostname: url.hostname };
}

/** Resolve immutable browser and MCP Access trust inputs from Worker variables. */
export function accessWorkerConfig(env: AccessWorkerEnv): AccessWorkerConfig {
  const issuer = requiredString(env.ACCESS_ISSUER);
  const jwksUrl = requiredString(env.ACCESS_JWKS_URL);
  const browserAudience = requiredString(env.ACCESS_BROWSER_AUDIENCE);
  const mcpAudience = requiredString(env.ACCESS_MCP_AUDIENCE);
  const app = canonicalAppOrigin(env.APP_ORIGIN);
  const mcp = env.MCP_ORIGIN === undefined
    ? app
    : canonicalAppOrigin(env.MCP_ORIGIN);

  if (browserAudience === mcpAudience) throw misconfigured();
  return {
    issuer,
    jwksUrl,
    browserAudience,
    mcpAudience,
    appOrigin: app.origin,
    appHostname: app.hostname,
    mcpOrigin: mcp.origin,
    mcpHostname: mcp.hostname,
  };
}

export function browserAccessVerifierConfig(
  config: AccessWorkerConfig,
): AccessAssertionVerifierConfig {
  return {
    issuer: config.issuer,
    audience: config.browserAudience,
    jwksUrl: config.jwksUrl,
  };
}

export function mcpAccessVerifierConfig(
  config: AccessWorkerConfig,
): AccessAssertionVerifierConfig {
  return {
    issuer: config.issuer,
    audience: config.mcpAudience,
    jwksUrl: config.jwksUrl,
  };
}

export function accessWorkerConfigKey(config: AccessWorkerConfig): string {
  return JSON.stringify([
    config.issuer,
    config.jwksUrl,
    config.browserAudience,
    config.mcpAudience,
    config.appOrigin,
    config.mcpOrigin,
  ]);
}
