//! LFH-1074: Body-Limit vor dem Handler (Spec `eingabegrenzen`, „Übergroßer Body wird vor dem
//! Handler abgewiesen“). Ohne eigenes Limit nimmt eine Route höchstens 256 KiB an; Zone und
//! Abschnittsfläche haben 320 KiB, damit dort die Geometrieprüfung (400) die wirksame Grenze bleibt.

use axum::http::StatusCode;
use serde_json::{json, Value};

mod common;
use common::{anfrage, einsatz_anlegen, login_cookie, setup};

/// `JSON_BODY_MAX` in `src/app.rs`.
const JSON_BODY_MAX: usize = 256 * 1024;
/// `GEOMETRIE_BODY_MAX` in `src/app.rs`.
const GEOMETRIE_BODY_MAX: usize = 256 * 1024 + 64 * 1024;

const ZU_GROSS: &str = "Anfrage ist zu groß.";

async fn etb_anzahl(app: &axum::Router, cookie: &str, e: i64) -> usize {
    let (s, etb) = anfrage(app, "GET", &format!("/api/einsaetze/{e}/etb"), cookie, None).await;
    assert_eq!(s, StatusCode::OK);
    etb.as_array().unwrap().len()
}

/// Gültiger ETB-Eintrag, mit Leerzeichen hinter dem letzten Feld auf genau `laenge` Bytes
/// gebracht. Ohne Body-Limit nähme der Handler ihn an.
fn gueltiger_eintrag_mit_laenge(laenge: usize) -> String {
    let kern = r#"{"typ":"meldung","inhalt":"Lage ruhig","von":"A","an":"B""#;
    let fuellung = laenge - kern.len() - 1;
    format!("{kern}{}}}", " ".repeat(fuellung))
}

/// ETB-Eintrag, dessen `inhalt` den Body auf genau `laenge` Bytes bringt.
fn langer_eintrag_mit_laenge(laenge: usize) -> String {
    let rahmen = r#"{"typ":"meldung","inhalt":"","von":"A","an":"B"}"#;
    json!({ "typ": "meldung", "inhalt": "x".repeat(laenge - rahmen.len()), "von": "A", "an": "B" })
        .to_string()
}

#[tokio::test]
async fn body_ueber_dem_limit_ist_413_und_der_handler_laeuft_nicht() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let vorher = etb_anzahl(&app, &admin, e).await;

    let body = gueltiger_eintrag_mit_laenge(JSON_BODY_MAX + 1);
    assert_eq!(body.len(), JSON_BODY_MAX + 1);
    let (s, j) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{e}/etb"),
        &admin,
        Some(&body),
    )
    .await;
    assert_eq!(s, StatusCode::PAYLOAD_TOO_LARGE, "{j:?}");
    assert_eq!(j["error"], ZU_GROSS);
    assert_eq!(
        etb_anzahl(&app, &admin, e).await,
        vorher,
        "kein Eintrag entstanden"
    );

    // Derselbe Eintrag an der Grenze geht durch: abgewiesen hat oben nur die Größe.
    let body = gueltiger_eintrag_mit_laenge(JSON_BODY_MAX);
    let (s, j) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{e}/etb"),
        &admin,
        Some(&body),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{j:?}");
    assert_eq!(etb_anzahl(&app, &admin, e).await, vorher + 1);
}

#[tokio::test]
async fn body_an_der_grenze_erreicht_die_feldpruefung() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;

    let body = langer_eintrag_mit_laenge(JSON_BODY_MAX);
    assert_eq!(body.len(), JSON_BODY_MAX);
    let (s, j) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{e}/etb"),
        &admin,
        Some(&body),
    )
    .await;
    assert_eq!(s, StatusCode::BAD_REQUEST);
    assert_eq!(j["error"], "Inhalt darf höchstens 20000 Zeichen lang sein");
}

fn zone_mit_body_laenge(laenge: usize) -> String {
    let rahmen =
        json!({ "typ": "gefahrengebiet", "geometrie_typ": "Polygon", "geometrie": "" }).to_string();
    json!({
        "typ": "gefahrengebiet",
        "geometrie_typ": "Polygon",
        "geometrie": "x".repeat(laenge - rahmen.len()),
    })
    .to_string()
}

async fn zone(app: &axum::Router, cookie: &str, e: i64, body: &str) -> (StatusCode, Value) {
    anfrage(
        app,
        "POST",
        &format!("/api/einsaetze/{e}/zonen"),
        cookie,
        Some(body),
    )
    .await
}

#[tokio::test]
async fn geometrie_routen_haben_ein_eigenes_limit() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;

    // Geometrie knapp über 256 KiB: die Geometrieprüfung lehnt ab, nicht das Body-Limit.
    let rahmen =
        json!({ "typ": "gefahrengebiet", "geometrie_typ": "Polygon", "geometrie": "" }).to_string();
    let body = zone_mit_body_laenge(rahmen.len() + 256 * 1024 + 1);
    assert!(body.len() > JSON_BODY_MAX);
    let (s, j) = zone(&app, &admin, e, &body).await;
    assert_eq!(s, StatusCode::BAD_REQUEST, "{j:?}");
    assert_eq!(j["error"], "geometrie darf höchstens 256 KiB groß sein");

    let (s, j) = zone(
        &app,
        &admin,
        e,
        &zone_mit_body_laenge(GEOMETRIE_BODY_MAX + 1),
    )
    .await;
    assert_eq!(s, StatusCode::PAYLOAD_TOO_LARGE, "{j:?}");
    assert_eq!(j["error"], ZU_GROSS);

    // Abschnittsfläche: dieselbe Grenze. Der Abschnitt muss für die 413 nicht existieren, das
    // Limit greift vor dem Handler.
    let flaeche = json!({ "flaeche_geojson": "x".repeat(GEOMETRIE_BODY_MAX) }).to_string();
    let (s, j) = anfrage(
        &app,
        "PATCH",
        &format!("/api/einsaetze/{e}/abschnitte/1/flaeche"),
        &admin,
        Some(&flaeche),
    )
    .await;
    assert_eq!(s, StatusCode::PAYLOAD_TOO_LARGE, "{j:?}");

    let flaeche = json!({ "flaeche_geojson": "x".repeat(256 * 1024 + 1) }).to_string();
    let (s, j) = anfrage(
        &app,
        "PATCH",
        &format!("/api/einsaetze/{e}/abschnitte/1/flaeche"),
        &admin,
        Some(&flaeche),
    )
    .await;
    assert_eq!(
        s,
        StatusCode::BAD_REQUEST,
        "Geometrieprüfung vor dem Abschnitt: {j:?}"
    );
}
