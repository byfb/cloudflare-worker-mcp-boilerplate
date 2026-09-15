import type {
  McpClientInfo,
  McpConnectionActivity,
  PublicMcpConnection,
} from '../domain/mcp-connection'
import type {
  RemoveMcpConnectionInput,
  SetMcpConnectionEnabledInput,
} from '../application/mcp-connection-service'

/** Narrow cross-context seam used by Worker MCP composition and Account HTTP. */
export interface McpConnectionCapability {
  authorize(
    userId: string,
    client: McpClientInfo,
    activity: McpConnectionActivity,
  ): Promise<void>
  list(userId: string): Promise<{
    readonly connections: readonly PublicMcpConnection[]
  }>
  setEnabled(
    userId: string,
    input: SetMcpConnectionEnabledInput,
  ): Promise<PublicMcpConnection>
  remove(userId: string, input: RemoveMcpConnectionInput): Promise<void>
}

export type {
  McpClientInfo,
  McpConnectionActivity,
  PublicMcpConnection,
  RemoveMcpConnectionInput,
  SetMcpConnectionEnabledInput,
}
