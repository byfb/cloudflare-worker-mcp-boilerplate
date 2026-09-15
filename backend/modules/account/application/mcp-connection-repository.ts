import type { McpConnectionRecord } from '../domain/mcp-connection'

export interface McpConnectionAuthorization {
  readonly userId: string
  readonly clientKey: string
  readonly displayName: string
  readonly clientVersion: string
  readonly nowMs: number
  readonly toolCall: boolean
}

export type RemoveMcpConnectionResult = 'removed' | 'active' | 'missing'

/** Account-owned persistence boundary for cooperative MCP client families. */
export interface McpConnectionRepository {
  /** Insert/refresh an active row; return false without mutation for a tombstone. */
  authorize(input: McpConnectionAuthorization): Promise<boolean>
  listByUser(userId: string): Promise<readonly McpConnectionRecord[]>
  setEnabled(
    userId: string,
    clientKey: string,
    enabled: boolean,
    nowMs: number,
  ): Promise<McpConnectionRecord | null>
  removeDisabled(userId: string, clientKey: string): Promise<RemoveMcpConnectionResult>
}
