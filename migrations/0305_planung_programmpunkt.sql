-- LLH-1583: Programmpunkte der Veranstaltung schon in der Vorplanung (Einlass 18:00, Beginn 19:00,
-- Feuerwerk 22:30). Die Übernahme einer Planung legt sie im Einsatz als `programmpunkt` (0279) an;
-- einen Punkt mit gleicher Bezeichnung und gleichem Zeitpunkt, den der Einsatz schon hat, lässt
-- sie aus.
--
-- Form wie `programmpunkt`: Bezeichnung (höchstens 100 Zeichen) und Zeitpunkt (UTC,
-- 'YYYY-MM-DD HH:MM:SS'), höchstens 50 je Planung. Die Grenzen prüft Rust (`planung::programm`).
-- Innerhalb der Planung CASCADE: der Aufbewahrungslauf und das Löschen der Planung nehmen die
-- Programmpunkte mit. Kein Verweis auf einen Einsatz (GUARD 5, wie 0296).
--
-- Abgesichert von db::tests::migration_0305_planung_programmpunkt.
CREATE TABLE planung_programmpunkt (
    id            INTEGER PRIMARY KEY,
    planung_id    INTEGER NOT NULL REFERENCES planung(id) ON DELETE CASCADE,
    bezeichnung   TEXT    NOT NULL,
    zeitpunkt_at  TEXT    NOT NULL,
    angelegt_at   TEXT    NOT NULL DEFAULT (datetime('now')),
    angelegt_von  INTEGER REFERENCES benutzer(id),
    geaendert_at  TEXT
);
CREATE INDEX idx_planung_programmpunkt_planung
    ON planung_programmpunkt(planung_id, zeitpunkt_at);
