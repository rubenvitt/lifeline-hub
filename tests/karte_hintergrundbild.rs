//! HTTP-Integrationstests für karte_hintergrundbild-Routen (LFH-35).
//!
//! Abdeckung:
//!   (a) Upload → Liste → Download-Roundtrip (Bytes identisch, Content-Type image/png)
//!   (b) Beobachter ohne Schreibrecht → 403 beim Upload
//!   (c) Nicht-Bild-Datei (GIF) → 400 (erkenne_bild_mime)
//!   (d) Download setzt `Content-Disposition: attachment` (LFH-238) — konsistent zu anhang.rs.

use axum::body::{to_bytes, Body};
use axum::http::{header, HeaderMap, Request, StatusCode};
use serde_json::{json, Value};
use tower::ServiceExt;

mod common;
use common::{
    anfrage, benutzer_anlegen, einsatz_anlegen, karten_ansicht_anlegen, login_cookie, rolle_setzen,
    setup, standard_ansicht_id,
};

// ---------- Harness ----------

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
    let (s, liste) = anfrage(
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
    // Content-Disposition wird separat in download_setzt_content_disposition_attachment geprüft.
}

/// G05 (LFH-238): Der Download setzt jetzt — konsistent zu anhang.rs — einen
/// `Content-Disposition: attachment`-Header mit dem Bildnamen. Rendering-neutral
/// (das Frontend lädt per fetch→Blob), aber Defense-in-Depth bei direktem
/// Browser-Zugriff und beendet die Inkonsistenz zwischen den Upload-Pfaden.
#[tokio::test]
async fn download_setzt_content_disposition_attachment() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let png = minimal_png();

    let (status, bild) =
        upload_bild(&app, einsatz, &admin, "plan.png", "image/png", &png, ECKEN).await;
    assert_eq!(status, StatusCode::CREATED, "Upload: {bild:?}");
    let bild_id = bild["id"].as_i64().unwrap();

    let (s, headers, _) = download_bild(&app, einsatz, bild_id, &admin).await;
    assert_eq!(s, StatusCode::OK);
    let cd = headers
        .get(header::CONTENT_DISPOSITION)
        .expect("Content-Disposition gesetzt")
        .to_str()
        .unwrap();
    assert!(cd.starts_with("attachment"), "attachment-Disposition: {cd}");
    assert!(cd.contains("plan.png"), "Dateiname im Header: {cd}");
}

/// LFH-797: Die Route setzt `nosniff` nicht selbst; die Schicht in `app.rs` hängt ihn an
/// (Spec `http-schutzkoepfe`). Hochgeladene Bytes dürfen nie als etwas anderes gedeutet werden.
#[tokio::test]
async fn download_setzt_nosniff() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let png = minimal_png();

    let (status, bild) =
        upload_bild(&app, einsatz, &admin, "plan.png", "image/png", &png, ECKEN).await;
    assert_eq!(status, StatusCode::CREATED, "Upload: {bild:?}");
    let bild_id = bild["id"].as_i64().unwrap();

    let (s, headers, _) = download_bild(&app, einsatz, bild_id, &admin).await;
    assert_eq!(s, StatusCode::OK);
    let werte: Vec<_> = headers
        .get_all(header::X_CONTENT_TYPE_OPTIONS)
        .iter()
        .collect();
    assert_eq!(werte, ["nosniff"], "X-Content-Type-Options: {werte:?}");
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

/// GET Download mit optionalem `If-None-Match`: (Status, Header, Bytes).
async fn download_bild_inm(
    app: &axum::Router,
    einsatz_id: i64,
    bild_id: i64,
    cookie: &str,
    if_none_match: Option<&str>,
) -> (StatusCode, HeaderMap, Vec<u8>) {
    let mut req = Request::builder()
        .method("GET")
        .uri(format!(
            "/api/einsaetze/{einsatz_id}/karte/hintergrundbilder/{bild_id}/download"
        ))
        .header(header::COOKIE, cookie);
    if let Some(etag) = if_none_match {
        req = req.header(header::IF_NONE_MATCH, etag);
    }
    let resp = app
        .clone()
        .oneshot(req.body(Body::empty()).unwrap())
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

/// G04 (LFH-258): Der Bild-Download trägt starken ETag (sha256) + Cache-Control (immutable).
#[tokio::test]
async fn download_setzt_etag_und_cache_control() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let png = minimal_png();
    let (_, bild) = upload_bild(&app, einsatz, &admin, "plan.png", "image/png", &png, ECKEN).await;
    let bild_id = bild["id"].as_i64().unwrap();

    let (s, headers, _) = download_bild(&app, einsatz, bild_id, &admin).await;
    assert_eq!(s, StatusCode::OK);
    let etag = headers.get(header::ETAG).expect("ETag").to_str().unwrap();
    assert_eq!(
        etag.trim_matches('"').len(),
        64,
        "sha256-Hex als ETag: {etag}"
    );
    let cc = headers
        .get(header::CACHE_CONTROL)
        .expect("Cache-Control")
        .to_str()
        .unwrap();
    assert!(
        cc.contains("private") && cc.contains("immutable"),
        "Cache-Control: {cc}"
    );
}

/// G04: `If-None-Match` mit passendem ETag → 304 ohne Body; unpassend → 200 mit Body.
#[tokio::test]
async fn download_if_none_match_liefert_304() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let png = minimal_png();
    let (_, bild) = upload_bild(&app, einsatz, &admin, "plan.png", "image/png", &png, ECKEN).await;
    let bild_id = bild["id"].as_i64().unwrap();

    let (_, headers, _) = download_bild(&app, einsatz, bild_id, &admin).await;
    let etag = headers
        .get(header::ETAG)
        .unwrap()
        .to_str()
        .unwrap()
        .to_string();

    let (s304, _, body304) = download_bild_inm(&app, einsatz, bild_id, &admin, Some(&etag)).await;
    assert_eq!(s304, StatusCode::NOT_MODIFIED, "passend → 304");
    assert!(body304.is_empty(), "304 ohne Body");

    let (s200, _, body200) =
        download_bild_inm(&app, einsatz, bild_id, &admin, Some("\"deadbeef\"")).await;
    assert_eq!(s200, StatusCode::OK, "unpassend → 200");
    assert_eq!(body200, png, "voller Body bei 200");
}

// ---------- B (LFH-320): Ansichts-Zugehörigkeit ----------

/// Upload mit optionalem `ansicht_id`-Multipart-Feld → (Status, JSON).
async fn upload_bild_ansicht(
    app: &axum::Router,
    einsatz_id: i64,
    cookie: &str,
    daten: &[u8],
    ecken: &str,
    ansicht_id: Option<i64>,
) -> (StatusCode, Value) {
    let boundary = "LFHTESTBND";
    let mut body = Vec::new();
    body.extend_from_slice(
        format!(
            "--{boundary}\r\nContent-Disposition: form-data; name=\"datei\"; filename=\"plan.png\"\r\nContent-Type: image/png\r\n\r\n"
        )
        .as_bytes(),
    );
    body.extend_from_slice(daten);
    body.extend_from_slice(b"\r\n");
    body.extend_from_slice(
        format!("--{boundary}\r\nContent-Disposition: form-data; name=\"ecken\"\r\n\r\n")
            .as_bytes(),
    );
    body.extend_from_slice(ecken.as_bytes());
    body.extend_from_slice(b"\r\n");
    if let Some(a) = ansicht_id {
        body.extend_from_slice(
            format!("--{boundary}\r\nContent-Disposition: form-data; name=\"ansicht_id\"\r\n\r\n{a}\r\n")
                .as_bytes(),
        );
    }
    body.extend_from_slice(format!("--{boundary}--\r\n").as_bytes());

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

/// Multipart-Upload mit `ansicht_id`-Feld stempelt die Zugehörigkeit des Bildes.
#[tokio::test]
async fn upload_mit_ansicht_id_stempelt_zugehoerigkeit() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let aid = standard_ansicht_id(&app, &admin, einsatz).await;

    let (s, bild) =
        upload_bild_ansicht(&app, einsatz, &admin, &minimal_png(), ECKEN, Some(aid)).await;
    assert_eq!(s, StatusCode::CREATED, "{bild:?}");
    assert_eq!(bild["ansicht_id"], aid, "ansicht_id gestempelt: {bild:?}");
}

/// `?ansicht=X` liefert die X-Bilder und die NULL-Bilder, NICHT die von Y (Negativ-
/// Assertion, Mutationsprobe-Ziel).
#[tokio::test]
async fn liste_ansicht_filtert_fremde_aus_haelt_null() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let x = standard_ansicht_id(&app, &admin, einsatz).await;
    let y = karten_ansicht_anlegen(&app, &admin, einsatz, "Y").await;
    let png = minimal_png();

    let (_, bx) = upload_bild_ansicht(&app, einsatz, &admin, &png, ECKEN, Some(x)).await;
    let (_, by) = upload_bild_ansicht(&app, einsatz, &admin, &png, ECKEN, Some(y)).await;
    let (_, bnull) = upload_bild_ansicht(&app, einsatz, &admin, &png, ECKEN, None).await;
    let (bx, by, bnull) = (
        bx["id"].as_i64().unwrap(),
        by["id"].as_i64().unwrap(),
        bnull["id"].as_i64().unwrap(),
    );

    let (s, liste) = anfrage(
        &app,
        "GET",
        &format!("/api/einsaetze/{einsatz}/karte/hintergrundbilder?ansicht={x}"),
        &admin,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{liste:?}");
    let ids: Vec<i64> = liste
        .as_array()
        .unwrap()
        .iter()
        .map(|b| b["id"].as_i64().unwrap())
        .collect();
    assert!(ids.contains(&bx), "X-Bild sichtbar: {ids:?}");
    assert!(ids.contains(&bnull), "NULL-Bild sichtbar: {ids:?}");
    assert!(!ids.contains(&by), "Y-Bild NICHT sichtbar auf X: {ids:?}");
}

/// LFH-738: Eine `ansicht_id` aus einem ANDEREN Einsatz wird abgelehnt, beim Hochladen wie im
/// PATCH, mit 404 wie eine unbekannte id (kein Existenz-Orakel).
#[tokio::test]
async fn fremde_ansicht_id_ist_404() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let anderer = einsatz_anlegen(&app, &admin).await;
    let eigene = standard_ansicht_id(&app, &admin, einsatz).await;
    let fremde = standard_ansicht_id(&app, &admin, anderer).await;
    let png = minimal_png();

    for aid in [fremde, 999_999_999] {
        let (s, v) = upload_bild_ansicht(&app, einsatz, &admin, &png, ECKEN, Some(aid)).await;
        assert_eq!(s, StatusCode::NOT_FOUND, "Upload ansicht_id={aid}: {v:?}");
    }

    let (s, bild) = upload_bild_ansicht(&app, einsatz, &admin, &png, ECKEN, Some(eigene)).await;
    assert_eq!(s, StatusCode::CREATED, "{bild:?}");
    let bid = bild["id"].as_i64().unwrap();
    for aid in [fremde, 999_999_999] {
        let (s, v) = anfrage(
            &app,
            "PATCH",
            &format!("/api/einsaetze/{einsatz}/karte/hintergrundbilder/{bid}"),
            &admin,
            Some(&json!({"ansicht_id": aid}).to_string()),
        )
        .await;
        assert_eq!(s, StatusCode::NOT_FOUND, "PATCH ansicht_id={aid}: {v:?}");
    }

    let (_, liste) = anfrage(
        &app,
        "GET",
        &format!("/api/einsaetze/{einsatz}/karte/hintergrundbilder"),
        &admin,
        None,
    )
    .await;
    let bilder = liste.as_array().unwrap();
    assert_eq!(bilder.len(), 1, "kein Bild angelegt: {bilder:?}");
    assert_eq!(
        bilder[0]["ansicht_id"], eigene,
        "Zuordnung unverändert: {bilder:?}"
    );
}
