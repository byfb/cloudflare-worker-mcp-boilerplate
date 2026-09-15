import { ApiError } from '../http/api-error'

/** Methods exempt from the double-submit CSRF check. */
export function methodRequiresCsrf(method: string): boolean {
  const upper = method.toUpperCase()
  return upper !== 'GET' && upper !== 'HEAD' && upper !== 'OPTIONS'
}

/**
 * Constant-time comparison for byte strings.
 *
 * The loop intentionally visits the length of the longer operand even when
 * lengths differ. UTF-8 encoding keeps byte-level comparison deterministic.
 */
export function timingSafeEqual(left: Uint8Array, right: Uint8Array): boolean {
  const length = Math.max(left.length, right.length)
  let difference = left.length ^ right.length
  for (let i = 0; i < length; i += 1) {
    difference |= (left[i] ?? 0) ^ (right[i] ?? 0)
  }
  return difference === 0
}

export function verifyCsrf(headerValue: string | null | undefined, claimValue: string): void {
  if (headerValue == null) {
    throw ApiError.forbidden('csrf_required', 'missing X-CSRF-Token header')
  }

  const encoder = new TextEncoder()
  if (timingSafeEqual(encoder.encode(headerValue), encoder.encode(claimValue))) return
  throw ApiError.forbidden('csrf_invalid', 'invalid CSRF token')
}

// Compatibility aliases retained for existing handler imports.
export const method_requires_csrf = methodRequiresCsrf
export const verify = verifyCsrf
