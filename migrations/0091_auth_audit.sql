-- LFH-249/F30: Auth-Audit-Spur.
--
-- Bis hierher hinterließen Login und Logout keinerlei Spur — ein fehlgeschlagener
-- Anmeldeversuch war nach dem Request nicht mehr nachweisbar. Für ein
-- Einsatzführungssystem im Behördenbetrieb ist „wer hat wann versucht, sich anzumelden"
-- aber eine Frage, die man beantworten können muss.
--
-- Bewusst als Tabelle und nicht nur als stdout-Log: nur so ist die Spur revisionssicher,
-- landet im Backup und ist über die API auswertbar. Der Preis ist, dass hier
-- personenbezogene Daten (Benutzername, IP) liegen — deshalb die Aufbewahrungsfrist,
-- die `auth::audit::purge_abgelaufene` im Purge-Scheduler durchsetzt.
CREATE TABLE auth_audit (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    zeitpunkt     TEXT NOT NULL DEFAULT (datetime('now')),
    -- Wire-Werte des Enums `auth::audit::Ereignis` — der CHECK ist die DB-seitige
    -- Absicherung des Kontrakts (Guard: tests/enum_wire_kontrakt.rs).
    ereignis      TEXT NOT NULL CHECK (ereignis IN ('login_ok', 'login_fehlgeschlagen', 'logout')),
    -- Bei Erfolg der angemeldete Benutzer; bei Fehlschlag der VERSUCHTE Name — der ist
    -- der interessante Teil einer Brute-Force-Spur und existiert womöglich gar nicht als
    -- Benutzer, deshalb reiner Text ohne FK.
    benutzername  TEXT,
    -- Nur bei Erfolg gesetzt. ON DELETE SET NULL: das Löschen eines Benutzers darf die
    -- Audit-Spur nicht mitreißen, aber auch nicht auf eine tote ID zeigen.
    benutzer_id   INTEGER REFERENCES benutzer(id) ON DELETE SET NULL,
    -- Socket-Adresse des Aufrufers. NULL, wenn sie nicht ermittelbar war.
    peer_ip       TEXT,
    -- Welcher Anmeldeweg: 'passwort', 'oidc', 'passkey', …
    provider      TEXT NOT NULL
);

-- Deckt beide Zugriffsmuster ab: Purge nach Alter und die Abfrage „letzte Ereignisse".
CREATE INDEX idx_auth_audit_zeitpunkt ON auth_audit (zeitpunkt);
-- Für die Brute-Force-Frage „wie oft von dieser Quelle in Zeitraum X".
CREATE INDEX idx_auth_audit_ip_zeit ON auth_audit (peer_ip, zeitpunkt);
