use axum::body::{to_bytes, Body};
use axum::http::{header, Request, StatusCode};
use tower::ServiceExt; // stellt `oneshot` bereit

mod common;
use common::{login_cookie, setup};

/// Legt über die Admin-Benutzerverwaltung einen normalen Nutzer
/// (`system_rolle = 'keiner'`) an.
async fn nicht_admin_anlegen(app: &axum::Router, admin_cookie: &str) {
    let resp = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/benutzer")
                .header(header::CONTENT_TYPE, "application/json")
                .header(header::COOKIE, admin_cookie)
                .body(Body::from(
                    r#"{"anzeigename":"Erika","benutzername":"erika","passwort":"erikapw1"}"#,
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::CREATED);
}

async fn get_organisation(app: &axum::Router, cookie: &str) -> (StatusCode, serde_json::Value) {
    let resp = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/api/organisation")
                .header(header::COOKIE, cookie)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    let status = resp.status();
    let bytes = to_bytes(resp.into_body(), usize::MAX).await.unwrap();
    let json: serde_json::Value = serde_json::from_slice(&bytes).unwrap_or(serde_json::Value::Null);
    (status, json)
}

#[tokio::test]
async fn get_liefert_bootstrap_default_hilfsorganisation() {
    let app = setup().await;
    let admin_cookie = login_cookie(&app, "admin", "startpw12").await;

    let (status, json) = get_organisation(&app, &admin_cookie).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(json["tz_organisation"], "hilfsorganisation");
    assert_eq!(json["name"], "Test-Orga");
}

#[tokio::test]
async fn patch_als_admin_setzt_org_default() {
    let app = setup().await;
    let admin_cookie = login_cookie(&app, "admin", "startpw12").await;

    let resp = app
        .clone()
        .oneshot(
            Request::builder()
                .method("PATCH")
                .uri("/api/organisation")
                .header(header::CONTENT_TYPE, "application/json")
                .header(header::COOKIE, admin_cookie.clone())
                .body(Body::from(r#"{"tz_organisation":"feuerwehr"}"#))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);

    // Danach liefert GET den neuen Wert.
    let (status, json) = get_organisation(&app, &admin_cookie).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(json["tz_organisation"], "feuerwehr");
}

#[tokio::test]
async fn patch_als_nicht_admin_ist_403() {
    let app = setup().await;
    let admin_cookie = login_cookie(&app, "admin", "startpw12").await;
    nicht_admin_anlegen(&app, &admin_cookie).await;

    let erika_cookie = login_cookie(&app, "erika", "erikapw1").await;
    let resp = app
        .oneshot(
            Request::builder()
                .method("PATCH")
                .uri("/api/organisation")
                .header(header::CONTENT_TYPE, "application/json")
                .header(header::COOKIE, erika_cookie)
                .body(Body::from(r#"{"tz_organisation":"feuerwehr"}"#))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::FORBIDDEN);
}
