-- E‑3: Material-Verortung an eine UHS. NULL = nicht zugeordnet (Default).
-- Lebenszyklus über die UHS: wird die UHS aufgelöst, bleibt das Material in
-- der Disposition (zugeordnet zur Einheit oder frei), aber die UHS-Zuordnung
-- bleibt — das Detail-View einer aufgelösten UHS soll noch zeigen, was
-- zugeordnet war. Kein CASCADE.
ALTER TABLE einsatz_material ADD COLUMN uhs_id INTEGER REFERENCES uhs(id);
CREATE INDEX idx_einsatz_material_uhs ON einsatz_material (uhs_id);
