import { defineConfig } from 'drizzle-kit'

// Generation is offline. Wrangler remains the only migration runner.
export default defineConfig({
  dialect: 'sqlite',
  schema: './modules/*/persistence/schema.ts',
  out: '../migrations',
})
