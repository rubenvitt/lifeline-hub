-- LLH-1206: Kenntnisnahme einer Lagemeldung. „Neu“ heißt `gesehen_at IS NULL`, für alle Benutzer
-- gleich; gesetzt wird sie mit Schreibrecht am Modul `lagemeldungen`, die erste gewinnt.
-- Herleitung: /mnt/project-files/llh-1206/design.md (D1, D3, Risks).
ALTER TABLE lage_meldung ADD COLUMN gesehen_at TEXT;
ALTER TABLE lage_meldung ADD COLUMN gesehen_von_id INTEGER REFERENCES benutzer(id);

-- Bestand gilt als gesehen: sonst zeigte jeder laufende Einsatz nach dem Update eine Zahl ohne
-- neuen Inhalt. Die Person bleibt unbekannt.
UPDATE lage_meldung SET gesehen_at = erstellt_at;
