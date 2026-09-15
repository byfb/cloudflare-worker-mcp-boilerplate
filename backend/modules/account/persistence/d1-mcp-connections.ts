import {
  d1ApiError,
  D1Executor,
  type D1Database,
} from '../../../platform/d1'
import type {
  McpConnectionAuthorization,
  McpConnectionRepository,
} from '../application/mcp-connection-repository'
import type { McpConnectionRecord } from '../domain/mcp-connection'

export const AUTHORIZE_MCP_CONNECTION_SQL =
  'INSERT INTO mcp_connections (' +
  'user_id, client_key, display_name, client_version, first_seen_at, last_seen_at, revoked_at, tool_call_count' +
  ') VALUES (?1, ?2, ?3, ?4, ?5, ?5, NULL, ?6) ' +
  'ON CONFLICT(user_id, client_key) DO UPDATE SET ' +
  'display_name = excluded.display_name, ' +
  'client_version = excluded.client_version, ' +
  'last_seen_at = excluded.last_seen_at, ' +
  'tool_call_count = mcp_connections.tool_call_count + excluded.tool_call_count ' +
  'WHERE mcp_connections.revoked_at IS NULL'

export const LIST_MCP_CONNECTIONS_SQL =
  'SELECT user_id, client_key, display_name, client_version, ' +
  'first_seen_at, last_seen_at, revoked_at, tool_call_count ' +
  'FROM mcp_connections WHERE user_id = ?1 ' +
  'ORDER BY last_seen_at DESC, client_key ASC'

export const SET_MCP_CONNECTION_ENABLED_SQL =
  'UPDATE mcp_connections SET revoked_at = ' +
  'CASE WHEN ?3 = 1 THEN NULL ELSE ?4 END ' +
  'WHERE user_id = ?1 AND client_key = ?2'

export const SELECT_MCP_CONNECTION_SQL =
  'SELECT user_id, client_key, display_name, client_version, ' +
  'first_seen_at, last_seen_at, revoked_at, tool_call_count ' +
  'FROM mcp_connections WHERE user_id = ?1 AND client_key = ?2'

export const REMOVE_DISABLED_MCP_CONNECTION_SQL =
  'DELETE FROM mcp_connections ' +
  'WHERE user_id = ?1 AND client_key = ?2 AND revoked_at IS NOT NULL'

interface McpConnectionRow {
  user_id: string
  client_key: string
  display_name: string
  client_version: string
  first_seen_at: number
  last_seen_at: number
  revoked_at: number | null
  tool_call_count: number
}

function fromRow(row: McpConnectionRow): McpConnectionRecord {
  return {
    userId: row.user_id,
    clientKey: row.client_key,
    displayName: row.display_name,
    clientVersion: row.client_version,
    firstSeenAt: row.first_seen_at,
    lastSeenAt: row.last_seen_at,
    revokedAt: row.revoked_at,
    toolCallCount: row.tool_call_count,
  }
}

function changes(result: { readonly meta?: Record<string, unknown> }): number {
  const value = result.meta?.changes
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw d1ApiError('d1_run_failed', 'D1 write metadata missing changes')
  }
  return value
}

async function selectConnection(
  executor: D1Executor,
  userId: string,
  clientKey: string,
): Promise<McpConnectionRecord | null> {
  const row = await executor.first<McpConnectionRow>(SELECT_MCP_CONNECTION_SQL, [
    userId,
    clientKey,
  ])
  return row === null ? null : fromRow(row)
}

export class D1McpConnectionRepository implements McpConnectionRepository {
  private readonly executor: D1Executor

  constructor(db: D1Database) {
    this.executor = new D1Executor(db)
  }

  async authorize(input: McpConnectionAuthorization): Promise<boolean> {
    try {
      const result = await this.executor.run(AUTHORIZE_MCP_CONNECTION_SQL, [
        input.userId,
        input.clientKey,
        input.displayName,
        input.clientVersion,
        input.nowMs,
        input.toolCall ? 1 : 0,
      ])
      return changes(result) > 0
    } catch (error) {
      if (error instanceof Error && 'status' in error) throw error
      throw d1ApiError('d1_run_failed', error)
    }
  }

  async listByUser(userId: string): Promise<readonly McpConnectionRecord[]> {
    const rows = await this.executor.all<McpConnectionRow>(LIST_MCP_CONNECTIONS_SQL, [
      userId,
    ])
    return rows.map(fromRow)
  }

  async setEnabled(
    userId: string,
    clientKey: string,
    enabled: boolean,
    nowMs: number,
  ): Promise<McpConnectionRecord | null> {
    try {
      const result = await this.executor.run(SET_MCP_CONNECTION_ENABLED_SQL, [
        userId,
        clientKey,
        enabled ? 1 : 0,
        nowMs,
      ])
      if (changes(result) === 0) return null
    } catch (error) {
      if (error instanceof Error && 'status' in error) throw error
      throw d1ApiError('d1_run_failed', error)
    }
    return selectConnection(this.executor, userId, clientKey)
  }

  async removeDisabled(
    userId: string,
    clientKey: string,
  ): Promise<'removed' | 'active' | 'missing'> {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      let removed: number
      try {
        removed = changes(await this.executor.run(
          REMOVE_DISABLED_MCP_CONNECTION_SQL,
          [userId, clientKey],
        ))
      } catch (error) {
        if (error instanceof Error && 'status' in error) throw error
        throw d1ApiError('d1_run_failed', error)
      }
      if (removed > 0) return 'removed'

      const row = await selectConnection(this.executor, userId, clientKey)
      if (row === null) return 'missing'
      if (row.revokedAt === null) return 'active'
      // The row became disconnected between DELETE and SELECT. Retry once
      // with the same revoked-state predicate rather than reporting a race.
    }
    throw d1ApiError('d1_run_failed', 'MCP connection changed during removal')
  }
}

export function createD1McpConnectionRepository(
  db: D1Database,
): McpConnectionRepository {
  return new D1McpConnectionRepository(db)
}
