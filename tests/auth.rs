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
