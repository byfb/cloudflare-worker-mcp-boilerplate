import { describe, expect, it } from 'vitest'

import { buildClearCookie, buildSetCookie, extractCookie } from './cookie'

describe('session cookie parity', () => {
  it('emits exact set and clear values', () => {
    expect(buildSetCookie('abc.def.ghi')).toBe(
      'session=abc.def.ghi; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=604800',
    )
    expect(buildClearCookie()).toBe(
      'session=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0',
    )
  })

  it('splits semicolons, trims only leading spaces, and returns first exact pair', () => {
    expect(extractCookie('foo=1; session=abc.def.ghi; bar=2')).toBe('abc.def.ghi')
    expect(extractCookie('session=first; session=second')).toBe('first')
    expect(extractCookie('xsession=no; session=token ')).toBe('token ')
    expect(extractCookie('not-session=1;  session=')).toBe('')
    expect(extractCookie('sessionized=wrong')).toBeUndefined()
  })
})
