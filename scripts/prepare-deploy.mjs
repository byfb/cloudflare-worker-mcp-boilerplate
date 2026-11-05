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

export function validateDeploymentCredentials(env) {
  const accountId = required(env, 'CLOUDFLARE_ACCOUNT_ID')
  if (!/^[a-f0-9]{32}$/i.test(accountId)) {
    throw new Error('CLOUDFLARE_ACCOUNT_ID must be a 32-character hexadecimal account ID.')
  }
  required(env, 'CLOUDFLARE_WORKER_NAME')
  required(env, 'CLOUDFLARE_API_TOKEN')
  const jwtSecret = required(env, 'JWT_SECRET')
  if (Buffer.byteLength(jwtSecret, 'utf8') < 32) {
    throw new Error('JWT_SECRET must contain at least 32 bytes.')
  }
}

function applyInfrastructure(config, env, infrastructure) {
  if (!infrastructure || infrastructure.schema_version !== 1) {
    throw new Error('Expected Terraform deployment output with schema_version 1.')
  }
  if (infrastructure.account_id !== env.CLOUDFLARE_ACCOUNT_ID
    || infrastructure.worker_name !== env.CLOUDFLARE_WORKER_NAME) {
    throw new Error('Terraform output does not match the target Cloudflare account and Worker.')
  }
  const hostnames = ['app_hostname', 'mcp_hostname'].map((key) => {
    const value = required(infrastructure, key)
    if (value.length > 253 || !/^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(value)) {
      throw new Error(`Terraform ${key} must be a DNS hostname without a scheme, port or path.`)
    }
    return value
  })
  const teamDomain = required(infrastructure, 'access_team_domain')
  if (!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.cloudflareaccess\.com$/.test(teamDomain)) {
    throw new Error('Terraform access_team_domain must be a Cloudflare Access team domain.')
  }
  for (const key of ['browser_audience', 'mcp_audience']) {
    if (!/^[a-f0-9]{64}$/i.test(required(infrastructure, key))) {
      throw new Error(`Terraform ${key} must be a Cloudflare Access audience.`)
    }
  }
  config.routes = [...new Set(hostnames)].map((pattern) => ({ pattern, custom_domain: true }))
  config.workers_dev = false
  config.preview_urls = false
  config.vars = {
    ...config.vars,
    APP_ORIGIN: `https://${hostnames[0]}`,
    ACCESS_ISSUER: `https://${teamDomain}`,
    ACCESS_JWKS_URL: `https://${teamDomain}/cdn-cgi/access/certs`,
    ACCESS_BROWSER_AUDIENCE: infrastructure.browser_audience,
  }
  // Remove stale overrides when moving back to the shared defaults.
  delete config.vars.MCP_ORIGIN
  delete config.vars.ACCESS_MCP_AUDIENCE
  if (hostnames[1] !== hostnames[0]) config.vars.MCP_ORIGIN = `https://${hostnames[1]}`
  if (infrastructure.mcp_audience !== infrastructure.browser_audience) {
    config.vars.ACCESS_MCP_AUDIENCE = infrastructure.mcp_audience
  }
  return {
    ...env,
    CLOUDFLARE_D1_DATABASE_ID: required(infrastructure, 'database_id'),
    CLOUDFLARE_D1_DATABASE_NAME: required(infrastructure, 'database_name'),
  }
}

export function prepareDeployment(source, env, infrastructure) {
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
  if (config.vars !== undefined && (!config.vars || typeof config.vars !== 'object' || Array.isArray(config.vars))) {
    throw new Error('Wrangler vars must be a configuration object.')
  }
  validateDeploymentCredentials(env)
  if (infrastructure !== undefined) env = applyInfrastructure(config, env, infrastructure)
  const databaseId = required(env, 'CLOUDFLARE_D1_DATABASE_ID')
  if (!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(databaseId)
    || databaseId === '00000000-0000-0000-0000-000000000000') {
    throw new Error('CLOUDFLARE_D1_DATABASE_ID must be a non-placeholder database UUID.')
  }

  config.name = required(env, 'CLOUDFLARE_WORKER_NAME')
  config.account_id = env.CLOUDFLARE_ACCOUNT_ID
  databases[0].database_id = databaseId
  if (env.CLOUDFLARE_D1_DATABASE_NAME) {
    databases[0].database_name = required(env, 'CLOUDFLARE_D1_DATABASE_NAME')
  }
  return { config, secrets: { JWT_SECRET: env.JWT_SECRET } }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  try {
    if (process.argv.includes('--check-credentials')) {
      validateDeploymentCredentials(process.env)
      console.log('Deployment credentials are configured.')
    } else {
      const root = new URL('../', import.meta.url)
      const tempDirectory = required(process.env, 'RUNNER_TEMP')
      const infrastructure = process.env.CLOUDFLARE_INFRASTRUCTURE_OUTPUT
        ? JSON.parse(readFileSync(process.env.CLOUDFLARE_INFRASTRUCTURE_OUTPUT, 'utf8'))
        : undefined
      const prepared = prepareDeployment(readFileSync(new URL('wrangler.jsonc', root), 'utf8'), process.env, infrastructure)
      writeFileSync(new URL('wrangler.deploy.json', root), JSON.stringify(prepared.config, null, 2) + '\n', { mode: 0o600 })
      writeFileSync(join(tempDirectory, 'cloudflare-worker-secrets.json'), JSON.stringify(prepared.secrets) + '\n', { mode: 0o600 })
      console.log('Prepared deployment configuration and Worker secrets.')
    }
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
