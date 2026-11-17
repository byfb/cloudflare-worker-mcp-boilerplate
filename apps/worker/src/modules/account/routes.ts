import { z } from 'zod'
import { buildClearCookie, buildSetCookie, getJwtSecret, requireCsrf, requireSession,
  type Claims, type JwtEnv } from '../../platform/auth'
import { ApiError } from '../../platform/http/api-error'
import { parseJson } from '../../platform/http/request'
import { empty, json, withSetCookie } from '../../platform/http/responses'
import type { Router } from '../../platform/http/router'
import type { AccountApplication } from './application/service'

export interface AccountRouteDeps<E extends JwtEnv = JwtEnv> {
  application: AccountApplication
  session?: {
    requireSession(request: Request, env: E): Promise<Claims>
    requireCsrf(request: Request, claims: Claims): void
  }
}
const credentials = z.strictObject({ username: z.string(), password: z.string() })

async function credentialsBody(request: Request) {
  const parsed = credentials.safeParse(await parseJson(request))
  if (!parsed.success) throw ApiError.badRequest('invalid_payload', 'expected username and password')
  return parsed.data
}

function secretFor(env: JwtEnv) {
  const secret = getJwtSecret(env)
  if (secret === undefined) throw ApiError.internal('server_misconfigured', 'JWT_SECRET missing')
  return secret
}

export function registerAccountRoutes<E extends JwtEnv>(router: Router<E>, deps: AccountRouteDeps<E>): Router<E> {
  const session = deps.session ?? { requireSession, requireCsrf }
  for (const action of ['register', 'login'] as const) {
    router.post(`/api/auth/${action}`, async ({ request, env }) => {
      // JSON-only credentials prevent cross-origin HTML form login/registration.
      if (request.headers.get('Content-Type')?.split(';')[0]?.trim().toLowerCase() !== 'application/json') {
        throw ApiError.badRequest('invalid_payload', 'application/json required')
      }
      const { jwt, ...user } = await deps.application[action](await credentialsBody(request), secretFor(env))
      return withSetCookie(json(user, action === 'register' ? 201 : 200), buildSetCookie(jwt))
    })
  }
  router.get('/api/auth/me', async ({ request, env }) =>
    json(await deps.application.me(await session.requireSession(request, env))))
  router.get('/api/profile', async ({ request, env }) => {
    const claims = await session.requireSession(request, env)
    return json(await deps.application.getBasicProfile(claims.sub))
  })
  router.post('/api/auth/logout', async ({ request, env }) => {
    const claims = await session.requireSession(request, env)
    session.requireCsrf(request, claims)
    return withSetCookie(empty(), buildClearCookie())
  })
  return router
}
