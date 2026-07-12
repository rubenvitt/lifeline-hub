use axum::http::StatusCode;

mod common;
use common::{anfrage, benutzer_anlegen, login_cookie, setup};

// ---------- Tests ----------

#[tokio::test]
async fn bootstrap_seedet_einheit_typen() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let (status, json) = anfrage(&app, "GET", "/api/einheit-typen", &admin, None).await;
    assert_eq!(status, StatusCode::OK);
    let labels: Vec<&str> = json
        .as_array()
        .unwrap()
        .iter()
        .map(|t| t["label"].as_str().unwrap())
        .collect();
    assert_eq!(labels.len(), 5);
    assert!(labels.contains(&"Zug"));
    // Zug hat Soll 1/3/18; Sonstige hat null.
    let zug = json
        .as_array()
        .unwrap()
        .iter()
        .find(|t| t["label"] == "Zug")
        .unwrap();
    assert_eq!(zug["soll"]["fuehrer"], 1);
    assert_eq!(zug["soll"]["mannschaft"], 18);
    let sonstige = json
        .as_array()
        .unwrap()
        .iter()
        .find(|t| t["label"] == "Sonstige")
        .unwrap();
    assert!(sonstige["soll"].is_null());
}

#[tokio::test]
async fn alle_lesen_nur_admin_legt_an() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    benutzer_anlegen(&app, &admin, "erika", "keine").await;
    let erika = login_cookie(&app, "erika", "erikapw1").await;
    assert_eq!(
        anfrage(&app, "GET", "/api/einheit-typen", &erika, None)
            .await
            .0,
        StatusCode::OK
    );
    assert_eq!(
        anfrage(
            &app,
            "POST",
            "/api/einheit-typen",
            &erika,
            Some(r#"{"label":"X"}"#)
        )
        .await
        .0,
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        anfrage(&app, "POST", "/api/einheit-typen", &admin,
            Some(r#"{"label":"Verband","soll_fuehrer":3,"soll_unterfuehrer":9,"soll_mannschaft":40,"sortier":60}"#)).await.0,
        StatusCode::CREATED
    );
}

#[tokio::test]
async fn teilweise_soll_ist_400() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let (status, _) = anfrage(
        &app,
        "POST",
        "/api/einheit-typen",
        &admin,
        Some(r#"{"label":"X","soll_fuehrer":1}"#),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn dublette_label_ist_409() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    // 'Zug' existiert aus dem Seed.
    assert_eq!(
        anfrage(
            &app,
            "POST",
            "/api/einheit-typen",
            &admin,
            Some(r#"{"label":"Zug"}"#)
        )
        .await
        .0,
        StatusCode::CONFLICT
    );
}

#[tokio::test]
async fn deaktivieren_entfernt_aus_liste() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let (_, json) = anfrage(
        &app,
        "POST",
        "/api/einheit-typen",
        &admin,
        Some(r#"{"label":"Reserve"}"#),
    )
    .await;
    let id = json["id"].as_i64().unwrap();
    assert_eq!(
        anfrage(
            &app,
            "POST",
            &format!("/api/einheit-typen/{id}/deaktivieren"),
            &admin,
            None
        )
        .await
        .0,
        StatusCode::NO_CONTENT
    );
    let (_, liste) = anfrage(&app, "GET", "/api/einheit-typen", &admin, None).await;
    let labels: Vec<&str> = liste
        .as_array()
        .unwrap()
        .iter()
        .map(|t| t["label"].as_str().unwrap())
        .collect();
    assert!(!labels.contains(&"Reserve"));
}
