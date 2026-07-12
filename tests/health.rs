use axum::body::Body;
use axum::http::{Request, StatusCode};
use lifeline_hub::app::{build_router, AppState};
use lifeline_hub::db;
use lifeline_hub::live::LiveHub;
use tower::ServiceExt; // stellt `oneshot` bereit

#[tokio::test]
async fn health_endpoint_returns_ok() {
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

    let response = app
        .oneshot(
            Request::builder()
                .uri("/api/health")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);

    let bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
        .await
        .unwrap();
    let json: serde_json::Value = serde_json::from_slice(&bytes).unwrap();

    assert_eq!(json["status"], "ok");
    assert_eq!(json["db"], true);
    assert_eq!(json["version"], env!("CARGO_PKG_VERSION"));
}

#[tokio::test]
async fn health_endpoint_reports_degraded_when_db_down() {
    let pool = db::test_pool().await;
    pool.close().await; // DB-Verbindung schließen → Query schlägt fehl
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

    let response = app
        .oneshot(
            Request::builder()
                .uri("/api/health")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::SERVICE_UNAVAILABLE);

    let bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
        .await
        .unwrap();
    let json: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(json["status"], "degraded");
    assert_eq!(json["db"], false);
}
