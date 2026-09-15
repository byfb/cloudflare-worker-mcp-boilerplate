import { describe, expect, it } from "vitest";
import { logRequest } from "./request-log";

describe("request logging", () => {
  it("emits only method, pathname, status, and elapsed ms", () => {
    const lines: string[] = [];
    const line = logRequest(
      new Request("https://example.test/api/me?token=secret", { method: "GET" }),
      new Response(null, { status: 204 }),
      100,
      (value) => lines.push(value),
      123,
    );
    expect(line).toBe("GET /api/me 204 23ms");
    expect(lines).toEqual([line]);
    expect(line).not.toContain("secret");
  });
});
