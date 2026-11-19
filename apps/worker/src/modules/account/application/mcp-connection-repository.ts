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
  /** Record an active connection. Unnamed requests require all of the user's connections to be active. */
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
