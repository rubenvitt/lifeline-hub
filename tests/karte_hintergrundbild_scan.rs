//! Dediziertes Test-Binary (LFH-238): beweist, dass der Karten-Hintergrundbild-Upload
//! den AV-Scan-Seam durchläuft (scan-vor-persist, wie der generische Anhang-Upload).
//!
//! Warum ein EIGENES Binary: `init_scan_config` setzt eine prozessglobale OnceLock. Auf
//! fail-closed + unerreichbaren clamd gestellt, würde das JEDEN Upload im Prozess auf 503
//! kippen — deshalb isoliert von der übrigen karte_hintergrundbild-Suite. Kein `clamav`-
//! Feature nötig: der not-feature-Stub liefert bei gesetzter Adresse `ScannerNichtErreichbar`
//! → fail-closed → 503.

use axum::body::{to_bytes, Body};
use axum::http::{header, Request, StatusCode};
use lifeline_hub::anhang::{init_scan_config, ScanConfig};
use tower::ServiceExt;

mod common;
use common::{anfrage, einsatz_anlegen, login_cookie, setup};

const ECKEN: &str = "[[9.0,50.0],[9.1,50.0],[9.1,49.9],[9.0,49.9]]";

/// Valides 1x1-PNG (Magic-Bytes für erkenne_bild_mime), damit der Upload MIME-/Ecken-/
/// Größenprüfung passiert und erst am AV-Scan scheitert.
fn minimal_png() -> Vec<u8> {
    vec![
        0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44,
        0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x02, 0x00, 0x00, 0x00, 0x90,
        0x77, 0x53, 0xDE, 0x00, 0x00, 0x00, 0x0C, 0x49, 0x44, 0x41, 0x54, 0x08, 0xD7, 0x63, 0xF8,
        0xCF, 0xC0, 0x00, 0x00, 0x00, 0x02, 0x00, 0x01, 0xE2, 0x21, 0xBC, 0x33, 0x00, 0x00, 0x00,
        0x00, 0x49, 0x45, 0x4E, 0x44, 0xAE, 0x42, 0x60, 0x82,
    ]
}

fn multipart_bild(boundary: &str, daten: &[u8]) -> Vec<u8> {
    let mut body = Vec::new();
    body.extend_from_slice(
        format!(
            "--{boundary}\r\nContent-Disposition: form-data; name=\"datei\"; filename=\"plan.png\"\r\nContent-Type: image/png\r\n\r\n"
        )
        .as_bytes(),
    );
    body.extend_from_slice(daten);
    body.extend_from_slice(
        format!(
            "\r\n--{boundary}\r\nContent-Disposition: form-data; name=\"ecken\"\r\n\r\n{ECKEN}\r\n--{boundary}--\r\n"
        )
        .as_bytes(),
    );
    body
}

/// Fail-closed + unerreichbarer clamd: Ein valides PNG (MIME/Ecken/Größe ok) muss am
/// AV-Scan scheitern (503) — Beweis, dass der Upload den Scan-Seam durchläuft und nicht
/// still ungescannt persistiert. Vor LFH-238 umging der Hintergrundbild-Upload den Scan
/// (→ 201).
#[tokio::test]
async fn upload_ohne_erreichbaren_scanner_wird_fail_closed_abgelehnt() {
    // Prozessglobal, VOR dem ersten scan_config()-Zugriff (den erst der Upload-Handler tut).
    init_scan_config(ScanConfig {
        clamd_addr: Some("127.0.0.1:1".into()), // ECONNREFUSED / not-feature-Stub → nicht erreichbar
        fail_open: false,
        ..ScanConfig::default()
    });

    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;

    let boundary = "LFHSCANBND";
    let body = multipart_bild(boundary, &minimal_png());
    let resp = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(format!("/api/einsaetze/{einsatz}/karte/hintergrundbilder"))
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
    let status = resp.status();
    let _ = to_bytes(resp.into_body(), usize::MAX).await.unwrap();
    assert_eq!(
        status,
        StatusCode::SERVICE_UNAVAILABLE,
        "fail-closed + unerreichbarer clamd → 503 (Scan-Seam muss durchlaufen werden)"
    );

    // Kern-Garantie von G05 (scan-vor-persist): der abgelehnte Upload hinterlässt NICHTS.
    let (sl, liste) = anfrage(
        &app,
        "GET",
        &format!("/api/einsaetze/{einsatz}/karte/hintergrundbilder"),
        &admin,
        None,
    )
    .await;
    assert_eq!(sl, StatusCode::OK);
    assert!(
        liste.as_array().unwrap().is_empty(),
        "abgelehnter Upload darf nichts persistieren"
    );
}
