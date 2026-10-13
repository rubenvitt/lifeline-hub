//! Kenntnisnahme einer Lagemeldung (LLH-1206, Spec `lagemeldung-kenntnisnahme`): „neu“ gilt für
//! alle, gesetzt mit Schreibrecht am Modul `lagemeldungen`, die erste Kenntnisnahme gewinnt.

use axum::http::StatusCode;
use serde_json::{json, Value};
use std::time::Duration;

mod common;
use common::{
    anfrage, benutzer_anlegen, einsatz_anlegen, login_cookie, recv_until_tag, rolle_setzen, setup,
    setup_mit_live,
};

async fn post(app: &axum::Router, cookie: &str, pfad: &str, body: &str) -> Value {
    let (status, v) = anfrage(app, "POST", pfad, cookie, Some(body)).await;
    assert!(status.is_success(), "POST {pfad}: {status} {v:?}");
    v
}

/// Legt eine Meldung an und übergibt sie an die Lage; liefert die Lagemeldung-id.
async fn uebergeben(app: &axum::Router, cookie: &str, e: i64, inhalt: &str) -> i64 {
    let m = post(
        app,
        cookie,
        &format!("/api/einsaetze/{e}/meldungen"),
        &json!({
            "absender": "Florian Nord 1", "empfaenger": "ELW 1", "meldeweg": "funk",
            "inhalt": inhalt, "ereigniszeit": "2026-06-12 09:00:00"
        })
        .to_string(),
    )
    .await;
    let mid = m["id"].as_i64().unwrap();
    let m = post(
        app,
        cookie,
        &format!("/api/einsaetze/{e}/meldungen/{mid}/lagerelevant"),
        "{}",
    )
    .await;
    m["lage_meldung_id"].as_i64().unwrap()
}

async fn liste(app: &axum::Router, cookie: &str, e: i64) -> Vec<Value> {
    let (status, v) = anfrage(
        app,
        "GET",
        &format!("/api/einsaetze/{e}/lage/meldungen"),
        cookie,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{v:?}");
    v.as_array().unwrap().clone()
}

fn zeile(liste: &[Value], id: i64) -> &Value {
    liste.iter().find(|l| l["id"] == id).unwrap()
}

async fn zaehler(app: &axum::Router, cookie: &str, e: i64) -> Value {
    let (status, v) = anfrage(
        app,
        "GET",
        &format!("/api/einsaetze/{e}/modul-zaehler"),
        cookie,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{v:?}");
    v
}

/// Beobachterin ohne Admin-Rechte im Einsatz: liest, schreibt nicht.
async fn erika(app: &axum::Router, admin: &str, e: i64) -> String {
    let id = benutzer_anlegen(app, admin, "erika", "keine").await;
    rolle_setzen(app, admin, e, id, "beobachter").await;
    login_cookie(app, "erika", "erikapw1").await
}

#[tokio::test]
async fn einzeln_gesehen_gilt_fuer_alle_und_die_erste_gewinnt() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let lid = uebergeben(&app, &admin, e, "Brücke gesperrt").await;
    let erika = erika(&app, &admin, e).await;

    let frisch = liste(&app, &erika, e).await;
    assert_eq!(zeile(&frisch, lid)["is_neu"], true);
    assert!(zeile(&frisch, lid).get("gesehen_at").is_none());

    let pfad = format!("/api/einsaetze/{e}/lage/meldungen/{lid}/gesehen");
    let erst = post(&app, &admin, &pfad, "{}").await;
    assert_eq!(erst["is_neu"], false, "{erst:?}");
    assert_eq!(erst["gesehen_von_name"], "Administrator", "{erst:?}");
    let gesehen_at = erst["gesehen_at"].clone();
    assert!(gesehen_at.is_string(), "{erst:?}");

    // Dieselbe Sicht für die Beobachterin.
    let fuer_erika = liste(&app, &erika, e).await;
    assert_eq!(zeile(&fuer_erika, lid)["is_neu"], false);
    assert_eq!(zeile(&fuer_erika, lid)["gesehen_von_name"], "Administrator");

    // Zweites Mal: 200, Zeitpunkt und Person unverändert.
    let zweit = post(&app, &admin, &pfad, "{}").await;
    assert_eq!(zweit["gesehen_at"], gesehen_at);
}

#[tokio::test]
async fn alle_gesehen_bis_zur_angezeigten() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let a = uebergeben(&app, &admin, e, "eins").await;
    let b = uebergeben(&app, &admin, e, "zwei").await;
    let c = uebergeben(&app, &admin, e, "drei").await;

    let v = post(
        &app,
        &admin,
        &format!("/api/einsaetze/{e}/lage/meldungen/gesehen"),
        &json!({ "bis_id": b }).to_string(),
    )
    .await;
    assert_eq!(v, json!({ "gesehen": 2 }));

    let l = liste(&app, &admin, e).await;
    assert_eq!(zeile(&l, a)["is_neu"], false);
    assert_eq!(zeile(&l, b)["is_neu"], false);
    assert_eq!(
        zeile(&l, c)["is_neu"],
        true,
        "jünger als `bis_id` bleibt neu"
    );
}

#[tokio::test]
async fn nur_lesend_ist_403_und_bleibt_neu() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let lid = uebergeben(&app, &admin, e, "Brücke gesperrt").await;
    let erika = erika(&app, &admin, e).await;

    let (status, _) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{e}/lage/meldungen/{lid}/gesehen"),
        &erika,
        Some("{}"),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    let (status, _) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{e}/lage/meldungen/gesehen"),
        &erika,
        Some(&json!({ "bis_id": lid }).to_string()),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    assert_eq!(zeile(&liste(&app, &admin, e).await, lid)["is_neu"], true);
}

#[tokio::test]
async fn lagemeldung_aus_fremdem_einsatz_ist_404() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let fremd = einsatz_anlegen(&app, &admin).await;
    let lid = uebergeben(&app, &admin, e, "Brücke gesperrt").await;

    let (status, _) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{fremd}/lage/meldungen/{lid}/gesehen"),
        &admin,
        Some("{}"),
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    // Der Sammelweg im fremden Einsatz rührt die Lagemeldung nicht an.
    let v = post(
        &app,
        &admin,
        &format!("/api/einsaetze/{fremd}/lage/meldungen/gesehen"),
        &json!({ "bis_id": lid }).to_string(),
    )
    .await;
    assert_eq!(v, json!({ "gesehen": 0 }));
    assert_eq!(zeile(&liste(&app, &admin, e).await, lid)["is_neu"], true);
}

#[tokio::test]
async fn ohne_bis_id_ist_400() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let (status, _) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{e}/lage/meldungen/gesehen"),
        &admin,
        Some("{}"),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn beide_wege_melden_den_kurzruf_meldung() {
    let (app, live) = setup_mit_live().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let a = uebergeben(&app, &admin, e, "eins").await;
    let b = uebergeben(&app, &admin, e, "zwei").await;
    let mut rx = live.abonniere(e);

    post(
        &app,
        &admin,
        &format!("/api/einsaetze/{e}/lage/meldungen/{a}/gesehen"),
        "{}",
    )
    .await;
    recv_until_tag(&mut rx, "meldung", Duration::from_secs(1)).await;

    post(
        &app,
        &admin,
        &format!("/api/einsaetze/{e}/lage/meldungen/gesehen"),
        &json!({ "bis_id": b }).to_string(),
    )
    .await;
    recv_until_tag(&mut rx, "meldung", Duration::from_secs(1)).await;
}

/// Spec `modul-zaehler`: `lagemeldungen.neu` gleich den Listeneinträgen mit `is_neu`, für jeden
/// Benutzer gleich; ausgeblendet fehlt das Feld.
#[tokio::test]
async fn zaehler_neu_entspricht_der_liste_und_fehlt_ohne_freigabe() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let erika = erika(&app, &admin, e).await;
    assert_eq!(
        zaehler(&app, &admin, e).await["lagemeldungen"],
        json!({ "neu": 0 })
    );

    let a = uebergeben(&app, &admin, e, "eins").await;
    uebergeben(&app, &admin, e, "zwei").await;
    uebergeben(&app, &admin, e, "drei").await;
    post(
        &app,
        &admin,
        &format!("/api/einsaetze/{e}/lage/meldungen/{a}/gesehen"),
        "{}",
    )
    .await;

    let neu_in_liste = liste(&app, &admin, e)
        .await
        .iter()
        .filter(|l| l["is_neu"] == true)
        .count() as i64;
    assert_eq!(neu_in_liste, 2);
    for cookie in [&admin, &erika] {
        let v = zaehler(&app, cookie, e).await;
        assert_eq!(v["lagemeldungen"], json!({ "neu": neu_in_liste }), "{v:?}");
    }

    let (status, v) = anfrage(
        &app,
        "PUT",
        &format!("/api/einsaetze/{e}/modul-overrides/lagemeldungen"),
        &admin,
        Some(r#"{"sichtbar":false,"benoetigte_rolle":null}"#),
    )
    .await;
    assert!(status.is_success(), "Override: {status} {v:?}");
    let v = zaehler(&app, &erika, e).await;
    assert!(
        !v.as_object().unwrap().contains_key("lagemeldungen"),
        "{v:?}"
    );
    assert!(v.as_object().unwrap().contains_key("etb"), "{v:?}");
}
