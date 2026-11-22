//! Fingerabdruck am Webhook (LLH-1872, Design-Doc
//! `docs/superpowers/specs/2026-11-22-wx6bfsmc-webhook-zertifikat-pin-design.md`, D2–D4).

use super::*;
use crate::instanz::zertifikat::tests::gegenstelle_mit_zaehler;
use crate::instanz::zertifikat::tls_config;

const PIN: &str = "ab12cd34ef56ab12cd34ef56ab12cd34ef56ab12cd34ef56ab12cd34ef56ab12";

#[test]
fn normalize_pin_nimmt_schreibweisen_an() {
    let gross_mit_doppelpunkten = PIN
        .to_ascii_uppercase()
        .as_bytes()
        .chunks(2)
        .map(|c| std::str::from_utf8(c).unwrap())
        .collect::<Vec<_>>()
        .join(":");
    let mit_leerzeichen = format!(" {} {} ", &PIN[..32], &PIN[32..]);
    for roh in [PIN.to_string(), gross_mit_doppelpunkten, mit_leerzeichen] {
        assert_eq!(normalize_pin(&roh), Ok(Some(PIN.to_string())), "{roh}");
    }
    assert_eq!(normalize_pin(""), Ok(None));
    assert_eq!(normalize_pin("   "), Ok(None));
    assert!(normalize_pin(&PIN[..63]).is_err());
    assert!(normalize_pin(&format!("{PIN}a")).is_err());
    assert!(normalize_pin(&"z".repeat(64)).is_err());
}

/// Akzeptanzkriterium: ein anderes Zertifikat als das hinterlegte scheitert mit `tls`.
#[tokio::test]
async fn pin_passt_nicht_ist_tls() {
    let (adresse, _, zaehler) = gegenstelle_mit_zaehler().await;
    let e = reqwest::Client::builder()
        .tls_backend_preconfigured(tls_config(Some(PIN.to_string())).unwrap())
        .build()
        .unwrap()
        .post(format!("{adresse}/hook"))
        .body("{}")
        .send()
        .await
        .unwrap_err();
    assert_eq!(fehler_art(&e), WebhookFehler::Tls);
    assert_eq!(zaehler.load(std::sync::atomic::Ordering::SeqCst), 0);
}

/// Der Pin ändert nichts am Zielschutz: Loopback bleibt gesperrt.
#[tokio::test]
async fn gepinnter_client_lehnt_loopback_ab() {
    let lauscher = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = lauscher.local_addr().unwrap().port();
    let fehler = client(true, Some(PIN))
        .unwrap()
        .post(format!("https://localhost:{port}/hook"))
        .send()
        .await
        .expect_err("darf nicht verbinden");
    assert_eq!(fehler_art(&fehler), WebhookFehler::ZielIntern);
    let angenommen =
        tokio::time::timeout(std::time::Duration::from_millis(200), lauscher.accept()).await;
    assert!(angenommen.is_err(), "keine Verbindung erwartet");
}

#[tokio::test]
async fn hole_fingerabdruck_internes_ziel() {
    assert_eq!(
        hole_fingerabdruck("https://127.0.0.1/", true).await,
        Err(WebhookFehler::ZielIntern)
    );
    assert_eq!(
        hole_fingerabdruck("http://empfaenger.example/", false).await,
        Err(WebhookFehler::ZielUngueltig)
    );
}
