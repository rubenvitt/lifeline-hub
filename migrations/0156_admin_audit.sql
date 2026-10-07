-- LFH-1005: Admin-Spur. Was ein Admin am Zugang ändert (Benutzer anlegen, deaktivieren,
-- reaktivieren, Rolle ändern, Zweitfaktor zurücksetzen, Anmeldeweg schalten), hinterließ bisher
-- keine Spur. `auth_audit` (0091) beschreibt Anmeldevorgänge EINER Person; eine Admin-Aktion hat
-- zwei Beteiligte und manchmal gar kein Zielkonto (Anmeldeweg). Deshalb eine eigene Tabelle mit
-- eigener Frist (`auth::admin_audit::AUFBEWAHRUNG_TAGE`, Purge-Lauf Phase C).
CREATE TABLE admin_audit (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    zeitpunkt        TEXT NOT NULL DEFAULT (datetime('now')),
    -- Wire-Werte des Enums `auth::admin_audit::AdminAktion` (Test
    -- `jede_aktion_passiert_den_db_check`).
    aktion           TEXT NOT NULL CHECK (aktion IN ('benutzer_angelegt', 'benutzer_deaktiviert',
                         'benutzer_reaktiviert', 'rolle_geaendert', 'zweitfaktor_zurueckgesetzt',
                         'anmeldeweg_aktiviert', 'anmeldeweg_deaktiviert')),
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

-- Purge nach Alter und „letzte Aktionen“.
CREATE INDEX idx_admin_audit_zeitpunkt ON admin_audit (zeitpunkt);
-- „Was ist mit diesem Konto passiert?“
CREATE INDEX idx_admin_audit_ziel ON admin_audit (ziel_benutzer_id, zeitpunkt);
