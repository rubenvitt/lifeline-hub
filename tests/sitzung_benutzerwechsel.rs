//! LFH-387: Schreibanfragen sind an den Benutzer gebunden, den der schreibende Tab anzeigt.
//!
//! Das Session-Cookie gilt für den ganzen Origin. Meldet sich in einem anderen Tab jemand
//! anderes an, schickt der alte Tab weiter `X-Erwarteter-Benutzer-Id` mit dem bisherigen
//! Benutzer. Geprüft wird im `CurrentUser`-Extractor, also an jeder authentifizierten Route —
//! hier belegt an Schreibrouten der drei Extractor-Familien (`CurrentUser` direkt,
//! `AdminUser`, `EinsatzKontext`), jeweils als Paar „passend → geschrieben“ und „abweichend →
//! 412, nichts geschrieben“. Die Sitzung, unter der geschrieben wird, gehört in allen Fällen dem
//! Admin; der „veraltete Tab“ erwartet den zweiten Benutzer.

use axum::body::{to_bytes, Body};
use axum::http::{header, Request, StatusCode};
use serde_json::Value;
use tower::ServiceExt;

mod common;
use common::{anfrage, benutzer_anlegen, einsatz_anlegen, login_cookie, setup};

const KOPF: &str = "X-Erwarteter-Benutzer-Id";

/// Wie `common::anfrage`, mit dem erwarteten Benutzer als Kopf.
async fn anfrage_erwartet(
    app: &axum::Router,
    methode: &str,
    uri: &str,
    cookie: &str,
    body: Option<&str>,
    erwartet: &str,
) -> (StatusCode, Value) {
    let mut req = Request::builder()
        .method(methode)
        .uri(uri)
        .header(header::COOKIE, cookie.to_string())
        .header(KOPF, erwartet);
    let body = match body {
        Some(b) => {
            req = req.header(header::CONTENT_TYPE, "application/json");
            Body::from(b.to_string())
        }
        None => Body::empty(),
    };
    let resp = app.clone().oneshot(req.body(body).unwrap()).await.unwrap();
    let status = resp.status();
    let bytes = to_bytes(resp.into_body(), usize::MAX).await.unwrap();
    (
        status,
        serde_json::from_slice(&bytes).unwrap_or(Value::Null),
    )
}

async fn eigene_id(app: &axum::Router, cookie: &str) -> i64 {
    let (status, me) = anfrage(app, "GET", "/api/auth/me", cookie, None).await;
    assert_eq!(status, StatusCode::OK);
    me["id"].as_i64().unwrap()
}

async fn anzahl(app: &axum::Router, cookie: &str, uri: &str) -> usize {
    let (status, liste) = anfrage(app, "GET", uri, cookie, None).await;
    assert_eq!(status, StatusCode::OK, "{uri}");
    liste
        .as_array()
        .or_else(|| liste["eintraege"].as_array())
        .unwrap_or_else(|| panic!("{uri} liefert keine Liste: {liste}"))
        .len()
}

/// Admin-Sitzung, Admin-id und die id eines zweiten Benutzers (des „neuen“).
async fn zwei_benutzer(app: &axum::Router) -> (String, i64, i64) {
    let admin = login_cookie(app, "admin", "startpw12").await;
    let admin_id = eigene_id(app, &admin).await;
    let zweiter = benutzer_anlegen(app, &admin, "bruno", "keine").await;
    (admin, admin_id, zweiter)
}

#[tokio::test]
async fn current_user_route_schreibt_nur_unter_dem_erwarteten_benutzer() {
    let app = setup().await;
    let (admin, admin_id, zweiter) = zwei_benutzer(&app).await;
    let vorher = anzahl(&app, &admin, "/api/einsaetze").await;

    let body = r#"{"bezeichnung":"Veralteter Tab"}"#;
    let (status, antwort) = anfrage_erwartet(
        &app,
        "POST",
        "/api/einsaetze",
        &admin,
        Some(body),
        &zweiter.to_string(),
    )
    .await;
    assert_eq!(status, StatusCode::PRECONDITION_FAILED);
    assert_eq!(
        antwort["error"],
        "Die Sitzung gehört inzwischen einem anderen Benutzer"
    );
    assert_eq!(anzahl(&app, &admin, "/api/einsaetze").await, vorher);

    let (status, _) = anfrage_erwartet(
        &app,
        "POST",
        "/api/einsaetze",
        &admin,
        Some(body),
        &admin_id.to_string(),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    assert_eq!(anzahl(&app, &admin, "/api/einsaetze").await, vorher + 1);
}

#[tokio::test]
async fn admin_route_schreibt_nur_unter_dem_erwarteten_benutzer() {
    let app = setup().await;
    let (admin, admin_id, zweiter) = zwei_benutzer(&app).await;
    let vorher = anzahl(&app, &admin, "/api/benutzer").await;

    let body = r#"{"anzeigename":"Carla","benutzername":"carla","passwort":"carlapw12","org_rolle":"keine"}"#;
    let (status, _) = anfrage_erwartet(
        &app,
        "POST",
        "/api/benutzer",
        &admin,
        Some(body),
        &zweiter.to_string(),
    )
    .await;
    assert_eq!(status, StatusCode::PRECONDITION_FAILED);
    assert_eq!(anzahl(&app, &admin, "/api/benutzer").await, vorher);

    let (status, _) = anfrage_erwartet(
        &app,
        "POST",
        "/api/benutzer",
        &admin,
        Some(body),
        &admin_id.to_string(),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    assert_eq!(anzahl(&app, &admin, "/api/benutzer").await, vorher + 1);
}

#[tokio::test]
async fn etb_schreibt_und_replayt_nur_unter_dem_erwarteten_benutzer() {
    let app = setup().await;
    let (admin, admin_id, zweiter) = zwei_benutzer(&app).await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let etb = format!("/api/einsaetze/{einsatz}/etb");
    let vorher = anzahl(&app, &admin, &etb).await;

    let body = r#"{"typ":"meldung","inhalt":"Aus dem alten Tab","client_id":"lfh-387-1"}"#;
    let (status, _) =
        anfrage_erwartet(&app, "POST", &etb, &admin, Some(body), &zweiter.to_string()).await;
    assert_eq!(status, StatusCode::PRECONDITION_FAILED);
    assert_eq!(anzahl(&app, &admin, &etb).await, vorher);

    let (status, _) =
        anfrage_erwartet(&app, "POST", &etb, &admin, Some(body), &admin_id.to_string()).await;
    assert_eq!(status, StatusCode::CREATED);
    assert_eq!(anzahl(&app, &admin, &etb).await, vorher + 1);

    // Auch der idempotente Replay derselben client_id wird nicht an einen fremd erwartenden
    // Tab ausgeliefert: der Extractor lehnt ab, bevor der Handler nachschlägt.
    let (status, antwort) =
        anfrage_erwartet(&app, "POST", &etb, &admin, Some(body), &zweiter.to_string()).await;
    assert_eq!(status, StatusCode::PRECONDITION_FAILED);
    assert!(antwort.get("id").is_none(), "kein Replay-Körper: {antwort}");
}

#[tokio::test]
async fn einsatz_kontext_route_schreibt_nur_unter_dem_erwarteten_benutzer() {
    // `EinsatzSchreibzugriff<Auftraege>` läuft über `EinsatzKontext` → `CurrentUser`.
    let app = setup().await;
    let (admin, admin_id, zweiter) = zwei_benutzer(&app).await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let auftraege = format!("/api/einsaetze/{einsatz}/auftraege");
    let vorher = anzahl(&app, &admin, &auftraege).await;

    let body = serde_json::json!({
        "auftrag_text": "Deich sichern",
        "empfaenger": [{ "empfaenger_typ": "funktion", "funktion_text": "Abschnitt Nord" }]
    })
    .to_string();
    let (status, _) = anfrage_erwartet(
        &app,
        "POST",
        &auftraege,
        &admin,
        Some(&body),
        &zweiter.to_string(),
    )
    .await;
    assert_eq!(status, StatusCode::PRECONDITION_FAILED);
    assert_eq!(anzahl(&app, &admin, &auftraege).await, vorher);

    let (status, _) = anfrage_erwartet(
        &app,
        "POST",
        &auftraege,
        &admin,
        Some(&body),
        &admin_id.to_string(),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    assert_eq!(anzahl(&app, &admin, &auftraege).await, vorher + 1);
}

#[tokio::test]
async fn ohne_kopf_und_bei_lesenden_anfragen_bleibt_alles_wie_bisher() {
    let app = setup().await;
    let (admin, _, zweiter) = zwei_benutzer(&app).await;

    let (status, _) = anfrage(
        &app,
        "POST",
        "/api/einsaetze",
        &admin,
        Some(r#"{"bezeichnung":"Ohne Kopf"}"#),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);

    let (status, _) = anfrage_erwartet(
        &app,
        "GET",
        "/api/einsaetze",
        &admin,
        None,
        &zweiter.to_string(),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
}

#[tokio::test]
async fn ungueltiger_kopf_ist_412_und_tote_sitzung_bleibt_401() {
    let app = setup().await;
    let (admin, admin_id, _) = zwei_benutzer(&app).await;
    let body = Some(r#"{"bezeichnung":"x"}"#);

    let (status, _) =
        anfrage_erwartet(&app, "POST", "/api/einsaetze", &admin, body, "kein-wert").await;
    assert_eq!(status, StatusCode::PRECONDITION_FAILED);

    let (status, _) = anfrage_erwartet(
        &app,
        "POST",
        "/api/einsaetze",
        "lifeline_sid=abgelaufen",
        body,
        &admin_id.to_string(),
    )
    .await;
    assert_eq!(
        status,
        StatusCode::UNAUTHORIZED,
        "eine tote Sitzung ist 401, auch mit Kopf"
    );
}

#[tokio::test]
async fn logout_aus_veraltetem_tab_beendet_die_fremde_sitzung_nicht() {
    let app = setup().await;
    let (admin, admin_id, zweiter) = zwei_benutzer(&app).await;

    let (status, _) = anfrage_erwartet(
        &app,
        "POST",
        "/api/auth/logout",
        &admin,
        None,
        &zweiter.to_string(),
    )
    .await;
    assert_eq!(status, StatusCode::PRECONDITION_FAILED);
    let (status, _) = anfrage(&app, "GET", "/api/auth/me", &admin, None).await;
    assert_eq!(status, StatusCode::OK, "die Sitzung muss weiterleben");

    let (status, _) = anfrage_erwartet(
        &app,
        "POST",
        "/api/auth/logout",
        &admin,
        None,
        &admin_id.to_string(),
    )
    .await;
    assert_eq!(status, StatusCode::NO_CONTENT);
    let (status, _) = anfrage(&app, "GET", "/api/auth/me", &admin, None).await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn logout_mit_toter_sitzung_raeumt_wie_bisher() {
    let app = setup().await;
    let (status, _) = anfrage_erwartet(
        &app,
        "POST",
        "/api/auth/logout",
        "lifeline_sid=abgelaufen",
        None,
        "1",
    )
    .await;
    assert_eq!(status, StatusCode::NO_CONTENT);
}
