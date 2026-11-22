-- LLH-1893: Eine ID, die SQLite nach dem Löschen neu vergibt, ist eine neue Zeile. Entwurf:
-- docs/superpowers/specs/2026-11-22-k13jdo7f-spiegel-herkunft-neu-vergeben-design.md.
--
-- Merker der Neuvergabe (D4): Dieser Schlüssel steht in diesem Einsatz seit `stand` für eine neue
-- Zeile; ein Gegenüber, das bis dahin nicht abgeglichen hat, meint mit ihm vielleicht die alte.
-- Setzt nur der Log-Trigger `<tabelle>_spiegellog_i`; ausgewertet in `instanz::spiegel::fuehrung`.
CREATE TABLE spiegel_neu_vergeben (
    einsatz_id         INTEGER NOT NULL REFERENCES einsatz(id) ON DELETE CASCADE,
    art                TEXT NOT NULL,
    lokaler_schluessel TEXT NOT NULL,
    stand              INTEGER NOT NULL,
    PRIMARY KEY (einsatz_id, art, lokaler_schluessel)
);

-- Log-Trigger der gespiegelten Tabellen mit Ersatzschlüssel `id` (D1, D3), erzeugt mit
-- `instanz::spiegel::art::trigger_sql`: Legt diese Instanz eine Zeile selbst an (außerhalb des
-- Merkers `spiegel_uebernahme`), fällt die Herkunft einer früheren Zeile unter derselben ID, und
-- stand die ID im Log dieses Einsatzes, entsteht der Merker.
DROP TRIGGER einsatz_feld_vermerk_spiegellog_i;
CREATE TRIGGER einsatz_feld_vermerk_spiegellog_i AFTER INSERT ON einsatz_feld_vermerk WHEN EXISTS (SELECT 1 FROM einsatz WHERE id = NEW.einsatz_id) BEGIN
    INSERT OR REPLACE INTO spiegel_neu_vergeben (einsatz_id, art, lokaler_schluessel, stand) SELECT NEW.einsatz_id, 'einsatz_feld_vermerk', CAST(NEW.id AS TEXT), 0 WHERE NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND EXISTS (SELECT 1 FROM einsatz_aenderung WHERE einsatz_id = NEW.einsatz_id AND art = 'einsatz_feld_vermerk' AND schluessel = CAST(NEW.id AS TEXT));
    DELETE FROM spiegel_herkunft WHERE NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND art = 'einsatz_feld_vermerk' AND lokaler_schluessel = CAST(NEW.id AS TEXT);
    DELETE FROM einsatz_aenderung WHERE einsatz_id = NEW.einsatz_id AND art = 'einsatz_feld_vermerk' AND schluessel = CAST(NEW.id AS TEXT);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) VALUES (NEW.einsatz_id, 'einsatz_feld_vermerk', CAST(NEW.id AS TEXT));
    UPDATE spiegel_neu_vergeben SET stand = (SELECT stand FROM einsatz_aenderung WHERE einsatz_id = NEW.einsatz_id AND art = 'einsatz_feld_vermerk' AND schluessel = CAST(NEW.id AS TEXT)) WHERE einsatz_id = NEW.einsatz_id AND art = 'einsatz_feld_vermerk' AND lokaler_schluessel = CAST(NEW.id AS TEXT) AND stand = 0;
END;
DROP TRIGGER einsatz_lagebesprechung_spiegellog_i;
CREATE TRIGGER einsatz_lagebesprechung_spiegellog_i AFTER INSERT ON einsatz_lagebesprechung WHEN EXISTS (SELECT 1 FROM einsatz WHERE id = NEW.einsatz_id) BEGIN
    INSERT OR REPLACE INTO spiegel_neu_vergeben (einsatz_id, art, lokaler_schluessel, stand) SELECT NEW.einsatz_id, 'einsatz_lagebesprechung', CAST(NEW.id AS TEXT), 0 WHERE NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND EXISTS (SELECT 1 FROM einsatz_aenderung WHERE einsatz_id = NEW.einsatz_id AND art = 'einsatz_lagebesprechung' AND schluessel = CAST(NEW.id AS TEXT));
    DELETE FROM spiegel_herkunft WHERE NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND art = 'einsatz_lagebesprechung' AND lokaler_schluessel = CAST(NEW.id AS TEXT);
    DELETE FROM einsatz_aenderung WHERE einsatz_id = NEW.einsatz_id AND art = 'einsatz_lagebesprechung' AND schluessel = CAST(NEW.id AS TEXT);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) VALUES (NEW.einsatz_id, 'einsatz_lagebesprechung', CAST(NEW.id AS TEXT));
    UPDATE spiegel_neu_vergeben SET stand = (SELECT stand FROM einsatz_aenderung WHERE einsatz_id = NEW.einsatz_id AND art = 'einsatz_lagebesprechung' AND schluessel = CAST(NEW.id AS TEXT)) WHERE einsatz_id = NEW.einsatz_id AND art = 'einsatz_lagebesprechung' AND lokaler_schluessel = CAST(NEW.id AS TEXT) AND stand = 0;
END;
DROP TRIGGER einsatzabschnitt_spiegellog_i;
CREATE TRIGGER einsatzabschnitt_spiegellog_i AFTER INSERT ON einsatzabschnitt WHEN EXISTS (SELECT 1 FROM einsatz WHERE id = NEW.einsatz_id) BEGIN
    INSERT OR REPLACE INTO spiegel_neu_vergeben (einsatz_id, art, lokaler_schluessel, stand) SELECT NEW.einsatz_id, 'einsatzabschnitt', CAST(NEW.id AS TEXT), 0 WHERE NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND EXISTS (SELECT 1 FROM einsatz_aenderung WHERE einsatz_id = NEW.einsatz_id AND art = 'einsatzabschnitt' AND schluessel = CAST(NEW.id AS TEXT));
    DELETE FROM spiegel_herkunft WHERE NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND art = 'einsatzabschnitt' AND lokaler_schluessel = CAST(NEW.id AS TEXT);
    DELETE FROM einsatz_aenderung WHERE einsatz_id = NEW.einsatz_id AND art = 'einsatzabschnitt' AND schluessel = CAST(NEW.id AS TEXT);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) VALUES (NEW.einsatz_id, 'einsatzabschnitt', CAST(NEW.id AS TEXT));
    UPDATE spiegel_neu_vergeben SET stand = (SELECT stand FROM einsatz_aenderung WHERE einsatz_id = NEW.einsatz_id AND art = 'einsatzabschnitt' AND schluessel = CAST(NEW.id AS TEXT)) WHERE einsatz_id = NEW.einsatz_id AND art = 'einsatzabschnitt' AND lokaler_schluessel = CAST(NEW.id AS TEXT) AND stand = 0;
END;
DROP TRIGGER erinnerung_spiegellog_i;
CREATE TRIGGER erinnerung_spiegellog_i AFTER INSERT ON erinnerung WHEN EXISTS (SELECT 1 FROM einsatz WHERE id = NEW.einsatz_id) BEGIN
    INSERT OR REPLACE INTO spiegel_neu_vergeben (einsatz_id, art, lokaler_schluessel, stand) SELECT NEW.einsatz_id, 'erinnerung', CAST(NEW.id AS TEXT), 0 WHERE NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND EXISTS (SELECT 1 FROM einsatz_aenderung WHERE einsatz_id = NEW.einsatz_id AND art = 'erinnerung' AND schluessel = CAST(NEW.id AS TEXT));
    DELETE FROM spiegel_herkunft WHERE NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND art = 'erinnerung' AND lokaler_schluessel = CAST(NEW.id AS TEXT);
    DELETE FROM einsatz_aenderung WHERE einsatz_id = NEW.einsatz_id AND art = 'erinnerung' AND schluessel = CAST(NEW.id AS TEXT);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) VALUES (NEW.einsatz_id, 'erinnerung', CAST(NEW.id AS TEXT));
    UPDATE spiegel_neu_vergeben SET stand = (SELECT stand FROM einsatz_aenderung WHERE einsatz_id = NEW.einsatz_id AND art = 'erinnerung' AND schluessel = CAST(NEW.id AS TEXT)) WHERE einsatz_id = NEW.einsatz_id AND art = 'erinnerung' AND lokaler_schluessel = CAST(NEW.id AS TEXT) AND stand = 0;
END;
DROP TRIGGER programmpunkt_spiegellog_i;
CREATE TRIGGER programmpunkt_spiegellog_i AFTER INSERT ON programmpunkt WHEN EXISTS (SELECT 1 FROM einsatz WHERE id = NEW.einsatz_id) BEGIN
    INSERT OR REPLACE INTO spiegel_neu_vergeben (einsatz_id, art, lokaler_schluessel, stand) SELECT NEW.einsatz_id, 'programmpunkt', CAST(NEW.id AS TEXT), 0 WHERE NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND EXISTS (SELECT 1 FROM einsatz_aenderung WHERE einsatz_id = NEW.einsatz_id AND art = 'programmpunkt' AND schluessel = CAST(NEW.id AS TEXT));
    DELETE FROM spiegel_herkunft WHERE NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND art = 'programmpunkt' AND lokaler_schluessel = CAST(NEW.id AS TEXT);
    DELETE FROM einsatz_aenderung WHERE einsatz_id = NEW.einsatz_id AND art = 'programmpunkt' AND schluessel = CAST(NEW.id AS TEXT);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) VALUES (NEW.einsatz_id, 'programmpunkt', CAST(NEW.id AS TEXT));
    UPDATE spiegel_neu_vergeben SET stand = (SELECT stand FROM einsatz_aenderung WHERE einsatz_id = NEW.einsatz_id AND art = 'programmpunkt' AND schluessel = CAST(NEW.id AS TEXT)) WHERE einsatz_id = NEW.einsatz_id AND art = 'programmpunkt' AND lokaler_schluessel = CAST(NEW.id AS TEXT) AND stand = 0;
END;
DROP TRIGGER etb_eintrag_spiegellog_i;
CREATE TRIGGER etb_eintrag_spiegellog_i AFTER INSERT ON etb_eintrag WHEN EXISTS (SELECT 1 FROM einsatz WHERE id = NEW.einsatz_id) BEGIN
    INSERT OR REPLACE INTO spiegel_neu_vergeben (einsatz_id, art, lokaler_schluessel, stand) SELECT NEW.einsatz_id, 'etb_eintrag', CAST(NEW.id AS TEXT), 0 WHERE NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND EXISTS (SELECT 1 FROM einsatz_aenderung WHERE einsatz_id = NEW.einsatz_id AND art = 'etb_eintrag' AND schluessel = CAST(NEW.id AS TEXT));
    DELETE FROM spiegel_herkunft WHERE NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND art = 'etb_eintrag' AND lokaler_schluessel = CAST(NEW.id AS TEXT);
    DELETE FROM einsatz_aenderung WHERE einsatz_id = NEW.einsatz_id AND art = 'etb_eintrag' AND schluessel = CAST(NEW.id AS TEXT);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) VALUES (NEW.einsatz_id, 'etb_eintrag', CAST(NEW.id AS TEXT));
    UPDATE spiegel_neu_vergeben SET stand = (SELECT stand FROM einsatz_aenderung WHERE einsatz_id = NEW.einsatz_id AND art = 'etb_eintrag' AND schluessel = CAST(NEW.id AS TEXT)) WHERE einsatz_id = NEW.einsatz_id AND art = 'etb_eintrag' AND lokaler_schluessel = CAST(NEW.id AS TEXT) AND stand = 0;
END;
DROP TRIGGER lage_zone_spiegellog_i;
CREATE TRIGGER lage_zone_spiegellog_i AFTER INSERT ON lage_zone WHEN EXISTS (SELECT 1 FROM einsatz WHERE id = NEW.einsatz_id) BEGIN
    INSERT OR REPLACE INTO spiegel_neu_vergeben (einsatz_id, art, lokaler_schluessel, stand) SELECT NEW.einsatz_id, 'lage_zone', CAST(NEW.id AS TEXT), 0 WHERE NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND EXISTS (SELECT 1 FROM einsatz_aenderung WHERE einsatz_id = NEW.einsatz_id AND art = 'lage_zone' AND schluessel = CAST(NEW.id AS TEXT));
    DELETE FROM spiegel_herkunft WHERE NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND art = 'lage_zone' AND lokaler_schluessel = CAST(NEW.id AS TEXT);
    DELETE FROM einsatz_aenderung WHERE einsatz_id = NEW.einsatz_id AND art = 'lage_zone' AND schluessel = CAST(NEW.id AS TEXT);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) VALUES (NEW.einsatz_id, 'lage_zone', CAST(NEW.id AS TEXT));
    UPDATE spiegel_neu_vergeben SET stand = (SELECT stand FROM einsatz_aenderung WHERE einsatz_id = NEW.einsatz_id AND art = 'lage_zone' AND schluessel = CAST(NEW.id AS TEXT)) WHERE einsatz_id = NEW.einsatz_id AND art = 'lage_zone' AND lokaler_schluessel = CAST(NEW.id AS TEXT) AND stand = 0;
END;
DROP TRIGGER gefahrengebiet_spiegellog_i;
CREATE TRIGGER gefahrengebiet_spiegellog_i AFTER INSERT ON gefahrengebiet WHEN EXISTS (SELECT 1 FROM einsatz WHERE id = NEW.einsatz_id) BEGIN
    INSERT OR REPLACE INTO spiegel_neu_vergeben (einsatz_id, art, lokaler_schluessel, stand) SELECT NEW.einsatz_id, 'gefahrengebiet', CAST(NEW.id AS TEXT), 0 WHERE NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND EXISTS (SELECT 1 FROM einsatz_aenderung WHERE einsatz_id = NEW.einsatz_id AND art = 'gefahrengebiet' AND schluessel = CAST(NEW.id AS TEXT));
    DELETE FROM spiegel_herkunft WHERE NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND art = 'gefahrengebiet' AND lokaler_schluessel = CAST(NEW.id AS TEXT);
    DELETE FROM einsatz_aenderung WHERE einsatz_id = NEW.einsatz_id AND art = 'gefahrengebiet' AND schluessel = CAST(NEW.id AS TEXT);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) VALUES (NEW.einsatz_id, 'gefahrengebiet', CAST(NEW.id AS TEXT));
    UPDATE spiegel_neu_vergeben SET stand = (SELECT stand FROM einsatz_aenderung WHERE einsatz_id = NEW.einsatz_id AND art = 'gefahrengebiet' AND schluessel = CAST(NEW.id AS TEXT)) WHERE einsatz_id = NEW.einsatz_id AND art = 'gefahrengebiet' AND lokaler_schluessel = CAST(NEW.id AS TEXT) AND stand = 0;
END;
DROP TRIGGER gefahr_bewertung_spiegellog_i;
CREATE TRIGGER gefahr_bewertung_spiegellog_i AFTER INSERT ON gefahr_bewertung WHEN EXISTS (SELECT 1 FROM einsatz WHERE id = (SELECT einsatz_id FROM gefahrengebiet WHERE id = NEW.gefahrengebiet_id)) BEGIN
    INSERT OR REPLACE INTO spiegel_neu_vergeben (einsatz_id, art, lokaler_schluessel, stand) SELECT (SELECT einsatz_id FROM gefahrengebiet WHERE id = NEW.gefahrengebiet_id), 'gefahr_bewertung', CAST(NEW.id AS TEXT), 0 WHERE NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND EXISTS (SELECT 1 FROM einsatz_aenderung WHERE einsatz_id = (SELECT einsatz_id FROM gefahrengebiet WHERE id = NEW.gefahrengebiet_id) AND art = 'gefahr_bewertung' AND schluessel = CAST(NEW.id AS TEXT));
    DELETE FROM spiegel_herkunft WHERE NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND art = 'gefahr_bewertung' AND lokaler_schluessel = CAST(NEW.id AS TEXT);
    DELETE FROM einsatz_aenderung WHERE einsatz_id = (SELECT einsatz_id FROM gefahrengebiet WHERE id = NEW.gefahrengebiet_id) AND art = 'gefahr_bewertung' AND schluessel = CAST(NEW.id AS TEXT);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) VALUES ((SELECT einsatz_id FROM gefahrengebiet WHERE id = NEW.gefahrengebiet_id), 'gefahr_bewertung', CAST(NEW.id AS TEXT));
    UPDATE spiegel_neu_vergeben SET stand = (SELECT stand FROM einsatz_aenderung WHERE einsatz_id = (SELECT einsatz_id FROM gefahrengebiet WHERE id = NEW.gefahrengebiet_id) AND art = 'gefahr_bewertung' AND schluessel = CAST(NEW.id AS TEXT)) WHERE einsatz_id = (SELECT einsatz_id FROM gefahrengebiet WHERE id = NEW.gefahrengebiet_id) AND art = 'gefahr_bewertung' AND lokaler_schluessel = CAST(NEW.id AS TEXT) AND stand = 0;
END;
DROP TRIGGER freies_zeichen_spiegellog_i;
CREATE TRIGGER freies_zeichen_spiegellog_i AFTER INSERT ON freies_zeichen WHEN EXISTS (SELECT 1 FROM einsatz WHERE id = NEW.einsatz_id) BEGIN
    INSERT OR REPLACE INTO spiegel_neu_vergeben (einsatz_id, art, lokaler_schluessel, stand) SELECT NEW.einsatz_id, 'freies_zeichen', CAST(NEW.id AS TEXT), 0 WHERE NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND EXISTS (SELECT 1 FROM einsatz_aenderung WHERE einsatz_id = NEW.einsatz_id AND art = 'freies_zeichen' AND schluessel = CAST(NEW.id AS TEXT));
    DELETE FROM spiegel_herkunft WHERE NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND art = 'freies_zeichen' AND lokaler_schluessel = CAST(NEW.id AS TEXT);
    DELETE FROM einsatz_aenderung WHERE einsatz_id = NEW.einsatz_id AND art = 'freies_zeichen' AND schluessel = CAST(NEW.id AS TEXT);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) VALUES (NEW.einsatz_id, 'freies_zeichen', CAST(NEW.id AS TEXT));
    UPDATE spiegel_neu_vergeben SET stand = (SELECT stand FROM einsatz_aenderung WHERE einsatz_id = NEW.einsatz_id AND art = 'freies_zeichen' AND schluessel = CAST(NEW.id AS TEXT)) WHERE einsatz_id = NEW.einsatz_id AND art = 'freies_zeichen' AND lokaler_schluessel = CAST(NEW.id AS TEXT) AND stand = 0;
END;
DROP TRIGGER karte_hintergrundbild_spiegellog_i;
CREATE TRIGGER karte_hintergrundbild_spiegellog_i AFTER INSERT ON karte_hintergrundbild WHEN EXISTS (SELECT 1 FROM einsatz WHERE id = NEW.einsatz_id) BEGIN
    INSERT OR REPLACE INTO spiegel_neu_vergeben (einsatz_id, art, lokaler_schluessel, stand) SELECT NEW.einsatz_id, 'karte_hintergrundbild', CAST(NEW.id AS TEXT), 0 WHERE NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND EXISTS (SELECT 1 FROM einsatz_aenderung WHERE einsatz_id = NEW.einsatz_id AND art = 'karte_hintergrundbild' AND schluessel = CAST(NEW.id AS TEXT));
    DELETE FROM spiegel_herkunft WHERE NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND art = 'karte_hintergrundbild' AND lokaler_schluessel = CAST(NEW.id AS TEXT);
    DELETE FROM einsatz_aenderung WHERE einsatz_id = NEW.einsatz_id AND art = 'karte_hintergrundbild' AND schluessel = CAST(NEW.id AS TEXT);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) VALUES (NEW.einsatz_id, 'karte_hintergrundbild', CAST(NEW.id AS TEXT));
    UPDATE spiegel_neu_vergeben SET stand = (SELECT stand FROM einsatz_aenderung WHERE einsatz_id = NEW.einsatz_id AND art = 'karte_hintergrundbild' AND schluessel = CAST(NEW.id AS TEXT)) WHERE einsatz_id = NEW.einsatz_id AND art = 'karte_hintergrundbild' AND lokaler_schluessel = CAST(NEW.id AS TEXT) AND stand = 0;
END;
DROP TRIGGER karten_ansicht_spiegellog_i;
CREATE TRIGGER karten_ansicht_spiegellog_i AFTER INSERT ON karten_ansicht WHEN EXISTS (SELECT 1 FROM einsatz WHERE id = NEW.einsatz_id) BEGIN
    INSERT OR REPLACE INTO spiegel_neu_vergeben (einsatz_id, art, lokaler_schluessel, stand) SELECT NEW.einsatz_id, 'karten_ansicht', CAST(NEW.id AS TEXT), 0 WHERE NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND EXISTS (SELECT 1 FROM einsatz_aenderung WHERE einsatz_id = NEW.einsatz_id AND art = 'karten_ansicht' AND schluessel = CAST(NEW.id AS TEXT));
    DELETE FROM spiegel_herkunft WHERE NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND art = 'karten_ansicht' AND lokaler_schluessel = CAST(NEW.id AS TEXT);
    DELETE FROM einsatz_aenderung WHERE einsatz_id = NEW.einsatz_id AND art = 'karten_ansicht' AND schluessel = CAST(NEW.id AS TEXT);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) VALUES (NEW.einsatz_id, 'karten_ansicht', CAST(NEW.id AS TEXT));
    UPDATE spiegel_neu_vergeben SET stand = (SELECT stand FROM einsatz_aenderung WHERE einsatz_id = NEW.einsatz_id AND art = 'karten_ansicht' AND schluessel = CAST(NEW.id AS TEXT)) WHERE einsatz_id = NEW.einsatz_id AND art = 'karten_ansicht' AND lokaler_schluessel = CAST(NEW.id AS TEXT) AND stand = 0;
END;
DROP TRIGGER lage_snapshot_spiegellog_i;
CREATE TRIGGER lage_snapshot_spiegellog_i AFTER INSERT ON lage_snapshot WHEN EXISTS (SELECT 1 FROM einsatz WHERE id = NEW.einsatz_id) BEGIN
    INSERT OR REPLACE INTO spiegel_neu_vergeben (einsatz_id, art, lokaler_schluessel, stand) SELECT NEW.einsatz_id, 'lage_snapshot', CAST(NEW.id AS TEXT), 0 WHERE NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND EXISTS (SELECT 1 FROM einsatz_aenderung WHERE einsatz_id = NEW.einsatz_id AND art = 'lage_snapshot' AND schluessel = CAST(NEW.id AS TEXT));
    DELETE FROM spiegel_herkunft WHERE NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND art = 'lage_snapshot' AND lokaler_schluessel = CAST(NEW.id AS TEXT);
    DELETE FROM einsatz_aenderung WHERE einsatz_id = NEW.einsatz_id AND art = 'lage_snapshot' AND schluessel = CAST(NEW.id AS TEXT);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) VALUES (NEW.einsatz_id, 'lage_snapshot', CAST(NEW.id AS TEXT));
    UPDATE spiegel_neu_vergeben SET stand = (SELECT stand FROM einsatz_aenderung WHERE einsatz_id = NEW.einsatz_id AND art = 'lage_snapshot' AND schluessel = CAST(NEW.id AS TEXT)) WHERE einsatz_id = NEW.einsatz_id AND art = 'lage_snapshot' AND lokaler_schluessel = CAST(NEW.id AS TEXT) AND stand = 0;
END;
DROP TRIGGER einsatz_pegel_spiegellog_i;
CREATE TRIGGER einsatz_pegel_spiegellog_i AFTER INSERT ON einsatz_pegel WHEN EXISTS (SELECT 1 FROM einsatz WHERE id = NEW.einsatz_id) BEGIN
    INSERT OR REPLACE INTO spiegel_neu_vergeben (einsatz_id, art, lokaler_schluessel, stand) SELECT NEW.einsatz_id, 'einsatz_pegel', CAST(NEW.id AS TEXT), 0 WHERE NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND EXISTS (SELECT 1 FROM einsatz_aenderung WHERE einsatz_id = NEW.einsatz_id AND art = 'einsatz_pegel' AND schluessel = CAST(NEW.id AS TEXT));
    DELETE FROM spiegel_herkunft WHERE NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND art = 'einsatz_pegel' AND lokaler_schluessel = CAST(NEW.id AS TEXT);
    DELETE FROM einsatz_aenderung WHERE einsatz_id = NEW.einsatz_id AND art = 'einsatz_pegel' AND schluessel = CAST(NEW.id AS TEXT);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) VALUES (NEW.einsatz_id, 'einsatz_pegel', CAST(NEW.id AS TEXT));
    UPDATE spiegel_neu_vergeben SET stand = (SELECT stand FROM einsatz_aenderung WHERE einsatz_id = NEW.einsatz_id AND art = 'einsatz_pegel' AND schluessel = CAST(NEW.id AS TEXT)) WHERE einsatz_id = NEW.einsatz_id AND art = 'einsatz_pegel' AND lokaler_schluessel = CAST(NEW.id AS TEXT) AND stand = 0;
END;
DROP TRIGGER einsatz_schaden_spiegellog_i;
CREATE TRIGGER einsatz_schaden_spiegellog_i AFTER INSERT ON einsatz_schaden WHEN EXISTS (SELECT 1 FROM einsatz WHERE id = NEW.einsatz_id) BEGIN
    INSERT OR REPLACE INTO spiegel_neu_vergeben (einsatz_id, art, lokaler_schluessel, stand) SELECT NEW.einsatz_id, 'einsatz_schaden', CAST(NEW.id AS TEXT), 0 WHERE NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND EXISTS (SELECT 1 FROM einsatz_aenderung WHERE einsatz_id = NEW.einsatz_id AND art = 'einsatz_schaden' AND schluessel = CAST(NEW.id AS TEXT));
    DELETE FROM spiegel_herkunft WHERE NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND art = 'einsatz_schaden' AND lokaler_schluessel = CAST(NEW.id AS TEXT);
    DELETE FROM einsatz_aenderung WHERE einsatz_id = NEW.einsatz_id AND art = 'einsatz_schaden' AND schluessel = CAST(NEW.id AS TEXT);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) VALUES (NEW.einsatz_id, 'einsatz_schaden', CAST(NEW.id AS TEXT));
    UPDATE spiegel_neu_vergeben SET stand = (SELECT stand FROM einsatz_aenderung WHERE einsatz_id = NEW.einsatz_id AND art = 'einsatz_schaden' AND schluessel = CAST(NEW.id AS TEXT)) WHERE einsatz_id = NEW.einsatz_id AND art = 'einsatz_schaden' AND lokaler_schluessel = CAST(NEW.id AS TEXT) AND stand = 0;
END;
DROP TRIGGER einsatz_tier_spiegellog_i;
CREATE TRIGGER einsatz_tier_spiegellog_i AFTER INSERT ON einsatz_tier WHEN EXISTS (SELECT 1 FROM einsatz WHERE id = NEW.einsatz_id) BEGIN
    INSERT OR REPLACE INTO spiegel_neu_vergeben (einsatz_id, art, lokaler_schluessel, stand) SELECT NEW.einsatz_id, 'einsatz_tier', CAST(NEW.id AS TEXT), 0 WHERE NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND EXISTS (SELECT 1 FROM einsatz_aenderung WHERE einsatz_id = NEW.einsatz_id AND art = 'einsatz_tier' AND schluessel = CAST(NEW.id AS TEXT));
    DELETE FROM spiegel_herkunft WHERE NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND art = 'einsatz_tier' AND lokaler_schluessel = CAST(NEW.id AS TEXT);
    DELETE FROM einsatz_aenderung WHERE einsatz_id = NEW.einsatz_id AND art = 'einsatz_tier' AND schluessel = CAST(NEW.id AS TEXT);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) VALUES (NEW.einsatz_id, 'einsatz_tier', CAST(NEW.id AS TEXT));
    UPDATE spiegel_neu_vergeben SET stand = (SELECT stand FROM einsatz_aenderung WHERE einsatz_id = NEW.einsatz_id AND art = 'einsatz_tier' AND schluessel = CAST(NEW.id AS TEXT)) WHERE einsatz_id = NEW.einsatz_id AND art = 'einsatz_tier' AND lokaler_schluessel = CAST(NEW.id AS TEXT) AND stand = 0;
END;
DROP TRIGGER einsatz_einheit_spiegellog_i;
CREATE TRIGGER einsatz_einheit_spiegellog_i AFTER INSERT ON einsatz_einheit WHEN EXISTS (SELECT 1 FROM einsatz WHERE id = NEW.einsatz_id) BEGIN
    INSERT OR REPLACE INTO spiegel_neu_vergeben (einsatz_id, art, lokaler_schluessel, stand) SELECT NEW.einsatz_id, 'einsatz_einheit', CAST(NEW.id AS TEXT), 0 WHERE NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND EXISTS (SELECT 1 FROM einsatz_aenderung WHERE einsatz_id = NEW.einsatz_id AND art = 'einsatz_einheit' AND schluessel = CAST(NEW.id AS TEXT));
    DELETE FROM spiegel_herkunft WHERE NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND art = 'einsatz_einheit' AND lokaler_schluessel = CAST(NEW.id AS TEXT);
    DELETE FROM einsatz_aenderung WHERE einsatz_id = NEW.einsatz_id AND art = 'einsatz_einheit' AND schluessel = CAST(NEW.id AS TEXT);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) VALUES (NEW.einsatz_id, 'einsatz_einheit', CAST(NEW.id AS TEXT));
    UPDATE spiegel_neu_vergeben SET stand = (SELECT stand FROM einsatz_aenderung WHERE einsatz_id = NEW.einsatz_id AND art = 'einsatz_einheit' AND schluessel = CAST(NEW.id AS TEXT)) WHERE einsatz_id = NEW.einsatz_id AND art = 'einsatz_einheit' AND lokaler_schluessel = CAST(NEW.id AS TEXT) AND stand = 0;
END;
DROP TRIGGER einsatz_einheit_letzte_besetzung_spiegellog_i;
CREATE TRIGGER einsatz_einheit_letzte_besetzung_spiegellog_i AFTER INSERT ON einsatz_einheit_letzte_besetzung WHEN EXISTS (SELECT 1 FROM einsatz WHERE id = (SELECT einsatz_id FROM einsatz_einheit WHERE id = NEW.einheit_id)) BEGIN
    INSERT OR REPLACE INTO spiegel_neu_vergeben (einsatz_id, art, lokaler_schluessel, stand) SELECT (SELECT einsatz_id FROM einsatz_einheit WHERE id = NEW.einheit_id), 'einsatz_einheit_letzte_besetzung', CAST(NEW.id AS TEXT), 0 WHERE NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND EXISTS (SELECT 1 FROM einsatz_aenderung WHERE einsatz_id = (SELECT einsatz_id FROM einsatz_einheit WHERE id = NEW.einheit_id) AND art = 'einsatz_einheit_letzte_besetzung' AND schluessel = CAST(NEW.id AS TEXT));
    DELETE FROM spiegel_herkunft WHERE NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND art = 'einsatz_einheit_letzte_besetzung' AND lokaler_schluessel = CAST(NEW.id AS TEXT);
    DELETE FROM einsatz_aenderung WHERE einsatz_id = (SELECT einsatz_id FROM einsatz_einheit WHERE id = NEW.einheit_id) AND art = 'einsatz_einheit_letzte_besetzung' AND schluessel = CAST(NEW.id AS TEXT);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) VALUES ((SELECT einsatz_id FROM einsatz_einheit WHERE id = NEW.einheit_id), 'einsatz_einheit_letzte_besetzung', CAST(NEW.id AS TEXT));
    UPDATE spiegel_neu_vergeben SET stand = (SELECT stand FROM einsatz_aenderung WHERE einsatz_id = (SELECT einsatz_id FROM einsatz_einheit WHERE id = NEW.einheit_id) AND art = 'einsatz_einheit_letzte_besetzung' AND schluessel = CAST(NEW.id AS TEXT)) WHERE einsatz_id = (SELECT einsatz_id FROM einsatz_einheit WHERE id = NEW.einheit_id) AND art = 'einsatz_einheit_letzte_besetzung' AND lokaler_schluessel = CAST(NEW.id AS TEXT) AND stand = 0;
END;
DROP TRIGGER einsatz_fahrzeug_spiegellog_i;
CREATE TRIGGER einsatz_fahrzeug_spiegellog_i AFTER INSERT ON einsatz_fahrzeug WHEN EXISTS (SELECT 1 FROM einsatz WHERE id = NEW.einsatz_id) BEGIN
    INSERT OR REPLACE INTO spiegel_neu_vergeben (einsatz_id, art, lokaler_schluessel, stand) SELECT NEW.einsatz_id, 'einsatz_fahrzeug', CAST(NEW.id AS TEXT), 0 WHERE NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND EXISTS (SELECT 1 FROM einsatz_aenderung WHERE einsatz_id = NEW.einsatz_id AND art = 'einsatz_fahrzeug' AND schluessel = CAST(NEW.id AS TEXT));
    DELETE FROM spiegel_herkunft WHERE NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND art = 'einsatz_fahrzeug' AND lokaler_schluessel = CAST(NEW.id AS TEXT);
    DELETE FROM einsatz_aenderung WHERE einsatz_id = NEW.einsatz_id AND art = 'einsatz_fahrzeug' AND schluessel = CAST(NEW.id AS TEXT);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) VALUES (NEW.einsatz_id, 'einsatz_fahrzeug', CAST(NEW.id AS TEXT));
    UPDATE spiegel_neu_vergeben SET stand = (SELECT stand FROM einsatz_aenderung WHERE einsatz_id = NEW.einsatz_id AND art = 'einsatz_fahrzeug' AND schluessel = CAST(NEW.id AS TEXT)) WHERE einsatz_id = NEW.einsatz_id AND art = 'einsatz_fahrzeug' AND lokaler_schluessel = CAST(NEW.id AS TEXT) AND stand = 0;
END;
DROP TRIGGER einsatz_material_spiegellog_i;
CREATE TRIGGER einsatz_material_spiegellog_i AFTER INSERT ON einsatz_material WHEN EXISTS (SELECT 1 FROM einsatz WHERE id = NEW.einsatz_id) BEGIN
    INSERT OR REPLACE INTO spiegel_neu_vergeben (einsatz_id, art, lokaler_schluessel, stand) SELECT NEW.einsatz_id, 'einsatz_material', CAST(NEW.id AS TEXT), 0 WHERE NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND EXISTS (SELECT 1 FROM einsatz_aenderung WHERE einsatz_id = NEW.einsatz_id AND art = 'einsatz_material' AND schluessel = CAST(NEW.id AS TEXT));
    DELETE FROM spiegel_herkunft WHERE NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND art = 'einsatz_material' AND lokaler_schluessel = CAST(NEW.id AS TEXT);
    DELETE FROM einsatz_aenderung WHERE einsatz_id = NEW.einsatz_id AND art = 'einsatz_material' AND schluessel = CAST(NEW.id AS TEXT);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) VALUES (NEW.einsatz_id, 'einsatz_material', CAST(NEW.id AS TEXT));
    UPDATE spiegel_neu_vergeben SET stand = (SELECT stand FROM einsatz_aenderung WHERE einsatz_id = NEW.einsatz_id AND art = 'einsatz_material' AND schluessel = CAST(NEW.id AS TEXT)) WHERE einsatz_id = NEW.einsatz_id AND art = 'einsatz_material' AND lokaler_schluessel = CAST(NEW.id AS TEXT) AND stand = 0;
END;
DROP TRIGGER einsatz_personal_spiegellog_i;
CREATE TRIGGER einsatz_personal_spiegellog_i AFTER INSERT ON einsatz_personal WHEN EXISTS (SELECT 1 FROM einsatz WHERE id = NEW.einsatz_id) BEGIN
    INSERT OR REPLACE INTO spiegel_neu_vergeben (einsatz_id, art, lokaler_schluessel, stand) SELECT NEW.einsatz_id, 'einsatz_personal', CAST(NEW.id AS TEXT), 0 WHERE NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND EXISTS (SELECT 1 FROM einsatz_aenderung WHERE einsatz_id = NEW.einsatz_id AND art = 'einsatz_personal' AND schluessel = CAST(NEW.id AS TEXT));
    DELETE FROM spiegel_herkunft WHERE NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND art = 'einsatz_personal' AND lokaler_schluessel = CAST(NEW.id AS TEXT);
    DELETE FROM einsatz_aenderung WHERE einsatz_id = NEW.einsatz_id AND art = 'einsatz_personal' AND schluessel = CAST(NEW.id AS TEXT);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) VALUES (NEW.einsatz_id, 'einsatz_personal', CAST(NEW.id AS TEXT));
    UPDATE spiegel_neu_vergeben SET stand = (SELECT stand FROM einsatz_aenderung WHERE einsatz_id = NEW.einsatz_id AND art = 'einsatz_personal' AND schluessel = CAST(NEW.id AS TEXT)) WHERE einsatz_id = NEW.einsatz_id AND art = 'einsatz_personal' AND lokaler_schluessel = CAST(NEW.id AS TEXT) AND stand = 0;
END;
DROP TRIGGER einsatz_abloesung_spiegellog_i;
CREATE TRIGGER einsatz_abloesung_spiegellog_i AFTER INSERT ON einsatz_abloesung WHEN EXISTS (SELECT 1 FROM einsatz WHERE id = NEW.einsatz_id) BEGIN
    INSERT OR REPLACE INTO spiegel_neu_vergeben (einsatz_id, art, lokaler_schluessel, stand) SELECT NEW.einsatz_id, 'einsatz_abloesung', CAST(NEW.id AS TEXT), 0 WHERE NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND EXISTS (SELECT 1 FROM einsatz_aenderung WHERE einsatz_id = NEW.einsatz_id AND art = 'einsatz_abloesung' AND schluessel = CAST(NEW.id AS TEXT));
    DELETE FROM spiegel_herkunft WHERE NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND art = 'einsatz_abloesung' AND lokaler_schluessel = CAST(NEW.id AS TEXT);
    DELETE FROM einsatz_aenderung WHERE einsatz_id = NEW.einsatz_id AND art = 'einsatz_abloesung' AND schluessel = CAST(NEW.id AS TEXT);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) VALUES (NEW.einsatz_id, 'einsatz_abloesung', CAST(NEW.id AS TEXT));
    UPDATE spiegel_neu_vergeben SET stand = (SELECT stand FROM einsatz_aenderung WHERE einsatz_id = NEW.einsatz_id AND art = 'einsatz_abloesung' AND schluessel = CAST(NEW.id AS TEXT)) WHERE einsatz_id = NEW.einsatz_id AND art = 'einsatz_abloesung' AND lokaler_schluessel = CAST(NEW.id AS TEXT) AND stand = 0;
END;
DROP TRIGGER einsatz_plan_helfer_spiegellog_i;
CREATE TRIGGER einsatz_plan_helfer_spiegellog_i AFTER INSERT ON einsatz_plan_helfer WHEN EXISTS (SELECT 1 FROM einsatz WHERE id = NEW.einsatz_id) BEGIN
    INSERT OR REPLACE INTO spiegel_neu_vergeben (einsatz_id, art, lokaler_schluessel, stand) SELECT NEW.einsatz_id, 'einsatz_plan_helfer', CAST(NEW.id AS TEXT), 0 WHERE NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND EXISTS (SELECT 1 FROM einsatz_aenderung WHERE einsatz_id = NEW.einsatz_id AND art = 'einsatz_plan_helfer' AND schluessel = CAST(NEW.id AS TEXT));
    DELETE FROM spiegel_herkunft WHERE NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND art = 'einsatz_plan_helfer' AND lokaler_schluessel = CAST(NEW.id AS TEXT);
    DELETE FROM einsatz_aenderung WHERE einsatz_id = NEW.einsatz_id AND art = 'einsatz_plan_helfer' AND schluessel = CAST(NEW.id AS TEXT);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) VALUES (NEW.einsatz_id, 'einsatz_plan_helfer', CAST(NEW.id AS TEXT));
    UPDATE spiegel_neu_vergeben SET stand = (SELECT stand FROM einsatz_aenderung WHERE einsatz_id = NEW.einsatz_id AND art = 'einsatz_plan_helfer' AND schluessel = CAST(NEW.id AS TEXT)) WHERE einsatz_id = NEW.einsatz_id AND art = 'einsatz_plan_helfer' AND lokaler_schluessel = CAST(NEW.id AS TEXT) AND stand = 0;
END;
DROP TRIGGER einsatz_planschicht_spiegellog_i;
CREATE TRIGGER einsatz_planschicht_spiegellog_i AFTER INSERT ON einsatz_planschicht WHEN EXISTS (SELECT 1 FROM einsatz WHERE id = NEW.einsatz_id) BEGIN
    INSERT OR REPLACE INTO spiegel_neu_vergeben (einsatz_id, art, lokaler_schluessel, stand) SELECT NEW.einsatz_id, 'einsatz_planschicht', CAST(NEW.id AS TEXT), 0 WHERE NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND EXISTS (SELECT 1 FROM einsatz_aenderung WHERE einsatz_id = NEW.einsatz_id AND art = 'einsatz_planschicht' AND schluessel = CAST(NEW.id AS TEXT));
    DELETE FROM spiegel_herkunft WHERE NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND art = 'einsatz_planschicht' AND lokaler_schluessel = CAST(NEW.id AS TEXT);
    DELETE FROM einsatz_aenderung WHERE einsatz_id = NEW.einsatz_id AND art = 'einsatz_planschicht' AND schluessel = CAST(NEW.id AS TEXT);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) VALUES (NEW.einsatz_id, 'einsatz_planschicht', CAST(NEW.id AS TEXT));
    UPDATE spiegel_neu_vergeben SET stand = (SELECT stand FROM einsatz_aenderung WHERE einsatz_id = NEW.einsatz_id AND art = 'einsatz_planschicht' AND schluessel = CAST(NEW.id AS TEXT)) WHERE einsatz_id = NEW.einsatz_id AND art = 'einsatz_planschicht' AND lokaler_schluessel = CAST(NEW.id AS TEXT) AND stand = 0;
END;
DROP TRIGGER einsatz_planschicht_person_spiegellog_i;
CREATE TRIGGER einsatz_planschicht_person_spiegellog_i AFTER INSERT ON einsatz_planschicht_person WHEN EXISTS (SELECT 1 FROM einsatz WHERE id = (SELECT einsatz_id FROM einsatz_planschicht WHERE id = NEW.planschicht_id)) BEGIN
    INSERT OR REPLACE INTO spiegel_neu_vergeben (einsatz_id, art, lokaler_schluessel, stand) SELECT (SELECT einsatz_id FROM einsatz_planschicht WHERE id = NEW.planschicht_id), 'einsatz_planschicht_person', CAST(NEW.id AS TEXT), 0 WHERE NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND EXISTS (SELECT 1 FROM einsatz_aenderung WHERE einsatz_id = (SELECT einsatz_id FROM einsatz_planschicht WHERE id = NEW.planschicht_id) AND art = 'einsatz_planschicht_person' AND schluessel = CAST(NEW.id AS TEXT));
    DELETE FROM spiegel_herkunft WHERE NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND art = 'einsatz_planschicht_person' AND lokaler_schluessel = CAST(NEW.id AS TEXT);
    DELETE FROM einsatz_aenderung WHERE einsatz_id = (SELECT einsatz_id FROM einsatz_planschicht WHERE id = NEW.planschicht_id) AND art = 'einsatz_planschicht_person' AND schluessel = CAST(NEW.id AS TEXT);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) VALUES ((SELECT einsatz_id FROM einsatz_planschicht WHERE id = NEW.planschicht_id), 'einsatz_planschicht_person', CAST(NEW.id AS TEXT));
    UPDATE spiegel_neu_vergeben SET stand = (SELECT stand FROM einsatz_aenderung WHERE einsatz_id = (SELECT einsatz_id FROM einsatz_planschicht WHERE id = NEW.planschicht_id) AND art = 'einsatz_planschicht_person' AND schluessel = CAST(NEW.id AS TEXT)) WHERE einsatz_id = (SELECT einsatz_id FROM einsatz_planschicht WHERE id = NEW.planschicht_id) AND art = 'einsatz_planschicht_person' AND lokaler_schluessel = CAST(NEW.id AS TEXT) AND stand = 0;
END;
DROP TRIGGER einsatz_plan_wechsel_spiegellog_i;
CREATE TRIGGER einsatz_plan_wechsel_spiegellog_i AFTER INSERT ON einsatz_plan_wechsel WHEN EXISTS (SELECT 1 FROM einsatz WHERE id = NEW.einsatz_id) BEGIN
    INSERT OR REPLACE INTO spiegel_neu_vergeben (einsatz_id, art, lokaler_schluessel, stand) SELECT NEW.einsatz_id, 'einsatz_plan_wechsel', CAST(NEW.id AS TEXT), 0 WHERE NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND EXISTS (SELECT 1 FROM einsatz_aenderung WHERE einsatz_id = NEW.einsatz_id AND art = 'einsatz_plan_wechsel' AND schluessel = CAST(NEW.id AS TEXT));
    DELETE FROM spiegel_herkunft WHERE NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND art = 'einsatz_plan_wechsel' AND lokaler_schluessel = CAST(NEW.id AS TEXT);
    DELETE FROM einsatz_aenderung WHERE einsatz_id = NEW.einsatz_id AND art = 'einsatz_plan_wechsel' AND schluessel = CAST(NEW.id AS TEXT);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) VALUES (NEW.einsatz_id, 'einsatz_plan_wechsel', CAST(NEW.id AS TEXT));
    UPDATE spiegel_neu_vergeben SET stand = (SELECT stand FROM einsatz_aenderung WHERE einsatz_id = NEW.einsatz_id AND art = 'einsatz_plan_wechsel' AND schluessel = CAST(NEW.id AS TEXT)) WHERE einsatz_id = NEW.einsatz_id AND art = 'einsatz_plan_wechsel' AND lokaler_schluessel = CAST(NEW.id AS TEXT) AND stand = 0;
END;
DROP TRIGGER einsatz_kraft_zeitachse_spiegellog_i;
CREATE TRIGGER einsatz_kraft_zeitachse_spiegellog_i AFTER INSERT ON einsatz_kraft_zeitachse WHEN EXISTS (SELECT 1 FROM einsatz WHERE id = NEW.einsatz_id) BEGIN
    INSERT OR REPLACE INTO spiegel_neu_vergeben (einsatz_id, art, lokaler_schluessel, stand) SELECT NEW.einsatz_id, 'einsatz_kraft_zeitachse', CAST(NEW.id AS TEXT), 0 WHERE NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND EXISTS (SELECT 1 FROM einsatz_aenderung WHERE einsatz_id = NEW.einsatz_id AND art = 'einsatz_kraft_zeitachse' AND schluessel = CAST(NEW.id AS TEXT));
    DELETE FROM spiegel_herkunft WHERE NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND art = 'einsatz_kraft_zeitachse' AND lokaler_schluessel = CAST(NEW.id AS TEXT);
    DELETE FROM einsatz_aenderung WHERE einsatz_id = NEW.einsatz_id AND art = 'einsatz_kraft_zeitachse' AND schluessel = CAST(NEW.id AS TEXT);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) VALUES (NEW.einsatz_id, 'einsatz_kraft_zeitachse', CAST(NEW.id AS TEXT));
    UPDATE spiegel_neu_vergeben SET stand = (SELECT stand FROM einsatz_aenderung WHERE einsatz_id = NEW.einsatz_id AND art = 'einsatz_kraft_zeitachse' AND schluessel = CAST(NEW.id AS TEXT)) WHERE einsatz_id = NEW.einsatz_id AND art = 'einsatz_kraft_zeitachse' AND lokaler_schluessel = CAST(NEW.id AS TEXT) AND stand = 0;
END;
DROP TRIGGER bereitstellungsraum_spiegellog_i;
CREATE TRIGGER bereitstellungsraum_spiegellog_i AFTER INSERT ON bereitstellungsraum WHEN EXISTS (SELECT 1 FROM einsatz WHERE id = NEW.einsatz_id) BEGIN
    INSERT OR REPLACE INTO spiegel_neu_vergeben (einsatz_id, art, lokaler_schluessel, stand) SELECT NEW.einsatz_id, 'bereitstellungsraum', CAST(NEW.id AS TEXT), 0 WHERE NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND EXISTS (SELECT 1 FROM einsatz_aenderung WHERE einsatz_id = NEW.einsatz_id AND art = 'bereitstellungsraum' AND schluessel = CAST(NEW.id AS TEXT));
    DELETE FROM spiegel_herkunft WHERE NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND art = 'bereitstellungsraum' AND lokaler_schluessel = CAST(NEW.id AS TEXT);
    DELETE FROM einsatz_aenderung WHERE einsatz_id = NEW.einsatz_id AND art = 'bereitstellungsraum' AND schluessel = CAST(NEW.id AS TEXT);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) VALUES (NEW.einsatz_id, 'bereitstellungsraum', CAST(NEW.id AS TEXT));
    UPDATE spiegel_neu_vergeben SET stand = (SELECT stand FROM einsatz_aenderung WHERE einsatz_id = NEW.einsatz_id AND art = 'bereitstellungsraum' AND schluessel = CAST(NEW.id AS TEXT)) WHERE einsatz_id = NEW.einsatz_id AND art = 'bereitstellungsraum' AND lokaler_schluessel = CAST(NEW.id AS TEXT) AND stand = 0;
END;
DROP TRIGGER br_belegung_spiegellog_i;
CREATE TRIGGER br_belegung_spiegellog_i AFTER INSERT ON br_belegung WHEN EXISTS (SELECT 1 FROM einsatz WHERE id = NEW.einsatz_id) BEGIN
    INSERT OR REPLACE INTO spiegel_neu_vergeben (einsatz_id, art, lokaler_schluessel, stand) SELECT NEW.einsatz_id, 'br_belegung', CAST(NEW.id AS TEXT), 0 WHERE NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND EXISTS (SELECT 1 FROM einsatz_aenderung WHERE einsatz_id = NEW.einsatz_id AND art = 'br_belegung' AND schluessel = CAST(NEW.id AS TEXT));
    DELETE FROM spiegel_herkunft WHERE NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND art = 'br_belegung' AND lokaler_schluessel = CAST(NEW.id AS TEXT);
    DELETE FROM einsatz_aenderung WHERE einsatz_id = NEW.einsatz_id AND art = 'br_belegung' AND schluessel = CAST(NEW.id AS TEXT);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) VALUES (NEW.einsatz_id, 'br_belegung', CAST(NEW.id AS TEXT));
    UPDATE spiegel_neu_vergeben SET stand = (SELECT stand FROM einsatz_aenderung WHERE einsatz_id = NEW.einsatz_id AND art = 'br_belegung' AND schluessel = CAST(NEW.id AS TEXT)) WHERE einsatz_id = NEW.einsatz_id AND art = 'br_belegung' AND lokaler_schluessel = CAST(NEW.id AS TEXT) AND stand = 0;
END;
DROP TRIGGER einsatz_person_spiegellog_i;
CREATE TRIGGER einsatz_person_spiegellog_i AFTER INSERT ON einsatz_person WHEN EXISTS (SELECT 1 FROM einsatz WHERE id = NEW.einsatz_id) BEGIN
    INSERT OR REPLACE INTO spiegel_neu_vergeben (einsatz_id, art, lokaler_schluessel, stand) SELECT NEW.einsatz_id, 'einsatz_person', CAST(NEW.id AS TEXT), 0 WHERE NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND EXISTS (SELECT 1 FROM einsatz_aenderung WHERE einsatz_id = NEW.einsatz_id AND art = 'einsatz_person' AND schluessel = CAST(NEW.id AS TEXT));
    DELETE FROM spiegel_herkunft WHERE NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND art = 'einsatz_person' AND lokaler_schluessel = CAST(NEW.id AS TEXT);
    DELETE FROM einsatz_aenderung WHERE einsatz_id = NEW.einsatz_id AND art = 'einsatz_person' AND schluessel = CAST(NEW.id AS TEXT);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) VALUES (NEW.einsatz_id, 'einsatz_person', CAST(NEW.id AS TEXT));
    UPDATE spiegel_neu_vergeben SET stand = (SELECT stand FROM einsatz_aenderung WHERE einsatz_id = NEW.einsatz_id AND art = 'einsatz_person' AND schluessel = CAST(NEW.id AS TEXT)) WHERE einsatz_id = NEW.einsatz_id AND art = 'einsatz_person' AND lokaler_schluessel = CAST(NEW.id AS TEXT) AND stand = 0;
END;
DROP TRIGGER person_anlass_spiegellog_i;
CREATE TRIGGER person_anlass_spiegellog_i AFTER INSERT ON person_anlass WHEN EXISTS (SELECT 1 FROM einsatz WHERE id = NEW.einsatz_id) BEGIN
    INSERT OR REPLACE INTO spiegel_neu_vergeben (einsatz_id, art, lokaler_schluessel, stand) SELECT NEW.einsatz_id, 'person_anlass', CAST(NEW.id AS TEXT), 0 WHERE NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND EXISTS (SELECT 1 FROM einsatz_aenderung WHERE einsatz_id = NEW.einsatz_id AND art = 'person_anlass' AND schluessel = CAST(NEW.id AS TEXT));
    DELETE FROM spiegel_herkunft WHERE NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND art = 'person_anlass' AND lokaler_schluessel = CAST(NEW.id AS TEXT);
    DELETE FROM einsatz_aenderung WHERE einsatz_id = NEW.einsatz_id AND art = 'person_anlass' AND schluessel = CAST(NEW.id AS TEXT);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) VALUES (NEW.einsatz_id, 'person_anlass', CAST(NEW.id AS TEXT));
    UPDATE spiegel_neu_vergeben SET stand = (SELECT stand FROM einsatz_aenderung WHERE einsatz_id = NEW.einsatz_id AND art = 'person_anlass' AND schluessel = CAST(NEW.id AS TEXT)) WHERE einsatz_id = NEW.einsatz_id AND art = 'person_anlass' AND lokaler_schluessel = CAST(NEW.id AS TEXT) AND stand = 0;
END;
DROP TRIGGER person_transport_spiegellog_i;
CREATE TRIGGER person_transport_spiegellog_i AFTER INSERT ON person_transport WHEN EXISTS (SELECT 1 FROM einsatz WHERE id = NEW.einsatz_id) BEGIN
    INSERT OR REPLACE INTO spiegel_neu_vergeben (einsatz_id, art, lokaler_schluessel, stand) SELECT NEW.einsatz_id, 'person_transport', CAST(NEW.id AS TEXT), 0 WHERE NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND EXISTS (SELECT 1 FROM einsatz_aenderung WHERE einsatz_id = NEW.einsatz_id AND art = 'person_transport' AND schluessel = CAST(NEW.id AS TEXT));
    DELETE FROM spiegel_herkunft WHERE NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND art = 'person_transport' AND lokaler_schluessel = CAST(NEW.id AS TEXT);
    DELETE FROM einsatz_aenderung WHERE einsatz_id = NEW.einsatz_id AND art = 'person_transport' AND schluessel = CAST(NEW.id AS TEXT);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) VALUES (NEW.einsatz_id, 'person_transport', CAST(NEW.id AS TEXT));
    UPDATE spiegel_neu_vergeben SET stand = (SELECT stand FROM einsatz_aenderung WHERE einsatz_id = NEW.einsatz_id AND art = 'person_transport' AND schluessel = CAST(NEW.id AS TEXT)) WHERE einsatz_id = NEW.einsatz_id AND art = 'person_transport' AND lokaler_schluessel = CAST(NEW.id AS TEXT) AND stand = 0;
END;
DROP TRIGGER person_sichtung_spiegellog_i;
CREATE TRIGGER person_sichtung_spiegellog_i AFTER INSERT ON person_sichtung WHEN EXISTS (SELECT 1 FROM einsatz WHERE id = NEW.einsatz_id) BEGIN
    INSERT OR REPLACE INTO spiegel_neu_vergeben (einsatz_id, art, lokaler_schluessel, stand) SELECT NEW.einsatz_id, 'person_sichtung', CAST(NEW.id AS TEXT), 0 WHERE NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND EXISTS (SELECT 1 FROM einsatz_aenderung WHERE einsatz_id = NEW.einsatz_id AND art = 'person_sichtung' AND schluessel = CAST(NEW.id AS TEXT));
    DELETE FROM spiegel_herkunft WHERE NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND art = 'person_sichtung' AND lokaler_schluessel = CAST(NEW.id AS TEXT);
    DELETE FROM einsatz_aenderung WHERE einsatz_id = NEW.einsatz_id AND art = 'person_sichtung' AND schluessel = CAST(NEW.id AS TEXT);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) VALUES (NEW.einsatz_id, 'person_sichtung', CAST(NEW.id AS TEXT));
    UPDATE spiegel_neu_vergeben SET stand = (SELECT stand FROM einsatz_aenderung WHERE einsatz_id = NEW.einsatz_id AND art = 'person_sichtung' AND schluessel = CAST(NEW.id AS TEXT)) WHERE einsatz_id = NEW.einsatz_id AND art = 'person_sichtung' AND lokaler_schluessel = CAST(NEW.id AS TEXT) AND stand = 0;
END;
DROP TRIGGER person_massnahme_spiegellog_i;
CREATE TRIGGER person_massnahme_spiegellog_i AFTER INSERT ON person_massnahme WHEN EXISTS (SELECT 1 FROM einsatz WHERE id = NEW.einsatz_id) BEGIN
    INSERT OR REPLACE INTO spiegel_neu_vergeben (einsatz_id, art, lokaler_schluessel, stand) SELECT NEW.einsatz_id, 'person_massnahme', CAST(NEW.id AS TEXT), 0 WHERE NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND EXISTS (SELECT 1 FROM einsatz_aenderung WHERE einsatz_id = NEW.einsatz_id AND art = 'person_massnahme' AND schluessel = CAST(NEW.id AS TEXT));
    DELETE FROM spiegel_herkunft WHERE NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND art = 'person_massnahme' AND lokaler_schluessel = CAST(NEW.id AS TEXT);
    DELETE FROM einsatz_aenderung WHERE einsatz_id = NEW.einsatz_id AND art = 'person_massnahme' AND schluessel = CAST(NEW.id AS TEXT);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) VALUES (NEW.einsatz_id, 'person_massnahme', CAST(NEW.id AS TEXT));
    UPDATE spiegel_neu_vergeben SET stand = (SELECT stand FROM einsatz_aenderung WHERE einsatz_id = NEW.einsatz_id AND art = 'person_massnahme' AND schluessel = CAST(NEW.id AS TEXT)) WHERE einsatz_id = NEW.einsatz_id AND art = 'person_massnahme' AND lokaler_schluessel = CAST(NEW.id AS TEXT) AND stand = 0;
END;
DROP TRIGGER person_verletzung_spiegellog_i;
CREATE TRIGGER person_verletzung_spiegellog_i AFTER INSERT ON person_verletzung WHEN EXISTS (SELECT 1 FROM einsatz WHERE id = NEW.einsatz_id) BEGIN
    INSERT OR REPLACE INTO spiegel_neu_vergeben (einsatz_id, art, lokaler_schluessel, stand) SELECT NEW.einsatz_id, 'person_verletzung', CAST(NEW.id AS TEXT), 0 WHERE NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND EXISTS (SELECT 1 FROM einsatz_aenderung WHERE einsatz_id = NEW.einsatz_id AND art = 'person_verletzung' AND schluessel = CAST(NEW.id AS TEXT));
    DELETE FROM spiegel_herkunft WHERE NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND art = 'person_verletzung' AND lokaler_schluessel = CAST(NEW.id AS TEXT);
    DELETE FROM einsatz_aenderung WHERE einsatz_id = NEW.einsatz_id AND art = 'person_verletzung' AND schluessel = CAST(NEW.id AS TEXT);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) VALUES (NEW.einsatz_id, 'person_verletzung', CAST(NEW.id AS TEXT));
    UPDATE spiegel_neu_vergeben SET stand = (SELECT stand FROM einsatz_aenderung WHERE einsatz_id = NEW.einsatz_id AND art = 'person_verletzung' AND schluessel = CAST(NEW.id AS TEXT)) WHERE einsatz_id = NEW.einsatz_id AND art = 'person_verletzung' AND lokaler_schluessel = CAST(NEW.id AS TEXT) AND stand = 0;
END;
DROP TRIGGER person_verlaufsnotiz_spiegellog_i;
CREATE TRIGGER person_verlaufsnotiz_spiegellog_i AFTER INSERT ON person_verlaufsnotiz WHEN EXISTS (SELECT 1 FROM einsatz WHERE id = NEW.einsatz_id) BEGIN
    INSERT OR REPLACE INTO spiegel_neu_vergeben (einsatz_id, art, lokaler_schluessel, stand) SELECT NEW.einsatz_id, 'person_verlaufsnotiz', CAST(NEW.id AS TEXT), 0 WHERE NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND EXISTS (SELECT 1 FROM einsatz_aenderung WHERE einsatz_id = NEW.einsatz_id AND art = 'person_verlaufsnotiz' AND schluessel = CAST(NEW.id AS TEXT));
    DELETE FROM spiegel_herkunft WHERE NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND art = 'person_verlaufsnotiz' AND lokaler_schluessel = CAST(NEW.id AS TEXT);
    DELETE FROM einsatz_aenderung WHERE einsatz_id = NEW.einsatz_id AND art = 'person_verlaufsnotiz' AND schluessel = CAST(NEW.id AS TEXT);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) VALUES (NEW.einsatz_id, 'person_verlaufsnotiz', CAST(NEW.id AS TEXT));
    UPDATE spiegel_neu_vergeben SET stand = (SELECT stand FROM einsatz_aenderung WHERE einsatz_id = NEW.einsatz_id AND art = 'person_verlaufsnotiz' AND schluessel = CAST(NEW.id AS TEXT)) WHERE einsatz_id = NEW.einsatz_id AND art = 'person_verlaufsnotiz' AND lokaler_schluessel = CAST(NEW.id AS TEXT) AND stand = 0;
END;
DROP TRIGGER person_verbleib_spiegellog_i;
CREATE TRIGGER person_verbleib_spiegellog_i AFTER INSERT ON person_verbleib WHEN EXISTS (SELECT 1 FROM einsatz WHERE id = NEW.einsatz_id) BEGIN
    INSERT OR REPLACE INTO spiegel_neu_vergeben (einsatz_id, art, lokaler_schluessel, stand) SELECT NEW.einsatz_id, 'person_verbleib', CAST(NEW.id AS TEXT), 0 WHERE NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND EXISTS (SELECT 1 FROM einsatz_aenderung WHERE einsatz_id = NEW.einsatz_id AND art = 'person_verbleib' AND schluessel = CAST(NEW.id AS TEXT));
    DELETE FROM spiegel_herkunft WHERE NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND art = 'person_verbleib' AND lokaler_schluessel = CAST(NEW.id AS TEXT);
    DELETE FROM einsatz_aenderung WHERE einsatz_id = NEW.einsatz_id AND art = 'person_verbleib' AND schluessel = CAST(NEW.id AS TEXT);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) VALUES (NEW.einsatz_id, 'person_verbleib', CAST(NEW.id AS TEXT));
    UPDATE spiegel_neu_vergeben SET stand = (SELECT stand FROM einsatz_aenderung WHERE einsatz_id = NEW.einsatz_id AND art = 'person_verbleib' AND schluessel = CAST(NEW.id AS TEXT)) WHERE einsatz_id = NEW.einsatz_id AND art = 'person_verbleib' AND lokaler_schluessel = CAST(NEW.id AS TEXT) AND stand = 0;
END;
DROP TRIGGER person_uhs_belegung_spiegellog_i;
CREATE TRIGGER person_uhs_belegung_spiegellog_i AFTER INSERT ON person_uhs_belegung WHEN EXISTS (SELECT 1 FROM einsatz WHERE id = NEW.einsatz_id) BEGIN
    INSERT OR REPLACE INTO spiegel_neu_vergeben (einsatz_id, art, lokaler_schluessel, stand) SELECT NEW.einsatz_id, 'person_uhs_belegung', CAST(NEW.id AS TEXT), 0 WHERE NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND EXISTS (SELECT 1 FROM einsatz_aenderung WHERE einsatz_id = NEW.einsatz_id AND art = 'person_uhs_belegung' AND schluessel = CAST(NEW.id AS TEXT));
    DELETE FROM spiegel_herkunft WHERE NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND art = 'person_uhs_belegung' AND lokaler_schluessel = CAST(NEW.id AS TEXT);
    DELETE FROM einsatz_aenderung WHERE einsatz_id = NEW.einsatz_id AND art = 'person_uhs_belegung' AND schluessel = CAST(NEW.id AS TEXT);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) VALUES (NEW.einsatz_id, 'person_uhs_belegung', CAST(NEW.id AS TEXT));
    UPDATE spiegel_neu_vergeben SET stand = (SELECT stand FROM einsatz_aenderung WHERE einsatz_id = NEW.einsatz_id AND art = 'person_uhs_belegung' AND schluessel = CAST(NEW.id AS TEXT)) WHERE einsatz_id = NEW.einsatz_id AND art = 'person_uhs_belegung' AND lokaler_schluessel = CAST(NEW.id AS TEXT) AND stand = 0;
END;
DROP TRIGGER person_abgleich_spiegellog_i;
CREATE TRIGGER person_abgleich_spiegellog_i AFTER INSERT ON person_abgleich WHEN EXISTS (SELECT 1 FROM einsatz WHERE id = NEW.einsatz_id) BEGIN
    INSERT OR REPLACE INTO spiegel_neu_vergeben (einsatz_id, art, lokaler_schluessel, stand) SELECT NEW.einsatz_id, 'person_abgleich', CAST(NEW.id AS TEXT), 0 WHERE NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND EXISTS (SELECT 1 FROM einsatz_aenderung WHERE einsatz_id = NEW.einsatz_id AND art = 'person_abgleich' AND schluessel = CAST(NEW.id AS TEXT));
    DELETE FROM spiegel_herkunft WHERE NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND art = 'person_abgleich' AND lokaler_schluessel = CAST(NEW.id AS TEXT);
    DELETE FROM einsatz_aenderung WHERE einsatz_id = NEW.einsatz_id AND art = 'person_abgleich' AND schluessel = CAST(NEW.id AS TEXT);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) VALUES (NEW.einsatz_id, 'person_abgleich', CAST(NEW.id AS TEXT));
    UPDATE spiegel_neu_vergeben SET stand = (SELECT stand FROM einsatz_aenderung WHERE einsatz_id = NEW.einsatz_id AND art = 'person_abgleich' AND schluessel = CAST(NEW.id AS TEXT)) WHERE einsatz_id = NEW.einsatz_id AND art = 'person_abgleich' AND lokaler_schluessel = CAST(NEW.id AS TEXT) AND stand = 0;
END;
DROP TRIGGER uhs_spiegellog_i;
CREATE TRIGGER uhs_spiegellog_i AFTER INSERT ON uhs WHEN EXISTS (SELECT 1 FROM einsatz WHERE id = NEW.einsatz_id) BEGIN
    INSERT OR REPLACE INTO spiegel_neu_vergeben (einsatz_id, art, lokaler_schluessel, stand) SELECT NEW.einsatz_id, 'uhs', CAST(NEW.id AS TEXT), 0 WHERE NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND EXISTS (SELECT 1 FROM einsatz_aenderung WHERE einsatz_id = NEW.einsatz_id AND art = 'uhs' AND schluessel = CAST(NEW.id AS TEXT));
    DELETE FROM spiegel_herkunft WHERE NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND art = 'uhs' AND lokaler_schluessel = CAST(NEW.id AS TEXT);
    DELETE FROM einsatz_aenderung WHERE einsatz_id = NEW.einsatz_id AND art = 'uhs' AND schluessel = CAST(NEW.id AS TEXT);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) VALUES (NEW.einsatz_id, 'uhs', CAST(NEW.id AS TEXT));
    UPDATE spiegel_neu_vergeben SET stand = (SELECT stand FROM einsatz_aenderung WHERE einsatz_id = NEW.einsatz_id AND art = 'uhs' AND schluessel = CAST(NEW.id AS TEXT)) WHERE einsatz_id = NEW.einsatz_id AND art = 'uhs' AND lokaler_schluessel = CAST(NEW.id AS TEXT) AND stand = 0;
END;
DROP TRIGGER uhs_platz_spiegellog_i;
CREATE TRIGGER uhs_platz_spiegellog_i AFTER INSERT ON uhs_platz WHEN EXISTS (SELECT 1 FROM einsatz WHERE id = (SELECT einsatz_id FROM uhs WHERE id = NEW.uhs_id)) BEGIN
    INSERT OR REPLACE INTO spiegel_neu_vergeben (einsatz_id, art, lokaler_schluessel, stand) SELECT (SELECT einsatz_id FROM uhs WHERE id = NEW.uhs_id), 'uhs_platz', CAST(NEW.id AS TEXT), 0 WHERE NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND EXISTS (SELECT 1 FROM einsatz_aenderung WHERE einsatz_id = (SELECT einsatz_id FROM uhs WHERE id = NEW.uhs_id) AND art = 'uhs_platz' AND schluessel = CAST(NEW.id AS TEXT));
    DELETE FROM spiegel_herkunft WHERE NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND art = 'uhs_platz' AND lokaler_schluessel = CAST(NEW.id AS TEXT);
    DELETE FROM einsatz_aenderung WHERE einsatz_id = (SELECT einsatz_id FROM uhs WHERE id = NEW.uhs_id) AND art = 'uhs_platz' AND schluessel = CAST(NEW.id AS TEXT);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) VALUES ((SELECT einsatz_id FROM uhs WHERE id = NEW.uhs_id), 'uhs_platz', CAST(NEW.id AS TEXT));
    UPDATE spiegel_neu_vergeben SET stand = (SELECT stand FROM einsatz_aenderung WHERE einsatz_id = (SELECT einsatz_id FROM uhs WHERE id = NEW.uhs_id) AND art = 'uhs_platz' AND schluessel = CAST(NEW.id AS TEXT)) WHERE einsatz_id = (SELECT einsatz_id FROM uhs WHERE id = NEW.uhs_id) AND art = 'uhs_platz' AND lokaler_schluessel = CAST(NEW.id AS TEXT) AND stand = 0;
END;
DROP TRIGGER evakuierungsbezirk_spiegellog_i;
CREATE TRIGGER evakuierungsbezirk_spiegellog_i AFTER INSERT ON evakuierungsbezirk WHEN EXISTS (SELECT 1 FROM einsatz WHERE id = NEW.einsatz_id) BEGIN
    INSERT OR REPLACE INTO spiegel_neu_vergeben (einsatz_id, art, lokaler_schluessel, stand) SELECT NEW.einsatz_id, 'evakuierungsbezirk', CAST(NEW.id AS TEXT), 0 WHERE NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND EXISTS (SELECT 1 FROM einsatz_aenderung WHERE einsatz_id = NEW.einsatz_id AND art = 'evakuierungsbezirk' AND schluessel = CAST(NEW.id AS TEXT));
    DELETE FROM spiegel_herkunft WHERE NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND art = 'evakuierungsbezirk' AND lokaler_schluessel = CAST(NEW.id AS TEXT);
    DELETE FROM einsatz_aenderung WHERE einsatz_id = NEW.einsatz_id AND art = 'evakuierungsbezirk' AND schluessel = CAST(NEW.id AS TEXT);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) VALUES (NEW.einsatz_id, 'evakuierungsbezirk', CAST(NEW.id AS TEXT));
    UPDATE spiegel_neu_vergeben SET stand = (SELECT stand FROM einsatz_aenderung WHERE einsatz_id = NEW.einsatz_id AND art = 'evakuierungsbezirk' AND schluessel = CAST(NEW.id AS TEXT)) WHERE einsatz_id = NEW.einsatz_id AND art = 'evakuierungsbezirk' AND lokaler_schluessel = CAST(NEW.id AS TEXT) AND stand = 0;
END;
DROP TRIGGER evakuierung_stand_spiegellog_i;
CREATE TRIGGER evakuierung_stand_spiegellog_i AFTER INSERT ON evakuierung_stand WHEN EXISTS (SELECT 1 FROM einsatz WHERE id = NEW.einsatz_id) BEGIN
    INSERT OR REPLACE INTO spiegel_neu_vergeben (einsatz_id, art, lokaler_schluessel, stand) SELECT NEW.einsatz_id, 'evakuierung_stand', CAST(NEW.id AS TEXT), 0 WHERE NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND EXISTS (SELECT 1 FROM einsatz_aenderung WHERE einsatz_id = NEW.einsatz_id AND art = 'evakuierung_stand' AND schluessel = CAST(NEW.id AS TEXT));
    DELETE FROM spiegel_herkunft WHERE NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND art = 'evakuierung_stand' AND lokaler_schluessel = CAST(NEW.id AS TEXT);
    DELETE FROM einsatz_aenderung WHERE einsatz_id = NEW.einsatz_id AND art = 'evakuierung_stand' AND schluessel = CAST(NEW.id AS TEXT);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) VALUES (NEW.einsatz_id, 'evakuierung_stand', CAST(NEW.id AS TEXT));
    UPDATE spiegel_neu_vergeben SET stand = (SELECT stand FROM einsatz_aenderung WHERE einsatz_id = NEW.einsatz_id AND art = 'evakuierung_stand' AND schluessel = CAST(NEW.id AS TEXT)) WHERE einsatz_id = NEW.einsatz_id AND art = 'evakuierung_stand' AND lokaler_schluessel = CAST(NEW.id AS TEXT) AND stand = 0;
END;
DROP TRIGGER haushalt_spiegellog_i;
CREATE TRIGGER haushalt_spiegellog_i AFTER INSERT ON haushalt WHEN EXISTS (SELECT 1 FROM einsatz WHERE id = NEW.einsatz_id) BEGIN
    INSERT OR REPLACE INTO spiegel_neu_vergeben (einsatz_id, art, lokaler_schluessel, stand) SELECT NEW.einsatz_id, 'haushalt', CAST(NEW.id AS TEXT), 0 WHERE NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND EXISTS (SELECT 1 FROM einsatz_aenderung WHERE einsatz_id = NEW.einsatz_id AND art = 'haushalt' AND schluessel = CAST(NEW.id AS TEXT));
    DELETE FROM spiegel_herkunft WHERE NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND art = 'haushalt' AND lokaler_schluessel = CAST(NEW.id AS TEXT);
    DELETE FROM einsatz_aenderung WHERE einsatz_id = NEW.einsatz_id AND art = 'haushalt' AND schluessel = CAST(NEW.id AS TEXT);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) VALUES (NEW.einsatz_id, 'haushalt', CAST(NEW.id AS TEXT));
    UPDATE spiegel_neu_vergeben SET stand = (SELECT stand FROM einsatz_aenderung WHERE einsatz_id = NEW.einsatz_id AND art = 'haushalt' AND schluessel = CAST(NEW.id AS TEXT)) WHERE einsatz_id = NEW.einsatz_id AND art = 'haushalt' AND lokaler_schluessel = CAST(NEW.id AS TEXT) AND stand = 0;
END;
DROP TRIGGER betreuungsstelle_spiegellog_i;
CREATE TRIGGER betreuungsstelle_spiegellog_i AFTER INSERT ON betreuungsstelle WHEN EXISTS (SELECT 1 FROM einsatz WHERE id = NEW.einsatz_id) BEGIN
    INSERT OR REPLACE INTO spiegel_neu_vergeben (einsatz_id, art, lokaler_schluessel, stand) SELECT NEW.einsatz_id, 'betreuungsstelle', CAST(NEW.id AS TEXT), 0 WHERE NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND EXISTS (SELECT 1 FROM einsatz_aenderung WHERE einsatz_id = NEW.einsatz_id AND art = 'betreuungsstelle' AND schluessel = CAST(NEW.id AS TEXT));
    DELETE FROM spiegel_herkunft WHERE NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND art = 'betreuungsstelle' AND lokaler_schluessel = CAST(NEW.id AS TEXT);
    DELETE FROM einsatz_aenderung WHERE einsatz_id = NEW.einsatz_id AND art = 'betreuungsstelle' AND schluessel = CAST(NEW.id AS TEXT);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) VALUES (NEW.einsatz_id, 'betreuungsstelle', CAST(NEW.id AS TEXT));
    UPDATE spiegel_neu_vergeben SET stand = (SELECT stand FROM einsatz_aenderung WHERE einsatz_id = NEW.einsatz_id AND art = 'betreuungsstelle' AND schluessel = CAST(NEW.id AS TEXT)) WHERE einsatz_id = NEW.einsatz_id AND art = 'betreuungsstelle' AND lokaler_schluessel = CAST(NEW.id AS TEXT) AND stand = 0;
END;
DROP TRIGGER betreuungsstelle_belegung_spiegellog_i;
CREATE TRIGGER betreuungsstelle_belegung_spiegellog_i AFTER INSERT ON betreuungsstelle_belegung WHEN EXISTS (SELECT 1 FROM einsatz WHERE id = NEW.einsatz_id) BEGIN
    INSERT OR REPLACE INTO spiegel_neu_vergeben (einsatz_id, art, lokaler_schluessel, stand) SELECT NEW.einsatz_id, 'betreuungsstelle_belegung', CAST(NEW.id AS TEXT), 0 WHERE NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND EXISTS (SELECT 1 FROM einsatz_aenderung WHERE einsatz_id = NEW.einsatz_id AND art = 'betreuungsstelle_belegung' AND schluessel = CAST(NEW.id AS TEXT));
    DELETE FROM spiegel_herkunft WHERE NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND art = 'betreuungsstelle_belegung' AND lokaler_schluessel = CAST(NEW.id AS TEXT);
    DELETE FROM einsatz_aenderung WHERE einsatz_id = NEW.einsatz_id AND art = 'betreuungsstelle_belegung' AND schluessel = CAST(NEW.id AS TEXT);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) VALUES (NEW.einsatz_id, 'betreuungsstelle_belegung', CAST(NEW.id AS TEXT));
    UPDATE spiegel_neu_vergeben SET stand = (SELECT stand FROM einsatz_aenderung WHERE einsatz_id = NEW.einsatz_id AND art = 'betreuungsstelle_belegung' AND schluessel = CAST(NEW.id AS TEXT)) WHERE einsatz_id = NEW.einsatz_id AND art = 'betreuungsstelle_belegung' AND lokaler_schluessel = CAST(NEW.id AS TEXT) AND stand = 0;
END;
DROP TRIGGER verpflegung_zeitfenster_spiegellog_i;
CREATE TRIGGER verpflegung_zeitfenster_spiegellog_i AFTER INSERT ON verpflegung_zeitfenster WHEN EXISTS (SELECT 1 FROM einsatz WHERE id = NEW.einsatz_id) BEGIN
    INSERT OR REPLACE INTO spiegel_neu_vergeben (einsatz_id, art, lokaler_schluessel, stand) SELECT NEW.einsatz_id, 'verpflegung_zeitfenster', CAST(NEW.id AS TEXT), 0 WHERE NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND EXISTS (SELECT 1 FROM einsatz_aenderung WHERE einsatz_id = NEW.einsatz_id AND art = 'verpflegung_zeitfenster' AND schluessel = CAST(NEW.id AS TEXT));
    DELETE FROM spiegel_herkunft WHERE NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND art = 'verpflegung_zeitfenster' AND lokaler_schluessel = CAST(NEW.id AS TEXT);
    DELETE FROM einsatz_aenderung WHERE einsatz_id = NEW.einsatz_id AND art = 'verpflegung_zeitfenster' AND schluessel = CAST(NEW.id AS TEXT);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) VALUES (NEW.einsatz_id, 'verpflegung_zeitfenster', CAST(NEW.id AS TEXT));
    UPDATE spiegel_neu_vergeben SET stand = (SELECT stand FROM einsatz_aenderung WHERE einsatz_id = NEW.einsatz_id AND art = 'verpflegung_zeitfenster' AND schluessel = CAST(NEW.id AS TEXT)) WHERE einsatz_id = NEW.einsatz_id AND art = 'verpflegung_zeitfenster' AND lokaler_schluessel = CAST(NEW.id AS TEXT) AND stand = 0;
END;
DROP TRIGGER verpflegungsstelle_spiegellog_i;
CREATE TRIGGER verpflegungsstelle_spiegellog_i AFTER INSERT ON verpflegungsstelle WHEN EXISTS (SELECT 1 FROM einsatz WHERE id = NEW.einsatz_id) BEGIN
    INSERT OR REPLACE INTO spiegel_neu_vergeben (einsatz_id, art, lokaler_schluessel, stand) SELECT NEW.einsatz_id, 'verpflegungsstelle', CAST(NEW.id AS TEXT), 0 WHERE NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND EXISTS (SELECT 1 FROM einsatz_aenderung WHERE einsatz_id = NEW.einsatz_id AND art = 'verpflegungsstelle' AND schluessel = CAST(NEW.id AS TEXT));
    DELETE FROM spiegel_herkunft WHERE NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND art = 'verpflegungsstelle' AND lokaler_schluessel = CAST(NEW.id AS TEXT);
    DELETE FROM einsatz_aenderung WHERE einsatz_id = NEW.einsatz_id AND art = 'verpflegungsstelle' AND schluessel = CAST(NEW.id AS TEXT);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) VALUES (NEW.einsatz_id, 'verpflegungsstelle', CAST(NEW.id AS TEXT));
    UPDATE spiegel_neu_vergeben SET stand = (SELECT stand FROM einsatz_aenderung WHERE einsatz_id = NEW.einsatz_id AND art = 'verpflegungsstelle' AND schluessel = CAST(NEW.id AS TEXT)) WHERE einsatz_id = NEW.einsatz_id AND art = 'verpflegungsstelle' AND lokaler_schluessel = CAST(NEW.id AS TEXT) AND stand = 0;
END;
DROP TRIGGER verpflegung_ausgabe_spiegellog_i;
CREATE TRIGGER verpflegung_ausgabe_spiegellog_i AFTER INSERT ON verpflegung_ausgabe WHEN EXISTS (SELECT 1 FROM einsatz WHERE id = NEW.einsatz_id) BEGIN
    INSERT OR REPLACE INTO spiegel_neu_vergeben (einsatz_id, art, lokaler_schluessel, stand) SELECT NEW.einsatz_id, 'verpflegung_ausgabe', CAST(NEW.id AS TEXT), 0 WHERE NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND EXISTS (SELECT 1 FROM einsatz_aenderung WHERE einsatz_id = NEW.einsatz_id AND art = 'verpflegung_ausgabe' AND schluessel = CAST(NEW.id AS TEXT));
    DELETE FROM spiegel_herkunft WHERE NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND art = 'verpflegung_ausgabe' AND lokaler_schluessel = CAST(NEW.id AS TEXT);
    DELETE FROM einsatz_aenderung WHERE einsatz_id = NEW.einsatz_id AND art = 'verpflegung_ausgabe' AND schluessel = CAST(NEW.id AS TEXT);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) VALUES (NEW.einsatz_id, 'verpflegung_ausgabe', CAST(NEW.id AS TEXT));
    UPDATE spiegel_neu_vergeben SET stand = (SELECT stand FROM einsatz_aenderung WHERE einsatz_id = NEW.einsatz_id AND art = 'verpflegung_ausgabe' AND schluessel = CAST(NEW.id AS TEXT)) WHERE einsatz_id = NEW.einsatz_id AND art = 'verpflegung_ausgabe' AND lokaler_schluessel = CAST(NEW.id AS TEXT) AND stand = 0;
END;
DROP TRIGGER meldung_spiegellog_i;
CREATE TRIGGER meldung_spiegellog_i AFTER INSERT ON meldung WHEN EXISTS (SELECT 1 FROM einsatz WHERE id = NEW.einsatz_id) BEGIN
    INSERT OR REPLACE INTO spiegel_neu_vergeben (einsatz_id, art, lokaler_schluessel, stand) SELECT NEW.einsatz_id, 'meldung', CAST(NEW.id AS TEXT), 0 WHERE NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND EXISTS (SELECT 1 FROM einsatz_aenderung WHERE einsatz_id = NEW.einsatz_id AND art = 'meldung' AND schluessel = CAST(NEW.id AS TEXT));
    DELETE FROM spiegel_herkunft WHERE NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND art = 'meldung' AND lokaler_schluessel = CAST(NEW.id AS TEXT);
    DELETE FROM einsatz_aenderung WHERE einsatz_id = NEW.einsatz_id AND art = 'meldung' AND schluessel = CAST(NEW.id AS TEXT);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) VALUES (NEW.einsatz_id, 'meldung', CAST(NEW.id AS TEXT));
    UPDATE spiegel_neu_vergeben SET stand = (SELECT stand FROM einsatz_aenderung WHERE einsatz_id = NEW.einsatz_id AND art = 'meldung' AND schluessel = CAST(NEW.id AS TEXT)) WHERE einsatz_id = NEW.einsatz_id AND art = 'meldung' AND lokaler_schluessel = CAST(NEW.id AS TEXT) AND stand = 0;
END;
DROP TRIGGER auftrag_spiegellog_i;
CREATE TRIGGER auftrag_spiegellog_i AFTER INSERT ON auftrag WHEN EXISTS (SELECT 1 FROM einsatz WHERE id = NEW.einsatz_id) BEGIN
    INSERT OR REPLACE INTO spiegel_neu_vergeben (einsatz_id, art, lokaler_schluessel, stand) SELECT NEW.einsatz_id, 'auftrag', CAST(NEW.id AS TEXT), 0 WHERE NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND EXISTS (SELECT 1 FROM einsatz_aenderung WHERE einsatz_id = NEW.einsatz_id AND art = 'auftrag' AND schluessel = CAST(NEW.id AS TEXT));
    DELETE FROM spiegel_herkunft WHERE NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND art = 'auftrag' AND lokaler_schluessel = CAST(NEW.id AS TEXT);
    DELETE FROM einsatz_aenderung WHERE einsatz_id = NEW.einsatz_id AND art = 'auftrag' AND schluessel = CAST(NEW.id AS TEXT);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) VALUES (NEW.einsatz_id, 'auftrag', CAST(NEW.id AS TEXT));
    UPDATE spiegel_neu_vergeben SET stand = (SELECT stand FROM einsatz_aenderung WHERE einsatz_id = NEW.einsatz_id AND art = 'auftrag' AND schluessel = CAST(NEW.id AS TEXT)) WHERE einsatz_id = NEW.einsatz_id AND art = 'auftrag' AND lokaler_schluessel = CAST(NEW.id AS TEXT) AND stand = 0;
END;
DROP TRIGGER auftrag_empfaenger_spiegellog_i;
CREATE TRIGGER auftrag_empfaenger_spiegellog_i AFTER INSERT ON auftrag_empfaenger WHEN EXISTS (SELECT 1 FROM einsatz WHERE id = (SELECT einsatz_id FROM auftrag WHERE id = NEW.auftrag_id)) BEGIN
    INSERT OR REPLACE INTO spiegel_neu_vergeben (einsatz_id, art, lokaler_schluessel, stand) SELECT (SELECT einsatz_id FROM auftrag WHERE id = NEW.auftrag_id), 'auftrag_empfaenger', CAST(NEW.id AS TEXT), 0 WHERE NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND EXISTS (SELECT 1 FROM einsatz_aenderung WHERE einsatz_id = (SELECT einsatz_id FROM auftrag WHERE id = NEW.auftrag_id) AND art = 'auftrag_empfaenger' AND schluessel = CAST(NEW.id AS TEXT));
    DELETE FROM spiegel_herkunft WHERE NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND art = 'auftrag_empfaenger' AND lokaler_schluessel = CAST(NEW.id AS TEXT);
    DELETE FROM einsatz_aenderung WHERE einsatz_id = (SELECT einsatz_id FROM auftrag WHERE id = NEW.auftrag_id) AND art = 'auftrag_empfaenger' AND schluessel = CAST(NEW.id AS TEXT);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) VALUES ((SELECT einsatz_id FROM auftrag WHERE id = NEW.auftrag_id), 'auftrag_empfaenger', CAST(NEW.id AS TEXT));
    UPDATE spiegel_neu_vergeben SET stand = (SELECT stand FROM einsatz_aenderung WHERE einsatz_id = (SELECT einsatz_id FROM auftrag WHERE id = NEW.auftrag_id) AND art = 'auftrag_empfaenger' AND schluessel = CAST(NEW.id AS TEXT)) WHERE einsatz_id = (SELECT einsatz_id FROM auftrag WHERE id = NEW.auftrag_id) AND art = 'auftrag_empfaenger' AND lokaler_schluessel = CAST(NEW.id AS TEXT) AND stand = 0;
END;
DROP TRIGGER befehl_spiegellog_i;
CREATE TRIGGER befehl_spiegellog_i AFTER INSERT ON befehl WHEN EXISTS (SELECT 1 FROM einsatz WHERE id = NEW.einsatz_id) BEGIN
    INSERT OR REPLACE INTO spiegel_neu_vergeben (einsatz_id, art, lokaler_schluessel, stand) SELECT NEW.einsatz_id, 'befehl', CAST(NEW.id AS TEXT), 0 WHERE NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND EXISTS (SELECT 1 FROM einsatz_aenderung WHERE einsatz_id = NEW.einsatz_id AND art = 'befehl' AND schluessel = CAST(NEW.id AS TEXT));
    DELETE FROM spiegel_herkunft WHERE NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND art = 'befehl' AND lokaler_schluessel = CAST(NEW.id AS TEXT);
    DELETE FROM einsatz_aenderung WHERE einsatz_id = NEW.einsatz_id AND art = 'befehl' AND schluessel = CAST(NEW.id AS TEXT);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) VALUES (NEW.einsatz_id, 'befehl', CAST(NEW.id AS TEXT));
    UPDATE spiegel_neu_vergeben SET stand = (SELECT stand FROM einsatz_aenderung WHERE einsatz_id = NEW.einsatz_id AND art = 'befehl' AND schluessel = CAST(NEW.id AS TEXT)) WHERE einsatz_id = NEW.einsatz_id AND art = 'befehl' AND lokaler_schluessel = CAST(NEW.id AS TEXT) AND stand = 0;
END;
DROP TRIGGER befehl_verteiler_spiegellog_i;
CREATE TRIGGER befehl_verteiler_spiegellog_i AFTER INSERT ON befehl_verteiler WHEN EXISTS (SELECT 1 FROM einsatz WHERE id = NEW.einsatz_id) BEGIN
    INSERT OR REPLACE INTO spiegel_neu_vergeben (einsatz_id, art, lokaler_schluessel, stand) SELECT NEW.einsatz_id, 'befehl_verteiler', CAST(NEW.id AS TEXT), 0 WHERE NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND EXISTS (SELECT 1 FROM einsatz_aenderung WHERE einsatz_id = NEW.einsatz_id AND art = 'befehl_verteiler' AND schluessel = CAST(NEW.id AS TEXT));
    DELETE FROM spiegel_herkunft WHERE NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND art = 'befehl_verteiler' AND lokaler_schluessel = CAST(NEW.id AS TEXT);
    DELETE FROM einsatz_aenderung WHERE einsatz_id = NEW.einsatz_id AND art = 'befehl_verteiler' AND schluessel = CAST(NEW.id AS TEXT);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) VALUES (NEW.einsatz_id, 'befehl_verteiler', CAST(NEW.id AS TEXT));
    UPDATE spiegel_neu_vergeben SET stand = (SELECT stand FROM einsatz_aenderung WHERE einsatz_id = NEW.einsatz_id AND art = 'befehl_verteiler' AND schluessel = CAST(NEW.id AS TEXT)) WHERE einsatz_id = NEW.einsatz_id AND art = 'befehl_verteiler' AND lokaler_schluessel = CAST(NEW.id AS TEXT) AND stand = 0;
END;
DROP TRIGGER lagebericht_spiegellog_i;
CREATE TRIGGER lagebericht_spiegellog_i AFTER INSERT ON lagebericht WHEN EXISTS (SELECT 1 FROM einsatz WHERE id = NEW.einsatz_id) BEGIN
    INSERT OR REPLACE INTO spiegel_neu_vergeben (einsatz_id, art, lokaler_schluessel, stand) SELECT NEW.einsatz_id, 'lagebericht', CAST(NEW.id AS TEXT), 0 WHERE NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND EXISTS (SELECT 1 FROM einsatz_aenderung WHERE einsatz_id = NEW.einsatz_id AND art = 'lagebericht' AND schluessel = CAST(NEW.id AS TEXT));
    DELETE FROM spiegel_herkunft WHERE NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND art = 'lagebericht' AND lokaler_schluessel = CAST(NEW.id AS TEXT);
    DELETE FROM einsatz_aenderung WHERE einsatz_id = NEW.einsatz_id AND art = 'lagebericht' AND schluessel = CAST(NEW.id AS TEXT);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) VALUES (NEW.einsatz_id, 'lagebericht', CAST(NEW.id AS TEXT));
    UPDATE spiegel_neu_vergeben SET stand = (SELECT stand FROM einsatz_aenderung WHERE einsatz_id = NEW.einsatz_id AND art = 'lagebericht' AND schluessel = CAST(NEW.id AS TEXT)) WHERE einsatz_id = NEW.einsatz_id AND art = 'lagebericht' AND lokaler_schluessel = CAST(NEW.id AS TEXT) AND stand = 0;
END;
DROP TRIGGER lagebericht_verteiler_spiegellog_i;
CREATE TRIGGER lagebericht_verteiler_spiegellog_i AFTER INSERT ON lagebericht_verteiler WHEN EXISTS (SELECT 1 FROM einsatz WHERE id = NEW.einsatz_id) BEGIN
    INSERT OR REPLACE INTO spiegel_neu_vergeben (einsatz_id, art, lokaler_schluessel, stand) SELECT NEW.einsatz_id, 'lagebericht_verteiler', CAST(NEW.id AS TEXT), 0 WHERE NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND EXISTS (SELECT 1 FROM einsatz_aenderung WHERE einsatz_id = NEW.einsatz_id AND art = 'lagebericht_verteiler' AND schluessel = CAST(NEW.id AS TEXT));
    DELETE FROM spiegel_herkunft WHERE NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND art = 'lagebericht_verteiler' AND lokaler_schluessel = CAST(NEW.id AS TEXT);
    DELETE FROM einsatz_aenderung WHERE einsatz_id = NEW.einsatz_id AND art = 'lagebericht_verteiler' AND schluessel = CAST(NEW.id AS TEXT);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) VALUES (NEW.einsatz_id, 'lagebericht_verteiler', CAST(NEW.id AS TEXT));
    UPDATE spiegel_neu_vergeben SET stand = (SELECT stand FROM einsatz_aenderung WHERE einsatz_id = NEW.einsatz_id AND art = 'lagebericht_verteiler' AND schluessel = CAST(NEW.id AS TEXT)) WHERE einsatz_id = NEW.einsatz_id AND art = 'lagebericht_verteiler' AND lokaler_schluessel = CAST(NEW.id AS TEXT) AND stand = 0;
END;
DROP TRIGGER nachforderung_spiegellog_i;
CREATE TRIGGER nachforderung_spiegellog_i AFTER INSERT ON nachforderung WHEN EXISTS (SELECT 1 FROM einsatz WHERE id = NEW.einsatz_id) BEGIN
    INSERT OR REPLACE INTO spiegel_neu_vergeben (einsatz_id, art, lokaler_schluessel, stand) SELECT NEW.einsatz_id, 'nachforderung', CAST(NEW.id AS TEXT), 0 WHERE NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND EXISTS (SELECT 1 FROM einsatz_aenderung WHERE einsatz_id = NEW.einsatz_id AND art = 'nachforderung' AND schluessel = CAST(NEW.id AS TEXT));
    DELETE FROM spiegel_herkunft WHERE NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND art = 'nachforderung' AND lokaler_schluessel = CAST(NEW.id AS TEXT);
    DELETE FROM einsatz_aenderung WHERE einsatz_id = NEW.einsatz_id AND art = 'nachforderung' AND schluessel = CAST(NEW.id AS TEXT);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) VALUES (NEW.einsatz_id, 'nachforderung', CAST(NEW.id AS TEXT));
    UPDATE spiegel_neu_vergeben SET stand = (SELECT stand FROM einsatz_aenderung WHERE einsatz_id = NEW.einsatz_id AND art = 'nachforderung' AND schluessel = CAST(NEW.id AS TEXT)) WHERE einsatz_id = NEW.einsatz_id AND art = 'nachforderung' AND lokaler_schluessel = CAST(NEW.id AS TEXT) AND stand = 0;
END;
DROP TRIGGER infotelefon_anruf_spiegellog_i;
CREATE TRIGGER infotelefon_anruf_spiegellog_i AFTER INSERT ON infotelefon_anruf WHEN EXISTS (SELECT 1 FROM einsatz WHERE id = NEW.einsatz_id) BEGIN
    INSERT OR REPLACE INTO spiegel_neu_vergeben (einsatz_id, art, lokaler_schluessel, stand) SELECT NEW.einsatz_id, 'infotelefon_anruf', CAST(NEW.id AS TEXT), 0 WHERE NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND EXISTS (SELECT 1 FROM einsatz_aenderung WHERE einsatz_id = NEW.einsatz_id AND art = 'infotelefon_anruf' AND schluessel = CAST(NEW.id AS TEXT));
    DELETE FROM spiegel_herkunft WHERE NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND art = 'infotelefon_anruf' AND lokaler_schluessel = CAST(NEW.id AS TEXT);
    DELETE FROM einsatz_aenderung WHERE einsatz_id = NEW.einsatz_id AND art = 'infotelefon_anruf' AND schluessel = CAST(NEW.id AS TEXT);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) VALUES (NEW.einsatz_id, 'infotelefon_anruf', CAST(NEW.id AS TEXT));
    UPDATE spiegel_neu_vergeben SET stand = (SELECT stand FROM einsatz_aenderung WHERE einsatz_id = NEW.einsatz_id AND art = 'infotelefon_anruf' AND schluessel = CAST(NEW.id AS TEXT)) WHERE einsatz_id = NEW.einsatz_id AND art = 'infotelefon_anruf' AND lokaler_schluessel = CAST(NEW.id AS TEXT) AND stand = 0;
END;
DROP TRIGGER chat_kanal_spiegellog_i;
CREATE TRIGGER chat_kanal_spiegellog_i AFTER INSERT ON chat_kanal WHEN EXISTS (SELECT 1 FROM einsatz WHERE id = NEW.einsatz_id) BEGIN
    INSERT OR REPLACE INTO spiegel_neu_vergeben (einsatz_id, art, lokaler_schluessel, stand) SELECT NEW.einsatz_id, 'chat_kanal', CAST(NEW.id AS TEXT), 0 WHERE NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND EXISTS (SELECT 1 FROM einsatz_aenderung WHERE einsatz_id = NEW.einsatz_id AND art = 'chat_kanal' AND schluessel = CAST(NEW.id AS TEXT));
    DELETE FROM spiegel_herkunft WHERE NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND art = 'chat_kanal' AND lokaler_schluessel = CAST(NEW.id AS TEXT);
    DELETE FROM einsatz_aenderung WHERE einsatz_id = NEW.einsatz_id AND art = 'chat_kanal' AND schluessel = CAST(NEW.id AS TEXT);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) VALUES (NEW.einsatz_id, 'chat_kanal', CAST(NEW.id AS TEXT));
    UPDATE spiegel_neu_vergeben SET stand = (SELECT stand FROM einsatz_aenderung WHERE einsatz_id = NEW.einsatz_id AND art = 'chat_kanal' AND schluessel = CAST(NEW.id AS TEXT)) WHERE einsatz_id = NEW.einsatz_id AND art = 'chat_kanal' AND lokaler_schluessel = CAST(NEW.id AS TEXT) AND stand = 0;
END;
DROP TRIGGER chat_nachricht_spiegellog_i;
CREATE TRIGGER chat_nachricht_spiegellog_i AFTER INSERT ON chat_nachricht WHEN EXISTS (SELECT 1 FROM einsatz WHERE id = NEW.einsatz_id) BEGIN
    INSERT OR REPLACE INTO spiegel_neu_vergeben (einsatz_id, art, lokaler_schluessel, stand) SELECT NEW.einsatz_id, 'chat_nachricht', CAST(NEW.id AS TEXT), 0 WHERE NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND EXISTS (SELECT 1 FROM einsatz_aenderung WHERE einsatz_id = NEW.einsatz_id AND art = 'chat_nachricht' AND schluessel = CAST(NEW.id AS TEXT));
    DELETE FROM spiegel_herkunft WHERE NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND art = 'chat_nachricht' AND lokaler_schluessel = CAST(NEW.id AS TEXT);
    DELETE FROM einsatz_aenderung WHERE einsatz_id = NEW.einsatz_id AND art = 'chat_nachricht' AND schluessel = CAST(NEW.id AS TEXT);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) VALUES (NEW.einsatz_id, 'chat_nachricht', CAST(NEW.id AS TEXT));
    UPDATE spiegel_neu_vergeben SET stand = (SELECT stand FROM einsatz_aenderung WHERE einsatz_id = NEW.einsatz_id AND art = 'chat_nachricht' AND schluessel = CAST(NEW.id AS TEXT)) WHERE einsatz_id = NEW.einsatz_id AND art = 'chat_nachricht' AND lokaler_schluessel = CAST(NEW.id AS TEXT) AND stand = 0;
END;
DROP TRIGGER chat_erwaehnung_spiegellog_i;
CREATE TRIGGER chat_erwaehnung_spiegellog_i AFTER INSERT ON chat_erwaehnung WHEN EXISTS (SELECT 1 FROM einsatz WHERE id = (SELECT einsatz_id FROM chat_nachricht WHERE id = NEW.nachricht_id)) BEGIN
    INSERT OR REPLACE INTO spiegel_neu_vergeben (einsatz_id, art, lokaler_schluessel, stand) SELECT (SELECT einsatz_id FROM chat_nachricht WHERE id = NEW.nachricht_id), 'chat_erwaehnung', CAST(NEW.id AS TEXT), 0 WHERE NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND EXISTS (SELECT 1 FROM einsatz_aenderung WHERE einsatz_id = (SELECT einsatz_id FROM chat_nachricht WHERE id = NEW.nachricht_id) AND art = 'chat_erwaehnung' AND schluessel = CAST(NEW.id AS TEXT));
    DELETE FROM spiegel_herkunft WHERE NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND art = 'chat_erwaehnung' AND lokaler_schluessel = CAST(NEW.id AS TEXT);
    DELETE FROM einsatz_aenderung WHERE einsatz_id = (SELECT einsatz_id FROM chat_nachricht WHERE id = NEW.nachricht_id) AND art = 'chat_erwaehnung' AND schluessel = CAST(NEW.id AS TEXT);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) VALUES ((SELECT einsatz_id FROM chat_nachricht WHERE id = NEW.nachricht_id), 'chat_erwaehnung', CAST(NEW.id AS TEXT));
    UPDATE spiegel_neu_vergeben SET stand = (SELECT stand FROM einsatz_aenderung WHERE einsatz_id = (SELECT einsatz_id FROM chat_nachricht WHERE id = NEW.nachricht_id) AND art = 'chat_erwaehnung' AND schluessel = CAST(NEW.id AS TEXT)) WHERE einsatz_id = (SELECT einsatz_id FROM chat_nachricht WHERE id = NEW.nachricht_id) AND art = 'chat_erwaehnung' AND lokaler_schluessel = CAST(NEW.id AS TEXT) AND stand = 0;
END;
DROP TRIGGER kommunikation_status_spiegellog_i;
CREATE TRIGGER kommunikation_status_spiegellog_i AFTER INSERT ON kommunikation_status WHEN EXISTS (SELECT 1 FROM einsatz WHERE id = NEW.einsatz_id) BEGIN
    INSERT OR REPLACE INTO spiegel_neu_vergeben (einsatz_id, art, lokaler_schluessel, stand) SELECT NEW.einsatz_id, 'kommunikation_status', CAST(NEW.id AS TEXT), 0 WHERE NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND EXISTS (SELECT 1 FROM einsatz_aenderung WHERE einsatz_id = NEW.einsatz_id AND art = 'kommunikation_status' AND schluessel = CAST(NEW.id AS TEXT));
    DELETE FROM spiegel_herkunft WHERE NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND art = 'kommunikation_status' AND lokaler_schluessel = CAST(NEW.id AS TEXT);
    DELETE FROM einsatz_aenderung WHERE einsatz_id = NEW.einsatz_id AND art = 'kommunikation_status' AND schluessel = CAST(NEW.id AS TEXT);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) VALUES (NEW.einsatz_id, 'kommunikation_status', CAST(NEW.id AS TEXT));
    UPDATE spiegel_neu_vergeben SET stand = (SELECT stand FROM einsatz_aenderung WHERE einsatz_id = NEW.einsatz_id AND art = 'kommunikation_status' AND schluessel = CAST(NEW.id AS TEXT)) WHERE einsatz_id = NEW.einsatz_id AND art = 'kommunikation_status' AND lokaler_schluessel = CAST(NEW.id AS TEXT) AND stand = 0;
END;
DROP TRIGGER kommunikation_zustellung_spiegellog_i;
CREATE TRIGGER kommunikation_zustellung_spiegellog_i AFTER INSERT ON kommunikation_zustellung WHEN EXISTS (SELECT 1 FROM einsatz WHERE id = NEW.einsatz_id) BEGIN
    INSERT OR REPLACE INTO spiegel_neu_vergeben (einsatz_id, art, lokaler_schluessel, stand) SELECT NEW.einsatz_id, 'kommunikation_zustellung', CAST(NEW.id AS TEXT), 0 WHERE NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND EXISTS (SELECT 1 FROM einsatz_aenderung WHERE einsatz_id = NEW.einsatz_id AND art = 'kommunikation_zustellung' AND schluessel = CAST(NEW.id AS TEXT));
    DELETE FROM spiegel_herkunft WHERE NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND art = 'kommunikation_zustellung' AND lokaler_schluessel = CAST(NEW.id AS TEXT);
    DELETE FROM einsatz_aenderung WHERE einsatz_id = NEW.einsatz_id AND art = 'kommunikation_zustellung' AND schluessel = CAST(NEW.id AS TEXT);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) VALUES (NEW.einsatz_id, 'kommunikation_zustellung', CAST(NEW.id AS TEXT));
    UPDATE spiegel_neu_vergeben SET stand = (SELECT stand FROM einsatz_aenderung WHERE einsatz_id = NEW.einsatz_id AND art = 'kommunikation_zustellung' AND schluessel = CAST(NEW.id AS TEXT)) WHERE einsatz_id = NEW.einsatz_id AND art = 'kommunikation_zustellung' AND lokaler_schluessel = CAST(NEW.id AS TEXT) AND stand = 0;
END;
DROP TRIGGER sprechgruppe_spiegellog_i;
CREATE TRIGGER sprechgruppe_spiegellog_i AFTER INSERT ON sprechgruppe WHEN EXISTS (SELECT 1 FROM einsatz WHERE id = NEW.einsatz_id) BEGIN
    INSERT OR REPLACE INTO spiegel_neu_vergeben (einsatz_id, art, lokaler_schluessel, stand) SELECT NEW.einsatz_id, 'sprechgruppe', CAST(NEW.id AS TEXT), 0 WHERE NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND EXISTS (SELECT 1 FROM einsatz_aenderung WHERE einsatz_id = NEW.einsatz_id AND art = 'sprechgruppe' AND schluessel = CAST(NEW.id AS TEXT));
    DELETE FROM spiegel_herkunft WHERE NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND art = 'sprechgruppe' AND lokaler_schluessel = CAST(NEW.id AS TEXT);
    DELETE FROM einsatz_aenderung WHERE einsatz_id = NEW.einsatz_id AND art = 'sprechgruppe' AND schluessel = CAST(NEW.id AS TEXT);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) VALUES (NEW.einsatz_id, 'sprechgruppe', CAST(NEW.id AS TEXT));
    UPDATE spiegel_neu_vergeben SET stand = (SELECT stand FROM einsatz_aenderung WHERE einsatz_id = NEW.einsatz_id AND art = 'sprechgruppe' AND schluessel = CAST(NEW.id AS TEXT)) WHERE einsatz_id = NEW.einsatz_id AND art = 'sprechgruppe' AND lokaler_schluessel = CAST(NEW.id AS TEXT) AND stand = 0;
END;
DROP TRIGGER einsatz_verbindung_spiegellog_i;
CREATE TRIGGER einsatz_verbindung_spiegellog_i AFTER INSERT ON einsatz_verbindung WHEN EXISTS (SELECT 1 FROM einsatz WHERE id = NEW.einsatz_id) BEGIN
    INSERT OR REPLACE INTO spiegel_neu_vergeben (einsatz_id, art, lokaler_schluessel, stand) SELECT NEW.einsatz_id, 'einsatz_verbindung', CAST(NEW.id AS TEXT), 0 WHERE NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND EXISTS (SELECT 1 FROM einsatz_aenderung WHERE einsatz_id = NEW.einsatz_id AND art = 'einsatz_verbindung' AND schluessel = CAST(NEW.id AS TEXT));
    DELETE FROM spiegel_herkunft WHERE NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND art = 'einsatz_verbindung' AND lokaler_schluessel = CAST(NEW.id AS TEXT);
    DELETE FROM einsatz_aenderung WHERE einsatz_id = NEW.einsatz_id AND art = 'einsatz_verbindung' AND schluessel = CAST(NEW.id AS TEXT);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) VALUES (NEW.einsatz_id, 'einsatz_verbindung', CAST(NEW.id AS TEXT));
    UPDATE spiegel_neu_vergeben SET stand = (SELECT stand FROM einsatz_aenderung WHERE einsatz_id = NEW.einsatz_id AND art = 'einsatz_verbindung' AND schluessel = CAST(NEW.id AS TEXT)) WHERE einsatz_id = NEW.einsatz_id AND art = 'einsatz_verbindung' AND lokaler_schluessel = CAST(NEW.id AS TEXT) AND stand = 0;
END;
DROP TRIGGER einsatz_kommunikation_stelle_spiegellog_i;
CREATE TRIGGER einsatz_kommunikation_stelle_spiegellog_i AFTER INSERT ON einsatz_kommunikation_stelle WHEN EXISTS (SELECT 1 FROM einsatz WHERE id = NEW.einsatz_id) BEGIN
    INSERT OR REPLACE INTO spiegel_neu_vergeben (einsatz_id, art, lokaler_schluessel, stand) SELECT NEW.einsatz_id, 'einsatz_kommunikation_stelle', CAST(NEW.id AS TEXT), 0 WHERE NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND EXISTS (SELECT 1 FROM einsatz_aenderung WHERE einsatz_id = NEW.einsatz_id AND art = 'einsatz_kommunikation_stelle' AND schluessel = CAST(NEW.id AS TEXT));
    DELETE FROM spiegel_herkunft WHERE NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND art = 'einsatz_kommunikation_stelle' AND lokaler_schluessel = CAST(NEW.id AS TEXT);
    DELETE FROM einsatz_aenderung WHERE einsatz_id = NEW.einsatz_id AND art = 'einsatz_kommunikation_stelle' AND schluessel = CAST(NEW.id AS TEXT);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) VALUES (NEW.einsatz_id, 'einsatz_kommunikation_stelle', CAST(NEW.id AS TEXT));
    UPDATE spiegel_neu_vergeben SET stand = (SELECT stand FROM einsatz_aenderung WHERE einsatz_id = NEW.einsatz_id AND art = 'einsatz_kommunikation_stelle' AND schluessel = CAST(NEW.id AS TEXT)) WHERE einsatz_id = NEW.einsatz_id AND art = 'einsatz_kommunikation_stelle' AND lokaler_schluessel = CAST(NEW.id AS TEXT) AND stand = 0;
END;
DROP TRIGGER einsatz_kommunikation_verbindung_spiegellog_i;
CREATE TRIGGER einsatz_kommunikation_verbindung_spiegellog_i AFTER INSERT ON einsatz_kommunikation_verbindung WHEN EXISTS (SELECT 1 FROM einsatz WHERE id = NEW.einsatz_id) BEGIN
    INSERT OR REPLACE INTO spiegel_neu_vergeben (einsatz_id, art, lokaler_schluessel, stand) SELECT NEW.einsatz_id, 'einsatz_kommunikation_verbindung', CAST(NEW.id AS TEXT), 0 WHERE NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND EXISTS (SELECT 1 FROM einsatz_aenderung WHERE einsatz_id = NEW.einsatz_id AND art = 'einsatz_kommunikation_verbindung' AND schluessel = CAST(NEW.id AS TEXT));
    DELETE FROM spiegel_herkunft WHERE NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND art = 'einsatz_kommunikation_verbindung' AND lokaler_schluessel = CAST(NEW.id AS TEXT);
    DELETE FROM einsatz_aenderung WHERE einsatz_id = NEW.einsatz_id AND art = 'einsatz_kommunikation_verbindung' AND schluessel = CAST(NEW.id AS TEXT);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) VALUES (NEW.einsatz_id, 'einsatz_kommunikation_verbindung', CAST(NEW.id AS TEXT));
    UPDATE spiegel_neu_vergeben SET stand = (SELECT stand FROM einsatz_aenderung WHERE einsatz_id = NEW.einsatz_id AND art = 'einsatz_kommunikation_verbindung' AND schluessel = CAST(NEW.id AS TEXT)) WHERE einsatz_id = NEW.einsatz_id AND art = 'einsatz_kommunikation_verbindung' AND lokaler_schluessel = CAST(NEW.id AS TEXT) AND stand = 0;
END;
DROP TRIGGER fernmeldeskizze_komponente_spiegellog_i;
CREATE TRIGGER fernmeldeskizze_komponente_spiegellog_i AFTER INSERT ON fernmeldeskizze_komponente WHEN EXISTS (SELECT 1 FROM einsatz WHERE id = NEW.einsatz_id) BEGIN
    INSERT OR REPLACE INTO spiegel_neu_vergeben (einsatz_id, art, lokaler_schluessel, stand) SELECT NEW.einsatz_id, 'fernmeldeskizze_komponente', CAST(NEW.id AS TEXT), 0 WHERE NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND EXISTS (SELECT 1 FROM einsatz_aenderung WHERE einsatz_id = NEW.einsatz_id AND art = 'fernmeldeskizze_komponente' AND schluessel = CAST(NEW.id AS TEXT));
    DELETE FROM spiegel_herkunft WHERE NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND art = 'fernmeldeskizze_komponente' AND lokaler_schluessel = CAST(NEW.id AS TEXT);
    DELETE FROM einsatz_aenderung WHERE einsatz_id = NEW.einsatz_id AND art = 'fernmeldeskizze_komponente' AND schluessel = CAST(NEW.id AS TEXT);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) VALUES (NEW.einsatz_id, 'fernmeldeskizze_komponente', CAST(NEW.id AS TEXT));
    UPDATE spiegel_neu_vergeben SET stand = (SELECT stand FROM einsatz_aenderung WHERE einsatz_id = NEW.einsatz_id AND art = 'fernmeldeskizze_komponente' AND schluessel = CAST(NEW.id AS TEXT)) WHERE einsatz_id = NEW.einsatz_id AND art = 'fernmeldeskizze_komponente' AND lokaler_schluessel = CAST(NEW.id AS TEXT) AND stand = 0;
END;
DROP TRIGGER fernmeldeskizze_verbindung_spiegellog_i;
CREATE TRIGGER fernmeldeskizze_verbindung_spiegellog_i AFTER INSERT ON fernmeldeskizze_verbindung WHEN EXISTS (SELECT 1 FROM einsatz WHERE id = NEW.einsatz_id) BEGIN
    INSERT OR REPLACE INTO spiegel_neu_vergeben (einsatz_id, art, lokaler_schluessel, stand) SELECT NEW.einsatz_id, 'fernmeldeskizze_verbindung', CAST(NEW.id AS TEXT), 0 WHERE NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND EXISTS (SELECT 1 FROM einsatz_aenderung WHERE einsatz_id = NEW.einsatz_id AND art = 'fernmeldeskizze_verbindung' AND schluessel = CAST(NEW.id AS TEXT));
    DELETE FROM spiegel_herkunft WHERE NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND art = 'fernmeldeskizze_verbindung' AND lokaler_schluessel = CAST(NEW.id AS TEXT);
    DELETE FROM einsatz_aenderung WHERE einsatz_id = NEW.einsatz_id AND art = 'fernmeldeskizze_verbindung' AND schluessel = CAST(NEW.id AS TEXT);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) VALUES (NEW.einsatz_id, 'fernmeldeskizze_verbindung', CAST(NEW.id AS TEXT));
    UPDATE spiegel_neu_vergeben SET stand = (SELECT stand FROM einsatz_aenderung WHERE einsatz_id = NEW.einsatz_id AND art = 'fernmeldeskizze_verbindung' AND schluessel = CAST(NEW.id AS TEXT)) WHERE einsatz_id = NEW.einsatz_id AND art = 'fernmeldeskizze_verbindung' AND lokaler_schluessel = CAST(NEW.id AS TEXT) AND stand = 0;
END;
DROP TRIGGER fernmeldeskizze_bereich_spiegellog_i;
CREATE TRIGGER fernmeldeskizze_bereich_spiegellog_i AFTER INSERT ON fernmeldeskizze_bereich WHEN EXISTS (SELECT 1 FROM einsatz WHERE id = NEW.einsatz_id) BEGIN
    INSERT OR REPLACE INTO spiegel_neu_vergeben (einsatz_id, art, lokaler_schluessel, stand) SELECT NEW.einsatz_id, 'fernmeldeskizze_bereich', CAST(NEW.id AS TEXT), 0 WHERE NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND EXISTS (SELECT 1 FROM einsatz_aenderung WHERE einsatz_id = NEW.einsatz_id AND art = 'fernmeldeskizze_bereich' AND schluessel = CAST(NEW.id AS TEXT));
    DELETE FROM spiegel_herkunft WHERE NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND art = 'fernmeldeskizze_bereich' AND lokaler_schluessel = CAST(NEW.id AS TEXT);
    DELETE FROM einsatz_aenderung WHERE einsatz_id = NEW.einsatz_id AND art = 'fernmeldeskizze_bereich' AND schluessel = CAST(NEW.id AS TEXT);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) VALUES (NEW.einsatz_id, 'fernmeldeskizze_bereich', CAST(NEW.id AS TEXT));
    UPDATE spiegel_neu_vergeben SET stand = (SELECT stand FROM einsatz_aenderung WHERE einsatz_id = NEW.einsatz_id AND art = 'fernmeldeskizze_bereich' AND schluessel = CAST(NEW.id AS TEXT)) WHERE einsatz_id = NEW.einsatz_id AND art = 'fernmeldeskizze_bereich' AND lokaler_schluessel = CAST(NEW.id AS TEXT) AND stand = 0;
END;
DROP TRIGGER anhang_spiegellog_i;
CREATE TRIGGER anhang_spiegellog_i AFTER INSERT ON anhang WHEN EXISTS (SELECT 1 FROM einsatz WHERE id = NEW.einsatz_id) BEGIN
    INSERT OR REPLACE INTO spiegel_neu_vergeben (einsatz_id, art, lokaler_schluessel, stand) SELECT NEW.einsatz_id, 'anhang', CAST(NEW.id AS TEXT), 0 WHERE NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND EXISTS (SELECT 1 FROM einsatz_aenderung WHERE einsatz_id = NEW.einsatz_id AND art = 'anhang' AND schluessel = CAST(NEW.id AS TEXT));
    DELETE FROM spiegel_herkunft WHERE NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND art = 'anhang' AND lokaler_schluessel = CAST(NEW.id AS TEXT);
    DELETE FROM einsatz_aenderung WHERE einsatz_id = NEW.einsatz_id AND art = 'anhang' AND schluessel = CAST(NEW.id AS TEXT);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) VALUES (NEW.einsatz_id, 'anhang', CAST(NEW.id AS TEXT));
    UPDATE spiegel_neu_vergeben SET stand = (SELECT stand FROM einsatz_aenderung WHERE einsatz_id = NEW.einsatz_id AND art = 'anhang' AND schluessel = CAST(NEW.id AS TEXT)) WHERE einsatz_id = NEW.einsatz_id AND art = 'anhang' AND lokaler_schluessel = CAST(NEW.id AS TEXT) AND stand = 0;
END;
DROP TRIGGER einsatz_dokument_spiegellog_i;
CREATE TRIGGER einsatz_dokument_spiegellog_i AFTER INSERT ON einsatz_dokument WHEN EXISTS (SELECT 1 FROM einsatz WHERE id = NEW.einsatz_id) BEGIN
    INSERT OR REPLACE INTO spiegel_neu_vergeben (einsatz_id, art, lokaler_schluessel, stand) SELECT NEW.einsatz_id, 'einsatz_dokument', CAST(NEW.id AS TEXT), 0 WHERE NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND EXISTS (SELECT 1 FROM einsatz_aenderung WHERE einsatz_id = NEW.einsatz_id AND art = 'einsatz_dokument' AND schluessel = CAST(NEW.id AS TEXT));
    DELETE FROM spiegel_herkunft WHERE NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND art = 'einsatz_dokument' AND lokaler_schluessel = CAST(NEW.id AS TEXT);
    DELETE FROM einsatz_aenderung WHERE einsatz_id = NEW.einsatz_id AND art = 'einsatz_dokument' AND schluessel = CAST(NEW.id AS TEXT);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) VALUES (NEW.einsatz_id, 'einsatz_dokument', CAST(NEW.id AS TEXT));
    UPDATE spiegel_neu_vergeben SET stand = (SELECT stand FROM einsatz_aenderung WHERE einsatz_id = NEW.einsatz_id AND art = 'einsatz_dokument' AND schluessel = CAST(NEW.id AS TEXT)) WHERE einsatz_id = NEW.einsatz_id AND art = 'einsatz_dokument' AND lokaler_schluessel = CAST(NEW.id AS TEXT) AND stand = 0;
END;
DROP TRIGGER einsatz_schaden_anhang_spiegellog_i;
CREATE TRIGGER einsatz_schaden_anhang_spiegellog_i AFTER INSERT ON einsatz_schaden_anhang WHEN EXISTS (SELECT 1 FROM einsatz WHERE id = NEW.einsatz_id) BEGIN
    INSERT OR REPLACE INTO spiegel_neu_vergeben (einsatz_id, art, lokaler_schluessel, stand) SELECT NEW.einsatz_id, 'einsatz_schaden_anhang', CAST(NEW.id AS TEXT), 0 WHERE NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND EXISTS (SELECT 1 FROM einsatz_aenderung WHERE einsatz_id = NEW.einsatz_id AND art = 'einsatz_schaden_anhang' AND schluessel = CAST(NEW.id AS TEXT));
    DELETE FROM spiegel_herkunft WHERE NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND art = 'einsatz_schaden_anhang' AND lokaler_schluessel = CAST(NEW.id AS TEXT);
    DELETE FROM einsatz_aenderung WHERE einsatz_id = NEW.einsatz_id AND art = 'einsatz_schaden_anhang' AND schluessel = CAST(NEW.id AS TEXT);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) VALUES (NEW.einsatz_id, 'einsatz_schaden_anhang', CAST(NEW.id AS TEXT));
    UPDATE spiegel_neu_vergeben SET stand = (SELECT stand FROM einsatz_aenderung WHERE einsatz_id = NEW.einsatz_id AND art = 'einsatz_schaden_anhang' AND schluessel = CAST(NEW.id AS TEXT)) WHERE einsatz_id = NEW.einsatz_id AND art = 'einsatz_schaden_anhang' AND lokaler_schluessel = CAST(NEW.id AS TEXT) AND stand = 0;
END;
DROP TRIGGER einsatz_tier_anhang_spiegellog_i;
CREATE TRIGGER einsatz_tier_anhang_spiegellog_i AFTER INSERT ON einsatz_tier_anhang WHEN EXISTS (SELECT 1 FROM einsatz WHERE id = NEW.einsatz_id) BEGIN
    INSERT OR REPLACE INTO spiegel_neu_vergeben (einsatz_id, art, lokaler_schluessel, stand) SELECT NEW.einsatz_id, 'einsatz_tier_anhang', CAST(NEW.id AS TEXT), 0 WHERE NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND EXISTS (SELECT 1 FROM einsatz_aenderung WHERE einsatz_id = NEW.einsatz_id AND art = 'einsatz_tier_anhang' AND schluessel = CAST(NEW.id AS TEXT));
    DELETE FROM spiegel_herkunft WHERE NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND art = 'einsatz_tier_anhang' AND lokaler_schluessel = CAST(NEW.id AS TEXT);
    DELETE FROM einsatz_aenderung WHERE einsatz_id = NEW.einsatz_id AND art = 'einsatz_tier_anhang' AND schluessel = CAST(NEW.id AS TEXT);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) VALUES (NEW.einsatz_id, 'einsatz_tier_anhang', CAST(NEW.id AS TEXT));
    UPDATE spiegel_neu_vergeben SET stand = (SELECT stand FROM einsatz_aenderung WHERE einsatz_id = NEW.einsatz_id AND art = 'einsatz_tier_anhang' AND schluessel = CAST(NEW.id AS TEXT)) WHERE einsatz_id = NEW.einsatz_id AND art = 'einsatz_tier_anhang' AND lokaler_schluessel = CAST(NEW.id AS TEXT) AND stand = 0;
END;
DROP TRIGGER uhs_anhang_spiegellog_i;
CREATE TRIGGER uhs_anhang_spiegellog_i AFTER INSERT ON uhs_anhang WHEN EXISTS (SELECT 1 FROM einsatz WHERE id = NEW.einsatz_id) BEGIN
    INSERT OR REPLACE INTO spiegel_neu_vergeben (einsatz_id, art, lokaler_schluessel, stand) SELECT NEW.einsatz_id, 'uhs_anhang', CAST(NEW.id AS TEXT), 0 WHERE NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND EXISTS (SELECT 1 FROM einsatz_aenderung WHERE einsatz_id = NEW.einsatz_id AND art = 'uhs_anhang' AND schluessel = CAST(NEW.id AS TEXT));
    DELETE FROM spiegel_herkunft WHERE NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND art = 'uhs_anhang' AND lokaler_schluessel = CAST(NEW.id AS TEXT);
    DELETE FROM einsatz_aenderung WHERE einsatz_id = NEW.einsatz_id AND art = 'uhs_anhang' AND schluessel = CAST(NEW.id AS TEXT);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) VALUES (NEW.einsatz_id, 'uhs_anhang', CAST(NEW.id AS TEXT));
    UPDATE spiegel_neu_vergeben SET stand = (SELECT stand FROM einsatz_aenderung WHERE einsatz_id = NEW.einsatz_id AND art = 'uhs_anhang' AND schluessel = CAST(NEW.id AS TEXT)) WHERE einsatz_id = NEW.einsatz_id AND art = 'uhs_anhang' AND lokaler_schluessel = CAST(NEW.id AS TEXT) AND stand = 0;
END;
DROP TRIGGER einsatz_person_anhang_spiegellog_i;
CREATE TRIGGER einsatz_person_anhang_spiegellog_i AFTER INSERT ON einsatz_person_anhang WHEN EXISTS (SELECT 1 FROM einsatz WHERE id = NEW.einsatz_id) BEGIN
    INSERT OR REPLACE INTO spiegel_neu_vergeben (einsatz_id, art, lokaler_schluessel, stand) SELECT NEW.einsatz_id, 'einsatz_person_anhang', CAST(NEW.id AS TEXT), 0 WHERE NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND EXISTS (SELECT 1 FROM einsatz_aenderung WHERE einsatz_id = NEW.einsatz_id AND art = 'einsatz_person_anhang' AND schluessel = CAST(NEW.id AS TEXT));
    DELETE FROM spiegel_herkunft WHERE NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND art = 'einsatz_person_anhang' AND lokaler_schluessel = CAST(NEW.id AS TEXT);
    DELETE FROM einsatz_aenderung WHERE einsatz_id = NEW.einsatz_id AND art = 'einsatz_person_anhang' AND schluessel = CAST(NEW.id AS TEXT);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) VALUES (NEW.einsatz_id, 'einsatz_person_anhang', CAST(NEW.id AS TEXT));
    UPDATE spiegel_neu_vergeben SET stand = (SELECT stand FROM einsatz_aenderung WHERE einsatz_id = NEW.einsatz_id AND art = 'einsatz_person_anhang' AND schluessel = CAST(NEW.id AS TEXT)) WHERE einsatz_id = NEW.einsatz_id AND art = 'einsatz_person_anhang' AND lokaler_schluessel = CAST(NEW.id AS TEXT) AND stand = 0;
END;
DROP TRIGGER lagebericht_anlage_spiegellog_i;
CREATE TRIGGER lagebericht_anlage_spiegellog_i AFTER INSERT ON lagebericht_anlage WHEN EXISTS (SELECT 1 FROM einsatz WHERE id = NEW.einsatz_id) BEGIN
    INSERT OR REPLACE INTO spiegel_neu_vergeben (einsatz_id, art, lokaler_schluessel, stand) SELECT NEW.einsatz_id, 'lagebericht_anlage', CAST(NEW.id AS TEXT), 0 WHERE NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND EXISTS (SELECT 1 FROM einsatz_aenderung WHERE einsatz_id = NEW.einsatz_id AND art = 'lagebericht_anlage' AND schluessel = CAST(NEW.id AS TEXT));
    DELETE FROM spiegel_herkunft WHERE NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND art = 'lagebericht_anlage' AND lokaler_schluessel = CAST(NEW.id AS TEXT);
    DELETE FROM einsatz_aenderung WHERE einsatz_id = NEW.einsatz_id AND art = 'lagebericht_anlage' AND schluessel = CAST(NEW.id AS TEXT);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) VALUES (NEW.einsatz_id, 'lagebericht_anlage', CAST(NEW.id AS TEXT));
    UPDATE spiegel_neu_vergeben SET stand = (SELECT stand FROM einsatz_aenderung WHERE einsatz_id = NEW.einsatz_id AND art = 'lagebericht_anlage' AND schluessel = CAST(NEW.id AS TEXT)) WHERE einsatz_id = NEW.einsatz_id AND art = 'lagebericht_anlage' AND lokaler_schluessel = CAST(NEW.id AS TEXT) AND stand = 0;
END;
DROP TRIGGER befehl_anlage_spiegellog_i;
CREATE TRIGGER befehl_anlage_spiegellog_i AFTER INSERT ON befehl_anlage WHEN EXISTS (SELECT 1 FROM einsatz WHERE id = NEW.einsatz_id) BEGIN
    INSERT OR REPLACE INTO spiegel_neu_vergeben (einsatz_id, art, lokaler_schluessel, stand) SELECT NEW.einsatz_id, 'befehl_anlage', CAST(NEW.id AS TEXT), 0 WHERE NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND EXISTS (SELECT 1 FROM einsatz_aenderung WHERE einsatz_id = NEW.einsatz_id AND art = 'befehl_anlage' AND schluessel = CAST(NEW.id AS TEXT));
    DELETE FROM spiegel_herkunft WHERE NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND art = 'befehl_anlage' AND lokaler_schluessel = CAST(NEW.id AS TEXT);
    DELETE FROM einsatz_aenderung WHERE einsatz_id = NEW.einsatz_id AND art = 'befehl_anlage' AND schluessel = CAST(NEW.id AS TEXT);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) VALUES (NEW.einsatz_id, 'befehl_anlage', CAST(NEW.id AS TEXT));
    UPDATE spiegel_neu_vergeben SET stand = (SELECT stand FROM einsatz_aenderung WHERE einsatz_id = NEW.einsatz_id AND art = 'befehl_anlage' AND schluessel = CAST(NEW.id AS TEXT)) WHERE einsatz_id = NEW.einsatz_id AND art = 'befehl_anlage' AND lokaler_schluessel = CAST(NEW.id AS TEXT) AND stand = 0;
END;
