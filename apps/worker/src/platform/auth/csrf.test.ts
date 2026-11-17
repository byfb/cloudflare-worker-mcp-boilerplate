import { describe, expect, it } from 'vitest'

import { methodRequiresCsrf, verifyCsrf } from './csrf'

describe('CSRF parity', () => {
  it('exempts GET, HEAD, and OPTIONS case-insensitively', () => {
    expect(methodRequiresCsrf('GET')).toBe(false)
    expect(methodRequiresCsrf('get')).toBe(false)
    expect(methodRequiresCsrf('HEAD')).toBe(false)
    expect(methodRequiresCsrf('OPTIONS')).toBe(false)
    expect(methodRequiresCsrf('POST')).toBe(true)
    expect(methodRequiresCsrf('PATCH')).toBe(true)
    expect(methodRequiresCsrf('DELETE')).toBe(true)
  })

  it('uses stable missing and mismatch errors', () => {
    expect(() => verifyCsrf(undefined, 'token')).toThrowError(
      expect.objectContaining({ status: 403, code: 'csrf_required', message: 'missing X-CSRF-Token header' }),
    )
    expect(() => verifyCsrf('nope', 'token')).toThrowError(
      expect.objectContaining({ status: 403, code: 'csrf_invalid', message: 'invalid CSRF token' }),
    )
    expect(() => verifyCsrf('token', 'token')).not.toThrow()
  })
})
