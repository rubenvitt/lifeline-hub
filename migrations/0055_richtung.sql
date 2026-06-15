-- Externe Kommunikation (LFH-87): Richtungskennzeichnung intern/extern an Meldung und Auftrag.
-- Additive code-validierte TEXT-Spalte (Werte 'intern'|'extern', kein DB-CHECK, Bestandsmuster
-- prioritaet/status). Weder meldung noch auftrag haben eigene FTS/Trigger → kein Table-Rebuild;
-- ADD COLUMN NOT NULL DEFAULT backfillt Bestand auf 'intern'.
ALTER TABLE meldung ADD COLUMN richtung TEXT NOT NULL DEFAULT 'intern';
ALTER TABLE auftrag ADD COLUMN richtung TEXT NOT NULL DEFAULT 'intern';
