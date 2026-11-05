import { DatabaseSync, type SQLInputValue } from 'node:sqlite'
import { readFileSync, readdirSync } from 'node:fs'
import type { D1Database, D1PreparedStatement, D1Result } from '../platform/d1'

type Stage = 'bind' | 'query' | 'run'
interface Hooks {
  before?: (stage: Stage, sql: string) => void
  after?: (stage: Exclude<Stage, 'bind'>, sql: string) => void
}

/** Exercise the production D1 driver and generated SQL against real SQLite. */
export function createTestDatabase(hooks: Hooks = {}) {
  const sqlite = new DatabaseSync(':memory:')
  sqlite.exec('PRAGMA foreign_keys = ON')
  const directory = new URL('../../migrations/', import.meta.url)
  for (const name of readdirSync(directory).filter((name) => name.endsWith('.sql')).sort()) {
    sqlite.exec(readFileSync(new URL(name, directory), 'utf8'))
  }
  function prepare(sql: string, values: unknown[] = []): D1PreparedStatement {
    const numbered = [...sql.matchAll(/\?(\d+)/g)].map((match) => Number(match[1]) - 1)
    const statement = () => sqlite.prepare(sql.replace(/\?\d+/g, '?'))
    const bindings = () => (numbered.length ? numbered.map((index) => values[index]) : values) as SQLInputValue[]
    const stage = /^\s*select\b/i.test(sql) ? 'query' : 'run'
    function execute<T>(operation: () => T): T {
      hooks.before?.(stage, sql)
      const result = operation()
      hooks.after?.(stage, sql)
      return result
    }
    function result<T>(results: T[], changes = 0): D1Result<T> {
      return {
        results, success: true,
        meta: { changes, duration: 0, size_after: 0, rows_read: results.length, rows_written: changes, last_row_id: 0, changed_db: changes > 0 },
      }
    }
    async function raw<T = unknown[]>(options: { columnNames: true }): Promise<[string[], ...T[]]>
    async function raw<T = unknown[]>(options?: { columnNames?: false }): Promise<T[]>
    async function raw<T = unknown[]>(options?: { columnNames?: boolean }): Promise<T[] | [string[], ...T[]]> {
      return execute(() => {
        const query = statement()
        const rows = query.all(...bindings()).map(Object.values) as T[]
        return options?.columnNames ? [query.columns().map((column) => column.name), ...rows] : rows
      })
    }
    return {
      bind: (...next) => { hooks.before?.('bind', sql); return prepare(sql, next) },
      async first<T>(column?: string) {
        return execute(() => {
          const row = statement().get(...bindings())
          return (row === undefined ? null : column ? row[column] : row) as T | null
        })
      },
      async all<T>() { return execute(() => result(statement().all(...bindings()) as T[])) },
      raw,
      async run<T>() {
        return execute(() => result<T>([], Number(statement().run(...bindings()).changes)))
      },
    }
  }
  async function batch<T>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]> {
    sqlite.exec('BEGIN')
    try {
      const results = []
      for (const statement of statements) results.push(await statement.all<T>())
      sqlite.exec('COMMIT')
      return results
    } catch (error) { sqlite.exec('ROLLBACK'); throw error }
  }
  const db: D1Database = {
    prepare, batch,
    async exec(sql) { sqlite.exec(sql); return { count: 1, duration: 0 } },
    withSession() { return { prepare, batch, getBookmark: () => null } },
    async dump() { throw new Error('D1 dump is not used by the application') },
  }
  return { db, sqlite, close: () => sqlite.close() }
}
