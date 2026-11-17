-- Founders apply at /apply. Applications wait in the Inbound pool until a
-- member takes the call and posts it as their own deal. They never reach the
-- Deals list on their own.
CREATE TABLE IF NOT EXISTS applications (
  id             TEXT PRIMARY KEY,
  founder_name   TEXT NOT NULL,
  founder_email  TEXT NOT NULL,
  founder_link   TEXT,
  why_you        TEXT NOT NULL,
  company        TEXT NOT NULL,
  website        TEXT,
  sector         TEXT,
  one_liner      TEXT NOT NULL,
  end_state      TEXT NOT NULL,
  flywheel       TEXT NOT NULL,
  next_goal      TEXT NOT NULL,
  blocker        TEXT NOT NULL,
  round_type     TEXT NOT NULL,
  raise_amount   TEXT,
  valuation_cap  TEXT,
  min_check      TEXT,
  deadline       TEXT,
  accredited_only INTEGER NOT NULL DEFAULT 0,
  deck_url       TEXT,
  video_url      TEXT,                           -- a one-minute founder video
  why_now        TEXT NOT NULL,
  heard_from     TEXT,
  status         TEXT NOT NULL DEFAULT 'open',   -- open | claimed | posted
  claimed_by     TEXT REFERENCES users(id),
  claimed_at     INTEGER,
  deal_id        TEXT,
  created_at     INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS applications_status ON applications(status, created_at);
ALTER TABLE deals ADD COLUMN application_id TEXT;
