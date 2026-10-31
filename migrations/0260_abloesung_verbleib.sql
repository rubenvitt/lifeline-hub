-- LLH-1308 (Folge aus LLH-1132, Epic LLH-1016): was nach dem Vollzug mit der abgelösten Einheit
-- geschieht, und die Buchungen im Bereitstellungsraum, die der Vollzug dabei schreibt.
--
-- 1. `einsatz_abloesung.verbleib` — der Verbleib der abgelösten Einheit beim Vollzug als „Ganze
--    Einheit“: `ruhe` (Vorgabe, die Periode endet mit der Ablösung), `bereitstellungsraum` (dazu
--    Eintritt in den Raum `verbleib_br_id`) oder `entlassen` (die Periode endet mit der
--    Entlassung statt der Ablösung). Eine laufende Schicht und jeder Besatzungswechsel tragen
--    `ruhe`; die Rücknahme setzt den Wert zurück. `verbleib_br_id` nur bei `bereitstellungsraum`
--    (der CHECK hält beides zusammen; SET NULL beim Löschen des Raums, damit das Löschen eines
--    ganzen Einsatzes in jeder Reihenfolge gelingt — die Spalte ist dann nur noch Anzeige).
ALTER TABLE einsatz_abloesung ADD COLUMN verbleib TEXT NOT NULL DEFAULT 'ruhe'
    CHECK (verbleib IN ('ruhe', 'bereitstellungsraum', 'entlassen'));
ALTER TABLE einsatz_abloesung ADD COLUMN verbleib_br_id INTEGER
    REFERENCES bereitstellungsraum(id) ON DELETE SET NULL
    CHECK (verbleib_br_id IS NULL OR verbleib = 'bereitstellungsraum');

-- 2. `einsatz_abloesung_br_buchung` — je Zeile eine Belegungsbuchung, die der Vollzug geschrieben
--    hat: der Eintritt der abgelösten Einheit und der Austritt jedes Ablösers (samt mitgenommener
--    Untereinheiten), der beim Vollzug im Raum stand. Die Rücknahme bucht je Zeile das Gegenstück
--    (Austritt bzw. Eintritt im selben Raum), solange die Buchung noch das jüngste Ereignis ihrer
--    Kraft ist, und löscht dann die Zeilen. Nur Verweise und Zeit. Abgesichert von
--    db::tests::migration_0259_verbleib_und_buchungen.
CREATE TABLE einsatz_abloesung_br_buchung (
    abloesung_id INTEGER NOT NULL REFERENCES einsatz_abloesung(id) ON DELETE CASCADE,
    belegung_id  INTEGER NOT NULL REFERENCES br_belegung(id) ON DELETE CASCADE,
    angelegt_at  TEXT    NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (abloesung_id, belegung_id)
);
CREATE INDEX idx_abloesung_br_buchung_belegung ON einsatz_abloesung_br_buchung(belegung_id);
