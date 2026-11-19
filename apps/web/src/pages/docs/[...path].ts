import { readFile } from 'node:fs/promises'
import type { APIRoute } from 'astro'
import { publicDir } from 'astro:config/server'

export async function getStaticPaths() {
  const index = await readFile(new URL('llms.txt', publicDir), 'utf8')
  const links = index.matchAll(/\]\(\/?docs\/([^#)\s]+\.md)(?:#[^)]*)?\)/g)
  const paths = new Set(Array.from(links, ([, path]) => path))
  const guides = import.meta.glob<string>('./**/*.md', {
    base: '../../../../../docs',
    query: '?raw',
    import: 'default',
  })

  return Promise.all(Array.from(paths, async (path) => {
    const load = guides[`./${path}`]
    if (!load) throw new Error(`Missing guide linked from llms.txt: /docs/${path}`)
    return { params: { path }, props: { markdown: await load() } }
  }))
}

export const GET: APIRoute<{ markdown: string }> = ({ props }) =>
  new Response(props.markdown, { headers: { 'Content-Type': 'text/markdown; charset=utf-8' } })
