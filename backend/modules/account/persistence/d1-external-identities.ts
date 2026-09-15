import {
  d1ApiError,
  D1Executor,
  type D1Database,
} from '../../../platform/d1'
import type { ExternalIdentityRepository } from '../application/external-identity-repository'
import {
  ExternalIdentityCollisionError,
  type ExternalIdentity,
  type ExternalIdentityKey,
  type ExternalIdentityLink,
  type LinkedExternalIdentitySummary,
} from '../domain/external-identity'

export const INSERT_EXTERNAL_IDENTITY_SQL =
  'INSERT INTO auth_identities (issuer, subject, user_id, verified_email) ' +
  'VALUES (?1, ?2, ?3, ?4) ' +
  'ON CONFLICT(issuer, subject) DO NOTHING'

export const SELECT_EXTERNAL_IDENTITY_SQL =
  'SELECT issuer, subject, user_id, verified_email, created_at ' +
  'FROM auth_identities WHERE issuer = ?1 AND subject = ?2'

export const LIST_EXTERNAL_IDENTITIES_BY_USER_SQL =
  'SELECT verified_email, created_at ' +
  'FROM auth_identities WHERE user_id = ?1 ' +
  'ORDER BY created_at ASC, issuer ASC, subject ASC'

interface ExternalIdentityRow {
  issuer: string
  subject: string
  user_id: string
  verified_email: string | null
  created_at: string
}

function identityFromRow(row: ExternalIdentityRow): ExternalIdentity {
  return {
    issuer: row.issuer,
    subject: row.subject,
    userId: row.user_id,
    verifiedEmail: row.verified_email,
    createdAt: row.created_at,
  }
}

async function selectIdentity(
  executor: D1Executor,
  key: ExternalIdentityKey,
): Promise<ExternalIdentity | null> {
  const row = await executor.first<ExternalIdentityRow>(SELECT_EXTERNAL_IDENTITY_SQL, [
    key.issuer,
    key.subject,
  ])
  return row === null ? null : identityFromRow(row)
}

/** D1 adapter whose insert-first sequence makes identity ownership immutable. */
export class D1ExternalIdentityRepository implements ExternalIdentityRepository {
  private readonly executor: D1Executor

  constructor(db: D1Database) {
    this.executor = new D1Executor(db)
  }

  find(key: ExternalIdentityKey): Promise<ExternalIdentity | null> {
    return selectIdentity(this.executor, key)
  }

  async listByUser(userId: string): Promise<LinkedExternalIdentitySummary[]> {
    const rows = await this.executor.all<{
      verified_email: string | null
      created_at: string
    }>(LIST_EXTERNAL_IDENTITIES_BY_USER_SQL, [userId])
    return rows.map((row) => ({
      email: row.verified_email,
      linked_at: row.created_at,
    }))
  }

  async link(input: ExternalIdentityLink): Promise<ExternalIdentity> {
    // The composite primary key selects one winner under concurrent links. A
    // retry never updates user_id or the optional email snapshot.
    try {
      await this.executor.run(INSERT_EXTERNAL_IDENTITY_SQL, [
        input.issuer,
        input.subject,
        input.userId,
        input.verifiedEmail,
      ])
    } catch (error) {
      if (error instanceof Error && 'status' in error) throw error
      throw d1ApiError('d1_run_failed', error)
    }

    const identity = await selectIdentity(this.executor, input)
    if (identity === null) {
      throw d1ApiError('d1_query_failed', 'external identity missing after link')
    }
    if (identity.userId !== input.userId) {
      throw new ExternalIdentityCollisionError()
    }
    return identity
  }
}

export function createD1ExternalIdentityRepository(
  db: D1Database,
): ExternalIdentityRepository {
  return new D1ExternalIdentityRepository(db)
}
