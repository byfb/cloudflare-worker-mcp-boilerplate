import type { Claims } from '../../../platform/auth/jwt'
import type { NewUser, UserRow } from '../domain/models'

export interface AccountRepository {
  insertUser(user: NewUser): Promise<void>
  findUserByUsername(username: string): Promise<UserRow | null>
  findUserById(id: string): Promise<UserRow | null>
}
export interface PasswordPort {
  hash(password: string, salt?: Uint8Array): Promise<string>
  verify(password: string, storedHash: string): Promise<boolean>
}
export interface SessionIssuer {
  issue(userId: string, csrf: string, nowSeconds: number, secret: string): Promise<string>
}
export interface SessionReader<E> {
  requireSession(request: Request, env: E, nowSeconds?: number): Promise<Claims>
  requireCsrf(request: Request, claims: Claims): void
}
