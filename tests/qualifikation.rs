use axum::http::StatusCode;

mod common;
use common::*;

// ---------- Tests ----------

#[tokio::test]
async fn seed_liefert_neun_aktive_qualifikationen() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let (status, json) = anfrage(&app, "GET", "/api/qualifikationen", &admin, None).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(json.as_array().unwrap().len(), 9, "Bootstrap-Seed");
    assert_eq!(json[0]["label"], "Sanitäter");
}

#[tokio::test]
async fn admin_crud_nicht_admin_nur_lesen() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    benutzer_anlegen(&app, &admin, "erika", "keine").await;
    let erika = login_cookie(&app, "erika", "erikapw1").await;

    // Lesen für alle.
    assert_eq!(
        anfrage(&app, "GET", "/api/qualifikationen", &erika, None)
            .await
            .0,
        StatusCode::OK
    );
    // Anlegen nur Admin.
    assert_eq!(
        anfrage(
            &app,
            "POST",
            "/api/qualifikationen",
            &erika,
            Some(r#"{"label":"Hund"}"#)
        )
        .await
        .0,
        StatusCode::FORBIDDEN
    );
    let (status, json) = anfrage(
        &app,
        "POST",
        "/api/qualifikationen",
        &admin,
        Some(r#"{"label":"Drohnenpilot","sortier":100}"#),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    let id = json["id"].as_i64().unwrap();

    // Dublette → Conflict.
    assert_eq!(
        anfrage(
            &app,
            "POST",
            "/api/qualifikationen",
            &admin,
            Some(r#"{"label":"Drohnenpilot"}"#)
        )
        .await
        .0,
        StatusCode::CONFLICT
    );

    // Deaktivieren → verschwindet aus der Liste.
    assert_eq!(
        anfrage(
            &app,
            "POST",
            &format!("/api/qualifikationen/{id}/deaktivieren"),
            &admin,
            None
        )
        .await
        .0,
        StatusCode::NO_CONTENT
    );
    let (_, json) = anfrage(&app, "GET", "/api/qualifikationen", &admin, None).await;
    assert!(json
        .as_array()
        .unwrap()
        .iter()
        .all(|q| q["id"].as_i64() != Some(id)));
}

#[tokio::test]
async fn patch_aktualisiert_label_und_unbekannte_id_ist_404() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    // Eine neue Qualifikation anlegen und umbenennen.
    let (_, json) = anfrage(
        &app,
        "POST",
        "/api/qualifikationen",
        &admin,
        Some(r#"{"label":"Drohnenpilot","sortier":100}"#),
    )
    .await;
    let id = json["id"].as_i64().unwrap();
    let (status, json) = anfrage(
        &app,
        "PATCH",
        &format!("/api/qualifikationen/{id}"),
        &admin,
        Some(r#"{"label":"Drohnenführer","sortier":105}"#),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(json["label"], "Drohnenführer");
    assert_eq!(json["sortier"], 105);
    // Unbekannte id → 404.
    assert_eq!(
        anfrage(
            &app,
            "PATCH",
            "/api/qualifikationen/9999",
            &admin,
            Some(r#"{"label":"X"}"#)
        )
        .await
        .0,
        StatusCode::NOT_FOUND
    );
}
