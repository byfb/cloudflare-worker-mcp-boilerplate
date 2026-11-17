import { ApiError, isApiError } from "./api-error";
import { fromApiError, methodNotAllowedResponse, notFoundResponse, json } from "./responses";

export type RouteParams = Record<string, string>;

export interface RouteContext<E> {
  request: Request;
  env: E;
  params: RouteParams;
}

export type RouteHandler<E> = (
  context: RouteContext<E>,
) => Response | Promise<Response>;

interface Route<E> {
  method: string;
  pattern: string;
  segments: string[];
  handler: RouteHandler<E>;
}

export interface RouteMatch<E> {
  route: {
    method: string;
    pattern: string;
    handler: RouteHandler<E>;
  };
  params: RouteParams;
}

function pathFromRequest(request: Request): string {
  try {
    return new URL(request.url).pathname;
  } catch {
    // Useful for small unit tests that use a relative URL. Workers always
    // provide an absolute request URL.
    const withoutQuery = request.url.split(/[?#]/, 1)[0];
    return withoutQuery || "/";
  }
}

function splitPath(path: string): string[] {
  return path.split("/");
}

function matchPattern(patternSegments: string[], pathSegments: string[]): RouteParams | null {
  if (patternSegments.length !== pathSegments.length) return null;

  const params: RouteParams = {};
  for (let index = 0; index < patternSegments.length; index += 1) {
    const expected = patternSegments[index];
    const actual = pathSegments[index];
    if (expected.startsWith(":")) {
      const key = expected.slice(1);
      if (key.length === 0) return null;
      // Keep URL encoding exactly as received. Decoding is a caller concern
      // and would change the raw parameter contract.
      params[key] = actual;
    } else if (expected !== actual) {
      return null;
    }
  }
  return params;
}

/** Small exact-match method/path router for the Worker boundary. */
export class Router<E = unknown> {
  private readonly routes: Array<Route<E>> = [];

  route(method: string, pattern: string, handler: RouteHandler<E>): this {
    if (!method || !pattern.startsWith("/")) {
      throw new TypeError("route method and absolute path are required");
    }
    this.routes.push({
      method: method.toUpperCase(),
      pattern,
      segments: splitPath(pattern),
      handler,
    });
    return this;
  }

  get(pattern: string, handler: RouteHandler<E>): this {
    return this.route("GET", pattern, handler);
  }

  post(pattern: string, handler: RouteHandler<E>): this {
    return this.route("POST", pattern, handler);
  }

  put(pattern: string, handler: RouteHandler<E>): this {
    return this.route("PUT", pattern, handler);
  }

  patch(pattern: string, handler: RouteHandler<E>): this {
    return this.route("PATCH", pattern, handler);
  }

  delete(pattern: string, handler: RouteHandler<E>): this {
    return this.route("DELETE", pattern, handler);
  }

  /** Find a method/path match without invoking its handler. */
  match(request: Request): RouteMatch<E> | null {
    const path = pathFromRequest(request);
    const pathSegments = splitPath(path);
    const method = request.method.toUpperCase();
    for (const route of this.routes) {
      const params = matchPattern(route.segments, pathSegments);
      if (params !== null && route.method === method) {
        return { route, params };
      }
    }
    return null;
  }

  private hasPath(path: string): boolean {
    const pathSegments = splitPath(path);
    return this.routes.some((route) => matchPattern(route.segments, pathSegments) !== null);
  }

  async handle(request: Request, env: E): Promise<Response> {
    const path = pathFromRequest(request);
    const match = this.match(request);
    if (!match) {
      return this.hasPath(path) ? methodNotAllowedResponse() : notFoundResponse();
    }

    try {
      const result = await match.route.handler({
        request,
        env,
        params: match.params,
      });
      if (!(result instanceof Response)) {
        throw new TypeError("route handler must return a Response");
      }
      return result;
    } catch (error: unknown) {
      if (isApiError(error)) {
        return fromApiError(error);
      }
      // Do not expose thrown messages, which can contain SQL, secrets, or
      // other adapter details. This envelope is intentionally stable.
      return json(new ApiError(500, "internal_error", "internal error").bodyJson(), 500);
    }
  }

  /** Alias useful for fetch-entrypoint composition. */
  run(request: Request, env: E): Promise<Response> {
    return this.handle(request, env);
  }

  fetch(request: Request, env: E): Promise<Response> {
    return this.handle(request, env);
  }
}

export function createRouter<E = unknown>(): Router<E> {
  return new Router<E>();
}
