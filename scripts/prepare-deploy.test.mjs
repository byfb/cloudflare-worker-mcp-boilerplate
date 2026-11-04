import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { parse } from 'jsonc-parser'
import { prepareDeployment } from './prepare-deploy.mjs'

const source = readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8')
const env = {
  CLOUDFLARE_ACCOUNT_ID: '0123456789abcdef0123456789abcdef',
  CLOUDFLARE_WORKER_NAME: 'example-worker',
  CLOUDFLARE_D1_DATABASE_ID: '11111111-2222-3333-4444-555555555555',
  CLOUDFLARE_API_TOKEN: 'synthetic-deployment-token',
  JWT_SECRET: 'synthetic-worker-secret-at-least-32-bytes',
}

test('injects deployment identifiers while preserving the template and relative paths', () => {
  const template = parse(source)
  const { config, secrets } = prepareDeployment(source, env)

  assert.equal(config.name, env.CLOUDFLARE_WORKER_NAME)
  assert.equal(config.account_id, env.CLOUDFLARE_ACCOUNT_ID)
  assert.deepEqual(config.d1_databases, template.d1_databases.map((database) => (
    database.binding === 'DB' ? { ...database, database_id: env.CLOUDFLARE_D1_DATABASE_ID } : database
  )))
  assert.equal(config.main, template.main)
  assert.deepEqual(config.assets, template.assets)
  assert.equal(parse(source).d1_databases[0].database_id, '00000000-0000-0000-0000-000000000000')
  assert.deepEqual(secrets, { JWT_SECRET: env.JWT_SECRET })
  assert.ok(!JSON.stringify(config).includes(env.JWT_SECRET))
  assert.ok(!JSON.stringify({ config, secrets }).includes(env.CLOUDFLARE_API_TOKEN))
})

test('keeps routing, Access settings, and other bindings while overriding the database name', () => {
  const template = parse(source)
  template.vars = { APP_ORIGIN: 'https://app.example.com', ACCESS_BROWSER_AUDIENCE: 'app-audience' }
  template.routes = [{ pattern: 'app.example.com', custom_domain: true }]
  template.workers_dev = false
  template.preview_urls = false
  template.d1_databases.push({ binding: 'OTHER', database_name: 'other-db', database_id: '22222222-2222-2222-2222-222222222222' })
  const { config } = prepareDeployment(JSON.stringify(template), { ...env, CLOUDFLARE_D1_DATABASE_NAME: 'example-db' })

  assert.deepEqual(config.vars, template.vars)
  assert.deepEqual(config.routes, template.routes)
  assert.equal(config.workers_dev, false)
  assert.equal(config.preview_urls, false)
  assert.equal(config.d1_databases[0].database_name, 'example-db')
  assert.deepEqual(config.d1_databases[1], template.d1_databases[1])
})

test('accepts JSONC comments and trailing commas', () => {
  const { config } = prepareDeployment('/* template */ { "d1_databases": [{ "binding": "DB", }], }', env)
  assert.equal(config.d1_databases[0].database_id, env.CLOUDFLARE_D1_DATABASE_ID)
})

test('rejects missing deployment inputs without disclosing configured values', () => {
  for (const name of Object.keys(env)) {
    assert.throws(() => prepareDeployment(source, { ...env, [name]: '' }), (error) => {
      assert.ok(error.message.includes(name))
      assert.ok(!error.message.includes(env.CLOUDFLARE_API_TOKEN))
      assert.ok(!error.message.includes(env.JWT_SECRET))
      return true
    })
  }
})

test('rejects placeholder IDs, invalid IDs, and short secrets before deployment', () => {
  for (const override of [
    { CLOUDFLARE_D1_DATABASE_ID: '00000000-0000-0000-0000-000000000000' },
    { CLOUDFLARE_D1_DATABASE_ID: 'not-a-database-id' },
    { CLOUDFLARE_ACCOUNT_ID: 'not-an-account-id' },
    { JWT_SECRET: 'too-short' },
  ]) {
    assert.throws(() => prepareDeployment(source, { ...env, ...override }))
  }
})

test('rejects malformed configuration, ambiguous DB bindings, and plaintext JWT secrets', () => {
  for (const invalid of [
    '{ broken json',
    'null',
    '[]',
    '{}',
    '{ "d1_databases": {} }',
    '{ "d1_databases": [null] }',
    '{ "d1_databases": [{ "binding": "OTHER" }] }',
    '{ "d1_databases": [{ "binding": "DB" }, { "binding": "DB" }] }',
    '{ "d1_databases": [{ "binding": "DB" }], "vars": { "JWT_SECRET": "plaintext" } }',
  ]) {
    assert.throws(() => prepareDeployment(invalid, env))
  }
})
