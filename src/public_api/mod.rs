//! Öffentliche API v1 für Fremdsysteme (LLH-1653, ADR-0022, Konzept
//! `docs/konzepte/2026-11-11-oeffentliche-api.md`, Spec `oeffentliche-api-vertrag`).
//!
//! Alles unter `/api/v1/` entsteht hier, und nur hier:
//!
//! - Eine Route kommt per `.routes(routes!(handler))` in [`router`]; der Handler trägt
//!   `#[utoipa::path]`. So steht jede Route im Dokument (`GET /api/v1/openapi.json`, versioniert
//!   als `docs/api/public-v1.json`, Drift-Test `tests/public_api_spec_aktuell.rs`).
//! - v1-Handler antworten im Fehlerfall mit [`ApiError`]. Alles andere unter `/api/v1/` bekommt
//!   seinen `code` und `Cache-Control: no-store` von der Schicht [`schicht`].
//! - v1-Typen sind eigene Schemas in [`PublicApiDoc`], nie solche aus `crate::api_doc` (die
//!   interne API hat keine Zusage).
//!
//! Regeln: `src/AGENTS.md`, „Öffentliche API v1“.

pub mod error;

use std::sync::OnceLock;

use axum::body::{to_bytes, Body};
use axum::extract::{DefaultBodyLimit, Request};
use axum::http::{header, HeaderValue};
use axum::middleware::Next;
use axum::response::{IntoResponse, Response};
use axum::{Json, Router};
use utoipa::OpenApi;
use utoipa_axum::router::OpenApiRouter;
use utoipa_axum::routes;

pub use error::{ApiError, ApiErrorBody, ErrorCode};

/// Präfix der öffentlichen API.
pub const PREFIX: &str = "/api/v1";

/// Kopf des Dokuments. `info.version` ist fest und erbt nicht die Crate-Version, aus demselben
/// Grund wie in `crate::api_doc`: `cargo set-version` schriebe das Dokument sonst bei jedem
/// Release um.
#[derive(OpenApi)]
#[openapi(
    info(
        title = "Lifeline Hub, öffentliche API",
        version = "1",
        description = include_str!("beschreibung.md"),
    ),
    components(schemas(ApiErrorBody, ErrorCode))
)]
pub struct PublicApiDoc;

/// Alle Routen der öffentlichen API samt Dokument. Neue Routen nur per `.routes(routes!(…))`.
/// Die einfache Routenmethode des `OpenApiRouter` legte eine Route ohne Dokumenteintrag an
/// (`tests/public_api.rs` verbietet sie hier).
pub fn router() -> OpenApiRouter<crate::app::AppState> {
    OpenApiRouter::with_openapi(PublicApiDoc::openapi()).routes(routes!(openapi_json))
}

/// Das fertige Dokument, einmal aus [`router`] gebaut.
pub fn dokument() -> &'static utoipa::openapi::OpenApi {
    static DOKUMENT: OnceLock<utoipa::openapi::OpenApi> = OnceLock::new();
    DOKUMENT.get_or_init(|| {
        let mut dokument = router().split_for_parts().1;
        // utoipa setzt aus `license-file` eine Lizenz ohne Namen; die sagt Fremdsystemen nichts.
        dokument.info.license = None;
        dokument
    })
}

/// Macht aus dem v1-Router den Router, den `crate::app` einhängt: mit der Body-Grenze der
/// öffentlichen API (`crate::app::PUBLIC_API_BODY_MAX`). Sie liegt innen und gilt deshalb vor
/// `JSON_BODY_MAX`. Generisch, damit Tests eine Proberoute ohne `AppState` montieren können.
pub fn montieren<S>(router: OpenApiRouter<S>) -> Router<S>
where
    S: Clone + Send + Sync + 'static,
{
    let (router, _) = router.split_for_parts();
    router.layer(DefaultBodyLimit::max(crate::app::PUBLIC_API_BODY_MAX))
}

/// Das OpenAPI-Dokument dieser API.
#[utoipa::path(
    get,
    path = "/api/v1/openapi.json",
    tag = "Vertrag",
    operation_id = "get_openapi",
    responses(
        (status = 200, description = "OpenAPI-Dokument (3.1) der öffentlichen API v1",
            content_type = "application/json", body = Object),
    ),
)]
async fn openapi_json() -> Response {
    Json(dokument()).into_response()
}

/// `true` für Pfade der öffentlichen API.
pub fn ist_v1(pfad: &str) -> bool {
    pfad == PREFIX
        || pfad
            .strip_prefix(PREFIX)
            .is_some_and(|rest| rest.starts_with('/'))
}

/// Höchstgröße eines Fehler-Bodys, den die Schicht liest. v1-Fehler sind kurz; ein größerer
/// Body wird durch den Vorgabetext ersetzt.
const FEHLER_BODY_MAX: usize = 64 * 1024;

/// Schicht für alles unter `/api/v1/` (design.md D2), montiert in `crate::app` außerhalb der
/// Zulassung, damit auch Panik-500 und Lastabwurf-503 sie durchlaufen:
///
/// - jede Antwort trägt `Cache-Control: no-store`;
/// - jede Fehlerantwort ohne `code` bekommt den Vorgabe-Code ihres Status
///   ([`ErrorCode::for_status`]); ein Body, der kein `{error}` ist, wird ersetzt.
///
/// Eine Antwort mit `code` (aus [`ApiError`]) bleibt, wie sie ist. Ein gepackter Body
/// (`Content-Encoding`) wird nicht angefasst; Fehler-Bodys liegen unter der Packgrenze.
pub async fn schicht(req: Request, next: Next) -> Response {
    if !ist_v1(req.uri().path()) {
        return next.run(req).await;
    }
    let mut resp = next.run(req).await;
    resp.headers_mut()
        .insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    let status = resp.status();
    if !(status.is_client_error() || status.is_server_error())
        || resp.headers().contains_key(header::CONTENT_ENCODING)
    {
        return resp;
    }

    let (mut parts, body) = resp.into_parts();
    let bytes = to_bytes(body, FEHLER_BODY_MAX).await.unwrap_or_default();
    let code = ErrorCode::for_status(status);
    let neu = match serde_json::from_slice::<serde_json::Value>(&bytes) {
        Ok(serde_json::Value::Object(o)) if o.contains_key("code") => {
            return Response::from_parts(parts, Body::from(bytes));
        }
        Ok(serde_json::Value::Object(mut o)) if o.get("error").is_some_and(|e| e.is_string()) => {
            o.insert("code".into(), serde_json::json!(code));
            serde_json::Value::Object(o)
        }
        _ => serde_json::json!(ApiErrorBody {
            error: code.default_message().into(),
            code,
        }),
    };
    let neu = serde_json::to_vec(&neu).unwrap_or_default();
    parts.headers.insert(
        header::CONTENT_TYPE,
        HeaderValue::from_static("application/json"),
    );
    parts.headers.remove(header::CONTENT_LENGTH);
    Response::from_parts(parts, Body::from(neu))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn nur_pfade_unter_v1_sind_v1() {
        assert!(ist_v1("/api/v1"));
        assert!(ist_v1("/api/v1/openapi.json"));
        assert!(!ist_v1("/api/v10/x"));
        assert!(!ist_v1("/api/v1x"));
        assert!(!ist_v1("/api/einsaetze"));
    }

    /// Die Code-Tabelle der Beschreibung nennt genau die Werte von [`ErrorCode`], jeden mit dem
    /// Status, mit dem er antwortet. Sonst driftet die Prosa still vom Enum weg.
    #[test]
    fn beschreibung_nennt_genau_die_fehlercodes() {
        let text = include_str!("beschreibung.md");
        let mut in_tabelle: Vec<(u16, String)> = text
            .lines()
            .filter_map(|zeile| {
                let spalten: Vec<&str> = zeile.split('|').map(str::trim).collect();
                let status = spalten.get(1)?.parse::<u16>().ok()?;
                let code = spalten.get(2)?.trim_matches('`').to_string();
                Some((status, code))
            })
            .collect();
        in_tabelle.sort();
        let mut aus_enum: Vec<(u16, String)> = ErrorCode::ALLE
            .iter()
            .map(|c| (c.status().as_u16(), c.as_str().to_string()))
            .collect();
        aus_enum.sort();
        assert_eq!(in_tabelle, aus_enum);
    }
}
