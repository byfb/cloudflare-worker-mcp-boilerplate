import { appendFileSync, readFileSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { spawnSync } from 'node:child_process'

export const approvalEnvironment = 'production-infrastructure'
const maxPlanAge = 24 * 60 * 60 * 1000

function required(env, name) {
  const value = env[name]
  if (typeof value !== 'string' || !value.trim() || value !== value.trim()) {
    throw new Error(`Set ${name} before running the Terraform workflow.`)
  }
  return value
}

function execute(command, args, { capture, env }) {
  const result = spawnSync(command, args, {
    env,
    encoding: 'utf8',
    stdio: capture ? 'pipe' : 'inherit',
    maxBuffer: 16 * 1024 * 1024,
  })
  if (result.error || result.signal) throw new Error(`Could not complete ${command}.`)
  return result
}

function backend(env) {
  const accountId = required(env, 'TF_VAR_account_id')
  if (!/^[a-f0-9]{32}$/i.test(accountId)) throw new Error('Invalid Cloudflare account ID.')
  const bucket = required(env, 'TF_STATE_BUCKET')
  if (!/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(bucket)) throw new Error('Invalid R2 state bucket name.')
  required(env, 'AWS_ACCESS_KEY_ID')
  required(env, 'AWS_SECRET_ACCESS_KEY')
  return { accountId, bucket, endpoint: `https://${accountId}.r2.cloudflarestorage.com` }
}

function planPrefix(env) {
  const repository = required(env, 'GITHUB_REPOSITORY')
  const runId = required(env, 'GITHUB_RUN_ID')
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository) || !/^\d+$/.test(runId)) {
    throw new Error('Invalid GitHub workflow identity.')
  }
  return `terraform-plans/${repository}/${runId}/`
}

function savedPlanKey(env) {
  const key = required(env, 'TF_PLAN_KEY')
  const prefix = planPrefix(env)
  if (!key.startsWith(prefix) || !/^\d+\.tfplan$/.test(key.slice(prefix.length))) {
    throw new Error('The saved plan must belong to this repository and workflow run.')
  }
  return key
}

function digest(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

export function assertRequiredReviewers(environment) {
  const rule = environment?.protection_rules?.find((entry) => entry.type === 'required_reviewers')
  if (!rule?.reviewers?.some((entry) => ['User', 'Team'].includes(entry.type) && entry.reviewer?.id)) {
    throw new Error(`Configure required reviewers on the ${approvalEnvironment} GitHub environment. Refusing to apply without an approval gate.`)
  }
}

export async function runTerraformWorkflow(mode, env, options = {}) {
  const run = options.execute ?? execute
  const now = options.now ?? Date.now
  const childEnv = {
    ...env,
    TF_IN_AUTOMATION: 'true',
    TF_INPUT: 'false',
    AWS_EC2_METADATA_DISABLED: 'true',
    AWS_REQUEST_CHECKSUM_CALCULATION: 'when_required',
    AWS_RESPONSE_CHECKSUM_VALIDATION: 'when_required',
  }
  function command(binary, args, capture = false, allowedStatuses = [0]) {
    const result = run(binary, args, { capture, env: childEnv })
    if (!allowedStatuses.includes(result.status)) {
      throw new Error(`${binary} failed with exit code ${result.status}.`)
    }
    return result
  }
  const terraform = (args, capture = false, allowedStatuses = [0]) => (
    command('terraform', ['-chdir=infra/cloudflare', ...args], capture, allowedStatuses)
  )

  if (mode === 'check-approval') {
    const repository = required(env, 'GITHUB_REPOSITORY')
    const api = required(env, 'GITHUB_API_URL').replace(/\/$/, '')
    const response = await (options.fetch ?? fetch)(`${api}/repos/${repository}/environments/${approvalEnvironment}`, {
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${required(env, 'GITHUB_TOKEN')}`,
        'X-GitHub-Api-Version': '2022-11-28',
      },
      signal: AbortSignal.timeout(10000),
    })
    if (!response.ok) throw new Error(`Could not verify the approval environment (HTTP ${response.status}).`)
    assertRequiredReviewers(await response.json())
    return
  }

  const { accountId, bucket, endpoint } = backend(env)
  const aws = (args) => command('aws', ['--endpoint-url', endpoint, '--region', 'auto', 's3', ...args, '--only-show-errors'])
  if (mode === 'cleanup') {
    aws(['rm', `s3://${bucket}/${savedPlanKey(env)}`])
    return
  }
  if (!['plan', 'deploy'].includes(mode)) throw new Error('Expected plan, deploy, cleanup or check-approval.')

  const stateKey = required(env, 'TF_STATE_KEY')
  const directory = required(env, 'RUNNER_TEMP')
  const planPath = join(directory, 'cloudflare.tfplan')
  required(env, 'CLOUDFLARE_API_TOKEN')
  terraform(['init', '-input=false', '-lockfile=readonly',
    `-backend-config=bucket=${bucket}`,
    `-backend-config=key=${stateKey}`,
    `-backend-config=endpoints={s3="${endpoint}"}`,
  ])

  if (mode === 'plan') {
    const revision = required(env, 'GITHUB_SHA')
    if (!/^[a-f0-9]{40}$/.test(revision)) throw new Error('Invalid workflow commit SHA.')
    const attempt = required(env, 'GITHUB_RUN_ATTEMPT')
    if (!/^\d+$/.test(attempt)) throw new Error('Invalid workflow attempt.')
    const result = terraform(['plan', '-input=false', '-detailed-exitcode', '-lock-timeout=5m', `-out=${planPath}`], false, [0, 2])
    const hasChanges = result.status === 2
    const checksum = digest(readFileSync(planPath))
    const text = terraform(['show', '-no-color', planPath], true).stdout
    if (Buffer.byteLength(text, 'utf8') > 900000) throw new Error('Terraform plan exceeds the review summary limit. Split the infrastructure changes.')
    const fence = '`'.repeat(Math.max(3, ...[...text.matchAll(/`+/g)].map((match) => match[0].length + 1)))
    appendFileSync(required(env, 'GITHUB_STEP_SUMMARY'), [
      '# Terraform plan', '',
      hasChanges ? 'Infrastructure changes require manual approval before apply.' : 'No infrastructure changes. Terraform apply and its approval gate will be skipped.',
      ...(env.TF_PLAN_ONLY === 'true' ? ['Plan-only run: no apply or deployment will follow.'] : []),
      '', `Commit: ${revision}`, `Plan SHA-256: ${checksum}`, '',
      `${fence}text`, text, fence, '',
    ].join('\n'))
    let key = ''
    if (hasChanges && env.TF_PLAN_ONLY !== 'true') {
      key = `${planPrefix(env)}${attempt}.tfplan`
      aws(['cp', planPath, `s3://${bucket}/${key}`])
    }
    const outputs = {
      has_changes: String(hasChanges),
      plan_key: key,
      plan_sha256: checksum,
      plan_created_at: String(now()),
      account_id: accountId,
      state_bucket: bucket,
      state_key: stateKey,
    }
    for (const value of Object.values(outputs)) {
      if (/[\r\n]/.test(value)) throw new Error('Workflow output contains an unexpected newline.')
    }
    appendFileSync(required(env, 'GITHUB_OUTPUT'), Object.entries(outputs).map(([key, value]) => `${key}=${value}\n`).join(''))
    return
  }

  if (!['true', 'false'].includes(env.TF_HAS_CHANGES)) throw new Error('Missing Terraform plan change status.')
  if (env.TF_HAS_CHANGES === 'true') {
    const createdAt = Number(required(env, 'TF_PLAN_CREATED_AT'))
    if (!Number.isFinite(createdAt) || createdAt > now() || now() - createdAt > maxPlanAge) {
      throw new Error('The approved plan has expired. Start a new workflow run to plan and review again.')
    }
    const checksum = required(env, 'TF_PLAN_SHA256')
    if (!/^[a-f0-9]{64}$/.test(checksum)) throw new Error('Invalid reviewed plan checksum.')
    aws(['cp', `s3://${bucket}/${savedPlanKey(env)}`, planPath])
    if (digest(readFileSync(planPath)) !== checksum) {
      throw new Error('Saved plan differs from the reviewed plan. Refusing to apply.')
    }
    // Apply only the reviewed binary plan. A stale state fails; never re-plan here.
    terraform(['apply', '-input=false', '-lock-timeout=5m', planPath])
  }
  const output = terraform(['output', '-json', 'deployment'], true).stdout
  writeFileSync(join(directory, 'cloudflare-infrastructure.json'), output, { mode: 0o600 })
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  process.umask(0o077)
  try {
    await runTerraformWorkflow(process.argv[2], process.env)
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
