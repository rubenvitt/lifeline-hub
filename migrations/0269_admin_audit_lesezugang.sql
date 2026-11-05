-- no-transaction
-- LLH-1484: Admin-Spur für den Lesezugang externer Anzeigen. Neu im aktion-CHECK
-- 'lesezugang_angelegt' und 'lesezugang_widerrufen' (Wire-Werte des
-- Enums `auth::admin_audit::AdminAktion`; beim Lesezugang ist `ziel` seine Bezeichnung und
-- `ziel_benutzer_id` NULL). Rebuild nach Muster 0174, mit der Spalte `org_id`
-- und ihrem Index aus 0191. admin_audit ist Leaf → kein PRAGMA-foreign_keys-Toggle; der
-- sqlite_sequence-Eintrag wird umgehängt (Begründung in 0112).
CREATE TABLE admin_audit_neu (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    zeitpunkt        TEXT NOT NULL DEFAULT (datetime('now')),
    -- Wire-Werte des Enums `auth::admin_audit::AdminAktion` (Test
    -- `jede_aktion_passiert_den_db_check`).
    aktion           TEXT NOT NULL CHECK (aktion IN ('benutzer_angelegt', 'benutzer_deaktiviert',
                         'benutzer_reaktiviert', 'rolle_geaendert', 'zweitfaktor_zurueckgesetzt',
                         'anmeldeweg_aktiviert', 'anmeldeweg_deaktiviert', 'sitzung_beendet',
                         'einmalpasswort_vergeben', 'lesezugang_angelegt',
                         'lesezugang_widerrufen')),
    -- Handelnde Person. Der Name steht als Schnappschuss daneben, damit der Eintrag ohne Join
    -- lesbar bleibt. ON DELETE SET NULL wie in auth_audit: die Spur überlebt ihren Benutzer.
    akteur_id        INTEGER REFERENCES benutzer(id) ON DELETE SET NULL,
    akteur_name      TEXT,
    -- Betroffenes Konto; NULL, wenn das Ziel ein Anmeldeweg ist.
    ziel_benutzer_id INTEGER REFERENCES benutzer(id) ON DELETE SET NULL,
    -- Benutzername des Zielkontos oder id des Anmeldewegs ('passwort', 'oidc', …).
    ziel             TEXT NOT NULL,
    -- Was genau, wo die Aktion allein es nicht sagt: Rollen beim Anlegen, alt → neu beim Ändern.
    detail           TEXT,
    -- Socket-Adresse des Aufrufers. NULL, wenn sie nicht ermittelbar war.
    peer_ip          TEXT,
    -- Org der handelnden Person als Schnappschuss (0191); NULL = serverweit.
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

-- No-op, falls SQLite den Eintrag beim RENAME bereits mitzieht (wie in 0082).
UPDATE sqlite_sequence SET name = 'admin_audit' WHERE name = 'admin_audit_neu';

-- Die Indizes aus 0156/0170/0191 fallen mit dem DROP; wortgleich neu.
-- Purge nach Alter und „letzte Aktionen“.
CREATE INDEX idx_admin_audit_zeitpunkt ON admin_audit (zeitpunkt);
-- „Was ist mit diesem Konto passiert?“
CREATE INDEX idx_admin_audit_ziel ON admin_audit (ziel_benutzer_id, zeitpunkt);
-- Die Liste liest neueste zuerst je Org.
CREATE INDEX idx_admin_audit_org ON admin_audit (org_id, id);
