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
  APP_ORIGIN: "https://app.example.com",
};

describe("Access Worker configuration", () => {
  it("defaults MCP to the browser audience and app origin", () => {
    const config = accessWorkerConfig(env);

    expect(config).toEqual({
      issuer: "https://team.cloudflareaccess.com",
      jwksUrl: "https://team.cloudflareaccess.com/cdn-cgi/access/certs",
      browserAudience: "browser-aud",
      mcpAudience: "browser-aud",
      appOrigin: "https://app.example.com",
      appHostname: "app.example.com",
      mcpOrigin: "https://app.example.com",
      mcpHostname: "app.example.com",
    });
    expect(browserAccessVerifierConfig(config)).toEqual({
      issuer: config.issuer,
      audience: "browser-aud",
      jwksUrl: config.jwksUrl,
    });
    expect(mcpAccessVerifierConfig(config)).toEqual({
      issuer: config.issuer,
      audience: "browser-aud",
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

  it("accepts explicit shared values with the same resolved cache key as the defaults", () => {
    const defaults = accessWorkerConfig(env);
    const explicit = accessWorkerConfig({
      ...env,
      ACCESS_MCP_AUDIENCE: env.ACCESS_BROWSER_AUDIENCE,
      MCP_ORIGIN: env.APP_ORIGIN,
    });

    expect(explicit).toEqual(defaults);
    expect(accessWorkerConfigKey(explicit)).toBe(accessWorkerConfigKey(defaults));
  });

  it.each([
    { audience: "mcp-aud", origin: undefined },
    { audience: undefined, origin: "https://mcp.example.com" },
    { audience: "mcp-aud", origin: "https://mcp.example.com" },
  ])("allows independent MCP audience and origin overrides: %o", ({ audience, origin }) => {
    const config = accessWorkerConfig({
      ...env,
      ACCESS_MCP_AUDIENCE: audience,
      MCP_ORIGIN: origin,
    });

    expect(config.browserAudience).toBe("browser-aud");
    expect(config.appOrigin).toBe("https://app.example.com");
    expect(config.mcpAudience).toBe(audience ?? "browser-aud");
    expect(config.mcpOrigin).toBe(origin ?? "https://app.example.com");
    expect(config.mcpHostname).toBe(new URL(config.mcpOrigin).hostname);
    expect(browserAccessVerifierConfig(config).audience).toBe("browser-aud");
    expect(mcpAccessVerifierConfig(config).audience).toBe(audience ?? "browser-aud");
  });

  it.each([
    { ACCESS_ISSUER: undefined },
    { ACCESS_BROWSER_AUDIENCE: undefined },
    { ACCESS_BROWSER_AUDIENCE: "", ACCESS_MCP_AUDIENCE: "mcp-aud" },
    { ACCESS_MCP_AUDIENCE: "" },
    { ACCESS_MCP_AUDIENCE: " mcp-aud" },
    { ACCESS_MCP_AUDIENCE: "mcp\naud" },
    { ACCESS_MCP_AUDIENCE: null },
    { ACCESS_MCP_AUDIENCE: 42 },
    { APP_ORIGIN: undefined },
    { APP_ORIGIN: "http://app.example.com" },
    { APP_ORIGIN: "https://user@app.example.com" },
    { APP_ORIGIN: "https://app.example.com/path" },
    { APP_ORIGIN: "https://app.example.com?unsafe=1" },
    { MCP_ORIGIN: "http://mcp.example.com" },
    { MCP_ORIGIN: "https://mcp.example.com/path" },
    { MCP_ORIGIN: "" },
    { MCP_ORIGIN: null },
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
