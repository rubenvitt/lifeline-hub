//! Integrationstests zu LFH-674: ein Verbleib „Notunterkunft“ verweist auf eine
//! Betreuungsstelle. Geprüft wird, was erst die Routen leisten: die Prüfkette aus design.md D2
//! (422 → 403 → 404 → 409, geschlossen erlaubt), „davon namentlich“ nur für Lesende mit
//! Personenrecht, und die Gegenprobe, dass die Zahl in keine Mengenaussage eingeht.
//!
//! Den Cache und die Zählung selbst prüfen `person::verbleib_repo` und `person::repo`.

use axum::http::StatusCode;
use serde_json::Value;

mod common;
use common::*;

fn betreuung(einsatz: i64) -> String {
    format!("/api/einsaetze/{einsatz}/betreuung")
}

async fn stelle(app: &axum::Router, cookie: &str, einsatz: i64, bezeichnung: &str) -> i64 {
    let (s, json) = anfrage(
        app,
        "POST",
        &format!("{}/stellen", betreuung(einsatz)),
        cookie,
        Some(&format!(
            r#"{{"bezeichnung":"{bezeichnung}","art":"notunterkunft","kapazitaet_personen":150}}"#
        )),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "Stelle: {json:?}");
    json["id"].as_i64().unwrap()
}

async fn person(app: &axum::Router, cookie: &str, einsatz: i64) -> i64 {
    let (s, json) = anfrage(
        app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/personen"),
        cookie,
        Some("{}"),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "Person: {json:?}");
    json["id"].as_i64().unwrap()
}

async fn verbleib(
    app: &axum::Router,
    cookie: &str,
    einsatz: i64,
    person: i64,
    body: &str,
) -> (StatusCode, Value) {
    anfrage(
        app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/personen/{person}/verbleib"),
        cookie,
        Some(body),
    )
    .await
}

async fn person_detail(app: &axum::Router, cookie: &str, einsatz: i64, person: i64) -> Value {
    let (s, json) = anfrage(
        app,
        "GET",
        &format!("/api/einsaetze/{einsatz}/personen/{person}"),
        cookie,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{json:?}");
    json
}

async fn verbleib_anzahl(app: &axum::Router, cookie: &str, einsatz: i64, person: i64) -> usize {
    person_detail(app, cookie, einsatz, person).await["verbleib"]
        .as_array()
        .unwrap()
        .len()
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

async fn system_etb(app: &axum::Router, cookie: &str, einsatz: i64) -> Vec<String> {
    let (_, json) = anfrage(
        app,
        "GET",
        &format!("/api/einsaetze/{einsatz}/etb"),
        cookie,
        None,
    )
    .await;
    json.as_array()
        .unwrap()
        .iter()
        .filter(|e| e["typ"] == "system")
        .map(|e| e["inhalt"].as_str().unwrap().to_string())
        .collect()
}

// ---------- Schreibweg (design.md D2) ----------

#[tokio::test]
async fn notunterkunft_mit_stelle_setzt_verweis_im_ereignis_und_im_cache() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let sid = stelle(&app, &admin, e, "NU Turnhalle Nord").await;
    let p = person(&app, &admin, e).await;

    let (s, v) = verbleib(
        &app,
        &admin,
        e,
        p,
        &format!(
            r#"{{"art":"notunterkunft","betreuungsstelle_id":{sid},"ziel":"NU Turnhalle Nord"}}"#
        ),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{v:?}");
    assert_eq!(v["betreuungsstelle_id"], sid);
    assert_eq!(v["ziel"], "NU Turnhalle Nord");

    let detail = person_detail(&app, &admin, e, p).await;
    assert_eq!(detail["aktuelle_verbleib_betreuungsstelle_id"], sid);
    assert_eq!(detail["verbleib"][0]["betreuungsstelle_id"], sid);
}

#[tokio::test]
async fn stelle_ohne_ziel_setzt_keinen_stellennamen_in_kurzform_und_etb() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let sid = stelle(&app, &admin, e, "NU Turnhalle Nord").await;
    let p = person(&app, &admin, e).await;

    let (s, v) = verbleib(
        &app,
        &admin,
        e,
        p,
        &format!(r#"{{"art":"notunterkunft","betreuungsstelle_id":{sid}}}"#),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{v:?}");
    assert!(!v.as_object().unwrap().contains_key("ziel") || v["ziel"].is_null());
    let detail = person_detail(&app, &admin, e, p).await;
    assert_eq!(detail["aktueller_verbleib"], "Notunterkunft");
    assert!(
        !detail
            .as_object()
            .unwrap()
            .contains_key("aktuelles_verbleib_ziel"),
        "der Server kopiert keinen Namen ins Ziel"
    );
    // Nur die Einträge der Person: das Modul Betreuung schreibt beim Anlegen der Stelle
    // seine Bezeichnung selbst ins ETB, das ist nicht der Verbleib.
    let etb: Vec<String> = system_etb(&app, &admin, e)
        .await
        .into_iter()
        .filter(|i| i.starts_with("Person "))
        .collect();
    assert!(
        etb.iter().any(|i| i.contains("in Notunterkunft")),
        "Vorbedingung: der Verbleib steht im ETB: {etb:?}"
    );
    assert!(
        etb.iter().all(|i| !i.contains("Turnhalle Nord")),
        "kein Stellenname im ETB des Verbleibs: {etb:?}"
    );
}

#[tokio::test]
async fn verweis_bei_anderer_art_ist_422() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let sid = stelle(&app, &admin, e, "NU Nord").await;
    let p = person(&app, &admin, e).await;
    let (s, _) = verbleib(
        &app,
        &admin,
        e,
        p,
        &format!(r#"{{"art":"transport","ziel":"KH Mitte","betreuungsstelle_id":{sid}}}"#),
    )
    .await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(verbleib_anzahl(&app, &admin, e, p).await, 0);
}

#[tokio::test]
async fn stelle_eines_anderen_einsatzes_oder_unbekannt_ist_404() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let e2 = einsatz_anlegen(&app, &admin).await;
    let fremd = stelle(&app, &admin, e2, "NU Fremd").await;
    let p = person(&app, &admin, e).await;
    for sid in [fremd, 999_999] {
        let (s, _) = verbleib(
            &app,
            &admin,
            e,
            p,
            &format!(r#"{{"art":"notunterkunft","betreuungsstelle_id":{sid}}}"#),
        )
        .await;
        assert_eq!(s, StatusCode::NOT_FOUND, "Stelle {sid}");
    }
    assert_eq!(verbleib_anzahl(&app, &admin, e, p).await, 0);
}

#[tokio::test]
async fn stornierte_stelle_ist_409_geschlossene_ist_erlaubt() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let storniert = stelle(&app, &admin, e, "NU Storniert").await;
    let (s, j) = anfrage(
        &app,
        "POST",
        &format!("{}/stellen/{storniert}/stornieren", betreuung(e)),
        &admin,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{j:?}");
    let geschlossen = stelle(&app, &admin, e, "NU Geschlossen").await;
    let (s, j) = anfrage(
        &app,
        "PATCH",
        &format!("{}/stellen/{geschlossen}", betreuung(e)),
        &admin,
        Some(r#"{"status":"geschlossen"}"#),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{j:?}");
    assert_eq!(j["status"], "geschlossen");
    let p = person(&app, &admin, e).await;

    let (s, _) = verbleib(
        &app,
        &admin,
        e,
        p,
        &format!(r#"{{"art":"notunterkunft","betreuungsstelle_id":{storniert}}}"#),
    )
    .await;
    assert_eq!(s, StatusCode::CONFLICT);
    assert_eq!(verbleib_anzahl(&app, &admin, e, p).await, 0);

    let (s, v) = verbleib(
        &app,
        &admin,
        e,
        p,
        &format!(r#"{{"art":"notunterkunft","betreuungsstelle_id":{geschlossen}}}"#),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{v:?}");
    assert_eq!(v["betreuungsstelle_id"], geschlossen);
}

/// Ohne Lesezugriff auf das Modul Betreuung: 403 — auch für eine Stelle, die es nicht gibt
/// (sonst verriete 404 gegen 409 die Existenz). Ohne Verweis bleibt der Verbleib erfassbar.
#[tokio::test]
async fn ohne_betreuungsrecht_ist_verweis_403_auch_fuer_unbekannte_stelle() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let sid = stelle(&app, &admin, e, "NU Nord").await;
    let frieda = fuehrung(&app, &admin, e, "frieda").await;
    modul_ausblenden(&app, &admin, e, "betreuung").await;
    let p = person(&app, &frieda, e).await;

    for ziel in [sid, 999_999] {
        let (s, _) = verbleib(
            &app,
            &frieda,
            e,
            p,
            &format!(r#"{{"art":"notunterkunft","betreuungsstelle_id":{ziel}}}"#),
        )
        .await;
        assert_eq!(s, StatusCode::FORBIDDEN, "Stelle {ziel}");
    }
    assert_eq!(verbleib_anzahl(&app, &frieda, e, p).await, 0);

    let (s, _) = verbleib(
        &app,
        &frieda,
        e,
        p,
        r#"{"art":"notunterkunft","ziel":"Turnhalle Ost"}"#,
    )
    .await;
    assert_eq!(
        s,
        StatusCode::CREATED,
        "ohne Verweis kein Betreuungsrecht nötig"
    );
}

// ---------- „davon namentlich“ (design.md D4) ----------

/// Zwei Personen mit Stelle, Belegung 40 gemeldet: die Übersicht nennt 2 namentlich — die
/// Mengenaussagen (Belegung, Kopfzahl) bleiben 40.
async fn lage_mit_zwei_namentlichen(app: &axum::Router, admin: &str) -> (i64, i64) {
    let e = einsatz_anlegen(app, admin).await;
    let sid = stelle(app, admin, e, "NU Turnhalle Nord").await;
    let _leer = stelle(app, admin, e, "NU Leer").await;
    let (s, j) = anfrage(
        app,
        "PATCH",
        &format!("{}/stellen/{sid}", betreuung(e)),
        admin,
        Some(r#"{"status":"in_betrieb"}"#),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{j:?}");
    let (s, j) = anfrage(
        app,
        "POST",
        &format!("{}/stellen/{sid}/belegungen", betreuung(e)),
        admin,
        Some(r#"{"belegt":40}"#),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{j:?}");
    for _ in 0..2 {
        let p = person(app, admin, e).await;
        let (s, v) = verbleib(
            app,
            admin,
            e,
            p,
            &format!(r#"{{"art":"notunterkunft","betreuungsstelle_id":{sid}}}"#),
        )
        .await;
        assert_eq!(s, StatusCode::CREATED, "{v:?}");
    }
    (e, sid)
}

#[tokio::test]
async fn uebersicht_nennt_namentliche_zahl_und_laesst_mengen_unveraendert() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let (e, sid) = lage_mit_zwei_namentlichen(&app, &admin).await;

    let (s, u) = anfrage(&app, "GET", &betreuung(e), &admin, None).await;
    assert_eq!(s, StatusCode::OK, "{u:?}");
    assert_eq!(
        u["namentlich"],
        serde_json::json!([{ "stelle_id": sid, "anzahl": 2 }]),
        "nur Stellen mit ≥ 1 Person"
    );
    let stelle = u["stellen"]
        .as_array()
        .unwrap()
        .iter()
        .find(|s| s["id"] == sid)
        .unwrap();
    assert_eq!(
        stelle["belegung"]["belegt"], 40,
        "Belegung bleibt die Meldung"
    );

    let (s, k) = anfrage(
        &app,
        "GET",
        &format!("{}/belegung", betreuung(e)),
        &admin,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{k:?}");
    assert_eq!(
        k["summe"], 40,
        "Kopfzahl zählt keine namentlichen Personen dazu"
    );
    assert!(
        !k.as_object().unwrap().contains_key("namentlich"),
        "die Kopfzahl trägt keine namentliche Zahl: {k}"
    );
}

#[tokio::test]
async fn ohne_personenrecht_fehlt_die_namentliche_zahl() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let (e, _) = lage_mit_zwei_namentlichen(&app, &admin).await;
    let bernd = fuehrung(&app, &admin, e, "bernd").await;

    let (s, u) = anfrage(&app, "GET", &betreuung(e), &bernd, None).await;
    assert_eq!(s, StatusCode::OK);
    assert!(
        u.as_object().unwrap().contains_key("namentlich"),
        "Vorbedingung: mit Personenrecht steht die Zahl da"
    );

    modul_ausblenden(&app, &admin, e, "personen").await;
    let (s, u) = anfrage(&app, "GET", &betreuung(e), &bernd, None).await;
    assert_eq!(s, StatusCode::OK);
    assert!(
        !u.as_object().unwrap().contains_key("namentlich"),
        "ohne Personenrecht fehlt das Feld, statt 0 zu sagen: {u}"
    );
}

#[tokio::test]
async fn gesicherter_lagestand_enthaelt_keine_namentliche_zahl() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let (e, _) = lage_mit_zwei_namentlichen(&app, &admin).await;
    let (s, dok) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{e}/lage-snapshots"),
        &admin,
        Some(r#"{"bezeichnung":"Stand 1"}"#),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{dok:?}");
    let text = dok.to_string();
    assert!(
        !text.contains("namentlich"),
        "Lagestand trägt keine namentliche Zahl: {text}"
    );
}
