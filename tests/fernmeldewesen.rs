//! Freigabe des Moduls Fernmeldewesen (LLH-1180, Spec `fernmeldewesen`): Kommunikationsplan und
//! Fernmeldeskizze behalten ihre Pfade unter `…/stab`, hängen aber allein an der Freigabe des
//! Fernmeldewesens. Inhalt und Live-Verhalten prüfen `tests/stab_kommunikationsplan.rs` und
//! `tests/stab_fernmeldeskizze.rs`.

use axum::http::StatusCode;

mod common;
use common::*;

fn plan_pfad(einsatz: i64) -> String {
    format!("/api/einsaetze/{einsatz}/stab/kommunikationsplan")
}

fn skizze_pfad(einsatz: i64) -> String {
    format!("/api/einsaetze/{einsatz}/stab/fernmeldeskizze")
}

/// Setzt den Override eines Moduls im Einsatz.
async fn override_setzen(app: &axum::Router, admin: &str, einsatz: i64, modul: &str, body: &str) {
    let (status, json) = anfrage(
        app,
        "PUT",
        &format!("/api/einsaetze/{einsatz}/modul-overrides/{modul}"),
        admin,
        Some(body),
    )
    .await;
    assert!(status.is_success(), "Override {modul}: {status} {json:?}");
}

async fn ausblenden(app: &axum::Router, admin: &str, einsatz: i64, modul: &str) {
    override_setzen(
        app,
        admin,
        einsatz,
        modul,
        r#"{"sichtbar":false,"benoetigte_rolle":null}"#,
    )
    .await;
}

/// Führungskraft mit Einsatzrolle Führungspersonal; liefert ihren Cookie.
async fn fuehrungskraft(app: &axum::Router, admin: &str, einsatz: i64) -> String {
    let kraft = benutzer_anlegen(app, admin, "kraft", "fuehrungskraft").await;
    rolle_setzen(app, admin, einsatz, kraft, "fuehrungspersonal").await;
    login_cookie(app, "kraft", "kraftpw1").await
}

/// Legt eine externe Stelle an und liefert ihre Id.
async fn stelle_anlegen(app: &axum::Router, cookie: &str, einsatz: i64) -> i64 {
    let (status, plan) = anfrage(
        app,
        "POST",
        &format!("{}/stellen", plan_pfad(einsatz)),
        cookie,
        Some(r#"{"stellenart":"leitstelle","bezeichnung":"ILS"}"#),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "Stelle: {plan:?}");
    plan.as_array()
        .unwrap()
        .iter()
        .map(|s| s["id"].as_i64().unwrap())
        .max()
        .unwrap()
}

/// Jede Route des Fernmeldewesens mit einem Body, der ohne Sperre gültig wäre.
fn alle_routen(einsatz: i64) -> Vec<(&'static str, String, Option<&'static str>)> {
    let p = plan_pfad(einsatz);
    let s = skizze_pfad(einsatz);
    vec![
        ("GET", p.clone(), None),
        (
            "POST",
            format!("{p}/stellen"),
            Some(r#"{"stellenart":"behoerde","bezeichnung":"x"}"#),
        ),
        ("GET", s.clone(), None),
        (
            "PUT",
            format!("{s}/lage/fs"),
            Some(r#"{"x":8,"y":16,"version":null}"#),
        ),
        ("DELETE", format!("{s}/lage"), None),
        (
            "PUT",
            format!("{s}/schriftfeld"),
            Some(r#"{"gez_name":"x"}"#),
        ),
        (
            "POST",
            format!("{s}/komponenten"),
            Some(r#"{"art":"repeater"}"#),
        ),
        (
            "POST",
            format!("{s}/bereiche"),
            Some(r#"{"x":0,"y":0,"breite":80,"hoehe":40}"#),
        ),
    ]
}

/// Spec `fernmeldewesen`, „Bestehende Schnittstellen gehören dem Fernmeldewesen“: Stab aus,
/// Fernmeldewesen an.
#[tokio::test]
async fn ohne_stab_bleibt_das_fernmeldewesen_voll_nutzbar() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let kraft = fuehrungskraft(&app, &admin, einsatz).await;
    ausblenden(&app, &admin, einsatz, "stab").await;

    let (status, _) = anfrage(
        &app,
        "GET",
        &format!("/api/einsaetze/{einsatz}/stab"),
        &kraft,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN, "Stab ist zu");

    let (status, _) = anfrage(&app, "GET", &plan_pfad(einsatz), &kraft, None).await;
    assert_eq!(
        status,
        StatusCode::OK,
        "Kommunikationsplan lesbar ohne Stab"
    );
    let (status, _) = anfrage(&app, "GET", &skizze_pfad(einsatz), &kraft, None).await;
    assert_eq!(status, StatusCode::OK, "Skizze lesbar ohne Stab");

    let stelle = stelle_anlegen(&app, &kraft, einsatz).await;
    let (status, json) = anfrage(
        &app,
        "POST",
        &format!("{}/stellen/{stelle}/verbindungen", plan_pfad(einsatz)),
        &kraft,
        Some(r#"{"mittel":"festnetz","wert":"0911 1234"}"#),
    )
    .await;
    assert_eq!(
        status,
        StatusCode::CREATED,
        "Verbindung ohne Stab: {json:?}"
    );
    let (status, json) = anfrage(
        &app,
        "POST",
        &format!("{}/komponenten", skizze_pfad(einsatz)),
        &kraft,
        Some(r#"{"art":"repeater"}"#),
    )
    .await;
    assert_eq!(
        status,
        StatusCode::CREATED,
        "Komponente ohne Stab: {json:?}"
    );
}

#[tokio::test]
async fn ausgeblendetes_fernmeldewesen_sperrt_lesen_und_schreiben() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let kraft = fuehrungskraft(&app, &admin, einsatz).await;
    ausblenden(&app, &admin, einsatz, "fernmeldewesen").await;

    for (methode, pfad, body) in alle_routen(einsatz) {
        let (status, _) = anfrage(&app, methode, &pfad, &kraft, body).await;
        assert_eq!(status, StatusCode::FORBIDDEN, "{methode} {pfad}");
    }

    // Der Stab bleibt davon unberührt.
    let (status, _) = anfrage(
        &app,
        "GET",
        &format!("/api/einsaetze/{einsatz}/stab"),
        &kraft,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "Stab offen");
}

/// Eine Rollensperre am Fernmeldewesen gilt, auch wenn der Stab frei ist; eine am Stab nicht.
#[tokio::test]
async fn rollensperre_folgt_dem_fernmeldewesen_nicht_dem_stab() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let kraft = fuehrungskraft(&app, &admin, einsatz).await;

    override_setzen(
        &app,
        &admin,
        einsatz,
        "stab",
        r#"{"sichtbar":true,"benoetigte_rolle":"admin"}"#,
    )
    .await;
    let (status, _) = anfrage(&app, "GET", &skizze_pfad(einsatz), &kraft, None).await;
    assert_eq!(status, StatusCode::OK, "Stab gesperrt, Fernmeldewesen frei");

    override_setzen(
        &app,
        &admin,
        einsatz,
        "stab",
        r#"{"sichtbar":true,"benoetigte_rolle":null}"#,
    )
    .await;
    override_setzen(
        &app,
        &admin,
        einsatz,
        "fernmeldewesen",
        r#"{"sichtbar":true,"benoetigte_rolle":"admin"}"#,
    )
    .await;
    for (methode, pfad, body) in alle_routen(einsatz) {
        let (status, _) = anfrage(&app, methode, &pfad, &kraft, body).await;
        assert_eq!(status, StatusCode::FORBIDDEN, "{methode} {pfad}");
    }
    let (status, _) = anfrage(
        &app,
        "GET",
        &format!("/api/einsaetze/{einsatz}/stab"),
        &kraft,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "Stab frei");
}

/// Fremde Organisation: 403 oder 404 auf jeder Route (wie `tests/cross_org.rs`); ein Einsatz,
/// den es nicht gibt, ist 404.
#[tokio::test]
async fn fremde_org_wird_auf_allen_routen_abgewiesen() {
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    fremde_org_anlegen(&pool, "Fremd-Orga", "fremd", "fremdpw1", "fuehrungskraft").await;
    let fremd = login_cookie(&app, "fremd", "fremdpw1").await;

    for (methode, pfad, body) in alle_routen(einsatz) {
        let (status, _) = anfrage(&app, methode, &pfad, &fremd, body).await;
        assert!(
            status == StatusCode::FORBIDDEN || status == StatusCode::NOT_FOUND,
            "{methode} {pfad}: erwartet 403/404, war {status}"
        );
    }
    let (status, _) = anfrage(&app, "GET", &plan_pfad(999_999), &admin, None).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn beobachter_liest_aber_schreibt_nicht() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let beob = benutzer_anlegen(&app, &admin, "beobachter", "keine").await;
    rolle_setzen(&app, &admin, einsatz, beob, "beobachter").await;
    let beob = login_cookie(&app, "beobachter", "beobachterpw1").await;
    ausblenden(&app, &admin, einsatz, "stab").await;

    let (status, _) = anfrage(&app, "GET", &plan_pfad(einsatz), &beob, None).await;
    assert_eq!(status, StatusCode::OK, "Beobachter liest ohne Stab");
    let (status, _) = anfrage(
        &app,
        "POST",
        &format!("{}/komponenten", skizze_pfad(einsatz)),
        &beob,
        Some(r#"{"art":"repeater"}"#),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN, "Beobachter schreibt nicht");
}

// ---------- Live ----------

/// Spec `fernmeldewesen`, „Live-Verteilung mit dem Gate des Fernmeldewesens“: wer nur den Stab
/// lesen darf, erfährt von keiner Änderung an Kommunikationsplan oder Skizze.
#[test]
fn stab_leser_ohne_fernmeldewesen_erhaelt_kein_ereignis() {
    use lifeline_hub::live::LiveEvent;
    use std::collections::HashSet;
    let nur_stab: HashSet<&'static str> = HashSet::from(["stab"]);
    assert!(!LiveEvent::Fernmeldewesen.sichtbar_fuer(&nur_stab));
    let nur_fernmeldewesen: HashSet<&'static str> = HashSet::from(["fernmeldewesen"]);
    assert!(LiveEvent::Fernmeldewesen.sichtbar_fuer(&nur_fernmeldewesen));
    assert!(!LiveEvent::Stab.sichtbar_fuer(&nur_fernmeldewesen));
}

/// Besetzung und Checkliste bleiben Stab: sie senden `stab`, nie `fernmeldewesen`.
#[tokio::test]
async fn besetzung_sendet_stab_und_kein_fernmeldewesen() {
    let (app, _pool, live) = setup_mit_pool_und_live().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let mut rx = live.abonniere(einsatz);
    let (status, json) = anfrage(
        &app,
        "PUT",
        &format!("/api/einsaetze/{einsatz}/stab/besetzung/s2"),
        &admin,
        Some(r#"{"besetzung_art":"einsatzleitung"}"#),
    )
    .await;
    assert!(status.is_success(), "besetzen: {status} {json:?}");
    let (mut stab, mut fernmeldewesen) = (0, 0);
    while let Ok(n) = rx.try_recv() {
        match n.event.as_str() {
            "stab" => stab += 1,
            "fernmeldewesen" => fernmeldewesen += 1,
            _ => {}
        }
    }
    assert_eq!((stab, fernmeldewesen), (1, 0));
}
