use axum::http::StatusCode;

mod common;
use common::{anfrage, benutzer_anlegen, login_cookie, setup};

// ---------- Tests ----------

#[tokio::test]
async fn admin_legt_material_an_alle_lesen_es() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    benutzer_anlegen(&app, &admin, "erika", "keine").await;

    let (status, json) = anfrage(
        &app,
        "POST",
        "/api/material",
        &admin,
        Some(r#"{"bezeichnung":"Wolldecke","kategorie":"Betreuung"}"#),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    assert_eq!(json["bezeichnung"], "Wolldecke");
    assert_eq!(json["dienststatus"], "in_dienst");

    let erika = login_cookie(&app, "erika", "erikapw1").await;
    let (status, json) = anfrage(&app, "GET", "/api/material", &erika, None).await;
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
        "/api/material",
        &erika,
        Some(r#"{"bezeichnung":"Verboten"}"#),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn bezeichnung_nicht_eindeutig_zwei_wolldecken() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let body = r#"{"bezeichnung":"Wolldecke"}"#;
    assert_eq!(
        anfrage(&app, "POST", "/api/material", &admin, Some(body))
            .await
            .0,
        StatusCode::CREATED
    );
    assert_eq!(
        anfrage(&app, "POST", "/api/material", &admin, Some(body))
            .await
            .0,
        StatusCode::CREATED
    );
}

#[tokio::test]
async fn dublette_bestandsnummer_ist_409() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let body = r#"{"bezeichnung":"Stromerzeuger","bestandsnummer":"INV-1"}"#;
    assert_eq!(
        anfrage(&app, "POST", "/api/material", &admin, Some(body))
            .await
            .0,
        StatusCode::CREATED
    );
    let body2 = r#"{"bezeichnung":"Stromerzeuger 2","bestandsnummer":"INV-1"}"#;
    assert_eq!(
        anfrage(&app, "POST", "/api/material", &admin, Some(body2))
            .await
            .0,
        StatusCode::CONFLICT
    );
}

#[tokio::test]
async fn leere_bezeichnung_ist_400() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let (status, _) = anfrage(
        &app,
        "POST",
        "/api/material",
        &admin,
        Some(r#"{"bezeichnung":"   "}"#),
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
        "/api/material",
        &admin,
        Some(r#"{"bezeichnung":"Wolldecke"}"#),
    )
    .await;
    let id = json["id"].as_i64().unwrap();

    assert_eq!(
        anfrage(
            &app,
            "POST",
            &format!("/api/material/{id}/ausser-dienst"),
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
        "/api/material?nur_im_dienst=true",
        &admin,
        None,
    )
    .await;
    assert!(im_dienst.as_array().unwrap().is_empty());
    let (_, alle) = anfrage(&app, "GET", "/api/material", &admin, None).await;
    assert_eq!(alle.as_array().unwrap().len(), 1);
}

#[tokio::test]
async fn kein_delete_endpunkt() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let (_, json) = anfrage(
        &app,
        "POST",
        "/api/material",
        &admin,
        Some(r#"{"bezeichnung":"Wolldecke"}"#),
    )
    .await;
    let id = json["id"].as_i64().unwrap();
    let (status, _) = anfrage(&app, "DELETE", &format!("/api/material/{id}"), &admin, None).await;
    assert_eq!(status, StatusCode::METHOD_NOT_ALLOWED);
}

#[tokio::test]
async fn patch_unbekannte_id_ist_404() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let (status, _) = anfrage(
        &app,
        "PATCH",
        "/api/material/9999",
        &admin,
        Some(r#"{"bezeichnung":"X"}"#),
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn kategorien_endpunkt_liefert_distinct() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    anfrage(
        &app,
        "POST",
        "/api/material",
        &admin,
        Some(r#"{"bezeichnung":"Decke","kategorie":"Betreuung"}"#),
    )
    .await;
    anfrage(
        &app,
        "POST",
        "/api/material",
        &admin,
        Some(r#"{"bezeichnung":"Wolldecke","kategorie":"Betreuung"}"#),
    )
    .await;
    anfrage(
        &app,
        "POST",
        "/api/material",
        &admin,
        Some(r#"{"bezeichnung":"Sandsack","kategorie":"Hochwasser"}"#),
    )
    .await;
    let (status, json) = anfrage(&app, "GET", "/api/material-kategorien", &admin, None).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        json.as_array().unwrap().len(),
        2,
        "DISTINCT: Betreuung, Hochwasser"
    );
}
