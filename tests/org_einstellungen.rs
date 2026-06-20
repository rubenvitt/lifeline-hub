//! Integrationstests für GET/PUT /api/org-einstellungen (admin-einstellungen, Task 4).
//!
//! Berechtigungsmatrix:
//!   GET  — admin ✓, fuehrungskraft ✓, nicht eingeloggt → 401
//!   PUT  — admin ✓ (200 + persistiert), fuehrungskraft → 403, ungültig → 400

use axum::body::{to_bytes, Body};
use axum::http::{header, Request, StatusCode};
use lifeline_hub::app::{build_router, AppState};
use lifeline_hub::auth::bootstrap::bootstrap_admin;
use lifeline_hub::db;
use lifeline_hub::live::LiveHub;
use serde_json::Value;
use tower::ServiceExt;

// ----------------------------- Test-Harness -----------------------------

async fn setup() -> axum::Router {
    let pool = db::test_pool().await;
    bootstrap_admin(&pool, "Test-Orga", "admin", Some("startpw12"))
        .await
        .unwrap();
    build_router(AppState {
        pool,
        live: LiveHub::new(),
        fachebenen: lifeline_hub::karte::FachebenenState::neu(),
    })
}

/// Loggt sich ein und liefert das `name=value`-Cookie-Paar.
async fn login_cookie(app: &axum::Router, benutzername: &str, passwort: &str) -> String {
    let body = format!(r#"{{"benutzername":"{benutzername}","passwort":"{passwort}"}}"#);
    let resp = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/auth/login")
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(body))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK, "Login muss klappen");
    resp.headers()
        .get(header::SET_COOKIE)
        .unwrap()
        .to_str()
        .unwrap()
        .split(';')
        .next()
        .unwrap()
        .to_string()
}

/// Legt über die Admin-Benutzerverwaltung einen neuen Benutzer an.
async fn benutzer_anlegen(
    app: &axum::Router,
    admin_cookie: &str,
    benutzername: &str,
    passwort: &str,
    org_rolle: &str,
) {
    let body = format!(
        r#"{{"anzeigename":"{benutzername}","benutzername":"{benutzername}","passwort":"{passwort}","org_rolle":"{org_rolle}"}}"#
    );
    let resp = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/benutzer")
                .header(header::CONTENT_TYPE, "application/json")
                .header(header::COOKIE, admin_cookie)
                .body(Body::from(body))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::CREATED, "Benutzer anlegen muss klappen");
}

/// GET /api/org-einstellungen mit Cookie; liefert (StatusCode, Body).
async fn get_einstellungen(app: &axum::Router, cookie: Option<&str>) -> (StatusCode, Value) {
    let mut builder = Request::builder()
        .method("GET")
        .uri("/api/org-einstellungen");
    if let Some(c) = cookie {
        builder = builder.header(header::COOKIE, c);
    }
    let resp = app
        .clone()
        .oneshot(builder.body(Body::empty()).unwrap())
        .await
        .unwrap();
    let status = resp.status();
    let bytes = to_bytes(resp.into_body(), usize::MAX).await.unwrap();
    let body = if bytes.is_empty() {
        Value::Null
    } else {
        serde_json::from_slice(&bytes).unwrap_or(Value::Null)
    };
    (status, body)
}

/// PUT /api/org-einstellungen mit Cookie und Body; liefert (StatusCode, Body).
async fn put_einstellungen(
    app: &axum::Router,
    cookie: &str,
    body: serde_json::Value,
) -> (StatusCode, Value) {
    let resp = app
        .clone()
        .oneshot(
            Request::builder()
                .method("PUT")
                .uri("/api/org-einstellungen")
                .header(header::CONTENT_TYPE, "application/json")
                .header(header::COOKIE, cookie)
                .body(Body::from(body.to_string()))
                .unwrap(),
        )
        .await
        .unwrap();
    let status = resp.status();
    let bytes = to_bytes(resp.into_body(), usize::MAX).await.unwrap();
    let body = if bytes.is_empty() {
        Value::Null
    } else {
        serde_json::from_slice(&bytes).unwrap_or(Value::Null)
    };
    (status, body)
}

// ----------------------------- Tests -----------------------------

/// GET als Führungskraft → 200 (darf lesen).
#[tokio::test]
async fn get_als_fuehrungskraft_liefert_200() {
    let app = setup().await;
    let admin_cookie = login_cookie(&app, "admin", "startpw12").await;

    benutzer_anlegen(&app, &admin_cookie, "fk", "fkpw1234", "fuehrungskraft").await;
    let fk_cookie = login_cookie(&app, "fk", "fkpw1234").await;

    let (status, _body) = get_einstellungen(&app, Some(&fk_cookie)).await;
    assert_eq!(status, StatusCode::OK);
}

/// PUT als Führungskraft → 403 (darf nicht schreiben).
#[tokio::test]
async fn put_als_fuehrungskraft_ist_403() {
    let app = setup().await;
    let admin_cookie = login_cookie(&app, "admin", "startpw12").await;

    benutzer_anlegen(&app, &admin_cookie, "fk", "fkpw1234", "fuehrungskraft").await;
    let fk_cookie = login_cookie(&app, "fk", "fkpw1234").await;

    let (status, _body) = put_einstellungen(
        &app,
        &fk_cookie,
        serde_json::json!({"zeitzone": "Europe/Berlin"}),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
}

/// PUT als Admin mit gültigen Daten → 200 und persistiert (Re-GET liefert Werte).
#[tokio::test]
async fn put_als_admin_gueltig_persistiert() {
    let app = setup().await;
    let admin_cookie = login_cookie(&app, "admin", "startpw12").await;

    let body = serde_json::json!({
        "zeitzone": "Europe/Berlin",
        "zeitformat": "24h",
        "einheiten": "metrisch",
        "koordinatenformat": "mgrs",
        "retention_dauer_tage": 365,
        "etb_nummer_praefix": "EB-",
        "meldung_bestaetigung_frist_min": 30,
        "auftrag_quittierung_frist_min": 45,
        "auto_etb_eintraege": false
    });

    let (status, resp_body) = put_einstellungen(&app, &admin_cookie, body).await;
    assert_eq!(status, StatusCode::OK, "PUT muss 200 liefern; body={resp_body}");

    // Persistenz: Re-GET liefert dieselben Werte.
    let (get_status, get_body) = get_einstellungen(&app, Some(&admin_cookie)).await;
    assert_eq!(get_status, StatusCode::OK);
    assert_eq!(get_body["zeitzone"], "Europe/Berlin");
    assert_eq!(get_body["zeitformat"], "24h");
    assert_eq!(get_body["einheiten"], "metrisch");
    assert_eq!(get_body["koordinatenformat"], "mgrs");
    assert_eq!(get_body["retention_dauer_tage"], 365);
    assert_eq!(get_body["etb_nummer_praefix"], "EB-");
    assert_eq!(get_body["meldung_bestaetigung_frist_min"], 30);
    assert_eq!(get_body["auftrag_quittierung_frist_min"], 45);
    assert_eq!(get_body["auto_etb_eintraege"], 0); // false → 0
}

/// PUT als Admin mit `retention_dauer_tage=0` → 400 (0 ist ungültig; 1..=3650).
#[tokio::test]
async fn put_als_admin_ungueltig_retention_null_ist_400() {
    let app = setup().await;
    let admin_cookie = login_cookie(&app, "admin", "startpw12").await;

    let (status, _body) = put_einstellungen(
        &app,
        &admin_cookie,
        serde_json::json!({"retention_dauer_tage": 0}),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
}

/// GET ohne eingeloggten Benutzer → 401.
#[tokio::test]
async fn get_ohne_login_ist_401() {
    let app = setup().await;
    let (status, _body) = get_einstellungen(&app, None).await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
}

// ─── Modul-Rollen-Defaults (Task 5) ────────────────────────────────────────

/// GET /api/org-modul-einstellungen mit Cookie; liefert (StatusCode, Body).
async fn get_modul_einstellungen(app: &axum::Router, cookie: &str) -> (StatusCode, Value) {
    let resp = app
        .clone()
        .oneshot(
            Request::builder()
                .method("GET")
                .uri("/api/org-modul-einstellungen")
                .header(header::COOKIE, cookie)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    let status = resp.status();
    let bytes = to_bytes(resp.into_body(), usize::MAX).await.unwrap();
    let body = if bytes.is_empty() {
        Value::Null
    } else {
        serde_json::from_slice(&bytes).unwrap_or(Value::Null)
    };
    (status, body)
}

/// PUT /api/org-modul-einstellungen/:modul_key mit Cookie und Body; liefert (StatusCode, Body).
async fn put_modul_einstellung(
    app: &axum::Router,
    cookie: &str,
    modul_key: &str,
    body: serde_json::Value,
) -> (StatusCode, Value) {
    let resp = app
        .clone()
        .oneshot(
            Request::builder()
                .method("PUT")
                .uri(format!("/api/org-modul-einstellungen/{modul_key}"))
                .header(header::CONTENT_TYPE, "application/json")
                .header(header::COOKIE, cookie)
                .body(Body::from(body.to_string()))
                .unwrap(),
        )
        .await
        .unwrap();
    let status = resp.status();
    let bytes = to_bytes(resp.into_body(), usize::MAX).await.unwrap();
    let body = if bytes.is_empty() {
        Value::Null
    } else {
        serde_json::from_slice(&bytes).unwrap_or(Value::Null)
    };
    (status, body)
}

/// GET als Führungskraft → 200 (Map der Modul-Rollen-Defaults).
#[tokio::test]
async fn modul_get_als_fuehrungskraft_liefert_200() {
    let app = setup().await;
    let admin_cookie = login_cookie(&app, "admin", "startpw12").await;

    benutzer_anlegen(&app, &admin_cookie, "fk2", "fkpw5678", "fuehrungskraft").await;
    let fk_cookie = login_cookie(&app, "fk2", "fkpw5678").await;

    let (status, body) = get_modul_einstellungen(&app, &fk_cookie).await;
    assert_eq!(status, StatusCode::OK, "body={body}");
    // Leere Map, noch kein Default gesetzt.
    assert!(body.is_object(), "Antwort muss ein Objekt sein");
}

/// PUT als Führungskraft → 403 (nur admin darf schreiben).
#[tokio::test]
async fn modul_put_als_fuehrungskraft_ist_403() {
    let app = setup().await;
    let admin_cookie = login_cookie(&app, "admin", "startpw12").await;

    benutzer_anlegen(&app, &admin_cookie, "fk3", "fkpw9012", "fuehrungskraft").await;
    let fk_cookie = login_cookie(&app, "fk3", "fkpw9012").await;

    let (status, _body) =
        put_modul_einstellung(&app, &fk_cookie, "etb", serde_json::json!({"benoetigte_rolle": "fuehrungskraft"})).await;
    assert_eq!(status, StatusCode::FORBIDDEN);
}

/// PUT als Admin mit gültigem modul_key + gültiger Rolle → 200, persistiert in GET.
#[tokio::test]
async fn modul_put_als_admin_gueltig_persistiert() {
    let app = setup().await;
    let admin_cookie = login_cookie(&app, "admin", "startpw12").await;

    let (status, body) = put_modul_einstellung(
        &app,
        &admin_cookie,
        "etb",
        serde_json::json!({"benoetigte_rolle": "fuehrungskraft"}),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "PUT muss 200 liefern; body={body}");

    // Persistenz: Re-GET enthält den Eintrag.
    let (get_status, get_body) = get_modul_einstellungen(&app, &admin_cookie).await;
    assert_eq!(get_status, StatusCode::OK);
    assert_eq!(
        get_body["etb"],
        Value::String("fuehrungskraft".to_string()),
        "Map muss etb→fuehrungskraft enthalten; body={get_body}"
    );
}

/// PUT mit unbekanntem modul_key → 400.
#[tokio::test]
async fn modul_put_ungueltiiger_modul_key_ist_400() {
    let app = setup().await;
    let admin_cookie = login_cookie(&app, "admin", "startpw12").await;

    let (status, _body) = put_modul_einstellung(
        &app,
        &admin_cookie,
        "gibtsnicht",
        serde_json::json!({"benoetigte_rolle": "admin"}),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
}

/// PUT mit ungültiger Rolle ('quatsch') → 400.
#[tokio::test]
async fn modul_put_ungueltige_rolle_ist_400() {
    let app = setup().await;
    let admin_cookie = login_cookie(&app, "admin", "startpw12").await;

    let (status, _body) = put_modul_einstellung(
        &app,
        &admin_cookie,
        "etb",
        serde_json::json!({"benoetigte_rolle": "quatsch"}),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
}

/// GET /api/org-einstellungen als Benutzer mit org_rolle=keine → 403.
#[tokio::test]
async fn get_als_keine_liefert_403() {
    let app = setup().await;
    let admin_cookie = login_cookie(&app, "admin", "startpw12").await;

    benutzer_anlegen(&app, &admin_cookie, "kein1", "keinpw12", "keine").await;
    let kein_cookie = login_cookie(&app, "kein1", "keinpw12").await;

    let (status, _body) = get_einstellungen(&app, Some(&kein_cookie)).await;
    assert_eq!(status, StatusCode::FORBIDDEN);
}

/// GET /api/org-modul-einstellungen als Benutzer mit org_rolle=keine → 403.
#[tokio::test]
async fn modul_get_als_keine_liefert_403() {
    let app = setup().await;
    let admin_cookie = login_cookie(&app, "admin", "startpw12").await;

    benutzer_anlegen(&app, &admin_cookie, "kein2", "keinpw12", "keine").await;
    let kein_cookie = login_cookie(&app, "kein2", "keinpw12").await;

    let (status, _body) = get_modul_einstellungen(&app, &kein_cookie).await;
    assert_eq!(status, StatusCode::FORBIDDEN);
}

/// PUT mit gültiger geocoder_url → 200, GET zeigt die URL; PUT mit ftp:// → 400.
#[tokio::test]
async fn put_geocoder_url_gueltig_und_ungueltig() {
    let app = setup().await;
    let admin_cookie = login_cookie(&app, "admin", "startpw12").await;

    // Gültige URL: PUT → 200, GET zeigt den Wert.
    let (status, resp_body) = put_einstellungen(
        &app,
        &admin_cookie,
        serde_json::json!({"geocoder_url": "https://nominatim.example.org"}),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "PUT mit gültiger geocoder_url muss 200 liefern; body={resp_body}");

    let (get_status, get_body) = get_einstellungen(&app, Some(&admin_cookie)).await;
    assert_eq!(get_status, StatusCode::OK);
    assert_eq!(get_body["geocoder_url"], "https://nominatim.example.org");

    // Ungültige URL (ftp://): PUT → 400.
    let (status_bad, _body_bad) = put_einstellungen(
        &app,
        &admin_cookie,
        serde_json::json!({"geocoder_url": "ftp://x"}),
    )
    .await;
    assert_eq!(status_bad, StatusCode::BAD_REQUEST, "PUT mit ftp:// muss 400 liefern");
}

/// PUT mit modul_key aus NICHT_AUSBLENDBAR → 200 (Rollen-Default ≠ Sichtbarkeit, kein Sonderfall).
#[tokio::test]
async fn modul_put_nicht_ausblendbar_key_ist_erlaubt() {
    let app = setup().await;
    let admin_cookie = login_cookie(&app, "admin", "startpw12").await;

    // 'einsatzdaten' ist NICHT_AUSBLENDBAR, aber ein gültiger modul_key.
    let (status, body) = put_modul_einstellung(
        &app,
        &admin_cookie,
        "einsatzdaten",
        serde_json::json!({"benoetigte_rolle": "fuehrungskraft"}),
    )
    .await;
    assert_eq!(
        status,
        StatusCode::OK,
        "NICHT_AUSBLENDBAR-Key muss als Rollen-Default setzbar sein; body={body}"
    );
}
