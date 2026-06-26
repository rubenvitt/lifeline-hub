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
    build_router(AppState { pool, live: LiveHub::new(), karten_dir: std::env::temp_dir(), fachebenen: lifeline_hub::karte::FachebenenState::neu(), download_client: lifeline_hub::karte::download::download_client(), download_fortschritt: lifeline_hub::karte::download::neue_fortschritt_map() })
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
async fn admin_legt_person_an_alle_lesen_sie() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    benutzer_anlegen(&app, &admin, "erika", "keine").await;

    let (status, json) = anfrage(
        &app, "POST", "/api/personal", &admin,
        Some(r#"{"name":"Thomas Müller","staerke_position":"fuehrer"}"#),
    ).await;
    assert_eq!(status, StatusCode::CREATED);
    assert_eq!(json["name"], "Thomas Müller");
    assert_eq!(json["staerke_position"], "fuehrer");
    assert_eq!(json["qualifikationen"].as_array().unwrap().len(), 0);

    let erika = login_cookie(&app, "erika", "erikapw1").await;
    let (status, json) = anfrage(&app, "GET", "/api/personal", &erika, None).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(json.as_array().unwrap().len(), 1);
}

#[tokio::test]
async fn nicht_admin_darf_nicht_anlegen() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    benutzer_anlegen(&app, &admin, "erika", "keine").await;
    let erika = login_cookie(&app, "erika", "erikapw1").await;
    let (status, _) = anfrage(&app, "POST", "/api/personal", &erika, Some(r#"{"name":"Verboten"}"#)).await;
    assert_eq!(status, StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn dublette_personalnummer_ist_409_namen_erlaubt() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    // Gleicher Name ohne Nummer → erlaubt.
    assert_eq!(anfrage(&app, "POST", "/api/personal", &admin, Some(r#"{"name":"Thomas Müller"}"#)).await.0, StatusCode::CREATED);
    assert_eq!(anfrage(&app, "POST", "/api/personal", &admin, Some(r#"{"name":"Thomas Müller"}"#)).await.0, StatusCode::CREATED);
    // Gleiche Nummer → Conflict.
    let mit_nr = r#"{"name":"A","personalnummer":"4711"}"#;
    assert_eq!(anfrage(&app, "POST", "/api/personal", &admin, Some(mit_nr)).await.0, StatusCode::CREATED);
    assert_eq!(anfrage(&app, "POST", "/api/personal", &admin, Some(r#"{"name":"B","personalnummer":"4711"}"#)).await.0, StatusCode::CONFLICT);
}

#[tokio::test]
async fn ungueltige_staerke_position_ist_400() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let (status, _) = anfrage(&app, "POST", "/api/personal", &admin, Some(r#"{"name":"X","staerke_position":"chef"}"#)).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn ausser_dienst_versteckt_aus_nur_im_dienst() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let (_, json) = anfrage(&app, "POST", "/api/personal", &admin, Some(r#"{"name":"Thomas"}"#)).await;
    let id = json["id"].as_i64().unwrap();
    assert_eq!(anfrage(&app, "POST", &format!("/api/personal/{id}/ausser-dienst"), &admin, None).await.0, StatusCode::OK);
    let (_, im_dienst) = anfrage(&app, "GET", "/api/personal?nur_im_dienst=true", &admin, None).await;
    assert!(im_dienst.as_array().unwrap().is_empty());
    let (_, alle) = anfrage(&app, "GET", "/api/personal", &admin, None).await;
    assert_eq!(alle.as_array().unwrap().len(), 1);
}

#[tokio::test]
async fn qualifikationen_werden_zugeordnet_und_aufgeloest() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    // Aus dem Bootstrap-Seed zwei Qualifikations-IDs holen.
    let (_, quals) = anfrage(&app, "GET", "/api/qualifikationen", &admin, None).await;
    let ids: Vec<i64> = quals.as_array().unwrap().iter().take(2).map(|q| q["id"].as_i64().unwrap()).collect();
    let body = format!(r#"{{"name":"Thomas","qualifikation_ids":[{},{}]}}"#, ids[0], ids[1]);
    let (status, json) = anfrage(&app, "POST", "/api/personal", &admin, Some(&body)).await;
    assert_eq!(status, StatusCode::CREATED);
    assert_eq!(json["qualifikationen"].as_array().unwrap().len(), 2);
}

#[tokio::test]
async fn patch_unbekannte_id_ist_404() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let (status, _) = anfrage(&app, "PATCH", "/api/personal/9999", &admin, Some(r#"{"name":"X"}"#)).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn in_dienst_auf_vergebene_personalnummer_ist_409() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    // A mit Nummer 7, dann außer Dienst.
    let (_, a) = anfrage(&app, "POST", "/api/personal", &admin, Some(r#"{"name":"Alt","personalnummer":"7"}"#)).await;
    let id = a["id"].as_i64().unwrap();
    assert_eq!(anfrage(&app, "POST", &format!("/api/personal/{id}/ausser-dienst"), &admin, None).await.0, StatusCode::OK);
    // Nummer 7 neu vergeben.
    assert_eq!(anfrage(&app, "POST", "/api/personal", &admin, Some(r#"{"name":"Neu","personalnummer":"7"}"#)).await.0, StatusCode::CREATED);
    // Reaktivieren von A kollidiert → 409.
    assert_eq!(anfrage(&app, "POST", &format!("/api/personal/{id}/in-dienst"), &admin, None).await.0, StatusCode::CONFLICT);
}

#[tokio::test]
async fn kein_delete_endpunkt() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let (_, json) = anfrage(&app, "POST", "/api/personal", &admin, Some(r#"{"name":"Thomas"}"#)).await;
    let id = json["id"].as_i64().unwrap();
    let (status, _) = anfrage(&app, "DELETE", &format!("/api/personal/{id}"), &admin, None).await;
    assert_eq!(status, StatusCode::METHOD_NOT_ALLOWED);
}
