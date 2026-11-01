//! Richtwerte des Unterkunftsrechners in Ebenen (LLH-1520, Spec `unterkunftsrechner`,
//! „Richtwerte in Ebenen“): Basis im Programm, Org-Werte nur durch den Admin, Einsatz-Werte mit
//! Verwaltungszugriff. Wirksam ist Einsatz vor Organisation vor Basis, ein geleerter Wert erbt.
//!
//! Statuscode-Konvention (LFH-267): unbekannter Schlüssel und Wert außerhalb der Grenzen bewerten
//! ein Feld für sich → 400.

use axum::http::StatusCode;
use serde_json::{json, Value};

mod common;
use common::*;

const ORG: &str = "/api/unterkunft-richtwerte";

fn org_put(schluessel: &str) -> String {
    format!("/api/org-unterkunft-richtwerte/{schluessel}")
}

fn einsatz_pfad(einsatz: i64) -> String {
    format!("/api/einsaetze/{einsatz}/unterkunft-richtwerte")
}

/// Der Eintrag eines Schlüssels aus der Antwort.
fn eintrag<'a>(antwort: &'a Value, schluessel: &str) -> &'a Value {
    antwort["werte"]
        .as_array()
        .expect("werte ist eine Liste")
        .iter()
        .find(|w| w["schluessel"] == schluessel)
        .unwrap_or_else(|| panic!("{schluessel} fehlt in {antwort}"))
}

async fn admin(app: &axum::Router) -> String {
    login_cookie(app, "admin", "startpw12").await
}

#[tokio::test]
async fn ohne_sitzung_401() {
    let app = setup().await;
    let (status, _) = anfrage(&app, "GET", ORG, "", None).await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn org_lesen_zeigt_basis_mit_stand() {
    let app = setup().await;
    let a = admin(&app).await;
    benutzer_anlegen(&app, &a, "helfer", "keine").await;
    let helfer = login_cookie(&app, "helfer", "helferpw1").await;

    let (status, json) = anfrage(&app, "GET", ORG, &helfer, None).await;
    assert_eq!(status, StatusCode::OK, "{json}");
    assert_eq!(json["stand"], "2026-11-01");
    let f = eintrag(&json, "flaeche_je_person_m2");
    assert_eq!(f["basis"], 4.0);
    assert_eq!(f["wert"], 4.0);
    assert_eq!(f["herkunft"], "basis");
    assert!(f["org"].is_null() && f["einsatz"].is_null());
}

#[tokio::test]
async fn org_setzen_nur_admin_und_leeren_erbt() {
    let app = setup().await;
    let a = admin(&app).await;
    benutzer_anlegen(&app, &a, "fuehrung", "fuehrungskraft").await;
    let fk = login_cookie(&app, "fuehrung", "fuehrungpw1").await;

    let (status, _) = anfrage_json(
        &app,
        "PUT",
        &org_put("flaeche_je_person_m2"),
        &fk,
        Some(&json!({"wert": 3.5})),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN, "nur der Admin pflegt Org-Werte");

    let (status, json) = anfrage_json(
        &app,
        "PUT",
        &org_put("flaeche_je_person_m2"),
        &a,
        Some(&json!({"wert": 3.5})),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{json}");
    let f = eintrag(&json, "flaeche_je_person_m2");
    assert_eq!((f["wert"].as_f64(), f["herkunft"].as_str()), (Some(3.5), Some("org")));
    assert_eq!(f["basis"], 4.0, "die Basis bleibt sichtbar");

    let (_, json) = anfrage(&app, "GET", ORG, &fk, None).await;
    assert_eq!(eintrag(&json, "flaeche_je_person_m2")["wert"], 3.5);

    let (status, json) = anfrage_json(
        &app,
        "PUT",
        &org_put("flaeche_je_person_m2"),
        &a,
        Some(&json!({"wert": null})),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let f = eintrag(&json, "flaeche_je_person_m2");
    assert_eq!((f["wert"].as_f64(), f["herkunft"].as_str()), (Some(4.0), Some("basis")));
}

#[tokio::test]
async fn unbekannter_schluessel_und_grenzen_400() {
    let app = setup().await;
    let a = admin(&app).await;
    for (schluessel, body, nennt) in [
        ("foo", json!({"wert": 1}), "'foo'"),
        ("foo", json!({"wert": null}), "'foo'"),
        ("flaeche_je_person_m2", json!({"wert": 0.5}), "zwischen 1 und 20"),
        ("zelt_sg30_schlafplaetze", json!({"wert": 10.5}), "ganze Zahl"),
    ] {
        let (status, json) = anfrage_json(&app, "PUT", &org_put(schluessel), &a, Some(&body)).await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "{schluessel} {body}: {json}");
        assert!(json.to_string().contains(nennt), "{json} nennt {nennt}");
    }
}

#[tokio::test]
async fn org_werte_gelten_nur_in_der_eigenen_org() {
    let (app, pool) = setup_mit_pool().await;
    let a = admin(&app).await;
    anfrage_json(&app, "PUT", &org_put("wasser_je_person_l"), &a, Some(&json!({"wert": 15})))
        .await;
    fremde_org_anlegen(&pool, "Nachbar", "fremd", "fremdpw12", "keine").await;
    let fremd = login_cookie(&app, "fremd", "fremdpw12").await;
    let (_, json) = anfrage(&app, "GET", ORG, &fremd, None).await;
    let w = eintrag(&json, "wasser_je_person_l");
    assert_eq!((w["wert"].as_f64(), w["herkunft"].as_str()), (Some(25.0), Some("basis")));
}

#[tokio::test]
async fn einsatz_vor_organisation_und_zurueck() {
    let app = setup().await;
    let a = admin(&app).await;
    let einsatz = einsatz_anlegen(&app, &a).await;
    anfrage_json(&app, "PUT", &org_put("flaeche_je_person_m2"), &a, Some(&json!({"wert": 3.5})))
        .await;

    let (status, json) = anfrage_json(
        &app,
        "PUT",
        &format!("{}/flaeche_je_person_m2", einsatz_pfad(einsatz)),
        &a,
        Some(&json!({"wert": 5})),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{json}");
    let f = eintrag(&json, "flaeche_je_person_m2");
    assert_eq!(f["wert"], 5.0);
    assert_eq!(f["herkunft"], "einsatz");
    assert_eq!((f["basis"].as_f64(), f["org"].as_f64()), (Some(4.0), Some(3.5)));

    let (status, json) = anfrage(&app, "GET", &einsatz_pfad(einsatz), &a, None).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(eintrag(&json, "flaeche_je_person_m2")["wert"], 5.0);

    let (_, json) = anfrage_json(
        &app,
        "PUT",
        &format!("{}/flaeche_je_person_m2", einsatz_pfad(einsatz)),
        &a,
        Some(&json!({"wert": null})),
    )
    .await;
    let f = eintrag(&json, "flaeche_je_person_m2");
    assert_eq!((f["wert"].as_f64(), f["herkunft"].as_str()), (Some(3.5), Some("org")));

    // Die Org-Seite kennt keine Einsatz-Werte.
    let (_, json) = anfrage(&app, "GET", ORG, &a, None).await;
    assert!(eintrag(&json, "flaeche_je_person_m2")["einsatz"].is_null());
}

#[tokio::test]
async fn einsatz_werte_brauchen_lese_und_verwaltungsrecht() {
    let (app, pool) = setup_mit_pool().await;
    let a = admin(&app).await;
    let einsatz = einsatz_anlegen(&app, &a).await;

    let (status, json) = anfrage_json(
        &app,
        "PUT",
        &format!("{}/foo", einsatz_pfad(einsatz)),
        &a,
        Some(&json!({"wert": 1})),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST, "{json}");

    fremde_org_anlegen(&pool, "Nachbar", "fremd", "fremdpw12", "keine").await;
    let fremd = login_cookie(&app, "fremd", "fremdpw12").await;
    let (status, _) = anfrage(&app, "GET", &einsatz_pfad(einsatz), &fremd, None).await;
    assert!(
        status == StatusCode::FORBIDDEN || status == StatusCode::NOT_FOUND,
        "fremde Org liest keine Einsatz-Werte: {status}"
    );
    let (status, _) = anfrage_json(
        &app,
        "PUT",
        &format!("{}/wasser_je_person_l", einsatz_pfad(einsatz)),
        &fremd,
        Some(&json!({"wert": 15})),
    )
    .await;
    assert!(
        status == StatusCode::FORBIDDEN || status == StatusCode::NOT_FOUND,
        "fremde Org schreibt keine Einsatz-Werte: {status}"
    );
}
