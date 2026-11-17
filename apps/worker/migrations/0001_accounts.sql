-- Account owns all three tables. Add new business data in separate migrations.
CREATE TABLE users (
  id TEXT PRIMARY KEY NOT NULL,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- Email is display metadata; the verified issuer + subject selects ownership.
CREATE TABLE auth_identities (
  issuer TEXT NOT NULL,
  subject TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  verified_email TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (issuer, subject)
);
CREATE INDEX idx_auth_identities_user ON auth_identities(user_id);

-- Client names are self-reported. These controls do not revoke OAuth grants.
CREATE TABLE mcp_connections (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  client_key TEXT NOT NULL CHECK (length(client_key) BETWEEN 1 AND 128),
  display_name TEXT NOT NULL CHECK (length(display_name) BETWEEN 1 AND 128),
  client_version TEXT NOT NULL CHECK (length(client_version) BETWEEN 1 AND 64),
  first_seen_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  revoked_at INTEGER CHECK (revoked_at IS NULL OR revoked_at >= 0),
  tool_call_count INTEGER NOT NULL DEFAULT 0 CHECK (tool_call_count >= 0),
  PRIMARY KEY (user_id, client_key)
);
CREATE INDEX idx_mcp_connections_user_last_seen
  ON mcp_connections(user_id, last_seen_at DESC, client_key ASC);
