use axum::body::Body;
use axum::http::{header, Request, StatusCode};
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

#[tokio::test]
async fn admin_legt_vorschlag_an_und_alle_sehen_ihn() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    benutzer_anlegen(&app, &admin, "erika", "keine").await;

    assert_eq!(
        post_vorschlag(&app, &admin, "Probealarm").await,
        StatusCode::CREATED
    );

    let erika = login_cookie(&app, "erika", "erikapw1").await;
    let (status, json) = anfrage(&app, "GET", "/api/stichwort-vorschlaege", &erika, None).await;
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

    assert_eq!(
        post_vorschlag(&app, &erika, "Verboten").await,
        StatusCode::FORBIDDEN
    );
}

#[tokio::test]
async fn duplikat_vorschlag_ist_409() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    assert_eq!(
        post_vorschlag(&app, &admin, "Doppelt").await,
        StatusCode::CREATED
    );
    assert_eq!(
        post_vorschlag(&app, &admin, "Doppelt").await,
        StatusCode::CONFLICT
    );
}

#[tokio::test]
async fn admin_loescht_vorschlag() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    assert_eq!(
        post_vorschlag(&app, &admin, "Weg").await,
        StatusCode::CREATED
    );

    let (_, json) = anfrage(&app, "GET", "/api/stichwort-vorschlaege", &admin, None).await;
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

    let (_, json) = anfrage(&app, "GET", "/api/stichwort-vorschlaege", &admin, None).await;
    let texte: Vec<&str> = json
        .as_array()
        .unwrap()
        .iter()
        .map(|v| v["text"].as_str().unwrap())
        .collect();
    assert!(!texte.contains(&"Weg"));
}
