import { describe, expect, it } from 'vitest'
import type {
  McpConnectionAuthorization,
  McpConnectionRepository,
} from './mcp-connection-repository'
import { McpConnectionApplication } from './mcp-connection-service'
import type { McpConnectionRecord } from '../domain/mcp-connection'

const activeRow: McpConnectionRecord = {
  userId: 'user-a',
  clientKey: 'chatgpt',
  displayName: 'ChatGPT',
  clientVersion: '1.0.0',
  firstSeenAt: 1_700_000_000_000,
  lastSeenAt: 1_700_000_001_000,
  revokedAt: null,
  toolCallCount: 3,
}

class FakeConnections implements McpConnectionRepository {
  readonly authorizations: McpConnectionAuthorization[] = []
  readonly rows = new Map<string, McpConnectionRecord>()
  authorizeResult = true

  async authorize(input: McpConnectionAuthorization): Promise<boolean> {
    this.authorizations.push(input)
    return this.authorizeResult
  }

  async listByUser(userId: string): Promise<readonly McpConnectionRecord[]> {
    return [...this.rows.values()].filter((row) => row.userId === userId)
  }

  async setEnabled(
    userId: string,
    clientKey: string,
    enabled: boolean,
    nowMs: number,
  ): Promise<McpConnectionRecord | null> {
    const row = this.rows.get(`${userId}\u0000${clientKey}`)
    if (row === undefined) return null
    const updated = {
      ...row,
      revokedAt: enabled ? null : nowMs,
    }
    this.rows.set(`${userId}\u0000${clientKey}`, updated)
    return updated
  }

  async removeDisabled(
    userId: string,
    clientKey: string,
  ): Promise<'removed' | 'active' | 'missing'> {
    const key = `${userId}\u0000${clientKey}`
    const row = this.rows.get(key)
    if (row === undefined) return 'missing'
    if (row.revokedAt === null) return 'active'
    this.rows.delete(key)
    return 'removed'
  }
}

function setup() {
  const repository = new FakeConnections()
  const application = new McpConnectionApplication({
    repository,
    clock: { nowMs: () => 1_800_000_000_000 },
  })
  return { application, repository }
}

describe('McpConnectionApplication', () => {
  it('registers/refreshes an active user-client family and ignores version for its key', async () => {
    const { application, repository } = setup()

    await expect(application.authorize('user-a', {
      name: 'ChatGPT',
      title: 'ChatGPT Web',
      version: '2.0.0',
    }, { toolCall: true })).resolves.toBeUndefined()

    expect(repository.authorizations).toEqual([{
      userId: 'user-a',
      clientKey: 'chatgpt',
      displayName: 'ChatGPT Web',
      clientVersion: '2.0.0',
      nowMs: 1_800_000_000_000,
      toolCall: true,
    }])
  })

  it('rejects a revoked tombstone with a stable actionable public error', async () => {
    const { application, repository } = setup()
    repository.authorizeResult = false

    await expect(application.authorize('user-a', {
      name: 'ChatGPT',
      version: '2.0.0',
    }, { toolCall: false })).rejects.toMatchObject({
      status: 403,
      code: 'mcp_connection_revoked',
      message: 'MCP connection is disabled; re-enable it in Profile',
    })
  })

  it('lists and updates only rows selected by the authenticated user', async () => {
    const { application, repository } = setup()
    repository.rows.set('user-a\u0000chatgpt', activeRow)
    repository.rows.set('user-b\u0000chatgpt', { ...activeRow, userId: 'user-b' })

    await expect(application.list('user-a')).resolves.toEqual({
      connections: [{
        client_key: 'chatgpt',
        display_name: 'ChatGPT',
        client_version: '1.0.0',
        first_seen_at: 1_700_000_000_000,
        last_seen_at: 1_700_000_001_000,
        tool_call_count: 3,
        enabled: true,
      }],
    })
    await expect(application.setEnabled('user-a', {
      client_key: 'chatgpt',
      enabled: false,
    })).resolves.toMatchObject({
      client_key: 'chatgpt',
      enabled: false,
    })
    expect(repository.rows.get('user-b\u0000chatgpt')?.revokedAt).toBeNull()
  })

  it('removes only a disconnected current-user row', async () => {
    const { application, repository } = setup()
    repository.rows.set('user-a\u0000chatgpt', activeRow)
    repository.rows.set('user-b\u0000chatgpt', { ...activeRow, userId: 'user-b' })

    await expect(application.remove('user-a', {
      client_key: 'chatgpt',
    })).rejects.toMatchObject({
      status: 409,
      code: 'mcp_connection_active',
    })
    await application.setEnabled('user-a', { client_key: 'chatgpt', enabled: false })
    await expect(application.remove('user-a', { client_key: 'chatgpt' }))
      .resolves.toBeUndefined()
    expect(repository.rows.has('user-a\u0000chatgpt')).toBe(false)
    expect(repository.rows.has('user-b\u0000chatgpt')).toBe(true)
    await expect(application.remove('user-a', { client_key: 'chatgpt' }))
      .rejects.toMatchObject({ status: 404, code: 'mcp_connection_not_found' })
  })

  it('uses the same not-found response for missing and cross-user client keys', async () => {
    const { application, repository } = setup()
    repository.rows.set('user-b\u0000chatgpt', { ...activeRow, userId: 'user-b' })

    await expect(application.setEnabled('user-a', {
      client_key: 'chatgpt',
      enabled: false,
    })).rejects.toMatchObject({
      status: 404,
      code: 'mcp_connection_not_found',
      message: 'MCP connection not found',
    })
  })
})
