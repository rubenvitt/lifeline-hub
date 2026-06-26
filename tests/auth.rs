use axum::body::{to_bytes, Body};
use axum::http::{header, Request, StatusCode};
use lifeline_hub::app::{build_router, AppState};
use lifeline_hub::auth::bootstrap::bootstrap_admin;
use lifeline_hub::db;
use lifeline_hub::live::LiveHub;
use tower::ServiceExt; // stellt `oneshot` bereit

/// Baut Router + DB mit einem Bootstrap-Admin (admin / startpw12).
async fn setup() -> axum::Router {
    let pool = db::test_pool().await;
    bootstrap_admin(&pool, "Test-Orga", "admin", Some("startpw12"))
        .await
        .unwrap();
    build_router(AppState {
        pool,
        live: LiveHub::new(),
        karten_dir: std::env::temp_dir(), fachebenen: lifeline_hub::karte::FachebenenState::neu(), download_client: lifeline_hub::karte::download::download_client(), download_fortschritt: lifeline_hub::karte::download::neue_fortschritt_map(),
    })
}

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
