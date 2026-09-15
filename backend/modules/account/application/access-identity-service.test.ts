import { describe, expect, it, vi } from "vitest";
import { ApiError } from "../../../platform/http/api-error";
import type {
  ExternalIdentity,
  ExternalIdentityLink,
} from "../domain/external-identity";
import { ExternalIdentityCollisionError } from "../domain/external-identity";
import {
  AccessIdentityApplication,
  type VerifiedExternalPrincipal,
} from "./access-identity-service";

const principal: VerifiedExternalPrincipal = {
  issuer: "https://team.cloudflareaccess.com",
  subject: "google-subject-01",
  email: "alice@example.com",
};

const identity: ExternalIdentity = {
  issuer: principal.issuer,
  subject: principal.subject,
  userId: "user-01",
  verifiedEmail: principal.email,
  createdAt: "2026-08-09T12:00:00.000Z",
};

const user = {
  id: "user-01",
  username: "alice",
  password_hash: "unused",
};

function setup(options?: { identity?: ExternalIdentity | null; user?: typeof user | null }) {
  const identities = {
    find: vi.fn(async () => options?.identity === undefined ? identity : options.identity),
    listByUser: vi.fn(async () => [{
      email: identity.verifiedEmail,
      linked_at: identity.createdAt,
    }]),
    link: vi.fn(async (_input: ExternalIdentityLink) => identity),
  };
  const accounts = {
    findUserById: vi.fn(async () => options?.user === undefined ? user : options.user),
  };
  const ids = { token: vi.fn(() => "csrf-token") };
  const clock = { nowMs: vi.fn(() => 1_700_000_123_456) };
  const sessions = { issue: vi.fn(async () => "session-jwt") };
  const application = new AccessIdentityApplication({
    identities,
    accounts,
    ids,
    clock,
    sessions,
  });
  return { application, identities, accounts, ids, clock, sessions };
}

describe("AccessIdentityApplication", () => {
  it("resolves only an exact linked issuer and subject", async () => {
    const { application, identities } = setup();

    await expect(application.resolveUserId(principal)).resolves.toBe("user-01");
    expect(identities.find).toHaveBeenCalledWith({
      issuer: principal.issuer,
      subject: principal.subject,
    });
  });

  it("denies unknown identities without matching by email", async () => {
    const { application, identities, accounts } = setup({ identity: null });

    await expect(application.resolveUserId(principal)).rejects.toMatchObject({
      status: 403,
      code: "access_identity_unlinked",
    });
    expect(identities.find).toHaveBeenCalledOnce();
    expect(accounts.findUserById).not.toHaveBeenCalled();
  });

  it("links the verified principal idempotently and returns only its email snapshot", async () => {
    const { application, identities, accounts } = setup();

    await expect(application.link("user-01", principal)).resolves.toEqual({
      linked: true,
      email: "alice@example.com",
    });
    expect(accounts.findUserById).toHaveBeenCalledWith("user-01");
    expect(identities.link).toHaveBeenCalledWith({
      issuer: principal.issuer,
      subject: principal.subject,
      userId: "user-01",
      verifiedEmail: "alice@example.com",
    });
  });

  it("lists only safe linked-identity summaries for an existing account", async () => {
    const { application, identities, accounts } = setup();

    await expect(application.listLinked("user-01")).resolves.toEqual([{
      email: "alice@example.com",
      linked_at: "2026-08-09T12:00:00.000Z",
    }]);
    expect(accounts.findUserById).toHaveBeenCalledWith("user-01");
    expect(identities.listByUser).toHaveBeenCalledWith("user-01");
  });

  it("does not list identities for a deleted account", async () => {
    const { application, identities } = setup({ user: null });

    await expect(application.listLinked("deleted-user")).rejects.toMatchObject({
      status: 401,
      code: "unauthenticated",
    });
    expect(identities.listByUser).not.toHaveBeenCalled();
  });

  it("maps immutable ownership collisions without exposing the owner", async () => {
    const { application, identities } = setup();
    identities.link.mockRejectedValueOnce(new ExternalIdentityCollisionError());

    let thrown: unknown;
    try {
      await application.link("user-01", principal);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(ApiError);
    expect(thrown).toMatchObject({
      status: 409,
      code: "access_identity_conflict",
      message: "Access identity is already linked to another account",
    });
    expect(String(thrown)).not.toContain("different-user");
  });

  it("bootstraps the existing session contract for the mapped account", async () => {
    const { application, sessions, ids } = setup();

    await expect(application.bootstrapSession(principal, "jwt-secret", null)).resolves.toEqual({
      user_id: "user-01",
      username: "alice",
      csrf: "csrf-token",
      jwt: "session-jwt",
    });
    expect(ids.token).toHaveBeenCalledOnce();
    expect(sessions.issue).toHaveBeenCalledWith(
      "user-01",
      "csrf-token",
      1_700_000_123,
      "jwt-secret",
    );
  });

  it("rejects a valid but different current application session before issuing a token", async () => {
    const { application, sessions, accounts } = setup();

    await expect(
      application.bootstrapSession(principal, "jwt-secret", "user-02"),
    ).rejects.toMatchObject({ status: 409, code: "access_identity_mismatch" });
    expect(accounts.findUserById).not.toHaveBeenCalled();
    expect(sessions.issue).not.toHaveBeenCalled();
  });

  it("fails closed if the linked account no longer exists", async () => {
    const { application, sessions } = setup({ user: null });

    await expect(
      application.bootstrapSession(principal, "jwt-secret", null),
    ).rejects.toMatchObject({ status: 403, code: "access_identity_unlinked" });
    expect(sessions.issue).not.toHaveBeenCalled();
  });
});
