import { RuleViolation } from '../../../shared-kernel/rule-violation'

export const MCP_CLIENT_NAME_MAX_BYTES = 128
export const MCP_CLIENT_TITLE_MAX_BYTES = 128
export const MCP_CLIENT_VERSION_MAX_BYTES = 64

export interface McpClientInfo {
  readonly name: string
  readonly version: string
  readonly title?: string
}

export interface McpClientDescriptor {
  readonly clientKey: string
  readonly displayName: string
  readonly clientVersion: string
}

export interface McpConnectionActivity {
  readonly toolCall: boolean
}

export interface McpConnectionRecord extends McpClientDescriptor {
  readonly userId: string
  readonly firstSeenAt: number
  readonly lastSeenAt: number
  readonly revokedAt: number | null
  readonly toolCallCount: number
}

export interface PublicMcpConnection {
  readonly client_key: string
  readonly display_name: string
  readonly client_version: string
  readonly first_seen_at: number
  readonly last_seen_at: number
  readonly tool_call_count: number
  readonly enabled: boolean
}

const CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength
}

function invalidClientIdentity(): never {
  throw new RuleViolation(
    'mcp_client_identity_required',
    'valid MCP client identity is required',
  )
}

function normalizedRequired(value: unknown, maxBytes: number): string {
  if (typeof value !== 'string') return invalidClientIdentity()
  const normalized = value.normalize('NFKC').trim()
  if (
    normalized.length === 0 ||
    CONTROL_CHARACTER.test(normalized) ||
    byteLength(normalized) > maxBytes
  ) {
    return invalidClientIdentity()
  }
  return normalized
}

/**
 * Normalize self-reported MCP implementation metadata into one cooperative
 * client-family key. This descriptor is deliberately not an OAuth identity.
 */
export function normalizeMcpClientDescriptor(input: {
  readonly name: unknown
  readonly version: unknown
  readonly title?: unknown
}): McpClientDescriptor {
  const name = normalizedRequired(input.name, MCP_CLIENT_NAME_MAX_BYTES)
  const clientVersion = normalizedRequired(
    input.version,
    MCP_CLIENT_VERSION_MAX_BYTES,
  )
  const normalizedKey = name.toLowerCase()
  if (byteLength(normalizedKey) > MCP_CLIENT_NAME_MAX_BYTES) {
    return invalidClientIdentity()
  }

  let displayName = name
  if (typeof input.title === 'string') {
    const title = input.title.normalize('NFKC').trim()
    if (
      title.length > 0 &&
      !CONTROL_CHARACTER.test(title) &&
      byteLength(title) <= MCP_CLIENT_TITLE_MAX_BYTES
    ) {
      displayName = title
    }
  }

  return {
    clientKey: normalizedKey,
    displayName,
    clientVersion,
  }
}

export function normalizeMcpClientKey(value: unknown): string {
  if (typeof value !== 'string') {
    throw new RuleViolation('invalid_payload', 'client_key must be a string')
  }
  const normalized = value.normalize('NFKC').trim().toLowerCase()
  if (
    normalized.length === 0 ||
    CONTROL_CHARACTER.test(normalized) ||
    byteLength(normalized) > MCP_CLIENT_NAME_MAX_BYTES
  ) {
    throw new RuleViolation('invalid_payload', 'client_key is invalid')
  }
  return normalized
}

export function publicMcpConnection(
  row: McpConnectionRecord,
): PublicMcpConnection {
  return {
    client_key: row.clientKey,
    display_name: row.displayName,
    client_version: row.clientVersion,
    first_seen_at: row.firstSeenAt,
    last_seen_at: row.lastSeenAt,
    tool_call_count: row.toolCallCount,
    enabled: row.revokedAt === null,
  }
}
