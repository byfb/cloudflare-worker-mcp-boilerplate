import { ApiError } from "../../../platform/http/api-error";
import type { ExternalIdentityRepository } from "./external-identity-repository";
import type { AccountRepository, SessionIssuer } from "./ports";
import type { AccountClock, AccountIds, LoginPlan } from "./service";
import { PlatformSessionIssuer } from "./service";
import { publicUser } from "../domain/models";
import { ExternalIdentityCollisionError } from "../domain/external-identity";
import type { LinkedExternalIdentitySummary } from "../domain/external-identity";

/** Verified provider identity after platform Access JWT validation. */
export interface VerifiedExternalPrincipal {
  readonly issuer: string;
  readonly subject: string;
  readonly email: string | null;
}

export interface AccessIdentityApplicationDependencies {
  readonly identities: ExternalIdentityRepository;
  readonly accounts: Pick<AccountRepository, "findUserById">;
  readonly ids: Pick<AccountIds, "token">;
  readonly clock: AccountClock;
  readonly sessions?: SessionIssuer;
}

export interface LinkedExternalIdentity {
  readonly linked: true;
  readonly email: string | null;
}

function nowSeconds(clock: AccountClock): number {
  return Math.floor(clock.nowMs() / 1_000);
}

/**
 * Account-owned external identity use cases.
 *
 * Callers may supply only a principal that has already passed the platform
 * Access verifier. The stable provider subject selects ownership; email is
 * retained only as non-authoritative display/audit metadata.
 */
export class AccessIdentityApplication {
  private readonly sessions: SessionIssuer;

  constructor(private readonly deps: AccessIdentityApplicationDependencies) {
    this.sessions = deps.sessions ?? new PlatformSessionIssuer();
  }

  async resolveUserId(principal: VerifiedExternalPrincipal): Promise<string> {
    const identity = await this.deps.identities.find({
      issuer: principal.issuer,
      subject: principal.subject,
    });
    if (identity === null) {
      throw ApiError.forbidden(
        "access_identity_unlinked",
        "Access identity is not linked to an account",
      );
    }
    return identity.userId;
  }

  async link(
    userId: string,
    principal: VerifiedExternalPrincipal,
  ): Promise<LinkedExternalIdentity> {
    const user = await this.deps.accounts.findUserById(userId);
    if (user === null) {
      throw ApiError.unauthorized("unauthenticated", "user no longer exists");
    }

    try {
      const identity = await this.deps.identities.link({
        issuer: principal.issuer,
        subject: principal.subject,
        userId,
        verifiedEmail: principal.email,
      });
      return { linked: true, email: identity.verifiedEmail };
    } catch (error) {
      if (error instanceof ExternalIdentityCollisionError) {
        throw ApiError.conflict(
          "access_identity_conflict",
          "Access identity is already linked to another account",
        );
      }
      throw error;
    }
  }

  async listLinked(userId: string): Promise<LinkedExternalIdentitySummary[]> {
    const user = await this.deps.accounts.findUserById(userId);
    if (user === null) {
      throw ApiError.unauthorized("unauthenticated", "user no longer exists");
    }
    return this.deps.identities.listByUser(userId);
  }

  async bootstrapSession(
    principal: VerifiedExternalPrincipal,
    secret: string,
    existingSessionUserId: string | null,
  ): Promise<LoginPlan> {
    const userId = await this.resolveUserId(principal);
    if (existingSessionUserId !== null && existingSessionUserId !== userId) {
      throw ApiError.conflict(
        "access_identity_mismatch",
        "Access identity does not match the current session",
      );
    }

    const user = await this.deps.accounts.findUserById(userId);
    if (user === null) {
      throw ApiError.forbidden(
        "access_identity_unlinked",
        "Access identity is not linked to an account",
      );
    }

    const csrf = this.deps.ids.token();
    const jwt = await this.sessions.issue(
      user.id,
      csrf,
      nowSeconds(this.deps.clock),
      secret,
    );
    return { ...publicUser(user), csrf, jwt };
  }
}

export function createAccessIdentityApplication(
  dependencies: AccessIdentityApplicationDependencies,
): AccessIdentityApplication {
  return new AccessIdentityApplication(dependencies);
}
