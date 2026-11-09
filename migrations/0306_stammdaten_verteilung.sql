-- LLH-1493: Stammdaten vom Hub an gekoppelte ELW (Change ca8v0psv-stammdaten-verteilung,
-- design.md D1, D3, D4, D6). Rein additiv.
--
-- Änderungslog (D1): je (Org, Art, Schlüssel) höchstens eine Zeile mit dem Stand der letzten
-- Änderung. `stand` ist global und steigt nur (AUTOINCREMENT vergibt keinen Wert zweimal); eine
-- Nachlieferung filtert nach Org. Gefüllt nur von den Triggern unten, kein Schreibweg in Rust.
-- `schluessel` ist die id als Text, bei Führungs- und Modul-Einstellungen der Schlüssel, bei den
-- Org-Einstellungen leer. Ob eine Zeile gelöscht ist, sagt erst der Blick in ihre Tabelle.
CREATE TABLE stammdaten_aenderung (
    stand      INTEGER PRIMARY KEY AUTOINCREMENT,
    org_id     INTEGER NOT NULL,
    art        TEXT NOT NULL,
    schluessel TEXT NOT NULL,
    UNIQUE (org_id, art, schluessel)
);
CREATE INDEX idx_stammdaten_aenderung_org ON stammdaten_aenderung (org_id, stand);

-- Herkunft an der meldenden Seite (D3): welche lokale Zeile aus welcher Org-Zuordnung kommt und
-- wie sie dort heißt. „vom Hub“ = es gibt eine Zeile; die Zeile entfällt mit dem Widerruf der
-- Zuordnung (dann gehört die Zeile der Instanz). `geheimnis_merkmal` nur bei Konten (D6):
-- SHA-256 über das zuletzt übernommene Geheimnis.
CREATE TABLE stammdaten_herkunft (
    id                 INTEGER PRIMARY KEY,
    kopplung_org_id    INTEGER NOT NULL REFERENCES instanz_kopplung_org(id) ON DELETE CASCADE,
    org_id             INTEGER NOT NULL REFERENCES organisation(id) ON DELETE CASCADE,
    art                TEXT NOT NULL,
    fremder_schluessel TEXT NOT NULL,
    lokaler_schluessel TEXT NOT NULL,
    geheimnis_merkmal  TEXT,
    UNIQUE (kopplung_org_id, art, fremder_schluessel),
    UNIQUE (org_id, art, lokaler_schluessel)
);

-- Merker der Übernahme (D4): eine Zeile, solange eine Nachlieferung in ihrer Transaktion
-- schreibt. SQLite hat nur einen Schreiber, kein anderer Schreibweg sieht sie.
CREATE TABLE stammdaten_uebernahme (
    id INTEGER PRIMARY KEY CHECK (id = 1)
);

-- Stand der übernommenen Stammdaten je Org-Zuordnung an der meldenden Seite und ein Hinweis
-- (Namenskonflikt bei Konten, zweite Quelle, unauflösbarer Verweis).
ALTER TABLE instanz_kopplung_org ADD COLUMN stammdaten_stand INTEGER NOT NULL DEFAULT 0;
ALTER TABLE instanz_kopplung_org ADD COLUMN stammdaten_hinweis TEXT;
-- Die Arten, die diese Instanz beim letzten Melden kannte (kommagetrennt). Kennt sie nach einem
-- Update mehr, beginnt die Nachlieferung wieder bei 0 (D2).
ALTER TABLE instanz_kopplung_org ADD COLUMN stammdaten_arten TEXT;

-- Geheimnisse (D6): age-Schlüssel dieser Instanz (X25519, Bech32 `AGE-SECRET-KEY-…`), an der
-- erreichten Seite der Empfänger des Gegenübers und seine Bestätigung der
-- Datenträgerverschlüsselung, beide aus seiner letzten signierten Meldung.
ALTER TABLE instanz_identitaet ADD COLUMN age_privat TEXT;
-- Ob der Betreiber dieser Instanz die Datenträgerverschlüsselung bestätigt hat
-- (`--datentraeger-verschluesselung-extern`); der Start schreibt den Wert aus der Konfiguration.
ALTER TABLE instanz_identitaet ADD COLUMN datentraeger_bestaetigt INTEGER NOT NULL DEFAULT 0;
ALTER TABLE instanz_kopplung ADD COLUMN gegenueber_age_empfaenger TEXT;
ALTER TABLE instanz_kopplung ADD COLUMN gegenueber_datentraeger_verschluesselt INTEGER NOT NULL DEFAULT 0;

-- Wessen Geheimnisse an welche Org-Zuordnung gingen (D6, für „ELW verloren“, D8).
CREATE TABLE instanz_geheimnis_lieferung (
    kopplung_org_id INTEGER NOT NULL REFERENCES instanz_kopplung_org(id) ON DELETE CASCADE,
    benutzer_id     INTEGER NOT NULL REFERENCES benutzer(id) ON DELETE CASCADE,
    geliefert_at    TEXT NOT NULL,
    PRIMARY KEY (kopplung_org_id, benutzer_id)
);

-- Grundstock des Logs: alles, was schon besteht, gilt als einmal geändert.
INSERT INTO stammdaten_aenderung (org_id, art, schluessel)
    SELECT org_id, 'konto', CAST(id AS TEXT) FROM benutzer
    UNION ALL SELECT org_id, 'org_einstellungen', '' FROM org_einstellungen
    UNION ALL SELECT org_id, 'modul_einstellung', modul_key FROM org_modul_einstellung
    UNION ALL SELECT org_id, 'fuehrungsfunktion', funktion FROM org_fuehrungsfunktion
    UNION ALL SELECT org_id, 'fahrzeug_status', CAST(id AS TEXT) FROM fahrzeug_status
    UNION ALL SELECT org_id, 'personal_status', CAST(id AS TEXT) FROM personal_status
    UNION ALL SELECT org_id, 'einheit_typ', CAST(id AS TEXT) FROM einheit_typ
    UNION ALL SELECT org_id, 'qualifikation', CAST(id AS TEXT) FROM qualifikation
    UNION ALL SELECT org_id, 'fahrzeug', CAST(id AS TEXT) FROM fahrzeug
    UNION ALL SELECT org_id, 'material', CAST(id AS TEXT) FROM material
    UNION ALL SELECT org_id, 'personal', CAST(id AS TEXT) FROM personal
    UNION ALL SELECT org_id, 'einheit_vorlage', CAST(id AS TEXT) FROM einheit_vorlage;

-- Ein neuer oder entfernter Anmelde-Passkey ändert, ob die Geheimnisse eines System-Admins
-- hinausgehen dürfen (D6/D7): das Konto gilt als geändert.
CREATE TRIGGER webauthn_credential_log_i AFTER INSERT ON webauthn_credential
BEGIN
    DELETE FROM stammdaten_aenderung WHERE art = 'konto' AND schluessel = CAST(NEW.benutzer_id AS TEXT)
        AND org_id = (SELECT org_id FROM benutzer WHERE id = NEW.benutzer_id);
    INSERT INTO stammdaten_aenderung (org_id, art, schluessel)
        SELECT org_id, 'konto', CAST(id AS TEXT) FROM benutzer WHERE id = NEW.benutzer_id;
END;
CREATE TRIGGER webauthn_credential_log_d AFTER DELETE ON webauthn_credential
BEGIN
    DELETE FROM stammdaten_aenderung WHERE art = 'konto' AND schluessel = CAST(OLD.benutzer_id AS TEXT)
        AND org_id = (SELECT org_id FROM benutzer WHERE id = OLD.benutzer_id);
    INSERT INTO stammdaten_aenderung (org_id, art, schluessel)
        SELECT org_id, 'konto', CAST(id AS TEXT) FROM benutzer WHERE id = OLD.benutzer_id;
END;

-- Trigger (D1 Log, D4 Schutz). Wer eine dieser Tabellen neu baut, legt sie wieder an; der
-- Guard `instanz::stammdaten::art::tests` prüft das über sqlite_master.
-- fahrzeug (fahrzeug)
CREATE TRIGGER fahrzeug_log_i AFTER INSERT ON fahrzeug
BEGIN
    DELETE FROM stammdaten_aenderung WHERE org_id = NEW.org_id AND art = 'fahrzeug' AND schluessel = CAST(NEW.id AS TEXT);
    INSERT INTO stammdaten_aenderung (org_id, art, schluessel) VALUES (NEW.org_id, 'fahrzeug', CAST(NEW.id AS TEXT));
END;
CREATE TRIGGER fahrzeug_log_u AFTER UPDATE ON fahrzeug
BEGIN
    DELETE FROM stammdaten_aenderung WHERE org_id = OLD.org_id AND art = 'fahrzeug' AND schluessel = CAST(OLD.id AS TEXT);
    INSERT INTO stammdaten_aenderung (org_id, art, schluessel) VALUES (OLD.org_id, 'fahrzeug', CAST(OLD.id AS TEXT));
    DELETE FROM stammdaten_aenderung WHERE org_id = NEW.org_id AND art = 'fahrzeug' AND schluessel = CAST(NEW.id AS TEXT);
    INSERT INTO stammdaten_aenderung (org_id, art, schluessel) VALUES (NEW.org_id, 'fahrzeug', CAST(NEW.id AS TEXT));
END;
CREATE TRIGGER fahrzeug_log_d AFTER DELETE ON fahrzeug
BEGIN
    DELETE FROM stammdaten_aenderung WHERE org_id = OLD.org_id AND art = 'fahrzeug' AND schluessel = CAST(OLD.id AS TEXT);
    INSERT INTO stammdaten_aenderung (org_id, art, schluessel) VALUES (OLD.org_id, 'fahrzeug', CAST(OLD.id AS TEXT));
END;
CREATE TRIGGER fahrzeug_schutz_u BEFORE UPDATE ON fahrzeug
WHEN EXISTS (SELECT 1 FROM stammdaten_herkunft h WHERE h.art = 'fahrzeug' AND h.org_id = OLD.org_id AND h.lokaler_schluessel = CAST(OLD.id AS TEXT))
    AND NOT EXISTS (SELECT 1 FROM stammdaten_uebernahme)
BEGIN
    SELECT RAISE(ABORT, 'stammdaten_vom_hub');
END;

CREATE TRIGGER fahrzeug_schutz_d BEFORE DELETE ON fahrzeug
WHEN EXISTS (SELECT 1 FROM stammdaten_herkunft h WHERE h.art = 'fahrzeug' AND h.org_id = OLD.org_id AND h.lokaler_schluessel = CAST(OLD.id AS TEXT))
    AND NOT EXISTS (SELECT 1 FROM stammdaten_uebernahme)
BEGIN
    SELECT RAISE(ABORT, 'stammdaten_vom_hub');
END;

-- personal (personal)
CREATE TRIGGER personal_log_i AFTER INSERT ON personal
BEGIN
    DELETE FROM stammdaten_aenderung WHERE org_id = NEW.org_id AND art = 'personal' AND schluessel = CAST(NEW.id AS TEXT);
    INSERT INTO stammdaten_aenderung (org_id, art, schluessel) VALUES (NEW.org_id, 'personal', CAST(NEW.id AS TEXT));
END;
CREATE TRIGGER personal_log_u AFTER UPDATE ON personal
BEGIN
    DELETE FROM stammdaten_aenderung WHERE org_id = OLD.org_id AND art = 'personal' AND schluessel = CAST(OLD.id AS TEXT);
    INSERT INTO stammdaten_aenderung (org_id, art, schluessel) VALUES (OLD.org_id, 'personal', CAST(OLD.id AS TEXT));
    DELETE FROM stammdaten_aenderung WHERE org_id = NEW.org_id AND art = 'personal' AND schluessel = CAST(NEW.id AS TEXT);
    INSERT INTO stammdaten_aenderung (org_id, art, schluessel) VALUES (NEW.org_id, 'personal', CAST(NEW.id AS TEXT));
END;
CREATE TRIGGER personal_log_d AFTER DELETE ON personal
BEGIN
    DELETE FROM stammdaten_aenderung WHERE org_id = OLD.org_id AND art = 'personal' AND schluessel = CAST(OLD.id AS TEXT);
    INSERT INTO stammdaten_aenderung (org_id, art, schluessel) VALUES (OLD.org_id, 'personal', CAST(OLD.id AS TEXT));
END;
CREATE TRIGGER personal_schutz_u BEFORE UPDATE ON personal
WHEN EXISTS (SELECT 1 FROM stammdaten_herkunft h WHERE h.art = 'personal' AND h.org_id = OLD.org_id AND h.lokaler_schluessel = CAST(OLD.id AS TEXT))
    AND NOT EXISTS (SELECT 1 FROM stammdaten_uebernahme)
BEGIN
    SELECT RAISE(ABORT, 'stammdaten_vom_hub');
END;

CREATE TRIGGER personal_schutz_d BEFORE DELETE ON personal
WHEN EXISTS (SELECT 1 FROM stammdaten_herkunft h WHERE h.art = 'personal' AND h.org_id = OLD.org_id AND h.lokaler_schluessel = CAST(OLD.id AS TEXT))
    AND NOT EXISTS (SELECT 1 FROM stammdaten_uebernahme)
BEGIN
    SELECT RAISE(ABORT, 'stammdaten_vom_hub');
END;

-- qualifikation (qualifikation)
CREATE TRIGGER qualifikation_log_i AFTER INSERT ON qualifikation
BEGIN
    DELETE FROM stammdaten_aenderung WHERE org_id = NEW.org_id AND art = 'qualifikation' AND schluessel = CAST(NEW.id AS TEXT);
    INSERT INTO stammdaten_aenderung (org_id, art, schluessel) VALUES (NEW.org_id, 'qualifikation', CAST(NEW.id AS TEXT));
END;
CREATE TRIGGER qualifikation_log_u AFTER UPDATE ON qualifikation
BEGIN
    DELETE FROM stammdaten_aenderung WHERE org_id = OLD.org_id AND art = 'qualifikation' AND schluessel = CAST(OLD.id AS TEXT);
    INSERT INTO stammdaten_aenderung (org_id, art, schluessel) VALUES (OLD.org_id, 'qualifikation', CAST(OLD.id AS TEXT));
    DELETE FROM stammdaten_aenderung WHERE org_id = NEW.org_id AND art = 'qualifikation' AND schluessel = CAST(NEW.id AS TEXT);
    INSERT INTO stammdaten_aenderung (org_id, art, schluessel) VALUES (NEW.org_id, 'qualifikation', CAST(NEW.id AS TEXT));
END;
CREATE TRIGGER qualifikation_log_d AFTER DELETE ON qualifikation
BEGIN
    DELETE FROM stammdaten_aenderung WHERE org_id = OLD.org_id AND art = 'qualifikation' AND schluessel = CAST(OLD.id AS TEXT);
    INSERT INTO stammdaten_aenderung (org_id, art, schluessel) VALUES (OLD.org_id, 'qualifikation', CAST(OLD.id AS TEXT));
END;
CREATE TRIGGER qualifikation_schutz_u BEFORE UPDATE ON qualifikation
WHEN EXISTS (SELECT 1 FROM stammdaten_herkunft h WHERE h.art = 'qualifikation' AND h.org_id = OLD.org_id AND h.lokaler_schluessel = CAST(OLD.id AS TEXT))
    AND NOT EXISTS (SELECT 1 FROM stammdaten_uebernahme)
BEGIN
    SELECT RAISE(ABORT, 'stammdaten_vom_hub');
END;

CREATE TRIGGER qualifikation_schutz_d BEFORE DELETE ON qualifikation
WHEN EXISTS (SELECT 1 FROM stammdaten_herkunft h WHERE h.art = 'qualifikation' AND h.org_id = OLD.org_id AND h.lokaler_schluessel = CAST(OLD.id AS TEXT))
    AND NOT EXISTS (SELECT 1 FROM stammdaten_uebernahme)
BEGIN
    SELECT RAISE(ABORT, 'stammdaten_vom_hub');
END;

-- material (material)
CREATE TRIGGER material_log_i AFTER INSERT ON material
BEGIN
    DELETE FROM stammdaten_aenderung WHERE org_id = NEW.org_id AND art = 'material' AND schluessel = CAST(NEW.id AS TEXT);
    INSERT INTO stammdaten_aenderung (org_id, art, schluessel) VALUES (NEW.org_id, 'material', CAST(NEW.id AS TEXT));
END;
CREATE TRIGGER material_log_u AFTER UPDATE ON material
BEGIN
    DELETE FROM stammdaten_aenderung WHERE org_id = OLD.org_id AND art = 'material' AND schluessel = CAST(OLD.id AS TEXT);
    INSERT INTO stammdaten_aenderung (org_id, art, schluessel) VALUES (OLD.org_id, 'material', CAST(OLD.id AS TEXT));
    DELETE FROM stammdaten_aenderung WHERE org_id = NEW.org_id AND art = 'material' AND schluessel = CAST(NEW.id AS TEXT);
    INSERT INTO stammdaten_aenderung (org_id, art, schluessel) VALUES (NEW.org_id, 'material', CAST(NEW.id AS TEXT));
END;
CREATE TRIGGER material_log_d AFTER DELETE ON material
BEGIN
    DELETE FROM stammdaten_aenderung WHERE org_id = OLD.org_id AND art = 'material' AND schluessel = CAST(OLD.id AS TEXT);
    INSERT INTO stammdaten_aenderung (org_id, art, schluessel) VALUES (OLD.org_id, 'material', CAST(OLD.id AS TEXT));
END;
CREATE TRIGGER material_schutz_u BEFORE UPDATE ON material
WHEN EXISTS (SELECT 1 FROM stammdaten_herkunft h WHERE h.art = 'material' AND h.org_id = OLD.org_id AND h.lokaler_schluessel = CAST(OLD.id AS TEXT))
    AND NOT EXISTS (SELECT 1 FROM stammdaten_uebernahme)
BEGIN
    SELECT RAISE(ABORT, 'stammdaten_vom_hub');
END;

CREATE TRIGGER material_schutz_d BEFORE DELETE ON material
WHEN EXISTS (SELECT 1 FROM stammdaten_herkunft h WHERE h.art = 'material' AND h.org_id = OLD.org_id AND h.lokaler_schluessel = CAST(OLD.id AS TEXT))
    AND NOT EXISTS (SELECT 1 FROM stammdaten_uebernahme)
BEGIN
    SELECT RAISE(ABORT, 'stammdaten_vom_hub');
END;

-- fahrzeug_status (fahrzeug_status)
CREATE TRIGGER fahrzeug_status_log_i AFTER INSERT ON fahrzeug_status
BEGIN
    DELETE FROM stammdaten_aenderung WHERE org_id = NEW.org_id AND art = 'fahrzeug_status' AND schluessel = CAST(NEW.id AS TEXT);
    INSERT INTO stammdaten_aenderung (org_id, art, schluessel) VALUES (NEW.org_id, 'fahrzeug_status', CAST(NEW.id AS TEXT));
END;
CREATE TRIGGER fahrzeug_status_log_u AFTER UPDATE ON fahrzeug_status
BEGIN
    DELETE FROM stammdaten_aenderung WHERE org_id = OLD.org_id AND art = 'fahrzeug_status' AND schluessel = CAST(OLD.id AS TEXT);
    INSERT INTO stammdaten_aenderung (org_id, art, schluessel) VALUES (OLD.org_id, 'fahrzeug_status', CAST(OLD.id AS TEXT));
    DELETE FROM stammdaten_aenderung WHERE org_id = NEW.org_id AND art = 'fahrzeug_status' AND schluessel = CAST(NEW.id AS TEXT);
    INSERT INTO stammdaten_aenderung (org_id, art, schluessel) VALUES (NEW.org_id, 'fahrzeug_status', CAST(NEW.id AS TEXT));
END;
CREATE TRIGGER fahrzeug_status_log_d AFTER DELETE ON fahrzeug_status
BEGIN
    DELETE FROM stammdaten_aenderung WHERE org_id = OLD.org_id AND art = 'fahrzeug_status' AND schluessel = CAST(OLD.id AS TEXT);
    INSERT INTO stammdaten_aenderung (org_id, art, schluessel) VALUES (OLD.org_id, 'fahrzeug_status', CAST(OLD.id AS TEXT));
END;
CREATE TRIGGER fahrzeug_status_schutz_u BEFORE UPDATE ON fahrzeug_status
WHEN EXISTS (SELECT 1 FROM stammdaten_herkunft h WHERE h.art = 'fahrzeug_status' AND h.org_id = OLD.org_id AND h.lokaler_schluessel = CAST(OLD.id AS TEXT))
    AND NOT EXISTS (SELECT 1 FROM stammdaten_uebernahme)
BEGIN
    SELECT RAISE(ABORT, 'stammdaten_vom_hub');
END;

CREATE TRIGGER fahrzeug_status_schutz_d BEFORE DELETE ON fahrzeug_status
WHEN EXISTS (SELECT 1 FROM stammdaten_herkunft h WHERE h.art = 'fahrzeug_status' AND h.org_id = OLD.org_id AND h.lokaler_schluessel = CAST(OLD.id AS TEXT))
    AND NOT EXISTS (SELECT 1 FROM stammdaten_uebernahme)
BEGIN
    SELECT RAISE(ABORT, 'stammdaten_vom_hub');
END;

-- personal_status (personal_status)
CREATE TRIGGER personal_status_log_i AFTER INSERT ON personal_status
BEGIN
    DELETE FROM stammdaten_aenderung WHERE org_id = NEW.org_id AND art = 'personal_status' AND schluessel = CAST(NEW.id AS TEXT);
    INSERT INTO stammdaten_aenderung (org_id, art, schluessel) VALUES (NEW.org_id, 'personal_status', CAST(NEW.id AS TEXT));
END;
CREATE TRIGGER personal_status_log_u AFTER UPDATE ON personal_status
BEGIN
    DELETE FROM stammdaten_aenderung WHERE org_id = OLD.org_id AND art = 'personal_status' AND schluessel = CAST(OLD.id AS TEXT);
    INSERT INTO stammdaten_aenderung (org_id, art, schluessel) VALUES (OLD.org_id, 'personal_status', CAST(OLD.id AS TEXT));
    DELETE FROM stammdaten_aenderung WHERE org_id = NEW.org_id AND art = 'personal_status' AND schluessel = CAST(NEW.id AS TEXT);
    INSERT INTO stammdaten_aenderung (org_id, art, schluessel) VALUES (NEW.org_id, 'personal_status', CAST(NEW.id AS TEXT));
END;
CREATE TRIGGER personal_status_log_d AFTER DELETE ON personal_status
BEGIN
    DELETE FROM stammdaten_aenderung WHERE org_id = OLD.org_id AND art = 'personal_status' AND schluessel = CAST(OLD.id AS TEXT);
    INSERT INTO stammdaten_aenderung (org_id, art, schluessel) VALUES (OLD.org_id, 'personal_status', CAST(OLD.id AS TEXT));
END;
CREATE TRIGGER personal_status_schutz_u BEFORE UPDATE ON personal_status
WHEN EXISTS (SELECT 1 FROM stammdaten_herkunft h WHERE h.art = 'personal_status' AND h.org_id = OLD.org_id AND h.lokaler_schluessel = CAST(OLD.id AS TEXT))
    AND NOT EXISTS (SELECT 1 FROM stammdaten_uebernahme)
BEGIN
    SELECT RAISE(ABORT, 'stammdaten_vom_hub');
END;

CREATE TRIGGER personal_status_schutz_d BEFORE DELETE ON personal_status
WHEN EXISTS (SELECT 1 FROM stammdaten_herkunft h WHERE h.art = 'personal_status' AND h.org_id = OLD.org_id AND h.lokaler_schluessel = CAST(OLD.id AS TEXT))
    AND NOT EXISTS (SELECT 1 FROM stammdaten_uebernahme)
BEGIN
    SELECT RAISE(ABORT, 'stammdaten_vom_hub');
END;

-- einheit_typ (einheit_typ)
CREATE TRIGGER einheit_typ_log_i AFTER INSERT ON einheit_typ
BEGIN
    DELETE FROM stammdaten_aenderung WHERE org_id = NEW.org_id AND art = 'einheit_typ' AND schluessel = CAST(NEW.id AS TEXT);
    INSERT INTO stammdaten_aenderung (org_id, art, schluessel) VALUES (NEW.org_id, 'einheit_typ', CAST(NEW.id AS TEXT));
END;
CREATE TRIGGER einheit_typ_log_u AFTER UPDATE ON einheit_typ
BEGIN
    DELETE FROM stammdaten_aenderung WHERE org_id = OLD.org_id AND art = 'einheit_typ' AND schluessel = CAST(OLD.id AS TEXT);
    INSERT INTO stammdaten_aenderung (org_id, art, schluessel) VALUES (OLD.org_id, 'einheit_typ', CAST(OLD.id AS TEXT));
    DELETE FROM stammdaten_aenderung WHERE org_id = NEW.org_id AND art = 'einheit_typ' AND schluessel = CAST(NEW.id AS TEXT);
    INSERT INTO stammdaten_aenderung (org_id, art, schluessel) VALUES (NEW.org_id, 'einheit_typ', CAST(NEW.id AS TEXT));
END;
CREATE TRIGGER einheit_typ_log_d AFTER DELETE ON einheit_typ
BEGIN
    DELETE FROM stammdaten_aenderung WHERE org_id = OLD.org_id AND art = 'einheit_typ' AND schluessel = CAST(OLD.id AS TEXT);
    INSERT INTO stammdaten_aenderung (org_id, art, schluessel) VALUES (OLD.org_id, 'einheit_typ', CAST(OLD.id AS TEXT));
END;
CREATE TRIGGER einheit_typ_schutz_u BEFORE UPDATE ON einheit_typ
WHEN EXISTS (SELECT 1 FROM stammdaten_herkunft h WHERE h.art = 'einheit_typ' AND h.org_id = OLD.org_id AND h.lokaler_schluessel = CAST(OLD.id AS TEXT))
    AND NOT EXISTS (SELECT 1 FROM stammdaten_uebernahme)
BEGIN
    SELECT RAISE(ABORT, 'stammdaten_vom_hub');
END;

CREATE TRIGGER einheit_typ_schutz_d BEFORE DELETE ON einheit_typ
WHEN EXISTS (SELECT 1 FROM stammdaten_herkunft h WHERE h.art = 'einheit_typ' AND h.org_id = OLD.org_id AND h.lokaler_schluessel = CAST(OLD.id AS TEXT))
    AND NOT EXISTS (SELECT 1 FROM stammdaten_uebernahme)
BEGIN
    SELECT RAISE(ABORT, 'stammdaten_vom_hub');
END;

-- einheit_vorlage (einheit_vorlage)
CREATE TRIGGER einheit_vorlage_log_i AFTER INSERT ON einheit_vorlage
BEGIN
    DELETE FROM stammdaten_aenderung WHERE org_id = NEW.org_id AND art = 'einheit_vorlage' AND schluessel = CAST(NEW.id AS TEXT);
    INSERT INTO stammdaten_aenderung (org_id, art, schluessel) VALUES (NEW.org_id, 'einheit_vorlage', CAST(NEW.id AS TEXT));
END;
CREATE TRIGGER einheit_vorlage_log_u AFTER UPDATE ON einheit_vorlage
BEGIN
    DELETE FROM stammdaten_aenderung WHERE org_id = OLD.org_id AND art = 'einheit_vorlage' AND schluessel = CAST(OLD.id AS TEXT);
    INSERT INTO stammdaten_aenderung (org_id, art, schluessel) VALUES (OLD.org_id, 'einheit_vorlage', CAST(OLD.id AS TEXT));
    DELETE FROM stammdaten_aenderung WHERE org_id = NEW.org_id AND art = 'einheit_vorlage' AND schluessel = CAST(NEW.id AS TEXT);
    INSERT INTO stammdaten_aenderung (org_id, art, schluessel) VALUES (NEW.org_id, 'einheit_vorlage', CAST(NEW.id AS TEXT));
END;
CREATE TRIGGER einheit_vorlage_log_d AFTER DELETE ON einheit_vorlage
BEGIN
    DELETE FROM stammdaten_aenderung WHERE org_id = OLD.org_id AND art = 'einheit_vorlage' AND schluessel = CAST(OLD.id AS TEXT);
    INSERT INTO stammdaten_aenderung (org_id, art, schluessel) VALUES (OLD.org_id, 'einheit_vorlage', CAST(OLD.id AS TEXT));
END;
CREATE TRIGGER einheit_vorlage_schutz_u BEFORE UPDATE ON einheit_vorlage
WHEN EXISTS (SELECT 1 FROM stammdaten_herkunft h WHERE h.art = 'einheit_vorlage' AND h.org_id = OLD.org_id AND h.lokaler_schluessel = CAST(OLD.id AS TEXT))
    AND NOT EXISTS (SELECT 1 FROM stammdaten_uebernahme)
BEGIN
    SELECT RAISE(ABORT, 'stammdaten_vom_hub');
END;

CREATE TRIGGER einheit_vorlage_schutz_d BEFORE DELETE ON einheit_vorlage
WHEN EXISTS (SELECT 1 FROM stammdaten_herkunft h WHERE h.art = 'einheit_vorlage' AND h.org_id = OLD.org_id AND h.lokaler_schluessel = CAST(OLD.id AS TEXT))
    AND NOT EXISTS (SELECT 1 FROM stammdaten_uebernahme)
BEGIN
    SELECT RAISE(ABORT, 'stammdaten_vom_hub');
END;

-- org_fuehrungsfunktion (fuehrungsfunktion)
CREATE TRIGGER org_fuehrungsfunktion_log_i AFTER INSERT ON org_fuehrungsfunktion
BEGIN
    DELETE FROM stammdaten_aenderung WHERE org_id = NEW.org_id AND art = 'fuehrungsfunktion' AND schluessel = CAST(NEW.funktion AS TEXT);
    INSERT INTO stammdaten_aenderung (org_id, art, schluessel) VALUES (NEW.org_id, 'fuehrungsfunktion', CAST(NEW.funktion AS TEXT));
END;
CREATE TRIGGER org_fuehrungsfunktion_log_u AFTER UPDATE ON org_fuehrungsfunktion
BEGIN
    DELETE FROM stammdaten_aenderung WHERE org_id = OLD.org_id AND art = 'fuehrungsfunktion' AND schluessel = CAST(OLD.funktion AS TEXT);
    INSERT INTO stammdaten_aenderung (org_id, art, schluessel) VALUES (OLD.org_id, 'fuehrungsfunktion', CAST(OLD.funktion AS TEXT));
    DELETE FROM stammdaten_aenderung WHERE org_id = NEW.org_id AND art = 'fuehrungsfunktion' AND schluessel = CAST(NEW.funktion AS TEXT);
    INSERT INTO stammdaten_aenderung (org_id, art, schluessel) VALUES (NEW.org_id, 'fuehrungsfunktion', CAST(NEW.funktion AS TEXT));
END;
CREATE TRIGGER org_fuehrungsfunktion_log_d AFTER DELETE ON org_fuehrungsfunktion
BEGIN
    DELETE FROM stammdaten_aenderung WHERE org_id = OLD.org_id AND art = 'fuehrungsfunktion' AND schluessel = CAST(OLD.funktion AS TEXT);
    INSERT INTO stammdaten_aenderung (org_id, art, schluessel) VALUES (OLD.org_id, 'fuehrungsfunktion', CAST(OLD.funktion AS TEXT));
END;
CREATE TRIGGER org_fuehrungsfunktion_schutz_u BEFORE UPDATE ON org_fuehrungsfunktion
WHEN EXISTS (SELECT 1 FROM stammdaten_herkunft h WHERE h.art = 'fuehrungsfunktion' AND h.org_id = OLD.org_id AND h.lokaler_schluessel = CAST(OLD.funktion AS TEXT))
    AND NOT EXISTS (SELECT 1 FROM stammdaten_uebernahme)
BEGIN
    SELECT RAISE(ABORT, 'stammdaten_vom_hub');
END;

CREATE TRIGGER org_fuehrungsfunktion_schutz_d BEFORE DELETE ON org_fuehrungsfunktion
WHEN EXISTS (SELECT 1 FROM stammdaten_herkunft h WHERE h.art = 'fuehrungsfunktion' AND h.org_id = OLD.org_id AND h.lokaler_schluessel = CAST(OLD.funktion AS TEXT))
    AND NOT EXISTS (SELECT 1 FROM stammdaten_uebernahme)
BEGIN
    SELECT RAISE(ABORT, 'stammdaten_vom_hub');
END;

-- org_modul_einstellung (modul_einstellung)
CREATE TRIGGER org_modul_einstellung_log_i AFTER INSERT ON org_modul_einstellung
BEGIN
    DELETE FROM stammdaten_aenderung WHERE org_id = NEW.org_id AND art = 'modul_einstellung' AND schluessel = CAST(NEW.modul_key AS TEXT);
    INSERT INTO stammdaten_aenderung (org_id, art, schluessel) VALUES (NEW.org_id, 'modul_einstellung', CAST(NEW.modul_key AS TEXT));
END;
CREATE TRIGGER org_modul_einstellung_log_u AFTER UPDATE ON org_modul_einstellung
BEGIN
    DELETE FROM stammdaten_aenderung WHERE org_id = OLD.org_id AND art = 'modul_einstellung' AND schluessel = CAST(OLD.modul_key AS TEXT);
    INSERT INTO stammdaten_aenderung (org_id, art, schluessel) VALUES (OLD.org_id, 'modul_einstellung', CAST(OLD.modul_key AS TEXT));
    DELETE FROM stammdaten_aenderung WHERE org_id = NEW.org_id AND art = 'modul_einstellung' AND schluessel = CAST(NEW.modul_key AS TEXT);
    INSERT INTO stammdaten_aenderung (org_id, art, schluessel) VALUES (NEW.org_id, 'modul_einstellung', CAST(NEW.modul_key AS TEXT));
END;
CREATE TRIGGER org_modul_einstellung_log_d AFTER DELETE ON org_modul_einstellung
BEGIN
    DELETE FROM stammdaten_aenderung WHERE org_id = OLD.org_id AND art = 'modul_einstellung' AND schluessel = CAST(OLD.modul_key AS TEXT);
    INSERT INTO stammdaten_aenderung (org_id, art, schluessel) VALUES (OLD.org_id, 'modul_einstellung', CAST(OLD.modul_key AS TEXT));
END;
CREATE TRIGGER org_modul_einstellung_schutz_u BEFORE UPDATE ON org_modul_einstellung
WHEN EXISTS (SELECT 1 FROM stammdaten_herkunft h WHERE h.art = 'modul_einstellung' AND h.org_id = OLD.org_id AND h.lokaler_schluessel = CAST(OLD.modul_key AS TEXT))
    AND NOT EXISTS (SELECT 1 FROM stammdaten_uebernahme)
BEGIN
    SELECT RAISE(ABORT, 'stammdaten_vom_hub');
END;

CREATE TRIGGER org_modul_einstellung_schutz_d BEFORE DELETE ON org_modul_einstellung
WHEN EXISTS (SELECT 1 FROM stammdaten_herkunft h WHERE h.art = 'modul_einstellung' AND h.org_id = OLD.org_id AND h.lokaler_schluessel = CAST(OLD.modul_key AS TEXT))
    AND NOT EXISTS (SELECT 1 FROM stammdaten_uebernahme)
BEGIN
    SELECT RAISE(ABORT, 'stammdaten_vom_hub');
END;

-- org_einstellungen (org_einstellungen)
CREATE TRIGGER org_einstellungen_log_i AFTER INSERT ON org_einstellungen
BEGIN
    DELETE FROM stammdaten_aenderung WHERE org_id = NEW.org_id AND art = 'org_einstellungen' AND schluessel = '';
    INSERT INTO stammdaten_aenderung (org_id, art, schluessel) VALUES (NEW.org_id, 'org_einstellungen', '');
END;
CREATE TRIGGER org_einstellungen_log_u AFTER UPDATE ON org_einstellungen
BEGIN
    DELETE FROM stammdaten_aenderung WHERE org_id = OLD.org_id AND art = 'org_einstellungen' AND schluessel = '';
    INSERT INTO stammdaten_aenderung (org_id, art, schluessel) VALUES (OLD.org_id, 'org_einstellungen', '');
    DELETE FROM stammdaten_aenderung WHERE org_id = NEW.org_id AND art = 'org_einstellungen' AND schluessel = '';
    INSERT INTO stammdaten_aenderung (org_id, art, schluessel) VALUES (NEW.org_id, 'org_einstellungen', '');
END;
CREATE TRIGGER org_einstellungen_log_d AFTER DELETE ON org_einstellungen
BEGIN
    DELETE FROM stammdaten_aenderung WHERE org_id = OLD.org_id AND art = 'org_einstellungen' AND schluessel = '';
    INSERT INTO stammdaten_aenderung (org_id, art, schluessel) VALUES (OLD.org_id, 'org_einstellungen', '');
END;
CREATE TRIGGER org_einstellungen_schutz_u BEFORE UPDATE ON org_einstellungen
WHEN EXISTS (SELECT 1 FROM stammdaten_herkunft h WHERE h.art = 'org_einstellungen' AND h.org_id = OLD.org_id AND h.lokaler_schluessel = '')
    AND NOT EXISTS (SELECT 1 FROM stammdaten_uebernahme)
BEGIN
    SELECT RAISE(ABORT, 'stammdaten_vom_hub');
END;

CREATE TRIGGER org_einstellungen_schutz_d BEFORE DELETE ON org_einstellungen
WHEN EXISTS (SELECT 1 FROM stammdaten_herkunft h WHERE h.art = 'org_einstellungen' AND h.org_id = OLD.org_id AND h.lokaler_schluessel = '')
    AND NOT EXISTS (SELECT 1 FROM stammdaten_uebernahme)
BEGIN
    SELECT RAISE(ABORT, 'stammdaten_vom_hub');
END;

-- benutzer (konto)
CREATE TRIGGER benutzer_log_i AFTER INSERT ON benutzer
BEGIN
    DELETE FROM stammdaten_aenderung WHERE org_id = NEW.org_id AND art = 'konto' AND schluessel = CAST(NEW.id AS TEXT);
    INSERT INTO stammdaten_aenderung (org_id, art, schluessel) VALUES (NEW.org_id, 'konto', CAST(NEW.id AS TEXT));
END;
CREATE TRIGGER benutzer_log_u AFTER UPDATE OF anzeigename, benutzername, passwort_hash, system_rolle, org_rolle, aktiv, totp_secret, totp_aktiviert, org_id ON benutzer
BEGIN
    DELETE FROM stammdaten_aenderung WHERE org_id = OLD.org_id AND art = 'konto' AND schluessel = CAST(OLD.id AS TEXT);
    INSERT INTO stammdaten_aenderung (org_id, art, schluessel) VALUES (OLD.org_id, 'konto', CAST(OLD.id AS TEXT));
    DELETE FROM stammdaten_aenderung WHERE org_id = NEW.org_id AND art = 'konto' AND schluessel = CAST(NEW.id AS TEXT);
    INSERT INTO stammdaten_aenderung (org_id, art, schluessel) VALUES (NEW.org_id, 'konto', CAST(NEW.id AS TEXT));
END;
CREATE TRIGGER benutzer_log_d AFTER DELETE ON benutzer
BEGIN
    DELETE FROM stammdaten_aenderung WHERE org_id = OLD.org_id AND art = 'konto' AND schluessel = CAST(OLD.id AS TEXT);
    INSERT INTO stammdaten_aenderung (org_id, art, schluessel) VALUES (OLD.org_id, 'konto', CAST(OLD.id AS TEXT));
END;
CREATE TRIGGER benutzer_schutz_u BEFORE UPDATE OF anzeigename, benutzername, system_rolle, org_rolle, aktiv, org_id ON benutzer
WHEN EXISTS (SELECT 1 FROM stammdaten_herkunft h WHERE h.art = 'konto' AND h.org_id = OLD.org_id AND h.lokaler_schluessel = CAST(OLD.id AS TEXT))
    AND NOT EXISTS (SELECT 1 FROM stammdaten_uebernahme)
BEGIN
    SELECT RAISE(ABORT, 'stammdaten_vom_hub');
END;

CREATE TRIGGER benutzer_schutz_d BEFORE DELETE ON benutzer
WHEN EXISTS (SELECT 1 FROM stammdaten_herkunft h WHERE h.art = 'konto' AND h.org_id = OLD.org_id AND h.lokaler_schluessel = CAST(OLD.id AS TEXT))
    AND NOT EXISTS (SELECT 1 FROM stammdaten_uebernahme)
BEGIN
    SELECT RAISE(ABORT, 'stammdaten_vom_hub');
END;

-- personal_qualifikation (Unterliste von personal)
CREATE TRIGGER personal_qualifikation_log_i AFTER INSERT ON personal_qualifikation
BEGIN
    DELETE FROM stammdaten_aenderung WHERE art = 'personal' AND schluessel = CAST(NEW.personal_id AS TEXT)
        AND org_id = (SELECT org_id FROM personal WHERE id = NEW.personal_id);
    INSERT INTO stammdaten_aenderung (org_id, art, schluessel)
        SELECT org_id, 'personal', CAST(id AS TEXT) FROM personal WHERE id = NEW.personal_id;
END;
CREATE TRIGGER personal_qualifikation_schutz_i BEFORE INSERT ON personal_qualifikation
WHEN EXISTS (SELECT 1 FROM stammdaten_herkunft h JOIN personal e ON e.id = NEW.personal_id
        WHERE h.art = 'personal' AND h.org_id = e.org_id AND h.lokaler_schluessel = CAST(e.id AS TEXT))
    AND NOT EXISTS (SELECT 1 FROM stammdaten_uebernahme)
BEGIN
    SELECT RAISE(ABORT, 'stammdaten_vom_hub');
END;

CREATE TRIGGER personal_qualifikation_log_u AFTER UPDATE ON personal_qualifikation
BEGIN
    DELETE FROM stammdaten_aenderung WHERE art = 'personal' AND schluessel = CAST(NEW.personal_id AS TEXT)
        AND org_id = (SELECT org_id FROM personal WHERE id = NEW.personal_id);
    INSERT INTO stammdaten_aenderung (org_id, art, schluessel)
        SELECT org_id, 'personal', CAST(id AS TEXT) FROM personal WHERE id = NEW.personal_id;
END;
CREATE TRIGGER personal_qualifikation_schutz_u BEFORE UPDATE ON personal_qualifikation
WHEN EXISTS (SELECT 1 FROM stammdaten_herkunft h JOIN personal e ON e.id = NEW.personal_id
        WHERE h.art = 'personal' AND h.org_id = e.org_id AND h.lokaler_schluessel = CAST(e.id AS TEXT))
    AND NOT EXISTS (SELECT 1 FROM stammdaten_uebernahme)
BEGIN
    SELECT RAISE(ABORT, 'stammdaten_vom_hub');
END;

CREATE TRIGGER personal_qualifikation_log_d AFTER DELETE ON personal_qualifikation
BEGIN
    DELETE FROM stammdaten_aenderung WHERE art = 'personal' AND schluessel = CAST(OLD.personal_id AS TEXT)
        AND org_id = (SELECT org_id FROM personal WHERE id = OLD.personal_id);
    INSERT INTO stammdaten_aenderung (org_id, art, schluessel)
        SELECT org_id, 'personal', CAST(id AS TEXT) FROM personal WHERE id = OLD.personal_id;
END;
CREATE TRIGGER personal_qualifikation_schutz_d BEFORE DELETE ON personal_qualifikation
WHEN EXISTS (SELECT 1 FROM stammdaten_herkunft h JOIN personal e ON e.id = OLD.personal_id
        WHERE h.art = 'personal' AND h.org_id = e.org_id AND h.lokaler_schluessel = CAST(e.id AS TEXT))
    AND NOT EXISTS (SELECT 1 FROM stammdaten_uebernahme)
BEGIN
    SELECT RAISE(ABORT, 'stammdaten_vom_hub');
END;

-- einheit_vorlage_fahrzeug (Unterliste von einheit_vorlage)
CREATE TRIGGER einheit_vorlage_fahrzeug_log_i AFTER INSERT ON einheit_vorlage_fahrzeug
BEGIN
    DELETE FROM stammdaten_aenderung WHERE art = 'einheit_vorlage' AND schluessel = CAST(NEW.vorlage_id AS TEXT)
        AND org_id = (SELECT org_id FROM einheit_vorlage WHERE id = NEW.vorlage_id);
    INSERT INTO stammdaten_aenderung (org_id, art, schluessel)
        SELECT org_id, 'einheit_vorlage', CAST(id AS TEXT) FROM einheit_vorlage WHERE id = NEW.vorlage_id;
END;
CREATE TRIGGER einheit_vorlage_fahrzeug_schutz_i BEFORE INSERT ON einheit_vorlage_fahrzeug
WHEN EXISTS (SELECT 1 FROM stammdaten_herkunft h JOIN einheit_vorlage e ON e.id = NEW.vorlage_id
        WHERE h.art = 'einheit_vorlage' AND h.org_id = e.org_id AND h.lokaler_schluessel = CAST(e.id AS TEXT))
    AND NOT EXISTS (SELECT 1 FROM stammdaten_uebernahme)
BEGIN
    SELECT RAISE(ABORT, 'stammdaten_vom_hub');
END;

CREATE TRIGGER einheit_vorlage_fahrzeug_log_u AFTER UPDATE ON einheit_vorlage_fahrzeug
BEGIN
    DELETE FROM stammdaten_aenderung WHERE art = 'einheit_vorlage' AND schluessel = CAST(NEW.vorlage_id AS TEXT)
        AND org_id = (SELECT org_id FROM einheit_vorlage WHERE id = NEW.vorlage_id);
    INSERT INTO stammdaten_aenderung (org_id, art, schluessel)
        SELECT org_id, 'einheit_vorlage', CAST(id AS TEXT) FROM einheit_vorlage WHERE id = NEW.vorlage_id;
END;
CREATE TRIGGER einheit_vorlage_fahrzeug_schutz_u BEFORE UPDATE ON einheit_vorlage_fahrzeug
WHEN EXISTS (SELECT 1 FROM stammdaten_herkunft h JOIN einheit_vorlage e ON e.id = NEW.vorlage_id
        WHERE h.art = 'einheit_vorlage' AND h.org_id = e.org_id AND h.lokaler_schluessel = CAST(e.id AS TEXT))
    AND NOT EXISTS (SELECT 1 FROM stammdaten_uebernahme)
BEGIN
    SELECT RAISE(ABORT, 'stammdaten_vom_hub');
END;

CREATE TRIGGER einheit_vorlage_fahrzeug_log_d AFTER DELETE ON einheit_vorlage_fahrzeug
BEGIN
    DELETE FROM stammdaten_aenderung WHERE art = 'einheit_vorlage' AND schluessel = CAST(OLD.vorlage_id AS TEXT)
        AND org_id = (SELECT org_id FROM einheit_vorlage WHERE id = OLD.vorlage_id);
    INSERT INTO stammdaten_aenderung (org_id, art, schluessel)
        SELECT org_id, 'einheit_vorlage', CAST(id AS TEXT) FROM einheit_vorlage WHERE id = OLD.vorlage_id;
END;
CREATE TRIGGER einheit_vorlage_fahrzeug_schutz_d BEFORE DELETE ON einheit_vorlage_fahrzeug
WHEN EXISTS (SELECT 1 FROM stammdaten_herkunft h JOIN einheit_vorlage e ON e.id = OLD.vorlage_id
        WHERE h.art = 'einheit_vorlage' AND h.org_id = e.org_id AND h.lokaler_schluessel = CAST(e.id AS TEXT))
    AND NOT EXISTS (SELECT 1 FROM stammdaten_uebernahme)
BEGIN
    SELECT RAISE(ABORT, 'stammdaten_vom_hub');
END;

-- einheit_vorlage_personal (Unterliste von einheit_vorlage)
CREATE TRIGGER einheit_vorlage_personal_log_i AFTER INSERT ON einheit_vorlage_personal
BEGIN
    DELETE FROM stammdaten_aenderung WHERE art = 'einheit_vorlage' AND schluessel = CAST(NEW.vorlage_id AS TEXT)
        AND org_id = (SELECT org_id FROM einheit_vorlage WHERE id = NEW.vorlage_id);
    INSERT INTO stammdaten_aenderung (org_id, art, schluessel)
        SELECT org_id, 'einheit_vorlage', CAST(id AS TEXT) FROM einheit_vorlage WHERE id = NEW.vorlage_id;
END;
CREATE TRIGGER einheit_vorlage_personal_schutz_i BEFORE INSERT ON einheit_vorlage_personal
WHEN EXISTS (SELECT 1 FROM stammdaten_herkunft h JOIN einheit_vorlage e ON e.id = NEW.vorlage_id
        WHERE h.art = 'einheit_vorlage' AND h.org_id = e.org_id AND h.lokaler_schluessel = CAST(e.id AS TEXT))
    AND NOT EXISTS (SELECT 1 FROM stammdaten_uebernahme)
BEGIN
    SELECT RAISE(ABORT, 'stammdaten_vom_hub');
END;

CREATE TRIGGER einheit_vorlage_personal_log_u AFTER UPDATE ON einheit_vorlage_personal
BEGIN
    DELETE FROM stammdaten_aenderung WHERE art = 'einheit_vorlage' AND schluessel = CAST(NEW.vorlage_id AS TEXT)
        AND org_id = (SELECT org_id FROM einheit_vorlage WHERE id = NEW.vorlage_id);
    INSERT INTO stammdaten_aenderung (org_id, art, schluessel)
        SELECT org_id, 'einheit_vorlage', CAST(id AS TEXT) FROM einheit_vorlage WHERE id = NEW.vorlage_id;
END;
CREATE TRIGGER einheit_vorlage_personal_schutz_u BEFORE UPDATE ON einheit_vorlage_personal
WHEN EXISTS (SELECT 1 FROM stammdaten_herkunft h JOIN einheit_vorlage e ON e.id = NEW.vorlage_id
        WHERE h.art = 'einheit_vorlage' AND h.org_id = e.org_id AND h.lokaler_schluessel = CAST(e.id AS TEXT))
    AND NOT EXISTS (SELECT 1 FROM stammdaten_uebernahme)
BEGIN
    SELECT RAISE(ABORT, 'stammdaten_vom_hub');
END;

CREATE TRIGGER einheit_vorlage_personal_log_d AFTER DELETE ON einheit_vorlage_personal
BEGIN
    DELETE FROM stammdaten_aenderung WHERE art = 'einheit_vorlage' AND schluessel = CAST(OLD.vorlage_id AS TEXT)
        AND org_id = (SELECT org_id FROM einheit_vorlage WHERE id = OLD.vorlage_id);
    INSERT INTO stammdaten_aenderung (org_id, art, schluessel)
        SELECT org_id, 'einheit_vorlage', CAST(id AS TEXT) FROM einheit_vorlage WHERE id = OLD.vorlage_id;
END;
CREATE TRIGGER einheit_vorlage_personal_schutz_d BEFORE DELETE ON einheit_vorlage_personal
WHEN EXISTS (SELECT 1 FROM stammdaten_herkunft h JOIN einheit_vorlage e ON e.id = OLD.vorlage_id
        WHERE h.art = 'einheit_vorlage' AND h.org_id = e.org_id AND h.lokaler_schluessel = CAST(e.id AS TEXT))
    AND NOT EXISTS (SELECT 1 FROM stammdaten_uebernahme)
BEGIN
    SELECT RAISE(ABORT, 'stammdaten_vom_hub');
END;

-- einheit_vorlage_material (Unterliste von einheit_vorlage)
CREATE TRIGGER einheit_vorlage_material_log_i AFTER INSERT ON einheit_vorlage_material
BEGIN
    DELETE FROM stammdaten_aenderung WHERE art = 'einheit_vorlage' AND schluessel = CAST(NEW.vorlage_id AS TEXT)
        AND org_id = (SELECT org_id FROM einheit_vorlage WHERE id = NEW.vorlage_id);
    INSERT INTO stammdaten_aenderung (org_id, art, schluessel)
        SELECT org_id, 'einheit_vorlage', CAST(id AS TEXT) FROM einheit_vorlage WHERE id = NEW.vorlage_id;
END;
CREATE TRIGGER einheit_vorlage_material_schutz_i BEFORE INSERT ON einheit_vorlage_material
WHEN EXISTS (SELECT 1 FROM stammdaten_herkunft h JOIN einheit_vorlage e ON e.id = NEW.vorlage_id
        WHERE h.art = 'einheit_vorlage' AND h.org_id = e.org_id AND h.lokaler_schluessel = CAST(e.id AS TEXT))
    AND NOT EXISTS (SELECT 1 FROM stammdaten_uebernahme)
BEGIN
    SELECT RAISE(ABORT, 'stammdaten_vom_hub');
END;

CREATE TRIGGER einheit_vorlage_material_log_u AFTER UPDATE ON einheit_vorlage_material
BEGIN
    DELETE FROM stammdaten_aenderung WHERE art = 'einheit_vorlage' AND schluessel = CAST(NEW.vorlage_id AS TEXT)
        AND org_id = (SELECT org_id FROM einheit_vorlage WHERE id = NEW.vorlage_id);
    INSERT INTO stammdaten_aenderung (org_id, art, schluessel)
        SELECT org_id, 'einheit_vorlage', CAST(id AS TEXT) FROM einheit_vorlage WHERE id = NEW.vorlage_id;
END;
CREATE TRIGGER einheit_vorlage_material_schutz_u BEFORE UPDATE ON einheit_vorlage_material
WHEN EXISTS (SELECT 1 FROM stammdaten_herkunft h JOIN einheit_vorlage e ON e.id = NEW.vorlage_id
        WHERE h.art = 'einheit_vorlage' AND h.org_id = e.org_id AND h.lokaler_schluessel = CAST(e.id AS TEXT))
    AND NOT EXISTS (SELECT 1 FROM stammdaten_uebernahme)
BEGIN
    SELECT RAISE(ABORT, 'stammdaten_vom_hub');
END;

CREATE TRIGGER einheit_vorlage_material_log_d AFTER DELETE ON einheit_vorlage_material
BEGIN
    DELETE FROM stammdaten_aenderung WHERE art = 'einheit_vorlage' AND schluessel = CAST(OLD.vorlage_id AS TEXT)
        AND org_id = (SELECT org_id FROM einheit_vorlage WHERE id = OLD.vorlage_id);
    INSERT INTO stammdaten_aenderung (org_id, art, schluessel)
        SELECT org_id, 'einheit_vorlage', CAST(id AS TEXT) FROM einheit_vorlage WHERE id = OLD.vorlage_id;
END;
CREATE TRIGGER einheit_vorlage_material_schutz_d BEFORE DELETE ON einheit_vorlage_material
WHEN EXISTS (SELECT 1 FROM stammdaten_herkunft h JOIN einheit_vorlage e ON e.id = OLD.vorlage_id
        WHERE h.art = 'einheit_vorlage' AND h.org_id = e.org_id AND h.lokaler_schluessel = CAST(e.id AS TEXT))
    AND NOT EXISTS (SELECT 1 FROM stammdaten_uebernahme)
BEGIN
    SELECT RAISE(ABORT, 'stammdaten_vom_hub');
END;

