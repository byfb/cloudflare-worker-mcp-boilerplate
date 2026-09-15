import { DatabaseSync } from 'node:sqlite'
import { readFileSync, readdirSync } from 'node:fs'
import type { D1Database, D1PreparedStatement, D1Value } from '../platform/d1'

/** Exercise repository SQL against a real, isolated SQLite database. */
export function createTestDatabase() {
  const sqlite = new DatabaseSync(':memory:')
  sqlite.exec('PRAGMA foreign_keys = ON')
  const directory = new URL('../../migrations/', import.meta.url)
  for (const name of readdirSync(directory).filter((name) => name.endsWith('.sql')).sort()) {
    sqlite.exec(readFileSync(new URL(name, directory), 'utf8'))
  }
  function prepare(sql: string, values: D1Value[] = []): D1PreparedStatement {
    // Node binds anonymous placeholders positionally; D1 uses numbered ones.
    const numbered = [...sql.matchAll(/\?(\d+)/g)].map((match) => Number(match[1]) - 1)
    const statement = () => sqlite.prepare(sql.replace(/\?\d+/g, '?'))
    const bindings = () => numbered.length ? numbered.map((index) => values[index]) : values
    return {
      bind: (...next) => prepare(sql, next),
      async first<T>(column?: string) {
        const row = statement().get(...bindings())
        return (row === undefined ? null : column ? row[column] : row) as T | null
      },
      async all<T>() { return { results: statement().all(...bindings()) as T[], success: true } },
      async raw<T>() { return statement().all(...bindings()).map(Object.values) as T[] },
      async run() {
        const result = statement().run(...bindings())
        return { success: true, meta: { changes: Number(result.changes) } }
      },
    }
  }
  const db: D1Database = {
    prepare,
    async exec(sql) { sqlite.exec(sql); return { success: true } },
    async batch(statements) {
      sqlite.exec('BEGIN')
      try {
        const results = []
        for (const statement of statements) results.push(await statement.run())
        sqlite.exec('COMMIT')
        return results
      } catch (error) { sqlite.exec('ROLLBACK'); throw error }
    },
  }
  return { db, sqlite, close: () => sqlite.close() }
}
