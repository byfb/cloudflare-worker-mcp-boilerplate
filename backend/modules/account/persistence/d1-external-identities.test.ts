import { describe, expect, it } from 'vitest'
import type {
  D1Database,
  D1ExecResult,
  D1PreparedStatement,
  D1Result,
  D1Value,
} from '../../../platform/d1'
import { ExternalIdentityCollisionError } from '../domain/external-identity'
import {
  D1ExternalIdentityRepository,
  INSERT_EXTERNAL_IDENTITY_SQL,
  LIST_EXTERNAL_IDENTITIES_BY_USER_SQL,
  SELECT_EXTERNAL_IDENTITY_SQL,
} from './d1-external-identities'

interface StoredRow {
  issuer: string
  subject: string
  user_id: string
  verified_email: string | null
  created_at: string
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
    if (this.sql !== SELECT_EXTERNAL_IDENTITY_SQL) throw new Error('unexpected query')
    const row = this.database.rows.get(this.key())
    return (row ?? null) as T | null
  }

  async all<T = Record<string, unknown>>(): Promise<D1Result<T>> {
    if (this.database.failQuery) throw new Error('query unavailable')
    if (this.sql !== LIST_EXTERNAL_IDENTITIES_BY_USER_SQL) throw new Error('unexpected list query')
    const userId = String(this.values[0])
    const results = [...this.database.rows.values()]
      .filter((row) => row.user_id === userId)
      .sort((left, right) =>
        left.created_at.localeCompare(right.created_at) ||
        left.issuer.localeCompare(right.issuer) ||
        left.subject.localeCompare(right.subject),
      )
      .map((row) => ({
        verified_email: row.verified_email,
        created_at: row.created_at,
      })) as T[]
    return { results, success: true }
  }

  async raw<T = unknown>(): Promise<T[]> {
    return []
  }

  async run(): Promise<D1ExecResult> {
    if (this.database.failRun) throw new Error('write unavailable')
    if (this.sql !== INSERT_EXTERNAL_IDENTITY_SQL) throw new Error('unexpected write')
    const key = this.key()
    if (this.database.rows.has(key)) return { success: true, meta: { changes: 0 } }
    this.database.rows.set(key, {
      issuer: String(this.values[0]),
      subject: String(this.values[1]),
      user_id: String(this.values[2]),
      verified_email: this.values[3] === null ? null : String(this.values[3]),
      created_at: `2026-08-09T00:00:0${this.database.rows.size}.000Z`,
    })
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

const firstLink = {
  issuer: 'https://team.cloudflareaccess.com',
  subject: 'google-subject-1',
  userId: 'user-1',
  verifiedEmail: 'first@example.com',
} as const

describe('D1ExternalIdentityRepository', () => {
  it('links and resolves an exact issuer-subject mapping', async () => {
    const database = new MemoryD1()
    const repository = new D1ExternalIdentityRepository(database)

    const linked = await repository.link(firstLink)

    expect(linked).toEqual({
      ...firstLink,
      createdAt: '2026-08-09T00:00:00.000Z',
    })
    await expect(repository.find({
      issuer: firstLink.issuer,
      subject: firstLink.subject,
    })).resolves.toEqual(linked)
    await expect(repository.find({
      issuer: firstLink.issuer,
      subject: 'unknown',
    })).resolves.toBeNull()
  })

  it('is idempotent for one owner and never overwrites the email snapshot', async () => {
    const database = new MemoryD1()
    const repository = new D1ExternalIdentityRepository(database)
    const original = await repository.link(firstLink)

    await expect(repository.link({
      ...firstLink,
      verifiedEmail: 'changed@example.com',
    })).resolves.toEqual(original)
    expect(database.rows).toHaveLength(1)
    expect([...database.rows.values()][0]?.verified_email).toBe('first@example.com')
  })

  it('rejects a different owner and preserves the winning mapping', async () => {
    const database = new MemoryD1()
    const repository = new D1ExternalIdentityRepository(database)
    const original = await repository.link(firstLink)

    await expect(repository.link({
      ...firstLink,
      userId: 'user-2',
      verifiedEmail: 'second@example.com',
    })).rejects.toBeInstanceOf(ExternalIdentityCollisionError)
    await expect(repository.find(firstLink)).resolves.toEqual(original)
  })

  it('does not use email to match identities or owners', async () => {
    const database = new MemoryD1()
    const repository = new D1ExternalIdentityRepository(database)
    await repository.link(firstLink)

    const second = await repository.link({
      issuer: 'https://another.cloudflareaccess.com',
      subject: firstLink.subject,
      userId: 'user-2',
      verifiedEmail: firstLink.verifiedEmail,
    })

    expect(second.userId).toBe('user-2')
    expect(database.rows).toHaveLength(2)
  })

  it('lists deterministic safe summaries for only the selected user', async () => {
    const database = new MemoryD1()
    const repository = new D1ExternalIdentityRepository(database)
    await repository.link(firstLink)
    await repository.link({
      issuer: 'https://second.cloudflareaccess.com',
      subject: 'google-subject-2',
      userId: 'user-1',
      verifiedEmail: null,
    })
    await repository.link({
      issuer: 'https://other.cloudflareaccess.com',
      subject: 'google-subject-3',
      userId: 'user-2',
      verifiedEmail: 'other@example.com',
    })

    const summaries = await repository.listByUser('user-1')
    expect(summaries).toEqual([
      { email: 'first@example.com', linked_at: '2026-08-09T00:00:00.000Z' },
      { email: null, linked_at: '2026-08-09T00:00:01.000Z' },
    ])
    expect(JSON.stringify(summaries)).not.toContain('issuer')
    expect(JSON.stringify(summaries)).not.toContain('subject')
    await expect(repository.listByUser('missing')).resolves.toEqual([])
  })

  it('maps bind, write, and query failures to stable D1 errors', async () => {
    const database = new MemoryD1()
    const repository = new D1ExternalIdentityRepository(database)

    database.failBind = true
    await expect(repository.find(firstLink)).rejects.toMatchObject({
      code: 'd1_bind_failed',
      status: 500,
    })

    database.failBind = false
    database.failRun = true
    await expect(repository.link(firstLink)).rejects.toMatchObject({
      code: 'd1_run_failed',
      status: 500,
    })

    database.failRun = false
    database.failQuery = true
    await expect(repository.find(firstLink)).rejects.toMatchObject({
      code: 'd1_query_failed',
      status: 500,
    })
  })
})
