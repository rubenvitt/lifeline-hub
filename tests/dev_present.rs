#![cfg(feature = "dev-seeds")]

use axum::body::{to_bytes, Body};
use axum::http::{Request, StatusCode};
use lifeline_hub::app::{build_router, AppState};
use lifeline_hub::db;
use lifeline_hub::dev::seed::dev_seed;
use lifeline_hub::live::LiveHub;
use tower::ServiceExt; // stellt `oneshot` bereit

async fn setup() -> axum::Router {
    let pool = db::test_pool().await;
    dev_seed(&pool).await.unwrap();
    build_router(AppState {
        pool,
        live: LiveHub::new(),
    })
}

#[tokio::test]
async fn dev_users_liefert_aktive_benutzer_mit_klartext_passwort() {
    let app = setup().await;
    let resp = app
        .oneshot(
            Request::builder()
                .uri("/api/dev/users")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);

    let bytes = to_bytes(resp.into_body(), usize::MAX).await.unwrap();
    let json: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
    let arr = json.as_array().expect("Array erwartet");

    // 3 aktive Benutzer; 'inaktiv' ist ausgeschlossen.
    assert_eq!(arr.len(), 3);
    assert!(arr.iter().any(|b| b["benutzername"] == "admin"));
    assert!(!arr.iter().any(|b| b["benutzername"] == "inaktiv"));

    // Alle tragen das Klartext-Dev-Passwort 'dev' und ein Anzeige-Label.
    assert!(arr.iter().all(|b| b["passwort"] == "dev"));
    assert!(arr.iter().all(|b| b["rolle"].is_string()));

    // KEINE internen Felder nach außen.
    assert!(arr
        .iter()
        .all(|b| b.get("passwort_hash").is_none() && b.get("system_rolle").is_none()));
}
