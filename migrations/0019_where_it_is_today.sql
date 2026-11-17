-- Where it is today: who pays and how much, the numbers so far, how they get
-- customers, and who else solves it. The facts behind the ten questions.
ALTER TABLE applications ADD COLUMN customers TEXT;
ALTER TABLE applications ADD COLUMN traction TEXT;
ALTER TABLE applications ADD COLUMN acquisition TEXT;
ALTER TABLE applications ADD COLUMN competition TEXT;
ALTER TABLE deals ADD COLUMN customers TEXT;
ALTER TABLE deals ADD COLUMN traction TEXT;
ALTER TABLE deals ADD COLUMN acquisition TEXT;
ALTER TABLE deals ADD COLUMN competition TEXT;
