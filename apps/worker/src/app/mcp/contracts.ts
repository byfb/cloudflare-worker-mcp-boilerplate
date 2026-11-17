import { z } from 'zod'

export const MCP_ROUTE = '/mcp'
export const MCP_MAX_REQUEST_BYTES = 64 * 1024
export const MCP_MAX_TOOL_RESULT_BYTES = 256 * 1024
export const MCP_MAX_EXEC_COMMAND_BYTES = 16 * 1024
export const MCP_MAX_EXEC_SEARCH_BYTES = 256
export const MCP_MAX_EXEC_SCHEMA_PATH_BYTES = 256

export const MCP_TOOL_NAMES = ['exec'] as const
export type McpToolName = (typeof MCP_TOOL_NAMES)[number]
export const MCP_OPERATION_NAMES = ['get_user_profile'] as const
export type McpOperationName = (typeof MCP_OPERATION_NAMES)[number]
export type McpAuditToolName = McpToolName | McpOperationName

export const getUserProfileInputSchema = z.strictObject({})
export const MCP_OPERATION_CONTRACTS = [{
  name: 'get_user_profile',
  title: 'Get current profile',
  description: 'Read the authenticated account’s username. No account selector is accepted.',
  inputSchema: getUserProfileInputSchema,
}] as const

export const MCP_EXEC_TOOL_CONTRACT = {
  name: 'exec',
  title: 'Run an application command',
  description: 'Discover and call application operations. Commands: tools; search <query>; info <tool_name>; schema <tool_name> [field_path]; call <tool_name> <json_input>. This is an allowlisted command interface, not a shell.',
  inputSchema: z.strictObject({
    command: z.string().min(1).max(MCP_MAX_EXEC_COMMAND_BYTES).refine(
      (command) => new TextEncoder().encode(command).byteLength <= MCP_MAX_EXEC_COMMAND_BYTES,
      'Command exceeds the UTF-8 byte limit',
    ),
  }),
} as const

// Review these hints whenever a write operation is added to the catalog.
export const MCP_EXEC_ANNOTATIONS = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const
