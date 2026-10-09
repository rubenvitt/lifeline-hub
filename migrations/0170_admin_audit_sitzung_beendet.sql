-- no-transaction
-- LFH-1092: Von einem Admin beendete Sitzungen in der Admin-Spur. Neu im aktion-CHECK:
-- 'sitzung_beendet' (ein Eintrag je Sitzung, Gerät und Anmeldezeit im Detail). Wire-Wert des
-- Enums `auth::admin_audit::AdminAktion`.
--
-- Rebuild nach Muster 0143: admin_audit ist Leaf (keine Tabelle verweist darauf, gemessen per grep
-- über migrations/) → kein PRAGMA-foreign_keys-Toggle nötig. Die Tabelle trägt AUTOINCREMENT →
-- der sqlite_sequence-Eintrag wird umgehängt, sonst vergäbe SQLite nach dem Löschen der höchsten
-- Zeile (365-Tage-Purge) deren id erneut.
-- Schema = 0156 1:1, einzige Änderung ist der aktion-CHECK; die Spaltenkommentare bleiben
-- wortgleich (die DDL trägt sie mit, der Test vergleicht sie).
-- Abgesichert von db::tests::migration_0170_* (include_str!).

CREATE TABLE admin_audit_neu (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    zeitpunkt        TEXT NOT NULL DEFAULT (datetime('now')),
    -- Wire-Werte des Enums `auth::admin_audit::AdminAktion` (Test
    -- `jede_aktion_passiert_den_db_check`).
    aktion           TEXT NOT NULL CHECK (aktion IN ('benutzer_angelegt', 'benutzer_deaktiviert',
                         'benutzer_reaktiviert', 'rolle_geaendert', 'zweitfaktor_zurueckgesetzt',
                         'anmeldeweg_aktiviert', 'anmeldeweg_deaktiviert', 'sitzung_beendet')),
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
    peer_ip          TEXT
);

INSERT INTO admin_audit_neu
    (id, zeitpunkt, aktion, akteur_id, akteur_name, ziel_benutzer_id, ziel, detail, peer_ip)
    SELECT id, zeitpunkt, aktion, akteur_id, akteur_name, ziel_benutzer_id, ziel, detail, peer_ip
    FROM admin_audit;

-- Sequenz der Alt-Tabelle übernehmen, bevor DROP ihren Eintrag entfernt (Begründung in 0112).
DELETE FROM sqlite_sequence
 WHERE name = 'admin_audit_neu'
   AND EXISTS (SELECT 1 FROM sqlite_sequence WHERE name = 'admin_audit');
INSERT INTO sqlite_sequence (name, seq)
    SELECT 'admin_audit_neu', seq FROM sqlite_sequence WHERE name = 'admin_audit';

DROP TABLE admin_audit;

ALTER TABLE admin_audit_neu RENAME TO admin_audit;

-- No-op, falls SQLite den Eintrag beim RENAME bereits mitzieht (wie in 0082).
UPDATE sqlite_sequence SET name = 'admin_audit' WHERE name = 'admin_audit_neu';

-- Die Indizes aus 0156 fallen mit dem DROP; wortgleich neu.
-- Purge nach Alter und „letzte Aktionen“.
CREATE INDEX idx_admin_audit_zeitpunkt ON admin_audit (zeitpunkt);
-- „Was ist mit diesem Konto passiert?“
CREATE INDEX idx_admin_audit_ziel ON admin_audit (ziel_benutzer_id, zeitpunkt);
