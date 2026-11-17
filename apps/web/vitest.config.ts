/// <reference types="vitest/config" />
import { getViteConfig } from 'astro/config'

export default getViteConfig({
  test: {
    environment: './tests/environment.ts',
    globals: true,
    setupFiles: ['./tests/setup.ts'],
    restoreMocks: true,
  },
})
