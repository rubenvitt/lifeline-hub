//! HTTP-Integrationstests für karte_hintergrundbild-Routen (LFH-35).
//!
//! Abdeckung:
//!   (a) Upload → Liste → Download-Roundtrip (Bytes identisch, Content-Type image/png)
//!   (b) Beobachter ohne Schreibrecht → 403 beim Upload
//!   (c) Nicht-Bild-Datei (GIF) → 400 (erkenne_bild_mime)
//!
//! Auslassung: Content-Disposition-Header (karte_hintergrundbild::herunterladen setzt
//! keinen) — explizit nicht geprüft (kein Bug, Design-Entscheid).

use axum::body::{to_bytes, Body};
use axum::http::{header, HeaderMap, Request, StatusCode};
use lifeline_hub::app::{build_router, AppState};
use lifeline_hub::auth::bootstrap::bootstrap_admin;
use lifeline_hub::db;
use lifeline_hub::live::LiveHub;
use serde_json::Value;
use tower::ServiceExt;

mod common;
use common::login_cookie;

// ---------- Harness ----------

async fn setup_mit_pool() -> (axum::Router, sqlx::SqlitePool) {
    let pool = db::test_pool().await;
    bootstrap_admin(&pool, "Test-Orga", "admin", Some("startpw12"))
        .await
        .unwrap();
    let router = build_router(AppState {
        pool: pool.clone(),
        live: LiveHub::new(),
        karten_dir: std::env::temp_dir(),
        fachebenen: lifeline_hub::karte::FachebenenState::neu(),
        download_client: lifeline_hub::karte::download::download_client(),
        download_fortschritt: lifeline_hub::karte::download::neue_fortschritt_map(),
        karten_service_url: None,
        karten_service_token: None,
    });
    (router, pool)
}

async fn setup() -> axum::Router {
    setup_mit_pool().await.0
}

async fn json_anfrage(
    app: &axum::Router,
    methode: &str,
    uri: &str,
    cookie: &str,
    body: Option<&str>,
) -> (StatusCode, Value) {
    let mut req = Request::builder()
        .method(methode)
        .uri(uri)
        .header(header::COOKIE, cookie.to_string());
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
    let value = if bytes.is_empty() {
        Value::Null
    } else {
        serde_json::from_slice(&bytes).unwrap_or(Value::Null)
    };
    (status, value)
}

async fn einsatz_anlegen(app: &axum::Router, cookie: &str) -> i64 {
    let (s, v) = json_anfrage(
        app,
        "POST",
        "/api/einsaetze",
        cookie,
        Some(r#"{"bezeichnung":"Lage"}"#),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "einsatz_anlegen: {v:?}");
    v["id"].as_i64().unwrap()
}

async fn benutzer_anlegen(
    app: &axum::Router,
    admin_cookie: &str,
    name: &str,
    org_rolle: &str,
) -> i64 {
    let body = format!(
        r#"{{"anzeigename":"{name}","benutzername":"{name}","passwort":"{name}pw1","org_rolle":"{org_rolle}"}}"#
    );
    let (s, v) = json_anfrage(app, "POST", "/api/benutzer", admin_cookie, Some(&body)).await;
    assert_eq!(s, StatusCode::CREATED, "benutzer_anlegen: {v:?}");
    v["id"].as_i64().unwrap()
}

async fn rolle_setzen(
    app: &axum::Router,
    leit_cookie: &str,
    einsatz: i64,
    benutzer_id: i64,
    rolle: &str,
) {
    let body = format!(r#"{{"einsatz_rolle":"{rolle}"}}"#);
    let (s, _) = json_anfrage(
        app,
        "PUT",
        &format!("/api/einsaetze/{einsatz}/mitglieder/{benutzer_id}"),
        leit_cookie,
        Some(&body),
    )
    .await;
    assert_eq!(s, StatusCode::OK);
}

/// Baut einen Multipart-Body mit den Feldern `datei` (Bildbytes) und `ecken` (JSON-String).
/// Optional kann ein `name`-Feld übergeben werden.
fn multipart_bild(
    boundary: &str,
    dateiname: &str,
    content_type: &str,
    daten: &[u8],
    ecken: &str,
) -> Vec<u8> {
    let mut body = Vec::new();
    // datei-Feld
    body.extend_from_slice(
        format!(
            "--{boundary}\r\nContent-Disposition: form-data; name=\"datei\"; filename=\"{dateiname}\"\r\nContent-Type: {content_type}\r\n\r\n"
        )
        .as_bytes(),
    );
    body.extend_from_slice(daten);
    body.extend_from_slice(b"\r\n");
    // ecken-Feld
    body.extend_from_slice(
        format!("--{boundary}\r\nContent-Disposition: form-data; name=\"ecken\"\r\n\r\n")
            .as_bytes(),
    );
    body.extend_from_slice(ecken.as_bytes());
    body.extend_from_slice(b"\r\n");
    // Abschluss
    body.extend_from_slice(format!("--{boundary}--\r\n").as_bytes());
    body
}

/// POST Upload → (Status, JSON)
async fn upload_bild(
    app: &axum::Router,
    einsatz_id: i64,
    cookie: &str,
    dateiname: &str,
    content_type: &str,
    daten: &[u8],
    ecken: &str,
) -> (StatusCode, Value) {
    let boundary = "LFHTESTBND";
    let body = multipart_bild(boundary, dateiname, content_type, daten, ecken);
    let resp = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(format!(
                    "/api/einsaetze/{einsatz_id}/karte/hintergrundbilder"
                ))
                .header(header::COOKIE, cookie)
                .header(
                    header::CONTENT_TYPE,
                    format!("multipart/form-data; boundary={boundary}"),
                )
                .body(Body::from(body))
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

/// GET Download → (Status, Header, Bytes)
async fn download_bild(
    app: &axum::Router,
    einsatz_id: i64,
    bild_id: i64,
    cookie: &str,
) -> (StatusCode, HeaderMap, Vec<u8>) {
    let resp = app
        .clone()
        .oneshot(
            Request::builder()
                .method("GET")
                .uri(format!(
                    "/api/einsaetze/{einsatz_id}/karte/hintergrundbilder/{bild_id}/download"
                ))
                .header(header::COOKIE, cookie)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    let status = resp.status();
    let headers = resp.headers().clone();
    let bytes = to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap()
        .to_vec();
    (status, headers, bytes)
}

// ---------- Minimal-PNG (1x1 Pixel, 67 Bytes) ----------
// Valides PNG mit Magic-Bytes für erkenne_bild_mime.
fn minimal_png() -> Vec<u8> {
    vec![
        0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, // PNG-Magic
        0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52, // IHDR-Chunk-Länge + "IHDR"
        0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, // Breite=1, Höhe=1
        0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53, // Bit-Tiefe, Farbtyp, ...
        0xDE, 0x00, 0x00, 0x00, 0x0C, 0x49, 0x44, 0x41, // IDAT-Chunk-Länge + "IDAT"
        0x54, 0x08, 0xD7, 0x63, 0xF8, 0xCF, 0xC0, 0x00, // Daten (deflate-komprimiert)
        0x00, 0x00, 0x02, 0x00, 0x01, 0xE2, 0x21, 0xBC, // ...
        0x33, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4E, // IEND-Chunk-Länge + "IEND"
        0x44, 0xAE, 0x42, 0x60, 0x82, // ...
    ]
}

const ECKEN: &str = "[[9.0,50.0],[9.1,50.0],[9.1,49.9],[9.0,49.9]]";

// ---------- Tests ----------

/// (a) Upload → Liste → Download-Roundtrip.
/// Prüft: 201 beim Upload, 1 Eintrag in der Liste, Download liefert identische
/// Bytes und Content-Type image/png.
#[tokio::test]
async fn upload_liste_download_roundtrip() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let png = minimal_png();

    // Upload
    let (status, bild) =
        upload_bild(&app, einsatz, &admin, "plan.png", "image/png", &png, ECKEN).await;
    assert_eq!(status, StatusCode::CREATED, "Upload: {bild:?}");
    let bild_id = bild["id"].as_i64().expect("id im Upload-Response");
    assert_eq!(bild["mime"].as_str(), Some("image/png"));
    assert_eq!(bild["groesse"].as_i64(), Some(png.len() as i64));
    assert_eq!(bild["ecken_json"].as_str(), Some(ECKEN));

    // Liste: genau 1 Eintrag
    let (s, liste) = json_anfrage(
        &app,
        "GET",
        &format!("/api/einsaetze/{einsatz}/karte/hintergrundbilder"),
        &admin,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK, "Liste: {liste:?}");
    let arr = liste.as_array().expect("Liste ist Array");
    assert_eq!(arr.len(), 1, "genau 1 Bild in der Liste");
    assert_eq!(arr[0]["id"].as_i64(), Some(bild_id));

    // Download: Bytes und MIME identisch
    let (s, headers, bytes) = download_bild(&app, einsatz, bild_id, &admin).await;
    assert_eq!(s, StatusCode::OK, "Download Status");
    assert_eq!(bytes, png, "Download-Bytes stimmen mit Upload überein");
    assert_eq!(
        headers.get(header::CONTENT_TYPE).unwrap(),
        "image/png",
        "Content-Type image/png"
    );
    // Hinweis: karte_hintergrundbild::herunterladen setzt kein Content-Disposition-Header —
    // das ist kein Fehler, nur Unterschied zu anhang.rs.
}

/// (b) Beobachter ohne Schreibrecht → POST Upload → 403.
#[tokio::test]
async fn beobachter_darf_nicht_hochladen() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;

    let beo_id = benutzer_anlegen(&app, &admin, "beobachter1", "keine").await;
    rolle_setzen(&app, &admin, einsatz, beo_id, "beobachter").await;
    let beo = login_cookie(&app, "beobachter1", "beobachter1pw1").await;

    let png = minimal_png();
    let (status, _) = upload_bild(&app, einsatz, &beo, "x.png", "image/png", &png, ECKEN).await;
    assert_eq!(
        status,
        StatusCode::FORBIDDEN,
        "Beobachter muss 403 erhalten"
    );
}

/// (c) Nicht-Bild (GIF-Magic) → 400 (erkenne_bild_mime schlägt an).
/// Ecken werden mitgesendet, damit der Fehler garantiert von der MIME-Prüfung stammt.
#[tokio::test]
async fn nicht_bild_wird_abgelehnt() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;

    // GIF-Magic: kein PNG/JPEG → erkenne_bild_mime schlägt fehl
    let gif =
        b"GIF89a\x01\x00\x01\x00\x00\xff\x00\x2c\x00\x00\x00\x00\x01\x00\x01\x00\x00\x02\x00\x3b";
    let (status, _) = upload_bild(&app, einsatz, &admin, "bild.gif", "image/gif", gif, ECKEN).await;
    assert_eq!(status, StatusCode::BAD_REQUEST, "GIF muss 400 ergeben");
}
