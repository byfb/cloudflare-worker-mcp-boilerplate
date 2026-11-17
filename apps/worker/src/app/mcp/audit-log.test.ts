import { describe, expect, it, vi } from "vitest";
import {
  createMcpAuditSink,
  hashMcpPrincipal,
} from "./audit-log";

describe("MCP audit log", () => {
  it("hashes principals with a stable domain-separated SHA-256 value", async () => {
    const first = await hashMcpPrincipal("internal-user-a");
    const repeat = await hashMcpPrincipal("internal-user-a");
    const other = await hashMcpPrincipal("internal-user-b");

    expect(first).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(repeat).toBe(first);
    expect(other).not.toBe(first);
    expect(first).not.toContain("internal-user-a");
  });

  it("emits only the allowlisted JSON-line fields", () => {
    const logger = vi.fn();
    const sink = createMcpAuditSink(logger);

    sink.record({
      correlationId: "corr-1",
      method: "tools/call",
      tool: "get_user_profile",
      principalHash: "sha256:" + "a".repeat(64),
      outcome: "internal_error",
      errorClass: "internal_error",
      durationMs: 12.9,
      assertion: "bearer-secret",
      args: { record_id: "private" },
      results: { private_value: 80 },
      rawError: "private error",
    } as unknown as Parameters<typeof sink.record>[0]);

    expect(logger).toHaveBeenCalledTimes(1);
    expect(logger.mock.calls[0][0]).toBe(
      JSON.stringify({
        type: "mcp_audit",
        protocol: "mcp",
        correlationId: "corr-1",
        method: "tools/call",
        tool: "get_user_profile",
        principalHash: "sha256:" + "a".repeat(64),
        outcome: "internal_error",
        errorClass: "internal_error",
        durationMs: 12,
      }),
    );
    expect(logger.mock.calls[0][0]).not.toMatch(
      /bearer-secret|private|private_value|rawError|assertion|args|results/,
    );
  });

  it("attributes both catalog operations without retaining filters", () => {
    const logger = vi.fn();
    const sink = createMcpAuditSink(logger);

    for (const tool of ["exec", "get_user_profile"] as const) {
      sink.record({
        correlationId: "corr-history",
        method: "tools/call",
        tool,
        outcome: "success",
        durationMs: 2,
        query: "private sensitive query",
        cursor: "private cursor",
      } as unknown as Parameters<typeof sink.record>[0]);
    }

    expect(logger.mock.calls.map(([line]) => JSON.parse(line))).toEqual([
      expect.objectContaining({ tool: "exec" }),
      expect.objectContaining({ tool: "get_user_profile" }),
    ]);
    expect(JSON.stringify(logger.mock.calls)).not.toMatch(/sensitive|cursor/);
  });
});
