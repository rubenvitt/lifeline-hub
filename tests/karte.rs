use axum::body::Body;
use axum::http::{Request, StatusCode};
use lifeline_hub::app::{build_router, build_router_mit_karte, AppState};
use lifeline_hub::config::KarteConfig;
use lifeline_hub::live::LiveHub;
use std::io::Write;
use tower::ServiceExt; // oneshot

async fn pool() -> sqlx::SqlitePool {
    // db::test_pool() liefert einen bereits migrierten Test-Pool (wie alle tests/*.rs).
    // Die Karte-Routen lesen die DB nicht — der Pool wird nur für AppState gebraucht.
    lifeline_hub::db::test_pool().await
}

#[tokio::test]
async fn tiles_route_liefert_range_aus() {
    let pool = pool().await;
    let mut datei = tempfile::NamedTempFile::new().unwrap();
    datei.write_all(b"PMTILESDATA0123456789").unwrap();
    let pfad = datei.path().to_string_lossy().to_string();

    let app = build_router_mit_karte(
        AppState { pool, live: LiveHub::new(), fachebenen: lifeline_hub::karte::FachebenenState::neu() },
        KarteConfig { pmtiles_path: Some(pfad), online_styles: vec![] },
    );

    let req = Request::builder()
        .uri("/api/karte/tiles.pmtiles")
        .header("Range", "bytes=0-7")
        .body(Body::empty())
        .unwrap();
    let res = app.oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::PARTIAL_CONTENT); // 206
    let bytes = axum::body::to_bytes(res.into_body(), 1024).await.unwrap();
    assert_eq!(&bytes[..], b"PMTILESD");
}

#[tokio::test]
async fn tiles_route_404_ohne_konfigurierten_pfad() {
    let pool = pool().await;
    let app = build_router(AppState { pool, live: LiveHub::new(), fachebenen: lifeline_hub::karte::FachebenenState::neu() }); // Default-KarteConfig
    let req = Request::builder()
        .uri("/api/karte/tiles.pmtiles")
        .body(Body::empty())
        .unwrap();
    let res = app.oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn config_endpoint_meldet_verfuegbarkeit() {
    let pool = pool().await;
    let app = build_router_mit_karte(
        AppState { pool, live: LiveHub::new(), fachebenen: lifeline_hub::karte::FachebenenState::neu() },
        KarteConfig {
            pmtiles_path: Some("/irrelevant.pmtiles".into()),
            online_styles: vec![lifeline_hub::config::OnlineStyle {
                name: "Online".into(),
                url: "https://tiles.example/style.json".into(),
                typ: lifeline_hub::config::OnlineStyleTyp::Vektor,
                attribution: None,
            }],
        },
    );
    let req = Request::builder().uri("/api/karte/config").body(Body::empty()).unwrap();
    let res = app.oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::OK);
    let bytes = axum::body::to_bytes(res.into_body(), 4096).await.unwrap();
    let v: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(v["pmtiles_verfuegbar"].as_bool(), Some(true));
    assert_eq!(v["pmtiles_url"].as_str(), Some("/api/karte/tiles.pmtiles"));
    assert_eq!(v["online_styles"][0]["url"].as_str(), Some("https://tiles.example/style.json"));
    assert_eq!(v["online_styles"][0]["typ"].as_str(), Some("vektor"));
}

#[tokio::test]
async fn config_endpoint_blind_modus_ohne_konfiguration() {
    let pool = pool().await;
    let app = build_router(AppState { pool, live: LiveHub::new(), fachebenen: lifeline_hub::karte::FachebenenState::neu() });
    let req = Request::builder().uri("/api/karte/config").body(Body::empty()).unwrap();
    let res = app.oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::OK);
    let bytes = axum::body::to_bytes(res.into_body(), 4096).await.unwrap();
    let v: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(v["pmtiles_verfuegbar"].as_bool(), Some(false));
    assert!(v["pmtiles_url"].is_null());
    assert!(v["online_styles"].as_array().unwrap().is_empty());
}

#[tokio::test]
async fn fachebenen_unbekannte_quelle_ist_400() {
    let pool = pool().await;
    let app = build_router(AppState {
        pool,
        live: LiveHub::new(),
        fachebenen: lifeline_hub::karte::FachebenenState::neu(),
    });
    let req = Request::builder()
        .uri("/api/karte/fachebenen/gibtsnicht")
        .body(Body::empty())
        .unwrap();
    let res = app.oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn fachebenen_kritis_ohne_bbox_ist_400() {
    let pool = pool().await;
    let app = build_router(AppState {
        pool,
        live: LiveHub::new(),
        fachebenen: lifeline_hub::karte::FachebenenState::neu(),
    });
    let req = Request::builder()
        .uri("/api/karte/fachebenen/kritis")
        .body(Body::empty())
        .unwrap();
    let res = app.oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::BAD_REQUEST);
}
