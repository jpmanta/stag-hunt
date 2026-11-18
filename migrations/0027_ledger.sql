-- Architecture, Phase 1 (Proof): a record that proves itself.
-- Every locked call and every confirmed outcome becomes a ledger entry. Each entry's hash
-- covers the hash of the entry before it, so changing any old entry breaks every hash after it.
-- Entries hold only a hash of their content (body_hash); the content itself stays private and
-- carries a random salt, so the public chain reveals nothing about anyone's calls.

CREATE TABLE ledger (
  seq       INTEGER PRIMARY KEY,                    -- order of entry, 1 upward
  kind      TEXT NOT NULL CHECK (kind IN ('call', 'outcome', 'outcome_cleared')),
  ref       TEXT NOT NULL UNIQUE,                   -- which call or outcome
  member_id TEXT,                                   -- whose call (null for outcomes)
  body      TEXT NOT NULL,                          -- the entry as locked, JSON with a salt. Private
  body_hash TEXT NOT NULL,                          -- sha256(body)
  prev      TEXT NOT NULL,                          -- hash of entry seq - 1 (64 zeros for the first)
  hash      TEXT NOT NULL,                          -- sha256(seq || prev || body_hash)
  at        INTEGER NOT NULL
);
CREATE INDEX ledger_member ON ledger(member_id);

-- The chain's fingerprint at the end of each day. Published, and mailed to members weekly.
CREATE TABLE ledger_heads (
  day  TEXT PRIMARY KEY NOT NULL,                   -- YYYY-MM-DD, UTC
  seq  INTEGER NOT NULL,
  hash TEXT NOT NULL,
  at   INTEGER NOT NULL
);

-- Append only. Nobody, the operator included, can change or remove an entry or a fingerprint.
CREATE TRIGGER ledger_no_update BEFORE UPDATE ON ledger
  BEGIN SELECT RAISE(ABORT, 'ledger is append only'); END;
CREATE TRIGGER ledger_no_delete BEFORE DELETE ON ledger
  BEGIN SELECT RAISE(ABORT, 'ledger is append only'); END;
CREATE TRIGGER ledger_heads_no_update BEFORE UPDATE ON ledger_heads
  BEGIN SELECT RAISE(ABORT, 'fingerprints are append only'); END;
CREATE TRIGGER ledger_heads_no_delete BEFORE DELETE ON ledger_heads
  BEGIN SELECT RAISE(ABORT, 'fingerprints are append only'); END;
