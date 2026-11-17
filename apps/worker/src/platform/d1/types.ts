export type {
  D1Database,
  D1ExecResult,
  D1Meta,
  D1PreparedStatement,
  D1Result,
} from '@cloudflare/workers-types'
import type { D1Database } from '@cloudflare/workers-types'

/** Scalar values used by the optional D1 value conversion helpers. */
export type D1Value = string | number | null

export type D1Env = Record<string, unknown> & { DB?: D1Database }
