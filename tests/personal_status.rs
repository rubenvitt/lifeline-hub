use axum::body::{to_bytes, Body};
use axum::http::{header, Request, StatusCode};
use lifeline_hub::app::{build_router, AppState};
use lifeline_hub::auth::bootstrap::bootstrap_admin;
use lifeline_hub::db;
use lifeline_hub::live::LiveHub;
use serde_json::Value;
use tower::ServiceExt;

// ---------- Harness (identisch zu tests/stichwort.rs) ----------

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
async fn seed_liefert_sechs_aktive_status() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let (status, json) = anfrage(&app, "GET", "/api/personal-status", &admin, None).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(json.as_array().unwrap().len(), 6);
    assert_eq!(json[0]["label"], "verfügbar");
}

#[tokio::test]
async fn admin_crud_kategorie_validierung_dublette() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    benutzer_anlegen(&app, &admin, "erika", "keine").await;
    let erika = login_cookie(&app, "erika", "erikapw1").await;

    assert_eq!(anfrage(&app, "GET", "/api/personal-status", &erika, None).await.0, StatusCode::OK);
    assert_eq!(anfrage(&app, "POST", "/api/personal-status", &erika, Some(r#"{"label":"X","kategorie":"gebunden"}"#)).await.0, StatusCode::FORBIDDEN);

    // Ungültige Kategorie → 400.
    assert_eq!(anfrage(&app, "POST", "/api/personal-status", &admin, Some(r#"{"label":"X","kategorie":"quatsch"}"#)).await.0, StatusCode::BAD_REQUEST);
    // Anlegen ok.
    assert_eq!(anfrage(&app, "POST", "/api/personal-status", &admin, Some(r#"{"label":"nachalarmiert","kategorie":"gebunden","sortier":70}"#)).await.0, StatusCode::CREATED);
    // Dublette label → Conflict.
    assert_eq!(anfrage(&app, "POST", "/api/personal-status", &admin, Some(r#"{"label":"nachalarmiert","kategorie":"verfuegbar"}"#)).await.0, StatusCode::CONFLICT);
}

#[tokio::test]
async fn patch_aktualisiert_und_unbekannte_id_ist_404() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let (_, json) = anfrage(&app, "POST", "/api/personal-status", &admin, Some(r#"{"label":"nachalarmiert","kategorie":"gebunden","sortier":70}"#)).await;
    let id = json["id"].as_i64().unwrap();
    let (status, json) = anfrage(&app, "PATCH", &format!("/api/personal-status/{id}"), &admin, Some(r##"{"label":"nachgefordert","kategorie":"verfuegbar","farbe":"#00ff00","sortier":75}"##)).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(json["label"], "nachgefordert");
    assert_eq!(json["kategorie"], "verfuegbar");
    // Unbekannte id → 404.
    assert_eq!(anfrage(&app, "PATCH", "/api/personal-status/9999", &admin, Some(r#"{"label":"X","kategorie":"gebunden"}"#)).await.0, StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn deaktivieren_entfernt_aus_liste() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let (_, json) = anfrage(&app, "POST", "/api/personal-status", &admin,
        Some(r#"{"label":"Reserve","kategorie":"verfuegbar"}"#)).await;
    let id = json["id"].as_i64().unwrap();
    assert_eq!(
        anfrage(&app, "POST", &format!("/api/personal-status/{id}/deaktivieren"), &admin, None).await.0,
        StatusCode::NO_CONTENT
    );
    let (_, liste) = anfrage(&app, "GET", "/api/personal-status", &admin, None).await;
    assert!(!liste.as_array().unwrap().iter().any(|s| s["label"] == "Reserve"));
}
