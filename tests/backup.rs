use axum::body::{to_bytes, Body};
use axum::http::{header, Request, StatusCode};
use lifeline_hub::app::{build_router, AppState};
use lifeline_hub::auth::bootstrap::bootstrap_admin;
use lifeline_hub::db;
use lifeline_hub::live::LiveHub;
use tower::ServiceExt;

/// Baut Router + DB mit Bootstrap-Admin (admin / startpw12) und einer Org.
async fn setup() -> axum::Router {
    let pool = db::test_pool().await;
    bootstrap_admin(&pool, "Test-Orga", "admin", Some("startpw12"))
        .await
        .unwrap();
    build_router(AppState {
        pool,
        live: LiveHub::new(),
    })
}

/// Loggt einen Benutzer ein und liefert den Session-Cookie-Wert.
async fn login(app: &axum::Router, benutzername: &str, passwort: &str) -> String {
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
    let cookie = resp
        .headers()
        .get(header::SET_COOKIE)
        .unwrap()
        .to_str()
        .unwrap();
    cookie.split(';').next().unwrap().to_string()
}

#[tokio::test]
async fn admin_kann_backup_herunterladen() {
    let app = setup().await;
    let cookie = login(&app, "admin", "startpw12").await;

    let resp = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/api/backup")
                .header(header::COOKIE, &cookie)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(resp.status(), StatusCode::OK);
    let disposition = resp
        .headers()
        .get(header::CONTENT_DISPOSITION)
        .unwrap()
        .to_str()
        .unwrap()
        .to_string();
    assert!(disposition.contains("attachment"));
    assert!(disposition.contains(".sqlite"));

    let bytes = to_bytes(resp.into_body(), usize::MAX).await.unwrap();
    assert!(
        bytes.starts_with(b"SQLite format 3\0"),
        "Download muss eine echte SQLite-Datenbank sein"
    );

    let dir = tempfile::tempdir().unwrap();
    let pfad = dir.path().join("heruntergeladen.sqlite");
    std::fs::write(&pfad, &bytes).unwrap();
    let options = sqlx::sqlite::SqliteConnectOptions::new()
        .filename(&pfad)
        .read_only(true);
    let pool = sqlx::SqlitePool::connect_with(options).await.unwrap();
    let admin_da: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM benutzer WHERE benutzername = 'admin'")
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(admin_da, 1, "Sicherung muss den Admin enthalten");
}

#[tokio::test]
async fn backup_ohne_session_ist_401() {
    let app = setup().await;
    let resp = app
        .oneshot(
            Request::builder()
                .uri("/api/backup")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn backup_als_nicht_admin_ist_403() {
    let app = setup().await;

    let admin_cookie = login(&app, "admin", "startpw12").await;
    let resp = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/benutzer")
                .header(header::COOKIE, &admin_cookie)
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(
                    r#"{"anzeigename":"Bea Obachter","benutzername":"bea","passwort":"passwort1"}"#,
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::CREATED);

    let bea_cookie = login(&app, "bea", "passwort1").await;
    let resp = app
        .oneshot(
            Request::builder()
                .uri("/api/backup")
                .header(header::COOKIE, &bea_cookie)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::FORBIDDEN);
}
