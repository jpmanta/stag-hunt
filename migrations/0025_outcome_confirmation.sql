-- Nobody grades their own deal. A reported outcome waits as "pending" until a second
-- member confirms it, unless it comes with a public source link anyone can check.
-- deals.outcome stays the confirmed result, so every record keeps reading it.
ALTER TABLE deals ADD COLUMN outcome_by TEXT;
ALTER TABLE deals ADD COLUMN outcome_confirmed_by TEXT;
ALTER TABLE deals ADD COLUMN outcome_source TEXT;
ALTER TABLE deals ADD COLUMN pending_outcome TEXT;
ALTER TABLE deals ADD COLUMN pending_note TEXT;
ALTER TABLE deals ADD COLUMN pending_by TEXT;
ALTER TABLE deals ADD COLUMN pending_at INTEGER;
