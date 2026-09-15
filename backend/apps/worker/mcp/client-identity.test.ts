import { describe, expect, it } from "vitest";
import {
  MCP_CLIENT_INFO_META_KEY,
  mcpClientInfoFromRequestBody,
} from "./client-identity";

function body(clientInfo: unknown): unknown {
  return {
    jsonrpc: "2.0",
    id: 1,
    method: "tools/list",
    params: {
      _meta: { [MCP_CLIENT_INFO_META_KEY]: clientInfo },
    },
  };
}

describe("mcpClientInfoFromRequestBody", () => {
  it("extracts only the modern per-request client identity envelope", () => {
    expect(mcpClientInfoFromRequestBody(body({
      name: "chatgpt",
      title: "ChatGPT",
      version: "2026.8.11",
      ignored: "not persisted",
    }))).toEqual({
      name: "chatgpt",
      title: "ChatGPT",
      version: "2026.8.11",
    });
  });

  it.each([
    undefined,
    null,
    [],
    {},
    { params: {} },
    { params: { clientInfo: { name: "legacy", version: "1" } } },
    body(null),
    body({ name: "chatgpt" }),
    body({ name: 7, version: "1" }),
    body({ name: "chatgpt", version: 1 }),
    body({ name: "chatgpt", version: "1", title: false }),
  ])("rejects missing or malformed client identity without alternate sources", (value) => {
    expect(() => mcpClientInfoFromRequestBody(value)).toThrowError(
      expect.objectContaining({
        status: 400,
        code: "mcp_client_identity_required",
        message: "valid MCP client identity is required",
      }),
    );
  });
});
