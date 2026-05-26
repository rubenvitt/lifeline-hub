use axum::body::{to_bytes, Body};
use axum::http::{header, Request, StatusCode};
use lifeline_hub::app::{build_router, AppState};
use lifeline_hub::auth::bootstrap::bootstrap_admin;
use lifeline_hub::db;
use lifeline_hub::live::LiveHub;
use serde_json::Value;
use tower::ServiceExt;

// ---------- Harness (identisch zu tests/fahrzeug.rs) ----------

async fn setup() -> axum::Router {
    let pool = db::test_pool().await;
    bootstrap_admin(&pool, "Test-Orga", "admin", Some("startpw12"))
        .await
        .unwrap();
    build_router(AppState { pool, live: LiveHub::new() })
}

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
    assert_eq!(resp.status(), StatusCode::OK);
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

async fn benutzer_anlegen(app: &axum::Router, admin_cookie: &str, name: &str, org_rolle: &str) -> i64 {
    let body = format!(
        r#"{{"anzeigename":"{name}","benutzername":"{name}","passwort":"{name}pw1","org_rolle":"{org_rolle}"}}"#
    );
    let resp = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/benutzer")
                .header(header::CONTENT_TYPE, "application/json")
                .header(header::COOKIE, admin_cookie.to_string())
                .body(Body::from(body))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::CREATED);
    let bytes = to_bytes(resp.into_body(), usize::MAX).await.unwrap();
    serde_json::from_slice::<Value>(&bytes).unwrap()["id"].as_i64().unwrap()
}

/// Generischer Request-Helfer: liefert (Status, JSON-Body).
async fn anfrage(
    app: &axum::Router,
    methode: &str,
    uri: &str,
    cookie: &str,
    body: Option<&str>,
) -> (StatusCode, Value) {
    let mut req = Request::builder().method(methode).uri(uri).header(header::COOKIE, cookie.to_string());
    let body = match body {
        Some(b) => {
            req = req.header(header::CONTENT_TYPE, "application/json");
            Body::from(b.to_string())
        }
        None => Body::empty(),
    };
    let resp = app.clone().oneshot(req.body(body).unwrap()).await.unwrap();
    let status = resp.status();
    let bytes = to_bytes(resp.into_body(), usize::MAX).await.unwrap();
    (status, serde_json::from_slice(&bytes).unwrap_or(Value::Null))
}

// ---------- Tests ----------

#[tokio::test]
async fn bootstrap_seedet_status_katalog() {
    // bootstrap_admin seedet den FMS-Default-Katalog → GET liefert die 10 Stati.
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let (status, json) = anfrage(&app, "GET", "/api/fahrzeug-status", &admin, None).await;
    assert_eq!(status, StatusCode::OK);
    let labels: Vec<&str> = json.as_array().unwrap().iter().map(|s| s["label"].as_str().unwrap()).collect();
    assert!(labels.contains(&"1 – Frei auf Funk"));
    assert!(labels.contains(&"3 – Auf Anfahrt"));
    assert_eq!(json.as_array().unwrap().len(), 10);
}

#[tokio::test]
async fn alle_lesen_admin_legt_an() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    benutzer_anlegen(&app, &admin, "erika", "keine").await;
    let erika = login_cookie(&app, "erika", "erikapw1").await;

    // Nicht-Admin liest (für Dropdowns), darf aber nicht anlegen.
    assert_eq!(anfrage(&app, "GET", "/api/fahrzeug-status", &erika, None).await.0, StatusCode::OK);
    let (status, _) = anfrage(
        &app, "POST", "/api/fahrzeug-status", &erika,
        Some(r#"{"label":"X","kategorie":"gebunden"}"#),
    ).await;
    assert_eq!(status, StatusCode::FORBIDDEN);

    let (status, _) = anfrage(
        &app, "POST", "/api/fahrzeug-status", &admin,
        Some(r#"{"label":"Reserve","kategorie":"verfuegbar","sortier":90}"#),
    ).await;
    assert_eq!(status, StatusCode::CREATED);
}

#[tokio::test]
async fn ungueltige_kategorie_ist_400() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let (status, _) = anfrage(
        &app, "POST", "/api/fahrzeug-status", &admin,
        Some(r#"{"label":"X","kategorie":"unsinn"}"#),
    ).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn fms_anker_ausserhalb_ist_400() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let (status, _) = anfrage(
        &app, "POST", "/api/fahrzeug-status", &admin,
        Some(r#"{"label":"X","kategorie":"gebunden","fms_anker":12}"#),
    ).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn dublette_label_ist_409() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    // '3 – Auf Anfahrt' existiert bereits aus dem Seed.
    let (status, _) = anfrage(
        &app, "POST", "/api/fahrzeug-status", &admin,
        Some(r#"{"label":"3 – Auf Anfahrt","kategorie":"gebunden"}"#),
    ).await;
    assert_eq!(status, StatusCode::CONFLICT);
}

#[tokio::test]
async fn deaktivieren_entfernt_aus_liste() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let (_, json) = anfrage(
        &app, "POST", "/api/fahrzeug-status", &admin,
        Some(r#"{"label":"Reserve","kategorie":"verfuegbar"}"#),
    ).await;
    let id = json["id"].as_i64().unwrap();

    assert_eq!(
        anfrage(&app, "POST", &format!("/api/fahrzeug-status/{id}/deaktivieren"), &admin, None).await.0,
        StatusCode::NO_CONTENT
    );
    let (_, liste) = anfrage(&app, "GET", "/api/fahrzeug-status", &admin, None).await;
    let labels: Vec<&str> = liste.as_array().unwrap().iter().map(|s| s["label"].as_str().unwrap()).collect();
    assert!(!labels.contains(&"Reserve"));
}
