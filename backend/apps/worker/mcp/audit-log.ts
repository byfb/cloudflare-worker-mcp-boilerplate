import type {
  McpAuditErrorClass,
  McpAuditEvent,
  McpAuditSink,
  McpAuditOutcome,
} from "./types";
import { MCP_OPERATION_NAMES, MCP_TOOL_NAMES } from "./contracts";

const MCP_PRINCIPAL_HASH_DOMAIN = "worker-mcp:principal:v1\0";
const SHA256_HASH = /^sha256:[0-9a-f]{64}$/;
const AUDIT_METHODS = new Set<McpAuditEvent["method"]>(["tools/call", "protocol"]);
const AUDIT_OUTCOMES = new Set<McpAuditOutcome>([
  "success",
  "client_error",
  "internal_error",
]);
const AUDIT_ERROR_CLASSES = new Set<McpAuditErrorClass>([
  "access_unauthenticated",
  "access_auth_unavailable",
  "access_identity_unlinked",
  "transport_rejected",
  "internal_error",
]);
const AUDIT_TOOLS = new Set<string>([...MCP_TOOL_NAMES, ...MCP_OPERATION_NAMES]);

export type McpAuditLogger = (line: string) => void;

/**
 * Hash a trusted internal principal identifier with an MCP-specific domain.
 * The identifier itself is never returned or logged.
 */
export async function hashMcpPrincipal(principalId: string): Promise<string> {
  const payload = new TextEncoder().encode(`${MCP_PRINCIPAL_HASH_DOMAIN}${principalId}`);
  const digest = await crypto.subtle.digest("SHA-256", payload);
  const bytes = new Uint8Array(digest);
  let hex = "";
  for (const byte of bytes) hex += byte.toString(16).padStart(2, "0");
  return `sha256:${hex}`;
}

function safeString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

/** Keep the emitted record deliberately narrower than the input object. */
function safeAuditRecord(event: McpAuditEvent): Record<string, unknown> {
  const record: Record<string, unknown> = { type: "mcp_audit", protocol: "mcp" };

  const correlationId = safeString(event.correlationId);
  if (correlationId !== undefined) record.correlationId = correlationId;

  if (AUDIT_METHODS.has(event.method)) record.method = event.method;

  const tool = safeString(event.tool);
  if (tool !== undefined && AUDIT_TOOLS.has(tool)) record.tool = tool;

  const principalHash = safeString(event.principalHash);
  if (principalHash !== undefined && SHA256_HASH.test(principalHash)) {
    record.principalHash = principalHash;
  }

  if (AUDIT_OUTCOMES.has(event.outcome)) record.outcome = event.outcome;

  const errorClass = safeString(event.errorClass);
  if (
    errorClass !== undefined &&
    AUDIT_ERROR_CLASSES.has(errorClass as McpAuditErrorClass)
  ) {
    record.errorClass = errorClass;
  }

  if (typeof event.durationMs === "number" && Number.isFinite(event.durationMs)) {
    record.durationMs = Math.max(0, Math.floor(event.durationMs));
  }

  return record;
}

/** Build a fail-open, JSON-lines MCP audit sink. */
export function createMcpAuditSink(
  logger: McpAuditLogger = (line) => console.log(line),
): McpAuditSink {
  return {
    record(event) {
      try {
        logger(JSON.stringify(safeAuditRecord(event)));
      } catch {
        // Audit output is deliberately fail-open; request handling owns errors.
      }
    },
  };
}
