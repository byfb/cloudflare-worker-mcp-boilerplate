import { describe, expect, it, vi } from 'vitest'
import type { AccessPrincipal, Claims, JwtEnv } from '../../platform/auth'
import { ApiError } from '../../platform/http/api-error'
import { createRouter } from '../../platform/http/router'
import type { AccessIdentityApplication } from './application/access-identity-service'
import {
  registerAccountAccessRoutes,
  type AccountAccessRouteDeps,
} from './access-routes'

const ORIGIN = 'https://app.example.com'
const principal: AccessPrincipal = {
  issuer: 'https://team.cloudflareaccess.com',
  subject: 'google-subject-01',
  email: 'alice@example.com',
}
const claims: Claims = {
  sub: 'user-01',
  iat: 1_700_000_000,
  exp: 1_700_604_800,
  csrf: 'csrf-01',
}

interface Env extends JwtEnv {
  JWT_SECRET?: string
}

function setup(options: { jwtSecret?: string; omitJwtSecret?: boolean } = {}) {
  const calls: string[] = []
  const application = {
    link: vi.fn(async () => {
      calls.push('application.link')
      return { linked: true as const, email: principal.email }
    }),
    listLinked: vi.fn(async () => {
      calls.push('application.listLinked')
      return [{ email: principal.email, linked_at: '2026-08-09T12:00:00.000Z' }]
    }),
    bootstrapSession: vi.fn(async () => {
      calls.push('application.bootstrapSession')
      return {
        user_id: 'user-01',
        username: 'alice',
        csrf: 'new-csrf',
        jwt: 'new-session-jwt',
      }
    }),
  }
  const access = {
    verify: vi.fn(async () => {
      calls.push('access.verify')
      return principal
    }),
  }
  const session = {
    requireSession: vi.fn(async () => {
      calls.push('session.require')
      return claims
    }),
    requireCsrf: vi.fn(() => {
      calls.push('session.csrf')
    }),
  }
  const allowedOrigin = vi.fn(() => {
    calls.push('origin')
    return ORIGIN
  })
  const deps: AccountAccessRouteDeps<Env> = {
    application: application as unknown as Pick<
      AccessIdentityApplication,
      'link' | 'listLinked' | 'bootstrapSession'
    >,
    access,
    session,
    allowedOrigin,
  }
  const router = createRouter<Env>()
  registerAccountAccessRoutes(router, deps)
  const env = options.omitJwtSecret
    ? {}
    : { JWT_SECRET: options.jwtSecret ?? 'jwt-secret' }
  return { application, access, session, allowedOrigin, calls, router, env }
}

function linkRequest(headers: HeadersInit = {}): Request {
  return new Request(`${ORIGIN}/api/auth/access-link`, {
    method: 'POST',
    headers: {
      Origin: ORIGIN,
      Cookie: 'session=current-session',
      'X-CSRF-Token': 'csrf-01',
      'Cf-Access-Jwt-Assertion': 'browser-access-jwt',
      ...headers,
    },
  })
}

function bootstrapRequest(headers: HeadersInit = {}): Request {
  return new Request(`${ORIGIN}/api/auth/access-session`, {
    method: 'POST',
    headers: {
      Origin: ORIGIN,
      'Cf-Access-Jwt-Assertion': 'browser-access-jwt',
      ...headers,
    },
  })
}

describe('Account Access routes', () => {
  it('lists only the current session user linked-identity summaries', async () => {
    const { application, access, router, env, calls } = setup()

    const response = await router.handle(
      new Request(`${ORIGIN}/api/auth/access-identities`, {
        headers: { Cookie: 'session=current-session' },
      }),
      env,
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      identities: [{
        email: 'alice@example.com',
        linked_at: '2026-08-09T12:00:00.000Z',
      }],
    })
    expect(calls).toEqual(['session.require', 'application.listLinked'])
    expect(application.listLinked).toHaveBeenCalledWith('user-01')
    expect(access.verify).not.toHaveBeenCalled()
    expect(response.headers.get('Cache-Control')).toBe('no-store, private')
  })

  it('links explicitly in origin, session, CSRF, Access, application order', async () => {
    const { application, router, env, calls } = setup()

    const response = await router.handle(linkRequest(), env)
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toEqual({ linked: true, email: 'alice@example.com' })
    expect(response.headers.get('Cache-Control')).toBe('no-store, private')
    expect(response.headers.get('Set-Cookie')).toBeNull()
    expect(calls).toEqual([
      'origin',
      'session.require',
      'session.csrf',
      'access.verify',
      'application.link',
    ])
    expect(application.link).toHaveBeenCalledWith('user-01', principal)
    expect(JSON.stringify(body)).not.toContain(principal.subject)
    expect(JSON.stringify(body)).not.toContain(principal.issuer)
  })

  it('keeps repeated same-user linking idempotent at the boundary', async () => {
    const { application, router, env } = setup()

    const first = await router.handle(linkRequest(), env)
    const second = await router.handle(linkRequest(), env)

    expect(first.status).toBe(200)
    expect(second.status).toBe(200)
    expect(await first.json()).toEqual(await second.json())
    expect(application.link).toHaveBeenCalledTimes(2)
  })

  it('returns a sanitized collision without revealing identity ownership', async () => {
    const { application, router, env } = setup()
    application.link.mockRejectedValueOnce(
      ApiError.conflict(
        'access_identity_conflict',
        'Access identity is already linked to another account',
      ),
    )

    const response = await router.handle(linkRequest(), env)
    const body = await response.text()

    expect(response.status).toBe(409)
    expect(JSON.parse(body)).toEqual({
      code: 'access_identity_conflict',
      message: 'Access identity is already linked to another account',
    })
    expect(body).not.toContain(principal.issuer)
    expect(body).not.toContain(principal.subject)
    expect(response.headers.get('Cache-Control')).toBe('no-store, private')
  })

  it.each([
    ['missing', {}],
    ['wrong', { Origin: 'https://evil.example' }],
  ])('rejects %s Origin before session, Access, or application work', async (_name, headers) => {
    const { application, access, session, router, env } = setup()
    const request = new Request(`${ORIGIN}/api/auth/access-link`, {
      method: 'POST',
      headers,
    })

    const response = await router.handle(request, env)

    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({
      code: 'origin_forbidden',
      message: 'same-origin request required',
    })
    expect(session.requireSession).not.toHaveBeenCalled()
    expect(access.verify).not.toHaveBeenCalled()
    expect(application.link).not.toHaveBeenCalled()
  })

  it('requires an existing application session before Access verification', async () => {
    const { application, access, session, router, env } = setup()
    session.requireSession.mockRejectedValueOnce(
      ApiError.unauthorized('unauthenticated', 'no session cookie'),
    )

    const response = await router.handle(linkRequest({ Cookie: '' }), env)

    expect(response.status).toBe(401)
    expect(access.verify).not.toHaveBeenCalled()
    expect(application.link).not.toHaveBeenCalled()
  })

  it.each([
    ['missing', ApiError.forbidden('csrf_required', 'missing X-CSRF-Token header')],
    ['wrong', ApiError.forbidden('csrf_invalid', 'invalid CSRF token')],
  ])('rejects %s CSRF before Access verification', async (_name, csrfError) => {
    const { application, access, session, router, env } = setup()
    session.requireCsrf.mockImplementationOnce(() => {
      throw csrfError
    })

    const response = await router.handle(linkRequest(), env)

    expect(response.status).toBe(403)
    expect(access.verify).not.toHaveBeenCalled()
    expect(application.link).not.toHaveBeenCalled()
  })

  it('rejects an invalid browser Access assertion before linking', async () => {
    const { application, access, router, env } = setup()
    access.verify.mockRejectedValueOnce(
      ApiError.unauthorized('access_unauthenticated', 'invalid Access assertion'),
    )

    const response = await router.handle(linkRequest(), env)

    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({
      code: 'access_unauthenticated',
      message: 'invalid Access assertion',
    })
    expect(application.link).not.toHaveBeenCalled()
  })

  it('bootstraps a linked identity with the existing response and cookie contract', async () => {
    const { application, session, router, env, calls } = setup()

    const response = await router.handle(bootstrapRequest(), env)

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      user_id: 'user-01',
      username: 'alice',
      csrf: 'new-csrf',
    })
    expect(response.headers.get('Set-Cookie')).toBe(
      'session=new-session-jwt; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=604800',
    )
    expect(response.headers.get('Cache-Control')).toBe('no-store, private')
    expect(session.requireSession).not.toHaveBeenCalled()
    expect(calls).toEqual(['origin', 'access.verify', 'application.bootstrapSession'])
    expect(application.bootstrapSession).toHaveBeenCalledWith(principal, 'jwt-secret', null)
  })

  it('returns unlinked without issuing a session cookie', async () => {
    const { application, router, env } = setup()
    application.bootstrapSession.mockRejectedValueOnce(
      ApiError.forbidden(
        'access_identity_unlinked',
        'Access identity is not linked to an account',
      ),
    )

    const response = await router.handle(bootstrapRequest(), env)

    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({
      code: 'access_identity_unlinked',
      message: 'Access identity is not linked to an account',
    })
    expect(response.headers.get('Set-Cookie')).toBeNull()
    expect(response.headers.get('Cache-Control')).toBe('no-store, private')
  })

  it('rejects cross-origin bootstrap before Access or application work', async () => {
    const { application, access, session, router, env } = setup()

    const response = await router.handle(
      bootstrapRequest({ Origin: 'https://evil.example' }),
      env,
    )

    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({
      code: 'origin_forbidden',
      message: 'same-origin request required',
    })
    expect(response.headers.get('Set-Cookie')).toBeNull()
    expect(response.headers.get('Cache-Control')).toBe('no-store, private')
    expect(access.verify).not.toHaveBeenCalled()
    expect(session.requireSession).not.toHaveBeenCalled()
    expect(application.bootstrapSession).not.toHaveBeenCalled()
  })

  it('rejects an alternate request host even when the Origin header is forged', async () => {
    const { application, access, session, router, env } = setup()
    const response = await router.handle(
      new Request('https://preview-worker.example/api/auth/access-session', {
        method: 'POST',
        headers: {
          Origin: ORIGIN,
          'Cf-Access-Jwt-Assertion': 'browser-access-jwt',
        },
      }),
      env,
    )

    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({
      code: 'origin_forbidden',
      message: 'same-origin request required',
    })
    expect(access.verify).not.toHaveBeenCalled()
    expect(session.requireSession).not.toHaveBeenCalled()
    expect(application.bootstrapSession).not.toHaveBeenCalled()
  })

  it('passes a valid existing session to mixed-identity protection', async () => {
    const { application, access, session, router, env, calls } = setup()
    session.requireSession.mockResolvedValueOnce({ ...claims, sub: 'user-02' })
    application.bootstrapSession.mockRejectedValueOnce(
      ApiError.conflict(
        'access_identity_mismatch',
        'Access identity does not match the current session',
      ),
    )

    const response = await router.handle(
      bootstrapRequest({ Cookie: 'session=valid-other-session' }),
      env,
    )

    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({
      code: 'access_identity_mismatch',
      message: 'Access identity does not match the current session',
    })
    expect(calls).toEqual(['origin', 'access.verify'])
    expect(access.verify.mock.invocationCallOrder[0])
      .toBeLessThan(session.requireSession.mock.invocationCallOrder[0])
    expect(session.requireSession.mock.invocationCallOrder[0])
      .toBeLessThan(application.bootstrapSession.mock.invocationCallOrder[0])
    expect(application.bootstrapSession).toHaveBeenCalledWith(
      principal,
      'jwt-secret',
      'user-02',
    )
  })

  it('treats a stale application cookie as absent after Access succeeds', async () => {
    const { application, session, router, env } = setup()
    session.requireSession.mockRejectedValueOnce(
      ApiError.unauthorized('session_expired', 'session expired'),
    )

    const response = await router.handle(
      bootstrapRequest({ Cookie: 'session=stale-session' }),
      env,
    )

    expect(response.status).toBe(200)
    expect(application.bootstrapSession).toHaveBeenCalledWith(principal, 'jwt-secret', null)
  })

  it('does not hide session configuration failures as an absent cookie', async () => {
    const { application, session, router, env } = setup()
    session.requireSession.mockRejectedValueOnce(
      ApiError.internal('server_misconfigured', 'JWT_SECRET missing'),
    )

    const response = await router.handle(
      bootstrapRequest({ Cookie: 'session=present' }),
      env,
    )

    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({
      code: 'server_misconfigured',
      message: 'JWT_SECRET missing',
    })
    expect(application.bootstrapSession).not.toHaveBeenCalled()
  })

  it('verifies Access before optional session inspection and stops on Access failure', async () => {
    const { application, access, session, router, env } = setup()
    access.verify.mockRejectedValueOnce(
      ApiError.unauthorized('access_unauthenticated', 'invalid Access assertion'),
    )

    const response = await router.handle(
      bootstrapRequest({ Cookie: 'session=valid-session' }),
      env,
    )

    expect(response.status).toBe(401)
    expect(session.requireSession).not.toHaveBeenCalled()
    expect(application.bootstrapSession).not.toHaveBeenCalled()
  })

  it('checks JWT configuration before bootstrap application work', async () => {
    const { application, router, env } = setup({ omitJwtSecret: true })

    const response = await router.handle(bootstrapRequest(), env)

    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({
      code: 'server_misconfigured',
      message: 'JWT_SECRET missing',
    })
    expect(application.bootstrapSession).not.toHaveBeenCalled()
  })

  it('fails closed on invalid origin configuration before auth or application work', async () => {
    const { application, access, session, allowedOrigin, router, env } = setup()
    allowedOrigin.mockReturnValueOnce('https://app.example.com/path')

    const response = await router.handle(linkRequest(), env)

    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({
      code: 'server_misconfigured',
      message: 'browser origin is not configured',
    })
    expect(session.requireSession).not.toHaveBeenCalled()
    expect(access.verify).not.toHaveBeenCalled()
    expect(application.link).not.toHaveBeenCalled()
  })

  it('rejects non-loopback HTTP origin configuration before auth or application work', async () => {
    const { application, access, session, allowedOrigin, router, env } = setup()
    allowedOrigin.mockReturnValueOnce('http://app.example.com')

    const response = await router.handle(
      linkRequest({ Origin: 'http://app.example.com' }),
      env,
    )

    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({
      code: 'server_misconfigured',
      message: 'browser origin is not configured',
    })
    expect(session.requireSession).not.toHaveBeenCalled()
    expect(access.verify).not.toHaveBeenCalled()
    expect(application.link).not.toHaveBeenCalled()
  })

  it('sanitizes unexpected application errors and keeps them non-cacheable', async () => {
    const { application, router, env } = setup()
    application.bootstrapSession.mockRejectedValueOnce(
      new Error(`D1 failed for ${principal.subject}`),
    )

    const response = await router.handle(bootstrapRequest(), env)

    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({ code: 'internal_error', message: 'internal error' })
    expect(response.headers.get('Cache-Control')).toBe('no-store, private')
  })

  it('sanitizes typed adapter failures that contain internal details', async () => {
    const { application, router, env } = setup()
    application.bootstrapSession.mockRejectedValueOnce(
      ApiError.internal(
        'd1_query_failed',
        `SELECT auth_identities WHERE subject = ${principal.subject}`,
      ),
    )

    const response = await router.handle(bootstrapRequest(), env)

    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({ code: 'internal_error', message: 'internal error' })
    expect(response.headers.get('Cache-Control')).toBe('no-store, private')
  })
})
