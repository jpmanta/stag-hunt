-- Fifth score: is what they sell scarce and wanted, or is the space crowded?
ALTER TABLE scores ADD COLUMN scarcity INTEGER CHECK (scarcity BETWEEN 0 AND 10);
ALTER TABLE scores ADD COLUMN scarcity_why TEXT;
