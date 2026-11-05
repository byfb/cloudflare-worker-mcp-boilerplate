import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createTestDatabase } from '../../../tests/sqlite-d1'
import { D1McpConnectionRepository } from './d1-mcp-connections'

const authorization = {
  userId: 'user-a', clientKey: 'chatgpt', displayName: 'ChatGPT',
  clientVersion: '1.0.0', nowMs: 1_000, toolCall: false,
} as const

let database: ReturnType<typeof createTestDatabase>
let repository: D1McpConnectionRepository
let failure: string | undefined
let afterQuery: ((sql: string) => void) | undefined
beforeEach(() => {
  failure = undefined
  afterQuery = undefined
  database = createTestDatabase({
    before: (stage) => { if (stage === failure) throw new Error(`${stage} unavailable`) },
    after: (_, sql) => afterQuery?.(sql),
  })
  database.sqlite.exec("INSERT INTO users (id, username, password_hash) VALUES ('user-a', 'first', 'hash'), ('user-b', 'second', 'hash')")
  repository = new D1McpConnectionRepository(database.db)
})
afterEach(() => database.close())

describe('D1McpConnectionRepository with Drizzle', () => {
  it('refreshes active metadata while preserving first-seen time', async () => {
    await expect(repository.authorize(authorization)).resolves.toBe(true)
    await expect(repository.authorize({ ...authorization, clientVersion: '2.0.0', nowMs: 2_000 })).resolves.toBe(true)
    await expect(repository.listByUser('user-a')).resolves.toEqual([{
      userId: 'user-a', clientKey: 'chatgpt', displayName: 'ChatGPT', clientVersion: '2.0.0',
      firstSeenAt: 1_000, lastSeenAt: 2_000, revokedAt: null, toolCallCount: 0,
    }])
  })

  it('preserves every accepted tool-call increment without read-modify-write', async () => {
    await repository.authorize(authorization)
    await Promise.all([
      repository.authorize({ ...authorization, toolCall: true, nowMs: 2_000 }),
      repository.authorize({ ...authorization, toolCall: true, nowMs: 2_001 }),
      repository.authorize({ ...authorization, nowMs: 2_002 }),
    ])
    await expect(repository.listByUser('user-a')).resolves.toMatchObject([{ toolCallCount: 2 }])
  })

  it('preserves revoked rows and scopes every mutation to the current user', async () => {
    await repository.authorize(authorization)
    await repository.authorize({ ...authorization, userId: 'user-b' })
    await expect(repository.setEnabled('user-a', 'chatgpt', false, 3_000)).resolves.toMatchObject({ revokedAt: 3_000 })
    await expect(repository.authorize({ ...authorization, clientVersion: '9.0.0', nowMs: 4_000, toolCall: true })).resolves.toBe(false)
    await expect(repository.authorize({ ...authorization, userId: 'user-b', nowMs: 4_000 })).resolves.toBe(true)
    await expect(repository.listByUser('user-a')).resolves.toMatchObject([{
      clientVersion: '1.0.0', lastSeenAt: 1_000, revokedAt: 3_000, toolCallCount: 0,
    }])
    await expect(repository.listByUser('user-b')).resolves.toMatchObject([{ revokedAt: null }])
    await expect(repository.setEnabled('unknown', 'chatgpt', true, 5_000)).resolves.toBeNull()
    await expect(repository.setEnabled('user-a', 'chatgpt', true, 5_000)).resolves.toMatchObject({ revokedAt: null })
    await expect(repository.authorize({ ...authorization, nowMs: 6_000 })).resolves.toBe(true)
  })

  it('removes only disabled rows and allows a new registration after forgetting', async () => {
    await repository.authorize(authorization)
    await expect(repository.removeDisabled('user-a', 'chatgpt')).resolves.toBe('active')
    await repository.setEnabled('user-a', 'chatgpt', false, 2_000)
    await expect(repository.removeDisabled('user-b', 'chatgpt')).resolves.toBe('missing')
    await expect(repository.removeDisabled('user-a', 'chatgpt')).resolves.toBe('removed')
    await expect(repository.removeDisabled('user-a', 'chatgpt')).resolves.toBe('missing')
    await expect(repository.authorize({ ...authorization, nowMs: 3_000 })).resolves.toBe(true)
    await expect(repository.listByUser('user-a')).resolves.toMatchObject([{ firstSeenAt: 3_000 }])
  })

  it('retries when a row is disabled between the conditional delete and lookup', async () => {
    await repository.authorize(authorization)
    let deletes = 0
    afterQuery = (sql) => {
      if (!/^delete/i.test(sql)) return
      deletes += 1
      if (deletes === 1) database.sqlite.exec("UPDATE mcp_connections SET revoked_at = 2500 WHERE user_id = 'user-a' AND client_key = 'chatgpt'")
    }
    await expect(repository.removeDisabled('user-a', 'chatgpt')).resolves.toBe('removed')
    expect(deletes).toBe(2)
    await expect(repository.listByUser('user-a')).resolves.toEqual([])
  })

  it('orders recent connections first with stable client-key ties', async () => {
    await repository.authorize({ ...authorization, clientKey: 'z-client', nowMs: 2_000 })
    await repository.authorize({ ...authorization, clientKey: 'a-client', nowMs: 2_000 })
    await repository.authorize(authorization)
    expect((await repository.listByUser('user-a')).map((row) => row.clientKey)).toEqual(['a-client', 'z-client', 'chatgpt'])
  })

  it.each(['bind', 'run', 'query'])('maps %s failures to the existing public code', async (stage) => {
    failure = stage
    await expect(stage === 'run' ? repository.authorize(authorization) : repository.listByUser('user-a'))
      .rejects.toMatchObject({ code: `d1_${stage}_failed`, status: 500, message: `${stage} unavailable` })
  })
})
