-- Members: extend users with profile, role and membership status
ALTER TABLE users ADD COLUMN name TEXT;
ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'member';      -- member | admin
ALTER TABLE users ADD COLUMN status TEXT NOT NULL DEFAULT 'active';    -- active | removed
ALTER TABLE users ADD COLUMN invited_by TEXT;
ALTER TABLE users ADD COLUMN network TEXT;                              -- what networks they bring

-- The first admin. Running your own copy? Put your own email here before applying.
UPDATE users SET role = 'admin', name = COALESCE(name, 'Admin') WHERE email = 'admin@example.com';
INSERT OR IGNORE INTO users (id, email, created_at, name, role, status)
  VALUES (lower(hex(randomblob(16))), 'admin@example.com', unixepoch(), 'Admin', 'admin', 'active');

-- Deals posted by members, in the standard post format
CREATE TABLE IF NOT EXISTS deals (
  id            TEXT PRIMARY KEY,
  poster_id     TEXT NOT NULL REFERENCES users(id),
  company       TEXT NOT NULL,
  website       TEXT,
  sector        TEXT,
  one_liner     TEXT NOT NULL,         -- what it does
  round_type    TEXT NOT NULL,         -- SAFE | Convertible note | Priced round | Reg CF | Other
  raise_amount  TEXT,
  valuation_cap TEXT,
  discount      TEXT,
  min_check     TEXT,
  deadline      TEXT,
  accredited_only INTEGER NOT NULL DEFAULT 0,
  how_found     TEXT NOT NULL,         -- how the member came across it (the edge)
  why_now       TEXT NOT NULL,
  disclosure    TEXT,                  -- founder / employee / existing investor interest
  status        TEXT NOT NULL DEFAULT 'reviewing',  -- reviewing | founder_call | invested | passed | exited | dead
  round_public  INTEGER NOT NULL DEFAULT 0,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS deals_created ON deals(created_at);
CREATE INDEX IF NOT EXISTS deals_poster ON deals(poster_id);

-- One scorecard per member per deal (each 0-10, with a one-line reason)
CREATE TABLE IF NOT EXISTS scores (
  deal_id     TEXT NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  member_id   TEXT NOT NULL REFERENCES users(id),
  fmf         INTEGER NOT NULL CHECK (fmf BETWEEN 0 AND 10),
  market      INTEGER NOT NULL CHECK (market BETWEEN 0 AND 10),
  pmf         INTEGER NOT NULL CHECK (pmf BETWEEN 0 AND 10),
  vibe        INTEGER NOT NULL CHECK (vibe BETWEEN 0 AND 10),
  fmf_why     TEXT, market_why TEXT, pmf_why TEXT, vibe_why TEXT,
  updated_at  INTEGER NOT NULL,
  PRIMARY KEY (deal_id, member_id)
);

-- Individual investments (no pooled money): amounts in cents
CREATE TABLE IF NOT EXISTS investments (
  deal_id        TEXT NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  member_id      TEXT NOT NULL REFERENCES users(id),
  amount_cents   INTEGER NOT NULL CHECK (amount_cents > 0),
  invested_on    TEXT,
  realized_cents INTEGER NOT NULL DEFAULT 0,   -- cash actually returned
  paper_cents    INTEGER,                      -- current paper value (can go to zero)
  note           TEXT,
  updated_at     INTEGER NOT NULL,
  PRIMARY KEY (deal_id, member_id)
);

-- Updates and lessons on a deal
CREATE TABLE IF NOT EXISTS deal_updates (
  id          TEXT PRIMARY KEY,
  deal_id     TEXT NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  member_id   TEXT NOT NULL REFERENCES users(id),
  body        TEXT NOT NULL,
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS updates_deal ON deal_updates(deal_id, created_at);

-- Real-time chat messages: room = 'general' or 'deal:<id>'
CREATE TABLE IF NOT EXISTS messages (
  id          TEXT PRIMARY KEY,
  room        TEXT NOT NULL,
  member_id   TEXT NOT NULL REFERENCES users(id),
  body        TEXT NOT NULL,
  created_at  INTEGER NOT NULL      -- milliseconds
);
CREATE INDEX IF NOT EXISTS messages_room ON messages(room, created_at);

-- Nominations: one member nominates, group can object, admin approves
CREATE TABLE IF NOT EXISTS nominations (
  id            TEXT PRIMARY KEY,
  email         TEXT NOT NULL,
  name          TEXT NOT NULL,
  reason        TEXT NOT NULL,
  nominated_by  TEXT NOT NULL REFERENCES users(id),
  status        TEXT NOT NULL DEFAULT 'open',   -- open | approved | rejected
  created_at    INTEGER NOT NULL,
  decided_at    INTEGER
);
CREATE TABLE IF NOT EXISTS objections (
  nomination_id TEXT NOT NULL REFERENCES nominations(id) ON DELETE CASCADE,
  member_id     TEXT NOT NULL REFERENCES users(id),
  reason        TEXT,
  created_at    INTEGER NOT NULL,
  PRIMARY KEY (nomination_id, member_id)
);

-- Playbook: lessons written after each six-month review
CREATE TABLE IF NOT EXISTS lessons (
  id          TEXT PRIMARY KEY,
  member_id   TEXT NOT NULL REFERENCES users(id),
  title       TEXT NOT NULL,
  body        TEXT NOT NULL,
  created_at  INTEGER NOT NULL
);
