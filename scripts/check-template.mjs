import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join, relative } from 'node:path'

const root = fileURLToPath(new URL('../', import.meta.url))
const excluded = new Set(['node_modules', '.git', '.wrangler', '.build', 'dist', 'coverage', '.worktrees', '.codegraph', 'test-results', 'playwright-report'])
const problems = []
function walk(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (excluded.has(entry.name) || entry.isSymbolicLink()) continue
    if (entry.isDirectory()) { walk(path); continue }
    if (/^(?:\.dev\.vars|\.env)(?:\.|$)/.test(entry.name) && !entry.name.endsWith('.example')) continue
    if (!/\.(?:[cm]?[jt]sx?|jsonc?|ya?ml|toml|md|html|css|svg|example)$/.test(entry.name)) continue
    const content = readFileSync(path, 'utf8')
    const name = relative(root, path)
    if (/(?:\/Users|\/home)\/[a-zA-Z0-9_-]+\//.test(content)) problems.push(`${name}: machine-specific home path`)
    if (/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(content)) problems.push(`${name}: private key material`)
    if (/wrangler\.(?:jsonc?|toml)$/.test(entry.name)) {
      if (/\baccount_id["']?\s*[:=]/.test(content)) problems.push(`${name}: account ID must remain unconfigured in the template`)
      for (const match of content.matchAll(/\bdatabase_id["']?\s*[:=]\s*["']([^"']+)/g)) {
        if (match[1] !== '00000000-0000-0000-0000-000000000000') problems.push(`${name}: expected local-only database placeholder`)
      }
    }
  }
}
walk(root)
if (problems.length) {
  console.error(problems.join('\n'))
  process.exitCode = 1
} else console.log('Template hygiene passed: no local paths, private keys, or configured Cloudflare account/database IDs.')
