ALTER TABLE messages ADD COLUMN edited_at INTEGER;
ALTER TABLE users ADD COLUMN chat_read_at INTEGER;   -- ms timestamp of the last group-chat message this member has seen
