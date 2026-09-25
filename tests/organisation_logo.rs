//! Logo der Organisation (LFH-22, design.md D8): `POST|GET|DELETE /api/organisation/logo`
//! und das Feld `logo` an `GET /api/organisation`.
//!
//! Der fail-closed-Pfad des Virenscans (503) steht in `tests/organisation_logo_scan.rs`:
//! `init_scan_config` setzt eine prozessweite OnceLock und kippte hier jeden Upload auf 503.

use axum::body::{to_bytes, Body};
use axum::http::{header, HeaderMap, Request, StatusCode};
use lifeline_hub::anhang::{entscheide, ScanErgebnis};
use serde_json::Value;
use tower::ServiceExt;

mod common;
use common::{anfrage, benutzer_anlegen, fremde_org_anlegen, login_cookie, setup, setup_mit_pool};

const MIB: usize = 1024 * 1024;
const LOGO: &str = "/api/organisation/logo";

/// Valides 1x1-PNG.
fn png() -> Vec<u8> {
    vec![
        0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44,
        0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x02, 0x00, 0x00, 0x00, 0x90,
        0x77, 0x53, 0xDE, 0x00, 0x00, 0x00, 0x0C, 0x49, 0x44, 0x41, 0x54, 0x08, 0xD7, 0x63, 0xF8,
        0xCF, 0xC0, 0x00, 0x00, 0x00, 0x02, 0x00, 0x01, 0xE2, 0x21, 0xBC, 0x33, 0x00, 0x00, 0x00,
        0x00, 0x49, 0x45, 0x4E, 0x44, 0xAE, 0x42, 0x60, 0x82,
    ]
}

/// JPEG-Kopf (SOI + APP0/JFIF). Die Erkennung prüft die Magic-Bytes, nicht die Dekodierbarkeit.
fn jpeg() -> Vec<u8> {
    let mut v = vec![
        0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, b'J', b'F', b'I', b'F', 0x00, 0x01, 0x01, 0x00, 0x00,
        0x01, 0x00, 0x01, 0x00, 0x00,
    ];
    v.extend_from_slice(&[0xFF, 0xD9]);
    v
}

/// PNG-Magic-Bytes, auf `groesse` mit Nullen aufgefüllt.
fn png_mit_groesse(groesse: usize) -> Vec<u8> {
    let mut v = png();
    v.resize(groesse, 0);
    v
}

fn multipart(boundary: &str, dateiname: &str, content_type: &str, daten: &[u8]) -> Vec<u8> {
    let mut body = Vec::new();
    body.extend_from_slice(
        format!(
            "--{boundary}\r\nContent-Disposition: form-data; name=\"datei\"; \
             filename=\"{dateiname}\"\r\nContent-Type: {content_type}\r\n\r\n"
        )
        .as_bytes(),
    );
    body.extend_from_slice(daten);
    body.extend_from_slice(format!("\r\n--{boundary}--\r\n").as_bytes());
    body
}

/// Lädt `daten` als Feld `datei` hoch; liefert (Status, JSON-Antwort).
async fn hochladen_als(
    app: &axum::Router,
    cookie: &str,
    dateiname: &str,
    content_type: &str,
    daten: &[u8],
) -> (StatusCode, Value) {
    let boundary = "LFHLOGOBND";
    let resp = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(LOGO)
                .header(header::COOKIE, cookie)
                .header(
                    header::CONTENT_TYPE,
                    format!("multipart/form-data; boundary={boundary}"),
                )
                .body(Body::from(multipart(
                    boundary,
                    dateiname,
                    content_type,
                    daten,
                )))
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

async fn hochladen(app: &axum::Router, cookie: &str, daten: &[u8]) -> (StatusCode, Value) {
    hochladen_als(app, cookie, "logo.png", "image/png", daten).await
}

/// GET des Logos roh: (Status, Header, Bytes).
async fn logo_holen(
    app: &axum::Router,
    cookie: &str,
    if_none_match: Option<&str>,
) -> (StatusCode, HeaderMap, Vec<u8>) {
    let mut req = Request::builder()
        .method("GET")
        .uri(LOGO)
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

async fn org(app: &axum::Router, cookie: &str) -> Value {
    let (status, json) = anfrage(app, "GET", "/api/organisation", cookie, None).await;
    assert_eq!(status, StatusCode::OK);
    json
}

/// Presence per `contains_key`: `json["logo"] == Value::Null` wäre auch bei `"logo": null`
/// grün und unterschiede „fehlt" nicht von „null" (CLAUDE.md, Typ-Codegen).
fn hat_logo(org: &Value) -> bool {
    org.as_object().unwrap().contains_key("logo")
}

fn header_str<'a>(h: &'a HeaderMap, name: header::HeaderName) -> &'a str {
    h.get(name).unwrap().to_str().unwrap()
}

// --- Hochladen -------------------------------------------------------------------------

#[tokio::test]
async fn png_wird_angenommen_und_steht_an_der_organisation() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    assert!(
        !hat_logo(&org(&app, &admin).await),
        "ohne Logo fehlt der Schlüssel"
    );

    let (status, json) = hochladen(&app, &admin, &png()).await;
    assert_eq!(status, StatusCode::OK, "{json:?}");
    assert_eq!(
        json["name"], "Test-Orga",
        "Antwort ist die OrganisationAnzeige"
    );
    assert_eq!(json["logo"]["mime"], "image/png");
    assert_eq!(json["logo"]["groesse"], png().len());
    assert_eq!(json["logo"]["sha256"].as_str().unwrap().len(), 64);
    assert!(json["logo"]["geaendert_at"].is_string());
    assert!(
        !json["logo"].as_object().unwrap().contains_key("daten"),
        "die Metadaten tragen keine Bytes"
    );

    let o = org(&app, &admin).await;
    assert!(hat_logo(&o));
    assert_eq!(o["logo"], json["logo"]);
}

#[tokio::test]
async fn jpeg_wird_angenommen() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let (status, json) = hochladen_als(&app, &admin, "logo.jpg", "image/jpeg", &jpeg()).await;
    assert_eq!(status, StatusCode::OK, "{json:?}");
    assert_eq!(json["logo"]["mime"], "image/jpeg");
}

/// Erkannt wird am Inhalt: eine SVG-Datei mit `.png`-Namen und PNG-Typangabe ist 400, und
/// das bisherige Logo bleibt stehen.
#[tokio::test]
async fn svg_mit_png_namen_ist_400_und_bisheriges_logo_bleibt() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let (status, _) = hochladen(&app, &admin, &png()).await;
    assert_eq!(status, StatusCode::OK);

    let svg = br#"<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>"#;
    let (status, json) = hochladen_als(&app, &admin, "logo.png", "image/png", svg).await;
    assert_eq!(status, StatusCode::BAD_REQUEST, "{json:?}");

    let (status, _, bytes) = logo_holen(&app, &admin, None).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(bytes, png(), "das bisherige Logo bleibt");
}

#[tokio::test]
async fn gif_ist_400() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let gif = b"GIF89a\x01\x00\x01\x00\x00\x00\x00;";
    let (status, json) = hochladen_als(&app, &admin, "logo.gif", "image/gif", gif).await;
    assert_eq!(status, StatusCode::BAD_REQUEST, "{json:?}");
    assert!(!hat_logo(&org(&app, &admin).await));
}

#[tokio::test]
async fn leere_datei_ist_400() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let (status, json) = hochladen(&app, &admin, &[]).await;
    assert_eq!(status, StatusCode::BAD_REQUEST, "{json:?}");
    assert!(!hat_logo(&org(&app, &admin).await));
}

#[tokio::test]
async fn ohne_feld_datei_ist_400() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let boundary = "LFHLOGOBND";
    let body = format!(
        "--{boundary}\r\nContent-Disposition: form-data; name=\"anderes\"\r\n\r\nx\r\n--{boundary}--\r\n"
    );
    let resp = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(LOGO)
                .header(header::COOKIE, admin.as_str())
                .header(
                    header::CONTENT_TYPE,
                    format!("multipart/form-data; boundary={boundary}"),
                )
                .body(Body::from(body))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
}

/// Grenze der Größe: genau 1 MiB angenommen, ein Byte mehr → 400 (vom Handler, nicht vom
/// Body-Limit der Route, das 64 KiB Luft für den Multipart-Rahmen lässt).
#[tokio::test]
async fn genau_1_mib_angenommen_ein_byte_mehr_ist_400() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;

    let (status, json) = hochladen(&app, &admin, &png_mit_groesse(MIB)).await;
    assert_eq!(status, StatusCode::OK, "{json:?}");
    assert_eq!(json["logo"]["groesse"], MIB);

    let (status, json) = hochladen(&app, &admin, &png_mit_groesse(MIB + 1)).await;
    assert_eq!(status, StatusCode::BAD_REQUEST, "{json:?}");
    assert_eq!(
        org(&app, &admin).await["logo"]["groesse"],
        MIB,
        "das 1-MiB-Logo bleibt"
    );
}

/// Eine Datei deutlich über dem Body-Limit der Route (1 MiB + 64 KiB) ist ebenfalls 400,
/// nicht 413: die Spec verlangt für „über 1 MiB" 400, und der realistische Fall ist ein
/// großes Foto direkt an die API — die Vorprüfung im Client schützt nur die Oberfläche.
#[tokio::test]
async fn zwei_mib_ueber_dem_body_limit_ist_400_und_das_logo_bleibt() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let (status, _) = hochladen(&app, &admin, &png()).await;
    assert_eq!(status, StatusCode::OK);

    let (status, json) = hochladen(&app, &admin, &png_mit_groesse(2 * MIB)).await;
    assert_eq!(status, StatusCode::BAD_REQUEST, "{json:?}");
    assert!(
        json["error"].is_string(),
        "Fehler im {{error}}-Format: {json:?}"
    );
    assert_eq!(
        org(&app, &admin).await["logo"]["groesse"],
        png().len(),
        "das bisherige Logo bleibt"
    );
}

/// Die Fund-Entscheidung des gemeinsamen Scan-Seams ist 422. Nur auf Einheitsebene
/// belegt: ohne laufenden clamd lässt sich ein Fund über die Route nicht auslösen. Dass
/// die Route den Seam überhaupt durchläuft, belegt `tests/organisation_logo_scan.rs` (503).
#[test]
fn fund_entscheidung_ist_422() {
    let fehler = entscheide(ScanErgebnis::Fund("Eicar-Test-Signature".into()), false).unwrap_err();
    assert_eq!(fehler.status(), StatusCode::UNPROCESSABLE_ENTITY);
}

#[tokio::test]
async fn nicht_admin_darf_nicht_hochladen_und_nicht_entfernen_aber_lesen() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    benutzer_anlegen(&app, &admin, "erika", "keine").await;
    let erika = login_cookie(&app, "erika", "erikapw1").await;

    let (status, _) = hochladen(&app, &erika, &png()).await;
    assert_eq!(status, StatusCode::FORBIDDEN);

    let (status, _) = hochladen(&app, &admin, &png()).await;
    assert_eq!(status, StatusCode::OK);

    let (status, _) = anfrage(&app, "DELETE", LOGO, &erika, None).await;
    assert_eq!(status, StatusCode::FORBIDDEN);

    let (status, _, bytes) = logo_holen(&app, &erika, None).await;
    assert_eq!(
        status,
        StatusCode::OK,
        "jede angemeldete Person liest ihr Logo"
    );
    assert_eq!(bytes, png());
    assert!(hat_logo(&org(&app, &erika).await));
}

#[tokio::test]
async fn ohne_anmeldung_401() {
    let app = setup().await;
    let (status, _, _) = logo_holen(&app, "lfh_session=ungueltig", None).await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
}

// --- Lesen -----------------------------------------------------------------------------

#[tokio::test]
async fn get_liefert_bytes_mit_typ_etag_und_nicht_unbefristetem_cache() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let (_, json) = hochladen(&app, &admin, &png()).await;
    let sha = json["logo"]["sha256"].as_str().unwrap().to_string();

    let (status, h, bytes) = logo_holen(&app, &admin, None).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(bytes, png());
    assert_eq!(header_str(&h, header::CONTENT_TYPE), "image/png");
    assert_eq!(header_str(&h, header::ETAG), format!("\"{sha}\""));
    let cache = header_str(&h, header::CACHE_CONTROL);
    assert_eq!(cache, "private, no-cache");
    assert!(
        !cache.contains("immutable") && !cache.contains("max-age"),
        "die Adresse ist stabil, der Inhalt nicht: {cache}"
    );
    assert_eq!(header_str(&h, header::X_CONTENT_TYPE_OPTIONS), "nosniff");
}

#[tokio::test]
async fn if_none_match_ist_304_ohne_body() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    hochladen(&app, &admin, &png()).await;
    let (_, h, _) = logo_holen(&app, &admin, None).await;
    let etag = header_str(&h, header::ETAG).to_string();

    let (status, h304, bytes) = logo_holen(&app, &admin, Some(&etag)).await;
    assert_eq!(status, StatusCode::NOT_MODIFIED);
    assert!(bytes.is_empty(), "304 trägt keine Bilddaten");
    assert_eq!(header_str(&h304, header::ETAG), etag);
    assert_eq!(
        header_str(&h304, header::CACHE_CONTROL),
        "private, no-cache"
    );

    let (status, _, bytes) = logo_holen(&app, &admin, Some("\"veraltet\"")).await;
    assert_eq!(status, StatusCode::OK, "fremder Validator → volle Antwort");
    assert_eq!(bytes, png());
}

#[tokio::test]
async fn ersetzen_aendert_den_etag_und_den_inhalt() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    hochladen(&app, &admin, &png()).await;
    let (_, h1, _) = logo_holen(&app, &admin, None).await;
    let etag_alt = header_str(&h1, header::ETAG).to_string();

    let (status, json) = hochladen_als(&app, &admin, "neu.jpg", "image/jpeg", &jpeg()).await;
    assert_eq!(status, StatusCode::OK, "{json:?}");

    let (status, h2, bytes) = logo_holen(&app, &admin, Some(&etag_alt)).await;
    assert_eq!(
        status,
        StatusCode::OK,
        "der alte Validator trägt nicht mehr"
    );
    assert_ne!(header_str(&h2, header::ETAG), etag_alt);
    assert_eq!(header_str(&h2, header::CONTENT_TYPE), "image/jpeg");
    assert_eq!(bytes, jpeg());
}

// --- Entfernen -------------------------------------------------------------------------

#[tokio::test]
async fn delete_ist_204_und_danach_404() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    hochladen(&app, &admin, &png()).await;

    let (status, _) = anfrage(&app, "DELETE", LOGO, &admin, None).await;
    assert_eq!(status, StatusCode::NO_CONTENT);
    let (status, _, _) = logo_holen(&app, &admin, None).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    assert!(!hat_logo(&org(&app, &admin).await));

    // Auch ohne Logo 204 (idempotent).
    let (status, _) = anfrage(&app, "DELETE", LOGO, &admin, None).await;
    assert_eq!(status, StatusCode::NO_CONTENT);
}

#[tokio::test]
async fn ohne_logo_ist_get_404() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let (status, _, _) = logo_holen(&app, &admin, None).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
}

/// Der PATCH des Namens antwortet mit derselben Form wie der GET — samt `logo`. Sonst
/// verlöre ein Client, der seinen Cache aus der PATCH-Antwort setzt, das Logo still.
#[tokio::test]
async fn patch_antwort_traegt_das_logo_mit() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    hochladen(&app, &admin, &png()).await;
    let (status, json) = anfrage(
        &app,
        "PATCH",
        "/api/organisation",
        &admin,
        Some(r#"{"name":"Neu"}"#),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert!(hat_logo(&json), "{json:?}");
    assert_eq!(json["logo"]["mime"], "image/png");
}

// --- Trennung der Organisationen (3.4) -------------------------------------------------

/// Legt Org B mit einer Leserin und einem Admin an. Der Admin ist serverweit `admin`
/// (`system_rolle`), gehört aber zu B — genau der Fall, an dem sich zeigt, dass die Route
/// die Org aus dem Benutzer liest und nicht aus einer Berechtigung „über alles".
async fn org_b(pool: &sqlx::SqlitePool) -> i64 {
    let (org_b, _) = fremde_org_anlegen(pool, "Org B", "bea", "beapw123", "keine").await;
    let (_, admin_b) = fremde_org_anlegen(pool, "Hilfs-Org", "bert", "bertpw12", "keine").await;
    sqlx::query("UPDATE benutzer SET org_id = ?, system_rolle = 'admin' WHERE id = ?")
        .bind(org_b)
        .bind(admin_b)
        .execute(pool)
        .await
        .unwrap();
    org_b
}

#[tokio::test]
async fn jede_organisation_bekommt_ihr_eigenes_logo() {
    let (app, pool) = setup_mit_pool().await;
    org_b(&pool).await;
    let admin_a = login_cookie(&app, "admin", "startpw12").await;
    let admin_b = login_cookie(&app, "bert", "bertpw12").await;
    let leserin_b = login_cookie(&app, "bea", "beapw123").await;

    assert_eq!(hochladen(&app, &admin_a, &png()).await.0, StatusCode::OK);
    let (status, json) = hochladen_als(&app, &admin_b, "b.jpg", "image/jpeg", &jpeg()).await;
    assert_eq!(status, StatusCode::OK, "{json:?}");
    assert_eq!(json["name"], "Org B");

    let (_, _, a) = logo_holen(&app, &admin_a, None).await;
    let (_, _, b) = logo_holen(&app, &leserin_b, None).await;
    assert_eq!(a, png());
    assert_eq!(b, jpeg());
    assert_eq!(org(&app, &admin_a).await["logo"]["mime"], "image/png");
    assert_eq!(org(&app, &leserin_b).await["logo"]["mime"], "image/jpeg");
}

#[tokio::test]
async fn organisation_ohne_logo_neben_einer_mit_logo_bekommt_404() {
    let (app, pool) = setup_mit_pool().await;
    org_b(&pool).await;
    let admin_a = login_cookie(&app, "admin", "startpw12").await;
    let leserin_b = login_cookie(&app, "bea", "beapw123").await;
    assert_eq!(hochladen(&app, &admin_a, &png()).await.0, StatusCode::OK);

    let (status, _, bytes) = logo_holen(&app, &leserin_b, None).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    assert_ne!(bytes, png(), "niemals das Logo der fremden Org");
    assert!(!hat_logo(&org(&app, &leserin_b).await));
}

/// Die Routen nehmen keine Org-Kennung: der Admin von A ändert immer nur A. Hochladen,
/// Ersetzen und Entfernen durch A lassen das Logo von B unberührt.
#[tokio::test]
async fn admin_von_a_kann_das_logo_von_b_nicht_aendern() {
    let (app, pool) = setup_mit_pool().await;
    org_b(&pool).await;
    let admin_a = login_cookie(&app, "admin", "startpw12").await;
    let admin_b = login_cookie(&app, "bert", "bertpw12").await;
    let leserin_b = login_cookie(&app, "bea", "beapw123").await;

    hochladen_als(&app, &admin_b, "b.jpg", "image/jpeg", &jpeg()).await;
    let (_, hb, _) = logo_holen(&app, &leserin_b, None).await;
    let etag_b = header_str(&hb, header::ETAG).to_string();

    assert_eq!(hochladen(&app, &admin_a, &png()).await.0, StatusCode::OK);
    let (status, _) = anfrage(&app, "DELETE", LOGO, &admin_a, None).await;
    assert_eq!(status, StatusCode::NO_CONTENT);

    let (status, hb2, bytes) = logo_holen(&app, &leserin_b, None).await;
    assert_eq!(status, StatusCode::OK, "B hat sein Logo noch");
    assert_eq!(bytes, jpeg());
    assert_eq!(header_str(&hb2, header::ETAG), etag_b);
    let (status, _, _) = logo_holen(&app, &admin_a, None).await;
    assert_eq!(status, StatusCode::NOT_FOUND, "A hat seines entfernt");
}
