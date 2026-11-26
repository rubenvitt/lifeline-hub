//! Bedingter Abruf einer Fremdebene gegen einen echten HTTPS-Server (LLH-2132).
//!
//! Der Produktivweg erreicht kein lokales Ziel (Loopback ist in Vorprüfung und Resolver
//! gesperrt). Der Testclient baut deshalb auf denselben Schutzeinstellungen auf
//! ([`protected_client_builder`]) und legt nur zwei Dinge darüber: einen festen DNS-Eintrag für
//! [`NAME`] auf den lokalen Server und den Fingerabdruck des Testzertifikats als
//! Vertrauensanker. Weiterleitung, Größengrenze und Zeitlimit prüft also der echte Client.

use std::net::SocketAddr;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Mutex;

use axum::http::{HeaderMap as AxumKoepfe, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::get;

use super::*;
use crate::instanz::identitaet::tls_fingerabdruck_pem;
use crate::instanz::zertifikat::tls_config;

/// Ein Name, den `check_url` durchlässt und der nur über den Eintrag im Testclient auflöst.
const NAME: &str = "fremdebene.test";
const ETAG_V1: &str = "\"v1\"";
const LAST_MOD: &str = "Wed, 21 Oct 2026 07:28:00 GMT";
const INHALT: &str = r#"{"type":"FeatureCollection","features":[]}"#;
const DECKEL: usize = 1024;

/// Was der Server gesehen hat.
#[derive(Default)]
struct Gesehen {
    /// `If-None-Match` je Anfrage an `/lage` (`None`: ohne Kopf).
    if_none_match: Mutex<Vec<Option<String>>>,
    /// Anfragen an das Ziel der Weiterleitung.
    ziel: AtomicUsize,
}

struct Gegenstelle {
    adresse: SocketAddr,
    fingerabdruck: String,
    gesehen: Arc<Gesehen>,
}

impl Gegenstelle {
    fn url(&self, pfad: &str) -> String {
        format!("https://{NAME}:{}{pfad}", self.adresse.port())
    }

    /// Der Adapter-Client mit allen Schutzeinstellungen, nur [`NAME`] zeigt auf den Server.
    fn client(&self, zeitlimit: Duration) -> reqwest::Client {
        protected_client_builder(false)
            .resolve(NAME, self.adresse)
            .tls_backend_preconfigured(tls_config(Some(self.fingerabdruck.clone())).unwrap())
            .timeout(zeitlimit)
            .build()
            .unwrap()
    }
}

async fn lage(gesehen: Arc<Gesehen>, koepfe: AxumKoepfe) -> Response {
    let inm = koepfe
        .get("if-none-match")
        .and_then(|w| w.to_str().ok())
        .map(str::to_string);
    gesehen.if_none_match.lock().unwrap().push(inm.clone());
    if inm.as_deref() == Some(ETAG_V1) {
        return (StatusCode::NOT_MODIFIED, [("etag", ETAG_V1)]).into_response();
    }
    ([("etag", ETAG_V1), ("last-modified", LAST_MOD)], INHALT).into_response()
}

async fn gegenstelle() -> Gegenstelle {
    let (cert, key) = crate::tls::rcgen_pem(&[NAME.to_string()]).unwrap();
    let fingerabdruck = tls_fingerabdruck_pem(cert.as_bytes()).unwrap();
    let config =
        axum_server::tls_rustls::RustlsConfig::from_pem(cert.into_bytes(), key.into_bytes())
            .await
            .unwrap();
    let lauscher = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    lauscher.set_nonblocking(true).unwrap();
    let adresse = lauscher.local_addr().unwrap();
    let gesehen = Arc::new(Gesehen::default());
    let (g_lage, g_ziel) = (gesehen.clone(), gesehen.clone());
    let app = axum::Router::new()
        .route(
            "/lage",
            get(move |koepfe: AxumKoepfe| lage(g_lage.clone(), koepfe)),
        )
        .route(
            "/weiter",
            get(|| async { (StatusCode::MOVED_PERMANENTLY, [("location", "/ziel")]) }),
        )
        .route(
            "/ziel",
            get(move || {
                g_ziel.ziel.fetch_add(1, Ordering::SeqCst);
                async { INHALT }
            }),
        )
        .route("/gross", get(|| async { "x".repeat(DECKEL * 4) }))
        .route(
            "/langsam",
            get(|| async {
                tokio::time::sleep(Duration::from_secs(5)).await;
                INHALT
            }),
        );
    tokio::spawn(async move {
        axum_server::from_tcp_rustls(lauscher, config)
            .unwrap()
            .serve(app.into_make_service())
            .await
            .unwrap();
    });
    Gegenstelle {
        adresse,
        fingerabdruck,
        gesehen,
    }
}

async fn abrufen(
    g: &Gegenstelle,
    pfad: &str,
    etag: Option<&str>,
    zeitlimit: Duration,
) -> Result<BedingteAntwort, FremdebeneFehler> {
    fetch_bedingt_via(
        &g.client(zeitlimit),
        &g.url(pfad),
        false,
        DECKEL,
        etag,
        None,
    )
    .await
}

const NORMAL: Duration = Duration::from_secs(10);

#[tokio::test]
async fn erster_abruf_liefert_inhalt_und_validatoren() {
    let g = gegenstelle().await;
    let a = abrufen(&g, "/lage", None, NORMAL).await.unwrap();
    assert_eq!(a.status, 200);
    assert_eq!(a.etag.as_deref(), Some(ETAG_V1));
    assert_eq!(a.last_modified.as_deref(), Some(LAST_MOD));
    assert_eq!(a.body.as_deref(), Some(INHALT.as_bytes()));
    assert_eq!(*g.gesehen.if_none_match.lock().unwrap(), vec![None]);
}

#[tokio::test]
async fn mit_etag_kommt_304_ohne_rumpf() {
    let g = gegenstelle().await;
    let a = abrufen(&g, "/lage", Some(ETAG_V1), NORMAL).await.unwrap();
    assert_eq!(a.status, 304);
    assert_eq!(a.body, None);
    assert_eq!(a.etag.as_deref(), Some(ETAG_V1));
    assert_eq!(
        *g.gesehen.if_none_match.lock().unwrap(),
        vec![Some(ETAG_V1.to_string())]
    );
}

#[tokio::test]
async fn weiterleitung_wird_abgelehnt_und_nicht_verfolgt() {
    let g = gegenstelle().await;
    assert_eq!(
        abrufen(&g, "/weiter", None, NORMAL).await,
        Err(FremdebeneFehler::Weiterleitung)
    );
    assert_eq!(g.gesehen.ziel.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn zu_grosser_rumpf_scheitert_am_deckel() {
    let g = gegenstelle().await;
    assert_eq!(
        abrufen(&g, "/gross", None, NORMAL).await,
        Err(FremdebeneFehler::ZuGross)
    );
}

#[tokio::test]
async fn langsame_antwort_scheitert_am_zeitlimit() {
    let g = gegenstelle().await;
    assert_eq!(
        abrufen(&g, "/langsam", None, Duration::from_millis(300)).await,
        Err(FremdebeneFehler::Zeitlimit)
    );
}

/// Gegenprobe: Ohne den Eintrag im Testclient erreicht der Produktivclient den Server nicht.
#[tokio::test]
async fn produktivclient_erreicht_den_testserver_nicht() {
    let g = gegenstelle().await;
    assert_ne!(
        fetch_bedingt(&g.url("/lage"), true, DECKEL, None, None)
            .await
            .map(|a| a.status),
        Ok(200)
    );
    assert!(g.gesehen.if_none_match.lock().unwrap().is_empty());
}
