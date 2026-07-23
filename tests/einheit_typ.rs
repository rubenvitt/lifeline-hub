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

// ---------- LFH-306: Teil-PATCH mit Tri-State + Effektivzustands-Prüfung ----------

/// Legt einen Typ mit vollem Soll-Trio und `sortier` an; liefert seine id.
async fn typ_mit_trio(app: &axum::Router, admin: &str, label: &str) -> i64 {
    let (status, json) = anfrage(
        app,
        "POST",
        "/api/einheit-typen",
        admin,
        Some(&format!(
            r#"{{"label":"{label}","soll_fuehrer":1,"soll_unterfuehrer":3,"soll_mannschaft":18,"sortier":60}}"#
        )),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    json["id"].as_i64().unwrap()
}

/// **Der unterscheidende Test der Route.** Ein Patch ohne Soll-Felder und ohne `sortier`
/// darf beide nicht anfassen. Unter dem alten Vollersatz nullte derselbe Request das
/// Trio und setzte `sortier` auf 0 (`#[serde(default)]`).
#[tokio::test]
async fn patch_ohne_soll_felder_laesst_trio_und_sortier_stehen() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let id = typ_mit_trio(&app, &admin, "Verband").await;

    let (status, json) = anfrage(
        &app,
        "PATCH",
        &format!("/api/einheit-typen/{id}"),
        &admin,
        Some(r#"{"label":"Verstärkter Verband"}"#),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(json["label"], "Verstärkter Verband");
    assert_eq!(json["soll"]["fuehrer"], 1, "Trio unberührt");
    assert_eq!(json["soll"]["unterfuehrer"], 3);
    assert_eq!(json["soll"]["mannschaft"], 18);
    assert_eq!(
        json["sortier"], 60,
        "NOT-NULL-Spalte darf nicht auf 0 fallen"
    );
}

/// Effektivzustands-Prüfung: EIN Soll-Feld patchen ist zulässig, weil der Bestand die
/// anderen zwei trägt. Ohne den Merge antwortete dieselbe Anfrage 400 („alle drei oder
/// keiner") oder schriebe eine Zeile mit zwei NULL — beide Ausgänge macht der Test sichtbar.
#[tokio::test]
async fn patch_nur_ein_soll_feld_prueft_gegen_bestand() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let id = typ_mit_trio(&app, &admin, "Verband").await;

    let (status, json) = anfrage(
        &app,
        "PATCH",
        &format!("/api/einheit-typen/{id}"),
        &admin,
        Some(r#"{"soll_mannschaft":20}"#),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(json["soll"]["fuehrer"], 1);
    assert_eq!(json["soll"]["unterfuehrer"], 3);
    assert_eq!(json["soll"]["mannschaft"], 20);
}

/// Das Trio darf nicht halb geleert werden.
#[tokio::test]
async fn patch_soll_fuehrer_null_bei_gesetztem_trio_ist_400() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let id = typ_mit_trio(&app, &admin, "Verband").await;

    assert_eq!(
        anfrage(
            &app,
            "PATCH",
            &format!("/api/einheit-typen/{id}"),
            &admin,
            Some(r#"{"soll_fuehrer":null}"#)
        )
        .await
        .0,
        StatusCode::BAD_REQUEST
    );
}

/// Grenzt gegen den vorigen ab: der legitime Leer-Weg bleibt offen.
#[tokio::test]
async fn patch_alle_drei_null_leert_das_trio() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let id = typ_mit_trio(&app, &admin, "Verband").await;

    let (status, json) = anfrage(
        &app,
        "PATCH",
        &format!("/api/einheit-typen/{id}"),
        &admin,
        Some(r#"{"soll_fuehrer":null,"soll_unterfuehrer":null,"soll_mannschaft":null}"#),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert!(json["soll"].is_null());
    assert_eq!(json["sortier"], 60, "Nachbarfeld unberührt");
}

#[tokio::test]
async fn patch_leeres_label_ist_400_unbekannte_id_ist_404() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let id = typ_mit_trio(&app, &admin, "Verband").await;
    assert_eq!(
        anfrage(
            &app,
            "PATCH",
            &format!("/api/einheit-typen/{id}"),
            &admin,
            Some(r#"{"label":"   "}"#)
        )
        .await
        .0,
        StatusCode::BAD_REQUEST
    );
    assert_eq!(
        anfrage(
            &app,
            "PATCH",
            "/api/einheit-typen/9999",
            &admin,
            Some(r#"{"label":"X"}"#)
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
