import { describe, expect, it } from 'vitest'
import { SignJWT } from 'jose'
import { decodeJwt, encodeJwt, newClaims } from './jwt'

const secret = 'test-secret-0123456789abcdef0123456789abcdef'
describe('session tokens', () => {
  it('verifies a session and rejects expiry, wrong signatures, and short secrets', async () => {
    const claims = newClaims('member', 'csrf-value', 1000)
    const token = await encodeJwt(secret, claims)
    expect(await decodeJwt(secret, token, 1001)).toEqual(claims)
    await expect(decodeJwt(secret, token, claims.exp)).rejects.toMatchObject({ code: 'session_expired' })
    await expect(decodeJwt(secret + 'wrong', token, 1001)).rejects.toMatchObject({ status: 401 })
    await expect(encodeJwt('short', claims)).rejects.toMatchObject({ code: 'server_misconfigured' })
  })
  it('rejects unexpected algorithms and invalid claim values', async () => {
    for (const [claims, alg] of [[newClaims('member', 'csrf', 1000), 'HS384'], [{ sub: 'member', csrf: '', iat: 1000, exp: 2000 }, 'HS256']] as const) {
      const token = await new SignJWT({ ...claims }).setProtectedHeader({ alg, typ: 'JWT' }).sign(new TextEncoder().encode(secret))
      await expect(decodeJwt(secret, token, 1001)).rejects.toMatchObject({ status: 401 })
    }
  })
})
