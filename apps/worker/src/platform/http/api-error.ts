import { isRuleViolation, type RuleViolation } from "../../shared-kernel/rule-violation";

/**
 * Typed error used at the HTTP boundary.
 *
 * Application and adapter code can throw an ApiError and the router will
 * preserve its status and public `{ code, message }` envelope. Domain rule
 * violations are translated separately without carrying transport status.
 */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    // Required when transpiling to older targets and harmless on Workers.
    Object.setPrototypeOf(this, new.target.prototype);
  }

  static badRequest(code: string, message: string): ApiError {
    return new ApiError(400, code, message);
  }

  static unauthorized(code: string, message: string): ApiError {
    return new ApiError(401, code, message);
  }

  static forbidden(code: string, message: string): ApiError {
    return new ApiError(403, code, message);
  }

  static notFound(code: string, message: string): ApiError {
    return new ApiError(404, code, message);
  }

  static conflict(code: string, message: string): ApiError {
    return new ApiError(409, code, message);
  }

  static internal(code: string, message: string): ApiError {
    return new ApiError(500, code, message);
  }

  static bad_request(code: string, message: string): ApiError {
    return ApiError.badRequest(code, message);
  }

  static not_found(code: string, message: string): ApiError {
    return ApiError.notFound(code, message);
  }

  /** Public JSON representation; never includes status or stack details. */
  bodyJson(): { code: string; message: string } {
    return { code: this.code, message: this.message };
  }

  /** Compatibility alias retained for existing callers. */
  body_json(): { code: string; message: string } {
    return this.bodyJson();
  }
}

/**
 * Compatibility guard for errors the HTTP boundary can serialize.
 *
 * It retains the established name for callers while also recognizing
 * platform-neutral domain rule violations as HTTP-400 errors.
 */
export type HttpMappableError = ApiError | RuleViolation;

export function isApiError(value: unknown): value is HttpMappableError {
  if (value instanceof ApiError) return true;
  if (isRuleViolation(value)) return true;
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as { status?: unknown; code?: unknown; message?: unknown };
  return (
    typeof candidate.status === "number" &&
    typeof candidate.code === "string" &&
    typeof candidate.message === "string"
  );
}

/** Resolve transport status without adding transport state to domain errors. */
export function apiErrorStatus(error: HttpMappableError): number {
  return error instanceof ApiError ? error.status : 400;
}

export function apiErrorBody(error: HttpMappableError): { code: string; message: string } {
  return error instanceof ApiError
    ? error.bodyJson()
    : { code: error.code, message: error.message };
}
