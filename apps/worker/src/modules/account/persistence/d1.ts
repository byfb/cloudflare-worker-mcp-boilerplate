import { eq } from 'drizzle-orm'
import { ApiError } from '../../../platform/http/api-error'
import { createDatabase, executeD1, type Database, type D1Database } from '../../../platform/d1'
import type { AccountRepository } from '../application/ports'
import type { NewUser, UserRow } from '../domain/models'
import { users } from './schema'

const userColumns = { id: users.id, username: users.username, password_hash: users.password_hash }

export class D1AccountRepository implements AccountRepository {
  private readonly db: Database
  constructor(binding: D1Database) { this.db = createDatabase(binding) }

  async insertUser(user: NewUser): Promise<void> {
    try {
      await executeD1('run', () => this.db.insert(users).values(user).run())
    } catch (error) {
      const message = error instanceof Error ? error.message : ''
      if (message.includes('UNIQUE constraint failed: users.username')) {
        throw ApiError.conflict('username_taken', 'username already taken')
      }
      throw ApiError.internal('d1_insert_failed', 'could not create account')
    }
  }

  async findUserByUsername(username: string): Promise<UserRow | null> {
    return (await executeD1('query', () => this.db.select(userColumns).from(users)
      .where(eq(users.username, username)).get())) ?? null
  }

  async findUserById(id: string): Promise<UserRow | null> {
    return (await executeD1('query', () => this.db.select(userColumns).from(users)
      .where(eq(users.id, id)).get())) ?? null
  }
}
