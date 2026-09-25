//! Dediziertes Test-Binary (LFH-22): der Logo-Upload durchläuft den AV-Scan-Seam
//! (scan-vor-persist) und lehnt bei unerreichbarem Scanner fail-closed mit 503 ab.
//!
//! Eigenes Binary aus demselben Grund wie `tests/karte_hintergrundbild_scan.rs`:
//! `init_scan_config` setzt eine prozessweite OnceLock und kippte in
//! `tests/organisation_logo.rs` jeden Upload auf 503. Läuft in BEIDEN Builds grün: Default
//! (clamav an) → echter `clamd_scan` gegen `127.0.0.1:1` (ECONNREFUSED); mit
//! `--no-default-features` → not-feature-Stub, identisches Ergebnis.

use axum::body::{to_bytes, Body};
use axum::http::{header, Request, StatusCode};
use lifeline_hub::anhang::{init_scan_config, ScanConfig};
use tower::ServiceExt;

mod common;
use common::{anfrage, login_cookie, setup};

/// PNG-Magic-Bytes genügen: Größe und Typ sind in Ordnung, erst der Scan scheitert.
const PNG: &[u8] = &[0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00];

#[tokio::test]
async fn logo_upload_ohne_erreichbaren_scanner_ist_503_und_speichert_nichts() {
    // Prozessglobal, VOR dem ersten scan_config()-Zugriff (den erst der Upload-Handler tut).
    init_scan_config(ScanConfig {
        clamd_addr: Some("127.0.0.1:1".into()),
        fail_open: false,
        ..ScanConfig::default()
    });

    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;

    let boundary = "LFHLOGOSCAN";
    let mut body = format!(
        "--{boundary}\r\nContent-Disposition: form-data; name=\"datei\"; filename=\"logo.png\"\r\n\
         Content-Type: image/png\r\n\r\n"
    )
    .into_bytes();
    body.extend_from_slice(PNG);
    body.extend_from_slice(format!("\r\n--{boundary}--\r\n").as_bytes());

    let resp = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/organisation/logo")
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

    // Scan vor dem Schreiben: der abgelehnte Upload hinterlässt nichts.
    let (status, _) = anfrage(&app, "GET", "/api/organisation/logo", &admin, None).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    let (_, org) = anfrage(&app, "GET", "/api/organisation", &admin, None).await;
    assert!(!org.as_object().unwrap().contains_key("logo"));
}
