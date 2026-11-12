//! Helfer für signierte Aufrufe eines Fremdsystems unter `/api/v1/` (LLH-1652): Anbindung
//! anlegen, Code einlösen, signieren und senden. Genutzt von `tests/maschinenzugang.rs` und
//! `tests/rechner_api.rs`.

use axum::body::{to_bytes, Body};
use axum::extract::ConnectInfo;
use axum::http::{Request, StatusCode};
use ed25519_dalek::SigningKey;
use lifeline_machine_client::{finish_redeem, prepare_redeem, Credentials, RedeemResponse};
use serde_json::{json, Value};
use std::net::SocketAddr;
use tower::ServiceExt;

pub fn schluessel(n: u8) -> SigningKey {
    SigningKey::from_bytes(&[n; 32])
}

pub async fn senden(
    app: &axum::Router,
    methode: &str,
    pfad: &str,
    kopf: Option<(&str, String)>,
    body: Vec<u8>,
    ip: &str,
) -> (StatusCode, axum::http::HeaderMap, Vec<u8>) {
    let mut req = Request::builder().method(methode).uri(pfad);
    if let Some((name, wert)) = kopf {
        req = req.header(name, wert);
    }
    if !body.is_empty() {
        req = req.header("content-type", "application/json");
    }
    let mut req = req.body(Body::from(body)).unwrap();
    req.extensions_mut().insert(ConnectInfo::<SocketAddr>(
        format!("{ip}:4000").parse().unwrap(),
    ));
    let resp = app.clone().oneshot(req).await.unwrap();
    let status = resp.status();
    let headers = resp.headers().clone();
    let bytes = to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap()
        .to_vec();
    (status, headers, bytes)
}

/// Löst `code` mit `key` ein; liefert Status und, bei Erfolg, die Zugangsdaten.
pub async fn einloesen(
    app: &axum::Router,
    code: &str,
    key: &SigningKey,
    ip: &str,
) -> (StatusCode, Option<Credentials>) {
    let (d, anfrage) = prepare_redeem(code, key).unwrap();
    let (s, _, bytes) = senden(
        app,
        "POST",
        "/api/v1/zugang/redeem",
        None,
        serde_json::to_vec(&anfrage).unwrap(),
        ip,
    )
    .await;
    if s != StatusCode::OK {
        return (s, None);
    }
    let antwort: RedeemResponse = serde_json::from_slice(&bytes).unwrap();
    (
        s,
        Some(finish_redeem(&d, key, "http://test", &antwort).unwrap()),
    )
}

pub fn jetzt() -> i64 {
    chrono::Utc::now().timestamp()
}

/// Signiert und sendet ohne Body; liefert Status, Köpfe und Body als JSON.
pub async fn signiert(
    app: &axum::Router,
    cred: &Credentials,
    methode: &str,
    pfad: &str,
    iat: i64,
    jti: &str,
    ip: &str,
) -> (StatusCode, axum::http::HeaderMap, Value) {
    signiert_mit_body(app, cred, methode, pfad, vec![], iat, jti, ip).await
}

/// Signiert über `body` und sendet ihn; liefert Status, Köpfe und Body als JSON.
#[allow(clippy::too_many_arguments)]
pub async fn signiert_mit_body(
    app: &axum::Router,
    cred: &Credentials,
    methode: &str,
    pfad: &str,
    body: Vec<u8>,
    iat: i64,
    jti: &str,
    ip: &str,
) -> (StatusCode, axum::http::HeaderMap, Value) {
    let auth = cred.sign_request(methode, pfad, &body, iat, jti).unwrap();
    let (s, h, b) = senden(app, methode, pfad, Some(("authorization", auth)), body, ip).await;
    (s, h, serde_json::from_slice(&b).unwrap_or(Value::Null))
}

/// Legt als `admin` eine Anbindung mit `scopes` an und löst ihren Code ein.
pub async fn angebunden(
    app: &axum::Router,
    admin: &str,
    scopes: Value,
    key: &SigningKey,
    ip: &str,
) -> Credentials {
    let (s, v) = super::anfrage_json(
        app,
        "POST",
        "/api/admin/anbindungen",
        admin,
        Some(&json!({ "name": "Fremdsystem", "scopes": scopes })),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{v}");
    let (s, cred) = einloesen(app, v["code"].as_str().unwrap(), key, ip).await;
    assert_eq!(s, StatusCode::OK);
    cred.unwrap()
}
