import { exportJWK, generateKeyPair, SignJWT, type JWK } from "jose";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { ApiError } from "../http/api-error";
import {
  ACCESS_ASSERTION_HEADER,
  createAccessAssertionVerifier,
  type AccessAssertionVerifierConfig,
  type AccessJwksFetch,
} from "./access";

const NOW = 1_800_000_000;
const ISSUER = "https://team.cloudflareaccess.com";
const JWKS_URL = `${ISSUER}/cdn-cgi/access/certs`;
const MCP_AUDIENCE = "mcp-audience";
const BROWSER_AUDIENCE = "browser-audience";

interface SigningKey {
  readonly kid: string;
  readonly privateKey: CryptoKey;
  readonly publicJwk: JWK;
}

let firstKey: SigningKey;
let rotatedKey: SigningKey;

beforeAll(async () => {
  firstKey = await signingKey("first-key");
  rotatedKey = await signingKey("rotated-key");
});

async function signingKey(kid: string): Promise<SigningKey> {
  const pair = await generateKeyPair("RS256", { extractable: true });
  const publicJwk = await exportJWK(pair.publicKey);
  return {
    kid,
    privateKey: pair.privateKey,
    publicJwk: { ...publicJwk, kid, alg: "RS256", use: "sig" },
  };
}

function config(overrides: Partial<AccessAssertionVerifierConfig> = {}): AccessAssertionVerifierConfig {
  return {
    issuer: ISSUER,
    audience: MCP_AUDIENCE,
    jwksUrl: JWKS_URL,
    ...overrides,
  };
}

function jwksResponse(keys: readonly JWK[], status = 200): Response {
  return new Response(JSON.stringify({ keys }), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function requestWith(assertion?: string): Request {
  const headers = new Headers();
  if (assertion !== undefined) headers.set(ACCESS_ASSERTION_HEADER, assertion);
  return new Request("https://app.example.com/mcp", { headers });
}

function verifier(fetchJwks: AccessJwksFetch, overrides: Partial<AccessAssertionVerifierConfig> = {}) {
  return createAccessAssertionVerifier(config(overrides), {
    now: () => NOW,
    fetchJwks,
  });
}

async function token(
  key: SigningKey = firstKey,
  payload: Record<string, unknown> = {},
  protectedHeader: { alg: string; kid?: string; jku?: string } = {
    alg: "RS256",
    kid: key.kid,
  },
): Promise<string> {
  return new SignJWT({
    iss: ISSUER,
    aud: MCP_AUDIENCE,
    sub: "access-subject-01",
    email: "athlete@example.com",
    iat: NOW - 60,
    exp: NOW + 300,
    ...payload,
  })
    .setProtectedHeader(protectedHeader)
    .sign(key.privateKey);
}

function expectInvalid(result: Promise<unknown>): Promise<unknown> {
  return expect(result).rejects.toEqual(
    expect.objectContaining({
      status: 401,
      code: "access_unauthenticated",
      message: "invalid Access assertion",
    }),
  );
}

describe("Cloudflare Access assertion verifier", () => {
  it("verifies an RS256 assertion and returns only the stable principal snapshot", async () => {
    const fetchJwks = vi.fn<AccessJwksFetch>(async () => jwksResponse([firstKey.publicJwk]));
    const principal = await verifier(fetchJwks).verify(requestWith(await token()));

    expect(principal).toEqual({
      issuer: ISSUER,
      subject: "access-subject-01",
      email: "athlete@example.com",
    });
    expect(fetchJwks).toHaveBeenCalledWith(
      JWKS_URL,
      expect.objectContaining({ method: "GET", redirect: "manual" }),
    );
  });

  it("accepts the exact configured audience in either string or array form", async () => {
    const fetchJwks = vi.fn<AccessJwksFetch>(async () => jwksResponse([firstKey.publicJwk]));
    const access = verifier(fetchJwks);

    await expect(access.verify(requestWith(await token()))).resolves.toMatchObject({
      subject: "access-subject-01",
    });
    await expect(
      access.verify(requestWith(await token(firstKey, { aud: [BROWSER_AUDIENCE, MCP_AUDIENCE] }))),
    ).resolves.toMatchObject({ subject: "access-subject-01" });
    expect(fetchJwks).toHaveBeenCalledTimes(1);
  });

  it("represents an absent optional email snapshot as null", async () => {
    const fetchJwks = vi.fn<AccessJwksFetch>(async () => jwksResponse([firstKey.publicJwk]));
    const principal = await verifier(fetchJwks).verify(
      requestWith(await token(firstKey, { email: undefined })),
    );

    expect(principal.email).toBeNull();
  });

  it("never selects keys from a token-controlled URL", async () => {
    const fetchJwks = vi.fn<AccessJwksFetch>(async () => jwksResponse([firstKey.publicJwk]));
    const assertion = await token(firstKey, {}, {
      alg: "RS256",
      kid: firstKey.kid,
      jku: "https://attacker.example.com/keys",
    });

    await expect(verifier(fetchJwks).verify(requestWith(assertion))).resolves.toBeDefined();
    expect(fetchJwks).toHaveBeenCalledWith(JWKS_URL, expect.any(Object));
  });

  it("rejects missing, coalesced duplicate, malformed, and oversized assertions before JWKS work", async () => {
    const fetchJwks = vi.fn<AccessJwksFetch>(async () => jwksResponse([firstKey.publicJwk]));
    const access = verifier(fetchJwks);
    const valid = await token();
    const duplicateHeaders = new Headers([
      [ACCESS_ASSERTION_HEADER, valid],
      [ACCESS_ASSERTION_HEADER, valid],
    ]);

    await expectInvalid(access.verify(requestWith()));
    await expectInvalid(
      access.verify({ headers: duplicateHeaders }),
    );
    await expectInvalid(access.verify(requestWith("not-a-jwt")));
    await expectInvalid(access.verify(requestWith(`a.${"b".repeat(17_000)}.c`)));
    expect(fetchJwks).not.toHaveBeenCalled();
  });

  it("rejects tampering without exposing verification details", async () => {
    const fetchJwks = vi.fn<AccessJwksFetch>(async () => jwksResponse([firstKey.publicJwk]));
    const signed = await token();
    const [header, payload, signature] = signed.split(".");
    const tampered = `${header}.${payload?.slice(0, -1)}A.${signature}`;

    await expectInvalid(verifier(fetchJwks).verify(requestWith(tampered)));
  });

  it("rejects non-RS256 and missing-kid headers before fetching keys", async () => {
    const fetchJwks = vi.fn<AccessJwksFetch>(async () => jwksResponse([firstKey.publicJwk]));
    const symmetric = new TextEncoder().encode("a-secret-that-is-at-least-32-bytes-long");
    const hs256 = await new SignJWT({
      iss: ISSUER,
      aud: MCP_AUDIENCE,
      sub: "subject",
      exp: NOW + 60,
    })
      .setProtectedHeader({ alg: "HS256", kid: firstKey.kid })
      .sign(symmetric);

    await expectInvalid(verifier(fetchJwks).verify(requestWith(hs256)));
    await expectInvalid(
      verifier(fetchJwks).verify(requestWith(await token(firstKey, {}, { alg: "RS256" }))),
    );
    expect(fetchJwks).not.toHaveBeenCalled();
  });

  it("rejects wrong issuer and exact-audience mismatches, including arrays", async () => {
    const fetchJwks = vi.fn<AccessJwksFetch>(async () => jwksResponse([firstKey.publicJwk]));
    const access = verifier(fetchJwks);

    await expectInvalid(
      access.verify(requestWith(await token(firstKey, { iss: "https://other.example.com" }))),
    );
    await expectInvalid(
      access.verify(requestWith(await token(firstKey, { aud: BROWSER_AUDIENCE }))),
    );
    await expectInvalid(
      access.verify(requestWith(await token(firstKey, { aud: [BROWSER_AUDIENCE] }))),
    );
  });

  it("enforces exp and nbf with only the configured small clock skew", async () => {
    const fetchJwks = vi.fn<AccessJwksFetch>(async () => jwksResponse([firstKey.publicJwk]));
    const access = verifier(fetchJwks);

    await expect(
      access.verify(requestWith(await token(firstKey, { exp: NOW - 29 }))),
    ).resolves.toMatchObject({ subject: "access-subject-01" });
    await expectInvalid(access.verify(requestWith(await token(firstKey, { exp: NOW - 31 }))));
    await expect(
      access.verify(requestWith(await token(firstKey, { nbf: NOW + 29 }))),
    ).resolves.toMatchObject({ subject: "access-subject-01" });
    await expectInvalid(access.verify(requestWith(await token(firstKey, { nbf: NOW + 31 }))));
  });

  it("rejects absent, empty, wrongly typed, or unsafe identity/time claims", async () => {
    const fetchJwks = vi.fn<AccessJwksFetch>(async () => jwksResponse([firstKey.publicJwk]));
    const access = verifier(fetchJwks);

    for (const payload of [
      { sub: "" },
      { sub: "   " },
      { sub: 42 },
      { email: ["athlete@example.com"] },
      { exp: Number.MAX_SAFE_INTEGER + 1 },
      { nbf: -1 },
      { nbf: NOW + 200, exp: NOW + 100 },
      { iat: NOW + 31 },
      { iat: NOW + 100, exp: NOW + 50 },
    ]) {
      await expectInvalid(access.verify(requestWith(await token(firstKey, payload))));
    }

    const noSubject = await new SignJWT({
      iss: ISSUER,
      aud: MCP_AUDIENCE,
      exp: NOW + 60,
    })
      .setProtectedHeader({ alg: "RS256", kid: firstKey.kid })
      .sign(firstKey.privateKey);
    await expectInvalid(access.verify(requestWith(noSubject)));
  });

  it("refreshes once for an unknown kid and accepts a rotated key", async () => {
    const fetchJwks = vi
      .fn<AccessJwksFetch>()
      .mockResolvedValueOnce(jwksResponse([firstKey.publicJwk]))
      .mockResolvedValueOnce(jwksResponse([rotatedKey.publicJwk]));
    const access = verifier(fetchJwks);

    await expect(access.verify(requestWith(await token()))).resolves.toBeDefined();
    await expect(access.verify(requestWith(await token(rotatedKey)))).resolves.toMatchObject({
      subject: "access-subject-01",
    });
    expect(fetchJwks).toHaveBeenCalledTimes(2);
  });

  it("rejects an unknown key after exactly one forced refresh", async () => {
    const fetchJwks = vi.fn<AccessJwksFetch>(async () => jwksResponse([firstKey.publicJwk]));
    const access = verifier(fetchJwks);

    await expectInvalid(access.verify(requestWith(await token(rotatedKey))));
    expect(fetchJwks).toHaveBeenCalledTimes(2);
  });

  it("single-flights initial and rotation JWKS retrieval", async () => {
    let releaseInitial: ((response: Response) => void) | undefined;
    const initial = new Promise<Response>((resolve) => {
      releaseInitial = resolve;
    });
    const fetchJwks = vi
      .fn<AccessJwksFetch>()
      .mockImplementationOnce(async () => initial)
      .mockResolvedValue(jwksResponse([rotatedKey.publicJwk]));
    const access = verifier(fetchJwks);
    const firstAssertion = await token();
    const firstVerification = access.verify(requestWith(firstAssertion));
    const secondVerification = access.verify(requestWith(firstAssertion));

    await vi.waitFor(() => expect(fetchJwks).toHaveBeenCalledTimes(1));
    releaseInitial?.(jwksResponse([firstKey.publicJwk]));
    await expect(Promise.all([firstVerification, secondVerification])).resolves.toHaveLength(2);

    const rotatedAssertion = await token(rotatedKey);
    await expect(
      Promise.all([
        access.verify(requestWith(rotatedAssertion)),
        access.verify(requestWith(rotatedAssertion)),
      ]),
    ).resolves.toHaveLength(2);
    expect(fetchJwks).toHaveBeenCalledTimes(2);
  });

  it("uses cached keys only within the bounded TTL", async () => {
    let now = NOW;
    const fetchJwks = vi.fn<AccessJwksFetch>(async () => jwksResponse([firstKey.publicJwk]));
    const access = createAccessAssertionVerifier(config({ jwksCacheTtlSeconds: 60 }), {
      now: () => now,
      fetchJwks,
    });
    const assertion = await token();

    await access.verify(requestWith(assertion));
    now += 59;
    await access.verify(requestWith(assertion));
    expect(fetchJwks).toHaveBeenCalledTimes(1);
    now += 1;
    await access.verify(requestWith(assertion));
    expect(fetchJwks).toHaveBeenCalledTimes(2);
  });

  it("fails closed with a generic temporary error for JWKS outage and unsafe JWKS", async () => {
    const outage = vi.fn<AccessJwksFetch>(async () => {
      throw new Error("upstream secret detail");
    });
    const unsafe = vi.fn<AccessJwksFetch>(async () => jwksResponse([]));
    const redirect = vi.fn<AccessJwksFetch>(async () =>
      new Response(null, {
        status: 302,
        headers: { location: "https://attacker.example.com/keys" },
      }),
    );
    const assertion = await token();
    const expected = expect.objectContaining({
      status: 503,
      code: "access_auth_unavailable",
      message: "Access authentication is temporarily unavailable",
    });

    await expect(verifier(outage).verify(requestWith(assertion))).rejects.toEqual(expected);
    await expect(verifier(unsafe).verify(requestWith(assertion))).rejects.toEqual(expected);
    await expect(verifier(redirect).verify(requestWith(assertion))).rejects.toEqual(expected);
  });

  it("fails closed when rotation refresh cannot reach JWKS", async () => {
    const fetchJwks = vi
      .fn<AccessJwksFetch>()
      .mockResolvedValueOnce(jwksResponse([firstKey.publicJwk]))
      .mockRejectedValueOnce(new Error("private network detail"));
    const access = verifier(fetchJwks);

    await expect(access.verify(requestWith(await token()))).resolves.toBeDefined();
    await expect(access.verify(requestWith(await token(rotatedKey)))).rejects.toEqual(
      expect.objectContaining({
        status: 503,
        code: "access_auth_unavailable",
        message: "Access authentication is temporarily unavailable",
      }),
    );
  });

  it("rejects unsafe verifier configuration without echoing configured values", () => {
    for (const unsafeConfig of [
      config({ issuer: undefined as unknown as string }),
      config({ issuer: "http://team.cloudflareaccess.com" }),
      config({ jwksUrl: "https://evil.example.com/certs" }),
      config({ audience: "" }),
      config({ clockSkewSeconds: 121 }),
    ]) {
      expect(() => createAccessAssertionVerifier(unsafeConfig)).toThrowError(
        new ApiError(500, "server_misconfigured", "Access authentication is not configured"),
      );
    }
  });
});
