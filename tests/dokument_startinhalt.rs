//! Anlegen eines Vorlagendokuments mit Startinhalt (LFH-548, Spec `dokument-uebernahme`):
//! Lagebericht und Befehl entstehen in EINEM Schritt mit Text. Eine Ablehnung hinterlässt keinen
//! leeren Entwurf. Ohne Startinhalt bleibt alles wie bisher.

use axum::http::StatusCode;

mod common;
use common::{anfrage, einsatz_anlegen, login_cookie, setup, setup_mit_live};

async fn anzahl(app: &axum::Router, cookie: &str, pfad: &str) -> usize {
    let (status, liste) = anfrage(app, "GET", pfad, cookie, None).await;
    assert_eq!(status, StatusCode::OK, "{liste:?}");
    liste.as_array().unwrap().len()
}

#[tokio::test]
async fn lagebericht_mit_startinhalt_entsteht_in_einem_schritt() {
    let (app, live) = setup_mit_live().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let mut rx = live.abonniere(einsatz);

    let (status, lb) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/lageberichte"),
        &admin,
        Some(
            r##"{"vorlage":"freitext","titel":"Funkplan 301200Sep26","abschnitte":[{"schluessel":"text","text":"# Funkplan\n- EA Nord"}]}"##,
        ),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{lb:?}");
    assert_eq!(lb["status"], "entwurf");
    let abschnitte = lb["abschnitte"].as_array().unwrap();
    assert_eq!(abschnitte.len(), 1);
    assert_eq!(abschnitte[0]["schluessel"], "text");
    assert_eq!(abschnitte[0]["text"], "# Funkplan\n- EA Nord");

    // Genau EIN Live-Hinweis für den neuen Entwurf — kein zweiter wie beim alten POST + PATCH.
    let mut hinweise = 0;
    while rx.try_recv().is_ok() {
        hinweise += 1;
    }
    assert_eq!(hinweise, 1);
}

#[tokio::test]
async fn nicht_genannte_abschnitte_der_vorlage_bleiben_leer_in_vorlagenreihenfolge() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;

    let (status, bf) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/befehle"),
        &admin,
        Some(
            r#"{"vorlage":"befehl_lad","titel":"B","abschnitte":[{"schluessel":"durchfuehrung","text":"Zugweise"},{"schluessel":"lage","text":"Hochwasser"}]}"#,
        ),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{bf:?}");
    let abs: Vec<(String, String)> = bf["abschnitte"]
        .as_array()
        .unwrap()
        .iter()
        .map(|a| {
            (
                a["schluessel"].as_str().unwrap().to_string(),
                a["text"].as_str().unwrap().to_string(),
            )
        })
        .collect();
    assert_eq!(
        abs,
        vec![
            ("lage".to_string(), "Hochwasser".to_string()),
            ("auftrag".to_string(), String::new()),
            ("durchfuehrung".to_string(), "Zugweise".to_string()),
        ]
    );
}

#[tokio::test]
async fn unbekannter_schluessel_ist_400_und_hinterlaesst_keinen_entwurf() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let pfad = format!("/api/einsaetze/{einsatz}/lageberichte");

    let (status, antwort) = anfrage(
        &app,
        "POST",
        &pfad,
        &admin,
        Some(
            r#"{"vorlage":"freitext","titel":"X","abschnitte":[{"schluessel":"lage","text":"x"}]}"#,
        ),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST, "{antwort:?}");
    assert_eq!(anzahl(&app, &admin, &pfad).await, 0);
}

#[tokio::test]
async fn doppelter_schluessel_ist_400_und_hinterlaesst_keinen_entwurf() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let pfad = format!("/api/einsaetze/{einsatz}/befehle");

    let (status, antwort) = anfrage(
        &app,
        "POST",
        &pfad,
        &admin,
        Some(
            r#"{"vorlage":"befehl_lad","titel":"X","abschnitte":[{"schluessel":"lage","text":"a"},{"schluessel":"lage","text":"b"}]}"#,
        ),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST, "{antwort:?}");
    assert_eq!(anzahl(&app, &admin, &pfad).await, 0);
}

#[tokio::test]
async fn ohne_startinhalt_bleibt_das_leere_skelett() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;

    let (status, lb) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/lageberichte"),
        &admin,
        Some(r#"{"vorlage":"lagebericht","titel":"Lage 10:00"}"#),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    let abschnitte = lb["abschnitte"].as_array().unwrap();
    assert_eq!(abschnitte.len(), 7);
    assert!(abschnitte.iter().all(|a| a["text"] == ""));
}
