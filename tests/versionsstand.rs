//! Integrationstests für GET /api/versionsstand und POST /api/versionsstand/gelesen (Spec
//! `versionsstand`, Change neuigkeiten-versionshinweise).
//!
//! Der Versionsstand gilt für die ganze Instanz: was eine Person als gelesen markiert, sieht
//! jede andere angemeldete Person. Beide Routen verlangen eine Sitzung.

use axum::body::Body;
use axum::http::{header, Request, StatusCode};
use lifeline_hub::routes::versionsstand::LAUFENDE_VERSION;
use lifeline_hub::versionsstand::repo;
use serde_json::Value;
use tower::ServiceExt;

mod common;
use common::{anfrage, benutzer_anlegen, login_cookie, setup_mit_pool};

const PFAD: &str = "/api/versionsstand";
const GELESEN: &str = "/api/versionsstand/gelesen";

/// Anfrage ohne Cookie, liefert nur den Statuscode.
async fn ohne_cookie(app: &axum::Router, methode: &str, uri: &str) -> StatusCode {
    app.clone()
        .oneshot(
            Request::builder()
                .method(methode)
                .uri(uri)
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap()
        .status()
}

/// Prüft die **Anwesenheit** eines Keys (serde_json indexiert fehlende und `null`-Werte gleich).
fn hat_key(json: &Value, key: &str) -> bool {
    json.as_object()
        .expect("Antwort ist ein JSON-Objekt")
        .contains_key(key)
}

#[tokio::test]
async fn ohne_sitzung_gibt_es_weder_lesen_noch_schreiben() {
    let (app, pool) = setup_mit_pool().await;
    repo::beim_start(&pool, "0.9.0").await.unwrap();

    assert_eq!(
        ohne_cookie(&app, "GET", PFAD).await,
        StatusCode::UNAUTHORIZED
    );
    assert_eq!(
        ohne_cookie(&app, "POST", GELESEN).await,
        StatusCode::UNAUTHORIZED
    );

    let stand = repo::laden(&pool).await.unwrap().unwrap();
    assert_eq!(
        stand.gelesen_bis.as_deref(),
        Some("0.9.0"),
        "Lesestand darf nicht wandern"
    );
}

#[tokio::test]
async fn nach_einem_update_zeigt_der_stand_den_vorgaenger_und_den_alten_lesestand() {
    let (app, pool) = setup_mit_pool().await;
    let cookie = login_cookie(&app, "admin", "startpw12").await;
    repo::beim_start(&pool, "0.9.0").await.unwrap();
    repo::beim_start(&pool, LAUFENDE_VERSION).await.unwrap();

    let (status, json) = anfrage(&app, "GET", PFAD, &cookie, None).await;

    assert_eq!(status, StatusCode::OK);
    assert_eq!(json["laufend"], LAUFENDE_VERSION);
    assert_eq!(json["zuletzt_gestartet"], "0.9.0");
    assert_eq!(json["gelesen_bis"], "0.9.0");
}

#[tokio::test]
async fn ohne_vorgaenger_fehlt_zuletzt_gestartet_im_json() {
    let (app, pool) = setup_mit_pool().await;
    let cookie = login_cookie(&app, "admin", "startpw12").await;
    repo::beim_start(&pool, LAUFENDE_VERSION).await.unwrap();

    let (_, json) = anfrage(&app, "GET", PFAD, &cookie, None).await;

    assert!(!hat_key(&json, "zuletzt_gestartet"));
    assert_eq!(json["gelesen_bis"], LAUFENDE_VERSION);
}

#[tokio::test]
async fn gelesen_setzt_den_lesestand_auf_die_laufende_version_und_ist_wiederholbar() {
    let (app, pool) = setup_mit_pool().await;
    let cookie = login_cookie(&app, "admin", "startpw12").await;
    repo::beim_start(&pool, "0.9.0").await.unwrap();
    repo::beim_start(&pool, LAUFENDE_VERSION).await.unwrap();

    let (status, json) = anfrage(&app, "POST", GELESEN, &cookie, None).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(json["gelesen_bis"], LAUFENDE_VERSION);

    let (status, json) = anfrage(&app, "POST", GELESEN, &cookie, None).await;
    assert_eq!(status, StatusCode::OK, "zweites Markieren ist kein Fehler");
    assert_eq!(json["gelesen_bis"], LAUFENDE_VERSION);
}

#[tokio::test]
async fn der_lesestand_gilt_fuer_alle_personen_der_instanz() {
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    repo::beim_start(&pool, "0.9.0").await.unwrap();
    repo::beim_start(&pool, LAUFENDE_VERSION).await.unwrap();
    benutzer_anlegen(&app, &admin, "lesende", "keine").await;
    let andere = login_cookie(&app, "lesende", "lesendepw1").await;

    anfrage(&app, "POST", GELESEN, &andere, None).await;
    let (_, json) = anfrage(&app, "GET", PFAD, &admin, None).await;

    assert_eq!(json["gelesen_bis"], LAUFENDE_VERSION);
}
