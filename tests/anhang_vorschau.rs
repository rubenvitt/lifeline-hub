//! LFH-759, Spec `anhang-vorschau`: Vorschaubilder über jeden Anhang-Weg (Chat/generisch,
//! Dokumentenablage, ETB, Schaden), mit den Gates der Route, ohne ETB-Vermerk, mit eigenem ETag
//! und `inline`; dazu die Schutz-Header jeder Anhang-Antwort.
//!
//! Die Erzeugung je Format prüfen die Unit-Tests in `src/anhang/vorschau/`; hier steht, dass die
//! Routen sie anwenden. Abgelegt wird als die ablegende Person (`src/AGENTS.md`, „Anhänge“).

use axum::body::{to_bytes, Body};
use axum::http::{header, HeaderMap, Request, StatusCode};
use image::codecs::jpeg::JpegEncoder;
use image::codecs::png::{CompressionType, FilterType, PngEncoder};
use image::{ExtendedColorType, ImageEncoder, Rgb, RgbImage};
use serde_json::Value;
use tower::ServiceExt;

mod common;
use common::*;

const ADMIN_PW: &str = "startpw12";

// ── Fixtures: echte Bildbytes ───────────────────────────────────────────────────────────

/// TIFF-Block (II) mit Gerät, Ausrichtung 6 und GPS; die Personendaten tragen `MARKER`.
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
    // GPS-IFD bei 62: 1 Eintrag.
    t.extend(le16(1));
    t.extend(le16(2));
    t.extend(le16(2));
    t.extend(le32(12));
    t.extend(le32(80));
    t.extend(le32(0));
    t.extend_from_slice(b"MARKER_GPS1\0");
    t
}

/// Ein Handyfoto 400 × 300 px (zur Anzeige hochkant, Ausrichtung 6) mit Gerät und GPS.
fn foto_mit_gps() -> Vec<u8> {
    let bild = RgbImage::from_fn(400, 300, |x, _| {
        if x < 200 {
            Rgb([220, 20, 20])
        } else {
            Rgb([20, 20, 220])
        }
    });
    let mut jpeg = Vec::new();
    JpegEncoder::new_with_quality(&mut jpeg, 90)
        .encode_image(&bild)
        .unwrap();
    let mut app1 = b"Exif\0\0".to_vec();
    app1.extend(exif_tiff());
    let mut foto = jpeg[..2].to_vec();
    foto.extend([0xFF, 0xE1]);
    foto.extend(((app1.len() + 2) as u16).to_be_bytes());
    foto.extend(app1);
    foto.extend_from_slice(&jpeg[2..]);
    foto
}

/// Ein lesbares PNG, das die Bereinigung trotzdem abweist: seine unkomprimierten Bildpunkte
/// buchstabieren eine XMP-Signatur, und das Kontrollnetz verwirft die bereinigte Fassung.
fn png_mit_signatur_in_bildpunkten() -> Vec<u8> {
    // 12 Bildpunkte × 3 Byte je Zeile; jede Zeile trägt die Signatur in ihren Rohbytes.
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

fn abmessungen(jpeg: &[u8]) -> (u32, u32) {
    let bild = image::load_from_memory_with_format(jpeg, image::ImageFormat::Jpeg)
        .expect("Vorschau ist ein JPEG");
    (bild.width(), bild.height())
}

// ── Anfragen ────────────────────────────────────────────────────────────────────────────

async fn laden(
    app: &axum::Router,
    pfad: &str,
    cookie: &str,
    if_none_match: Option<&str>,
) -> (StatusCode, HeaderMap, Vec<u8>) {
    let mut req = Request::builder()
        .method("GET")
        .uri(pfad)
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

fn mit(pfad: &str, fassung: &str) -> String {
    format!("{pfad}?fassung={fassung}")
}

/// Generischer Upload (Chat); der ungebundene Anhang gehört der hochladenden Person.
async fn chat_foto(app: &axum::Router, cookie: &str, einsatz: i64) -> String {
    let (s, v) = multipart_post(
        app,
        &format!("/api/einsaetze/{einsatz}/anhaenge"),
        cookie,
        Some(("foto.jpg", &foto_mit_gps())),
        &[],
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{v}");
    let aid = v[0]["id"].as_i64().unwrap();
    format!("/api/einsaetze/{einsatz}/anhaenge/{aid}")
}

async fn dokument_foto(app: &axum::Router, cookie: &str, einsatz: i64) -> String {
    let (s, v) = multipart_post(
        app,
        &format!("/api/einsaetze/{einsatz}/dokumente"),
        cookie,
        Some(("lage.jpg", &foto_mit_gps())),
        &[("titel", "Lagefoto"), ("kategorie", "lagekarte_plan")],
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{v}");
    let did = v["id"].as_i64().unwrap();
    format!("/api/einsaetze/{einsatz}/dokumente/{did}/datei")
}

async fn etb_foto(app: &axum::Router, cookie: &str, einsatz: i64) -> String {
    let (s, v) = multipart_post(
        app,
        &format!("/api/einsaetze/{einsatz}/etb/anhaenge"),
        cookie,
        Some(("Lagefoto Süd.jpg", &foto_mit_gps())),
        &[],
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{v}");
    let aid = v[0]["id"].as_i64().unwrap();
    let (s, e) = anfrage(
        app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/etb"),
        cookie,
        Some(&format!(
            r#"{{"typ":"meldung","inhalt":"Foto","anhang_ids":[{aid}]}}"#
        )),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{e}");
    let eintrag = e["id"].as_i64().unwrap();
    format!("/api/einsaetze/{einsatz}/etb/{eintrag}/anhaenge/{aid}")
}

/// Schaden mit Anhang per SQL, als `admin` abgelegt; liefert den Download-Pfad.
async fn schaden_datei(
    pool: &sqlx::SqlitePool,
    einsatz: i64,
    dateiname: &str,
    mime: &str,
    daten: &[u8],
) -> String {
    let von: i64 = sqlx::query_scalar("SELECT id FROM benutzer WHERE benutzername = 'admin'")
        .fetch_one(pool)
        .await
        .unwrap();
    let schaden: i64 = sqlx::query_scalar(
        "INSERT INTO einsatz_schaden \
           (einsatz_id, registrier_nr, typ, ausmass, ort, erfasst_von, geaendert_von) \
         VALUES (?, (SELECT COALESCE(MAX(registrier_nr), 0) + 1 FROM einsatz_schaden \
                     WHERE einsatz_id = ?), 'sachschaden', 'gering', 'Hauptstr. 1', ?, ?) \
         RETURNING id",
    )
    .bind(einsatz)
    .bind(einsatz)
    .bind(von)
    .bind(von)
    .fetch_one(pool)
    .await
    .unwrap();
    let aid: i64 = sqlx::query_scalar(
        "INSERT INTO anhang (einsatz_id, dateiname, mime, groesse, sha256, daten, hochgeladen_von) \
         VALUES (?, ?, ?, ?, 'feedface', ?, ?) RETURNING id",
    )
    .bind(einsatz)
    .bind(dateiname)
    .bind(mime)
    .bind(daten.len() as i64)
    .bind(daten)
    .bind(von)
    .fetch_one(pool)
    .await
    .unwrap();
    let linker: i64 = sqlx::query_scalar(
        "INSERT INTO einsatz_schaden_anhang (einsatz_id, schaden_id, anhang_id, abgelegt_von_id) \
         VALUES (?, ?, ?, ?) RETURNING id",
    )
    .bind(einsatz)
    .bind(schaden)
    .bind(aid)
    .bind(von)
    .fetch_one(pool)
    .await
    .unwrap();
    format!("/api/einsaetze/{einsatz}/schaeden/{schaden}/anhaenge/{linker}/datei")
}

fn ist_vorschau(h: &HeaderMap, bytes: &[u8], soll: (u32, u32)) {
    assert_eq!(h[header::CONTENT_TYPE], "image/jpeg");
    let disposition = h[header::CONTENT_DISPOSITION].to_str().unwrap();
    assert!(disposition.starts_with("inline;"), "{disposition}");
    assert!(disposition.contains(".vorschau.jpg"), "{disposition}");
    assert!(!enthaelt(bytes, b"MARKER"), "Metadaten in der Vorschau");
    assert!(!enthaelt(bytes, b"Exif\0\0"), "EXIF-Block in der Vorschau");
    assert_eq!(abmessungen(bytes), soll);
}

// ── Vorschau über jeden Weg ─────────────────────────────────────────────────────────────

#[tokio::test]
async fn jeder_weg_liefert_vorschau_und_grossansicht_ohne_vermerk() {
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", ADMIN_PW).await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let wege = [
        chat_foto(&app, &admin, einsatz).await,
        dokument_foto(&app, &admin, einsatz).await,
        etb_foto(&app, &admin, einsatz).await,
        schaden_datei(&pool, einsatz, "dach.jpg", "image/jpeg", &foto_mit_gps()).await,
    ];
    let vorher = system_etb_inhalte(&app, &admin, einsatz).await;
    for pfad in &wege {
        let (s, h, bytes) = laden(&app, &mit(pfad, "vorschau"), &admin, None).await;
        assert_eq!(s, StatusCode::OK, "{pfad}");
        // 400 × 300 mit Ausrichtung 6 → hochkant 300 × 400 → längste Kante 256.
        ist_vorschau(&h, &bytes, (192, 256));
        let (s, h, bytes) = laden(&app, &mit(pfad, "grossansicht"), &admin, None).await;
        assert_eq!(s, StatusCode::OK, "{pfad}");
        // Kleiner als 1600 px: nicht vergrößert, nur gedreht.
        ist_vorschau(&h, &bytes, (300, 400));
    }
    assert_eq!(
        system_etb_inhalte(&app, &admin, einsatz).await,
        vorher,
        "eine Vorschau wird nicht im ETB vermerkt"
    );
}

#[tokio::test]
async fn etag_der_vorschau_ist_eigen_und_traegt_304() {
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", ADMIN_PW).await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let pfad = etb_foto(&app, &admin, einsatz).await;

    let (_, h_bereinigt, _) = laden(&app, &pfad, &admin, None).await;
    let (_, h_klein, _) = laden(&app, &mit(&pfad, "vorschau"), &admin, None).await;
    let (_, h_gross, _) = laden(&app, &mit(&pfad, "grossansicht"), &admin, None).await;
    let etag = |h: &HeaderMap| h[header::ETAG].to_str().unwrap().to_string();
    let klein = etag(&h_klein);
    assert_ne!(klein, etag(&h_bereinigt));
    assert_ne!(klein, etag(&h_gross));
    assert!(klein.ends_with(".v1.k\""), "{klein}");
    assert!(etag(&h_gross).ends_with(".v1.g\""));
    assert_eq!(h_klein[header::CACHE_CONTROL], "private, no-cache");

    let (s, _, bytes) = laden(&app, &mit(&pfad, "vorschau"), &admin, Some(&klein)).await;
    assert_eq!(s, StatusCode::NOT_MODIFIED);
    assert!(bytes.is_empty());
    // Der ETag einer anderen Fassung trifft nicht.
    let (s, _, _) = laden(&app, &mit(&pfad, "vorschau"), &admin, Some(&etag(&h_gross))).await;
    assert_eq!(s, StatusCode::OK);
    let _ = pool;
}

#[tokio::test]
async fn passendes_etag_antwortet_304_ohne_zu_lesen_oder_zu_dekodieren() {
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", ADMIN_PW).await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    // Ein PDF hat keine Vorschau: würde gelesen und dekodiert, käme 422. `schaden_datei` setzt
    // sha256 `feedface`, also kennt der Test den ETag, ohne je eine Vorschau bekommen zu haben.
    let pfad = schaden_datei(
        &pool,
        einsatz,
        "gutachten.pdf",
        "application/pdf",
        b"%PDF-1.4",
    )
    .await;
    let (s, _, bytes) = laden(
        &app,
        &mit(&pfad, "vorschau"),
        &admin,
        Some("\"feedface.v1.k\""),
    )
    .await;
    assert_eq!(s, StatusCode::NOT_MODIFIED);
    assert!(bytes.is_empty());
}

#[tokio::test]
async fn ohne_lesezugriff_antwortet_die_vorschau_wie_der_download() {
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", ADMIN_PW).await;
    let eigener = einsatz_anlegen(&app, &admin).await;
    let fremder = einsatz_anlegen(&app, &admin).await;
    let pfad = schaden_datei(&pool, fremder, "dach.jpg", "image/jpeg", &foto_mit_gps()).await;
    let id = benutzer_anlegen(&app, &admin, "helfer", "keine").await;
    rolle_setzen(&app, &admin, eigener, id, "beobachter").await;
    let helfer = login_cookie(&app, "helfer", "helferpw1").await;
    let (download, _, _) = laden(&app, &pfad, &helfer, None).await;
    assert!(download.is_client_error(), "Vorbedingung: {download}");
    let (s, h, bytes) = laden(&app, &mit(&pfad, "vorschau"), &helfer, None).await;
    assert_eq!(s, download, "dieselbe Antwort wie der Download der Route");
    assert!(h.get(header::CONTENT_DISPOSITION).is_none());
    assert!(!bytes.starts_with(&[0xFF, 0xD8]));
}

#[tokio::test]
async fn kein_vorschaubild_fuer_pdf_heic_und_kaputte_bilder() {
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", ADMIN_PW).await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let mut png = Vec::new();
    PngEncoder::new(&mut png)
        .write_image(
            &(0..64 * 64 * 3)
                .map(|i| (i * 31 % 251) as u8)
                .collect::<Vec<_>>(),
            64,
            64,
            ExtendedColorType::Rgb8,
        )
        .unwrap();
    let heic = b"\0\0\0\x18ftypheic\0\0\0\0mif1heic\0\0\0\x08mdat".to_vec();
    let faelle = [
        (
            "gutachten.pdf",
            "application/pdf",
            b"%PDF-1.4\n%%EOF".to_vec(),
        ),
        ("IMG_0001.HEIC", "image/heic", heic),
        ("plan.png", "image/png", png[..png.len() / 2].to_vec()),
    ];
    for (name, mime, daten) in faelle {
        let pfad = schaden_datei(&pool, einsatz, name, mime, &daten).await;
        let (s, h, bytes) = laden(&app, &mit(&pfad, "vorschau"), &admin, None).await;
        assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY, "{name}");
        assert!(h.get(header::CONTENT_DISPOSITION).is_none(), "{name}");
        let v: Value = serde_json::from_slice(&bytes).expect("Fehler im {error}-Format");
        assert!(
            v["error"].as_str().unwrap().contains("keine Vorschau"),
            "{v}"
        );
    }
}

#[tokio::test]
async fn nicht_bereinigbares_bild_bekommt_trotzdem_eine_vorschau() {
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", ADMIN_PW).await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let png = png_mit_signatur_in_bildpunkten();
    let pfad = schaden_datei(&pool, einsatz, "plan.png", "image/png", &png).await;
    let (s, _, _) = laden(&app, &pfad, &admin, None).await;
    assert_eq!(
        s,
        StatusCode::UNPROCESSABLE_ENTITY,
        "Vorbedingung: der Download weist die Datei ab"
    );
    let (s, h, bytes) = laden(&app, &mit(&pfad, "vorschau"), &admin, None).await;
    assert_eq!(s, StatusCode::OK);
    ist_vorschau(&h, &bytes, (12, 4));
    assert!(!enthaelt(&bytes, b"<x:xmpmeta"));
}

// ── Schutz-Header ───────────────────────────────────────────────────────────────────────

fn hat_schutz_header(h: &HeaderMap) {
    assert_eq!(h[header::X_CONTENT_TYPE_OPTIONS], "nosniff");
    assert_eq!(
        h[header::CONTENT_SECURITY_POLICY],
        "default-src 'none'; sandbox"
    );
}

#[tokio::test]
async fn jede_anhang_antwort_traegt_die_schutz_header() {
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", ADMIN_PW).await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let foto = schaden_datei(&pool, einsatz, "dach.jpg", "image/jpeg", &foto_mit_gps()).await;
    let html = b"<html><script>alert(1)</script></html>";
    let notiz = schaden_datei(&pool, einsatz, "notiz.txt", "text/plain", html).await;

    let (s, h, bytes) = laden(&app, &notiz, &admin, None).await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(bytes, html, "Text bleibt unverändert");
    hat_schutz_header(&h);
    assert!(h[header::CONTENT_DISPOSITION]
        .to_str()
        .unwrap()
        .starts_with("attachment;"));
    for fassung in ["bereinigt", "original", "vorschau", "grossansicht"] {
        let (s, h, _) = laden(&app, &mit(&foto, fassung), &admin, None).await;
        assert_eq!(s, StatusCode::OK, "{fassung}");
        hat_schutz_header(&h);
    }
    // Der normale Download bleibt eine Anlage.
    let (_, h, _) = laden(&app, &foto, &admin, None).await;
    assert!(h[header::CONTENT_DISPOSITION]
        .to_str()
        .unwrap()
        .starts_with("attachment;"));
}

// ── Echtes HEIC (Fixture des Frontends) ─────────────────────────────────────────────────

/// HEIC aus `frontend/src/heic/__fixtures__/mach_heic.py` (pillow-heif): 64 × 48 quer kodiert,
/// zur Anzeige über `irot` hochkant, mit EXIF (Gerät, GPS) und XMP.
const HEIC: &[u8] = include_bytes!("../frontend/src/heic/__fixtures__/hochkant.heic");
/// Was der Server davon ausliefert; der HEIC-Decoder im Browser dekodiert genau diese Bytes
/// (`frontend/src/heic/heicDekodieren.test.ts`).
const HEIC_BEREINIGT: &[u8] =
    include_bytes!("../frontend/src/heic/__fixtures__/hochkant.bereinigt.heic");

#[tokio::test]
async fn echtes_heic_wird_bereinigt_ausgeliefert_und_hat_keine_server_vorschau() {
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", ADMIN_PW).await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    assert!(enthaelt(HEIC, b"MARKER"), "Fixture trägt Metadaten");
    let pfad = schaden_datei(&pool, einsatz, "IMG_0001.HEIC", "image/heic", HEIC).await;

    let (s, _, bytes) = laden(&app, &pfad, &admin, None).await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(
        bytes, HEIC_BEREINIGT,
        "Fixture der bereinigten Fassung ist aktuell"
    );
    assert!(!enthaelt(&bytes, b"MARKER"));
    assert!(!enthaelt(&bytes, b"xmpmeta"));
    assert!(enthaelt(&bytes, b"irot"), "die Drehung bleibt");

    let (s, _, _) = laden(&app, &mit(&pfad, "vorschau"), &admin, None).await;
    assert_eq!(
        s,
        StatusCode::UNPROCESSABLE_ENTITY,
        "HEIC dekodiert der Browser"
    );
}
