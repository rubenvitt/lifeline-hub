//! Grenzen der öffentlichen Anmelde-Starts (LFH-919): Drossel je Quelle (429), volle
//! Zeremonie-Speicher (503) und die Längengrenze des OIDC-Ziel-Pfads.
//!
//! Eigenes Test-Binary: Drossel und Speicher sind prozessweit, und die Tests setzen die
//! Obergrenze herab. Innerhalb des Binaries laufen sie nacheinander ([`NACHEINANDER`]).

use axum::body::{to_bytes, Body};
use axum::extract::ConnectInfo;
use axum::http::{header, Request, StatusCode};
use serde_json::Value;
use std::net::SocketAddr;
use std::sync::LazyLock;
use tokio::sync::{Mutex, MutexGuard};
use tower::ServiceExt;

mod common;
use common::setup;

static NACHEINANDER: Mutex<()> = Mutex::const_new(());

async fn aufbau() -> (MutexGuard<'static, ()>, axum::Router) {
    let reihe = NACHEINANDER.lock().await;
    webauthn_aktivieren();
    oidc_aktivieren();
    (reihe, setup().await)
}

fn webauthn_aktivieren() {
    lifeline_hub::auth::provider::registry::set_webauthn_konfiguriert(true);
    lifeline_hub::auth::webauthn::set_webauthn(
        lifeline_hub::auth::webauthn::baue("localhost", "https://localhost").unwrap(),
    );
}

/// Discovery eines IdP ohne Schlüssel und ohne Token-Endpoint: `oidc/start` braucht nur die
/// Autorisierungs-URL.
static IDP: LazyLock<String> = LazyLock::new(|| {
    let (tx, rx) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap()
            .block_on(async move {
                let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
                let basis = format!("http://{}", listener.local_addr().unwrap());
                tx.send(basis.clone()).unwrap();
                axum::serve(listener, mini_idp(basis)).await.unwrap();
            });
    });
    rx.recv().unwrap()
});

fn mini_idp(basis: String) -> axum::Router {
    use openidconnect::core::{
        CoreJsonWebKeySet, CoreJwsSigningAlgorithm, CoreProviderMetadata, CoreResponseType,
        CoreSubjectIdentifierType,
    };
    use openidconnect::{
        AuthUrl, EmptyAdditionalProviderMetadata, IssuerUrl, JsonWebKeySetUrl, ResponseTypes,
    };

    let metadata = serde_json::to_value(CoreProviderMetadata::new(
        IssuerUrl::new(basis.clone()).unwrap(),
        AuthUrl::new(format!("{basis}/authorize")).unwrap(),
        JsonWebKeySetUrl::new(format!("{basis}/jwks")).unwrap(),
        vec![ResponseTypes::new(vec![CoreResponseType::Code])],
        vec![CoreSubjectIdentifierType::Public],
        vec![CoreJwsSigningAlgorithm::RsaSsaPkcs1V15Sha256],
        EmptyAdditionalProviderMetadata {},
    ))
    .unwrap();
    let jwks = serde_json::to_value(CoreJsonWebKeySet::new(vec![])).unwrap();
    axum::Router::new()
        .route(
            "/.well-known/openid-configuration",
            axum::routing::get(move || async move { axum::Json(metadata) }),
        )
        .route(
            "/jwks",
            axum::routing::get(move || async move { axum::Json(jwks) }),
        )
}

fn oidc_aktivieren() {
    lifeline_hub::auth::provider::registry::set_oidc_konfiguriert(true);
    lifeline_hub::auth::oidc::init_oidc_settings(lifeline_hub::auth::oidc::OidcSettings {
        issuer: Some(IDP.clone()),
        client_id: Some("lifeline-test".to_string()),
        client_secret: Some(lifeline_hub::config::GeheimesPasswort("geheim".to_string())),
        redirect_url: Some("http://localhost/api/auth/oidc/callback".to_string()),
    });
}

struct Antwort {
    status: StatusCode,
    set_cookie: Vec<String>,
    body: Value,
}

/// Anfrage ohne Sitzung, optional von einer Quelladresse (ohne Adresse greift die Drossel nicht).
async fn sende(
    app: &axum::Router,
    methode: &str,
    uri: &str,
    body: Option<&str>,
    quelle: Option<&str>,
) -> Antwort {
    let mut req = Request::builder().method(methode).uri(uri);
    if body.is_some() {
        req = req.header(header::CONTENT_TYPE, "application/json");
    }
    let mut req = req
        .body(body.map_or_else(Body::empty, |b| Body::from(b.to_string())))
        .unwrap();
    if let Some(q) = quelle {
        let adresse: SocketAddr = q.parse().unwrap();
        req.extensions_mut().insert(ConnectInfo(adresse));
    }
    let resp = app.clone().oneshot(req).await.unwrap();
    let status = resp.status();
    let set_cookie = resp
        .headers()
        .get_all(header::SET_COOKIE)
        .iter()
        .map(|v| v.to_str().unwrap().split(';').next().unwrap().to_string())
        .collect();
    let bytes = to_bytes(resp.into_body(), usize::MAX).await.unwrap();
    Antwort {
        status,
        set_cookie,
        body: serde_json::from_slice(&bytes).unwrap_or(Value::Null),
    }
}

const DISCOVERABLE: &str = "/api/auth/webauthn/discoverable/start";

#[tokio::test]
async fn discoverable_start_wird_je_quelle_gedrosselt() {
    let (_reihe, app) = aufbau().await;
    let quelle = "192.0.2.10:40000";
    for n in 0..lifeline_hub::auth::start_drossel::MAX_STARTS {
        let a = sende(&app, "POST", DISCOVERABLE, None, Some(quelle)).await;
        assert_eq!(a.status, StatusCode::OK, "Start {n}: {:?}", a.body);
    }
    let a = sende(&app, "POST", DISCOVERABLE, None, Some(quelle)).await;
    assert_eq!(a.status, StatusCode::TOO_MANY_REQUESTS, "{:?}", a.body);
    assert!(a.set_cookie.is_empty(), "keine Zeremonie, kein Cookie");

    let andere = sende(&app, "POST", DISCOVERABLE, None, Some("192.0.2.11:40000")).await;
    assert_eq!(andere.status, StatusCode::OK, "andere Quellen bleiben frei");
}

/// Auch der benutzergebundene Start zählt, schon bevor er den Namen nachschlägt.
#[tokio::test]
async fn auth_start_wird_je_quelle_gedrosselt() {
    let (_reihe, app) = aufbau().await;
    let quelle = "192.0.2.20:40000";
    let body = r#"{"benutzername":"niemand"}"#;
    for _ in 0..lifeline_hub::auth::start_drossel::MAX_STARTS {
        let a = sende(
            &app,
            "POST",
            "/api/auth/webauthn/auth/start",
            Some(body),
            Some(quelle),
        )
        .await;
        assert_eq!(a.status, StatusCode::UNAUTHORIZED, "{:?}", a.body);
    }
    let a = sende(
        &app,
        "POST",
        "/api/auth/webauthn/auth/start",
        Some(body),
        Some(quelle),
    )
    .await;
    assert_eq!(a.status, StatusCode::TOO_MANY_REQUESTS, "{:?}", a.body);
}

#[tokio::test]
async fn oidc_start_wird_je_quelle_gedrosselt() {
    let (_reihe, app) = aufbau().await;
    let quelle = "192.0.2.30:40000";
    for n in 0..lifeline_hub::auth::start_drossel::MAX_STARTS {
        let a = sende(&app, "GET", "/api/auth/oidc/start", None, Some(quelle)).await;
        assert_eq!(a.status, StatusCode::SEE_OTHER, "Start {n}: {:?}", a.body);
    }
    let a = sende(&app, "GET", "/api/auth/oidc/start", None, Some(quelle)).await;
    assert_eq!(a.status, StatusCode::TOO_MANY_REQUESTS, "{:?}", a.body);
}

/// Ist der Speicher voll, entsteht keine Zeremonie: 503, kein Cookie.
#[tokio::test]
async fn voller_webauthn_speicher_ist_503() {
    let (_reihe, app) = aufbau().await;
    lifeline_hub::auth::webauthn::state::platz_fuer_tests(Some(2));
    let mut status = Vec::new();
    let mut cookies = Vec::new();
    for _ in 0..3 {
        let a = sende(&app, "POST", DISCOVERABLE, None, None).await;
        status.push(a.status);
        cookies.push(a.set_cookie.len());
    }
    lifeline_hub::auth::webauthn::state::platz_fuer_tests(None);

    assert_eq!(
        status,
        [
            StatusCode::OK,
            StatusCode::OK,
            StatusCode::SERVICE_UNAVAILABLE
        ]
    );
    assert_eq!(cookies, [1, 1, 0]);
}

#[tokio::test]
async fn voller_oidc_speicher_ist_503() {
    let (_reihe, app) = aufbau().await;
    lifeline_hub::auth::oidc::state::platz_fuer_tests(Some(1));
    let erster = sende(&app, "GET", "/api/auth/oidc/start", None, None).await;
    let zweiter = sende(&app, "GET", "/api/auth/oidc/start", None, None).await;
    lifeline_hub::auth::oidc::state::platz_fuer_tests(None);

    assert_eq!(erster.status, StatusCode::SEE_OTHER, "{:?}", erster.body);
    assert_eq!(
        zweiter.status,
        StatusCode::SERVICE_UNAVAILABLE,
        "{:?}",
        zweiter.body
    );
    assert!(
        zweiter.set_cookie.is_empty(),
        "kein Binding-Cookie ohne State"
    );
}

/// Ein überlanges `?von=` landet nicht im State-Speicher (LFH-919).
#[tokio::test]
async fn ueberlanges_von_wird_nicht_gespeichert() {
    let (_reihe, app) = aufbau().await;
    let von = format!("/{}", "a".repeat(8 * 1024));
    let a = sende(
        &app,
        "GET",
        &format!("/api/auth/oidc/start?von={von}"),
        None,
        None,
    )
    .await;
    assert_eq!(a.status, StatusCode::SEE_OTHER, "{:?}", a.body);
    let state = a
        .set_cookie
        .iter()
        .find_map(|c| c.strip_prefix("oidc_state="))
        .expect("Binding-Cookie");
    let eintrag = lifeline_hub::auth::oidc::state::entnehme(state).expect("State gespeichert");
    assert_eq!(eintrag.ziel_pfad, "/einsaetze");
}
