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
    build_router(AppState { pool, live: LiveHub::new(), karten_dir: std::env::temp_dir(), fachebenen: lifeline_hub::karte::FachebenenState::neu(), download_client: lifeline_hub::karte::download::download_client(), download_fortschritt: lifeline_hub::karte::download::neue_fortschritt_map(), karten_service_url: None, karten_service_token: None })
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
async fn seed_liefert_neun_aktive_qualifikationen() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let (status, json) = anfrage(&app, "GET", "/api/qualifikationen", &admin, None).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(json.as_array().unwrap().len(), 9, "Bootstrap-Seed");
    assert_eq!(json[0]["label"], "Sanitäter");
}

#[tokio::test]
async fn admin_crud_nicht_admin_nur_lesen() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    benutzer_anlegen(&app, &admin, "erika", "keine").await;
    let erika = login_cookie(&app, "erika", "erikapw1").await;

    // Lesen für alle.
    assert_eq!(anfrage(&app, "GET", "/api/qualifikationen", &erika, None).await.0, StatusCode::OK);
    // Anlegen nur Admin.
    assert_eq!(anfrage(&app, "POST", "/api/qualifikationen", &erika, Some(r#"{"label":"Hund"}"#)).await.0, StatusCode::FORBIDDEN);
    let (status, json) = anfrage(&app, "POST", "/api/qualifikationen", &admin, Some(r#"{"label":"Drohnenpilot","sortier":100}"#)).await;
    assert_eq!(status, StatusCode::CREATED);
    let id = json["id"].as_i64().unwrap();

    // Dublette → Conflict.
    assert_eq!(anfrage(&app, "POST", "/api/qualifikationen", &admin, Some(r#"{"label":"Drohnenpilot"}"#)).await.0, StatusCode::CONFLICT);

    // Deaktivieren → verschwindet aus der Liste.
    assert_eq!(anfrage(&app, "POST", &format!("/api/qualifikationen/{id}/deaktivieren"), &admin, None).await.0, StatusCode::NO_CONTENT);
    let (_, json) = anfrage(&app, "GET", "/api/qualifikationen", &admin, None).await;
    assert!(json.as_array().unwrap().iter().all(|q| q["id"].as_i64() != Some(id)));
}

#[tokio::test]
async fn patch_aktualisiert_label_und_unbekannte_id_ist_404() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    // Eine neue Qualifikation anlegen und umbenennen.
    let (_, json) = anfrage(&app, "POST", "/api/qualifikationen", &admin, Some(r#"{"label":"Drohnenpilot","sortier":100}"#)).await;
    let id = json["id"].as_i64().unwrap();
    let (status, json) = anfrage(&app, "PATCH", &format!("/api/qualifikationen/{id}"), &admin, Some(r#"{"label":"Drohnenführer","sortier":105}"#)).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(json["label"], "Drohnenführer");
    assert_eq!(json["sortier"], 105);
    // Unbekannte id → 404.
    assert_eq!(anfrage(&app, "PATCH", "/api/qualifikationen/9999", &admin, Some(r#"{"label":"X"}"#)).await.0, StatusCode::NOT_FOUND);
}
