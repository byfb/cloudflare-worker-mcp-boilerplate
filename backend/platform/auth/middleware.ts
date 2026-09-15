import { ApiError } from '../http/api-error'
import { extractCookie, SESSION_COOKIE_NAME } from './cookie'
import { methodRequiresCsrf, verifyCsrf } from './csrf'
import { Claims, decodeJwt } from './jwt'

export interface HeaderReader {
  get(name: string): string | null
}

/** Minimal structural request contract; native Request satisfies it. */
export interface RequestLike {
  headers: HeaderReader
  method?: string
}

/** Minimal environment contract; generated Wrangler Env types are compatible. */
export interface JwtEnv {
  JWT_SECRET?: unknown
  secrets?: { JWT_SECRET?: unknown }
  [key: string]: unknown
}

export function getJwtSecret(env: JwtEnv): string | undefined {
  const direct = env.JWT_SECRET
  if (typeof direct === 'string') return direct
  const nested = env.secrets?.JWT_SECRET
  if (typeof nested === 'string') return nested
  return undefined
}

export const jwtSecret = getJwtSecret

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000)
}

/** Resolve and verify the session cookie, returning the decoded JWT claims. */
export async function requireSession(
  req: RequestLike,
  env: JwtEnv,
  now = nowSeconds(),
): Promise<Claims> {
  const cookieHeader = req.headers.get('Cookie')
  if (cookieHeader == null) {
    throw ApiError.unauthorized('unauthenticated', 'no session cookie')
  }
  const token = extractCookie(cookieHeader, SESSION_COOKIE_NAME)
  if (token === undefined) {
    throw ApiError.unauthorized('unauthenticated', 'no session cookie')
  }
  const secret = getJwtSecret(env)
  if (secret === undefined) {
    throw ApiError.internal('server_misconfigured', 'JWT_SECRET missing')
  }
  return decodeJwt(secret, token, now)
}

/** Verify the double-submit token for state-changing requests. */
export function requireCsrf(req: RequestLike, claims: Claims): void {
  if (!methodRequiresCsrf(req.method ?? 'GET')) return
  verifyCsrf(req.headers.get('X-CSRF-Token'), claims.csrf)
}

export const require_session = requireSession
export const require_csrf = requireCsrf
