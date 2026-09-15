import { describe, expect, it } from 'vitest'
import type {
  D1Database,
  D1ExecResult,
  D1PreparedStatement,
  D1Result,
  D1Value,
} from '../../../platform/d1'
import {
  AUTHORIZE_MCP_CONNECTION_SQL,
  D1McpConnectionRepository,
  LIST_MCP_CONNECTIONS_SQL,
  REMOVE_DISABLED_MCP_CONNECTION_SQL,
  SELECT_MCP_CONNECTION_SQL,
  SET_MCP_CONNECTION_ENABLED_SQL,
} from './d1-mcp-connections'

interface StoredRow {
  user_id: string
  client_key: string
  display_name: string
  client_version: string
  first_seen_at: number
  last_seen_at: number
  revoked_at: number | null
  tool_call_count: number
}

class MemoryStatement implements D1PreparedStatement {
  private values: D1Value[] = []

  constructor(
    private readonly database: MemoryD1,
    private readonly sql: string,
  ) {}

  bind(...values: D1Value[]): D1PreparedStatement {
    if (this.database.failBind) throw new Error('bind unavailable')
    this.values = values
    return this
  }

  async first<T = Record<string, unknown>>(): Promise<T | null> {
    if (this.database.failQuery) throw new Error('query unavailable')
    if (this.sql !== SELECT_MCP_CONNECTION_SQL) throw new Error('unexpected query')
    return (this.database.rows.get(this.key()) ?? null) as T | null
  }

  async all<T = Record<string, unknown>>(): Promise<D1Result<T>> {
    if (this.database.failQuery) throw new Error('query unavailable')
    if (this.sql !== LIST_MCP_CONNECTIONS_SQL) throw new Error('unexpected query')
    const userId = String(this.values[0])
    const results = [...this.database.rows.values()]
      .filter((row) => row.user_id === userId)
      .sort((left, right) =>
        right.last_seen_at - left.last_seen_at ||
        left.client_key.localeCompare(right.client_key),
      )
    return { results: results as T[], success: true }
  }

  async raw<T = unknown>(): Promise<T[]> {
    return []
  }

  async run(): Promise<D1ExecResult> {
    if (this.database.failRun) throw new Error('write unavailable')
    if (this.sql === AUTHORIZE_MCP_CONNECTION_SQL) return this.authorize()
    if (this.sql === SET_MCP_CONNECTION_ENABLED_SQL) return this.setEnabled()
    if (this.sql === REMOVE_DISABLED_MCP_CONNECTION_SQL) return this.removeDisabled()
    throw new Error('unexpected write')
  }

  private authorize(): D1ExecResult {
    const key = this.key()
    const existing = this.database.rows.get(key)
    if (existing?.revoked_at !== undefined && existing.revoked_at !== null) {
      return { success: true, meta: { changes: 0 } }
    }
    const nowMs = Number(this.values[4])
    this.database.rows.set(key, {
      user_id: String(this.values[0]),
      client_key: String(this.values[1]),
      display_name: String(this.values[2]),
      client_version: String(this.values[3]),
      first_seen_at: existing?.first_seen_at ?? nowMs,
      last_seen_at: nowMs,
      revoked_at: null,
      tool_call_count: (existing?.tool_call_count ?? 0) + Number(this.values[5]),
    })
    return { success: true, meta: { changes: 1 } }
  }

  private setEnabled(): D1ExecResult {
    const key = this.key()
    const existing = this.database.rows.get(key)
    if (existing === undefined) return { success: true, meta: { changes: 0 } }
    this.database.rows.set(key, {
      ...existing,
      revoked_at: Number(this.values[2]) === 1 ? null : Number(this.values[3]),
    })
    return { success: true, meta: { changes: 1 } }
  }

  private removeDisabled(): D1ExecResult {
    const key = this.key()
    const existing = this.database.rows.get(key)
    if (
      this.database.disconnectOnFirstRemove &&
      this.database.removeAttempts === 0 &&
      existing !== undefined &&
      existing.revoked_at === null
    ) {
      this.database.removeAttempts += 1
      this.database.rows.set(key, { ...existing, revoked_at: 2_500 })
      return { success: true, meta: { changes: 0 } }
    }
    this.database.removeAttempts += 1
    if (existing === undefined || existing.revoked_at === null) {
      return { success: true, meta: { changes: 0 } }
    }
    this.database.rows.delete(key)
    return { success: true, meta: { changes: 1 } }
  }

  private key(): string {
    return `${String(this.values[0])}\u0000${String(this.values[1])}`
  }
}

class MemoryD1 implements D1Database {
  readonly rows = new Map<string, StoredRow>()
  failBind = false
  failQuery = false
  failRun = false
  disconnectOnFirstRemove = false
  removeAttempts = 0

  prepare(sql: string): D1PreparedStatement {
    return new MemoryStatement(this, sql)
  }

  async batch(): Promise<D1ExecResult[]> {
    return []
  }

  async exec(): Promise<D1ExecResult> {
    return { success: true }
  }
}

const chatGptAuthorization = {
  userId: 'user-a',
  clientKey: 'chatgpt',
  displayName: 'ChatGPT',
  clientVersion: '1.0.0',
  nowMs: 1_000,
  toolCall: false,
} as const

describe('D1McpConnectionRepository', () => {
  it('inserts first-seen and refreshes active metadata without changing the key', async () => {
    const database = new MemoryD1()
    const repository = new D1McpConnectionRepository(database)

    await expect(repository.authorize(chatGptAuthorization)).resolves.toBe(true)
    await expect(repository.authorize({
      ...chatGptAuthorization,
      clientVersion: '2.0.0',
      nowMs: 2_000,
    })).resolves.toBe(true)

    await expect(repository.listByUser('user-a')).resolves.toEqual([{
      userId: 'user-a',
      clientKey: 'chatgpt',
      displayName: 'ChatGPT',
      clientVersion: '2.0.0',
      firstSeenAt: 1_000,
      lastSeenAt: 2_000,
      revokedAt: null,
      toolCallCount: 0,
    }])
    expect(database.rows).toHaveLength(1)
  })

  it('increments only tool-call authorizations and preserves every accepted increment', async () => {
    const database = new MemoryD1()
    const repository = new D1McpConnectionRepository(database)

    await repository.authorize(chatGptAuthorization)
    await Promise.all([
      repository.authorize({ ...chatGptAuthorization, toolCall: true, nowMs: 2_000 }),
      repository.authorize({ ...chatGptAuthorization, toolCall: true, nowMs: 2_001 }),
      repository.authorize({ ...chatGptAuthorization, toolCall: false, nowMs: 2_002 }),
    ])

    await expect(repository.listByUser('user-a')).resolves.toEqual([
      expect.objectContaining({ toolCallCount: 2 }),
    ])
  })

  it('keeps revoked tombstones while isolating the same client key by user', async () => {
    const database = new MemoryD1()
    const repository = new D1McpConnectionRepository(database)
    await repository.authorize(chatGptAuthorization)
    await repository.authorize({
      ...chatGptAuthorization,
      clientKey: 'gemini',
      displayName: 'Gemini',
    })
    await repository.authorize({ ...chatGptAuthorization, userId: 'user-b' })

    await expect(repository.setEnabled(
      'user-a',
      'chatgpt',
      false,
      3_000,
    )).resolves.toMatchObject({ revokedAt: 3_000 })
    await expect(repository.authorize({
      ...chatGptAuthorization,
      clientVersion: '9.0.0',
      nowMs: 4_000,
    })).resolves.toBe(false)
    await expect(repository.authorize({
      ...chatGptAuthorization,
      clientKey: 'gemini',
      displayName: 'Gemini',
      nowMs: 4_000,
    })).resolves.toBe(true)
    await expect(repository.authorize({
      ...chatGptAuthorization,
      userId: 'user-b',
      nowMs: 4_000,
    })).resolves.toBe(true)

    expect(database.rows.get('user-a\u0000chatgpt')).toMatchObject({
      client_version: '1.0.0',
      last_seen_at: 1_000,
      revoked_at: 3_000,
    })
    expect(database.rows.get('user-b\u0000chatgpt')?.revoked_at).toBeNull()
    expect(database.rows.get('user-a\u0000gemini')?.revoked_at).toBeNull()

    await expect(repository.setEnabled(
      'user-a',
      'chatgpt',
      true,
      5_000,
    )).resolves.toMatchObject({ revokedAt: null })
    await expect(repository.authorize({
      ...chatGptAuthorization,
      clientVersion: '9.0.0',
      nowMs: 6_000,
    })).resolves.toBe(true)
  })

  it('removes only revoked rows and allows a later first-seen registration', async () => {
    const database = new MemoryD1()
    const repository = new D1McpConnectionRepository(database)
    await repository.authorize(chatGptAuthorization)

    await expect(repository.removeDisabled('user-a', 'chatgpt')).resolves.toBe('active')
    await repository.setEnabled('user-a', 'chatgpt', false, 2_000)
    await expect(repository.removeDisabled('user-b', 'chatgpt')).resolves.toBe('missing')
    await expect(repository.removeDisabled('user-a', 'chatgpt')).resolves.toBe('removed')
    await expect(repository.removeDisabled('user-a', 'chatgpt')).resolves.toBe('missing')
    await expect(repository.authorize({
      ...chatGptAuthorization,
      nowMs: 3_000,
    })).resolves.toBe(true)
  })

  it('retries when an active row becomes disconnected during removal', async () => {
    const database = new MemoryD1()
    const repository = new D1McpConnectionRepository(database)
    await repository.authorize(chatGptAuthorization)
    database.disconnectOnFirstRemove = true

    await expect(repository.removeDisabled('user-a', 'chatgpt')).resolves.toBe('removed')
    expect(database.removeAttempts).toBe(2)
    expect(database.rows.has('user-a\u0000chatgpt')).toBe(false)
  })

  it('returns null for missing/current-user lookup and maps D1 stages', async () => {
    const database = new MemoryD1()
    const repository = new D1McpConnectionRepository(database)

    await expect(repository.setEnabled(
      'user-a',
      'missing',
      false,
      1_000,
    )).resolves.toBeNull()

    database.failBind = true
    await expect(repository.listByUser('user-a')).rejects.toMatchObject({
      code: 'd1_bind_failed',
      status: 500,
    })

    database.failBind = false
    database.failRun = true
    await expect(repository.authorize(chatGptAuthorization)).rejects.toMatchObject({
      code: 'd1_run_failed',
      status: 500,
    })

    database.failRun = false
    database.failQuery = true
    await expect(repository.listByUser('user-a')).rejects.toMatchObject({
      code: 'd1_query_failed',
      status: 500,
    })
  })
})
