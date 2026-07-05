use axum::body::{to_bytes, Body};
use axum::http::{header, Request, StatusCode};
use lifeline_hub::app::{build_router, AppState};
use lifeline_hub::auth::bootstrap::bootstrap_admin;
use lifeline_hub::db;
use lifeline_hub::live::LiveHub;
use serde_json::Value;
use tower::ServiceExt;

async fn setup() -> axum::Router {
    let pool = db::test_pool().await;
    bootstrap_admin(&pool, "Test-Orga", "admin", Some("startpw12"))
        .await
        .unwrap();
    build_router(AppState {
        pool,
        live: LiveHub::new(),
        karten_dir: std::env::temp_dir(), fachebenen: lifeline_hub::karte::FachebenenState::neu(), download_client: lifeline_hub::karte::download::download_client(), download_fortschritt: lifeline_hub::karte::download::neue_fortschritt_map(),
        karten_service_url: None,
        karten_service_token: None,
    })
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

/// Admin legt einen Nicht-Admin-Benutzer an; gibt dessen id zurück.
async fn benutzer_anlegen(app: &axum::Router, admin_cookie: &str, name: &str) -> i64 {
    let body = format!(
        r#"{{"anzeigename":"{name}","benutzername":"{name}","passwort":"{name}pw1","org_rolle":"keine"}}"#
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
    let json: Value = serde_json::from_slice(&bytes).unwrap();
    json["id"].as_i64().unwrap()
}

async fn post_vorschlag(app: &axum::Router, cookie: &str, text: &str) -> StatusCode {
    let body = format!(r#"{{"text":"{text}"}}"#);
    app.clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/stichwort-vorschlaege")
                .header(header::CONTENT_TYPE, "application/json")
                .header(header::COOKIE, cookie.to_string())
                .body(Body::from(body))
                .unwrap(),
        )
        .await
        .unwrap()
        .status()
}

async fn liste_vorschlaege(app: &axum::Router, cookie: &str) -> (StatusCode, Value) {
    let resp = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/api/stichwort-vorschlaege")
                .header(header::COOKIE, cookie.to_string())
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    let status = resp.status();
    let bytes = to_bytes(resp.into_body(), usize::MAX).await.unwrap();
    (status, serde_json::from_slice(&bytes).unwrap_or(Value::Null))
}

#[tokio::test]
async fn admin_legt_vorschlag_an_und_alle_sehen_ihn() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    benutzer_anlegen(&app, &admin, "erika").await;

    assert_eq!(post_vorschlag(&app, &admin, "Probealarm").await, StatusCode::CREATED);

    let erika = login_cookie(&app, "erika", "erikapw1").await;
    let (status, json) = liste_vorschlaege(&app, &erika).await;
    assert_eq!(status, StatusCode::OK);
    let texte: Vec<&str> = json
        .as_array()
        .unwrap()
        .iter()
        .map(|v| v["text"].as_str().unwrap())
        .collect();
    assert!(texte.contains(&"Probealarm"));
}

#[tokio::test]
async fn nicht_admin_darf_keinen_vorschlag_anlegen() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    benutzer_anlegen(&app, &admin, "erika").await;
    let erika = login_cookie(&app, "erika", "erikapw1").await;

    assert_eq!(post_vorschlag(&app, &erika, "Verboten").await, StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn duplikat_vorschlag_ist_409() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    assert_eq!(post_vorschlag(&app, &admin, "Doppelt").await, StatusCode::CREATED);
    assert_eq!(post_vorschlag(&app, &admin, "Doppelt").await, StatusCode::CONFLICT);
}

#[tokio::test]
async fn admin_loescht_vorschlag() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    assert_eq!(post_vorschlag(&app, &admin, "Weg").await, StatusCode::CREATED);

    let (_, json) = liste_vorschlaege(&app, &admin).await;
    let id = json
        .as_array()
        .unwrap()
        .iter()
        .find(|v| v["text"] == "Weg")
        .unwrap()["id"]
        .as_i64()
        .unwrap();

    let resp = app
        .clone()
        .oneshot(
            Request::builder()
                .method("DELETE")
                .uri(format!("/api/stichwort-vorschlaege/{id}"))
                .header(header::COOKIE, admin.clone())
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::NO_CONTENT);

    let (_, json) = liste_vorschlaege(&app, &admin).await;
    let texte: Vec<&str> = json
        .as_array()
        .unwrap()
        .iter()
        .map(|v| v["text"].as_str().unwrap())
        .collect();
    assert!(!texte.contains(&"Weg"));
}
