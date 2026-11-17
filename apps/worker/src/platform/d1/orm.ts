import { drizzle, type DrizzleD1Database } from 'drizzle-orm/d1'
import { DrizzleQueryError } from 'drizzle-orm/errors'
import { ApiError } from '../http/api-error'
import { d1ApiError } from './errors'
import type { D1Database } from './types'

export type Database = DrizzleD1Database

/** Keep the platform schema-free; each module owns its typed tables. */
export function createDatabase(binding: D1Database): Database {
  // Drizzle prepares and binds internally. Preserve the existing bind error code
  // while returning native bound statements to the D1 driver.
  const client = new Proxy(binding, {
    get(target, property) {
      if (property === 'prepare') return (sql: string) => {
        try {
          return new Proxy(target.prepare(sql), {
            get(statement, method) {
              if (method === 'bind') return (...values: unknown[]) => {
                try { return statement.bind(...values) }
                catch (error) { throw d1ApiError('d1_bind_failed', error) }
              }
              const value = Reflect.get(statement, method)
              return typeof value === 'function' ? value.bind(statement) : value
            },
          })
        } catch (error) { throw d1ApiError('d1_bind_failed', error) }
      }
      const value = Reflect.get(target, property)
      return typeof value === 'function' ? value.bind(target) : value
    },
  })
  return drizzle(client, { logger: false })
}

/** Drizzle errors contain SQL and bound values; never expose that wrapper. */
export async function executeD1<T>(
  stage: 'query' | 'run',
  operation: () => PromiseLike<T>,
): Promise<T> {
  try { return await operation() }
  catch (error) {
    const cause = error instanceof DrizzleQueryError ? error.cause : error
    if (cause instanceof ApiError) throw cause
    throw d1ApiError(`d1_${stage}_failed`, cause)
  }
}
