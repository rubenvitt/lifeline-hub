-- LLH-1817: vierte Einsatzrolle `mitarbeit` (erfasst, schreibt keinen ETB, führt nicht).
--
-- SQLite ändert einen CHECK nur per Neubau. einsatz_mitgliedschaft ist ein Blatt (keine Tabelle
-- verweist darauf; `grep -l "REFERENCES einsatz_mitgliedschaft" migrations` ist leer) → kein
-- PRAGMA-foreign_keys-Umschalter, das DROP löst keine Kaskade aus, und der Neubau läuft in der
-- Transaktion der Migration (Muster 0208). Keine AUTOINCREMENT-Spalte, also keine Sequenz.
-- Schema = 0003 + fuehrungsstelle (0100) + fuehrungsfunktion (0128, CHECK unverändert), nur der
-- einsatz_rolle-CHECK nimmt 'mitarbeit' auf. Index aus 0003 und die sechs Spiegel-Trigger
-- (Protokoll und Schutz, 0314) fallen mit dem DROP und werden wortgleich neu angelegt.
-- Abgesichert von db::tests::migration_0357_mitgliedschaft_neubau_erhaelt_zeilen_trigger_und_schema.

CREATE TABLE einsatz_mitgliedschaft_neu (
    einsatz_id        INTEGER NOT NULL REFERENCES einsatz(id) ON DELETE CASCADE,
    benutzer_id       INTEGER NOT NULL REFERENCES benutzer(id) ON DELETE CASCADE,
    einsatz_rolle     TEXT NOT NULL
                      CHECK (einsatz_rolle IN ('einsatzleitung', 'fuehrungspersonal', 'mitarbeit',
                                               'beobachter')),
    zugewiesen_at     TEXT NOT NULL DEFAULT (datetime('now')),
    fuehrungsstelle   TEXT,
    fuehrungsfunktion TEXT
                      CHECK (fuehrungsfunktion IN ('el','s1','s2','s3','s4','s5','s6','s7',
                                                   'fuehrungshilfspersonal','fachberater')),
    PRIMARY KEY (einsatz_id, benutzer_id)
);

INSERT INTO einsatz_mitgliedschaft_neu
    (einsatz_id, benutzer_id, einsatz_rolle, zugewiesen_at, fuehrungsstelle, fuehrungsfunktion)
    SELECT einsatz_id, benutzer_id, einsatz_rolle, zugewiesen_at, fuehrungsstelle,
           fuehrungsfunktion
    FROM einsatz_mitgliedschaft;

DROP TABLE einsatz_mitgliedschaft;

ALTER TABLE einsatz_mitgliedschaft_neu RENAME TO einsatz_mitgliedschaft;

CREATE INDEX idx_mitgliedschaft_benutzer ON einsatz_mitgliedschaft(benutzer_id);

CREATE TRIGGER einsatz_mitgliedschaft_spiegellog_i AFTER INSERT ON einsatz_mitgliedschaft WHEN EXISTS (SELECT 1 FROM einsatz WHERE id = NEW.einsatz_id) BEGIN
    DELETE FROM einsatz_aenderung WHERE einsatz_id = NEW.einsatz_id AND art = 'einsatz_mitgliedschaft' AND schluessel = json_array(NEW.einsatz_id, NEW.benutzer_id);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) VALUES (NEW.einsatz_id, 'einsatz_mitgliedschaft', json_array(NEW.einsatz_id, NEW.benutzer_id));
END;
CREATE TRIGGER einsatz_mitgliedschaft_spiegellog_u AFTER UPDATE ON einsatz_mitgliedschaft BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'einsatz_mitgliedschaft' AND ((einsatz_id = OLD.einsatz_id AND schluessel = json_array(OLD.einsatz_id, OLD.benutzer_id)) OR (einsatz_id = NEW.einsatz_id AND schluessel = json_array(NEW.einsatz_id, NEW.benutzer_id)));
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT OLD.einsatz_id, 'einsatz_mitgliedschaft', json_array(OLD.einsatz_id, OLD.benutzer_id) WHERE (json_array(OLD.einsatz_id, OLD.benutzer_id) IS NOT json_array(NEW.einsatz_id, NEW.benutzer_id) OR OLD.einsatz_id IS NOT NEW.einsatz_id) AND EXISTS (SELECT 1 FROM einsatz WHERE id = OLD.einsatz_id);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT NEW.einsatz_id, 'einsatz_mitgliedschaft', json_array(NEW.einsatz_id, NEW.benutzer_id) WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = NEW.einsatz_id);
END;
CREATE TRIGGER einsatz_mitgliedschaft_spiegellog_d AFTER DELETE ON einsatz_mitgliedschaft BEGIN
    DELETE FROM einsatz_aenderung WHERE einsatz_id = OLD.einsatz_id AND art = 'einsatz_mitgliedschaft' AND schluessel = json_array(OLD.einsatz_id, OLD.benutzer_id);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT OLD.einsatz_id, 'einsatz_mitgliedschaft', json_array(OLD.einsatz_id, OLD.benutzer_id) WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = OLD.einsatz_id);
END;
CREATE TRIGGER einsatz_mitgliedschaft_spiegelschutz_i BEFORE INSERT ON einsatz_mitgliedschaft WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = NEW.einsatz_id) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
CREATE TRIGGER einsatz_mitgliedschaft_spiegelschutz_u BEFORE UPDATE ON einsatz_mitgliedschaft WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND (EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = OLD.einsatz_id) OR EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = NEW.einsatz_id)) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
CREATE TRIGGER einsatz_mitgliedschaft_spiegelschutz_d BEFORE DELETE ON einsatz_mitgliedschaft WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = OLD.einsatz_id) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
