-- Passkeys (Face ID / Touch ID / device PIN). Public keys only; nothing secret is stored.
CREATE TABLE IF NOT EXISTS passkeys (
  id          TEXT PRIMARY KEY,        -- credential ID (base64url)
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  public_key  TEXT NOT NULL,           -- base64url
  counter     INTEGER NOT NULL DEFAULT 0,
  transports  TEXT,
  name        TEXT,
  created_at  INTEGER NOT NULL,
  last_used   INTEGER
);
CREATE INDEX IF NOT EXISTS passkeys_user ON passkeys(user_id);
-- Short-lived WebAuthn challenges
CREATE TABLE IF NOT EXISTS webauthn_challenges (
  id          TEXT PRIMARY KEY,
  user_id     TEXT,
  kind        TEXT NOT NULL,           -- register | login
  challenge   TEXT NOT NULL,
  expires_at  INTEGER NOT NULL
);
