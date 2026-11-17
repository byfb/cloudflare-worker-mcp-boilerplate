import { describe, expect, it, vi } from 'vitest'
import type { Claims, JwtEnv } from '../../platform/auth'
import { ApiError } from '../../platform/http/api-error'
import { createRouter } from '../../platform/http/router'
import type { McpConnectionCapability } from './public/mcp-connections'
import {
  registerMcpConnectionRoutes,
  type McpConnectionRouteDeps,
} from './mcp-connection-routes'

interface Env extends JwtEnv {}

const claims: Claims = {
  sub: 'user-a',
  csrf: 'csrf-a',
  iat: 1,
  exp: 2,
}

const connection = {
  client_key: 'chatgpt',
  display_name: 'ChatGPT',
  client_version: '1.0.0',
  first_seen_at: 1_000,
  last_seen_at: 2_000,
  tool_call_count: 4,
  enabled: true,
} as const

function setup() {
  const calls: string[] = []
  const application = {
    list: vi.fn(async () => {
      calls.push('application.list')
      return { connections: [connection] }
    }),
    setEnabled: vi.fn(async (_userId, input) => {
      calls.push('application.setEnabled')
      return { ...connection, enabled: input.enabled }
    }),
    remove: vi.fn(async () => {
      calls.push('application.remove')
    }),
  } satisfies Pick<McpConnectionCapability, 'list' | 'setEnabled' | 'remove'>
  const session = {
    requireSession: vi.fn(async () => {
      calls.push('session.require')
      return claims
    }),
    requireCsrf: vi.fn(() => {
      calls.push('session.csrf')
    }),
  }
  const deps: McpConnectionRouteDeps<Env> = { application, session }
  const router = createRouter<Env>()
  registerMcpConnectionRoutes(router, deps)
  return { application, calls, router, session }
}

function updateRequest(body = JSON.stringify({
  client_key: 'chatgpt',
  enabled: false,
})): Request {
  return new Request('https://app.example.com/api/mcp-connections', {
    method: 'PATCH',
    headers: {
      Cookie: 'session=session-a',
      'X-CSRF-Token': 'csrf-a',
    },
    body,
  })
}

function removeRequest(body = JSON.stringify({ client_key: 'chatgpt' })): Request {
  return new Request('https://app.example.com/api/mcp-connections', {
    method: 'DELETE',
    headers: {
      Cookie: 'session=session-a',
      'X-CSRF-Token': 'csrf-a',
    },
    body,
  })
}

describe('Account MCP connection routes', () => {
  it('lists only through the authenticated user and returns private data', async () => {
    const { application, router } = setup()

    const response = await router.handle(
      new Request('https://app.example.com/api/mcp-connections'),
      {},
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ connections: [connection] })
    expect(response.headers.get('Cache-Control')).toBe('no-store, private')
    expect(response.headers.get('Pragma')).toBe('no-cache')
    expect(application.list).toHaveBeenCalledWith('user-a')
  })

  it('updates in session, CSRF, parse, application order', async () => {
    const { application, calls, router } = setup()

    const response = await router.handle(updateRequest(), {})

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      connection: { ...connection, enabled: false },
    })
    expect(calls).toEqual([
      'session.require',
      'session.csrf',
      'application.setEnabled',
    ])
    expect(application.setEnabled).toHaveBeenCalledWith('user-a', {
      client_key: 'chatgpt',
      enabled: false,
    })
  })

  it('removes in session, CSRF, strict parse, application order', async () => {
    const { application, calls, router } = setup()
    const response = await router.handle(removeRequest(), {})

    expect(response.status).toBe(204)
    expect(calls).toEqual([
      'session.require',
      'session.csrf',
      'application.remove',
    ])
    expect(application.remove).toHaveBeenCalledWith('user-a', {
      client_key: 'chatgpt',
    })
  })

  it.each([
    ['array', '[]'],
    ['missing', '{}'],
    ['unknown', JSON.stringify({ client_key: 'chatgpt', user_id: 'user-b' })],
    ['wrong type', JSON.stringify({ client_key: 1 })],
  ])('rejects remove %s without application work', async (_name, body) => {
    const { application, router } = setup()
    const response = await router.handle(removeRequest(body), {})
    expect(response.status).toBe(400)
    expect(application.remove).not.toHaveBeenCalled()
  })

  it('checks authentication and CSRF before parsing or application work', async () => {
    const unauthenticated = setup()
    unauthenticated.session.requireSession.mockRejectedValueOnce(
      ApiError.unauthorized('unauthenticated', 'no session cookie'),
    )
    const noSession = await unauthenticated.router.handle(
      updateRequest('not-json'),
      {},
    )
    expect(noSession.status).toBe(401)
    expect(unauthenticated.session.requireCsrf).not.toHaveBeenCalled()
    expect(unauthenticated.application.setEnabled).not.toHaveBeenCalled()

    const csrfRejected = setup()
    csrfRejected.session.requireCsrf.mockImplementationOnce(() => {
      throw ApiError.forbidden('csrf_invalid', 'invalid CSRF token')
    })
    const noCsrf = await csrfRejected.router.handle(updateRequest('not-json'), {})
    expect(noCsrf.status).toBe(403)
    expect(csrfRejected.application.setEnabled).not.toHaveBeenCalled()
  })

  it.each([
    ['malformed JSON', 'not-json'],
    ['array', '[]'],
    ['missing field', JSON.stringify({ client_key: 'chatgpt' })],
    ['unknown field', JSON.stringify({
      client_key: 'chatgpt',
      enabled: false,
      user_id: 'user-b',
    })],
    ['wrong enabled type', JSON.stringify({ client_key: 'chatgpt', enabled: 0 })],
  ])('rejects %s without update work', async (_name, body) => {
    const { application, router } = setup()

    const response = await router.handle(updateRequest(body), {})

    expect(response.status).toBe(400)
    expect((await response.json()) as { code: string }).toMatchObject({
      code: 'invalid_payload',
    })
    expect(application.setEnabled).not.toHaveBeenCalled()
  })

  it('preserves generic cross-user/missing not-found and sanitized internal errors', async () => {
    const missing = setup()
    missing.application.setEnabled.mockRejectedValueOnce(
      ApiError.notFound('mcp_connection_not_found', 'MCP connection not found'),
    )
    const notFound = await missing.router.handle(updateRequest(), {})
    expect(notFound.status).toBe(404)
    expect(await notFound.json()).toEqual({
      code: 'mcp_connection_not_found',
      message: 'MCP connection not found',
    })

    const failing = setup()
    failing.application.list.mockRejectedValueOnce(
      new Error('SELECT secret FROM mcp_connections'),
    )
    const internal = await failing.router.handle(
      new Request('https://app.example.com/api/mcp-connections'),
      {},
    )
    expect(internal.status).toBe(500)
    expect(await internal.json()).toEqual({
      code: 'internal_error',
      message: 'internal error',
    })
  })
})
