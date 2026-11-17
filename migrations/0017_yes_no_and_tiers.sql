-- A yes or no on each deal beats a score, members say what they back,
-- and check-size tiers decide which deals each member sees.

-- Investor profile: check-size tier (in dollars: 50000, 100000, 250000, 500000 or 1000000),
-- thesis in their own words, and how involved they like to be (silent | advice | hands_on).
ALTER TABLE users ADD COLUMN tier INTEGER;
ALTER TABLE users ADD COLUMN thesis TEXT;
ALTER TABLE users ADD COLUMN involvement TEXT;

-- The smallest check the founder takes, as a tier. Members see deals at or below their tier.
ALTER TABLE deals ADD COLUMN min_tier INTEGER;

-- Each member's call on a deal is now a yes or no with one line on why.
-- The ten questions become optional, so the total can be empty.
CREATE TABLE scores_new (
  deal_id       TEXT NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  member_id     TEXT NOT NULL REFERENCES users(id),
  yes           INTEGER NOT NULL CHECK (yes IN (0, 1)),
  why           TEXT,
  fmf           INTEGER CHECK (fmf BETWEEN 0 AND 10),
  market        INTEGER CHECK (market BETWEEN 0 AND 10),
  pmf           INTEGER CHECK (pmf BETWEEN 0 AND 10),
  vibe          INTEGER CHECK (vibe BETWEEN 0 AND 10),
  scarcity      INTEGER CHECK (scarcity BETWEEN 0 AND 10),
  team          INTEGER CHECK (team BETWEEN 0 AND 10),
  problem       INTEGER CHECK (problem BETWEEN 0 AND 10),
  product       INTEGER CHECK (product BETWEEN 0 AND 10),
  moat          INTEGER CHECK (moat BETWEEN 0 AND 10),
  money         INTEGER CHECK (money BETWEEN 0 AND 10),
  growth        INTEGER CHECK (growth BETWEEN 0 AND 10),
  retention     INTEGER CHECK (retention BETWEEN 0 AND 10),
  timing        INTEGER CHECK (timing BETWEEN 0 AND 10),
  endgame       INTEGER CHECK (endgame BETWEEN 0 AND 10),
  fmf_why TEXT, market_why TEXT, pmf_why TEXT, vibe_why TEXT, scarcity_why TEXT,
  team_why TEXT, problem_why TEXT, product_why TEXT, moat_why TEXT, money_why TEXT,
  growth_why TEXT, retention_why TEXT, timing_why TEXT, endgame_why TEXT,
  total         INTEGER CHECK (total BETWEEN 0 AND 100),
  updated_at    INTEGER NOT NULL,
  PRIMARY KEY (deal_id, member_id)
);

-- Older scores count as a yes when they reached 60 out of 100 ("worth a call").
INSERT INTO scores_new (deal_id, member_id, yes, fmf, market, pmf, vibe, scarcity,
    team, problem, product, moat, money, growth, retention, timing, endgame,
    fmf_why, market_why, pmf_why, vibe_why, scarcity_why,
    team_why, problem_why, product_why, moat_why, money_why, growth_why, retention_why, timing_why, endgame_why,
    total, updated_at)
  SELECT deal_id, member_id, CASE WHEN total >= 60 THEN 1 ELSE 0 END, fmf, market, pmf, vibe, scarcity,
    team, problem, product, moat, money, growth, retention, timing, endgame,
    fmf_why, market_why, pmf_why, vibe_why, scarcity_why,
    team_why, problem_why, product_why, moat_why, money_why, growth_why, retention_why, timing_why, endgame_why,
    total, updated_at
  FROM scores;

DROP TABLE scores;
ALTER TABLE scores_new RENAME TO scores;
