-- LLH-1656 (Change z6ds0ed9-webhooks-outbox, design.md D8): Admin-Spur der Webhooks am
-- Maschinenzugang. Neu im aktion-CHECK 'maschinenzugang_webhook_angelegt', '…_geaendert',
-- '…_entfernt', '…_wieder_aufgenommen', '…_lan_erlaubt' und '…_lan_entzogen'. Rebuild nach Muster
-- 0340 (in einer Transaktion); die Liste übernimmt alles bis 0346 (Löschersuchen, LLH-1712).
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
                         'maschinenzugang_widerrufen', 'archiv_eingespielt',
                         'instanz_zertifikat_gewechselt', 'instanz_adresse_geaendert',
                         'einwurf_zugang_angelegt', 'einwurf_zugang_schluessel_gewechselt',
                         'einwurf_zugang_widerrufen', 'archiv_person_geschwaerzt',
                         'archiv_durchsucht', 'maschinenzugang_webhook_angelegt',
                         'maschinenzugang_webhook_geaendert', 'maschinenzugang_webhook_entfernt',
                         'maschinenzugang_webhook_wieder_aufgenommen',
                         'maschinenzugang_webhook_lan_erlaubt',
                         'maschinenzugang_webhook_lan_entzogen')),
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
