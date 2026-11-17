-- A member can send a founder a link instead of recording in person. The founder
-- opens it, agrees to be recorded, and pitches out loud on their own phone. The
-- same rules hold: audio is never saved, only the member who sent the link sees
-- the transcript, and it's deleted when the deal is posted or after 7 days.
-- For a link, consent_at stays 0 until the founder agrees.
ALTER TABLE recordings ADD COLUMN link TEXT;      -- the secret in the link; empty for calls recorded in person
ALTER TABLE recordings ADD COLUMN founder TEXT;   -- who the link is for, as the member typed it
ALTER TABLE recordings ADD COLUMN done_at INTEGER; -- when the founder pressed Send
CREATE UNIQUE INDEX IF NOT EXISTS recordings_link ON recordings(link);
