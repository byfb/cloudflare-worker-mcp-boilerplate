import { ApiError } from "../http/api-error";

export function stableErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (typeof error === "number" || typeof error === "boolean" || typeof error === "bigint") {
    return String(error);
  }
  if (error === null) return "null";
  if (error === undefined) return "undefined";

  if (typeof error === "object") {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string") return message;
    try {
      return JSON.stringify(error) ?? "[object Object]";
    } catch {
      return "[object Object]";
    }
  }
  return String(error);
}

/** Stable adapter error that retains the original primitive as `cause`. */
export class D1Error extends Error {
  readonly operation: string;
  readonly cause: unknown;
  readonly code: string;

  constructor(operation: string, cause: unknown) {
    super(`D1 ${operation} failed: ${stableErrorMessage(cause)}`);
    this.name = "D1Error";
    this.operation = operation;
    this.cause = cause;
    this.code =
      operation === "unavailable"
        ? "d1_unavailable"
        : operation.startsWith("d1_")
          ? operation
          : `d1_${operation}_failed`;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export function wrapD1Error(operation: string, cause: unknown): D1Error {
  return cause instanceof D1Error ? cause : new D1Error(operation, cause);
}

export const toD1Error = wrapD1Error;
export const d1Error = wrapD1Error;

/** Convert an adapter failure into the public typed internal error. */
export function d1ApiError(code: string, error: unknown): ApiError {
  return ApiError.internal(code, stableErrorMessage(error));
}

export const wrapD1ApiError = d1ApiError;

export const d1BindError = (error: unknown): ApiError =>
  d1ApiError("d1_bind_failed", error);
export const d1QueryError = (error: unknown): ApiError =>
  d1ApiError("d1_query_failed", error);
export const d1RunError = (error: unknown): ApiError =>
  d1ApiError("d1_run_failed", error);
