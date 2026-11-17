-- One-tap sign-in links sent alongside the 6-digit code (only the hash is stored)
ALTER TABLE login_codes ADD COLUMN link_hash TEXT;
