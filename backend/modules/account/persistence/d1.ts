import { ApiError } from '../../../platform/http/api-error'
import { D1Executor, type D1Database } from '../../../platform/d1'
import type { AccountRepository } from '../application/ports'
import type { NewUser, UserRow } from '../domain/models'
import { INSERT_USER_SQL, SELECT_USER_BY_ID_SQL, SELECT_USER_BY_USERNAME_SQL } from './sql'

export class D1AccountRepository implements AccountRepository {
  private readonly executor: D1Executor
  constructor(db: D1Database) { this.executor = new D1Executor(db) }

  async insertUser(user: NewUser): Promise<void> {
    try {
      await this.executor.statement(INSERT_USER_SQL, [user.id, user.username, user.password_hash]).run()
    } catch (error) {
      const message = error instanceof Error ? error.message : ''
      if (message.includes('UNIQUE constraint failed: users.username')) {
        throw ApiError.conflict('username_taken', 'username already taken')
      }
      throw ApiError.internal('d1_insert_failed', 'could not create account')
    }
  }
  findUserByUsername(username: string): Promise<UserRow | null> {
    return this.executor.first<UserRow>(SELECT_USER_BY_USERNAME_SQL, [username])
  }
  findUserById(id: string): Promise<UserRow | null> {
    return this.executor.first<UserRow>(SELECT_USER_BY_ID_SQL, [id])
  }
}
