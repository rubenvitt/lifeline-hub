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

use axum::extract::rejection::JsonRejection;
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
}
