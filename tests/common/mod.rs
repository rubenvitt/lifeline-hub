#![allow(dead_code)]

use axum::body::{to_bytes, Body};
use axum::http::{header, Request, StatusCode};
use lifeline_hub::app::{build_router, AppState};
use lifeline_hub::auth::bootstrap::bootstrap_admin;
use lifeline_hub::db;
use lifeline_hub::live::LiveHub;
use serde_json::Value;
use tower::ServiceExt;

pub async fn setup() -> axum::Router {
    setup_mit_pool().await.0
}

/// Wie `setup()`, liefert zusätzlich den (isolierten) Pool zurück — für Tests, die neben dem
/// Router auch direkten DB-Zugriff brauchen (z. B. eine `auth_provider`-Override-Zeile schreiben,
/// siehe `tests/auth.rs`s OIDC-Enforcement-Tests).
pub async fn setup_mit_pool() -> (axum::Router, sqlx::SqlitePool) {
    let (router, pool, _live) = setup_mit_pool_und_live().await;
    (router, pool)
}

/// Wie [`setup_mit_pool`], stellt zusaetzlich den geteilten LiveHub fuer Assertions auf
/// post-commit SSE-Publikationen bereit.
pub async fn setup_mit_pool_und_live() -> (axum::Router, sqlx::SqlitePool, LiveHub) {
    let pool = db::test_pool().await;
    bootstrap_admin(&pool, "Test-Orga", "admin", Some("startpw12"))
        .await
        .unwrap();
    let live = LiveHub::new();
    let router = build_router(AppState {
        pool: pool.clone(),
        live: live.clone(),
        karten_dir: std::env::temp_dir(),
        fachebenen: lifeline_hub::karte::FachebenenState::neu(),
        download_client: lifeline_hub::karte::download::download_client(),
        download_fortschritt: lifeline_hub::karte::download::neue_fortschritt_map(),
        karten_service_url: None,
        karten_service_token: None,
    });
    (router, pool, live)
}

/// Legt eine ZWEITE Organisation samt Benutzer an — die Voraussetzung für jeden
/// Cross-Org-Test (F05/LFH-232).
///
/// `bootstrap_admin` ist bewusst einmalig (es bricht ab, sobald ein Benutzer existiert),
/// deshalb geht die Fremd-Org direkt über SQL. Ohne diesen Helfer ist die Mandanten-Grenze
/// grundsätzlich unbeweisbar: mit nur einer Organisation ist jeder Org-Check trivial erfüllt,
/// und genau deshalb konnten die Lücken so lange unbemerkt bleiben.
///
/// Liefert `(org_id, benutzer_id)`. `org_rolle` ist z. B. `"fuehrungskraft"` oder `"keine"`,
/// `system_rolle` `"keiner"` (ein zweiter `admin` wäre serverweit berechtigt und würde
/// Org-Isolation gerade NICHT testen).
pub async fn fremde_org_anlegen(
    pool: &sqlx::SqlitePool,
    org_name: &str,
    benutzername: &str,
    passwort: &str,
    org_rolle: &str,
) -> (i64, i64) {
    let org_id: i64 = sqlx::query_scalar(
        "INSERT INTO organisation (name, tz_organisation) \
         VALUES (?, 'hilfsorganisation') RETURNING id",
    )
    .bind(org_name)
    .fetch_one(pool)
    .await
    .expect("Fremd-Org anlegen");

    let hash = lifeline_hub::auth::password::hash(passwort).expect("Passwort hashen");
    let benutzer_id: i64 = sqlx::query_scalar(
        "INSERT INTO benutzer (org_id, anzeigename, benutzername, passwort_hash, \
                               system_rolle, org_rolle) \
         VALUES (?, ?, ?, ?, 'keiner', ?) RETURNING id",
    )
    .bind(org_id)
    .bind(benutzername)
    .bind(benutzername)
    .bind(&hash)
    .bind(org_rolle)
    .fetch_one(pool)
    .await
    .expect("Fremd-Org-Benutzer anlegen");

    (org_id, benutzer_id)
}

pub async fn login_cookie(app: &axum::Router, benutzername: &str, passwort: &str) -> String {
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
pub async fn benutzer_anlegen(
    app: &axum::Router,
    admin_cookie: &str,
    name: &str,
    org_rolle: &str,
) -> i64 {
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
    serde_json::from_slice::<Value>(&bytes).unwrap()["id"]
        .as_i64()
        .unwrap()
}

/// Generischer Request-Helfer: liefert (Status, JSON-Body).
pub async fn anfrage(
    app: &axum::Router,
    methode: &str,
    uri: &str,
    cookie: &str,
    body: Option<&str>,
) -> (StatusCode, Value) {
    let mut req = Request::builder()
        .method(methode)
        .uri(uri)
        .header(header::COOKIE, cookie.to_string());
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
    (
        status,
        serde_json::from_slice(&bytes).unwrap_or(Value::Null),
    )
}

/// Wie [`anfrage`], aber mit dem Besitz-Nachweis eines Offline-Queue-Eintrags.
pub async fn anfrage_mit_offline_queue_benutzer(
    app: &axum::Router,
    methode: &str,
    uri: &str,
    cookie: &str,
    body: Option<&str>,
    benutzer_id: i64,
) -> (StatusCode, Value) {
    let mut req = Request::builder()
        .method(methode)
        .uri(uri)
        .header(header::COOKIE, cookie.to_string())
        .header("X-Offline-Queue-Benutzer-Id", benutzer_id.to_string());
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
    (
        status,
        serde_json::from_slice(&bytes).unwrap_or(Value::Null),
    )
}

pub async fn einsatz_anlegen(app: &axum::Router, cookie: &str) -> i64 {
    let (status, json) = anfrage(
        app,
        "POST",
        "/api/einsaetze",
        cookie,
        Some(r#"{"bezeichnung":"Lage"}"#),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    json["id"].as_i64().unwrap()
}

/// Seedet (via GET) und liefert die id der Standardansicht des Einsatzes (LFH-320).
pub async fn standard_ansicht_id(app: &axum::Router, cookie: &str, einsatz: i64) -> i64 {
    let (status, v) = anfrage(
        app,
        "GET",
        &format!("/api/einsaetze/{einsatz}/karten-ansichten"),
        cookie,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "karten-ansichten GET: {v:?}");
    v[0]["id"].as_i64().unwrap()
}

/// Legt eine zweite, benannte Kartenansicht an und liefert ihre id (LFH-320).
pub async fn karten_ansicht_anlegen(
    app: &axum::Router,
    cookie: &str,
    einsatz: i64,
    name: &str,
) -> i64 {
    let (status, v) = anfrage(
        app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/karten-ansichten"),
        cookie,
        Some(&format!(r#"{{"name":"{name}"}}"#)),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "karten-ansicht anlegen: {v:?}");
    v["id"].as_i64().unwrap()
}

/// Weist einem Benutzer eine Einsatz-Rolle zu (durch die Einsatzleitung).
pub async fn rolle_setzen(
    app: &axum::Router,
    leit_cookie: &str,
    einsatz: i64,
    benutzer_id: i64,
    rolle: &str,
) {
    let (status, _) = anfrage(
        app,
        "PUT",
        &format!("/api/einsaetze/{einsatz}/mitglieder/{benutzer_id}"),
        leit_cookie,
        Some(&format!(r#"{{"einsatz_rolle":"{rolle}"}}"#)),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
}

/// Zählt ETB-Einträge mit typ='system'.
pub async fn system_etb_anzahl(app: &axum::Router, cookie: &str, einsatz: i64) -> usize {
    let (_, json) = anfrage(
        app,
        "GET",
        &format!("/api/einsaetze/{einsatz}/etb"),
        cookie,
        None,
    )
    .await;
    json.as_array()
        .unwrap()
        .iter()
        .filter(|e| e["typ"] == "system")
        .count()
}
