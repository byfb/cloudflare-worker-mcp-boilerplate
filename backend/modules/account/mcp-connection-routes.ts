import type { JwtEnv } from '../../platform/auth'
import {
  ApiError,
  apiErrorStatus,
  isApiError,
} from '../../platform/http/api-error'
import { parseJson } from '../../platform/http/request'
import { fromApiError, json } from '../../platform/http/responses'
import type { Router, RouteContext } from '../../platform/http/router'
import type { SessionReader } from './application/ports'
import type {
  McpConnectionCapability,
  RemoveMcpConnectionInput,
  SetMcpConnectionEnabledInput,
} from './public/mcp-connections'

const PRIVATE_NO_STORE = 'no-store, private'

export interface McpConnectionRouteDeps<E extends JwtEnv = JwtEnv> {
  readonly application: Pick<McpConnectionCapability, 'list' | 'setEnabled' | 'remove'>
  readonly session: SessionReader<E>
}

function privateNoStore(response: Response): Response {
  const headers = new Headers(response.headers)
  headers.set('Cache-Control', PRIVATE_NO_STORE)
  headers.set('Pragma', 'no-cache')
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}

function errorResponse(error: unknown): Response {
  const response =
    isApiError(error) && apiErrorStatus(error) < 500
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

function updateBody(value: unknown): SetMcpConnectionEnabledInput {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw ApiError.badRequest('invalid_payload', 'expected an object payload')
  }
  const record = value as Record<string, unknown>
  const keys = Object.keys(record)
  if (
    keys.length !== 2 ||
    !Object.hasOwn(record, 'client_key') ||
    !Object.hasOwn(record, 'enabled')
  ) {
    throw ApiError.badRequest(
      'invalid_payload',
      'expected only client_key and enabled',
    )
  }
  if (typeof record.client_key !== 'string') {
    throw ApiError.badRequest('invalid_payload', 'client_key must be a string')
  }
  if (typeof record.enabled !== 'boolean') {
    throw ApiError.badRequest('invalid_payload', 'enabled must be a boolean')
  }
  return {
    client_key: record.client_key,
    enabled: record.enabled,
  }
}

function removeBody(value: unknown): RemoveMcpConnectionInput {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw ApiError.badRequest('invalid_payload', 'expected an object payload')
  }
  const record = value as Record<string, unknown>
  if (Object.keys(record).length !== 1 || !Object.hasOwn(record, 'client_key')) {
    throw ApiError.badRequest('invalid_payload', 'expected only client_key')
  }
  if (typeof record.client_key !== 'string') {
    throw ApiError.badRequest('invalid_payload', 'client_key must be a string')
  }
  return { client_key: record.client_key }
}

/** Register user-facing MCP connection list and toggle operations. */
export function registerMcpConnectionRoutes<E extends JwtEnv>(
  router: Router<E>,
  deps: McpConnectionRouteDeps<E>,
): Router<E> {
  router.get('/api/mcp-connections', ({ request, env }: RouteContext<E>) =>
    routeResult(
      async () => {
        const claims = await deps.session.requireSession(request, env)
        return deps.application.list(claims.sub)
      },
      (result) => json(result, 200),
    ),
  )

  router.patch('/api/mcp-connections', ({ request, env }: RouteContext<E>) =>
    routeResult(
      async () => {
        const claims = await deps.session.requireSession(request, env)
        deps.session.requireCsrf(request, claims)
        const input = updateBody(await parseJson<unknown>(request))
        return deps.application.setEnabled(claims.sub, input)
      },
      (connection) => json({ connection }, 200),
    ),
  )

  router.delete('/api/mcp-connections', ({ request, env }: RouteContext<E>) =>
    routeResult(
      async () => {
        const claims = await deps.session.requireSession(request, env)
        deps.session.requireCsrf(request, claims)
        await deps.application.remove(
          claims.sub,
          removeBody(await parseJson<unknown>(request)),
        )
      },
      () => new Response(null, { status: 204 }),
    ),
  )

  return router
}
