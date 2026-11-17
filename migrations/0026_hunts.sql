-- Architecture, Phase 1: many hunts on one network. A hunt is a group that shares deals.
-- Visibility does not change yet: every member still sees every deal at their check size.
-- Sharing between hunts is Phase 2.

CREATE TABLE hunts (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  sharing    TEXT NOT NULL DEFAULT 'per_deal',   -- none | per_deal | all      (used from Phase 2)
  listing    TEXT NOT NULL DEFAULT 'private',    -- private | name | record    (used from Phase 6)
  joining    TEXT NOT NULL DEFAULT 'invite',     -- invite | request | open    (used from Phase 2)
  is_fund    INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

-- One account across hunts. A lead manages the hunt's settings and nothing else.
CREATE TABLE memberships (
  person     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  hunt       TEXT NOT NULL REFERENCES hunts(id) ON DELETE CASCADE,
  role       TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('lead', 'member')),
  listing_ok INTEGER NOT NULL DEFAULT 0,         -- consent to list the hunt's record (Phase 6)
  joined_at  INTEGER NOT NULL,
  PRIMARY KEY (person, hunt)
);
CREATE INDEX memberships_hunt ON memberships(hunt);

-- An invite waits for its email. Joining is the invited person's own choice.
CREATE TABLE hunt_invites (
  hunt       TEXT NOT NULL REFERENCES hunts(id) ON DELETE CASCADE,
  email      TEXT NOT NULL,
  invited_by TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (hunt, email)
);

-- Every deal has a home hunt: the one its bringer shared it in.
ALTER TABLE deals ADD COLUMN home_hunt TEXT REFERENCES hunts(id);

-- Current members are the first hunt. Admins lead it. Every deal so far is at home there.
INSERT INTO hunts (id, name, created_at)
  VALUES ('00000000-0000-4000-8000-000000000001', 'Founding hunt', CAST(strftime('%s', 'now') AS INTEGER));
INSERT INTO memberships (person, hunt, role, joined_at)
  SELECT id, '00000000-0000-4000-8000-000000000001', CASE WHEN role = 'admin' THEN 'lead' ELSE 'member' END, created_at
  FROM users WHERE status = 'active' AND role != 'observer';
UPDATE deals SET home_hunt = '00000000-0000-4000-8000-000000000001' WHERE home_hunt IS NULL;
