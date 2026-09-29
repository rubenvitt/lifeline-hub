//! Querschnittliche Extraktoren, die den `{error}`-JSON-Vertrag einhalten (LFH-267).
//!
//! axums Extractor-Rejections antworten mit `text/plain`; das Frontend liest die Meldung aber
//! aus dem JSON-Body (`frontend/src/api/client.ts`) und zeigte sonst nur „Serverfehler
//! (status)“. [`JsonBody`] delegiert deshalb an `axum::Json` und ersetzt nur die Rejection.

use axum::extract::rejection::{JsonRejection, PathRejection};
use axum::extract::{ConnectInfo, FromRequest, FromRequestParts, Request};
use axum::http::request::Parts;
use serde::de::DeserializeOwned;
use std::convert::Infallible;
use std::net::{IpAddr, SocketAddr};

use crate::error::AppError;

/// Quell-IP des Aufrufers, sofern ermittelbar.
///
/// `ConnectInfo<SocketAddr>` direkt ginge nicht: die Extension fehlt in jedem Router-Test
/// (`oneshot`), der Handler antwortete dort mit 500; `Option<ConnectInfo<_>>` ist in axum 0.8
/// kein Extractor mehr. Dieser Extractor ist infallible und liefert `None`, wenn die Adresse
/// unbekannt ist.
///
/// Bewusst nicht aus `X-Forwarded-For`: ohne vertrauenswürdigen Reverse-Proxy ist der Header
/// frei fälschbar, und ein fälschbares Rate-Limit ist keins.
#[derive(Debug, Clone, Copy)]
pub struct PeerIp(pub Option<IpAddr>);

impl<S: Send + Sync> FromRequestParts<S> for PeerIp {
    type Rejection = Infallible;

    async fn from_request_parts(parts: &mut Parts, _state: &S) -> Result<Self, Self::Rejection> {
        Ok(PeerIp(
            parts
                .extensions
                .get::<ConnectInfo<SocketAddr>>()
                .map(|ConnectInfo(adresse)| adresse.ip()),
        ))
    }
}

/// Json-Body-Extractor mit deutschsprachiger Rejection im `{error}`-Format; deserialisiert
/// exakt wie `axum::Json`. Der distinkte Name lässt `tests/json_extractor_guard.rs` Wrapper und
/// Rohform unterscheiden.
#[derive(Debug, Clone, Copy, Default)]
pub struct JsonBody<T>(pub T);

impl<T, S> FromRequest<S> for JsonBody<T>
where
    T: DeserializeOwned,
    S: Send + Sync,
{
    type Rejection = AppError;

    async fn from_request(req: Request, state: &S) -> Result<Self, Self::Rejection> {
        match axum::Json::<T>::from_request(req, state).await {
            Ok(axum::Json(wert)) => Ok(JsonBody(wert)),
            Err(rejection) => Err(rejection_zu_app_error(rejection)),
        }
    }
}

/// Bildet eine `JsonRejection` auf einen `AppError` ab. Alle Arme landen auf 400 (formal
/// ungültig).
///
/// Bewusste Ungenauigkeit: `MissingJsonContentType` wäre HTTP-korrekt 415, `LengthLimitError`
/// 413. `AppError` trägt beide Codes nicht; der Envelope zählt hier mehr als die Code-Nuance.
fn rejection_zu_app_error(rejection: JsonRejection) -> AppError {
    match rejection {
        JsonRejection::JsonSyntaxError(_) => {
            AppError::Validation("Anfrage-Body ist kein gültiges JSON.".into())
        }
        JsonRejection::JsonDataError(e) => AppError::Validation(format!(
            "Anfrage-Body passt nicht zum erwarteten Format: {e}"
        )),
        JsonRejection::MissingJsonContentType(_) => AppError::Validation(
            "Anfrage-Body muss als 'Content-Type: application/json' gesendet werden.".into(),
        ),
        JsonRejection::BytesRejection(_) => {
            AppError::Validation("Anfrage-Body konnte nicht gelesen werden.".into())
        }
        // `JsonRejection` ist `#[non_exhaustive]`; dieser Arm fängt künftige Varianten. Nicht auf
        // 400:
        // ein unbekannter Arm soll im Log auffallen.
        andere => {
            tracing::error!("Unbehandelte JsonRejection-Variante: {andere}");
            AppError::Internal(format!("Unbehandelte Json-Rejection: {andere}"))
        }
    }
}

/// Pfad-Parameter-Extractor mit deutschsprachiger Rejection im `{error}`-Format (LFH-317);
/// deserialisiert exakt wie `axum::extract::Path`. Der distinkte Name lässt
/// `tests/path_extractor_guard.rs` Wrapper und Rohform unterscheiden und vermeidet die
/// Kollision mit `std::path::Path`.
///
/// **Status 400, nicht 404:** eine nicht parsebare Route-ID ist ein formal ungültiger
/// Eingabewert; axums Default ist ebenfalls 400, die Ersetzung ändert nur den Envelope (gepinnt:
/// `tests/karte.rs::proxy_raster_nicht_numerisches_z_ist_400`). Anders `src/einsatz/kontext.rs`,
/// das die *einsatz_id* auf 404 abbildet (Existenzfrage). Die Extraktoren sind orthogonal:
/// `EinsatzKontext` zieht die `{id}`, `PfadParam` die Sub-IDs.
#[derive(Debug, Clone, Copy, Default)]
pub struct PfadParam<T>(pub T);

impl<T, S> FromRequestParts<S> for PfadParam<T>
where
    T: DeserializeOwned + Send,
    S: Send + Sync,
{
    type Rejection = AppError;

    async fn from_request_parts(parts: &mut Parts, state: &S) -> Result<Self, Self::Rejection> {
        match axum::extract::Path::<T>::from_request_parts(parts, state).await {
            Ok(axum::extract::Path(wert)) => Ok(PfadParam(wert)),
            Err(rejection) => Err(pfad_rejection_zu_app_error(rejection)),
        }
    }
}

/// Bildet eine `PathRejection` auf einen `AppError` ab; der Deserialisierungsfehler landet auf
/// 400.
fn pfad_rejection_zu_app_error(rejection: PathRejection) -> AppError {
    match rejection {
        PathRejection::FailedToDeserializePathParams(e) => {
            AppError::Validation(format!("Ungültiger Pfad-Parameter: {e}"))
        }
        // `MissingPathParams`: der Handler verlangt mehr Segmente als die Route trägt — ein
        // Programmierfehler, der als 500 im Log auffallen soll.
        PathRejection::MissingPathParams(e) => {
            tracing::error!("MissingPathParams (Route/Handler-Mismatch): {e}");
            AppError::Internal(format!("Pfad-Parameter fehlen (Router-Fehler): {e}"))
        }
        // `PathRejection` ist `#[non_exhaustive]`; Arm für künftige Varianten.
        andere => {
            tracing::error!("Unbehandelte PathRejection-Variante: {andere}");
            AppError::Internal(format!("Unbehandelte Path-Rejection: {andere}"))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::body::{to_bytes, Body};
    use axum::http::{header, Request, StatusCode};
    use axum::routing::post;
    use axum::Router;
    use serde::Deserialize;
    use serde_json::Value;
    use tower::ServiceExt;

    #[derive(Debug, Deserialize, PartialEq)]
    enum Farbe {
        #[serde(rename = "rot")]
        Rot,
    }

    #[derive(Debug, Deserialize)]
    struct Probe {
        name: String,
        anzahl: i64,
        farbe: Option<Farbe>,
    }

    /// Router ohne State — kein Feld von `AppState` ist für den Extractor relevant.
    fn probe_router() -> Router {
        Router::new().route(
            "/t",
            post(|JsonBody(p): JsonBody<Probe>| async move {
                format!("{}/{}/{:?}", p.name, p.anzahl, p.farbe)
            }),
        )
    }

    async fn sende(body: &str, content_type: Option<&str>) -> (StatusCode, String) {
        let mut req = Request::builder().method("POST").uri("/t");
        if let Some(ct) = content_type {
            req = req.header(header::CONTENT_TYPE, ct);
        }
        let resp = probe_router()
            .oneshot(req.body(Body::from(body.to_string())).unwrap())
            .await
            .unwrap();
        let status = resp.status();
        let bytes = to_bytes(resp.into_body(), usize::MAX).await.unwrap();
        (status, String::from_utf8_lossy(&bytes).to_string())
    }

    /// Der Wrapper deserialisiert identisch zu `axum::Json`; darauf ruht die Verhaltensneutralität
    /// der Ersetzung.
    #[tokio::test]
    async fn gueltiger_body_wird_unveraendert_deserialisiert() {
        let (status, body) = sende(
            r#"{"name":"Probe","anzahl":42,"farbe":"rot"}"#,
            Some("application/json"),
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(body, "Probe/42/Some(Rot)");
    }

    #[tokio::test]
    async fn kaputte_syntax_wird_400_mit_envelope() {
        let (status, body) = sende(r#"{kaputt"#, Some("application/json")).await;
        assert_eq!(status, StatusCode::BAD_REQUEST);
        let json: Value = serde_json::from_str(&body).expect("Body ist JSON");
        assert!(json["error"].as_str().unwrap().contains("gültiges JSON"));
    }

    #[tokio::test]
    async fn falscher_feldtyp_wird_400_mit_envelope() {
        let (status, body) = sende(r#"{"name":123,"anzahl":42}"#, Some("application/json")).await;
        assert_eq!(status, StatusCode::BAD_REQUEST);
        let json: Value = serde_json::from_str(&body).expect("Body ist JSON");
        assert!(json["error"].as_str().is_some());
    }

    /// Ein unbekannter Enum-Wert ist formal ungültig (400), nicht 422 (axum allein lieferte 422).
    #[tokio::test]
    async fn unbekannter_enum_wert_wird_400_nicht_422() {
        let (status, body) = sende(
            r#"{"name":"Probe","anzahl":1,"farbe":"tuerkis"}"#,
            Some("application/json"),
        )
        .await;
        assert_eq!(
            status,
            StatusCode::BAD_REQUEST,
            "unbekannter Enum-Wert ist 400, nicht 422"
        );
        let json: Value = serde_json::from_str(&body).expect("Body ist JSON");
        assert!(json["error"].as_str().is_some());
    }

    #[tokio::test]
    async fn fehlender_content_type_wird_400_mit_envelope() {
        let (status, body) = sende(r#"{"name":"Probe","anzahl":1}"#, None).await;
        assert_eq!(status, StatusCode::BAD_REQUEST);
        let json: Value = serde_json::from_str(&body).expect("Body ist JSON");
        assert!(json["error"].as_str().unwrap().contains("Content-Type"));
    }

    // ── PfadParam ──

    fn pfad_router() -> Router {
        Router::new().route(
            "/t/{a}/{b}",
            axum::routing::get(|PfadParam((a, b)): PfadParam<(i64, String)>| async move {
                format!("{a}/{b}")
            }),
        )
    }

    async fn hole(uri: &str) -> (StatusCode, String) {
        let resp = pfad_router()
            .oneshot(Request::builder().uri(uri).body(Body::empty()).unwrap())
            .await
            .unwrap();
        let status = resp.status();
        let bytes = to_bytes(resp.into_body(), usize::MAX).await.unwrap();
        (status, String::from_utf8_lossy(&bytes).to_string())
    }

    /// Der Wrapper extrahiert identisch zu `axum::extract::Path`.
    #[tokio::test]
    async fn pfad_gueltig_wird_unveraendert_extrahiert() {
        let (status, body) = hole("/t/42/hallo").await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(body, "42/hallo");
    }

    /// Eine nicht-numerische Route-ID liefert 400 im `{error}`-Envelope statt `text/plain`.
    #[tokio::test]
    async fn pfad_nicht_numerisch_wird_400_mit_envelope() {
        let (status, body) = hole("/t/abc/hallo").await;
        assert_eq!(status, StatusCode::BAD_REQUEST);
        let json: Value = serde_json::from_str(&body).expect("Body ist JSON");
        assert!(
            json["error"].as_str().unwrap().contains("Pfad-Parameter"),
            "deutsche Envelope-Meldung erwartet, war: {json}"
        );
    }
}
