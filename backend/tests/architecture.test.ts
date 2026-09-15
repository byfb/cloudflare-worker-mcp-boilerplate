import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { expect, it } from 'vitest'

const root = fileURLToPath(new URL('../', import.meta.url))
function sources(path: string): string[] {
  return readdirSync(path, { withFileTypes: true }).flatMap((entry) => {
    const full = join(path, entry.name)
    return entry.isDirectory() ? sources(full) : entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts') ? [full] : []
  })
}

it('keeps platform independent and domain logic inward-facing', () => {
  const violations: string[] = []
  for (const area of ['platform', 'shared-kernel', 'modules', 'apps']) {
    for (const file of sources(join(root, area))) {
      const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true)
      const from = relative(root, file).replaceAll('\\', '/')
      for (const statement of source.statements) {
        if (!ts.isImportDeclaration(statement) && !ts.isExportDeclaration(statement)) continue
        const specifier = statement.moduleSpecifier
        if (!specifier || !ts.isStringLiteral(specifier)) continue
        const target = specifier.text.startsWith('.')
          ? relative(root, resolve(dirname(file), specifier.text)).replaceAll('\\', '/') : specifier.text
        if (from.startsWith('platform/') && /^(modules|apps|dev)\//.test(target)) violations.push(`${from} -> ${target}`)
        if (from.startsWith('apps/') && /^(dev|tests)\//.test(target)) violations.push(`${from} -> ${target}`)
        if (from.startsWith('shared-kernel/') && !target.startsWith('shared-kernel/')) violations.push(`${from} -> ${target}`)
        const domain = /^(modules\/[^/]+\/domain)\//.exec(from)?.[1]
        if (domain && !target.startsWith(domain + '/') && !target.startsWith('shared-kernel/')) violations.push(`${from} -> ${target}`)
      }
    }
  }
  expect(violations).toEqual([])
})
