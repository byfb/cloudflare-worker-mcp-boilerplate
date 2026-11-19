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
  it("extracts the modern per-request client identity", () => {
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

  it("uses legacy clientInfo only on initialize and gives per-request metadata precedence", () => {
    const legacy = { name: "example-cli", version: "1" };
    const modern = { name: "modern-client", version: "2" };
    const initialize = (params: object) => mcpClientInfoFromRequestBody({ method: "initialize", params });
    expect(initialize({ clientInfo: legacy })).toEqual(legacy);
    expect(initialize({ clientInfo: legacy, _meta: { [MCP_CLIENT_INFO_META_KEY]: modern } })).toEqual(modern);
    expect(() => initialize({ clientInfo: legacy, _meta: { [MCP_CLIENT_INFO_META_KEY]: null } })).toThrow();
    expect(mcpClientInfoFromRequestBody({ method: "tools/list", params: { clientInfo: legacy } })).toBeUndefined();
  });

  it.each([
    { method: "notifications/initialized" },
    { method: "tools/list", params: {} },
    { method: "tools/call", params: { _meta: { progressToken: 1 } } },
  ])("accepts omitted client info on $method", (message) => {
    expect(mcpClientInfoFromRequestBody(message)).toBeUndefined();
  });

  it.each([
    undefined,
    null,
    [],
    {},
    { method: "initialize", params: {} },
    { method: "initialize", params: { clientInfo: { name: "legacy" } } },
    { method: "tools/list", params: null },
    { method: "tools/list", params: { _meta: [] } },
    body(null),
    body({ name: "chatgpt" }),
    body({ name: 7, version: "1" }),
    body({ name: "chatgpt", version: 1 }),
    body({ name: "chatgpt", version: "1", title: false }),
  ])("rejects a malformed message or client identity", (value) => {
    expect(() => mcpClientInfoFromRequestBody(value)).toThrowError(
      expect.objectContaining({
        status: 400,
        code: "mcp_client_identity_required",
        message: "valid MCP client identity is required",
      }),
    );
  });
});
