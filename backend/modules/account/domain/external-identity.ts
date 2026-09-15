/** Exact, provider-scoped key from a verified external identity assertion. */
export interface ExternalIdentityKey {
  readonly issuer: string
  readonly subject: string
}

/** Durable Account-owned mapping. Email is display/audit metadata, never a key. */
export interface ExternalIdentity extends ExternalIdentityKey {
  readonly userId: string
  readonly verifiedEmail: string | null
  readonly createdAt: string
}

/** Candidate mapping accepted only after the caller has verified the identity. */
export interface ExternalIdentityLink extends ExternalIdentityKey {
  readonly userId: string
  readonly verifiedEmail: string | null
}

/** Safe, user-facing projection. Provider ownership keys never leave Account. */
export interface LinkedExternalIdentitySummary {
  readonly email: string | null
  readonly linked_at: string
}

/** Raised when an immutable external identity already belongs to another user. */
export class ExternalIdentityCollisionError extends Error {
  constructor() {
    super('external identity already linked')
    this.name = 'ExternalIdentityCollisionError'
    Object.setPrototypeOf(this, new.target.prototype)
  }
}
