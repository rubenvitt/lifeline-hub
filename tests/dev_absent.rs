#![cfg(not(feature = "dev-seeds"))]

use axum::body::Body;
use axum::http::{Request, StatusCode};
use lifeline_hub::app::{build_router, AppState};
use lifeline_hub::db;
use lifeline_hub::live::LiveHub;
use tower::ServiceExt;

#[tokio::test]
async fn dev_users_route_fehlt_ohne_feature() {
    let pool = db::test_pool().await;
    let app = build_router(AppState {
        pool,
        live: LiveHub::new(),
        karten_dir: std::env::temp_dir(),
        fachebenen: lifeline_hub::karte::FachebenenState::neu(),
        download_client: lifeline_hub::karte::download::download_client(),
        download_fortschritt: lifeline_hub::karte::download::neue_fortschritt_map(),
        karten_service_url: None,
        karten_service_token: None,
    });
    let resp = app
        .oneshot(
            Request::builder()
                .uri("/api/dev/users")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    // Fallback gibt für unbekannte /api/-Pfade 404 JSON zurück.
    assert_eq!(resp.status(), StatusCode::NOT_FOUND);
}
