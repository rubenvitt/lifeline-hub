use axum::body::{to_bytes, Body};
use axum::http::{header, Request, StatusCode};
use lifeline_hub::app::{build_router, AppState};
use lifeline_hub::auth::bootstrap::bootstrap_admin;
use lifeline_hub::db;
use lifeline_hub::live::LiveHub;
use serde_json::Value;
use tower::ServiceExt;

// ---------- Harness ----------

async fn setup() -> axum::Router {
    let pool = db::test_pool().await;
    bootstrap_admin(&pool, "Test-Orga", "admin", Some("startpw12"))
        .await
        .unwrap();
    build_router(AppState { pool, live: LiveHub::new(), karten_dir: std::env::temp_dir(), fachebenen: lifeline_hub::karte::FachebenenState::neu(), download_client: lifeline_hub::karte::download::download_client(), download_fortschritt: lifeline_hub::karte::download::neue_fortschritt_map(), karten_service_url: None, karten_service_token: None })
}

async fn setup_mit_pool() -> (axum::Router, sqlx::SqlitePool) {
    let pool = db::test_pool().await;
    bootstrap_admin(&pool, "Test-Orga", "admin", Some("startpw12"))
        .await
        .unwrap();
    let app = build_router(AppState { pool: pool.clone(), live: LiveHub::new(), karten_dir: std::env::temp_dir(), fachebenen: lifeline_hub::karte::FachebenenState::neu(), download_client: lifeline_hub::karte::download::download_client(), download_fortschritt: lifeline_hub::karte::download::neue_fortschritt_map(), karten_service_url: None, karten_service_token: None });
    (app, pool)
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
async fn seed_liefert_fuenf_aktive_bausteine() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let (status, json) = anfrage(&app, "GET", "/api/etb-bausteine", &admin, None).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(json.as_array().unwrap().len(), 5);
    assert_eq!(json[0]["label"], "Lage unverändert");
    assert_eq!(json[0]["typ"], "lage");
}

#[tokio::test]
async fn admin_crud_und_typ_validierung() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    benutzer_anlegen(&app, &admin, "erika", "keine").await;
    let erika = login_cookie(&app, "erika", "erikapw1").await;

    assert_eq!(anfrage(&app, "GET", "/api/etb-bausteine", &erika, None).await.0, StatusCode::OK);
    assert_eq!(
        anfrage(&app, "POST", "/api/etb-bausteine", &erika,
            Some(r#"{"typ":"meldung","label":"X","inhalt":"x"}"#)).await.0,
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        anfrage(&app, "POST", "/api/etb-bausteine", &admin,
            Some(r#"{"typ":"system","label":"S","inhalt":"x"}"#)).await.0,
        StatusCode::BAD_REQUEST
    );
    assert_eq!(
        anfrage(&app, "POST", "/api/etb-bausteine", &admin,
            Some(r#"{"typ":"berichtigung","label":"B","inhalt":"x"}"#)).await.0,
        StatusCode::BAD_REQUEST
    );
    assert_eq!(
        anfrage(&app, "POST", "/api/etb-bausteine", &admin,
            Some(r#"{"typ":"meldung","label":"M","inhalt":"x","meldeweg":"brieftaube"}"#)).await.0,
        StatusCode::BAD_REQUEST
    );
    assert_eq!(
        anfrage(&app, "POST", "/api/etb-bausteine", &admin,
            Some(r#"{"typ":"meldung","label":"   ","inhalt":"x"}"#)).await.0,
        StatusCode::BAD_REQUEST
    );

    let (status, json) = anfrage(&app, "POST", "/api/etb-bausteine", &admin,
        Some(r#"{"typ":"anordnung","label":"Räumung anordnen","inhalt":"Räumung {abschnitt} anordnen.","meldeweg":"funk","sortier":60}"#)).await;
    assert_eq!(status, StatusCode::CREATED);
    assert_eq!(json["label"], "Räumung anordnen");
    assert_eq!(json["meldeweg"], "funk");
    let id = json["id"].as_i64().unwrap();

    let (status, json) = anfrage(&app, "PATCH", &format!("/api/etb-bausteine/{id}"), &admin,
        Some(r#"{"typ":"anordnung","label":"Räumung anordnen","inhalt":"Sofort räumen.","sortier":60}"#)).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(json["inhalt"], "Sofort räumen.");
    assert!(json["meldeweg"].is_null(), "PATCH ohne meldeweg muss das Feld leeren (Full-Replace)");

    assert_eq!(
        anfrage(&app, "PATCH", "/api/etb-bausteine/9999", &admin,
            Some(r#"{"typ":"meldung","label":"Z","inhalt":"z"}"#)).await.0,
        StatusCode::NOT_FOUND
    );
}

#[tokio::test]
async fn label_konflikt_auch_gegen_deaktivierten_ist_409() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;

    let (_, json) = anfrage(&app, "POST", "/api/etb-bausteine", &admin,
        Some(r#"{"typ":"lage","label":"Eigenlabel","inhalt":"a"}"#)).await;
    let id = json["id"].as_i64().unwrap();

    assert_eq!(
        anfrage(&app, "POST", "/api/etb-bausteine", &admin,
            Some(r#"{"typ":"meldung","label":"Eigenlabel","inhalt":"b"}"#)).await.0,
        StatusCode::CONFLICT
    );

    assert_eq!(
        anfrage(&app, "POST", &format!("/api/etb-bausteine/{id}/deaktivieren"), &admin, None).await.0,
        StatusCode::NO_CONTENT
    );
    let (_, liste) = anfrage(&app, "GET", "/api/etb-bausteine", &admin, None).await;
    assert!(!liste.as_array().unwrap().iter().any(|b| b["label"] == "Eigenlabel"));

    assert_eq!(
        anfrage(&app, "POST", "/api/etb-bausteine", &admin,
            Some(r#"{"typ":"meldung","label":"Eigenlabel","inhalt":"c"}"#)).await.0,
        StatusCode::CONFLICT
    );
}

#[tokio::test]
async fn org_isolation_liste_trennt_orgs() {
    use lifeline_hub::etb_baustein::repo::{self, BausteinDaten};
    let (_app, pool) = setup_mit_pool().await;

    let org_a: i64 = sqlx::query_scalar("SELECT id FROM organisation ORDER BY id LIMIT 1")
        .fetch_one(&pool).await.unwrap();
    let org_b: i64 = sqlx::query_scalar(
        "INSERT INTO organisation (name) VALUES ('Org B') RETURNING id")
        .fetch_one(&pool).await.unwrap();

    repo::anlegen(&pool, org_b, BausteinDaten {
        label: "Nur-B", typ: "meldung", inhalt: "b", meldeweg: None, veranlassung: None, sortier: 1,
    }).await.unwrap();

    let liste_a = repo::liste(&pool, org_a).await.unwrap();
    assert!(!liste_a.iter().any(|b| b.label == "Nur-B"));
    let liste_b = repo::liste(&pool, org_b).await.unwrap();
    assert!(liste_b.iter().any(|b| b.label == "Nur-B"));

    let b_id = liste_b.iter().find(|b| b.label == "Nur-B").unwrap().id;
    assert!(matches!(repo::laden(&pool, org_a, b_id).await, Err(lifeline_hub::error::AppError::NotFound)));
}
