//! OIDC-Start bei einem stummen IdP (LFH-923): Eine Welle paralleler `GET /api/auth/oidc/start`
//! löst höchstens einen Discovery-Netzversuch aus, und jede Anfrage antwortet binnen 3 s mit dem
//! Fehler-Redirect, statt bis zum Anfrage-Budget einen Zulassungsplatz zu belegen.
//!
//! Eigenes Test-Binary: Der Discovery-Cache und die OIDC-Einstellungen sind prozessweit.

use axum::body::Body;
use axum::http::{header, Request, StatusCode};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tower::ServiceExt;

mod common;
use common::setup;

/// Ein IdP, der Verbindungen annimmt und nie antwortet; zählt die angenommenen Verbindungen.
async fn stummer_idp() -> (String, Arc<AtomicUsize>) {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let basis = format!("http://{}", listener.local_addr().unwrap());
    let verbindungen = Arc::new(AtomicUsize::new(0));
    let zaehler = verbindungen.clone();
    tokio::spawn(async move {
        let mut offen = Vec::new();
        while let Ok((sock, _)) = listener.accept().await {
            zaehler.fetch_add(1, Ordering::SeqCst);
            offen.push(sock);
        }
    });
    (basis, verbindungen)
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn welle_gegen_stummen_idp_endet_schnell_mit_einem_netzversuch() {
    let (issuer, verbindungen) = stummer_idp().await;
    lifeline_hub::auth::provider::registry::set_oidc_konfiguriert(true);
    lifeline_hub::auth::oidc::init_oidc_settings(lifeline_hub::auth::oidc::OidcSettings {
        issuer: Some(issuer),
        client_id: Some("lifeline-test".to_string()),
        client_secret: Some(lifeline_hub::config::GeheimesPasswort("geheim".to_string())),
        redirect_url: Some("http://localhost/api/auth/oidc/callback".to_string()),
    });
    let app = setup().await;

    let anfragen = (0..50).map(|_| {
        let app = app.clone();
        tokio::spawn(async move {
            let beginn = Instant::now();
            let resp = app
                .oneshot(
                    Request::builder()
                        .uri("/api/auth/oidc/start")
                        .body(Body::empty())
                        .unwrap(),
                )
                .await
                .unwrap();
            let location = resp
                .headers()
                .get(header::LOCATION)
                .map(|v| v.to_str().unwrap().to_string());
            (resp.status(), location, beginn.elapsed())
        })
    });
    let antworten = futures::future::join_all(anfragen).await;

    for antwort in antworten {
        let (status, location, dauer) = antwort.unwrap();
        assert_eq!(status, StatusCode::SEE_OTHER);
        assert_eq!(location.as_deref(), Some("/login?fehler=oidc"));
        assert!(dauer <= Duration::from_secs(3), "{dauer:?}");
    }
    assert!(
        verbindungen.load(Ordering::SeqCst) <= 1,
        "höchstens ein Discovery-Netzversuch, waren {}",
        verbindungen.load(Ordering::SeqCst)
    );
}
