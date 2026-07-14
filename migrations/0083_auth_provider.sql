-- Auth-Provider-Fundament (LFH-57). Rein additiv: benutzer wird NICHT rebuildt,
-- passwort_hash bleibt NOT NULL bis Increment 3 (JIT-SSO ohne Passwort).

-- Anhängbare Credential-/Identitäts-Spalten am bestehenden Konto.
ALTER TABLE benutzer ADD COLUMN oidc_subject  TEXT;
ALTER TABLE benutzer ADD COLUMN oidc_issuer   TEXT;
ALTER TABLE benutzer ADD COLUMN totp_secret   TEXT;
ALTER TABLE benutzer ADD COLUMN totp_aktiviert INTEGER NOT NULL DEFAULT 0;

-- Eine SSO-Identität (issuer+sub) darf höchstens einem Konto gehören.
-- Partiell, damit viele Konten ohne SSO (NULL) koexistieren.
CREATE UNIQUE INDEX idx_benutzer_oidc
    ON benutzer(oidc_issuer, oidc_subject)
    WHERE oidc_subject IS NOT NULL;

-- Lokale Passkeys (Increment 4 füllt sie; Schema hier vorbereitet).
CREATE TABLE webauthn_credential (
    id            INTEGER PRIMARY KEY,
    benutzer_id   INTEGER NOT NULL REFERENCES benutzer(id) ON DELETE CASCADE,
    credential_id BLOB NOT NULL UNIQUE,
    public_key    BLOB NOT NULL,
    sign_count    INTEGER NOT NULL DEFAULT 0,
    label         TEXT,
    erstellt_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_webauthn_credential_benutzer ON webauthn_credential(benutzer_id);

-- Einmalige TOTP-Recovery-Codes (Increment 5 füllt sie; gehasht gespeichert).
CREATE TABLE totp_recovery_code (
    id          INTEGER PRIMARY KEY,
    benutzer_id INTEGER NOT NULL REFERENCES benutzer(id) ON DELETE CASCADE,
    code_hash   TEXT NOT NULL,
    benutzt_at  TEXT
);
CREATE INDEX idx_totp_recovery_benutzer ON totp_recovery_code(benutzer_id);

-- Serverweiter An/Aus-OVERRIDE je Provider. Fehlt eine Zeile, gilt der Provider
-- als aktiviert (Default). Die konfigurierte Menge lebt im Code (registry::konfiguriert).
CREATE TABLE auth_provider (
    id        TEXT PRIMARY KEY,
    aktiviert INTEGER NOT NULL DEFAULT 1
);
