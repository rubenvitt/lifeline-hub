-- WebAuthn/Passkeys (LFH-275, Increment 4). Rein additiv.

-- Zufälliger, EINMALIG generierter Opaque-User-Handle (16 Bytes/UUID) für die
-- WebAuthn-Ceremony (`user.id` gegenüber dem Authenticator). NICHT aus `benutzer.id`
-- ableitbar/abgeleitet — Authenticatoren speichern (rp_id, handle) dauerhaft, ein
-- späterer Wechsel würde jeden Passkey invalidieren. Siehe `auth::webauthn::user_handle`.
ALTER TABLE benutzer ADD COLUMN webauthn_user_handle BLOB;

-- Der komplette, opak serialisierte `Passkey` (serde/JSON) — `credential_id` bleibt für
-- Lookup/UNIQUE/exclude_credentials in ihrer eigenen Spalte (Increment-1-Schema).
ALTER TABLE webauthn_credential ADD COLUMN passkey_json TEXT;
