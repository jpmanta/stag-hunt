-- People who tried to get in without an invite (verified Google sign-ins). An admin approves or declines.
CREATE TABLE IF NOT EXISTS join_requests (
  id          TEXT PRIMARY KEY,
  email       TEXT NOT NULL,
  name        TEXT,
  source      TEXT NOT NULL DEFAULT 'google',
  status      TEXT NOT NULL DEFAULT 'open',   -- open | approved | declined
  created_at  INTEGER NOT NULL,
  decided_at  INTEGER
);
CREATE INDEX IF NOT EXISTS join_requests_email ON join_requests(email, status);
