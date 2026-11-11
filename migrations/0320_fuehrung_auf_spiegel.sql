-- LLH-1641: Führung je Einsatz auf den Spiegel aufgesetzt (Entwurf E1–E7, mit Ruben am
-- 11.11.2026 abgestimmt). Die Akte entscheidet, wer führt; die Zeile in `einsatz_spiegel` folgt ihr
-- (`instanz::spiegel::fuehrung::richte_aus`), und nur der Spiegel sperrt (ADR-0018, ADR-0021).
--
-- 1. `einsatz.fuehrung_bei` entfällt: der Schreibschutz ist allein der Spiegel.
-- 2. Akten und Stände des Austauschs werden verworfen. Der Schalter `LIFELINE_FUEHRUNG` war bis
--    hier nirgends an (Annahme, im Entwurf genannt); der Start legt die Akten mit der Kennung des
--    Einsatzes (`einsatz.kennung`) neu an, Spiegel bekommen keine eigene Akte mehr.
-- 3. `einsatz_fuehrung.herkunft_kopplung_id` (lokal, reist nicht): die Kopplung, von der die
--    Zeilen eines Einsatzes stammen, den diese Instanz als Spiegel hielt und jetzt führt. Nur an sie
--    geht der Schlüssel beim Empfänger (`Zeile.gegen`) mit (E3), und bei ihr holt der neue Führer
--    fehlende Inhalte (E7). `uebernommen_stand`: höchster Stand des Logs, als diese Instanz die
--    Führung bekam; was danach geändert ist, kennt der alte Führer nicht (Bruchstelle, E6).
--    `anfrage_von` (lokal, nur am Führer): Kennung des Gegenübers, dessen Anfrage wartet, bis es
--    alles hat (E4); erfüllt wird sie bei einer seiner nächsten Meldungen.
-- 4. `spiegel_antrag.daten_lokal`: die Erfassung mit den lokalen Kennungen. Wird der Spiegel
--    selbst Führer, führt er seine offenen Anträge damit aus (E5).
-- 5. `einsatz_spiegel.bruch_offen`: der Spiegel hat eigene, nicht abgeglichene Änderungen
--    gesichert und räumt neue Zeilen ab, sobald der Führer ihm sagt, welche er kennt (E6).
-- 6. `einsatz_bruchstelle`: je gesicherter Zeile ihr Inhalt beim Wechsel zum Spiegel (JSON, NULL
--    für eine gelöschte Zeile), ob sie lokal entfernt wurde und ob der Führer sie schon beurteilt
--    hat (`geklaert`: 0 offen, 1 geklärt, 2 zurückgestellt, weil noch ein Verweis daran hängt; mehr
--    als `BRUCH_MAX` Zeilen klären sich über mehrere Runden). Einsatz-scoped
--    (`einsatz::schwaerzung_registry`), nicht gespiegelt (`instanz::spiegel::art::AUSGENOMMEN`).
ALTER TABLE einsatz DROP COLUMN fuehrung_bei;

DELETE FROM einsatz_fuehrung;
UPDATE instanz_kopplung SET fuehrung_gesendet_bis = 0, fuehrung_empfangen_bis = 0;

ALTER TABLE einsatz_fuehrung ADD COLUMN herkunft_kopplung_id INTEGER
    REFERENCES instanz_kopplung(id) ON DELETE SET NULL;
ALTER TABLE einsatz_fuehrung ADD COLUMN uebernommen_stand INTEGER;
ALTER TABLE einsatz_fuehrung ADD COLUMN anfrage_von TEXT;

ALTER TABLE spiegel_antrag ADD COLUMN daten_lokal TEXT;

ALTER TABLE einsatz_spiegel ADD COLUMN bruch_offen INTEGER NOT NULL DEFAULT 0
    CHECK (bruch_offen IN (0, 1));

CREATE TABLE einsatz_bruchstelle (
    id           INTEGER PRIMARY KEY,
    einsatz_id   INTEGER NOT NULL REFERENCES einsatz(id) ON DELETE CASCADE,
    art          TEXT    NOT NULL,
    schluessel   TEXT    NOT NULL,
    stand        INTEGER NOT NULL,
    daten        TEXT,
    entfernt     INTEGER NOT NULL DEFAULT 0 CHECK (entfernt IN (0, 1)),
    geklaert     INTEGER NOT NULL DEFAULT 0 CHECK (geklaert IN (0, 1, 2)),
    gesichert_at TEXT    NOT NULL
);
CREATE INDEX idx_einsatz_bruchstelle_einsatz ON einsatz_bruchstelle (einsatz_id);
