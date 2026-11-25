-- LLH-2130: eingefrorene Inhalte der Fremdebenen für gesicherte Stände (Lage-Snapshot).
-- Entwurf: docs/superpowers/specs/2026-11-25-m6rhqco4-fremdebenen-stand-offline-design.md.
--
-- Eine Zeile je Einsatz und Inhalt (`sha256`): „Stand sichern“ kopiert den aktuellen Inhalt jeder
-- Ebene hierher (`INSERT OR IGNORE`), ein Stand nennt ihn in `daten.fremdebenen[*].sha256`. Eine
-- Verweistabelle gibt es nicht; nach dem Löschen eines Stands räumt `lage_snapshot::fremdebene`
-- jede Zeile, auf die kein Stand mehr zeigt. Der Inhalt ist das normierte GeoJSON als BLOB wie in
-- `karte_fremdebene_daten`, damit er am Spiegel auf Abruf kommt. `id` trägt der Nachlauf der
-- Schwärzung (`schwaerzung_nachlauf::EINZELN_GELOESCHT`) und der Spiegel.
CREATE TABLE karte_fremdebene_stand (
    id         INTEGER PRIMARY KEY,
    einsatz_id INTEGER NOT NULL REFERENCES einsatz(id) ON DELETE CASCADE,
    sha256     TEXT    NOT NULL,
    geojson    BLOB    NOT NULL,
    objekte    INTEGER NOT NULL,
    verworfen  INTEGER NOT NULL,
    UNIQUE (einsatz_id, sha256)
);

-- Spiegel (ADR-0018, `src/AGENTS.md`, „Spiegel und Anträge“): Log- und Schutz-Trigger, erzeugt mit
-- `spiegel::art::tests::erzeuge_migration`. Kein Grundstock: die Tabelle ist neu und leer.
-- karte_fremdebene_stand
CREATE TRIGGER karte_fremdebene_stand_spiegellog_i AFTER INSERT ON karte_fremdebene_stand WHEN EXISTS (SELECT 1 FROM einsatz WHERE id = NEW.einsatz_id) BEGIN
    INSERT OR REPLACE INTO spiegel_neu_vergeben (einsatz_id, art, lokaler_schluessel, fremder_schluessel) SELECT NEW.einsatz_id, 'karte_fremdebene_stand', CAST(NEW.id AS TEXT), COALESCE((SELECT fremder_schluessel FROM spiegel_herkunft WHERE einsatz_id = NEW.einsatz_id AND art = 'karte_fremdebene_stand' AND lokaler_schluessel = CAST(NEW.id AS TEXT)), (SELECT fremder_schluessel FROM spiegel_neu_vergeben WHERE einsatz_id = NEW.einsatz_id AND art = 'karte_fremdebene_stand' AND lokaler_schluessel = CAST(NEW.id AS TEXT))) WHERE NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND EXISTS (SELECT 1 FROM einsatz_aenderung WHERE einsatz_id = NEW.einsatz_id AND art = 'karte_fremdebene_stand' AND schluessel = CAST(NEW.id AS TEXT));
    DELETE FROM spiegel_herkunft WHERE NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND art = 'karte_fremdebene_stand' AND lokaler_schluessel = CAST(NEW.id AS TEXT);
    DELETE FROM einsatz_aenderung WHERE einsatz_id = NEW.einsatz_id AND art = 'karte_fremdebene_stand' AND schluessel = CAST(NEW.id AS TEXT);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) VALUES (NEW.einsatz_id, 'karte_fremdebene_stand', CAST(NEW.id AS TEXT));
END;
CREATE TRIGGER karte_fremdebene_stand_spiegellog_u AFTER UPDATE ON karte_fremdebene_stand BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'karte_fremdebene_stand' AND ((einsatz_id = OLD.einsatz_id AND schluessel = CAST(OLD.id AS TEXT)) OR (einsatz_id = NEW.einsatz_id AND schluessel = CAST(NEW.id AS TEXT)));
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT OLD.einsatz_id, 'karte_fremdebene_stand', CAST(OLD.id AS TEXT) WHERE (CAST(OLD.id AS TEXT) IS NOT CAST(NEW.id AS TEXT) OR OLD.einsatz_id IS NOT NEW.einsatz_id) AND EXISTS (SELECT 1 FROM einsatz WHERE id = OLD.einsatz_id);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT NEW.einsatz_id, 'karte_fremdebene_stand', CAST(NEW.id AS TEXT) WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = NEW.einsatz_id);
END;
CREATE TRIGGER karte_fremdebene_stand_spiegellog_d AFTER DELETE ON karte_fremdebene_stand BEGIN
    DELETE FROM einsatz_aenderung WHERE einsatz_id = OLD.einsatz_id AND art = 'karte_fremdebene_stand' AND schluessel = CAST(OLD.id AS TEXT);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT OLD.einsatz_id, 'karte_fremdebene_stand', CAST(OLD.id AS TEXT) WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = OLD.einsatz_id);
END;
CREATE TRIGGER karte_fremdebene_stand_spiegelschutz_i BEFORE INSERT ON karte_fremdebene_stand WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = NEW.einsatz_id) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
CREATE TRIGGER karte_fremdebene_stand_spiegelschutz_u BEFORE UPDATE ON karte_fremdebene_stand WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND (EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = OLD.einsatz_id) OR EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = NEW.einsatz_id)) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
CREATE TRIGGER karte_fremdebene_stand_spiegelschutz_d BEFORE DELETE ON karte_fremdebene_stand WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = OLD.einsatz_id) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
