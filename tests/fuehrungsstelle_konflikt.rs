//! Feld-CAS und Änderungsvermerk an der eigenen Führungsstelle (LLH-1831, LLH-1834; Change
//! `nvhnqynd-konflikt-und-aenderungsvermerk`, Specs `einsatz-fuehrungsstelle` „Angabe der
//! Führungsstelle mit Altwert speichern“ / „Altwerte der Führungsstelle gemeinsam geprüft“ und
//! `aenderungsvermerk`).

use axum::http::StatusCode;
use serde_json::{json, Value};

mod common;
use common::*;

fn pfad(einsatz: i64) -> String {
    format!("/api/incidents/{einsatz}/command-post")
}

async fn patchen(
    app: &axum::Router,
    cookie: &str,
    einsatz: i64,
    body: Value,
) -> (StatusCode, Value) {
    anfrage_json(app, "PATCH", &pfad(einsatz), cookie, Some(&body)).await
}

async fn lesen(app: &axum::Router, cookie: &str, einsatz: i64) -> Value {
    let (s, j) = anfrage(app, "GET", &pfad(einsatz), cookie, None).await;
    assert_eq!(s, StatusCode::OK, "{j:?}");
    j
}

async fn start() -> (axum::Router, String, i64) {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    (app, admin, einsatz)
}

#[tokio::test]
async fn rufname_mit_veraltetem_stand_ist_409() {
    let (app, admin, einsatz) = start().await;
    patchen(&app, &admin, einsatz, json!({"rufname": "Florian 1"})).await;
    patchen(&app, &admin, einsatz, json!({"rufname": "Florian 2"})).await;
    let (s, j) = patchen(
        &app,
        &admin,
        einsatz,
        json!({"rufname": "Florian 3", "erwartet": {"rufname": "Florian 1"}}),
    )
    .await;
    assert_eq!(s, StatusCode::CONFLICT, "{j:?}");
    // Sperrkonflikt ausgezeichnet (src/AGENTS.md, Statuscode-Konvention, LLH-1920).
    assert_eq!(j["grund"], "veraltet", "{j:?}");
    assert_eq!(lesen(&app, &admin, einsatz).await["rufname"], "Florian 2");
}

#[tokio::test]
async fn ohne_altwert_wie_bisher_und_stimmender_altwert_schreibt() {
    let (app, admin, einsatz) = start().await;
    patchen(&app, &admin, einsatz, json!({"rufname": "Florian 1"})).await;
    let (s, _) = patchen(&app, &admin, einsatz, json!({"rufname": "Florian 2"})).await;
    assert_eq!(s, StatusCode::OK);
    let (s, j) = patchen(
        &app,
        &admin,
        einsatz,
        json!({"rufname": "Florian 3", "erwartet": {"rufname": "Florian 2"}}),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{j:?}");
    assert_eq!(lesen(&app, &admin, einsatz).await["rufname"], "Florian 3");
}

#[tokio::test]
async fn einsatzleiter_gleichzeitig_uebergeben_nur_ein_eintrag() {
    let (app, admin, einsatz) = start().await;
    let etb_vorher = system_etb_anzahl(&app, &admin, einsatz).await;
    let (s, j) = patchen(
        &app,
        &admin,
        einsatz,
        json!({
            "einsatzleiter": {"art": "extern", "name": "KBM Weber"},
            "erwartet": {"einsatzleiter": null}
        }),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{j:?}");
    let (s, j) = patchen(
        &app,
        &admin,
        einsatz,
        json!({
            "einsatzleiter": {"art": "extern", "name": "KBM Schulz"},
            "erwartet": {"einsatzleiter": null}
        }),
    )
    .await;
    assert_eq!(s, StatusCode::CONFLICT, "{j:?}");
    assert_eq!(
        lesen(&app, &admin, einsatz).await["einsatzleiter"]["name"],
        "KBM Weber"
    );
    assert_eq!(
        system_etb_anzahl(&app, &admin, einsatz).await,
        etb_vorher + 1,
        "nur die erste Übergabe steht im ETB"
    );

    // Mit dem gelesenen Leiter als Altwert geht die Übergabe.
    let (s, j) = patchen(
        &app,
        &admin,
        einsatz,
        json!({
            "einsatzleiter": {"art": "extern", "name": "KBM Schulz"},
            "erwartet": {"einsatzleiter": {"art": "extern", "name": "KBM Weber"}}
        }),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{j:?}");
}

#[tokio::test]
async fn halber_standort_erwartet_ist_422() {
    let (app, admin, einsatz) = start().await;
    let (s, _) = patchen(
        &app,
        &admin,
        einsatz,
        json!({
            "standort_lat": 52.5, "standort_lon": 13.4,
            "erwartet": {"standort_lat": null}
        }),
    )
    .await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY);
}

#[tokio::test]
async fn vermerk_an_der_fuehrungsstelle() {
    let (app, admin, einsatz) = start().await;
    assert!(lesen(&app, &admin, einsatz).await.get("vermerke").is_none());
    let (s, antwort) = patchen(&app, &admin, einsatz, json!({"rufname": "Florian 1"})).await;
    assert_eq!(s, StatusCode::OK);
    let v = &lesen(&app, &admin, einsatz).await["vermerke"];
    assert_eq!(v["rufname"]["von"], "Administrator", "{v:?}");
    assert!(v.get("bezeichnung").is_none());
    assert_eq!(antwort["vermerke"], *v);
}
