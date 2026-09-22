//! `GET /api/einsaetze/{id}/etb/anzahl` (LFH-619): die Trefferzahl des ETB-Filters, für den
//! Sammeltreffer der Sprungpalette („ETB · Einträge zu „Deich“ — 31 Treffer“).
//!
//! Die Zahl MUSS denselben Filter zählen wie die Liste — ein eigener WHERE-Zweig für die
//! Zählung wäre eine zweite Meinung darüber, was „Treffer“ heißt. Deshalb prüfen die Tests
//! die Zahl gegen die Länge der Liste mit demselben Query-String.
use axum::body::{to_bytes, Body};
use axum::http::{header, Request, StatusCode};
use lifeline_hub::app::{build_router, AppState};
use lifeline_hub::auth::bootstrap::bootstrap_admin;
use lifeline_hub::db;
use lifeline_hub::live::LiveHub;
use serde_json::Value;
use tower::ServiceExt;

mod common;
use common::{benutzer_anlegen, login_cookie};

async fn setup() -> axum::Router {
    let pool = db::test_pool().await;
    bootstrap_admin(&pool, "Test-Orga", "admin", Some("startpw12"))
        .await
        .unwrap();
    build_router(AppState {
        pool,
        live: LiveHub::new(),
        karten_dir: std::env::temp_dir(),
        fachebenen: lifeline_hub::karte::FachebenenState::neu(),
        download_client: lifeline_hub::karte::download::download_client(),
        download_fortschritt: lifeline_hub::karte::download::neue_fortschritt_map(),
        karten_service_url: None,
        karten_service_token: None,
    })
}

async fn anfrage(
    app: &axum::Router,
    cookie: &str,
    method: &str,
    uri: &str,
    body: Option<String>,
) -> (StatusCode, Value) {
    let mut b = Request::builder()
        .method(method)
        .uri(uri)
        .header(header::COOKIE, cookie.to_string());
    if body.is_some() {
        b = b.header(header::CONTENT_TYPE, "application/json");
    }
    let resp = app
        .clone()
        .oneshot(
            b.body(body.map(Body::from).unwrap_or_else(Body::empty))
                .unwrap(),
        )
        .await
        .unwrap();
    let status = resp.status();
    let bytes = to_bytes(resp.into_body(), usize::MAX).await.unwrap();
    (
        status,
        serde_json::from_slice(&bytes).unwrap_or(Value::Null),
    )
}

async fn einsatz_mit_eintraegen(app: &axum::Router, cookie: &str, inhalte: &[(&str, &str)]) -> i64 {
    let (status, json) = anfrage(
        app,
        cookie,
        "POST",
        "/api/einsaetze",
        Some(r#"{"bezeichnung":"Hochwasser"}"#.into()),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    let id = json["id"].as_i64().unwrap();
    for (typ, inhalt) in inhalte {
        let (s, _) = anfrage(
            app,
            cookie,
            "POST",
            &format!("/api/einsaetze/{id}/etb"),
            Some(format!(r#"{{"typ":"{typ}","inhalt":"{inhalt}"}}"#)),
        )
        .await;
        assert_eq!(s, StatusCode::CREATED);
    }
    id
}

const BESTAND: &[(&str, &str)] = &[
    ("meldung", "Deich Nord durchfeuchtet"),
    ("meldung", "Deich Süd hält"),
    ("anordnung", "Sandsäcke an den Deich"),
    ("meldung", "Lage ruhig"),
];

#[tokio::test]
async fn zaehlt_volltexttreffer_wie_die_liste() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_mit_eintraegen(&app, &admin, BESTAND).await;

    let (status, json) = anfrage(
        &app,
        &admin,
        "GET",
        &format!("/api/einsaetze/{e}/etb/anzahl?q=Deich"),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(json["anzahl"], 3);

    // Gegenprobe gegen die Liste mit demselben Filter — die Zahl ist keine eigene Meinung.
    let (_, liste) = anfrage(
        &app,
        &admin,
        "GET",
        &format!("/api/einsaetze/{e}/etb?q=Deich"),
        None,
    )
    .await;
    assert_eq!(liste.as_array().unwrap().len(), 3);
}

#[tokio::test]
async fn zaehlt_ohne_limit() {
    // Der Sammeltreffer steht gerade dort, wo die Liste gedeckelt ist: die Zahl darf am
    // Seitendeckel der Liste nicht enden. `limit` ist an dieser Route kein Parameter.
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_mit_eintraegen(&app, &admin, BESTAND).await;

    let (_, json) = anfrage(
        &app,
        &admin,
        "GET",
        &format!("/api/einsaetze/{e}/etb/anzahl?q=Deich&limit=1"),
        None,
    )
    .await;
    assert_eq!(json["anzahl"], 3);
}

#[tokio::test]
async fn filter_werden_verknuepft() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_mit_eintraegen(&app, &admin, BESTAND).await;

    let (_, json) = anfrage(
        &app,
        &admin,
        "GET",
        &format!("/api/einsaetze/{e}/etb/anzahl?q=Deich&typ=anordnung"),
        None,
    )
    .await;
    assert_eq!(json["anzahl"], 1);
    let (_, alle) = anfrage(
        &app,
        &admin,
        "GET",
        &format!("/api/einsaetze/{e}/etb/anzahl"),
        None,
    )
    .await;
    assert_eq!(alle["anzahl"], 4);
}

#[tokio::test]
async fn kein_treffer_ist_null_nicht_404() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_mit_eintraegen(&app, &admin, BESTAND).await;

    let (status, json) = anfrage(
        &app,
        &admin,
        "GET",
        &format!("/api/einsaetze/{e}/etb/anzahl?q=Pegel"),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(json["anzahl"], 0);
}

#[tokio::test]
async fn ungueltiger_typ_ist_400() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_mit_eintraegen(&app, &admin, &[]).await;

    let (status, _) = anfrage(
        &app,
        &admin,
        "GET",
        &format!("/api/einsaetze/{e}/etb/anzahl?typ=unsinn"),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn nur_fuer_mitglieder() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_mit_eintraegen(&app, &admin, BESTAND).await;
    benutzer_anlegen(&app, &admin, "fremd", "keine").await;
    let fremd = login_cookie(&app, "fremd", "fremdpw1").await;

    let (status, _) = anfrage(
        &app,
        &fremd,
        "GET",
        &format!("/api/einsaetze/{e}/etb/anzahl?q=Deich"),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn zaehlt_nur_den_eigenen_einsatz() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e1 = einsatz_mit_eintraegen(&app, &admin, BESTAND).await;
    let e2 = einsatz_mit_eintraegen(&app, &admin, &[("meldung", "Deich West")]).await;

    let (_, json) = anfrage(
        &app,
        &admin,
        "GET",
        &format!("/api/einsaetze/{e2}/etb/anzahl?q=Deich"),
        None,
    )
    .await;
    assert_eq!(json["anzahl"], 1);
    let (_, json) = anfrage(
        &app,
        &admin,
        "GET",
        &format!("/api/einsaetze/{e1}/etb/anzahl?q=Deich"),
        None,
    )
    .await;
    assert_eq!(json["anzahl"], 3);
}
