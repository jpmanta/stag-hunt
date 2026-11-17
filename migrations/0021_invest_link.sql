-- Where members invest: the company's own link (SAFE signing page, Wefunder page, wire instructions).
-- Stag Hunt only links to it; the money goes straight from each member to the company.
ALTER TABLE deals ADD COLUMN invest_url TEXT;
