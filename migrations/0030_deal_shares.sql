-- Framework Phase 2 (Sharing): a deal shared from its home hunt to another hunt.
-- A deal leaves its home hunt only with the founder's yes (I10); founder_ok_at is when whoever
-- brought the deal stated the founder agreed. Nothing reads or writes this table until sharing is
-- switched on (the SHARING var in wrangler.jsonc), which waits for the lawyer.
CREATE TABLE IF NOT EXISTS deal_shares (
  deal          TEXT NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  hunt          TEXT NOT NULL REFERENCES hunts(id) ON DELETE CASCADE,
  shared_by     TEXT NOT NULL REFERENCES users(id),
  founder_ok_at INTEGER,
  created_at    INTEGER NOT NULL,
  PRIMARY KEY (deal, hunt)
);
CREATE INDEX IF NOT EXISTS deal_shares_hunt ON deal_shares(hunt);
