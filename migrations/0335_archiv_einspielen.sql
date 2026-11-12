-- LLH-1494, Teil 3 (Change tkky2noy-archiv-nachbereitung, design.md D10): Einspielen eines
-- Archivblocks per Befehl. Der Einsatz erscheint als beendeter Spiegel ohne Kopplung und wird
-- 7 Tage später abgeräumt.

-- Eingespielte Einsätze und wann sie wieder gehen. `sha256` ist die Prüfsumme der eingespielten
-- Datei (Admin-Spur, Abgleich mit `einsatz_archiv.sha256`).
CREATE TABLE einsatz_archiv_eingespielt (
    einsatz_id     INTEGER PRIMARY KEY REFERENCES einsatz(id) ON DELETE CASCADE,
    sha256         TEXT NOT NULL,
    eingespielt_at TEXT NOT NULL,
    loeschen_at    TEXT NOT NULL
);

CREATE INDEX idx_einsatz_archiv_eingespielt_loeschen ON einsatz_archiv_eingespielt (loeschen_at);

-- Gesperrte Platzhalter-Konten für die Konten eines eingespielten Einsatzes, mit dem Namen aus dem
-- Archiv. Sie erscheinen in keiner Verwaltung (`OHNE_STELLVERTRETER`) und gehen nach dem Einsatz.
-- `einsatz_id` ohne Fremdschlüssel: nach dem Abräumen des Einsatzes findet das Aufräumen die
-- Konten noch.
CREATE TABLE archiv_konto (
    benutzer_id INTEGER PRIMARY KEY REFERENCES benutzer(id) ON DELETE CASCADE,
    einsatz_id  INTEGER NOT NULL
);

CREATE INDEX idx_archiv_konto_einsatz ON archiv_konto (einsatz_id);

-- Admin-Spur: neu im aktion-CHECK 'archiv_eingespielt' (Liste bis 0334). Rebuild nach Muster 0330, in einer
-- Transaktion (admin_audit ist Leaf).
CREATE TABLE admin_audit_neu (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    zeitpunkt        TEXT NOT NULL DEFAULT (datetime('now')),
    -- Wire-Werte des Enums `auth::admin_audit::AdminAktion` (Test
    -- `jede_aktion_passiert_den_db_check`).
    aktion           TEXT NOT NULL CHECK (aktion IN ('benutzer_angelegt', 'benutzer_deaktiviert',
                         'benutzer_reaktiviert', 'rolle_geaendert', 'zweitfaktor_zurueckgesetzt',
                         'anmeldeweg_aktiviert', 'anmeldeweg_deaktiviert', 'sitzung_beendet',
                         'einmalpasswort_vergeben', 'lesezugang_angelegt',
                         'lesezugang_widerrufen', 'instanz_code_ausgestellt',
                         'instanz_code_eingeloest', 'instanz_gekoppelt',
                         'instanz_kopplung_widerrufen',
                         'instanz_kopplung_vom_gegenueber_widerrufen',
                         'unterschrift_registriert', 'unterschrift_gegengezeichnet',
                         'unterschrift_widerrufen', 'unterschrift_abgelehnt',
                         'instanz_elw_verloren', 'unterschrift_bestaetigt',
                         'unterschrift_zurueckgewiesen', 'fuehrung_notuebernahme',
                         'fuehrung_verworfen', 'fuehrung_widerspruch',
                         'archiv_schluessel_eingetragen', 'archiv_schluessel_geprueft',
                         'archiv_schluessel_entfernt', 'archiv_heruntergeladen',
                         'maschinenzugang_angelegt', 'maschinenzugang_code_ausgestellt',
                         'maschinenzugang_schluessel_gebunden', 'maschinenzugang_geaendert',
                         'maschinenzugang_widerrufen', 'archiv_eingespielt')),
    akteur_id        INTEGER REFERENCES benutzer(id) ON DELETE SET NULL,
    akteur_name      TEXT,
    ziel_benutzer_id INTEGER REFERENCES benutzer(id) ON DELETE SET NULL,
    ziel             TEXT NOT NULL,
    detail           TEXT,
    peer_ip          TEXT,
    org_id           INTEGER
);

INSERT INTO admin_audit_neu
    (id, zeitpunkt, aktion, akteur_id, akteur_name, ziel_benutzer_id, ziel, detail, peer_ip,
     org_id)
    SELECT id, zeitpunkt, aktion, akteur_id, akteur_name, ziel_benutzer_id, ziel, detail, peer_ip,
           org_id
    FROM admin_audit;

DELETE FROM sqlite_sequence
 WHERE name = 'admin_audit_neu'
   AND EXISTS (SELECT 1 FROM sqlite_sequence WHERE name = 'admin_audit');
INSERT INTO sqlite_sequence (name, seq)
    SELECT 'admin_audit_neu', seq FROM sqlite_sequence WHERE name = 'admin_audit';

DROP TABLE admin_audit;

ALTER TABLE admin_audit_neu RENAME TO admin_audit;

UPDATE sqlite_sequence SET name = 'admin_audit' WHERE name = 'admin_audit_neu';

CREATE INDEX idx_admin_audit_zeitpunkt ON admin_audit (zeitpunkt);
CREATE INDEX idx_admin_audit_ziel ON admin_audit (ziel_benutzer_id, zeitpunkt);
CREATE INDEX idx_admin_audit_org ON admin_audit (org_id, id);
