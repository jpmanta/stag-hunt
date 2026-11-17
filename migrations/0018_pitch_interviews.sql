-- Founders can pitch out loud to an AI interviewer at /apply. It fills in
-- their application; members can read the transcript and hear the recording.
-- cost_usd is held at the most an interview can cost until the real cost is
-- known, so the monthly budget can't be overspent.
CREATE TABLE IF NOT EXISTS interviews (
  id              TEXT PRIMARY KEY,
  conversation_id TEXT UNIQUE,
  ip_hash         TEXT,
  transcript      TEXT,
  fields          TEXT,                 -- the form answers drafted from it (JSON)
  duration_secs   INTEGER,
  cost_usd        REAL NOT NULL,
  created_at      INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS interviews_created ON interviews(created_at);
ALTER TABLE applications ADD COLUMN interview_id TEXT;
-- The founder's smallest check as a tier, so applications reach the members it fits
ALTER TABLE applications ADD COLUMN min_tier INTEGER;
