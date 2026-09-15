import { describe, expect, it } from "vitest";
import {
  accessWorkerConfig,
  accessWorkerConfigKey,
  browserAccessVerifierConfig,
  mcpAccessVerifierConfig,
  type AccessWorkerEnv,
} from "./access-config";

const env: AccessWorkerEnv = {
  ACCESS_ISSUER: "https://team.cloudflareaccess.com",
  ACCESS_JWKS_URL: "https://team.cloudflareaccess.com/cdn-cgi/access/certs",
  ACCESS_BROWSER_AUDIENCE: "browser-aud",
  ACCESS_MCP_AUDIENCE: "mcp-aud",
  APP_ORIGIN: "https://app.example.com",
  MCP_ORIGIN: "https://mcp.example.com",
};

describe("Access Worker configuration", () => {
  it("pins separate browser and MCP audiences and canonical origins", () => {
    const config = accessWorkerConfig(env);

    expect(config).toEqual({
      issuer: "https://team.cloudflareaccess.com",
      jwksUrl: "https://team.cloudflareaccess.com/cdn-cgi/access/certs",
      browserAudience: "browser-aud",
      mcpAudience: "mcp-aud",
      appOrigin: "https://app.example.com",
      appHostname: "app.example.com",
      mcpOrigin: "https://mcp.example.com",
      mcpHostname: "mcp.example.com",
    });
    expect(browserAccessVerifierConfig(config)).toEqual({
      issuer: config.issuer,
      audience: "browser-aud",
      jwksUrl: config.jwksUrl,
    });
    expect(mcpAccessVerifierConfig(config)).toEqual({
      issuer: config.issuer,
      audience: "mcp-aud",
      jwksUrl: config.jwksUrl,
    });
    expect(accessWorkerConfigKey(config)).not.toContain("undefined");
  });

  it("allows explicit loopback HTTP only for local development", () => {
    expect(accessWorkerConfig({
      ...env,
      APP_ORIGIN: "http://127.0.0.1:5173",
      MCP_ORIGIN: "http://localhost:8787",
    })).toMatchObject({
      appOrigin: "http://127.0.0.1:5173",
      appHostname: "127.0.0.1",
      mcpOrigin: "http://localhost:8787",
      mcpHostname: "localhost",
    });
  });

  it("defaults MCP transport to the app origin for existing same-host deployments", () => {
    const config = accessWorkerConfig({ ...env, MCP_ORIGIN: undefined });

    expect(config).toMatchObject({
      appOrigin: "https://app.example.com",
      appHostname: "app.example.com",
      mcpOrigin: "https://app.example.com",
      mcpHostname: "app.example.com",
    });
  });

  it.each([
    { ACCESS_ISSUER: undefined },
    { ACCESS_MCP_AUDIENCE: "browser-aud" },
    { APP_ORIGIN: "http://app.example.com" },
    { APP_ORIGIN: "https://user@app.example.com" },
    { APP_ORIGIN: "https://app.example.com/path" },
    { APP_ORIGIN: "https://app.example.com?unsafe=1" },
    { MCP_ORIGIN: "http://mcp.example.com" },
    { MCP_ORIGIN: "https://mcp.example.com/path" },
    { ACCESS_ISSUER: " https://team.cloudflareaccess.com" },
  ])("fails closed for missing or unsafe variables: %o", (override) => {
    expect(() => accessWorkerConfig({ ...env, ...override })).toThrowError(
      expect.objectContaining({
        status: 500,
        code: "server_misconfigured",
        message: "Access authentication is not configured",
      }),
    );
  });
});
