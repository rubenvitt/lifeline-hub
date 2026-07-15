//! WebAuthn/Passkey-Login-Smoke (LFH-275, Increment 4). `#[ignore]`: braucht einen laufenden
//! `--tls`-Server unter einem Hostnamen (nicht IP, siehe `docs/betrieb-webauthn.md`) + einen
//! Browser mit Authenticator (Plattform wie Touch ID/Windows Hello oder Roaming wie ein
//! Sicherheitsschlüssel) — nicht Teil der Unit-Suite (kein `navigator.credentials`-WebAuthn-API
//! in `cargo test`, kein echter Ceremony-Roundtrip ohne Browser).
//!
//! Manueller Ablauf (Build-Host/Betrieb, siehe auch `docs/betrieb-webauthn.md`):
//!
//! 1. Server über HTTPS mit einem Hostnamen (rp_id/rp_origin, KEINE IP) starten, z.B.:
//!    ```bash
//!    LIFELINE_WEBAUTHN_RP_ID=elw.local \
//!    LIFELINE_WEBAUTHN_RP_ORIGIN=https://elw.local:8443 \
//!    lifeline-hub --tls --tls-hostname elw.local --bind 127.0.0.1:8443
//!    ```
//!    (mDNS-Hostname wie `elw.local` oder echtes DNS — siehe `docs/betrieb-tls.md` für
//!    `--tls-hostname`/Cache-SAN-Invalidierung und den mkcert-Root-CA-Rollout.)
//! 2. Im Browser (mit installiertem/vertrautem Authenticator) `https://elw.local:8443/login`
//!    öffnen und sich mit einem bestehenden lokalen Konto per Passwort einloggen (Passkeys
//!    sind an ein BESTEHENDES Konto gebunden — kein Self-Signup über WebAuthn).
//! 3. Zu "Profil" navigieren und auf "Passkey registrieren" klicken → das löst
//!    `navigator.credentials.create()` aus (`POST /api/auth/webauthn/register/start` +
//!    `/register/finish`). Erwartung: der Browser fragt den Authenticator ab (Touch ID/
//!    Windows Hello/Sicherheitsschlüssel-Tap), die Registrierung schließt ohne Fehler ab.
//! 4. Ausloggen.
//! 5. Auf der Login-Seite den Benutzernamen eingeben und "Mit Passkey anmelden" klicken →
//!    das löst `navigator.credentials.get()` aus (`POST /api/auth/webauthn/auth/start` +
//!    `/auth/finish`), OHNE Passwort. Erwartung: der Browser fragt erneut den Authenticator
//!    ab, danach ist die Session aufgebaut (eingeloggt, wie beim Passwort-Login).
//! 6. Erneuter Passkey-Login mit demselben Credential → funktioniert weiterhin (der
//!    Signature-Counter des Authenticators wird serverseitig fortgeschrieben und bei jeder
//!    Authentifizierung geprüft). Clone-/Regressions-Erkennung (der Counter darf nicht
//!    zurückspringen oder stehen bleiben, wenn der Authenticator ihn hochzählt) wird von
//!    `webauthn-rs` selbst durchgesetzt — kein eigener Zähler-Vergleich in diesem Repo,
//!    daher hier keine manuelle Prüfschritt-Reproduktion (bräuchte einen klonbaren
//!    Test-Authenticator).
//!
//! Manuell/Build-Host: `cargo test --test webauthn_smoke -- --ignored` (Server + TLS-Hostname
//! + Browser + Authenticator müssen dafür bereitstehen — daher kein automatisierter Teil
//! dieses Tests).
#[test]
#[ignore]
fn webauthn_passkey_end_to_end_dokumentiert() {
    // Platzhalter-Doku: der echte WebAuthn-Smoke läuft manuell (siehe Modul-Doku oben), weil
    // er einen laufenden HTTPS-Server unter einem Hostnamen, einen Browser und einen echten
    // Authenticator braucht (nicht in der Unit-Suite, kein `navigator.credentials` hier).
}
