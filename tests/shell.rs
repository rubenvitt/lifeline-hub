//! Hüllen-Vertrag `GET /api/shell` (LLH-1978, Spec `huellen-vertrag`, design.md D4).
//!
//! Eine App-Hülle fragt hier ohne Anmeldung, welche Server-Version läuft und welchen
//! Hüllen-Vertrag der Server spricht. Pflichtfelder werden per `contains_key` geprüft, nicht
//! über eine feste Feldzahl: neue Felder dürfen hinzukommen (Spec, „Zusätzliches Feld“).

use axum::body::{to_bytes, Body};
use axum::http::{header, Request, StatusCode};
use lifeline_hub::app::build_router;
use lifeline_hub::db;
use lifeline_hub::live::LiveHub;
use serde_json::{json, Value};
use tower::ServiceExt; // stellt `oneshot` bereit

mod common;
use common::{anfrage_json, einsatz_anlegen, login_cookie, setup_mit_pool_und_live};

/// `GET` auf `uri`, optional mit Cookie; liefert Status und JSON-Körper.
async fn abrufen(app: &axum::Router, uri: &str, cookie: Option<&str>) -> (StatusCode, Value) {
    let mut req = Request::builder().uri(uri);
    if let Some(c) = cookie {
        req = req.header(header::COOKIE, c);
    }
    let resp = app
        .clone()
        .oneshot(req.body(Body::empty()).unwrap())
        .await
        .unwrap();
    let status = resp.status();
    let bytes = to_bytes(resp.into_body(), usize::MAX).await.unwrap();
    (
        status,
        serde_json::from_slice(&bytes).unwrap_or(Value::Null),
    )
}

/// Prüft die Pflichtfelder des Vertrags, ohne die Feldzahl festzulegen.
fn pruefe_pflichtfelder(json: &Value) {
    let objekt = json.as_object().expect("Antwort ist ein JSON-Objekt");
    assert!(objekt.contains_key("version"), "version fehlt: {json}");
    assert!(
        objekt.contains_key("shell_contract"),
        "shell_contract fehlt: {json}"
    );
    assert!(
        json["version"].is_string(),
        "version ist keine Zeichenkette"
    );
    let vertrag = json["shell_contract"]
        .as_u64()
        .expect("shell_contract ist eine ganze Zahl ≥ 0");
    assert!(
        vertrag >= 1,
        "shell_contract ist mindestens 1, war {vertrag}"
    );
    // Vertrag 2 (LLH-1979): der Login-Pfad der Hüllen heißt `/api/auth/app-code/redeem`.
    assert_eq!(vertrag, 2, "shell_contract nach LLH-1979");
}

#[tokio::test]
async fn anonymer_abruf_liefert_version_wie_health_und_vertrag() {
    let (app, _pool, _live) = setup_mit_pool_und_live().await;

    let (status, shell) = abrufen(&app, "/api/shell", None).await;
    assert_eq!(status, StatusCode::OK, "{shell}");
    pruefe_pflichtfelder(&shell);

    let (_, health) = abrufen(&app, "/api/health", None).await;
    assert_eq!(shell["version"], health["version"]);
    assert_eq!(shell["version"], env!("CARGO_PKG_VERSION"));
}

#[tokio::test]
async fn gekoppeltes_geraet_erreicht_den_vertrag() {
    let (app, _pool, _live) = setup_mit_pool_und_live().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;

    // Aktive UHS und ein daran gekoppeltes Tablet (wie in `tests/geraet_kopplung.rs`).
    let (s, v) = anfrage_json(
        &app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/uhs"),
        &admin,
        Some(&json!({"typ": "behandlungsplatz", "bezeichnung": "UHS 1"})),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{v}");
    let uhs = v["id"].as_i64().unwrap();
    let (s, _) = anfrage_json(
        &app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/uhs/{uhs}/status"),
        &admin,
        Some(&json!({"status": "aktiv"})),
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    let (s, v) = anfrage_json(
        &app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/geraete"),
        &admin,
        Some(&json!({"ansicht": "uhs-tablet", "uhs_id": uhs, "bezeichnung": "Tablet 1"})),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{v}");
    let code = v["code"]["code"].as_str().unwrap().to_string();

    let resp = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/geraete/koppeln")
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(json!({ "code": code }).to_string()))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let geraet = resp
        .headers()
        .get(header::SET_COOKIE)
        .expect("Sitzungscookie des Geräts")
        .to_str()
        .unwrap()
        .split(';')
        .next()
        .unwrap()
        .to_string();

    // Die Gerätesitzung ist wirksam: sie meldet sich als angemeldet.
    let (s, _) = abrufen(&app, "/api/auth/me", Some(&geraet)).await;
    assert_eq!(s, StatusCode::OK);

    let (status, shell) = abrufen(&app, "/api/shell", Some(&geraet)).await;
    assert_eq!(status, StatusCode::OK, "{shell}");
    pruefe_pflichtfelder(&shell);
}

#[tokio::test]
async fn vertrag_antwortet_auch_bei_gestoerter_datenbank() {
    let pool = db::test_pool().await;
    let app = build_router(common::test_state(&pool, &LiveHub::new()));
    pool.close().await; // jede Abfrage schlägt jetzt fehl

    let (status, shell) = abrufen(&app, "/api/shell", None).await;
    assert_eq!(status, StatusCode::OK, "{shell}");
    pruefe_pflichtfelder(&shell);
}
