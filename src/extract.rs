//! Querschnittliche Extraktoren, die den `{error}`-JSON-Vertrag einhalten (LFH-267/F22).
//!
//! axums eigene Extractor-Rejections antworten mit `text/plain` und laufen damit am
//! einheitlichen Fehlerformat aus [`crate::error::AppError`] vorbei. Das Frontend liest die
//! Servermeldung aus dem JSON-Body (`frontend/src/api/client.ts`) und fällt sonst auf ein
//! generisches „Serverfehler (status)" zurück — die Einsatzkraft sähe statt einer deutschen
//! Fachmeldung eine Nullaussage.
//!
//! [`JsonBody`] delegiert deshalb an `axum::Json` (identische Deserialisierung und
//! Content-Type-Prüfung) und ersetzt ausschließlich die Rejection.

use axum::extract::rejection::{JsonRejection, PathRejection};
use axum::extract::{ConnectInfo, FromRequest, FromRequestParts, Request};
use axum::http::request::Parts;
use serde::de::DeserializeOwned;
use std::convert::Infallible;
use std::net::{IpAddr, SocketAddr};

use crate::error::AppError;

/// Quell-IP des Aufrufers, sofern ermittelbar (LFH-249/F30).
///
/// `ConnectInfo<SocketAddr>` direkt im Handler ginge nicht: die Extension existiert nur,
/// wenn der Server mit `into_make_service_with_connect_info` läuft — in jedem Router-Test
/// (`oneshot` gegen den blanken Router) fehlt sie, und der Handler würde dort mit 500
/// antworten statt zu arbeiten. `Option<ConnectInfo<_>>` ist seit axum 0.8 ebenfalls kein
/// gültiger Extractor mehr (verlangt `OptionalFromRequestParts`).
///
/// Deshalb dieser Extractor: er ist **infallible** und liefert schlicht `None`, wenn die
/// Adresse nicht bekannt ist. Eine unbekannte Quelle ist kein Fehlerfall — sie ist die
/// normale Lage in Tests und hinter manchen Setups.
///
/// Bewusst NICHT aus `X-Forwarded-For` gelesen: der Header ist ohne vertrauenswürdigen
/// Reverse-Proxy frei fälschbar, und ein fälschbares Rate-Limit ist keins.
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

/// Json-Body-Extractor mit deutschsprachiger Rejection im `{error}`-Format.
///
/// Verhält sich beim Deserialisieren exakt wie `axum::Json` — nur der Fehlerfall
/// unterscheidet sich. Der Name ist bewusst distinkt (nicht `Json`), damit der Guard
/// `tests/json_extractor_guard.rs` Wrapper und Rohform unterscheiden kann und ein
/// vergessener Import nicht still auf `axum::Json` zurückfällt.
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

/// Bildet eine `JsonRejection` auf einen `AppError` ab.
///
/// Alle Arme landen auf 400: der Body ist formal ungültig, unabhängig davon, ob er
/// syntaktisch kaputt, typwidrig oder falsch deklariert war (LFH-267: 400 = formal
/// ungültig, 422 = Zustand verbietet, 409 = Nebenläufigkeit/Lebenszyklus).
///
/// Bewusste Ungenauigkeit: `MissingJsonContentType` wäre HTTP-korrekt ein 415 und
/// `LengthLimitError` ein 413. `AppError` trägt beide Codes nicht, und da eine
/// Extractor-Rejection im Gegensatz zu einem Router-Fallback fest an den Rejection-Typ
/// gebunden ist, ließe sich der Code nur über zwei neue Varianten erhalten. Das wurde
/// gegen den Zuschnitt dieses Tasks abgewogen und verworfen — der Envelope zählt hier
/// mehr als die exakte Code-Nuance.
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
        // `JsonRejection` ist `#[non_exhaustive]` — dieser Arm ist vom Compiler erzwungen
        // und fängt Varianten, die ein künftiger axum-Bump hinzufügt. Bewusst NICHT auf 400:
        // ein unbekannter Arm soll im Log auffallen, statt still als Eingabefehler
        // durchzugehen.
        andere => {
            tracing::error!("Unbehandelte JsonRejection-Variante: {andere}");
            AppError::Internal(format!("Unbehandelte Json-Rejection: {andere}"))
        }
    }
}

/// Pfad-Parameter-Extractor mit deutschsprachiger Rejection im `{error}`-Format (LFH-317/F22-B).
///
/// Verhält sich beim Deserialisieren exakt wie `axum::extract::Path` — nur der Fehlerfall
/// unterscheidet sich. axums `Path` antwortet bei einer nicht-deserialisierbaren Route-ID
/// (z. B. `abc` statt einer Zahl) mit `text/plain` und läuft damit am `{error}`-JSON-Vertrag
/// vorbei; das Frontend (`api/client.ts`) sähe dann nur „Serverfehler (status)".
///
/// Der Name ist bewusst distinkt (nicht `Path`), aus drei Gründen: damit der Guard
/// `tests/path_extractor_guard.rs` Wrapper und Rohform unterscheiden kann, damit ein vergessener
/// Import nicht still auf `axum::extract::Path` zurückfällt, und wegen der Kollision mit
/// `std::path::Path`.
///
/// **Status 400, nicht 404:** Eine nicht-parsebare Route-ID ist ein formal ungültiger
/// Eingabewert (LFH-267: falscher Feldtyp → 400), und axums Default ist bereits 400 — die
/// Ersetzung ist damit envelope-only, ohne Status-Änderung (gepinnt:
/// `tests/karte.rs::proxy_raster_nicht_numerisches_z_ist_400`). Bewusst ANDERS als
/// `src/einsatz/kontext.rs`, das die *einsatz_id* auf `NotFound` (404) abbildet: dort ist die
/// fehlende ID eine Ressourcen-Existenzfrage (den Einsatz gibt es nicht), hier nur eine
/// Parse-Frage des Pfad-Segments. Die beiden Extraktoren sind orthogonal — `EinsatzKontext`
/// zieht die `{id}`, `PfadParam` die Sub-IDs; ein Modul nutzt oft beide (z. B. `auftrag.rs`).
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

/// Bildet eine `PathRejection` auf einen `AppError` ab. Der Deserialisierungsfehler (die häufige
/// nicht-numerische ID) landet auf **400** — analog `rejection_zu_app_error` für den Body.
fn pfad_rejection_zu_app_error(rejection: PathRejection) -> AppError {
    match rejection {
        PathRejection::FailedToDeserializePathParams(e) => {
            AppError::Validation(format!("Ungültiger Pfad-Parameter: {e}"))
        }
        // `MissingPathParams` heißt: der Handler verlangt mehr Pfad-Segmente als die Route trägt —
        // ein Router-/Handler-Fehler, kein Client-Fehler. Wie beim Json-Wrapper: auffallen (500 +
        // Log) statt still als 400 durchgehen.
        PathRejection::MissingPathParams(e) => {
            tracing::error!("MissingPathParams (Route/Handler-Mismatch): {e}");
            AppError::Internal(format!("Pfad-Parameter fehlen (Router-Fehler): {e}"))
        }
        // `PathRejection` ist `#[non_exhaustive]` — erzwungener Arm für künftige axum-Varianten.
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

    /// Router ohne State — `AppState` hat viele Pflichtfelder, und keins davon ist für
    /// den Extractor relevant.
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

    /// Der wichtigste Test: der Wrapper verhält sich beim Deserialisieren identisch zu
    /// `axum::Json`. Das ist die Voraussetzung dafür, dass die Ersetzung über alle
    /// Routen hinweg verhaltensneutral ist.
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

    /// Kern der Nutzer-Entscheidung: ein unbekannter Enum-Wert ist formal ungültig (400),
    /// nicht „Zustand verbietet" (422). axum allein lieferte hier 422.
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

    // ── PfadParam (LFH-317) ──

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

    /// Wie beim Json-Wrapper der wichtigste Test: der PfadParam-Wrapper extrahiert identisch
    /// zu `axum::extract::Path` — Voraussetzung dafür, dass die Ersetzung über ~206 Call-Sites
    /// verhaltensneutral ist.
    #[tokio::test]
    async fn pfad_gueltig_wird_unveraendert_extrahiert() {
        let (status, body) = hole("/t/42/hallo").await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(body, "42/hallo");
    }

    /// Der Kern von LFH-317: eine nicht-numerische Route-ID liefert 400 im `{error}`-Envelope
    /// statt `text/plain` (axum-Default-Status 400 bleibt, nur der Body wird JSON).
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
