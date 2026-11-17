import { z } from "zod";
import {
  MCP_MAX_EXEC_SCHEMA_PATH_BYTES,
  MCP_MAX_EXEC_SEARCH_BYTES,
  MCP_OPERATION_CONTRACTS,
  MCP_OPERATION_NAMES,
  type McpAuditToolName,
  type McpOperationName,
} from "./contracts";
import { McpExecCommandError } from "./tool-result";

export type McpOperationDispatcher = (
  operation: McpOperationName,
  input: unknown,
  signal: AbortSignal,
) => Promise<unknown>;

interface CommandParts {
  readonly verb: string;
  readonly rest: string;
}

function commandParts(command: string): CommandParts {
  const trimmed = command.trim();
  const boundary = trimmed.search(/\s/);
  if (boundary === -1) return { verb: trimmed, rest: "" };
  return {
    verb: trimmed.slice(0, boundary),
    rest: trimmed.slice(boundary).trim(),
  };
}

function boundedUtf8(value: string, maximum: number, code: string, message: string): void {
  if (new TextEncoder().encode(value).byteLength > maximum) {
    throw new McpExecCommandError(code, message);
  }
}

function operationContract(name: string) {
  const contract = MCP_OPERATION_CONTRACTS.find((candidate) => candidate.name === name);
  if (contract === undefined) {
    throw new McpExecCommandError(
      "unknown_operation",
      "Unknown operation. Run `search <query>` or `tools` to find an available name.",
    );
  }
  return contract;
}

function invalidToolInputError(): McpExecCommandError {
  return new McpExecCommandError(
    "invalid_tool_input",
    "Tool input does not match its strict schema. Run `info <tool_name>` and retry.",
  );
}

function oneArgument(rest: string, usage: string): string {
  if (rest === "" || /\s/.test(rest)) {
    throw new McpExecCommandError("invalid_command", `Usage: ${usage}`);
  }
  return rest;
}

function inputSchema(contract: (typeof MCP_OPERATION_CONTRACTS)[number]): Record<string, unknown> {
  return z.toJSONSchema(contract.inputSchema, { io: "input" }) as Record<string, unknown>;
}

function schemaAtPath(schema: Record<string, unknown>, path: string): unknown {
  let current: unknown = schema;
  for (const segment of path.split(".")) {
    if (segment === "") {
      throw new McpExecCommandError(
        "unknown_schema_path",
        "Unknown schema path. Use `schema <tool_name>` to inspect the full schema.",
      );
    }
    if (typeof current !== "object" || current === null || Array.isArray(current)) {
      throw new McpExecCommandError(
        "unknown_schema_path",
        "Unknown schema path. Use `schema <tool_name>` to inspect the full schema.",
      );
    }
    const properties = (current as Record<string, unknown>).properties;
    if (
      typeof properties !== "object" ||
      properties === null ||
      Array.isArray(properties) ||
      !Object.hasOwn(properties, segment)
    ) {
      throw new McpExecCommandError(
        "unknown_schema_path",
        "Unknown schema path. Use `schema <tool_name>` to inspect the full schema.",
      );
    }
    current = (properties as Record<string, unknown>)[segment];
  }
  return current;
}

function toolsResult(): { readonly tools: readonly McpOperationName[] } {
  return { tools: MCP_OPERATION_NAMES };
}

function searchResult(query: string): Record<string, unknown> {
  boundedUtf8(
    query,
    MCP_MAX_EXEC_SEARCH_BYTES,
    "search_query_too_large",
    `Search query must not exceed ${MCP_MAX_EXEC_SEARCH_BYTES} UTF-8 bytes.`,
  );
  const tokens = query.toLocaleLowerCase("en-US").split(/\s+/).filter(Boolean);
  if (tokens.length === 0) {
    throw new McpExecCommandError("invalid_command", "Usage: search <query>");
  }
  const matches = MCP_OPERATION_CONTRACTS.filter((contract) => {
    const metadata = `${contract.name} ${contract.title} ${contract.description}`
      .toLocaleLowerCase("en-US");
    return tokens.every((token) => metadata.includes(token));
  }).map(({ name }) => name);
  return matches.length === 0
    ? { matches, hint: "No operations matched. Run `tools` to list all names." }
    : { matches };
}

function infoResult(name: string): Record<string, unknown> {
  const contract = operationContract(name);
  return {
    name: contract.name,
    title: contract.title,
    description: contract.description,
    input_schema: inputSchema(contract),
  };
}

function schemaResult(rest: string): Record<string, unknown> {
  const [name = "", path, ...extra] = rest.split(/\s+/);
  if (name === "" || extra.length > 0) {
    throw new McpExecCommandError(
      "invalid_command",
      "Usage: schema <tool_name> [field_path]",
    );
  }
  if (path !== undefined) {
    boundedUtf8(
      path,
      MCP_MAX_EXEC_SCHEMA_PATH_BYTES,
      "schema_path_too_large",
      `Schema path must not exceed ${MCP_MAX_EXEC_SCHEMA_PATH_BYTES} UTF-8 bytes.`,
    );
  }
  const contract = operationContract(name);
  const schema = inputSchema(contract);
  return {
    tool: contract.name,
    ...(path === undefined ? {} : { path }),
    schema: path === undefined ? schema : schemaAtPath(schema, path),
  };
}

async function callResult(
  rest: string,
  dispatch: McpOperationDispatcher,
  signal: AbortSignal,
): Promise<unknown> {
  const parsed = commandParts(rest);
  if (parsed.verb === "" || parsed.rest === "") {
    throw new McpExecCommandError(
      "invalid_command",
      "Usage: call <tool_name> <json_input>",
    );
  }
  const contract = operationContract(parsed.verb);
  let input: unknown;
  try {
    input = JSON.parse(parsed.rest) as unknown;
  } catch {
    throw new McpExecCommandError(
      "invalid_json_input",
      "Tool input must be one valid JSON object with no trailing content.",
    );
  }
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new McpExecCommandError(
      "invalid_json_input",
      "Tool input must be one valid JSON object with no trailing content.",
    );
  }
  const validated = contract.inputSchema.safeParse(input);
  if (!validated.success) {
    throw invalidToolInputError();
  }
  return dispatch(contract.name, validated.data, signal);
}

/** Attribute calls to a known inner operation without retaining command text. */
export function auditToolForExecCommand(command: string): McpAuditToolName {
  const parsed = commandParts(command);
  if (parsed.verb !== "call") return "exec";
  const inner = commandParts(parsed.rest).verb;
  return (MCP_OPERATION_NAMES as readonly string[]).includes(inner)
    ? inner as McpOperationName
    : "exec";
}

/** Execute the closed command grammar over the supplied typed operation dispatcher. */
export async function executeExecCommand(
  command: string,
  dispatch: McpOperationDispatcher,
  signal: AbortSignal,
): Promise<unknown> {
  const parsed = commandParts(command);
  switch (parsed.verb) {
    case "tools":
      if (parsed.rest !== "") {
        throw new McpExecCommandError("invalid_command", "Usage: tools");
      }
      return toolsResult();
    case "search":
      return searchResult(parsed.rest);
    case "info":
      return infoResult(oneArgument(parsed.rest, "info <tool_name>"));
    case "schema":
      return schemaResult(parsed.rest);
    case "call":
      return callResult(parsed.rest, dispatch, signal);
    default:
      throw new McpExecCommandError(
        "unknown_command",
        "Unknown command. Use `tools`, `search`, `info`, `schema`, or `call`.",
      );
  }
}
