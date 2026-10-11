-- LFH-1199: der Einsatzleiter nach FwDV 100 als Angabe der eigenen Führungsstelle (0145). Entweder
-- eine Person aus dem disponierten Personal (`personal`, Name beim Setzen eingefroren) oder ein
-- externer Einsatzleiter als Freitext (`extern`), stets mit „seit“ (UTC wie `status_seit`).
--
-- Die Art steht eigens, weil `einsatzleiter_personal_id` beim Entlassen der Person auf NULL fällt
-- (ON DELETE SET NULL, wie die Stab-Besetzung 0102): der Datensatz bleibt eine Person, „nicht mehr
-- disponiert“, und wird kein externer Einsatzleiter. Alle vier leer = kein Einsatzleiter erfasst;
-- die Konsistenz hält der Code (`einsatz::fuehrungsstelle`).
ALTER TABLE einsatz_fuehrungsstelle ADD COLUMN einsatzleiter_art TEXT
    CHECK (einsatzleiter_art IN ('personal', 'extern'));
ALTER TABLE einsatz_fuehrungsstelle ADD COLUMN einsatzleiter_personal_id INTEGER
    REFERENCES einsatz_personal(id) ON DELETE SET NULL;
ALTER TABLE einsatz_fuehrungsstelle ADD COLUMN einsatzleiter_name TEXT;
ALTER TABLE einsatz_fuehrungsstelle ADD COLUMN einsatzleiter_seit TEXT;

CREATE INDEX idx_einsatz_fuehrungsstelle_einsatzleiter_personal
    ON einsatz_fuehrungsstelle(einsatzleiter_personal_id);
