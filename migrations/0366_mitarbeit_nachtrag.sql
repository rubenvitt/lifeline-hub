-- LLH-2007 (Design `2026-11-22-s110uic4-mitarbeit-nachtrag-fuehrer-design.md`, D2 und D4):
-- Mitarbeit nach einer Rückgabe an eine ältere Instanz nachtragen.
--
-- `mitarbeit_nachtrag` ist der Ausgang eines Spiegels: Lernt er, dass sein Führer die Einsatzrolle
-- `mitarbeit` jetzt kennt, merkt er sich jede Mitgliedschaft, die er gegen den älteren Stand als
-- `mitarbeit` festgehalten hat (`instanz::spiegel::nachtrag`). Der Abgleich trägt sie zum Führer,
-- bis der quittiert. Nicht gespiegelt; mit Kopplung oder Einsatz weg.
CREATE TABLE mitarbeit_nachtrag (
    id          INTEGER PRIMARY KEY,
    kopplung_id INTEGER NOT NULL REFERENCES instanz_kopplung(id) ON DELETE CASCADE,
    einsatz_id  INTEGER NOT NULL REFERENCES einsatz(id) ON DELETE CASCADE,
    -- Schlüssel der Mitgliedschaft beim Spiegel (`json_array(einsatz_id, benutzer_id)`).
    schluessel  TEXT    NOT NULL,
    angelegt_at TEXT    NOT NULL DEFAULT (datetime('now')),
    UNIQUE (kopplung_id, einsatz_id, schluessel)
);
CREATE INDEX idx_mitarbeit_nachtrag_einsatz ON mitarbeit_nachtrag(einsatz_id);

-- Am Führer: höchster Stand des Änderungslogs in dem Moment, ab dem diese Instanz `mitarbeit`
-- kennt. Eine Mitgliedschaft, die danach hier bearbeitet wurde, hebt kein Nachtrag mehr an.
-- Bestehende Kopplungen bekommen den Stand dieses Aufrüstens (die Migration kommt mit 0358/0359
-- im selben Release, Design D4); eine neue Kopplung den Stand, an dem sie die Fähigkeit des
-- Gegenübers zuerst lernt (`instanz::spiegel::nachtrag::save_grenze`).
ALTER TABLE instanz_kopplung ADD COLUMN mitarbeit_grenze_stand INTEGER;
UPDATE instanz_kopplung SET mitarbeit_grenze_stand =
    (SELECT COALESCE(MAX(stand), 0) FROM einsatz_aenderung);
