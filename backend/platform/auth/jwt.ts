import { SignJWT, jwtVerify, errors } from 'jose'
import { ApiError } from '../http/api-error'
import { JWT_TTL_SECONDS } from './cookie'

export interface Claims { sub: string; iat: number; exp: number; csrf: string }
export type JwtClaims = Claims
export const JWT_TTL = JWT_TTL_SECONDS

function key(secret: string | Uint8Array): Uint8Array {
  const bytes = typeof secret === 'string' ? new TextEncoder().encode(secret) : secret
  if (bytes.byteLength < 32) {
    throw ApiError.internal('server_misconfigured', 'JWT_SECRET must contain at least 32 bytes')
  }
  return bytes
}

export function newClaims(userId: string, csrf: string, now: number): Claims {
  return { sub: userId, csrf, iat: now, exp: now + JWT_TTL_SECONDS }
}

export async function encodeJwt(secret: string | Uint8Array, claims: Claims): Promise<string> {
  return new SignJWT({ ...claims }).setProtectedHeader({ alg: 'HS256', typ: 'JWT' }).sign(key(secret))
}

export async function decodeJwt(secret: string | Uint8Array, token: string, now = Math.floor(Date.now() / 1000)): Promise<Claims> {
  const signingKey = key(secret)
  try {
    const { payload } = await jwtVerify(token, signingKey, {
      algorithms: ['HS256'], typ: 'JWT', currentDate: new Date(now * 1000),
      requiredClaims: ['sub', 'iat', 'exp', 'csrf'],
    })
    const { sub, iat, exp, csrf } = payload
    if (typeof sub !== 'string' || !sub || typeof csrf !== 'string' || !csrf ||
        typeof iat !== 'number' || !Number.isSafeInteger(iat) || iat < 0 || iat > now ||
        typeof exp !== 'number' || !Number.isSafeInteger(exp) || exp <= iat || exp - iat > JWT_TTL_SECONDS) {
      throw new Error('invalid session claims')
    }
    return { sub, iat, exp, csrf }
  } catch (error) {
    if (error instanceof errors.JWTExpired) throw ApiError.unauthorized('session_expired', 'session expired')
    throw ApiError.unauthorized('unauthenticated', 'invalid session')
  }
}
