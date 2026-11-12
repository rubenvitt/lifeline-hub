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
    for path in public_api::openapi().paths.paths.keys() {
        assert!(public_api::is_v1(path), "Pfad außerhalb von v1: {path}");
    }
}

/// Alle `.rs`-Dateien unter `dir`, auch in Unterordnern.
fn rust_files(dir: &std::path::Path) -> Vec<std::path::PathBuf> {
    let mut files = Vec::new();
    for entry in std::fs::read_dir(dir).unwrap() {
        let path = entry.unwrap().path();
        if path.is_dir() {
            files.extend(rust_files(&path));
        } else if path.extension().is_some_and(|e| e == "rs") {
            files.push(path);
        }
    }
    files
}

/// Der Produktionsteil von `src/app.rs`; die Tests darin bauen eigene Router.
fn app_production_code() -> String {
    let app = std::fs::read_to_string("src/app.rs").unwrap();
    app.split("#[cfg(test)]").next().unwrap().to_string()
}

/// Eine Route unter `/api/v1/` entsteht nur über `public_api::router()` mit `routes!`; so steht
/// sie im Dokument. `.route(…)` am `OpenApiRouter` und ein `/api/v1`-Pfad in `src/app.rs`
/// legten eine Route ohne Eintrag an.
#[test]
fn v1_routen_entstehen_nur_mit_dokumenteintrag() {
    let files = rust_files(std::path::Path::new("src/public_api"));
    assert!(files.len() >= 2, "src/public_api nicht gefunden");
    let mut violations = Vec::new();
    for path in files {
        let text = std::fs::read_to_string(&path).unwrap();
        for needle in [".route(", ".route_service(", ".nest_service("] {
            if text.contains(needle) {
                violations.push(format!("{}: {needle}", path.display()));
            }
        }
    }
    if app_production_code().contains("\"/api/v1") {
        violations.push("src/app.rs registriert einen /api/v1-Pfad selbst".into());
    }
    assert!(
        violations.is_empty(),
        "v1-Route ohne Dokumenteintrag möglich:\n{}",
        violations.join("\n")
    );
}

/// Die äußere Schicht liegt in `build_router_mit` außerhalb von Kompression, CatchPanic und
/// Zulassung (`.layer()` hängt nach außen, also später im Text): nur so bekommen Panik-500 und
/// Lastabwurf-503 einen Code (design.md D2). Den Router mit Panik und Lastabwurf baut der Test
/// `app::tests::panik_und_lastabwurf_unter_v1_tragen_code` in derselben Reihenfolge nach.
#[test]
fn die_vertragsschicht_liegt_ausserhalb_von_zulassung_und_catch_panic() {
    let app = app_production_code();
    let position = |needle: &str| {
        app.find(needle)
            .unwrap_or_else(|| panic!("src/app.rs montiert {needle} nicht"))
    };
    let contract = position("crate::public_api::contract_layer");
    for inner in [
        "CompressionLayer::new()",
        "CatchPanicLayer::custom(on_panic)",
        "crate::zulassung::zulassung",
    ] {
        assert!(
            position(inner) < contract,
            "contract_layer liegt innerhalb von {inner}"
        );
    }
    assert!(
        position("crate::public_api::mount(") < contract,
        "die v1-Routen sind nicht eingehängt"
    );
}

/// Ein Body über 64 KiB scheitert an jeder v1-Route vor dem Handler, auch an einer, die den Body
/// gar nicht liest, und am echten Router.
#[tokio::test]
async fn body_ueber_64_kib_scheitert_auch_an_einer_route_ohne_body() {
    let app = common::setup().await;
    let body = "a".repeat(64 * 1024 + 1);
    let resp = app
        .oneshot(
            Request::builder()
                .uri("/api/v1/openapi.json")
                .header(header::CONTENT_LENGTH, body.len())
                .body(Body::from(body))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::PAYLOAD_TOO_LARGE);
    assert_eq!(
        resp.headers()
            .get(header::CACHE_CONTROL)
            .and_then(|v| v.to_str().ok()),
        Some("no-store")
    );
    assert_eq!(json(resp).await["code"], "payload_too_large");
}

/// Dasselbe ohne `Content-Length` (chunked, HTTP/2): die Grenze greift beim Puffern, weiterhin
/// vor dem Handler.
#[tokio::test]
async fn body_ueber_64_kib_ohne_content_length_scheitert_vor_dem_handler() {
    let app = common::setup().await;
    let chunks = (0..65).map(|_| Ok::<_, std::io::Error>(vec![b'a'; 1024]));
    let resp = app
        .oneshot(
            Request::builder()
                .uri("/api/v1/openapi.json")
                .body(Body::from_stream(futures::stream::iter(chunks)))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::PAYLOAD_TOO_LARGE);
    assert_eq!(json(resp).await["code"], "payload_too_large");
}

/// Jede Operation im Dokument nennt die Fehlerantwort (`default` mit `ApiErrorBody`,
/// `src/AGENTS.md`, „Öffentliche API v1“).
#[test]
fn jede_operation_nennt_die_fehlerantwort() {
    let document = serde_json::to_value(public_api::openapi()).unwrap();
    let mut missing = Vec::new();
    for (path, item) in document["paths"].as_object().unwrap() {
        for (method, operation) in item.as_object().unwrap() {
            let schema =
                &operation["responses"]["default"]["content"]["application/json"]["schema"]["$ref"];
            if schema != "#/components/schemas/ApiErrorBody" {
                missing.push(format!("{method} {path}"));
            }
        }
    }
    assert!(
        missing.is_empty(),
        "ohne Fehlerantwort im Dokument: {missing:?}"
    );
}

#[derive(serde::Deserialize)]
#[allow(dead_code)]
struct Number {
    x: u32,
}

/// v1-Routen über `public_api::mount` wie in `app.rs`, mit der Antwortkompression darum. Bis
/// LLH-1652 hat die öffentliche API keine Route mit Body, deshalb Proberouten.
fn probe_router() -> axum::Router {
    let v1 = OpenApiRouter::<()>::new()
        .route(
            "/api/v1/probe",
            post(|JsonBody(_): JsonBody<Value>| async { StatusCode::NO_CONTENT }),
        )
        .route(
            "/api/v1/number",
            post(|JsonBody(_): JsonBody<Number>| async { StatusCode::NO_CONTENT }),
        );
    public_api::mount(v1).layer(tower_http::compression::CompressionLayer::new())
}

/// Ein JSON-Body von genau `length` Bytes.
fn body_of_length(length: usize) -> String {
    let frame = r#"{"x":""}"#.len();
    format!(r#"{{"x":"{}"}}"#, "a".repeat(length - frame))
}

async fn send(uri: &str, body: String) -> axum::response::Response {
    probe_router()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(uri)
                .header(header::CONTENT_TYPE, "application/json")
                .header(header::ACCEPT_ENCODING, "gzip")
                .body(Body::from(body))
                .unwrap(),
        )
        .await
        .unwrap()
}

/// Liest den Body, entpackt ihn, falls er gzip-gepackt ist.
async fn json_unpacked(resp: axum::response::Response) -> Value {
    let gzip = resp
        .headers()
        .get(header::CONTENT_ENCODING)
        .is_some_and(|v| v == "gzip");
    let bytes = to_bytes(resp.into_body(), usize::MAX).await.unwrap();
    let bytes = if gzip {
        use std::io::Read;
        let mut out = Vec::new();
        flate2::read::GzDecoder::new(&bytes[..])
            .read_to_end(&mut out)
            .unwrap();
        out
    } else {
        bytes.to_vec()
    };
    serde_json::from_slice(&bytes).unwrap()
}

#[tokio::test]
async fn body_bis_64_kib_wird_angenommen() {
    let body = body_of_length(lifeline_hub::app::PUBLIC_API_BODY_MAX);
    assert_eq!(body.len(), 64 * 1024);
    assert_eq!(
        send("/api/v1/probe", body).await.status(),
        StatusCode::NO_CONTENT
    );
}

#[tokio::test]
async fn body_ueber_64_kib_ist_413_payload_too_large() {
    let resp = send("/api/v1/probe", body_of_length(64 * 1024 + 1)).await;
    assert_eq!(resp.status(), StatusCode::PAYLOAD_TOO_LARGE);
    assert_eq!(json_unpacked(resp).await["code"], "payload_too_large");
}

#[tokio::test]
async fn kaputtes_json_ist_400_invalid_field() {
    let resp = send("/api/v1/probe", r#"{kaputt"#.into()).await;
    assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
    let body = json_unpacked(resp).await;
    assert_eq!(body["code"], "invalid_field");
    assert!(body["error"].as_str().is_some_and(|t| !t.is_empty()));
}

/// Eine Ablehnung, die die Eingabe zurückgibt, ist lang genug zum Packen. Der Code kommt vorher
/// dazu und steht auch im gepackten Body.
#[tokio::test]
async fn langer_fehler_body_wird_gepackt_und_traegt_code() {
    let resp = send(
        "/api/v1/number",
        format!(r#"{{"x":"{}"}}"#, "a".repeat(2000)),
    )
    .await;
    assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
    assert_eq!(
        resp.headers()
            .get(header::CONTENT_ENCODING)
            .and_then(|v| v.to_str().ok()),
        Some("gzip"),
        "die Probe soll den gepackten Fall treffen"
    );
    let body = json_unpacked(resp).await;
    assert_eq!(body["code"], "invalid_field", "{body}");
}
