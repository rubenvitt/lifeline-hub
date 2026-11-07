-- LLH-1574: die Reihe „Sanitätsdienst“ im Lagebild ist eine wählbare Lagekennzahl. Der CHECK von
-- `einsatz_lagekennzahl_wahl` (0245) lässt sie zu; SQLite ändert einen CHECK nur per Rebuild der
-- (kleinen) Tabelle. Bestehende Zeilen bleiben, mit Wähler und Zeitpunkt.
--
-- Einsätze mit Einsatzart Sanitätsdienst bekommen die Wahl NICHT nachträglich: die Reihe eines
-- laufenden Einsatzes wechselt nur durch eine Entscheidung am Einsatz (Regel LFH-640). Neue
-- Einsätze mit dieser Einsatzart belegt `einsatz::lagekennzahl::vorbelegen_tx` vor.
CREATE TABLE einsatz_lagekennzahl_wahl_neu (
    einsatz_id      INTEGER NOT NULL REFERENCES einsatz(id) ON DELETE CASCADE,
    kennzahl        TEXT    NOT NULL CHECK (kennzahl IN ('nachforderungen', 'sanitaetsdienst')),
    gewaehlt_von_id INTEGER NOT NULL REFERENCES benutzer(id),
    gewaehlt_at     TEXT    NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (einsatz_id, kennzahl)
);
INSERT INTO einsatz_lagekennzahl_wahl_neu (einsatz_id, kennzahl, gewaehlt_von_id, gewaehlt_at)
    SELECT einsatz_id, kennzahl, gewaehlt_von_id, gewaehlt_at FROM einsatz_lagekennzahl_wahl;
DROP TABLE einsatz_lagekennzahl_wahl;
ALTER TABLE einsatz_lagekennzahl_wahl_neu RENAME TO einsatz_lagekennzahl_wahl;
