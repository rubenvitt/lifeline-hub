//! Antwortkompression nur für JSON (LFH-940, Spec `antwortkompression`).

use axum::body::{to_bytes, Body};
use axum::http::{header, Request, StatusCode};
use std::io::Read;
use tower::ServiceExt;

mod common;
use common::{anfrage, einsatz_anlegen, login_cookie, person_anlegen, setup};

async fn holen(
    app: &axum::Router,
    cookie: &str,
    pfad: &str,
    kodierung: Option<&str>,
) -> axum::response::Response {
    let mut req = Request::builder()
        .uri(pfad)
        .header(header::COOKIE, cookie.to_string());
    if let Some(k) = kodierung {
        req = req.header(header::ACCEPT_ENCODING, k);
    }
    app.clone()
        .oneshot(req.body(Body::empty()).unwrap())
        .await
        .unwrap()
}

fn kodierung(resp: &axum::response::Response) -> Option<String> {
    resp.headers()
        .get(header::CONTENT_ENCODING)
        .map(|v| v.to_str().unwrap().to_string())
}

/// Ein Einsatz mit so vielen Personen, dass Liste und CSV über der Schwelle liegen.
async fn einsatz_mit_personen(app: &axum::Router, admin: &str, n: usize) -> i64 {
    let e = einsatz_anlegen(app, admin).await;
    for i in 0..n {
        person_anlegen(
            app,
            admin,
            e,
            &format!(r#"{{"name":"Person {i}","vorname":"Vorname {i}"}}"#),
        )
        .await;
    }
    e
}

#[tokio::test]
async fn json_liste_kommt_mit_gzip_und_br_gepackt() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_mit_personen(&app, &admin, 12).await;
    let pfad = format!("/api/einsaetze/{e}/personen");
    let (_, roh) = anfrage(&app, "GET", &pfad, &admin, None).await;
    assert!(
        roh.to_string().len() > 1024,
        "Vorbedingung: über der Schwelle"
    );

    let resp = holen(&app, &admin, &pfad, Some("gzip")).await;
    assert_eq!(resp.status(), StatusCode::OK);
    assert_eq!(kodierung(&resp).as_deref(), Some("gzip"));
    let gepackt = to_bytes(resp.into_body(), usize::MAX).await.unwrap();
    let mut entpackt = String::new();
    flate2::read::GzDecoder::new(&gepackt[..])
        .read_to_string(&mut entpackt)
        .unwrap();
    assert_eq!(
        serde_json::from_str::<serde_json::Value>(&entpackt).unwrap(),
        roh
    );
    assert!(gepackt.len() < entpackt.len(), "gepackt ist kleiner");

    let resp = holen(&app, &admin, &pfad, Some("br")).await;
    assert_eq!(kodierung(&resp).as_deref(), Some("br"));

    let resp = holen(&app, &admin, &pfad, None).await;
    assert_eq!(kodierung(&resp), None, "ohne Angebot roh");
}

#[tokio::test]
async fn kleine_json_antwort_bleibt_roh() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let resp = holen(
        &app,
        &admin,
        &format!("/api/einsaetze/{e}/personen"),
        Some("gzip"),
    )
    .await;
    assert_eq!(kodierung(&resp), None, "leere Liste unter der Schwelle");
}

#[tokio::test]
async fn live_strom_und_csv_bleiben_roh() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_mit_personen(&app, &admin, 40).await;

    let resp = holen(
        &app,
        &admin,
        &format!("/api/einsaetze/{e}/live"),
        Some("gzip, br"),
    )
    .await;
    assert_eq!(resp.status(), StatusCode::OK);
    assert!(resp.headers()[header::CONTENT_TYPE]
        .to_str()
        .unwrap()
        .starts_with("text/event-stream"));
    assert_eq!(kodierung(&resp), None, "SSE darf nicht puffern");

    let resp = holen(
        &app,
        &admin,
        &format!("/api/einsaetze/{e}/personen/export"),
        Some("gzip"),
    )
    .await;
    assert_eq!(resp.status(), StatusCode::OK);
    assert_eq!(kodierung(&resp), None, "nur JSON wird gepackt");
    let csv = to_bytes(resp.into_body(), usize::MAX).await.unwrap();
    assert!(csv.len() > 1024, "Vorbedingung: über der Schwelle");
}
