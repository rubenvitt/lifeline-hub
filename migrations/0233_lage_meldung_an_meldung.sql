-- LLH-1031 (Entscheidung LLH-1027 D5): Jede Lagemeldung ist eine Meldung. Die Angaben des
-- Lageobjekts werden Spalten der Meldung, der Bestand wird übernommen, `lage_meldung` fällt in
-- derselben Migration (kein Altbestand, keine zweite Kennung). Herleitung:
-- docs/design/2026-10-21-meldungsmodell/README.md, „Migrationsweg“.

-- Eigener Lage-Text; NULL heißt: der Wortlaut der Meldung gilt (kein Doppel des Wortlauts).
ALTER TABLE meldung ADD COLUMN lage_text TEXT;
-- Verortung der Lagemeldung (Lagekarte-Ebene „Lagemeldungen“).
ALTER TABLE meldung ADD COLUMN lat REAL;
ALTER TABLE meldung ADD COLUMN lon REAL;
-- Seit wann und durch wen sie in der Lage steht; NULL genau dann, wenn lagerelevant = 0.
ALTER TABLE meldung ADD COLUMN lage_uebergeben_at TEXT;
ALTER TABLE meldung ADD COLUMN lage_uebergeben_von_id INTEGER REFERENCES benutzer(id);
-- Kenntnisnahme durch die Lage (LLH-1206), unabhängig vom Bearbeitungsstand der Meldung.
ALTER TABLE meldung ADD COLUMN lage_gesehen_at TEXT;
ALTER TABLE meldung ADD COLUMN lage_gesehen_von_id INTEGER REFERENCES benutzer(id);

-- Ein Flag ohne Lageobjekt setzte kein Schreibweg (nur ein Handeingriff); es stand in keiner Liste
-- und auf keiner Karte. Es fällt, damit die Lage-Sicht danach genau die bisherige ist.
UPDATE meldung SET lagerelevant = 0
WHERE lagerelevant = 1 AND id NOT IN (SELECT meldung_id FROM lage_meldung);

-- Bestand: übergebene Meldungen, Spalte für Spalte (UNIQUE(meldung_id): höchstens eine Zeile).
UPDATE meldung SET
  lage_text = (SELECT NULLIF(lm.text, meldung.inhalt) FROM lage_meldung lm
               WHERE lm.meldung_id = meldung.id),
  lat = (SELECT lm.lat FROM lage_meldung lm WHERE lm.meldung_id = meldung.id),
  lon = (SELECT lm.lon FROM lage_meldung lm WHERE lm.meldung_id = meldung.id),
  lage_uebergeben_at = (SELECT lm.erstellt_at FROM lage_meldung lm
                        WHERE lm.meldung_id = meldung.id),
  lage_uebergeben_von_id = (SELECT lm.erstellt_von_id FROM lage_meldung lm
                            WHERE lm.meldung_id = meldung.id),
  lage_gesehen_at = (SELECT lm.gesehen_at FROM lage_meldung lm WHERE lm.meldung_id = meldung.id),
  lage_gesehen_von_id = (SELECT lm.gesehen_von_id FROM lage_meldung lm
                         WHERE lm.meldung_id = meldung.id),
  lagerelevant = 1
WHERE id IN (SELECT meldung_id FROM lage_meldung);

-- Bestand: Lagemeldungen, die nie übergeben wurden. Sie sind ab jetzt lagerelevant (Übernahme =
-- Eingang, durch den Erfasser) und gelten als gesehen, ohne Person (wie 0189): sonst zeigte jeder
-- laufende Einsatz nach dem Update eine Zahl ohne neuen Inhalt.
UPDATE meldung SET
  lagerelevant = 1,
  lage_uebergeben_at = eingang_at,
  lage_uebergeben_von_id = erfasst_von_id,
  lage_gesehen_at = eingang_at
WHERE meldungsart = 'lagemeldung' AND lage_uebergeben_at IS NULL;

DROP TABLE lage_meldung;

CREATE INDEX idx_meldung_lage ON meldung(einsatz_id, lagerelevant);
