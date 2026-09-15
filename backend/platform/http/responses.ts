import {
  apiErrorBody,
  apiErrorStatus,
  type HttpMappableError,
} from "./api-error";

const JSON_CONTENT_TYPE = "application/json";

/** Serialize a value using the API's exact JSON media type. */
export function json<T>(value: T, status = 200, init?: ResponseInit): Response {
  const headers = new Headers(init?.headers);
  headers.set("Content-Type", JSON_CONTENT_TYPE);
  const body = JSON.stringify(value) ?? "null";
  return new Response(body, {
    ...init,
    status,
    headers,
  });
}

/** Alias that reads naturally at call sites that distinguish responses. */
export const jsonResponse = json;

/** Return a response with no body and no implicit content type. */
export function empty(status = 204, init?: ResponseInit): Response {
  const headers = new Headers(init?.headers);
  headers.delete("Content-Type");
  return new Response(null, {
    ...init,
    status,
    headers,
  });
}

export const emptyResponse = empty;

/** Translate a typed error into its public JSON envelope. */
export function fromApiError(error: HttpMappableError): Response {
  const status = apiErrorStatus(error);
  const body = apiErrorBody(error);
  if (status >= 500 && body.code !== "server_misconfigured" && body.code !== "access_auth_unavailable") {
    return json({ code: "internal_error", message: "internal error" }, status);
  }
  return json(body, status);
}

/**
 * Construct an intentionally untyped text response.
 *
 * Fetch implementations often infer `text/plain;charset=UTF-8` for a string
 * body.  404/405 responses use an untyped body, so
 * explicitly remove that inferred header.
 */
export function text(value: string, status = 200, init?: ResponseInit): Response {
  const headers = new Headers(init?.headers);
  const response = new Response(value, {
    ...init,
    status,
    headers,
  });
  // Response(string) implementations may infer a text media type after the
  // init headers are applied, so delete it on the constructed response.
  response.headers.delete("Content-Type");
  return response;
}

export const textResponse = text;

/** Append, never replace, a Set-Cookie header. */
export function withSetCookie(response: Response, cookie: string): Response {
  try {
    response.headers.append("Set-Cookie", cookie);
    return response;
  } catch {
    // Some Fetch implementations expose immutable response headers.  Rebuild
    // the response while retaining status, status text, body, and headers.
    const headers = new Headers(response.headers);
    headers.append("Set-Cookie", cookie);
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  }
}

export const appendSetCookie = withSetCookie;

export function notFoundResponse(): Response {
  return text("Not Found", 404);
}

export function methodNotAllowedResponse(): Response {
  return text("Method Not Allowed", 405);
}
