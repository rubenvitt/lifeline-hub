-- LFH-981: Benutzernamen sind ohne Groß-/Kleinschreibung eindeutig.
--
-- Login und Passkey-Start suchen mit `benutzername = ? COLLATE NOCASE`, damit die automatische
-- Großschreibung einer Bildschirmtastatur (`Admin` statt `admin`) nicht in 401 endet. Dann darf
-- es `Admin` neben `admin` nicht geben: dieser Index setzt das durch und trägt zugleich die Suche.
-- Die bestehende UNIQUE-Einschränkung (BINARY) aus 0002 bleibt.
--
-- `NOCASE` faltet nur A–Z; `Ä` und `ä` bleiben zwei Namen. Die Vorprüfung gruppiert mit derselben
-- Kollation wie der Index (nicht `lower()`, das mit ICU auch Umlaute faltete).
--
-- Vorprüfung: Hat eine Installation schon zwei solche Namen, bricht die Migration mit einer
-- lesbaren Meldung ab, statt still umzubenennen. Ohne sie käme nur „UNIQUE constraint failed:
-- index …“. Umbenennen geht nur per SQL (`UPDATE benutzer SET benutzername = … WHERE id = …`).
--
-- Herleitung: openspec/changes/archive/2026-10-05-lfh-921-981-anmeldung-benutzername/design.md
-- (Entscheidungen 1 und 7).

CREATE TEMP TABLE benutzername_kollision_pruefung (anzahl INTEGER NOT NULL);

CREATE TEMP TRIGGER benutzername_kollision_abbrechen
BEFORE INSERT ON benutzername_kollision_pruefung
WHEN NEW.anzahl > 0
BEGIN
    SELECT RAISE(ABORT, 'Benutzernamen kollidieren ohne Groß-/Kleinschreibung (z. B. max und Max). Vor dem Update eines der Konten per SQL umbenennen: SELECT benutzername COLLATE NOCASE, count(*) FROM benutzer GROUP BY 1 HAVING count(*) > 1');
END;

INSERT INTO benutzername_kollision_pruefung (anzahl)
SELECT count(*) FROM (
    SELECT 1 FROM benutzer GROUP BY benutzername COLLATE NOCASE HAVING count(*) > 1
);

DROP TRIGGER benutzername_kollision_abbrechen;
DROP TABLE benutzername_kollision_pruefung;

CREATE UNIQUE INDEX idx_benutzer_benutzername_nocase ON benutzer (benutzername COLLATE NOCASE);
