//! Dediziertes Test-Binary (LFH-999): der Upload eines UHS-Plans läuft durch den AV-Scan, BEVOR
//! etwas gespeichert wird — Scanner nicht erreichbar: 503, weder Plan noch ETB-Eintrag.
//!
//! Eigenes Binary, weil `init_scan_config` eine prozessglobale OnceLock setzt (Muster
//! `tests/uhs_anhang_scan.rs`). Läuft in BEIDEN Builds: Default (clamav an) → echter
//! Verbindungsversuch gegen `127.0.0.1:1`; `--no-default-features` → Stub, gleiches Ergebnis.

use axum::http::StatusCode;
use lifeline_hub::anhang::{init_scan_config, ScanConfig};

mod common;
use common::{anfrage, einsatz_anlegen, login_cookie, plan_hochladen, png_bytes, setup_mit_pool};

#[tokio::test]
async fn plan_ohne_erreichbaren_scanner_ist_503_und_speichert_nichts() {
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
        &format!("/api/einsaetze/{einsatz}/uhs"),
        &admin,
        Some(r#"{"typ":"behandlungsplatz","bezeichnung":"BHP 50"}"#),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{v}");
    let uhs = v["id"].as_i64().unwrap();
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

    let (s, _) = plan_hochladen(&app, einsatz, uhs, &admin, "halle.png", &png_bytes(20, 20)).await;
    assert_eq!(
        s,
        StatusCode::SERVICE_UNAVAILABLE,
        "fail-closed + unerreichbarer clamd → 503"
    );
    assert_eq!(
        zaehle("SELECT COUNT(*) FROM uhs_plan WHERE einsatz_id = ?").await,
        0,
        "kein Plan"
    );
    assert_eq!(
        zaehle("SELECT COUNT(*) FROM etb_eintrag WHERE einsatz_id = ?").await,
        etb_vorher,
        "kein ETB-Eintrag"
    );
}
