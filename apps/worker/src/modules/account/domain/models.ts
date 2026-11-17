/** Account persistence stays private; public projections expose only needed fields. */
export interface UserRow { id: string; username: string; password_hash: string }
export interface NewUser extends UserRow {}
export interface BasicProfile { username: string }
export interface PublicUser extends BasicProfile { user_id: string }
export interface RegisterInput { username: string; password: string }
export interface LoginInput extends RegisterInput {}
export interface RegisterResult extends PublicUser { csrf: string; jwt: string }
export interface LoginResult extends RegisterResult {}
export interface SessionUser extends PublicUser { csrf: string }

export function basicProfile(row: UserRow): BasicProfile {
  return { username: row.username }
}
export function publicUser(row: UserRow): PublicUser {
  return { user_id: row.id, ...basicProfile(row) }
}
