-- Ten-question scorecard (team, problem, product, market, moat, money, growth, retention, timing, endgame).
-- Each 0-10, total out of 100. The old five scores stay on older rows, so the table is rebuilt
-- with every score column optional and a stored total (old rows: their /50 total doubled).
CREATE TABLE scores_new (
  deal_id       TEXT NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  member_id     TEXT NOT NULL REFERENCES users(id),
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
  total         INTEGER NOT NULL CHECK (total BETWEEN 0 AND 100),
  updated_at    INTEGER NOT NULL,
  PRIMARY KEY (deal_id, member_id)
);

INSERT INTO scores_new (deal_id, member_id, fmf, market, pmf, vibe, scarcity,
    fmf_why, market_why, pmf_why, vibe_why, scarcity_why, total, updated_at)
  SELECT deal_id, member_id, fmf, market, pmf, vibe, scarcity,
    fmf_why, market_why, pmf_why, vibe_why, scarcity_why,
    (fmf + market + pmf + vibe + COALESCE(scarcity, 0)) * 2, updated_at
  FROM scores;

DROP TABLE scores;
ALTER TABLE scores_new RENAME TO scores;
