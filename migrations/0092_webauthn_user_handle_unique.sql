-- Usernameless/discoverable Passkey-Login (LFH-313). Rein additiv.
--
-- Der WebAuthn-User-Handle wird beim discoverable-Login rückwärts aufgelöst
-- (`identify_discoverable_authentication` liefert den Handle → Benutzer). Damit diese
-- Auflösung EINDEUTIG ist, muss der Handle über alle Benutzer eindeutig sein — zwei
-- Benutzer mit demselben Handle wären ein Sicherheitsbug (Login als der falsche Nutzer).
--
-- Partieller Index (WHERE ... IS NOT NULL): die Spalte ist nullable (No-op-Default für
-- Nutzer ohne Passkey), NULLs sind vom UNIQUE ausgenommen — Muster wie idx_benutzer_oidc
-- (0083) und idx_etb_client_id (0088). Der Handle ist eine zufällige Uuid::new_v4
-- (`auth::webauthn::user_handle`); der Index macht die faktische Eindeutigkeit strukturell.
CREATE UNIQUE INDEX idx_benutzer_webauthn_handle
    ON benutzer(webauthn_user_handle)
    WHERE webauthn_user_handle IS NOT NULL;
