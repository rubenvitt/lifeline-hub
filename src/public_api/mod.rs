//! Öffentliche API v1 für Fremdsysteme (LLH-1653, ADR-0022, Konzept
//! `docs/konzepte/2026-11-11-oeffentliche-api.md`, Spec `oeffentliche-api-vertrag`).
//!
//! Alles unter `/api/v1/` entsteht hier, und nur hier:
//!
//! - Eine Route kommt per `.routes(routes!(handler))` in [`router`]; der Handler trägt
//!   `#[utoipa::path]`. So steht jede Route im Dokument (`GET /api/v1/openapi.json`, versioniert
//!   als `docs/api/public-v1.json`, Drift-Test `tests/public_api_spec_aktuell.rs`).
//! - v1-Handler antworten im Fehlerfall mit [`ApiError`]. Alles andere unter `/api/v1/` bekommt
//!   seinen `code` von [`error_code_layer`] (an den v1-Routen, [`mount`]) und
//!   [`contract_layer`] (außen in `crate::app`, mit `Cache-Control: no-store`).
//! - v1-Typen sind eigene Schemas in [`PublicApiDoc`], nie solche aus `crate::api_doc` (die
//!   interne API hat keine Zusage).
//!
//! Maschinenzugang für Fremdsysteme (LLH-1652, Spec `maschinenzugang`): Repo [`zugang`], Scopes
//! [`scope`], Drosselung [`drossel`] und Kommando [`kommando`]. Die Freigabe eines Einsatzes für
//! einen Zugang (LLH-1638, ADR-0034) liegt in [`freigabe`].
//!
//! Fachrouten: Rechner Unterkunft und Zelte in [`rechner`] (LLH-1524, Spec
//! `rechner-api-unterkunft`).
//!
//! Regeln: `src/AGENTS.md`, „Öffentliche API v1“.

pub mod drossel;
pub mod einsaetze;
pub mod error;
pub mod events;
pub mod freigabe;
pub mod kommando;
pub mod lage;
pub mod machine;
pub mod rechner;
pub mod routen;
pub mod scope;
pub mod zugang;

use std::sync::OnceLock;

use axum::body::{to_bytes, Body};
use axum::extract::{DefaultBodyLimit, Request};
use axum::http::{header, HeaderValue};
use axum::middleware::Next;
use axum::response::{IntoResponse, Response};
use axum::{Json, Router};
use utoipa::OpenApi;
use utoipa_axum::router::OpenApiRouter;
use utoipa_axum::router::UtoipaMethodRouterExt;
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
        description = include_str!("description.md"),
    ),
    components(schemas(ApiErrorBody, ErrorCode)),
    servers((url = "/", description = "Diese Instanz")),
    modifiers(&MaschinenAnmeldung)
)]
pub struct PublicApiDoc;

/// Sicherheitsschema `machine` (LLH-1652, design.md D12): ein JWS je Anfrage im Kopf
/// `Authorization: Machine <jws>`. OpenAPI kennt dafür kein eigenes `http`-Schema; `apiKey` im
/// Kopf `Authorization` beschreibt den Ort, die Beschreibung das Verfahren.
struct MaschinenAnmeldung;

impl utoipa::Modify for MaschinenAnmeldung {
    fn modify(&self, openapi: &mut utoipa::openapi::OpenApi) {
        use utoipa::openapi::security::{ApiKey, ApiKeyValue, SecurityScheme};
        let components = openapi.components.get_or_insert_with(Default::default);
        components.add_security_scheme(
            "machine",
            SecurityScheme::ApiKey(ApiKey::Header(ApiKeyValue::with_description(
                "Authorization",
                "`Machine <jws>`: je Anfrage ein kompaktes JWS (EdDSA, `typ` \
                 `lifeline-machine+jwt`, `kid` = Zugangs-ID) mit den Claims `iss`, `aud` \
                 (Instanz-UUID), `iat`, `exp` (höchstens 60 s nach `iat`), `jti`, `htm`, `htu` \
                 (Pfad mit Abfrage) und `bh` (SHA-256 des Bodys, Base64url). Uhren dürfen 5 min \
                 abweichen. Verfahren, Code-Ableitung und Testvektoren: \
                 `docs/api/maschinenzugang.md`.",
            ))),
        );
    }
}

/// Body-Grenze des Einlösens: ein Schlüssel und zwei Werte, öffentlich erreichbar.
const REDEEM_BODY_MAX: usize = 4 * 1024;

/// Alle Routen der öffentlichen API samt Dokument. Neue Routen nur per `.routes(routes!(…))`.
/// Die einfache Routenmethode des `OpenApiRouter` legte eine Route ohne Dokumenteintrag an
/// (`tests/public_api.rs` verbietet sie unter `src/public_api/`).
pub fn router() -> OpenApiRouter<crate::app::AppState> {
    use axum::Extension;
    use machine::ScopeAnforderung;
    use scope::Scope;
    OpenApiRouter::with_openapi(PublicApiDoc::openapi())
        .routes(routes!(openapi_json))
        // Maschinenzugang (LLH-1652). Jede Route mit `MachineClient` trägt ihre
        // `ScopeAnforderung`; ohne sie lehnt der Extractor ab (fail closed).
        .routes(routes!(routen::redeem).layer(DefaultBodyLimit::max(REDEEM_BODY_MAX)))
        .routes(routes!(routen::jwks))
        .routes(routes!(routen::me).layer(Extension(ScopeAnforderung::Keine)))
        // Ausgangsereignisse (LLH-1655).
        .routes(
            routes!(events::events)
                .layer(Extension(ScopeAnforderung::Scope(scope::Scope::EventsRead))),
        )
        // Freigegebene Einsätze (LLH-1655).
        .routes(
            routes!(einsaetze::liste).layer(Extension(ScopeAnforderung::Scope(
                scope::Scope::EinsaetzeRead,
            ))),
        )
        .routes(
            routes!(einsaetze::einzeln).layer(Extension(ScopeAnforderung::Scope(
                scope::Scope::EinsaetzeRead,
            ))),
        )
        // Lage des freigegebenen Einsatzes (LLH-1638).
        .routes(routes!(lage::lage).layer(Extension(ScopeAnforderung::Scope(Scope::LageRead))))
        // Rechner (LLH-1524, Spec `rechner-api-unterkunft`).
        .routes(
            routes!(rechner::calculate_unterkunft)
                .layer(Extension(ScopeAnforderung::Scope(Scope::RechnerUse))),
        )
        .routes(
            routes!(rechner::get_unterkunft_richtwerte)
                .layer(Extension(ScopeAnforderung::Scope(Scope::RechnerUse))),
        )
}

/// Das fertige Dokument, einmal aus [`router`] gebaut.
pub fn openapi() -> &'static utoipa::openapi::OpenApi {
    static DOCUMENT: OnceLock<utoipa::openapi::OpenApi> = OnceLock::new();
    DOCUMENT.get_or_init(|| {
        let mut document = router().split_for_parts().1;
        // utoipa setzt aus `license-file` eine Lizenz ohne Namen; die sagt Fremdsystemen nichts.
        document.info.license = None;
        document
    })
}

/// Macht aus dem v1-Router den Router, den `crate::app` einhängt (design.md D2, D3):
///
/// - Body-Grenze `crate::app::PUBLIC_API_BODY_MAX` vor jedem Handler, auch einem, der den Body
///   nicht oder roh liest: [`body_limit_layer`] puffert den Body, mit und ohne `Content-Length`.
///   `DefaultBodyLimit` stellt die Extraktoren (`JsonBody`) auf dieselbe Grenze.
/// - [`error_code_layer`] an den Routen, also innerhalb der Antwortkompression: ein langer
///   Fehler-Body (etwa eine Ablehnung, die die Eingabe zurückgibt) bekommt seinen `code`, bevor
///   er gepackt wird.
///
/// Generisch, damit Tests eine Proberoute ohne `AppState` montieren können.
pub fn mount<S>(router: OpenApiRouter<S>) -> Router<S>
where
    S: Clone + Send + Sync + 'static,
{
    let (router, _) = router.split_for_parts();
    router
        .layer(DefaultBodyLimit::max(crate::app::PUBLIC_API_BODY_MAX))
        .layer(axum::middleware::from_fn(body_limit_layer))
        .layer(axum::middleware::from_fn(error_code_layer))
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
        (status = "default", description = "Fehler; `code` nach der Tabelle in `info.description`",
            body = ApiErrorBody),
    ),
)]
async fn openapi_json() -> Response {
    Json(openapi()).into_response()
}

/// `true` für Pfade der öffentlichen API.
pub fn is_v1(path: &str) -> bool {
    path == PREFIX
        || path
            .strip_prefix(PREFIX)
            .is_some_and(|rest| rest.starts_with('/'))
}

/// Liest den Body einer v1-Anfrage ganz, bevor der Handler läuft, und lehnt einen über
/// `crate::app::PUBLIC_API_BODY_MAX` mit 413 `payload_too_large` ab: nach `Content-Length` ohne
/// zu lesen, sonst beim Puffern (chunked, HTTP/2 ohne Länge). Ein abgebrochener oder kaputter
/// Body ist 400 `invalid_field`. Kosten: höchstens 64 KiB je Anfrage, die ein Handler ohnehin
/// puffert.
pub async fn body_limit_layer(req: Request, next: Next) -> Response {
    let max = crate::app::PUBLIC_API_BODY_MAX;
    let declared = req
        .headers()
        .get(header::CONTENT_LENGTH)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.parse::<u64>().ok());
    if declared.is_some_and(|length| length > max as u64) {
        return ApiError::from_code(ErrorCode::PayloadTooLarge).into_response();
    }
    let (parts, body) = req.into_parts();
    match to_bytes(body, max).await {
        Ok(bytes) => {
            next.run(Request::from_parts(parts, Body::from(bytes)))
                .await
        }
        Err(err) if is_length_limit(&err) => {
            ApiError::from_code(ErrorCode::PayloadTooLarge).into_response()
        }
        Err(_) => ApiError::new(
            ErrorCode::InvalidField,
            "Der Anfrage-Body ließ sich nicht lesen.",
        )
        .into_response(),
    }
}

/// `true`, wenn das Puffern an der Längengrenze scheiterte.
fn is_length_limit(err: &axum::Error) -> bool {
    let mut source: Option<&(dyn std::error::Error + 'static)> = Some(err);
    while let Some(e) = source {
        if e.is::<http_body_util::LengthLimitError>() {
            return true;
        }
        source = e.source();
    }
    false
}

/// Höchstgröße eines Fehler-Bodys, den die Schichten lesen. Darüber wird der Body durch den
/// Vorgabetext seines Codes ersetzt.
const ERROR_BODY_MAX: usize = 64 * 1024;

/// Äußere Schicht für alles unter `/api/v1/`, montiert in `crate::app` außerhalb von Zulassung
/// und CatchPanic (design.md D2): setzt `Cache-Control: no-store` und ergänzt `code` an
/// Fehlerantworten, die nicht von einer v1-Route kommen (404 eines unbekannten Pfads, 405,
/// Panik-500, Lastabwurf-503). Deren Bodys sind kurz und liegen unter der Packgrenze.
pub async fn contract_layer(req: Request, next: Next) -> Response {
    if !is_v1(req.uri().path()) {
        return next.run(req).await;
    }
    let mut resp = add_error_code(next.run(req).await).await;
    resp.headers_mut()
        .insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    resp
}

/// Innere Schicht an den v1-Routen ([`mount`]): ergänzt `code` an Fehlerantworten der Routen,
/// bevor die Antwortkompression packt. Setzt kein `Cache-Control`: die Kompression ließe eine
/// Antwort mit diesem Kopf ungepackt.
pub async fn error_code_layer(req: Request, next: Next) -> Response {
    add_error_code(next.run(req).await).await
}

/// Gibt einer Fehlerantwort ohne `code` den Vorgabe-Code ihres Status
/// ([`ErrorCode::for_status`]). Ein Body, der kein `{error}` ist, wird ersetzt; eine Antwort mit
/// `code` (aus [`ApiError`]) und eine gepackte Antwort bleiben, wie sie sind.
async fn add_error_code(resp: Response) -> Response {
    let status = resp.status();
    if !(status.is_client_error() || status.is_server_error())
        || resp.headers().contains_key(header::CONTENT_ENCODING)
    {
        return resp;
    }

    let (mut parts, body) = resp.into_parts();
    let bytes = to_bytes(body, ERROR_BODY_MAX).await.unwrap_or_default();
    let code = ErrorCode::for_status(status);
    let body = match serde_json::from_slice::<serde_json::Value>(&bytes) {
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
    let body = serde_json::to_vec(&body).unwrap_or_default();
    parts.headers.insert(
        header::CONTENT_TYPE,
        HeaderValue::from_static("application/json"),
    );
    parts.headers.remove(header::CONTENT_LENGTH);
    Response::from_parts(parts, Body::from(body))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn nur_pfade_unter_v1_sind_v1() {
        assert!(is_v1("/api/v1"));
        assert!(is_v1("/api/v1/openapi.json"));
        assert!(!is_v1("/api/v10/x"));
        assert!(!is_v1("/api/v1x"));
        assert!(!is_v1("/api/einsaetze"));
    }

    /// Die Code-Tabelle der Beschreibung nennt genau die Werte von [`ErrorCode`], jeden mit dem
    /// Status, mit dem er antwortet. Sonst driftet die Prosa still vom Enum weg.
    #[test]
    fn beschreibung_nennt_genau_die_fehlercodes() {
        let text = include_str!("description.md");
        let mut from_table: Vec<(u16, String)> = text
            .lines()
            .filter_map(|line| {
                let columns: Vec<&str> = line.split('|').map(str::trim).collect();
                let status = columns.get(1)?.parse::<u16>().ok()?;
                let code = columns.get(2)?.trim_matches('`').to_string();
                Some((status, code))
            })
            .collect();
        from_table.sort();
        let mut from_enum: Vec<(u16, String)> = ErrorCode::ALLE
            .iter()
            .map(|c| (c.status().as_u16(), c.as_str().to_string()))
            .collect();
        from_enum.sort();
        assert_eq!(from_table, from_enum);
    }
}
