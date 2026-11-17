-- Members join in small waves. The first wave is the founding cohort.
CREATE TABLE IF NOT EXISTS cohorts (
  number     INTEGER PRIMARY KEY,
  name       TEXT,
  seats      INTEGER NOT NULL,
  status     TEXT NOT NULL DEFAULT 'open',     -- open | closed
  opened_at  INTEGER NOT NULL,
  closed_at  INTEGER
);
ALTER TABLE users ADD COLUMN cohort INTEGER;
INSERT INTO cohorts (number, name, seats, status, opened_at) VALUES (1, 'Founding cohort', 6, 'open', strftime('%s','now'));
UPDATE users SET cohort = 1 WHERE status = 'active';
