//! Öffentliche API v1: Dokument, Body-Grenze und Montage (LLH-1653, Spec
//! `oeffentliche-api-vertrag`). Die Fehlerform prüft `tests/fehler_vertrag.rs`.

mod common;

use axum::body::{to_bytes, Body};
use axum::http::{header, Request, StatusCode};
use axum::routing::post;
use lifeline_hub::extract::JsonBody;
use lifeline_hub::public_api;
use serde_json::Value;
use tower::ServiceExt;
use utoipa_axum::router::OpenApiRouter;

async fn json(resp: axum::response::Response) -> Value {
    let bytes = to_bytes(resp.into_body(), usize::MAX).await.unwrap();
    serde_json::from_slice(&bytes).unwrap()
}

#[tokio::test]
async fn dokument_ist_ohne_anmeldung_abrufbar() {
    let app = common::setup().await;
    let resp = app
        .oneshot(
            Request::builder()
                .uri("/api/v1/openapi.json")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    assert_eq!(
        resp.headers()
            .get(header::CACHE_CONTROL)
            .and_then(|v| v.to_str().ok()),
        Some("no-store")
    );
    let dok = json(resp).await;
    assert!(dok["openapi"].as_str().is_some_and(|v| v.starts_with('3')));
    assert!(
        dok["paths"]["/api/v1/openapi.json"]["get"].is_object(),
        "Dokument nennt seine eigene Route nicht: {}",
        dok["paths"]
    );
    let beschreibung = dok["info"]["description"].as_str().unwrap();
    for teil in [
        "Stabilitätszusage",
        "UTC",
        "fuehrung_elsewhere",
        "`/api/v2/`",
    ] {
        assert!(beschreibung.contains(teil), "Beschreibung ohne {teil}");
    }
}

/// Jeder Pfad im Dokument liegt unter `/api/v1/`.
#[test]
fn dokument_kennt_nur_v1_pfade() {
    for pfad in public_api::dokument().paths.paths.keys() {
        assert!(public_api::ist_v1(pfad), "Pfad außerhalb von v1: {pfad}");
    }
}

/// Eine Route unter `/api/v1/` entsteht nur über `public_api::router()` mit `routes!`; so steht
/// sie im Dokument. `.route(…)` am `OpenApiRouter` und ein `/api/v1`-Pfad in `src/app.rs`
/// legten eine Route ohne Eintrag an.
#[test]
fn v1_routen_entstehen_nur_mit_dokumenteintrag() {
    let mut verstoesse = Vec::new();
    for eintrag in std::fs::read_dir("src/public_api").unwrap() {
        let pfad = eintrag.unwrap().path();
        if pfad.extension().is_some_and(|e| e == "rs") {
            let text = std::fs::read_to_string(&pfad).unwrap();
            for nadel in [".route(", ".route_service(", ".nest_service("] {
                if text.contains(nadel) {
                    verstoesse.push(format!("{}: {nadel}", pfad.display()));
                }
            }
        }
    }
    let app = std::fs::read_to_string("src/app.rs").unwrap();
    // Nur der Produktionsteil; die Tests in `app.rs` bauen eigene Router.
    let produktion = app.split("#[cfg(test)]").next().unwrap();
    if produktion.contains("\"/api/v1") {
        verstoesse.push("src/app.rs registriert einen /api/v1-Pfad selbst".into());
    }
    assert!(
        verstoesse.is_empty(),
        "v1-Route ohne Dokumenteintrag möglich:\n{}",
        verstoesse.join("\n")
    );
}

/// Probe-Router wie in `app.rs`: v1-Route über `montieren`, Schicht außen. Bis LLH-1652 hat die
/// öffentliche API keine Route mit Body, deshalb eine Proberoute.
fn probe() -> axum::Router {
    let v1 = OpenApiRouter::<()>::new().route(
        "/api/v1/probe",
        post(|JsonBody(_): JsonBody<Value>| async { StatusCode::NO_CONTENT }),
    );
    public_api::montieren(v1).layer(axum::middleware::from_fn(public_api::schicht))
}

/// Ein JSON-Body von genau `laenge` Bytes.
fn body_der_laenge(laenge: usize) -> String {
    let rahmen = r#"{"x":""}"#.len();
    format!(r#"{{"x":"{}"}}"#, "a".repeat(laenge - rahmen))
}

async fn sende(body: String) -> axum::response::Response {
    probe()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/v1/probe")
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(body))
                .unwrap(),
        )
        .await
        .unwrap()
}

#[tokio::test]
async fn body_bis_64_kib_wird_angenommen() {
    let body = body_der_laenge(lifeline_hub::app::PUBLIC_API_BODY_MAX);
    assert_eq!(body.len(), 64 * 1024);
    assert_eq!(sende(body).await.status(), StatusCode::NO_CONTENT);
}

#[tokio::test]
async fn body_ueber_64_kib_ist_413_payload_too_large() {
    let resp = sende(body_der_laenge(64 * 1024 + 1)).await;
    assert_eq!(resp.status(), StatusCode::PAYLOAD_TOO_LARGE);
    assert_eq!(json(resp).await["code"], "payload_too_large");
}

#[tokio::test]
async fn kaputtes_json_ist_400_invalid_field() {
    let resp = sende(r#"{kaputt"#.into()).await;
    assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
    let body = json(resp).await;
    assert_eq!(body["code"], "invalid_field");
    assert!(body["error"].as_str().is_some_and(|t| !t.is_empty()));
}
