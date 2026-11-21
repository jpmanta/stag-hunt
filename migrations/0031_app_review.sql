-- App Review (Nov 21). Apple's reviewer signs in to a demo account that sees a sample hunt of
-- made-up deals and nothing real. demo = 1 marks that account and the made-up member who brought them.
ALTER TABLE users ADD COLUMN demo INTEGER NOT NULL DEFAULT 0;
