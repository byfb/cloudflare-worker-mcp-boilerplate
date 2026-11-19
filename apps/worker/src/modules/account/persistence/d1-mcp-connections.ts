import { and, asc, desc, eq, isNotNull, isNull, notExists, sql } from 'drizzle-orm'
import { createDatabase, d1ApiError, executeD1, type Database, type D1Database } from '../../../platform/d1'
import type { McpConnectionAuthorization, McpConnectionRepository } from '../application/mcp-connection-repository'
import { UNREPORTED_MCP_CLIENT, type McpConnectionRecord } from '../domain/mcp-connection'
import { mcpConnections, users } from './schema'

function connectionKey(userId: string, clientKey: string) {
  return and(eq(mcpConnections.userId, userId), eq(mcpConnections.clientKey, clientKey))
}

export class D1McpConnectionRepository implements McpConnectionRepository {
  private readonly db: Database

  constructor(binding: D1Database) { this.db = createDatabase(binding) }

  async authorize(input: McpConnectionAuthorization): Promise<boolean> {
    const increment = input.toolCall ? 1 : 0
    const values = {
      userId: sql<string>`${input.userId}`,
      clientKey: sql<string>`${input.clientKey}`,
      displayName: sql<string>`${input.displayName}`,
      clientVersion: sql<string>`${input.clientVersion}`,
      firstSeenAt: sql<number>`${input.nowMs}`,
      lastSeenAt: sql<number>`${input.nowMs}`,
      revokedAt: sql<null>`null`,
      toolCallCount: sql<number>`${increment}`,
    }
    const insert = this.db.insert(mcpConnections)
    let write = insert.values(values)
    if (input.clientKey === UNREPORTED_MCP_CLIENT.clientKey) {
      // The caller could be any disconnected client for this user. Gate both
      // first use and later updates in the same statement that records activity.
      const disconnected = this.db.select({ key: mcpConnections.clientKey }).from(mcpConnections)
        .where(and(eq(mcpConnections.userId, input.userId), isNotNull(mcpConnections.revokedAt)))
      const eligible = this.db.select(values).from(users)
        .where(and(eq(users.id, input.userId), notExists(disconnected)))
      write = insert.select(eligible.getSQL())
    }
    const row = await executeD1('run', () => write.onConflictDoUpdate({
      target: [mcpConnections.userId, mcpConnections.clientKey],
      set: {
        displayName: input.displayName,
        clientVersion: input.clientVersion,
        lastSeenAt: input.nowMs,
        toolCallCount: sql`${mcpConnections.toolCallCount} + ${increment}`,
      },
      setWhere: isNull(mcpConnections.revokedAt),
    }).returning({ clientKey: mcpConnections.clientKey }).get())
    return row !== undefined
  }

  listByUser(userId: string): Promise<readonly McpConnectionRecord[]> {
    return executeD1('query', () => this.db.select().from(mcpConnections)
      .where(eq(mcpConnections.userId, userId))
      .orderBy(desc(mcpConnections.lastSeenAt), asc(mcpConnections.clientKey)).all())
  }

  async setEnabled(userId: string, clientKey: string, enabled: boolean, nowMs: number): Promise<McpConnectionRecord | null> {
    return (await executeD1('run', () => this.db.update(mcpConnections)
      .set({ revokedAt: enabled ? null : nowMs }).where(connectionKey(userId, clientKey))
      .returning().get())) ?? null
  }

  async removeDisabled(userId: string, clientKey: string): Promise<'removed' | 'active' | 'missing'> {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const removed = await executeD1('run', () => this.db.delete(mcpConnections)
        .where(and(connectionKey(userId, clientKey), isNotNull(mcpConnections.revokedAt)))
        .returning({ clientKey: mcpConnections.clientKey }).get())
      if (removed !== undefined) return 'removed'
      const row = await executeD1('query', () => this.db.select().from(mcpConnections)
        .where(connectionKey(userId, clientKey)).get())
      if (row === undefined) return 'missing'
      if (row.revokedAt === null) return 'active'
      // Retry once if the row became disconnected between DELETE and SELECT.
    }
    throw d1ApiError('d1_run_failed', 'MCP connection changed during removal')
  }
}

export function createD1McpConnectionRepository(db: D1Database): McpConnectionRepository {
  return new D1McpConnectionRepository(db)
}
