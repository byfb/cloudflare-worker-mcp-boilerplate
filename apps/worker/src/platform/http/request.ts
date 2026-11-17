import { ApiError } from "./api-error";

/**
 * Parse any JSON value without requiring a Content-Type header.
 *
 * Empty and malformed bodies use the same public parse error.
 * Valid JSON values remain permissive; context adapters validate their shape.
 */
export async function parseJson<T = unknown>(request: Request): Promise<T> {
  const raw = await request.text();
  try {
    return JSON.parse(raw) as T;
  } catch {
    // Cloudflare Request.json() collapses both an
    // empty body and malformed JSON to this exact public message.
    throw ApiError.badRequest(
      "invalid_payload",
      "failed to get JSON for body value",
    );
  }
}

export function queryParams(requestOrUrl: Request | URL | string): URLSearchParams {
  const url =
    typeof requestOrUrl === "string"
      ? new URL(requestOrUrl, "https://worker.invalid")
      : requestOrUrl instanceof URL
        ? requestOrUrl
        : new URL(requestOrUrl.url);
  return url.searchParams;
}

export function queryParam(
  requestOrUrl: Request | URL | string,
  name: string,
): string | null {
  return queryParams(requestOrUrl).get(name);
}
