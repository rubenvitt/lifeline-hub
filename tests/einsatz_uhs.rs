//! HTTP-Integrationstests für Unfallhilfsstellen (E-3):
//! Lifecycle/Status, Belegung, Plätze (1:1-Garantie + Reservierung +
//! Auto-Aufbereitung), Cross-Modul-Wirkung (Person-Status/Verbleib/Storno),
//! ETB-Pseudonymisierung, Rechte-Matrix, Cross-Einsatz-404 und
//! Read-only-409 für abgeschlossene Einsätze.

use axum::body::{to_bytes, Body};
use axum::http::{header, Request, StatusCode};
use lifeline_hub::app::{build_router, AppState};
use lifeline_hub::auth::bootstrap::bootstrap_admin;
use lifeline_hub::db;
use lifeline_hub::live::LiveHub;
use serde_json::{json, Value};
use tower::ServiceExt;

// ---------- Harness (an tests/einsatz_person.rs angelehnt) ----------

/// Liefert Router + Pool (Pool wird für DB-Direktquery-Verifikation und
/// für den Test-Shortcut „Einsatz abschließen" benötigt). `SqlitePool` ist
/// billig klonbar und teilt dieselbe In-Memory-DB.
async fn setup_mit_pool() -> (axum::Router, sqlx::SqlitePool) {
    let pool = db::test_pool().await;
    bootstrap_admin(&pool, "Test-Orga", "admin", Some("startpw12"))
        .await
        .unwrap();
    let router = build_router(AppState {
        pool: pool.clone(),
        live: LiveHub::new(),
    });
    (router, pool)
}

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
    assert_eq!(resp.status(), StatusCode::OK);
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

/// Generischer JSON-Request-Helfer: liefert (Status, JSON-Body).
/// `body` als `serde_json::Value` ist kompakter als String-Formatting.
async fn json_request(
    app: &axum::Router,
    method: &str,
    uri: &str,
    cookie: &str,
    body: Option<&Value>,
) -> (StatusCode, Value) {
    let mut req = Request::builder()
        .method(method)
        .uri(uri)
        .header(header::COOKIE, cookie);
    let body = match body {
        Some(b) => {
            req = req.header(header::CONTENT_TYPE, "application/json");
            Body::from(b.to_string())
        }
        None => Body::empty(),
    };
    let resp = app.clone().oneshot(req.body(body).unwrap()).await.unwrap();
    let status = resp.status();
    let bytes = to_bytes(resp.into_body(), 1024 * 1024).await.unwrap();
    let value = if bytes.is_empty() {
        Value::Null
    } else {
        serde_json::from_slice(&bytes).unwrap_or(Value::Null)
    };
    (status, value)
}

// ---------- Domänen-Helfer ----------

/// Legt einen Einsatz an (Body wie in tests/einsatz_person.rs).
async fn einsatz_anlegen(app: &axum::Router, cookie: &str) -> i64 {
    let (s, v) = json_request(
        app,
        "POST",
        "/api/einsaetze",
        cookie,
        Some(&json!({"bezeichnung": "Lage"})),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED);
    v["id"].as_i64().unwrap()
}

/// Legt eine Person ohne identifizierende Felder an.
async fn person_anlegen(app: &axum::Router, cookie: &str, einsatz: i64) -> i64 {
    let (s, v) = json_request(
        app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/personen"),
        cookie,
        Some(&json!({})),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED);
    v["id"].as_i64().unwrap()
}

/// Legt eine UHS an und versetzt sie sofort in den Status `aktiv`.
async fn uhs_anlegen_und_aktivieren(
    app: &axum::Router,
    cookie: &str,
    einsatz: i64,
    bez: &str,
) -> i64 {
    let (s, v) = json_request(
        app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/uhs"),
        cookie,
        Some(&json!({"typ": "behandlungsplatz", "bezeichnung": bez})),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED);
    let uhs = v["id"].as_i64().unwrap();
    let (s, _) = json_request(
        app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/uhs/{uhs}/status"),
        cookie,
        Some(&json!({"status": "aktiv"})),
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    uhs
}

/// Legt einen Platz in einer UHS an.
async fn platz_anlegen(
    app: &axum::Router,
    cookie: &str,
    einsatz: i64,
    uhs: i64,
    bez: &str,
) -> i64 {
    let (s, v) = json_request(
        app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/uhs/{uhs}/plaetze"),
        cookie,
        Some(&json!({"typ": "bett", "bezeichnung": bez})),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED);
    v["id"].as_i64().unwrap()
}

/// Inhalte aller System-ETB-Einträge eines Einsatzes (chronologisch).
async fn etb_inhalte(app: &axum::Router, cookie: &str, einsatz: i64) -> Vec<String> {
    let (_, v) = json_request(
        app,
        "GET",
        &format!("/api/einsaetze/{einsatz}/etb"),
        cookie,
        None,
    )
    .await;
    v.as_array()
        .unwrap()
        .iter()
        .filter(|e| e["typ"] == "system")
        .map(|e| e["inhalt"].as_str().unwrap_or("").to_string())
        .collect()
}

// ============================== Tests ==============================

#[tokio::test]
async fn anlegen_liefert_geplant_und_keinen_etb() {
    let (app, _) = setup_mit_pool().await;
    let cookie = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &cookie).await;
    let (s, v) = json_request(
        &app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/uhs"),
        &cookie,
        Some(&json!({"typ": "behandlungsplatz", "bezeichnung": "BHP 50"})),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED);
    assert_eq!(v["status"], "geplant");
    let inhalte = etb_inhalte(&app, &cookie, einsatz).await;
    assert!(
        inhalte.iter().all(|s| !s.contains("BHP 50")),
        "Anlegen schreibt KEINEN ETB-Eintrag (Spec): {inhalte:?}"
    );
}

#[tokio::test]
async fn status_aktiv_schreibt_etb_in_betrieb_genommen() {
    let (app, _) = setup_mit_pool().await;
    let cookie = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &cookie).await;
    let _uhs = uhs_anlegen_und_aktivieren(&app, &cookie, einsatz, "BHP 50").await;
    let inhalte = etb_inhalte(&app, &cookie, einsatz).await;
    assert!(
        inhalte
            .iter()
            .any(|s| s.contains("BHP 50") && s.contains("in Betrieb genommen")),
        "Inbetriebnahme-ETB-Eintrag mit Typ-Label erwartet, gefunden: {inhalte:?}"
    );
}

#[tokio::test]
async fn ungueltiger_status_uebergang_ist_422() {
    let (app, _) = setup_mit_pool().await;
    let cookie = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &cookie).await;
    let (_, v) = json_request(
        &app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/uhs"),
        &cookie,
        Some(&json!({"typ": "behandlungsplatz", "bezeichnung": "BHP 50"})),
    )
    .await;
    let uhs = v["id"].as_i64().unwrap();
    // geplant → aufgeloest (terminal) → versuch aktiv:
    let (s_ok, _) = json_request(
        &app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/uhs/{uhs}/status"),
        &cookie,
        Some(&json!({"status": "aufgeloest"})),
    )
    .await;
    assert_eq!(s_ok, StatusCode::OK);
    let (s, _) = json_request(
        &app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/uhs/{uhs}/status"),
        &cookie,
        Some(&json!({"status": "aktiv"})),
    )
    .await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY);
}

#[tokio::test]
async fn geplante_uhs_akzeptiert_keine_belegung() {
    let (app, _) = setup_mit_pool().await;
    let cookie = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &cookie).await;
    let person = person_anlegen(&app, &cookie, einsatz).await;
    let (_, v) = json_request(
        &app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/uhs"),
        &cookie,
        Some(&json!({"typ": "behandlungsplatz", "bezeichnung": "BHP 50"})),
    )
    .await;
    let uhs = v["id"].as_i64().unwrap();
    let (s, _) = json_request(
        &app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/personen/{person}/uhs-belegung"),
        &cookie,
        Some(&json!({"art": "eintritt", "uhs_id": uhs})),
    )
    .await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY);
}

#[tokio::test]
async fn aufloesen_blockt_bei_aktiver_belegung_409() {
    let (app, _) = setup_mit_pool().await;
    let cookie = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &cookie).await;
    let uhs = uhs_anlegen_und_aktivieren(&app, &cookie, einsatz, "BHP 50").await;
    let person = person_anlegen(&app, &cookie, einsatz).await;
    let (s, _) = json_request(
        &app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/personen/{person}/uhs-belegung"),
        &cookie,
        Some(&json!({"art": "eintritt", "uhs_id": uhs})),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED);
    // Status-Wechsel aufgeloest:
    let (s, _) = json_request(
        &app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/uhs/{uhs}/status"),
        &cookie,
        Some(&json!({"status": "aufgeloest"})),
    )
    .await;
    assert_eq!(s, StatusCode::CONFLICT, "Auflösung bei Belegung → 409");
    // Storno-Verhalten identisch:
    let (s, _) = json_request(
        &app,
        "DELETE",
        &format!("/api/einsaetze/{einsatz}/uhs/{uhs}"),
        &cookie,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::CONFLICT, "Storno bei Belegung → 409");
}

#[tokio::test]
async fn inbox_mehrfach_belegung_erlaubt() {
    let (app, _) = setup_mit_pool().await;
    let cookie = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &cookie).await;
    let uhs = uhs_anlegen_und_aktivieren(&app, &cookie, einsatz, "BHP 50").await;
    let p1 = person_anlegen(&app, &cookie, einsatz).await;
    let p2 = person_anlegen(&app, &cookie, einsatz).await;
    for p in [p1, p2] {
        let (s, _) = json_request(
            &app,
            "POST",
            &format!("/api/einsaetze/{einsatz}/personen/{p}/uhs-belegung"),
            &cookie,
            Some(&json!({"art": "eintritt", "uhs_id": uhs})),
        )
        .await;
        assert_eq!(
            s,
            StatusCode::CREATED,
            "Inbox-Mehrfach-Belegung erlaubt (kein 1:1-Zwang ohne Platz)"
        );
    }
}

#[tokio::test]
async fn doppelbelegung_eines_platzes_ist_konflikt() {
    let (app, _) = setup_mit_pool().await;
    let cookie = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &cookie).await;
    let uhs = uhs_anlegen_und_aktivieren(&app, &cookie, einsatz, "BHP 50").await;
    let platz = platz_anlegen(&app, &cookie, einsatz, uhs, "Bett 3").await;
    let p1 = person_anlegen(&app, &cookie, einsatz).await;
    let p2 = person_anlegen(&app, &cookie, einsatz).await;
    let body = json!({"art": "eintritt", "uhs_id": uhs, "platz_id": platz});
    let (s, _) = json_request(
        &app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/personen/{p1}/uhs-belegung"),
        &cookie,
        Some(&body),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED);
    let (s, _) = json_request(
        &app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/personen/{p2}/uhs-belegung"),
        &cookie,
        Some(&body),
    )
    .await;
    assert_eq!(s, StatusCode::CONFLICT, "1:1-Belegung pro Platz erzwungen");
}

#[tokio::test]
async fn auto_aufbereitung_und_etb_text_inbox() {
    let (app, pool) = setup_mit_pool().await;
    let cookie = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &cookie).await;
    let uhs = uhs_anlegen_und_aktivieren(&app, &cookie, einsatz, "BHP 50").await;
    let platz = platz_anlegen(&app, &cookie, einsatz, uhs, "Bett 3").await;
    let person = person_anlegen(&app, &cookie, einsatz).await;
    // Eintritt auf Platz + expliziter Austritt → Aufbereitung + zwei ETB-Texte:
    let (s, _) = json_request(
        &app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/personen/{person}/uhs-belegung"),
        &cookie,
        Some(&json!({"art": "eintritt", "uhs_id": uhs, "platz_id": platz})),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED);
    let (s, _) = json_request(
        &app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/personen/{person}/uhs-belegung"),
        &cookie,
        Some(&json!({"art": "austritt"})),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED);
    let verf: String = sqlx::query_scalar("SELECT verfuegbarkeit FROM uhs_platz WHERE id = ?")
        .bind(platz)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(verf, "aufbereitung", "Platz wechselt nach Austritt automatisch in Aufbereitung");
    let inhalte = etb_inhalte(&app, &cookie, einsatz).await;
    assert!(
        inhalte
            .iter()
            .any(|s| s.contains("Aufnahme in BHP 50") && s.contains("Bett 3")),
        "Eintritt-ETB-Text mit Platz, fand: {inhalte:?}"
    );
    assert!(
        inhalte.iter().any(|s| s.contains("verlässt BHP 50")),
        "Austritt-ETB-Text, fand: {inhalte:?}"
    );
}

#[tokio::test]
async fn reservierte_person_belegt_loest_reservierung() {
    let (app, pool) = setup_mit_pool().await;
    let cookie = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &cookie).await;
    let uhs = uhs_anlegen_und_aktivieren(&app, &cookie, einsatz, "BHP 50").await;
    let platz = platz_anlegen(&app, &cookie, einsatz, uhs, "Bett 3").await;
    let person = person_anlegen(&app, &cookie, einsatz).await;
    let (s, _) = json_request(
        &app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/uhs/{uhs}/plaetze/{platz}/verfuegbarkeit"),
        &cookie,
        Some(&json!({"verfuegbarkeit": "reserviert", "reserviert_fuer_person_id": person})),
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    // Belegen mit der reservierten Person → erlaubt + Reservierung weg:
    let (s, _) = json_request(
        &app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/personen/{person}/uhs-belegung"),
        &cookie,
        Some(&json!({"art": "eintritt", "uhs_id": uhs, "platz_id": platz})),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED);
    let (v, fk): (String, Option<i64>) =
        sqlx::query_as("SELECT verfuegbarkeit, reserviert_fuer_person_id FROM uhs_platz WHERE id = ?")
            .bind(platz)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(v, "frei", "Reservierung wird durch Eintritt der gleichen Person eingelöst");
    assert!(fk.is_none(), "reserviert_fuer_person_id wird zurückgesetzt");
}

#[tokio::test]
async fn fremde_person_auf_reservierten_platz_ist_422() {
    let (app, _) = setup_mit_pool().await;
    let cookie = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &cookie).await;
    let uhs = uhs_anlegen_und_aktivieren(&app, &cookie, einsatz, "BHP 50").await;
    let platz = platz_anlegen(&app, &cookie, einsatz, uhs, "Bett 3").await;
    let p_res = person_anlegen(&app, &cookie, einsatz).await;
    let p_andere = person_anlegen(&app, &cookie, einsatz).await;
    let (s, _) = json_request(
        &app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/uhs/{uhs}/plaetze/{platz}/verfuegbarkeit"),
        &cookie,
        Some(&json!({"verfuegbarkeit": "reserviert", "reserviert_fuer_person_id": p_res})),
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    let (s, _) = json_request(
        &app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/personen/{p_andere}/uhs-belegung"),
        &cookie,
        Some(&json!({"art": "eintritt", "uhs_id": uhs, "platz_id": platz})),
    )
    .await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY);
}

#[tokio::test]
async fn cross_modul_status_verstorben_loest_auto_austritt_aus() {
    let (app, _) = setup_mit_pool().await;
    let cookie = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &cookie).await;
    let uhs = uhs_anlegen_und_aktivieren(&app, &cookie, einsatz, "BHP 50").await;
    let person = person_anlegen(&app, &cookie, einsatz).await;
    // Status auf betroffen (für sauberen Übergang):
    let (s, _) = json_request(
        &app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/personen/{person}/status"),
        &cookie,
        Some(&json!({"status": "betroffen"})),
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    let (s, _) = json_request(
        &app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/personen/{person}/uhs-belegung"),
        &cookie,
        Some(&json!({"art": "eintritt", "uhs_id": uhs})),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED);
    // Status → verstorben löst Auto-Austritt aus:
    let (s, _) = json_request(
        &app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/personen/{person}/status"),
        &cookie,
        Some(&json!({"status": "verstorben"})),
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    let inhalte = etb_inhalte(&app, &cookie, einsatz).await;
    // ZWEI relevante Einträge: Status-Wechsel + Auto-Austritt mit Anlass:
    assert!(
        inhalte
            .iter()
            .any(|s| s.contains("betroffen") && s.contains("verstorben")),
        "Status-Wechsel-ETB erwartet, fand: {inhalte:?}"
    );
    assert!(
        inhalte
            .iter()
            .any(|s| s.contains("verlässt BHP 50")
                && s.contains("Status-Wechsel zu verstorben")),
        "Auto-Austritt-ETB mit Anlass erwartet, fand: {inhalte:?}"
    );
}

#[tokio::test]
async fn cross_modul_verbleib_transport_loest_auto_austritt_aus() {
    let (app, _) = setup_mit_pool().await;
    let cookie = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &cookie).await;
    let uhs = uhs_anlegen_und_aktivieren(&app, &cookie, einsatz, "BHP 50").await;
    let person = person_anlegen(&app, &cookie, einsatz).await;
    let (s, _) = json_request(
        &app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/personen/{person}/status"),
        &cookie,
        Some(&json!({"status": "betroffen"})),
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    let (s, _) = json_request(
        &app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/personen/{person}/uhs-belegung"),
        &cookie,
        Some(&json!({"art": "eintritt", "uhs_id": uhs})),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED);
    let (s, _) = json_request(
        &app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/personen/{person}/verbleib"),
        &cookie,
        Some(&json!({"art": "transport", "ziel": "KH Mitte"})),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED);
    let inhalte = etb_inhalte(&app, &cookie, einsatz).await;
    assert!(
        inhalte
            .iter()
            .any(|s| s.contains("verlässt BHP 50") && s.contains("Verbleib transport")),
        "Auto-Austritt-ETB mit Verbleib-Anlass erwartet, fand: {inhalte:?}"
    );
}

#[tokio::test]
async fn cross_modul_storno_loest_reservierung_auf_auch_ohne_belegung() {
    let (app, pool) = setup_mit_pool().await;
    let cookie = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &cookie).await;
    let uhs = uhs_anlegen_und_aktivieren(&app, &cookie, einsatz, "BHP 50").await;
    let platz = platz_anlegen(&app, &cookie, einsatz, uhs, "Bett 3").await;
    let person = person_anlegen(&app, &cookie, einsatz).await;
    let (s, _) = json_request(
        &app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/uhs/{uhs}/plaetze/{platz}/verfuegbarkeit"),
        &cookie,
        Some(&json!({"verfuegbarkeit": "reserviert", "reserviert_fuer_person_id": person})),
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    // Person stornieren (NICHT belegt) → Reservierungs-Cleanup muss trotzdem laufen:
    let (s, _) = json_request(
        &app,
        "DELETE",
        &format!("/api/einsaetze/{einsatz}/personen/{person}"),
        &cookie,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::NO_CONTENT);
    let (v, fk): (String, Option<i64>) =
        sqlx::query_as("SELECT verfuegbarkeit, reserviert_fuer_person_id FROM uhs_platz WHERE id = ?")
            .bind(platz)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(v, "frei", "Reservierung wird durch Storno der Person aufgelöst");
    assert!(fk.is_none(), "reserviert_fuer_person_id wird zurückgesetzt");
}

#[tokio::test]
async fn etb_text_enthaelt_nur_pseudonym_keinen_namen() {
    let (app, _) = setup_mit_pool().await;
    let cookie = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &cookie).await;
    let uhs = uhs_anlegen_und_aktivieren(&app, &cookie, einsatz, "BHP 50").await;
    let (s, v) = json_request(
        &app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/personen"),
        &cookie,
        Some(&json!({"name": "Müller", "vorname": "Anna"})),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED);
    let person = v["id"].as_i64().unwrap();
    let (s, _) = json_request(
        &app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/personen/{person}/uhs-belegung"),
        &cookie,
        Some(&json!({"art": "eintritt", "uhs_id": uhs})),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED);
    let inhalte = etb_inhalte(&app, &cookie, einsatz).await;
    for inh in &inhalte {
        assert!(!inh.contains("Müller"), "ETB-Leak Name: {inh}");
        assert!(!inh.contains("Anna"), "ETB-Leak Vorname: {inh}");
    }
}

#[tokio::test]
async fn material_verortung_schreibt_keinen_etb() {
    let (app, _) = setup_mit_pool().await;
    let cookie = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &cookie).await;
    let uhs = uhs_anlegen_und_aktivieren(&app, &cookie, einsatz, "BHP 50").await;
    // Material ad-hoc disponieren (schreibt selbst einen ETB-Eintrag):
    let (s, v) = json_request(
        &app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/material"),
        &cookie,
        Some(&json!({"adhoc": {"bezeichnung": "Wolldecke"}, "menge": 10})),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED);
    let em = v["id"].as_i64().unwrap();
    // Snapshot NACH Disponierung — wir messen nur die Wirkung der Verortung:
    let vorher = etb_inhalte(&app, &cookie, einsatz).await.len();
    let (s, _) = json_request(
        &app,
        "PATCH",
        &format!("/api/einsaetze/{einsatz}/material/{em}"),
        &cookie,
        Some(&json!({"uhs_id": uhs})),
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    let nachher = etb_inhalte(&app, &cookie, einsatz).await.len();
    assert_eq!(
        vorher, nachher,
        "Material-Verortung allein schreibt KEINEN ETB-Eintrag"
    );
}

#[tokio::test]
async fn beobachter_kann_keine_uhs_anlegen() {
    let (app, _) = setup_mit_pool().await;
    let admin_cookie = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin_cookie).await;
    // Beobachter-Benutzer (org_rolle default `keine`):
    let (s, v) = json_request(
        &app,
        "POST",
        "/api/benutzer",
        &admin_cookie,
        Some(&json!({
            "anzeigename": "Beob",
            "benutzername": "beob",
            "passwort": "startpw12"
        })),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED);
    let beob_id = v["id"].as_i64().unwrap();
    // Mitgliedschaft als Beobachter:
    let (s, _) = json_request(
        &app,
        "PUT",
        &format!("/api/einsaetze/{einsatz}/mitglieder/{beob_id}"),
        &admin_cookie,
        Some(&json!({"einsatz_rolle": "beobachter"})),
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    let beob_cookie = login_cookie(&app, "beob", "startpw12").await;
    let (s, _) = json_request(
        &app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/uhs"),
        &beob_cookie,
        Some(&json!({"typ": "behandlungsplatz", "bezeichnung": "BHP 50"})),
    )
    .await;
    assert_eq!(s, StatusCode::FORBIDDEN, "Beobachter darf nicht schreiben");
}

#[tokio::test]
async fn fremder_einsatz_ist_404() {
    let (app, _) = setup_mit_pool().await;
    let cookie = login_cookie(&app, "admin", "startpw12").await;
    let einsatz_a = einsatz_anlegen(&app, &cookie).await;
    let einsatz_b = einsatz_anlegen(&app, &cookie).await;
    let uhs_a = uhs_anlegen_und_aktivieren(&app, &cookie, einsatz_a, "BHP A").await;
    // UHS aus Einsatz A über Einsatz B abrufen → 404:
    let (s, _) = json_request(
        &app,
        "GET",
        &format!("/api/einsaetze/{einsatz_b}/uhs/{uhs_a}"),
        &cookie,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn abgeschlossener_einsatz_blockt_schreibrouten() {
    let (app, pool) = setup_mit_pool().await;
    let cookie = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &cookie).await;
    let uhs = uhs_anlegen_und_aktivieren(&app, &cookie, einsatz, "BHP 50").await;
    // Einsatz direkt in DB abschließen (Test-Shortcut, umgeht Abschluss-Route mit
    // Nachlauffrist-Effekten — wir wollen nur `fordere_aktiv` testen):
    sqlx::query(
        "UPDATE einsatz SET status = 'abgeschlossen', \
         abgeschlossen_at = strftime('%Y-%m-%d %H:%M:%S','now') WHERE id = ?",
    )
    .bind(einsatz)
    .execute(&pool)
    .await
    .unwrap();
    let (s, _) = json_request(
        &app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/uhs/{uhs}/status"),
        &cookie,
        Some(&json!({"status": "aufgeloest"})),
    )
    .await;
    assert_eq!(
        s,
        StatusCode::CONFLICT,
        "fordere_aktiv blockt Schreibrouten auf abgeschlossenen Einsätzen"
    );
}

#[tokio::test]
async fn verorten_setzt_lat_lon_und_liste_liefert_sie() {
    let (app, _) = setup_mit_pool().await;
    let cookie = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &cookie).await;
    let (s, v) = json_request(
        &app, "POST", &format!("/api/einsaetze/{einsatz}/uhs"), &cookie,
        Some(&json!({"typ": "behandlungsplatz", "bezeichnung": "BHP 50"})),
    ).await;
    assert_eq!(s, StatusCode::CREATED);
    let uhs_id = v["id"].as_i64().unwrap();

    let (s, v) = json_request(
        &app, "PATCH", &format!("/api/einsaetze/{einsatz}/uhs/{uhs_id}"), &cookie,
        Some(&json!({"lat": 50.1, "lon": 8.6})),
    ).await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(v["lat"].as_f64(), Some(50.1));
    assert_eq!(v["lon"].as_f64(), Some(8.6));

    let (s, liste) = json_request(
        &app, "GET", &format!("/api/einsaetze/{einsatz}/uhs"), &cookie, None,
    ).await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(liste[0]["lat"].as_f64(), Some(50.1));
}

#[tokio::test]
async fn verorten_loeschen_setzt_beide_auf_null() {
    let (app, _) = setup_mit_pool().await;
    let cookie = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &cookie).await;
    let (_s, v) = json_request(
        &app, "POST", &format!("/api/einsaetze/{einsatz}/uhs"), &cookie,
        Some(&json!({"typ": "behandlungsplatz", "bezeichnung": "BHP 50"})),
    ).await;
    let uhs_id = v["id"].as_i64().unwrap();
    let (s, _) = json_request(&app, "PATCH", &format!("/api/einsaetze/{einsatz}/uhs/{uhs_id}"), &cookie,
        Some(&json!({"lat": 50.1, "lon": 8.6}))).await;
    assert_eq!(s, StatusCode::OK);
    let (s, v) = json_request(&app, "PATCH", &format!("/api/einsaetze/{einsatz}/uhs/{uhs_id}"), &cookie,
        Some(&json!({"lat": null, "lon": null}))).await;
    assert_eq!(s, StatusCode::OK);
    assert!(v["lat"].is_null());
    assert!(v["lon"].is_null());
}

#[tokio::test]
async fn verorten_nur_lat_ist_422() {
    let (app, _) = setup_mit_pool().await;
    let cookie = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &cookie).await;
    let (_s, v) = json_request(
        &app, "POST", &format!("/api/einsaetze/{einsatz}/uhs"), &cookie,
        Some(&json!({"typ": "behandlungsplatz", "bezeichnung": "BHP 50"})),
    ).await;
    let uhs_id = v["id"].as_i64().unwrap();
    let (s, _) = json_request(&app, "PATCH", &format!("/api/einsaetze/{einsatz}/uhs/{uhs_id}"), &cookie,
        Some(&json!({"lat": 50.1}))).await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY, "darf 422 sein, NICHT 500");
}

#[tokio::test]
async fn verorten_nur_lon_ist_422() {
    let (app, _) = setup_mit_pool().await;
    let cookie = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &cookie).await;
    let (_s, v) = json_request(
        &app, "POST", &format!("/api/einsaetze/{einsatz}/uhs"), &cookie,
        Some(&json!({"typ": "behandlungsplatz", "bezeichnung": "BHP 50"})),
    ).await;
    let uhs_id = v["id"].as_i64().unwrap();
    let (s, _) = json_request(&app, "PATCH", &format!("/api/einsaetze/{einsatz}/uhs/{uhs_id}"), &cookie,
        Some(&json!({"lon": 8.6}))).await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY, "darf 422 sein, NICHT 500");
}

#[tokio::test]
async fn verorten_ausserhalb_range_ist_422() {
    let (app, _) = setup_mit_pool().await;
    let cookie = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &cookie).await;
    let (_s, v) = json_request(
        &app, "POST", &format!("/api/einsaetze/{einsatz}/uhs"), &cookie,
        Some(&json!({"typ": "behandlungsplatz", "bezeichnung": "BHP 50"})),
    ).await;
    let uhs_id = v["id"].as_i64().unwrap();
    let (s, _) = json_request(&app, "PATCH", &format!("/api/einsaetze/{einsatz}/uhs/{uhs_id}"), &cookie,
        Some(&json!({"lat": 99.0, "lon": 8.6}))).await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY);
}

#[tokio::test]
async fn verorten_lon_ausserhalb_range_ist_422() {
    let (app, _) = setup_mit_pool().await;
    let cookie = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &cookie).await;
    let (_s, v) = json_request(
        &app, "POST", &format!("/api/einsaetze/{einsatz}/uhs"), &cookie,
        Some(&json!({"typ": "behandlungsplatz", "bezeichnung": "BHP 50"})),
    ).await;
    let uhs_id = v["id"].as_i64().unwrap();
    let (s, _) = json_request(&app, "PATCH", &format!("/api/einsaetze/{einsatz}/uhs/{uhs_id}"), &cookie,
        Some(&json!({"lat": 50.0, "lon": 200.0}))).await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY);
}
