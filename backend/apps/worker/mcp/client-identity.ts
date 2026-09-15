import type { McpClientInfo } from "../../../modules/account/public/mcp-connections";
import { ApiError } from "../../../platform/http/api-error";

export const MCP_CLIENT_INFO_META_KEY = "io.modelcontextprotocol/clientInfo";

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function identityRequired(): never {
  throw ApiError.badRequest(
    "mcp_client_identity_required",
    "valid MCP client identity is required",
  );
}

/**
 * Read MCP 2026 per-request implementation metadata without accepting legacy
 * initialize-only identity or caller-defined query/header substitutes.
 */
export function mcpClientInfoFromRequestBody(body: unknown): McpClientInfo {
  const params = record(record(body)?.params);
  const meta = record(params?._meta);
  const clientInfo = record(meta?.[MCP_CLIENT_INFO_META_KEY]);
  if (
    clientInfo === undefined ||
    typeof clientInfo.name !== "string" ||
    typeof clientInfo.version !== "string" ||
    (clientInfo.title !== undefined && typeof clientInfo.title !== "string")
  ) {
    return identityRequired();
  }
  return {
    name: clientInfo.name,
    version: clientInfo.version,
    ...(clientInfo.title === undefined ? {} : { title: clientInfo.title }),
  };
}
