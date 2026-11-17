import {
  createLocalJWKSet,
  decodeProtectedHeader,
  jwtVerify,
  type JSONWebKeySet,
  type JWTPayload,
  type LocalJWKSet,
} from "jose";

import { ApiError } from "../http/api-error";

export const ACCESS_ASSERTION_HEADER = "Cf-Access-Jwt-Assertion";

const RS256 = "RS256";
const DEFAULT_CLOCK_SKEW_SECONDS = 30;
const DEFAULT_JWKS_CACHE_TTL_SECONDS = 300;
const DEFAULT_JWKS_FETCH_TIMEOUT_MS = 3_000;
const DEFAULT_MAX_ASSERTION_BYTES = 16 * 1024;
const DEFAULT_MAX_JWKS_BYTES = 128 * 1024;
const DEFAULT_MAX_JWKS_KEYS = 16;

export interface AccessPrincipal {
  readonly issuer: string;
  readonly subject: string;
  readonly email: string | null;
}

/**
 * Pinned trust inputs for one Cloudflare Access application audience.
 *
 * Browser and MCP callers should receive separate verifier instances so a
 * caller cannot choose which audience to accept from request-controlled data.
 */
export interface AccessAssertionVerifierConfig {
  readonly issuer: string;
  readonly audience: string;
  readonly jwksUrl: string;
  readonly clockSkewSeconds?: number;
  readonly jwksCacheTtlSeconds?: number;
  readonly jwksFetchTimeoutMs?: number;
  readonly maxAssertionBytes?: number;
  readonly maxJwksBytes?: number;
  readonly maxJwksKeys?: number;
}

export type AccessJwksFetch = (url: string, init: RequestInit) => Promise<Response>;

export interface AccessAssertionVerifierDependencies {
  /** Returns Unix epoch seconds. */
  readonly now?: () => number;
  readonly fetchJwks?: AccessJwksFetch;
}

export interface AccessAssertionVerifier {
  verify(request: Pick<Request, "headers">): Promise<AccessPrincipal>;
}

interface NormalizedConfig {
  readonly issuer: string;
  readonly audience: string;
  readonly jwksUrl: string;
  readonly clockSkewSeconds: number;
  readonly jwksCacheTtlSeconds: number;
  readonly jwksFetchTimeoutMs: number;
  readonly maxAssertionBytes: number;
  readonly maxJwksBytes: number;
  readonly maxJwksKeys: number;
}

interface CachedResolver {
  readonly resolver: LocalJWKSet;
  readonly expiresAt: number;
  readonly generation: number;
}

function invalidAssertion(): ApiError {
  return ApiError.unauthorized("access_unauthenticated", "invalid Access assertion");
}

function invalidConfiguration(): ApiError {
  return ApiError.internal(
    "server_misconfigured",
    "Access authentication is not configured",
  );
}

function jwksUnavailable(): ApiError {
  return new ApiError(
    503,
    "access_auth_unavailable",
    "Access authentication is temporarily unavailable",
  );
}

function requireBoundedInteger(
  value: number | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved < minimum || resolved > maximum) {
    throw invalidConfiguration();
  }
  return resolved;
}

function secureUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw invalidConfiguration();
  }
  if (
    url.protocol !== "https:" ||
    url.username !== "" ||
    url.password !== "" ||
    url.search !== "" ||
    url.hash !== ""
  ) {
    throw invalidConfiguration();
  }
  return url;
}

function safePinnedString(value: unknown, maximumLength: number): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= maximumLength &&
    value.trim() === value &&
    !/[\u0000-\u001f\u007f]/.test(value)
  );
}

function normalizeConfig(config: AccessAssertionVerifierConfig): NormalizedConfig {
  if (
    !safePinnedString(config.issuer, 2_048) ||
    !safePinnedString(config.audience, 2_048) ||
    !safePinnedString(config.jwksUrl, 2_048)
  ) {
    throw invalidConfiguration();
  }

  const issuer = secureUrl(config.issuer);
  const jwks = secureUrl(config.jwksUrl);
  if (issuer.origin !== jwks.origin) throw invalidConfiguration();

  return {
    issuer: config.issuer,
    audience: config.audience,
    jwksUrl: config.jwksUrl,
    clockSkewSeconds: requireBoundedInteger(
      config.clockSkewSeconds,
      DEFAULT_CLOCK_SKEW_SECONDS,
      0,
      120,
    ),
    jwksCacheTtlSeconds: requireBoundedInteger(
      config.jwksCacheTtlSeconds,
      DEFAULT_JWKS_CACHE_TTL_SECONDS,
      1,
      3_600,
    ),
    jwksFetchTimeoutMs: requireBoundedInteger(
      config.jwksFetchTimeoutMs,
      DEFAULT_JWKS_FETCH_TIMEOUT_MS,
      100,
      10_000,
    ),
    maxAssertionBytes: requireBoundedInteger(
      config.maxAssertionBytes,
      DEFAULT_MAX_ASSERTION_BYTES,
      1_024,
      64 * 1024,
    ),
    maxJwksBytes: requireBoundedInteger(
      config.maxJwksBytes,
      DEFAULT_MAX_JWKS_BYTES,
      1_024,
      1024 * 1024,
    ),
    maxJwksKeys: requireBoundedInteger(
      config.maxJwksKeys,
      DEFAULT_MAX_JWKS_KEYS,
      1,
      64,
    ),
  };
}

function assertionFrom(headers: Headers, maximumBytes: number): string {
  const assertion = headers.get(ACCESS_ASSERTION_HEADER);
  if (
    assertion === null ||
    assertion.includes(",") ||
    assertion.length > maximumBytes ||
    new TextEncoder().encode(assertion).byteLength > maximumBytes ||
    !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(assertion)
  ) {
    throw invalidAssertion();
  }
  return assertion;
}

function validateProtectedHeader(assertion: string): void {
  let header: ReturnType<typeof decodeProtectedHeader>;
  try {
    header = decodeProtectedHeader(assertion);
  } catch {
    throw invalidAssertion();
  }
  if (
    header.alg !== RS256 ||
    typeof header.kid !== "string" ||
    !safePinnedString(header.kid, 256)
  ) {
    throw invalidAssertion();
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isBase64Url(value: unknown, minimumLength: number, maximumLength: number): value is string {
  return (
    typeof value === "string" &&
    value.length >= minimumLength &&
    value.length <= maximumLength &&
    /^[A-Za-z0-9_-]+$/.test(value)
  );
}

function validateJwks(value: unknown, maximumKeys: number): JSONWebKeySet {
  if (!isRecord(value) || !Array.isArray(value.keys)) throw jwksUnavailable();
  if (value.keys.length === 0 || value.keys.length > maximumKeys) throw jwksUnavailable();

  const seenKids = new Set<string>();
  for (const candidate of value.keys) {
    if (!isRecord(candidate)) throw jwksUnavailable();
    if (
      candidate.kty !== "RSA" ||
      (candidate.alg !== undefined && candidate.alg !== RS256) ||
      (candidate.use !== undefined && candidate.use !== "sig") ||
      typeof candidate.kid !== "string" ||
      !safePinnedString(candidate.kid, 256) ||
      !isBase64Url(candidate.n, 342, 2_048) ||
      !isBase64Url(candidate.e, 2, 16) ||
      candidate.d !== undefined ||
      candidate.p !== undefined ||
      candidate.q !== undefined ||
      candidate.dp !== undefined ||
      candidate.dq !== undefined ||
      candidate.qi !== undefined ||
      candidate.k !== undefined
    ) {
      throw jwksUnavailable();
    }
    if (seenKids.has(candidate.kid)) throw jwksUnavailable();
    seenKids.add(candidate.kid);
  }

  return value as unknown as JSONWebKeySet;
}

async function readBoundedJson(response: Response, maximumBytes: number): Promise<unknown> {
  const declaredLength = response.headers.get("content-length");
  if (declaredLength !== null) {
    const parsedLength = Number(declaredLength);
    if (!Number.isSafeInteger(parsedLength) || parsedLength < 0 || parsedLength > maximumBytes) {
      throw jwksUnavailable();
    }
  }

  if (response.body === null) throw jwksUnavailable();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const result = await reader.read();
    if (result.done) break;
    total += result.value.byteLength;
    if (total > maximumBytes) {
      await reader.cancel();
      throw jwksUnavailable();
    }
    chunks.push(result.value);
  }

  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }

  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(body);
    return JSON.parse(text) as unknown;
  } catch {
    throw jwksUnavailable();
  }
}

function isUnknownKey(error: unknown): boolean {
  return (
    isRecord(error) &&
    error.code === "ERR_JWKS_NO_MATCHING_KEY"
  );
}

function safeNumericDate(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function validateAudience(value: unknown, expected: string): boolean {
  if (typeof value === "string") return value === expected;
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.length <= 16 &&
    value.every((entry) => typeof entry === "string" && safePinnedString(entry, 2_048)) &&
    value.includes(expected)
  );
}

function principalFrom(
  payload: JWTPayload,
  config: NormalizedConfig,
  currentEpochSeconds: number,
): AccessPrincipal {
  if (
    payload.iss !== config.issuer ||
    !validateAudience(payload.aud, config.audience) ||
    typeof payload.sub !== "string" ||
    !safePinnedString(payload.sub, 512) ||
    !safeNumericDate(payload.exp) ||
    (payload.nbf !== undefined &&
      (!safeNumericDate(payload.nbf) || payload.nbf > payload.exp)) ||
    (payload.iat !== undefined &&
      (!safeNumericDate(payload.iat) ||
        payload.iat > payload.exp ||
        payload.iat > currentEpochSeconds + config.clockSkewSeconds))
  ) {
    throw invalidAssertion();
  }

  const email = payload.email;
  if (
    email !== undefined &&
    (typeof email !== "string" || !safePinnedString(email, 320))
  ) {
    throw invalidAssertion();
  }

  return {
    issuer: config.issuer,
    subject: payload.sub,
    email: email ?? null,
  };
}

class JoseAccessAssertionVerifier implements AccessAssertionVerifier {
  private cache: CachedResolver | undefined;
  private loadInFlight: Promise<CachedResolver> | undefined;
  private generation = 0;

  constructor(
    private readonly config: NormalizedConfig,
    private readonly now: () => number,
    private readonly fetchJwks: AccessJwksFetch,
  ) {}

  async verify(request: Pick<Request, "headers">): Promise<AccessPrincipal> {
    const assertion = assertionFrom(request.headers, this.config.maxAssertionBytes);
    validateProtectedHeader(assertion);

    const cached = await this.getResolver();
    try {
      return principalFrom(
        await this.verifyWith(assertion, cached.resolver),
        this.config,
        this.currentEpochSeconds(),
      );
    } catch (error) {
      if (error instanceof ApiError) throw error;
      if (!isUnknownKey(error)) throw invalidAssertion();
    }

    const refreshed = await this.getResolver(cached.generation);
    try {
      return principalFrom(
        await this.verifyWith(assertion, refreshed.resolver),
        this.config,
        this.currentEpochSeconds(),
      );
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw invalidAssertion();
    }
  }

  private currentEpochSeconds(): number {
    const current = this.now();
    if (!Number.isSafeInteger(current) || current < 0) throw invalidConfiguration();
    return current;
  }

  private async verifyWith(assertion: string, resolver: LocalJWKSet): Promise<JWTPayload> {
    const result = await jwtVerify(assertion, resolver, {
      algorithms: [RS256],
      issuer: this.config.issuer,
      audience: this.config.audience,
      requiredClaims: ["iss", "aud", "sub", "exp"],
      currentDate: new Date(this.currentEpochSeconds() * 1_000),
      clockTolerance: this.config.clockSkewSeconds,
    });
    return result.payload;
  }

  /**
   * Passing a generation requests one rotation refresh. If another request
   * already replaced that generation, its result is reused instead.
   */
  private async getResolver(staleGeneration?: number): Promise<CachedResolver> {
    const now = this.currentEpochSeconds();
    if (this.cache !== undefined) {
      if (staleGeneration !== undefined && this.cache.generation > staleGeneration) {
        return this.cache;
      }
      if (staleGeneration === undefined && now < this.cache.expiresAt) return this.cache;
    }
    if (this.loadInFlight !== undefined) return this.loadInFlight;

    const load = this.loadResolver(now);
    this.loadInFlight = load;
    try {
      return await load;
    } finally {
      if (this.loadInFlight === load) this.loadInFlight = undefined;
    }
  }

  private async loadResolver(fetchedAt: number): Promise<CachedResolver> {
    try {
      const response = await this.fetchWithTimeout();
      if (!response.ok) throw jwksUnavailable();
      const jwks = validateJwks(
        await readBoundedJson(response, this.config.maxJwksBytes),
        this.config.maxJwksKeys,
      );
      const cached: CachedResolver = {
        resolver: createLocalJWKSet(jwks),
        expiresAt: fetchedAt + this.config.jwksCacheTtlSeconds,
        generation: this.generation + 1,
      };
      this.generation = cached.generation;
      this.cache = cached;
      return cached;
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw jwksUnavailable();
    }
  }

  private async fetchWithTimeout(): Promise<Response> {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(jwksUnavailable());
      }, this.config.jwksFetchTimeoutMs);
    });
    try {
      return await Promise.race([
        this.fetchJwks(this.config.jwksUrl, {
          method: "GET",
          headers: { Accept: "application/json" },
          // Cloudflare Workers implements only `follow` and `manual`; using
          // `error` throws before the request is sent. Manual mode preserves
          // fail-closed behavior because loadResolver rejects every non-2xx
          // response, including redirects.
          redirect: "manual",
          signal: controller.signal,
        }),
        timeout,
      ]);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }
}

export function createAccessAssertionVerifier(
  config: AccessAssertionVerifierConfig,
  dependencies: AccessAssertionVerifierDependencies = {},
): AccessAssertionVerifier {
  const normalized = normalizeConfig(config);
  const now = dependencies.now ?? (() => Math.floor(Date.now() / 1_000));
  const fetchJwks =
    dependencies.fetchJwks ??
    ((url: string, init: RequestInit) => globalThis.fetch(url, init));
  if (typeof now !== "function" || typeof fetchJwks !== "function") {
    throw invalidConfiguration();
  }
  return new JoseAccessAssertionVerifier(normalized, now, fetchJwks);
}
