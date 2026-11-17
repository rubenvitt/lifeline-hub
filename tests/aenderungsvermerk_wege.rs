//! Änderungsvermerk auf den Schreibwegen außerhalb der Einzelangaben (LLH-1834, Change
//! `nvhnqynd-konflikt-und-aenderungsvermerk`, Spec `aenderungsvermerk` „Vermerk je Angabe bei
//! jedem Schreiben“): Entlassen, Auflösen, Abruf aus dem Bereitstellungsraum und Zuordnen ändern
//! Angaben von Einheit und Führungsstelle mit; der Vermerk nennt, wer das ausgelöst hat.

use axum::http::StatusCode;
use serde_json::{json, Value};

mod common;
use common::*;

struct Lage {
    app: axum::Router,
    pool: sqlx::SqlitePool,
    admin: String,
    /// Zweiter Arbeitsplatz: löst den geprüften Schreibweg aus.
    bert: String,
    bert_id: i64,
    einsatz: i64,
}

async fn lage() -> Lage {
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let bert_id = benutzer_anlegen(&app, &admin, "berthold", "keine").await;
    rolle_setzen(&app, &admin, einsatz, bert_id, "einsatzleitung").await;
    let bert = login_cookie(&app, "berthold", "bertholdpw1").await;
    Lage {
        app,
        pool,
        admin,
        bert,
        bert_id,
        einsatz,
    }
}

/// Benutzer des Vermerks an einem Feld der Einheit, `None` ohne Vermerk.
async fn vermerk_einheit(pool: &sqlx::SqlitePool, eid: i64, feld: &str) -> Option<i64> {
    sqlx::query_scalar(
        "SELECT geaendert_von FROM einsatz_feld_vermerk \
         WHERE objekt_art = 'einheit' AND einheit_id = ? AND feld = ?",
    )
    .bind(eid)
    .bind(feld)
    .fetch_optional(pool)
    .await
    .unwrap()
    .flatten()
}

async fn vermerk_fuehrungsstelle(pool: &sqlx::SqlitePool, einsatz: i64, feld: &str) -> Option<i64> {
    sqlx::query_scalar(
        "SELECT geaendert_von FROM einsatz_feld_vermerk \
         WHERE einsatz_id = ? AND objekt_art = 'fuehrungsstelle' AND feld = ?",
    )
    .bind(einsatz)
    .bind(feld)
    .fetch_optional(pool)
    .await
    .unwrap()
    .flatten()
}

async fn senden(app: &axum::Router, cookie: &str, methode: &str, pfad: &str, body: Option<Value>) {
    let (s, v) = anfrage_json(app, methode, pfad, cookie, body.as_ref()).await;
    assert!(s.is_success(), "{methode} {pfad}: {s} {v}");
}

async fn einheit_mit_fuehrer(l: &Lage, name: &str, person: &str) -> (i64, i64) {
    let eid = einheit_bilden(&l.app, &l.admin, l.einsatz, name).await;
    let ep = stammpersonal_disponieren(&l.app, &l.admin, l.einsatz, person).await;
    let basis = format!("/api/einsaetze/{}/einheiten/{eid}", l.einsatz);
    senden(
        &l.app,
        &l.admin,
        "PUT",
        &format!("{basis}/personal/{ep}"),
        None,
    )
    .await;
    senden(
        &l.app,
        &l.admin,
        "PATCH",
        &basis,
        Some(json!({"fuehrer_id": ep})),
    )
    .await;
    (eid, ep)
}

#[tokio::test]
async fn entlassen_des_fuehrers_vermerkt_fuehrer_und_einsatzleiter() {
    let l = lage().await;
    let (eid, ep) = einheit_mit_fuehrer(&l, "1. Zug", "Anna").await;
    let fs = format!("/api/einsaetze/{}/fuehrungsstelle", l.einsatz);
    senden(
        &l.app,
        &l.admin,
        "PATCH",
        &fs,
        Some(json!({"einsatzleiter": {"art": "personal", "personal_id": ep}})),
    )
    .await;
    let admin_id = vermerk_einheit(&l.pool, eid, "fuehrer_id").await;
    assert_ne!(admin_id, Some(l.bert_id), "Vorbedingung");

    let pfad = format!("/api/einsaetze/{}/personal/{ep}/entlassen", l.einsatz);
    senden(&l.app, &l.bert, "POST", &pfad, None).await;

    assert_eq!(
        vermerk_einheit(&l.pool, eid, "fuehrer_id").await,
        Some(l.bert_id)
    );
    assert_eq!(
        vermerk_fuehrungsstelle(&l.pool, l.einsatz, "einsatzleiter").await,
        Some(l.bert_id)
    );
}

#[tokio::test]
async fn entlassen_eines_fahrzeugs_der_fuehrungsstelle_vermerkt_ihre_fahrzeuge() {
    let l = lage().await;
    let (s, v) = anfrage_json(
        &l.app,
        "POST",
        &format!("/api/einsaetze/{}/fahrzeuge", l.einsatz),
        &l.admin,
        Some(&json!({"adhoc": {"funkrufname": "Florian 10/1", "fahrzeugtyp": "ELW 1"}})),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{v}");
    let ef = v["id"].as_i64().unwrap();
    let fs = format!("/api/einsaetze/{}/fuehrungsstelle", l.einsatz);
    senden(
        &l.app,
        &l.admin,
        "PATCH",
        &fs,
        Some(json!({"fahrzeug_ids": [ef]})),
    )
    .await;

    let pfad = format!("/api/einsaetze/{}/fahrzeuge/{ef}/entlassen", l.einsatz);
    senden(&l.app, &l.bert, "POST", &pfad, None).await;

    assert_eq!(
        vermerk_fuehrungsstelle(&l.pool, l.einsatz, "fahrzeug_ids").await,
        Some(l.bert_id)
    );
}

#[tokio::test]
async fn aufloesen_vermerkt_die_ueber_einheit_der_kinder() {
    let l = lage().await;
    let zug = einheit_bilden(&l.app, &l.admin, l.einsatz, "1. Zug").await;
    let gruppe = einheit_bilden(&l.app, &l.admin, l.einsatz, "1. Gruppe").await;
    let basis = format!("/api/einsaetze/{}/einheiten", l.einsatz);
    senden(
        &l.app,
        &l.admin,
        "PATCH",
        &format!("{basis}/{gruppe}"),
        Some(json!({"ueber_einheit_id": zug})),
    )
    .await;

    senden(&l.app, &l.bert, "DELETE", &format!("{basis}/{zug}"), None).await;

    assert_eq!(
        vermerk_einheit(&l.pool, gruppe, "ueber_einheit_id").await,
        Some(l.bert_id)
    );
}

#[tokio::test]
async fn abruf_mit_abschnitt_vermerkt_den_abschnitt_nur_bei_wechsel() {
    let l = lage().await;
    let br_basis = format!("/api/einsaetze/{}/bereitstellungsraeume", l.einsatz);
    let (s, v) = anfrage_json(
        &l.app,
        "POST",
        &br_basis,
        &l.admin,
        Some(&json!({"bezeichnung": "Sportplatz"})),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{v}");
    let br = v["id"].as_i64().unwrap();
    senden(
        &l.app,
        &l.admin,
        "POST",
        &format!("{br_basis}/{br}/status"),
        Some(json!({"status": "aktiv"})),
    )
    .await;
    let (s, v) = anfrage_json(
        &l.app,
        "POST",
        &format!("/api/einsaetze/{}/abschnitte", l.einsatz),
        &l.admin,
        Some(&json!({"name": "EA Deich"})),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{v}");
    let deich = v["id"].as_i64().unwrap();
    let hlf = einheit_bilden(&l.app, &l.admin, l.einsatz, "HLF 20").await;
    // Der RTW steht schon im Abschnitt: sein Abruf dorthin ändert nichts.
    let rtw = einheit_bilden(&l.app, &l.admin, l.einsatz, "RTW 1").await;
    senden(
        &l.app,
        &l.admin,
        "PATCH",
        &format!("/api/einsaetze/{}/einheiten/{rtw}", l.einsatz),
        Some(json!({"abschnitt_id": deich})),
    )
    .await;
    let admin_id = vermerk_einheit(&l.pool, rtw, "abschnitt_id").await;
    assert!(
        admin_id.is_some() && admin_id != Some(l.bert_id),
        "Vorbedingung"
    );

    for eid in [hlf, rtw] {
        senden(
            &l.app,
            &l.admin,
            "POST",
            &format!("{br_basis}/{br}/belegung"),
            Some(json!({"objekt_typ": "einheit", "objekt_id": eid, "art": "eintritt"})),
        )
        .await;
        senden(
            &l.app,
            &l.bert,
            "POST",
            &format!("{br_basis}/{br}/abruf"),
            Some(json!({"objekt_typ": "einheit", "objekt_id": eid, "abschnitt_id": deich})),
        )
        .await;
    }

    assert_eq!(
        vermerk_einheit(&l.pool, hlf, "abschnitt_id").await,
        Some(l.bert_id)
    );
    assert_eq!(
        vermerk_einheit(&l.pool, rtw, "abschnitt_id").await,
        admin_id
    );
}

#[tokio::test]
async fn zuordnen_und_freigeben_vermerken_den_fuehrer() {
    let l = lage().await;
    let (zug, anna) = einheit_mit_fuehrer(&l, "1. Zug", "Anna").await;
    let gruppe = einheit_bilden(&l.app, &l.admin, l.einsatz, "1. Gruppe").await;
    let basis = format!("/api/einsaetze/{}/einheiten", l.einsatz);

    // Anna wechselt in die Gruppe: ihre Führung im Zug endet.
    senden(
        &l.app,
        &l.bert,
        "PUT",
        &format!("{basis}/{gruppe}/personal/{anna}"),
        None,
    )
    .await;
    assert_eq!(
        vermerk_einheit(&l.pool, zug, "fuehrer_id").await,
        Some(l.bert_id)
    );

    // Rückgängig als Führer: die Führung im Zug kommt zurück, vermerkt für den Admin.
    senden(
        &l.app,
        &l.admin,
        "PUT",
        &format!("{basis}/{zug}/personal/{anna}?als_fuehrer=1"),
        None,
    )
    .await;
    let admin_id = vermerk_einheit(&l.pool, zug, "fuehrer_id").await;
    assert!(admin_id.is_some() && admin_id != Some(l.bert_id));

    // Freigeben des Führers leert die Führung: Vermerk bei Bert.
    senden(
        &l.app,
        &l.bert,
        "DELETE",
        &format!("{basis}/{zug}/personal/{anna}"),
        None,
    )
    .await;
    assert_eq!(
        vermerk_einheit(&l.pool, zug, "fuehrer_id").await,
        Some(l.bert_id)
    );
}
