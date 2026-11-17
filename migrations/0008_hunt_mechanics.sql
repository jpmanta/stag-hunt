-- Conditional pledges: "I'm in for $X if at least N others are in." Locked pledges are binding.
CREATE TABLE IF NOT EXISTS pledges (
  deal_id      TEXT NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  member_id    TEXT NOT NULL REFERENCES users(id),
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  need_others  INTEGER NOT NULL CHECK (need_others BETWEEN 0 AND 20),
  locked_at    INTEGER,
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL,
  PRIMARY KEY (deal_id, member_id)
);
CREATE INDEX IF NOT EXISTS pledges_member ON pledges(member_id);

-- Look back: how did the company actually do?
ALTER TABLE deals ADD COLUMN outcome TEXT;        -- breakout | on_track | struggling | dead
ALTER TABLE deals ADD COLUMN outcome_note TEXT;
ALTER TABLE deals ADD COLUMN outcome_at INTEGER;
