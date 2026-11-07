-- LLH-1567 (Konzept LLH-1562, Abschnitt 5.3, Variante A; Change
-- `unxqhab4-patient-einheit-meldung`, design.md D1): Patient, Streife und Hilfeersuchen kennen
-- einander.
--
-- `versorgende_einheit_id`: die Einheit, die die Person versorgt (Streife, UHS-Trupp, RTW). Der
-- Abschnitt folgt zur Abfragezeit aus `einsatz_einheit.abschnitt_id` (D2), kein Schnappschuss.
-- Eine Einheit mit einem nicht stornierten Patienten hat eine Spur (`einheit::repo`,
-- `SPUREN_EINHEIT`, D3) und wird nie hart gelöscht; SET NULL trifft nur Stornierte.
--
-- `meldung_id`: die Meldung, aus der die Person angelegt wurde. Eine Meldung kann mehrere
-- Patienten haben, eine Person höchstens eine Meldung; an der Meldung entsteht keine Spalte.
-- Gesetzt nur beim Anlegen (D6).
--
-- Aufbewahrung: beide sind Verweise ohne Personenbezug, retain (`einsatz::schwaerzung_registry`).
-- Rein additiv per ADD COLUMN (einsatz_person ist Nicht-Leaf), beide nullable, kein Backfill.
ALTER TABLE einsatz_person ADD COLUMN versorgende_einheit_id INTEGER
    REFERENCES einsatz_einheit(id) ON DELETE SET NULL;
ALTER TABLE einsatz_person ADD COLUMN meldung_id INTEGER
    REFERENCES meldung(id) ON DELETE SET NULL;

CREATE INDEX idx_einsatz_person_versorgende_einheit ON einsatz_person(versorgende_einheit_id)
    WHERE versorgende_einheit_id IS NOT NULL;
CREATE INDEX idx_einsatz_person_meldung ON einsatz_person(meldung_id)
    WHERE meldung_id IS NOT NULL;
