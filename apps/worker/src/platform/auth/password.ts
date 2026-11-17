import { argon2idAsync } from '@noble/hashes/argon2.js'
const base64 = {
  encode: (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)),
  decode: (text: string) => Uint8Array.from(atob(text), (char) => char.charCodeAt(0)),
}
import { timingSafeEqual } from './csrf'

export const ARGON2_SALT_LENGTH = 16
const parameters = { t: 2, m: 19456, p: 1, dkLen: 32 }
const prefix = '$argon2id$v=19$m=19456,t=2,p=1$'

export async function hashPassword(password: string, options: { salt?: Uint8Array } = {}): Promise<string> {
  const salt = options.salt ?? crypto.getRandomValues(new Uint8Array(ARGON2_SALT_LENGTH))
  if (salt.length !== ARGON2_SALT_LENGTH) throw new Error('invalid password salt')
  const digest = await argon2idAsync(password, salt, parameters)
  return `${prefix}${base64.encode(salt)}$${base64.encode(digest)}`
}

export async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  // Only hashes issued by this version are accepted; runtime costs stay bounded.
  if (!storedHash.startsWith(prefix)) return false
  const parts = storedHash.slice(prefix.length).split('$')
  if (parts.length !== 2) return false
  try {
    const salt = base64.decode(parts[0])
    const expected = base64.decode(parts[1])
    if (salt.length !== ARGON2_SALT_LENGTH || expected.length !== parameters.dkLen) return false
    return timingSafeEqual(await argon2idAsync(password, salt, parameters), expected)
  } catch { return false }
}
