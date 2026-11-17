import { builtinEnvironments } from 'vitest/runtime'

// Astro templates need the server transform; their browser controllers need a DOM.
export default { ...builtinEnvironments.jsdom, name: 'astro-dom', viteEnvironment: 'ssr' }
