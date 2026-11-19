import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { exportJWK, generateKeyPair, SignJWT, type JWK } from 'jose'
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import { handleWorkerRequest, type WorkerEnv } from '../src/app'
import { WorkerAccessRuntime } from '../src/app/access-runtime'
import { createAccessAssertionVerifier } from '../src/platform/auth/access'
import { createTestDatabase } from './sqlite-d1'

const origin = 'https://app.example.com'
const secret = 'test-secret-0123456789abcdef0123456789abcdef'
const issuer = 'https://team.cloudflareaccess.com'
const browserAudience = 'app-audience'
const now = 1_800_000_000
let database: ReturnType<typeof createTestDatabase>
let env: WorkerEnv
let access: WorkerAccessRuntime
let privateKey: CryptoKey
let publicJwk: JWK

beforeAll(async () => {
  const pair = await generateKeyPair('RS256', { extractable: true })
  privateKey = pair.privateKey
  publicJwk = { ...await exportJWK(pair.publicKey), kid: 'test-key', alg: 'RS256', use: 'sig' }
})

async function assertion(audience: string) {
  return new SignJWT({ email: 'member@example.com' })
    .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
    .setIssuer(issuer)
    .setSubject('test-subject')
    .setAudience(audience)
    .setIssuedAt(now - 60)
    .setExpirationTime(now + 300)
    .sign(privateKey)
}
function request(path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers)
  headers.set('Host', new URL(origin).host)
  return handleWorkerRequest(new Request(origin + path, { ...init, headers }), env, () => {}, { accessRuntime: access, mcpAudit: { record() {} } })
}
async function register(username = 'member') {
  const response = await request('/api/auth/register', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password: 'correct-horse-example' }),
  })
  expect(response.status).toBe(201)
  return { response, user: await response.json() as { user_id: string; username: string; csrf: string }, cookie: response.headers.get('Set-Cookie')!.split(';')[0] }
}
async function linkAccount({ user, cookie }: Awaited<ReturnType<typeof register>>, browserAssertion: string) {
  const headers = { Cookie: cookie, Origin: origin, 'X-CSRF-Token': user.csrf, 'Cf-Access-Jwt-Assertion': browserAssertion }
  expect((await request('/api/auth/access-link', { method: 'POST', headers })).status).toBe(200)
  return headers
}
beforeEach(() => {
  database = createTestDatabase()
  env = { DB: database.db, JWT_SECRET: secret, APP_ORIGIN: origin,
    ACCESS_ISSUER: issuer,
    ACCESS_JWKS_URL: `${issuer}/cdn-cgi/access/certs`,
    ACCESS_BROWSER_AUDIENCE: browserAudience }
  access = new WorkerAccessRuntime((config) => createAccessAssertionVerifier(config, {
    now: () => now,
    fetchJwks: async () => Response.json({ keys: [publicJwk] }),
  }))
})
afterEach(() => database.close())

describe('fresh application', () => {
  it('registers, persists, signs in, scopes profiles, and requires CSRF for logout', async () => {
    const { response, user, cookie } = await register()
    expect(Object.keys(user).sort()).toEqual(['csrf', 'user_id', 'username'])
    expect(response.headers.get('Set-Cookie')).toContain('HttpOnly; Secure; SameSite=Strict')
    expect(response.headers.get('Cache-Control')).toBe('no-store, private')
    const stored = database.sqlite.prepare('SELECT * FROM users').get()!
    expect(stored.password_hash).toMatch(/^\$argon2id\$/)
    expect(stored.password_hash).not.toContain('correct-horse-example')
    expect(await (await request('/api/profile', { headers: { Cookie: cookie } })).json()).toEqual({ username: 'member' })
    expect((await request('/api/profile')).status).toBe(401)
    expect((await request('/api/auth/logout', { method: 'POST', headers: { Cookie: cookie } })).status).toBe(403)
    const logout = await request('/api/auth/logout', { method: 'POST', headers: { Cookie: cookie, 'X-CSRF-Token': user.csrf } })
    expect(logout.status).toBe(204)
    expect(logout.headers.get('Set-Cookie')).toContain('Max-Age=0')
    const login = await request('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'member', password: 'correct-horse-example' }) })
    expect(login.status).toBe(200)
    expect(await login.json()).toMatchObject({ username: 'member', user_id: user.user_id })
    const wrongPassword = await request('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'member', password: 'incorrect-password' }) })
    expect(wrongPassword.status).toBe(401)
    const duplicate = await request('/api/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'member', password: 'another-password' }) })
    expect(duplicate.status).toBe(409)
  })

  it('rejects unknown fields and form submissions before creating an account', async () => {
    for (const [type, body] of [
      ['application/json', JSON.stringify({ username: 'member', password: 'password-example', user_id: 'chosen' })],
      ['text/plain', JSON.stringify({ username: 'member', password: 'password-example' })],
    ]) {
      expect((await request('/api/auth/register', { method: 'POST', headers: { 'Content-Type': type }, body })).status).toBe(400)
    }
    expect(database.sqlite.prepare('SELECT count(*) AS n FROM users').get()?.n).toBe(0)
  })

  it.each([
    { name: 'shared defaults', mcpAudience: undefined, mcpOrigin: undefined },
    { name: 'legacy initialize-only client', mcpAudience: undefined, mcpOrigin: undefined, legacy: true },
    { name: 'explicit shared settings', mcpAudience: browserAudience, mcpOrigin: origin },
    { name: 'separate audience', mcpAudience: 'mcp-audience', mcpOrigin: undefined },
    { name: 'separate origin', mcpAudience: undefined, mcpOrigin: 'https://mcp.example.com' },
    { name: 'separate audience and origin', mcpAudience: 'mcp-audience', mcpOrigin: 'https://mcp.example.com' },
  ])('links an identity, calls MCP, and enforces disconnect with $name', async ({ mcpAudience, mcpOrigin, legacy }) => {
    if (mcpAudience !== undefined) env.ACCESS_MCP_AUDIENCE = mcpAudience
    if (mcpOrigin !== undefined) env.MCP_ORIGIN = mcpOrigin
    const browserAssertion = await assertion(browserAudience)
    const mcpAssertion = await assertion(mcpAudience ?? browserAudience)
    const mcpUrl = new URL('/mcp', mcpOrigin ?? origin)
    const account = await register()
    const unlinked = await handleWorkerRequest(new Request(mcpUrl, {
      method: 'POST', headers: { Host: mcpUrl.host, 'Cf-Access-Jwt-Assertion': mcpAssertion },
    }), env, () => {}, { accessRuntime: access, mcpAudit: { record() {} } })
    expect(unlinked.status).toBe(403)
    expect(await unlinked.json()).toMatchObject({ code: 'access_identity_unlinked' })
    const { user, cookie } = account
    const headers = await linkAccount(account, browserAssertion)
    const client = new Client({ name: 'test-client', version: '1.0.0' }, { versionNegotiation: { mode: legacy ? 'legacy' : 'auto' } })
    const transport = new StreamableHTTPClientTransport(mcpUrl, {
      fetch: async (url, init) => {
        const req = new Request(url, init)
        req.headers.set('Host', mcpUrl.host)
        req.headers.set('Cf-Access-Jwt-Assertion', mcpAssertion)
        return handleWorkerRequest(req, env, () => {}, { accessRuntime: access, mcpAudit: { record() {} } })
      },
    })
    await client.connect(transport)
    try {
      expect((await client.listTools()).tools.map((tool) => tool.name)).toEqual(['exec'])
      const result = await client.callTool({ name: 'exec', arguments: { command: 'call get_user_profile {}' } })
      expect(result.isError).not.toBe(true)
      expect(result.structuredContent).toEqual({ username: 'member' })
      const clients = await (await request('/api/mcp-connections', { headers: { Cookie: cookie } })).json() as { connections: { client_key: string; tool_call_count: number }[] }
      expect(clients.connections).toHaveLength(legacy ? 2 : 1)
      const key = 'test-client'
      expect(clients.connections).toContainEqual(expect.objectContaining({
        client_key: legacy ? 'mcp:unreported' : key, tool_call_count: 1,
      }))
      const disconnected = await request('/api/mcp-connections', { method: 'PATCH', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ client_key: key, enabled: false }) })
      expect(disconnected.status).toBe(200)
      await expect(client.listTools()).rejects.toThrow(/mcp_connection_revoked/)
      const removed = await request('/api/mcp-connections', { method: 'DELETE', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ client_key: key }) })
      expect(removed.status).toBe(204)
    } finally { await client.close() }
    database.sqlite.prepare('DELETE FROM users WHERE id = ?').run(user.user_id)
    expect(database.sqlite.prepare('SELECT count(*) AS n FROM auth_identities').get()?.n).toBe(0)
  })

  it('lists the default tool on the 2026 protocol when the client omits its name', async () => {
    const token = await assertion(browserAudience)
    await linkAccount(await register(), token)
    const response = await request('/mcp', {
      method: 'POST',
      headers: {
        'Cf-Access-Jwt-Assertion': token, 'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream', 'Mcp-Method': 'tools/list',
        'Mcp-Protocol-Version': '2026-07-28',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: { _meta: {
        'io.modelcontextprotocol/protocolVersion': '2026-07-28',
        'io.modelcontextprotocol/clientCapabilities': {},
      } } }),
    })
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ result: { tools: [expect.objectContaining({ name: 'exec' })] } })
  })

  it.each([undefined, 'mcp-audience'])('rejects invalid MCP authentication before D1 with audience override %s', async (mcpAudience) => {
    if (mcpAudience !== undefined) env.ACCESS_MCP_AUDIENCE = mcpAudience
    const { cookie } = await register()
    const valid = await assertion(mcpAudience ?? browserAudience)
    const rejectedHeaders: HeadersInit[] = [
      {},
      { Cookie: cookie },
      { Authorization: `Bearer ${valid}` },
      { 'Cf-Access-Jwt-Assertion': await assertion('unrelated-audience') },
    ]
    if (mcpAudience !== undefined) {
      rejectedHeaders.push({ 'Cf-Access-Jwt-Assertion': await assertion(browserAudience) })
    }
    const prepare = vi.fn(() => { throw new Error('database must not be reached') })
    env.DB = Object.assign(database.db, { prepare })
    for (const headers of rejectedHeaders) {
      expect((await request('/mcp', { method: 'POST', headers })).status).toBe(401)
    }
    expect(prepare).not.toHaveBeenCalled()
  })

  it('keeps protocol paths out of static pages', async () => {
    for (const path of ['/mcp/', '/mcp-unknown', '/.well-known/oauth-protected-resource', '/api/missing']) {
      expect((await request(path)).status).toBe(404)
    }
  })
})
