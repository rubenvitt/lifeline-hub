use axum::body::{to_bytes, Body};
use axum::http::{header, Request, StatusCode};
use serde_json::Value;
use tower::ServiceExt;

mod common;
use common::*;

async fn post_vorschlag(app: &axum::Router, cookie: &str, text: &str) -> StatusCode {
    let body = format!(r#"{{"text":"{text}"}}"#);
    app.clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/stichwort-vorschlaege")
                .header(header::CONTENT_TYPE, "application/json")
                .header(header::COOKIE, cookie.to_string())
                .body(Body::from(body))
                .unwrap(),
        )
        .await
        .unwrap()
        .status()
}

async fn liste_vorschlaege(app: &axum::Router, cookie: &str) -> (StatusCode, Value) {
    let resp = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/api/stichwort-vorschlaege")
                .header(header::COOKIE, cookie.to_string())
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    let status = resp.status();
    let bytes = to_bytes(resp.into_body(), usize::MAX).await.unwrap();
    (status, serde_json::from_slice(&bytes).unwrap_or(Value::Null))
}

#[tokio::test]
async fn admin_legt_vorschlag_an_und_alle_sehen_ihn() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    benutzer_anlegen(&app, &admin, "erika", "keine").await;

    assert_eq!(post_vorschlag(&app, &admin, "Probealarm").await, StatusCode::CREATED);

    let erika = login_cookie(&app, "erika", "erikapw1").await;
    let (status, json) = liste_vorschlaege(&app, &erika).await;
    assert_eq!(status, StatusCode::OK);
    let texte: Vec<&str> = json
        .as_array()
        .unwrap()
        .iter()
        .map(|v| v["text"].as_str().unwrap())
        .collect();
    assert!(texte.contains(&"Probealarm"));
}

#[tokio::test]
async fn nicht_admin_darf_keinen_vorschlag_anlegen() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    benutzer_anlegen(&app, &admin, "erika", "keine").await;
    let erika = login_cookie(&app, "erika", "erikapw1").await;

    assert_eq!(post_vorschlag(&app, &erika, "Verboten").await, StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn duplikat_vorschlag_ist_409() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    assert_eq!(post_vorschlag(&app, &admin, "Doppelt").await, StatusCode::CREATED);
    assert_eq!(post_vorschlag(&app, &admin, "Doppelt").await, StatusCode::CONFLICT);
}

#[tokio::test]
async fn admin_loescht_vorschlag() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    assert_eq!(post_vorschlag(&app, &admin, "Weg").await, StatusCode::CREATED);

    let (_, json) = liste_vorschlaege(&app, &admin).await;
    let id = json
        .as_array()
        .unwrap()
        .iter()
        .find(|v| v["text"] == "Weg")
        .unwrap()["id"]
        .as_i64()
        .unwrap();

    let resp = app
        .clone()
        .oneshot(
            Request::builder()
                .method("DELETE")
                .uri(format!("/api/stichwort-vorschlaege/{id}"))
                .header(header::COOKIE, admin.clone())
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::NO_CONTENT);

    let (_, json) = liste_vorschlaege(&app, &admin).await;
    let texte: Vec<&str> = json
        .as_array()
        .unwrap()
        .iter()
        .map(|v| v["text"].as_str().unwrap())
        .collect();
    assert!(!texte.contains(&"Weg"));
}
