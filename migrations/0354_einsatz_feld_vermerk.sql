-- LLH-1834 (Change `nvhnqynd-konflikt-und-aenderungsvermerk`, design.md D3): Änderungsvermerk je
-- Einzelangabe von Einsatzkopf, Einheit und eigener Führungsstelle — wer sie zuletzt geändert hat
-- und wann. Geschrieben in derselben Transaktion wie die Angabe, nur bei echter Wertänderung.
--
-- `einheit_id` ist nur bei `objekt_art = 'einheit'` gesetzt (CHECK); ein echter Fremdschlüssel
-- statt einer polymorphen Kennung, damit der Spiegel ihn ohne Sonderliste kennt und das Löschen
-- einer Einheit ihre Vermerke mitnimmt. Eindeutig je Einsatz, Objekt und Feld über den Index mit
-- `IFNULL(einheit_id, 0)` (NULL wäre in einem UNIQUE stets verschieden).
CREATE TABLE einsatz_feld_vermerk (
    id INTEGER PRIMARY KEY,
    einsatz_id INTEGER NOT NULL REFERENCES einsatz(id) ON DELETE CASCADE,
    objekt_art TEXT NOT NULL CHECK (objekt_art IN ('einsatz', 'einheit', 'fuehrungsstelle')),
    einheit_id INTEGER REFERENCES einsatz_einheit(id) ON DELETE CASCADE,
    feld TEXT NOT NULL,
    geaendert_at TEXT NOT NULL,
    geaendert_von INTEGER REFERENCES benutzer(id),
    CHECK ((objekt_art = 'einheit') = (einheit_id IS NOT NULL))
);

CREATE UNIQUE INDEX ux_einsatz_feld_vermerk
    ON einsatz_feld_vermerk (einsatz_id, objekt_art, IFNULL(einheit_id, 0), feld);

CREATE INDEX ix_einsatz_feld_vermerk_einheit ON einsatz_feld_vermerk (einheit_id);

-- Spiegel (ADR-0018, `src/AGENTS.md`, „Spiegel und Anträge“): Log- und Schutz-Trigger, erzeugt mit
-- `spiegel::art::tests::erzeuge_migration`. Kein Grundstock: die Tabelle ist neu und leer.
CREATE TRIGGER einsatz_feld_vermerk_spiegellog_i AFTER INSERT ON einsatz_feld_vermerk WHEN EXISTS (SELECT 1 FROM einsatz WHERE id = NEW.einsatz_id) BEGIN
    DELETE FROM einsatz_aenderung WHERE einsatz_id = NEW.einsatz_id AND art = 'einsatz_feld_vermerk' AND schluessel = CAST(NEW.id AS TEXT);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) VALUES (NEW.einsatz_id, 'einsatz_feld_vermerk', CAST(NEW.id AS TEXT));
END;
CREATE TRIGGER einsatz_feld_vermerk_spiegellog_u AFTER UPDATE ON einsatz_feld_vermerk BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'einsatz_feld_vermerk' AND ((einsatz_id = OLD.einsatz_id AND schluessel = CAST(OLD.id AS TEXT)) OR (einsatz_id = NEW.einsatz_id AND schluessel = CAST(NEW.id AS TEXT)));
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT OLD.einsatz_id, 'einsatz_feld_vermerk', CAST(OLD.id AS TEXT) WHERE (CAST(OLD.id AS TEXT) IS NOT CAST(NEW.id AS TEXT) OR OLD.einsatz_id IS NOT NEW.einsatz_id) AND EXISTS (SELECT 1 FROM einsatz WHERE id = OLD.einsatz_id);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT NEW.einsatz_id, 'einsatz_feld_vermerk', CAST(NEW.id AS TEXT) WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = NEW.einsatz_id);
END;
CREATE TRIGGER einsatz_feld_vermerk_spiegellog_d AFTER DELETE ON einsatz_feld_vermerk BEGIN
    DELETE FROM einsatz_aenderung WHERE einsatz_id = OLD.einsatz_id AND art = 'einsatz_feld_vermerk' AND schluessel = CAST(OLD.id AS TEXT);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT OLD.einsatz_id, 'einsatz_feld_vermerk', CAST(OLD.id AS TEXT) WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = OLD.einsatz_id);
END;
CREATE TRIGGER einsatz_feld_vermerk_spiegelschutz_i BEFORE INSERT ON einsatz_feld_vermerk WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = NEW.einsatz_id) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
CREATE TRIGGER einsatz_feld_vermerk_spiegelschutz_u BEFORE UPDATE ON einsatz_feld_vermerk WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND (EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = OLD.einsatz_id) OR EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = NEW.einsatz_id)) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
CREATE TRIGGER einsatz_feld_vermerk_spiegelschutz_d BEFORE DELETE ON einsatz_feld_vermerk WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = OLD.einsatz_id) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;