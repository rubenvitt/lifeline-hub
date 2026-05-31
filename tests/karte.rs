use axum::body::Body;
use axum::http::{header, Request, StatusCode};
use lifeline_hub::app::{build_router, build_router_mit_karte, AppState};
use lifeline_hub::auth::bootstrap::bootstrap_admin;
use lifeline_hub::config::KarteConfig;
use lifeline_hub::live::LiveHub;
use std::io::Write;
use tower::ServiceExt; // oneshot

async fn pool() -> sqlx::SqlitePool {
    // db::test_pool() liefert einen bereits migrierten Test-Pool (wie alle tests/*.rs).
    // Die Karte-Routen lesen die DB nicht — der Pool wird nur für AppState gebraucht.
    lifeline_hub::db::test_pool().await
}

/// Bootstrappt einen Admin im übergebenen Pool, loggt sich ein und liefert das
/// `name=value`-Cookie-Paar für nachfolgende authentifizierte Requests.
async fn login_cookie(app: &axum::Router) -> String {
    let body = r#"{"benutzername":"admin","passwort":"startpw12"}"#;
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
    assert_eq!(resp.status(), StatusCode::OK, "Login im Test muss klappen");
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

#[tokio::test]
async fn tiles_route_liefert_range_aus() {
    let pool = pool().await;
    let mut datei = tempfile::NamedTempFile::new().unwrap();
    datei.write_all(b"PMTILESDATA0123456789").unwrap();
    let pfad = datei.path().to_string_lossy().to_string();

    let app = build_router_mit_karte(
        AppState { pool, live: LiveHub::new() },
        KarteConfig { pmtiles_path: Some(pfad), online_style_url: None },
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
    let app = build_router(AppState { pool, live: LiveHub::new() }); // Default-KarteConfig
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
    bootstrap_admin(&pool, "Test-Orga", "admin", Some("startpw12")).await.unwrap();
    let app = build_router_mit_karte(
        AppState { pool, live: LiveHub::new() },
        KarteConfig {
            pmtiles_path: Some("/irrelevant.pmtiles".into()),
            online_style_url: Some("https://tiles.example/style.json".into()),
        },
    );
    let cookie = login_cookie(&app).await;
    let req = Request::builder()
        .uri("/api/karte/config")
        .header(header::COOKIE, &cookie)
        .body(Body::empty())
        .unwrap();
    let res = app.oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::OK);
    let bytes = axum::body::to_bytes(res.into_body(), 4096).await.unwrap();
    let v: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(v["pmtiles_verfuegbar"].as_bool(), Some(true));
    assert_eq!(v["pmtiles_url"].as_str(), Some("/api/karte/tiles.pmtiles"));
    assert_eq!(v["online_style_url"].as_str(), Some("https://tiles.example/style.json"));
}

#[tokio::test]
async fn config_endpoint_blind_modus_ohne_konfiguration() {
    let pool = pool().await;
    bootstrap_admin(&pool, "Test-Orga", "admin", Some("startpw12")).await.unwrap();
    let app = build_router(AppState { pool, live: LiveHub::new() });
    let cookie = login_cookie(&app).await;
    let req = Request::builder()
        .uri("/api/karte/config")
        .header(header::COOKIE, &cookie)
        .body(Body::empty())
        .unwrap();
    let res = app.oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::OK);
    let bytes = axum::body::to_bytes(res.into_body(), 4096).await.unwrap();
    let v: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(v["pmtiles_verfuegbar"].as_bool(), Some(false));
    assert!(v["pmtiles_url"].is_null());
    assert!(v["online_style_url"].is_null());
}

#[tokio::test]
async fn config_endpoint_401_ohne_session() {
    let pool = pool().await;
    let app = build_router(AppState { pool, live: LiveHub::new() });
    let req = Request::builder()
        .uri("/api/karte/config")
        .body(Body::empty())
        .unwrap();
    let res = app.oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::UNAUTHORIZED);
}
