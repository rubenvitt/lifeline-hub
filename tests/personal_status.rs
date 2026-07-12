use axum::http::StatusCode;

mod common;
use common::*;

// ---------- Tests ----------

#[tokio::test]
async fn seed_liefert_sechs_aktive_status() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let (status, json) = anfrage(&app, "GET", "/api/personal-status", &admin, None).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(json.as_array().unwrap().len(), 6);
    assert_eq!(json[0]["label"], "verfügbar");
}

#[tokio::test]
async fn admin_crud_kategorie_validierung_dublette() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    benutzer_anlegen(&app, &admin, "erika", "keine").await;
    let erika = login_cookie(&app, "erika", "erikapw1").await;

    assert_eq!(
        anfrage(&app, "GET", "/api/personal-status", &erika, None)
            .await
            .0,
        StatusCode::OK
    );
    assert_eq!(
        anfrage(
            &app,
            "POST",
            "/api/personal-status",
            &erika,
            Some(r#"{"label":"X","kategorie":"gebunden"}"#)
        )
        .await
        .0,
        StatusCode::FORBIDDEN
    );

    // Ungültige Kategorie → 400.
    assert_eq!(
        anfrage(
            &app,
            "POST",
            "/api/personal-status",
            &admin,
            Some(r#"{"label":"X","kategorie":"quatsch"}"#)
        )
        .await
        .0,
        StatusCode::BAD_REQUEST
    );
    // Anlegen ok.
    assert_eq!(
        anfrage(
            &app,
            "POST",
            "/api/personal-status",
            &admin,
            Some(r#"{"label":"nachalarmiert","kategorie":"gebunden","sortier":70}"#)
        )
        .await
        .0,
        StatusCode::CREATED
    );
    // Dublette label → Conflict.
    assert_eq!(
        anfrage(
            &app,
            "POST",
            "/api/personal-status",
            &admin,
            Some(r#"{"label":"nachalarmiert","kategorie":"verfuegbar"}"#)
        )
        .await
        .0,
        StatusCode::CONFLICT
    );
}

#[tokio::test]
async fn patch_aktualisiert_und_unbekannte_id_ist_404() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let (_, json) = anfrage(
        &app,
        "POST",
        "/api/personal-status",
        &admin,
        Some(r#"{"label":"nachalarmiert","kategorie":"gebunden","sortier":70}"#),
    )
    .await;
    let id = json["id"].as_i64().unwrap();
    let (status, json) = anfrage(&app, "PATCH", &format!("/api/personal-status/{id}"), &admin, Some(r##"{"label":"nachgefordert","kategorie":"verfuegbar","farbe":"#00ff00","sortier":75}"##)).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(json["label"], "nachgefordert");
    assert_eq!(json["kategorie"], "verfuegbar");
    // Unbekannte id → 404.
    assert_eq!(
        anfrage(
            &app,
            "PATCH",
            "/api/personal-status/9999",
            &admin,
            Some(r#"{"label":"X","kategorie":"gebunden"}"#)
        )
        .await
        .0,
        StatusCode::NOT_FOUND
    );
}

#[tokio::test]
async fn deaktivieren_entfernt_aus_liste() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let (_, json) = anfrage(
        &app,
        "POST",
        "/api/personal-status",
        &admin,
        Some(r#"{"label":"Reserve","kategorie":"verfuegbar"}"#),
    )
    .await;
    let id = json["id"].as_i64().unwrap();
    assert_eq!(
        anfrage(
            &app,
            "POST",
            &format!("/api/personal-status/{id}/deaktivieren"),
            &admin,
            None
        )
        .await
        .0,
        StatusCode::NO_CONTENT
    );
    let (_, liste) = anfrage(&app, "GET", "/api/personal-status", &admin, None).await;
    assert!(!liste
        .as_array()
        .unwrap()
        .iter()
        .any(|s| s["label"] == "Reserve"));
}
