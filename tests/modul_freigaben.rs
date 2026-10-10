//! Modulfreigaben je Benutzer (LFH-669): `GET /api/einsaetze/{id}/modul-freigaben`.
//!
//! Die tragende Zusicherung ist der **Gleichlauf**: `zugriff` sagt für jedes Modul genau das,
//! was der Listen-Endpunkt desselben Moduls demselben Benutzer antwortet. Die Tests prüfen
//! deshalb neben der Freigabe immer auch den Statuscode der Liste.

use axum::http::StatusCode;
use serde_json::{json, Value};

mod common;
use common::{anfrage, benutzer_anlegen, einsatz_anlegen, login_cookie, rolle_setzen, setup};

fn uri(einsatz: i64) -> String {
    format!("/api/einsaetze/{einsatz}/modul-freigaben")
}

async fn freigaben(app: &axum::Router, cookie: &str, einsatz: i64) -> Value {
    let (status, v) = anfrage(app, "GET", &uri(einsatz), cookie, None).await;
    assert_eq!(status, StatusCode::OK, "modul-freigaben: {v:?}");
    v
}

async fn aufbau() -> (axum::Router, String, i64) {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    (app, admin, einsatz)
}

/// Mitglied ohne Admin-Rechte und ohne Führungsrolle in der Org.
async fn mitglied(app: &axum::Router, admin: &str, einsatz: i64, name: &str, org: &str) -> String {
    let id = benutzer_anlegen(app, admin, name, org).await;
    rolle_setzen(app, admin, einsatz, id, "beobachter").await;
    login_cookie(app, name, &format!("{name}pw1")).await
}

async fn org_vorgabe(app: &axum::Router, admin: &str, modul: &str, rolle: &str) {
    let (status, v) = anfrage(
        app,
        "PUT",
        &format!("/api/org-modul-einstellungen/{modul}"),
        admin,
        Some(&format!(r#"{{"benoetigte_rolle":"{rolle}"}}"#)),
    )
    .await;
    assert!(status.is_success(), "Org-Vorgabe {modul}: {status} {v:?}");
}

async fn modul_override(app: &axum::Router, admin: &str, einsatz: i64, modul: &str, body: &str) {
    let (status, v) = anfrage(
        app,
        "PUT",
        &format!("/api/einsaetze/{einsatz}/modul-overrides/{modul}"),
        admin,
        Some(body),
    )
    .await;
    assert!(status.is_success(), "Override {modul}: {status} {v:?}");
}

async fn liste_status(app: &axum::Router, cookie: &str, einsatz: i64, pfad: &str) -> StatusCode {
    let (status, _) = anfrage(
        app,
        "GET",
        &format!("/api/einsaetze/{einsatz}/{pfad}"),
        cookie,
        None,
    )
    .await;
    status
}

#[tokio::test]
async fn ohne_regeln_ist_jedes_modul_frei() {
    let (app, admin, einsatz) = aufbau().await;
    let erika = mitglied(&app, &admin, einsatz, "erika", "keine").await;
    let v = freigaben(&app, &erika, einsatz).await;
    let map = v.as_object().unwrap();
    for key in lifeline_hub::einsatz::modul::MODUL_KEYS {
        assert_eq!(
            map.get(key),
            Some(&json!({ "sichtbar": true, "zugriff": true })),
            "{key}: {v:?}"
        );
    }
    assert_eq!(
        map.len(),
        lifeline_hub::einsatz::modul::MODUL_KEYS.len(),
        "{v:?}"
    );
}

#[tokio::test]
async fn org_vorgabe_sperrt_mitglied_wie_die_liste() {
    let (app, admin, einsatz) = aufbau().await;
    let erika = mitglied(&app, &admin, einsatz, "erika", "keine").await;
    org_vorgabe(&app, &admin, "schaeden", "fuehrungskraft").await;

    let v = freigaben(&app, &erika, einsatz).await;
    assert_eq!(v["schaeden"], json!({ "sichtbar": true, "zugriff": false }));
    assert_eq!(
        liste_status(&app, &erika, einsatz, "schaeden").await,
        StatusCode::FORBIDDEN
    );
    // Ein nicht betroffenes Modul bleibt frei — und seine Liste antwortet.
    assert_eq!(v["tiere"], json!({ "sichtbar": true, "zugriff": true }));
    assert_eq!(
        liste_status(&app, &erika, einsatz, "tiere").await,
        StatusCode::OK
    );
}

#[tokio::test]
async fn org_vorgabe_laesst_fuehrungskraft_durch() {
    let (app, admin, einsatz) = aufbau().await;
    let fk = mitglied(&app, &admin, einsatz, "fritz", "fuehrungskraft").await;
    org_vorgabe(&app, &admin, "schaeden", "fuehrungskraft").await;

    let v = freigaben(&app, &fk, einsatz).await;
    assert_eq!(v["schaeden"], json!({ "sichtbar": true, "zugriff": true }));
    assert_eq!(
        liste_status(&app, &fk, einsatz, "schaeden").await,
        StatusCode::OK
    );
}

#[tokio::test]
async fn ausgeblendetes_modul_admin_erreicht_es_sieht_es_aber_nicht() {
    let (app, admin, einsatz) = aufbau().await;
    let erika = mitglied(&app, &admin, einsatz, "erika", "keine").await;
    modul_override(
        &app,
        &admin,
        einsatz,
        "meldungen",
        r#"{"sichtbar":false,"benoetigte_rolle":null}"#,
    )
    .await;

    let v = freigaben(&app, &erika, einsatz).await;
    assert_eq!(
        v["meldungen"],
        json!({ "sichtbar": false, "zugriff": false })
    );
    assert_eq!(
        liste_status(&app, &erika, einsatz, "meldungen").await,
        StatusCode::FORBIDDEN
    );

    let v = freigaben(&app, &admin, einsatz).await;
    assert_eq!(
        v["meldungen"],
        json!({ "sichtbar": false, "zugriff": true })
    );
    assert_eq!(
        liste_status(&app, &admin, einsatz, "meldungen").await,
        StatusCode::OK
    );
}

#[tokio::test]
async fn nichtmitglied_ist_403_und_unbekannter_einsatz_404() {
    let (app, admin, einsatz) = aufbau().await;
    benutzer_anlegen(&app, &admin, "fremd", "keine").await;
    let fremd = login_cookie(&app, "fremd", "fremdpw1").await;
    let (status, _) = anfrage(&app, "GET", &uri(einsatz), &fremd, None).await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    let (status, _) = anfrage(&app, "GET", &uri(9999), &admin, None).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
}

// --- Stufe „Führung im Einsatz“ (LFH-1150) ---

/// Mitglied ohne Org-Rolle mit der gegebenen Rolle im Einsatz.
async fn mit_einsatzrolle(
    app: &axum::Router,
    admin: &str,
    einsatz: i64,
    name: &str,
    rolle: &str,
) -> String {
    let id = benutzer_anlegen(app, admin, name, "keine").await;
    rolle_setzen(app, admin, einsatz, id, rolle).await;
    login_cookie(app, name, &format!("{name}pw1")).await
}

const EINSATZFUEHRUNG: &str = r#"{"sichtbar":true,"benoetigte_rolle":"einsatzfuehrung"}"#;

/// Der Anlass von LFH-1150: die Einsatzleitung ohne Org-Rolle setzt die Stufe selbst und bleibt
/// im Modul — Freigabe und Liste sagen dasselbe.
#[tokio::test]
async fn einsatzleitung_ohne_org_rolle_sperrt_sich_mit_einsatzfuehrung_nicht_aus() {
    let (app, admin, einsatz) = aufbau().await;
    let leitung = mit_einsatzrolle(&app, &admin, einsatz, "leonie", "einsatzleitung").await;
    modul_override(&app, &leitung, einsatz, "schaeden", EINSATZFUEHRUNG).await;

    let v = freigaben(&app, &leitung, einsatz).await;
    assert_eq!(v["schaeden"], json!({ "sichtbar": true, "zugriff": true }));
    assert_eq!(
        liste_status(&app, &leitung, einsatz, "schaeden").await,
        StatusCode::OK
    );
}

#[tokio::test]
async fn einsatzfuehrung_laesst_fuehrungspersonal_durch_und_sperrt_beobachter() {
    let (app, admin, einsatz) = aufbau().await;
    let personal = mit_einsatzrolle(&app, &admin, einsatz, "paulina", "fuehrungspersonal").await;
    let erika = mitglied(&app, &admin, einsatz, "erika", "keine").await;
    modul_override(&app, &admin, einsatz, "schaeden", EINSATZFUEHRUNG).await;

    let v = freigaben(&app, &personal, einsatz).await;
    assert_eq!(v["schaeden"], json!({ "sichtbar": true, "zugriff": true }));
    assert_eq!(
        liste_status(&app, &personal, einsatz, "schaeden").await,
        StatusCode::OK
    );

    let v = freigaben(&app, &erika, einsatz).await;
    assert_eq!(v["schaeden"], json!({ "sichtbar": true, "zugriff": false }));
    assert_eq!(
        liste_status(&app, &erika, einsatz, "schaeden").await,
        StatusCode::FORBIDDEN
    );
}

#[tokio::test]
async fn einsatzfuehrung_laesst_org_fuehrungskraft_ohne_mitgliedschaft_durch() {
    let (app, admin, einsatz) = aufbau().await;
    benutzer_anlegen(&app, &admin, "fritz", "fuehrungskraft").await;
    let fk = login_cookie(&app, "fritz", "fritzpw1").await;
    modul_override(&app, &admin, einsatz, "schaeden", EINSATZFUEHRUNG).await;

    let v = freigaben(&app, &fk, einsatz).await;
    assert_eq!(v["schaeden"], json!({ "sichtbar": true, "zugriff": true }));
    assert_eq!(
        liste_status(&app, &fk, einsatz, "schaeden").await,
        StatusCode::OK
    );
}

#[tokio::test]
async fn org_vorgabe_einsatzfuehrung_wirkt_ohne_override() {
    let (app, admin, einsatz) = aufbau().await;
    let leitung = mit_einsatzrolle(&app, &admin, einsatz, "leonie", "einsatzleitung").await;
    let erika = mitglied(&app, &admin, einsatz, "erika", "keine").await;
    org_vorgabe(&app, &admin, "schaeden", "einsatzfuehrung").await;

    assert_eq!(
        freigaben(&app, &leitung, einsatz).await["schaeden"],
        json!({ "sichtbar": true, "zugriff": true })
    );
    assert_eq!(
        freigaben(&app, &erika, einsatz).await["schaeden"],
        json!({ "sichtbar": true, "zugriff": false })
    );
}

/// Die bestehende Stufe behält ihr Verhalten: nur die Org-Rolle zählt.
#[tokio::test]
async fn fuehrungskraft_sperrt_einsatzleitung_ohne_org_rolle_weiter() {
    let (app, admin, einsatz) = aufbau().await;
    let leitung = mit_einsatzrolle(&app, &admin, einsatz, "leonie", "einsatzleitung").await;
    modul_override(
        &app,
        &admin,
        einsatz,
        "schaeden",
        r#"{"sichtbar":true,"benoetigte_rolle":"fuehrungskraft"}"#,
    )
    .await;

    assert_eq!(
        freigaben(&app, &leitung, einsatz).await["schaeden"],
        json!({ "sichtbar": true, "zugriff": false })
    );
    assert_eq!(
        liste_status(&app, &leitung, einsatz, "schaeden").await,
        StatusCode::FORBIDDEN
    );
}
