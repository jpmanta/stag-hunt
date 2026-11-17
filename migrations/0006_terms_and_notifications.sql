-- Membership terms agreement + email preferences
ALTER TABLE users ADD COLUMN terms_accepted_at INTEGER;
ALTER TABLE users ADD COLUMN notify_deals INTEGER NOT NULL DEFAULT 1;
ALTER TABLE users ADD COLUMN notify_digest INTEGER NOT NULL DEFAULT 1;
