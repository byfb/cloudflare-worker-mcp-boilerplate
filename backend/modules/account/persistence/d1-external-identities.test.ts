import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createTestDatabase } from '../../../tests/sqlite-d1'
import { ExternalIdentityCollisionError } from '../domain/external-identity'
import { D1ExternalIdentityRepository } from './d1-external-identities'

const firstLink = {
  issuer: 'https://team.cloudflareaccess.com', subject: 'google-subject-1',
  userId: 'user-1', verifiedEmail: 'first@example.com',
} as const

let database: ReturnType<typeof createTestDatabase>
let repository: D1ExternalIdentityRepository
let failure: string | undefined

beforeEach(() => {
  failure = undefined
  database = createTestDatabase({ before: (stage) => { if (stage === failure) throw new Error(`${stage} unavailable`) } })
  database.sqlite.exec("INSERT INTO users (id, username, password_hash) VALUES ('user-1', 'first', 'hash'), ('user-2', 'second', 'hash')")
  repository = new D1ExternalIdentityRepository(database.db)
})
afterEach(() => database.close())

describe('D1ExternalIdentityRepository with Drizzle', () => {
  it('links and resolves the exact issuer and subject with a database timestamp', async () => {
    const linked = await repository.link(firstLink)
    expect(linked).toEqual({ ...firstLink, createdAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T.*Z$/) })
    await expect(repository.find(firstLink)).resolves.toEqual(linked)
    await expect(repository.find({ ...firstLink, subject: 'unknown' })).resolves.toBeNull()
  })

  it('keeps the original email snapshot across retries', async () => {
    const original = await repository.link(firstLink)
    await expect(repository.link({ ...firstLink, verifiedEmail: 'changed@example.com' })).resolves.toEqual(original)
    expect(await repository.listByUser('user-1')).toHaveLength(1)
  })

  it('selects one owner under competing links and preserves the winner', async () => {
    const results = await Promise.allSettled([
      repository.link(firstLink), repository.link({ ...firstLink, userId: 'user-2' }),
    ])
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    expect(results.find((result) => result.status === 'rejected')).toMatchObject({ reason: expect.any(ExternalIdentityCollisionError) })
    await expect(repository.find(firstLink)).resolves.toMatchObject({ userId: 'user-1' })
  })

  it('keeps identities with matching email and different issuers independent', async () => {
    await repository.link(firstLink)
    await expect(repository.link({ ...firstLink, issuer: 'https://other.cloudflareaccess.com', userId: 'user-2' }))
      .resolves.toMatchObject({ userId: 'user-2' })
  })

  it('lists safe summaries in deterministic order for only the selected user', async () => {
    await repository.link(firstLink)
    await repository.link({ ...firstLink, subject: 'google-subject-2', verifiedEmail: null })
    await repository.link({ ...firstLink, subject: 'google-subject-3', userId: 'user-2' })
    database.sqlite.exec("UPDATE auth_identities SET created_at = '2026-01-01T00:00:00.000Z'")
    await expect(repository.listByUser('user-1')).resolves.toEqual([
      { email: 'first@example.com', linked_at: '2026-01-01T00:00:00.000Z' },
      { email: null, linked_at: '2026-01-01T00:00:00.000Z' },
    ])
    await expect(repository.listByUser('missing')).resolves.toEqual([])
  })

  it.each(['bind', 'run', 'query'])('maps %s failures without leaking Drizzle parameters', async (stage) => {
    failure = stage
    await expect(stage === 'run' ? repository.link(firstLink) : repository.find(firstLink))
      .rejects.toMatchObject({ code: `d1_${stage}_failed`, status: 500, message: `${stage} unavailable` })
  })
})
