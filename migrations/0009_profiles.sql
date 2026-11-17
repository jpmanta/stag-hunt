-- Richer member profiles (shown to members only)
ALTER TABLE users ADD COLUMN headline TEXT;
ALTER TABLE users ADD COLUMN location TEXT;
ALTER TABLE users ADD COLUMN bio TEXT;
ALTER TABLE users ADD COLUMN focus TEXT;
ALTER TABLE users ADD COLUMN check_size TEXT;
ALTER TABLE users ADD COLUMN linkedin TEXT;
ALTER TABLE users ADD COLUMN twitter TEXT;
ALTER TABLE users ADD COLUMN website TEXT;
ALTER TABLE users ADD COLUMN photo TEXT;        -- small JPEG data URL, resized in the browser
ALTER TABLE users ADD COLUMN photo_at INTEGER;
