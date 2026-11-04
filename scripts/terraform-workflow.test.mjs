import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { assertRequiredReviewers, runTerraformWorkflow } from './terraform-workflow.mjs'

const planBytes = Buffer.from('synthetic binary plan with private state')
const checksum = createHash('sha256').update(planBytes).digest('hex')
const timestamp = 1800000000000

function fixture(t, { planStatus = 2, downloadedPlan = planBytes, applyStatus = 0 } = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'terraform-workflow-test-'))
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  const env = {
    TF_VAR_account_id: '0123456789abcdef0123456789abcdef',
    TF_STATE_BUCKET: 'example-state',
    TF_STATE_KEY: 'example/worker/production.tfstate',
    AWS_ACCESS_KEY_ID: 'synthetic-r2-key',
    AWS_SECRET_ACCESS_KEY: 'synthetic-r2-secret',
    CLOUDFLARE_API_TOKEN: 'synthetic-provider-token',
    RUNNER_TEMP: directory,
    GITHUB_REPOSITORY: 'example/worker',
    GITHUB_RUN_ID: '42',
    GITHUB_RUN_ATTEMPT: '1',
    GITHUB_SHA: 'a'.repeat(40),
    GITHUB_OUTPUT: join(directory, 'outputs'),
    GITHUB_STEP_SUMMARY: join(directory, 'summary'),
    TF_PLAN_ONLY: 'false',
    TF_HAS_CHANGES: 'true',
    TF_PLAN_KEY: 'terraform-plans/example/worker/42/1.tfplan',
    TF_PLAN_SHA256: checksum,
    TF_PLAN_CREATED_AT: String(timestamp),
  }
  const calls = []
  const options = {
    now: () => timestamp + 1000,
    execute(binary, args) {
      calls.push({ binary, args })
      if (binary === 'terraform' && args[1] === 'plan') {
        if (planStatus !== 1) writeFileSync(args.find((arg) => arg.startsWith('-out=')).slice(5), planBytes)
        return { status: planStatus }
      }
      if (binary === 'terraform' && args[1] === 'show') {
        return { status: 0, stdout: 'Plan: 1 to add, 0 to change, 0 to destroy.\ninclude = (sensitive value)\n' }
      }
      if (binary === 'aws' && args.includes('cp') && args[6].startsWith('s3://')) {
        writeFileSync(args[7], downloadedPlan)
      }
      if (binary === 'terraform' && args[1] === 'apply') return { status: applyStatus }
      return { status: 0, stdout: '{"schema_version":1}\n' }
    },
  }
  const outputs = () => Object.fromEntries(readFileSync(env.GITHUB_OUTPUT, 'utf8').trim().split('\n').map((line) => {
    const index = line.indexOf('=')
    return [line.slice(0, index), line.slice(index + 1)]
  }))
  return { env, options, calls, outputs, directory }
}

const applies = (calls) => calls.filter(({ binary, args }) => binary === 'terraform' && args[1] === 'apply')
const transfers = (calls) => calls.filter(({ binary }) => binary === 'aws')

test('a no-change plan skips approval storage and apply, while publishing review context', async (t) => {
  const { env, options, calls, outputs } = fixture(t, { planStatus: 0 })
  await runTerraformWorkflow('plan', env, options)
  assert.equal(outputs().has_changes, 'false')
  assert.equal(outputs().plan_key, '')
  assert.equal(outputs().state_key, env.TF_STATE_KEY)
  assert.equal(transfers(calls).length, 0)
  assert.equal(applies(calls).length, 0)
  assert.match(readFileSync(env.GITHUB_STEP_SUMMARY, 'utf8'), /No infrastructure changes/)
})

test('a changed plan is retained privately with a digest and commit for human review', async (t) => {
  const { env, options, calls, outputs } = fixture(t)
  await runTerraformWorkflow('plan', env, options)
  assert.equal(outputs().has_changes, 'true')
  assert.equal(outputs().plan_sha256, checksum)
  assert.equal(outputs().plan_key, env.TF_PLAN_KEY)
  assert.ok(transfers(calls)[0].args.includes(`s3://${env.TF_STATE_BUCKET}/${env.TF_PLAN_KEY}`))
  assert.equal(applies(calls).length, 0)
  const summary = readFileSync(env.GITHUB_STEP_SUMMARY, 'utf8')
  assert.ok(summary.includes(env.GITHUB_SHA) && summary.includes(checksum))
  assert.ok(!summary.includes(planBytes.toString()) && !summary.includes(env.AWS_SECRET_ACCESS_KEY))
})

test('plan-only runs never save a plan for later apply', async (t) => {
  const { env, options, calls, outputs } = fixture(t)
  await runTerraformWorkflow('plan', { ...env, TF_PLAN_ONLY: 'true' }, options)
  assert.equal(outputs().has_changes, 'true')
  assert.equal(outputs().plan_key, '')
  assert.equal(transfers(calls).length, 0)
  assert.equal(applies(calls).length, 0)
})

test('plan errors stop the workflow instead of being treated as changes', async (t) => {
  const { env, options, calls } = fixture(t, { planStatus: 1 })
  await assert.rejects(runTerraformWorkflow('plan', env, options), /exit code 1/)
  assert.equal(existsSync(env.GITHUB_OUTPUT), false)
  assert.equal(transfers(calls).length, 0)
})

test('deployment consumes the reviewed binary without creating a new plan', async (t) => {
  const { env, options, calls, directory } = fixture(t)
  await runTerraformWorkflow('deploy', env, options)
  assert.equal(applies(calls).length, 1)
  assert.equal(applies(calls)[0].args.at(-1), join(directory, 'cloudflare.tfplan'))
  assert.equal(calls.some(({ args }) => args[1] === 'plan'), false)
  assert.deepEqual(JSON.parse(readFileSync(join(directory, 'cloudflare-infrastructure.json'))), { schema_version: 1 })
})

test('modified plans are rejected before apply', async (t) => {
  const { env, options, calls } = fixture(t, { downloadedPlan: Buffer.from('different changes') })
  await assert.rejects(runTerraformWorkflow('deploy', env, options), /differs from the reviewed plan/)
  assert.equal(applies(calls).length, 0)
})

test('expired plans require a new run and review', async (t) => {
  const { env, options, calls } = fixture(t)
  await assert.rejects(runTerraformWorkflow('deploy', { ...env, TF_PLAN_CREATED_AT: String(timestamp - 86400000) }, options), /expired/)
  assert.equal(applies(calls).length, 0)
  assert.equal(transfers(calls).length, 0)
})

test('a failed or stale apply never falls back to re-planning or emits deployment inputs', async (t) => {
  const { env, options, calls, directory } = fixture(t, { applyStatus: 1 })
  await assert.rejects(runTerraformWorkflow('deploy', env, options), /exit code 1/)
  assert.equal(calls.some(({ args }) => args[1] === 'plan'), false)
  assert.equal(existsSync(join(directory, 'cloudflare-infrastructure.json')), false)
})

test('no-change deployment reads existing outputs without calling apply', async (t) => {
  const { env, options, calls } = fixture(t)
  await runTerraformWorkflow('deploy', { ...env, TF_HAS_CHANGES: 'false', TF_PLAN_KEY: '', TF_PLAN_SHA256: '' }, options)
  assert.equal(applies(calls).length, 0)
  assert.equal(transfers(calls).length, 0)
})

test('cleanup can only remove a plan from this repository and run', async (t) => {
  const { env, options, calls } = fixture(t)
  await assert.rejects(runTerraformWorkflow('cleanup', { ...env, TF_PLAN_KEY: env.TF_STATE_KEY }, options), /must belong/)
  assert.equal(transfers(calls).length, 0)
  await runTerraformWorkflow('cleanup', env, options)
  assert.ok(transfers(calls)[0].args.includes(`s3://${env.TF_STATE_BUCKET}/${env.TF_PLAN_KEY}`))
})

test('an absent or unprotected approval environment fails closed', () => {
  for (const value of [null, {}, { protection_rules: [] }, { protection_rules: [{ type: 'required_reviewers', reviewers: [] }] }]) {
    assert.throws(() => assertRequiredReviewers(value), /Configure required reviewers/)
  }
  assert.doesNotThrow(() => assertRequiredReviewers({ protection_rules: [{ type: 'required_reviewers', reviewers: [{ type: 'User', reviewer: { id: 1 } }] }] }))
})

test('approval checks reject API errors and verify current environment rules', async () => {
  const env = { GITHUB_REPOSITORY: 'example/worker', GITHUB_API_URL: 'https://api.github.com', GITHUB_TOKEN: 'synthetic-token' }
  await assert.rejects(runTerraformWorkflow('check-approval', env, { fetch: async () => ({ ok: false, status: 403 }) }), /HTTP 403/)
  await assert.rejects(runTerraformWorkflow('check-approval', env, { fetch: async () => ({ ok: true, json: async () => ({ protection_rules: [] }) }) }), /Configure required reviewers/)
})
