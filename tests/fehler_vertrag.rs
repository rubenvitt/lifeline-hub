//! Vertragstest: JEDE Fehlerantwort der API folgt dem `{error}`-JSON-Kontrakt (LFH-267/F22).
//!
//! Motivation: `AppError` beantwortet Fehler einheitlich als `{"error": "<Meldung>"}`
//! (src/error.rs), aber die axum-Extractor-Rejections laufen daran vorbei — sie antworten
//! mit `text/plain`. Das Frontend (`frontend/src/api/client.ts`) liest die Servermeldung aus
//! dem JSON-Body; bei `text/plain` fällt es auf ein generisches „Serverfehler (status)" zurück,
//! und die Einsatzkraft sieht statt einer deutschen Fachmeldung eine Nullaussage.
//!
//! Diese Datei prüft die querschnittlichen Fälle, die KEINE Route einzeln abdeckt.

mod common;

use axum::body::{to_bytes, Body};
use axum::http::{header, Request, StatusCode};
use serde_json::Value;
use tower::ServiceExt;

/// Prüft den Fehler-Envelope: `application/json` + parsebarer Body + String-Feld `error`.
///
/// Bewusst getrennt vom Statuscode-Assert: ein Fall kann den richtigen Status und trotzdem
/// den falschen Body-Typ liefern (so verhält sich heute `JsonSyntaxError` — 400, aber
/// `text/plain`). Beides einzeln zu prüfen macht sichtbar, welche Hälfte bricht.
async fn assert_fehler_envelope(resp: axum::response::Response, fall: &str) -> Value {
    let status = resp.status();
    assert!(
        status.is_client_error() || status.is_server_error(),
        "[{fall}] erwartet Fehlerstatus, war {status}"
    );

    let content_type = resp
        .headers()
        .get(header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("<fehlt>")
        .to_string();
    assert!(
        content_type.starts_with("application/json"),
        "[{fall}] content-type war {content_type:?}, erwartet application/json"
    );

    let bytes = to_bytes(resp.into_body(), usize::MAX).await.unwrap();
    let json: Value = serde_json::from_slice(&bytes).unwrap_or_else(|e| {
        panic!(
            "[{fall}] Body ist kein JSON ({e}): {:?}",
            String::from_utf8_lossy(&bytes)
        )
    });
    assert!(
        json.get("error").and_then(Value::as_str).is_some(),
        "[{fall}] Body hat kein String-Feld 'error': {json}"
    );
    json
}

/// Baut einen POST auf einen Endpunkt, der ohne Session erreichbar ist (Login).
/// `content_type = None` lässt den Header bewusst weg.
fn login_request(body: &str, content_type: Option<&str>) -> Request<Body> {
    let mut req = Request::builder().method("POST").uri("/api/auth/login");
    if let Some(ct) = content_type {
        req = req.header(header::CONTENT_TYPE, ct);
    }
    req.body(Body::from(body.to_string())).unwrap()
}

/// Syntaktisch kaputter Body: axum liefert heute den RICHTIGEN Status (400), aber
/// `text/plain` — der Envelope-Teil des Asserts ist rot.
#[tokio::test]
async fn kaputtes_json_liefert_400_im_fehler_envelope() {
    let app = common::setup().await;
    let resp = app
        .oneshot(login_request(r#"{kaputt"#, Some("application/json")))
        .await
        .unwrap();

    let status = resp.status();
    let json = assert_fehler_envelope(resp, "Syntaxfehler").await;
    assert_eq!(status, StatusCode::BAD_REQUEST, "Syntaxfehler ist 400");
    assert!(
        !json["error"].as_str().unwrap().is_empty(),
        "Meldung darf nicht leer sein"
    );
}

/// Falscher Skalartyp: heute `JsonDataError` → 422 + `text/plain`.
/// Nach LFH-267 ist das ein formaler Eingabefehler → 400 (Nutzer-Entscheidung:
/// „unbekannter Enum-Wert / Typfehler = formal ungültig").
#[tokio::test]
async fn falscher_feldtyp_liefert_400_im_fehler_envelope() {
    let app = common::setup().await;
    let resp = app
        .oneshot(login_request(
            r#"{"benutzername":123,"passwort":"x"}"#,
            Some("application/json"),
        ))
        .await
        .unwrap();

    let status = resp.status();
    assert_fehler_envelope(resp, "Typfehler").await;
    assert_eq!(
        status,
        StatusCode::BAD_REQUEST,
        "Typfehler ist formal ungültig → 400, nicht 422"
    );
}

/// Fehlender `Content-Type`: heute `MissingJsonContentType` → 415 + `text/plain`.
/// Wird bewusst auf 400 gefaltet — `AppError` trägt keinen 415-Code, und eine eigene
/// Variante dafür hätte den Batch über das Fundament hinaus aufgezogen.
#[tokio::test]
async fn fehlender_content_type_liefert_fehler_envelope() {
    let app = common::setup().await;
    let resp = app
        .oneshot(login_request(
            r#"{"benutzername":"admin","passwort":"startpw12"}"#,
            None,
        ))
        .await
        .unwrap();

    assert_fehler_envelope(resp, "kein Content-Type").await;
}

/// Regressionsschutz, KEIN Rot-Nachweis: `static_files::serve` prüft den `/api/`-Präfix
/// bereits vor dem SPA-Fallback und liefert korrekt 404 + JSON. Der Test hält das fest,
/// damit eine spätere Änderung am Fallback nicht unbemerkt HTML auf API-Pfade zurückgibt.
#[tokio::test]
async fn unbekannter_api_pfad_liefert_404_im_fehler_envelope() {
    let app = common::setup().await;
    let resp = app
        .oneshot(
            Request::builder()
                .uri("/api/gibtsnicht")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    let status = resp.status();
    assert_fehler_envelope(resp, "unbekannter API-Pfad").await;
    assert_eq!(status, StatusCode::NOT_FOUND);
}

/// Existierender Pfad, nicht registrierte Methode: axums MethodRouter-Default antwortet
/// 405 mit LEEREM Body. Kein Json-Extractor beteiligt — dieser Fall wäre durch den
/// Wrapper allein nie geschlossen worden.
#[tokio::test]
async fn falsche_methode_liefert_405_im_fehler_envelope() {
    let app = common::setup().await;
    let resp = app
        .oneshot(
            Request::builder()
                .method("DELETE")
                .uri("/api/health")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    let status = resp.status();
    assert_fehler_envelope(resp, "falsche Methode").await;
    assert_eq!(status, StatusCode::METHOD_NOT_ALLOWED);
}
