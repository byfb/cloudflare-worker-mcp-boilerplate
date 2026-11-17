import {
  ARGON2_SALT_LENGTH,
  hashPassword,
  verifyPassword,
} from '../../../platform/auth/password'
import { SystemIdGenerator } from '../../../platform/runtime/ids'
import { SystemClock } from '../../../platform/runtime/clock'
import type { AccountIds, AccountClock } from './service'
import type { PasswordPort } from './ports'

/** Account adapter around platform Argon2id implementation. */
export class PlatformPasswordPort implements PasswordPort {
  hash(password: string, salt?: Uint8Array): Promise<string> {
    return hashPassword(password, salt === undefined ? undefined : { salt })
  }

  verify(password: string, storedHash: string): Promise<boolean> {
    return verifyPassword(password, storedHash)
  }
}

export class PlatformAccountIds implements AccountIds {
  constructor(private readonly generator = new SystemIdGenerator()) {}

  ulid(): string {
    return this.generator.ulid()
  }

  salt(): Uint8Array {
    // SystemIdGenerator already exposes the same 16-byte CSPRNG draw used
    // by the established token generator. Decode that draw so
    // ULID -> salt -> CSRF consumes one shared deterministic stream.
    const encoded = this.generator.token()
    const salt = new Uint8Array(ARGON2_SALT_LENGTH)
    for (let index = 0; index < salt.length; index += 1) {
      salt[index] = Number.parseInt(encoded.slice(index * 2, index * 2 + 2), 16)
    }
    return salt
  }

  token(): string {
    return this.generator.token()
  }
}

export class PlatformAccountClock implements AccountClock {
  constructor(private readonly clock = new SystemClock()) {}

  nowMs(): number {
    return this.clock.nowMs()
  }
}
