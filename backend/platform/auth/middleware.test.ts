import { describe, expect, it } from 'vitest'

import { requireCsrf, requireSession } from './middleware'
import { encodeJwt, newClaims } from './jwt'

function request(method: string, headers: Record<string, string> = {}): Request {
  return new Request('https://example.test/api', { method, headers })
}

describe('session middleware', () => {
  it('maps missing cookie/secret to stable errors', async () => {
    await expect(requireSession(request('GET'), {})).rejects.toMatchObject({
      status: 401,
      code: 'unauthenticated',
      message: 'no session cookie',
    })
    await expect(requireSession(request('GET', { Cookie: 'session=abc' }), {})).rejects.toMatchObject({
      status: 500,
      code: 'server_misconfigured',
      message: 'JWT_SECRET missing',
    })
  })

  it('extracts cookie and enforces CSRF only for state-changing methods', async () => {
    const claims = newClaims('u', 'csrf', 1_700_000_000)
    const token = await encodeJwt('0123456789abcdef0123456789abcdef', claims)
    const req = request('POST', { Cookie: `session=${token}`, 'X-CSRF-Token': 'csrf' })
    await expect(requireSession(req, { JWT_SECRET: '0123456789abcdef0123456789abcdef' }, 1_700_000_001)).resolves.toEqual(claims)
    expect(() => requireCsrf(req, claims)).not.toThrow()
    expect(() => requireCsrf(request('GET'), claims)).not.toThrow()
    expect(() => requireCsrf(request('POST'), claims)).toThrowError(
      expect.objectContaining({ code: 'csrf_required' }),
    )
  })
})
