//! Integrationstests zu LLH-1082: eine Nachforderung verweist auf die Betreuungsstelle, für die
//! sie angefordert wurde (`betreuungsstelle_id`). Geprüft werden die Prüfkette beim Anlegen
//! (403 → 404 → 409, geschlossen erlaubt), der Storno der Stelle (löst den Bezug, die
//! Nachforderung bleibt) und die Mengenwahrheit (LFH-553): die Stelle selbst trägt nichts davon.
//!
//! Die Schwärzung prüft `einsatz::purge_scheduler`, die Spalte `db::tests::migration_0227_*`.

use axum::http::StatusCode;
use serde_json::Value;

mod common;
use common::*;

fn nachforderungen(einsatz: i64) -> String {
    format!("/api/einsaetze/{einsatz}/nachforderungen")
}

async fn stelle(app: &axum::Router, cookie: &str, einsatz: i64, bezeichnung: &str) -> i64 {
    let (s, json) = anfrage(
        app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/betreuung/stellen"),
        cookie,
        Some(&format!(
            r#"{{"bezeichnung":"{bezeichnung}","art":"notunterkunft","kapazitaet_personen":150}}"#
        )),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "Stelle: {json:?}");
    json["id"].as_i64().unwrap()
}

/// Eine Nachforderung „40× Feldbetten“, optional mit Stellenbezug.
async fn anlegen(
    app: &axum::Router,
    cookie: &str,
    einsatz: i64,
    stelle: Option<i64>,
) -> (StatusCode, Value) {
    let mut body = serde_json::json!({
        "art": "Feldbetten", "bezeichnung": "Feldbetten für die Nacht", "anzahl": 40,
        "adressat_kategorie": "leitstelle",
        "begruendung": "Für Betreuungsstelle Turnhalle Ost"
    });
    if let Some(sid) = stelle {
        body["betreuungsstelle_id"] = sid.into();
    }
    anfrage(
        app,
        "POST",
        &nachforderungen(einsatz),
        cookie,
        Some(&body.to_string()),
    )
    .await
}

async fn liste(app: &axum::Router, cookie: &str, einsatz: i64) -> Vec<Value> {
    let (s, json) = anfrage(app, "GET", &nachforderungen(einsatz), cookie, None).await;
    assert_eq!(s, StatusCode::OK, "{json:?}");
    json.as_array().unwrap().clone()
}

async fn stellen_der_uebersicht(app: &axum::Router, cookie: &str, einsatz: i64) -> Vec<Value> {
    let (s, json) = anfrage(
        app,
        "GET",
        &format!("/api/einsaetze/{einsatz}/betreuung"),
        cookie,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{json:?}");
    json["stellen"].as_array().unwrap().clone()
}

async fn stelle_stornieren(app: &axum::Router, cookie: &str, einsatz: i64, sid: i64) {
    let (s, json) = anfrage(
        app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/betreuung/stellen/{sid}/stornieren"),
        cookie,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK, "Storno: {json:?}");
}

async fn modul_ausblenden(app: &axum::Router, admin: &str, einsatz: i64, modul: &str) {
    let (s, j) = anfrage(
        app,
        "PUT",
        &format!("/api/einsaetze/{einsatz}/modul-overrides/{modul}"),
        admin,
        Some(r#"{"sichtbar":false,"benoetigte_rolle":null}"#),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "Override {modul}: {j:?}");
}

/// Eine Führungskraft im Einsatz (Schreibrecht, kein Admin — Admins sehen jedes Modul).
async fn fuehrung(app: &axum::Router, admin: &str, einsatz: i64, name: &str) -> String {
    let id = benutzer_anlegen(app, admin, name, "keine").await;
    rolle_setzen(app, admin, einsatz, id, "fuehrungspersonal").await;
    login_cookie(app, name, &format!("{name}pw1")).await
}

#[tokio::test]
async fn nachforderung_mit_gueltiger_stelle_traegt_den_bezug() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let sid = stelle(&app, &admin, e, "Turnhalle Ost").await;

    let (s, n) = anlegen(&app, &admin, e, Some(sid)).await;
    assert_eq!(s, StatusCode::CREATED, "{n:?}");
    assert_eq!(n["betreuungsstelle_id"], sid);
    assert_eq!(n["anzahl"], 40);
    assert_eq!(n["status"], "angefordert");
    // Nur die Kennung: kein Stellenname im DTO (design.md D4).
    assert!(n.get("betreuungsstelle").is_none());
    assert!(n.get("betreuungsstelle_bezeichnung").is_none());

    let alle = liste(&app, &admin, e).await;
    assert_eq!(alle.len(), 1);
    assert_eq!(alle[0]["betreuungsstelle_id"], sid);
}

#[tokio::test]
async fn ohne_bezug_fehlt_das_feld() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let (s, n) = anlegen(&app, &admin, e, None).await;
    assert_eq!(s, StatusCode::CREATED, "{n:?}");
    assert!(
        !n.as_object().unwrap().contains_key("betreuungsstelle_id"),
        "{n:?}"
    );
}

#[tokio::test]
async fn stelle_eines_anderen_einsatzes_oder_unbekannt_ist_404() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let fremder = einsatz_anlegen(&app, &admin).await;
    let fremde_stelle = stelle(&app, &admin, fremder, "NU Fremd").await;

    for ziel in [fremde_stelle, 999_999] {
        let (s, j) = anlegen(&app, &admin, e, Some(ziel)).await;
        assert_eq!(s, StatusCode::NOT_FOUND, "Stelle {ziel}: {j:?}");
    }
    assert!(liste(&app, &admin, e).await.is_empty(), "nichts angelegt");
}

#[tokio::test]
async fn stornierte_stelle_ist_409() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let sid = stelle(&app, &admin, e, "NU Fehlanlage").await;
    stelle_stornieren(&app, &admin, e, sid).await;

    let (s, j) = anlegen(&app, &admin, e, Some(sid)).await;
    assert_eq!(s, StatusCode::CONFLICT, "{j:?}");
    assert!(liste(&app, &admin, e).await.is_empty(), "nichts angelegt");
}

#[tokio::test]
async fn geschlossene_stelle_ist_zulaessig() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let sid = stelle(&app, &admin, e, "NU Abbau").await;
    let (s, j) = anfrage(
        &app,
        "PATCH",
        &format!("/api/einsaetze/{e}/betreuung/stellen/{sid}"),
        &admin,
        Some(r#"{"status":"geschlossen"}"#),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{j:?}");

    let (s, n) = anlegen(&app, &admin, e, Some(sid)).await;
    assert_eq!(s, StatusCode::CREATED, "{n:?}");
    assert_eq!(n["betreuungsstelle_id"], sid);
}

/// Ohne Lesezugriff auf das Modul Betreuung: 403 — auch für eine Stelle, die es nicht gibt
/// (sonst verriete 404 gegen 409 die Existenz). Ohne Bezug bleibt die Nachforderung möglich.
#[tokio::test]
async fn ohne_betreuungsrecht_ist_bezug_403_auch_fuer_unbekannte_stelle() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let sid = stelle(&app, &admin, e, "NU Nord").await;
    let frieda = fuehrung(&app, &admin, e, "frieda").await;
    modul_ausblenden(&app, &admin, e, "betreuung").await;

    for ziel in [sid, 999_999] {
        let (s, j) = anlegen(&app, &frieda, e, Some(ziel)).await;
        assert_eq!(s, StatusCode::FORBIDDEN, "Stelle {ziel}: {j:?}");
    }
    assert!(liste(&app, &frieda, e).await.is_empty());

    let (s, j) = anlegen(&app, &frieda, e, None).await;
    assert_eq!(
        s,
        StatusCode::CREATED,
        "ohne Bezug kein Betreuungsrecht nötig: {j:?}"
    );
}

/// design.md D3: der Storno der Stelle lässt die Nachforderung bestehen (Status, Anzahl,
/// Begründung unverändert) und löst den Bezug; Nachforderungen anderer Stellen behalten ihn.
#[tokio::test]
async fn storno_der_stelle_loest_den_bezug_und_laesst_die_nachforderung_bestehen() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let fehlanlage = stelle(&app, &admin, e, "NU Fehlanlage").await;
    let andere = stelle(&app, &admin, e, "NU Bleibt").await;
    let (_, n) = anlegen(&app, &admin, e, Some(fehlanlage)).await;
    let (_, m) = anlegen(&app, &admin, e, Some(andere)).await;
    let (s, j) = anfrage(
        &app,
        "POST",
        &format!("{}/{}/status", nachforderungen(e), n["id"]),
        &admin,
        Some(r#"{"status":"zugesagt"}"#),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{j:?}");

    stelle_stornieren(&app, &admin, e, fehlanlage).await;

    let alle = liste(&app, &admin, e).await;
    assert_eq!(alle.len(), 2, "beide Nachforderungen bestehen");
    let geloest = alle.iter().find(|x| x["id"] == n["id"]).unwrap();
    assert!(
        !geloest
            .as_object()
            .unwrap()
            .contains_key("betreuungsstelle_id"),
        "Bezug geloest: {geloest:?}"
    );
    assert_eq!(geloest["status"], "zugesagt");
    assert_eq!(geloest["anzahl"], 40);
    assert_eq!(geloest["begruendung"], "Für Betreuungsstelle Turnhalle Ost");
    let bleibt = alle.iter().find(|x| x["id"] == m["id"]).unwrap();
    assert_eq!(bleibt["betreuungsstelle_id"], andere);
}

/// LFH-553 (Spec `stab-versorgung`, „Eine Mengenwahrheit“): der Bedarf steht nur als
/// Nachforderung. Die Stelle in der Betreuungsübersicht ist vor und nach dem Anlegen dieselbe.
#[tokio::test]
async fn die_stelle_traegt_keine_menge_des_bedarfs() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let sid = stelle(&app, &admin, e, "Turnhalle Ost").await;
    let vorher = stellen_der_uebersicht(&app, &admin, e).await;

    let (s, n) = anlegen(&app, &admin, e, Some(sid)).await;
    assert_eq!(s, StatusCode::CREATED, "{n:?}");

    assert_eq!(stellen_der_uebersicht(&app, &admin, e).await, vorher);
}
