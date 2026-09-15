export const INSERT_USER_SQL =
  'INSERT INTO users (id, username, password_hash) VALUES (?1, ?2, ?3)'
export const SELECT_USER_BY_USERNAME_SQL =
  'SELECT id, username, password_hash FROM users WHERE username = ?1'
export const SELECT_USER_BY_ID_SQL =
  'SELECT id, username, password_hash FROM users WHERE id = ?1'
