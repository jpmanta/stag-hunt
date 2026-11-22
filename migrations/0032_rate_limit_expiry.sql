-- Rate limits keep their own window (Nov 22). Each row now says when it expires, so cleanup
-- can no longer reset a daily or monthly cap after an hour. Rows from before this change are
-- kept for the longest window any limit uses (40 days).
ALTER TABLE rate_limits ADD COLUMN expires_at INTEGER NOT NULL DEFAULT 0;
UPDATE rate_limits SET expires_at = window_start + 40 * 86400;
