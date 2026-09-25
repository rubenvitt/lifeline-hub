//! Dediziertes Test-Binary (LFH-21): die Schaden-Ablage läuft durch den AV-Scan, BEVOR
//! irgendetwas gespeichert wird — Spec „Scanner nicht erreichbar“: 503, weder Datei noch
//! Verknüpfung noch ETB-Eintrag.
//!
//! Eigenes Binary, weil `init_scan_config` eine prozessglobale OnceLock setzt: fail-closed
//! gegen einen unerreichbaren clamd kippte sonst jeden Upload der übrigen Suite auf 503
//! (Muster `tests/karte_hintergrundbild_scan.rs`). Läuft in BEIDEN Builds: Default (clamav
//! an) → echter Verbindungsversuch gegen `127.0.0.1:1` (ECONNREFUSED); `--no-default-features`
//! → Stub, gleiches Ergebnis.

use axum::body::{to_bytes, Body};
use axum::http::{header, Request, StatusCode};
use lifeline_hub::anhang::{init_scan_config, ScanConfig};
use tower::ServiceExt;

mod common;
use common::{anfrage, einsatz_anlegen, login_cookie, setup_mit_pool};

#[tokio::test]
async fn ablage_ohne_erreichbaren_scanner_ist_503_und_speichert_nichts() {
    // Prozessglobal, VOR dem ersten scan_config()-Zugriff (den erst der Upload-Handler tut).
    init_scan_config(ScanConfig {
        clamd_addr: Some("127.0.0.1:1".into()),
        fail_open: false,
        ..ScanConfig::default()
    });

    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let (s, v) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/schaeden"),
        &admin,
        Some(r#"{"typ":"sachschaden","ausmass":"gering","ort":"Hauptstr. 1"}"#),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{v}");
    let schaden = v["id"].as_i64().unwrap();
    let zaehle = |sql: &'static str| {
        let pool = pool.clone();
        async move {
            sqlx::query_scalar::<_, i64>(sql)
                .bind(einsatz)
                .fetch_one(&pool)
                .await
                .unwrap()
        }
    };
    let etb_vorher = zaehle("SELECT COUNT(*) FROM etb_eintrag WHERE einsatz_id = ?").await;

    let b = "LFHSCHADENSCAN";
    let mut body = Vec::new();
    body.extend_from_slice(
        format!(
            "--{b}\r\nContent-Disposition: form-data; name=\"datei\"; filename=\"dach.jpg\"\r\n\
             Content-Type: image/jpeg\r\n\r\n"
        )
        .as_bytes(),
    );
    body.extend_from_slice(b"JPEGDATEN");
    body.extend_from_slice(format!("\r\n--{b}--\r\n").as_bytes());
    let resp = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(format!(
                    "/api/einsaetze/{einsatz}/schaeden/{schaden}/anhaenge"
                ))
                .header(header::COOKIE, admin.as_str())
                .header(
                    header::CONTENT_TYPE,
                    format!("multipart/form-data; boundary={b}"),
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
        "fail-closed + unerreichbarer clamd → 503"
    );

    assert_eq!(
        zaehle("SELECT COUNT(*) FROM anhang WHERE einsatz_id = ?").await,
        0,
        "keine Datei"
    );
    assert_eq!(
        zaehle("SELECT COUNT(*) FROM einsatz_schaden_anhang WHERE einsatz_id = ?").await,
        0,
        "keine Verknüpfung"
    );
    assert_eq!(
        zaehle("SELECT COUNT(*) FROM etb_eintrag WHERE einsatz_id = ?").await,
        etb_vorher,
        "kein ETB-Eintrag"
    );
}
