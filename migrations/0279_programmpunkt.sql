-- LLH-1570 (Change `n7row3f9-ablaufplan-marken`, Konzept LLH-1562 Abschnitt 5.9): Programmpunkte
-- der Veranstaltung (Einlass 18:00, Beginn 19:00, Feuerwerk 22:30) am Einsatz. Sie stehen als
-- Marken im Überblick und auf dem Lagemonitor, bis ihr Zeitpunkt erreicht ist.
--
-- Bewusst eine eigene Tabelle statt einer Quelle der Erinnerung (design.md D1): ein Programmpunkt
-- hat keinen Status, keinen Zähler, löst nichts aus und benachrichtigt nicht. Grenzen
-- (Bezeichnung höchstens 100 Zeichen, höchstens 50 je Einsatz, Jahr im Bereich) prüft Rust
-- (`programmpunkt`).
CREATE TABLE programmpunkt (
    id              INTEGER PRIMARY KEY,
    einsatz_id      INTEGER NOT NULL REFERENCES einsatz(id) ON DELETE CASCADE,
    bezeichnung     TEXT    NOT NULL,
    -- Zeitpunkt (UTC, 'YYYY-MM-DD HH:MM:SS').
    zeitpunkt_at    TEXT    NOT NULL,
    erstellt_von_id INTEGER NOT NULL REFERENCES benutzer(id),
    erstellt_at     TEXT    NOT NULL DEFAULT (datetime('now')),
    geaendert_at    TEXT
);
CREATE INDEX idx_programmpunkt_einsatz ON programmpunkt(einsatz_id, zeitpunkt_at);
