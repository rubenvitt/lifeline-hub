//! Integrationstests des **Sprechgruppen-Katalogs** (`/api/sprechgruppen`) — Schwerpunkt
//! LFH-306: echter Teil-PATCH statt Vollersatz.
//!
//! Eigene Datei, damit die Katalog-Zusagen per `cargo test --test sprechgruppe_katalog`
//! einzeln fahrbar sind; die einsatz-lokalen Sprechgruppen sind bewusst nicht hier.

use axum::http::StatusCode;

mod common;
use common::{anfrage, benutzer_anlegen, login_cookie, setup};

/// Legt einen Katalog-Eintrag mit ALLEN Feldern gesetzt an und liefert seine id.
async fn katalog_anlegen(
    app: &axum::Router,
    admin: &str,
    bezeichnung: &str,
    hinweis: &str,
    sortier: i64,
) -> i64 {
    let (status, json) = anfrage(
        app,
        "POST",
        "/api/sprechgruppen",
        admin,
        Some(&format!(
            r#"{{"bezeichnung":"{bezeichnung}","betriebsart":"TMO","hinweis":"{hinweis}","sortier":{sortier}}}"#
        )),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{json:?}");
    json["id"].as_i64().unwrap()
}

// ---------- Grundzusagen (Berechtigung, Anlegen, Deaktivieren) ----------

#[tokio::test]
async fn alle_lesen_admin_legt_an() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    benutzer_anlegen(&app, &admin, "erika", "keine").await;
    let erika = login_cookie(&app, "erika", "erikapw1").await;

    assert_eq!(
        anfrage(&app, "GET", "/api/sprechgruppen", &erika, None)
            .await
            .0,
        StatusCode::OK
    );
    assert_eq!(
        anfrage(
            &app,
            "POST",
            "/api/sprechgruppen",
            &erika,
            Some(r#"{"bezeichnung":"412_F_DRK","betriebsart":"TMO"}"#)
        )
        .await
        .0,
        StatusCode::FORBIDDEN
    );
    let id = katalog_anlegen(&app, &admin, "412_F_DRK", "Marschkanal", 30).await;

    // Dublette (Bezeichnung + Betriebsart) → Conflict.
    assert_eq!(
        anfrage(
            &app,
            "POST",
            "/api/sprechgruppen",
            &admin,
            Some(r#"{"bezeichnung":"412_F_DRK","betriebsart":"TMO"}"#)
        )
        .await
        .0,
        StatusCode::CONFLICT
    );

    assert_eq!(
        anfrage(
            &app,
            "POST",
            &format!("/api/sprechgruppen/{id}/deaktivieren"),
            &admin,
            None
        )
        .await
        .0,
        StatusCode::NO_CONTENT
    );
    let (_, liste) = anfrage(&app, "GET", "/api/sprechgruppen", &admin, None).await;
    assert!(liste.as_array().unwrap().is_empty());
}

#[tokio::test]
async fn unbekannte_id_ist_404() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    assert_eq!(
        anfrage(
            &app,
            "PATCH",
            "/api/sprechgruppen/9999",
            &admin,
            Some(r#"{"bezeichnung":"X"}"#)
        )
        .await
        .0,
        StatusCode::NOT_FOUND
    );
}

// ---------- LFH-306: Teil-PATCH mit Tri-State ----------

/// **Der wichtigste Test dieser Route** — und der einzige Verlustpfad des ganzen Tickets,
/// der heute bis in die UI durchschlägt:
///
/// `SprechgruppeFormModal` sendet beim Bearbeiten `{bezeichnung, betriebsart, hinweis}`
/// OHNE `sortier`. Der alte Vollersatz-Body trug `#[serde(default)] sortier: i64`, also
/// wurde „nicht gesendet" zu „auf 0 setzen": jede Hinweis-Änderung hat die Sortierung
/// zurückgesetzt und den Eintrag in der Katalogliste verschoben — ohne Fehler, ohne
/// Hinweis, ohne roten Test. Genau dieser Body steht unten.
#[tokio::test]
async fn patch_ohne_sortier_behaelt_sortier() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let id = katalog_anlegen(&app, &admin, "412_F_DRK", "Marschkanal", 30).await;

    let (status, json) = anfrage(
        &app,
        "PATCH",
        &format!("/api/sprechgruppen/{id}"),
        &admin,
        // Exakt der Body, den das Formular schickt: kein `sortier`.
        Some(r#"{"bezeichnung":"412_F_DRK","betriebsart":"TMO","hinweis":"Neuer Hinweis"}"#),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{json:?}");
    assert_eq!(json["hinweis"], "Neuer Hinweis");
    assert_eq!(
        json["sortier"], 30,
        "nicht gesendetes sortier darf nicht auf 0 fallen"
    );
}

/// **Der unterscheidende Test.** Zusammen mit `patch_hinweis_null_loescht_hinweis` bildet
/// er das Paar, das den Tri-State beweist: HIER ist `hinweis` nicht im Body und muss stehen
/// bleiben, DORT steht `null` im Body und muss löschen. Unter dem alten Vollersatz war
/// beides ununterscheidbar — das fehlende Feld nullte die Spalte.
///
/// Der Body ist bewusst **unter HEAD gültig** (`bezeichnung`/`betriebsart`/`sortier` alle
/// da, nur `hinweis` fehlt): so schlägt der Test gegen HEAD mit dem echten Datenverlust
/// fehl (200 + `hinweis: null`) statt am Extractor — ein 400 wäre ein Fehlschlag aus dem
/// falschen Grund.
#[tokio::test]
async fn patch_ohne_hinweis_laesst_hinweis_stehen() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let id = katalog_anlegen(&app, &admin, "412_F_DRK", "Marschkanal", 30).await;

    let (status, json) = anfrage(
        &app,
        "PATCH",
        &format!("/api/sprechgruppen/{id}"),
        &admin,
        Some(r#"{"bezeichnung":"490_F_DRK","betriebsart":"TMO","sortier":30}"#),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{json:?}");
    assert_eq!(json["bezeichnung"], "490_F_DRK");
    assert_eq!(
        json["hinweis"], "Marschkanal",
        "nicht gesendetes Feld bleibt"
    );
    assert_eq!(json["betriebsart"], "TMO", "nicht gesendetes Feld bleibt");
    assert_eq!(json["sortier"], 30, "nicht gesendetes Feld bleibt");
}

#[tokio::test]
async fn patch_hinweis_null_loescht_hinweis() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let id = katalog_anlegen(&app, &admin, "412_F_DRK", "Marschkanal", 30).await;

    let (status, json) = anfrage(
        &app,
        "PATCH",
        &format!("/api/sprechgruppen/{id}"),
        &admin,
        Some(r#"{"hinweis":null}"#),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{json:?}");
    assert!(
        json["hinweis"].is_null(),
        "explizites null leert die Spalte"
    );
    assert_eq!(json["bezeichnung"], "412_F_DRK", "Nachbarfeld unberührt");
    assert_eq!(json["sortier"], 30, "Nachbarfeld unberührt");
}

/// `""` ist der zweite Weg zum Leerwunsch (`trimme_tri`) — die Formulare schicken bei
/// geleertem Eingabefeld einen Leerstring, kein `null`.
#[tokio::test]
async fn patch_hinweis_leerstring_loescht_hinweis() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let id = katalog_anlegen(&app, &admin, "412_F_DRK", "Marschkanal", 30).await;

    let (status, json) = anfrage(
        &app,
        "PATCH",
        &format!("/api/sprechgruppen/{id}"),
        &admin,
        Some(r#"{"hinweis":"   "}"#),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{json:?}");
    assert!(json["hinweis"].is_null());
}

/// Vorhandenes, aber leeres Pflichtfeld → 400, unbekannter Enum-Wert → 400
/// (LFH-305-Konvention). Beides darf NUR beim gesendeten Feld greifen.
#[tokio::test]
async fn patch_leere_bezeichnung_und_falsche_betriebsart_sind_400() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let id = katalog_anlegen(&app, &admin, "412_F_DRK", "Marschkanal", 30).await;
    let u = format!("/api/sprechgruppen/{id}");

    assert_eq!(
        anfrage(&app, "PATCH", &u, &admin, Some(r#"{"bezeichnung":"  "}"#))
            .await
            .0,
        StatusCode::BAD_REQUEST
    );
    assert_eq!(
        anfrage(&app, "PATCH", &u, &admin, Some(r#"{"betriebsart":"XX"}"#))
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

/// Umbenennen auf ein aktives Geschwister derselben Betriebsart → 409 (Unique-Index).
/// Die Conflict-Zusage darf der Teil-Patch nicht verlieren.
#[tokio::test]
async fn patch_auf_geschwister_ist_409() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    katalog_anlegen(&app, &admin, "412_F_DRK", "A", 10).await;
    let zweite = katalog_anlegen(&app, &admin, "490_F_DRK", "B", 20).await;

    assert_eq!(
        anfrage(
            &app,
            "PATCH",
            &format!("/api/sprechgruppen/{zweite}"),
            &admin,
            Some(r#"{"bezeichnung":"412_F_DRK"}"#)
        )
        .await
        .0,
        StatusCode::CONFLICT
    );
}

/// Nicht-Admin darf den Katalog nicht patchen.
#[tokio::test]
async fn patch_nicht_admin_ist_403() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let id = katalog_anlegen(&app, &admin, "412_F_DRK", "Marschkanal", 30).await;
    benutzer_anlegen(&app, &admin, "erika", "keine").await;
    let erika = login_cookie(&app, "erika", "erikapw1").await;

    assert_eq!(
        anfrage(
            &app,
            "PATCH",
            &format!("/api/sprechgruppen/{id}"),
            &erika,
            Some(r#"{"bezeichnung":"X"}"#)
        )
        .await
        .0,
        StatusCode::FORBIDDEN
    );
}
