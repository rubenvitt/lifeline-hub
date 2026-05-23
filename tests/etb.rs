use axum::body::{to_bytes, Body};
use axum::http::{header, Request, StatusCode};
use lifeline_hub::app::{build_router, AppState};
use lifeline_hub::auth::bootstrap::bootstrap_admin;
use lifeline_hub::db;
use lifeline_hub::live::LiveHub;
use serde_json::Value;
use std::time::Duration;
use tower::ServiceExt;

/// Router + Bootstrap-Admin (admin / startpw12); liefert zusätzlich den LiveHub,
/// damit Tests direkt am Broadcast-Kanal lauschen können.
async fn setup() -> (axum::Router, LiveHub) {
    let pool = db::test_pool().await;
    bootstrap_admin(&pool, "Test-Orga", "admin", Some("startpw12"))
        .await
        .unwrap();
    let live = LiveHub::new();
    let router = build_router(AppState {
        pool,
        live: live.clone(),
    });
    (router, live)
}

async fn login_cookie(app: &axum::Router, benutzername: &str, passwort: &str) -> String {
    let body = format!(r#"{{"benutzername":"{benutzername}","passwort":"{passwort}"}}"#);
    let resp = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/auth/login")
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(body))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK, "Login muss klappen");
    resp.headers()
        .get(header::SET_COOKIE)
        .unwrap()
        .to_str()
        .unwrap()
        .split(';')
        .next()
        .unwrap()
        .to_string()
}

async fn benutzer_anlegen(
    app: &axum::Router,
    admin_cookie: &str,
    benutzername: &str,
    org_rolle: &str,
) -> i64 {
    let body = format!(
        r#"{{"anzeigename":"{benutzername}","benutzername":"{benutzername}","passwort":"{benutzername}pw1","org_rolle":"{org_rolle}"}}"#
    );
    let resp = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/benutzer")
                .header(header::CONTENT_TYPE, "application/json")
                .header(header::COOKIE, admin_cookie.to_string())
                .body(Body::from(body))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::CREATED);
    let bytes = to_bytes(resp.into_body(), usize::MAX).await.unwrap();
    serde_json::from_slice::<Value>(&bytes).unwrap()["id"]
        .as_i64()
        .unwrap()
}

async fn einsatz_anlegen(app: &axum::Router, cookie: &str, bezeichnung: &str) -> i64 {
    let body = format!(r#"{{"bezeichnung":"{bezeichnung}"}}"#);
    let resp = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/einsaetze")
                .header(header::CONTENT_TYPE, "application/json")
                .header(header::COOKIE, cookie.to_string())
                .body(Body::from(body))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::CREATED);
    let bytes = to_bytes(resp.into_body(), usize::MAX).await.unwrap();
    serde_json::from_slice::<Value>(&bytes).unwrap()["id"]
        .as_i64()
        .unwrap()
}

/// Erfasst einen Eintrag mit gegebenem JSON-Body; liefert (Status, JSON).
async fn eintrag_erfassen(
    app: &axum::Router,
    cookie: &str,
    einsatz_id: i64,
    body: &str,
) -> (StatusCode, Value) {
    let resp = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(format!("/api/einsaetze/{einsatz_id}/etb"))
                .header(header::CONTENT_TYPE, "application/json")
                .header(header::COOKIE, cookie.to_string())
                .body(Body::from(body.to_string()))
                .unwrap(),
        )
        .await
        .unwrap();
    let status = resp.status();
    let bytes = to_bytes(resp.into_body(), usize::MAX).await.unwrap();
    let json = serde_json::from_slice(&bytes).unwrap_or(Value::Null);
    (status, json)
}

#[tokio::test]
async fn einsatzleitung_erfasst_eintrag() {
    let (app, _live) = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin, "Lage").await;

    let (status, json) = eintrag_erfassen(
        &app,
        &admin,
        einsatz,
        r#"{"typ":"meldung","inhalt":"Deich instabil"}"#,
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    assert_eq!(json["lfd_nr"], 1);
    assert_eq!(json["typ"], "meldung");
    assert_eq!(json["inhalt"], "Deich instabil");
    assert_eq!(json["erfasser_name"], "Administrator");
    assert!(!json["received_at"].as_str().unwrap().is_empty());
}

#[tokio::test]
async fn beobachter_darf_nicht_erfassen() {
    let (app, _live) = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin, "Lage").await;
    let erika_id = benutzer_anlegen(&app, &admin, "erika", "keine").await;

    // Erika als Beobachterin zuweisen.
    let zuweisung = app
        .clone()
        .oneshot(
            Request::builder()
                .method("PUT")
                .uri(format!("/api/einsaetze/{einsatz}/mitglieder/{erika_id}"))
                .header(header::CONTENT_TYPE, "application/json")
                .header(header::COOKIE, admin.clone())
                .body(Body::from(r#"{"einsatz_rolle":"beobachter"}"#))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(
        zuweisung.status(),
        StatusCode::OK,
        "Beobachter-Rolle muss gesetzt werden, sonst testet der Test den Nicht-Mitglied-Pfad"
    );

    let erika = login_cookie(&app, "erika", "erikapw1").await;
    let (status, _) =
        eintrag_erfassen(&app, &erika, einsatz, r#"{"typ":"meldung","inhalt":"X"}"#).await;
    assert_eq!(status, StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn nicht_mitglied_darf_nicht_erfassen() {
    let (app, _live) = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin, "Lage").await;
    benutzer_anlegen(&app, &admin, "fremd", "keine").await;

    let fremd = login_cookie(&app, "fremd", "fremdpw1").await;
    let (status, _) =
        eintrag_erfassen(&app, &fremd, einsatz, r#"{"typ":"meldung","inhalt":"X"}"#).await;
    assert_eq!(status, StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn system_typ_wird_abgelehnt() {
    let (app, _live) = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin, "Lage").await;

    let (status, _) =
        eintrag_erfassen(&app, &admin, einsatz, r#"{"typ":"system","inhalt":"X"}"#).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn leerer_inhalt_wird_abgelehnt() {
    let (app, _live) = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin, "Lage").await;

    let (status, _) =
        eintrag_erfassen(&app, &admin, einsatz, r#"{"typ":"meldung","inhalt":"   "}"#).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn berichtigung_verknuepft_und_validiert() {
    let (app, _live) = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin, "Lage").await;

    let (_, original) = eintrag_erfassen(
        &app,
        &admin,
        einsatz,
        r#"{"typ":"meldung","inhalt":"Falsch"}"#,
    )
    .await;
    let original_id = original["id"].as_i64().unwrap();

    // Gültige Berichtigung.
    let body = format!(
        r#"{{"typ":"berichtigung","inhalt":"Korrektur","berichtigt_eintrag_id":{original_id}}}"#
    );
    let (status, json) = eintrag_erfassen(&app, &admin, einsatz, &body).await;
    assert_eq!(status, StatusCode::CREATED);
    assert_eq!(json["berichtigt_eintrag_id"], original_id);

    // Berichtigung ohne Verweis → 400.
    let (status, _) = eintrag_erfassen(
        &app,
        &admin,
        einsatz,
        r#"{"typ":"berichtigung","inhalt":"X"}"#,
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn berichtigt_eintrag_id_ohne_berichtigungstyp_ist_400() {
    let (app, _live) = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin, "Lage").await;
    let (_, e1) =
        eintrag_erfassen(&app, &admin, einsatz, r#"{"typ":"meldung","inhalt":"A"}"#).await;
    let id = e1["id"].as_i64().unwrap();

    let body = format!(r#"{{"typ":"meldung","inhalt":"B","berichtigt_eintrag_id":{id}}}"#);
    let (status, _) = eintrag_erfassen(&app, &admin, einsatz, &body).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn erfassen_in_abgeschlossenem_einsatz_ist_409() {
    let (app, _live) = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin, "Lage").await;

    app.clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(format!("/api/einsaetze/{einsatz}/abschliessen"))
                .header(header::COOKIE, admin.clone())
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    let (status, _) =
        eintrag_erfassen(&app, &admin, einsatz, r#"{"typ":"meldung","inhalt":"X"}"#).await;
    assert_eq!(status, StatusCode::CONFLICT);
}

#[tokio::test]
async fn erfassen_ohne_session_ist_401() {
    let (app, _live) = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin, "Lage").await;

    let resp = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(format!("/api/einsaetze/{einsatz}/etb"))
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(r#"{"typ":"meldung","inhalt":"X"}"#))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn erfasster_eintrag_wird_live_publiziert() {
    let (app, live) = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin, "Lage").await;

    let mut rx = live.abonniere(einsatz);
    let (status, _) = eintrag_erfassen(
        &app,
        &admin,
        einsatz,
        r#"{"typ":"meldung","inhalt":"Live-Test"}"#,
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);

    let json = tokio::time::timeout(Duration::from_secs(1), rx.recv())
        .await
        .expect("Broadcast muss innerhalb 1s ankommen")
        .expect("Broadcast-Kanal liefert Nachricht");
    let value: Value = serde_json::from_str(&json).unwrap();
    assert_eq!(value["inhalt"], "Live-Test");
}
