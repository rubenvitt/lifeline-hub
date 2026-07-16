use axum::body::{to_bytes, Body};
use axum::http::{header, Request, StatusCode};
use tower::ServiceExt; // stellt `oneshot` bereit

mod common;
use common::{anfrage, login_cookie, setup, setup_mit_pool};

/// Sendet ein Login und gibt den `Set-Cookie`-Header-Wert zurück.
async fn login(
    app: &axum::Router,
    benutzername: &str,
    passwort: &str,
) -> (StatusCode, Option<String>) {
    let body = format!(r#"{{"benutzername":"{benutzername}","passwort":"{passwort}"}}"#);
    let resp = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/auth/login")
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(body))
                .unwrap(),
        )
        .await
        .unwrap();
    let status = resp.status();
    let cookie = resp
        .headers()
        .get(header::SET_COOKIE)
        .map(|v| v.to_str().unwrap().to_string());
    (status, cookie)
}

#[tokio::test]
async fn login_erfolgreich_setzt_httponly_cookie() {
    let app = setup().await;
    let (status, cookie) = login(&app, "admin", "startpw12").await;
    assert_eq!(status, StatusCode::OK);
    let cookie = cookie.expect("Set-Cookie erwartet");
    assert!(cookie.contains("lifeline_sid="));
    assert!(cookie.to_lowercase().contains("httponly"));
}

#[tokio::test]
async fn login_mit_falschem_passwort_ist_401() {
    let app = setup().await;
    let (status, _) = login(&app, "admin", "falsch").await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn login_mit_unbekanntem_benutzer_ist_401() {
    let app = setup().await;
    let (status, _) = login(&app, "niemand", "egal1234").await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn me_ohne_session_ist_401() {
    let app = setup().await;
    let resp = app
        .oneshot(
            Request::builder()
                .uri("/api/auth/me")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn me_mit_session_liefert_benutzer() {
    let app = setup().await;
    let (_, cookie) = login(&app, "admin", "startpw12").await;
    // Set-Cookie-Wert vor dem ersten ';' ist das eigentliche name=value-Paar.
    let cookie_paar = cookie.unwrap();
    let cookie_paar = cookie_paar.split(';').next().unwrap().to_string();

    let resp = app
        .oneshot(
            Request::builder()
                .uri("/api/auth/me")
                .header(header::COOKIE, cookie_paar)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);

    let bytes = to_bytes(resp.into_body(), usize::MAX).await.unwrap();
    let json: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(json["benutzername"], "admin");
    assert_eq!(json["system_rolle"], "admin");
    assert!(
        json.get("passwort_hash").is_none(),
        "Hash darf nicht ausgegeben werden"
    );
}

#[tokio::test]
async fn logout_invalidiert_session() {
    let app = setup().await;
    let (_, cookie) = login(&app, "admin", "startpw12").await;
    let cookie_paar = cookie.unwrap().split(';').next().unwrap().to_string();

    // Logout.
    let resp = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/auth/logout")
                .header(header::COOKIE, cookie_paar.clone())
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::NO_CONTENT);

    // Dieselbe Session ist danach ungültig.
    let resp = app
        .oneshot(
            Request::builder()
                .uri("/api/auth/me")
                .header(header::COOKIE, cookie_paar)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn login_mit_deaktiviertem_passwort_provider_ist_403() {
    // Enforcement-Seam (LFH-41, defensiv): direkt in `auth_provider` geschrieben, weil der
    // Aussperr-Guard (`registry::schalten`) den Provider "passwort" NICHT deaktivieren ließe,
    // solange noch ein aktiver Admin existiert (409, siehe `admin_kann_passwort_nicht_
    // deaktivieren_409` unten) — der Guard umgeht also den regulären Toggle-Endpunkt. Anders als
    // beim OIDC-Override (`oidc_deaktiviert_override`) ist hier kein prozessweiter OnceLock im
    // Spiel: "passwort" ist immer in `konfiguriert()` gelistet, die Override-Zeile greift sofort.
    let (app, pool) = setup_mit_pool().await;
    sqlx::query(
        "INSERT INTO auth_provider (id, aktiviert) VALUES ('passwort', 0) \
         ON CONFLICT(id) DO UPDATE SET aktiviert = 0",
    )
    .execute(&pool)
    .await
    .unwrap();

    let (status, _) = login(&app, "admin", "startpw12").await;
    assert_eq!(status, StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn providers_listet_passwort() {
    let app = setup().await;
    let (status, json) = anfrage(&app, "GET", "/api/auth/providers", "", None).await;
    assert_eq!(status, StatusCode::OK);
    let ids: Vec<&str> = json
        .as_array()
        .unwrap()
        .iter()
        .map(|p| p["id"].as_str().unwrap())
        .collect();
    assert!(ids.contains(&"passwort"));
}

#[tokio::test]
async fn providers_admin_ohne_session_ist_401() {
    let app = setup().await;
    let (status, _) = anfrage(&app, "GET", "/api/auth/providers/admin", "", None).await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
}

/// Router-Ebene (nicht nur die reine `public_provider_projektion`-Funktion, s.
/// `routes::auth::tests`): `/api/auth/providers` filtert deaktivierte, `/api/auth/providers/admin`
/// (hinter `AdminUser`) zeigt sie (LFH-277). Aktiviert "oidc" GLOBAL für den Rest dieses
/// Testbinary-Prozesses (`OIDC_KONFIGURIERT`-OnceLock, s. `oidc_callback_mit_unbekanntem_state_
/// redirect_auf_login_fehler`-Doc) — unschädlich für die 404-Tests oben, die per
/// `oidc_deaktiviert_override` reihenfolge-unabhängig gemacht sind.
#[tokio::test]
async fn providers_admin_zeigt_deaktivierte_public_verbirgt_sie() {
    lifeline_hub::auth::provider::registry::set_oidc_konfiguriert(true);
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;

    // oidc regulär deaktivieren (kein Lockout-Risiko: passwort bleibt aktiv).
    let (status, _) = anfrage(
        &app,
        "PUT",
        "/api/auth/providers/oidc",
        &admin,
        Some(r#"{"aktiviert":false}"#),
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    let (status, json) = anfrage(&app, "GET", "/api/auth/providers", "", None).await;
    assert_eq!(status, StatusCode::OK);
    assert!(
        !json.as_array().unwrap().iter().any(|p| p["id"] == "oidc"),
        "public: deaktiviertes oidc nicht sichtbar"
    );

    let (status, json) = anfrage(&app, "GET", "/api/auth/providers/admin", &admin, None).await;
    assert_eq!(status, StatusCode::OK);
    let oidc = json
        .as_array()
        .unwrap()
        .iter()
        .find(|p| p["id"] == "oidc")
        .expect("admin: oidc sichtbar");
    assert_eq!(oidc["aktiviert"], false);
}

#[tokio::test]
async fn toggle_ohne_admin_session_ist_401() {
    let app = setup().await;
    let (status, _) = anfrage(
        &app,
        "PUT",
        "/api/auth/providers/passwort",
        "",
        Some(r#"{"aktiviert":false}"#),
    )
    .await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn admin_kann_passwort_nicht_deaktivieren_409() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let (status, _) = anfrage(
        &app,
        "PUT",
        "/api/auth/providers/passwort",
        &admin,
        Some(r#"{"aktiviert":false}"#),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT);
}

/// Schreibt eine Override-Zeile, die "oidc" explizit deaktiviert — unabhängig davon, ob der
/// prozessweite `OIDC_KONFIGURIERT`-OnceLock (in `auth::provider::registry`) in diesem
/// Testbinary-Prozess (`--test auth`) bereits `true` ist oder noch `false`:
/// - `false` (Default/noch keine andere Test-Funktion hat `set_oidc_konfiguriert(true)`
///   aufgerufen): "oidc" taucht in `konfiguriert()` gar nicht auf, die Override-Zeile wird von
///   `liste()` schlicht ignoriert (kein Effekt, aber auch kein Schaden) — 404 wie vorher.
/// - `true` (irgendeine andere Testfunktion in diesem Prozess hat es bereits gesetzt — der
///   OnceLock ist prozessweit, `#[tokio::test]`s in einer Datei laufen im selben Prozess,
///   Reihenfolge ist NICHT garantiert): ohne diese Override-Zeile würde "oidc" plötzlich
///   `aktiviert=true` gelistet und der Enforcement-Check hier fälschlich durchfallen (404 →
///   Redirect). Die Zeile macht die Assertion damit reihenfolge-unabhängig.
async fn oidc_deaktiviert_override(pool: &sqlx::SqlitePool) {
    sqlx::query(
        "INSERT INTO auth_provider (id, aktiviert) VALUES ('oidc', 0) \
         ON CONFLICT(id) DO UPDATE SET aktiviert = 0",
    )
    .execute(pool)
    .await
    .unwrap();
}

#[tokio::test]
async fn oidc_start_ohne_konfigurierten_provider_ist_404() {
    // Siehe `oidc_deaktiviert_override`-Doc: macht diesen Test robust gegen die Ausführungs-
    // reihenfolge mit `oidc_callback_mit_unbekanntem_state_redirect_auf_login_fehler` (setzt in
    // diesem Prozess `set_oidc_konfiguriert(true)` — prozessweiter OnceLock, kein Zurücksetzen).
    // Prüft die JSON-Fehler-Antwort (nicht nur den Statuscode): unterscheidet den echten
    // Enforcement-404 (`AppError::NotFound`, JSON-Body `{"error": "Nicht gefunden"}`) von einem
    // bloßen Routing-404 (nicht registrierte Route), das ein leerer Klartext-Body wäre und hier
    // zu `Value::Null` degradieren würde.
    let (app, pool) = setup_mit_pool().await;
    oidc_deaktiviert_override(&pool).await;
    let (status, json) = anfrage(&app, "GET", "/api/auth/oidc/start", "", None).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    assert_eq!(json["error"], "Nicht gefunden");
}

#[tokio::test]
async fn oidc_callback_ohne_konfigurierten_provider_ist_404() {
    // Dieselbe Enforcement-Prüfung (Registry-Check) wie `oidc_start` — siehe
    // `oidc_deaktiviert_override`-Doc zur Reihenfolge-Unabhängigkeit.
    let (app, pool) = setup_mit_pool().await;
    oidc_deaktiviert_override(&pool).await;
    let (status, json) = anfrage(
        &app,
        "GET",
        "/api/auth/oidc/callback?code=x&state=unbekannt",
        "",
        None,
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    assert_eq!(json["error"], "Nicht gefunden");
}

#[tokio::test]
async fn oidc_callback_mit_unbekanntem_state_redirect_auf_login_fehler() {
    // Aktiviert "oidc" GLOBAL für den Rest dieses Testbinary-Prozesses (`OIDC_KONFIGURIERT`
    // ist ein `OnceLock`, `set_oidc_konfiguriert` ignoriert jeden weiteren Aufruf) — siehe
    // `oidc_deaktiviert_override`-Doc für die Kehrseite (macht die beiden 404-Tests oben
    // reihenfolge-unabhängig).
    lifeline_hub::auth::provider::registry::set_oidc_konfiguriert(true);
    let app = setup().await;

    // `state=unbekannt` wurde nie über `/oidc/start` angelegt: `entnehme` liefert `None` — DAS
    // greift, BEVOR der Handler irgendeinen Netzzugriff (Token-Tausch/Discovery) macht, ist also
    // ohne echten IdP testbar (kein `set_oidc_konfiguriert`-Discovery-Aufruf nötig, weil der
    // State-Check zuerst läuft und hier sofort scheitert).
    let resp = app
        .oneshot(
            Request::builder()
                .uri("/api/auth/oidc/callback?code=x&state=unbekannt")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(resp.status(), StatusCode::SEE_OTHER); // axum::response::Redirect::to = 303
    let location = resp
        .headers()
        .get(header::LOCATION)
        .expect("Location-Header erwartet")
        .to_str()
        .unwrap();
    assert_eq!(location, "/login?fehler=oidc");
}

/// Schreibt eine Override-Zeile, die "webauthn" explizit deaktiviert — unabhängig davon, ob der
/// prozessweite `WEBAUTHN_KONFIGURIERT`-OnceLock in diesem Testbinary-Prozess (`--test auth`)
/// bereits `true` ist (z. B. durch eine künftige Task-6-Testfunktion, die
/// `set_webauthn_konfiguriert(true)` aufruft). Analog `oidc_deaktiviert_override` — macht die
/// 404-Tests unten reihenfolge-unabhängig.
async fn webauthn_deaktiviert_override(pool: &sqlx::SqlitePool) {
    sqlx::query(
        "INSERT INTO auth_provider (id, aktiviert) VALUES ('webauthn', 0) \
         ON CONFLICT(id) DO UPDATE SET aktiviert = 0",
    )
    .execute(pool)
    .await
    .unwrap();
}

#[tokio::test]
async fn webauthn_register_start_ohne_session_ist_401() {
    let app = setup().await;
    let (status, _) = anfrage(&app, "POST", "/api/auth/webauthn/register/start", "", None).await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn webauthn_register_start_mit_session_aber_ohne_provider_ist_404() {
    // Default in Tests: "webauthn" ist NICHT konfiguriert (kein Boot-Bau in `setup_mit_pool`) —
    // die Override-Zeile macht den Test zusätzlich robust gegen die Ausführungsreihenfolge mit
    // künftigen Tests, die den prozessweiten OnceLock global auf `true` setzen (siehe
    // `webauthn_deaktiviert_override`-Doc).
    let (app, pool) = setup_mit_pool().await;
    webauthn_deaktiviert_override(&pool).await;
    let admin = login_cookie(&app, "admin", "startpw12").await;

    let (status, json) = anfrage(
        &app,
        "POST",
        "/api/auth/webauthn/register/start",
        &admin,
        None,
    )
    .await;

    assert_eq!(status, StatusCode::NOT_FOUND);
    assert_eq!(json["error"], "Nicht gefunden");
}

#[tokio::test]
async fn webauthn_register_finish_ohne_session_ist_401() {
    // `CurrentUser` wird VOR dem `Json<RegisterPublicKeyCredential>`-Body-Extractor ausgewertet
    // (Reihenfolge der Handler-Parameter) — ein fehlender/ungültiger Body ist hier irrelevant,
    // der Request scheitert bereits an der fehlenden Session, bevor der Body je geparst wird.
    let app = setup().await;
    let (status, _) = anfrage(&app, "POST", "/api/auth/webauthn/register/finish", "", None).await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn webauthn_register_start_mit_provider_liefert_ccr_und_setzt_reg_cookie() {
    // Aktiviert "webauthn" GLOBAL für den Rest dieses Testbinary-Prozesses (OnceLock, wie
    // `set_oidc_konfiguriert`) UND hält ein ECHTES, lokal gebautes `Webauthn` im prozessweiten
    // `WEBAUTHN`-OnceLock (`auth::webauthn::set_webauthn`) — `start_passkey_registration` ist
    // reine Challenge-Generierung (kein Netz, kein Authenticator nötig), nur `finish` bräuchte
    // ein echtes Gerät (siehe Task-8-Smoke). Macht `webauthn_deaktiviert_override` oben endlich
    // diskriminierend (ohne die Override-Zeile in den beiden 404-Tests würden sie ab hier
    // fälschlich durchfallen) und verifiziert die state-key-Cookie-Bindung end-to-end.
    lifeline_hub::auth::provider::registry::set_webauthn_konfiguriert(true);
    lifeline_hub::auth::webauthn::set_webauthn(
        lifeline_hub::auth::webauthn::baue("localhost", "https://localhost").unwrap(),
    );
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;

    let resp = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/auth/webauthn/register/start")
                .header(header::COOKIE, admin)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(resp.status(), StatusCode::OK);
    let cookie = resp
        .headers()
        .get(header::SET_COOKIE)
        .expect("Set-Cookie (webauthn_reg) erwartet")
        .to_str()
        .unwrap()
        .to_string();
    assert!(
        cookie.contains("webauthn_reg="),
        "state-key muss als eigenes Cookie gesetzt werden, nicht im Response-Body"
    );
    assert!(cookie.to_lowercase().contains("httponly"));
    assert!(cookie.contains("/api/auth/webauthn"));

    let bytes = to_bytes(resp.into_body(), usize::MAX).await.unwrap();
    let json: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
    assert!(
        json.get("publicKey").is_some(),
        "Response muss die CreationChallengeResponse (publicKey) für navigator.credentials.create enthalten"
    );
    assert!(
        json["publicKey"].get("challenge").is_some(),
        "publicKey muss die Challenge enthalten"
    );
}

/// Aktiviert "webauthn" GLOBAL für den Rest dieses Testbinary-Prozesses (idempotenter OnceLock,
/// wie im Register-Test oben) — geteilter Helfer für alle `auth/start`/`auth/finish`-Tests
/// (LFH-275 Task 6), die einen konfigurierten Provider brauchen.
fn webauthn_aktivieren() {
    lifeline_hub::auth::provider::registry::set_webauthn_konfiguriert(true);
    lifeline_hub::auth::webauthn::set_webauthn(
        lifeline_hub::auth::webauthn::baue("localhost", "https://localhost").unwrap(),
    );
}

#[tokio::test]
async fn webauthn_auth_start_deaktiviert_ist_404() {
    // Default in Tests bzw. explizit per Override deaktiviert — unabhängig von der
    // Ausführungsreihenfolge mit `webauthn_aktivieren`-Tests im selben Testbinary-Prozess
    // (analog `webauthn_register_start_mit_session_aber_ohne_provider_ist_404`).
    let (app, pool) = setup_mit_pool().await;
    webauthn_deaktiviert_override(&pool).await;

    let (status, json) = anfrage(
        &app,
        "POST",
        "/api/auth/webauthn/auth/start",
        "",
        Some(r#"{"benutzername":"admin"}"#),
    )
    .await;

    assert_eq!(status, StatusCode::NOT_FOUND);
    assert_eq!(json["error"], "Nicht gefunden");
}

#[tokio::test]
async fn webauthn_auth_start_unbekannter_benutzer_ist_generischer_fehler() {
    webauthn_aktivieren();
    let app = setup().await;

    let (status, json) = anfrage(
        &app,
        "POST",
        "/api/auth/webauthn/auth/start",
        "",
        Some(r#"{"benutzername":"existiert-nicht"}"#),
    )
    .await;

    // NO-Enumeration-MUST: kein 200, kein Detail wie "Benutzer nicht gefunden" — derselbe
    // generische 401 wie bei falschem Passwort im normalen Login.
    assert_eq!(status, StatusCode::UNAUTHORIZED);
    assert_eq!(json["error"], "Nicht angemeldet");
}

#[tokio::test]
async fn webauthn_auth_start_bekannter_benutzer_ohne_passkey_liefert_denselben_fehler() {
    // Beweist die NO-Enumeration-Eigenschaft diskriminierend: "admin" EXISTIERT (per
    // `bootstrap_admin` in `setup_mit_pool`/`setup`) und ist aktiv, hat aber in diesem frisch
    // isolierten Test-Pool garantiert KEINEN registrierten Passkey — Status UND Fehlertext
    // müssen 1:1 identisch zum Unbekannt-Fall oben sein, sonst leakt die Antwort, ob ein
    // Benutzername existiert.
    webauthn_aktivieren();
    let app = setup().await;

    let (status, json) = anfrage(
        &app,
        "POST",
        "/api/auth/webauthn/auth/start",
        "",
        Some(r#"{"benutzername":"admin"}"#),
    )
    .await;

    assert_eq!(status, StatusCode::UNAUTHORIZED);
    assert_eq!(json["error"], "Nicht angemeldet");
}

/// Ein strukturell valides (aber kryptografisch bedeutungsloses) `PublicKeyCredential`-JSON —
/// genug, damit der `Json<PublicKeyCredential>`-Body-Extractor VOR der eigentlichen
/// Handler-Logik erfolgreich deserialisiert (sonst schlägt der Request schon am Extractor mit
/// `422` fehl, bevor der State-Cookie-Check in `webauthn_auth_finish` je läuft — analog der
/// dokumentierten Extractor-Reihenfolge bei `webauthn_register_finish_ohne_session_ist_401`).
///
/// `extensions` bewusst WEGGELASSEN statt `null`: die tatsächlich kompilierte
/// `PublicKeyCredential` (re-exportiert aus `webauthn-rs-proto`, s. `webauthn-rs-core`s
/// `pub mod proto { pub use webauthn_rs_proto::*; }` — die gleichnamigen Typen direkt in
/// `webauthn-rs-core/src/proto.rs` sind TOTER, nie über `mod proto;` eingebundener Code) trägt
/// `extensions: AuthenticationExtensionsClientOutputs` (KEIN `Option`!) mit
/// `#[serde(default, alias = "clientExtensionResults")]` — der Schlüssel darf fehlen (Default),
/// ein explizites JSON-`null` schlägt dagegen fehl ("invalid type: null, expected struct
/// AuthenticationExtensionsClientOutputs"), verifiziert per Diagnose-Deserialisierung gegen den
/// Crate-Quelltext.
const FINISH_BODY_PLATZHALTER: &str = r#"{
    "id": "AAAA",
    "rawId": "AAAA",
    "response": {
        "authenticatorData": "AAAA",
        "clientDataJSON": "AAAA",
        "signature": "AAAA",
        "userHandle": null
    },
    "type": "public-key"
}"#;

#[tokio::test]
async fn webauthn_auth_finish_ohne_state_cookie_ist_generischer_fehler() {
    webauthn_aktivieren();
    let app = setup().await;

    let (status, json) = anfrage(
        &app,
        "POST",
        "/api/auth/webauthn/auth/finish",
        "",
        Some(FINISH_BODY_PLATZHALTER),
    )
    .await;

    assert_eq!(status, StatusCode::UNAUTHORIZED);
    assert_eq!(json["error"], "Nicht angemeldet");
}

#[tokio::test]
async fn webauthn_auth_finish_mit_unbekanntem_state_cookie_ist_generischer_fehler() {
    webauthn_aktivieren();
    let app = setup().await;

    let (status, json) = anfrage(
        &app,
        "POST",
        "/api/auth/webauthn/auth/finish",
        "webauthn_auth=nie-gespeichert",
        Some(FINISH_BODY_PLATZHALTER),
    )
    .await;

    assert_eq!(status, StatusCode::UNAUTHORIZED);
    assert_eq!(json["error"], "Nicht angemeldet");
}

#[tokio::test]
async fn webauthn_auth_finish_deaktiviert_ist_404() {
    let (app, pool) = setup_mit_pool().await;
    webauthn_deaktiviert_override(&pool).await;

    let (status, json) = anfrage(
        &app,
        "POST",
        "/api/auth/webauthn/auth/finish",
        "",
        Some(FINISH_BODY_PLATZHALTER),
    )
    .await;

    assert_eq!(status, StatusCode::NOT_FOUND);
    assert_eq!(json["error"], "Nicht gefunden");
}

#[tokio::test]
async fn oidc_callback_mit_idp_error_redirect_ohne_400() {
    // Derselbe prozessweite OnceLock wie in `oidc_callback_mit_unbekanntem_state_redirect_auf_
    // login_fehler` — erneutes Setzen ist ein No-op, falls eine andere Testfunktion in diesem
    // Prozess bereits `true` gesetzt hat (reihenfolge-unabhängig).
    lifeline_hub::auth::provider::registry::set_oidc_konfiguriert(true);
    let app = setup().await;

    // IdP-Error-Callback (z. B. abgelehnte Zustimmung): `?error=access_denied&state=...`, KEIN
    // `code` — ein normaler, spec-konformer Ablauf (RFC 6749 4.1.2.1). Vor Fix B waren `code`/
    // `state` Pflichtfelder im Query-Extractor, der diesen Fall mit einer rohen 400 abgelehnt
    // hätte. Erwartet: derselbe generische Redirect wie bei jedem anderen Callback-Fehler,
    // KEIN 400.
    let resp = app
        .oneshot(
            Request::builder()
                .uri("/api/auth/oidc/callback?error=access_denied&state=irgendwas")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(resp.status(), StatusCode::SEE_OTHER); // axum::response::Redirect::to = 303
    let location = resp
        .headers()
        .get(header::LOCATION)
        .expect("Location-Header erwartet")
        .to_str()
        .unwrap();
    assert_eq!(location, "/login?fehler=oidc");
}

#[tokio::test]
async fn oidc_callback_mit_falschem_state_cookie_redirect_ohne_session() {
    // Derselbe prozessweite OnceLock wie in den anderen OIDC-Tests (reihenfolge-unabhängig).
    lifeline_hub::auth::provider::registry::set_oidc_konfiguriert(true);
    let app = setup().await;

    // Seedet DIREKT einen echten, gültigen State-Store-Eintrag (bypasst `/oidc/start`, das einen
    // echten IdP für Discovery bräuchte) — das `state`-Query im Callback unten ist damit KEIN
    // unbekannter/abgelaufener Key (anders als in
    // `oidc_callback_mit_unbekanntem_state_redirect_auf_login_fehler`): der State-Store-Lookup
    // allein würde hier also DURCHGEHEN. Diskriminierend prüft dieser Test daher, dass der
    // Binding-Check (LFH-277) trotzdem VORHER abbricht, wenn der `oidc_state`-Cookie fehlt/nicht
    // passt.
    let state_key = "echter-state-aber-falsches-cookie".to_string();
    lifeline_hub::auth::oidc::state::speichere(
        state_key.clone(),
        lifeline_hub::auth::oidc::state::StateEintrag {
            nonce: "n".to_string(),
            pkce_verifier: "v".to_string(),
            ziel_pfad: "/einsaetze".to_string(),
        },
    );

    let resp = app
        .oneshot(
            Request::builder()
                .uri(format!("/api/auth/oidc/callback?code=x&state={state_key}"))
                .header(header::COOKIE, "oidc_state=ein-anderer-wert")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(resp.status(), StatusCode::SEE_OTHER); // axum::response::Redirect::to = 303
    let location = resp
        .headers()
        .get(header::LOCATION)
        .expect("Location-Header erwartet")
        .to_str()
        .unwrap();
    assert_eq!(location, "/login?fehler=oidc");

    // Binding-Cookie wird auch auf diesem Fehlerpfad geräumt — kein Wert, der über den Flow
    // hinaus im Browser überlebt.
    let set_cookie = resp
        .headers()
        .get(header::SET_COOKIE)
        .expect("Set-Cookie (Räumung von oidc_state) erwartet")
        .to_str()
        .unwrap();
    assert!(set_cookie.contains("oidc_state="));
    // Diskriminierend (T3-Regressionsschutz): eine ECHTE Löschung (`jar.remove`) rendert
    // `Max-Age=0` (`cookie`-Crate `make_removal`) — ein bloßes Überschreiben auf leer (`jar.add`)
    // täte das NICHT und würde nur `oidc_state=` ohne `Max-Age=0` senden. Ohne diese Zeile würde
    // dieser Test auch bestehen, wenn `oidc_callback` versehentlich wieder auf `jar.add(...)`
    // zurückfiele (nur überschreiben statt löschen).
    assert!(
        set_cookie.contains("Max-Age=0"),
        "Set-Cookie muss eine echte Löschung sein (Max-Age=0), kein bloßes Leer-Überschreiben: {set_cookie}"
    );
    assert!(
        !set_cookie.contains("lifeline_sid="),
        "keine Session darf bei fehlgeschlagener state-Bindung entstehen"
    );

    // Diskriminierend (sonst würde dieser Test auch bestehen, wenn der Binding-Check GAR NICHT
    // existierte oder invertiert wäre — der seedete Eintrag würde dann in `oidc_client(...)` ohne
    // echten IdP ebenfalls scheitern und denselben Redirect/dieselbe Cookie-Lage produzieren):
    // ein Binding-Fehlschlag bricht VOR `state::entnehme` ab (s. Doc-Kommentar Punkt 3 in
    // `oidc_callback`) — der Store-Eintrag muss also UNVERBRAUCHT überlebt haben. `entnehme`
    // selbst ist einmalig/entfernend, dieser Aufruf hier räumt den Eintrag also gleich mit auf.
    assert!(
        lifeline_hub::auth::oidc::state::entnehme(&state_key).is_some(),
        "Binding-Check muss VOR state::entnehme greifen; der Store-Eintrag darf durch einen \
         Binding-Fehlschlag nicht konsumiert werden (sonst wäre der legitime Opfer-Flow tot)"
    );
}

// ===== TOTP-Enroll (LFH-43, Increment 5, Task 4) =====

fn jetzt_unix() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs()
}

#[tokio::test]
async fn totp_enroll_start_liefert_otpauth_url_und_speichert_secret_inaktiv() {
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;

    let (status, json) = anfrage(&app, "POST", "/api/auth/totp/enroll/start", &admin, None).await;
    assert_eq!(status, StatusCode::OK);

    let otpauth_url = json["otpauth_url"].as_str().expect("otpauth_url erwartet");
    assert!(
        otpauth_url.starts_with("otpauth://totp/"),
        "URL: {otpauth_url}"
    );
    let secret = json["secret_base32"]
        .as_str()
        .expect("secret_base32 erwartet")
        .to_string();
    assert!(!secret.is_empty());

    let (db_secret, db_aktiviert): (Option<String>, i64) = sqlx::query_as(
        "SELECT totp_secret, totp_aktiviert FROM benutzer WHERE benutzername = 'admin'",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(
        db_secret.as_deref(),
        Some(secret.as_str()),
        "DB muss das zurückgegebene Secret gespeichert haben"
    );
    assert_eq!(
        db_aktiviert, 0,
        "Secret ist gespeichert, MFA ist aber noch NICHT aktiv"
    );
}

#[tokio::test]
async fn totp_enroll_finish_mit_gueltigem_code_aktiviert_mfa_und_liefert_10_recovery_codes() {
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;

    let (status, json) = anfrage(&app, "POST", "/api/auth/totp/enroll/start", &admin, None).await;
    assert_eq!(status, StatusCode::OK);
    let secret = json["secret_base32"].as_str().unwrap().to_string();

    let now = jetzt_unix();
    let code = lifeline_hub::auth::totp::generiere_code(&secret, now)
        .expect("Code-Erzeugung aus dem gerade zurückgegebenen Secret darf nicht scheitern");

    let (status, json) = anfrage(
        &app,
        "POST",
        "/api/auth/totp/enroll/finish",
        &admin,
        Some(&format!(r#"{{"code":"{code}"}}"#)),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let recovery_codes = json["recovery_codes"]
        .as_array()
        .expect("recovery_codes erwartet");
    assert_eq!(recovery_codes.len(), 10);

    let benutzer_id: i64 =
        sqlx::query_scalar("SELECT id FROM benutzer WHERE benutzername = 'admin'")
            .fetch_one(&pool)
            .await
            .unwrap();
    let db_aktiviert: i64 = sqlx::query_scalar("SELECT totp_aktiviert FROM benutzer WHERE id = ?")
        .bind(benutzer_id)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(db_aktiviert, 1, "ein gültiger Code muss MFA aktivieren");

    let anzahl: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM totp_recovery_code WHERE benutzer_id = ?")
            .bind(benutzer_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(
        anzahl, 10,
        "für jeden zurückgegebenen Recovery-Code muss genau ein Hash gespeichert sein"
    );
}

#[tokio::test]
async fn totp_enroll_finish_mit_falschem_code_ist_422_und_aktiviert_nicht() {
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;

    let (status, json) = anfrage(&app, "POST", "/api/auth/totp/enroll/start", &admin, None).await;
    assert_eq!(status, StatusCode::OK);
    let secret = json["secret_base32"].as_str().unwrap().to_string();

    // Deterministisch garantiert falsch (statt eines festen "000000", das zufällig der gültige
    // Code sein könnte): `pruefe_code` akzeptiert wegen skew=1 GLEICH DREI Codes (Zeitschritt
    // jetzt-30/jetzt/jetzt+30, s. `auth::totp`-Moduldoc) — alle drei werden berechnet und aus
    // zehn repetitiven Kandidaten ("000000".."999999") der erste gewählt, der zu KEINEM der
    // drei passt (mind. 7 der 10 Kandidaten bleiben immer übrig).
    let now = jetzt_unix();
    let gueltige_codes: std::collections::HashSet<String> = [now - 30, now, now + 30]
        .into_iter()
        .map(|t| lifeline_hub::auth::totp::generiere_code(&secret, t).unwrap())
        .collect();
    let falscher_code = (0..10u32)
        .map(|n| n.to_string().repeat(6))
        .find(|c| !gueltige_codes.contains(c))
        .expect("mind. 7 der 10 repetitiven Kandidaten sind ≠ den 3 gültigen Codes");

    let (status, _) = anfrage(
        &app,
        "POST",
        "/api/auth/totp/enroll/finish",
        &admin,
        Some(&format!(r#"{{"code":"{falscher_code}"}}"#)),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);

    let db_aktiviert: i64 =
        sqlx::query_scalar("SELECT totp_aktiviert FROM benutzer WHERE benutzername = 'admin'")
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(
        db_aktiviert, 0,
        "ein falscher Code darf MFA NICHT aktivieren"
    );
}

#[tokio::test]
async fn totp_enroll_start_ohne_session_ist_401() {
    let app = setup().await;
    let (status, _) = anfrage(&app, "POST", "/api/auth/totp/enroll/start", "", None).await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
}

// ===== Zweistufiger Passwort→TOTP-Login + /totp/finish (LFH-43, Increment 5, Task 5 —
// „der Crux": Pending-State→Session-Gating) =====

/// Aktiviert TOTP für den admin-Nutzer über den bestehenden Enroll-Flow (Task 4, reused statt
/// eines direkten DB-Schreibens — deckt damit zusätzlich ab, dass Enroll und Login
/// zusammenspielen). Liefert (secret_base32, recovery_codes_klartext).
async fn totp_fuer_admin_aktivieren(
    app: &axum::Router,
    admin_cookie: &str,
) -> (String, Vec<String>) {
    let (status, json) = anfrage(
        app,
        "POST",
        "/api/auth/totp/enroll/start",
        admin_cookie,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let secret = json["secret_base32"].as_str().unwrap().to_string();

    let code = lifeline_hub::auth::totp::generiere_code(&secret, jetzt_unix())
        .expect("Code-Erzeugung aus dem gerade zurückgegebenen Secret darf nicht scheitern");
    let (status, json) = anfrage(
        app,
        "POST",
        "/api/auth/totp/enroll/finish",
        admin_cookie,
        Some(&format!(r#"{{"code":"{code}"}}"#)),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let recovery_codes: Vec<String> = json["recovery_codes"]
        .as_array()
        .unwrap()
        .iter()
        .map(|v| v.as_str().unwrap().to_string())
        .collect();
    (secret, recovery_codes)
}

/// Wie die datei-lokale `login()`-Funktion oben, sammelt aber ALLE `Set-Cookie`-Header-Werte
/// statt nur des ersten — für den MFA-Zweig relevant, der genau EIN Cookie (`mfa_pending`, KEIN
/// `lifeline_sid`) setzt; die Anzahl/Namen sind Teil der Assertion.
async fn login_alle_cookies(
    app: &axum::Router,
    benutzername: &str,
    passwort: &str,
) -> (StatusCode, serde_json::Value, Vec<String>) {
    let body = format!(r#"{{"benutzername":"{benutzername}","passwort":"{passwort}"}}"#);
    let resp = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/auth/login")
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(body))
                .unwrap(),
        )
        .await
        .unwrap();
    let status = resp.status();
    let set_cookies: Vec<String> = resp
        .headers()
        .get_all(header::SET_COOKIE)
        .iter()
        .map(|v| v.to_str().unwrap().to_string())
        .collect();
    let bytes = to_bytes(resp.into_body(), usize::MAX).await.unwrap();
    let json: serde_json::Value = serde_json::from_slice(&bytes).unwrap_or(serde_json::Value::Null);
    (status, json, set_cookies)
}

/// Sendet `POST /api/auth/totp/finish` mit optionalem `mfa_pending`-Cookie-Paar (z. B.
/// `"mfa_pending=<key>"`, wie es aus einem `Set-Cookie`-Header extrahiert wird) und liefert
/// (Status, JSON, alle Set-Cookie-Header-Werte der Antwort — `/totp/finish` setzt bei Erfolg
/// ZWEI Header: neues Session-Cookie + entferntes `mfa_pending`-Cookie).
async fn totp_finish(
    app: &axum::Router,
    mfa_pending_cookie_paar: Option<&str>,
    code: &str,
) -> (StatusCode, serde_json::Value, Vec<String>) {
    let mut req = Request::builder()
        .method("POST")
        .uri("/api/auth/totp/finish")
        .header(header::CONTENT_TYPE, "application/json");
    if let Some(paar) = mfa_pending_cookie_paar {
        req = req.header(header::COOKIE, paar.to_string());
    }
    let resp = app
        .clone()
        .oneshot(
            req.body(Body::from(format!(r#"{{"code":"{code}"}}"#)))
                .unwrap(),
        )
        .await
        .unwrap();
    let status = resp.status();
    let set_cookies: Vec<String> = resp
        .headers()
        .get_all(header::SET_COOKIE)
        .iter()
        .map(|v| v.to_str().unwrap().to_string())
        .collect();
    let bytes = to_bytes(resp.into_body(), usize::MAX).await.unwrap();
    let json: serde_json::Value = serde_json::from_slice(&bytes).unwrap_or(serde_json::Value::Null);
    (status, json, set_cookies)
}

#[tokio::test]
async fn login_ohne_totp_liefert_weiterhin_die_nackte_benutzeranzeige() {
    // Neutralitäts-MUST des Plans: `LoginAntwort::Angemeldet` serialisiert (`#[serde(untagged)]`)
    // BYTE-IDENTISCH als die nackte `BenutzerAnzeige` — kein Wrapper-Feld, kein
    // `mfa_erforderlich`. Die bestehenden Login-Tests prüfen nur Status/Cookie, nicht den Body;
    // dieser Test pinnt die Body-Form explizit (ergänzend, kein Ersatz für die bestehenden).
    let app = setup().await;
    let (status, json, cookies) = login_alle_cookies(&app, "admin", "startpw12").await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(json["benutzername"], "admin");
    assert_eq!(json["system_rolle"], "admin");
    assert!(
        json.get("mfa_erforderlich").is_none(),
        "ein Nicht-TOTP-Login darf KEIN mfa_erforderlich-Feld tragen: {json}"
    );
    assert!(cookies.iter().any(|c| c.starts_with("lifeline_sid=")));
}

#[tokio::test]
async fn login_mit_totp_aktiviert_liefert_mfa_ohne_session_und_setzt_pending_cookie() {
    let (app, _pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    totp_fuer_admin_aktivieren(&app, &admin).await;

    let (status, json, cookies) = login_alle_cookies(&app, "admin", "startpw12").await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(json["mfa_erforderlich"], "totp");
    assert!(
        json.get("benutzername").is_none(),
        "MFA-Antwort darf KEIN Benutzer-Objekt tragen: {json}"
    );

    assert_eq!(
        cookies.len(),
        1,
        "erwarte genau ein Set-Cookie (mfa_pending), war: {cookies:?}"
    );
    assert!(
        cookies[0].starts_with("mfa_pending="),
        "erwarte mfa_pending-Cookie, war: {}",
        cookies[0]
    );
    assert!(
        cookies[0].to_lowercase().contains("httponly"),
        "mfa_pending-Cookie muss HttpOnly sein: {}",
        cookies[0]
    );
    assert!(
        !cookies.iter().any(|c| c.starts_with("lifeline_sid=")),
        "ein totp_aktiviert-Nutzer darf durch Passwort ALLEIN keine Session bekommen: {cookies:?}"
    );
}

#[tokio::test]
async fn totp_finish_mit_gueltigem_totp_code_liefert_session() {
    let (app, _pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let (secret, _codes) = totp_fuer_admin_aktivieren(&app, &admin).await;

    let (_, _, login_cookies) = login_alle_cookies(&app, "admin", "startpw12").await;
    let pending_paar = login_cookies[0].split(';').next().unwrap().to_string();

    let code = lifeline_hub::auth::totp::generiere_code(&secret, jetzt_unix()).unwrap();
    let (status, json, cookies) = totp_finish(&app, Some(&pending_paar), &code).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(json["benutzername"], "admin");
    assert!(
        cookies
            .iter()
            .any(|c| c.starts_with("lifeline_sid=") && c.to_lowercase().contains("httponly")),
        "Session-Cookie nach gültigem TOTP-Code erwartet: {cookies:?}"
    );
}

#[tokio::test]
async fn totp_finish_mit_falschem_code_ist_401_ohne_session() {
    let (app, _pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let (secret, _codes) = totp_fuer_admin_aktivieren(&app, &admin).await;

    let (_, _, login_cookies) = login_alle_cookies(&app, "admin", "startpw12").await;
    let pending_paar = login_cookies[0].split(';').next().unwrap().to_string();

    // Deterministisch garantiert falsch (analog dem `totp_enroll_finish`-Test oben): alle drei
    // durch den ±1-Skew gültigen Codes ausschließen.
    let now = jetzt_unix();
    let gueltige_codes: std::collections::HashSet<String> = [now - 30, now, now + 30]
        .into_iter()
        .map(|t| lifeline_hub::auth::totp::generiere_code(&secret, t).unwrap())
        .collect();
    let falscher_code = (0..10u32)
        .map(|n| n.to_string().repeat(6))
        .find(|c| !gueltige_codes.contains(c))
        .expect("mind. 7 der 10 repetitiven Kandidaten sind ≠ den 3 gültigen Codes");

    let (status, _, cookies) = totp_finish(&app, Some(&pending_paar), &falscher_code).await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
    assert!(
        !cookies.iter().any(|c| c.starts_with("lifeline_sid=")),
        "ein falscher Code darf keine Session anlegen: {cookies:?}"
    );
}

#[tokio::test]
async fn totp_finish_ohne_pending_cookie_ist_401() {
    let app = setup().await;
    let (status, _, cookies) = totp_finish(&app, None, "123456").await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
    assert!(!cookies.iter().any(|c| c.starts_with("lifeline_sid=")));
}

#[tokio::test]
async fn totp_finish_mit_recovery_code_liefert_session_und_verbraucht_ihn_einmalig() {
    let (app, _pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let (_secret, recovery_codes) = totp_fuer_admin_aktivieren(&app, &admin).await;
    let recovery_code = recovery_codes[0].clone();

    // Erster Passwort-Schritt → frischer Pending-Key.
    let (_, _, login_cookies_1) = login_alle_cookies(&app, "admin", "startpw12").await;
    let pending_paar_1 = login_cookies_1[0].split(';').next().unwrap().to_string();

    let (status, json, cookies) = totp_finish(&app, Some(&pending_paar_1), &recovery_code).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(json["benutzername"], "admin");
    assert!(
        cookies.iter().any(|c| c.starts_with("lifeline_sid=")),
        "gültiger Recovery-Code muss eine Session anlegen: {cookies:?}"
    );

    // Zweiter Passwort-Schritt → NEUER Pending-Key (Pending-State ist single-use pro Login-
    // Versuch, unabhängig vom Recovery-Code) — derselbe Recovery-Code muss trotzdem als bereits
    // verbraucht gelten (Isoliert die Recovery-Code-Single-use-Eigenschaft von der
    // Pending-Key-Single-use-Eigenschaft).
    let (_, _, login_cookies_2) = login_alle_cookies(&app, "admin", "startpw12").await;
    let pending_paar_2 = login_cookies_2[0].split(';').next().unwrap().to_string();

    let (status2, _, cookies2) = totp_finish(&app, Some(&pending_paar_2), &recovery_code).await;
    assert_eq!(
        status2,
        StatusCode::UNAUTHORIZED,
        "derselbe Recovery-Code darf kein zweites Mal gültig sein (single-use)"
    );
    assert!(!cookies2.iter().any(|c| c.starts_with("lifeline_sid=")));
}

// ===== MFA-Status in `BenutzerAnzeige` (LFH-43, Increment 5, Task 6) =====

#[tokio::test]
async fn me_liefert_totp_aktiviert_false_fuer_frischen_benutzer() {
    let app = setup().await;
    let admin_cookie = login_cookie(&app, "admin", "startpw12").await;

    let (status, json) = anfrage(&app, "GET", "/api/auth/me", &admin_cookie, None).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        json["totp_aktiviert"], false,
        "ein frischer Benutzer hat TOTP noch nicht aktiviert: {json}"
    );
}

#[tokio::test]
async fn me_liefert_totp_aktiviert_true_nach_enroll() {
    let (app, _pool) = setup_mit_pool().await;
    let admin_cookie = login_cookie(&app, "admin", "startpw12").await;
    totp_fuer_admin_aktivieren(&app, &admin_cookie).await;

    let (status, json) = anfrage(&app, "GET", "/api/auth/me", &admin_cookie, None).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        json["totp_aktiviert"], true,
        "nach abgeschlossenem Enrollment muss /me totp_aktiviert=true zeigen: {json}"
    );
}
