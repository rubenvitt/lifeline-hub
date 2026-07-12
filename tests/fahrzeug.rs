use axum::http::StatusCode;

mod common;
use common::*;

// ---------- Tests ----------

#[tokio::test]
async fn admin_legt_fahrzeug_an_alle_lesen_es() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    benutzer_anlegen(&app, &admin, "erika", "keine").await;

    let (status, json) = anfrage(
        &app, "POST", "/api/fahrzeuge", &admin,
        Some(r#"{"funkrufname":"Florian Musterstadt 83/1","fahrzeugtyp":"LF 20","staerke_fuehrer":0,"staerke_unterfuehrer":1,"staerke_mannschaft":8}"#),
    ).await;
    assert_eq!(status, StatusCode::CREATED);
    assert_eq!(json["funkrufname"], "Florian Musterstadt 83/1");
    assert_eq!(json["staerke"]["mannschaft"], 8);

    let erika = login_cookie(&app, "erika", "erikapw1").await;
    let (status, json) = anfrage(&app, "GET", "/api/fahrzeuge", &erika, None).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(json.as_array().unwrap().len(), 1);
}

#[tokio::test]
async fn nicht_admin_darf_nicht_anlegen() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    benutzer_anlegen(&app, &admin, "erika", "keine").await;
    let erika = login_cookie(&app, "erika", "erikapw1").await;

    let (status, _) = anfrage(
        &app,
        "POST",
        "/api/fahrzeuge",
        &erika,
        Some(r#"{"funkrufname":"Verboten 1"}"#),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn dublette_funkrufname_ist_409() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let body = r#"{"funkrufname":"Florian 1"}"#;
    assert_eq!(
        anfrage(&app, "POST", "/api/fahrzeuge", &admin, Some(body))
            .await
            .0,
        StatusCode::CREATED
    );
    assert_eq!(
        anfrage(&app, "POST", "/api/fahrzeuge", &admin, Some(body))
            .await
            .0,
        StatusCode::CONFLICT
    );
}

#[tokio::test]
async fn unvollstaendige_staerke_ist_400() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let (status, _) = anfrage(
        &app,
        "POST",
        "/api/fahrzeuge",
        &admin,
        Some(r#"{"funkrufname":"Florian 1","staerke_fuehrer":0,"staerke_mannschaft":8}"#),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn ausser_dienst_versteckt_aus_nur_im_dienst() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let (_, json) = anfrage(
        &app,
        "POST",
        "/api/fahrzeuge",
        &admin,
        Some(r#"{"funkrufname":"Florian 1"}"#),
    )
    .await;
    let id = json["id"].as_i64().unwrap();

    assert_eq!(
        anfrage(
            &app,
            "POST",
            &format!("/api/fahrzeuge/{id}/ausser-dienst"),
            &admin,
            None
        )
        .await
        .0,
        StatusCode::OK
    );
    let (_, im_dienst) = anfrage(
        &app,
        "GET",
        "/api/fahrzeuge?nur_im_dienst=true",
        &admin,
        None,
    )
    .await;
    assert!(im_dienst.as_array().unwrap().is_empty());
    let (_, alle) = anfrage(&app, "GET", "/api/fahrzeuge", &admin, None).await;
    assert_eq!(alle.as_array().unwrap().len(), 1);
}

#[tokio::test]
async fn patch_unbekannte_id_ist_404() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let (status, _) = anfrage(
        &app,
        "PATCH",
        "/api/fahrzeuge/9999",
        &admin,
        Some(r#"{"funkrufname":"X"}"#),
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn kein_delete_endpunkt() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let (_, json) = anfrage(
        &app,
        "POST",
        "/api/fahrzeuge",
        &admin,
        Some(r#"{"funkrufname":"Florian 1"}"#),
    )
    .await;
    let id = json["id"].as_i64().unwrap();
    // DELETE existiert nicht → 405 Method Not Allowed (Route ist nur PATCH/POST).
    let (status, _) = anfrage(
        &app,
        "DELETE",
        &format!("/api/fahrzeuge/{id}"),
        &admin,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::METHOD_NOT_ALLOWED);
}
