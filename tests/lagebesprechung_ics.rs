//! Integrationstests des ICS-Exports der Lagebesprechung (Zunder `p133o8h2`):
//! `GET /api/incidents/{id}/briefing/schedule/export`.

use axum::body::{to_bytes, Body};
use axum::http::{header, Request, StatusCode};
use tower::ServiceExt;

mod common;
use common::*;

fn export_pfad(einsatz: i64) -> String {
    format!("/api/incidents/{einsatz}/briefing/schedule/export")
}

fn termin_pfad(einsatz: i64) -> String {
    format!("/api/incidents/{einsatz}/briefing/schedule")
}

/// Roher GET mit Kopfzeilen und Body als Text.
async fn hole(
    app: &axum::Router,
    pfad: &str,
    cookie: &str,
) -> (StatusCode, axum::http::HeaderMap, String) {
    let req = Request::builder()
        .method("GET")
        .uri(pfad)
        .header(header::COOKIE, cookie.to_string())
        .body(Body::empty())
        .unwrap();
    let resp = app.clone().oneshot(req).await.unwrap();
    let status = resp.status();
    let kopf = resp.headers().clone();
    let bytes = to_bytes(resp.into_body(), usize::MAX).await.unwrap();
    (status, kopf, String::from_utf8_lossy(&bytes).into_owned())
}

async fn termin_setzen(app: &axum::Router, cookie: &str, einsatz: i64, zeit: &str) {
    let (status, json) = anfrage(
        app,
        "PUT",
        &termin_pfad(einsatz),
        cookie,
        Some(&format!(r#"{{"naechste_at":"{zeit}"}}"#)),
    )
    .await;
    assert!(status.is_success(), "Termin setzen: {status} {json:?}");
}

#[tokio::test]
async fn ics_export_liefert_kalenderdatei() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    termin_setzen(&app, &admin, einsatz, "2099-11-24 14:30:00").await;

    let (status, kopf, body) = hole(&app, &export_pfad(einsatz), &admin).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(
        kopf[header::CONTENT_TYPE],
        "text/calendar; charset=utf-8; method=PUBLISH"
    );
    assert_eq!(kopf[header::CACHE_CONTROL], "no-store");
    let dispo = kopf[header::CONTENT_DISPOSITION].to_str().unwrap();
    assert!(dispo.contains("lagebesprechung-einsatz-"), "{dispo}");
    assert!(body.starts_with("BEGIN:VCALENDAR\r\n"), "{body}");
    assert!(body.contains("DTSTART:20991124T143000Z"), "{body}");
}

#[tokio::test]
async fn ics_export_ohne_termin_ist_404() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;

    let (status, _, _) = hole(&app, &export_pfad(einsatz), &admin).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn ics_export_ohne_mitgliedschaft_verweigert() {
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    termin_setzen(&app, &admin, einsatz, "2099-11-24 14:30:00").await;
    fremde_org_anlegen(&pool, "Fremd-Orga", "fremd", "fremdpw1", "fuehrungskraft").await;
    let fremd = login_cookie(&app, "fremd", "fremdpw1").await;

    let (status, _, _) = hole(&app, &export_pfad(einsatz), &fremd).await;
    assert!(
        status == StatusCode::FORBIDDEN || status == StatusCode::NOT_FOUND,
        "erwartet 403/404, war {status}"
    );
}

#[tokio::test]
async fn ics_export_bei_ueberfaelligem_termin_200() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    termin_setzen(&app, &admin, einsatz, "2020-01-01 08:00:00").await;

    let (status, _, body) = hole(&app, &export_pfad(einsatz), &admin).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert!(body.contains("DTSTART:20200101T080000Z"), "{body}");
}
