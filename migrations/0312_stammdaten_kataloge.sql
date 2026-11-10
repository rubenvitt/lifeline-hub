-- LLH-1613: übrige Kataloge an gekoppelte ELW (Change kjezbk06-stammdaten-kataloge, design.md
-- D1, D2; Verfahren aus 0306 / Change ca8v0psv-stammdaten-verteilung). Rein additiv: Log- und
-- Schutz-Trigger je verteilter Tabelle und ihr Grundstock im Änderungslog. Der Guard
-- `instanz::stammdaten::art::tests::trigger_und_spalten_passen_zur_beschreibung` vergleicht die
-- Trigger mit `src/instanz/stammdaten/art.rs`.
--
-- Sprechgruppen: nur der Org-Katalog (`einsatz_id IS NULL`, D2). Eine einsatz-lokale Gruppe
-- schreibt nichts ins Log; die Schutz-Trigger brauchen die Bedingung nicht, denn eine
-- einsatz-lokale Gruppe hat nie eine Herkunft.

-- Grundstock: was schon besteht, gilt als einmal geändert. Das neue Empfangskennzeichen einer
-- aktualisierten Instanz startet ihre Nachlieferung ohnehin bei 0.
INSERT INTO stammdaten_aenderung (org_id, art, schluessel)
    SELECT org_id, 'schichtmodell', CAST(id AS TEXT) FROM schichtmodell
    UNION ALL SELECT org_id, 'einsatz_vorlage', CAST(id AS TEXT) FROM einsatz_vorlage
    UNION ALL SELECT org_id, 'stichwort_vorschlag', CAST(id AS TEXT) FROM einsatz_stichwort_vorschlag
    UNION ALL SELECT org_id, 'verpflegung_vorlage', CAST(id AS TEXT) FROM verpflegung_vorlage
    UNION ALL SELECT org_id, 'sprechgruppe', CAST(id AS TEXT) FROM sprechgruppe WHERE einsatz_id IS NULL
    UNION ALL SELECT org_id, 'etb_baustein', CAST(id AS TEXT) FROM etb_baustein
    UNION ALL SELECT org_id, 'externe_stelle', CAST(id AS TEXT) FROM org_externe_stelle
    UNION ALL SELECT org_id, 'unterkunft_richtwert', schluessel FROM org_unterkunft_richtwert;

-- schichtmodell (schichtmodell)
CREATE TRIGGER schichtmodell_log_i AFTER INSERT ON schichtmodell
BEGIN
    DELETE FROM stammdaten_aenderung WHERE org_id = NEW.org_id AND art = 'schichtmodell' AND schluessel = CAST(NEW.id AS TEXT);
    INSERT INTO stammdaten_aenderung (org_id, art, schluessel) VALUES (NEW.org_id, 'schichtmodell', CAST(NEW.id AS TEXT));
END;
CREATE TRIGGER schichtmodell_log_u AFTER UPDATE ON schichtmodell
BEGIN
    DELETE FROM stammdaten_aenderung WHERE org_id = OLD.org_id AND art = 'schichtmodell' AND schluessel = CAST(OLD.id AS TEXT);
    INSERT INTO stammdaten_aenderung (org_id, art, schluessel) VALUES (OLD.org_id, 'schichtmodell', CAST(OLD.id AS TEXT));
    DELETE FROM stammdaten_aenderung WHERE org_id = NEW.org_id AND art = 'schichtmodell' AND schluessel = CAST(NEW.id AS TEXT);
    INSERT INTO stammdaten_aenderung (org_id, art, schluessel) VALUES (NEW.org_id, 'schichtmodell', CAST(NEW.id AS TEXT));
END;
CREATE TRIGGER schichtmodell_log_d AFTER DELETE ON schichtmodell
BEGIN
    DELETE FROM stammdaten_aenderung WHERE org_id = OLD.org_id AND art = 'schichtmodell' AND schluessel = CAST(OLD.id AS TEXT);
    INSERT INTO stammdaten_aenderung (org_id, art, schluessel) VALUES (OLD.org_id, 'schichtmodell', CAST(OLD.id AS TEXT));
END;
CREATE TRIGGER schichtmodell_schutz_u BEFORE UPDATE ON schichtmodell
WHEN EXISTS (SELECT 1 FROM stammdaten_herkunft h WHERE h.art = 'schichtmodell' AND h.org_id = OLD.org_id AND h.lokaler_schluessel = CAST(OLD.id AS TEXT))
    AND NOT EXISTS (SELECT 1 FROM stammdaten_uebernahme)
BEGIN
    SELECT RAISE(ABORT, 'stammdaten_vom_hub');
END;

CREATE TRIGGER schichtmodell_schutz_d BEFORE DELETE ON schichtmodell
WHEN EXISTS (SELECT 1 FROM stammdaten_herkunft h WHERE h.art = 'schichtmodell' AND h.org_id = OLD.org_id AND h.lokaler_schluessel = CAST(OLD.id AS TEXT))
    AND NOT EXISTS (SELECT 1 FROM stammdaten_uebernahme)
BEGIN
    SELECT RAISE(ABORT, 'stammdaten_vom_hub');
END;

-- einsatz_vorlage (einsatz_vorlage)
CREATE TRIGGER einsatz_vorlage_log_i AFTER INSERT ON einsatz_vorlage
BEGIN
    DELETE FROM stammdaten_aenderung WHERE org_id = NEW.org_id AND art = 'einsatz_vorlage' AND schluessel = CAST(NEW.id AS TEXT);
    INSERT INTO stammdaten_aenderung (org_id, art, schluessel) VALUES (NEW.org_id, 'einsatz_vorlage', CAST(NEW.id AS TEXT));
END;
CREATE TRIGGER einsatz_vorlage_log_u AFTER UPDATE ON einsatz_vorlage
BEGIN
    DELETE FROM stammdaten_aenderung WHERE org_id = OLD.org_id AND art = 'einsatz_vorlage' AND schluessel = CAST(OLD.id AS TEXT);
    INSERT INTO stammdaten_aenderung (org_id, art, schluessel) VALUES (OLD.org_id, 'einsatz_vorlage', CAST(OLD.id AS TEXT));
    DELETE FROM stammdaten_aenderung WHERE org_id = NEW.org_id AND art = 'einsatz_vorlage' AND schluessel = CAST(NEW.id AS TEXT);
    INSERT INTO stammdaten_aenderung (org_id, art, schluessel) VALUES (NEW.org_id, 'einsatz_vorlage', CAST(NEW.id AS TEXT));
END;
CREATE TRIGGER einsatz_vorlage_log_d AFTER DELETE ON einsatz_vorlage
BEGIN
    DELETE FROM stammdaten_aenderung WHERE org_id = OLD.org_id AND art = 'einsatz_vorlage' AND schluessel = CAST(OLD.id AS TEXT);
    INSERT INTO stammdaten_aenderung (org_id, art, schluessel) VALUES (OLD.org_id, 'einsatz_vorlage', CAST(OLD.id AS TEXT));
END;
CREATE TRIGGER einsatz_vorlage_schutz_u BEFORE UPDATE ON einsatz_vorlage
WHEN EXISTS (SELECT 1 FROM stammdaten_herkunft h WHERE h.art = 'einsatz_vorlage' AND h.org_id = OLD.org_id AND h.lokaler_schluessel = CAST(OLD.id AS TEXT))
    AND NOT EXISTS (SELECT 1 FROM stammdaten_uebernahme)
BEGIN
    SELECT RAISE(ABORT, 'stammdaten_vom_hub');
END;

CREATE TRIGGER einsatz_vorlage_schutz_d BEFORE DELETE ON einsatz_vorlage
WHEN EXISTS (SELECT 1 FROM stammdaten_herkunft h WHERE h.art = 'einsatz_vorlage' AND h.org_id = OLD.org_id AND h.lokaler_schluessel = CAST(OLD.id AS TEXT))
    AND NOT EXISTS (SELECT 1 FROM stammdaten_uebernahme)
BEGIN
    SELECT RAISE(ABORT, 'stammdaten_vom_hub');
END;

-- einsatz_stichwort_vorschlag (stichwort_vorschlag)
CREATE TRIGGER einsatz_stichwort_vorschlag_log_i AFTER INSERT ON einsatz_stichwort_vorschlag
BEGIN
    DELETE FROM stammdaten_aenderung WHERE org_id = NEW.org_id AND art = 'stichwort_vorschlag' AND schluessel = CAST(NEW.id AS TEXT);
    INSERT INTO stammdaten_aenderung (org_id, art, schluessel) VALUES (NEW.org_id, 'stichwort_vorschlag', CAST(NEW.id AS TEXT));
END;
CREATE TRIGGER einsatz_stichwort_vorschlag_log_u AFTER UPDATE ON einsatz_stichwort_vorschlag
BEGIN
    DELETE FROM stammdaten_aenderung WHERE org_id = OLD.org_id AND art = 'stichwort_vorschlag' AND schluessel = CAST(OLD.id AS TEXT);
    INSERT INTO stammdaten_aenderung (org_id, art, schluessel) VALUES (OLD.org_id, 'stichwort_vorschlag', CAST(OLD.id AS TEXT));
    DELETE FROM stammdaten_aenderung WHERE org_id = NEW.org_id AND art = 'stichwort_vorschlag' AND schluessel = CAST(NEW.id AS TEXT);
    INSERT INTO stammdaten_aenderung (org_id, art, schluessel) VALUES (NEW.org_id, 'stichwort_vorschlag', CAST(NEW.id AS TEXT));
END;
CREATE TRIGGER einsatz_stichwort_vorschlag_log_d AFTER DELETE ON einsatz_stichwort_vorschlag
BEGIN
    DELETE FROM stammdaten_aenderung WHERE org_id = OLD.org_id AND art = 'stichwort_vorschlag' AND schluessel = CAST(OLD.id AS TEXT);
    INSERT INTO stammdaten_aenderung (org_id, art, schluessel) VALUES (OLD.org_id, 'stichwort_vorschlag', CAST(OLD.id AS TEXT));
END;
CREATE TRIGGER einsatz_stichwort_vorschlag_schutz_u BEFORE UPDATE ON einsatz_stichwort_vorschlag
WHEN EXISTS (SELECT 1 FROM stammdaten_herkunft h WHERE h.art = 'stichwort_vorschlag' AND h.org_id = OLD.org_id AND h.lokaler_schluessel = CAST(OLD.id AS TEXT))
    AND NOT EXISTS (SELECT 1 FROM stammdaten_uebernahme)
BEGIN
    SELECT RAISE(ABORT, 'stammdaten_vom_hub');
END;

CREATE TRIGGER einsatz_stichwort_vorschlag_schutz_d BEFORE DELETE ON einsatz_stichwort_vorschlag
WHEN EXISTS (SELECT 1 FROM stammdaten_herkunft h WHERE h.art = 'stichwort_vorschlag' AND h.org_id = OLD.org_id AND h.lokaler_schluessel = CAST(OLD.id AS TEXT))
    AND NOT EXISTS (SELECT 1 FROM stammdaten_uebernahme)
BEGIN
    SELECT RAISE(ABORT, 'stammdaten_vom_hub');
END;

-- verpflegung_vorlage (verpflegung_vorlage)
CREATE TRIGGER verpflegung_vorlage_log_i AFTER INSERT ON verpflegung_vorlage
BEGIN
    DELETE FROM stammdaten_aenderung WHERE org_id = NEW.org_id AND art = 'verpflegung_vorlage' AND schluessel = CAST(NEW.id AS TEXT);
    INSERT INTO stammdaten_aenderung (org_id, art, schluessel) VALUES (NEW.org_id, 'verpflegung_vorlage', CAST(NEW.id AS TEXT));
END;
CREATE TRIGGER verpflegung_vorlage_log_u AFTER UPDATE ON verpflegung_vorlage
BEGIN
    DELETE FROM stammdaten_aenderung WHERE org_id = OLD.org_id AND art = 'verpflegung_vorlage' AND schluessel = CAST(OLD.id AS TEXT);
    INSERT INTO stammdaten_aenderung (org_id, art, schluessel) VALUES (OLD.org_id, 'verpflegung_vorlage', CAST(OLD.id AS TEXT));
    DELETE FROM stammdaten_aenderung WHERE org_id = NEW.org_id AND art = 'verpflegung_vorlage' AND schluessel = CAST(NEW.id AS TEXT);
    INSERT INTO stammdaten_aenderung (org_id, art, schluessel) VALUES (NEW.org_id, 'verpflegung_vorlage', CAST(NEW.id AS TEXT));
END;
CREATE TRIGGER verpflegung_vorlage_log_d AFTER DELETE ON verpflegung_vorlage
BEGIN
    DELETE FROM stammdaten_aenderung WHERE org_id = OLD.org_id AND art = 'verpflegung_vorlage' AND schluessel = CAST(OLD.id AS TEXT);
    INSERT INTO stammdaten_aenderung (org_id, art, schluessel) VALUES (OLD.org_id, 'verpflegung_vorlage', CAST(OLD.id AS TEXT));
END;
CREATE TRIGGER verpflegung_vorlage_schutz_u BEFORE UPDATE ON verpflegung_vorlage
WHEN EXISTS (SELECT 1 FROM stammdaten_herkunft h WHERE h.art = 'verpflegung_vorlage' AND h.org_id = OLD.org_id AND h.lokaler_schluessel = CAST(OLD.id AS TEXT))
    AND NOT EXISTS (SELECT 1 FROM stammdaten_uebernahme)
BEGIN
    SELECT RAISE(ABORT, 'stammdaten_vom_hub');
END;

CREATE TRIGGER verpflegung_vorlage_schutz_d BEFORE DELETE ON verpflegung_vorlage
WHEN EXISTS (SELECT 1 FROM stammdaten_herkunft h WHERE h.art = 'verpflegung_vorlage' AND h.org_id = OLD.org_id AND h.lokaler_schluessel = CAST(OLD.id AS TEXT))
    AND NOT EXISTS (SELECT 1 FROM stammdaten_uebernahme)
BEGIN
    SELECT RAISE(ABORT, 'stammdaten_vom_hub');
END;

-- sprechgruppe (sprechgruppe)
CREATE TRIGGER sprechgruppe_log_i AFTER INSERT ON sprechgruppe
BEGIN
    DELETE FROM stammdaten_aenderung WHERE org_id = NEW.org_id AND art = 'sprechgruppe' AND schluessel = CAST(NEW.id AS TEXT)
        AND NEW.einsatz_id IS NULL;
    INSERT INTO stammdaten_aenderung (org_id, art, schluessel)
        SELECT NEW.org_id, 'sprechgruppe', CAST(NEW.id AS TEXT) WHERE NEW.einsatz_id IS NULL;
END;
CREATE TRIGGER sprechgruppe_log_u AFTER UPDATE ON sprechgruppe
BEGIN
    DELETE FROM stammdaten_aenderung WHERE org_id = OLD.org_id AND art = 'sprechgruppe' AND schluessel = CAST(OLD.id AS TEXT)
        AND OLD.einsatz_id IS NULL;
    INSERT INTO stammdaten_aenderung (org_id, art, schluessel)
        SELECT OLD.org_id, 'sprechgruppe', CAST(OLD.id AS TEXT) WHERE OLD.einsatz_id IS NULL;
    DELETE FROM stammdaten_aenderung WHERE org_id = NEW.org_id AND art = 'sprechgruppe' AND schluessel = CAST(NEW.id AS TEXT)
        AND NEW.einsatz_id IS NULL;
    INSERT INTO stammdaten_aenderung (org_id, art, schluessel)
        SELECT NEW.org_id, 'sprechgruppe', CAST(NEW.id AS TEXT) WHERE NEW.einsatz_id IS NULL;
END;
CREATE TRIGGER sprechgruppe_log_d AFTER DELETE ON sprechgruppe
BEGIN
    DELETE FROM stammdaten_aenderung WHERE org_id = OLD.org_id AND art = 'sprechgruppe' AND schluessel = CAST(OLD.id AS TEXT)
        AND OLD.einsatz_id IS NULL;
    INSERT INTO stammdaten_aenderung (org_id, art, schluessel)
        SELECT OLD.org_id, 'sprechgruppe', CAST(OLD.id AS TEXT) WHERE OLD.einsatz_id IS NULL;
END;
CREATE TRIGGER sprechgruppe_schutz_u BEFORE UPDATE ON sprechgruppe
WHEN EXISTS (SELECT 1 FROM stammdaten_herkunft h WHERE h.art = 'sprechgruppe' AND h.org_id = OLD.org_id AND h.lokaler_schluessel = CAST(OLD.id AS TEXT))
    AND NOT EXISTS (SELECT 1 FROM stammdaten_uebernahme)
BEGIN
    SELECT RAISE(ABORT, 'stammdaten_vom_hub');
END;

CREATE TRIGGER sprechgruppe_schutz_d BEFORE DELETE ON sprechgruppe
WHEN EXISTS (SELECT 1 FROM stammdaten_herkunft h WHERE h.art = 'sprechgruppe' AND h.org_id = OLD.org_id AND h.lokaler_schluessel = CAST(OLD.id AS TEXT))
    AND NOT EXISTS (SELECT 1 FROM stammdaten_uebernahme)
BEGIN
    SELECT RAISE(ABORT, 'stammdaten_vom_hub');
END;

-- etb_baustein (etb_baustein)
CREATE TRIGGER etb_baustein_log_i AFTER INSERT ON etb_baustein
BEGIN
    DELETE FROM stammdaten_aenderung WHERE org_id = NEW.org_id AND art = 'etb_baustein' AND schluessel = CAST(NEW.id AS TEXT);
    INSERT INTO stammdaten_aenderung (org_id, art, schluessel) VALUES (NEW.org_id, 'etb_baustein', CAST(NEW.id AS TEXT));
END;
CREATE TRIGGER etb_baustein_log_u AFTER UPDATE ON etb_baustein
BEGIN
    DELETE FROM stammdaten_aenderung WHERE org_id = OLD.org_id AND art = 'etb_baustein' AND schluessel = CAST(OLD.id AS TEXT);
    INSERT INTO stammdaten_aenderung (org_id, art, schluessel) VALUES (OLD.org_id, 'etb_baustein', CAST(OLD.id AS TEXT));
    DELETE FROM stammdaten_aenderung WHERE org_id = NEW.org_id AND art = 'etb_baustein' AND schluessel = CAST(NEW.id AS TEXT);
    INSERT INTO stammdaten_aenderung (org_id, art, schluessel) VALUES (NEW.org_id, 'etb_baustein', CAST(NEW.id AS TEXT));
END;
CREATE TRIGGER etb_baustein_log_d AFTER DELETE ON etb_baustein
BEGIN
    DELETE FROM stammdaten_aenderung WHERE org_id = OLD.org_id AND art = 'etb_baustein' AND schluessel = CAST(OLD.id AS TEXT);
    INSERT INTO stammdaten_aenderung (org_id, art, schluessel) VALUES (OLD.org_id, 'etb_baustein', CAST(OLD.id AS TEXT));
END;
CREATE TRIGGER etb_baustein_schutz_u BEFORE UPDATE ON etb_baustein
WHEN EXISTS (SELECT 1 FROM stammdaten_herkunft h WHERE h.art = 'etb_baustein' AND h.org_id = OLD.org_id AND h.lokaler_schluessel = CAST(OLD.id AS TEXT))
    AND NOT EXISTS (SELECT 1 FROM stammdaten_uebernahme)
BEGIN
    SELECT RAISE(ABORT, 'stammdaten_vom_hub');
END;

CREATE TRIGGER etb_baustein_schutz_d BEFORE DELETE ON etb_baustein
WHEN EXISTS (SELECT 1 FROM stammdaten_herkunft h WHERE h.art = 'etb_baustein' AND h.org_id = OLD.org_id AND h.lokaler_schluessel = CAST(OLD.id AS TEXT))
    AND NOT EXISTS (SELECT 1 FROM stammdaten_uebernahme)
BEGIN
    SELECT RAISE(ABORT, 'stammdaten_vom_hub');
END;

-- org_externe_stelle (externe_stelle)
CREATE TRIGGER org_externe_stelle_log_i AFTER INSERT ON org_externe_stelle
BEGIN
    DELETE FROM stammdaten_aenderung WHERE org_id = NEW.org_id AND art = 'externe_stelle' AND schluessel = CAST(NEW.id AS TEXT);
    INSERT INTO stammdaten_aenderung (org_id, art, schluessel) VALUES (NEW.org_id, 'externe_stelle', CAST(NEW.id AS TEXT));
END;
CREATE TRIGGER org_externe_stelle_log_u AFTER UPDATE ON org_externe_stelle
BEGIN
    DELETE FROM stammdaten_aenderung WHERE org_id = OLD.org_id AND art = 'externe_stelle' AND schluessel = CAST(OLD.id AS TEXT);
    INSERT INTO stammdaten_aenderung (org_id, art, schluessel) VALUES (OLD.org_id, 'externe_stelle', CAST(OLD.id AS TEXT));
    DELETE FROM stammdaten_aenderung WHERE org_id = NEW.org_id AND art = 'externe_stelle' AND schluessel = CAST(NEW.id AS TEXT);
    INSERT INTO stammdaten_aenderung (org_id, art, schluessel) VALUES (NEW.org_id, 'externe_stelle', CAST(NEW.id AS TEXT));
END;
CREATE TRIGGER org_externe_stelle_log_d AFTER DELETE ON org_externe_stelle
BEGIN
    DELETE FROM stammdaten_aenderung WHERE org_id = OLD.org_id AND art = 'externe_stelle' AND schluessel = CAST(OLD.id AS TEXT);
    INSERT INTO stammdaten_aenderung (org_id, art, schluessel) VALUES (OLD.org_id, 'externe_stelle', CAST(OLD.id AS TEXT));
END;
CREATE TRIGGER org_externe_stelle_schutz_u BEFORE UPDATE ON org_externe_stelle
WHEN EXISTS (SELECT 1 FROM stammdaten_herkunft h WHERE h.art = 'externe_stelle' AND h.org_id = OLD.org_id AND h.lokaler_schluessel = CAST(OLD.id AS TEXT))
    AND NOT EXISTS (SELECT 1 FROM stammdaten_uebernahme)
BEGIN
    SELECT RAISE(ABORT, 'stammdaten_vom_hub');
END;

CREATE TRIGGER org_externe_stelle_schutz_d BEFORE DELETE ON org_externe_stelle
WHEN EXISTS (SELECT 1 FROM stammdaten_herkunft h WHERE h.art = 'externe_stelle' AND h.org_id = OLD.org_id AND h.lokaler_schluessel = CAST(OLD.id AS TEXT))
    AND NOT EXISTS (SELECT 1 FROM stammdaten_uebernahme)
BEGIN
    SELECT RAISE(ABORT, 'stammdaten_vom_hub');
END;

-- org_unterkunft_richtwert (unterkunft_richtwert)
CREATE TRIGGER org_unterkunft_richtwert_log_i AFTER INSERT ON org_unterkunft_richtwert
BEGIN
    DELETE FROM stammdaten_aenderung WHERE org_id = NEW.org_id AND art = 'unterkunft_richtwert' AND schluessel = CAST(NEW.schluessel AS TEXT);
    INSERT INTO stammdaten_aenderung (org_id, art, schluessel) VALUES (NEW.org_id, 'unterkunft_richtwert', CAST(NEW.schluessel AS TEXT));
END;
CREATE TRIGGER org_unterkunft_richtwert_log_u AFTER UPDATE ON org_unterkunft_richtwert
BEGIN
    DELETE FROM stammdaten_aenderung WHERE org_id = OLD.org_id AND art = 'unterkunft_richtwert' AND schluessel = CAST(OLD.schluessel AS TEXT);
    INSERT INTO stammdaten_aenderung (org_id, art, schluessel) VALUES (OLD.org_id, 'unterkunft_richtwert', CAST(OLD.schluessel AS TEXT));
    DELETE FROM stammdaten_aenderung WHERE org_id = NEW.org_id AND art = 'unterkunft_richtwert' AND schluessel = CAST(NEW.schluessel AS TEXT);
    INSERT INTO stammdaten_aenderung (org_id, art, schluessel) VALUES (NEW.org_id, 'unterkunft_richtwert', CAST(NEW.schluessel AS TEXT));
END;
CREATE TRIGGER org_unterkunft_richtwert_log_d AFTER DELETE ON org_unterkunft_richtwert
BEGIN
    DELETE FROM stammdaten_aenderung WHERE org_id = OLD.org_id AND art = 'unterkunft_richtwert' AND schluessel = CAST(OLD.schluessel AS TEXT);
    INSERT INTO stammdaten_aenderung (org_id, art, schluessel) VALUES (OLD.org_id, 'unterkunft_richtwert', CAST(OLD.schluessel AS TEXT));
END;
CREATE TRIGGER org_unterkunft_richtwert_schutz_u BEFORE UPDATE ON org_unterkunft_richtwert
WHEN EXISTS (SELECT 1 FROM stammdaten_herkunft h WHERE h.art = 'unterkunft_richtwert' AND h.org_id = OLD.org_id AND h.lokaler_schluessel = CAST(OLD.schluessel AS TEXT))
    AND NOT EXISTS (SELECT 1 FROM stammdaten_uebernahme)
BEGIN
    SELECT RAISE(ABORT, 'stammdaten_vom_hub');
END;

CREATE TRIGGER org_unterkunft_richtwert_schutz_d BEFORE DELETE ON org_unterkunft_richtwert
WHEN EXISTS (SELECT 1 FROM stammdaten_herkunft h WHERE h.art = 'unterkunft_richtwert' AND h.org_id = OLD.org_id AND h.lokaler_schluessel = CAST(OLD.schluessel AS TEXT))
    AND NOT EXISTS (SELECT 1 FROM stammdaten_uebernahme)
BEGIN
    SELECT RAISE(ABORT, 'stammdaten_vom_hub');
END;

-- einsatz_vorlage_modul_aus (Unterliste von einsatz_vorlage)
CREATE TRIGGER einsatz_vorlage_modul_aus_log_i AFTER INSERT ON einsatz_vorlage_modul_aus
BEGIN
    DELETE FROM stammdaten_aenderung WHERE art = 'einsatz_vorlage' AND schluessel = CAST(NEW.vorlage_id AS TEXT)
        AND org_id = (SELECT org_id FROM einsatz_vorlage WHERE id = NEW.vorlage_id);
    INSERT INTO stammdaten_aenderung (org_id, art, schluessel)
        SELECT org_id, 'einsatz_vorlage', CAST(id AS TEXT) FROM einsatz_vorlage WHERE id = NEW.vorlage_id;
END;
CREATE TRIGGER einsatz_vorlage_modul_aus_schutz_i BEFORE INSERT ON einsatz_vorlage_modul_aus
WHEN EXISTS (SELECT 1 FROM stammdaten_herkunft h JOIN einsatz_vorlage e ON e.id = NEW.vorlage_id
        WHERE h.art = 'einsatz_vorlage' AND h.org_id = e.org_id AND h.lokaler_schluessel = CAST(e.id AS TEXT))
    AND NOT EXISTS (SELECT 1 FROM stammdaten_uebernahme)
BEGIN
    SELECT RAISE(ABORT, 'stammdaten_vom_hub');
END;

CREATE TRIGGER einsatz_vorlage_modul_aus_log_u AFTER UPDATE ON einsatz_vorlage_modul_aus
BEGIN
    DELETE FROM stammdaten_aenderung WHERE art = 'einsatz_vorlage' AND schluessel = CAST(NEW.vorlage_id AS TEXT)
        AND org_id = (SELECT org_id FROM einsatz_vorlage WHERE id = NEW.vorlage_id);
    INSERT INTO stammdaten_aenderung (org_id, art, schluessel)
        SELECT org_id, 'einsatz_vorlage', CAST(id AS TEXT) FROM einsatz_vorlage WHERE id = NEW.vorlage_id;
END;
CREATE TRIGGER einsatz_vorlage_modul_aus_schutz_u BEFORE UPDATE ON einsatz_vorlage_modul_aus
WHEN EXISTS (SELECT 1 FROM stammdaten_herkunft h JOIN einsatz_vorlage e ON e.id = NEW.vorlage_id
        WHERE h.art = 'einsatz_vorlage' AND h.org_id = e.org_id AND h.lokaler_schluessel = CAST(e.id AS TEXT))
    AND NOT EXISTS (SELECT 1 FROM stammdaten_uebernahme)
BEGIN
    SELECT RAISE(ABORT, 'stammdaten_vom_hub');
END;

CREATE TRIGGER einsatz_vorlage_modul_aus_log_d AFTER DELETE ON einsatz_vorlage_modul_aus
BEGIN
    DELETE FROM stammdaten_aenderung WHERE art = 'einsatz_vorlage' AND schluessel = CAST(OLD.vorlage_id AS TEXT)
        AND org_id = (SELECT org_id FROM einsatz_vorlage WHERE id = OLD.vorlage_id);
    INSERT INTO stammdaten_aenderung (org_id, art, schluessel)
        SELECT org_id, 'einsatz_vorlage', CAST(id AS TEXT) FROM einsatz_vorlage WHERE id = OLD.vorlage_id;
END;
CREATE TRIGGER einsatz_vorlage_modul_aus_schutz_d BEFORE DELETE ON einsatz_vorlage_modul_aus
WHEN EXISTS (SELECT 1 FROM stammdaten_herkunft h JOIN einsatz_vorlage e ON e.id = OLD.vorlage_id
        WHERE h.art = 'einsatz_vorlage' AND h.org_id = e.org_id AND h.lokaler_schluessel = CAST(e.id AS TEXT))
    AND NOT EXISTS (SELECT 1 FROM stammdaten_uebernahme)
BEGIN
    SELECT RAISE(ABORT, 'stammdaten_vom_hub');
END;
