use axum::body::{to_bytes, Body};
use axum::http::{header, Request, StatusCode};
use lifeline_hub::app::{build_router, AppState};
use lifeline_hub::auth::bootstrap::bootstrap_admin;
use lifeline_hub::db;
use lifeline_hub::live::LiveHub;
use serde_json::{json, Value};
use tower::ServiceExt;

mod common;
use common::login_cookie;

// ---------- Harness ----------

async fn setup_mit_pool() -> (axum::Router, sqlx::SqlitePool) {
    let pool = db::test_pool().await;
    bootstrap_admin(&pool, "Test-Orga", "admin", Some("startpw12"))
        .await
        .unwrap();
    let router = build_router(AppState {
        pool: pool.clone(),
        live: LiveHub::new(),
        karten_dir: std::env::temp_dir(),
        fachebenen: lifeline_hub::karte::FachebenenState::neu(),
        download_client: lifeline_hub::karte::download::download_client(),
        download_fortschritt: lifeline_hub::karte::download::neue_fortschritt_map(),
        karten_service_url: None,
        karten_service_token: None,
    });
    (router, pool)
}

async fn anfrage(
    app: &axum::Router,
    method: &str,
    uri: &str,
    cookie: &str,
    body: Option<&Value>,
) -> (StatusCode, Value) {
    let mut req = Request::builder()
        .method(method)
        .uri(uri)
        .header(header::COOKIE, cookie);
    let body = match body {
        Some(b) => {
            req = req.header(header::CONTENT_TYPE, "application/json");
            Body::from(b.to_string())
        }
        None => Body::empty(),
    };
    let resp = app.clone().oneshot(req.body(body).unwrap()).await.unwrap();
    let status = resp.status();
    let bytes = to_bytes(resp.into_body(), 1024 * 1024).await.unwrap();
    let value = if bytes.is_empty() {
        Value::Null
    } else {
        serde_json::from_slice(&bytes).unwrap_or(Value::Null)
    };
    (status, value)
}

async fn einsatz_anlegen(app: &axum::Router, cookie: &str) -> i64 {
    let (s, v) = anfrage(
        app,
        "POST",
        "/api/einsaetze",
        cookie,
        Some(&json!({"bezeichnung":"Lage"})),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "einsatz_anlegen: {v:?}");
    v["id"].as_i64().unwrap()
}

async fn einstellungen_setzen(app: &axum::Router, cookie: &str, einsatz: i64, body: &Value) {
    let (s, v) = anfrage(
        app,
        "PUT",
        &format!("/api/einsaetze/{einsatz}/einstellungen"),
        cookie,
        Some(body),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "einstellungen_setzen: {v:?}");
}

// ---------- Tests ----------

/// Existiert für einen Einsatz keine Ansicht, legt der GET-Handler lazy eine
/// Standardansicht an, gespeist aus `einsatz_einstellungen`.
#[tokio::test]
async fn standardansicht_wird_lazy_geseedet_aus_einstellungen() {
    let (app, _pool) = setup_mit_pool().await;
    let cookie = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &cookie).await;

    einstellungen_setzen(
        &app,
        &cookie,
        e,
        &json!({
            "basemap_modus": "offline",
            "fachebenen_sichtbar": {"nina": true, "dwd": false, "pegelonline": false, "kritis": false}
        }),
    )
    .await;

    let (s, v) = anfrage(
        &app,
        "GET",
        &format!("/api/einsaetze/{e}/karten-ansichten"),
        &cookie,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v:?}");
    let ansichten = v.as_array().expect("Liste");
    assert_eq!(ansichten.len(), 1, "genau eine Standardansicht: {v:?}");
    assert_eq!(ansichten[0]["name"], "Standard");
    assert_eq!(ansichten[0]["ist_standard"], true);
    assert_eq!(
        ansichten[0]["basemap_modus"], "offline",
        "basemap aus einstellungen geseedet: {v:?}"
    );
}

/// Zweiter GET seedet nicht neu — genau eine Standardansicht bleibt bestehen.
#[tokio::test]
async fn zweiter_get_seedet_nicht_neu() {
    let (app, _pool) = setup_mit_pool().await;
    let cookie = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &cookie).await;

    let url = format!("/api/einsaetze/{e}/karten-ansichten");
    let (_, v1) = anfrage(&app, "GET", &url, &cookie, None).await;
    let (_, v2) = anfrage(&app, "GET", &url, &cookie, None).await;
    assert_eq!(v1.as_array().unwrap().len(), 1);
    assert_eq!(v2.as_array().unwrap().len(), 1, "kein Doppel-Seed");
    assert_eq!(v1[0]["id"], v2[0]["id"], "dieselbe Ansicht");
}

/// GET auf einen nicht existierenden Einsatz → 404 über den EinsatzKontext-Extractor.
#[tokio::test]
async fn get_nicht_existenter_einsatz_ist_404() {
    let (app, _pool) = setup_mit_pool().await;
    let cookie = login_cookie(&app, "admin", "startpw12").await;
    let (s, _) = anfrage(
        &app,
        "GET",
        "/api/einsaetze/999999/karten-ansichten",
        &cookie,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::NOT_FOUND);
}

/// „Für den Einsatz speichern": PATCH überschreibt die Konfiguration der Standardansicht
/// und der Stand überlebt einen erneuten GET.
#[tokio::test]
async fn patch_ueberschreibt_konfiguration() {
    let (app, _pool) = setup_mit_pool().await;
    let cookie = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &cookie).await;

    let url = format!("/api/einsaetze/{e}/karten-ansichten");
    let (_, v) = anfrage(&app, "GET", &url, &cookie, None).await;
    let aid = v[0]["id"].as_i64().unwrap();

    let (s, v) = anfrage(
        &app,
        "PATCH",
        &format!("{url}/{aid}"),
        &cookie,
        Some(&json!({
            "basemap_modus": "online",
            "karten_theme": "dark",
            "layer_sichtbar": {"melder": true, "zone": false},
            "fachebenen_sichtbar": {"nina": true, "dwd": false, "pegelonline": false, "kritis": false},
            "zoom": 14.5
        })),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v:?}");
    assert_eq!(v["basemap_modus"], "online");
    assert_eq!(v["karten_theme"], "dark");
    assert_eq!(v["zoom"], 14.5);
    assert_eq!(v["layer_sichtbar"]["zone"], false);

    let (_, v2) = anfrage(&app, "GET", &url, &cookie, None).await;
    assert_eq!(v2[0]["basemap_modus"], "online", "Stand persistiert: {v2:?}");
    assert_eq!(v2[0]["karten_theme"], "dark");
    assert_eq!(v2.as_array().unwrap().len(), 1, "kein Neu-Seed durch PATCH");
}

/// Unbekannter `basemap_modus` scheitert am Feld selbst → 400 (LFH-267).
#[tokio::test]
async fn patch_unbekannter_basemap_modus_ist_400() {
    let (app, _pool) = setup_mit_pool().await;
    let cookie = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &cookie).await;
    let url = format!("/api/einsaetze/{e}/karten-ansichten");
    let (_, v) = anfrage(&app, "GET", &url, &cookie, None).await;
    let aid = v[0]["id"].as_i64().unwrap();

    let (s, _) = anfrage(
        &app,
        "PATCH",
        &format!("{url}/{aid}"),
        &cookie,
        Some(&json!({"basemap_modus": "satellit"})),
    )
    .await;
    assert_eq!(s, StatusCode::BAD_REQUEST);
}

/// Unbekanntes `karten_theme` scheitert am Feld selbst → 400 (LFH-267).
#[tokio::test]
async fn patch_unbekanntes_theme_ist_400() {
    let (app, _pool) = setup_mit_pool().await;
    let cookie = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &cookie).await;
    let url = format!("/api/einsaetze/{e}/karten-ansichten");
    let (_, v) = anfrage(&app, "GET", &url, &cookie, None).await;
    let aid = v[0]["id"].as_i64().unwrap();

    let (s, _) = anfrage(
        &app,
        "PATCH",
        &format!("{url}/{aid}"),
        &cookie,
        Some(&json!({"karten_theme": "neon"})),
    )
    .await;
    assert_eq!(s, StatusCode::BAD_REQUEST);
}

/// PATCH auf eine Ansicht, die zu einem ANDEREN Einsatz gehört → 404 (einsatz-skopiert).
#[tokio::test]
async fn patch_fremde_ansicht_ist_404() {
    let (app, _pool) = setup_mit_pool().await;
    let cookie = login_cookie(&app, "admin", "startpw12").await;
    let e1 = einsatz_anlegen(&app, &cookie).await;
    let e2 = einsatz_anlegen(&app, &cookie).await;

    // Ansicht von e2 seeden
    let (_, v2) = anfrage(
        &app,
        "GET",
        &format!("/api/einsaetze/{e2}/karten-ansichten"),
        &cookie,
        None,
    )
    .await;
    let fremde_aid = v2[0]["id"].as_i64().unwrap();

    // …über e1 patchen → 404
    let (s, _) = anfrage(
        &app,
        "PATCH",
        &format!("/api/einsaetze/{e1}/karten-ansichten/{fremde_aid}"),
        &cookie,
        Some(&json!({"basemap_modus": "blind"})),
    )
    .await;
    assert_eq!(s, StatusCode::NOT_FOUND);
}
