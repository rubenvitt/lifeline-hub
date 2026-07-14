//! OIDC/SSO-Login-Smoke gegen ein echtes PocketID (LFH-41, Increment 3). `#[ignore]`: braucht
//! einen laufenden PocketID-Server + einen laufenden `lifeline-hub`-Prozess + einen Browser —
//! nicht Teil der Unit-Suite (kein Netz, kein Redirect-Flow in `cargo test`).
//!
//! Manueller Ablauf (Build-Host/Betrieb, siehe auch `docs/betrieb-oidc.md`):
//!
//! 1. PocketID bereitstellen (lokal oder erreichbar) und dort einen OIDC-Client anlegen mit
//!    Redirect-URL `https://<host>/api/auth/oidc/callback` (Details: `docs/betrieb-oidc.md`).
//! 2. `lifeline-hub` mit allen vier OIDC-Env-Vars starten, z.B.:
//!    ```bash
//!    LIFELINE_OIDC_ISSUER=https://pocketid.example \
//!    LIFELINE_OIDC_CLIENT_ID=<client-id> \
//!    LIFELINE_OIDC_CLIENT_SECRET=<client-secret> \
//!    LIFELINE_OIDC_REDIRECT_URL=https://<host>/api/auth/oidc/callback \
//!    lifeline-hub --tls --bind 127.0.0.1:8443
//!    ```
//! 3. Im Browser die Login-Seite öffnen (`https://<host>/login`) — der Button
//!    "Mit PocketID anmelden" muss erscheinen (Provider-Registry listet `oidc`, sobald
//!    Issuer/Client-ID/Client-Secret gesetzt sind).
//! 4. Auf "Mit PocketID anmelden" klicken → Redirect zu PocketID → dort mit einem
//!    PocketID-Testkonto einloggen, das noch KEINE `(issuer, subject)`-Bindung in
//!    `lifeline-hub` hat.
//! 5. Erwartung nach dem Callback (`GET /api/auth/oidc/callback`):
//!    - Redirect zurück in die App, eingeloggt (Session-Cookie gesetzt).
//!    - In der `benutzer`-Tabelle wurde GENAU EIN neues Konto angelegt, matched über
//!      `(oidc_issuer, oidc_subject)` — least-privilege: `system_rolle = keiner`,
//!      `org_rolle = keine`, `passwort_hash = PASSWORT_HASH_SSO_ONLY` (kein lokales
//!      Passwort möglich). KEIN automatisches Verlinken an ein bestehendes lokales
//!      Konto gleichen Namens (siehe `src/auth/oidc/provisioning.rs`).
//!    - Ein Admin muss das neue Konto anschließend manuell hochstufen (Rolle setzen),
//!      bevor es fachlich etwas sehen/tun kann.
//! 6. Erneuter Login mit demselben PocketID-Konto → derselbe `benutzer`-Datensatz wird
//!    wiedergefunden (kein Doppel-Insert), Session wird wie gewohnt aufgebaut.
//!
//! Manuell/Build-Host: `cargo test --test oidc_smoke -- --ignored` (Server + PocketID +
//! Browser müssen dafür bereitstehen — daher kein automatisierter Teil dieses Tests).
#[test]
#[ignore]
fn oidc_end_to_end_login_dokumentiert() {
    // Platzhalter-Doku: der echte OIDC-Smoke läuft manuell (siehe Modul-Doku oben),
    // weil er einen laufenden Server, ein echtes PocketID und einen Browser-Redirect
    // braucht (nicht in der Unit-Suite, kein Netz hier).
}
