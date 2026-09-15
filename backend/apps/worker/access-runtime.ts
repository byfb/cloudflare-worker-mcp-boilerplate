import {
  createAccessAssertionVerifier,
  type AccessAssertionVerifier,
  type AccessAssertionVerifierConfig,
} from "../../platform/auth";
import {
  accessWorkerConfig,
  accessWorkerConfigKey,
  browserAccessVerifierConfig,
  mcpAccessVerifierConfig,
  type AccessWorkerConfig,
  type AccessWorkerEnv,
} from "./access-config";

export type AccessVerifierFactory = (
  config: AccessAssertionVerifierConfig,
) => AccessAssertionVerifier;

export interface WorkerAccessVerifiers {
  readonly config: AccessWorkerConfig;
  readonly browser: AccessAssertionVerifier;
  readonly mcp: AccessAssertionVerifier;
}

interface CachedAccessVerifiers {
  readonly key: string;
  readonly value: WorkerAccessVerifiers;
}

/**
 * Resolve the browser/MCP verifier pair while retaining only the most recent
 * deployment configuration. The verifier instances own the bounded JWKS
 * caches, so keeping this runtime at module scope lets warm Worker requests
 * share keys without creating an unbounded configuration cache.
 */
export class WorkerAccessRuntime {
  private cached: CachedAccessVerifiers | undefined;

  constructor(
    private readonly createVerifier: AccessVerifierFactory =
      createAccessAssertionVerifier,
  ) {}

  resolve(env: AccessWorkerEnv): WorkerAccessVerifiers {
    const config = accessWorkerConfig(env);
    const key = accessWorkerConfigKey(config);
    if (this.cached?.key === key) return this.cached.value;

    const value: WorkerAccessVerifiers = {
      config,
      browser: this.createVerifier(browserAccessVerifierConfig(config)),
      mcp: this.createVerifier(mcpAccessVerifierConfig(config)),
    };
    this.cached = { key, value };
    return value;
  }
}

/** Shared only by the production entrypoint; tests inject an isolated runtime. */
export const defaultWorkerAccessRuntime = new WorkerAccessRuntime();
