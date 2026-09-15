import { RuleViolation } from "../../../shared-kernel/rule-violation";

export const MIN_USERNAME_BYTES = 3
export const MAX_USERNAME_BYTES = 32
export const MIN_PASSWORD_BYTES = 8
export const MAX_PASSWORD_BYTES = 256

/**
 * Validate the username rules owned by Account & Access.
 *
 * The username contract measures UTF-8 bytes, then accepts
 * only ASCII alphanumeric characters and `_`. The character check makes the
 * byte/code-unit distinction immaterial for valid values, but keep the byte
 * check explicit so invalid Unicode input cannot accidentally pass.
 */
export function validateUsername(value: string): void {
  const bytes = new TextEncoder().encode(value).byteLength
  if (bytes < MIN_USERNAME_BYTES || bytes > MAX_USERNAME_BYTES) {
    throw new RuleViolation(
      'username_invalid',
      `username must be ${MIN_USERNAME_BYTES}..${MAX_USERNAME_BYTES} characters`,
    )
  }
  if (!/^[A-Za-z0-9_]+$/.test(value)) {
    throw new RuleViolation(
      'username_invalid',
      'username must be ASCII alphanumeric or underscore',
    )
  }
}

/** Validate registration-only password length constraints. */
export function validatePassword(value: string): void {
  const bytes = new TextEncoder().encode(value).byteLength
  if (bytes < MIN_PASSWORD_BYTES) {
    throw new RuleViolation(
      'password_too_short',
      `password must be at least ${MIN_PASSWORD_BYTES} characters`,
    )
  }
  if (bytes > MAX_PASSWORD_BYTES) {
    throw new RuleViolation(
      'password_too_long',
      `password must be at most ${MAX_PASSWORD_BYTES} characters`,
    )
  }
}
