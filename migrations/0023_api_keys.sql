-- A personal, read-only key so a member can pull their own record into Excel,
-- Google Sheets or their own tools. One key per member; only its hash is kept,
-- and it can read nothing but that member's record.
CREATE TABLE api_keys (
  user_id      TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  key_hash     TEXT NOT NULL UNIQUE,
  last4        TEXT NOT NULL,
  created_at   INTEGER NOT NULL,
  last_used_at INTEGER
);
