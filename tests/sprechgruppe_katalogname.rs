//! LLH-1645: Katalog-Sprechgruppe und gleichnamige Einsatz-Sprechgruppe (gleiche Betriebsart)
//! schließen sich aus. Am Spiegel fiele das Paar auf eine Zeile (`instanz::spiegel::katalog`,
//! `gegenstueck`), deshalb sperrt der Führer beide Richtungen und meldet den Altbestand.

use axum::http::StatusCode;
use serde_json::Value;

mod common;
use common::{anfrage, einsatz_anlegen, einsatz_anlegen_mit, login_cookie, setup};

async fn katalog(app: &axum::Router, admin: &str, bezeichnung: &str, betriebsart: &str) -> i64 {
    let (status, json) = anfrage(
        app,
        "POST",
        "/api/sprechgruppen",
        admin,
        Some(&format!(
            r#"{{"bezeichnung":"{bezeichnung}","betriebsart":"{betriebsart}"}}"#
        )),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{json:?}");
    json["id"].as_i64().unwrap()
}

async fn lokal(
    app: &axum::Router,
    cookie: &str,
    einsatz: i64,
    bezeichnung: &str,
    betriebsart: &str,
) -> (StatusCode, Value) {
    anfrage(
        app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/sprechgruppen"),
        cookie,
        Some(&format!(
            r#"{{"bezeichnung":"{bezeichnung}","betriebsart":"{betriebsart}"}}"#
        )),
    )
    .await
}

async fn deaktivieren(app: &axum::Router, admin: &str, id: i64) {
    let (status, _) = anfrage(
        app,
        "POST",
        &format!("/api/sprechgruppen/{id}/deaktivieren"),
        admin,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::NO_CONTENT);
}

async fn fuehrungsstelle_zuordnen(app: &axum::Router, cookie: &str, einsatz: i64, sg: i64) {
    let (status, json) = anfrage(
        app,
        "PUT",
        &format!("/api/einsaetze/{einsatz}/fuehrungsstelle/sprechgruppen/{sg}"),
        cookie,
        None,
    )
    .await;
    assert!(status.is_success(), "{status} {json:?}");
}

async fn abschliessen(app: &axum::Router, admin: &str, einsatz: i64) {
    let (status, json) = anfrage(
        app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/abschliessen"),
        admin,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{json:?}");
}

async fn auch_lokal(app: &axum::Router, admin: &str) -> Vec<(i64, i64, String)> {
    let (status, json) = anfrage(app, "GET", "/api/sprechgruppen/auch-lokal", admin, None).await;
    assert_eq!(status, StatusCode::OK, "{json:?}");
    json.as_array()
        .unwrap()
        .iter()
        .map(|z| {
            (
                z["sprechgruppe_id"].as_i64().unwrap(),
                z["einsatz_id"].as_i64().unwrap(),
                z["einsatz"].as_str().unwrap().to_owned(),
            )
        })
        .collect()
}

// ---------- Richtung Einsatz ----------

#[tokio::test]
async fn einsatz_sprechgruppe_mit_namen_einer_aktiven_katalog_sprechgruppe_ist_409() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    katalog(&app, &admin, "412_F_DRK", "TMO").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;

    let (status, json) = lokal(&app, &admin, einsatz, "  412_F_DRK ", "TMO").await;
    assert_eq!(status, StatusCode::CONFLICT, "{json:?}");
    assert_eq!(
        json["error"],
        "Sprechgruppe „412_F_DRK“ (TMO) steht schon im Katalog"
    );

    // Andere Betriebsart ist eine andere Sprechgruppe.
    let (status, json) = lokal(&app, &admin, einsatz, "412_F_DRK", "DMO").await;
    assert_eq!(status, StatusCode::CREATED, "{json:?}");
}

#[tokio::test]
async fn deaktivierte_katalog_sprechgruppe_blockiert_nur_wo_sie_noch_genutzt_wird() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let sg = katalog(&app, &admin, "412_F_DRK", "TMO").await;
    let nutzt = einsatz_anlegen(&app, &admin).await;
    fuehrungsstelle_zuordnen(&app, &admin, nutzt, sg).await;
    deaktivieren(&app, &admin, sg).await;
    let frei = einsatz_anlegen(&app, &admin).await;

    // Der Einsatz, der sie noch nutzt, liefert sie an den Spiegel: gesperrt.
    let (status, json) = lokal(&app, &admin, nutzt, "412_F_DRK", "TMO").await;
    assert_eq!(status, StatusCode::CONFLICT, "{json:?}");
    // Ein anderer Einsatz kennt sie nicht: frei.
    let (status, json) = lokal(&app, &admin, frei, "412_F_DRK", "TMO").await;
    assert_eq!(status, StatusCode::CREATED, "{json:?}");
}

// ---------- Richtung Katalog ----------

#[tokio::test]
async fn katalog_sprechgruppe_mit_namen_einer_einsatz_sprechgruppe_im_laufenden_einsatz_ist_409() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen_mit(&app, &admin, "Hochwasser Elbe").await;
    let (status, _) = lokal(&app, &admin, einsatz, "Sonder 1", "DMO").await;
    assert_eq!(status, StatusCode::CREATED);

    let (status, json) = anfrage(
        &app,
        "POST",
        "/api/sprechgruppen",
        &admin,
        Some(r#"{"bezeichnung":"Sonder 1","betriebsart":"DMO"}"#),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT, "{json:?}");
    assert_eq!(
        json["error"],
        "„Sonder 1“ (DMO) ist im Einsatz „Hochwasser Elbe“ als Einsatz-Sprechgruppe angelegt"
    );
    let (_, liste) = anfrage(&app, "GET", "/api/sprechgruppen", &admin, None).await;
    assert!(
        liste.as_array().unwrap().is_empty(),
        "abgelehnt heißt nicht angelegt: {liste:?}"
    );

    // Umbenennen einer vorhandenen Katalog-Sprechgruppe auf den Namen: ebenso, und sie bleibt.
    let sg = katalog(&app, &admin, "Sonder 2", "DMO").await;
    let (status, json) = anfrage(
        &app,
        "PATCH",
        &format!("/api/sprechgruppen/{sg}"),
        &admin,
        Some(r#"{"bezeichnung":"Sonder 1"}"#),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT, "{json:?}");
    let (_, liste) = anfrage(&app, "GET", "/api/sprechgruppen", &admin, None).await;
    assert_eq!(liste[0]["bezeichnung"], "Sonder 2");

    // Die andere Betriebsart ist frei.
    katalog(&app, &admin, "Sonder 1", "TMO").await;
}

#[tokio::test]
async fn abgeschlossener_einsatz_blockiert_den_katalog_nicht() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let (status, _) = lokal(&app, &admin, einsatz, "Sonder 1", "DMO").await;
    assert_eq!(status, StatusCode::CREATED);
    abschliessen(&app, &admin, einsatz).await;

    // Erst lokal benutzt, danach in den Katalog übernommen.
    katalog(&app, &admin, "Sonder 1", "DMO").await;
    assert!(auch_lokal(&app, &admin).await.is_empty());
}

#[tokio::test]
async fn umbenennen_auf_einen_namen_im_nutzenden_abgeschlossenen_einsatz_ist_409() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let sg = katalog(&app, &admin, "412_F_DRK", "TMO").await;
    let einsatz = einsatz_anlegen_mit(&app, &admin, "Stadtfest").await;
    fuehrungsstelle_zuordnen(&app, &admin, einsatz, sg).await;
    let (status, _) = lokal(&app, &admin, einsatz, "Sonder 1", "TMO").await;
    assert_eq!(status, StatusCode::CREATED);
    abschliessen(&app, &admin, einsatz).await;

    // Der Einsatz liefert die Katalogzeile weiter; umbenannt fiele sie am Spiegel auf „Sonder 1“.
    let (status, json) = anfrage(
        &app,
        "PATCH",
        &format!("/api/sprechgruppen/{sg}"),
        &admin,
        Some(r#"{"bezeichnung":"Sonder 1"}"#),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT, "{json:?}");
    assert_eq!(
        json["error"],
        "„Sonder 1“ (TMO) ist im Einsatz „Stadtfest“ als Einsatz-Sprechgruppe angelegt"
    );
}

#[tokio::test]
async fn meldung_nennt_hoechstens_drei_einsaetze() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    for name in ["A", "B", "C", "D", "E"] {
        let e = einsatz_anlegen_mit(&app, &admin, name).await;
        let (status, _) = lokal(&app, &admin, e, "Sonder 1", "DMO").await;
        assert_eq!(status, StatusCode::CREATED);
    }
    let (status, json) = anfrage(
        &app,
        "POST",
        "/api/sprechgruppen",
        &admin,
        Some(r#"{"bezeichnung":"Sonder 1","betriebsart":"DMO"}"#),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT);
    assert_eq!(
        json["error"],
        "„Sonder 1“ (DMO) ist in den Einsätzen „A“, „B“, „C“ und 2 weiteren als \
         Einsatz-Sprechgruppe angelegt"
    );
}

// ---------- Altbestand ----------

#[tokio::test]
async fn altbestand_wird_erkannt_und_nur_fuer_admins_gezeigt() {
    let (app, pool) = common::setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let sg = katalog(&app, &admin, "412_F_DRK", "TMO").await;
    let einsatz = einsatz_anlegen_mit(&app, &admin, "Hochwasser Elbe").await;
    // Paar aus der Zeit vor der Sperre: direkt in die Tabelle.
    sqlx::query(
        "INSERT INTO sprechgruppe (org_id, einsatz_id, bezeichnung, betriebsart) \
         SELECT org_id, id, '412_F_DRK', 'TMO' FROM einsatz WHERE id = ?",
    )
    .bind(einsatz)
    .execute(&pool)
    .await
    .unwrap();

    assert_eq!(
        auch_lokal(&app, &admin).await,
        vec![(sg, einsatz, "Hochwasser Elbe".to_owned())]
    );

    common::benutzer_anlegen(&app, &admin, "erika", "keine").await;
    let erika = login_cookie(&app, "erika", "erikapw1").await;
    let (status, _) = anfrage(&app, "GET", "/api/sprechgruppen/auch-lokal", &erika, None).await;
    assert_eq!(status, StatusCode::FORBIDDEN);

    // Hinweis, Netz und Sicherheit bleiben pflegbar: der Name ändert sich nicht.
    let (status, json) = anfrage(
        &app,
        "PATCH",
        &format!("/api/sprechgruppen/{sg}"),
        &admin,
        Some(r#"{"bezeichnung":"412_F_DRK","betriebsart":"TMO","hinweis":"Führungskanal"}"#),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{json:?}");

    // Zuordnen stiftete das Paar erst im Einsatz: abgelehnt.
    let (status, json) = anfrage(
        &app,
        "PUT",
        &format!("/api/einsaetze/{einsatz}/fuehrungsstelle/sprechgruppen/{sg}"),
        &admin,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT, "{json:?}");
    assert_eq!(
        json["error"],
        "„412_F_DRK“ (TMO) ist in diesem Einsatz schon als Einsatz-Sprechgruppe angelegt"
    );

    // Deaktiviert und im Einsatz nicht genutzt: kein Paar mehr.
    deaktivieren(&app, &admin, sg).await;
    assert!(auch_lokal(&app, &admin).await.is_empty());
}

#[tokio::test]
async fn deaktivierte_katalog_sprechgruppe_neben_gleichnamiger_lokaler_ist_nicht_zuordenbar() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let sg = katalog(&app, &admin, "412_F_DRK", "TMO").await;
    deaktivieren(&app, &admin, sg).await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let (status, _) = lokal(&app, &admin, einsatz, "412_F_DRK", "TMO").await;
    assert_eq!(status, StatusCode::CREATED);

    let (status, json) = anfrage(
        &app,
        "PUT",
        &format!("/api/einsaetze/{einsatz}/fuehrungsstelle/sprechgruppen/{sg}"),
        &admin,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT, "{json:?}");

    // Ohne gleichnamige lokale bleibt sie zuordenbar wie bisher.
    let anderer = einsatz_anlegen(&app, &admin).await;
    fuehrungsstelle_zuordnen(&app, &admin, anderer, sg).await;
}
