//! LFH-747, Spec `anhang-metadaten`: Bild-Anhänge werden über jeden Weg (Chat/generisch,
//! Dokumentenablage, ETB, Schaden) bereinigt ausgeliefert; das Original bleibt gespeichert und
//! ist nur für Einsatzleitung und System-Admin der Einsatz-Org abrufbar, jeweils mit
//! ETB-Vermerk. Dazu der Guard, dass nur `routes/support.rs` Anhang-Bytes ausliefert.
//!
//! Die Bereinigung je Format prüfen die Unit-Tests in `src/anhang/metadaten/`; hier steht, dass
//! die Routen sie anwenden.

use axum::body::{to_bytes, Body};
use axum::http::{header, HeaderMap, Request, StatusCode};
use serde_json::Value;
use tower::ServiceExt;

mod common;
use common::*;

const ADMIN_PW: &str = "startpw12";

// ── Fixture: ein Handyfoto mit Standort ─────────────────────────────────────────────────

fn le16(v: u16) -> [u8; 2] {
    v.to_le_bytes()
}
fn le32(v: u32) -> [u8; 4] {
    v.to_le_bytes()
}

/// TIFF-Block (II) mit Make, Ausrichtung 6 und GPS-IFD; alle Personendaten tragen `MARKER`.
fn exif_tiff() -> Vec<u8> {
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
    // GPS-IFD bei 62: 1 Eintrag → 62 + 18 = 80.
    t.extend(le16(1));
    t.extend(le16(2)); // Breite, für den Test als ASCII, 12 Bytes bei 80
    t.extend(le16(2));
    t.extend(le32(12));
    t.extend(le32(80));
    t.extend(le32(0));
    t.extend_from_slice(b"MARKER_GPS1\0");
    t
}

fn segment(marker: u8, nutzlast: &[u8]) -> Vec<u8> {
    let mut s = vec![0xFF, marker];
    s.extend(((nutzlast.len() + 2) as u16).to_be_bytes());
    s.extend_from_slice(nutzlast);
    s
}

const PIXEL: &[u8] = b"PIXEL\x12\x34";

/// Ein JPEG mit Exif (Gerät, Ausrichtung, GPS) und Kommentar.
fn foto_mit_gps() -> Vec<u8> {
    let mut j = vec![0xFF, 0xD8];
    let mut app1 = b"Exif\0\0".to_vec();
    app1.extend(exif_tiff());
    j.extend(segment(0xE1, &app1));
    j.extend(segment(0xFE, b"MARKER_KOMMENTAR"));
    let mut dqt = vec![0u8];
    dqt.extend(1..=64u8);
    j.extend(segment(0xDB, &dqt));
    j.extend(segment(0xC0, &[8, 0, 16, 0, 16, 1, 1, 0x11, 0]));
    let mut dht = vec![0u8, 1];
    dht.extend([0u8; 15]);
    dht.push(0);
    j.extend(segment(0xC4, &dht));
    j.extend(segment(0xDA, &[1, 1, 0, 0, 63, 0]));
    j.extend_from_slice(PIXEL);
    j.extend_from_slice(&[0xFF, 0xD9]);
    j
}

fn enthaelt(heuhaufen: &[u8], nadel: &[u8]) -> bool {
    heuhaufen.windows(nadel.len()).any(|w| w == nadel)
}

/// Bereinigt heißt: keine Personendaten, aber die Bilddaten und die Ausrichtung sind da.
fn ist_bereinigt(bytes: &[u8]) {
    assert!(!enthaelt(bytes, b"MARKER"), "Metadaten in der Auslieferung");
    assert!(enthaelt(bytes, PIXEL), "Bilddaten fehlen");
    assert!(bytes.starts_with(&[0xFF, 0xD8]) && bytes.ends_with(&[0xFF, 0xD9]));
    // Mini-EXIF mit Ausrichtung 6 (II): Tag 274 = 0x0112, SHORT, 1, Wert 6.
    assert!(enthaelt(bytes, &[0x12, 0x01, 3, 0, 1, 0, 0, 0, 6, 0]));
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

fn original(pfad: &str) -> String {
    format!("{pfad}?fassung=original")
}

async fn gespeichert(pool: &sqlx::SqlitePool, anhang: i64) -> (Vec<u8>, String) {
    sqlx::query_as("SELECT daten, sha256 FROM anhang WHERE id = ?")
        .bind(anhang)
        .fetch_one(pool)
        .await
        .unwrap()
}

/// Generischer Upload (Chat); der ungebundene Anhang gehört der hochladenden Person.
async fn chat_foto(app: &axum::Router, cookie: &str, einsatz: i64) -> (String, i64) {
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
    (format!("/api/einsaetze/{einsatz}/anhaenge/{aid}"), aid)
}

/// Dokumentenablage; liefert (Pfad, Anhang-id).
async fn dokument_foto(
    app: &axum::Router,
    cookie: &str,
    pool: &sqlx::SqlitePool,
    einsatz: i64,
) -> (String, i64) {
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
    let aid: i64 = sqlx::query_scalar("SELECT anhang_id FROM einsatz_dokument WHERE id = ?")
        .bind(did)
        .fetch_one(pool)
        .await
        .unwrap();
    (
        format!("/api/einsaetze/{einsatz}/dokumente/{did}/datei"),
        aid,
    )
}

struct EtbFoto {
    pfad: String,
    anhang: i64,
    lfd_nr: i64,
}

/// ETB-Eintrag mit Foto.
async fn etb_foto(app: &axum::Router, cookie: &str, einsatz: i64) -> EtbFoto {
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
    EtbFoto {
        pfad: format!("/api/einsaetze/{einsatz}/etb/{eintrag}/anhaenge/{aid}"),
        anhang: aid,
        lfd_nr: e["lfd_nr"].as_i64().unwrap(),
    }
}

/// Schaden mit Anhang per SQL (wie `common::schaden_anhang`, mit eigenen Bytes); liefert
/// (Pfad, Anhang-id).
async fn schaden_datei(
    pool: &sqlx::SqlitePool,
    einsatz: i64,
    dateiname: &str,
    mime: &str,
    daten: &[u8],
) -> (String, i64) {
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
    (
        format!("/api/einsaetze/{einsatz}/schaeden/{schaden}/anhaenge/{linker}/datei"),
        aid,
    )
}

async fn mitglied(
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

fn vermerke(inhalte: &[String]) -> Vec<&String> {
    inhalte
        .iter()
        .filter(|i| i.starts_with("Originaldatei mit Metadaten"))
        .collect()
}

// ── Bereinigte Standardfassung ──────────────────────────────────────────────────────────

#[tokio::test]
async fn schaden_download_ist_bereinigt_und_das_original_bleibt_gespeichert() {
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", ADMIN_PW).await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let foto = foto_mit_gps();
    let (pfad, aid) = schaden_datei(&pool, einsatz, "dach.jpg", "image/jpeg", &foto).await;

    let (s, h, bytes) = laden(&app, &pfad, &admin, None).await;
    assert_eq!(s, StatusCode::OK);
    ist_bereinigt(&bytes);
    assert_eq!(h[header::CONTENT_TYPE], "image/jpeg");
    assert!(h[header::CONTENT_DISPOSITION]
        .to_str()
        .unwrap()
        .contains("dach.jpg"));
    let (daten, _) = gespeichert(&pool, aid).await;
    assert_eq!(daten, foto, "gespeichert bleibt das Original");
    assert!(vermerke(&system_etb_inhalte(&app, &admin, einsatz).await).is_empty());
}

#[tokio::test]
async fn jeder_weg_liefert_die_bereinigte_fassung() {
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", ADMIN_PW).await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let (chat, _) = chat_foto(&app, &admin, einsatz).await;
    let (dokument, _) = dokument_foto(&app, &admin, &pool, einsatz).await;
    let etb = etb_foto(&app, &admin, einsatz).await.pfad;
    for pfad in [chat, dokument, etb] {
        let (s, _, bytes) = laden(&app, &pfad, &admin, None).await;
        assert_eq!(s, StatusCode::OK, "{pfad}");
        ist_bereinigt(&bytes);
        // `?fassung=bereinigt` ist dasselbe wie keine Angabe.
        let (s, _, ausdruecklich) =
            laden(&app, &format!("{pfad}?fassung=bereinigt"), &admin, None).await;
        assert_eq!(s, StatusCode::OK);
        assert_eq!(ausdruecklich, bytes);
    }
}

#[tokio::test]
async fn falsche_endung_hilft_nicht() {
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", ADMIN_PW).await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let (pfad, _) = schaden_datei(&pool, einsatz, "foto.png", "image/png", &foto_mit_gps()).await;
    let (s, _, bytes) = laden(&app, &pfad, &admin, None).await;
    assert_eq!(s, StatusCode::OK);
    ist_bereinigt(&bytes);
}

#[tokio::test]
async fn pdf_bleibt_bytegleich() {
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", ADMIN_PW).await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let pdf = b"%PDF-1.4\n<< /Author (MARKER_AUTOR) >>\n%%EOF".to_vec();
    let (pfad, _) = schaden_datei(&pool, einsatz, "gutachten.pdf", "application/pdf", &pdf).await;
    let (s, _, bytes) = laden(&app, &pfad, &admin, None).await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(bytes, pdf);
}

#[tokio::test]
async fn beschaedigtes_bild_ist_422_ohne_dateibytes() {
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", ADMIN_PW).await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let foto = foto_mit_gps();
    // Mitten im Exif-Segment abgebrochen.
    let (pfad, _) = schaden_datei(&pool, einsatz, "dach.jpg", "image/jpeg", &foto[..40]).await;
    let (s, h, bytes) = laden(&app, &pfad, &admin, None).await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY);
    assert!(h.get(header::CONTENT_DISPOSITION).is_none());
    let v: Value = serde_json::from_slice(&bytes).unwrap();
    assert!(
        v["error"].as_str().unwrap().contains("Einsatzleitung"),
        "{v}"
    );
    assert!(!enthaelt(&bytes, b"MARKER"));
    // Die Einsatzleitung kommt ans Original.
    let (s, _, roh) = laden(&app, &original(&pfad), &admin, None).await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(roh, &foto[..40]);
}

#[tokio::test]
async fn etag_der_bereinigten_fassung_unterscheidet_sich_und_traegt_304() {
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", ADMIN_PW).await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let etb = etb_foto(&app, &admin, einsatz).await;
    let (_, sha256) = gespeichert(&pool, etb.anhang).await;

    let (s, h, _) = laden(&app, &etb.pfad, &admin, None).await;
    assert_eq!(s, StatusCode::OK);
    let etag = h[header::ETAG].to_str().unwrap().to_string();
    assert_ne!(
        etag,
        format!("\"{sha256}\""),
        "nicht der ETag des Originals"
    );
    assert_eq!(etag, format!("\"{sha256}.b1\""));

    assert_eq!(h[header::CACHE_CONTROL], "private, no-cache");
    let (s, _, bytes) = laden(&app, &etb.pfad, &admin, Some(&etag)).await;
    assert_eq!(s, StatusCode::NOT_MODIFIED);
    assert!(bytes.is_empty());
    // Der ETag einer früheren Auslieferung (sha256 des Originals) trifft nicht mehr.
    let (s, _, _) = laden(&app, &etb.pfad, &admin, Some(&format!("\"{sha256}\""))).await;
    assert_eq!(s, StatusCode::OK);
}

#[tokio::test]
async fn unbekannte_fassung_ist_400_im_fehlerformat() {
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", ADMIN_PW).await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let (chat, _) = chat_foto(&app, &admin, einsatz).await;
    let (dokument, _) = dokument_foto(&app, &admin, &pool, einsatz).await;
    let etb = etb_foto(&app, &admin, einsatz).await.pfad;
    let (schaden, _) = schaden_datei(&pool, einsatz, "a.jpg", "image/jpeg", &foto_mit_gps()).await;
    for pfad in [chat, dokument, etb, schaden] {
        let (s, _, bytes) = laden(&app, &format!("{pfad}?fassung=roh"), &admin, None).await;
        assert_eq!(s, StatusCode::BAD_REQUEST, "{pfad}");
        let v: Value = serde_json::from_slice(&bytes).unwrap();
        assert!(v["error"].as_str().unwrap().contains("Fassung"), "{v}");
    }
    // Doppelte Angabe: ebenfalls 400 im Fehlerformat, keine Klartext-Rejection.
    let (s, _, bytes) = laden(
        &app,
        &format!(
            "{}?fassung=original&fassung=bereinigt",
            etb_pfad_fuer_400(&app, &admin, einsatz).await
        ),
        &admin,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::BAD_REQUEST);
    assert!(serde_json::from_slice::<Value>(&bytes).unwrap()["error"].is_string());
    assert!(vermerke(&system_etb_inhalte(&app, &admin, einsatz).await).is_empty());
}

async fn etb_pfad_fuer_400(app: &axum::Router, admin: &str, einsatz: i64) -> String {
    etb_foto(app, admin, einsatz).await.pfad
}

// ── Original nur mit Recht und Vermerk ──────────────────────────────────────────────────

#[tokio::test]
async fn einsatzleitung_laedt_das_original_mit_vermerk_auf_jedem_weg() {
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", ADMIN_PW).await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let (chat, chat_aid) = chat_foto(&app, &admin, einsatz).await;
    let (dokument, dok_aid) = dokument_foto(&app, &admin, &pool, einsatz).await;
    let etb = etb_foto(&app, &admin, einsatz).await;
    let (schaden, schaden_aid) =
        schaden_datei(&pool, einsatz, "dach.jpg", "image/jpeg", &foto_mit_gps()).await;

    for (pfad, aid, ablage) in [
        (chat, chat_aid, "noch nicht versendeter Anhang".to_string()),
        (dokument, dok_aid, "Dokumentenablage".to_string()),
        (
            etb.pfad,
            etb.anhang,
            format!("ETB-Eintrag Nr. {}", etb.lfd_nr),
        ),
        (schaden, schaden_aid, "Schaden S-001".to_string()),
    ] {
        let (s, h, bytes) = laden(&app, &original(&pfad), &admin, None).await;
        assert_eq!(s, StatusCode::OK, "{pfad}");
        assert_eq!(bytes, foto_mit_gps(), "Original bytegleich, samt GPS");
        assert!(h.get(header::ETAG).is_none());
        assert_eq!(h[header::CACHE_CONTROL], "no-store");
        let cd = h[header::CONTENT_DISPOSITION].to_str().unwrap();
        assert!(
            cd.contains(".original."),
            "eigener Name fürs Original: {cd}"
        );
        let inhalte = system_etb_inhalte(&app, &admin, einsatz).await;
        let erwartet = format!(
            "Originaldatei mit Metadaten (Standort, Gerät) abgerufen: {ablage}, Anhang #{aid}"
        );
        assert!(inhalte.contains(&erwartet), "{inhalte:?}");
    }
    // Kein Vermerk nennt einen Dateinamen.
    let inhalte = system_etb_inhalte(&app, &admin, einsatz).await;
    for v in vermerke(&inhalte) {
        for name in ["foto.jpg", "lage.jpg", "Lagefoto", "dach.jpg", ".jpg"] {
            assert!(!v.contains(name), "{v}");
        }
    }
}

/// Ein an eine Nachricht gebundener Chat-Anhang: bereinigt für alle, das Original mit dem
/// Vermerk „Chat“.
#[tokio::test]
async fn chat_anhang_an_einer_nachricht_vermerkt_chat() {
    let (app, _pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", ADMIN_PW).await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let (pfad, aid) = chat_foto(&app, &admin, einsatz).await;
    let (_, kanaele) = anfrage(
        &app,
        "GET",
        &format!("/api/einsaetze/{einsatz}/chat/kanaele"),
        &admin,
        None,
    )
    .await;
    let kid = kanaele[0]["id"].as_i64().unwrap();
    let (s, m) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/chat/kanaele/{kid}/nachrichten"),
        &admin,
        Some(&format!(r#"{{"inhalt":"Foto","anhang_ids":[{aid}]}}"#)),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{m}");
    let fritz = mitglied(&app, &admin, einsatz, "fritz", "fuehrungspersonal").await;
    let (s, _, bytes) = laden(&app, &pfad, &fritz, None).await;
    assert_eq!(s, StatusCode::OK);
    ist_bereinigt(&bytes);
    let (s, _, _) = laden(&app, &original(&pfad), &fritz, None).await;
    assert_eq!(s, StatusCode::FORBIDDEN);
    let (s, _, bytes) = laden(&app, &original(&pfad), &admin, None).await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(bytes, foto_mit_gps());
    let inhalte = system_etb_inhalte(&app, &admin, einsatz).await;
    assert!(
        inhalte.contains(&format!(
            "Originaldatei mit Metadaten (Standort, Gerät) abgerufen: Chat, Anhang #{aid}"
        )),
        "{inhalte:?}"
    );
}

#[tokio::test]
async fn zweiter_abruf_liefert_erneut_und_vermerkt_erneut() {
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", ADMIN_PW).await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let (pfad, _) = schaden_datei(&pool, einsatz, "dach.jpg", "image/jpeg", &foto_mit_gps()).await;
    let (s1, h1, _) = laden(&app, &original(&pfad), &admin, None).await;
    // Auch ein mitgeschickter ETag führt nicht zum 304.
    let (s2, _, bytes) = laden(&app, &original(&pfad), &admin, Some("*")).await;
    assert_eq!((s1, s2), (StatusCode::OK, StatusCode::OK));
    assert!(h1.get(header::ETAG).is_none());
    assert_eq!(bytes, foto_mit_gps());
    assert_eq!(
        vermerke(&system_etb_inhalte(&app, &admin, einsatz).await).len(),
        2
    );
}

#[tokio::test]
async fn fuehrungspersonal_und_beobachter_bekommen_403_ohne_vermerk() {
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", ADMIN_PW).await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let (schaden, _) =
        schaden_datei(&pool, einsatz, "dach.jpg", "image/jpeg", &foto_mit_gps()).await;
    let etb = etb_foto(&app, &admin, einsatz).await.pfad;
    for (name, rolle) in [("fritz", "fuehrungspersonal"), ("erika", "beobachter")] {
        let cookie = mitglied(&app, &admin, einsatz, name, rolle).await;
        for pfad in [&schaden, &etb] {
            let (s, _, bytes) = laden(&app, &original(pfad), &cookie, None).await;
            assert_eq!(s, StatusCode::FORBIDDEN, "{rolle} {pfad}");
            assert!(!enthaelt(&bytes, b"MARKER"));
            // Die bereinigte Fassung bekommen sie.
            let (s, _, bytes) = laden(&app, pfad, &cookie, None).await;
            assert_eq!(s, StatusCode::OK);
            ist_bereinigt(&bytes);
        }
    }
    assert!(vermerke(&system_etb_inhalte(&app, &admin, einsatz).await).is_empty());
}

#[tokio::test]
async fn system_admin_der_eigenen_org_darf_einer_fremden_org_nicht() {
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", ADMIN_PW).await;
    // Einsatz einer Führungskraft, in dem der Admin kein Mitglied ist.
    benutzer_anlegen(&app, &admin, "fuehrung", "fuehrungskraft").await;
    let fk = login_cookie(&app, "fuehrung", "fuehrungpw1").await;
    let einsatz = einsatz_anlegen(&app, &fk).await;
    let (pfad, _) = schaden_datei(&pool, einsatz, "dach.jpg", "image/jpeg", &foto_mit_gps()).await;

    let (s, _, bytes) = laden(&app, &original(&pfad), &admin, None).await;
    assert_eq!(s, StatusCode::OK, "Admin der eigenen Org");
    assert_eq!(bytes, foto_mit_gps());

    let (_, fremd_id) = fremde_org_anlegen(&pool, "Nachbar", "nadmin", "nadminpw1", "keine").await;
    sqlx::query("UPDATE benutzer SET system_rolle = 'admin' WHERE id = ?")
        .bind(fremd_id)
        .execute(&pool)
        .await
        .unwrap();
    let fremd = login_cookie(&app, "nadmin", "nadminpw1").await;
    let (s, _, _) = laden(&app, &pfad, &fremd, None).await;
    assert_eq!(
        s,
        StatusCode::OK,
        "lesen darf der fremde Admin (serverweit)"
    );
    let (s, _, _) = laden(&app, &original(&pfad), &fremd, None).await;
    assert_eq!(s, StatusCode::FORBIDDEN, "das Original nicht");
    assert_eq!(
        vermerke(&system_etb_inhalte(&app, &fk, einsatz).await).len(),
        1
    );
}

#[tokio::test]
async fn fremder_einsatz_und_falsche_bindung_bleiben_404() {
    let (app, _pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", ADMIN_PW).await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let nachbar = einsatz_anlegen(&app, &admin).await;
    let etb = etb_foto(&app, &admin, einsatz).await;
    let fremd = etb.pfad.replace(
        &format!("/api/einsaetze/{einsatz}/"),
        &format!("/api/einsaetze/{nachbar}/"),
    );
    let (s, _, _) = laden(&app, &original(&fremd), &admin, None).await;
    assert_eq!(s, StatusCode::NOT_FOUND);
    // Der generische Download eines ETB-Anhangs bleibt gesperrt, auch für das Original.
    let (s, _, _) = laden(
        &app,
        &original(&format!("/api/einsaetze/{einsatz}/anhaenge/{}", etb.anhang)),
        &admin,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::NOT_FOUND);
    assert!(vermerke(&system_etb_inhalte(&app, &admin, einsatz).await).is_empty());
    assert!(vermerke(&system_etb_inhalte(&app, &admin, nachbar).await).is_empty());
}

#[tokio::test]
async fn vermerk_entsteht_auch_im_abgeschlossenen_einsatz() {
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", ADMIN_PW).await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let (pfad, aid) =
        schaden_datei(&pool, einsatz, "dach.jpg", "image/jpeg", &foto_mit_gps()).await;
    let (s, v) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/abschliessen"),
        &admin,
        None,
    )
    .await;
    assert!(s.is_success(), "abschließen: {s} {v}");

    let (s, _, bytes) = laden(&app, &original(&pfad), &admin, None).await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(bytes, foto_mit_gps());
    let inhalte = system_etb_inhalte(&app, &admin, einsatz).await;
    assert!(
        inhalte
            .iter()
            .any(|i| i.ends_with(&format!("Anhang #{aid}"))),
        "{inhalte:?}"
    );
}

// ── Guard: nur `routes/support.rs` liefert Anhang-Bytes aus (design.md D6) ───────────────

fn rs_dateien(verzeichnis: &std::path::Path, aus: &mut Vec<std::path::PathBuf>) {
    for e in std::fs::read_dir(verzeichnis).unwrap() {
        let p = e.unwrap().path();
        if p.is_dir() {
            rs_dateien(&p, aus);
        } else if p.extension().is_some_and(|x| x == "rs") {
            aus.push(p);
        }
    }
}

/// Erlaubte Stellen für `laden_bytes`: die Definition samt Tests (`anhang/repo.rs`), der eine
/// Aufrufer (`routes/support.rs`) und das gleichnamige, fremde `karte_hintergrundbild`-Repo.
fn verbotene_aufrufer(wurzel: &std::path::Path) -> Vec<String> {
    let erlaubt = [
        "src/anhang/repo.rs",
        "src/routes/support.rs",
        "src/karte_hintergrundbild/repo.rs",
        "src/routes/karte_hintergrundbild.rs",
    ];
    let mut dateien = Vec::new();
    rs_dateien(&wurzel.join("src"), &mut dateien);
    let mut treffer = Vec::new();
    for d in dateien {
        let rel = d
            .strip_prefix(wurzel)
            .unwrap()
            .to_string_lossy()
            .replace('\\', "/");
        if erlaubt.contains(&rel.as_str()) {
            continue;
        }
        for (i, zeile) in std::fs::read_to_string(&d).unwrap().lines().enumerate() {
            if zeile.contains("laden_bytes")
                && !zeile.contains("karte_hintergrundbild::repo::laden_bytes")
            {
                treffer.push(format!("{rel}:{}: {}", i + 1, zeile.trim()));
            }
        }
    }
    treffer
}

#[test]
fn nur_support_liefert_anhang_bytes_aus() {
    let wurzel = std::path::Path::new(env!("CARGO_MANIFEST_DIR"));
    let treffer = verbotene_aufrufer(wurzel);
    assert!(
        treffer.is_empty(),
        "Anhang-Bytes nur über `routes::support::anhang_antwort` ausliefern \
         (src/AGENTS.md, „Anhänge“, LFH-747):\n{}",
        treffer.join("\n")
    );
}

#[test]
fn guard_wird_bei_einem_zweiten_aufrufer_rot() {
    let tmp = tempfile::tempdir().unwrap();
    let src = tmp.path().join("src/routes");
    std::fs::create_dir_all(&src).unwrap();
    std::fs::write(
        src.join("neu.rs"),
        "let (_, _, d) = crate::anhang::repo::laden_bytes(&pool, id).await?;\n",
    )
    .unwrap();
    std::fs::write(
        src.join("support.rs"),
        "anhang::repo::laden_bytes(pool, id)\n",
    )
    .unwrap();
    assert_eq!(verbotene_aufrufer(tmp.path()).len(), 1);
}

// ── LFH-758: Tier und UHS ───────────────────────────────────────────────────────────────

/// Tier und UHS sind weitere Wege (Spec `anhang-metadaten`, Delta LFH-758): der normale
/// Download liefert bereinigt, das Original nur mit ETB-Vermerk, der Tier bzw. UHS nennt.
#[tokio::test]
async fn tier_und_uhs_liefern_bereinigt_und_das_original_mit_vermerk() {
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", ADMIN_PW).await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    for art in Erfassung::ALLE {
        let foto = foto_mit_gps();
        let (aid, besitzer, linker) =
            erfassungs_datei(&pool, einsatz, art, "dach.jpg", "image/jpeg", &foto).await;
        let pfad = format!(
            "/api/einsaetze/{einsatz}/{}/{besitzer}/anhaenge/{linker}/datei",
            art.segment()
        );

        let (s, _, bytes) = laden(&app, &pfad, &admin, None).await;
        assert_eq!(s, StatusCode::OK, "{art:?}");
        ist_bereinigt(&bytes);
        assert_eq!(
            gespeichert(&pool, aid).await.0,
            foto,
            "{art:?}: Original bleibt"
        );

        let (s, h, bytes) = laden(&app, &original(&pfad), &admin, None).await;
        assert_eq!(s, StatusCode::OK, "{art:?}");
        assert_eq!(bytes, foto, "{art:?}: Original bytegleich");
        assert_eq!(h[header::CACHE_CONTROL], "no-store");
        let erwartet = format!(
            "Originaldatei mit Metadaten (Standort, Gerät) abgerufen: {}, Anhang #{aid}",
            art.erster_ablage_name()
        );
        let inhalte = system_etb_inhalte(&app, &admin, einsatz).await;
        assert!(inhalte.contains(&erwartet), "{art:?}: {inhalte:?}");
    }
}

/// Führungspersonal bekommt an Tier und UHS kein Original (403) und hinterlässt keinen Vermerk.
#[tokio::test]
async fn tier_und_uhs_original_nur_fuer_die_einsatzleitung() {
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", ADMIN_PW).await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let frieda = mitglied(&app, &admin, einsatz, "frieda", "fuehrungspersonal").await;
    for art in Erfassung::ALLE {
        let (_, besitzer, linker) = erfassungs_datei(
            &pool,
            einsatz,
            art,
            "dach.jpg",
            "image/jpeg",
            &foto_mit_gps(),
        )
        .await;
        let pfad = format!(
            "/api/einsaetze/{einsatz}/{}/{besitzer}/anhaenge/{linker}/datei",
            art.segment()
        );
        let (s, _, _) = laden(&app, &original(&pfad), &frieda, None).await;
        assert_eq!(s, StatusCode::FORBIDDEN, "{art:?}");
        let (s, _, bytes) = laden(&app, &pfad, &frieda, None).await;
        assert_eq!(s, StatusCode::OK, "{art:?}: bereinigt darf sie");
        ist_bereinigt(&bytes);
    }
    assert!(vermerke(&system_etb_inhalte(&app, &admin, einsatz).await).is_empty());
}
