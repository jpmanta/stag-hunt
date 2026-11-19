-- Investor statements (Nov 19). Anyone can make an account, so deals go only to people who
-- have said, in writing, that they are accredited and will keep deals confidential.
-- Every statement is kept as it was made, word for word, and can never be edited or deleted.
CREATE TABLE investor_statements (
  id INTEGER PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  version TEXT NOT NULL,                      -- which wording they agreed to
  basis TEXT NOT NULL CHECK (basis IN ('income', 'net_worth', 'license', 'entity', 'none')),
  wording TEXT NOT NULL,                      -- the exact text they saw and agreed to, JSON
  at INTEGER NOT NULL
);
CREATE INDEX investor_statements_user ON investor_statements (user_id, at);
CREATE TRIGGER investor_statements_no_update BEFORE UPDATE ON investor_statements
  BEGIN SELECT RAISE(ABORT, 'investor statements are append only'); END;
CREATE TRIGGER investor_statements_no_delete BEFORE DELETE ON investor_statements
  BEGIN SELECT RAISE(ABORT, 'investor statements are append only'); END;

-- The latest statement, kept on the account for fast checks
ALTER TABLE users ADD COLUMN accredited TEXT;       -- basis of the latest statement, NULL = none made yet
ALTER TABLE users ADD COLUMN statement_at INTEGER;  -- when the first statement was made
