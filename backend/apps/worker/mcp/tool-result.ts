import type { CallToolResult } from "@modelcontextprotocol/server";
import { MCP_MAX_TOOL_RESULT_BYTES } from "./contracts";
import {
  apiErrorBody,
  apiErrorStatus,
  ApiError,
  isApiError,
} from "../../../platform/http/api-error";

const FORBIDDEN_OUTPUT_KEYS = new Set([
  "user_id",
  "userId",
  "owner_id",
  "ownerId",
  "issuer",
  "subject",
  "email",
  "password",
  "password_hash",
  "jwt",
  "csrf",
  "access_token",
  "refresh_token",
]);

const SAFE_CLIENT_ERROR_CODE = /^[a-z][a-z0-9_]{0,63}$/;
const RESULT_TOO_LARGE_MESSAGE = "The tool result exceeded its maximum size.";

export class McpToolTimeoutError extends Error {
  constructor() {
    super("bounded MCP tool execution timed out");
    this.name = "McpToolTimeoutError";
  }
}

/** Raised when the MCP request is cancelled by its caller. */
export class McpToolRequestAbortedError extends Error {
  constructor() {
    super("bounded MCP tool execution was cancelled by the request");
    this.name = "McpToolRequestAbortedError";
  }
}

/** A deliberately authored, value-free exec-command error safe to return. */
export class McpExecCommandError extends Error {
  constructor(
    readonly code: string,
    readonly publicMessage: string,
  ) {
    super(publicMessage);
    this.name = "McpExecCommandError";
  }
}

function sanitizedJson(value: unknown): unknown {
  const encoded = JSON.stringify(value, (key, entry: unknown) =>
    FORBIDDEN_OUTPUT_KEYS.has(key) ? undefined : entry,
  );
  if (encoded === undefined) return null;
  if (new TextEncoder().encode(encoded).byteLength > MCP_MAX_TOOL_RESULT_BYTES) {
    throw ApiError.badRequest("result_too_large", RESULT_TOO_LARGE_MESSAGE);
  }
  return JSON.parse(encoded) as unknown;
}

function structuredObject(value: unknown): Record<string, unknown> {
  const sanitized = sanitizedJson(value);
  if (typeof sanitized === "object" && sanitized !== null && !Array.isArray(sanitized)) {
    return sanitized as Record<string, unknown>;
  }
  return { result: sanitized };
}

export function successfulToolResult(value: unknown): CallToolResult {
  const structuredContent = structuredObject(value);
  const encoded = JSON.stringify(structuredContent);
  const result: CallToolResult = {
    content: [{ type: "text", text: encoded }],
    structuredContent,
  };
  if (
    new TextEncoder().encode(JSON.stringify(result)).byteLength >
    MCP_MAX_TOOL_RESULT_BYTES
  ) {
    throw ApiError.badRequest("result_too_large", RESULT_TOO_LARGE_MESSAGE);
  }
  return result;
}

/** Measure against the exact sanitized, duplicated MCP result representation. */
export function successfulToolResultFits(value: unknown): boolean {
  try {
    successfulToolResult(value);
    return true;
  } catch (error) {
    if (isApiError(error) && apiErrorBody(error).code === "result_too_large") {
      return false;
    }
    throw error;
  }
}

function publicClientCode(error: unknown): string | undefined {
  if (!isApiError(error)) return undefined;
  const status = apiErrorStatus(error);
  const code = apiErrorBody(error).code;
  return status >= 400 && status < 500 && SAFE_CLIENT_ERROR_CODE.test(code)
    ? code
    : undefined;
}

export function failedToolResult(error: unknown): {
  readonly result: CallToolResult;
  readonly outcome: "client_error" | "internal_error";
} {
  if (error instanceof McpExecCommandError) {
    return {
      outcome: "client_error",
      result: {
        isError: true,
        content: [{
          type: "text",
          text: JSON.stringify({
            error: { code: error.code, message: error.publicMessage },
          }),
        }],
      },
    };
  }
  if (error instanceof McpToolTimeoutError) {
    return {
      outcome: "internal_error",
      result: {
        isError: true,
        content: [{
          type: "text",
          text: JSON.stringify({
            error: {
              code: "tool_timeout",
              message: "The tool did not complete within its execution limit.",
            },
          }),
        }],
      },
    };
  }
  if (error instanceof McpToolRequestAbortedError) {
    return {
      outcome: "client_error",
      result: {
        isError: true,
        content: [{
          type: "text",
          text: JSON.stringify({
            error: {
              code: "request_aborted",
              message: "The request was cancelled.",
            },
          }),
        }],
      },
    };
  }
  const clientCode = publicClientCode(error);
  const code = clientCode ?? "internal_error";
  const message = clientCode
    ? "The request could not be completed."
    : "The tool could not be completed.";
  return {
    outcome: clientCode ? "client_error" : "internal_error",
    result: {
      isError: true,
      content: [{ type: "text", text: JSON.stringify({ error: { code, message } }) }],
    },
  };
}
