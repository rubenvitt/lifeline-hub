use axum::body::{to_bytes, Body};
use axum::http::{header, Request, StatusCode};
use lifeline_hub::app::{build_router, AppState};
use lifeline_hub::auth::bootstrap::bootstrap_admin;
use lifeline_hub::db;
use lifeline_hub::live::LiveHub;
use serde_json::Value;
use tower::ServiceExt;

// ---------- Harness (identisch zu tests/fahrzeug_status.rs) ----------

async fn setup() -> axum::Router {
    let pool = db::test_pool().await;
    bootstrap_admin(&pool, "Test-Orga", "admin", Some("startpw12"))
        .await
        .unwrap();
    build_router(AppState { pool, live: LiveHub::new(), fachebenen: lifeline_hub::karte::FachebenenState::neu() })
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
async fn bootstrap_seedet_einheit_typen() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let (status, json) = anfrage(&app, "GET", "/api/einheit-typen", &admin, None).await;
    assert_eq!(status, StatusCode::OK);
    let labels: Vec<&str> = json.as_array().unwrap().iter().map(|t| t["label"].as_str().unwrap()).collect();
    assert_eq!(labels.len(), 5);
    assert!(labels.contains(&"Zug"));
    // Zug hat Soll 1/3/18; Sonstige hat null.
    let zug = json.as_array().unwrap().iter().find(|t| t["label"] == "Zug").unwrap();
    assert_eq!(zug["soll"]["fuehrer"], 1);
    assert_eq!(zug["soll"]["mannschaft"], 18);
    let sonstige = json.as_array().unwrap().iter().find(|t| t["label"] == "Sonstige").unwrap();
    assert!(sonstige["soll"].is_null());
}

#[tokio::test]
async fn alle_lesen_nur_admin_legt_an() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    benutzer_anlegen(&app, &admin, "erika", "keine").await;
    let erika = login_cookie(&app, "erika", "erikapw1").await;
    assert_eq!(anfrage(&app, "GET", "/api/einheit-typen", &erika, None).await.0, StatusCode::OK);
    assert_eq!(
        anfrage(&app, "POST", "/api/einheit-typen", &erika, Some(r#"{"label":"X"}"#)).await.0,
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        anfrage(&app, "POST", "/api/einheit-typen", &admin,
            Some(r#"{"label":"Verband","soll_fuehrer":3,"soll_unterfuehrer":9,"soll_mannschaft":40,"sortier":60}"#)).await.0,
        StatusCode::CREATED
    );
}

#[tokio::test]
async fn teilweise_soll_ist_400() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let (status, _) = anfrage(&app, "POST", "/api/einheit-typen", &admin,
        Some(r#"{"label":"X","soll_fuehrer":1}"#)).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn dublette_label_ist_409() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    // 'Zug' existiert aus dem Seed.
    assert_eq!(
        anfrage(&app, "POST", "/api/einheit-typen", &admin, Some(r#"{"label":"Zug"}"#)).await.0,
        StatusCode::CONFLICT
    );
}

#[tokio::test]
async fn deaktivieren_entfernt_aus_liste() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let (_, json) = anfrage(&app, "POST", "/api/einheit-typen", &admin, Some(r#"{"label":"Reserve"}"#)).await;
    let id = json["id"].as_i64().unwrap();
    assert_eq!(
        anfrage(&app, "POST", &format!("/api/einheit-typen/{id}/deaktivieren"), &admin, None).await.0,
        StatusCode::NO_CONTENT
    );
    let (_, liste) = anfrage(&app, "GET", "/api/einheit-typen", &admin, None).await;
    let labels: Vec<&str> = liste.as_array().unwrap().iter().map(|t| t["label"].as_str().unwrap()).collect();
    assert!(!labels.contains(&"Reserve"));
}
