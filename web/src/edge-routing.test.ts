import { describe, expect, it } from 'vitest'
import { isEdgePath } from './edge-routing'

describe('PWA navigation policy', () => {
  it('keeps account, protocol, discovery, and provider requests network-only', () => {
    for (const path of ['/api', '/api/auth/me', '/mcp', '/mcp/unknown', '/.well-known/oauth-protected-resource', '/cdn-cgi/access/login']) expect(isEdgePath(path)).toBe(true)
    for (const path of ['/', '/account', '/login', '/register']) expect(isEdgePath(path)).toBe(false)
  })
})
