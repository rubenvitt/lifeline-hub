use axum::http::StatusCode;

mod common;
use common::{anfrage, benutzer_anlegen, login_cookie, setup};

// ---------- Tests ----------

#[tokio::test]
async fn bootstrap_seedet_status_katalog() {
    // bootstrap_admin seedet den FMS-Default-Katalog → GET liefert die 10 Stati.
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let (status, json) = anfrage(&app, "GET", "/api/fahrzeug-status", &admin, None).await;
    assert_eq!(status, StatusCode::OK);
    let labels: Vec<&str> = json
        .as_array()
        .unwrap()
        .iter()
        .map(|s| s["label"].as_str().unwrap())
        .collect();
    assert!(labels.contains(&"1 – Frei auf Funk"));
    assert!(labels.contains(&"3 – Auf Anfahrt"));
    assert_eq!(json.as_array().unwrap().len(), 10);
}

#[tokio::test]
async fn alle_lesen_admin_legt_an() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    benutzer_anlegen(&app, &admin, "erika", "keine").await;
    let erika = login_cookie(&app, "erika", "erikapw1").await;

    // Nicht-Admin liest (für Dropdowns), darf aber nicht anlegen.
    assert_eq!(
        anfrage(&app, "GET", "/api/fahrzeug-status", &erika, None)
            .await
            .0,
        StatusCode::OK
    );
    let (status, _) = anfrage(
        &app,
        "POST",
        "/api/fahrzeug-status",
        &erika,
        Some(r#"{"label":"X","kategorie":"gebunden"}"#),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);

    let (status, _) = anfrage(
        &app,
        "POST",
        "/api/fahrzeug-status",
        &admin,
        Some(r#"{"label":"Reserve","kategorie":"verfuegbar","sortier":90}"#),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
}

#[tokio::test]
async fn ungueltige_kategorie_ist_400() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let (status, _) = anfrage(
        &app,
        "POST",
        "/api/fahrzeug-status",
        &admin,
        Some(r#"{"label":"X","kategorie":"unsinn"}"#),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn fms_anker_ausserhalb_ist_400() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let (status, _) = anfrage(
        &app,
        "POST",
        "/api/fahrzeug-status",
        &admin,
        Some(r#"{"label":"X","kategorie":"gebunden","fms_anker":12}"#),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn dublette_label_ist_409() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    // '3 – Auf Anfahrt' existiert bereits aus dem Seed.
    let (status, _) = anfrage(
        &app,
        "POST",
        "/api/fahrzeug-status",
        &admin,
        Some(r#"{"label":"3 – Auf Anfahrt","kategorie":"gebunden"}"#),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT);
}

#[tokio::test]
async fn deaktivieren_entfernt_aus_liste() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let (_, json) = anfrage(
        &app,
        "POST",
        "/api/fahrzeug-status",
        &admin,
        Some(r#"{"label":"Reserve","kategorie":"verfuegbar"}"#),
    )
    .await;
    let id = json["id"].as_i64().unwrap();

    assert_eq!(
        anfrage(
            &app,
            "POST",
            &format!("/api/fahrzeug-status/{id}/deaktivieren"),
            &admin,
            None
        )
        .await
        .0,
        StatusCode::NO_CONTENT
    );
    let (_, liste) = anfrage(&app, "GET", "/api/fahrzeug-status", &admin, None).await;
    let labels: Vec<&str> = liste
        .as_array()
        .unwrap()
        .iter()
        .map(|s| s["label"].as_str().unwrap())
        .collect();
    assert!(!labels.contains(&"Reserve"));
}
