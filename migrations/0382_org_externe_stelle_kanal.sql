-- LLH-2093: Kanaladressen je externer Stelle (Ausgang per E-Mail, Spec
-- docs/superpowers/specs/2026-11-24-w1ymakq6-ausgang-email-design.md, Abschnitt 1).
--
-- Eine Stelle kann über mehrere Kanäle erreichbar sein. Alle vier Kanäle stehen schon im CHECK,
-- damit die Nachzüge (Fax, Matrix, Threema) keinen Tabellenumbau brauchen; API und Oberfläche
-- nehmen heute nur `email` an (`externe_stelle::KanalArt::is_freigeschaltet`). Die Kanal-Liste
-- im CHECK ist `KanalArt::ALLE` (Test `externe_stelle::tests::kanal_check_entspricht_der_art`).
--
-- Die Tabelle gehört nicht zum Stammdaten-Abgleich zum ELW (das ELW sendet nicht) und hat darum
-- keine Log-Trigger: der Guard `trigger_und_spalten_passen_zur_beschreibung` erlaubt Log-Trigger
-- nur an beschriebenen Tabellen. Den Schreibschutz einer vom Hub synchronisierten Stelle tragen
-- die Schutz-Trigger unten wie bei den Unterlisten aus 0312, mit der Herkunft der Eltern-Stelle.

CREATE TABLE org_externe_stelle_kanal (
    id                INTEGER PRIMARY KEY,
    org_id            INTEGER NOT NULL REFERENCES organisation(id) ON DELETE CASCADE,
    externe_stelle_id INTEGER NOT NULL REFERENCES org_externe_stelle(id) ON DELETE CASCADE,
    kanal             TEXT NOT NULL CHECK (kanal IN ('email', 'fax', 'matrix', 'threema')),
    adresse           TEXT NOT NULL,
    bezeichnung       TEXT,
    erstellt_at       TEXT NOT NULL DEFAULT (datetime('now')),
    aktualisiert_at   TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (externe_stelle_id, kanal, adresse)
);

CREATE INDEX idx_org_externe_stelle_kanal_stelle
    ON org_externe_stelle_kanal(org_id, externe_stelle_id);

CREATE TRIGGER org_externe_stelle_kanal_schutz_i BEFORE INSERT ON org_externe_stelle_kanal
WHEN EXISTS (SELECT 1 FROM stammdaten_herkunft h
        WHERE h.art = 'externe_stelle' AND h.org_id = NEW.org_id AND h.lokaler_schluessel = CAST(NEW.externe_stelle_id AS TEXT))
    AND NOT EXISTS (SELECT 1 FROM stammdaten_uebernahme)
BEGIN
    SELECT RAISE(ABORT, 'stammdaten_vom_hub');
END;

CREATE TRIGGER org_externe_stelle_kanal_schutz_u BEFORE UPDATE ON org_externe_stelle_kanal
WHEN EXISTS (SELECT 1 FROM stammdaten_herkunft h
        WHERE h.art = 'externe_stelle' AND h.org_id = OLD.org_id AND h.lokaler_schluessel = CAST(OLD.externe_stelle_id AS TEXT))
    AND NOT EXISTS (SELECT 1 FROM stammdaten_uebernahme)
BEGIN
    SELECT RAISE(ABORT, 'stammdaten_vom_hub');
END;

CREATE TRIGGER org_externe_stelle_kanal_schutz_d BEFORE DELETE ON org_externe_stelle_kanal
WHEN EXISTS (SELECT 1 FROM stammdaten_herkunft h
        WHERE h.art = 'externe_stelle' AND h.org_id = OLD.org_id AND h.lokaler_schluessel = CAST(OLD.externe_stelle_id AS TEXT))
    AND NOT EXISTS (SELECT 1 FROM stammdaten_uebernahme)
BEGIN
    SELECT RAISE(ABORT, 'stammdaten_vom_hub');
END;
