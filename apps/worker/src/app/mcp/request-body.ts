import { isJsonContentType } from "@modelcontextprotocol/server";
import { MCP_MAX_REQUEST_BYTES } from "./contracts";

export class McpRequestBodyError extends Error {
  constructor(
    readonly status: 400 | 413 | 415,
    readonly code: "invalid_request" | "request_too_large" | "unsupported_media_type",
  ) {
    super(code);
    this.name = "McpRequestBodyError";
  }
}

export interface BoundedMcpRequest {
  readonly request: Request;
  readonly parsedBody?: unknown;
}

function declaredBodyLength(request: Request): number | undefined {
  const value = request.headers.get("content-length");
  if (value === null) return undefined;
  if (!/^(0|[1-9]\d*)$/.test(value)) {
    throw new McpRequestBodyError(400, "invalid_request");
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new McpRequestBodyError(413, "request_too_large");
  }
  return parsed;
}

async function readBoundedBytes(request: Request): Promise<Uint8Array> {
  const declared = declaredBodyLength(request);
  if (declared !== undefined && declared > MCP_MAX_REQUEST_BYTES) {
    throw new McpRequestBodyError(413, "request_too_large");
  }
  if (request.body === null) return new Uint8Array();

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MCP_MAX_REQUEST_BYTES) {
        await reader.cancel().catch(() => undefined);
        throw new McpRequestBodyError(413, "request_too_large");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function copyRequestWithBody(request: Request, body: string): Request {
  return new Request(request.url, {
    method: request.method,
    headers: request.headers,
    body,
    redirect: request.redirect,
    signal: request.signal,
  });
}

/** Read and cap the complete POST body before the first JSON parse. */
export async function prepareBoundedMcpRequest(request: Request): Promise<BoundedMcpRequest> {
  if (request.method !== "POST") return { request };
  if (!isJsonContentType(request.headers.get("content-type"))) {
    throw new McpRequestBodyError(415, "unsupported_media_type");
  }

  const bytes = await readBoundedBytes(request);
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new McpRequestBodyError(400, "invalid_request");
  }

  let parsedBody: unknown;
  try {
    parsedBody = JSON.parse(text) as unknown;
  } catch {
    throw new McpRequestBodyError(400, "invalid_request");
  }

  return {
    request: copyRequestWithBody(request, text),
    parsedBody,
  };
}
