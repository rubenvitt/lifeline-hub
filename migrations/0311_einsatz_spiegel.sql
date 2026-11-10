-- LLH-1492: Spiegel eines Einsatzes an einer gekoppelten Instanz (Change
-- polrv1lt-spiegel-antraege, design.md D1, D2, D4, D5, D10). Rein additiv.
--
-- Änderungslog je Einsatz (D1): je (Tabelle, Schlüssel) höchstens eine Zeile mit dem Stand der
-- letzten Änderung. `stand` ist global und steigt nur; geliefert wird je Einsatz. Gefüllt nur von
-- den Triggern unten (erzeugt von `instanz::spiegel::art::trigger_sql`, geprüft vom Test
-- `art::tests::trigger_passen_zur_beschreibung`), kein Schreibweg in Rust. `schluessel` ist der
-- Primärschlüssel als Text, bei mehreren Spalten als JSON-Array, ohne Primärschlüssel die rowid.
-- Ob eine Zeile gelöscht ist, sagt erst der Blick in ihre Tabelle. Kein Fremdschlüssel auf
-- `einsatz`: Mit dem Einsatz löscht sein eigener Trigger die Logzeilen.
CREATE TABLE einsatz_aenderung (
    stand      INTEGER PRIMARY KEY AUTOINCREMENT,
    einsatz_id INTEGER NOT NULL,
    art        TEXT NOT NULL,
    schluessel TEXT NOT NULL,
    UNIQUE (art, schluessel)
);
CREATE INDEX idx_einsatz_aenderung_einsatz ON einsatz_aenderung (einsatz_id, stand);

-- Kennung über Instanzen hinweg (D2): `<instanzkennung>/<id>` des Führers, gesetzt beim ersten
-- Liefern, am Spiegel unverändert übernommen. Freigabestufe: gebaut ist nur `alles`.
ALTER TABLE einsatz ADD COLUMN kennung TEXT;
CREATE UNIQUE INDEX idx_einsatz_kennung ON einsatz (kennung) WHERE kennung IS NOT NULL;
ALTER TABLE einsatz ADD COLUMN freigabestufe TEXT NOT NULL DEFAULT 'alles'
    CHECK (freigabestufe IN ('alles'));

-- Ein Einsatz mit Zeile hier ist ein Spiegel; ohne Zeile führt ihn diese Instanz (D4). Eine
-- Übergabe (LLH-1491) legt die Zeile an oder entfernt sie, ohne Daten zu kopieren.
CREATE TABLE einsatz_spiegel (
    einsatz_id          INTEGER PRIMARY KEY REFERENCES einsatz(id) ON DELETE CASCADE,
    kopplung_org_id     INTEGER REFERENCES instanz_kopplung_org(id) ON DELETE SET NULL,
    fremde_kennung      TEXT NOT NULL UNIQUE,
    stand               INTEGER NOT NULL DEFAULT 0,
    freigabestufe       TEXT NOT NULL DEFAULT 'alles',
    letzter_abgleich_at TEXT,
    hinweis             TEXT,
    beendet_at          TEXT
);

-- Abbildung der Zeilen eines Spiegels (D4, D5): wie eine lokale Zeile beim Führer heißt.
CREATE TABLE spiegel_herkunft (
    einsatz_id         INTEGER NOT NULL REFERENCES einsatz(id) ON DELETE CASCADE,
    art                TEXT NOT NULL,
    fremder_schluessel TEXT NOT NULL,
    lokaler_schluessel TEXT NOT NULL,
    PRIMARY KEY (einsatz_id, art, fremder_schluessel),
    UNIQUE (art, lokaler_schluessel)
);

-- Merker der Übernahme (D7, D10): Solange die eine Zeile steht, lassen die Schutz-Trigger
-- schreiben. Nur die Übernahme setzt sie in ihrer Transaktion und löscht sie vor dem Commit.
CREATE TABLE spiegel_uebernahme (
    id INTEGER PRIMARY KEY CHECK (id = 1)
);

-- An der meldenden Seite, wenn sie führt (D6, Push): bis zu welchem Stand die erreichte Seite
-- einen Einsatz übernommen hat.
CREATE TABLE spiegel_ziel (
    kopplung_org_id INTEGER NOT NULL REFERENCES instanz_kopplung_org(id) ON DELETE CASCADE,
    einsatz_id      INTEGER NOT NULL REFERENCES einsatz(id) ON DELETE CASCADE,
    stand           INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (kopplung_org_id, einsatz_id)
);

-- Stellvertreter fremder Konten (D5, Nachtrag 10.11.2026): je fremdem Konto und Kopplung ein
-- lokales Konto ohne Anmeldung, damit Pflichtverweise und der Anzeigename des Verfassers bleiben.
CREATE TABLE spiegel_konto (
    kopplung_id INTEGER NOT NULL REFERENCES instanz_kopplung(id),
    fremde_id   INTEGER NOT NULL,
    benutzer_id INTEGER NOT NULL UNIQUE REFERENCES benutzer(id),
    PRIMARY KEY (kopplung_id, fremde_id)
);

-- Log- und Schutz-Trigger je gespiegelter Tabelle (D1, D10), erzeugt von
-- `instanz::spiegel::art::trigger_sql`. Schutz: an einem Spiegel schreibt nur die Übernahme.
-- einsatz
CREATE TRIGGER einsatz_spiegellog_i AFTER INSERT ON einsatz WHEN EXISTS (SELECT 1 FROM einsatz WHERE id = NEW.id) BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'einsatz' AND schluessel = CAST(NEW.id AS TEXT);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) VALUES (NEW.id, 'einsatz', CAST(NEW.id AS TEXT));
END;
CREATE TRIGGER einsatz_spiegellog_u AFTER UPDATE ON einsatz BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'einsatz' AND schluessel IN (CAST(OLD.id AS TEXT), CAST(NEW.id AS TEXT));
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT OLD.id, 'einsatz', CAST(OLD.id AS TEXT) WHERE CAST(OLD.id AS TEXT) IS NOT CAST(NEW.id AS TEXT) AND EXISTS (SELECT 1 FROM einsatz WHERE id = OLD.id);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT NEW.id, 'einsatz', CAST(NEW.id AS TEXT) WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = NEW.id);
END;
CREATE TRIGGER einsatz_spiegellog_d AFTER DELETE ON einsatz BEGIN
    DELETE FROM einsatz_aenderung WHERE einsatz_id = OLD.id;
END;
CREATE TRIGGER einsatz_spiegelschutz_i BEFORE INSERT ON einsatz WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = NEW.id) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
CREATE TRIGGER einsatz_spiegelschutz_u BEFORE UPDATE ON einsatz WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND (EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = OLD.id) OR EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = NEW.id)) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
CREATE TRIGGER einsatz_spiegelschutz_d BEFORE DELETE ON einsatz WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = OLD.id) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
-- einsatz_mitgliedschaft
CREATE TRIGGER einsatz_mitgliedschaft_spiegellog_i AFTER INSERT ON einsatz_mitgliedschaft WHEN EXISTS (SELECT 1 FROM einsatz WHERE id = NEW.einsatz_id) BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'einsatz_mitgliedschaft' AND schluessel = json_array(NEW.einsatz_id, NEW.benutzer_id);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) VALUES (NEW.einsatz_id, 'einsatz_mitgliedschaft', json_array(NEW.einsatz_id, NEW.benutzer_id));
END;
CREATE TRIGGER einsatz_mitgliedschaft_spiegellog_u AFTER UPDATE ON einsatz_mitgliedschaft BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'einsatz_mitgliedschaft' AND schluessel IN (json_array(OLD.einsatz_id, OLD.benutzer_id), json_array(NEW.einsatz_id, NEW.benutzer_id));
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT OLD.einsatz_id, 'einsatz_mitgliedschaft', json_array(OLD.einsatz_id, OLD.benutzer_id) WHERE json_array(OLD.einsatz_id, OLD.benutzer_id) IS NOT json_array(NEW.einsatz_id, NEW.benutzer_id) AND EXISTS (SELECT 1 FROM einsatz WHERE id = OLD.einsatz_id);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT NEW.einsatz_id, 'einsatz_mitgliedschaft', json_array(NEW.einsatz_id, NEW.benutzer_id) WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = NEW.einsatz_id);
END;
CREATE TRIGGER einsatz_mitgliedschaft_spiegellog_d AFTER DELETE ON einsatz_mitgliedschaft BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'einsatz_mitgliedschaft' AND schluessel = json_array(OLD.einsatz_id, OLD.benutzer_id);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT OLD.einsatz_id, 'einsatz_mitgliedschaft', json_array(OLD.einsatz_id, OLD.benutzer_id) WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = OLD.einsatz_id);
END;
CREATE TRIGGER einsatz_mitgliedschaft_spiegelschutz_i BEFORE INSERT ON einsatz_mitgliedschaft WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = NEW.einsatz_id) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
CREATE TRIGGER einsatz_mitgliedschaft_spiegelschutz_u BEFORE UPDATE ON einsatz_mitgliedschaft WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND (EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = OLD.einsatz_id) OR EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = NEW.einsatz_id)) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
CREATE TRIGGER einsatz_mitgliedschaft_spiegelschutz_d BEFORE DELETE ON einsatz_mitgliedschaft WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = OLD.einsatz_id) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
-- einsatz_einstellungen
CREATE TRIGGER einsatz_einstellungen_spiegellog_i AFTER INSERT ON einsatz_einstellungen WHEN EXISTS (SELECT 1 FROM einsatz WHERE id = NEW.einsatz_id) BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'einsatz_einstellungen' AND schluessel = CAST(NEW.einsatz_id AS TEXT);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) VALUES (NEW.einsatz_id, 'einsatz_einstellungen', CAST(NEW.einsatz_id AS TEXT));
END;
CREATE TRIGGER einsatz_einstellungen_spiegellog_u AFTER UPDATE ON einsatz_einstellungen BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'einsatz_einstellungen' AND schluessel IN (CAST(OLD.einsatz_id AS TEXT), CAST(NEW.einsatz_id AS TEXT));
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT OLD.einsatz_id, 'einsatz_einstellungen', CAST(OLD.einsatz_id AS TEXT) WHERE CAST(OLD.einsatz_id AS TEXT) IS NOT CAST(NEW.einsatz_id AS TEXT) AND EXISTS (SELECT 1 FROM einsatz WHERE id = OLD.einsatz_id);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT NEW.einsatz_id, 'einsatz_einstellungen', CAST(NEW.einsatz_id AS TEXT) WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = NEW.einsatz_id);
END;
CREATE TRIGGER einsatz_einstellungen_spiegellog_d AFTER DELETE ON einsatz_einstellungen BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'einsatz_einstellungen' AND schluessel = CAST(OLD.einsatz_id AS TEXT);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT OLD.einsatz_id, 'einsatz_einstellungen', CAST(OLD.einsatz_id AS TEXT) WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = OLD.einsatz_id);
END;
CREATE TRIGGER einsatz_einstellungen_spiegelschutz_i BEFORE INSERT ON einsatz_einstellungen WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = NEW.einsatz_id) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
CREATE TRIGGER einsatz_einstellungen_spiegelschutz_u BEFORE UPDATE ON einsatz_einstellungen WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND (EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = OLD.einsatz_id) OR EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = NEW.einsatz_id)) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
CREATE TRIGGER einsatz_einstellungen_spiegelschutz_d BEFORE DELETE ON einsatz_einstellungen WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = OLD.einsatz_id) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
-- einsatz_modul_override
CREATE TRIGGER einsatz_modul_override_spiegellog_i AFTER INSERT ON einsatz_modul_override WHEN EXISTS (SELECT 1 FROM einsatz WHERE id = NEW.einsatz_id) BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'einsatz_modul_override' AND schluessel = json_array(NEW.einsatz_id, NEW.modul_key);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) VALUES (NEW.einsatz_id, 'einsatz_modul_override', json_array(NEW.einsatz_id, NEW.modul_key));
END;
CREATE TRIGGER einsatz_modul_override_spiegellog_u AFTER UPDATE ON einsatz_modul_override BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'einsatz_modul_override' AND schluessel IN (json_array(OLD.einsatz_id, OLD.modul_key), json_array(NEW.einsatz_id, NEW.modul_key));
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT OLD.einsatz_id, 'einsatz_modul_override', json_array(OLD.einsatz_id, OLD.modul_key) WHERE json_array(OLD.einsatz_id, OLD.modul_key) IS NOT json_array(NEW.einsatz_id, NEW.modul_key) AND EXISTS (SELECT 1 FROM einsatz WHERE id = OLD.einsatz_id);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT NEW.einsatz_id, 'einsatz_modul_override', json_array(NEW.einsatz_id, NEW.modul_key) WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = NEW.einsatz_id);
END;
CREATE TRIGGER einsatz_modul_override_spiegellog_d AFTER DELETE ON einsatz_modul_override BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'einsatz_modul_override' AND schluessel = json_array(OLD.einsatz_id, OLD.modul_key);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT OLD.einsatz_id, 'einsatz_modul_override', json_array(OLD.einsatz_id, OLD.modul_key) WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = OLD.einsatz_id);
END;
CREATE TRIGGER einsatz_modul_override_spiegelschutz_i BEFORE INSERT ON einsatz_modul_override WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = NEW.einsatz_id) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
CREATE TRIGGER einsatz_modul_override_spiegelschutz_u BEFORE UPDATE ON einsatz_modul_override WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND (EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = OLD.einsatz_id) OR EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = NEW.einsatz_id)) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
CREATE TRIGGER einsatz_modul_override_spiegelschutz_d BEFORE DELETE ON einsatz_modul_override WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = OLD.einsatz_id) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
-- einsatz_fuehrungsstelle
CREATE TRIGGER einsatz_fuehrungsstelle_spiegellog_i AFTER INSERT ON einsatz_fuehrungsstelle WHEN EXISTS (SELECT 1 FROM einsatz WHERE id = NEW.einsatz_id) BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'einsatz_fuehrungsstelle' AND schluessel = CAST(NEW.einsatz_id AS TEXT);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) VALUES (NEW.einsatz_id, 'einsatz_fuehrungsstelle', CAST(NEW.einsatz_id AS TEXT));
END;
CREATE TRIGGER einsatz_fuehrungsstelle_spiegellog_u AFTER UPDATE ON einsatz_fuehrungsstelle BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'einsatz_fuehrungsstelle' AND schluessel IN (CAST(OLD.einsatz_id AS TEXT), CAST(NEW.einsatz_id AS TEXT));
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT OLD.einsatz_id, 'einsatz_fuehrungsstelle', CAST(OLD.einsatz_id AS TEXT) WHERE CAST(OLD.einsatz_id AS TEXT) IS NOT CAST(NEW.einsatz_id AS TEXT) AND EXISTS (SELECT 1 FROM einsatz WHERE id = OLD.einsatz_id);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT NEW.einsatz_id, 'einsatz_fuehrungsstelle', CAST(NEW.einsatz_id AS TEXT) WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = NEW.einsatz_id);
END;
CREATE TRIGGER einsatz_fuehrungsstelle_spiegellog_d AFTER DELETE ON einsatz_fuehrungsstelle BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'einsatz_fuehrungsstelle' AND schluessel = CAST(OLD.einsatz_id AS TEXT);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT OLD.einsatz_id, 'einsatz_fuehrungsstelle', CAST(OLD.einsatz_id AS TEXT) WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = OLD.einsatz_id);
END;
CREATE TRIGGER einsatz_fuehrungsstelle_spiegelschutz_i BEFORE INSERT ON einsatz_fuehrungsstelle WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = NEW.einsatz_id) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
CREATE TRIGGER einsatz_fuehrungsstelle_spiegelschutz_u BEFORE UPDATE ON einsatz_fuehrungsstelle WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND (EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = OLD.einsatz_id) OR EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = NEW.einsatz_id)) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
CREATE TRIGGER einsatz_fuehrungsstelle_spiegelschutz_d BEFORE DELETE ON einsatz_fuehrungsstelle WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = OLD.einsatz_id) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
-- einsatz_fuehrungsstelle_sprechgruppe
CREATE TRIGGER einsatz_fuehrungsstelle_sprechgruppe_spiegellog_i AFTER INSERT ON einsatz_fuehrungsstelle_sprechgruppe WHEN EXISTS (SELECT 1 FROM einsatz WHERE id = NEW.einsatz_id) BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'einsatz_fuehrungsstelle_sprechgruppe' AND schluessel = json_array(NEW.einsatz_id, NEW.sprechgruppe_id);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) VALUES (NEW.einsatz_id, 'einsatz_fuehrungsstelle_sprechgruppe', json_array(NEW.einsatz_id, NEW.sprechgruppe_id));
END;
CREATE TRIGGER einsatz_fuehrungsstelle_sprechgruppe_spiegellog_u AFTER UPDATE ON einsatz_fuehrungsstelle_sprechgruppe BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'einsatz_fuehrungsstelle_sprechgruppe' AND schluessel IN (json_array(OLD.einsatz_id, OLD.sprechgruppe_id), json_array(NEW.einsatz_id, NEW.sprechgruppe_id));
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT OLD.einsatz_id, 'einsatz_fuehrungsstelle_sprechgruppe', json_array(OLD.einsatz_id, OLD.sprechgruppe_id) WHERE json_array(OLD.einsatz_id, OLD.sprechgruppe_id) IS NOT json_array(NEW.einsatz_id, NEW.sprechgruppe_id) AND EXISTS (SELECT 1 FROM einsatz WHERE id = OLD.einsatz_id);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT NEW.einsatz_id, 'einsatz_fuehrungsstelle_sprechgruppe', json_array(NEW.einsatz_id, NEW.sprechgruppe_id) WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = NEW.einsatz_id);
END;
CREATE TRIGGER einsatz_fuehrungsstelle_sprechgruppe_spiegellog_d AFTER DELETE ON einsatz_fuehrungsstelle_sprechgruppe BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'einsatz_fuehrungsstelle_sprechgruppe' AND schluessel = json_array(OLD.einsatz_id, OLD.sprechgruppe_id);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT OLD.einsatz_id, 'einsatz_fuehrungsstelle_sprechgruppe', json_array(OLD.einsatz_id, OLD.sprechgruppe_id) WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = OLD.einsatz_id);
END;
CREATE TRIGGER einsatz_fuehrungsstelle_sprechgruppe_spiegelschutz_i BEFORE INSERT ON einsatz_fuehrungsstelle_sprechgruppe WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = NEW.einsatz_id) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
CREATE TRIGGER einsatz_fuehrungsstelle_sprechgruppe_spiegelschutz_u BEFORE UPDATE ON einsatz_fuehrungsstelle_sprechgruppe WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND (EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = OLD.einsatz_id) OR EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = NEW.einsatz_id)) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
CREATE TRIGGER einsatz_fuehrungsstelle_sprechgruppe_spiegelschutz_d BEFORE DELETE ON einsatz_fuehrungsstelle_sprechgruppe WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = OLD.einsatz_id) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
-- einsatz_fuehrungsstelle_fahrzeug
CREATE TRIGGER einsatz_fuehrungsstelle_fahrzeug_spiegellog_i AFTER INSERT ON einsatz_fuehrungsstelle_fahrzeug WHEN EXISTS (SELECT 1 FROM einsatz WHERE id = NEW.einsatz_id) BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'einsatz_fuehrungsstelle_fahrzeug' AND schluessel = json_array(NEW.einsatz_id, NEW.einsatz_fahrzeug_id);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) VALUES (NEW.einsatz_id, 'einsatz_fuehrungsstelle_fahrzeug', json_array(NEW.einsatz_id, NEW.einsatz_fahrzeug_id));
END;
CREATE TRIGGER einsatz_fuehrungsstelle_fahrzeug_spiegellog_u AFTER UPDATE ON einsatz_fuehrungsstelle_fahrzeug BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'einsatz_fuehrungsstelle_fahrzeug' AND schluessel IN (json_array(OLD.einsatz_id, OLD.einsatz_fahrzeug_id), json_array(NEW.einsatz_id, NEW.einsatz_fahrzeug_id));
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT OLD.einsatz_id, 'einsatz_fuehrungsstelle_fahrzeug', json_array(OLD.einsatz_id, OLD.einsatz_fahrzeug_id) WHERE json_array(OLD.einsatz_id, OLD.einsatz_fahrzeug_id) IS NOT json_array(NEW.einsatz_id, NEW.einsatz_fahrzeug_id) AND EXISTS (SELECT 1 FROM einsatz WHERE id = OLD.einsatz_id);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT NEW.einsatz_id, 'einsatz_fuehrungsstelle_fahrzeug', json_array(NEW.einsatz_id, NEW.einsatz_fahrzeug_id) WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = NEW.einsatz_id);
END;
CREATE TRIGGER einsatz_fuehrungsstelle_fahrzeug_spiegellog_d AFTER DELETE ON einsatz_fuehrungsstelle_fahrzeug BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'einsatz_fuehrungsstelle_fahrzeug' AND schluessel = json_array(OLD.einsatz_id, OLD.einsatz_fahrzeug_id);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT OLD.einsatz_id, 'einsatz_fuehrungsstelle_fahrzeug', json_array(OLD.einsatz_id, OLD.einsatz_fahrzeug_id) WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = OLD.einsatz_id);
END;
CREATE TRIGGER einsatz_fuehrungsstelle_fahrzeug_spiegelschutz_i BEFORE INSERT ON einsatz_fuehrungsstelle_fahrzeug WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = NEW.einsatz_id) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
CREATE TRIGGER einsatz_fuehrungsstelle_fahrzeug_spiegelschutz_u BEFORE UPDATE ON einsatz_fuehrungsstelle_fahrzeug WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND (EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = OLD.einsatz_id) OR EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = NEW.einsatz_id)) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
CREATE TRIGGER einsatz_fuehrungsstelle_fahrzeug_spiegelschutz_d BEFORE DELETE ON einsatz_fuehrungsstelle_fahrzeug WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = OLD.einsatz_id) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
-- einsatz_lagebesprechung
CREATE TRIGGER einsatz_lagebesprechung_spiegellog_i AFTER INSERT ON einsatz_lagebesprechung WHEN EXISTS (SELECT 1 FROM einsatz WHERE id = NEW.einsatz_id) BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'einsatz_lagebesprechung' AND schluessel = CAST(NEW.id AS TEXT);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) VALUES (NEW.einsatz_id, 'einsatz_lagebesprechung', CAST(NEW.id AS TEXT));
END;
CREATE TRIGGER einsatz_lagebesprechung_spiegellog_u AFTER UPDATE ON einsatz_lagebesprechung BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'einsatz_lagebesprechung' AND schluessel IN (CAST(OLD.id AS TEXT), CAST(NEW.id AS TEXT));
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT OLD.einsatz_id, 'einsatz_lagebesprechung', CAST(OLD.id AS TEXT) WHERE CAST(OLD.id AS TEXT) IS NOT CAST(NEW.id AS TEXT) AND EXISTS (SELECT 1 FROM einsatz WHERE id = OLD.einsatz_id);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT NEW.einsatz_id, 'einsatz_lagebesprechung', CAST(NEW.id AS TEXT) WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = NEW.einsatz_id);
END;
CREATE TRIGGER einsatz_lagebesprechung_spiegellog_d AFTER DELETE ON einsatz_lagebesprechung BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'einsatz_lagebesprechung' AND schluessel = CAST(OLD.id AS TEXT);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT OLD.einsatz_id, 'einsatz_lagebesprechung', CAST(OLD.id AS TEXT) WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = OLD.einsatz_id);
END;
CREATE TRIGGER einsatz_lagebesprechung_spiegelschutz_i BEFORE INSERT ON einsatz_lagebesprechung WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = NEW.einsatz_id) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
CREATE TRIGGER einsatz_lagebesprechung_spiegelschutz_u BEFORE UPDATE ON einsatz_lagebesprechung WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND (EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = OLD.einsatz_id) OR EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = NEW.einsatz_id)) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
CREATE TRIGGER einsatz_lagebesprechung_spiegelschutz_d BEFORE DELETE ON einsatz_lagebesprechung WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = OLD.einsatz_id) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
-- einsatz_lagekennzahl_wahl
CREATE TRIGGER einsatz_lagekennzahl_wahl_spiegellog_i AFTER INSERT ON einsatz_lagekennzahl_wahl WHEN EXISTS (SELECT 1 FROM einsatz WHERE id = NEW.einsatz_id) BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'einsatz_lagekennzahl_wahl' AND schluessel = json_array(NEW.einsatz_id, NEW.kennzahl);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) VALUES (NEW.einsatz_id, 'einsatz_lagekennzahl_wahl', json_array(NEW.einsatz_id, NEW.kennzahl));
END;
CREATE TRIGGER einsatz_lagekennzahl_wahl_spiegellog_u AFTER UPDATE ON einsatz_lagekennzahl_wahl BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'einsatz_lagekennzahl_wahl' AND schluessel IN (json_array(OLD.einsatz_id, OLD.kennzahl), json_array(NEW.einsatz_id, NEW.kennzahl));
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT OLD.einsatz_id, 'einsatz_lagekennzahl_wahl', json_array(OLD.einsatz_id, OLD.kennzahl) WHERE json_array(OLD.einsatz_id, OLD.kennzahl) IS NOT json_array(NEW.einsatz_id, NEW.kennzahl) AND EXISTS (SELECT 1 FROM einsatz WHERE id = OLD.einsatz_id);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT NEW.einsatz_id, 'einsatz_lagekennzahl_wahl', json_array(NEW.einsatz_id, NEW.kennzahl) WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = NEW.einsatz_id);
END;
CREATE TRIGGER einsatz_lagekennzahl_wahl_spiegellog_d AFTER DELETE ON einsatz_lagekennzahl_wahl BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'einsatz_lagekennzahl_wahl' AND schluessel = json_array(OLD.einsatz_id, OLD.kennzahl);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT OLD.einsatz_id, 'einsatz_lagekennzahl_wahl', json_array(OLD.einsatz_id, OLD.kennzahl) WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = OLD.einsatz_id);
END;
CREATE TRIGGER einsatz_lagekennzahl_wahl_spiegelschutz_i BEFORE INSERT ON einsatz_lagekennzahl_wahl WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = NEW.einsatz_id) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
CREATE TRIGGER einsatz_lagekennzahl_wahl_spiegelschutz_u BEFORE UPDATE ON einsatz_lagekennzahl_wahl WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND (EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = OLD.einsatz_id) OR EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = NEW.einsatz_id)) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
CREATE TRIGGER einsatz_lagekennzahl_wahl_spiegelschutz_d BEFORE DELETE ON einsatz_lagekennzahl_wahl WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = OLD.einsatz_id) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
-- einsatzabschnitt
CREATE TRIGGER einsatzabschnitt_spiegellog_i AFTER INSERT ON einsatzabschnitt WHEN EXISTS (SELECT 1 FROM einsatz WHERE id = NEW.einsatz_id) BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'einsatzabschnitt' AND schluessel = CAST(NEW.id AS TEXT);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) VALUES (NEW.einsatz_id, 'einsatzabschnitt', CAST(NEW.id AS TEXT));
END;
CREATE TRIGGER einsatzabschnitt_spiegellog_u AFTER UPDATE ON einsatzabschnitt BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'einsatzabschnitt' AND schluessel IN (CAST(OLD.id AS TEXT), CAST(NEW.id AS TEXT));
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT OLD.einsatz_id, 'einsatzabschnitt', CAST(OLD.id AS TEXT) WHERE CAST(OLD.id AS TEXT) IS NOT CAST(NEW.id AS TEXT) AND EXISTS (SELECT 1 FROM einsatz WHERE id = OLD.einsatz_id);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT NEW.einsatz_id, 'einsatzabschnitt', CAST(NEW.id AS TEXT) WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = NEW.einsatz_id);
END;
CREATE TRIGGER einsatzabschnitt_spiegellog_d AFTER DELETE ON einsatzabschnitt BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'einsatzabschnitt' AND schluessel = CAST(OLD.id AS TEXT);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT OLD.einsatz_id, 'einsatzabschnitt', CAST(OLD.id AS TEXT) WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = OLD.einsatz_id);
END;
CREATE TRIGGER einsatzabschnitt_spiegelschutz_i BEFORE INSERT ON einsatzabschnitt WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = NEW.einsatz_id) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
CREATE TRIGGER einsatzabschnitt_spiegelschutz_u BEFORE UPDATE ON einsatzabschnitt WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND (EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = OLD.einsatz_id) OR EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = NEW.einsatz_id)) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
CREATE TRIGGER einsatzabschnitt_spiegelschutz_d BEFORE DELETE ON einsatzabschnitt WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = OLD.einsatz_id) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
-- einsatzabschnitt_sprechgruppe
CREATE TRIGGER einsatzabschnitt_sprechgruppe_spiegellog_i AFTER INSERT ON einsatzabschnitt_sprechgruppe WHEN EXISTS (SELECT 1 FROM einsatz WHERE id = (SELECT einsatz_id FROM einsatzabschnitt WHERE id = NEW.abschnitt_id)) BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'einsatzabschnitt_sprechgruppe' AND schluessel = json_array(NEW.abschnitt_id, NEW.sprechgruppe_id);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) VALUES ((SELECT einsatz_id FROM einsatzabschnitt WHERE id = NEW.abschnitt_id), 'einsatzabschnitt_sprechgruppe', json_array(NEW.abschnitt_id, NEW.sprechgruppe_id));
END;
CREATE TRIGGER einsatzabschnitt_sprechgruppe_spiegellog_u AFTER UPDATE ON einsatzabschnitt_sprechgruppe BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'einsatzabschnitt_sprechgruppe' AND schluessel IN (json_array(OLD.abschnitt_id, OLD.sprechgruppe_id), json_array(NEW.abschnitt_id, NEW.sprechgruppe_id));
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT (SELECT einsatz_id FROM einsatzabschnitt WHERE id = OLD.abschnitt_id), 'einsatzabschnitt_sprechgruppe', json_array(OLD.abschnitt_id, OLD.sprechgruppe_id) WHERE json_array(OLD.abschnitt_id, OLD.sprechgruppe_id) IS NOT json_array(NEW.abschnitt_id, NEW.sprechgruppe_id) AND EXISTS (SELECT 1 FROM einsatz WHERE id = (SELECT einsatz_id FROM einsatzabschnitt WHERE id = OLD.abschnitt_id));
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT (SELECT einsatz_id FROM einsatzabschnitt WHERE id = NEW.abschnitt_id), 'einsatzabschnitt_sprechgruppe', json_array(NEW.abschnitt_id, NEW.sprechgruppe_id) WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = (SELECT einsatz_id FROM einsatzabschnitt WHERE id = NEW.abschnitt_id));
END;
CREATE TRIGGER einsatzabschnitt_sprechgruppe_spiegellog_d AFTER DELETE ON einsatzabschnitt_sprechgruppe BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'einsatzabschnitt_sprechgruppe' AND schluessel = json_array(OLD.abschnitt_id, OLD.sprechgruppe_id);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT (SELECT einsatz_id FROM einsatzabschnitt WHERE id = OLD.abschnitt_id), 'einsatzabschnitt_sprechgruppe', json_array(OLD.abschnitt_id, OLD.sprechgruppe_id) WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = (SELECT einsatz_id FROM einsatzabschnitt WHERE id = OLD.abschnitt_id));
END;
CREATE TRIGGER einsatzabschnitt_sprechgruppe_spiegelschutz_i BEFORE INSERT ON einsatzabschnitt_sprechgruppe WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = (SELECT einsatz_id FROM einsatzabschnitt WHERE id = NEW.abschnitt_id)) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
CREATE TRIGGER einsatzabschnitt_sprechgruppe_spiegelschutz_u BEFORE UPDATE ON einsatzabschnitt_sprechgruppe WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND (EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = (SELECT einsatz_id FROM einsatzabschnitt WHERE id = OLD.abschnitt_id)) OR EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = (SELECT einsatz_id FROM einsatzabschnitt WHERE id = NEW.abschnitt_id))) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
CREATE TRIGGER einsatzabschnitt_sprechgruppe_spiegelschutz_d BEFORE DELETE ON einsatzabschnitt_sprechgruppe WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = (SELECT einsatz_id FROM einsatzabschnitt WHERE id = OLD.abschnitt_id)) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
-- erinnerung
CREATE TRIGGER erinnerung_spiegellog_i AFTER INSERT ON erinnerung WHEN EXISTS (SELECT 1 FROM einsatz WHERE id = NEW.einsatz_id) BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'erinnerung' AND schluessel = CAST(NEW.id AS TEXT);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) VALUES (NEW.einsatz_id, 'erinnerung', CAST(NEW.id AS TEXT));
END;
CREATE TRIGGER erinnerung_spiegellog_u AFTER UPDATE ON erinnerung BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'erinnerung' AND schluessel IN (CAST(OLD.id AS TEXT), CAST(NEW.id AS TEXT));
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT OLD.einsatz_id, 'erinnerung', CAST(OLD.id AS TEXT) WHERE CAST(OLD.id AS TEXT) IS NOT CAST(NEW.id AS TEXT) AND EXISTS (SELECT 1 FROM einsatz WHERE id = OLD.einsatz_id);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT NEW.einsatz_id, 'erinnerung', CAST(NEW.id AS TEXT) WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = NEW.einsatz_id);
END;
CREATE TRIGGER erinnerung_spiegellog_d AFTER DELETE ON erinnerung BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'erinnerung' AND schluessel = CAST(OLD.id AS TEXT);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT OLD.einsatz_id, 'erinnerung', CAST(OLD.id AS TEXT) WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = OLD.einsatz_id);
END;
CREATE TRIGGER erinnerung_spiegelschutz_i BEFORE INSERT ON erinnerung WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = NEW.einsatz_id) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
CREATE TRIGGER erinnerung_spiegelschutz_u BEFORE UPDATE ON erinnerung WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND (EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = OLD.einsatz_id) OR EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = NEW.einsatz_id)) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
CREATE TRIGGER erinnerung_spiegelschutz_d BEFORE DELETE ON erinnerung WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = OLD.einsatz_id) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
-- programmpunkt
CREATE TRIGGER programmpunkt_spiegellog_i AFTER INSERT ON programmpunkt WHEN EXISTS (SELECT 1 FROM einsatz WHERE id = NEW.einsatz_id) BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'programmpunkt' AND schluessel = CAST(NEW.id AS TEXT);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) VALUES (NEW.einsatz_id, 'programmpunkt', CAST(NEW.id AS TEXT));
END;
CREATE TRIGGER programmpunkt_spiegellog_u AFTER UPDATE ON programmpunkt BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'programmpunkt' AND schluessel IN (CAST(OLD.id AS TEXT), CAST(NEW.id AS TEXT));
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT OLD.einsatz_id, 'programmpunkt', CAST(OLD.id AS TEXT) WHERE CAST(OLD.id AS TEXT) IS NOT CAST(NEW.id AS TEXT) AND EXISTS (SELECT 1 FROM einsatz WHERE id = OLD.einsatz_id);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT NEW.einsatz_id, 'programmpunkt', CAST(NEW.id AS TEXT) WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = NEW.einsatz_id);
END;
CREATE TRIGGER programmpunkt_spiegellog_d AFTER DELETE ON programmpunkt BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'programmpunkt' AND schluessel = CAST(OLD.id AS TEXT);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT OLD.einsatz_id, 'programmpunkt', CAST(OLD.id AS TEXT) WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = OLD.einsatz_id);
END;
CREATE TRIGGER programmpunkt_spiegelschutz_i BEFORE INSERT ON programmpunkt WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = NEW.einsatz_id) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
CREATE TRIGGER programmpunkt_spiegelschutz_u BEFORE UPDATE ON programmpunkt WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND (EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = OLD.einsatz_id) OR EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = NEW.einsatz_id)) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
CREATE TRIGGER programmpunkt_spiegelschutz_d BEFORE DELETE ON programmpunkt WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = OLD.einsatz_id) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
-- benachrichtigung
CREATE TRIGGER benachrichtigung_spiegellog_i AFTER INSERT ON benachrichtigung WHEN EXISTS (SELECT 1 FROM einsatz WHERE id = NEW.einsatz_id) BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'benachrichtigung' AND schluessel = CAST(NEW.id AS TEXT);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) VALUES (NEW.einsatz_id, 'benachrichtigung', CAST(NEW.id AS TEXT));
END;
CREATE TRIGGER benachrichtigung_spiegellog_u AFTER UPDATE ON benachrichtigung BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'benachrichtigung' AND schluessel IN (CAST(OLD.id AS TEXT), CAST(NEW.id AS TEXT));
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT OLD.einsatz_id, 'benachrichtigung', CAST(OLD.id AS TEXT) WHERE CAST(OLD.id AS TEXT) IS NOT CAST(NEW.id AS TEXT) AND EXISTS (SELECT 1 FROM einsatz WHERE id = OLD.einsatz_id);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT NEW.einsatz_id, 'benachrichtigung', CAST(NEW.id AS TEXT) WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = NEW.einsatz_id);
END;
CREATE TRIGGER benachrichtigung_spiegellog_d AFTER DELETE ON benachrichtigung BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'benachrichtigung' AND schluessel = CAST(OLD.id AS TEXT);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT OLD.einsatz_id, 'benachrichtigung', CAST(OLD.id AS TEXT) WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = OLD.einsatz_id);
END;
CREATE TRIGGER benachrichtigung_spiegelschutz_i BEFORE INSERT ON benachrichtigung WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = NEW.einsatz_id) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
CREATE TRIGGER benachrichtigung_spiegelschutz_u BEFORE UPDATE ON benachrichtigung WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND (EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = OLD.einsatz_id) OR EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = NEW.einsatz_id)) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
CREATE TRIGGER benachrichtigung_spiegelschutz_d BEFORE DELETE ON benachrichtigung WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = OLD.einsatz_id) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
-- benachrichtigung_vorgabe
CREATE TRIGGER benachrichtigung_vorgabe_spiegellog_i AFTER INSERT ON benachrichtigung_vorgabe WHEN EXISTS (SELECT 1 FROM einsatz WHERE id = NEW.einsatz_id) BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'benachrichtigung_vorgabe' AND schluessel = json_array(NEW.einsatz_id, NEW.art, NEW.funktion);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) VALUES (NEW.einsatz_id, 'benachrichtigung_vorgabe', json_array(NEW.einsatz_id, NEW.art, NEW.funktion));
END;
CREATE TRIGGER benachrichtigung_vorgabe_spiegellog_u AFTER UPDATE ON benachrichtigung_vorgabe BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'benachrichtigung_vorgabe' AND schluessel IN (json_array(OLD.einsatz_id, OLD.art, OLD.funktion), json_array(NEW.einsatz_id, NEW.art, NEW.funktion));
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT OLD.einsatz_id, 'benachrichtigung_vorgabe', json_array(OLD.einsatz_id, OLD.art, OLD.funktion) WHERE json_array(OLD.einsatz_id, OLD.art, OLD.funktion) IS NOT json_array(NEW.einsatz_id, NEW.art, NEW.funktion) AND EXISTS (SELECT 1 FROM einsatz WHERE id = OLD.einsatz_id);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT NEW.einsatz_id, 'benachrichtigung_vorgabe', json_array(NEW.einsatz_id, NEW.art, NEW.funktion) WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = NEW.einsatz_id);
END;
CREATE TRIGGER benachrichtigung_vorgabe_spiegellog_d AFTER DELETE ON benachrichtigung_vorgabe BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'benachrichtigung_vorgabe' AND schluessel = json_array(OLD.einsatz_id, OLD.art, OLD.funktion);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT OLD.einsatz_id, 'benachrichtigung_vorgabe', json_array(OLD.einsatz_id, OLD.art, OLD.funktion) WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = OLD.einsatz_id);
END;
CREATE TRIGGER benachrichtigung_vorgabe_spiegelschutz_i BEFORE INSERT ON benachrichtigung_vorgabe WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = NEW.einsatz_id) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
CREATE TRIGGER benachrichtigung_vorgabe_spiegelschutz_u BEFORE UPDATE ON benachrichtigung_vorgabe WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND (EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = OLD.einsatz_id) OR EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = NEW.einsatz_id)) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
CREATE TRIGGER benachrichtigung_vorgabe_spiegelschutz_d BEFORE DELETE ON benachrichtigung_vorgabe WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = OLD.einsatz_id) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
-- etb_eintrag
CREATE TRIGGER etb_eintrag_spiegellog_i AFTER INSERT ON etb_eintrag WHEN EXISTS (SELECT 1 FROM einsatz WHERE id = NEW.einsatz_id) BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'etb_eintrag' AND schluessel = CAST(NEW.id AS TEXT);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) VALUES (NEW.einsatz_id, 'etb_eintrag', CAST(NEW.id AS TEXT));
END;
CREATE TRIGGER etb_eintrag_spiegellog_u AFTER UPDATE ON etb_eintrag BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'etb_eintrag' AND schluessel IN (CAST(OLD.id AS TEXT), CAST(NEW.id AS TEXT));
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT OLD.einsatz_id, 'etb_eintrag', CAST(OLD.id AS TEXT) WHERE CAST(OLD.id AS TEXT) IS NOT CAST(NEW.id AS TEXT) AND EXISTS (SELECT 1 FROM einsatz WHERE id = OLD.einsatz_id);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT NEW.einsatz_id, 'etb_eintrag', CAST(NEW.id AS TEXT) WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = NEW.einsatz_id);
END;
CREATE TRIGGER etb_eintrag_spiegellog_d AFTER DELETE ON etb_eintrag BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'etb_eintrag' AND schluessel = CAST(OLD.id AS TEXT);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT OLD.einsatz_id, 'etb_eintrag', CAST(OLD.id AS TEXT) WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = OLD.einsatz_id);
END;
CREATE TRIGGER etb_eintrag_spiegelschutz_i BEFORE INSERT ON etb_eintrag WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = NEW.einsatz_id) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
CREATE TRIGGER etb_eintrag_spiegelschutz_u BEFORE UPDATE ON etb_eintrag WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND (EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = OLD.einsatz_id) OR EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = NEW.einsatz_id)) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
CREATE TRIGGER etb_eintrag_spiegelschutz_d BEFORE DELETE ON etb_eintrag WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = OLD.einsatz_id) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
-- etb_eintrag_einheit
CREATE TRIGGER etb_eintrag_einheit_spiegellog_i AFTER INSERT ON etb_eintrag_einheit WHEN EXISTS (SELECT 1 FROM einsatz WHERE id = (SELECT einsatz_id FROM etb_eintrag WHERE id = NEW.eintrag_id)) BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'etb_eintrag_einheit' AND schluessel = json_array(NEW.eintrag_id, NEW.einheit_id);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) VALUES ((SELECT einsatz_id FROM etb_eintrag WHERE id = NEW.eintrag_id), 'etb_eintrag_einheit', json_array(NEW.eintrag_id, NEW.einheit_id));
END;
CREATE TRIGGER etb_eintrag_einheit_spiegellog_u AFTER UPDATE ON etb_eintrag_einheit BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'etb_eintrag_einheit' AND schluessel IN (json_array(OLD.eintrag_id, OLD.einheit_id), json_array(NEW.eintrag_id, NEW.einheit_id));
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT (SELECT einsatz_id FROM etb_eintrag WHERE id = OLD.eintrag_id), 'etb_eintrag_einheit', json_array(OLD.eintrag_id, OLD.einheit_id) WHERE json_array(OLD.eintrag_id, OLD.einheit_id) IS NOT json_array(NEW.eintrag_id, NEW.einheit_id) AND EXISTS (SELECT 1 FROM einsatz WHERE id = (SELECT einsatz_id FROM etb_eintrag WHERE id = OLD.eintrag_id));
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT (SELECT einsatz_id FROM etb_eintrag WHERE id = NEW.eintrag_id), 'etb_eintrag_einheit', json_array(NEW.eintrag_id, NEW.einheit_id) WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = (SELECT einsatz_id FROM etb_eintrag WHERE id = NEW.eintrag_id));
END;
CREATE TRIGGER etb_eintrag_einheit_spiegellog_d AFTER DELETE ON etb_eintrag_einheit BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'etb_eintrag_einheit' AND schluessel = json_array(OLD.eintrag_id, OLD.einheit_id);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT (SELECT einsatz_id FROM etb_eintrag WHERE id = OLD.eintrag_id), 'etb_eintrag_einheit', json_array(OLD.eintrag_id, OLD.einheit_id) WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = (SELECT einsatz_id FROM etb_eintrag WHERE id = OLD.eintrag_id));
END;
CREATE TRIGGER etb_eintrag_einheit_spiegelschutz_i BEFORE INSERT ON etb_eintrag_einheit WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = (SELECT einsatz_id FROM etb_eintrag WHERE id = NEW.eintrag_id)) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
CREATE TRIGGER etb_eintrag_einheit_spiegelschutz_u BEFORE UPDATE ON etb_eintrag_einheit WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND (EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = (SELECT einsatz_id FROM etb_eintrag WHERE id = OLD.eintrag_id)) OR EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = (SELECT einsatz_id FROM etb_eintrag WHERE id = NEW.eintrag_id))) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
CREATE TRIGGER etb_eintrag_einheit_spiegelschutz_d BEFORE DELETE ON etb_eintrag_einheit WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = (SELECT einsatz_id FROM etb_eintrag WHERE id = OLD.eintrag_id)) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
-- lage_zone
CREATE TRIGGER lage_zone_spiegellog_i AFTER INSERT ON lage_zone WHEN EXISTS (SELECT 1 FROM einsatz WHERE id = NEW.einsatz_id) BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'lage_zone' AND schluessel = CAST(NEW.id AS TEXT);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) VALUES (NEW.einsatz_id, 'lage_zone', CAST(NEW.id AS TEXT));
END;
CREATE TRIGGER lage_zone_spiegellog_u AFTER UPDATE ON lage_zone BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'lage_zone' AND schluessel IN (CAST(OLD.id AS TEXT), CAST(NEW.id AS TEXT));
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT OLD.einsatz_id, 'lage_zone', CAST(OLD.id AS TEXT) WHERE CAST(OLD.id AS TEXT) IS NOT CAST(NEW.id AS TEXT) AND EXISTS (SELECT 1 FROM einsatz WHERE id = OLD.einsatz_id);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT NEW.einsatz_id, 'lage_zone', CAST(NEW.id AS TEXT) WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = NEW.einsatz_id);
END;
CREATE TRIGGER lage_zone_spiegellog_d AFTER DELETE ON lage_zone BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'lage_zone' AND schluessel = CAST(OLD.id AS TEXT);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT OLD.einsatz_id, 'lage_zone', CAST(OLD.id AS TEXT) WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = OLD.einsatz_id);
END;
CREATE TRIGGER lage_zone_spiegelschutz_i BEFORE INSERT ON lage_zone WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = NEW.einsatz_id) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
CREATE TRIGGER lage_zone_spiegelschutz_u BEFORE UPDATE ON lage_zone WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND (EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = OLD.einsatz_id) OR EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = NEW.einsatz_id)) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
CREATE TRIGGER lage_zone_spiegelschutz_d BEFORE DELETE ON lage_zone WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = OLD.einsatz_id) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
-- gefahrengebiet
CREATE TRIGGER gefahrengebiet_spiegellog_i AFTER INSERT ON gefahrengebiet WHEN EXISTS (SELECT 1 FROM einsatz WHERE id = NEW.einsatz_id) BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'gefahrengebiet' AND schluessel = CAST(NEW.id AS TEXT);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) VALUES (NEW.einsatz_id, 'gefahrengebiet', CAST(NEW.id AS TEXT));
END;
CREATE TRIGGER gefahrengebiet_spiegellog_u AFTER UPDATE ON gefahrengebiet BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'gefahrengebiet' AND schluessel IN (CAST(OLD.id AS TEXT), CAST(NEW.id AS TEXT));
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT OLD.einsatz_id, 'gefahrengebiet', CAST(OLD.id AS TEXT) WHERE CAST(OLD.id AS TEXT) IS NOT CAST(NEW.id AS TEXT) AND EXISTS (SELECT 1 FROM einsatz WHERE id = OLD.einsatz_id);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT NEW.einsatz_id, 'gefahrengebiet', CAST(NEW.id AS TEXT) WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = NEW.einsatz_id);
END;
CREATE TRIGGER gefahrengebiet_spiegellog_d AFTER DELETE ON gefahrengebiet BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'gefahrengebiet' AND schluessel = CAST(OLD.id AS TEXT);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT OLD.einsatz_id, 'gefahrengebiet', CAST(OLD.id AS TEXT) WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = OLD.einsatz_id);
END;
CREATE TRIGGER gefahrengebiet_spiegelschutz_i BEFORE INSERT ON gefahrengebiet WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = NEW.einsatz_id) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
CREATE TRIGGER gefahrengebiet_spiegelschutz_u BEFORE UPDATE ON gefahrengebiet WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND (EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = OLD.einsatz_id) OR EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = NEW.einsatz_id)) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
CREATE TRIGGER gefahrengebiet_spiegelschutz_d BEFORE DELETE ON gefahrengebiet WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = OLD.einsatz_id) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
-- gefahr_bewertung
CREATE TRIGGER gefahr_bewertung_spiegellog_i AFTER INSERT ON gefahr_bewertung WHEN EXISTS (SELECT 1 FROM einsatz WHERE id = (SELECT einsatz_id FROM gefahrengebiet WHERE id = NEW.gefahrengebiet_id)) BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'gefahr_bewertung' AND schluessel = CAST(NEW.id AS TEXT);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) VALUES ((SELECT einsatz_id FROM gefahrengebiet WHERE id = NEW.gefahrengebiet_id), 'gefahr_bewertung', CAST(NEW.id AS TEXT));
END;
CREATE TRIGGER gefahr_bewertung_spiegellog_u AFTER UPDATE ON gefahr_bewertung BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'gefahr_bewertung' AND schluessel IN (CAST(OLD.id AS TEXT), CAST(NEW.id AS TEXT));
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT (SELECT einsatz_id FROM gefahrengebiet WHERE id = OLD.gefahrengebiet_id), 'gefahr_bewertung', CAST(OLD.id AS TEXT) WHERE CAST(OLD.id AS TEXT) IS NOT CAST(NEW.id AS TEXT) AND EXISTS (SELECT 1 FROM einsatz WHERE id = (SELECT einsatz_id FROM gefahrengebiet WHERE id = OLD.gefahrengebiet_id));
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT (SELECT einsatz_id FROM gefahrengebiet WHERE id = NEW.gefahrengebiet_id), 'gefahr_bewertung', CAST(NEW.id AS TEXT) WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = (SELECT einsatz_id FROM gefahrengebiet WHERE id = NEW.gefahrengebiet_id));
END;
CREATE TRIGGER gefahr_bewertung_spiegellog_d AFTER DELETE ON gefahr_bewertung BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'gefahr_bewertung' AND schluessel = CAST(OLD.id AS TEXT);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT (SELECT einsatz_id FROM gefahrengebiet WHERE id = OLD.gefahrengebiet_id), 'gefahr_bewertung', CAST(OLD.id AS TEXT) WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = (SELECT einsatz_id FROM gefahrengebiet WHERE id = OLD.gefahrengebiet_id));
END;
CREATE TRIGGER gefahr_bewertung_spiegelschutz_i BEFORE INSERT ON gefahr_bewertung WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = (SELECT einsatz_id FROM gefahrengebiet WHERE id = NEW.gefahrengebiet_id)) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
CREATE TRIGGER gefahr_bewertung_spiegelschutz_u BEFORE UPDATE ON gefahr_bewertung WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND (EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = (SELECT einsatz_id FROM gefahrengebiet WHERE id = OLD.gefahrengebiet_id)) OR EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = (SELECT einsatz_id FROM gefahrengebiet WHERE id = NEW.gefahrengebiet_id))) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
CREATE TRIGGER gefahr_bewertung_spiegelschutz_d BEFORE DELETE ON gefahr_bewertung WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = (SELECT einsatz_id FROM gefahrengebiet WHERE id = OLD.gefahrengebiet_id)) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
-- freies_zeichen
CREATE TRIGGER freies_zeichen_spiegellog_i AFTER INSERT ON freies_zeichen WHEN EXISTS (SELECT 1 FROM einsatz WHERE id = NEW.einsatz_id) BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'freies_zeichen' AND schluessel = CAST(NEW.id AS TEXT);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) VALUES (NEW.einsatz_id, 'freies_zeichen', CAST(NEW.id AS TEXT));
END;
CREATE TRIGGER freies_zeichen_spiegellog_u AFTER UPDATE ON freies_zeichen BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'freies_zeichen' AND schluessel IN (CAST(OLD.id AS TEXT), CAST(NEW.id AS TEXT));
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT OLD.einsatz_id, 'freies_zeichen', CAST(OLD.id AS TEXT) WHERE CAST(OLD.id AS TEXT) IS NOT CAST(NEW.id AS TEXT) AND EXISTS (SELECT 1 FROM einsatz WHERE id = OLD.einsatz_id);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT NEW.einsatz_id, 'freies_zeichen', CAST(NEW.id AS TEXT) WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = NEW.einsatz_id);
END;
CREATE TRIGGER freies_zeichen_spiegellog_d AFTER DELETE ON freies_zeichen BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'freies_zeichen' AND schluessel = CAST(OLD.id AS TEXT);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT OLD.einsatz_id, 'freies_zeichen', CAST(OLD.id AS TEXT) WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = OLD.einsatz_id);
END;
CREATE TRIGGER freies_zeichen_spiegelschutz_i BEFORE INSERT ON freies_zeichen WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = NEW.einsatz_id) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
CREATE TRIGGER freies_zeichen_spiegelschutz_u BEFORE UPDATE ON freies_zeichen WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND (EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = OLD.einsatz_id) OR EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = NEW.einsatz_id)) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
CREATE TRIGGER freies_zeichen_spiegelschutz_d BEFORE DELETE ON freies_zeichen WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = OLD.einsatz_id) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
-- karte_hintergrundbild
CREATE TRIGGER karte_hintergrundbild_spiegellog_i AFTER INSERT ON karte_hintergrundbild WHEN EXISTS (SELECT 1 FROM einsatz WHERE id = NEW.einsatz_id) BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'karte_hintergrundbild' AND schluessel = CAST(NEW.id AS TEXT);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) VALUES (NEW.einsatz_id, 'karte_hintergrundbild', CAST(NEW.id AS TEXT));
END;
CREATE TRIGGER karte_hintergrundbild_spiegellog_u AFTER UPDATE ON karte_hintergrundbild BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'karte_hintergrundbild' AND schluessel IN (CAST(OLD.id AS TEXT), CAST(NEW.id AS TEXT));
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT OLD.einsatz_id, 'karte_hintergrundbild', CAST(OLD.id AS TEXT) WHERE CAST(OLD.id AS TEXT) IS NOT CAST(NEW.id AS TEXT) AND EXISTS (SELECT 1 FROM einsatz WHERE id = OLD.einsatz_id);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT NEW.einsatz_id, 'karte_hintergrundbild', CAST(NEW.id AS TEXT) WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = NEW.einsatz_id);
END;
CREATE TRIGGER karte_hintergrundbild_spiegellog_d AFTER DELETE ON karte_hintergrundbild BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'karte_hintergrundbild' AND schluessel = CAST(OLD.id AS TEXT);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT OLD.einsatz_id, 'karte_hintergrundbild', CAST(OLD.id AS TEXT) WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = OLD.einsatz_id);
END;
CREATE TRIGGER karte_hintergrundbild_spiegelschutz_i BEFORE INSERT ON karte_hintergrundbild WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = NEW.einsatz_id) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
CREATE TRIGGER karte_hintergrundbild_spiegelschutz_u BEFORE UPDATE ON karte_hintergrundbild WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND (EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = OLD.einsatz_id) OR EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = NEW.einsatz_id)) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
CREATE TRIGGER karte_hintergrundbild_spiegelschutz_d BEFORE DELETE ON karte_hintergrundbild WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = OLD.einsatz_id) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
-- karten_ansicht
CREATE TRIGGER karten_ansicht_spiegellog_i AFTER INSERT ON karten_ansicht WHEN EXISTS (SELECT 1 FROM einsatz WHERE id = NEW.einsatz_id) BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'karten_ansicht' AND schluessel = CAST(NEW.id AS TEXT);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) VALUES (NEW.einsatz_id, 'karten_ansicht', CAST(NEW.id AS TEXT));
END;
CREATE TRIGGER karten_ansicht_spiegellog_u AFTER UPDATE ON karten_ansicht BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'karten_ansicht' AND schluessel IN (CAST(OLD.id AS TEXT), CAST(NEW.id AS TEXT));
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT OLD.einsatz_id, 'karten_ansicht', CAST(OLD.id AS TEXT) WHERE CAST(OLD.id AS TEXT) IS NOT CAST(NEW.id AS TEXT) AND EXISTS (SELECT 1 FROM einsatz WHERE id = OLD.einsatz_id);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT NEW.einsatz_id, 'karten_ansicht', CAST(NEW.id AS TEXT) WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = NEW.einsatz_id);
END;
CREATE TRIGGER karten_ansicht_spiegellog_d AFTER DELETE ON karten_ansicht BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'karten_ansicht' AND schluessel = CAST(OLD.id AS TEXT);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT OLD.einsatz_id, 'karten_ansicht', CAST(OLD.id AS TEXT) WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = OLD.einsatz_id);
END;
CREATE TRIGGER karten_ansicht_spiegelschutz_i BEFORE INSERT ON karten_ansicht WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = NEW.einsatz_id) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
CREATE TRIGGER karten_ansicht_spiegelschutz_u BEFORE UPDATE ON karten_ansicht WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND (EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = OLD.einsatz_id) OR EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = NEW.einsatz_id)) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
CREATE TRIGGER karten_ansicht_spiegelschutz_d BEFORE DELETE ON karten_ansicht WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = OLD.einsatz_id) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
-- lage_snapshot
CREATE TRIGGER lage_snapshot_spiegellog_i AFTER INSERT ON lage_snapshot WHEN EXISTS (SELECT 1 FROM einsatz WHERE id = NEW.einsatz_id) BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'lage_snapshot' AND schluessel = CAST(NEW.id AS TEXT);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) VALUES (NEW.einsatz_id, 'lage_snapshot', CAST(NEW.id AS TEXT));
END;
CREATE TRIGGER lage_snapshot_spiegellog_u AFTER UPDATE ON lage_snapshot BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'lage_snapshot' AND schluessel IN (CAST(OLD.id AS TEXT), CAST(NEW.id AS TEXT));
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT OLD.einsatz_id, 'lage_snapshot', CAST(OLD.id AS TEXT) WHERE CAST(OLD.id AS TEXT) IS NOT CAST(NEW.id AS TEXT) AND EXISTS (SELECT 1 FROM einsatz WHERE id = OLD.einsatz_id);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT NEW.einsatz_id, 'lage_snapshot', CAST(NEW.id AS TEXT) WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = NEW.einsatz_id);
END;
CREATE TRIGGER lage_snapshot_spiegellog_d AFTER DELETE ON lage_snapshot BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'lage_snapshot' AND schluessel = CAST(OLD.id AS TEXT);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT OLD.einsatz_id, 'lage_snapshot', CAST(OLD.id AS TEXT) WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = OLD.einsatz_id);
END;
CREATE TRIGGER lage_snapshot_spiegelschutz_i BEFORE INSERT ON lage_snapshot WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = NEW.einsatz_id) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
CREATE TRIGGER lage_snapshot_spiegelschutz_u BEFORE UPDATE ON lage_snapshot WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND (EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = OLD.einsatz_id) OR EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = NEW.einsatz_id)) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
CREATE TRIGGER lage_snapshot_spiegelschutz_d BEFORE DELETE ON lage_snapshot WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = OLD.einsatz_id) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
-- einsatz_pegel
CREATE TRIGGER einsatz_pegel_spiegellog_i AFTER INSERT ON einsatz_pegel WHEN EXISTS (SELECT 1 FROM einsatz WHERE id = NEW.einsatz_id) BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'einsatz_pegel' AND schluessel = CAST(NEW.id AS TEXT);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) VALUES (NEW.einsatz_id, 'einsatz_pegel', CAST(NEW.id AS TEXT));
END;
CREATE TRIGGER einsatz_pegel_spiegellog_u AFTER UPDATE ON einsatz_pegel BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'einsatz_pegel' AND schluessel IN (CAST(OLD.id AS TEXT), CAST(NEW.id AS TEXT));
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT OLD.einsatz_id, 'einsatz_pegel', CAST(OLD.id AS TEXT) WHERE CAST(OLD.id AS TEXT) IS NOT CAST(NEW.id AS TEXT) AND EXISTS (SELECT 1 FROM einsatz WHERE id = OLD.einsatz_id);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT NEW.einsatz_id, 'einsatz_pegel', CAST(NEW.id AS TEXT) WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = NEW.einsatz_id);
END;
CREATE TRIGGER einsatz_pegel_spiegellog_d AFTER DELETE ON einsatz_pegel BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'einsatz_pegel' AND schluessel = CAST(OLD.id AS TEXT);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT OLD.einsatz_id, 'einsatz_pegel', CAST(OLD.id AS TEXT) WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = OLD.einsatz_id);
END;
CREATE TRIGGER einsatz_pegel_spiegelschutz_i BEFORE INSERT ON einsatz_pegel WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = NEW.einsatz_id) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
CREATE TRIGGER einsatz_pegel_spiegelschutz_u BEFORE UPDATE ON einsatz_pegel WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND (EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = OLD.einsatz_id) OR EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = NEW.einsatz_id)) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
CREATE TRIGGER einsatz_pegel_spiegelschutz_d BEFORE DELETE ON einsatz_pegel WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = OLD.einsatz_id) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
-- einsatz_schaden
CREATE TRIGGER einsatz_schaden_spiegellog_i AFTER INSERT ON einsatz_schaden WHEN EXISTS (SELECT 1 FROM einsatz WHERE id = NEW.einsatz_id) BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'einsatz_schaden' AND schluessel = CAST(NEW.id AS TEXT);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) VALUES (NEW.einsatz_id, 'einsatz_schaden', CAST(NEW.id AS TEXT));
END;
CREATE TRIGGER einsatz_schaden_spiegellog_u AFTER UPDATE ON einsatz_schaden BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'einsatz_schaden' AND schluessel IN (CAST(OLD.id AS TEXT), CAST(NEW.id AS TEXT));
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT OLD.einsatz_id, 'einsatz_schaden', CAST(OLD.id AS TEXT) WHERE CAST(OLD.id AS TEXT) IS NOT CAST(NEW.id AS TEXT) AND EXISTS (SELECT 1 FROM einsatz WHERE id = OLD.einsatz_id);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT NEW.einsatz_id, 'einsatz_schaden', CAST(NEW.id AS TEXT) WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = NEW.einsatz_id);
END;
CREATE TRIGGER einsatz_schaden_spiegellog_d AFTER DELETE ON einsatz_schaden BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'einsatz_schaden' AND schluessel = CAST(OLD.id AS TEXT);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT OLD.einsatz_id, 'einsatz_schaden', CAST(OLD.id AS TEXT) WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = OLD.einsatz_id);
END;
CREATE TRIGGER einsatz_schaden_spiegelschutz_i BEFORE INSERT ON einsatz_schaden WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = NEW.einsatz_id) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
CREATE TRIGGER einsatz_schaden_spiegelschutz_u BEFORE UPDATE ON einsatz_schaden WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND (EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = OLD.einsatz_id) OR EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = NEW.einsatz_id)) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
CREATE TRIGGER einsatz_schaden_spiegelschutz_d BEFORE DELETE ON einsatz_schaden WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = OLD.einsatz_id) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
-- einsatz_tier
CREATE TRIGGER einsatz_tier_spiegellog_i AFTER INSERT ON einsatz_tier WHEN EXISTS (SELECT 1 FROM einsatz WHERE id = NEW.einsatz_id) BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'einsatz_tier' AND schluessel = CAST(NEW.id AS TEXT);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) VALUES (NEW.einsatz_id, 'einsatz_tier', CAST(NEW.id AS TEXT));
END;
CREATE TRIGGER einsatz_tier_spiegellog_u AFTER UPDATE ON einsatz_tier BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'einsatz_tier' AND schluessel IN (CAST(OLD.id AS TEXT), CAST(NEW.id AS TEXT));
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT OLD.einsatz_id, 'einsatz_tier', CAST(OLD.id AS TEXT) WHERE CAST(OLD.id AS TEXT) IS NOT CAST(NEW.id AS TEXT) AND EXISTS (SELECT 1 FROM einsatz WHERE id = OLD.einsatz_id);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT NEW.einsatz_id, 'einsatz_tier', CAST(NEW.id AS TEXT) WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = NEW.einsatz_id);
END;
CREATE TRIGGER einsatz_tier_spiegellog_d AFTER DELETE ON einsatz_tier BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'einsatz_tier' AND schluessel = CAST(OLD.id AS TEXT);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT OLD.einsatz_id, 'einsatz_tier', CAST(OLD.id AS TEXT) WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = OLD.einsatz_id);
END;
CREATE TRIGGER einsatz_tier_spiegelschutz_i BEFORE INSERT ON einsatz_tier WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = NEW.einsatz_id) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
CREATE TRIGGER einsatz_tier_spiegelschutz_u BEFORE UPDATE ON einsatz_tier WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND (EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = OLD.einsatz_id) OR EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = NEW.einsatz_id)) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
CREATE TRIGGER einsatz_tier_spiegelschutz_d BEFORE DELETE ON einsatz_tier WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = OLD.einsatz_id) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
-- einsatz_einheit
CREATE TRIGGER einsatz_einheit_spiegellog_i AFTER INSERT ON einsatz_einheit WHEN EXISTS (SELECT 1 FROM einsatz WHERE id = NEW.einsatz_id) BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'einsatz_einheit' AND schluessel = CAST(NEW.id AS TEXT);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) VALUES (NEW.einsatz_id, 'einsatz_einheit', CAST(NEW.id AS TEXT));
END;
CREATE TRIGGER einsatz_einheit_spiegellog_u AFTER UPDATE ON einsatz_einheit BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'einsatz_einheit' AND schluessel IN (CAST(OLD.id AS TEXT), CAST(NEW.id AS TEXT));
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT OLD.einsatz_id, 'einsatz_einheit', CAST(OLD.id AS TEXT) WHERE CAST(OLD.id AS TEXT) IS NOT CAST(NEW.id AS TEXT) AND EXISTS (SELECT 1 FROM einsatz WHERE id = OLD.einsatz_id);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT NEW.einsatz_id, 'einsatz_einheit', CAST(NEW.id AS TEXT) WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = NEW.einsatz_id);
END;
CREATE TRIGGER einsatz_einheit_spiegellog_d AFTER DELETE ON einsatz_einheit BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'einsatz_einheit' AND schluessel = CAST(OLD.id AS TEXT);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT OLD.einsatz_id, 'einsatz_einheit', CAST(OLD.id AS TEXT) WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = OLD.einsatz_id);
END;
CREATE TRIGGER einsatz_einheit_spiegelschutz_i BEFORE INSERT ON einsatz_einheit WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = NEW.einsatz_id) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
CREATE TRIGGER einsatz_einheit_spiegelschutz_u BEFORE UPDATE ON einsatz_einheit WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND (EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = OLD.einsatz_id) OR EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = NEW.einsatz_id)) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
CREATE TRIGGER einsatz_einheit_spiegelschutz_d BEFORE DELETE ON einsatz_einheit WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = OLD.einsatz_id) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
-- einsatz_einheit_letzte_besetzung
CREATE TRIGGER einsatz_einheit_letzte_besetzung_spiegellog_i AFTER INSERT ON einsatz_einheit_letzte_besetzung WHEN EXISTS (SELECT 1 FROM einsatz WHERE id = (SELECT einsatz_id FROM einsatz_einheit WHERE id = NEW.einheit_id)) BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'einsatz_einheit_letzte_besetzung' AND schluessel = CAST(NEW.id AS TEXT);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) VALUES ((SELECT einsatz_id FROM einsatz_einheit WHERE id = NEW.einheit_id), 'einsatz_einheit_letzte_besetzung', CAST(NEW.id AS TEXT));
END;
CREATE TRIGGER einsatz_einheit_letzte_besetzung_spiegellog_u AFTER UPDATE ON einsatz_einheit_letzte_besetzung BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'einsatz_einheit_letzte_besetzung' AND schluessel IN (CAST(OLD.id AS TEXT), CAST(NEW.id AS TEXT));
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT (SELECT einsatz_id FROM einsatz_einheit WHERE id = OLD.einheit_id), 'einsatz_einheit_letzte_besetzung', CAST(OLD.id AS TEXT) WHERE CAST(OLD.id AS TEXT) IS NOT CAST(NEW.id AS TEXT) AND EXISTS (SELECT 1 FROM einsatz WHERE id = (SELECT einsatz_id FROM einsatz_einheit WHERE id = OLD.einheit_id));
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT (SELECT einsatz_id FROM einsatz_einheit WHERE id = NEW.einheit_id), 'einsatz_einheit_letzte_besetzung', CAST(NEW.id AS TEXT) WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = (SELECT einsatz_id FROM einsatz_einheit WHERE id = NEW.einheit_id));
END;
CREATE TRIGGER einsatz_einheit_letzte_besetzung_spiegellog_d AFTER DELETE ON einsatz_einheit_letzte_besetzung BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'einsatz_einheit_letzte_besetzung' AND schluessel = CAST(OLD.id AS TEXT);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT (SELECT einsatz_id FROM einsatz_einheit WHERE id = OLD.einheit_id), 'einsatz_einheit_letzte_besetzung', CAST(OLD.id AS TEXT) WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = (SELECT einsatz_id FROM einsatz_einheit WHERE id = OLD.einheit_id));
END;
CREATE TRIGGER einsatz_einheit_letzte_besetzung_spiegelschutz_i BEFORE INSERT ON einsatz_einheit_letzte_besetzung WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = (SELECT einsatz_id FROM einsatz_einheit WHERE id = NEW.einheit_id)) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
CREATE TRIGGER einsatz_einheit_letzte_besetzung_spiegelschutz_u BEFORE UPDATE ON einsatz_einheit_letzte_besetzung WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND (EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = (SELECT einsatz_id FROM einsatz_einheit WHERE id = OLD.einheit_id)) OR EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = (SELECT einsatz_id FROM einsatz_einheit WHERE id = NEW.einheit_id))) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
CREATE TRIGGER einsatz_einheit_letzte_besetzung_spiegelschutz_d BEFORE DELETE ON einsatz_einheit_letzte_besetzung WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = (SELECT einsatz_id FROM einsatz_einheit WHERE id = OLD.einheit_id)) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
-- einsatz_einheit_sprechgruppe
CREATE TRIGGER einsatz_einheit_sprechgruppe_spiegellog_i AFTER INSERT ON einsatz_einheit_sprechgruppe WHEN EXISTS (SELECT 1 FROM einsatz WHERE id = (SELECT einsatz_id FROM einsatz_einheit WHERE id = NEW.einheit_id)) BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'einsatz_einheit_sprechgruppe' AND schluessel = json_array(NEW.einheit_id, NEW.sprechgruppe_id);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) VALUES ((SELECT einsatz_id FROM einsatz_einheit WHERE id = NEW.einheit_id), 'einsatz_einheit_sprechgruppe', json_array(NEW.einheit_id, NEW.sprechgruppe_id));
END;
CREATE TRIGGER einsatz_einheit_sprechgruppe_spiegellog_u AFTER UPDATE ON einsatz_einheit_sprechgruppe BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'einsatz_einheit_sprechgruppe' AND schluessel IN (json_array(OLD.einheit_id, OLD.sprechgruppe_id), json_array(NEW.einheit_id, NEW.sprechgruppe_id));
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT (SELECT einsatz_id FROM einsatz_einheit WHERE id = OLD.einheit_id), 'einsatz_einheit_sprechgruppe', json_array(OLD.einheit_id, OLD.sprechgruppe_id) WHERE json_array(OLD.einheit_id, OLD.sprechgruppe_id) IS NOT json_array(NEW.einheit_id, NEW.sprechgruppe_id) AND EXISTS (SELECT 1 FROM einsatz WHERE id = (SELECT einsatz_id FROM einsatz_einheit WHERE id = OLD.einheit_id));
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT (SELECT einsatz_id FROM einsatz_einheit WHERE id = NEW.einheit_id), 'einsatz_einheit_sprechgruppe', json_array(NEW.einheit_id, NEW.sprechgruppe_id) WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = (SELECT einsatz_id FROM einsatz_einheit WHERE id = NEW.einheit_id));
END;
CREATE TRIGGER einsatz_einheit_sprechgruppe_spiegellog_d AFTER DELETE ON einsatz_einheit_sprechgruppe BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'einsatz_einheit_sprechgruppe' AND schluessel = json_array(OLD.einheit_id, OLD.sprechgruppe_id);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT (SELECT einsatz_id FROM einsatz_einheit WHERE id = OLD.einheit_id), 'einsatz_einheit_sprechgruppe', json_array(OLD.einheit_id, OLD.sprechgruppe_id) WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = (SELECT einsatz_id FROM einsatz_einheit WHERE id = OLD.einheit_id));
END;
CREATE TRIGGER einsatz_einheit_sprechgruppe_spiegelschutz_i BEFORE INSERT ON einsatz_einheit_sprechgruppe WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = (SELECT einsatz_id FROM einsatz_einheit WHERE id = NEW.einheit_id)) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
CREATE TRIGGER einsatz_einheit_sprechgruppe_spiegelschutz_u BEFORE UPDATE ON einsatz_einheit_sprechgruppe WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND (EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = (SELECT einsatz_id FROM einsatz_einheit WHERE id = OLD.einheit_id)) OR EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = (SELECT einsatz_id FROM einsatz_einheit WHERE id = NEW.einheit_id))) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
CREATE TRIGGER einsatz_einheit_sprechgruppe_spiegelschutz_d BEFORE DELETE ON einsatz_einheit_sprechgruppe WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = (SELECT einsatz_id FROM einsatz_einheit WHERE id = OLD.einheit_id)) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
-- einsatz_fahrzeug
CREATE TRIGGER einsatz_fahrzeug_spiegellog_i AFTER INSERT ON einsatz_fahrzeug WHEN EXISTS (SELECT 1 FROM einsatz WHERE id = NEW.einsatz_id) BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'einsatz_fahrzeug' AND schluessel = CAST(NEW.id AS TEXT);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) VALUES (NEW.einsatz_id, 'einsatz_fahrzeug', CAST(NEW.id AS TEXT));
END;
CREATE TRIGGER einsatz_fahrzeug_spiegellog_u AFTER UPDATE ON einsatz_fahrzeug BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'einsatz_fahrzeug' AND schluessel IN (CAST(OLD.id AS TEXT), CAST(NEW.id AS TEXT));
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT OLD.einsatz_id, 'einsatz_fahrzeug', CAST(OLD.id AS TEXT) WHERE CAST(OLD.id AS TEXT) IS NOT CAST(NEW.id AS TEXT) AND EXISTS (SELECT 1 FROM einsatz WHERE id = OLD.einsatz_id);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT NEW.einsatz_id, 'einsatz_fahrzeug', CAST(NEW.id AS TEXT) WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = NEW.einsatz_id);
END;
CREATE TRIGGER einsatz_fahrzeug_spiegellog_d AFTER DELETE ON einsatz_fahrzeug BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'einsatz_fahrzeug' AND schluessel = CAST(OLD.id AS TEXT);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT OLD.einsatz_id, 'einsatz_fahrzeug', CAST(OLD.id AS TEXT) WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = OLD.einsatz_id);
END;
CREATE TRIGGER einsatz_fahrzeug_spiegelschutz_i BEFORE INSERT ON einsatz_fahrzeug WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = NEW.einsatz_id) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
CREATE TRIGGER einsatz_fahrzeug_spiegelschutz_u BEFORE UPDATE ON einsatz_fahrzeug WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND (EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = OLD.einsatz_id) OR EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = NEW.einsatz_id)) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
CREATE TRIGGER einsatz_fahrzeug_spiegelschutz_d BEFORE DELETE ON einsatz_fahrzeug WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = OLD.einsatz_id) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
-- einsatz_material
CREATE TRIGGER einsatz_material_spiegellog_i AFTER INSERT ON einsatz_material WHEN EXISTS (SELECT 1 FROM einsatz WHERE id = NEW.einsatz_id) BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'einsatz_material' AND schluessel = CAST(NEW.id AS TEXT);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) VALUES (NEW.einsatz_id, 'einsatz_material', CAST(NEW.id AS TEXT));
END;
CREATE TRIGGER einsatz_material_spiegellog_u AFTER UPDATE ON einsatz_material BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'einsatz_material' AND schluessel IN (CAST(OLD.id AS TEXT), CAST(NEW.id AS TEXT));
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT OLD.einsatz_id, 'einsatz_material', CAST(OLD.id AS TEXT) WHERE CAST(OLD.id AS TEXT) IS NOT CAST(NEW.id AS TEXT) AND EXISTS (SELECT 1 FROM einsatz WHERE id = OLD.einsatz_id);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT NEW.einsatz_id, 'einsatz_material', CAST(NEW.id AS TEXT) WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = NEW.einsatz_id);
END;
CREATE TRIGGER einsatz_material_spiegellog_d AFTER DELETE ON einsatz_material BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'einsatz_material' AND schluessel = CAST(OLD.id AS TEXT);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT OLD.einsatz_id, 'einsatz_material', CAST(OLD.id AS TEXT) WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = OLD.einsatz_id);
END;
CREATE TRIGGER einsatz_material_spiegelschutz_i BEFORE INSERT ON einsatz_material WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = NEW.einsatz_id) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
CREATE TRIGGER einsatz_material_spiegelschutz_u BEFORE UPDATE ON einsatz_material WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND (EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = OLD.einsatz_id) OR EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = NEW.einsatz_id)) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
CREATE TRIGGER einsatz_material_spiegelschutz_d BEFORE DELETE ON einsatz_material WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = OLD.einsatz_id) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
-- einsatz_personal
CREATE TRIGGER einsatz_personal_spiegellog_i AFTER INSERT ON einsatz_personal WHEN EXISTS (SELECT 1 FROM einsatz WHERE id = NEW.einsatz_id) BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'einsatz_personal' AND schluessel = CAST(NEW.id AS TEXT);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) VALUES (NEW.einsatz_id, 'einsatz_personal', CAST(NEW.id AS TEXT));
END;
CREATE TRIGGER einsatz_personal_spiegellog_u AFTER UPDATE ON einsatz_personal BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'einsatz_personal' AND schluessel IN (CAST(OLD.id AS TEXT), CAST(NEW.id AS TEXT));
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT OLD.einsatz_id, 'einsatz_personal', CAST(OLD.id AS TEXT) WHERE CAST(OLD.id AS TEXT) IS NOT CAST(NEW.id AS TEXT) AND EXISTS (SELECT 1 FROM einsatz WHERE id = OLD.einsatz_id);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT NEW.einsatz_id, 'einsatz_personal', CAST(NEW.id AS TEXT) WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = NEW.einsatz_id);
END;
CREATE TRIGGER einsatz_personal_spiegellog_d AFTER DELETE ON einsatz_personal BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'einsatz_personal' AND schluessel = CAST(OLD.id AS TEXT);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT OLD.einsatz_id, 'einsatz_personal', CAST(OLD.id AS TEXT) WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = OLD.einsatz_id);
END;
CREATE TRIGGER einsatz_personal_spiegelschutz_i BEFORE INSERT ON einsatz_personal WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = NEW.einsatz_id) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
CREATE TRIGGER einsatz_personal_spiegelschutz_u BEFORE UPDATE ON einsatz_personal WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND (EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = OLD.einsatz_id) OR EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = NEW.einsatz_id)) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
CREATE TRIGGER einsatz_personal_spiegelschutz_d BEFORE DELETE ON einsatz_personal WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = OLD.einsatz_id) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
-- einsatz_abloesung
CREATE TRIGGER einsatz_abloesung_spiegellog_i AFTER INSERT ON einsatz_abloesung WHEN EXISTS (SELECT 1 FROM einsatz WHERE id = NEW.einsatz_id) BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'einsatz_abloesung' AND schluessel = CAST(NEW.id AS TEXT);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) VALUES (NEW.einsatz_id, 'einsatz_abloesung', CAST(NEW.id AS TEXT));
END;
CREATE TRIGGER einsatz_abloesung_spiegellog_u AFTER UPDATE ON einsatz_abloesung BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'einsatz_abloesung' AND schluessel IN (CAST(OLD.id AS TEXT), CAST(NEW.id AS TEXT));
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT OLD.einsatz_id, 'einsatz_abloesung', CAST(OLD.id AS TEXT) WHERE CAST(OLD.id AS TEXT) IS NOT CAST(NEW.id AS TEXT) AND EXISTS (SELECT 1 FROM einsatz WHERE id = OLD.einsatz_id);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT NEW.einsatz_id, 'einsatz_abloesung', CAST(NEW.id AS TEXT) WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = NEW.einsatz_id);
END;
CREATE TRIGGER einsatz_abloesung_spiegellog_d AFTER DELETE ON einsatz_abloesung BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'einsatz_abloesung' AND schluessel = CAST(OLD.id AS TEXT);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT OLD.einsatz_id, 'einsatz_abloesung', CAST(OLD.id AS TEXT) WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = OLD.einsatz_id);
END;
CREATE TRIGGER einsatz_abloesung_spiegelschutz_i BEFORE INSERT ON einsatz_abloesung WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = NEW.einsatz_id) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
CREATE TRIGGER einsatz_abloesung_spiegelschutz_u BEFORE UPDATE ON einsatz_abloesung WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND (EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = OLD.einsatz_id) OR EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = NEW.einsatz_id)) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
CREATE TRIGGER einsatz_abloesung_spiegelschutz_d BEFORE DELETE ON einsatz_abloesung WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = OLD.einsatz_id) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
-- einsatz_abloesung_abloeser
CREATE TRIGGER einsatz_abloesung_abloeser_spiegellog_i AFTER INSERT ON einsatz_abloesung_abloeser WHEN EXISTS (SELECT 1 FROM einsatz WHERE id = (SELECT einsatz_id FROM einsatz_abloesung WHERE id = NEW.abloesung_id)) BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'einsatz_abloesung_abloeser' AND schluessel = json_array(NEW.abloesung_id, NEW.einheit_id);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) VALUES ((SELECT einsatz_id FROM einsatz_abloesung WHERE id = NEW.abloesung_id), 'einsatz_abloesung_abloeser', json_array(NEW.abloesung_id, NEW.einheit_id));
END;
CREATE TRIGGER einsatz_abloesung_abloeser_spiegellog_u AFTER UPDATE ON einsatz_abloesung_abloeser BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'einsatz_abloesung_abloeser' AND schluessel IN (json_array(OLD.abloesung_id, OLD.einheit_id), json_array(NEW.abloesung_id, NEW.einheit_id));
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT (SELECT einsatz_id FROM einsatz_abloesung WHERE id = OLD.abloesung_id), 'einsatz_abloesung_abloeser', json_array(OLD.abloesung_id, OLD.einheit_id) WHERE json_array(OLD.abloesung_id, OLD.einheit_id) IS NOT json_array(NEW.abloesung_id, NEW.einheit_id) AND EXISTS (SELECT 1 FROM einsatz WHERE id = (SELECT einsatz_id FROM einsatz_abloesung WHERE id = OLD.abloesung_id));
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT (SELECT einsatz_id FROM einsatz_abloesung WHERE id = NEW.abloesung_id), 'einsatz_abloesung_abloeser', json_array(NEW.abloesung_id, NEW.einheit_id) WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = (SELECT einsatz_id FROM einsatz_abloesung WHERE id = NEW.abloesung_id));
END;
CREATE TRIGGER einsatz_abloesung_abloeser_spiegellog_d AFTER DELETE ON einsatz_abloesung_abloeser BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'einsatz_abloesung_abloeser' AND schluessel = json_array(OLD.abloesung_id, OLD.einheit_id);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT (SELECT einsatz_id FROM einsatz_abloesung WHERE id = OLD.abloesung_id), 'einsatz_abloesung_abloeser', json_array(OLD.abloesung_id, OLD.einheit_id) WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = (SELECT einsatz_id FROM einsatz_abloesung WHERE id = OLD.abloesung_id));
END;
CREATE TRIGGER einsatz_abloesung_abloeser_spiegelschutz_i BEFORE INSERT ON einsatz_abloesung_abloeser WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = (SELECT einsatz_id FROM einsatz_abloesung WHERE id = NEW.abloesung_id)) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
CREATE TRIGGER einsatz_abloesung_abloeser_spiegelschutz_u BEFORE UPDATE ON einsatz_abloesung_abloeser WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND (EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = (SELECT einsatz_id FROM einsatz_abloesung WHERE id = OLD.abloesung_id)) OR EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = (SELECT einsatz_id FROM einsatz_abloesung WHERE id = NEW.abloesung_id))) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
CREATE TRIGGER einsatz_abloesung_abloeser_spiegelschutz_d BEFORE DELETE ON einsatz_abloesung_abloeser WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = (SELECT einsatz_id FROM einsatz_abloesung WHERE id = OLD.abloesung_id)) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
-- einsatz_abloesung_br_buchung
CREATE TRIGGER einsatz_abloesung_br_buchung_spiegellog_i AFTER INSERT ON einsatz_abloesung_br_buchung WHEN EXISTS (SELECT 1 FROM einsatz WHERE id = (SELECT einsatz_id FROM einsatz_abloesung WHERE id = NEW.abloesung_id)) BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'einsatz_abloesung_br_buchung' AND schluessel = json_array(NEW.abloesung_id, NEW.belegung_id);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) VALUES ((SELECT einsatz_id FROM einsatz_abloesung WHERE id = NEW.abloesung_id), 'einsatz_abloesung_br_buchung', json_array(NEW.abloesung_id, NEW.belegung_id));
END;
CREATE TRIGGER einsatz_abloesung_br_buchung_spiegellog_u AFTER UPDATE ON einsatz_abloesung_br_buchung BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'einsatz_abloesung_br_buchung' AND schluessel IN (json_array(OLD.abloesung_id, OLD.belegung_id), json_array(NEW.abloesung_id, NEW.belegung_id));
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT (SELECT einsatz_id FROM einsatz_abloesung WHERE id = OLD.abloesung_id), 'einsatz_abloesung_br_buchung', json_array(OLD.abloesung_id, OLD.belegung_id) WHERE json_array(OLD.abloesung_id, OLD.belegung_id) IS NOT json_array(NEW.abloesung_id, NEW.belegung_id) AND EXISTS (SELECT 1 FROM einsatz WHERE id = (SELECT einsatz_id FROM einsatz_abloesung WHERE id = OLD.abloesung_id));
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT (SELECT einsatz_id FROM einsatz_abloesung WHERE id = NEW.abloesung_id), 'einsatz_abloesung_br_buchung', json_array(NEW.abloesung_id, NEW.belegung_id) WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = (SELECT einsatz_id FROM einsatz_abloesung WHERE id = NEW.abloesung_id));
END;
CREATE TRIGGER einsatz_abloesung_br_buchung_spiegellog_d AFTER DELETE ON einsatz_abloesung_br_buchung BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'einsatz_abloesung_br_buchung' AND schluessel = json_array(OLD.abloesung_id, OLD.belegung_id);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT (SELECT einsatz_id FROM einsatz_abloesung WHERE id = OLD.abloesung_id), 'einsatz_abloesung_br_buchung', json_array(OLD.abloesung_id, OLD.belegung_id) WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = (SELECT einsatz_id FROM einsatz_abloesung WHERE id = OLD.abloesung_id));
END;
CREATE TRIGGER einsatz_abloesung_br_buchung_spiegelschutz_i BEFORE INSERT ON einsatz_abloesung_br_buchung WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = (SELECT einsatz_id FROM einsatz_abloesung WHERE id = NEW.abloesung_id)) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
CREATE TRIGGER einsatz_abloesung_br_buchung_spiegelschutz_u BEFORE UPDATE ON einsatz_abloesung_br_buchung WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND (EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = (SELECT einsatz_id FROM einsatz_abloesung WHERE id = OLD.abloesung_id)) OR EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = (SELECT einsatz_id FROM einsatz_abloesung WHERE id = NEW.abloesung_id))) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
CREATE TRIGGER einsatz_abloesung_br_buchung_spiegelschutz_d BEFORE DELETE ON einsatz_abloesung_br_buchung WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = (SELECT einsatz_id FROM einsatz_abloesung WHERE id = OLD.abloesung_id)) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
-- einsatz_abloesung_besatzung
CREATE TRIGGER einsatz_abloesung_besatzung_spiegellog_i AFTER INSERT ON einsatz_abloesung_besatzung WHEN EXISTS (SELECT 1 FROM einsatz WHERE id = (SELECT einsatz_id FROM einsatz_abloesung WHERE id = NEW.abloesung_id)) BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'einsatz_abloesung_besatzung' AND schluessel = json_array(NEW.abloesung_id, NEW.personal_id);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) VALUES ((SELECT einsatz_id FROM einsatz_abloesung WHERE id = NEW.abloesung_id), 'einsatz_abloesung_besatzung', json_array(NEW.abloesung_id, NEW.personal_id));
END;
CREATE TRIGGER einsatz_abloesung_besatzung_spiegellog_u AFTER UPDATE ON einsatz_abloesung_besatzung BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'einsatz_abloesung_besatzung' AND schluessel IN (json_array(OLD.abloesung_id, OLD.personal_id), json_array(NEW.abloesung_id, NEW.personal_id));
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT (SELECT einsatz_id FROM einsatz_abloesung WHERE id = OLD.abloesung_id), 'einsatz_abloesung_besatzung', json_array(OLD.abloesung_id, OLD.personal_id) WHERE json_array(OLD.abloesung_id, OLD.personal_id) IS NOT json_array(NEW.abloesung_id, NEW.personal_id) AND EXISTS (SELECT 1 FROM einsatz WHERE id = (SELECT einsatz_id FROM einsatz_abloesung WHERE id = OLD.abloesung_id));
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT (SELECT einsatz_id FROM einsatz_abloesung WHERE id = NEW.abloesung_id), 'einsatz_abloesung_besatzung', json_array(NEW.abloesung_id, NEW.personal_id) WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = (SELECT einsatz_id FROM einsatz_abloesung WHERE id = NEW.abloesung_id));
END;
CREATE TRIGGER einsatz_abloesung_besatzung_spiegellog_d AFTER DELETE ON einsatz_abloesung_besatzung BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'einsatz_abloesung_besatzung' AND schluessel = json_array(OLD.abloesung_id, OLD.personal_id);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT (SELECT einsatz_id FROM einsatz_abloesung WHERE id = OLD.abloesung_id), 'einsatz_abloesung_besatzung', json_array(OLD.abloesung_id, OLD.personal_id) WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = (SELECT einsatz_id FROM einsatz_abloesung WHERE id = OLD.abloesung_id));
END;
CREATE TRIGGER einsatz_abloesung_besatzung_spiegelschutz_i BEFORE INSERT ON einsatz_abloesung_besatzung WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = (SELECT einsatz_id FROM einsatz_abloesung WHERE id = NEW.abloesung_id)) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
CREATE TRIGGER einsatz_abloesung_besatzung_spiegelschutz_u BEFORE UPDATE ON einsatz_abloesung_besatzung WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND (EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = (SELECT einsatz_id FROM einsatz_abloesung WHERE id = OLD.abloesung_id)) OR EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = (SELECT einsatz_id FROM einsatz_abloesung WHERE id = NEW.abloesung_id))) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
CREATE TRIGGER einsatz_abloesung_besatzung_spiegelschutz_d BEFORE DELETE ON einsatz_abloesung_besatzung WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = (SELECT einsatz_id FROM einsatz_abloesung WHERE id = OLD.abloesung_id)) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
-- einsatz_abloesung_besatzung_plan
CREATE TRIGGER einsatz_abloesung_besatzung_plan_spiegellog_i AFTER INSERT ON einsatz_abloesung_besatzung_plan WHEN EXISTS (SELECT 1 FROM einsatz WHERE id = (SELECT einsatz_id FROM einsatz_abloesung WHERE id = NEW.abloesung_id)) BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'einsatz_abloesung_besatzung_plan' AND schluessel = json_array(NEW.abloesung_id, NEW.personal_id);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) VALUES ((SELECT einsatz_id FROM einsatz_abloesung WHERE id = NEW.abloesung_id), 'einsatz_abloesung_besatzung_plan', json_array(NEW.abloesung_id, NEW.personal_id));
END;
CREATE TRIGGER einsatz_abloesung_besatzung_plan_spiegellog_u AFTER UPDATE ON einsatz_abloesung_besatzung_plan BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'einsatz_abloesung_besatzung_plan' AND schluessel IN (json_array(OLD.abloesung_id, OLD.personal_id), json_array(NEW.abloesung_id, NEW.personal_id));
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT (SELECT einsatz_id FROM einsatz_abloesung WHERE id = OLD.abloesung_id), 'einsatz_abloesung_besatzung_plan', json_array(OLD.abloesung_id, OLD.personal_id) WHERE json_array(OLD.abloesung_id, OLD.personal_id) IS NOT json_array(NEW.abloesung_id, NEW.personal_id) AND EXISTS (SELECT 1 FROM einsatz WHERE id = (SELECT einsatz_id FROM einsatz_abloesung WHERE id = OLD.abloesung_id));
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT (SELECT einsatz_id FROM einsatz_abloesung WHERE id = NEW.abloesung_id), 'einsatz_abloesung_besatzung_plan', json_array(NEW.abloesung_id, NEW.personal_id) WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = (SELECT einsatz_id FROM einsatz_abloesung WHERE id = NEW.abloesung_id));
END;
CREATE TRIGGER einsatz_abloesung_besatzung_plan_spiegellog_d AFTER DELETE ON einsatz_abloesung_besatzung_plan BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'einsatz_abloesung_besatzung_plan' AND schluessel = json_array(OLD.abloesung_id, OLD.personal_id);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT (SELECT einsatz_id FROM einsatz_abloesung WHERE id = OLD.abloesung_id), 'einsatz_abloesung_besatzung_plan', json_array(OLD.abloesung_id, OLD.personal_id) WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = (SELECT einsatz_id FROM einsatz_abloesung WHERE id = OLD.abloesung_id));
END;
CREATE TRIGGER einsatz_abloesung_besatzung_plan_spiegelschutz_i BEFORE INSERT ON einsatz_abloesung_besatzung_plan WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = (SELECT einsatz_id FROM einsatz_abloesung WHERE id = NEW.abloesung_id)) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
CREATE TRIGGER einsatz_abloesung_besatzung_plan_spiegelschutz_u BEFORE UPDATE ON einsatz_abloesung_besatzung_plan WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND (EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = (SELECT einsatz_id FROM einsatz_abloesung WHERE id = OLD.abloesung_id)) OR EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = (SELECT einsatz_id FROM einsatz_abloesung WHERE id = NEW.abloesung_id))) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
CREATE TRIGGER einsatz_abloesung_besatzung_plan_spiegelschutz_d BEFORE DELETE ON einsatz_abloesung_besatzung_plan WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = (SELECT einsatz_id FROM einsatz_abloesung WHERE id = OLD.abloesung_id)) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
-- einsatz_abloesung_planung_vorher
CREATE TRIGGER einsatz_abloesung_planung_vorher_spiegellog_i AFTER INSERT ON einsatz_abloesung_planung_vorher WHEN EXISTS (SELECT 1 FROM einsatz WHERE id = (SELECT einsatz_id FROM einsatz_abloesung WHERE id = NEW.abloesung_id)) BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'einsatz_abloesung_planung_vorher' AND schluessel = json_array(NEW.abloesung_id, NEW.einheit_id);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) VALUES ((SELECT einsatz_id FROM einsatz_abloesung WHERE id = NEW.abloesung_id), 'einsatz_abloesung_planung_vorher', json_array(NEW.abloesung_id, NEW.einheit_id));
END;
CREATE TRIGGER einsatz_abloesung_planung_vorher_spiegellog_u AFTER UPDATE ON einsatz_abloesung_planung_vorher BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'einsatz_abloesung_planung_vorher' AND schluessel IN (json_array(OLD.abloesung_id, OLD.einheit_id), json_array(NEW.abloesung_id, NEW.einheit_id));
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT (SELECT einsatz_id FROM einsatz_abloesung WHERE id = OLD.abloesung_id), 'einsatz_abloesung_planung_vorher', json_array(OLD.abloesung_id, OLD.einheit_id) WHERE json_array(OLD.abloesung_id, OLD.einheit_id) IS NOT json_array(NEW.abloesung_id, NEW.einheit_id) AND EXISTS (SELECT 1 FROM einsatz WHERE id = (SELECT einsatz_id FROM einsatz_abloesung WHERE id = OLD.abloesung_id));
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT (SELECT einsatz_id FROM einsatz_abloesung WHERE id = NEW.abloesung_id), 'einsatz_abloesung_planung_vorher', json_array(NEW.abloesung_id, NEW.einheit_id) WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = (SELECT einsatz_id FROM einsatz_abloesung WHERE id = NEW.abloesung_id));
END;
CREATE TRIGGER einsatz_abloesung_planung_vorher_spiegellog_d AFTER DELETE ON einsatz_abloesung_planung_vorher BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'einsatz_abloesung_planung_vorher' AND schluessel = json_array(OLD.abloesung_id, OLD.einheit_id);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT (SELECT einsatz_id FROM einsatz_abloesung WHERE id = OLD.abloesung_id), 'einsatz_abloesung_planung_vorher', json_array(OLD.abloesung_id, OLD.einheit_id) WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = (SELECT einsatz_id FROM einsatz_abloesung WHERE id = OLD.abloesung_id));
END;
CREATE TRIGGER einsatz_abloesung_planung_vorher_spiegelschutz_i BEFORE INSERT ON einsatz_abloesung_planung_vorher WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = (SELECT einsatz_id FROM einsatz_abloesung WHERE id = NEW.abloesung_id)) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
CREATE TRIGGER einsatz_abloesung_planung_vorher_spiegelschutz_u BEFORE UPDATE ON einsatz_abloesung_planung_vorher WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND (EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = (SELECT einsatz_id FROM einsatz_abloesung WHERE id = OLD.abloesung_id)) OR EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = (SELECT einsatz_id FROM einsatz_abloesung WHERE id = NEW.abloesung_id))) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
CREATE TRIGGER einsatz_abloesung_planung_vorher_spiegelschutz_d BEFORE DELETE ON einsatz_abloesung_planung_vorher WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = (SELECT einsatz_id FROM einsatz_abloesung WHERE id = OLD.abloesung_id)) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
-- einsatz_plan_helfer
CREATE TRIGGER einsatz_plan_helfer_spiegellog_i AFTER INSERT ON einsatz_plan_helfer WHEN EXISTS (SELECT 1 FROM einsatz WHERE id = NEW.einsatz_id) BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'einsatz_plan_helfer' AND schluessel = CAST(NEW.id AS TEXT);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) VALUES (NEW.einsatz_id, 'einsatz_plan_helfer', CAST(NEW.id AS TEXT));
END;
CREATE TRIGGER einsatz_plan_helfer_spiegellog_u AFTER UPDATE ON einsatz_plan_helfer BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'einsatz_plan_helfer' AND schluessel IN (CAST(OLD.id AS TEXT), CAST(NEW.id AS TEXT));
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT OLD.einsatz_id, 'einsatz_plan_helfer', CAST(OLD.id AS TEXT) WHERE CAST(OLD.id AS TEXT) IS NOT CAST(NEW.id AS TEXT) AND EXISTS (SELECT 1 FROM einsatz WHERE id = OLD.einsatz_id);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT NEW.einsatz_id, 'einsatz_plan_helfer', CAST(NEW.id AS TEXT) WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = NEW.einsatz_id);
END;
CREATE TRIGGER einsatz_plan_helfer_spiegellog_d AFTER DELETE ON einsatz_plan_helfer BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'einsatz_plan_helfer' AND schluessel = CAST(OLD.id AS TEXT);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT OLD.einsatz_id, 'einsatz_plan_helfer', CAST(OLD.id AS TEXT) WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = OLD.einsatz_id);
END;
CREATE TRIGGER einsatz_plan_helfer_spiegelschutz_i BEFORE INSERT ON einsatz_plan_helfer WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = NEW.einsatz_id) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
CREATE TRIGGER einsatz_plan_helfer_spiegelschutz_u BEFORE UPDATE ON einsatz_plan_helfer WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND (EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = OLD.einsatz_id) OR EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = NEW.einsatz_id)) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
CREATE TRIGGER einsatz_plan_helfer_spiegelschutz_d BEFORE DELETE ON einsatz_plan_helfer WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = OLD.einsatz_id) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
-- einsatz_planschicht
CREATE TRIGGER einsatz_planschicht_spiegellog_i AFTER INSERT ON einsatz_planschicht WHEN EXISTS (SELECT 1 FROM einsatz WHERE id = NEW.einsatz_id) BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'einsatz_planschicht' AND schluessel = CAST(NEW.id AS TEXT);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) VALUES (NEW.einsatz_id, 'einsatz_planschicht', CAST(NEW.id AS TEXT));
END;
CREATE TRIGGER einsatz_planschicht_spiegellog_u AFTER UPDATE ON einsatz_planschicht BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'einsatz_planschicht' AND schluessel IN (CAST(OLD.id AS TEXT), CAST(NEW.id AS TEXT));
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT OLD.einsatz_id, 'einsatz_planschicht', CAST(OLD.id AS TEXT) WHERE CAST(OLD.id AS TEXT) IS NOT CAST(NEW.id AS TEXT) AND EXISTS (SELECT 1 FROM einsatz WHERE id = OLD.einsatz_id);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT NEW.einsatz_id, 'einsatz_planschicht', CAST(NEW.id AS TEXT) WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = NEW.einsatz_id);
END;
CREATE TRIGGER einsatz_planschicht_spiegellog_d AFTER DELETE ON einsatz_planschicht BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'einsatz_planschicht' AND schluessel = CAST(OLD.id AS TEXT);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT OLD.einsatz_id, 'einsatz_planschicht', CAST(OLD.id AS TEXT) WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = OLD.einsatz_id);
END;
CREATE TRIGGER einsatz_planschicht_spiegelschutz_i BEFORE INSERT ON einsatz_planschicht WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = NEW.einsatz_id) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
CREATE TRIGGER einsatz_planschicht_spiegelschutz_u BEFORE UPDATE ON einsatz_planschicht WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND (EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = OLD.einsatz_id) OR EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = NEW.einsatz_id)) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
CREATE TRIGGER einsatz_planschicht_spiegelschutz_d BEFORE DELETE ON einsatz_planschicht WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = OLD.einsatz_id) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
-- einsatz_planschicht_person
CREATE TRIGGER einsatz_planschicht_person_spiegellog_i AFTER INSERT ON einsatz_planschicht_person WHEN EXISTS (SELECT 1 FROM einsatz WHERE id = (SELECT einsatz_id FROM einsatz_planschicht WHERE id = NEW.planschicht_id)) BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'einsatz_planschicht_person' AND schluessel = CAST(NEW.rowid AS TEXT);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) VALUES ((SELECT einsatz_id FROM einsatz_planschicht WHERE id = NEW.planschicht_id), 'einsatz_planschicht_person', CAST(NEW.rowid AS TEXT));
END;
CREATE TRIGGER einsatz_planschicht_person_spiegellog_u AFTER UPDATE ON einsatz_planschicht_person BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'einsatz_planschicht_person' AND schluessel IN (CAST(OLD.rowid AS TEXT), CAST(NEW.rowid AS TEXT));
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT (SELECT einsatz_id FROM einsatz_planschicht WHERE id = OLD.planschicht_id), 'einsatz_planschicht_person', CAST(OLD.rowid AS TEXT) WHERE CAST(OLD.rowid AS TEXT) IS NOT CAST(NEW.rowid AS TEXT) AND EXISTS (SELECT 1 FROM einsatz WHERE id = (SELECT einsatz_id FROM einsatz_planschicht WHERE id = OLD.planschicht_id));
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT (SELECT einsatz_id FROM einsatz_planschicht WHERE id = NEW.planschicht_id), 'einsatz_planschicht_person', CAST(NEW.rowid AS TEXT) WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = (SELECT einsatz_id FROM einsatz_planschicht WHERE id = NEW.planschicht_id));
END;
CREATE TRIGGER einsatz_planschicht_person_spiegellog_d AFTER DELETE ON einsatz_planschicht_person BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'einsatz_planschicht_person' AND schluessel = CAST(OLD.rowid AS TEXT);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT (SELECT einsatz_id FROM einsatz_planschicht WHERE id = OLD.planschicht_id), 'einsatz_planschicht_person', CAST(OLD.rowid AS TEXT) WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = (SELECT einsatz_id FROM einsatz_planschicht WHERE id = OLD.planschicht_id));
END;
CREATE TRIGGER einsatz_planschicht_person_spiegelschutz_i BEFORE INSERT ON einsatz_planschicht_person WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = (SELECT einsatz_id FROM einsatz_planschicht WHERE id = NEW.planschicht_id)) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
CREATE TRIGGER einsatz_planschicht_person_spiegelschutz_u BEFORE UPDATE ON einsatz_planschicht_person WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND (EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = (SELECT einsatz_id FROM einsatz_planschicht WHERE id = OLD.planschicht_id)) OR EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = (SELECT einsatz_id FROM einsatz_planschicht WHERE id = NEW.planschicht_id))) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
CREATE TRIGGER einsatz_planschicht_person_spiegelschutz_d BEFORE DELETE ON einsatz_planschicht_person WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = (SELECT einsatz_id FROM einsatz_planschicht WHERE id = OLD.planschicht_id)) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
-- einsatz_plan_wechsel
CREATE TRIGGER einsatz_plan_wechsel_spiegellog_i AFTER INSERT ON einsatz_plan_wechsel WHEN EXISTS (SELECT 1 FROM einsatz WHERE id = NEW.einsatz_id) BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'einsatz_plan_wechsel' AND schluessel = CAST(NEW.id AS TEXT);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) VALUES (NEW.einsatz_id, 'einsatz_plan_wechsel', CAST(NEW.id AS TEXT));
END;
CREATE TRIGGER einsatz_plan_wechsel_spiegellog_u AFTER UPDATE ON einsatz_plan_wechsel BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'einsatz_plan_wechsel' AND schluessel IN (CAST(OLD.id AS TEXT), CAST(NEW.id AS TEXT));
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT OLD.einsatz_id, 'einsatz_plan_wechsel', CAST(OLD.id AS TEXT) WHERE CAST(OLD.id AS TEXT) IS NOT CAST(NEW.id AS TEXT) AND EXISTS (SELECT 1 FROM einsatz WHERE id = OLD.einsatz_id);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT NEW.einsatz_id, 'einsatz_plan_wechsel', CAST(NEW.id AS TEXT) WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = NEW.einsatz_id);
END;
CREATE TRIGGER einsatz_plan_wechsel_spiegellog_d AFTER DELETE ON einsatz_plan_wechsel BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'einsatz_plan_wechsel' AND schluessel = CAST(OLD.id AS TEXT);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT OLD.einsatz_id, 'einsatz_plan_wechsel', CAST(OLD.id AS TEXT) WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = OLD.einsatz_id);
END;
CREATE TRIGGER einsatz_plan_wechsel_spiegelschutz_i BEFORE INSERT ON einsatz_plan_wechsel WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = NEW.einsatz_id) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
CREATE TRIGGER einsatz_plan_wechsel_spiegelschutz_u BEFORE UPDATE ON einsatz_plan_wechsel WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND (EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = OLD.einsatz_id) OR EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = NEW.einsatz_id)) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
CREATE TRIGGER einsatz_plan_wechsel_spiegelschutz_d BEFORE DELETE ON einsatz_plan_wechsel WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = OLD.einsatz_id) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
-- einsatz_plan_wechsel_person
CREATE TRIGGER einsatz_plan_wechsel_person_spiegellog_i AFTER INSERT ON einsatz_plan_wechsel_person WHEN EXISTS (SELECT 1 FROM einsatz WHERE id = (SELECT einsatz_id FROM einsatz_plan_wechsel WHERE id = NEW.wechsel_id)) BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'einsatz_plan_wechsel_person' AND schluessel = json_array(NEW.wechsel_id, NEW.einsatz_personal_id);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) VALUES ((SELECT einsatz_id FROM einsatz_plan_wechsel WHERE id = NEW.wechsel_id), 'einsatz_plan_wechsel_person', json_array(NEW.wechsel_id, NEW.einsatz_personal_id));
END;
CREATE TRIGGER einsatz_plan_wechsel_person_spiegellog_u AFTER UPDATE ON einsatz_plan_wechsel_person BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'einsatz_plan_wechsel_person' AND schluessel IN (json_array(OLD.wechsel_id, OLD.einsatz_personal_id), json_array(NEW.wechsel_id, NEW.einsatz_personal_id));
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT (SELECT einsatz_id FROM einsatz_plan_wechsel WHERE id = OLD.wechsel_id), 'einsatz_plan_wechsel_person', json_array(OLD.wechsel_id, OLD.einsatz_personal_id) WHERE json_array(OLD.wechsel_id, OLD.einsatz_personal_id) IS NOT json_array(NEW.wechsel_id, NEW.einsatz_personal_id) AND EXISTS (SELECT 1 FROM einsatz WHERE id = (SELECT einsatz_id FROM einsatz_plan_wechsel WHERE id = OLD.wechsel_id));
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT (SELECT einsatz_id FROM einsatz_plan_wechsel WHERE id = NEW.wechsel_id), 'einsatz_plan_wechsel_person', json_array(NEW.wechsel_id, NEW.einsatz_personal_id) WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = (SELECT einsatz_id FROM einsatz_plan_wechsel WHERE id = NEW.wechsel_id));
END;
CREATE TRIGGER einsatz_plan_wechsel_person_spiegellog_d AFTER DELETE ON einsatz_plan_wechsel_person BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'einsatz_plan_wechsel_person' AND schluessel = json_array(OLD.wechsel_id, OLD.einsatz_personal_id);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT (SELECT einsatz_id FROM einsatz_plan_wechsel WHERE id = OLD.wechsel_id), 'einsatz_plan_wechsel_person', json_array(OLD.wechsel_id, OLD.einsatz_personal_id) WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = (SELECT einsatz_id FROM einsatz_plan_wechsel WHERE id = OLD.wechsel_id));
END;
CREATE TRIGGER einsatz_plan_wechsel_person_spiegelschutz_i BEFORE INSERT ON einsatz_plan_wechsel_person WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = (SELECT einsatz_id FROM einsatz_plan_wechsel WHERE id = NEW.wechsel_id)) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
CREATE TRIGGER einsatz_plan_wechsel_person_spiegelschutz_u BEFORE UPDATE ON einsatz_plan_wechsel_person WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND (EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = (SELECT einsatz_id FROM einsatz_plan_wechsel WHERE id = OLD.wechsel_id)) OR EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = (SELECT einsatz_id FROM einsatz_plan_wechsel WHERE id = NEW.wechsel_id))) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
CREATE TRIGGER einsatz_plan_wechsel_person_spiegelschutz_d BEFORE DELETE ON einsatz_plan_wechsel_person WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = (SELECT einsatz_id FROM einsatz_plan_wechsel WHERE id = OLD.wechsel_id)) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
-- einsatz_schichtmodell
CREATE TRIGGER einsatz_schichtmodell_spiegellog_i AFTER INSERT ON einsatz_schichtmodell WHEN EXISTS (SELECT 1 FROM einsatz WHERE id = NEW.einsatz_id) BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'einsatz_schichtmodell' AND schluessel = CAST(NEW.einsatz_id AS TEXT);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) VALUES (NEW.einsatz_id, 'einsatz_schichtmodell', CAST(NEW.einsatz_id AS TEXT));
END;
CREATE TRIGGER einsatz_schichtmodell_spiegellog_u AFTER UPDATE ON einsatz_schichtmodell BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'einsatz_schichtmodell' AND schluessel IN (CAST(OLD.einsatz_id AS TEXT), CAST(NEW.einsatz_id AS TEXT));
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT OLD.einsatz_id, 'einsatz_schichtmodell', CAST(OLD.einsatz_id AS TEXT) WHERE CAST(OLD.einsatz_id AS TEXT) IS NOT CAST(NEW.einsatz_id AS TEXT) AND EXISTS (SELECT 1 FROM einsatz WHERE id = OLD.einsatz_id);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT NEW.einsatz_id, 'einsatz_schichtmodell', CAST(NEW.einsatz_id AS TEXT) WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = NEW.einsatz_id);
END;
CREATE TRIGGER einsatz_schichtmodell_spiegellog_d AFTER DELETE ON einsatz_schichtmodell BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'einsatz_schichtmodell' AND schluessel = CAST(OLD.einsatz_id AS TEXT);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT OLD.einsatz_id, 'einsatz_schichtmodell', CAST(OLD.einsatz_id AS TEXT) WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = OLD.einsatz_id);
END;
CREATE TRIGGER einsatz_schichtmodell_spiegelschutz_i BEFORE INSERT ON einsatz_schichtmodell WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = NEW.einsatz_id) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
CREATE TRIGGER einsatz_schichtmodell_spiegelschutz_u BEFORE UPDATE ON einsatz_schichtmodell WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND (EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = OLD.einsatz_id) OR EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = NEW.einsatz_id)) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
CREATE TRIGGER einsatz_schichtmodell_spiegelschutz_d BEFORE DELETE ON einsatz_schichtmodell WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = OLD.einsatz_id) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
-- einsatz_kraft_zeitachse
CREATE TRIGGER einsatz_kraft_zeitachse_spiegellog_i AFTER INSERT ON einsatz_kraft_zeitachse WHEN EXISTS (SELECT 1 FROM einsatz WHERE id = NEW.einsatz_id) BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'einsatz_kraft_zeitachse' AND schluessel = CAST(NEW.id AS TEXT);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) VALUES (NEW.einsatz_id, 'einsatz_kraft_zeitachse', CAST(NEW.id AS TEXT));
END;
CREATE TRIGGER einsatz_kraft_zeitachse_spiegellog_u AFTER UPDATE ON einsatz_kraft_zeitachse BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'einsatz_kraft_zeitachse' AND schluessel IN (CAST(OLD.id AS TEXT), CAST(NEW.id AS TEXT));
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT OLD.einsatz_id, 'einsatz_kraft_zeitachse', CAST(OLD.id AS TEXT) WHERE CAST(OLD.id AS TEXT) IS NOT CAST(NEW.id AS TEXT) AND EXISTS (SELECT 1 FROM einsatz WHERE id = OLD.einsatz_id);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT NEW.einsatz_id, 'einsatz_kraft_zeitachse', CAST(NEW.id AS TEXT) WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = NEW.einsatz_id);
END;
CREATE TRIGGER einsatz_kraft_zeitachse_spiegellog_d AFTER DELETE ON einsatz_kraft_zeitachse BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'einsatz_kraft_zeitachse' AND schluessel = CAST(OLD.id AS TEXT);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT OLD.einsatz_id, 'einsatz_kraft_zeitachse', CAST(OLD.id AS TEXT) WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = OLD.einsatz_id);
END;
CREATE TRIGGER einsatz_kraft_zeitachse_spiegelschutz_i BEFORE INSERT ON einsatz_kraft_zeitachse WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = NEW.einsatz_id) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
CREATE TRIGGER einsatz_kraft_zeitachse_spiegelschutz_u BEFORE UPDATE ON einsatz_kraft_zeitachse WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND (EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = OLD.einsatz_id) OR EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = NEW.einsatz_id)) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
CREATE TRIGGER einsatz_kraft_zeitachse_spiegelschutz_d BEFORE DELETE ON einsatz_kraft_zeitachse WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = OLD.einsatz_id) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
-- bereitstellungsraum
CREATE TRIGGER bereitstellungsraum_spiegellog_i AFTER INSERT ON bereitstellungsraum WHEN EXISTS (SELECT 1 FROM einsatz WHERE id = NEW.einsatz_id) BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'bereitstellungsraum' AND schluessel = CAST(NEW.id AS TEXT);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) VALUES (NEW.einsatz_id, 'bereitstellungsraum', CAST(NEW.id AS TEXT));
END;
CREATE TRIGGER bereitstellungsraum_spiegellog_u AFTER UPDATE ON bereitstellungsraum BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'bereitstellungsraum' AND schluessel IN (CAST(OLD.id AS TEXT), CAST(NEW.id AS TEXT));
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT OLD.einsatz_id, 'bereitstellungsraum', CAST(OLD.id AS TEXT) WHERE CAST(OLD.id AS TEXT) IS NOT CAST(NEW.id AS TEXT) AND EXISTS (SELECT 1 FROM einsatz WHERE id = OLD.einsatz_id);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT NEW.einsatz_id, 'bereitstellungsraum', CAST(NEW.id AS TEXT) WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = NEW.einsatz_id);
END;
CREATE TRIGGER bereitstellungsraum_spiegellog_d AFTER DELETE ON bereitstellungsraum BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'bereitstellungsraum' AND schluessel = CAST(OLD.id AS TEXT);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT OLD.einsatz_id, 'bereitstellungsraum', CAST(OLD.id AS TEXT) WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = OLD.einsatz_id);
END;
CREATE TRIGGER bereitstellungsraum_spiegelschutz_i BEFORE INSERT ON bereitstellungsraum WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = NEW.einsatz_id) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
CREATE TRIGGER bereitstellungsraum_spiegelschutz_u BEFORE UPDATE ON bereitstellungsraum WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND (EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = OLD.einsatz_id) OR EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = NEW.einsatz_id)) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
CREATE TRIGGER bereitstellungsraum_spiegelschutz_d BEFORE DELETE ON bereitstellungsraum WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = OLD.einsatz_id) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
-- br_belegung
CREATE TRIGGER br_belegung_spiegellog_i AFTER INSERT ON br_belegung WHEN EXISTS (SELECT 1 FROM einsatz WHERE id = NEW.einsatz_id) BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'br_belegung' AND schluessel = CAST(NEW.id AS TEXT);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) VALUES (NEW.einsatz_id, 'br_belegung', CAST(NEW.id AS TEXT));
END;
CREATE TRIGGER br_belegung_spiegellog_u AFTER UPDATE ON br_belegung BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'br_belegung' AND schluessel IN (CAST(OLD.id AS TEXT), CAST(NEW.id AS TEXT));
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT OLD.einsatz_id, 'br_belegung', CAST(OLD.id AS TEXT) WHERE CAST(OLD.id AS TEXT) IS NOT CAST(NEW.id AS TEXT) AND EXISTS (SELECT 1 FROM einsatz WHERE id = OLD.einsatz_id);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT NEW.einsatz_id, 'br_belegung', CAST(NEW.id AS TEXT) WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = NEW.einsatz_id);
END;
CREATE TRIGGER br_belegung_spiegellog_d AFTER DELETE ON br_belegung BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'br_belegung' AND schluessel = CAST(OLD.id AS TEXT);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT OLD.einsatz_id, 'br_belegung', CAST(OLD.id AS TEXT) WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = OLD.einsatz_id);
END;
CREATE TRIGGER br_belegung_spiegelschutz_i BEFORE INSERT ON br_belegung WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = NEW.einsatz_id) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
CREATE TRIGGER br_belegung_spiegelschutz_u BEFORE UPDATE ON br_belegung WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND (EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = OLD.einsatz_id) OR EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = NEW.einsatz_id)) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
CREATE TRIGGER br_belegung_spiegelschutz_d BEFORE DELETE ON br_belegung WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = OLD.einsatz_id) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
-- einsatz_person
CREATE TRIGGER einsatz_person_spiegellog_i AFTER INSERT ON einsatz_person WHEN EXISTS (SELECT 1 FROM einsatz WHERE id = NEW.einsatz_id) BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'einsatz_person' AND schluessel = CAST(NEW.id AS TEXT);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) VALUES (NEW.einsatz_id, 'einsatz_person', CAST(NEW.id AS TEXT));
END;
CREATE TRIGGER einsatz_person_spiegellog_u AFTER UPDATE ON einsatz_person BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'einsatz_person' AND schluessel IN (CAST(OLD.id AS TEXT), CAST(NEW.id AS TEXT));
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT OLD.einsatz_id, 'einsatz_person', CAST(OLD.id AS TEXT) WHERE CAST(OLD.id AS TEXT) IS NOT CAST(NEW.id AS TEXT) AND EXISTS (SELECT 1 FROM einsatz WHERE id = OLD.einsatz_id);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT NEW.einsatz_id, 'einsatz_person', CAST(NEW.id AS TEXT) WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = NEW.einsatz_id);
END;
CREATE TRIGGER einsatz_person_spiegellog_d AFTER DELETE ON einsatz_person BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'einsatz_person' AND schluessel = CAST(OLD.id AS TEXT);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT OLD.einsatz_id, 'einsatz_person', CAST(OLD.id AS TEXT) WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = OLD.einsatz_id);
END;
CREATE TRIGGER einsatz_person_spiegelschutz_i BEFORE INSERT ON einsatz_person WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = NEW.einsatz_id) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
CREATE TRIGGER einsatz_person_spiegelschutz_u BEFORE UPDATE ON einsatz_person WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND (EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = OLD.einsatz_id) OR EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = NEW.einsatz_id)) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
CREATE TRIGGER einsatz_person_spiegelschutz_d BEFORE DELETE ON einsatz_person WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = OLD.einsatz_id) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
-- person_anlass
CREATE TRIGGER person_anlass_spiegellog_i AFTER INSERT ON person_anlass WHEN EXISTS (SELECT 1 FROM einsatz WHERE id = NEW.einsatz_id) BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'person_anlass' AND schluessel = CAST(NEW.id AS TEXT);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) VALUES (NEW.einsatz_id, 'person_anlass', CAST(NEW.id AS TEXT));
END;
CREATE TRIGGER person_anlass_spiegellog_u AFTER UPDATE ON person_anlass BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'person_anlass' AND schluessel IN (CAST(OLD.id AS TEXT), CAST(NEW.id AS TEXT));
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT OLD.einsatz_id, 'person_anlass', CAST(OLD.id AS TEXT) WHERE CAST(OLD.id AS TEXT) IS NOT CAST(NEW.id AS TEXT) AND EXISTS (SELECT 1 FROM einsatz WHERE id = OLD.einsatz_id);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT NEW.einsatz_id, 'person_anlass', CAST(NEW.id AS TEXT) WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = NEW.einsatz_id);
END;
CREATE TRIGGER person_anlass_spiegellog_d AFTER DELETE ON person_anlass BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'person_anlass' AND schluessel = CAST(OLD.id AS TEXT);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT OLD.einsatz_id, 'person_anlass', CAST(OLD.id AS TEXT) WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = OLD.einsatz_id);
END;
CREATE TRIGGER person_anlass_spiegelschutz_i BEFORE INSERT ON person_anlass WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = NEW.einsatz_id) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
CREATE TRIGGER person_anlass_spiegelschutz_u BEFORE UPDATE ON person_anlass WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND (EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = OLD.einsatz_id) OR EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = NEW.einsatz_id)) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
CREATE TRIGGER person_anlass_spiegelschutz_d BEFORE DELETE ON person_anlass WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = OLD.einsatz_id) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
-- person_transport
CREATE TRIGGER person_transport_spiegellog_i AFTER INSERT ON person_transport WHEN EXISTS (SELECT 1 FROM einsatz WHERE id = NEW.einsatz_id) BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'person_transport' AND schluessel = CAST(NEW.id AS TEXT);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) VALUES (NEW.einsatz_id, 'person_transport', CAST(NEW.id AS TEXT));
END;
CREATE TRIGGER person_transport_spiegellog_u AFTER UPDATE ON person_transport BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'person_transport' AND schluessel IN (CAST(OLD.id AS TEXT), CAST(NEW.id AS TEXT));
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT OLD.einsatz_id, 'person_transport', CAST(OLD.id AS TEXT) WHERE CAST(OLD.id AS TEXT) IS NOT CAST(NEW.id AS TEXT) AND EXISTS (SELECT 1 FROM einsatz WHERE id = OLD.einsatz_id);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT NEW.einsatz_id, 'person_transport', CAST(NEW.id AS TEXT) WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = NEW.einsatz_id);
END;
CREATE TRIGGER person_transport_spiegellog_d AFTER DELETE ON person_transport BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'person_transport' AND schluessel = CAST(OLD.id AS TEXT);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT OLD.einsatz_id, 'person_transport', CAST(OLD.id AS TEXT) WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = OLD.einsatz_id);
END;
CREATE TRIGGER person_transport_spiegelschutz_i BEFORE INSERT ON person_transport WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = NEW.einsatz_id) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
CREATE TRIGGER person_transport_spiegelschutz_u BEFORE UPDATE ON person_transport WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND (EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = OLD.einsatz_id) OR EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = NEW.einsatz_id)) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
CREATE TRIGGER person_transport_spiegelschutz_d BEFORE DELETE ON person_transport WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = OLD.einsatz_id) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
-- person_sichtung
CREATE TRIGGER person_sichtung_spiegellog_i AFTER INSERT ON person_sichtung WHEN EXISTS (SELECT 1 FROM einsatz WHERE id = NEW.einsatz_id) BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'person_sichtung' AND schluessel = CAST(NEW.id AS TEXT);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) VALUES (NEW.einsatz_id, 'person_sichtung', CAST(NEW.id AS TEXT));
END;
CREATE TRIGGER person_sichtung_spiegellog_u AFTER UPDATE ON person_sichtung BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'person_sichtung' AND schluessel IN (CAST(OLD.id AS TEXT), CAST(NEW.id AS TEXT));
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT OLD.einsatz_id, 'person_sichtung', CAST(OLD.id AS TEXT) WHERE CAST(OLD.id AS TEXT) IS NOT CAST(NEW.id AS TEXT) AND EXISTS (SELECT 1 FROM einsatz WHERE id = OLD.einsatz_id);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT NEW.einsatz_id, 'person_sichtung', CAST(NEW.id AS TEXT) WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = NEW.einsatz_id);
END;
CREATE TRIGGER person_sichtung_spiegellog_d AFTER DELETE ON person_sichtung BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'person_sichtung' AND schluessel = CAST(OLD.id AS TEXT);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT OLD.einsatz_id, 'person_sichtung', CAST(OLD.id AS TEXT) WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = OLD.einsatz_id);
END;
CREATE TRIGGER person_sichtung_spiegelschutz_i BEFORE INSERT ON person_sichtung WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = NEW.einsatz_id) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
CREATE TRIGGER person_sichtung_spiegelschutz_u BEFORE UPDATE ON person_sichtung WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND (EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = OLD.einsatz_id) OR EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = NEW.einsatz_id)) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
CREATE TRIGGER person_sichtung_spiegelschutz_d BEFORE DELETE ON person_sichtung WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = OLD.einsatz_id) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
-- person_massnahme
CREATE TRIGGER person_massnahme_spiegellog_i AFTER INSERT ON person_massnahme WHEN EXISTS (SELECT 1 FROM einsatz WHERE id = NEW.einsatz_id) BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'person_massnahme' AND schluessel = CAST(NEW.id AS TEXT);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) VALUES (NEW.einsatz_id, 'person_massnahme', CAST(NEW.id AS TEXT));
END;
CREATE TRIGGER person_massnahme_spiegellog_u AFTER UPDATE ON person_massnahme BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'person_massnahme' AND schluessel IN (CAST(OLD.id AS TEXT), CAST(NEW.id AS TEXT));
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT OLD.einsatz_id, 'person_massnahme', CAST(OLD.id AS TEXT) WHERE CAST(OLD.id AS TEXT) IS NOT CAST(NEW.id AS TEXT) AND EXISTS (SELECT 1 FROM einsatz WHERE id = OLD.einsatz_id);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT NEW.einsatz_id, 'person_massnahme', CAST(NEW.id AS TEXT) WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = NEW.einsatz_id);
END;
CREATE TRIGGER person_massnahme_spiegellog_d AFTER DELETE ON person_massnahme BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'person_massnahme' AND schluessel = CAST(OLD.id AS TEXT);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT OLD.einsatz_id, 'person_massnahme', CAST(OLD.id AS TEXT) WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = OLD.einsatz_id);
END;
CREATE TRIGGER person_massnahme_spiegelschutz_i BEFORE INSERT ON person_massnahme WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = NEW.einsatz_id) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
CREATE TRIGGER person_massnahme_spiegelschutz_u BEFORE UPDATE ON person_massnahme WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND (EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = OLD.einsatz_id) OR EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = NEW.einsatz_id)) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
CREATE TRIGGER person_massnahme_spiegelschutz_d BEFORE DELETE ON person_massnahme WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = OLD.einsatz_id) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
-- person_verletzung
CREATE TRIGGER person_verletzung_spiegellog_i AFTER INSERT ON person_verletzung WHEN EXISTS (SELECT 1 FROM einsatz WHERE id = NEW.einsatz_id) BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'person_verletzung' AND schluessel = CAST(NEW.id AS TEXT);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) VALUES (NEW.einsatz_id, 'person_verletzung', CAST(NEW.id AS TEXT));
END;
CREATE TRIGGER person_verletzung_spiegellog_u AFTER UPDATE ON person_verletzung BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'person_verletzung' AND schluessel IN (CAST(OLD.id AS TEXT), CAST(NEW.id AS TEXT));
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT OLD.einsatz_id, 'person_verletzung', CAST(OLD.id AS TEXT) WHERE CAST(OLD.id AS TEXT) IS NOT CAST(NEW.id AS TEXT) AND EXISTS (SELECT 1 FROM einsatz WHERE id = OLD.einsatz_id);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT NEW.einsatz_id, 'person_verletzung', CAST(NEW.id AS TEXT) WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = NEW.einsatz_id);
END;
CREATE TRIGGER person_verletzung_spiegellog_d AFTER DELETE ON person_verletzung BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'person_verletzung' AND schluessel = CAST(OLD.id AS TEXT);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT OLD.einsatz_id, 'person_verletzung', CAST(OLD.id AS TEXT) WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = OLD.einsatz_id);
END;
CREATE TRIGGER person_verletzung_spiegelschutz_i BEFORE INSERT ON person_verletzung WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = NEW.einsatz_id) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
CREATE TRIGGER person_verletzung_spiegelschutz_u BEFORE UPDATE ON person_verletzung WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND (EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = OLD.einsatz_id) OR EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = NEW.einsatz_id)) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
CREATE TRIGGER person_verletzung_spiegelschutz_d BEFORE DELETE ON person_verletzung WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = OLD.einsatz_id) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
-- person_verlaufsnotiz
CREATE TRIGGER person_verlaufsnotiz_spiegellog_i AFTER INSERT ON person_verlaufsnotiz WHEN EXISTS (SELECT 1 FROM einsatz WHERE id = NEW.einsatz_id) BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'person_verlaufsnotiz' AND schluessel = CAST(NEW.id AS TEXT);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) VALUES (NEW.einsatz_id, 'person_verlaufsnotiz', CAST(NEW.id AS TEXT));
END;
CREATE TRIGGER person_verlaufsnotiz_spiegellog_u AFTER UPDATE ON person_verlaufsnotiz BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'person_verlaufsnotiz' AND schluessel IN (CAST(OLD.id AS TEXT), CAST(NEW.id AS TEXT));
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT OLD.einsatz_id, 'person_verlaufsnotiz', CAST(OLD.id AS TEXT) WHERE CAST(OLD.id AS TEXT) IS NOT CAST(NEW.id AS TEXT) AND EXISTS (SELECT 1 FROM einsatz WHERE id = OLD.einsatz_id);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT NEW.einsatz_id, 'person_verlaufsnotiz', CAST(NEW.id AS TEXT) WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = NEW.einsatz_id);
END;
CREATE TRIGGER person_verlaufsnotiz_spiegellog_d AFTER DELETE ON person_verlaufsnotiz BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'person_verlaufsnotiz' AND schluessel = CAST(OLD.id AS TEXT);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT OLD.einsatz_id, 'person_verlaufsnotiz', CAST(OLD.id AS TEXT) WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = OLD.einsatz_id);
END;
CREATE TRIGGER person_verlaufsnotiz_spiegelschutz_i BEFORE INSERT ON person_verlaufsnotiz WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = NEW.einsatz_id) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
CREATE TRIGGER person_verlaufsnotiz_spiegelschutz_u BEFORE UPDATE ON person_verlaufsnotiz WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND (EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = OLD.einsatz_id) OR EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = NEW.einsatz_id)) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
CREATE TRIGGER person_verlaufsnotiz_spiegelschutz_d BEFORE DELETE ON person_verlaufsnotiz WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = OLD.einsatz_id) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
-- person_verbleib
CREATE TRIGGER person_verbleib_spiegellog_i AFTER INSERT ON person_verbleib WHEN EXISTS (SELECT 1 FROM einsatz WHERE id = NEW.einsatz_id) BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'person_verbleib' AND schluessel = CAST(NEW.id AS TEXT);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) VALUES (NEW.einsatz_id, 'person_verbleib', CAST(NEW.id AS TEXT));
END;
CREATE TRIGGER person_verbleib_spiegellog_u AFTER UPDATE ON person_verbleib BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'person_verbleib' AND schluessel IN (CAST(OLD.id AS TEXT), CAST(NEW.id AS TEXT));
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT OLD.einsatz_id, 'person_verbleib', CAST(OLD.id AS TEXT) WHERE CAST(OLD.id AS TEXT) IS NOT CAST(NEW.id AS TEXT) AND EXISTS (SELECT 1 FROM einsatz WHERE id = OLD.einsatz_id);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT NEW.einsatz_id, 'person_verbleib', CAST(NEW.id AS TEXT) WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = NEW.einsatz_id);
END;
CREATE TRIGGER person_verbleib_spiegellog_d AFTER DELETE ON person_verbleib BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'person_verbleib' AND schluessel = CAST(OLD.id AS TEXT);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT OLD.einsatz_id, 'person_verbleib', CAST(OLD.id AS TEXT) WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = OLD.einsatz_id);
END;
CREATE TRIGGER person_verbleib_spiegelschutz_i BEFORE INSERT ON person_verbleib WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = NEW.einsatz_id) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
CREATE TRIGGER person_verbleib_spiegelschutz_u BEFORE UPDATE ON person_verbleib WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND (EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = OLD.einsatz_id) OR EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = NEW.einsatz_id)) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
CREATE TRIGGER person_verbleib_spiegelschutz_d BEFORE DELETE ON person_verbleib WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = OLD.einsatz_id) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
-- person_uhs_belegung
CREATE TRIGGER person_uhs_belegung_spiegellog_i AFTER INSERT ON person_uhs_belegung WHEN EXISTS (SELECT 1 FROM einsatz WHERE id = NEW.einsatz_id) BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'person_uhs_belegung' AND schluessel = CAST(NEW.id AS TEXT);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) VALUES (NEW.einsatz_id, 'person_uhs_belegung', CAST(NEW.id AS TEXT));
END;
CREATE TRIGGER person_uhs_belegung_spiegellog_u AFTER UPDATE ON person_uhs_belegung BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'person_uhs_belegung' AND schluessel IN (CAST(OLD.id AS TEXT), CAST(NEW.id AS TEXT));
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT OLD.einsatz_id, 'person_uhs_belegung', CAST(OLD.id AS TEXT) WHERE CAST(OLD.id AS TEXT) IS NOT CAST(NEW.id AS TEXT) AND EXISTS (SELECT 1 FROM einsatz WHERE id = OLD.einsatz_id);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT NEW.einsatz_id, 'person_uhs_belegung', CAST(NEW.id AS TEXT) WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = NEW.einsatz_id);
END;
CREATE TRIGGER person_uhs_belegung_spiegellog_d AFTER DELETE ON person_uhs_belegung BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'person_uhs_belegung' AND schluessel = CAST(OLD.id AS TEXT);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT OLD.einsatz_id, 'person_uhs_belegung', CAST(OLD.id AS TEXT) WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = OLD.einsatz_id);
END;
CREATE TRIGGER person_uhs_belegung_spiegelschutz_i BEFORE INSERT ON person_uhs_belegung WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = NEW.einsatz_id) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
CREATE TRIGGER person_uhs_belegung_spiegelschutz_u BEFORE UPDATE ON person_uhs_belegung WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND (EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = OLD.einsatz_id) OR EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = NEW.einsatz_id)) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
CREATE TRIGGER person_uhs_belegung_spiegelschutz_d BEFORE DELETE ON person_uhs_belegung WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = OLD.einsatz_id) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
-- person_abgleich
CREATE TRIGGER person_abgleich_spiegellog_i AFTER INSERT ON person_abgleich WHEN EXISTS (SELECT 1 FROM einsatz WHERE id = NEW.einsatz_id) BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'person_abgleich' AND schluessel = CAST(NEW.id AS TEXT);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) VALUES (NEW.einsatz_id, 'person_abgleich', CAST(NEW.id AS TEXT));
END;
CREATE TRIGGER person_abgleich_spiegellog_u AFTER UPDATE ON person_abgleich BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'person_abgleich' AND schluessel IN (CAST(OLD.id AS TEXT), CAST(NEW.id AS TEXT));
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT OLD.einsatz_id, 'person_abgleich', CAST(OLD.id AS TEXT) WHERE CAST(OLD.id AS TEXT) IS NOT CAST(NEW.id AS TEXT) AND EXISTS (SELECT 1 FROM einsatz WHERE id = OLD.einsatz_id);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT NEW.einsatz_id, 'person_abgleich', CAST(NEW.id AS TEXT) WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = NEW.einsatz_id);
END;
CREATE TRIGGER person_abgleich_spiegellog_d AFTER DELETE ON person_abgleich BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'person_abgleich' AND schluessel = CAST(OLD.id AS TEXT);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT OLD.einsatz_id, 'person_abgleich', CAST(OLD.id AS TEXT) WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = OLD.einsatz_id);
END;
CREATE TRIGGER person_abgleich_spiegelschutz_i BEFORE INSERT ON person_abgleich WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = NEW.einsatz_id) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
CREATE TRIGGER person_abgleich_spiegelschutz_u BEFORE UPDATE ON person_abgleich WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND (EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = OLD.einsatz_id) OR EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = NEW.einsatz_id)) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
CREATE TRIGGER person_abgleich_spiegelschutz_d BEFORE DELETE ON person_abgleich WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = OLD.einsatz_id) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
-- uhs
CREATE TRIGGER uhs_spiegellog_i AFTER INSERT ON uhs WHEN EXISTS (SELECT 1 FROM einsatz WHERE id = NEW.einsatz_id) BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'uhs' AND schluessel = CAST(NEW.id AS TEXT);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) VALUES (NEW.einsatz_id, 'uhs', CAST(NEW.id AS TEXT));
END;
CREATE TRIGGER uhs_spiegellog_u AFTER UPDATE ON uhs BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'uhs' AND schluessel IN (CAST(OLD.id AS TEXT), CAST(NEW.id AS TEXT));
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT OLD.einsatz_id, 'uhs', CAST(OLD.id AS TEXT) WHERE CAST(OLD.id AS TEXT) IS NOT CAST(NEW.id AS TEXT) AND EXISTS (SELECT 1 FROM einsatz WHERE id = OLD.einsatz_id);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT NEW.einsatz_id, 'uhs', CAST(NEW.id AS TEXT) WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = NEW.einsatz_id);
END;
CREATE TRIGGER uhs_spiegellog_d AFTER DELETE ON uhs BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'uhs' AND schluessel = CAST(OLD.id AS TEXT);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT OLD.einsatz_id, 'uhs', CAST(OLD.id AS TEXT) WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = OLD.einsatz_id);
END;
CREATE TRIGGER uhs_spiegelschutz_i BEFORE INSERT ON uhs WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = NEW.einsatz_id) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
CREATE TRIGGER uhs_spiegelschutz_u BEFORE UPDATE ON uhs WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND (EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = OLD.einsatz_id) OR EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = NEW.einsatz_id)) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
CREATE TRIGGER uhs_spiegelschutz_d BEFORE DELETE ON uhs WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = OLD.einsatz_id) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
-- uhs_platz
CREATE TRIGGER uhs_platz_spiegellog_i AFTER INSERT ON uhs_platz WHEN EXISTS (SELECT 1 FROM einsatz WHERE id = (SELECT einsatz_id FROM uhs WHERE id = NEW.uhs_id)) BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'uhs_platz' AND schluessel = CAST(NEW.id AS TEXT);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) VALUES ((SELECT einsatz_id FROM uhs WHERE id = NEW.uhs_id), 'uhs_platz', CAST(NEW.id AS TEXT));
END;
CREATE TRIGGER uhs_platz_spiegellog_u AFTER UPDATE ON uhs_platz BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'uhs_platz' AND schluessel IN (CAST(OLD.id AS TEXT), CAST(NEW.id AS TEXT));
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT (SELECT einsatz_id FROM uhs WHERE id = OLD.uhs_id), 'uhs_platz', CAST(OLD.id AS TEXT) WHERE CAST(OLD.id AS TEXT) IS NOT CAST(NEW.id AS TEXT) AND EXISTS (SELECT 1 FROM einsatz WHERE id = (SELECT einsatz_id FROM uhs WHERE id = OLD.uhs_id));
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT (SELECT einsatz_id FROM uhs WHERE id = NEW.uhs_id), 'uhs_platz', CAST(NEW.id AS TEXT) WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = (SELECT einsatz_id FROM uhs WHERE id = NEW.uhs_id));
END;
CREATE TRIGGER uhs_platz_spiegellog_d AFTER DELETE ON uhs_platz BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'uhs_platz' AND schluessel = CAST(OLD.id AS TEXT);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT (SELECT einsatz_id FROM uhs WHERE id = OLD.uhs_id), 'uhs_platz', CAST(OLD.id AS TEXT) WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = (SELECT einsatz_id FROM uhs WHERE id = OLD.uhs_id));
END;
CREATE TRIGGER uhs_platz_spiegelschutz_i BEFORE INSERT ON uhs_platz WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = (SELECT einsatz_id FROM uhs WHERE id = NEW.uhs_id)) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
CREATE TRIGGER uhs_platz_spiegelschutz_u BEFORE UPDATE ON uhs_platz WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND (EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = (SELECT einsatz_id FROM uhs WHERE id = OLD.uhs_id)) OR EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = (SELECT einsatz_id FROM uhs WHERE id = NEW.uhs_id))) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
CREATE TRIGGER uhs_platz_spiegelschutz_d BEFORE DELETE ON uhs_platz WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = (SELECT einsatz_id FROM uhs WHERE id = OLD.uhs_id)) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
-- evakuierungsbezirk
CREATE TRIGGER evakuierungsbezirk_spiegellog_i AFTER INSERT ON evakuierungsbezirk WHEN EXISTS (SELECT 1 FROM einsatz WHERE id = NEW.einsatz_id) BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'evakuierungsbezirk' AND schluessel = CAST(NEW.id AS TEXT);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) VALUES (NEW.einsatz_id, 'evakuierungsbezirk', CAST(NEW.id AS TEXT));
END;
CREATE TRIGGER evakuierungsbezirk_spiegellog_u AFTER UPDATE ON evakuierungsbezirk BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'evakuierungsbezirk' AND schluessel IN (CAST(OLD.id AS TEXT), CAST(NEW.id AS TEXT));
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT OLD.einsatz_id, 'evakuierungsbezirk', CAST(OLD.id AS TEXT) WHERE CAST(OLD.id AS TEXT) IS NOT CAST(NEW.id AS TEXT) AND EXISTS (SELECT 1 FROM einsatz WHERE id = OLD.einsatz_id);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT NEW.einsatz_id, 'evakuierungsbezirk', CAST(NEW.id AS TEXT) WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = NEW.einsatz_id);
END;
CREATE TRIGGER evakuierungsbezirk_spiegellog_d AFTER DELETE ON evakuierungsbezirk BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'evakuierungsbezirk' AND schluessel = CAST(OLD.id AS TEXT);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT OLD.einsatz_id, 'evakuierungsbezirk', CAST(OLD.id AS TEXT) WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = OLD.einsatz_id);
END;
CREATE TRIGGER evakuierungsbezirk_spiegelschutz_i BEFORE INSERT ON evakuierungsbezirk WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = NEW.einsatz_id) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
CREATE TRIGGER evakuierungsbezirk_spiegelschutz_u BEFORE UPDATE ON evakuierungsbezirk WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND (EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = OLD.einsatz_id) OR EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = NEW.einsatz_id)) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
CREATE TRIGGER evakuierungsbezirk_spiegelschutz_d BEFORE DELETE ON evakuierungsbezirk WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = OLD.einsatz_id) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
-- evakuierung_stand
CREATE TRIGGER evakuierung_stand_spiegellog_i AFTER INSERT ON evakuierung_stand WHEN EXISTS (SELECT 1 FROM einsatz WHERE id = NEW.einsatz_id) BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'evakuierung_stand' AND schluessel = CAST(NEW.id AS TEXT);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) VALUES (NEW.einsatz_id, 'evakuierung_stand', CAST(NEW.id AS TEXT));
END;
CREATE TRIGGER evakuierung_stand_spiegellog_u AFTER UPDATE ON evakuierung_stand BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'evakuierung_stand' AND schluessel IN (CAST(OLD.id AS TEXT), CAST(NEW.id AS TEXT));
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT OLD.einsatz_id, 'evakuierung_stand', CAST(OLD.id AS TEXT) WHERE CAST(OLD.id AS TEXT) IS NOT CAST(NEW.id AS TEXT) AND EXISTS (SELECT 1 FROM einsatz WHERE id = OLD.einsatz_id);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT NEW.einsatz_id, 'evakuierung_stand', CAST(NEW.id AS TEXT) WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = NEW.einsatz_id);
END;
CREATE TRIGGER evakuierung_stand_spiegellog_d AFTER DELETE ON evakuierung_stand BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'evakuierung_stand' AND schluessel = CAST(OLD.id AS TEXT);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT OLD.einsatz_id, 'evakuierung_stand', CAST(OLD.id AS TEXT) WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = OLD.einsatz_id);
END;
CREATE TRIGGER evakuierung_stand_spiegelschutz_i BEFORE INSERT ON evakuierung_stand WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = NEW.einsatz_id) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
CREATE TRIGGER evakuierung_stand_spiegelschutz_u BEFORE UPDATE ON evakuierung_stand WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND (EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = OLD.einsatz_id) OR EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = NEW.einsatz_id)) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
CREATE TRIGGER evakuierung_stand_spiegelschutz_d BEFORE DELETE ON evakuierung_stand WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = OLD.einsatz_id) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
-- haushalt
CREATE TRIGGER haushalt_spiegellog_i AFTER INSERT ON haushalt WHEN EXISTS (SELECT 1 FROM einsatz WHERE id = NEW.einsatz_id) BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'haushalt' AND schluessel = CAST(NEW.id AS TEXT);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) VALUES (NEW.einsatz_id, 'haushalt', CAST(NEW.id AS TEXT));
END;
CREATE TRIGGER haushalt_spiegellog_u AFTER UPDATE ON haushalt BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'haushalt' AND schluessel IN (CAST(OLD.id AS TEXT), CAST(NEW.id AS TEXT));
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT OLD.einsatz_id, 'haushalt', CAST(OLD.id AS TEXT) WHERE CAST(OLD.id AS TEXT) IS NOT CAST(NEW.id AS TEXT) AND EXISTS (SELECT 1 FROM einsatz WHERE id = OLD.einsatz_id);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT NEW.einsatz_id, 'haushalt', CAST(NEW.id AS TEXT) WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = NEW.einsatz_id);
END;
CREATE TRIGGER haushalt_spiegellog_d AFTER DELETE ON haushalt BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'haushalt' AND schluessel = CAST(OLD.id AS TEXT);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT OLD.einsatz_id, 'haushalt', CAST(OLD.id AS TEXT) WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = OLD.einsatz_id);
END;
CREATE TRIGGER haushalt_spiegelschutz_i BEFORE INSERT ON haushalt WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = NEW.einsatz_id) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
CREATE TRIGGER haushalt_spiegelschutz_u BEFORE UPDATE ON haushalt WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND (EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = OLD.einsatz_id) OR EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = NEW.einsatz_id)) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
CREATE TRIGGER haushalt_spiegelschutz_d BEFORE DELETE ON haushalt WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = OLD.einsatz_id) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
-- betreuungsstelle
CREATE TRIGGER betreuungsstelle_spiegellog_i AFTER INSERT ON betreuungsstelle WHEN EXISTS (SELECT 1 FROM einsatz WHERE id = NEW.einsatz_id) BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'betreuungsstelle' AND schluessel = CAST(NEW.id AS TEXT);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) VALUES (NEW.einsatz_id, 'betreuungsstelle', CAST(NEW.id AS TEXT));
END;
CREATE TRIGGER betreuungsstelle_spiegellog_u AFTER UPDATE ON betreuungsstelle BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'betreuungsstelle' AND schluessel IN (CAST(OLD.id AS TEXT), CAST(NEW.id AS TEXT));
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT OLD.einsatz_id, 'betreuungsstelle', CAST(OLD.id AS TEXT) WHERE CAST(OLD.id AS TEXT) IS NOT CAST(NEW.id AS TEXT) AND EXISTS (SELECT 1 FROM einsatz WHERE id = OLD.einsatz_id);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT NEW.einsatz_id, 'betreuungsstelle', CAST(NEW.id AS TEXT) WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = NEW.einsatz_id);
END;
CREATE TRIGGER betreuungsstelle_spiegellog_d AFTER DELETE ON betreuungsstelle BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'betreuungsstelle' AND schluessel = CAST(OLD.id AS TEXT);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT OLD.einsatz_id, 'betreuungsstelle', CAST(OLD.id AS TEXT) WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = OLD.einsatz_id);
END;
CREATE TRIGGER betreuungsstelle_spiegelschutz_i BEFORE INSERT ON betreuungsstelle WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = NEW.einsatz_id) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
CREATE TRIGGER betreuungsstelle_spiegelschutz_u BEFORE UPDATE ON betreuungsstelle WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND (EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = OLD.einsatz_id) OR EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = NEW.einsatz_id)) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
CREATE TRIGGER betreuungsstelle_spiegelschutz_d BEFORE DELETE ON betreuungsstelle WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = OLD.einsatz_id) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
-- betreuungsstelle_belegung
CREATE TRIGGER betreuungsstelle_belegung_spiegellog_i AFTER INSERT ON betreuungsstelle_belegung WHEN EXISTS (SELECT 1 FROM einsatz WHERE id = NEW.einsatz_id) BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'betreuungsstelle_belegung' AND schluessel = CAST(NEW.id AS TEXT);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) VALUES (NEW.einsatz_id, 'betreuungsstelle_belegung', CAST(NEW.id AS TEXT));
END;
CREATE TRIGGER betreuungsstelle_belegung_spiegellog_u AFTER UPDATE ON betreuungsstelle_belegung BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'betreuungsstelle_belegung' AND schluessel IN (CAST(OLD.id AS TEXT), CAST(NEW.id AS TEXT));
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT OLD.einsatz_id, 'betreuungsstelle_belegung', CAST(OLD.id AS TEXT) WHERE CAST(OLD.id AS TEXT) IS NOT CAST(NEW.id AS TEXT) AND EXISTS (SELECT 1 FROM einsatz WHERE id = OLD.einsatz_id);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT NEW.einsatz_id, 'betreuungsstelle_belegung', CAST(NEW.id AS TEXT) WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = NEW.einsatz_id);
END;
CREATE TRIGGER betreuungsstelle_belegung_spiegellog_d AFTER DELETE ON betreuungsstelle_belegung BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'betreuungsstelle_belegung' AND schluessel = CAST(OLD.id AS TEXT);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT OLD.einsatz_id, 'betreuungsstelle_belegung', CAST(OLD.id AS TEXT) WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = OLD.einsatz_id);
END;
CREATE TRIGGER betreuungsstelle_belegung_spiegelschutz_i BEFORE INSERT ON betreuungsstelle_belegung WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = NEW.einsatz_id) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
CREATE TRIGGER betreuungsstelle_belegung_spiegelschutz_u BEFORE UPDATE ON betreuungsstelle_belegung WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND (EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = OLD.einsatz_id) OR EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = NEW.einsatz_id)) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
CREATE TRIGGER betreuungsstelle_belegung_spiegelschutz_d BEFORE DELETE ON betreuungsstelle_belegung WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = OLD.einsatz_id) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
-- verpflegung_zeitfenster
CREATE TRIGGER verpflegung_zeitfenster_spiegellog_i AFTER INSERT ON verpflegung_zeitfenster WHEN EXISTS (SELECT 1 FROM einsatz WHERE id = NEW.einsatz_id) BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'verpflegung_zeitfenster' AND schluessel = CAST(NEW.id AS TEXT);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) VALUES (NEW.einsatz_id, 'verpflegung_zeitfenster', CAST(NEW.id AS TEXT));
END;
CREATE TRIGGER verpflegung_zeitfenster_spiegellog_u AFTER UPDATE ON verpflegung_zeitfenster BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'verpflegung_zeitfenster' AND schluessel IN (CAST(OLD.id AS TEXT), CAST(NEW.id AS TEXT));
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT OLD.einsatz_id, 'verpflegung_zeitfenster', CAST(OLD.id AS TEXT) WHERE CAST(OLD.id AS TEXT) IS NOT CAST(NEW.id AS TEXT) AND EXISTS (SELECT 1 FROM einsatz WHERE id = OLD.einsatz_id);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT NEW.einsatz_id, 'verpflegung_zeitfenster', CAST(NEW.id AS TEXT) WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = NEW.einsatz_id);
END;
CREATE TRIGGER verpflegung_zeitfenster_spiegellog_d AFTER DELETE ON verpflegung_zeitfenster BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'verpflegung_zeitfenster' AND schluessel = CAST(OLD.id AS TEXT);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT OLD.einsatz_id, 'verpflegung_zeitfenster', CAST(OLD.id AS TEXT) WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = OLD.einsatz_id);
END;
CREATE TRIGGER verpflegung_zeitfenster_spiegelschutz_i BEFORE INSERT ON verpflegung_zeitfenster WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = NEW.einsatz_id) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
CREATE TRIGGER verpflegung_zeitfenster_spiegelschutz_u BEFORE UPDATE ON verpflegung_zeitfenster WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND (EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = OLD.einsatz_id) OR EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = NEW.einsatz_id)) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
CREATE TRIGGER verpflegung_zeitfenster_spiegelschutz_d BEFORE DELETE ON verpflegung_zeitfenster WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = OLD.einsatz_id) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
-- verpflegungsstelle
CREATE TRIGGER verpflegungsstelle_spiegellog_i AFTER INSERT ON verpflegungsstelle WHEN EXISTS (SELECT 1 FROM einsatz WHERE id = NEW.einsatz_id) BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'verpflegungsstelle' AND schluessel = CAST(NEW.id AS TEXT);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) VALUES (NEW.einsatz_id, 'verpflegungsstelle', CAST(NEW.id AS TEXT));
END;
CREATE TRIGGER verpflegungsstelle_spiegellog_u AFTER UPDATE ON verpflegungsstelle BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'verpflegungsstelle' AND schluessel IN (CAST(OLD.id AS TEXT), CAST(NEW.id AS TEXT));
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT OLD.einsatz_id, 'verpflegungsstelle', CAST(OLD.id AS TEXT) WHERE CAST(OLD.id AS TEXT) IS NOT CAST(NEW.id AS TEXT) AND EXISTS (SELECT 1 FROM einsatz WHERE id = OLD.einsatz_id);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT NEW.einsatz_id, 'verpflegungsstelle', CAST(NEW.id AS TEXT) WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = NEW.einsatz_id);
END;
CREATE TRIGGER verpflegungsstelle_spiegellog_d AFTER DELETE ON verpflegungsstelle BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'verpflegungsstelle' AND schluessel = CAST(OLD.id AS TEXT);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT OLD.einsatz_id, 'verpflegungsstelle', CAST(OLD.id AS TEXT) WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = OLD.einsatz_id);
END;
CREATE TRIGGER verpflegungsstelle_spiegelschutz_i BEFORE INSERT ON verpflegungsstelle WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = NEW.einsatz_id) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
CREATE TRIGGER verpflegungsstelle_spiegelschutz_u BEFORE UPDATE ON verpflegungsstelle WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND (EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = OLD.einsatz_id) OR EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = NEW.einsatz_id)) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
CREATE TRIGGER verpflegungsstelle_spiegelschutz_d BEFORE DELETE ON verpflegungsstelle WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = OLD.einsatz_id) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
-- verpflegung_zeitfenster_stelle
CREATE TRIGGER verpflegung_zeitfenster_stelle_spiegellog_i AFTER INSERT ON verpflegung_zeitfenster_stelle WHEN EXISTS (SELECT 1 FROM einsatz WHERE id = NEW.einsatz_id) BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'verpflegung_zeitfenster_stelle' AND schluessel = json_array(NEW.zeitfenster_id, NEW.stelle_id);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) VALUES (NEW.einsatz_id, 'verpflegung_zeitfenster_stelle', json_array(NEW.zeitfenster_id, NEW.stelle_id));
END;
CREATE TRIGGER verpflegung_zeitfenster_stelle_spiegellog_u AFTER UPDATE ON verpflegung_zeitfenster_stelle BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'verpflegung_zeitfenster_stelle' AND schluessel IN (json_array(OLD.zeitfenster_id, OLD.stelle_id), json_array(NEW.zeitfenster_id, NEW.stelle_id));
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT OLD.einsatz_id, 'verpflegung_zeitfenster_stelle', json_array(OLD.zeitfenster_id, OLD.stelle_id) WHERE json_array(OLD.zeitfenster_id, OLD.stelle_id) IS NOT json_array(NEW.zeitfenster_id, NEW.stelle_id) AND EXISTS (SELECT 1 FROM einsatz WHERE id = OLD.einsatz_id);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT NEW.einsatz_id, 'verpflegung_zeitfenster_stelle', json_array(NEW.zeitfenster_id, NEW.stelle_id) WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = NEW.einsatz_id);
END;
CREATE TRIGGER verpflegung_zeitfenster_stelle_spiegellog_d AFTER DELETE ON verpflegung_zeitfenster_stelle BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'verpflegung_zeitfenster_stelle' AND schluessel = json_array(OLD.zeitfenster_id, OLD.stelle_id);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT OLD.einsatz_id, 'verpflegung_zeitfenster_stelle', json_array(OLD.zeitfenster_id, OLD.stelle_id) WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = OLD.einsatz_id);
END;
CREATE TRIGGER verpflegung_zeitfenster_stelle_spiegelschutz_i BEFORE INSERT ON verpflegung_zeitfenster_stelle WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = NEW.einsatz_id) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
CREATE TRIGGER verpflegung_zeitfenster_stelle_spiegelschutz_u BEFORE UPDATE ON verpflegung_zeitfenster_stelle WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND (EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = OLD.einsatz_id) OR EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = NEW.einsatz_id)) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
CREATE TRIGGER verpflegung_zeitfenster_stelle_spiegelschutz_d BEFORE DELETE ON verpflegung_zeitfenster_stelle WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = OLD.einsatz_id) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
-- verpflegung_ausgabe
CREATE TRIGGER verpflegung_ausgabe_spiegellog_i AFTER INSERT ON verpflegung_ausgabe WHEN EXISTS (SELECT 1 FROM einsatz WHERE id = NEW.einsatz_id) BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'verpflegung_ausgabe' AND schluessel = CAST(NEW.id AS TEXT);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) VALUES (NEW.einsatz_id, 'verpflegung_ausgabe', CAST(NEW.id AS TEXT));
END;
CREATE TRIGGER verpflegung_ausgabe_spiegellog_u AFTER UPDATE ON verpflegung_ausgabe BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'verpflegung_ausgabe' AND schluessel IN (CAST(OLD.id AS TEXT), CAST(NEW.id AS TEXT));
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT OLD.einsatz_id, 'verpflegung_ausgabe', CAST(OLD.id AS TEXT) WHERE CAST(OLD.id AS TEXT) IS NOT CAST(NEW.id AS TEXT) AND EXISTS (SELECT 1 FROM einsatz WHERE id = OLD.einsatz_id);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT NEW.einsatz_id, 'verpflegung_ausgabe', CAST(NEW.id AS TEXT) WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = NEW.einsatz_id);
END;
CREATE TRIGGER verpflegung_ausgabe_spiegellog_d AFTER DELETE ON verpflegung_ausgabe BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'verpflegung_ausgabe' AND schluessel = CAST(OLD.id AS TEXT);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT OLD.einsatz_id, 'verpflegung_ausgabe', CAST(OLD.id AS TEXT) WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = OLD.einsatz_id);
END;
CREATE TRIGGER verpflegung_ausgabe_spiegelschutz_i BEFORE INSERT ON verpflegung_ausgabe WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = NEW.einsatz_id) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
CREATE TRIGGER verpflegung_ausgabe_spiegelschutz_u BEFORE UPDATE ON verpflegung_ausgabe WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND (EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = OLD.einsatz_id) OR EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = NEW.einsatz_id)) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
CREATE TRIGGER verpflegung_ausgabe_spiegelschutz_d BEFORE DELETE ON verpflegung_ausgabe WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = OLD.einsatz_id) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
-- einsatz_unterkunft_richtwert
CREATE TRIGGER einsatz_unterkunft_richtwert_spiegellog_i AFTER INSERT ON einsatz_unterkunft_richtwert WHEN EXISTS (SELECT 1 FROM einsatz WHERE id = NEW.einsatz_id) BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'einsatz_unterkunft_richtwert' AND schluessel = json_array(NEW.einsatz_id, NEW.schluessel);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) VALUES (NEW.einsatz_id, 'einsatz_unterkunft_richtwert', json_array(NEW.einsatz_id, NEW.schluessel));
END;
CREATE TRIGGER einsatz_unterkunft_richtwert_spiegellog_u AFTER UPDATE ON einsatz_unterkunft_richtwert BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'einsatz_unterkunft_richtwert' AND schluessel IN (json_array(OLD.einsatz_id, OLD.schluessel), json_array(NEW.einsatz_id, NEW.schluessel));
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT OLD.einsatz_id, 'einsatz_unterkunft_richtwert', json_array(OLD.einsatz_id, OLD.schluessel) WHERE json_array(OLD.einsatz_id, OLD.schluessel) IS NOT json_array(NEW.einsatz_id, NEW.schluessel) AND EXISTS (SELECT 1 FROM einsatz WHERE id = OLD.einsatz_id);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT NEW.einsatz_id, 'einsatz_unterkunft_richtwert', json_array(NEW.einsatz_id, NEW.schluessel) WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = NEW.einsatz_id);
END;
CREATE TRIGGER einsatz_unterkunft_richtwert_spiegellog_d AFTER DELETE ON einsatz_unterkunft_richtwert BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'einsatz_unterkunft_richtwert' AND schluessel = json_array(OLD.einsatz_id, OLD.schluessel);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT OLD.einsatz_id, 'einsatz_unterkunft_richtwert', json_array(OLD.einsatz_id, OLD.schluessel) WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = OLD.einsatz_id);
END;
CREATE TRIGGER einsatz_unterkunft_richtwert_spiegelschutz_i BEFORE INSERT ON einsatz_unterkunft_richtwert WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = NEW.einsatz_id) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
CREATE TRIGGER einsatz_unterkunft_richtwert_spiegelschutz_u BEFORE UPDATE ON einsatz_unterkunft_richtwert WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND (EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = OLD.einsatz_id) OR EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = NEW.einsatz_id)) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
CREATE TRIGGER einsatz_unterkunft_richtwert_spiegelschutz_d BEFORE DELETE ON einsatz_unterkunft_richtwert WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = OLD.einsatz_id) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
-- meldung
CREATE TRIGGER meldung_spiegellog_i AFTER INSERT ON meldung WHEN EXISTS (SELECT 1 FROM einsatz WHERE id = NEW.einsatz_id) BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'meldung' AND schluessel = CAST(NEW.id AS TEXT);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) VALUES (NEW.einsatz_id, 'meldung', CAST(NEW.id AS TEXT));
END;
CREATE TRIGGER meldung_spiegellog_u AFTER UPDATE ON meldung BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'meldung' AND schluessel IN (CAST(OLD.id AS TEXT), CAST(NEW.id AS TEXT));
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT OLD.einsatz_id, 'meldung', CAST(OLD.id AS TEXT) WHERE CAST(OLD.id AS TEXT) IS NOT CAST(NEW.id AS TEXT) AND EXISTS (SELECT 1 FROM einsatz WHERE id = OLD.einsatz_id);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT NEW.einsatz_id, 'meldung', CAST(NEW.id AS TEXT) WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = NEW.einsatz_id);
END;
CREATE TRIGGER meldung_spiegellog_d AFTER DELETE ON meldung BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'meldung' AND schluessel = CAST(OLD.id AS TEXT);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT OLD.einsatz_id, 'meldung', CAST(OLD.id AS TEXT) WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = OLD.einsatz_id);
END;
CREATE TRIGGER meldung_spiegelschutz_i BEFORE INSERT ON meldung WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = NEW.einsatz_id) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
CREATE TRIGGER meldung_spiegelschutz_u BEFORE UPDATE ON meldung WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND (EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = OLD.einsatz_id) OR EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = NEW.einsatz_id)) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
CREATE TRIGGER meldung_spiegelschutz_d BEFORE DELETE ON meldung WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = OLD.einsatz_id) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
-- auftrag
CREATE TRIGGER auftrag_spiegellog_i AFTER INSERT ON auftrag WHEN EXISTS (SELECT 1 FROM einsatz WHERE id = NEW.einsatz_id) BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'auftrag' AND schluessel = CAST(NEW.id AS TEXT);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) VALUES (NEW.einsatz_id, 'auftrag', CAST(NEW.id AS TEXT));
END;
CREATE TRIGGER auftrag_spiegellog_u AFTER UPDATE ON auftrag BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'auftrag' AND schluessel IN (CAST(OLD.id AS TEXT), CAST(NEW.id AS TEXT));
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT OLD.einsatz_id, 'auftrag', CAST(OLD.id AS TEXT) WHERE CAST(OLD.id AS TEXT) IS NOT CAST(NEW.id AS TEXT) AND EXISTS (SELECT 1 FROM einsatz WHERE id = OLD.einsatz_id);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT NEW.einsatz_id, 'auftrag', CAST(NEW.id AS TEXT) WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = NEW.einsatz_id);
END;
CREATE TRIGGER auftrag_spiegellog_d AFTER DELETE ON auftrag BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'auftrag' AND schluessel = CAST(OLD.id AS TEXT);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT OLD.einsatz_id, 'auftrag', CAST(OLD.id AS TEXT) WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = OLD.einsatz_id);
END;
CREATE TRIGGER auftrag_spiegelschutz_i BEFORE INSERT ON auftrag WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = NEW.einsatz_id) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
CREATE TRIGGER auftrag_spiegelschutz_u BEFORE UPDATE ON auftrag WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND (EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = OLD.einsatz_id) OR EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = NEW.einsatz_id)) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
CREATE TRIGGER auftrag_spiegelschutz_d BEFORE DELETE ON auftrag WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = OLD.einsatz_id) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
-- auftrag_empfaenger
CREATE TRIGGER auftrag_empfaenger_spiegellog_i AFTER INSERT ON auftrag_empfaenger WHEN EXISTS (SELECT 1 FROM einsatz WHERE id = (SELECT einsatz_id FROM auftrag WHERE id = NEW.auftrag_id)) BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'auftrag_empfaenger' AND schluessel = CAST(NEW.id AS TEXT);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) VALUES ((SELECT einsatz_id FROM auftrag WHERE id = NEW.auftrag_id), 'auftrag_empfaenger', CAST(NEW.id AS TEXT));
END;
CREATE TRIGGER auftrag_empfaenger_spiegellog_u AFTER UPDATE ON auftrag_empfaenger BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'auftrag_empfaenger' AND schluessel IN (CAST(OLD.id AS TEXT), CAST(NEW.id AS TEXT));
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT (SELECT einsatz_id FROM auftrag WHERE id = OLD.auftrag_id), 'auftrag_empfaenger', CAST(OLD.id AS TEXT) WHERE CAST(OLD.id AS TEXT) IS NOT CAST(NEW.id AS TEXT) AND EXISTS (SELECT 1 FROM einsatz WHERE id = (SELECT einsatz_id FROM auftrag WHERE id = OLD.auftrag_id));
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT (SELECT einsatz_id FROM auftrag WHERE id = NEW.auftrag_id), 'auftrag_empfaenger', CAST(NEW.id AS TEXT) WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = (SELECT einsatz_id FROM auftrag WHERE id = NEW.auftrag_id));
END;
CREATE TRIGGER auftrag_empfaenger_spiegellog_d AFTER DELETE ON auftrag_empfaenger BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'auftrag_empfaenger' AND schluessel = CAST(OLD.id AS TEXT);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT (SELECT einsatz_id FROM auftrag WHERE id = OLD.auftrag_id), 'auftrag_empfaenger', CAST(OLD.id AS TEXT) WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = (SELECT einsatz_id FROM auftrag WHERE id = OLD.auftrag_id));
END;
CREATE TRIGGER auftrag_empfaenger_spiegelschutz_i BEFORE INSERT ON auftrag_empfaenger WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = (SELECT einsatz_id FROM auftrag WHERE id = NEW.auftrag_id)) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
CREATE TRIGGER auftrag_empfaenger_spiegelschutz_u BEFORE UPDATE ON auftrag_empfaenger WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND (EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = (SELECT einsatz_id FROM auftrag WHERE id = OLD.auftrag_id)) OR EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = (SELECT einsatz_id FROM auftrag WHERE id = NEW.auftrag_id))) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
CREATE TRIGGER auftrag_empfaenger_spiegelschutz_d BEFORE DELETE ON auftrag_empfaenger WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = (SELECT einsatz_id FROM auftrag WHERE id = OLD.auftrag_id)) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
-- befehl
CREATE TRIGGER befehl_spiegellog_i AFTER INSERT ON befehl WHEN EXISTS (SELECT 1 FROM einsatz WHERE id = NEW.einsatz_id) BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'befehl' AND schluessel = CAST(NEW.id AS TEXT);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) VALUES (NEW.einsatz_id, 'befehl', CAST(NEW.id AS TEXT));
END;
CREATE TRIGGER befehl_spiegellog_u AFTER UPDATE ON befehl BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'befehl' AND schluessel IN (CAST(OLD.id AS TEXT), CAST(NEW.id AS TEXT));
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT OLD.einsatz_id, 'befehl', CAST(OLD.id AS TEXT) WHERE CAST(OLD.id AS TEXT) IS NOT CAST(NEW.id AS TEXT) AND EXISTS (SELECT 1 FROM einsatz WHERE id = OLD.einsatz_id);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT NEW.einsatz_id, 'befehl', CAST(NEW.id AS TEXT) WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = NEW.einsatz_id);
END;
CREATE TRIGGER befehl_spiegellog_d AFTER DELETE ON befehl BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'befehl' AND schluessel = CAST(OLD.id AS TEXT);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT OLD.einsatz_id, 'befehl', CAST(OLD.id AS TEXT) WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = OLD.einsatz_id);
END;
CREATE TRIGGER befehl_spiegelschutz_i BEFORE INSERT ON befehl WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = NEW.einsatz_id) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
CREATE TRIGGER befehl_spiegelschutz_u BEFORE UPDATE ON befehl WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND (EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = OLD.einsatz_id) OR EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = NEW.einsatz_id)) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
CREATE TRIGGER befehl_spiegelschutz_d BEFORE DELETE ON befehl WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = OLD.einsatz_id) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
-- befehl_verteiler
CREATE TRIGGER befehl_verteiler_spiegellog_i AFTER INSERT ON befehl_verteiler WHEN EXISTS (SELECT 1 FROM einsatz WHERE id = NEW.einsatz_id) BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'befehl_verteiler' AND schluessel = CAST(NEW.id AS TEXT);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) VALUES (NEW.einsatz_id, 'befehl_verteiler', CAST(NEW.id AS TEXT));
END;
CREATE TRIGGER befehl_verteiler_spiegellog_u AFTER UPDATE ON befehl_verteiler BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'befehl_verteiler' AND schluessel IN (CAST(OLD.id AS TEXT), CAST(NEW.id AS TEXT));
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT OLD.einsatz_id, 'befehl_verteiler', CAST(OLD.id AS TEXT) WHERE CAST(OLD.id AS TEXT) IS NOT CAST(NEW.id AS TEXT) AND EXISTS (SELECT 1 FROM einsatz WHERE id = OLD.einsatz_id);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT NEW.einsatz_id, 'befehl_verteiler', CAST(NEW.id AS TEXT) WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = NEW.einsatz_id);
END;
CREATE TRIGGER befehl_verteiler_spiegellog_d AFTER DELETE ON befehl_verteiler BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'befehl_verteiler' AND schluessel = CAST(OLD.id AS TEXT);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT OLD.einsatz_id, 'befehl_verteiler', CAST(OLD.id AS TEXT) WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = OLD.einsatz_id);
END;
CREATE TRIGGER befehl_verteiler_spiegelschutz_i BEFORE INSERT ON befehl_verteiler WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = NEW.einsatz_id) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
CREATE TRIGGER befehl_verteiler_spiegelschutz_u BEFORE UPDATE ON befehl_verteiler WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND (EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = OLD.einsatz_id) OR EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = NEW.einsatz_id)) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
CREATE TRIGGER befehl_verteiler_spiegelschutz_d BEFORE DELETE ON befehl_verteiler WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = OLD.einsatz_id) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
-- lagebericht
CREATE TRIGGER lagebericht_spiegellog_i AFTER INSERT ON lagebericht WHEN EXISTS (SELECT 1 FROM einsatz WHERE id = NEW.einsatz_id) BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'lagebericht' AND schluessel = CAST(NEW.id AS TEXT);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) VALUES (NEW.einsatz_id, 'lagebericht', CAST(NEW.id AS TEXT));
END;
CREATE TRIGGER lagebericht_spiegellog_u AFTER UPDATE ON lagebericht BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'lagebericht' AND schluessel IN (CAST(OLD.id AS TEXT), CAST(NEW.id AS TEXT));
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT OLD.einsatz_id, 'lagebericht', CAST(OLD.id AS TEXT) WHERE CAST(OLD.id AS TEXT) IS NOT CAST(NEW.id AS TEXT) AND EXISTS (SELECT 1 FROM einsatz WHERE id = OLD.einsatz_id);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT NEW.einsatz_id, 'lagebericht', CAST(NEW.id AS TEXT) WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = NEW.einsatz_id);
END;
CREATE TRIGGER lagebericht_spiegellog_d AFTER DELETE ON lagebericht BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'lagebericht' AND schluessel = CAST(OLD.id AS TEXT);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT OLD.einsatz_id, 'lagebericht', CAST(OLD.id AS TEXT) WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = OLD.einsatz_id);
END;
CREATE TRIGGER lagebericht_spiegelschutz_i BEFORE INSERT ON lagebericht WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = NEW.einsatz_id) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
CREATE TRIGGER lagebericht_spiegelschutz_u BEFORE UPDATE ON lagebericht WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND (EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = OLD.einsatz_id) OR EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = NEW.einsatz_id)) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
CREATE TRIGGER lagebericht_spiegelschutz_d BEFORE DELETE ON lagebericht WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = OLD.einsatz_id) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
-- lagebericht_verteiler
CREATE TRIGGER lagebericht_verteiler_spiegellog_i AFTER INSERT ON lagebericht_verteiler WHEN EXISTS (SELECT 1 FROM einsatz WHERE id = NEW.einsatz_id) BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'lagebericht_verteiler' AND schluessel = CAST(NEW.id AS TEXT);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) VALUES (NEW.einsatz_id, 'lagebericht_verteiler', CAST(NEW.id AS TEXT));
END;
CREATE TRIGGER lagebericht_verteiler_spiegellog_u AFTER UPDATE ON lagebericht_verteiler BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'lagebericht_verteiler' AND schluessel IN (CAST(OLD.id AS TEXT), CAST(NEW.id AS TEXT));
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT OLD.einsatz_id, 'lagebericht_verteiler', CAST(OLD.id AS TEXT) WHERE CAST(OLD.id AS TEXT) IS NOT CAST(NEW.id AS TEXT) AND EXISTS (SELECT 1 FROM einsatz WHERE id = OLD.einsatz_id);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT NEW.einsatz_id, 'lagebericht_verteiler', CAST(NEW.id AS TEXT) WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = NEW.einsatz_id);
END;
CREATE TRIGGER lagebericht_verteiler_spiegellog_d AFTER DELETE ON lagebericht_verteiler BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'lagebericht_verteiler' AND schluessel = CAST(OLD.id AS TEXT);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT OLD.einsatz_id, 'lagebericht_verteiler', CAST(OLD.id AS TEXT) WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = OLD.einsatz_id);
END;
CREATE TRIGGER lagebericht_verteiler_spiegelschutz_i BEFORE INSERT ON lagebericht_verteiler WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = NEW.einsatz_id) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
CREATE TRIGGER lagebericht_verteiler_spiegelschutz_u BEFORE UPDATE ON lagebericht_verteiler WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND (EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = OLD.einsatz_id) OR EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = NEW.einsatz_id)) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
CREATE TRIGGER lagebericht_verteiler_spiegelschutz_d BEFORE DELETE ON lagebericht_verteiler WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = OLD.einsatz_id) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
-- nachforderung
CREATE TRIGGER nachforderung_spiegellog_i AFTER INSERT ON nachforderung WHEN EXISTS (SELECT 1 FROM einsatz WHERE id = NEW.einsatz_id) BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'nachforderung' AND schluessel = CAST(NEW.id AS TEXT);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) VALUES (NEW.einsatz_id, 'nachforderung', CAST(NEW.id AS TEXT));
END;
CREATE TRIGGER nachforderung_spiegellog_u AFTER UPDATE ON nachforderung BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'nachforderung' AND schluessel IN (CAST(OLD.id AS TEXT), CAST(NEW.id AS TEXT));
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT OLD.einsatz_id, 'nachforderung', CAST(OLD.id AS TEXT) WHERE CAST(OLD.id AS TEXT) IS NOT CAST(NEW.id AS TEXT) AND EXISTS (SELECT 1 FROM einsatz WHERE id = OLD.einsatz_id);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT NEW.einsatz_id, 'nachforderung', CAST(NEW.id AS TEXT) WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = NEW.einsatz_id);
END;
CREATE TRIGGER nachforderung_spiegellog_d AFTER DELETE ON nachforderung BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'nachforderung' AND schluessel = CAST(OLD.id AS TEXT);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT OLD.einsatz_id, 'nachforderung', CAST(OLD.id AS TEXT) WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = OLD.einsatz_id);
END;
CREATE TRIGGER nachforderung_spiegelschutz_i BEFORE INSERT ON nachforderung WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = NEW.einsatz_id) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
CREATE TRIGGER nachforderung_spiegelschutz_u BEFORE UPDATE ON nachforderung WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND (EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = OLD.einsatz_id) OR EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = NEW.einsatz_id)) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
CREATE TRIGGER nachforderung_spiegelschutz_d BEFORE DELETE ON nachforderung WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = OLD.einsatz_id) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
-- infotelefon_anruf
CREATE TRIGGER infotelefon_anruf_spiegellog_i AFTER INSERT ON infotelefon_anruf WHEN EXISTS (SELECT 1 FROM einsatz WHERE id = NEW.einsatz_id) BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'infotelefon_anruf' AND schluessel = CAST(NEW.id AS TEXT);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) VALUES (NEW.einsatz_id, 'infotelefon_anruf', CAST(NEW.id AS TEXT));
END;
CREATE TRIGGER infotelefon_anruf_spiegellog_u AFTER UPDATE ON infotelefon_anruf BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'infotelefon_anruf' AND schluessel IN (CAST(OLD.id AS TEXT), CAST(NEW.id AS TEXT));
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT OLD.einsatz_id, 'infotelefon_anruf', CAST(OLD.id AS TEXT) WHERE CAST(OLD.id AS TEXT) IS NOT CAST(NEW.id AS TEXT) AND EXISTS (SELECT 1 FROM einsatz WHERE id = OLD.einsatz_id);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT NEW.einsatz_id, 'infotelefon_anruf', CAST(NEW.id AS TEXT) WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = NEW.einsatz_id);
END;
CREATE TRIGGER infotelefon_anruf_spiegellog_d AFTER DELETE ON infotelefon_anruf BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'infotelefon_anruf' AND schluessel = CAST(OLD.id AS TEXT);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT OLD.einsatz_id, 'infotelefon_anruf', CAST(OLD.id AS TEXT) WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = OLD.einsatz_id);
END;
CREATE TRIGGER infotelefon_anruf_spiegelschutz_i BEFORE INSERT ON infotelefon_anruf WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = NEW.einsatz_id) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
CREATE TRIGGER infotelefon_anruf_spiegelschutz_u BEFORE UPDATE ON infotelefon_anruf WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND (EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = OLD.einsatz_id) OR EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = NEW.einsatz_id)) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
CREATE TRIGGER infotelefon_anruf_spiegelschutz_d BEFORE DELETE ON infotelefon_anruf WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = OLD.einsatz_id) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
-- chat_kanal
CREATE TRIGGER chat_kanal_spiegellog_i AFTER INSERT ON chat_kanal WHEN EXISTS (SELECT 1 FROM einsatz WHERE id = NEW.einsatz_id) BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'chat_kanal' AND schluessel = CAST(NEW.id AS TEXT);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) VALUES (NEW.einsatz_id, 'chat_kanal', CAST(NEW.id AS TEXT));
END;
CREATE TRIGGER chat_kanal_spiegellog_u AFTER UPDATE ON chat_kanal BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'chat_kanal' AND schluessel IN (CAST(OLD.id AS TEXT), CAST(NEW.id AS TEXT));
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT OLD.einsatz_id, 'chat_kanal', CAST(OLD.id AS TEXT) WHERE CAST(OLD.id AS TEXT) IS NOT CAST(NEW.id AS TEXT) AND EXISTS (SELECT 1 FROM einsatz WHERE id = OLD.einsatz_id);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT NEW.einsatz_id, 'chat_kanal', CAST(NEW.id AS TEXT) WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = NEW.einsatz_id);
END;
CREATE TRIGGER chat_kanal_spiegellog_d AFTER DELETE ON chat_kanal BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'chat_kanal' AND schluessel = CAST(OLD.id AS TEXT);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT OLD.einsatz_id, 'chat_kanal', CAST(OLD.id AS TEXT) WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = OLD.einsatz_id);
END;
CREATE TRIGGER chat_kanal_spiegelschutz_i BEFORE INSERT ON chat_kanal WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = NEW.einsatz_id) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
CREATE TRIGGER chat_kanal_spiegelschutz_u BEFORE UPDATE ON chat_kanal WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND (EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = OLD.einsatz_id) OR EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = NEW.einsatz_id)) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
CREATE TRIGGER chat_kanal_spiegelschutz_d BEFORE DELETE ON chat_kanal WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = OLD.einsatz_id) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
-- chat_nachricht
CREATE TRIGGER chat_nachricht_spiegellog_i AFTER INSERT ON chat_nachricht WHEN EXISTS (SELECT 1 FROM einsatz WHERE id = NEW.einsatz_id) BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'chat_nachricht' AND schluessel = CAST(NEW.id AS TEXT);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) VALUES (NEW.einsatz_id, 'chat_nachricht', CAST(NEW.id AS TEXT));
END;
CREATE TRIGGER chat_nachricht_spiegellog_u AFTER UPDATE ON chat_nachricht BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'chat_nachricht' AND schluessel IN (CAST(OLD.id AS TEXT), CAST(NEW.id AS TEXT));
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT OLD.einsatz_id, 'chat_nachricht', CAST(OLD.id AS TEXT) WHERE CAST(OLD.id AS TEXT) IS NOT CAST(NEW.id AS TEXT) AND EXISTS (SELECT 1 FROM einsatz WHERE id = OLD.einsatz_id);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT NEW.einsatz_id, 'chat_nachricht', CAST(NEW.id AS TEXT) WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = NEW.einsatz_id);
END;
CREATE TRIGGER chat_nachricht_spiegellog_d AFTER DELETE ON chat_nachricht BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'chat_nachricht' AND schluessel = CAST(OLD.id AS TEXT);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT OLD.einsatz_id, 'chat_nachricht', CAST(OLD.id AS TEXT) WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = OLD.einsatz_id);
END;
CREATE TRIGGER chat_nachricht_spiegelschutz_i BEFORE INSERT ON chat_nachricht WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = NEW.einsatz_id) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
CREATE TRIGGER chat_nachricht_spiegelschutz_u BEFORE UPDATE ON chat_nachricht WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND (EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = OLD.einsatz_id) OR EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = NEW.einsatz_id)) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
CREATE TRIGGER chat_nachricht_spiegelschutz_d BEFORE DELETE ON chat_nachricht WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = OLD.einsatz_id) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
-- chat_erwaehnung
CREATE TRIGGER chat_erwaehnung_spiegellog_i AFTER INSERT ON chat_erwaehnung WHEN EXISTS (SELECT 1 FROM einsatz WHERE id = (SELECT einsatz_id FROM chat_nachricht WHERE id = NEW.nachricht_id)) BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'chat_erwaehnung' AND schluessel = CAST(NEW.id AS TEXT);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) VALUES ((SELECT einsatz_id FROM chat_nachricht WHERE id = NEW.nachricht_id), 'chat_erwaehnung', CAST(NEW.id AS TEXT));
END;
CREATE TRIGGER chat_erwaehnung_spiegellog_u AFTER UPDATE ON chat_erwaehnung BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'chat_erwaehnung' AND schluessel IN (CAST(OLD.id AS TEXT), CAST(NEW.id AS TEXT));
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT (SELECT einsatz_id FROM chat_nachricht WHERE id = OLD.nachricht_id), 'chat_erwaehnung', CAST(OLD.id AS TEXT) WHERE CAST(OLD.id AS TEXT) IS NOT CAST(NEW.id AS TEXT) AND EXISTS (SELECT 1 FROM einsatz WHERE id = (SELECT einsatz_id FROM chat_nachricht WHERE id = OLD.nachricht_id));
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT (SELECT einsatz_id FROM chat_nachricht WHERE id = NEW.nachricht_id), 'chat_erwaehnung', CAST(NEW.id AS TEXT) WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = (SELECT einsatz_id FROM chat_nachricht WHERE id = NEW.nachricht_id));
END;
CREATE TRIGGER chat_erwaehnung_spiegellog_d AFTER DELETE ON chat_erwaehnung BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'chat_erwaehnung' AND schluessel = CAST(OLD.id AS TEXT);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT (SELECT einsatz_id FROM chat_nachricht WHERE id = OLD.nachricht_id), 'chat_erwaehnung', CAST(OLD.id AS TEXT) WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = (SELECT einsatz_id FROM chat_nachricht WHERE id = OLD.nachricht_id));
END;
CREATE TRIGGER chat_erwaehnung_spiegelschutz_i BEFORE INSERT ON chat_erwaehnung WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = (SELECT einsatz_id FROM chat_nachricht WHERE id = NEW.nachricht_id)) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
CREATE TRIGGER chat_erwaehnung_spiegelschutz_u BEFORE UPDATE ON chat_erwaehnung WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND (EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = (SELECT einsatz_id FROM chat_nachricht WHERE id = OLD.nachricht_id)) OR EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = (SELECT einsatz_id FROM chat_nachricht WHERE id = NEW.nachricht_id))) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
CREATE TRIGGER chat_erwaehnung_spiegelschutz_d BEFORE DELETE ON chat_erwaehnung WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = (SELECT einsatz_id FROM chat_nachricht WHERE id = OLD.nachricht_id)) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
-- kommunikation_status
CREATE TRIGGER kommunikation_status_spiegellog_i AFTER INSERT ON kommunikation_status WHEN EXISTS (SELECT 1 FROM einsatz WHERE id = NEW.einsatz_id) BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'kommunikation_status' AND schluessel = CAST(NEW.id AS TEXT);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) VALUES (NEW.einsatz_id, 'kommunikation_status', CAST(NEW.id AS TEXT));
END;
CREATE TRIGGER kommunikation_status_spiegellog_u AFTER UPDATE ON kommunikation_status BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'kommunikation_status' AND schluessel IN (CAST(OLD.id AS TEXT), CAST(NEW.id AS TEXT));
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT OLD.einsatz_id, 'kommunikation_status', CAST(OLD.id AS TEXT) WHERE CAST(OLD.id AS TEXT) IS NOT CAST(NEW.id AS TEXT) AND EXISTS (SELECT 1 FROM einsatz WHERE id = OLD.einsatz_id);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT NEW.einsatz_id, 'kommunikation_status', CAST(NEW.id AS TEXT) WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = NEW.einsatz_id);
END;
CREATE TRIGGER kommunikation_status_spiegellog_d AFTER DELETE ON kommunikation_status BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'kommunikation_status' AND schluessel = CAST(OLD.id AS TEXT);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT OLD.einsatz_id, 'kommunikation_status', CAST(OLD.id AS TEXT) WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = OLD.einsatz_id);
END;
CREATE TRIGGER kommunikation_status_spiegelschutz_i BEFORE INSERT ON kommunikation_status WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = NEW.einsatz_id) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
CREATE TRIGGER kommunikation_status_spiegelschutz_u BEFORE UPDATE ON kommunikation_status WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND (EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = OLD.einsatz_id) OR EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = NEW.einsatz_id)) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
CREATE TRIGGER kommunikation_status_spiegelschutz_d BEFORE DELETE ON kommunikation_status WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = OLD.einsatz_id) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
-- kommunikation_zustellung
CREATE TRIGGER kommunikation_zustellung_spiegellog_i AFTER INSERT ON kommunikation_zustellung WHEN EXISTS (SELECT 1 FROM einsatz WHERE id = NEW.einsatz_id) BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'kommunikation_zustellung' AND schluessel = CAST(NEW.id AS TEXT);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) VALUES (NEW.einsatz_id, 'kommunikation_zustellung', CAST(NEW.id AS TEXT));
END;
CREATE TRIGGER kommunikation_zustellung_spiegellog_u AFTER UPDATE ON kommunikation_zustellung BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'kommunikation_zustellung' AND schluessel IN (CAST(OLD.id AS TEXT), CAST(NEW.id AS TEXT));
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT OLD.einsatz_id, 'kommunikation_zustellung', CAST(OLD.id AS TEXT) WHERE CAST(OLD.id AS TEXT) IS NOT CAST(NEW.id AS TEXT) AND EXISTS (SELECT 1 FROM einsatz WHERE id = OLD.einsatz_id);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT NEW.einsatz_id, 'kommunikation_zustellung', CAST(NEW.id AS TEXT) WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = NEW.einsatz_id);
END;
CREATE TRIGGER kommunikation_zustellung_spiegellog_d AFTER DELETE ON kommunikation_zustellung BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'kommunikation_zustellung' AND schluessel = CAST(OLD.id AS TEXT);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT OLD.einsatz_id, 'kommunikation_zustellung', CAST(OLD.id AS TEXT) WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = OLD.einsatz_id);
END;
CREATE TRIGGER kommunikation_zustellung_spiegelschutz_i BEFORE INSERT ON kommunikation_zustellung WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = NEW.einsatz_id) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
CREATE TRIGGER kommunikation_zustellung_spiegelschutz_u BEFORE UPDATE ON kommunikation_zustellung WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND (EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = OLD.einsatz_id) OR EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = NEW.einsatz_id)) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
CREATE TRIGGER kommunikation_zustellung_spiegelschutz_d BEFORE DELETE ON kommunikation_zustellung WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = OLD.einsatz_id) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
-- sprechgruppe
CREATE TRIGGER sprechgruppe_spiegellog_i AFTER INSERT ON sprechgruppe WHEN EXISTS (SELECT 1 FROM einsatz WHERE id = NEW.einsatz_id) BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'sprechgruppe' AND schluessel = CAST(NEW.id AS TEXT);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) VALUES (NEW.einsatz_id, 'sprechgruppe', CAST(NEW.id AS TEXT));
END;
CREATE TRIGGER sprechgruppe_spiegellog_u AFTER UPDATE ON sprechgruppe BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'sprechgruppe' AND schluessel IN (CAST(OLD.id AS TEXT), CAST(NEW.id AS TEXT));
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT OLD.einsatz_id, 'sprechgruppe', CAST(OLD.id AS TEXT) WHERE CAST(OLD.id AS TEXT) IS NOT CAST(NEW.id AS TEXT) AND EXISTS (SELECT 1 FROM einsatz WHERE id = OLD.einsatz_id);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT NEW.einsatz_id, 'sprechgruppe', CAST(NEW.id AS TEXT) WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = NEW.einsatz_id);
END;
CREATE TRIGGER sprechgruppe_spiegellog_d AFTER DELETE ON sprechgruppe BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'sprechgruppe' AND schluessel = CAST(OLD.id AS TEXT);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT OLD.einsatz_id, 'sprechgruppe', CAST(OLD.id AS TEXT) WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = OLD.einsatz_id);
END;
CREATE TRIGGER sprechgruppe_spiegelschutz_i BEFORE INSERT ON sprechgruppe WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = NEW.einsatz_id) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
CREATE TRIGGER sprechgruppe_spiegelschutz_u BEFORE UPDATE ON sprechgruppe WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND (EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = OLD.einsatz_id) OR EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = NEW.einsatz_id)) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
CREATE TRIGGER sprechgruppe_spiegelschutz_d BEFORE DELETE ON sprechgruppe WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = OLD.einsatz_id) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
-- einsatz_verbindung
CREATE TRIGGER einsatz_verbindung_spiegellog_i AFTER INSERT ON einsatz_verbindung WHEN EXISTS (SELECT 1 FROM einsatz WHERE id = NEW.einsatz_id) BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'einsatz_verbindung' AND schluessel = CAST(NEW.id AS TEXT);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) VALUES (NEW.einsatz_id, 'einsatz_verbindung', CAST(NEW.id AS TEXT));
END;
CREATE TRIGGER einsatz_verbindung_spiegellog_u AFTER UPDATE ON einsatz_verbindung BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'einsatz_verbindung' AND schluessel IN (CAST(OLD.id AS TEXT), CAST(NEW.id AS TEXT));
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT OLD.einsatz_id, 'einsatz_verbindung', CAST(OLD.id AS TEXT) WHERE CAST(OLD.id AS TEXT) IS NOT CAST(NEW.id AS TEXT) AND EXISTS (SELECT 1 FROM einsatz WHERE id = OLD.einsatz_id);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT NEW.einsatz_id, 'einsatz_verbindung', CAST(NEW.id AS TEXT) WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = NEW.einsatz_id);
END;
CREATE TRIGGER einsatz_verbindung_spiegellog_d AFTER DELETE ON einsatz_verbindung BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'einsatz_verbindung' AND schluessel = CAST(OLD.id AS TEXT);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT OLD.einsatz_id, 'einsatz_verbindung', CAST(OLD.id AS TEXT) WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = OLD.einsatz_id);
END;
CREATE TRIGGER einsatz_verbindung_spiegelschutz_i BEFORE INSERT ON einsatz_verbindung WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = NEW.einsatz_id) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
CREATE TRIGGER einsatz_verbindung_spiegelschutz_u BEFORE UPDATE ON einsatz_verbindung WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND (EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = OLD.einsatz_id) OR EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = NEW.einsatz_id)) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
CREATE TRIGGER einsatz_verbindung_spiegelschutz_d BEFORE DELETE ON einsatz_verbindung WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = OLD.einsatz_id) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
-- einsatz_kommunikation_stelle
CREATE TRIGGER einsatz_kommunikation_stelle_spiegellog_i AFTER INSERT ON einsatz_kommunikation_stelle WHEN EXISTS (SELECT 1 FROM einsatz WHERE id = NEW.einsatz_id) BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'einsatz_kommunikation_stelle' AND schluessel = CAST(NEW.id AS TEXT);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) VALUES (NEW.einsatz_id, 'einsatz_kommunikation_stelle', CAST(NEW.id AS TEXT));
END;
CREATE TRIGGER einsatz_kommunikation_stelle_spiegellog_u AFTER UPDATE ON einsatz_kommunikation_stelle BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'einsatz_kommunikation_stelle' AND schluessel IN (CAST(OLD.id AS TEXT), CAST(NEW.id AS TEXT));
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT OLD.einsatz_id, 'einsatz_kommunikation_stelle', CAST(OLD.id AS TEXT) WHERE CAST(OLD.id AS TEXT) IS NOT CAST(NEW.id AS TEXT) AND EXISTS (SELECT 1 FROM einsatz WHERE id = OLD.einsatz_id);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT NEW.einsatz_id, 'einsatz_kommunikation_stelle', CAST(NEW.id AS TEXT) WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = NEW.einsatz_id);
END;
CREATE TRIGGER einsatz_kommunikation_stelle_spiegellog_d AFTER DELETE ON einsatz_kommunikation_stelle BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'einsatz_kommunikation_stelle' AND schluessel = CAST(OLD.id AS TEXT);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT OLD.einsatz_id, 'einsatz_kommunikation_stelle', CAST(OLD.id AS TEXT) WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = OLD.einsatz_id);
END;
CREATE TRIGGER einsatz_kommunikation_stelle_spiegelschutz_i BEFORE INSERT ON einsatz_kommunikation_stelle WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = NEW.einsatz_id) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
CREATE TRIGGER einsatz_kommunikation_stelle_spiegelschutz_u BEFORE UPDATE ON einsatz_kommunikation_stelle WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND (EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = OLD.einsatz_id) OR EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = NEW.einsatz_id)) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
CREATE TRIGGER einsatz_kommunikation_stelle_spiegelschutz_d BEFORE DELETE ON einsatz_kommunikation_stelle WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = OLD.einsatz_id) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
-- einsatz_kommunikation_verbindung
CREATE TRIGGER einsatz_kommunikation_verbindung_spiegellog_i AFTER INSERT ON einsatz_kommunikation_verbindung WHEN EXISTS (SELECT 1 FROM einsatz WHERE id = NEW.einsatz_id) BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'einsatz_kommunikation_verbindung' AND schluessel = CAST(NEW.id AS TEXT);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) VALUES (NEW.einsatz_id, 'einsatz_kommunikation_verbindung', CAST(NEW.id AS TEXT));
END;
CREATE TRIGGER einsatz_kommunikation_verbindung_spiegellog_u AFTER UPDATE ON einsatz_kommunikation_verbindung BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'einsatz_kommunikation_verbindung' AND schluessel IN (CAST(OLD.id AS TEXT), CAST(NEW.id AS TEXT));
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT OLD.einsatz_id, 'einsatz_kommunikation_verbindung', CAST(OLD.id AS TEXT) WHERE CAST(OLD.id AS TEXT) IS NOT CAST(NEW.id AS TEXT) AND EXISTS (SELECT 1 FROM einsatz WHERE id = OLD.einsatz_id);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT NEW.einsatz_id, 'einsatz_kommunikation_verbindung', CAST(NEW.id AS TEXT) WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = NEW.einsatz_id);
END;
CREATE TRIGGER einsatz_kommunikation_verbindung_spiegellog_d AFTER DELETE ON einsatz_kommunikation_verbindung BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'einsatz_kommunikation_verbindung' AND schluessel = CAST(OLD.id AS TEXT);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT OLD.einsatz_id, 'einsatz_kommunikation_verbindung', CAST(OLD.id AS TEXT) WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = OLD.einsatz_id);
END;
CREATE TRIGGER einsatz_kommunikation_verbindung_spiegelschutz_i BEFORE INSERT ON einsatz_kommunikation_verbindung WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = NEW.einsatz_id) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
CREATE TRIGGER einsatz_kommunikation_verbindung_spiegelschutz_u BEFORE UPDATE ON einsatz_kommunikation_verbindung WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND (EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = OLD.einsatz_id) OR EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = NEW.einsatz_id)) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
CREATE TRIGGER einsatz_kommunikation_verbindung_spiegelschutz_d BEFORE DELETE ON einsatz_kommunikation_verbindung WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = OLD.einsatz_id) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
-- einsatz_kommunikation_stelle_sprechgruppe
CREATE TRIGGER einsatz_kommunikation_stelle_sprechgruppe_spiegellog_i AFTER INSERT ON einsatz_kommunikation_stelle_sprechgruppe WHEN EXISTS (SELECT 1 FROM einsatz WHERE id = (SELECT einsatz_id FROM einsatz_kommunikation_stelle WHERE id = NEW.stelle_id)) BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'einsatz_kommunikation_stelle_sprechgruppe' AND schluessel = json_array(NEW.stelle_id, NEW.sprechgruppe_id);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) VALUES ((SELECT einsatz_id FROM einsatz_kommunikation_stelle WHERE id = NEW.stelle_id), 'einsatz_kommunikation_stelle_sprechgruppe', json_array(NEW.stelle_id, NEW.sprechgruppe_id));
END;
CREATE TRIGGER einsatz_kommunikation_stelle_sprechgruppe_spiegellog_u AFTER UPDATE ON einsatz_kommunikation_stelle_sprechgruppe BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'einsatz_kommunikation_stelle_sprechgruppe' AND schluessel IN (json_array(OLD.stelle_id, OLD.sprechgruppe_id), json_array(NEW.stelle_id, NEW.sprechgruppe_id));
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT (SELECT einsatz_id FROM einsatz_kommunikation_stelle WHERE id = OLD.stelle_id), 'einsatz_kommunikation_stelle_sprechgruppe', json_array(OLD.stelle_id, OLD.sprechgruppe_id) WHERE json_array(OLD.stelle_id, OLD.sprechgruppe_id) IS NOT json_array(NEW.stelle_id, NEW.sprechgruppe_id) AND EXISTS (SELECT 1 FROM einsatz WHERE id = (SELECT einsatz_id FROM einsatz_kommunikation_stelle WHERE id = OLD.stelle_id));
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT (SELECT einsatz_id FROM einsatz_kommunikation_stelle WHERE id = NEW.stelle_id), 'einsatz_kommunikation_stelle_sprechgruppe', json_array(NEW.stelle_id, NEW.sprechgruppe_id) WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = (SELECT einsatz_id FROM einsatz_kommunikation_stelle WHERE id = NEW.stelle_id));
END;
CREATE TRIGGER einsatz_kommunikation_stelle_sprechgruppe_spiegellog_d AFTER DELETE ON einsatz_kommunikation_stelle_sprechgruppe BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'einsatz_kommunikation_stelle_sprechgruppe' AND schluessel = json_array(OLD.stelle_id, OLD.sprechgruppe_id);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT (SELECT einsatz_id FROM einsatz_kommunikation_stelle WHERE id = OLD.stelle_id), 'einsatz_kommunikation_stelle_sprechgruppe', json_array(OLD.stelle_id, OLD.sprechgruppe_id) WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = (SELECT einsatz_id FROM einsatz_kommunikation_stelle WHERE id = OLD.stelle_id));
END;
CREATE TRIGGER einsatz_kommunikation_stelle_sprechgruppe_spiegelschutz_i BEFORE INSERT ON einsatz_kommunikation_stelle_sprechgruppe WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = (SELECT einsatz_id FROM einsatz_kommunikation_stelle WHERE id = NEW.stelle_id)) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
CREATE TRIGGER einsatz_kommunikation_stelle_sprechgruppe_spiegelschutz_u BEFORE UPDATE ON einsatz_kommunikation_stelle_sprechgruppe WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND (EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = (SELECT einsatz_id FROM einsatz_kommunikation_stelle WHERE id = OLD.stelle_id)) OR EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = (SELECT einsatz_id FROM einsatz_kommunikation_stelle WHERE id = NEW.stelle_id))) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
CREATE TRIGGER einsatz_kommunikation_stelle_sprechgruppe_spiegelschutz_d BEFORE DELETE ON einsatz_kommunikation_stelle_sprechgruppe WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = (SELECT einsatz_id FROM einsatz_kommunikation_stelle WHERE id = OLD.stelle_id)) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
-- fernmeldeskizze_komponente
CREATE TRIGGER fernmeldeskizze_komponente_spiegellog_i AFTER INSERT ON fernmeldeskizze_komponente WHEN EXISTS (SELECT 1 FROM einsatz WHERE id = NEW.einsatz_id) BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'fernmeldeskizze_komponente' AND schluessel = CAST(NEW.id AS TEXT);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) VALUES (NEW.einsatz_id, 'fernmeldeskizze_komponente', CAST(NEW.id AS TEXT));
END;
CREATE TRIGGER fernmeldeskizze_komponente_spiegellog_u AFTER UPDATE ON fernmeldeskizze_komponente BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'fernmeldeskizze_komponente' AND schluessel IN (CAST(OLD.id AS TEXT), CAST(NEW.id AS TEXT));
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT OLD.einsatz_id, 'fernmeldeskizze_komponente', CAST(OLD.id AS TEXT) WHERE CAST(OLD.id AS TEXT) IS NOT CAST(NEW.id AS TEXT) AND EXISTS (SELECT 1 FROM einsatz WHERE id = OLD.einsatz_id);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT NEW.einsatz_id, 'fernmeldeskizze_komponente', CAST(NEW.id AS TEXT) WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = NEW.einsatz_id);
END;
CREATE TRIGGER fernmeldeskizze_komponente_spiegellog_d AFTER DELETE ON fernmeldeskizze_komponente BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'fernmeldeskizze_komponente' AND schluessel = CAST(OLD.id AS TEXT);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT OLD.einsatz_id, 'fernmeldeskizze_komponente', CAST(OLD.id AS TEXT) WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = OLD.einsatz_id);
END;
CREATE TRIGGER fernmeldeskizze_komponente_spiegelschutz_i BEFORE INSERT ON fernmeldeskizze_komponente WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = NEW.einsatz_id) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
CREATE TRIGGER fernmeldeskizze_komponente_spiegelschutz_u BEFORE UPDATE ON fernmeldeskizze_komponente WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND (EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = OLD.einsatz_id) OR EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = NEW.einsatz_id)) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
CREATE TRIGGER fernmeldeskizze_komponente_spiegelschutz_d BEFORE DELETE ON fernmeldeskizze_komponente WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = OLD.einsatz_id) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
-- fernmeldeskizze_komponente_sprechgruppe
CREATE TRIGGER fernmeldeskizze_komponente_sprechgruppe_spiegellog_i AFTER INSERT ON fernmeldeskizze_komponente_sprechgruppe WHEN EXISTS (SELECT 1 FROM einsatz WHERE id = (SELECT einsatz_id FROM fernmeldeskizze_komponente WHERE id = NEW.komponente_id)) BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'fernmeldeskizze_komponente_sprechgruppe' AND schluessel = json_array(NEW.komponente_id, NEW.sprechgruppe_id);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) VALUES ((SELECT einsatz_id FROM fernmeldeskizze_komponente WHERE id = NEW.komponente_id), 'fernmeldeskizze_komponente_sprechgruppe', json_array(NEW.komponente_id, NEW.sprechgruppe_id));
END;
CREATE TRIGGER fernmeldeskizze_komponente_sprechgruppe_spiegellog_u AFTER UPDATE ON fernmeldeskizze_komponente_sprechgruppe BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'fernmeldeskizze_komponente_sprechgruppe' AND schluessel IN (json_array(OLD.komponente_id, OLD.sprechgruppe_id), json_array(NEW.komponente_id, NEW.sprechgruppe_id));
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT (SELECT einsatz_id FROM fernmeldeskizze_komponente WHERE id = OLD.komponente_id), 'fernmeldeskizze_komponente_sprechgruppe', json_array(OLD.komponente_id, OLD.sprechgruppe_id) WHERE json_array(OLD.komponente_id, OLD.sprechgruppe_id) IS NOT json_array(NEW.komponente_id, NEW.sprechgruppe_id) AND EXISTS (SELECT 1 FROM einsatz WHERE id = (SELECT einsatz_id FROM fernmeldeskizze_komponente WHERE id = OLD.komponente_id));
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT (SELECT einsatz_id FROM fernmeldeskizze_komponente WHERE id = NEW.komponente_id), 'fernmeldeskizze_komponente_sprechgruppe', json_array(NEW.komponente_id, NEW.sprechgruppe_id) WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = (SELECT einsatz_id FROM fernmeldeskizze_komponente WHERE id = NEW.komponente_id));
END;
CREATE TRIGGER fernmeldeskizze_komponente_sprechgruppe_spiegellog_d AFTER DELETE ON fernmeldeskizze_komponente_sprechgruppe BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'fernmeldeskizze_komponente_sprechgruppe' AND schluessel = json_array(OLD.komponente_id, OLD.sprechgruppe_id);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT (SELECT einsatz_id FROM fernmeldeskizze_komponente WHERE id = OLD.komponente_id), 'fernmeldeskizze_komponente_sprechgruppe', json_array(OLD.komponente_id, OLD.sprechgruppe_id) WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = (SELECT einsatz_id FROM fernmeldeskizze_komponente WHERE id = OLD.komponente_id));
END;
CREATE TRIGGER fernmeldeskizze_komponente_sprechgruppe_spiegelschutz_i BEFORE INSERT ON fernmeldeskizze_komponente_sprechgruppe WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = (SELECT einsatz_id FROM fernmeldeskizze_komponente WHERE id = NEW.komponente_id)) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
CREATE TRIGGER fernmeldeskizze_komponente_sprechgruppe_spiegelschutz_u BEFORE UPDATE ON fernmeldeskizze_komponente_sprechgruppe WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND (EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = (SELECT einsatz_id FROM fernmeldeskizze_komponente WHERE id = OLD.komponente_id)) OR EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = (SELECT einsatz_id FROM fernmeldeskizze_komponente WHERE id = NEW.komponente_id))) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
CREATE TRIGGER fernmeldeskizze_komponente_sprechgruppe_spiegelschutz_d BEFORE DELETE ON fernmeldeskizze_komponente_sprechgruppe WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = (SELECT einsatz_id FROM fernmeldeskizze_komponente WHERE id = OLD.komponente_id)) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
-- fernmeldeskizze_verbindung
CREATE TRIGGER fernmeldeskizze_verbindung_spiegellog_i AFTER INSERT ON fernmeldeskizze_verbindung WHEN EXISTS (SELECT 1 FROM einsatz WHERE id = NEW.einsatz_id) BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'fernmeldeskizze_verbindung' AND schluessel = CAST(NEW.id AS TEXT);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) VALUES (NEW.einsatz_id, 'fernmeldeskizze_verbindung', CAST(NEW.id AS TEXT));
END;
CREATE TRIGGER fernmeldeskizze_verbindung_spiegellog_u AFTER UPDATE ON fernmeldeskizze_verbindung BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'fernmeldeskizze_verbindung' AND schluessel IN (CAST(OLD.id AS TEXT), CAST(NEW.id AS TEXT));
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT OLD.einsatz_id, 'fernmeldeskizze_verbindung', CAST(OLD.id AS TEXT) WHERE CAST(OLD.id AS TEXT) IS NOT CAST(NEW.id AS TEXT) AND EXISTS (SELECT 1 FROM einsatz WHERE id = OLD.einsatz_id);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT NEW.einsatz_id, 'fernmeldeskizze_verbindung', CAST(NEW.id AS TEXT) WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = NEW.einsatz_id);
END;
CREATE TRIGGER fernmeldeskizze_verbindung_spiegellog_d AFTER DELETE ON fernmeldeskizze_verbindung BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'fernmeldeskizze_verbindung' AND schluessel = CAST(OLD.id AS TEXT);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT OLD.einsatz_id, 'fernmeldeskizze_verbindung', CAST(OLD.id AS TEXT) WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = OLD.einsatz_id);
END;
CREATE TRIGGER fernmeldeskizze_verbindung_spiegelschutz_i BEFORE INSERT ON fernmeldeskizze_verbindung WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = NEW.einsatz_id) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
CREATE TRIGGER fernmeldeskizze_verbindung_spiegelschutz_u BEFORE UPDATE ON fernmeldeskizze_verbindung WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND (EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = OLD.einsatz_id) OR EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = NEW.einsatz_id)) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
CREATE TRIGGER fernmeldeskizze_verbindung_spiegelschutz_d BEFORE DELETE ON fernmeldeskizze_verbindung WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = OLD.einsatz_id) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
-- fernmeldeskizze_bereich
CREATE TRIGGER fernmeldeskizze_bereich_spiegellog_i AFTER INSERT ON fernmeldeskizze_bereich WHEN EXISTS (SELECT 1 FROM einsatz WHERE id = NEW.einsatz_id) BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'fernmeldeskizze_bereich' AND schluessel = CAST(NEW.id AS TEXT);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) VALUES (NEW.einsatz_id, 'fernmeldeskizze_bereich', CAST(NEW.id AS TEXT));
END;
CREATE TRIGGER fernmeldeskizze_bereich_spiegellog_u AFTER UPDATE ON fernmeldeskizze_bereich BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'fernmeldeskizze_bereich' AND schluessel IN (CAST(OLD.id AS TEXT), CAST(NEW.id AS TEXT));
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT OLD.einsatz_id, 'fernmeldeskizze_bereich', CAST(OLD.id AS TEXT) WHERE CAST(OLD.id AS TEXT) IS NOT CAST(NEW.id AS TEXT) AND EXISTS (SELECT 1 FROM einsatz WHERE id = OLD.einsatz_id);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT NEW.einsatz_id, 'fernmeldeskizze_bereich', CAST(NEW.id AS TEXT) WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = NEW.einsatz_id);
END;
CREATE TRIGGER fernmeldeskizze_bereich_spiegellog_d AFTER DELETE ON fernmeldeskizze_bereich BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'fernmeldeskizze_bereich' AND schluessel = CAST(OLD.id AS TEXT);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT OLD.einsatz_id, 'fernmeldeskizze_bereich', CAST(OLD.id AS TEXT) WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = OLD.einsatz_id);
END;
CREATE TRIGGER fernmeldeskizze_bereich_spiegelschutz_i BEFORE INSERT ON fernmeldeskizze_bereich WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = NEW.einsatz_id) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
CREATE TRIGGER fernmeldeskizze_bereich_spiegelschutz_u BEFORE UPDATE ON fernmeldeskizze_bereich WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND (EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = OLD.einsatz_id) OR EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = NEW.einsatz_id)) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
CREATE TRIGGER fernmeldeskizze_bereich_spiegelschutz_d BEFORE DELETE ON fernmeldeskizze_bereich WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = OLD.einsatz_id) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
-- fernmeldeskizze_lage
CREATE TRIGGER fernmeldeskizze_lage_spiegellog_i AFTER INSERT ON fernmeldeskizze_lage WHEN EXISTS (SELECT 1 FROM einsatz WHERE id = NEW.einsatz_id) BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'fernmeldeskizze_lage' AND schluessel = json_array(NEW.einsatz_id, NEW.element);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) VALUES (NEW.einsatz_id, 'fernmeldeskizze_lage', json_array(NEW.einsatz_id, NEW.element));
END;
CREATE TRIGGER fernmeldeskizze_lage_spiegellog_u AFTER UPDATE ON fernmeldeskizze_lage BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'fernmeldeskizze_lage' AND schluessel IN (json_array(OLD.einsatz_id, OLD.element), json_array(NEW.einsatz_id, NEW.element));
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT OLD.einsatz_id, 'fernmeldeskizze_lage', json_array(OLD.einsatz_id, OLD.element) WHERE json_array(OLD.einsatz_id, OLD.element) IS NOT json_array(NEW.einsatz_id, NEW.element) AND EXISTS (SELECT 1 FROM einsatz WHERE id = OLD.einsatz_id);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT NEW.einsatz_id, 'fernmeldeskizze_lage', json_array(NEW.einsatz_id, NEW.element) WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = NEW.einsatz_id);
END;
CREATE TRIGGER fernmeldeskizze_lage_spiegellog_d AFTER DELETE ON fernmeldeskizze_lage BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'fernmeldeskizze_lage' AND schluessel = json_array(OLD.einsatz_id, OLD.element);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT OLD.einsatz_id, 'fernmeldeskizze_lage', json_array(OLD.einsatz_id, OLD.element) WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = OLD.einsatz_id);
END;
CREATE TRIGGER fernmeldeskizze_lage_spiegelschutz_i BEFORE INSERT ON fernmeldeskizze_lage WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = NEW.einsatz_id) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
CREATE TRIGGER fernmeldeskizze_lage_spiegelschutz_u BEFORE UPDATE ON fernmeldeskizze_lage WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND (EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = OLD.einsatz_id) OR EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = NEW.einsatz_id)) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
CREATE TRIGGER fernmeldeskizze_lage_spiegelschutz_d BEFORE DELETE ON fernmeldeskizze_lage WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = OLD.einsatz_id) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
-- fernmeldeskizze_schriftfeld
CREATE TRIGGER fernmeldeskizze_schriftfeld_spiegellog_i AFTER INSERT ON fernmeldeskizze_schriftfeld WHEN EXISTS (SELECT 1 FROM einsatz WHERE id = NEW.einsatz_id) BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'fernmeldeskizze_schriftfeld' AND schluessel = CAST(NEW.einsatz_id AS TEXT);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) VALUES (NEW.einsatz_id, 'fernmeldeskizze_schriftfeld', CAST(NEW.einsatz_id AS TEXT));
END;
CREATE TRIGGER fernmeldeskizze_schriftfeld_spiegellog_u AFTER UPDATE ON fernmeldeskizze_schriftfeld BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'fernmeldeskizze_schriftfeld' AND schluessel IN (CAST(OLD.einsatz_id AS TEXT), CAST(NEW.einsatz_id AS TEXT));
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT OLD.einsatz_id, 'fernmeldeskizze_schriftfeld', CAST(OLD.einsatz_id AS TEXT) WHERE CAST(OLD.einsatz_id AS TEXT) IS NOT CAST(NEW.einsatz_id AS TEXT) AND EXISTS (SELECT 1 FROM einsatz WHERE id = OLD.einsatz_id);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT NEW.einsatz_id, 'fernmeldeskizze_schriftfeld', CAST(NEW.einsatz_id AS TEXT) WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = NEW.einsatz_id);
END;
CREATE TRIGGER fernmeldeskizze_schriftfeld_spiegellog_d AFTER DELETE ON fernmeldeskizze_schriftfeld BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'fernmeldeskizze_schriftfeld' AND schluessel = CAST(OLD.einsatz_id AS TEXT);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT OLD.einsatz_id, 'fernmeldeskizze_schriftfeld', CAST(OLD.einsatz_id AS TEXT) WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = OLD.einsatz_id);
END;
CREATE TRIGGER fernmeldeskizze_schriftfeld_spiegelschutz_i BEFORE INSERT ON fernmeldeskizze_schriftfeld WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = NEW.einsatz_id) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
CREATE TRIGGER fernmeldeskizze_schriftfeld_spiegelschutz_u BEFORE UPDATE ON fernmeldeskizze_schriftfeld WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND (EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = OLD.einsatz_id) OR EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = NEW.einsatz_id)) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
CREATE TRIGGER fernmeldeskizze_schriftfeld_spiegelschutz_d BEFORE DELETE ON fernmeldeskizze_schriftfeld WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = OLD.einsatz_id) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
-- anhang
CREATE TRIGGER anhang_spiegellog_i AFTER INSERT ON anhang WHEN EXISTS (SELECT 1 FROM einsatz WHERE id = NEW.einsatz_id) BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'anhang' AND schluessel = CAST(NEW.id AS TEXT);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) VALUES (NEW.einsatz_id, 'anhang', CAST(NEW.id AS TEXT));
END;
CREATE TRIGGER anhang_spiegellog_u AFTER UPDATE ON anhang BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'anhang' AND schluessel IN (CAST(OLD.id AS TEXT), CAST(NEW.id AS TEXT));
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT OLD.einsatz_id, 'anhang', CAST(OLD.id AS TEXT) WHERE CAST(OLD.id AS TEXT) IS NOT CAST(NEW.id AS TEXT) AND EXISTS (SELECT 1 FROM einsatz WHERE id = OLD.einsatz_id);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT NEW.einsatz_id, 'anhang', CAST(NEW.id AS TEXT) WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = NEW.einsatz_id);
END;
CREATE TRIGGER anhang_spiegellog_d AFTER DELETE ON anhang BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'anhang' AND schluessel = CAST(OLD.id AS TEXT);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT OLD.einsatz_id, 'anhang', CAST(OLD.id AS TEXT) WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = OLD.einsatz_id);
END;
CREATE TRIGGER anhang_spiegelschutz_i BEFORE INSERT ON anhang WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = NEW.einsatz_id) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
CREATE TRIGGER anhang_spiegelschutz_u BEFORE UPDATE ON anhang WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND (EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = OLD.einsatz_id) OR EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = NEW.einsatz_id)) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
CREATE TRIGGER anhang_spiegelschutz_d BEFORE DELETE ON anhang WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = OLD.einsatz_id) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
-- karte_hintergrundbild_daten
CREATE TRIGGER karte_hintergrundbild_daten_spiegellog_i AFTER INSERT ON karte_hintergrundbild_daten WHEN EXISTS (SELECT 1 FROM einsatz WHERE id = (SELECT einsatz_id FROM karte_hintergrundbild WHERE id = NEW.bild_id)) BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'karte_hintergrundbild_daten' AND schluessel = CAST(NEW.bild_id AS TEXT);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) VALUES ((SELECT einsatz_id FROM karte_hintergrundbild WHERE id = NEW.bild_id), 'karte_hintergrundbild_daten', CAST(NEW.bild_id AS TEXT));
END;
CREATE TRIGGER karte_hintergrundbild_daten_spiegellog_u AFTER UPDATE ON karte_hintergrundbild_daten BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'karte_hintergrundbild_daten' AND schluessel IN (CAST(OLD.bild_id AS TEXT), CAST(NEW.bild_id AS TEXT));
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT (SELECT einsatz_id FROM karte_hintergrundbild WHERE id = OLD.bild_id), 'karte_hintergrundbild_daten', CAST(OLD.bild_id AS TEXT) WHERE CAST(OLD.bild_id AS TEXT) IS NOT CAST(NEW.bild_id AS TEXT) AND EXISTS (SELECT 1 FROM einsatz WHERE id = (SELECT einsatz_id FROM karte_hintergrundbild WHERE id = OLD.bild_id));
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT (SELECT einsatz_id FROM karte_hintergrundbild WHERE id = NEW.bild_id), 'karte_hintergrundbild_daten', CAST(NEW.bild_id AS TEXT) WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = (SELECT einsatz_id FROM karte_hintergrundbild WHERE id = NEW.bild_id));
END;
CREATE TRIGGER karte_hintergrundbild_daten_spiegellog_d AFTER DELETE ON karte_hintergrundbild_daten BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'karte_hintergrundbild_daten' AND schluessel = CAST(OLD.bild_id AS TEXT);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT (SELECT einsatz_id FROM karte_hintergrundbild WHERE id = OLD.bild_id), 'karte_hintergrundbild_daten', CAST(OLD.bild_id AS TEXT) WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = (SELECT einsatz_id FROM karte_hintergrundbild WHERE id = OLD.bild_id));
END;
CREATE TRIGGER karte_hintergrundbild_daten_spiegelschutz_i BEFORE INSERT ON karte_hintergrundbild_daten WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = (SELECT einsatz_id FROM karte_hintergrundbild WHERE id = NEW.bild_id)) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
CREATE TRIGGER karte_hintergrundbild_daten_spiegelschutz_u BEFORE UPDATE ON karte_hintergrundbild_daten WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND (EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = (SELECT einsatz_id FROM karte_hintergrundbild WHERE id = OLD.bild_id)) OR EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = (SELECT einsatz_id FROM karte_hintergrundbild WHERE id = NEW.bild_id))) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
CREATE TRIGGER karte_hintergrundbild_daten_spiegelschutz_d BEFORE DELETE ON karte_hintergrundbild_daten WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = (SELECT einsatz_id FROM karte_hintergrundbild WHERE id = OLD.bild_id)) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
-- uhs_plan
CREATE TRIGGER uhs_plan_spiegellog_i AFTER INSERT ON uhs_plan WHEN EXISTS (SELECT 1 FROM einsatz WHERE id = NEW.einsatz_id) BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'uhs_plan' AND schluessel = CAST(NEW.uhs_id AS TEXT);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) VALUES (NEW.einsatz_id, 'uhs_plan', CAST(NEW.uhs_id AS TEXT));
END;
CREATE TRIGGER uhs_plan_spiegellog_u AFTER UPDATE ON uhs_plan BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'uhs_plan' AND schluessel IN (CAST(OLD.uhs_id AS TEXT), CAST(NEW.uhs_id AS TEXT));
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT OLD.einsatz_id, 'uhs_plan', CAST(OLD.uhs_id AS TEXT) WHERE CAST(OLD.uhs_id AS TEXT) IS NOT CAST(NEW.uhs_id AS TEXT) AND EXISTS (SELECT 1 FROM einsatz WHERE id = OLD.einsatz_id);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT NEW.einsatz_id, 'uhs_plan', CAST(NEW.uhs_id AS TEXT) WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = NEW.einsatz_id);
END;
CREATE TRIGGER uhs_plan_spiegellog_d AFTER DELETE ON uhs_plan BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'uhs_plan' AND schluessel = CAST(OLD.uhs_id AS TEXT);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT OLD.einsatz_id, 'uhs_plan', CAST(OLD.uhs_id AS TEXT) WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = OLD.einsatz_id);
END;
CREATE TRIGGER uhs_plan_spiegelschutz_i BEFORE INSERT ON uhs_plan WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = NEW.einsatz_id) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
CREATE TRIGGER uhs_plan_spiegelschutz_u BEFORE UPDATE ON uhs_plan WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND (EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = OLD.einsatz_id) OR EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = NEW.einsatz_id)) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
CREATE TRIGGER uhs_plan_spiegelschutz_d BEFORE DELETE ON uhs_plan WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = OLD.einsatz_id) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
-- einsatz_dokument
CREATE TRIGGER einsatz_dokument_spiegellog_i AFTER INSERT ON einsatz_dokument WHEN EXISTS (SELECT 1 FROM einsatz WHERE id = NEW.einsatz_id) BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'einsatz_dokument' AND schluessel = CAST(NEW.id AS TEXT);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) VALUES (NEW.einsatz_id, 'einsatz_dokument', CAST(NEW.id AS TEXT));
END;
CREATE TRIGGER einsatz_dokument_spiegellog_u AFTER UPDATE ON einsatz_dokument BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'einsatz_dokument' AND schluessel IN (CAST(OLD.id AS TEXT), CAST(NEW.id AS TEXT));
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT OLD.einsatz_id, 'einsatz_dokument', CAST(OLD.id AS TEXT) WHERE CAST(OLD.id AS TEXT) IS NOT CAST(NEW.id AS TEXT) AND EXISTS (SELECT 1 FROM einsatz WHERE id = OLD.einsatz_id);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT NEW.einsatz_id, 'einsatz_dokument', CAST(NEW.id AS TEXT) WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = NEW.einsatz_id);
END;
CREATE TRIGGER einsatz_dokument_spiegellog_d AFTER DELETE ON einsatz_dokument BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'einsatz_dokument' AND schluessel = CAST(OLD.id AS TEXT);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT OLD.einsatz_id, 'einsatz_dokument', CAST(OLD.id AS TEXT) WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = OLD.einsatz_id);
END;
CREATE TRIGGER einsatz_dokument_spiegelschutz_i BEFORE INSERT ON einsatz_dokument WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = NEW.einsatz_id) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
CREATE TRIGGER einsatz_dokument_spiegelschutz_u BEFORE UPDATE ON einsatz_dokument WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND (EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = OLD.einsatz_id) OR EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = NEW.einsatz_id)) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
CREATE TRIGGER einsatz_dokument_spiegelschutz_d BEFORE DELETE ON einsatz_dokument WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = OLD.einsatz_id) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
-- einsatz_schaden_anhang
CREATE TRIGGER einsatz_schaden_anhang_spiegellog_i AFTER INSERT ON einsatz_schaden_anhang WHEN EXISTS (SELECT 1 FROM einsatz WHERE id = NEW.einsatz_id) BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'einsatz_schaden_anhang' AND schluessel = CAST(NEW.id AS TEXT);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) VALUES (NEW.einsatz_id, 'einsatz_schaden_anhang', CAST(NEW.id AS TEXT));
END;
CREATE TRIGGER einsatz_schaden_anhang_spiegellog_u AFTER UPDATE ON einsatz_schaden_anhang BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'einsatz_schaden_anhang' AND schluessel IN (CAST(OLD.id AS TEXT), CAST(NEW.id AS TEXT));
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT OLD.einsatz_id, 'einsatz_schaden_anhang', CAST(OLD.id AS TEXT) WHERE CAST(OLD.id AS TEXT) IS NOT CAST(NEW.id AS TEXT) AND EXISTS (SELECT 1 FROM einsatz WHERE id = OLD.einsatz_id);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT NEW.einsatz_id, 'einsatz_schaden_anhang', CAST(NEW.id AS TEXT) WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = NEW.einsatz_id);
END;
CREATE TRIGGER einsatz_schaden_anhang_spiegellog_d AFTER DELETE ON einsatz_schaden_anhang BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'einsatz_schaden_anhang' AND schluessel = CAST(OLD.id AS TEXT);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT OLD.einsatz_id, 'einsatz_schaden_anhang', CAST(OLD.id AS TEXT) WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = OLD.einsatz_id);
END;
CREATE TRIGGER einsatz_schaden_anhang_spiegelschutz_i BEFORE INSERT ON einsatz_schaden_anhang WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = NEW.einsatz_id) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
CREATE TRIGGER einsatz_schaden_anhang_spiegelschutz_u BEFORE UPDATE ON einsatz_schaden_anhang WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND (EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = OLD.einsatz_id) OR EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = NEW.einsatz_id)) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
CREATE TRIGGER einsatz_schaden_anhang_spiegelschutz_d BEFORE DELETE ON einsatz_schaden_anhang WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = OLD.einsatz_id) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
-- einsatz_tier_anhang
CREATE TRIGGER einsatz_tier_anhang_spiegellog_i AFTER INSERT ON einsatz_tier_anhang WHEN EXISTS (SELECT 1 FROM einsatz WHERE id = NEW.einsatz_id) BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'einsatz_tier_anhang' AND schluessel = CAST(NEW.id AS TEXT);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) VALUES (NEW.einsatz_id, 'einsatz_tier_anhang', CAST(NEW.id AS TEXT));
END;
CREATE TRIGGER einsatz_tier_anhang_spiegellog_u AFTER UPDATE ON einsatz_tier_anhang BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'einsatz_tier_anhang' AND schluessel IN (CAST(OLD.id AS TEXT), CAST(NEW.id AS TEXT));
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT OLD.einsatz_id, 'einsatz_tier_anhang', CAST(OLD.id AS TEXT) WHERE CAST(OLD.id AS TEXT) IS NOT CAST(NEW.id AS TEXT) AND EXISTS (SELECT 1 FROM einsatz WHERE id = OLD.einsatz_id);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT NEW.einsatz_id, 'einsatz_tier_anhang', CAST(NEW.id AS TEXT) WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = NEW.einsatz_id);
END;
CREATE TRIGGER einsatz_tier_anhang_spiegellog_d AFTER DELETE ON einsatz_tier_anhang BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'einsatz_tier_anhang' AND schluessel = CAST(OLD.id AS TEXT);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT OLD.einsatz_id, 'einsatz_tier_anhang', CAST(OLD.id AS TEXT) WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = OLD.einsatz_id);
END;
CREATE TRIGGER einsatz_tier_anhang_spiegelschutz_i BEFORE INSERT ON einsatz_tier_anhang WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = NEW.einsatz_id) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
CREATE TRIGGER einsatz_tier_anhang_spiegelschutz_u BEFORE UPDATE ON einsatz_tier_anhang WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND (EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = OLD.einsatz_id) OR EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = NEW.einsatz_id)) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
CREATE TRIGGER einsatz_tier_anhang_spiegelschutz_d BEFORE DELETE ON einsatz_tier_anhang WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = OLD.einsatz_id) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
-- uhs_anhang
CREATE TRIGGER uhs_anhang_spiegellog_i AFTER INSERT ON uhs_anhang WHEN EXISTS (SELECT 1 FROM einsatz WHERE id = NEW.einsatz_id) BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'uhs_anhang' AND schluessel = CAST(NEW.id AS TEXT);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) VALUES (NEW.einsatz_id, 'uhs_anhang', CAST(NEW.id AS TEXT));
END;
CREATE TRIGGER uhs_anhang_spiegellog_u AFTER UPDATE ON uhs_anhang BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'uhs_anhang' AND schluessel IN (CAST(OLD.id AS TEXT), CAST(NEW.id AS TEXT));
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT OLD.einsatz_id, 'uhs_anhang', CAST(OLD.id AS TEXT) WHERE CAST(OLD.id AS TEXT) IS NOT CAST(NEW.id AS TEXT) AND EXISTS (SELECT 1 FROM einsatz WHERE id = OLD.einsatz_id);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT NEW.einsatz_id, 'uhs_anhang', CAST(NEW.id AS TEXT) WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = NEW.einsatz_id);
END;
CREATE TRIGGER uhs_anhang_spiegellog_d AFTER DELETE ON uhs_anhang BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'uhs_anhang' AND schluessel = CAST(OLD.id AS TEXT);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT OLD.einsatz_id, 'uhs_anhang', CAST(OLD.id AS TEXT) WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = OLD.einsatz_id);
END;
CREATE TRIGGER uhs_anhang_spiegelschutz_i BEFORE INSERT ON uhs_anhang WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = NEW.einsatz_id) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
CREATE TRIGGER uhs_anhang_spiegelschutz_u BEFORE UPDATE ON uhs_anhang WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND (EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = OLD.einsatz_id) OR EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = NEW.einsatz_id)) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
CREATE TRIGGER uhs_anhang_spiegelschutz_d BEFORE DELETE ON uhs_anhang WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = OLD.einsatz_id) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
-- einsatz_person_anhang
CREATE TRIGGER einsatz_person_anhang_spiegellog_i AFTER INSERT ON einsatz_person_anhang WHEN EXISTS (SELECT 1 FROM einsatz WHERE id = NEW.einsatz_id) BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'einsatz_person_anhang' AND schluessel = CAST(NEW.id AS TEXT);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) VALUES (NEW.einsatz_id, 'einsatz_person_anhang', CAST(NEW.id AS TEXT));
END;
CREATE TRIGGER einsatz_person_anhang_spiegellog_u AFTER UPDATE ON einsatz_person_anhang BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'einsatz_person_anhang' AND schluessel IN (CAST(OLD.id AS TEXT), CAST(NEW.id AS TEXT));
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT OLD.einsatz_id, 'einsatz_person_anhang', CAST(OLD.id AS TEXT) WHERE CAST(OLD.id AS TEXT) IS NOT CAST(NEW.id AS TEXT) AND EXISTS (SELECT 1 FROM einsatz WHERE id = OLD.einsatz_id);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT NEW.einsatz_id, 'einsatz_person_anhang', CAST(NEW.id AS TEXT) WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = NEW.einsatz_id);
END;
CREATE TRIGGER einsatz_person_anhang_spiegellog_d AFTER DELETE ON einsatz_person_anhang BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'einsatz_person_anhang' AND schluessel = CAST(OLD.id AS TEXT);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT OLD.einsatz_id, 'einsatz_person_anhang', CAST(OLD.id AS TEXT) WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = OLD.einsatz_id);
END;
CREATE TRIGGER einsatz_person_anhang_spiegelschutz_i BEFORE INSERT ON einsatz_person_anhang WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = NEW.einsatz_id) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
CREATE TRIGGER einsatz_person_anhang_spiegelschutz_u BEFORE UPDATE ON einsatz_person_anhang WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND (EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = OLD.einsatz_id) OR EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = NEW.einsatz_id)) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
CREATE TRIGGER einsatz_person_anhang_spiegelschutz_d BEFORE DELETE ON einsatz_person_anhang WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = OLD.einsatz_id) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
-- lagebericht_anlage
CREATE TRIGGER lagebericht_anlage_spiegellog_i AFTER INSERT ON lagebericht_anlage WHEN EXISTS (SELECT 1 FROM einsatz WHERE id = NEW.einsatz_id) BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'lagebericht_anlage' AND schluessel = CAST(NEW.id AS TEXT);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) VALUES (NEW.einsatz_id, 'lagebericht_anlage', CAST(NEW.id AS TEXT));
END;
CREATE TRIGGER lagebericht_anlage_spiegellog_u AFTER UPDATE ON lagebericht_anlage BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'lagebericht_anlage' AND schluessel IN (CAST(OLD.id AS TEXT), CAST(NEW.id AS TEXT));
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT OLD.einsatz_id, 'lagebericht_anlage', CAST(OLD.id AS TEXT) WHERE CAST(OLD.id AS TEXT) IS NOT CAST(NEW.id AS TEXT) AND EXISTS (SELECT 1 FROM einsatz WHERE id = OLD.einsatz_id);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT NEW.einsatz_id, 'lagebericht_anlage', CAST(NEW.id AS TEXT) WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = NEW.einsatz_id);
END;
CREATE TRIGGER lagebericht_anlage_spiegellog_d AFTER DELETE ON lagebericht_anlage BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'lagebericht_anlage' AND schluessel = CAST(OLD.id AS TEXT);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT OLD.einsatz_id, 'lagebericht_anlage', CAST(OLD.id AS TEXT) WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = OLD.einsatz_id);
END;
CREATE TRIGGER lagebericht_anlage_spiegelschutz_i BEFORE INSERT ON lagebericht_anlage WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = NEW.einsatz_id) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
CREATE TRIGGER lagebericht_anlage_spiegelschutz_u BEFORE UPDATE ON lagebericht_anlage WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND (EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = OLD.einsatz_id) OR EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = NEW.einsatz_id)) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
CREATE TRIGGER lagebericht_anlage_spiegelschutz_d BEFORE DELETE ON lagebericht_anlage WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = OLD.einsatz_id) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
-- befehl_anlage
CREATE TRIGGER befehl_anlage_spiegellog_i AFTER INSERT ON befehl_anlage WHEN EXISTS (SELECT 1 FROM einsatz WHERE id = NEW.einsatz_id) BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'befehl_anlage' AND schluessel = CAST(NEW.id AS TEXT);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) VALUES (NEW.einsatz_id, 'befehl_anlage', CAST(NEW.id AS TEXT));
END;
CREATE TRIGGER befehl_anlage_spiegellog_u AFTER UPDATE ON befehl_anlage BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'befehl_anlage' AND schluessel IN (CAST(OLD.id AS TEXT), CAST(NEW.id AS TEXT));
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT OLD.einsatz_id, 'befehl_anlage', CAST(OLD.id AS TEXT) WHERE CAST(OLD.id AS TEXT) IS NOT CAST(NEW.id AS TEXT) AND EXISTS (SELECT 1 FROM einsatz WHERE id = OLD.einsatz_id);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT NEW.einsatz_id, 'befehl_anlage', CAST(NEW.id AS TEXT) WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = NEW.einsatz_id);
END;
CREATE TRIGGER befehl_anlage_spiegellog_d AFTER DELETE ON befehl_anlage BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'befehl_anlage' AND schluessel = CAST(OLD.id AS TEXT);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT OLD.einsatz_id, 'befehl_anlage', CAST(OLD.id AS TEXT) WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = OLD.einsatz_id);
END;
CREATE TRIGGER befehl_anlage_spiegelschutz_i BEFORE INSERT ON befehl_anlage WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = NEW.einsatz_id) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
CREATE TRIGGER befehl_anlage_spiegelschutz_u BEFORE UPDATE ON befehl_anlage WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND (EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = OLD.einsatz_id) OR EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = NEW.einsatz_id)) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
CREATE TRIGGER befehl_anlage_spiegelschutz_d BEFORE DELETE ON befehl_anlage WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = OLD.einsatz_id) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
-- etb_eintrag_anhang
CREATE TRIGGER etb_eintrag_anhang_spiegellog_i AFTER INSERT ON etb_eintrag_anhang WHEN EXISTS (SELECT 1 FROM einsatz WHERE id = (SELECT einsatz_id FROM etb_eintrag WHERE id = NEW.eintrag_id)) BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'etb_eintrag_anhang' AND schluessel = json_array(NEW.eintrag_id, NEW.anhang_id);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) VALUES ((SELECT einsatz_id FROM etb_eintrag WHERE id = NEW.eintrag_id), 'etb_eintrag_anhang', json_array(NEW.eintrag_id, NEW.anhang_id));
END;
CREATE TRIGGER etb_eintrag_anhang_spiegellog_u AFTER UPDATE ON etb_eintrag_anhang BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'etb_eintrag_anhang' AND schluessel IN (json_array(OLD.eintrag_id, OLD.anhang_id), json_array(NEW.eintrag_id, NEW.anhang_id));
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT (SELECT einsatz_id FROM etb_eintrag WHERE id = OLD.eintrag_id), 'etb_eintrag_anhang', json_array(OLD.eintrag_id, OLD.anhang_id) WHERE json_array(OLD.eintrag_id, OLD.anhang_id) IS NOT json_array(NEW.eintrag_id, NEW.anhang_id) AND EXISTS (SELECT 1 FROM einsatz WHERE id = (SELECT einsatz_id FROM etb_eintrag WHERE id = OLD.eintrag_id));
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT (SELECT einsatz_id FROM etb_eintrag WHERE id = NEW.eintrag_id), 'etb_eintrag_anhang', json_array(NEW.eintrag_id, NEW.anhang_id) WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = (SELECT einsatz_id FROM etb_eintrag WHERE id = NEW.eintrag_id));
END;
CREATE TRIGGER etb_eintrag_anhang_spiegellog_d AFTER DELETE ON etb_eintrag_anhang BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'etb_eintrag_anhang' AND schluessel = json_array(OLD.eintrag_id, OLD.anhang_id);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT (SELECT einsatz_id FROM etb_eintrag WHERE id = OLD.eintrag_id), 'etb_eintrag_anhang', json_array(OLD.eintrag_id, OLD.anhang_id) WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = (SELECT einsatz_id FROM etb_eintrag WHERE id = OLD.eintrag_id));
END;
CREATE TRIGGER etb_eintrag_anhang_spiegelschutz_i BEFORE INSERT ON etb_eintrag_anhang WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = (SELECT einsatz_id FROM etb_eintrag WHERE id = NEW.eintrag_id)) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
CREATE TRIGGER etb_eintrag_anhang_spiegelschutz_u BEFORE UPDATE ON etb_eintrag_anhang WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND (EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = (SELECT einsatz_id FROM etb_eintrag WHERE id = OLD.eintrag_id)) OR EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = (SELECT einsatz_id FROM etb_eintrag WHERE id = NEW.eintrag_id))) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
CREATE TRIGGER etb_eintrag_anhang_spiegelschutz_d BEFORE DELETE ON etb_eintrag_anhang WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = (SELECT einsatz_id FROM etb_eintrag WHERE id = OLD.eintrag_id)) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
-- chat_nachricht_anhang
CREATE TRIGGER chat_nachricht_anhang_spiegellog_i AFTER INSERT ON chat_nachricht_anhang WHEN EXISTS (SELECT 1 FROM einsatz WHERE id = (SELECT einsatz_id FROM chat_nachricht WHERE id = NEW.nachricht_id)) BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'chat_nachricht_anhang' AND schluessel = json_array(NEW.nachricht_id, NEW.anhang_id);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) VALUES ((SELECT einsatz_id FROM chat_nachricht WHERE id = NEW.nachricht_id), 'chat_nachricht_anhang', json_array(NEW.nachricht_id, NEW.anhang_id));
END;
CREATE TRIGGER chat_nachricht_anhang_spiegellog_u AFTER UPDATE ON chat_nachricht_anhang BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'chat_nachricht_anhang' AND schluessel IN (json_array(OLD.nachricht_id, OLD.anhang_id), json_array(NEW.nachricht_id, NEW.anhang_id));
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT (SELECT einsatz_id FROM chat_nachricht WHERE id = OLD.nachricht_id), 'chat_nachricht_anhang', json_array(OLD.nachricht_id, OLD.anhang_id) WHERE json_array(OLD.nachricht_id, OLD.anhang_id) IS NOT json_array(NEW.nachricht_id, NEW.anhang_id) AND EXISTS (SELECT 1 FROM einsatz WHERE id = (SELECT einsatz_id FROM chat_nachricht WHERE id = OLD.nachricht_id));
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT (SELECT einsatz_id FROM chat_nachricht WHERE id = NEW.nachricht_id), 'chat_nachricht_anhang', json_array(NEW.nachricht_id, NEW.anhang_id) WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = (SELECT einsatz_id FROM chat_nachricht WHERE id = NEW.nachricht_id));
END;
CREATE TRIGGER chat_nachricht_anhang_spiegellog_d AFTER DELETE ON chat_nachricht_anhang BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'chat_nachricht_anhang' AND schluessel = json_array(OLD.nachricht_id, OLD.anhang_id);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT (SELECT einsatz_id FROM chat_nachricht WHERE id = OLD.nachricht_id), 'chat_nachricht_anhang', json_array(OLD.nachricht_id, OLD.anhang_id) WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = (SELECT einsatz_id FROM chat_nachricht WHERE id = OLD.nachricht_id));
END;
CREATE TRIGGER chat_nachricht_anhang_spiegelschutz_i BEFORE INSERT ON chat_nachricht_anhang WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = (SELECT einsatz_id FROM chat_nachricht WHERE id = NEW.nachricht_id)) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
CREATE TRIGGER chat_nachricht_anhang_spiegelschutz_u BEFORE UPDATE ON chat_nachricht_anhang WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND (EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = (SELECT einsatz_id FROM chat_nachricht WHERE id = OLD.nachricht_id)) OR EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = (SELECT einsatz_id FROM chat_nachricht WHERE id = NEW.nachricht_id))) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
CREATE TRIGGER chat_nachricht_anhang_spiegelschutz_d BEFORE DELETE ON chat_nachricht_anhang WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = (SELECT einsatz_id FROM chat_nachricht WHERE id = OLD.nachricht_id)) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;

-- Grundstock (D1): jede bestehende Zeile einmal als geändert.
INSERT OR IGNORE INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT z.id, 'einsatz', CAST(z.id AS TEXT) FROM einsatz AS z WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = z.id);
INSERT OR IGNORE INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT z.einsatz_id, 'einsatz_mitgliedschaft', json_array(z.einsatz_id, z.benutzer_id) FROM einsatz_mitgliedschaft AS z WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = z.einsatz_id);
INSERT OR IGNORE INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT z.einsatz_id, 'einsatz_einstellungen', CAST(z.einsatz_id AS TEXT) FROM einsatz_einstellungen AS z WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = z.einsatz_id);
INSERT OR IGNORE INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT z.einsatz_id, 'einsatz_modul_override', json_array(z.einsatz_id, z.modul_key) FROM einsatz_modul_override AS z WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = z.einsatz_id);
INSERT OR IGNORE INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT z.einsatz_id, 'einsatz_fuehrungsstelle', CAST(z.einsatz_id AS TEXT) FROM einsatz_fuehrungsstelle AS z WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = z.einsatz_id);
INSERT OR IGNORE INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT z.einsatz_id, 'einsatz_fuehrungsstelle_sprechgruppe', json_array(z.einsatz_id, z.sprechgruppe_id) FROM einsatz_fuehrungsstelle_sprechgruppe AS z WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = z.einsatz_id);
INSERT OR IGNORE INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT z.einsatz_id, 'einsatz_fuehrungsstelle_fahrzeug', json_array(z.einsatz_id, z.einsatz_fahrzeug_id) FROM einsatz_fuehrungsstelle_fahrzeug AS z WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = z.einsatz_id);
INSERT OR IGNORE INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT z.einsatz_id, 'einsatz_lagebesprechung', CAST(z.id AS TEXT) FROM einsatz_lagebesprechung AS z WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = z.einsatz_id);
INSERT OR IGNORE INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT z.einsatz_id, 'einsatz_lagekennzahl_wahl', json_array(z.einsatz_id, z.kennzahl) FROM einsatz_lagekennzahl_wahl AS z WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = z.einsatz_id);
INSERT OR IGNORE INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT z.einsatz_id, 'einsatzabschnitt', CAST(z.id AS TEXT) FROM einsatzabschnitt AS z WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = z.einsatz_id);
INSERT OR IGNORE INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT (SELECT einsatz_id FROM einsatzabschnitt WHERE id = z.abschnitt_id), 'einsatzabschnitt_sprechgruppe', json_array(z.abschnitt_id, z.sprechgruppe_id) FROM einsatzabschnitt_sprechgruppe AS z WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = (SELECT einsatz_id FROM einsatzabschnitt WHERE id = z.abschnitt_id));
INSERT OR IGNORE INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT z.einsatz_id, 'erinnerung', CAST(z.id AS TEXT) FROM erinnerung AS z WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = z.einsatz_id);
INSERT OR IGNORE INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT z.einsatz_id, 'programmpunkt', CAST(z.id AS TEXT) FROM programmpunkt AS z WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = z.einsatz_id);
INSERT OR IGNORE INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT z.einsatz_id, 'benachrichtigung', CAST(z.id AS TEXT) FROM benachrichtigung AS z WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = z.einsatz_id);
INSERT OR IGNORE INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT z.einsatz_id, 'benachrichtigung_vorgabe', json_array(z.einsatz_id, z.art, z.funktion) FROM benachrichtigung_vorgabe AS z WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = z.einsatz_id);
INSERT OR IGNORE INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT z.einsatz_id, 'etb_eintrag', CAST(z.id AS TEXT) FROM etb_eintrag AS z WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = z.einsatz_id);
INSERT OR IGNORE INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT (SELECT einsatz_id FROM etb_eintrag WHERE id = z.eintrag_id), 'etb_eintrag_einheit', json_array(z.eintrag_id, z.einheit_id) FROM etb_eintrag_einheit AS z WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = (SELECT einsatz_id FROM etb_eintrag WHERE id = z.eintrag_id));
INSERT OR IGNORE INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT z.einsatz_id, 'lage_zone', CAST(z.id AS TEXT) FROM lage_zone AS z WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = z.einsatz_id);
INSERT OR IGNORE INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT z.einsatz_id, 'gefahrengebiet', CAST(z.id AS TEXT) FROM gefahrengebiet AS z WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = z.einsatz_id);
INSERT OR IGNORE INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT (SELECT einsatz_id FROM gefahrengebiet WHERE id = z.gefahrengebiet_id), 'gefahr_bewertung', CAST(z.id AS TEXT) FROM gefahr_bewertung AS z WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = (SELECT einsatz_id FROM gefahrengebiet WHERE id = z.gefahrengebiet_id));
INSERT OR IGNORE INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT z.einsatz_id, 'freies_zeichen', CAST(z.id AS TEXT) FROM freies_zeichen AS z WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = z.einsatz_id);
INSERT OR IGNORE INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT z.einsatz_id, 'karte_hintergrundbild', CAST(z.id AS TEXT) FROM karte_hintergrundbild AS z WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = z.einsatz_id);
INSERT OR IGNORE INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT z.einsatz_id, 'karten_ansicht', CAST(z.id AS TEXT) FROM karten_ansicht AS z WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = z.einsatz_id);
INSERT OR IGNORE INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT z.einsatz_id, 'lage_snapshot', CAST(z.id AS TEXT) FROM lage_snapshot AS z WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = z.einsatz_id);
INSERT OR IGNORE INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT z.einsatz_id, 'einsatz_pegel', CAST(z.id AS TEXT) FROM einsatz_pegel AS z WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = z.einsatz_id);
INSERT OR IGNORE INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT z.einsatz_id, 'einsatz_schaden', CAST(z.id AS TEXT) FROM einsatz_schaden AS z WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = z.einsatz_id);
INSERT OR IGNORE INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT z.einsatz_id, 'einsatz_tier', CAST(z.id AS TEXT) FROM einsatz_tier AS z WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = z.einsatz_id);
INSERT OR IGNORE INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT z.einsatz_id, 'einsatz_einheit', CAST(z.id AS TEXT) FROM einsatz_einheit AS z WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = z.einsatz_id);
INSERT OR IGNORE INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT (SELECT einsatz_id FROM einsatz_einheit WHERE id = z.einheit_id), 'einsatz_einheit_letzte_besetzung', CAST(z.id AS TEXT) FROM einsatz_einheit_letzte_besetzung AS z WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = (SELECT einsatz_id FROM einsatz_einheit WHERE id = z.einheit_id));
INSERT OR IGNORE INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT (SELECT einsatz_id FROM einsatz_einheit WHERE id = z.einheit_id), 'einsatz_einheit_sprechgruppe', json_array(z.einheit_id, z.sprechgruppe_id) FROM einsatz_einheit_sprechgruppe AS z WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = (SELECT einsatz_id FROM einsatz_einheit WHERE id = z.einheit_id));
INSERT OR IGNORE INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT z.einsatz_id, 'einsatz_fahrzeug', CAST(z.id AS TEXT) FROM einsatz_fahrzeug AS z WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = z.einsatz_id);
INSERT OR IGNORE INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT z.einsatz_id, 'einsatz_material', CAST(z.id AS TEXT) FROM einsatz_material AS z WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = z.einsatz_id);
INSERT OR IGNORE INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT z.einsatz_id, 'einsatz_personal', CAST(z.id AS TEXT) FROM einsatz_personal AS z WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = z.einsatz_id);
INSERT OR IGNORE INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT z.einsatz_id, 'einsatz_abloesung', CAST(z.id AS TEXT) FROM einsatz_abloesung AS z WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = z.einsatz_id);
INSERT OR IGNORE INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT (SELECT einsatz_id FROM einsatz_abloesung WHERE id = z.abloesung_id), 'einsatz_abloesung_abloeser', json_array(z.abloesung_id, z.einheit_id) FROM einsatz_abloesung_abloeser AS z WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = (SELECT einsatz_id FROM einsatz_abloesung WHERE id = z.abloesung_id));
INSERT OR IGNORE INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT (SELECT einsatz_id FROM einsatz_abloesung WHERE id = z.abloesung_id), 'einsatz_abloesung_br_buchung', json_array(z.abloesung_id, z.belegung_id) FROM einsatz_abloesung_br_buchung AS z WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = (SELECT einsatz_id FROM einsatz_abloesung WHERE id = z.abloesung_id));
INSERT OR IGNORE INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT (SELECT einsatz_id FROM einsatz_abloesung WHERE id = z.abloesung_id), 'einsatz_abloesung_besatzung', json_array(z.abloesung_id, z.personal_id) FROM einsatz_abloesung_besatzung AS z WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = (SELECT einsatz_id FROM einsatz_abloesung WHERE id = z.abloesung_id));
INSERT OR IGNORE INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT (SELECT einsatz_id FROM einsatz_abloesung WHERE id = z.abloesung_id), 'einsatz_abloesung_besatzung_plan', json_array(z.abloesung_id, z.personal_id) FROM einsatz_abloesung_besatzung_plan AS z WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = (SELECT einsatz_id FROM einsatz_abloesung WHERE id = z.abloesung_id));
INSERT OR IGNORE INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT (SELECT einsatz_id FROM einsatz_abloesung WHERE id = z.abloesung_id), 'einsatz_abloesung_planung_vorher', json_array(z.abloesung_id, z.einheit_id) FROM einsatz_abloesung_planung_vorher AS z WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = (SELECT einsatz_id FROM einsatz_abloesung WHERE id = z.abloesung_id));
INSERT OR IGNORE INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT z.einsatz_id, 'einsatz_plan_helfer', CAST(z.id AS TEXT) FROM einsatz_plan_helfer AS z WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = z.einsatz_id);
INSERT OR IGNORE INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT z.einsatz_id, 'einsatz_planschicht', CAST(z.id AS TEXT) FROM einsatz_planschicht AS z WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = z.einsatz_id);
INSERT OR IGNORE INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT (SELECT einsatz_id FROM einsatz_planschicht WHERE id = z.planschicht_id), 'einsatz_planschicht_person', CAST(z.rowid AS TEXT) FROM einsatz_planschicht_person AS z WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = (SELECT einsatz_id FROM einsatz_planschicht WHERE id = z.planschicht_id));
INSERT OR IGNORE INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT z.einsatz_id, 'einsatz_plan_wechsel', CAST(z.id AS TEXT) FROM einsatz_plan_wechsel AS z WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = z.einsatz_id);
INSERT OR IGNORE INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT (SELECT einsatz_id FROM einsatz_plan_wechsel WHERE id = z.wechsel_id), 'einsatz_plan_wechsel_person', json_array(z.wechsel_id, z.einsatz_personal_id) FROM einsatz_plan_wechsel_person AS z WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = (SELECT einsatz_id FROM einsatz_plan_wechsel WHERE id = z.wechsel_id));
INSERT OR IGNORE INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT z.einsatz_id, 'einsatz_schichtmodell', CAST(z.einsatz_id AS TEXT) FROM einsatz_schichtmodell AS z WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = z.einsatz_id);
INSERT OR IGNORE INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT z.einsatz_id, 'einsatz_kraft_zeitachse', CAST(z.id AS TEXT) FROM einsatz_kraft_zeitachse AS z WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = z.einsatz_id);
INSERT OR IGNORE INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT z.einsatz_id, 'bereitstellungsraum', CAST(z.id AS TEXT) FROM bereitstellungsraum AS z WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = z.einsatz_id);
INSERT OR IGNORE INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT z.einsatz_id, 'br_belegung', CAST(z.id AS TEXT) FROM br_belegung AS z WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = z.einsatz_id);
INSERT OR IGNORE INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT z.einsatz_id, 'einsatz_person', CAST(z.id AS TEXT) FROM einsatz_person AS z WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = z.einsatz_id);
INSERT OR IGNORE INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT z.einsatz_id, 'person_anlass', CAST(z.id AS TEXT) FROM person_anlass AS z WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = z.einsatz_id);
INSERT OR IGNORE INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT z.einsatz_id, 'person_transport', CAST(z.id AS TEXT) FROM person_transport AS z WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = z.einsatz_id);
INSERT OR IGNORE INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT z.einsatz_id, 'person_sichtung', CAST(z.id AS TEXT) FROM person_sichtung AS z WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = z.einsatz_id);
INSERT OR IGNORE INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT z.einsatz_id, 'person_massnahme', CAST(z.id AS TEXT) FROM person_massnahme AS z WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = z.einsatz_id);
INSERT OR IGNORE INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT z.einsatz_id, 'person_verletzung', CAST(z.id AS TEXT) FROM person_verletzung AS z WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = z.einsatz_id);
INSERT OR IGNORE INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT z.einsatz_id, 'person_verlaufsnotiz', CAST(z.id AS TEXT) FROM person_verlaufsnotiz AS z WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = z.einsatz_id);
INSERT OR IGNORE INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT z.einsatz_id, 'person_verbleib', CAST(z.id AS TEXT) FROM person_verbleib AS z WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = z.einsatz_id);
INSERT OR IGNORE INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT z.einsatz_id, 'person_uhs_belegung', CAST(z.id AS TEXT) FROM person_uhs_belegung AS z WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = z.einsatz_id);
INSERT OR IGNORE INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT z.einsatz_id, 'person_abgleich', CAST(z.id AS TEXT) FROM person_abgleich AS z WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = z.einsatz_id);
INSERT OR IGNORE INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT z.einsatz_id, 'uhs', CAST(z.id AS TEXT) FROM uhs AS z WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = z.einsatz_id);
INSERT OR IGNORE INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT (SELECT einsatz_id FROM uhs WHERE id = z.uhs_id), 'uhs_platz', CAST(z.id AS TEXT) FROM uhs_platz AS z WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = (SELECT einsatz_id FROM uhs WHERE id = z.uhs_id));
INSERT OR IGNORE INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT z.einsatz_id, 'evakuierungsbezirk', CAST(z.id AS TEXT) FROM evakuierungsbezirk AS z WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = z.einsatz_id);
INSERT OR IGNORE INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT z.einsatz_id, 'evakuierung_stand', CAST(z.id AS TEXT) FROM evakuierung_stand AS z WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = z.einsatz_id);
INSERT OR IGNORE INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT z.einsatz_id, 'haushalt', CAST(z.id AS TEXT) FROM haushalt AS z WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = z.einsatz_id);
INSERT OR IGNORE INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT z.einsatz_id, 'betreuungsstelle', CAST(z.id AS TEXT) FROM betreuungsstelle AS z WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = z.einsatz_id);
INSERT OR IGNORE INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT z.einsatz_id, 'betreuungsstelle_belegung', CAST(z.id AS TEXT) FROM betreuungsstelle_belegung AS z WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = z.einsatz_id);
INSERT OR IGNORE INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT z.einsatz_id, 'verpflegung_zeitfenster', CAST(z.id AS TEXT) FROM verpflegung_zeitfenster AS z WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = z.einsatz_id);
INSERT OR IGNORE INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT z.einsatz_id, 'verpflegungsstelle', CAST(z.id AS TEXT) FROM verpflegungsstelle AS z WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = z.einsatz_id);
INSERT OR IGNORE INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT z.einsatz_id, 'verpflegung_zeitfenster_stelle', json_array(z.zeitfenster_id, z.stelle_id) FROM verpflegung_zeitfenster_stelle AS z WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = z.einsatz_id);
INSERT OR IGNORE INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT z.einsatz_id, 'verpflegung_ausgabe', CAST(z.id AS TEXT) FROM verpflegung_ausgabe AS z WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = z.einsatz_id);
INSERT OR IGNORE INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT z.einsatz_id, 'einsatz_unterkunft_richtwert', json_array(z.einsatz_id, z.schluessel) FROM einsatz_unterkunft_richtwert AS z WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = z.einsatz_id);
INSERT OR IGNORE INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT z.einsatz_id, 'meldung', CAST(z.id AS TEXT) FROM meldung AS z WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = z.einsatz_id);
INSERT OR IGNORE INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT z.einsatz_id, 'auftrag', CAST(z.id AS TEXT) FROM auftrag AS z WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = z.einsatz_id);
INSERT OR IGNORE INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT (SELECT einsatz_id FROM auftrag WHERE id = z.auftrag_id), 'auftrag_empfaenger', CAST(z.id AS TEXT) FROM auftrag_empfaenger AS z WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = (SELECT einsatz_id FROM auftrag WHERE id = z.auftrag_id));
INSERT OR IGNORE INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT z.einsatz_id, 'befehl', CAST(z.id AS TEXT) FROM befehl AS z WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = z.einsatz_id);
INSERT OR IGNORE INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT z.einsatz_id, 'befehl_verteiler', CAST(z.id AS TEXT) FROM befehl_verteiler AS z WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = z.einsatz_id);
INSERT OR IGNORE INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT z.einsatz_id, 'lagebericht', CAST(z.id AS TEXT) FROM lagebericht AS z WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = z.einsatz_id);
INSERT OR IGNORE INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT z.einsatz_id, 'lagebericht_verteiler', CAST(z.id AS TEXT) FROM lagebericht_verteiler AS z WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = z.einsatz_id);
INSERT OR IGNORE INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT z.einsatz_id, 'nachforderung', CAST(z.id AS TEXT) FROM nachforderung AS z WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = z.einsatz_id);
INSERT OR IGNORE INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT z.einsatz_id, 'infotelefon_anruf', CAST(z.id AS TEXT) FROM infotelefon_anruf AS z WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = z.einsatz_id);
INSERT OR IGNORE INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT z.einsatz_id, 'chat_kanal', CAST(z.id AS TEXT) FROM chat_kanal AS z WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = z.einsatz_id);
INSERT OR IGNORE INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT z.einsatz_id, 'chat_nachricht', CAST(z.id AS TEXT) FROM chat_nachricht AS z WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = z.einsatz_id);
INSERT OR IGNORE INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT (SELECT einsatz_id FROM chat_nachricht WHERE id = z.nachricht_id), 'chat_erwaehnung', CAST(z.id AS TEXT) FROM chat_erwaehnung AS z WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = (SELECT einsatz_id FROM chat_nachricht WHERE id = z.nachricht_id));
INSERT OR IGNORE INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT z.einsatz_id, 'kommunikation_status', CAST(z.id AS TEXT) FROM kommunikation_status AS z WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = z.einsatz_id);
INSERT OR IGNORE INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT z.einsatz_id, 'kommunikation_zustellung', CAST(z.id AS TEXT) FROM kommunikation_zustellung AS z WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = z.einsatz_id);
INSERT OR IGNORE INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT z.einsatz_id, 'sprechgruppe', CAST(z.id AS TEXT) FROM sprechgruppe AS z WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = z.einsatz_id);
INSERT OR IGNORE INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT z.einsatz_id, 'einsatz_verbindung', CAST(z.id AS TEXT) FROM einsatz_verbindung AS z WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = z.einsatz_id);
INSERT OR IGNORE INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT z.einsatz_id, 'einsatz_kommunikation_stelle', CAST(z.id AS TEXT) FROM einsatz_kommunikation_stelle AS z WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = z.einsatz_id);
INSERT OR IGNORE INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT z.einsatz_id, 'einsatz_kommunikation_verbindung', CAST(z.id AS TEXT) FROM einsatz_kommunikation_verbindung AS z WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = z.einsatz_id);
INSERT OR IGNORE INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT (SELECT einsatz_id FROM einsatz_kommunikation_stelle WHERE id = z.stelle_id), 'einsatz_kommunikation_stelle_sprechgruppe', json_array(z.stelle_id, z.sprechgruppe_id) FROM einsatz_kommunikation_stelle_sprechgruppe AS z WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = (SELECT einsatz_id FROM einsatz_kommunikation_stelle WHERE id = z.stelle_id));
INSERT OR IGNORE INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT z.einsatz_id, 'fernmeldeskizze_komponente', CAST(z.id AS TEXT) FROM fernmeldeskizze_komponente AS z WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = z.einsatz_id);
INSERT OR IGNORE INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT (SELECT einsatz_id FROM fernmeldeskizze_komponente WHERE id = z.komponente_id), 'fernmeldeskizze_komponente_sprechgruppe', json_array(z.komponente_id, z.sprechgruppe_id) FROM fernmeldeskizze_komponente_sprechgruppe AS z WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = (SELECT einsatz_id FROM fernmeldeskizze_komponente WHERE id = z.komponente_id));
INSERT OR IGNORE INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT z.einsatz_id, 'fernmeldeskizze_verbindung', CAST(z.id AS TEXT) FROM fernmeldeskizze_verbindung AS z WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = z.einsatz_id);
INSERT OR IGNORE INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT z.einsatz_id, 'fernmeldeskizze_bereich', CAST(z.id AS TEXT) FROM fernmeldeskizze_bereich AS z WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = z.einsatz_id);
INSERT OR IGNORE INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT z.einsatz_id, 'fernmeldeskizze_lage', json_array(z.einsatz_id, z.element) FROM fernmeldeskizze_lage AS z WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = z.einsatz_id);
INSERT OR IGNORE INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT z.einsatz_id, 'fernmeldeskizze_schriftfeld', CAST(z.einsatz_id AS TEXT) FROM fernmeldeskizze_schriftfeld AS z WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = z.einsatz_id);
INSERT OR IGNORE INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT z.einsatz_id, 'anhang', CAST(z.id AS TEXT) FROM anhang AS z WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = z.einsatz_id);
INSERT OR IGNORE INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT (SELECT einsatz_id FROM karte_hintergrundbild WHERE id = z.bild_id), 'karte_hintergrundbild_daten', CAST(z.bild_id AS TEXT) FROM karte_hintergrundbild_daten AS z WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = (SELECT einsatz_id FROM karte_hintergrundbild WHERE id = z.bild_id));
INSERT OR IGNORE INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT z.einsatz_id, 'uhs_plan', CAST(z.uhs_id AS TEXT) FROM uhs_plan AS z WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = z.einsatz_id);
INSERT OR IGNORE INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT z.einsatz_id, 'einsatz_dokument', CAST(z.id AS TEXT) FROM einsatz_dokument AS z WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = z.einsatz_id);
INSERT OR IGNORE INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT z.einsatz_id, 'einsatz_schaden_anhang', CAST(z.id AS TEXT) FROM einsatz_schaden_anhang AS z WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = z.einsatz_id);
INSERT OR IGNORE INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT z.einsatz_id, 'einsatz_tier_anhang', CAST(z.id AS TEXT) FROM einsatz_tier_anhang AS z WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = z.einsatz_id);
INSERT OR IGNORE INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT z.einsatz_id, 'uhs_anhang', CAST(z.id AS TEXT) FROM uhs_anhang AS z WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = z.einsatz_id);
INSERT OR IGNORE INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT z.einsatz_id, 'einsatz_person_anhang', CAST(z.id AS TEXT) FROM einsatz_person_anhang AS z WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = z.einsatz_id);
INSERT OR IGNORE INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT z.einsatz_id, 'lagebericht_anlage', CAST(z.id AS TEXT) FROM lagebericht_anlage AS z WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = z.einsatz_id);
INSERT OR IGNORE INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT z.einsatz_id, 'befehl_anlage', CAST(z.id AS TEXT) FROM befehl_anlage AS z WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = z.einsatz_id);
INSERT OR IGNORE INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT (SELECT einsatz_id FROM etb_eintrag WHERE id = z.eintrag_id), 'etb_eintrag_anhang', json_array(z.eintrag_id, z.anhang_id) FROM etb_eintrag_anhang AS z WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = (SELECT einsatz_id FROM etb_eintrag WHERE id = z.eintrag_id));
INSERT OR IGNORE INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT (SELECT einsatz_id FROM chat_nachricht WHERE id = z.nachricht_id), 'chat_nachricht_anhang', json_array(z.nachricht_id, z.anhang_id) FROM chat_nachricht_anhang AS z WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = (SELECT einsatz_id FROM chat_nachricht WHERE id = z.nachricht_id));
