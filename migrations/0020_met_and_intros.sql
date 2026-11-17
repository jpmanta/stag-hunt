-- Early investors back teams, and nobody knows a team from a blurb.
-- A call now says whether the member has met the team, and members can ask
-- whoever brought the deal for an introduction.

-- 1 = has met the founders, 0 = has not. Empty for calls made before this question existed.
ALTER TABLE scores ADD COLUMN met INTEGER CHECK (met IN (0, 1));

-- Whoever brought a deal knows the founders, so their own call counts as met.
UPDATE scores SET met = 1
  WHERE member_id = (SELECT poster_id FROM deals WHERE deals.id = scores.deal_id);

-- One intro request per member per deal.
CREATE TABLE intros (
  deal_id     TEXT NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  member_id   TEXT NOT NULL REFERENCES users(id),
  created_at  INTEGER NOT NULL,
  PRIMARY KEY (deal_id, member_id)
);
