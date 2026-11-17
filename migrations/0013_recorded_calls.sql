-- Founder calls recorded on a member's phone. Audio is never stored: each
-- minute is transcribed on arrival and only the text is kept, visible only to
-- the member who recorded it, until the deal is posted or 7 days pass.
ALTER TABLE deals ADD COLUMN from_recording INTEGER NOT NULL DEFAULT 0;
CREATE TABLE IF NOT EXISTS recordings (
  id          TEXT PRIMARY KEY,
  member_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  consent_at  INTEGER NOT NULL,   -- when the member confirmed the founder agreed
  created_at  INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS rec_segments (
  rec_id  TEXT NOT NULL REFERENCES recordings(id) ON DELETE CASCADE,
  n       INTEGER NOT NULL,
  text    TEXT NOT NULL,
  PRIMARY KEY (rec_id, n)
);
