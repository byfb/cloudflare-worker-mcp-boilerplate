import { ApiError } from "../http/api-error";
import { D1Error, stableErrorMessage } from "./errors";
import type { D1Database } from "./types";

function looksLikeD1Database(value: unknown): value is D1Database {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { prepare?: unknown }).prepare === "function"
  );
}

/** Resolve a named Worker binding, defaulting to the canonical `DB` binding. */
export function getDb(env: unknown, binding = "DB"): D1Database {
  const value =
    typeof env === "object" && env !== null
      ? (env as Record<string, unknown>)[binding]
      : undefined;
  if (!looksLikeD1Database(value)) {
    throw new D1Error("unavailable", `D1 binding ${binding} is missing`);
  }
  return value;
}

export const requireDb = getDb;
export const db = getDb;
export const getD1 = getDb;
export const getDatabase = getDb;
export const requireD1Database = getDb;

/**
 * Resolve a Worker D1 binding at an HTTP boundary.
 *
 * `getDb` intentionally exposes the adapter-level `D1Error` for callers that
 * need to distinguish an unavailable binding from other platform failures.
 * Route composition needs the public transport shape instead, so this helper
 * translates only the binding-resolution failure into the stable compatibility
 * envelope while preserving the underlying message.
 */
export function getDbOrApiError(env: unknown, binding = "DB"): D1Database {
  try {
    return getDb(env, binding);
  } catch (error: unknown) {
    const cause = error instanceof D1Error ? error.cause : error;
    throw ApiError.internal("d1_unavailable", stableErrorMessage(cause));
  }
}

export const requireDbOrApiError = getDbOrApiError;
