import type {
  AccessAssertionVerifier,
  AccessAssertionVerifierConfig,
} from "../../platform/auth";
import { describe, expect, it, vi } from "vitest";
import type { AccessWorkerEnv } from "./access-config";
import { WorkerAccessRuntime } from "./access-runtime";

const baseEnv: AccessWorkerEnv = {
  ACCESS_ISSUER: "https://team.cloudflareaccess.com",
  ACCESS_JWKS_URL: "https://team.cloudflareaccess.com/cdn-cgi/access/certs",
  ACCESS_BROWSER_AUDIENCE: "browser-aud",
  ACCESS_MCP_AUDIENCE: "mcp-aud",
  APP_ORIGIN: "https://app.example.com",
  MCP_ORIGIN: "https://mcp.example.com",
};

describe("Worker Access verifier runtime", () => {
  it("reuses one pair and retains only the latest configuration", () => {
    const createVerifier = vi.fn(
      (config: AccessAssertionVerifierConfig): AccessAssertionVerifier => ({
        verify: vi.fn(async () => ({
          issuer: config.issuer,
          subject: config.audience,
          email: null,
        })),
      }),
    );
    const runtime = new WorkerAccessRuntime(createVerifier);

    const first = runtime.resolve(baseEnv);
    expect(runtime.resolve(baseEnv)).toBe(first);
    expect(createVerifier).toHaveBeenCalledTimes(2);
    expect(createVerifier.mock.calls.map(([config]) => config.audience)).toEqual([
      "browser-aud",
      "mcp-aud",
    ]);

    const secondEnv = { ...baseEnv, ACCESS_MCP_AUDIENCE: "mcp-aud-v2" };
    const second = runtime.resolve(secondEnv);
    expect(second).not.toBe(first);
    expect(runtime.resolve(secondEnv)).toBe(second);
    expect(createVerifier).toHaveBeenCalledTimes(4);

    // Returning to an earlier configuration must create a new pair. This
    // proves the runtime is not accumulating a map of historical deployments.
    expect(runtime.resolve(baseEnv)).not.toBe(first);
    expect(createVerifier).toHaveBeenCalledTimes(6);
  });
});
