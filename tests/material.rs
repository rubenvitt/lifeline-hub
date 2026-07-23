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

// ---------- LFH-306: Teil-PATCH mit Tri-State ----------

/// Legt ein Material mit ALLEN editierbaren Feldern gesetzt an und liefert seine id.
async fn material_voll(app: &axum::Router, admin: &str, bezeichnung: &str) -> i64 {
    let (status, json) = anfrage(
        app,
        "POST",
        "/api/material",
        admin,
        Some(&format!(
            r#"{{"bezeichnung":"{bezeichnung}","kategorie":"Betreuung",
                 "bestandsnummer":"INV-1","traegerorganisation":"DRK",
                 "standort":"Halle 1","bemerkung":"geprueft"}}"#
        )),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    assert_eq!(json["standort"], "Halle 1", "Vorbedingung des PATCH-Tests");
    json["id"].as_i64().unwrap()
}

/// **Der unterscheidende Test.** Zusammen mit `patch_standort_null_loescht` bildet er das
/// Paar, das den Tri-State beweist: HIER sind die Zusatzfelder nicht im Body und müssen
/// stehen bleiben, DORT steht `null` im Body und muss löschen. Unter dem alten
/// Vollersatz-Verhalten war beides ununterscheidbar — jedes fehlende Feld wurde zu `None`
/// und nullte seine Spalte.
#[tokio::test]
async fn patch_ohne_standort_laesst_standort_stehen() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let id = material_voll(&app, &admin, "Wolldecke").await;

    let (status, json) = anfrage(
        &app,
        "PATCH",
        &format!("/api/material/{id}"),
        &admin,
        Some(r#"{"bezeichnung":"Wolldecke gross"}"#),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(json["bezeichnung"], "Wolldecke gross");
    assert_eq!(json["standort"], "Halle 1", "nicht gesendetes Feld bleibt");
    assert_eq!(
        json["kategorie"], "Betreuung",
        "nicht gesendetes Feld bleibt"
    );
    assert_eq!(
        json["bestandsnummer"], "INV-1",
        "nicht gesendetes Feld bleibt"
    );
    assert_eq!(
        json["traegerorganisation"], "DRK",
        "nicht gesendetes Feld bleibt"
    );
    assert_eq!(
        json["bemerkung"], "geprueft",
        "nicht gesendetes Feld bleibt"
    );
}

#[tokio::test]
async fn patch_standort_null_loescht() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let id = material_voll(&app, &admin, "Wolldecke").await;

    let (status, json) = anfrage(
        &app,
        "PATCH",
        &format!("/api/material/{id}"),
        &admin,
        Some(r#"{"standort":null}"#),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert!(
        json["standort"].is_null(),
        "explizites null leert die Spalte"
    );
    assert_eq!(json["kategorie"], "Betreuung", "Nachbarfeld unberührt");
    assert_eq!(json["bezeichnung"], "Wolldecke", "Nachbarfeld unberührt");
}

/// `""` ist der zweite Weg zum Leerwunsch (`trimme_tri`) — die Formulare schicken
/// geleerte Textfelder als Leerstring, nicht als `null`.
#[tokio::test]
async fn patch_standort_leerstring_loescht() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let id = material_voll(&app, &admin, "Wolldecke").await;

    let (status, json) = anfrage(
        &app,
        "PATCH",
        &format!("/api/material/{id}"),
        &admin,
        Some(r#"{"standort":"   "}"#),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert!(json["standort"].is_null());
}

/// Statuscode-Konvention (LFH-305): ein VORHANDENES, aber leeres Pflichtfeld scheitert am
/// Feld selbst → 400. Ein ABSENTES ist kein Wunsch und geht durch — der Kontrast ist die
/// Aussage, ein Test allein wäre in beiden Welten grün.
#[tokio::test]
async fn patch_leere_bezeichnung_ist_400_absente_laesst_bezeichnung_stehen() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let id = material_voll(&app, &admin, "Wolldecke").await;

    assert_eq!(
        anfrage(
            &app,
            "PATCH",
            &format!("/api/material/{id}"),
            &admin,
            Some(r#"{"bezeichnung":"   "}"#)
        )
        .await
        .0,
        StatusCode::BAD_REQUEST
    );
    let (status, json) = anfrage(
        &app,
        "PATCH",
        &format!("/api/material/{id}"),
        &admin,
        Some(r#"{"bemerkung":"neu"}"#),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "absentes Pflichtfeld ist zulässig");
    assert_eq!(json["bezeichnung"], "Wolldecke");
    assert_eq!(json["bemerkung"], "neu");
}

/// Die Bestandsnummer-Dublette bleibt auch im Teil-Patch ein 409.
#[tokio::test]
async fn patch_auf_vergebene_bestandsnummer_ist_409() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    material_voll(&app, &admin, "Stromerzeuger").await; // belegt INV-1
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
            "PATCH",
            &format!("/api/material/{id}"),
            &admin,
            Some(r#"{"bestandsnummer":"INV-1"}"#)
        )
        .await
        .0,
        StatusCode::CONFLICT
    );
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
