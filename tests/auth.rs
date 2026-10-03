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
    login_mit_proto(app, benutzername, passwort, None).await
}

/// Wie [`login`], optional mit `X-Forwarded-Proto` wie hinter einem TLS-Proxy (LFH-603).
async fn login_mit_proto(
    app: &axum::Router,
    benutzername: &str,
    passwort: &str,
    proto: Option<&str>,
) -> (StatusCode, Option<String>) {
    let body = format!(r#"{{"benutzername":"{benutzername}","passwort":"{passwort}"}}"#);
    let mut anfrage = Request::builder()
        .method("POST")
        .uri("/api/auth/login")
        .header(header::CONTENT_TYPE, "application/json");
    if let Some(proto) = proto {
        anfrage = anfrage.header("x-forwarded-proto", proto);
    }
    let resp = app
        .clone()
        .oneshot(anfrage.body(Body::from(body)).unwrap())
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

/// LFH-779: Das Cookie ist persistent und lebt genau so lange wie die Serversitzung (7 Tage).
/// Ohne `Max-Age` verwerfen Webviews (Tauri-Hülle) und Browser es beim Prozessende.
#[tokio::test]
async fn login_cookie_lebt_so_lange_wie_die_serversitzung() {
    let app = setup().await;
    let (status, cookie) = login(&app, "admin", "startpw12").await;
    assert_eq!(status, StatusCode::OK);
    let cookie = cookie.expect("Set-Cookie erwartet");
    assert!(
        cookie.contains("Max-Age=604800"),
        "Max-Age = 7 Tage erwartet: {cookie}"
    );
}

/// LFH-603: Hinter einem TLS-Proxy (Traefik) kommt die Anfrage mit `X-Forwarded-Proto: https`;
/// das Sitzungs-Cookie trägt dann `Secure`, ohne dass jemand einen Schalter setzt. Ein direkter
/// http-Aufruf (LAN, Dev) bekommt es weiter ohne, sonst legte der Browser es nicht ab.
#[tokio::test]
async fn login_cookie_ist_secure_genau_hinter_tls_proxy() {
    let app = setup().await;
    for (proto, secure) in [(Some("https"), true), (Some("http"), false), (None, false)] {
        let (status, cookie) = login_mit_proto(&app, "admin", "startpw12", proto).await;
        assert_eq!(status, StatusCode::OK);
        let cookie = cookie.expect("Set-Cookie erwartet");
        assert_eq!(
            cookie.contains("; Secure"),
            secure,
            "X-Forwarded-Proto {proto:?}: {cookie}"
        );
    }
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
    // Das persistente Cookie (LFH-779) muss der Logout aktiv verfallen lassen.
    let geraeumt = resp
        .headers()
        .get(header::SET_COOKIE)
        .expect("Logout räumt das Cookie")
        .to_str()
        .unwrap()
        .to_string();
    assert!(geraeumt.starts_with("lifeline_sid=;"), "{geraeumt}");
    assert!(geraeumt.contains("Max-Age=0"), "{geraeumt}");
    assert!(geraeumt.contains("Path=/"), "{geraeumt}");

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
    // Enforcement-Seam (LFH-41): direkt in `auth_provider` geschrieben, weil der Aussperr-Guard
    // (`registry::schalten`) "passwort" nicht deaktivieren ließe, solange ein aktiver Admin
    // existiert (409, siehe `admin_kann_passwort_nicht_deaktivieren_409`). "passwort" ist immer in
    // `konfiguriert()` gelistet, die Override-Zeile greift sofort — kein OnceLock im Spiel.
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

/// Router-Ebene: `/api/auth/providers` filtert deaktivierte, `/api/auth/providers/admin` (hinter
/// `AdminUser`) zeigt sie (LFH-277). Aktiviert "oidc" GLOBAL für diesen Testprozess
/// (`OIDC_KONFIGURIERT`-OnceLock); die 404-Tests bleiben über `oidc_deaktiviert_override`
/// reihenfolge-unabhängig.
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

/// Die Anmeldeverfahren-Sektion sagt der Org-Führungskraft eine Nur-Lese-Ansicht zu
/// (`Anmeldeverfahren.tsx`). Lesen folgt deshalb `darf_admin_bereich`, Schalten bleibt
/// Admin-only. Gefunden vom Führungskraft-Durchgang in `e2e/trefflaeche-tablet.spec.ts`
/// (LFH-435): vorher 403, die Seite zeigte „nicht ladbar".
#[tokio::test]
async fn providers_admin_lesen_fuehrungskraft_ja_ohne_rolle_nein_schalten_nur_admin() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    for body in [
        r#"{"anzeigename":"Frieda Führung","benutzername":"frieda","passwort":"friedapw1","org_rolle":"fuehrungskraft"}"#,
        r#"{"anzeigename":"Otto Ohne","benutzername":"otto","passwort":"ottopw123"}"#,
    ] {
        let (status, _) = anfrage(&app, "POST", "/api/benutzer", &admin, Some(body)).await;
        assert_eq!(status, StatusCode::CREATED);
    }
    let frieda = login_cookie(&app, "frieda", "friedapw1").await;
    let otto = login_cookie(&app, "otto", "ottopw123").await;

    let (status, json) = anfrage(&app, "GET", "/api/auth/providers/admin", &frieda, None).await;
    assert_eq!(
        status,
        StatusCode::OK,
        "Führungskraft liest die volle Liste"
    );
    assert!(json
        .as_array()
        .unwrap()
        .iter()
        .any(|p| p["id"] == "passwort"));

    let (status, _) = anfrage(&app, "GET", "/api/auth/providers/admin", &otto, None).await;
    assert_eq!(
        status,
        StatusCode::FORBIDDEN,
        "ohne Org-Rolle kein Admin-Bereich"
    );

    let (status, _) = anfrage(
        &app,
        "PUT",
        "/api/auth/providers/passwort",
        &frieda,
        Some(r#"{"aktiviert":false}"#),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN, "Schalten bleibt Admin-only");
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

/// Schreibt eine Override-Zeile, die "oidc" explizit deaktiviert — unabhängig vom prozessweiten
/// `OIDC_KONFIGURIERT`-OnceLock. Ist er noch `false`, taucht "oidc" in `konfiguriert()` nicht
/// auf und die Zeile wirkt nicht. Hat ein anderer Test ihn schon auf `true` gesetzt (die
/// Reihenfolge der Tests im Prozess ist nicht garantiert), würde "oidc" ohne diese Zeile als
/// aktiviert gelistet und der 404-Check fiele fälschlich durch.
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
    // Reihenfolge-unabhängig über `oidc_deaktiviert_override`. Geprüft wird auch der JSON-Body:
    // er trennt den Enforcement-404 (`{"error": "Nicht gefunden"}`) von einem Routing-404 mit
    // leerem Body (`Value::Null`).
    let (app, pool) = setup_mit_pool().await;
    oidc_deaktiviert_override(&pool).await;
    let (status, json) = anfrage(&app, "GET", "/api/auth/oidc/start", "", None).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    assert_eq!(json["error"], "Nicht gefunden");
}

#[tokio::test]
async fn oidc_callback_ohne_konfigurierten_provider_ist_404() {
    // Dieselbe Enforcement-Prüfung wie `oidc_start`, reihenfolge-unabhängig über
    // `oidc_deaktiviert_override`.
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
    // Aktiviert "oidc" GLOBAL für diesen Testprozess (`OnceLock`, weitere Aufrufe sind No-ops).
    lifeline_hub::auth::provider::registry::set_oidc_konfiguriert(true);
    let app = setup().await;

    // `state=unbekannt` wurde nie angelegt: `entnehme` liefert `None`, BEVOR der Handler das Netz
    // (Token-Tausch/Discovery) anfasst — ohne echten IdP testbar.
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

/// Schreibt eine Override-Zeile, die "webauthn" explizit deaktiviert — unabhängig vom
/// prozessweiten `WEBAUTHN_KONFIGURIERT`-OnceLock (analog `oidc_deaktiviert_override`).
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
    // "webauthn" ist in Tests per Vorgabe nicht konfiguriert; die Override-Zeile hält den Test
    // zusätzlich unabhängig von Tests, die den OnceLock global auf `true` setzen.
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
    // `CurrentUser` wird VOR dem Body-Extractor ausgewertet: der Request scheitert an der fehlenden
    // Session, bevor der Body geparst wird.
    let app = setup().await;
    let (status, _) = anfrage(&app, "POST", "/api/auth/webauthn/register/finish", "", None).await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn webauthn_register_start_mit_provider_liefert_ccr_und_setzt_reg_cookie() {
    // Aktiviert "webauthn" GLOBAL für diesen Testprozess UND hält ein echtes, lokal gebautes
    // `Webauthn` im `WEBAUTHN`-OnceLock. `start_passkey_registration` ist reine
    // Challenge-Erzeugung (kein Netz, kein Authenticator); nur `finish` bräuchte ein echtes Gerät.
    // Damit wird `webauthn_deaktiviert_override` diskriminierend, und die state-key-Cookie-Bindung
    // ist end-to-end geprüft.
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

/// Aktiviert "webauthn" GLOBAL für diesen Testprozess (idempotenter OnceLock) — Helfer für die
/// `auth/start`/`auth/finish`-Tests.
fn webauthn_aktivieren() {
    lifeline_hub::auth::provider::registry::set_webauthn_konfiguriert(true);
    lifeline_hub::auth::webauthn::set_webauthn(
        lifeline_hub::auth::webauthn::baue("localhost", "https://localhost").unwrap(),
    );
}

#[tokio::test]
async fn webauthn_auth_start_deaktiviert_ist_404() {
    // Per Vorgabe bzw. per Override deaktiviert — unabhängig von der Reihenfolge mit
    // `webauthn_aktivieren`-Tests.
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
    // NO-Enumeration diskriminierend: "admin" existiert und ist aktiv, hat aber keinen Passkey —
    // Status UND Fehlertext müssen identisch zum Unbekannt-Fall sein, sonst verrät die Antwort,
    // ob ein Benutzername existiert.
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

/// Ein strukturell valides (kryptografisch bedeutungsloses) `PublicKeyCredential`-JSON, damit
/// der Body-Extractor erfolgreich deserialisiert und der State-Cookie-Check in
/// `webauthn_auth_finish` überhaupt läuft.
///
/// `extensions` fehlt bewusst, statt `null` zu sein: das Feld ist in `webauthn-rs-proto` kein
/// `Option`, sondern `#[serde(default)]` — ein fehlender Schlüssel wird zum Default, ein
/// explizites `null` scheitert ("invalid type: null, expected struct
/// AuthenticationExtensionsClientOutputs").
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

// --- Discoverable / usernameless Passkey-Login (LFH-313) ---

#[tokio::test]
async fn webauthn_discoverable_start_deaktiviert_ist_404() {
    let (app, pool) = setup_mit_pool().await;
    webauthn_deaktiviert_override(&pool).await;

    // Kein Body — der usernameless-Start verlangt keinen Benutzernamen.
    let (status, json) = anfrage(
        &app,
        "POST",
        "/api/auth/webauthn/discoverable/start",
        "",
        None,
    )
    .await;

    assert_eq!(status, StatusCode::NOT_FOUND);
    assert_eq!(json["error"], "Nicht gefunden");
}

#[tokio::test]
async fn webauthn_discoverable_start_liefert_challenge_ohne_benutzername_und_setzt_disc_cookie() {
    // Der Start funktioniert OHNE Benutzernamen (leerer Body) und liefert eine Challenge mit
    // LEERER allowCredentials-Liste (der Client entdeckt den Benutzer selbst) sowie das eigene
    // `webauthn_disc`-State-Cookie.
    webauthn_aktivieren();
    let app = setup().await;

    let resp = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/auth/webauthn/discoverable/start")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(resp.status(), StatusCode::OK);
    let cookie = resp
        .headers()
        .get(header::SET_COOKIE)
        .expect("Set-Cookie (webauthn_disc) erwartet")
        .to_str()
        .unwrap()
        .to_string();
    assert!(
        cookie.contains("webauthn_disc="),
        "eigenes discoverable-State-Cookie erwartet (nicht webauthn_auth)"
    );
    assert!(cookie.to_lowercase().contains("httponly"));
    assert!(cookie.contains("/api/auth/webauthn"));

    let bytes = to_bytes(resp.into_body(), usize::MAX).await.unwrap();
    let json: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
    assert!(
        json["publicKey"].get("challenge").is_some(),
        "Response muss die RequestChallengeResponse (publicKey.challenge) enthalten"
    );
    // Discoverable ⇒ keine vorgegebenen Credentials (usernameless). Feld darf fehlen oder leer sein.
    if let Some(allow) = json["publicKey"].get("allowCredentials") {
        assert!(
            allow.as_array().map(|a| a.is_empty()).unwrap_or(true),
            "allowCredentials muss beim discoverable-Login leer sein, war: {allow}"
        );
    }
}

#[tokio::test]
async fn webauthn_discoverable_finish_deaktiviert_ist_404() {
    let (app, pool) = setup_mit_pool().await;
    webauthn_deaktiviert_override(&pool).await;

    let (status, json) = anfrage(
        &app,
        "POST",
        "/api/auth/webauthn/discoverable/finish",
        "",
        Some(FINISH_BODY_PLATZHALTER),
    )
    .await;

    assert_eq!(status, StatusCode::NOT_FOUND);
    assert_eq!(json["error"], "Nicht gefunden");
}

#[tokio::test]
async fn webauthn_discoverable_finish_ohne_state_cookie_ist_generischer_fehler() {
    webauthn_aktivieren();
    let app = setup().await;

    let (status, json) = anfrage(
        &app,
        "POST",
        "/api/auth/webauthn/discoverable/finish",
        "",
        Some(FINISH_BODY_PLATZHALTER),
    )
    .await;

    assert_eq!(status, StatusCode::UNAUTHORIZED);
    assert_eq!(json["error"], "Nicht angemeldet");
}

#[tokio::test]
async fn webauthn_discoverable_finish_mit_unbekanntem_state_cookie_ist_generischer_fehler() {
    webauthn_aktivieren();
    let app = setup().await;

    let (status, json) = anfrage(
        &app,
        "POST",
        "/api/auth/webauthn/discoverable/finish",
        "webauthn_disc=nie-gespeichert",
        Some(FINISH_BODY_PLATZHALTER),
    )
    .await;

    assert_eq!(status, StatusCode::UNAUTHORIZED);
    assert_eq!(json["error"], "Nicht angemeldet");
}

#[tokio::test]
async fn webauthn_disc_state_cookie_passt_nicht_in_regulaeren_auth_finish() {
    // Variantentrennung: ein per discoverable/start erzeugter State-Key darf NICHT im
    // benutzergebundenen auth/finish akzeptiert werden (entnehme matcht die Variante disjunkt).
    // Beweist, dass die beiden Flows nicht über einen verwechselten State-Key kreuzbar sind.
    webauthn_aktivieren();
    let app = setup().await;

    // 1. discoverable/start → liefert ein webauthn_disc-Cookie mit gültigem State-Key.
    let start = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/auth/webauthn/discoverable/start")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(start.status(), StatusCode::OK);
    let disc_cookie = start
        .headers()
        .get(header::SET_COOKIE)
        .expect("webauthn_disc-Cookie erwartet")
        .to_str()
        .unwrap();
    let key_paar = disc_cookie.split(';').next().unwrap(); // "webauthn_disc=<key>"
    let key_wert = key_paar.split('=').nth(1).unwrap().to_string();

    // 2. Denselben Key-Wert unter dem auth-Cookie-Namen in den REGULÄREN auth/finish geben.
    let (status, json) = anfrage(
        &app,
        "POST",
        "/api/auth/webauthn/auth/finish",
        &format!("webauthn_auth={key_wert}"),
        Some(FINISH_BODY_PLATZHALTER),
    )
    .await;

    // Die Ceremony ist eine Discoverable-, keine Authentifizierung-Variante → generischer 401.
    assert_eq!(status, StatusCode::UNAUTHORIZED);
    assert_eq!(json["error"], "Nicht angemeldet");
}

#[tokio::test]
async fn oidc_callback_mit_idp_error_redirect_ohne_400() {
    // Derselbe prozessweite OnceLock wie in den anderen OIDC-Tests; erneutes Setzen ist ein No-op.
    lifeline_hub::auth::provider::registry::set_oidc_konfiguriert(true);
    let app = setup().await;

    // IdP-Error-Callback (z. B. abgelehnte Zustimmung): `?error=access_denied&state=...` ohne
    // `code` ist ein spec-konformer Ablauf (RFC 6749 4.1.2.1). Erwartet: derselbe generische
    // Redirect wie bei jedem anderen Callback-Fehler, kein 400 aus dem Query-Extractor.
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

    // Seedet direkt einen gültigen State-Store-Eintrag (ohne `/oidc/start`, das einen IdP
    // bräuchte): der Store-Lookup allein ginge hier also durch. Geprüft wird, dass der
    // Binding-Check (LFH-277) VORHER abbricht, wenn der `oidc_state`-Cookie fehlt oder nicht
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
    // Eine echte Löschung (`jar.remove`) rendert `Max-Age=0`; ein bloßes Überschreiben auf leer
    // (`jar.add`) sendete nur `oidc_state=` und fiele hier auf.
    assert!(
        set_cookie.contains("Max-Age=0"),
        "Set-Cookie muss eine echte Löschung sein (Max-Age=0), kein bloßes Leer-Überschreiben: {set_cookie}"
    );
    assert!(
        !set_cookie.contains("lifeline_sid="),
        "keine Session darf bei fehlgeschlagener state-Bindung entstehen"
    );

    // Diskriminierend: ohne Binding-Check scheiterte der Eintrag ebenfalls (in `oidc_client` ohne
    // IdP) mit demselben Redirect. Ein Binding-Fehlschlag bricht aber VOR `state::entnehme` ab —
    // der Eintrag muss unverbraucht überlebt haben. `entnehme` entfernt ihn dabei gleich.
    assert!(
        lifeline_hub::auth::oidc::state::entnehme(&state_key).is_some(),
        "Binding-Check muss VOR state::entnehme greifen; der Store-Eintrag darf durch einen \
         Binding-Fehlschlag nicht konsumiert werden (sonst wäre der legitime Opfer-Flow tot)"
    );
}

// ===== TOTP-Enroll (LFH-43) =====

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

    // Garantiert falscher Code: `pruefe_code` akzeptiert wegen skew=1 drei Codes (jetzt−30, jetzt,
    // jetzt+30). Aus zehn Kandidaten ("000000".."999999") wird der erste gewählt, der zu keinem
    // passt.
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

// ===== Zweistufiger Passwort→TOTP-Login + /totp/finish (LFH-43): Pending-State→Session =====

/// Aktiviert TOTP für den admin über den regulären Enroll-Flow (statt direkt in die DB) — deckt
/// damit zusätzlich ab, dass Enroll und Login zusammenspielen. Liefert (secret_base32,
/// recovery_codes_klartext).
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
    // `LoginAntwort::Angemeldet` serialisiert (`#[serde(untagged)]`) byte-identisch als nackte
    // `BenutzerAnzeige` — kein Wrapper-Feld, kein `mfa_erforderlich`. Dieser Test pinnt die
    // Body-Form.
    let app = setup().await;
    let (status, json, cookies) = login_alle_cookies(&app, "admin", "startpw12").await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(json["benutzername"], "admin");
    assert_eq!(json["system_rolle"], "admin");
    // Auch der Login-Weg trägt das Feld (LFH-828), der `AuthContext` übernimmt diese Antwort.
    assert_eq!(json["passwort_gesetzt"], true, "{json}");
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

    // Garantiert falscher Code: alle drei durch den ±1-Skew gültigen Codes ausschließen.
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

    // Zweiter Passwort-Schritt → NEUER Pending-Key; derselbe Recovery-Code muss trotzdem als
    // verbraucht gelten. Trennt die Single-use-Eigenschaft des Recovery-Codes von der des
    // Pending-Keys.
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

// ===== MFA-Status in `BenutzerAnzeige` (LFH-43) =====

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

// ===== Lokales Passwort in `BenutzerAnzeige` (LFH-828) =====

#[tokio::test]
async fn me_liefert_passwort_gesetzt_true_fuer_konto_mit_passwort() {
    let app = setup().await;
    let admin_cookie = login_cookie(&app, "admin", "startpw12").await;

    let (status, json) = anfrage(&app, "GET", "/api/auth/me", &admin_cookie, None).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        json["passwort_gesetzt"], true,
        "ein Konto mit lokalem Passwort: {json}"
    );
}

/// Ein SSO-only-Konto (Sentinel-Hash) bekommt `false`, und weder Hash noch Sentinel stehen in
/// der Antwort.
#[tokio::test]
async fn me_liefert_passwort_gesetzt_false_fuer_sso_only_konto() {
    let (app, pool) = setup_mit_pool().await;
    let admin_cookie = login_cookie(&app, "admin", "startpw12").await;
    sqlx::query("UPDATE benutzer SET passwort_hash = ? WHERE benutzername = 'admin'")
        .bind(lifeline_hub::auth::PASSWORT_HASH_SSO_ONLY)
        .execute(&pool)
        .await
        .unwrap();

    let (status, json) = anfrage(&app, "GET", "/api/auth/me", &admin_cookie, None).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(json["passwort_gesetzt"], false, "SSO-only-Konto: {json}");
    assert!(
        json.get("passwort_hash").is_none(),
        "Hash ausgeliefert: {json}"
    );
    assert!(
        !json
            .to_string()
            .contains(lifeline_hub::auth::PASSWORT_HASH_SSO_ONLY),
        "Sentinel ausgeliefert: {json}"
    );
}

// ===== Login-Sperre je Konto (LFH-793) =====

/// POST `/api/auth/login` mit fester Gegenstelle, damit die prozessweite Sperre nur diesen Test
/// trifft.
async fn login_von(
    app: &axum::Router,
    gegenstelle: &str,
    benutzername: &str,
    passwort: &str,
) -> StatusCode {
    let body = serde_json::json!({ "benutzername": benutzername, "passwort": passwort });
    let mut req = Request::builder()
        .method("POST")
        .uri("/api/auth/login")
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(body.to_string()))
        .unwrap();
    let peer: std::net::SocketAddr = gegenstelle.parse().unwrap();
    req.extensions_mut()
        .insert(axum::extract::ConnectInfo(peer));
    app.clone().oneshot(req).await.unwrap().status()
}

/// Ein Innentäter darf die Sperre nicht mit dem eigenen Konto zurücksetzen: der Erfolg räumt nur
/// die Fehlversuche gegen das Konto, das sich eben angemeldet hat.
#[tokio::test]
async fn eigener_login_hebt_die_sperre_fuer_fremde_konten_nicht_auf() {
    let app = setup().await;
    let quelle = "203.0.113.93:40000";

    for i in 0..9 {
        let s = login_von(&app, quelle, "opfer", "geraten").await;
        assert_eq!(s, StatusCode::UNAUTHORIZED, "Fremdversuch {i}");
    }
    assert_eq!(
        login_von(&app, quelle, "admin", "startpw12").await,
        StatusCode::OK,
        "unter der Schwelle meldet sich das eigene Konto an"
    );
    assert_eq!(
        login_von(&app, quelle, "opfer", "geraten").await,
        StatusCode::UNAUTHORIZED,
        "der zehnte Fremdversuch läuft noch"
    );
    assert_eq!(
        login_von(&app, quelle, "opfer", "geraten").await,
        StatusCode::TOO_MANY_REQUESTS,
        "die Fremdversuche vor dem eigenen Login zählen weiter"
    );
}

/// Wer sich am eigenen Konto vertippt und dann anmeldet, nimmt seine Fehlversuche mit: die
/// Quelle (etwa eine Wache hinter NAT) wird dadurch nicht schneller gesperrt.
#[tokio::test]
async fn eigener_login_raeumt_die_eigenen_fehlversuche() {
    let app = setup().await;
    let quelle = "203.0.113.94:40000";

    for _ in 0..9 {
        login_von(&app, quelle, "admin", "vertippt").await;
    }
    assert_eq!(
        login_von(&app, quelle, "admin", "startpw12").await,
        StatusCode::OK
    );
    for i in 0..9 {
        let s = login_von(&app, quelle, "admin", "vertippt").await;
        assert_eq!(s, StatusCode::UNAUTHORIZED, "Versuch {i} nach dem Erfolg");
    }
}
