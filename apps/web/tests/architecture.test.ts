// @vitest-environment node
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { expect, it } from 'vitest'

const root = fileURLToPath(new URL('../src/', import.meta.url))
const layers = ['shared', 'entities', 'features', 'widgets', '_pages', 'app', 'pages']
const slicedLayers = new Set(['entities', 'features', 'widgets', '_pages'])
const pathFromRoot = (file: string) => relative(root, file).replaceAll('\\', '/')

function sources(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = join(directory, entry.name)
    return entry.isDirectory() ? sources(file)
      : /\.(ts|astro)$/.test(entry.name) && !/\.(test|d)\.ts$/.test(entry.name) ? [file] : []
  })
}

function imports(file: string) {
  const source = readFileSync(file, 'utf8')
  const blocks = file.endsWith('.astro')
    ? [
      { code: source.match(/^---\r?\n([\s\S]*?)\r?\n---/)?.[1] ?? '', browser: false },
      ...Array.from(source.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g), ([, attributes, code]) => ({
        code, browser: true, src: attributes.match(/\bsrc=["']([^"']+)["']/)?.[1],
      })),
    ]
    : [{ code: source, browser: false }]
  return blocks.flatMap((block) => [
    ...ts.preProcessFile(block.code, true, true).importedFiles.map(({ fileName }) => ({ specifier: fileName, browser: block.browser })),
    ...('src' in block && block.src ? [{ specifier: block.src, browser: true }] : []),
  ])
}

function localTarget(file: string, specifier: string) {
  const target = specifier.startsWith('@/') ? resolve(root, specifier.slice(2))
    : specifier.startsWith('.') ? resolve(dirname(file), specifier) : null
  if (!target) return null
  const resolved = [target, `${target}.ts`, `${target}.astro`, join(target, 'index.ts')]
    .find((candidate) => existsSync(candidate) && statSync(candidate).isFile())
  if (!resolved) throw new Error(`Unresolved local import: ${pathFromRoot(file)} -> ${specifier}`)
  return resolved
}

function boundaryViolation(from: string, target: string) {
  const [fromLayer, fromSlice] = from.split('/')
  const [toLayer, toSlice, ...entry] = target.split('/')
  if (!layers.includes(fromLayer) || !layers.includes(toLayer)) return 'outside FSD layers'
  if (toLayer === 'pages') return 'framework routes are entry points'
  if (layers.indexOf(toLayer) > layers.indexOf(fromLayer)) return 'upward layer import'
  // Astro routes compose the App shell and page APIs above the FSD layers.
  if (fromLayer === 'pages' && !['app', '_pages'].includes(toLayer)) return 'logic belongs below the route adapter'
  const sameOwner = fromLayer === toLayer && fromSlice === toSlice
  if (fromLayer === toLayer && slicedLayers.has(toLayer) && !sameOwner) return 'cross-slice import'
  if ((slicedLayers.has(toLayer) || toLayer === 'shared') && !sameOwner
    && !/^index(?:\.server)?\.ts$/.test(entry.join('/'))) return 'bypassed public API'
  return null
}

it('keeps layer direction, slice isolation, and public APIs intact', () => {
  const violations: string[] = []
  for (const file of sources(root)) {
    for (const { specifier } of imports(file)) {
      const target = localTarget(file, specifier)
      if (!target) continue
      const failure = boundaryViolation(pathFromRoot(file), pathFromRoot(target))
      if (failure) violations.push(`${pathFromRoot(file)} -> ${specifier}: ${failure}`)
    }
  }
  expect(violations).toEqual([])
})

it('keeps Astro templates and server entry points out of browser scripts', () => {
  const visited = new Set<string>()
  const violations: string[] = []
  function visit(file: string) {
    if (visited.has(file)) return
    visited.add(file)
    if (file.endsWith('.astro') || file.endsWith('.server.ts')) {
      violations.push(pathFromRoot(file))
      return
    }
    if (!file.endsWith('.ts')) return
    for (const { specifier } of imports(file)) {
      const target = localTarget(file, specifier)
      if (target) visit(target)
    }
  }
  for (const file of sources(root).filter((file) => file.endsWith('.astro'))) {
    for (const { specifier, browser } of imports(file)) {
      const target = browser ? localTarget(file, specifier) : null
      if (target) visit(target)
    }
  }
  expect(visited.size).toBeGreaterThan(0)
  expect(violations).toEqual([])
})

it.each([
  ['shared/api/http.ts', '_pages/home/index.ts', 'upward layer import'],
  ['_pages/account/ui/account.ts', '_pages/home/index.ts', 'cross-slice import'],
  ['app/bootstrap/page.ts', '_pages/account/ui/account.ts', 'bypassed public API'],
  ['_pages/account/ui/account.ts', 'shared/api/http.ts', 'bypassed public API'],
  ['app/bootstrap/page.ts', 'pages/account.astro', 'framework routes are entry points'],
  ['app/bootstrap/page.ts', '_pages/account/index.ts', null],
  ['pages/account.astro', '_pages/account/index.server.ts', null],
  ['shared/auth/session.ts', 'shared/api/index.ts', null],
  ['_pages/account/index.ts', '_pages/account/ui/account.ts', null],
])('checks the boundary from %s to %s', (from, target, expected) => {
  expect(boundaryViolation(from, target)).toBe(expected)
})
