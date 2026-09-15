import type {
  McpClientInfo,
  McpConnectionActivity,
} from "../../../modules/account/public/mcp-connections";
import type { AccountProfileReadCapability } from "../../../modules/account/public/profile";
import type { McpAuditToolName } from "./contracts";

/** Minimal identity admitted into the MCP adapter after Access verification. */
export interface McpPrincipal {
  readonly userId: string;
}

/**
 * Narrow bounded-context seams available to MCP.
 *
 * Keeping the concrete capabilities grouped here makes it impossible for the
 * adapter to reach repositories, D1, HTTP routes, or unrelated mutations.
 */
export interface McpCapabilities {
  readonly account: AccountProfileReadCapability;
}

/** Explicit DNS-rebinding and browser-Origin policy for the exact MCP route. */
export interface McpTransportPolicy {
  readonly publicOrigin: string;
  readonly allowedHostnames: readonly string[];
  readonly allowedOriginHostnames: readonly string[];
}

export type McpAuditOutcome = "success" | "client_error" | "internal_error";

export type McpAuditErrorClass =
  | "access_unauthenticated"
  | "access_auth_unavailable"
  | "access_identity_unlinked"
  | "mcp_client_identity_required"
  | "mcp_connection_revoked"
  | "transport_rejected"
  | "internal_error";

/** Deliberately excludes identity, arguments, results, tokens, and raw errors. */
export interface McpAuditEvent {
  readonly correlationId: string;
  readonly method: "tools/call" | "protocol";
  readonly tool?: McpAuditToolName;
  readonly principalHash?: string;
  readonly outcome: McpAuditOutcome;
  readonly errorClass?: McpAuditErrorClass;
  readonly durationMs: number;
}

export interface McpAuditSink {
  record(event: McpAuditEvent): void | Promise<void>;
}

export interface McpRequestDependencies {
  readonly principal: McpPrincipal;
  readonly capabilities: McpCapabilities;
  /** Account-owned cooperative connection gate, evaluated before MCP work. */
  readonly authorizeConnection: (
    client: McpClientInfo,
    activity: McpConnectionActivity,
  ) => Promise<void>;
  readonly transport: McpTransportPolicy;
  readonly audit?: McpAuditSink;
  readonly principalHash?: string;
  readonly nowMs?: () => number;
  readonly correlationId?: () => string;
}
