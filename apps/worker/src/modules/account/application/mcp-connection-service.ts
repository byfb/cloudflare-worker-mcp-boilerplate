import { ApiError } from '../../../platform/http/api-error'
import {
  normalizeMcpClientDescriptor,
  normalizeMcpClientKey,
  publicMcpConnection,
  type McpClientInfo,
  type McpConnectionActivity,
  type PublicMcpConnection,
} from '../domain/mcp-connection'
import type { McpConnectionRepository } from './mcp-connection-repository'

export interface McpConnectionClock {
  nowMs(): number
}

export interface McpConnectionApplicationDependencies {
  readonly repository: McpConnectionRepository
  readonly clock: McpConnectionClock
}

export interface SetMcpConnectionEnabledInput {
  readonly client_key: string
  readonly enabled: boolean
}

export interface RemoveMcpConnectionInput {
  readonly client_key: string
}

/** Account use cases for cooperative, user-scoped MCP client-family access. */
export class McpConnectionApplication {
  constructor(private readonly deps: McpConnectionApplicationDependencies) {}

  async authorize(
    userId: string,
    client: McpClientInfo,
    activity: McpConnectionActivity,
  ): Promise<void> {
    const descriptor = normalizeMcpClientDescriptor(client)
    const active = await this.deps.repository.authorize({
      userId,
      ...descriptor,
      nowMs: this.deps.clock.nowMs(),
      toolCall: activity.toolCall,
    })
    if (!active) {
      throw ApiError.forbidden(
        'mcp_connection_revoked',
        'MCP connection is disabled; re-enable it in Profile',
      )
    }
  }

  async list(userId: string): Promise<{
    readonly connections: readonly PublicMcpConnection[]
  }> {
    const rows = await this.deps.repository.listByUser(userId)
    return { connections: rows.map(publicMcpConnection) }
  }

  async setEnabled(
    userId: string,
    input: SetMcpConnectionEnabledInput,
  ): Promise<PublicMcpConnection> {
    const clientKey = normalizeMcpClientKey(input.client_key)
    const row = await this.deps.repository.setEnabled(
      userId,
      clientKey,
      input.enabled,
      this.deps.clock.nowMs(),
    )
    if (row === null) {
      throw ApiError.notFound(
        'mcp_connection_not_found',
        'MCP connection not found',
      )
    }
    return publicMcpConnection(row)
  }

  async remove(userId: string, input: RemoveMcpConnectionInput): Promise<void> {
    const clientKey = normalizeMcpClientKey(input.client_key)
    const result = await this.deps.repository.removeDisabled(userId, clientKey)
    if (result === 'active') {
      throw ApiError.conflict(
        'mcp_connection_active',
        'Disconnect MCP connection before removing it',
      )
    }
    if (result === 'missing') {
      throw ApiError.notFound(
        'mcp_connection_not_found',
        'MCP connection not found',
      )
    }
  }
}
