import { and, asc, eq } from 'drizzle-orm'
import { createDatabase, d1ApiError, executeD1, type Database, type D1Database } from '../../../platform/d1'
import type { ExternalIdentityRepository } from '../application/external-identity-repository'
import {
  ExternalIdentityCollisionError,
  type ExternalIdentity,
  type ExternalIdentityKey,
  type ExternalIdentityLink,
  type LinkedExternalIdentitySummary,
} from '../domain/external-identity'
import { authIdentities } from './schema'

/** The composite primary key makes identity ownership immutable under retries. */
export class D1ExternalIdentityRepository implements ExternalIdentityRepository {
  private readonly db: Database

  constructor(binding: D1Database) { this.db = createDatabase(binding) }

  async find(key: ExternalIdentityKey): Promise<ExternalIdentity | null> {
    return (await executeD1('query', () => this.db.select().from(authIdentities).where(and(
      eq(authIdentities.issuer, key.issuer), eq(authIdentities.subject, key.subject),
    )).get())) ?? null
  }

  listByUser(userId: string): Promise<LinkedExternalIdentitySummary[]> {
    return executeD1('query', () => this.db.select({
      email: authIdentities.verifiedEmail, linked_at: authIdentities.createdAt,
    }).from(authIdentities).where(eq(authIdentities.userId, userId))
      .orderBy(asc(authIdentities.createdAt), asc(authIdentities.issuer), asc(authIdentities.subject)).all())
  }

  async link(input: ExternalIdentityLink): Promise<ExternalIdentity> {
    // A retry never changes the owner or the optional email snapshot.
    await executeD1('run', () => this.db.insert(authIdentities).values(input)
      .onConflictDoNothing({ target: [authIdentities.issuer, authIdentities.subject] }).run())
    const identity = await this.find(input)
    if (identity === null) throw d1ApiError('d1_query_failed', 'external identity missing after link')
    if (identity.userId !== input.userId) throw new ExternalIdentityCollisionError()
    return identity
  }
}

export function createD1ExternalIdentityRepository(db: D1Database): ExternalIdentityRepository {
  return new D1ExternalIdentityRepository(db)
}
