//! Dediziertes Test-Binary (LLH-2099): das Anlegen einer Fremdebene durchläuft den AV-Scan-Seam
//! (scan-vor-persist), und ein Fund ist `400` mit `grund: "virus"` (Entwurf, „Fehler“).
//!
//! Eigenes Binary aus demselben Grund wie `tests/karte_hintergrundbild_scan.rs`:
//! `init_scan_config` setzt eine prozessweite OnceLock. Der Scanner ist ein Stub, der das
//! INSTREAM-Protokoll von clamd spricht und jeden Puffer als Fund meldet. Nur mit dem Feature
//! `clamav`: ohne es gilt jede Adresse als unerreichbar (503, nicht der Fund).
#![cfg(feature = "clamav")]

use axum::body::{to_bytes, Body};
use axum::http::{header, Request, StatusCode};
use lifeline_hub::anhang::{init_scan_config, ScanConfig};
use serde_json::Value;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;
use tower::ServiceExt;

mod common;
use common::{anfrage, einsatz_anlegen, login_cookie, setup};

/// clamd-Stub: liest Befehl und Blöcke bis zum Nullblock und meldet einen Fund.
async fn clamd_mit_fund() -> String {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap().to_string();
    tokio::spawn(async move {
        loop {
            let Ok((mut sock, _)) = listener.accept().await else {
                return;
            };
            tokio::spawn(async move {
                let mut b = [0u8; 1];
                // Befehl `zINSTREAM\0`.
                loop {
                    if sock.read_exact(&mut b).await.is_err() || b[0] == 0 {
                        break;
                    }
                }
                loop {
                    let mut laenge = [0u8; 4];
                    if sock.read_exact(&mut laenge).await.is_err() {
                        return;
                    }
                    let n = u32::from_be_bytes(laenge) as usize;
                    if n == 0 {
                        break;
                    }
                    let mut block = vec![0u8; n];
                    if sock.read_exact(&mut block).await.is_err() {
                        return;
                    }
                }
                let _ = sock
                    .write_all(b"stream: Eicar-Test-Signature FOUND\0")
                    .await;
                let _ = sock.shutdown().await;
            });
        }
    });
    addr
}

#[tokio::test]
async fn virenfund_ist_400_virus_und_speichert_nichts() {
    let addr = clamd_mit_fund().await;
    init_scan_config(ScanConfig {
        clamd_addr: Some(addr),
        fail_open: false,
        ..ScanConfig::default()
    });

    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let uri = format!("/api/incidents/{einsatz}/map/foreign-layers");

    let boundary = "LLHFREMDSCAN";
    let geojson = r#"{"type":"Point","coordinates":[9.1,50.1]}"#;
    let body = format!(
        "--{boundary}\r\nContent-Disposition: form-data; name=\"name\"\r\n\r\nA\r\n\
         --{boundary}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"a.geojson\"\r\n\
         Content-Type: application/octet-stream\r\n\r\n{geojson}\r\n--{boundary}--\r\n"
    );
    let resp = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(&uri)
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
    let bytes = to_bytes(resp.into_body(), usize::MAX).await.unwrap();
    let v: Value = serde_json::from_slice(&bytes).unwrap_or(Value::Null);
    assert_eq!(status, StatusCode::BAD_REQUEST, "{v}");
    assert_eq!(v["grund"], "virus", "{v}");

    let (s, liste) = anfrage(&app, "GET", &uri, &admin, None).await;
    assert_eq!(s, StatusCode::OK);
    assert!(
        liste.as_array().unwrap().is_empty(),
        "abgelehnte Datei darf nichts speichern"
    );
}
