-- Where the company is going, in the founder's words
ALTER TABLE deals ADD COLUMN end_state TEXT;
ALTER TABLE deals ADD COLUMN flywheel TEXT;
ALTER TABLE deals ADD COLUMN next_goal TEXT;
ALTER TABLE deals ADD COLUMN blocker TEXT;
