import { sql } from 'drizzle-orm'
import { check, index, integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core'

const createdAt = () => text('created_at').notNull()
  .default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`)

export const users = sqliteTable('users', {
  id: text('id').primaryKey().notNull(),
  username: text('username').notNull().unique(),
  password_hash: text('password_hash').notNull(),
  created_at: createdAt(),
})

export const authIdentities = sqliteTable('auth_identities', {
  issuer: text('issuer').notNull(),
  subject: text('subject').notNull(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  verifiedEmail: text('verified_email'),
  createdAt: createdAt(),
}, (table) => [
  primaryKey({ columns: [table.issuer, table.subject] }),
  index('idx_auth_identities_user').on(table.userId),
])

export const mcpConnections = sqliteTable('mcp_connections', {
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  clientKey: text('client_key').notNull(),
  displayName: text('display_name').notNull(),
  clientVersion: text('client_version').notNull(),
  firstSeenAt: integer('first_seen_at').notNull(),
  lastSeenAt: integer('last_seen_at').notNull(),
  revokedAt: integer('revoked_at'),
  toolCallCount: integer('tool_call_count').notNull().default(0),
}, (table) => [
  primaryKey({ columns: [table.userId, table.clientKey] }),
  index('idx_mcp_connections_user_last_seen').on(table.userId, sql`${table.lastSeenAt} desc`, table.clientKey),
  check('mcp_client_key_length', sql`length(${table.clientKey}) between 1 and 128`),
  check('mcp_display_name_length', sql`length(${table.displayName}) between 1 and 128`),
  check('mcp_client_version_length', sql`length(${table.clientVersion}) between 1 and 64`),
  check('mcp_revoked_at_nonnegative', sql`${table.revokedAt} is null or ${table.revokedAt} >= 0`),
  check('mcp_tool_call_count_nonnegative', sql`${table.toolCallCount} >= 0`),
])
