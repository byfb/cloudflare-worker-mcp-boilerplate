/** Session-cookie policy shared by authentication handlers and middleware. */

export const SESSION_COOKIE_NAME = 'session'
export const JWT_TTL_SECONDS = 7 * 24 * 60 * 60

/**
 * Build the exact established Set-Cookie value.
 *
 * Attribute order is part of the compatibility surface: clients and golden
 * tests have historically compared this value as a string.
 */
export function buildSetCookie(jwt: string): string {
  return `${SESSION_COOKIE_NAME}=${jwt}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${JWT_TTL_SECONDS}`
}

/** Build the exact established cookie-clearing value. */
export function buildClearCookie(): string {
  return `${SESSION_COOKIE_NAME}=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0`
}

/**
 * Extract the first exact `name=` pair from a Cookie header.
 *
 * The cookie contract splits only on semicolons, removes leading whitespace, and does not
 * trim the value's trailing whitespace. Keep those details intentionally.
 */
export function extractCookie(header: string, name = SESSION_COOKIE_NAME): string | undefined {
  const prefix = `${name}=`
  for (const part of header.split(';')) {
    const trimmed = part.trimStart()
    if (trimmed.startsWith(prefix)) return trimmed.slice(prefix.length)
  }
  return undefined
}

// snake_case aliases retain compatibility with existing imports.
export const build_set_cookie = buildSetCookie
export const build_clear_cookie = buildClearCookie
export const extract_cookie = extractCookie
