import {
  buildSetCookie,
  extractCookie,
  getJwtSecret,
  SESSION_COOKIE_NAME,
  type AccessAssertionVerifier,
  type JwtEnv,
} from '../../platform/auth'
import {
  ApiError,
  apiErrorStatus,
  isApiError,
} from '../../platform/http/api-error'
import { fromApiError, json, withSetCookie } from '../../platform/http/responses'
import type { Router, RouteContext } from '../../platform/http/router'
import type { AccessIdentityApplication } from './application/access-identity-service'
import type { SessionReader } from './application/ports'

const PRIVATE_NO_STORE = 'no-store, private'

/** Resolve the one canonical browser origin configured for this deployment. */
export type AllowedOriginResolver<E> = (env: E) => string

export interface AccountAccessRouteDeps<E extends JwtEnv = JwtEnv> {
  readonly application: Pick<AccessIdentityApplication, 'link' | 'listLinked' | 'bootstrapSession'>
  /** This verifier must be pinned to the browser Access application audience. */
  readonly access: AccessAssertionVerifier
  readonly session: SessionReader<E>
  /** Must return a canonical origin such as `https://app.example.com`. */
  readonly allowedOrigin: AllowedOriginResolver<E>
}

function privateNoStore(response: Response): Response {
  try {
    response.headers.set('Cache-Control', PRIVATE_NO_STORE)
    return response
  } catch {
    const headers = new Headers(response.headers)
    headers.set('Cache-Control', PRIVATE_NO_STORE)
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    })
  }
}

function errorResponse(error: unknown): Response {
  const safeKnownFailure =
    error instanceof ApiError &&
    (error.code === 'server_misconfigured' || error.code === 'access_auth_unavailable')
  const response =
    isApiError(error) && (apiErrorStatus(error) < 500 || safeKnownFailure)
      ? fromApiError(error)
      : fromApiError(ApiError.internal('internal_error', 'internal error'))
  return privateNoStore(response)
}

async function routeResult<T>(
  work: () => Promise<T>,
  success: (value: T) => Response,
): Promise<Response> {
  try {
    return privateNoStore(success(await work()))
  } catch (error) {
    return errorResponse(error)
  }
}

function canonicalAllowedOrigin<E extends JwtEnv>(
  deps: AccountAccessRouteDeps<E>,
  env: E,
): string {
  let configured: unknown
  try {
    configured = deps.allowedOrigin(env)
  } catch {
    throw ApiError.internal('server_misconfigured', 'browser origin is not configured')
  }
  if (typeof configured !== 'string' || configured.length === 0) {
    throw ApiError.internal('server_misconfigured', 'browser origin is not configured')
  }

  let url: URL
  try {
    url = new URL(configured)
  } catch {
    throw ApiError.internal('server_misconfigured', 'browser origin is not configured')
  }
  const loopbackHttp =
    url.protocol === 'http:' &&
    (url.hostname === 'localhost' ||
      url.hostname === '127.0.0.1' ||
      url.hostname === '[::1]')
  if (
    (url.protocol !== 'https:' && !loopbackHttp) ||
    url.username !== '' ||
    url.password !== '' ||
    url.pathname !== '/' ||
    url.search !== '' ||
    url.hash !== '' ||
    configured !== url.origin
  ) {
    throw ApiError.internal('server_misconfigured', 'browser origin is not configured')
  }
  return configured
}

function requireSameOrigin<E extends JwtEnv>(
  request: Request,
  env: E,
  deps: AccountAccessRouteDeps<E>,
): void {
  const allowed = canonicalAllowedOrigin(deps, env)
  let requestOrigin: string
  try {
    requestOrigin = new URL(request.url).origin
  } catch {
    throw ApiError.forbidden('origin_forbidden', 'same-origin request required')
  }
  if (
    requestOrigin !== allowed ||
    request.headers.get('Origin') !== allowed
  ) {
    throw ApiError.forbidden('origin_forbidden', 'same-origin request required')
  }
}

function secretFor(env: JwtEnv): string {
  const secret = getJwtSecret(env)
  if (secret === undefined) {
    throw ApiError.internal('server_misconfigured', 'JWT_SECRET missing')
  }
  return secret
}

function hasSessionCookie(request: Request): boolean {
  const cookie = request.headers.get('Cookie')
  return cookie !== null && extractCookie(cookie, SESSION_COOKIE_NAME) !== undefined
}

async function optionalSessionUserId<E extends JwtEnv>(
  request: Request,
  env: E,
  session: SessionReader<E>,
): Promise<string | null> {
  if (!hasSessionCookie(request)) return null
  try {
    return (await session.requireSession(request, env)).sub
  } catch (error) {
    // Bootstrap is allowed to replace only a stale or otherwise invalid
    // application cookie. Configuration and unexpected failures still fail
    // closed and are never reclassified as an anonymous request.
    if (isApiError(error) && apiErrorStatus(error) === 401) return null
    throw error
  }
}

/** Register the browser-facing Access link and session-bootstrap routes. */
export function registerAccountAccessRoutes<E extends JwtEnv>(
  router: Router<E>,
  deps: AccountAccessRouteDeps<E>,
): Router<E> {
  router.get('/api/auth/access-identities', ({ request, env }: RouteContext<E>) =>
    routeResult(
      async () => {
        const claims = await deps.session.requireSession(request, env)
        return deps.application.listLinked(claims.sub)
      },
      (identities) => json({ identities }, 200),
    ),
  )

  router.post('/api/auth/access-link', ({ request, env }: RouteContext<E>) =>
    routeResult(
      async () => {
        requireSameOrigin(request, env, deps)
        const claims = await deps.session.requireSession(request, env)
        deps.session.requireCsrf(request, claims)
        const principal = await deps.access.verify(request)
        return deps.application.link(claims.sub, principal)
      },
      (result) => json({ linked: result.linked, email: result.email }, 200),
    ),
  )

  router.post('/api/auth/access-session', ({ request, env }: RouteContext<E>) =>
    routeResult(
      async () => {
        requireSameOrigin(request, env, deps)
        const principal = await deps.access.verify(request)
        const existingSessionUserId = await optionalSessionUserId(request, env, deps.session)
        const secret = secretFor(env)
        return deps.application.bootstrapSession(principal, secret, existingSessionUserId)
      },
      (result) =>
        withSetCookie(
          json(
            {
              user_id: result.user_id,
              username: result.username,
              csrf: result.csrf,
            },
            200,
          ),
          buildSetCookie(result.jwt),
        ),
    ),
  )

  return router
}
