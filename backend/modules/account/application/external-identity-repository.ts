import type {
  ExternalIdentity,
  ExternalIdentityKey,
  ExternalIdentityLink,
  LinkedExternalIdentitySummary,
} from '../domain/external-identity'

/** Account-owned persistence port for immutable external identity ownership. */
export interface ExternalIdentityRepository {
  find(key: ExternalIdentityKey): Promise<ExternalIdentity | null>
  listByUser(userId: string): Promise<LinkedExternalIdentitySummary[]>

  /**
   * Atomically claims an unlinked provider identity.
   *
   * Repeating the same mapping is idempotent and returns the original durable
   * row, including its original email snapshot. A different owner is rejected.
   */
  link(input: ExternalIdentityLink): Promise<ExternalIdentity>
}
