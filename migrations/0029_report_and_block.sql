-- Report and block (Nov 20). Any member can report something posted on the site,
-- and block a member so their posts stop showing for them. Both are the person's own choice (I8).
CREATE TABLE IF NOT EXISTS reports (
  id          TEXT PRIMARY KEY,
  reporter_id TEXT NOT NULL REFERENCES users(id),
  kind        TEXT NOT NULL CHECK (kind IN ('deal', 'update', 'call', 'investment', 'member')),
  target_id   TEXT NOT NULL,
  about_id    TEXT,                 -- the member who posted it
  reason      TEXT,
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS reports_time ON reports(created_at);

CREATE TABLE IF NOT EXISTS blocks (
  user_id     TEXT NOT NULL REFERENCES users(id),
  blocked_id  TEXT NOT NULL REFERENCES users(id),
  created_at  INTEGER NOT NULL,
  PRIMARY KEY (user_id, blocked_id)
);
