//! Integrationstests für GET/PUT /api/org-einstellungen (admin-einstellungen, Task 4).
//!
//! Berechtigungsmatrix:
//!   GET  — admin ✓, fuehrungskraft ✓, nicht eingeloggt → 401
//!   PUT  — admin ✓ (200 + persistiert), fuehrungskraft → 403, ungültig → 400

use axum::body::{to_bytes, Body};
use axum::http::{header, Request, StatusCode};
use lifeline_hub::app::{build_router, AppState};
use lifeline_hub::auth::bootstrap::bootstrap_admin;
use lifeline_hub::db;
use lifeline_hub::live::LiveHub;
use serde_json::Value;
use tower::ServiceExt;

// ----------------------------- Test-Harness -----------------------------

async fn setup() -> axum::Router {
    let pool = db::test_pool().await;
    bootstrap_admin(&pool, "Test-Orga", "admin", Some("startpw12"))
        .await
        .unwrap();
    build_router(AppState {
        pool,
        live: LiveHub::new(),
        fachebenen: lifeline_hub::karte::FachebenenState::neu(),
    })
}

/// Loggt sich ein und liefert das `name=value`-Cookie-Paar.
async fn login_cookie(app: &axum::Router, benutzername: &str, passwort: &str) -> String {
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
    assert_eq!(resp.status(), StatusCode::OK, "Login muss klappen");
    resp.headers()
        .get(header::SET_COOKIE)
        .unwrap()
        .to_str()
        .unwrap()
        .split(';')
        .next()
        .unwrap()
        .to_string()
}

/// Legt über die Admin-Benutzerverwaltung einen neuen Benutzer an.
async fn benutzer_anlegen(
    app: &axum::Router,
    admin_cookie: &str,
    benutzername: &str,
    passwort: &str,
    org_rolle: &str,
) {
    let body = format!(
        r#"{{"anzeigename":"{benutzername}","benutzername":"{benutzername}","passwort":"{passwort}","org_rolle":"{org_rolle}"}}"#
    );
    let resp = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/benutzer")
                .header(header::CONTENT_TYPE, "application/json")
                .header(header::COOKIE, admin_cookie)
                .body(Body::from(body))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::CREATED, "Benutzer anlegen muss klappen");
}

/// GET /api/org-einstellungen mit Cookie; liefert (StatusCode, Body).
async fn get_einstellungen(app: &axum::Router, cookie: Option<&str>) -> (StatusCode, Value) {
    let mut builder = Request::builder()
        .method("GET")
        .uri("/api/org-einstellungen");
    if let Some(c) = cookie {
        builder = builder.header(header::COOKIE, c);
    }
    let resp = app
        .clone()
        .oneshot(builder.body(Body::empty()).unwrap())
        .await
        .unwrap();
    let status = resp.status();
    let bytes = to_bytes(resp.into_body(), usize::MAX).await.unwrap();
    let body = if bytes.is_empty() {
        Value::Null
    } else {
        serde_json::from_slice(&bytes).unwrap_or(Value::Null)
    };
    (status, body)
}

/// PUT /api/org-einstellungen mit Cookie und Body; liefert (StatusCode, Body).
async fn put_einstellungen(
    app: &axum::Router,
    cookie: &str,
    body: serde_json::Value,
) -> (StatusCode, Value) {
    let resp = app
        .clone()
        .oneshot(
            Request::builder()
                .method("PUT")
                .uri("/api/org-einstellungen")
                .header(header::CONTENT_TYPE, "application/json")
                .header(header::COOKIE, cookie)
                .body(Body::from(body.to_string()))
                .unwrap(),
        )
        .await
        .unwrap();
    let status = resp.status();
    let bytes = to_bytes(resp.into_body(), usize::MAX).await.unwrap();
    let body = if bytes.is_empty() {
        Value::Null
    } else {
        serde_json::from_slice(&bytes).unwrap_or(Value::Null)
    };
    (status, body)
}

// ----------------------------- Tests -----------------------------

/// GET als Führungskraft → 200 (darf lesen).
#[tokio::test]
async fn get_als_fuehrungskraft_liefert_200() {
    let app = setup().await;
    let admin_cookie = login_cookie(&app, "admin", "startpw12").await;

    benutzer_anlegen(&app, &admin_cookie, "fk", "fkpw1234", "fuehrungskraft").await;
    let fk_cookie = login_cookie(&app, "fk", "fkpw1234").await;

    let (status, _body) = get_einstellungen(&app, Some(&fk_cookie)).await;
    assert_eq!(status, StatusCode::OK);
}

/// PUT als Führungskraft → 403 (darf nicht schreiben).
#[tokio::test]
async fn put_als_fuehrungskraft_ist_403() {
    let app = setup().await;
    let admin_cookie = login_cookie(&app, "admin", "startpw12").await;

    benutzer_anlegen(&app, &admin_cookie, "fk", "fkpw1234", "fuehrungskraft").await;
    let fk_cookie = login_cookie(&app, "fk", "fkpw1234").await;

    let (status, _body) = put_einstellungen(
        &app,
        &fk_cookie,
        serde_json::json!({"zeitzone": "Europe/Berlin"}),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
}

/// PUT als Admin mit gültigen Daten → 200 und persistiert (Re-GET liefert Werte).
#[tokio::test]
async fn put_als_admin_gueltig_persistiert() {
    let app = setup().await;
    let admin_cookie = login_cookie(&app, "admin", "startpw12").await;

    let body = serde_json::json!({
        "zeitzone": "Europe/Berlin",
        "zeitformat": "24h",
        "einheiten": "metrisch",
        "koordinatenformat": "mgrs",
        "retention_dauer_tage": 365,
        "etb_nummer_praefix": "EB-",
        "meldung_bestaetigung_frist_min": 30,
        "auftrag_quittierung_frist_min": 45,
        "auto_etb_eintraege": false
    });

    let (status, resp_body) = put_einstellungen(&app, &admin_cookie, body).await;
    assert_eq!(status, StatusCode::OK, "PUT muss 200 liefern; body={resp_body}");

    // Persistenz: Re-GET liefert dieselben Werte.
    let (get_status, get_body) = get_einstellungen(&app, Some(&admin_cookie)).await;
    assert_eq!(get_status, StatusCode::OK);
    assert_eq!(get_body["zeitzone"], "Europe/Berlin");
    assert_eq!(get_body["zeitformat"], "24h");
    assert_eq!(get_body["einheiten"], "metrisch");
    assert_eq!(get_body["koordinatenformat"], "mgrs");
    assert_eq!(get_body["retention_dauer_tage"], 365);
    assert_eq!(get_body["etb_nummer_praefix"], "EB-");
    assert_eq!(get_body["meldung_bestaetigung_frist_min"], 30);
    assert_eq!(get_body["auftrag_quittierung_frist_min"], 45);
    assert_eq!(get_body["auto_etb_eintraege"], 0); // false → 0
}

/// PUT als Admin mit `retention_dauer_tage=0` → 400 (0 ist ungültig; 1..=3650).
#[tokio::test]
async fn put_als_admin_ungueltig_retention_null_ist_400() {
    let app = setup().await;
    let admin_cookie = login_cookie(&app, "admin", "startpw12").await;

    let (status, _body) = put_einstellungen(
        &app,
        &admin_cookie,
        serde_json::json!({"retention_dauer_tage": 0}),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
}

/// GET ohne eingeloggten Benutzer → 401.
#[tokio::test]
async fn get_ohne_login_ist_401() {
    let app = setup().await;
    let (status, _body) = get_einstellungen(&app, None).await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
}
