import type { BasicProfile } from '../domain/models'

/** Minimal Account-owned read seam available to an authenticated MCP principal. */
export interface AccountProfileReadCapability {
  getBasicProfile(userId: string): Promise<BasicProfile>
}

export type { BasicProfile }
