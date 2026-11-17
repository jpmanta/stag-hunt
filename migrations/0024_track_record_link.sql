-- A member can share their track record with anyone they choose through a private
-- link (staghunts.com/track/#<secret>). It shows calls, sectors and outcomes, never
-- company names, terms or money. Empty means sharing is off.
ALTER TABLE users ADD COLUMN record_link TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS users_record_link ON users(record_link);
