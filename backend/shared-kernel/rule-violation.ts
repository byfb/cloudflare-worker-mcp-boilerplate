/**
 * A platform-neutral domain rule failure with a stable public error envelope.
 *
 * Transport adapters decide how to represent the violation. Domain code owns
 * only the machine-readable code and human-readable message.
 */
export class RuleViolation extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "RuleViolation";
    this.code = code;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** Cross-realm guard used by transport and application boundaries. */
export function isRuleViolation(value: unknown): value is RuleViolation {
  if (value instanceof RuleViolation) return true;
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as { name?: unknown; code?: unknown; message?: unknown };
  return (
    candidate.name === "RuleViolation" &&
    typeof candidate.code === "string" &&
    typeof candidate.message === "string"
  );
}
