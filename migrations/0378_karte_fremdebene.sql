-- LLH-2099/LLH-2100: Fremdebenen der Lagekarte, fremde Geodaten aus einer Datei oder einer URL.
-- Entwurf: docs/superpowers/specs/2026-11-24-qe5jrctd-fremdebenen-design.md („Daten“).
--
-- Metadaten und Inhalt getrennt wie `karte_hintergrundbild_daten` (LFH-936, 0154): die Liste
-- liest nie den Inhalt. Der Inhalt ist das normierte GeoJSON als BLOB (UTF-8-Text), damit er am
-- Spiegel wie ein Anhang auf Abruf kommt (`instanz::spiegel::anhang` erkennt den Inhalt an der
-- BLOB-Spalte); als TEXT läge eine Ebene bis 8 MiB über `paket::ZEILE_MAX`.
--
-- `url` gehört genau zur Quelle `url`. Die Spalten `quelle_etag` bis `fehler` führt nur die
-- URL-Ebene: `abgerufen_at` ist der letzte erfolgreiche Abruf (auch 304), `versucht_at` der
-- letzte Versuch, `fehler` dessen Code (`FremdebeneFehler`), nie der Text des Ziels.
-- Zeitpunkte UTC im Format `zeit::FORMAT` (ADR-0012), geschrieben aus Rust.
CREATE TABLE karte_fremdebene (
    id                   INTEGER PRIMARY KEY,
    einsatz_id           INTEGER NOT NULL REFERENCES einsatz(id) ON DELETE CASCADE,
    name                 TEXT    NOT NULL,
    quelle               TEXT    NOT NULL CHECK (quelle IN ('datei', 'url')),
    url                  TEXT,
    farbe                TEXT    NOT NULL,
    angelegt_von         INTEGER NOT NULL REFERENCES benutzer(id),
    erstellt_at          TEXT    NOT NULL,
    geaendert_at         TEXT    NOT NULL,
    quelle_etag          TEXT,
    quelle_last_modified TEXT,
    abgerufen_at         TEXT,
    versucht_at          TEXT,
    fehler               TEXT,
    CHECK ((quelle = 'url') = (url IS NOT NULL))
);
CREATE INDEX idx_karte_fremdebene_einsatz ON karte_fremdebene(einsatz_id);

-- `verworfen`: Zahl der Objekte ohne lesbare Geometrie.
CREATE TABLE karte_fremdebene_daten (
    ebene_id  INTEGER PRIMARY KEY REFERENCES karte_fremdebene(id) ON DELETE CASCADE,
    geojson   BLOB    NOT NULL,
    sha256    TEXT    NOT NULL,
    objekte   INTEGER NOT NULL,
    verworfen INTEGER NOT NULL
);

-- Spiegel (ADR-0018, `src/AGENTS.md`, „Spiegel und Anträge“): Log- und Schutz-Trigger, erzeugt mit
-- `spiegel::art::tests::erzeuge_migration`. Kein Grundstock: die Tabellen sind neu und leer.
-- karte_fremdebene
CREATE TRIGGER karte_fremdebene_spiegellog_i AFTER INSERT ON karte_fremdebene WHEN EXISTS (SELECT 1 FROM einsatz WHERE id = NEW.einsatz_id) BEGIN
    INSERT OR REPLACE INTO spiegel_neu_vergeben (einsatz_id, art, lokaler_schluessel, fremder_schluessel) SELECT NEW.einsatz_id, 'karte_fremdebene', CAST(NEW.id AS TEXT), COALESCE((SELECT fremder_schluessel FROM spiegel_herkunft WHERE einsatz_id = NEW.einsatz_id AND art = 'karte_fremdebene' AND lokaler_schluessel = CAST(NEW.id AS TEXT)), (SELECT fremder_schluessel FROM spiegel_neu_vergeben WHERE einsatz_id = NEW.einsatz_id AND art = 'karte_fremdebene' AND lokaler_schluessel = CAST(NEW.id AS TEXT))) WHERE NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND EXISTS (SELECT 1 FROM einsatz_aenderung WHERE einsatz_id = NEW.einsatz_id AND art = 'karte_fremdebene' AND schluessel = CAST(NEW.id AS TEXT));
    DELETE FROM spiegel_herkunft WHERE NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND art = 'karte_fremdebene' AND lokaler_schluessel = CAST(NEW.id AS TEXT);
    DELETE FROM einsatz_aenderung WHERE einsatz_id = NEW.einsatz_id AND art = 'karte_fremdebene' AND schluessel = CAST(NEW.id AS TEXT);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) VALUES (NEW.einsatz_id, 'karte_fremdebene', CAST(NEW.id AS TEXT));
END;
CREATE TRIGGER karte_fremdebene_spiegellog_u AFTER UPDATE ON karte_fremdebene BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'karte_fremdebene' AND ((einsatz_id = OLD.einsatz_id AND schluessel = CAST(OLD.id AS TEXT)) OR (einsatz_id = NEW.einsatz_id AND schluessel = CAST(NEW.id AS TEXT)));
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT OLD.einsatz_id, 'karte_fremdebene', CAST(OLD.id AS TEXT) WHERE (CAST(OLD.id AS TEXT) IS NOT CAST(NEW.id AS TEXT) OR OLD.einsatz_id IS NOT NEW.einsatz_id) AND EXISTS (SELECT 1 FROM einsatz WHERE id = OLD.einsatz_id);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT NEW.einsatz_id, 'karte_fremdebene', CAST(NEW.id AS TEXT) WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = NEW.einsatz_id);
END;
CREATE TRIGGER karte_fremdebene_spiegellog_d AFTER DELETE ON karte_fremdebene BEGIN
    DELETE FROM einsatz_aenderung WHERE einsatz_id = OLD.einsatz_id AND art = 'karte_fremdebene' AND schluessel = CAST(OLD.id AS TEXT);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT OLD.einsatz_id, 'karte_fremdebene', CAST(OLD.id AS TEXT) WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = OLD.einsatz_id);
END;
CREATE TRIGGER karte_fremdebene_spiegelschutz_i BEFORE INSERT ON karte_fremdebene WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = NEW.einsatz_id) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
CREATE TRIGGER karte_fremdebene_spiegelschutz_u BEFORE UPDATE ON karte_fremdebene WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND (EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = OLD.einsatz_id) OR EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = NEW.einsatz_id)) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
CREATE TRIGGER karte_fremdebene_spiegelschutz_d BEFORE DELETE ON karte_fremdebene WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = OLD.einsatz_id) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
-- karte_fremdebene_daten
CREATE TRIGGER karte_fremdebene_daten_spiegellog_i AFTER INSERT ON karte_fremdebene_daten WHEN EXISTS (SELECT 1 FROM einsatz WHERE id = (SELECT einsatz_id FROM karte_fremdebene WHERE id = NEW.ebene_id)) BEGIN
    DELETE FROM einsatz_aenderung WHERE einsatz_id = (SELECT einsatz_id FROM karte_fremdebene WHERE id = NEW.ebene_id) AND art = 'karte_fremdebene_daten' AND schluessel = CAST(NEW.ebene_id AS TEXT);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) VALUES ((SELECT einsatz_id FROM karte_fremdebene WHERE id = NEW.ebene_id), 'karte_fremdebene_daten', CAST(NEW.ebene_id AS TEXT));
END;
CREATE TRIGGER karte_fremdebene_daten_spiegellog_u AFTER UPDATE ON karte_fremdebene_daten BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'karte_fremdebene_daten' AND ((einsatz_id = (SELECT einsatz_id FROM karte_fremdebene WHERE id = OLD.ebene_id) AND schluessel = CAST(OLD.ebene_id AS TEXT)) OR (einsatz_id = (SELECT einsatz_id FROM karte_fremdebene WHERE id = NEW.ebene_id) AND schluessel = CAST(NEW.ebene_id AS TEXT)));
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT (SELECT einsatz_id FROM karte_fremdebene WHERE id = OLD.ebene_id), 'karte_fremdebene_daten', CAST(OLD.ebene_id AS TEXT) WHERE (CAST(OLD.ebene_id AS TEXT) IS NOT CAST(NEW.ebene_id AS TEXT) OR (SELECT einsatz_id FROM karte_fremdebene WHERE id = OLD.ebene_id) IS NOT (SELECT einsatz_id FROM karte_fremdebene WHERE id = NEW.ebene_id)) AND EXISTS (SELECT 1 FROM einsatz WHERE id = (SELECT einsatz_id FROM karte_fremdebene WHERE id = OLD.ebene_id));
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT (SELECT einsatz_id FROM karte_fremdebene WHERE id = NEW.ebene_id), 'karte_fremdebene_daten', CAST(NEW.ebene_id AS TEXT) WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = (SELECT einsatz_id FROM karte_fremdebene WHERE id = NEW.ebene_id));
END;
CREATE TRIGGER karte_fremdebene_daten_spiegellog_d AFTER DELETE ON karte_fremdebene_daten BEGIN
    DELETE FROM einsatz_aenderung WHERE einsatz_id = COALESCE((SELECT einsatz_id FROM karte_fremdebene WHERE id = OLD.ebene_id), (SELECT einsatz_id FROM einsatz_aenderung WHERE art = 'karte_fremdebene' AND schluessel = CAST(OLD.ebene_id AS TEXT) ORDER BY stand DESC LIMIT 1)) AND art = 'karte_fremdebene_daten' AND schluessel = CAST(OLD.ebene_id AS TEXT);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT COALESCE((SELECT einsatz_id FROM karte_fremdebene WHERE id = OLD.ebene_id), (SELECT einsatz_id FROM einsatz_aenderung WHERE art = 'karte_fremdebene' AND schluessel = CAST(OLD.ebene_id AS TEXT) ORDER BY stand DESC LIMIT 1)), 'karte_fremdebene_daten', CAST(OLD.ebene_id AS TEXT) WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = COALESCE((SELECT einsatz_id FROM karte_fremdebene WHERE id = OLD.ebene_id), (SELECT einsatz_id FROM einsatz_aenderung WHERE art = 'karte_fremdebene' AND schluessel = CAST(OLD.ebene_id AS TEXT) ORDER BY stand DESC LIMIT 1)));
END;
CREATE TRIGGER karte_fremdebene_daten_spiegelschutz_i BEFORE INSERT ON karte_fremdebene_daten WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = (SELECT einsatz_id FROM karte_fremdebene WHERE id = NEW.ebene_id)) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
CREATE TRIGGER karte_fremdebene_daten_spiegelschutz_u BEFORE UPDATE ON karte_fremdebene_daten WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND (EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = (SELECT einsatz_id FROM karte_fremdebene WHERE id = OLD.ebene_id)) OR EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = (SELECT einsatz_id FROM karte_fremdebene WHERE id = NEW.ebene_id))) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
CREATE TRIGGER karte_fremdebene_daten_spiegelschutz_d BEFORE DELETE ON karte_fremdebene_daten WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = (SELECT einsatz_id FROM karte_fremdebene WHERE id = OLD.ebene_id)) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
