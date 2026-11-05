import { sql } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { createTestDatabase } from '../../tests/sqlite-d1'
import {
  createDatabase, executeD1, D1Error, getDb, getDbOrApiError, stableErrorMessage, wrapD1Error,
  d1Int, d1NullableNumber, d1Values,
} from '.'

describe('D1 platform', () => {
  it('normalizes optional scalar values to Number/null', () => {
    expect(d1Int(4n)).toBe(4)
    expect(d1NullableNumber(undefined)).toBeNull()
    expect(d1NullableNumber(2n)).toBe(2)
    expect(d1Values([1n, undefined, null, 'name'])).toEqual([1, null, null, 'name'])
  })

  it('resolves the binding and wraps primitive failures stably', () => {
    const database = createTestDatabase()
    try { expect(getDb({ DB: database.db })).toBe(database.db) }
    finally { database.close() }
    expect(() => getDb({})).toThrow('D1 unavailable failed: D1 binding DB is missing')
    expect(stableErrorMessage(undefined)).toBe('undefined')
    expect(stableErrorMessage(7)).toBe('7')
    expect(wrapD1Error('query', 'boom')).toBeInstanceOf(D1Error)
    expect(() => getDbOrApiError({})).toThrowError(expect.objectContaining({ status: 500, code: 'd1_unavailable' }))
  })

  it('uses the D1 driver with parameterized query values', async () => {
    const database = createTestDatabase()
    try {
      const db = createDatabase(database.db)
      const value = "'; DROP TABLE users; --"
      await expect(executeD1('query', () => db.get(sql`select ${value} as value`))).resolves.toEqual({ value })
      expect(database.sqlite.prepare('SELECT count(*) AS n FROM users').get()?.n).toBe(0)
    } finally { database.close() }
  })

  it.each(['bind', 'query', 'run'] as const)('keeps %s errors free of Drizzle SQL and parameters', async (stage) => {
    const database = createTestDatabase({ before: (current) => { if (stage === current) throw new Error('database unavailable') } })
    try {
      const db = createDatabase(database.db)
      const operation = stage === 'run'
        ? () => db.run(sql`insert into users (id, username, password_hash) values ('id', 'member', ${'secret-hash'})`)
        : () => db.get(sql`select ${'private-value'} as value`)
      await expect(executeD1(stage === 'run' ? 'run' : 'query', operation)).rejects.toMatchObject({
        status: 500, code: `d1_${stage}_failed`, message: 'database unavailable',
      })
    } finally { database.close() }
  })
})
