import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { parse } from 'jsonc-parser'

function required(env, name) {
  const value = env[name]
  if (typeof value !== 'string' || !value.trim() || value !== value.trim()) {
    throw new Error(`Set ${name} before deploying.`)
  }
  return value
}

export function prepareDeployment(source, env) {
  const errors = []
  const config = parse(source, errors, { allowTrailingComma: true })
  if (errors.length || !config || typeof config !== 'object' || Array.isArray(config)) {
    throw new Error('wrangler.jsonc must contain a valid configuration object.')
  }
  const databases = Array.isArray(config.d1_databases)
    ? config.d1_databases.filter((database) => database?.binding === 'DB')
    : []
  if (databases.length !== 1) {
    throw new Error('wrangler.jsonc must contain exactly one D1 binding named DB.')
  }
  if (Object.hasOwn(config.vars ?? {}, 'JWT_SECRET')) {
    throw new Error('Configure JWT_SECRET as a deployment secret, not a Wrangler var.')
  }

  const accountId = required(env, 'CLOUDFLARE_ACCOUNT_ID')
  if (!/^[a-f0-9]{32}$/i.test(accountId)) {
    throw new Error('CLOUDFLARE_ACCOUNT_ID must be a 32-character hexadecimal account ID.')
  }
  const databaseId = required(env, 'CLOUDFLARE_D1_DATABASE_ID')
  if (!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(databaseId)
    || databaseId === '00000000-0000-0000-0000-000000000000') {
    throw new Error('CLOUDFLARE_D1_DATABASE_ID must be a non-placeholder database UUID.')
  }
  required(env, 'CLOUDFLARE_API_TOKEN')
  const jwtSecret = required(env, 'JWT_SECRET')
  if (Buffer.byteLength(jwtSecret, 'utf8') < 32) {
    throw new Error('JWT_SECRET must contain at least 32 bytes.')
  }

  config.name = required(env, 'CLOUDFLARE_WORKER_NAME')
  config.account_id = accountId
  databases[0].database_id = databaseId
  if (env.CLOUDFLARE_D1_DATABASE_NAME) {
    databases[0].database_name = required(env, 'CLOUDFLARE_D1_DATABASE_NAME')
  }
  return { config, secrets: { JWT_SECRET: jwtSecret } }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  try {
    const root = new URL('../', import.meta.url)
    const tempDirectory = required(process.env, 'RUNNER_TEMP')
    const prepared = prepareDeployment(readFileSync(new URL('wrangler.jsonc', root), 'utf8'), process.env)
    writeFileSync(new URL('wrangler.deploy.json', root), JSON.stringify(prepared.config, null, 2) + '\n', { mode: 0o600 })
    writeFileSync(join(tempDirectory, 'cloudflare-worker-secrets.json'), JSON.stringify(prepared.secrets) + '\n', { mode: 0o600 })
    console.log('Prepared deployment configuration and Worker secrets.')
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
