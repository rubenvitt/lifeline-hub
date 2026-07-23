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

// ---------- LFH-306: Teil-PATCH ----------

/// Legt eine Qualifikation mit gesetztem `sortier` an und liefert ihre id.
async fn qualifikation_anlegen(app: &axum::Router, admin: &str, label: &str, sortier: i64) -> i64 {
    let (status, json) = anfrage(
        app,
        "POST",
        "/api/qualifikationen",
        admin,
        Some(&format!(r#"{{"label":"{label}","sortier":{sortier}}}"#)),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{json:?}");
    json["id"].as_i64().unwrap()
}

/// **Der unterscheidende Test dieser Route.** `qualifikation` hat keine nullable Spalte,
/// also gibt es hier keinen null-vs-absent-Tri-State — der einzige echte Verlustpfad war
/// das `#[serde(default)] sortier: i64` am Vollersatz-Body: ein PATCH, der nur das Label
/// ändert, setzte `sortier` still auf 0 und verschob den Eintrag in der Katalogliste.
/// Fällt gegen HEAD hart durch.
#[tokio::test]
async fn patch_ohne_sortier_laesst_sortier_stehen() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let id = qualifikation_anlegen(&app, &admin, "Drohnenpilot", 100).await;

    let (status, json) = anfrage(
        &app,
        "PATCH",
        &format!("/api/qualifikationen/{id}"),
        &admin,
        Some(r#"{"label":"Drohnenführer"}"#),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{json:?}");
    assert_eq!(json["label"], "Drohnenführer");
    assert_eq!(json["sortier"], 100, "nicht gesendetes sortier bleibt");
}

/// Gegenprobe zu `patch_ohne_sortier_laesst_sortier_stehen`: gesendet wird gesetzt —
/// auch `sortier: 0`, das ist ein Wert und kein „nicht gesendet".
#[tokio::test]
async fn patch_mit_sortier_setzt_sortier_auch_auf_null() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let id = qualifikation_anlegen(&app, &admin, "Drohnenpilot", 100).await;

    let (status, json) = anfrage(
        &app,
        "PATCH",
        &format!("/api/qualifikationen/{id}"),
        &admin,
        Some(r#"{"sortier":0}"#),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{json:?}");
    assert_eq!(json["sortier"], 0);
    assert_eq!(json["label"], "Drohnenpilot", "Nachbarfeld unberührt");
}

/// Vorhandenes, aber leeres Pflichtfeld → 400 (LFH-305-Konvention); absentes geht durch.
#[tokio::test]
async fn patch_leeres_label_ist_400_absentes_geht_durch() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let id = qualifikation_anlegen(&app, &admin, "Drohnenpilot", 100).await;
    let u = format!("/api/qualifikationen/{id}");

    assert_eq!(
        anfrage(&app, "PATCH", &u, &admin, Some(r#"{"label":"   "}"#))
            .await
            .0,
        StatusCode::BAD_REQUEST
    );
    // Leerer Patch: kein Pflichtfeld gesendet → nichts zu beanstanden.
    assert_eq!(
        anfrage(&app, "PATCH", &u, &admin, Some("{}")).await.0,
        StatusCode::OK
    );
}
