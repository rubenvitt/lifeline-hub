//! Befehle — Backend-Integrationstests.
//!
//! Angelegt mit LFH-305: der PATCH-Handler prüft die Abschnitts-Schlüssel gegen die feste
//! Schlüsselmenge der Vorlage — enum-artig, also 400 nach der Statuscode-Konvention. Diese
//! Stelle war bis dahin vollständig ungetestet, es gab gar keine `tests/befehl*.rs`.
//! Harness 1:1 aus tests/lagebericht.rs, dessen Handler baugleich ist.

use axum::http::StatusCode;

mod common;
use common::{anfrage, einsatz_anlegen, login_cookie, setup};

/// Legt einen Befehls-Entwurf aus der Vorlage `befehl_lad` an (Abschnitte: lage, auftrag,
/// durchfuehrung) und liefert dessen id.
async fn befehl_anlegen(app: &axum::Router, cookie: &str, einsatz: i64) -> i64 {
    let (status, b) = anfrage(
        app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/befehle"),
        cookie,
        Some(r#"{"vorlage":"befehl_lad","titel":"Erstbefehl"}"#),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{b:?}");
    b["id"].as_i64().unwrap()
}

/// Der Schlüssel wird gegen die Schlüsselmenge der Vorlage geprüft und scheitert für sich
/// genommen → 400. Der Positiv-Zweig mit einem gültigen Schlüssel belegt, dass der 400
/// wirklich aus dieser Prüfung kommt und nicht aus einem vorgelagerten Gate (Schreibrecht,
/// Modul-Zugriff, Entwurfs-Status).
#[tokio::test]
async fn patch_unbekannter_abschnitts_schluessel_ist_400() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let bid = befehl_anlegen(&app, &admin, einsatz).await;
    let u = format!("/api/einsaetze/{einsatz}/befehle/{bid}");

    let (status, antwort) = anfrage(
        &app,
        "PATCH",
        &u,
        &admin,
        Some(r#"{"abschnitte":[{"schluessel":"quatsch","text":"x"}]}"#),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST, "{antwort:?}");

    let (status, antwort) = anfrage(
        &app,
        "PATCH",
        &u,
        &admin,
        Some(r#"{"abschnitte":[{"schluessel":"lage","text":"Hochwasser steigt."}]}"#),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "Positiv-Zweig: {antwort:?}");
}
