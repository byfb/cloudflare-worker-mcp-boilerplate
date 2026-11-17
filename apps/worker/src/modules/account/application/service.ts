import { encodeJwt, newClaims } from '../../../platform/auth/jwt'
import { ApiError } from '../../../platform/http/api-error'
import { basicProfile, publicUser, type LoginInput, type LoginResult, type RegisterInput,
  type RegisterResult, type SessionUser } from '../domain/models'
import { validatePassword, validateUsername } from '../domain/validation'
import type { AccountRepository, PasswordPort, SessionIssuer } from './ports'

export interface AccountClock { nowMs(): number }
export interface AccountIds { ulid(): string; salt(): Uint8Array; token(): string }
export interface AccountApplicationDependencies {
  repository: AccountRepository
  password: PasswordPort
  ids: AccountIds
  clock: AccountClock
  sessions?: SessionIssuer
}
export type RegisterPlan = RegisterResult
export type LoginPlan = LoginResult

export class PlatformSessionIssuer implements SessionIssuer {
  issue(userId: string, csrf: string, now: number, secret: string): Promise<string> {
    return encodeJwt(secret, newClaims(userId, csrf, now))
  }
}

export class AccountApplication {
  private readonly sessions: SessionIssuer
  constructor(private readonly deps: AccountApplicationDependencies) {
    this.sessions = deps.sessions ?? new PlatformSessionIssuer()
  }

  async register(input: RegisterInput, secret: string): Promise<RegisterPlan> {
    validateUsername(input.username)
    validatePassword(input.password)
    const user = {
      id: this.deps.ids.ulid(),
      username: input.username,
      password_hash: await this.deps.password.hash(input.password, this.deps.ids.salt()),
    }
    const session = await this.issueSession(user.id, secret)
    await this.deps.repository.insertUser(user)
    return { ...publicUser(user), ...session }
  }

  async login(input: LoginInput, secret: string): Promise<LoginPlan> {
    validateUsername(input.username)
    validatePassword(input.password)
    const user = await this.deps.repository.findUserByUsername(input.username)
    if (!user || !await this.deps.password.verify(input.password, user.password_hash)) {
      throw ApiError.unauthorized('invalid_credentials', 'invalid credentials')
    }
    return { ...publicUser(user), ...await this.issueSession(user.id, secret) }
  }

  async me(claims: { sub: string; csrf: string }): Promise<SessionUser> {
    return { ...publicUser(await this.requireUser(claims.sub)), csrf: claims.csrf }
  }

  async getBasicProfile(userId: string) {
    return basicProfile(await this.requireUser(userId))
  }

  private async requireUser(userId: string) {
    const user = await this.deps.repository.findUserById(userId)
    if (!user) throw ApiError.unauthorized('unauthenticated', 'account unavailable')
    return user
  }

  private async issueSession(userId: string, secret: string) {
    const csrf = this.deps.ids.token()
    const jwt = await this.sessions.issue(userId, csrf, Math.floor(this.deps.clock.nowMs() / 1000), secret)
    return { csrf, jwt }
  }
}
