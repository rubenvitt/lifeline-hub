//! HTTP-Integrationstests für karte_hintergrundbild-Routen (LFH-35).
//!
//! Abdeckung:
//!   (a) Upload → Liste → Download-Roundtrip (Bytes identisch, Content-Type image/png)
//!   (b) Beobachter ohne Schreibrecht → 403 beim Upload
//!   (c) Nicht-Bild-Datei (GIF) → 400 (erkenne_bild_mime)
//!   (d) Download setzt `Content-Disposition: attachment` (LFH-238) — konsistent zu anhang.rs.
//!   (e) Download liefert die bereinigte Fassung ohne EXIF/GPS, gespeichert bleibt das Original
//!       (LLH-1635).

use axum::body::{to_bytes, Body};
use axum::http::{header, HeaderMap, Request, StatusCode};
use serde_json::{json, Value};
use tower::ServiceExt;

mod common;
use common::{
    anfrage, benutzer_anlegen, einsatz_anlegen, karten_ansicht_anlegen, login_cookie, rolle_setzen,
    setup, setup_mit_pool, standard_ansicht_id,
};
use image::codecs::jpeg::JpegEncoder;
use image::codecs::png::{CompressionType, FilterType, PngEncoder};
use image::{ExtendedColorType, ImageEncoder, Rgb, RgbImage};

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

// ---------- LLH-1635: Drohnenfoto mit Standort ----------

/// TIFF-Block (II) mit Gerät, Ausrichtung 6 und GPS-IFD; die Personendaten tragen `MARKER`.
fn exif_tiff() -> Vec<u8> {
    let le16 = |v: u16| v.to_le_bytes();
    let le32 = |v: u32| v.to_le_bytes();
    let mut t = b"II*\0".to_vec();
    t.extend(le32(8));
    // IFD0 bei 8: 3 Einträge → 8 + 2 + 36 + 4 = 50.
    t.extend(le16(3));
    t.extend(le16(271)); // Make, ASCII, 12 Bytes bei 50
    t.extend(le16(2));
    t.extend(le32(12));
    t.extend(le32(50));
    t.extend(le16(274)); // Ausrichtung 6
    t.extend(le16(3));
    t.extend(le32(1));
    t.extend(le16(6));
    t.extend(le16(0));
    t.extend(le16(34853)); // GPS-IFD bei 62
    t.extend(le16(4));
    t.extend(le32(1));
    t.extend(le32(62));
    t.extend(le32(0));
    t.extend_from_slice(b"MARKER_MAKE\0");
    // GPS-IFD bei 62: 1 Eintrag (Breite, für den Test als ASCII) → Daten bei 80.
    t.extend(le16(1));
    t.extend(le16(2));
    t.extend(le16(2));
    t.extend(le32(12));
    t.extend(le32(80));
    t.extend(le32(0));
    t.extend_from_slice(b"MARKER_GPS1\0");
    t
}

/// Ein echtes JPEG (Luftbild-Ersatz, 400 × 300 px) mit EXIF samt GPS und einem Kommentar.
fn drohnenfoto_mit_gps() -> Vec<u8> {
    let bild = RgbImage::from_fn(400, 300, |x, y| {
        if (x / 50 + y / 50) % 2 == 0 {
            Rgb([60, 140, 60])
        } else {
            Rgb([200, 200, 180])
        }
    });
    let mut jpeg = Vec::new();
    JpegEncoder::new_with_quality(&mut jpeg, 90)
        .encode_image(&bild)
        .unwrap();
    let mut app1 = b"Exif\0\0".to_vec();
    app1.extend(exif_tiff());
    let com = b"MARKER_KOMMENTAR";
    let mut foto = jpeg[..2].to_vec();
    foto.extend([0xFF, 0xE1]);
    foto.extend(((app1.len() + 2) as u16).to_be_bytes());
    foto.extend(app1);
    foto.extend([0xFF, 0xFE]);
    foto.extend(((com.len() + 2) as u16).to_be_bytes());
    foto.extend_from_slice(com);
    foto.extend_from_slice(&jpeg[2..]);
    foto
}

/// Ein lesbares PNG, das die Bereinigung trotzdem abweist: seine unkomprimierten Bildpunkte
/// buchstabieren eine XMP-Signatur, und das Kontrollnetz verwirft die bereinigte Fassung.
fn png_mit_signatur_in_bildpunkten() -> Vec<u8> {
    let mut zeile = b"<x:xmpmeta".to_vec();
    zeile.resize(36, b' ');
    let roh: Vec<u8> = (0..4).flat_map(|_| zeile.clone()).collect();
    let mut png = Vec::new();
    PngEncoder::new_with_quality(
        &mut png,
        CompressionType::Uncompressed,
        FilterType::NoFilter,
    )
    .write_image(&roh, 12, 4, ExtendedColorType::Rgb8)
    .unwrap();
    png
}

fn enthaelt(heuhaufen: &[u8], nadel: &[u8]) -> bool {
    heuhaufen.windows(nadel.len()).any(|w| w == nadel)
}

async fn gespeichert(pool: &sqlx::SqlitePool, bild_id: i64) -> Vec<u8> {
    sqlx::query_scalar("SELECT daten FROM karte_hintergrundbild_daten WHERE bild_id = ?")
        .bind(bild_id)
        .fetch_one(pool)
        .await
        .unwrap()
}

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

/// G04 (LFH-258), LLH-1635: Der Bild-Download trägt einen starken ETag aus sha256 und Version der
/// Bereinigung (`"<sha256>.b<n>"`) und wird vor jeder Nutzung revalidiert, nicht `immutable`:
/// die ausgelieferte Fassung hängt an der Bereinigung.
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
    let (sha, version) = etag
        .trim_matches('"')
        .split_once(".b")
        .expect("ETag mit Bereinigungsversion");
    assert_eq!(sha.len(), 64, "sha256-Hex im ETag: {etag}");
    assert!(version.parse::<u32>().is_ok(), "Version im ETag: {etag}");
    let cc = headers
        .get(header::CACHE_CONTROL)
        .expect("Cache-Control")
        .to_str()
        .unwrap();
    assert_eq!(cc, "private, no-cache", "Cache-Control: {cc}");
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

// ---------- LLH-1635: Bereinigte Auslieferung ----------

/// Ein Drohnenfoto mit GPS wird hochgeladen: der Download trägt weder GPS noch Gerät noch
/// Kommentar, ist aber dasselbe Bild in gleicher Ausrichtung. Gespeichert bleibt das Original.
#[tokio::test]
async fn download_liefert_drohnenfoto_ohne_gps() {
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let foto = drohnenfoto_mit_gps();
    assert!(enthaelt(&foto, b"MARKER_GPS1"), "Fixture trägt GPS");

    let (status, bild) = upload_bild(
        &app,
        einsatz,
        &admin,
        "drohne.jpg",
        "image/jpeg",
        &foto,
        ECKEN,
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "Upload: {bild:?}");
    let bild_id = bild["id"].as_i64().unwrap();

    let (s, headers, bytes) = download_bild(&app, einsatz, bild_id, &admin).await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(headers.get(header::CONTENT_TYPE).unwrap(), "image/jpeg");
    assert!(
        !enthaelt(&bytes, b"MARKER"),
        "Metadaten in der Auslieferung"
    );
    // Mini-EXIF mit Ausrichtung 6 (II): Tag 274 = 0x0112, SHORT, 1, Wert 6.
    assert!(
        enthaelt(&bytes, &[0x12, 0x01, 3, 0, 1, 0, 0, 0, 6, 0]),
        "Ausrichtung fehlt"
    );
    let gelesen = image::load_from_memory_with_format(&bytes, image::ImageFormat::Jpeg)
        .expect("ausgeliefert wird ein lesbares JPEG");
    assert_eq!((gelesen.width(), gelesen.height()), (400, 300));

    assert_eq!(
        gespeichert(&pool, bild_id).await,
        foto,
        "Original bleibt gespeichert"
    );
}

/// Ein Bild aus der Zeit vor LLH-1635 (direkt mit GPS in der Tabelle) wird ebenso bereinigt
/// ausgeliefert: die Bereinigung greift beim Ausliefern, nicht nur beim Hochladen.
#[tokio::test]
async fn bestandsbild_mit_gps_wird_bereinigt_ausgeliefert() {
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let (status, bild) = upload_bild(
        &app,
        einsatz,
        &admin,
        "alt.png",
        "image/png",
        &minimal_png(),
        ECKEN,
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "Upload: {bild:?}");
    let bild_id = bild["id"].as_i64().unwrap();
    // Bestand nachstellen: Bytes und Typ eines alten Uploads, an der Bereinigung vorbei.
    let foto = drohnenfoto_mit_gps();
    sqlx::query("UPDATE karte_hintergrundbild_daten SET daten = ? WHERE bild_id = ?")
        .bind(&foto)
        .bind(bild_id)
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query("UPDATE karte_hintergrundbild SET mime = 'image/jpeg' WHERE id = ?")
        .bind(bild_id)
        .execute(&pool)
        .await
        .unwrap();

    let (s, _, bytes) = download_bild(&app, einsatz, bild_id, &admin).await;
    assert_eq!(s, StatusCode::OK);
    assert!(
        !enthaelt(&bytes, b"MARKER"),
        "Metadaten in der Auslieferung"
    );
    assert!(bytes.starts_with(&[0xFF, 0xD8]) && bytes.ends_with(&[0xFF, 0xD9]));
}

/// Fail-closed: lässt sich ein gespeichertes Bild nicht bereinigen, gibt es 422 und keine
/// Bildbytes, nie das Original.
#[tokio::test]
async fn unbereinigbares_bestandsbild_ist_422_ohne_bildbytes() {
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let (_, bild) = upload_bild(
        &app,
        einsatz,
        &admin,
        "alt.png",
        "image/png",
        &minimal_png(),
        ECKEN,
    )
    .await;
    let bild_id = bild["id"].as_i64().unwrap();
    let kaputt = png_mit_signatur_in_bildpunkten();
    sqlx::query("UPDATE karte_hintergrundbild_daten SET daten = ? WHERE bild_id = ?")
        .bind(&kaputt)
        .bind(bild_id)
        .execute(&pool)
        .await
        .unwrap();

    let (s, _, bytes) = download_bild(&app, einsatz, bild_id, &admin).await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY);
    assert!(
        !enthaelt(&bytes, b"<x:xmpmeta"),
        "keine Bildbytes im Fehler"
    );
}

/// Ein Bild, das sich nicht bereinigen lässt, käme nie auf die Karte: schon der Upload ist 422,
/// und nichts wird gespeichert.
#[tokio::test]
async fn unbereinigbares_bild_wird_beim_hochladen_abgewiesen() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;

    let (status, _) = upload_bild(
        &app,
        einsatz,
        &admin,
        "plan.png",
        "image/png",
        &png_mit_signatur_in_bildpunkten(),
        ECKEN,
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);

    let (_, liste) = anfrage(
        &app,
        "GET",
        &format!("/api/einsaetze/{einsatz}/karte/hintergrundbilder"),
        &admin,
        None,
    )
    .await;
    assert_eq!(
        liste.as_array().map(Vec::len),
        Some(0),
        "nichts gespeichert"
    );
}
