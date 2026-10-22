//! Berichtigter Wortlaut (LLH-1382, Spec `meldungseingang`, „Eine berichtigte Meldung zeigt die
//! Berichtigung“): Meldung und Lagemeldung tragen id und Nummer der jüngsten ETB-Berichtigung
//! ihres Eintrags; der Wortlaut bleibt. Herleitung `llh-1021/llh-1382/design.md` (D1–D5).
use axum::http::StatusCode;
use serde_json::{json, Value};
use std::time::Duration;

mod common;
use common::{anfrage, einsatz_anlegen, login_cookie, setup, setup_mit_live};

async fn melden(app: &axum::Router, cookie: &str, einsatz: i64, art: &str) -> Value {
    let body = json!({
        "absender": "Florian Nord 1",
        "empfaenger": "ELW 1",
        "meldeweg": "funk",
        "inhalt": "Brücke Nord gesperrt",
        "meldungsart": art,
        "ereigniszeit": "2026-10-21 09:00:00",
    });
    let (s, m) = anfrage(
        app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/meldungen"),
        cookie,
        Some(&body.to_string()),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{m:?}");
    m
}

/// Erfasst im ETB eine Berichtigung des Eintrags `grund`; liefert den neuen Eintrag.
async fn berichtigen(app: &axum::Router, cookie: &str, einsatz: i64, grund: i64) -> Value {
    let body = json!({
        "typ": "berichtigung",
        "inhalt": "Richtig: Brücke Süd gesperrt",
        "von": "ELW 1",
        "an": "ELW 1",
        "berichtigt_eintrag_id": grund,
    });
    let (s, v) = anfrage(
        app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/etb"),
        cookie,
        Some(&body.to_string()),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{v:?}");
    v
}

async fn lesen(app: &axum::Router, cookie: &str, pfad: &str) -> Vec<Value> {
    let (s, v) = anfrage(app, "GET", pfad, cookie, None).await;
    assert_eq!(s, StatusCode::OK, "{pfad}: {v}");
    v.as_array().unwrap().clone()
}

async fn meldung(app: &axum::Router, cookie: &str, einsatz: i64, mid: i64) -> Value {
    lesen(app, cookie, &format!("/api/einsaetze/{einsatz}/meldungen"))
        .await
        .into_iter()
        .find(|m| m["id"] == mid)
        .expect("Meldung in der Liste")
}

async fn lagemeldung(app: &axum::Router, cookie: &str, einsatz: i64, mid: i64) -> Value {
    lesen(
        app,
        cookie,
        &format!("/api/einsaetze/{einsatz}/lage/meldungen"),
    )
    .await
    .into_iter()
    .find(|l| l["meldung_id"] == mid)
    .expect("Lagemeldung in der Lage")
}

#[tokio::test]
async fn ohne_berichtigung_fehlen_die_felder() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let m = melden(&app, &admin, e, "lagemeldung").await;
    let mid = m["id"].as_i64().unwrap();

    let karte = meldung(&app, &admin, e, mid).await;
    assert!(
        !karte
            .as_object()
            .unwrap()
            .contains_key("etb_berichtigung_id"),
        "{karte}"
    );
    assert!(
        !karte
            .as_object()
            .unwrap()
            .contains_key("etb_berichtigung_lfd_nr"),
        "{karte}"
    );
    let zeile = lagemeldung(&app, &admin, e, mid).await;
    assert!(
        !zeile
            .as_object()
            .unwrap()
            .contains_key("etb_berichtigung_id"),
        "{zeile}"
    );
}

#[tokio::test]
async fn meldung_und_lage_tragen_die_juengste_berichtigung_und_behalten_den_wortlaut() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let m = melden(&app, &admin, e, "lagemeldung").await;
    let mid = m["id"].as_i64().unwrap();
    let grund = m["etb_meldung_id"].as_i64().expect("Auto-ETB-Eintrag");

    let erste = berichtigen(&app, &admin, e, grund).await;
    let karte = meldung(&app, &admin, e, mid).await;
    assert_eq!(karte["etb_berichtigung_id"], erste["id"], "{karte}");
    assert_eq!(karte["etb_berichtigung_lfd_nr"], erste["lfd_nr"], "{karte}");
    assert_eq!(
        karte["inhalt"], "Brücke Nord gesperrt",
        "der Wortlaut bleibt"
    );

    let zweite = berichtigen(&app, &admin, e, grund).await;
    let karte = meldung(&app, &admin, e, mid).await;
    assert_eq!(
        karte["etb_berichtigung_id"], zweite["id"],
        "die jüngste gilt"
    );
    assert_eq!(karte["etb_berichtigung_lfd_nr"], zweite["lfd_nr"]);

    // D1: die Lage zeigt weiter Lage-Text bzw. Wortlaut, mit dem Verweis.
    let zeile = lagemeldung(&app, &admin, e, mid).await;
    assert_eq!(zeile["text"], "Brücke Nord gesperrt");
    assert_eq!(zeile["etb_berichtigung_id"], zweite["id"], "{zeile}");
    assert_eq!(zeile["etb_berichtigung_lfd_nr"], zweite["lfd_nr"]);
}

#[tokio::test]
async fn berichtigung_einer_berichtigung_zaehlt_nicht_als_berichtigung_der_meldung() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let m = melden(&app, &admin, e, "sonstige").await;
    let mid = m["id"].as_i64().unwrap();
    let grund = m["etb_meldung_id"].as_i64().unwrap();

    let erste = berichtigen(&app, &admin, e, grund).await;
    berichtigen(&app, &admin, e, erste["id"].as_i64().unwrap()).await;

    let karte = meldung(&app, &admin, e, mid).await;
    assert_eq!(karte["etb_berichtigung_id"], erste["id"], "{karte}");
}

#[tokio::test]
async fn berichtigung_des_meldungseintrags_meldet_die_meldungen_live() {
    let (app, live) = setup_mit_live().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let m = melden(&app, &admin, e, "sonstige").await;
    let grund = m["etb_meldung_id"].as_i64().unwrap();
    let mut rx = live.abonniere(e);

    berichtigen(&app, &admin, e, grund).await;
    let mut tags = Vec::new();
    while let Ok(Ok(n)) = tokio::time::timeout(Duration::from_millis(200), rx.recv()).await {
        tags.push(n.event.as_str().to_string());
    }
    assert!(tags.iter().any(|t| t == "etb"), "{tags:?}");
    assert!(tags.iter().any(|t| t == "meldung"), "{tags:?}");
}

#[tokio::test]
async fn berichtigung_eines_anderen_eintrags_meldet_keine_meldung() {
    let (app, live) = setup_mit_live().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let (s, eintrag) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{e}/etb"),
        &admin,
        Some(r#"{"typ":"anordnung","inhalt":"Halle räumen","von":"ELW 1","an":"Florian 3"}"#),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{eintrag}");
    let mut rx = live.abonniere(e);

    berichtigen(&app, &admin, e, eintrag["id"].as_i64().unwrap()).await;
    let mut tags = Vec::new();
    while let Ok(Ok(n)) = tokio::time::timeout(Duration::from_millis(200), rx.recv()).await {
        tags.push(n.event.as_str().to_string());
    }
    assert!(tags.iter().any(|t| t == "etb"), "{tags:?}");
    assert!(!tags.iter().any(|t| t == "meldung"), "{tags:?}");
}
