//! LFH-690: Demo-Daten zur Laufzeit — Freischaltung und Rechte der Endpunkte.
//!
//! Spec: `openspec/changes/lfh-690-demo-daten-laufzeit-import/specs/demo-daten/spec.md`,
//! Anforderungen „Freischaltung per Umgebungsvariable“ und „Nur der System-Admin, nur die
//! eigene Organisation“; Herleitung in `design.md` D1–D3.

mod common;

use axum::body::{to_bytes, Body};
use axum::http::{header, Request, StatusCode};
use lifeline_hub::app::RouterOptionen;
use serde_json::Value;
use tower::ServiceExt;

/// Alle Demo-Endpunkte als `(Methode, Pfad)`.
const ENDPUNKTE: &[(&str, &str)] = &[
    ("GET", "/api/demo-daten"),
    ("POST", "/api/demo-daten"),
    ("DELETE", "/api/demo-daten"),
    ("POST", "/api/demo-daten/neu"),
];

/// Ein garantiert nicht registrierter `/api/`-Pfad als Vergleichsmaßstab.
const UNBEKANNT: &str = "/api/gibt-es-garantiert-nicht";

/// Antwort in Rohform: Status, Content-Type und Body-Bytes.
async fn roh(
    app: &axum::Router,
    methode: &str,
    uri: &str,
    cookie: Option<&str>,
) -> (StatusCode, String, Vec<u8>) {
    let mut req = Request::builder().method(methode).uri(uri);
    if let Some(c) = cookie {
        req = req.header(header::COOKIE, c.to_string());
    }
    let resp = app
        .clone()
        .oneshot(req.body(Body::empty()).unwrap())
        .await
        .unwrap();
    let status = resp.status();
    let ct = resp
        .headers()
        .get(header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("<fehlt>")
        .to_string();
    let bytes = to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap()
        .to_vec();
    (status, ct, bytes)
}

/// Ohne Freischaltung ist jeder Demo-Pfad von einem unbekannten `/api/`-Pfad nicht zu
/// unterscheiden: 404, gleicher Content-Type, gleicher Body — anonym wie als Admin, bei jeder
/// Methode. Ein 401/403/405 verriete, dass der Pfad existiert.
#[tokio::test]
async fn ohne_freischaltung_antworten_alle_demo_pfade_wie_ein_unbekannter_pfad() {
    let (app, _pool) = common::setup_mit_optionen(RouterOptionen::default()).await;
    let admin = common::login_cookie(&app, "admin", "startpw12").await;

    for cookie in [None, Some(admin.as_str())] {
        let wer = if cookie.is_some() { "Admin" } else { "anonym" };
        for (methode, pfad) in ENDPUNKTE {
            let (ref_status, ref_ct, ref_body) = roh(&app, methode, UNBEKANNT, cookie).await;
            assert_eq!(
                ref_status,
                StatusCode::NOT_FOUND,
                "Vergleichspfad muss 404 sein"
            );

            let (status, ct, body) = roh(&app, methode, pfad, cookie).await;
            assert!(
                ![
                    StatusCode::UNAUTHORIZED,
                    StatusCode::FORBIDDEN,
                    StatusCode::METHOD_NOT_ALLOWED
                ]
                .contains(&status),
                "[{wer}] {methode} {pfad}: {status} verrät den Pfad"
            );
            assert_eq!(status, ref_status, "[{wer}] {methode} {pfad}: Status");
            assert_eq!(ct, ref_ct, "[{wer}] {methode} {pfad}: Content-Type");
            assert_eq!(
                body,
                ref_body,
                "[{wer}] {methode} {pfad}: Body {:?}",
                String::from_utf8_lossy(&body)
            );
            let json: Value = serde_json::from_slice(&body).expect("Body ist JSON");
            assert!(json["error"].is_string(), "Envelope mit `error`: {json}");
        }
    }
}

/// Mit Freischaltung: anonym 401 auf jedem Endpunkt.
#[tokio::test]
async fn mit_freischaltung_anonym_401() {
    let (app, _pool) = common::setup_mit_optionen(RouterOptionen { demo_daten: true }).await;
    for (methode, pfad) in ENDPUNKTE {
        let (status, _ct, _body) = roh(&app, methode, pfad, None).await;
        assert_eq!(status, StatusCode::UNAUTHORIZED, "{methode} {pfad}");
    }
}

/// Mit Freischaltung: eine Führungskraft (Zugang zur Verwaltung, aber kein System-Admin)
/// bekommt auf jedem Endpunkt 403.
#[tokio::test]
async fn mit_freischaltung_fuehrungskraft_403() {
    let (app, _pool) = common::setup_mit_optionen(RouterOptionen { demo_daten: true }).await;
    let admin = common::login_cookie(&app, "admin", "startpw12").await;
    common::benutzer_anlegen(&app, &admin, "fuehrung", "fuehrungskraft").await;
    let fk = common::login_cookie(&app, "fuehrung", "fuehrungpw1").await;

    for (methode, pfad) in ENDPUNKTE {
        let (status, _ct, _body) = roh(&app, methode, pfad, Some(&fk)).await;
        assert_eq!(status, StatusCode::FORBIDDEN, "{methode} {pfad}");
    }
}

/// Mit Freischaltung: der Admin bekommt den Status „nicht importiert“ ohne Kopf und ohne
/// Bericht. Die Felder sind abwesend, nicht `null` (LFH-265).
#[tokio::test]
async fn mit_freischaltung_admin_status_nicht_importiert() {
    let (app, _pool) = common::setup_mit_optionen(RouterOptionen { demo_daten: true }).await;
    let admin = common::login_cookie(&app, "admin", "startpw12").await;

    let (status, v) = common::anfrage(&app, "GET", "/api/demo-daten", &admin, None).await;
    assert_eq!(status, StatusCode::OK, "{v}");
    assert_eq!(v["importiert"], Value::Bool(false));
    let o = v.as_object().expect("Objekt");
    assert!(!o.contains_key("import"), "import muss ABSENT sein: {v}");
    assert!(!o.contains_key("bericht"), "bericht muss ABSENT sein: {v}");
}

/// Mit Freischaltung: die schreibenden Endpunkte sind bis Block 5 Platzhalter und melden
/// 422 im Envelope — kein Stub darf still „Erfolg“ melden.
#[tokio::test]
async fn mit_freischaltung_schreibende_endpunkte_sind_noch_422() {
    let (app, _pool) = common::setup_mit_optionen(RouterOptionen { demo_daten: true }).await;
    let admin = common::login_cookie(&app, "admin", "startpw12").await;

    for (methode, pfad) in ENDPUNKTE.iter().filter(|(m, _)| *m != "GET") {
        let (status, v) = common::anfrage(&app, methode, pfad, &admin, None).await;
        assert_eq!(
            status,
            StatusCode::UNPROCESSABLE_ENTITY,
            "{methode} {pfad}: {v}"
        );
        assert!(v["error"].is_string(), "{methode} {pfad}: {v}");
    }
}

/// `build_router` ist die Vorgabe „aus“: ohne Optionen gibt es keinen Demo-Pfad.
#[tokio::test]
async fn build_router_ohne_optionen_hat_keinen_demo_pfad() {
    let app = common::setup().await;
    let admin = common::login_cookie(&app, "admin", "startpw12").await;
    let (status, _ct, _body) = roh(&app, "GET", "/api/demo-daten", Some(&admin)).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
}
