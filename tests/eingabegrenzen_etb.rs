//! LFH-937: Grenzen der Freitexte, die von außen unverändert ins ETB gelangen (Spec
//! `eingabegrenzen`, design.md D2). `max` geht durch, `max+1` ist 400 mit Feld und Grenze, und
//! nach einer 400 ist kein Eintrag entstanden.

use axum::http::StatusCode;
use serde_json::{json, Value};

mod common;
use common::{anfrage, einsatz_anlegen, login_cookie, setup, setup_mit_pool};

const INHALT_MAX: usize = 20_000;
const PARTEI_MAX: usize = 500;

fn x(n: usize) -> String {
    "x".repeat(n)
}

async fn etb_anzahl(app: &axum::Router, cookie: &str, e: i64) -> usize {
    let (s, etb) = anfrage(app, "GET", &format!("/api/einsaetze/{e}/etb"), cookie, None).await;
    assert_eq!(s, StatusCode::OK);
    etb.as_array().unwrap().len()
}

fn meldung_von(antwort: &Value) -> String {
    antwort["error"].as_str().unwrap_or_default().to_string()
}

async fn erfassen(app: &axum::Router, cookie: &str, e: i64, body: Value) -> (StatusCode, Value) {
    anfrage(
        app,
        "POST",
        &format!("/api/einsaetze/{e}/etb"),
        cookie,
        Some(&body.to_string()),
    )
    .await
}

fn eintrag(inhalt: &str, von: &str, an: &str, veranlassung: Option<&str>) -> Value {
    json!({ "typ": "meldung", "inhalt": inhalt, "von": von, "an": an, "veranlassung": veranlassung })
}

#[tokio::test]
async fn etb_inhalt_genau_an_der_grenze_und_eins_darueber() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let vorher = etb_anzahl(&app, &admin, e).await;

    let (s, j) = erfassen(&app, &admin, e, eintrag(&x(INHALT_MAX), "A", "B", None)).await;
    assert_eq!(s, StatusCode::CREATED, "{j:?}");

    let (s, j) = erfassen(&app, &admin, e, eintrag(&x(INHALT_MAX + 1), "A", "B", None)).await;
    assert_eq!(s, StatusCode::BAD_REQUEST);
    assert_eq!(
        meldung_von(&j),
        "Inhalt darf höchstens 20000 Zeichen lang sein"
    );
    assert_eq!(etb_anzahl(&app, &admin, e).await, vorher + 1);
}

#[tokio::test]
async fn etb_von_an_veranlassung_sind_auf_500_begrenzt() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let ok = x(PARTEI_MAX);
    let lang = x(PARTEI_MAX + 1);

    let (s, j) = erfassen(&app, &admin, e, eintrag("i", &ok, &ok, Some(&ok))).await;
    assert_eq!(s, StatusCode::CREATED, "{j:?}");
    let vorher = etb_anzahl(&app, &admin, e).await;

    for (body, feld) in [
        (eintrag("i", &lang, "B", None), "Von"),
        (eintrag("i", "A", &lang, None), "An"),
        (eintrag("i", "A", "B", Some(&lang)), "Veranlassung"),
    ] {
        let (s, j) = erfassen(&app, &admin, e, body).await;
        assert_eq!(s, StatusCode::BAD_REQUEST, "{feld}");
        assert!(meldung_von(&j).starts_with(feld), "{feld}: {j:?}");
    }
    assert_eq!(etb_anzahl(&app, &admin, e).await, vorher);
}

#[tokio::test]
async fn berichtigung_unterliegt_derselben_grenze() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let (_, ziel) = erfassen(&app, &admin, e, eintrag("i", "A", "B", None)).await;
    let body = json!({
        "typ": "berichtigung", "inhalt": x(INHALT_MAX + 1), "von": "A", "an": "B",
        "berichtigt_eintrag_id": ziel["id"],
    });
    let (s, _) = erfassen(&app, &admin, e, body).await;
    assert_eq!(s, StatusCode::BAD_REQUEST);
}

/// Der Replay einer schon gespeicherten `client_id` läuft vor der Feldprüfung und bleibt, wie
/// er war.
#[tokio::test]
async fn replay_mit_derselben_client_id_bleibt_unveraendert() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let mut body = eintrag("Deich hält", "A", "B", None);
    body["client_id"] = json!("c-937");
    let (s1, j1) = erfassen(&app, &admin, e, body.clone()).await;
    assert_eq!(s1, StatusCode::CREATED, "{j1:?}");
    let (s2, j2) = erfassen(&app, &admin, e, body).await;
    assert_eq!(s2, StatusCode::CREATED, "{j2:?}");
    assert_eq!(j1["id"], j2["id"]);
}

async fn default_kanal(app: &axum::Router, e: i64, cookie: &str) -> i64 {
    let (_, j) = anfrage(
        app,
        "GET",
        &format!("/api/einsaetze/{e}/chat/kanaele"),
        cookie,
        None,
    )
    .await;
    j[0]["id"].as_i64().unwrap()
}

#[tokio::test]
async fn chat_nachricht_anlegen_und_bearbeiten_sind_begrenzt() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let kid = default_kanal(&app, e, &admin).await;
    let uri = format!("/api/einsaetze/{e}/chat/kanaele/{kid}/nachrichten");

    let (s, m) = anfrage(
        &app,
        "POST",
        &uri,
        &admin,
        Some(&json!({ "inhalt": x(INHALT_MAX) }).to_string()),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{m:?}");
    let (s, _) = anfrage(
        &app,
        "POST",
        &uri,
        &admin,
        Some(&json!({ "inhalt": x(INHALT_MAX + 1) }).to_string()),
    )
    .await;
    assert_eq!(s, StatusCode::BAD_REQUEST);

    let mid = m["id"].as_i64().unwrap();
    let (s, _) = anfrage(
        &app,
        "PATCH",
        &format!("/api/einsaetze/{e}/chat/nachrichten/{mid}"),
        &admin,
        Some(&json!({ "inhalt": x(INHALT_MAX + 1) }).to_string()),
    )
    .await;
    assert_eq!(s, StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn chat_heraufstufen_prueft_eigenen_text_und_rueckfall() {
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let kid = default_kanal(&app, e, &admin).await;
    let (_, m) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{e}/chat/kanaele/{kid}/nachrichten"),
        &admin,
        Some(r#"{"inhalt":"kurz"}"#),
    )
    .await;
    let mid = m["id"].as_i64().unwrap();
    let uri = format!("/api/einsaetze/{e}/chat/nachrichten/{mid}/heraufstufen-etb");
    let vorher = etb_anzahl(&app, &admin, e).await;

    let (s, _) = anfrage(
        &app,
        "POST",
        &uri,
        &admin,
        Some(&json!({ "typ": "meldung", "inhalt": x(INHALT_MAX + 1) }).to_string()),
    )
    .await;
    assert_eq!(s, StatusCode::BAD_REQUEST);

    // Altbestand: eine gespeicherte Nachricht über der Grenze (vor LFH-937 möglich).
    sqlx::query("UPDATE chat_nachricht SET inhalt = ? WHERE id = ?")
        .bind(x(INHALT_MAX + 1))
        .bind(mid)
        .execute(&pool)
        .await
        .unwrap();
    let (s, _) = anfrage(&app, "POST", &uri, &admin, Some(r#"{"typ":"meldung"}"#)).await;
    assert_eq!(s, StatusCode::BAD_REQUEST);
    assert_eq!(etb_anzahl(&app, &admin, e).await, vorher);
}

fn meldung_body(absender: &str, empfaenger: &str, inhalt: &str) -> String {
    json!({
        "absender": absender, "empfaenger": empfaenger, "meldeweg": "funk", "inhalt": inhalt,
        "ereigniszeit": "2026-06-12 09:00:00"
    })
    .to_string()
}

#[tokio::test]
async fn meldung_inhalt_absender_empfaenger_sind_begrenzt() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let uri = format!("/api/einsaetze/{e}/meldungen");
    let ok = x(PARTEI_MAX);

    let (s, j) = anfrage(
        &app,
        "POST",
        &uri,
        &admin,
        Some(&meldung_body(&ok, &ok, &x(INHALT_MAX))),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{j:?}");
    let vorher = etb_anzahl(&app, &admin, e).await;

    for body in [
        meldung_body(&x(PARTEI_MAX + 1), "B", "i"),
        meldung_body("A", &x(PARTEI_MAX + 1), "i"),
        meldung_body("A", "B", &x(INHALT_MAX + 1)),
    ] {
        let (s, _) = anfrage(&app, "POST", &uri, &admin, Some(&body)).await;
        assert_eq!(s, StatusCode::BAD_REQUEST);
    }
    assert_eq!(etb_anzahl(&app, &admin, e).await, vorher);
}

fn nachforderung_body(bezeichnung: &str, adressat: &str, begruendung: &str) -> String {
    json!({
        "art": "RTW", "bezeichnung": bezeichnung, "anzahl": 1,
        "adressat_kategorie": "leitstelle", "adressat_bezeichnung": adressat,
        "begruendung": begruendung
    })
    .to_string()
}

#[tokio::test]
async fn nachforderung_texte_sind_begrenzt() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let uri = format!("/api/einsaetze/{e}/nachforderungen");

    let (s, j) = anfrage(
        &app,
        "POST",
        &uri,
        &admin,
        Some(&nachforderung_body(&x(200), &x(PARTEI_MAX), &x(PARTEI_MAX))),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{j:?}");
    let vorher = etb_anzahl(&app, &admin, e).await;

    for body in [
        nachforderung_body(&x(201), "L", "b"),
        nachforderung_body("RTW", &x(PARTEI_MAX + 1), "b"),
        nachforderung_body("RTW", "L", &x(PARTEI_MAX + 1)),
        nachforderung_body("Bez", "L", "b").replace("\"RTW\"", &format!("\"{}\"", x(201))),
    ] {
        let (s, _) = anfrage(&app, "POST", &uri, &admin, Some(&body)).await;
        assert_eq!(s, StatusCode::BAD_REQUEST);
    }
    assert_eq!(etb_anzahl(&app, &admin, e).await, vorher);
}

#[tokio::test]
async fn vollzugsmeldung_ist_begrenzt() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let auftrag = json!({
        "auftrag_text": "Deich sichern",
        "empfaenger": [{ "empfaenger_typ": "funktion", "funktion_text": "EA1" }]
    });
    let (_, a) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{e}/auftraege"),
        &admin,
        Some(&auftrag.to_string()),
    )
    .await;
    let aid = a["id"].as_i64().unwrap();
    let uri = format!("/api/einsaetze/{e}/auftraege/{aid}/vollzug");

    let lang = json!({ "status": "vollzogen", "vollzugsmeldung": x(INHALT_MAX + 1) });
    let (s, _) = anfrage(&app, "POST", &uri, &admin, Some(&lang.to_string())).await;
    assert_eq!(s, StatusCode::BAD_REQUEST);

    let ok = json!({ "status": "vollzogen", "vollzugsmeldung": x(INHALT_MAX) });
    let (s, j) = anfrage(&app, "POST", &uri, &admin, Some(&ok.to_string())).await;
    assert_eq!(s, StatusCode::OK, "{j:?}");
}
