-- no-transaction
-- LFH-827: Passwortwechsel in der Auth-Audit-Spur. `POST /api/auth/passwort` (LFH-471) schrieb
-- bisher nur `tracing`; bei einem Vorfall lautet die Frage aber „wann hat wer das Passwort
-- geändert, und von welcher IP?“. Neu im ereignis-CHECK: 'passwort_geaendert' (Wechsel
-- vollzogen) und 'passwort_wechsel_abgewiesen' (altes Passwort falsch). Wire-Werte des Enums
-- `auth::audit::Ereignis`.
--
-- SQLite ändert einen Spalten-CHECK nur per Tabellen-Rebuild. auth_audit ist Leaf (keine
-- Tabelle verweist darauf, gemessen per grep über migrations/) → kein PRAGMA-foreign_keys-Toggle
-- nötig, das DROP löst keine Kaskade aus (Muster 0112/0132/0141). Die Tabelle trägt
-- AUTOINCREMENT → der sqlite_sequence-Eintrag wird umgehängt, sonst vergäbe SQLite nach dem
-- Löschen der höchsten Zeile (etwa durch den 90-Tage-Purge) deren id erneut.
-- Schema = 0091 1:1, einzige Änderung ist der ereignis-CHECK; die Spaltenkommentare bleiben
-- wortgleich (die DDL trägt sie mit, der Test vergleicht sie).
-- Abgesichert von db::tests::migration_0143_* (include_str!).

CREATE TABLE auth_audit_neu (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    zeitpunkt     TEXT NOT NULL DEFAULT (datetime('now')),
    -- Wire-Werte des Enums `auth::audit::Ereignis` — der CHECK ist die DB-seitige
    -- Absicherung des Kontrakts (Guard: tests/enum_wire_kontrakt.rs).
    ereignis      TEXT NOT NULL CHECK (ereignis IN ('login_ok', 'login_fehlgeschlagen', 'logout', 'passwort_geaendert', 'passwort_wechsel_abgewiesen')),
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

INSERT INTO auth_audit_neu (id, zeitpunkt, ereignis, benutzername, benutzer_id, peer_ip, provider)
    SELECT id, zeitpunkt, ereignis, benutzername, benutzer_id, peer_ip, provider
    FROM auth_audit;

-- Sequenz der Alt-Tabelle übernehmen, bevor DROP ihren Eintrag entfernt (Begründung in 0112).
DELETE FROM sqlite_sequence
 WHERE name = 'auth_audit_neu'
   AND EXISTS (SELECT 1 FROM sqlite_sequence WHERE name = 'auth_audit');
INSERT INTO sqlite_sequence (name, seq)
    SELECT 'auth_audit_neu', seq FROM sqlite_sequence WHERE name = 'auth_audit';

DROP TABLE auth_audit;

ALTER TABLE auth_audit_neu RENAME TO auth_audit;

-- No-op, falls SQLite den Eintrag beim RENAME bereits mitzieht (wie in 0082).
UPDATE sqlite_sequence SET name = 'auth_audit' WHERE name = 'auth_audit_neu';

-- Die Indizes aus 0091 fallen mit dem DROP; wortgleich neu.
CREATE INDEX idx_auth_audit_zeitpunkt ON auth_audit (zeitpunkt);
CREATE INDEX idx_auth_audit_ip_zeit ON auth_audit (peer_ip, zeitpunkt);
