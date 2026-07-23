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

// ---------- LFH-306: Teil-PATCH mit Tri-State ----------

/// Legt einen Status mit ALLEN Feldern gesetzt an und liefert seine id.
async fn status_voll(app: &axum::Router, admin: &str, label: &str) -> i64 {
    let (status, json) = anfrage(
        app,
        "POST",
        "/api/fahrzeug-status",
        admin,
        Some(&format!(
            r##"{{"label":"{label}","kategorie":"gebunden","farbe":"#ff0000","fms_anker":3,"sortier":70}}"##
        )),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{json:?}");
    json["id"].as_i64().unwrap()
}

/// **Der unterscheidende Test.** Zusammen mit `patch_farbe_null_loescht_die_farbe` bildet er
/// das Paar, das den Tri-State beweist: HIER sind `farbe`/`fms_anker` nicht im Body und
/// müssen stehen bleiben, DORT steht `null` im Body und muss löschen. Unter dem alten
/// Vollersatz-Verhalten war beides ununterscheidbar — das fehlende Feld nullte die Spalte.
///
/// Der Body ist bewusst **unter HEAD gültig** (`label`/`kategorie`/`sortier` alle da, nur
/// die nullable Felder fehlen): so schlägt der Test gegen HEAD mit dem echten Datenverlust
/// fehl (200 + `farbe`/`fms_anker` auf `null`) statt am Extractor — ein 400 wäre ein
/// Fehlschlag aus dem falschen Grund.
#[tokio::test]
async fn patch_ohne_farbe_laesst_farbe_stehen() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let id = status_voll(&app, &admin, "Reserve").await;

    let (status, json) = anfrage(
        &app,
        "PATCH",
        &format!("/api/fahrzeug-status/{id}"),
        &admin,
        Some(r#"{"label":"umbenannt","kategorie":"gebunden","sortier":70}"#),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{json:?}");
    assert_eq!(json["label"], "umbenannt");
    assert_eq!(json["farbe"], "#ff0000", "nicht gesendetes Feld bleibt");
    assert_eq!(json["fms_anker"], 3, "nicht gesendetes Feld bleibt");
    assert_eq!(
        json["kategorie"], "gebunden",
        "nicht gesendetes Feld bleibt"
    );
}

#[tokio::test]
async fn patch_farbe_null_loescht_die_farbe() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let id = status_voll(&app, &admin, "Reserve").await;

    let (status, json) = anfrage(
        &app,
        "PATCH",
        &format!("/api/fahrzeug-status/{id}"),
        &admin,
        Some(r#"{"farbe":null,"fms_anker":null}"#),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{json:?}");
    assert!(json["farbe"].is_null(), "explizites null leert die Spalte");
    assert!(json["fms_anker"].is_null(), "explizites null leert");
    assert_eq!(json["label"], "Reserve", "Nachbarfeld unberührt");
}

/// Der schärfste Test gegen HEAD: `sortier` ist NOT NULL und trug am alten Body ein
/// `#[serde(default)]` — ein PATCH ohne `sortier` setzte die Spalte still auf 0 und
/// verschob den Eintrag in der Katalogliste.
///
/// Der Body ist bewusst **unter HEAD gültig** (alle Pflichtfelder da, nur `sortier` fehlt):
/// nur so schlägt der Test gegen HEAD mit dem echten Datenverlust fehl (200 + `sortier: 0`)
/// statt am Extractor — ein 400 wäre ein Fehlschlag aus dem falschen Grund.
#[tokio::test]
async fn patch_ohne_sortier_laesst_sortier_stehen() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let id = status_voll(&app, &admin, "Reserve").await;

    let (status, json) = anfrage(
        &app,
        "PATCH",
        &format!("/api/fahrzeug-status/{id}"),
        &admin,
        Some(r##"{"label":"Reserve","kategorie":"gebunden","farbe":"#00ff00","fms_anker":3}"##),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{json:?}");
    assert_eq!(json["farbe"], "#00ff00");
    assert_eq!(json["sortier"], 70, "nicht gesendetes sortier bleibt");
}

/// `fms_anker: 0` ist ein gültiger FMS-Status (Status 0 = „Priorisierter Sprechwunsch"),
/// KEIN Leerwunsch. Jede Implementierung, die `0` wie „leer" behandelt — Falsy-Prüfung
/// statt Tri-State — fällt hier durch.
#[tokio::test]
async fn patch_fms_anker_0_wird_gesetzt_nicht_geloescht() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let id = status_voll(&app, &admin, "Reserve").await;

    let (status, json) = anfrage(
        &app,
        "PATCH",
        &format!("/api/fahrzeug-status/{id}"),
        &admin,
        Some(r#"{"fms_anker":0}"#),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{json:?}");
    assert_eq!(json["fms_anker"], 0, "0 ist ein Wert, kein NULL");
    assert!(!json["fms_anker"].is_null());
}

/// Die Bereichsprüfung darf NUR beim gesendeten Wert greifen: ein Patch ohne `fms_anker`
/// kommt durch, ein Patch mit `fms_anker: 12` ist 400.
#[tokio::test]
async fn patch_fms_anker_ausserhalb_ist_400_absent_geht_durch() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let id = status_voll(&app, &admin, "Reserve").await;

    assert_eq!(
        anfrage(
            &app,
            "PATCH",
            &format!("/api/fahrzeug-status/{id}"),
            &admin,
            Some(r#"{"fms_anker":12}"#)
        )
        .await
        .0,
        StatusCode::BAD_REQUEST
    );
    assert_eq!(
        anfrage(
            &app,
            "PATCH",
            &format!("/api/fahrzeug-status/{id}"),
            &admin,
            Some(r#"{"label":"ok"}"#)
        )
        .await
        .0,
        StatusCode::OK,
        "ohne fms_anker darf die Bereichsprüfung nicht greifen"
    );
}

/// Vorhandenes, aber leeres Pflichtfeld → 400 (LFH-305-Konvention); absent geht durch.
/// Ebenso: unbekannter Enum-Wert nur bei gesendetem Feld.
#[tokio::test]
async fn patch_leeres_label_ist_400_absentes_geht_durch() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let id = status_voll(&app, &admin, "Reserve").await;

    assert_eq!(
        anfrage(
            &app,
            "PATCH",
            &format!("/api/fahrzeug-status/{id}"),
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
            &format!("/api/fahrzeug-status/{id}"),
            &admin,
            Some(r#"{"kategorie":"unsinn"}"#)
        )
        .await
        .0,
        StatusCode::BAD_REQUEST
    );
    // Leerer Patch: kein Pflichtfeld gesendet → nichts zu beanstanden.
    assert_eq!(
        anfrage(
            &app,
            "PATCH",
            &format!("/api/fahrzeug-status/{id}"),
            &admin,
            Some("{}")
        )
        .await
        .0,
        StatusCode::OK
    );
}
