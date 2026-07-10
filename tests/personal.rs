use axum::http::StatusCode;

mod common;
use common::*;

// ---------- Tests ----------

#[tokio::test]
async fn admin_legt_person_an_alle_lesen_sie() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    benutzer_anlegen(&app, &admin, "erika", "keine").await;

    let (status, json) = anfrage(
        &app, "POST", "/api/personal", &admin,
        Some(r#"{"name":"Thomas Müller","staerke_position":"fuehrer"}"#),
    ).await;
    assert_eq!(status, StatusCode::CREATED);
    assert_eq!(json["name"], "Thomas Müller");
    assert_eq!(json["staerke_position"], "fuehrer");
    assert_eq!(json["qualifikationen"].as_array().unwrap().len(), 0);

    let erika = login_cookie(&app, "erika", "erikapw1").await;
    let (status, json) = anfrage(&app, "GET", "/api/personal", &erika, None).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(json.as_array().unwrap().len(), 1);
}

#[tokio::test]
async fn nicht_admin_darf_nicht_anlegen() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    benutzer_anlegen(&app, &admin, "erika", "keine").await;
    let erika = login_cookie(&app, "erika", "erikapw1").await;
    let (status, _) = anfrage(&app, "POST", "/api/personal", &erika, Some(r#"{"name":"Verboten"}"#)).await;
    assert_eq!(status, StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn dublette_personalnummer_ist_409_namen_erlaubt() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    // Gleicher Name ohne Nummer → erlaubt.
    assert_eq!(anfrage(&app, "POST", "/api/personal", &admin, Some(r#"{"name":"Thomas Müller"}"#)).await.0, StatusCode::CREATED);
    assert_eq!(anfrage(&app, "POST", "/api/personal", &admin, Some(r#"{"name":"Thomas Müller"}"#)).await.0, StatusCode::CREATED);
    // Gleiche Nummer → Conflict.
    let mit_nr = r#"{"name":"A","personalnummer":"4711"}"#;
    assert_eq!(anfrage(&app, "POST", "/api/personal", &admin, Some(mit_nr)).await.0, StatusCode::CREATED);
    assert_eq!(anfrage(&app, "POST", "/api/personal", &admin, Some(r#"{"name":"B","personalnummer":"4711"}"#)).await.0, StatusCode::CONFLICT);
}

#[tokio::test]
async fn ungueltige_staerke_position_ist_400() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let (status, _) = anfrage(&app, "POST", "/api/personal", &admin, Some(r#"{"name":"X","staerke_position":"chef"}"#)).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn ausser_dienst_versteckt_aus_nur_im_dienst() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let (_, json) = anfrage(&app, "POST", "/api/personal", &admin, Some(r#"{"name":"Thomas"}"#)).await;
    let id = json["id"].as_i64().unwrap();
    assert_eq!(anfrage(&app, "POST", &format!("/api/personal/{id}/ausser-dienst"), &admin, None).await.0, StatusCode::OK);
    let (_, im_dienst) = anfrage(&app, "GET", "/api/personal?nur_im_dienst=true", &admin, None).await;
    assert!(im_dienst.as_array().unwrap().is_empty());
    let (_, alle) = anfrage(&app, "GET", "/api/personal", &admin, None).await;
    assert_eq!(alle.as_array().unwrap().len(), 1);
}

#[tokio::test]
async fn qualifikationen_werden_zugeordnet_und_aufgeloest() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    // Aus dem Bootstrap-Seed zwei Qualifikations-IDs holen.
    let (_, quals) = anfrage(&app, "GET", "/api/qualifikationen", &admin, None).await;
    let ids: Vec<i64> = quals.as_array().unwrap().iter().take(2).map(|q| q["id"].as_i64().unwrap()).collect();
    let body = format!(r#"{{"name":"Thomas","qualifikation_ids":[{},{}]}}"#, ids[0], ids[1]);
    let (status, json) = anfrage(&app, "POST", "/api/personal", &admin, Some(&body)).await;
    assert_eq!(status, StatusCode::CREATED);
    assert_eq!(json["qualifikationen"].as_array().unwrap().len(), 2);
}

#[tokio::test]
async fn patch_unbekannte_id_ist_404() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let (status, _) = anfrage(&app, "PATCH", "/api/personal/9999", &admin, Some(r#"{"name":"X"}"#)).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn in_dienst_auf_vergebene_personalnummer_ist_409() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    // A mit Nummer 7, dann außer Dienst.
    let (_, a) = anfrage(&app, "POST", "/api/personal", &admin, Some(r#"{"name":"Alt","personalnummer":"7"}"#)).await;
    let id = a["id"].as_i64().unwrap();
    assert_eq!(anfrage(&app, "POST", &format!("/api/personal/{id}/ausser-dienst"), &admin, None).await.0, StatusCode::OK);
    // Nummer 7 neu vergeben.
    assert_eq!(anfrage(&app, "POST", "/api/personal", &admin, Some(r#"{"name":"Neu","personalnummer":"7"}"#)).await.0, StatusCode::CREATED);
    // Reaktivieren von A kollidiert → 409.
    assert_eq!(anfrage(&app, "POST", &format!("/api/personal/{id}/in-dienst"), &admin, None).await.0, StatusCode::CONFLICT);
}

#[tokio::test]
async fn kein_delete_endpunkt() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let (_, json) = anfrage(&app, "POST", "/api/personal", &admin, Some(r#"{"name":"Thomas"}"#)).await;
    let id = json["id"].as_i64().unwrap();
    let (status, _) = anfrage(&app, "DELETE", &format!("/api/personal/{id}"), &admin, None).await;
    assert_eq!(status, StatusCode::METHOD_NOT_ALLOWED);
}
