import { DatabaseSync } from 'node:sqlite'
import { readFileSync, readdirSync } from 'node:fs'
import { generateSQLiteDrizzleJson, generateSQLiteMigration } from 'drizzle-kit/api'
import { expect, it } from 'vitest'
import { createTestDatabase } from '../../../tests/sqlite-d1'
import * as schema from './schema'

it('keeps the typed schema in sync with the latest migration snapshot', async () => {
  const directory = new URL('../../../../migrations/meta/', import.meta.url)
  const latest = readdirSync(directory).filter((name) => name.endsWith('_snapshot.json')).sort().at(-1)!
  const snapshot = JSON.parse(readFileSync(new URL(latest, directory), 'utf8'))
  const current = await generateSQLiteDrizzleJson(schema)
  for (const table of Object.keys(current.tables)) {
    expect(current.tables[table], 'Run pnpm run db:generate after changing schema.ts').toEqual(snapshot.tables[table])
  }
})

it('preserves the existing schema, defaults, indexes, and database constraints', async () => {
  const current = await generateSQLiteDrizzleJson(schema)
  const empty = await generateSQLiteDrizzleJson({})
  const statements = await generateSQLiteMigration(empty, current)
  const generated = new DatabaseSync(':memory:')
  const migrated = createTestDatabase()
  try {
    generated.exec('PRAGMA foreign_keys = ON')
    for (const statement of statements) generated.exec(statement)
    for (const table of Object.keys(current.tables)) {
      const columns = (db: DatabaseSync) => db.prepare(`PRAGMA table_info('${table}')`).all()
        .map((row) => ({ ...row, type: String(row.type).toLowerCase() }))
      expect(columns(generated)).toEqual(columns(migrated.sqlite))
      expect(generated.prepare(`PRAGMA foreign_key_list('${table}')`).all())
        .toEqual(migrated.sqlite.prepare(`PRAGMA foreign_key_list('${table}')`).all())
      // SQLite names inline UNIQUE indexes itself; compare their actual keys.
      const indexes = (db: DatabaseSync) => db.prepare(`PRAGMA index_list('${table}')`).all().map((row) => ({
        unique: row.unique,
        columns: db.prepare(`PRAGMA index_xinfo('${row.name}')`).all()
          .filter((column) => column.key === 1).map(({ name, desc }) => ({ name, desc })),
      })).sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)))
      expect(indexes(generated)).toEqual(indexes(migrated.sqlite))
    }
    for (const db of [generated, migrated.sqlite]) {
      db.exec("INSERT INTO users (id, username, password_hash) VALUES ('member-id', 'member', 'hash')")
      expect(db.prepare('SELECT created_at FROM users').get()?.created_at).toMatch(/^\d{4}-\d{2}-\d{2}T.*Z$/)
      expect(() => db.exec("INSERT INTO users (id, username, password_hash) VALUES ('other-id', 'member', 'hash')")).toThrow(/UNIQUE/)
      const insert = db.prepare('INSERT INTO mcp_connections (user_id, client_key, display_name, client_version, first_seen_at, last_seen_at, revoked_at, tool_call_count) VALUES (?, ?, ?, ?, 1, 1, ?, ?)')
      for (const values of [
        ['member-id', '', 'Client', '1.0', null, 0],
        ['member-id', 'x'.repeat(129), 'Client', '1.0', null, 0],
        ['member-id', 'client', '', '1.0', null, 0],
        ['member-id', 'client', 'x'.repeat(129), '1.0', null, 0],
        ['member-id', 'client', 'Client', '', null, 0],
        ['member-id', 'client', 'Client', 'x'.repeat(65), null, 0],
        ['member-id', 'client', 'Client', '1.0', -1, 0],
        ['member-id', 'client', 'Client', '1.0', null, -1],
      ]) expect(() => insert.run(...values)).toThrow(/CHECK/)
      expect(() => insert.run('unknown', 'client', 'Client', '1.0', null, 0)).toThrow(/FOREIGN KEY/)
      insert.run('member-id', 'client', 'Client', '1.0', null, 0)
      expect(() => insert.run('member-id', 'client', 'Client', '1.0', null, 0)).toThrow(/UNIQUE/)
      db.exec("INSERT INTO auth_identities (issuer, subject, user_id) VALUES ('issuer', 'subject', 'member-id')")
      expect(() => db.exec("INSERT INTO auth_identities (issuer, subject, user_id) VALUES ('issuer', 'subject', 'member-id')")).toThrow(/UNIQUE/)
      db.exec("DELETE FROM users WHERE id = 'member-id'")
      expect(db.prepare('SELECT count(*) AS n FROM auth_identities').get()?.n).toBe(0)
      expect(db.prepare('SELECT count(*) AS n FROM mcp_connections').get()?.n).toBe(0)
    }
  } finally {
    generated.close()
    migrated.close()
  }
})
