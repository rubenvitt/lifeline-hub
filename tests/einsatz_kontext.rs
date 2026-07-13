//! End-to-end-Contract des `EinsatzKontext`-Extractors (LFH-121) über eine MIGRIERTE
//! Route (`GET /api/einsaetze/{id}/meldungen`):
//! - Der Org-Isolations-Floor sperrt eine org-fremde Führungskraft ohne Mitgliedschaft
//!   strukturell VOR dem Handler-Gate (LFH-115-Regression-Lock).
//! - Unbekannter Einsatz → 404 (Extractor `einsatz_repo::laden`).
//! - Ohne Session → 401 (Extractor komponiert `CurrentUser` zuerst).
//!
//! Damit ist die Kern-Garantie „der Org-Check kann für eine Sub-Route nicht mehr
//! vergessen werden" end-to-end belegt (nicht nur über den Unit-Test von
//! `fordere_org_zugehoerigkeit`).

use axum::body::Body;
use axum::http::{header, Request, StatusCode};
use lifeline_hub::app::{build_router, AppState};
use lifeline_hub::auth::bootstrap::bootstrap_admin;
use lifeline_hub::db;
use lifeline_hub::live::LiveHub;
use sqlx::SqlitePool;
use tower::ServiceExt;

mod common;
use common::{benutzer_anlegen, login_cookie};

async fn setup_with_pool() -> (axum::Router, SqlitePool) {
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

async fn status_von(app: &axum::Router, uri: &str, cookie: Option<&str>) -> StatusCode {
    let mut req = Request::builder().uri(uri);
    if let Some(c) = cookie {
        req = req.header(header::COOKIE, c.to_string());
    }
    app.clone()
        .oneshot(req.body(Body::empty()).unwrap())
        .await
        .unwrap()
        .status()
}

#[tokio::test]
async fn org_floor_sperrt_fremde_org_fuehrungskraft_ueber_migrierte_route() {
    // Eine Org-1-Führungskraft (KEIN Mitglied) trifft einen Einsatz der Org 2 über die
    // migrierte Sub-Route GET .../meldungen. Der Extractor-Org-Floor
    // (darf_fremdeinsatz_lesen: Führungskraft nur EIGENE Org) sperrt VOR dem Handler → 403.
    let (app, pool) = setup_with_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;

    // Fremde Org 2 mit eigenem aktivem Einsatz (rohes SQL, wie in tests/einsatz.rs;
    // bootstrap_admin wird bewusst kein zweites Mal gefahren).
    let org2: i64 =
        sqlx::query_scalar("INSERT INTO organisation (name) VALUES ('Fremd-Orga') RETURNING id")
            .fetch_one(&pool)
            .await
            .unwrap();
    let fremd_einsatz: i64 = sqlx::query_scalar(
        "INSERT INTO einsatz (org_id, bezeichnung, status) \
         VALUES (?, 'Fremd-Lage', 'aktiv') RETURNING id",
    )
    .bind(org2)
    .fetch_one(&pool)
    .await
    .unwrap();

    benutzer_anlegen(&app, &admin, "frieda", "fuehrungskraft").await;
    let frieda = login_cookie(&app, "frieda", "friedapw1").await;

    let status = status_von(
        &app,
        &format!("/api/einsaetze/{fremd_einsatz}/meldungen"),
        Some(&frieda),
    )
    .await;
    assert_eq!(
        status,
        StatusCode::FORBIDDEN,
        "Org-Floor muss die fremde-Org-Führungskraft strukturell sperren"
    );
}

#[tokio::test]
async fn extractor_unbekannter_einsatz_ist_404() {
    let (app, _pool) = setup_with_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let status = status_von(&app, "/api/einsaetze/999999/meldungen", Some(&admin)).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn extractor_ohne_session_ist_401() {
    let (app, _pool) = setup_with_pool().await;
    let status = status_von(&app, "/api/einsaetze/1/meldungen", None).await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
}
