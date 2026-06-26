//! HTTP-Integrationstests für Bereitstellungsraeume (LFH-14):
//! Lifecycle/Status, Belegung (Einheit + Fahrzeug), ETB-Texte,
//! Rechte-Matrix, Cross-Einsatz-404 und Read-only für abgeschlossene Einsätze.

use axum::body::{to_bytes, Body};
use axum::http::{header, Request, StatusCode};
use lifeline_hub::app::{build_router, AppState};
use lifeline_hub::auth::bootstrap::bootstrap_admin;
use lifeline_hub::db;
use lifeline_hub::live::LiveHub;
use serde_json::{json, Value};
use tower::ServiceExt;

// ---------- Harness ----------

async fn setup_mit_pool() -> (axum::Router, sqlx::SqlitePool) {
    let (router, pool, _live) = setup_mit_live().await;
    (router, pool)
}

/// Wie `setup_mit_pool`, gibt aber zusätzlich den `LiveHub` zurück, um in
/// SSE-Tests Events zu abonnieren.
async fn setup_mit_live() -> (axum::Router, sqlx::SqlitePool, LiveHub) {
    let pool = db::test_pool().await;
    bootstrap_admin(&pool, "Test-Orga", "admin", Some("startpw12"))
        .await
        .unwrap();
    let live = LiveHub::new();
    let router = build_router(AppState {
        pool: pool.clone(),
        live: live.clone(),
        karten_dir: std::env::temp_dir(), fachebenen: lifeline_hub::karte::FachebenenState::neu(), download_client: lifeline_hub::karte::download::download_client(), download_fortschritt: lifeline_hub::karte::download::neue_fortschritt_map(),
    });
    (router, pool, live)
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

/// Legt einen BR an und versetzt ihn sofort auf aktiv.
async fn br_anlegen_und_aktivieren(
    app: &axum::Router,
    cookie: &str,
    einsatz: i64,
    bez: &str,
) -> i64 {
    let (s, v) = json_request(
        app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/bereitstellungsraeume"),
        cookie,
        Some(&json!({"bezeichnung": bez})),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "anlegen: {v}");
    let br = v["id"].as_i64().unwrap();
    let (s, _) = json_request(
        app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/bereitstellungsraeume/{br}/status"),
        cookie,
        Some(&json!({"status": "aktiv"})),
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    br
}

/// Liest alle ETB-System-Einträge und gibt deren Inhalt zurück.
async fn etb_inhalte(app: &axum::Router, cookie: &str, einsatz: i64) -> Vec<String> {
    let (s, v) = json_request(
        app,
        "GET",
        &format!("/api/einsaetze/{einsatz}/etb"),
        cookie,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    v.as_array()
        .unwrap_or(&vec![])
        .iter()
        .filter(|e| e["typ"].as_str() == Some("system"))
        .map(|e| e["inhalt"].as_str().unwrap_or("").to_string())
        .collect()
}

// ============================== Tests ==============================

/// CRUD-Basis: anlegen → geplant; status aktiv → 200.
#[tokio::test]
async fn anlegen_liefert_geplant_und_keinen_etb() {
    let (app, _pool) = setup_mit_pool().await;
    let cookie = login_cookie(&app, "admin", "startpw12").await;
    let eid = einsatz_anlegen(&app, &cookie).await;

    let (s, v) = json_request(
        &app,
        "POST",
        &format!("/api/einsaetze/{eid}/bereitstellungsraeume"),
        &cookie,
        Some(&json!({"bezeichnung": "BR Nord"})),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "Anlegen: {v}");
    assert_eq!(v["status"], "geplant");
    assert_eq!(v["bezeichnung"], "BR Nord");

    // KEIN ETB-Eintrag beim Anlegen.
    let etb = etb_inhalte(&app, &cookie, eid).await;
    assert!(etb.is_empty(), "Kein ETB beim Anlegen: {etb:?}");
}

/// Status aktiv → ETB "in Betrieb genommen".
#[tokio::test]
async fn status_aktiv_schreibt_etb_in_betrieb_genommen() {
    let (app, _pool) = setup_mit_pool().await;
    let cookie = login_cookie(&app, "admin", "startpw12").await;
    let eid = einsatz_anlegen(&app, &cookie).await;

    let (s, v) = json_request(
        &app,
        "POST",
        &format!("/api/einsaetze/{eid}/bereitstellungsraeume"),
        &cookie,
        Some(&json!({"bezeichnung": "BR Süd"})),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED);
    let br_id = v["id"].as_i64().unwrap();

    let (s, _) = json_request(
        &app,
        "POST",
        &format!("/api/einsaetze/{eid}/bereitstellungsraeume/{br_id}/status"),
        &cookie,
        Some(&json!({"status": "aktiv"})),
    )
    .await;
    assert_eq!(s, StatusCode::OK);

    let etb = etb_inhalte(&app, &cookie, eid).await;
    assert!(
        etb.iter().any(|t| t.contains("BR Süd") && t.contains("Betrieb")),
        "ETB muss BR-Name + 'Betrieb' enthalten: {etb:?}"
    );
}

/// Ungültiger Übergang → 422.
#[tokio::test]
async fn ungueltiger_status_uebergang_ist_422() {
    let (app, _pool) = setup_mit_pool().await;
    let cookie = login_cookie(&app, "admin", "startpw12").await;
    let eid = einsatz_anlegen(&app, &cookie).await;
    let br_id = br_anlegen_und_aktivieren(&app, &cookie, eid, "BR Test").await;

    // aktiv → geplant ist kein erlaubter Übergang
    let (s, _) = json_request(
        &app,
        "POST",
        &format!("/api/einsaetze/{eid}/bereitstellungsraeume/{br_id}/status"),
        &cookie,
        Some(&json!({"status": "geplant"})),
    )
    .await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY);
}

/// Detail-Response enthält einheiten + fahrzeuge der aktiven Belegungen.
#[tokio::test]
async fn crud_und_belegung_einheit_erscheint_in_detail() {
    let (app, pool) = setup_mit_pool().await;
    let cookie = login_cookie(&app, "admin", "startpw12").await;
    let eid = einsatz_anlegen(&app, &cookie).await;
    let br_id = br_anlegen_und_aktivieren(&app, &cookie, eid, "BR Ost").await;

    // Einheit direkt per SQL anlegen
    let einheit_id: i64 = sqlx::query_scalar(
        "INSERT INTO einsatz_einheit (einsatz_id, name) VALUES (?, '1. Zug') RETURNING id",
    )
    .bind(eid)
    .fetch_one(&pool)
    .await
    .unwrap();

    // Belegung: Eintritt
    let (s, v) = json_request(
        &app,
        "POST",
        &format!("/api/einsaetze/{eid}/bereitstellungsraeume/{br_id}/belegung"),
        &cookie,
        Some(&json!({"objekt_typ": "einheit", "objekt_id": einheit_id, "art": "eintritt"})),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "Belegung: {v}");
    assert_eq!(v["art"], "eintritt");

    // Detail zeigt die Einheit
    let (s, v) = json_request(
        &app,
        "GET",
        &format!("/api/einsaetze/{eid}/bereitstellungsraeume/{br_id}"),
        &cookie,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    let einheiten = v["einheiten"].as_array().unwrap();
    assert_eq!(einheiten.len(), 1, "Eine Einheit in Detail: {v}");
    assert_eq!(einheiten[0]["id"], einheit_id);
}

/// Austritt entfernt Einheit aus Detail.
#[tokio::test]
async fn austritt_entfernt_einheit_aus_detail() {
    let (app, pool) = setup_mit_pool().await;
    let cookie = login_cookie(&app, "admin", "startpw12").await;
    let eid = einsatz_anlegen(&app, &cookie).await;
    let br_id = br_anlegen_und_aktivieren(&app, &cookie, eid, "BR Austritt").await;

    let einheit_id: i64 = sqlx::query_scalar(
        "INSERT INTO einsatz_einheit (einsatz_id, name) VALUES (?, '2. Zug') RETURNING id",
    )
    .bind(eid)
    .fetch_one(&pool)
    .await
    .unwrap();

    json_request(
        &app,
        "POST",
        &format!("/api/einsaetze/{eid}/bereitstellungsraeume/{br_id}/belegung"),
        &cookie,
        Some(&json!({"objekt_typ": "einheit", "objekt_id": einheit_id, "art": "eintritt"})),
    )
    .await;

    json_request(
        &app,
        "POST",
        &format!("/api/einsaetze/{eid}/bereitstellungsraeume/{br_id}/belegung"),
        &cookie,
        Some(&json!({"objekt_typ": "einheit", "objekt_id": einheit_id, "art": "austritt"})),
    )
    .await;

    let (s, v) = json_request(
        &app,
        "GET",
        &format!("/api/einsaetze/{eid}/bereitstellungsraeume/{br_id}"),
        &cookie,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    let einheiten = v["einheiten"].as_array().unwrap();
    assert!(einheiten.is_empty(), "Nach Austritt keine Einheit mehr: {v}");
}

/// Auflösen blockt bei aktiver Belegung → 409.
#[tokio::test]
async fn aufloesen_blockt_bei_belegung_409() {
    let (app, pool) = setup_mit_pool().await;
    let cookie = login_cookie(&app, "admin", "startpw12").await;
    let eid = einsatz_anlegen(&app, &cookie).await;
    let br_id = br_anlegen_und_aktivieren(&app, &cookie, eid, "BR Block").await;

    let einheit_id: i64 = sqlx::query_scalar(
        "INSERT INTO einsatz_einheit (einsatz_id, name) VALUES (?, '3. Zug') RETURNING id",
    )
    .bind(eid)
    .fetch_one(&pool)
    .await
    .unwrap();

    json_request(
        &app,
        "POST",
        &format!("/api/einsaetze/{eid}/bereitstellungsraeume/{br_id}/belegung"),
        &cookie,
        Some(&json!({"objekt_typ": "einheit", "objekt_id": einheit_id, "art": "eintritt"})),
    )
    .await;

    let (s, _) = json_request(
        &app,
        "POST",
        &format!("/api/einsaetze/{eid}/bereitstellungsraeume/{br_id}/status"),
        &cookie,
        Some(&json!({"status": "aufgeloest"})),
    )
    .await;
    assert_eq!(s, StatusCode::CONFLICT);
}

/// Fahrzeug MIT einheit_id → Belegung 409.
#[tokio::test]
async fn fahrzeug_mit_einheit_belegen_409() {
    let (app, pool) = setup_mit_pool().await;
    let cookie = login_cookie(&app, "admin", "startpw12").await;
    let eid = einsatz_anlegen(&app, &cookie).await;
    let br_id = br_anlegen_und_aktivieren(&app, &cookie, eid, "BR Fz").await;

    let einheit_id: i64 = sqlx::query_scalar(
        "INSERT INTO einsatz_einheit (einsatz_id, name) VALUES (?, 'Einheit A') RETURNING id",
    )
    .bind(eid)
    .fetch_one(&pool)
    .await
    .unwrap();

    let fz_id: i64 = sqlx::query_scalar(
        "INSERT INTO einsatz_fahrzeug (einsatz_id, snap_funkrufname, einheit_id) \
         VALUES (?, 'Florian 1/44', ?) RETURNING id",
    )
    .bind(eid)
    .bind(einheit_id)
    .fetch_one(&pool)
    .await
    .unwrap();

    let (s, _) = json_request(
        &app,
        "POST",
        &format!("/api/einsaetze/{eid}/bereitstellungsraeume/{br_id}/belegung"),
        &cookie,
        Some(&json!({"objekt_typ": "fahrzeug", "objekt_id": fz_id, "art": "eintritt"})),
    )
    .await;
    assert_eq!(s, StatusCode::CONFLICT);
}

/// Einheitenloses Fahrzeug → Belegung 201.
#[tokio::test]
async fn fahrzeug_ohne_einheit_belegung_201() {
    let (app, pool) = setup_mit_pool().await;
    let cookie = login_cookie(&app, "admin", "startpw12").await;
    let eid = einsatz_anlegen(&app, &cookie).await;
    let br_id = br_anlegen_und_aktivieren(&app, &cookie, eid, "BR Fz2").await;

    let fz_id: i64 = sqlx::query_scalar(
        "INSERT INTO einsatz_fahrzeug (einsatz_id, snap_funkrufname) \
         VALUES (?, 'Florian 1/45') RETURNING id",
    )
    .bind(eid)
    .fetch_one(&pool)
    .await
    .unwrap();

    let (s, v) = json_request(
        &app,
        "POST",
        &format!("/api/einsaetze/{eid}/bereitstellungsraeume/{br_id}/belegung"),
        &cookie,
        Some(&json!({"objekt_typ": "fahrzeug", "objekt_id": fz_id, "art": "eintritt"})),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "Fahrzeug-Belegung: {v}");

    // Detail zeigt Fahrzeug
    let (_, d) = json_request(
        &app,
        "GET",
        &format!("/api/einsaetze/{eid}/bereitstellungsraeume/{br_id}"),
        &cookie,
        None,
    )
    .await;
    let fahrzeuge = d["fahrzeuge"].as_array().unwrap();
    assert_eq!(fahrzeuge.len(), 1);
    assert_eq!(fahrzeuge[0]["id"], fz_id);
}

/// Unbekannter objekt_typ → 400.
#[tokio::test]
async fn unbekannter_objekt_typ_400() {
    let (app, _pool) = setup_mit_pool().await;
    let cookie = login_cookie(&app, "admin", "startpw12").await;
    let eid = einsatz_anlegen(&app, &cookie).await;
    let br_id = br_anlegen_und_aktivieren(&app, &cookie, eid, "BR Val").await;

    let (s, _) = json_request(
        &app,
        "POST",
        &format!("/api/einsaetze/{eid}/bereitstellungsraeume/{br_id}/belegung"),
        &cookie,
        Some(&json!({"objekt_typ": "person", "objekt_id": 1, "art": "eintritt"})),
    )
    .await;
    assert_eq!(s, StatusCode::BAD_REQUEST);
}

/// Geplanter BR akzeptiert keine Belegung → 422.
#[tokio::test]
async fn geplanter_br_akzeptiert_keine_belegung_422() {
    let (app, pool) = setup_mit_pool().await;
    let cookie = login_cookie(&app, "admin", "startpw12").await;
    let eid = einsatz_anlegen(&app, &cookie).await;

    // BR anlegen, aber NICHT aktivieren (bleibt geplant)
    let (s, v) = json_request(
        &app,
        "POST",
        &format!("/api/einsaetze/{eid}/bereitstellungsraeume"),
        &cookie,
        Some(&json!({"bezeichnung": "BR Geplant"})),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED);
    let br_id = v["id"].as_i64().unwrap();

    let einheit_id: i64 = sqlx::query_scalar(
        "INSERT INTO einsatz_einheit (einsatz_id, name) VALUES (?, 'Testzug') RETURNING id",
    )
    .bind(eid)
    .fetch_one(&pool)
    .await
    .unwrap();

    let (s, _) = json_request(
        &app,
        "POST",
        &format!("/api/einsaetze/{eid}/bereitstellungsraeume/{br_id}/belegung"),
        &cookie,
        Some(&json!({"objekt_typ": "einheit", "objekt_id": einheit_id, "art": "eintritt"})),
    )
    .await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY);
}

/// ETB bei Inbetriebnahme + Belegung enthält BR-Bezeichnung.
#[tokio::test]
async fn etb_inbetriebnahme_und_belegung() {
    let (app, pool) = setup_mit_pool().await;
    let cookie = login_cookie(&app, "admin", "startpw12").await;
    let eid = einsatz_anlegen(&app, &cookie).await;

    let (s, v) = json_request(
        &app,
        "POST",
        &format!("/api/einsaetze/{eid}/bereitstellungsraeume"),
        &cookie,
        Some(&json!({"bezeichnung": "BR Alpha"})),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED);
    let br_id = v["id"].as_i64().unwrap();

    // Aktivieren → ETB
    let (s, _) = json_request(
        &app,
        "POST",
        &format!("/api/einsaetze/{eid}/bereitstellungsraeume/{br_id}/status"),
        &cookie,
        Some(&json!({"status": "aktiv"})),
    )
    .await;
    assert_eq!(s, StatusCode::OK);

    let etb_nach_aktiv = etb_inhalte(&app, &cookie, eid).await;
    assert!(
        etb_nach_aktiv.iter().any(|t| t.contains("BR Alpha")),
        "ETB fehlt BR-Name nach Aktivierung: {etb_nach_aktiv:?}"
    );

    // Einheit belegen → ETB
    let einheit_id: i64 = sqlx::query_scalar(
        "INSERT INTO einsatz_einheit (einsatz_id, name) VALUES (?, 'Alpha-Zug') RETURNING id",
    )
    .bind(eid)
    .fetch_one(&pool)
    .await
    .unwrap();

    let (s, _) = json_request(
        &app,
        "POST",
        &format!("/api/einsaetze/{eid}/bereitstellungsraeume/{br_id}/belegung"),
        &cookie,
        Some(&json!({"objekt_typ": "einheit", "objekt_id": einheit_id, "art": "eintritt"})),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED);

    let etb_nach_belegung = etb_inhalte(&app, &cookie, eid).await;
    assert!(
        etb_nach_belegung.iter().any(|t| t.contains("Alpha-Zug") && t.contains("BR Alpha")),
        "ETB-Belegungs-Text fehlt Einheitenname + BR-Name: {etb_nach_belegung:?}"
    );
}

/// Stammfeld-PATCH schreibt KEINEN ETB.
#[tokio::test]
async fn patch_stammfelder_kein_etb() {
    let (app, _pool) = setup_mit_pool().await;
    let cookie = login_cookie(&app, "admin", "startpw12").await;
    let eid = einsatz_anlegen(&app, &cookie).await;
    let br_id = br_anlegen_und_aktivieren(&app, &cookie, eid, "BR Patch").await;

    let (s, _) = json_request(
        &app,
        "PATCH",
        &format!("/api/einsaetze/{eid}/bereitstellungsraeume/{br_id}"),
        &cookie,
        Some(&json!({"bezeichnung": "BR Patch Neu"})),
    )
    .await;
    assert_eq!(s, StatusCode::OK);

    let etb = etb_inhalte(&app, &cookie, eid).await;
    // Einziger ETB sollte der Aktivierungs-Eintrag sein, kein PATCH-Eintrag.
    let patch_etb: Vec<_> = etb.iter().filter(|t| t.contains("Patch Neu")).collect();
    assert!(patch_etb.is_empty(), "PATCH soll keinen ETB schreiben: {etb:?}");
}

/// Rechte-Matrix: Beobachter kann nicht schreiben → 403.
#[tokio::test]
async fn beobachter_kann_nicht_schreiben_403() {
    let (app, _pool) = setup_mit_pool().await;
    let cookie_admin = login_cookie(&app, "admin", "startpw12").await;
    let eid = einsatz_anlegen(&app, &cookie_admin).await;

    // Beobachter-Benutzer anlegen
    let (s, v) = json_request(
        &app,
        "POST",
        "/api/benutzer",
        &cookie_admin,
        Some(&json!({"anzeigename": "Beob", "benutzername": "beob", "passwort": "startpw12"})),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED);
    let beob_id = v["id"].as_i64().unwrap();

    // Mitgliedschaft als Beobachter
    let (s, _) = json_request(
        &app,
        "PUT",
        &format!("/api/einsaetze/{eid}/mitglieder/{beob_id}"),
        &cookie_admin,
        Some(&json!({"einsatz_rolle": "beobachter"})),
    )
    .await;
    assert_eq!(s, StatusCode::OK);

    let cookie_beob = login_cookie(&app, "beob", "startpw12").await;

    let (s, _) = json_request(
        &app,
        "POST",
        &format!("/api/einsaetze/{eid}/bereitstellungsraeume"),
        &cookie_beob,
        Some(&json!({"bezeichnung": "BR Geheim"})),
    )
    .await;
    assert_eq!(s, StatusCode::FORBIDDEN);
}

/// Fremder Einsatz → 404 (Org-Isolation).
#[tokio::test]
async fn fremder_einsatz_ist_404() {
    let (app, _pool) = setup_mit_pool().await;
    let cookie = login_cookie(&app, "admin", "startpw12").await;

    let (s, _) = json_request(
        &app,
        "GET",
        "/api/einsaetze/9999/bereitstellungsraeume",
        &cookie,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::NOT_FOUND);
}

/// Abgeschlossener Einsatz: Schreib-Routen → 409.
#[tokio::test]
async fn abgeschlossener_einsatz_blockt_schreibrouten() {
    let (app, pool) = setup_mit_pool().await;
    let cookie = login_cookie(&app, "admin", "startpw12").await;
    let eid = einsatz_anlegen(&app, &cookie).await;
    let br_id = br_anlegen_und_aktivieren(&app, &cookie, eid, "BR AbgE").await;

    // Einsatz abschließen
    sqlx::query(
        "UPDATE einsatz SET status = 'abgeschlossen', \
         abgeschlossen_at = strftime('%Y-%m-%d %H:%M:%S','now') WHERE id = ?",
    )
    .bind(eid)
    .execute(&pool)
    .await
    .unwrap();

    let (s, _) = json_request(
        &app,
        "POST",
        &format!("/api/einsaetze/{eid}/bereitstellungsraeume"),
        &cookie,
        Some(&json!({"bezeichnung": "BR Neu"})),
    )
    .await;
    assert_eq!(s, StatusCode::CONFLICT, "Anlegen bei abgeschlossenem Einsatz");

    let (s, _) = json_request(
        &app,
        "PATCH",
        &format!("/api/einsaetze/{eid}/bereitstellungsraeume/{br_id}"),
        &cookie,
        Some(&json!({"bezeichnung": "BR Geaendert"})),
    )
    .await;
    assert_eq!(s, StatusCode::CONFLICT, "PATCH bei abgeschlossenem Einsatz");
}

/// Wechsel: Einheit von BR A nach BR B → 201, Detail B zeigt sie, A nicht.
#[tokio::test]
async fn wechsel_verschiebt_einheit_zwischen_br() {
    let (app, pool) = setup_mit_pool().await;
    let cookie = login_cookie(&app, "admin", "startpw12").await;
    let eid = einsatz_anlegen(&app, &cookie).await;
    let br_a = br_anlegen_und_aktivieren(&app, &cookie, eid, "BR A").await;
    let br_b = br_anlegen_und_aktivieren(&app, &cookie, eid, "BR B").await;

    let einheit_id: i64 = sqlx::query_scalar(
        "INSERT INTO einsatz_einheit (einsatz_id, name) VALUES (?, 'Wechselzug') RETURNING id",
    )
    .bind(eid)
    .fetch_one(&pool)
    .await
    .unwrap();

    // Eintritt in BR A
    let (s, _) = json_request(
        &app,
        "POST",
        &format!("/api/einsaetze/{eid}/bereitstellungsraeume/{br_a}/belegung"),
        &cookie,
        Some(&json!({"objekt_typ": "einheit", "objekt_id": einheit_id, "art": "eintritt"})),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED);

    // Wechsel nach BR B
    let (s, _) = json_request(
        &app,
        "POST",
        &format!("/api/einsaetze/{eid}/bereitstellungsraeume/{br_b}/belegung"),
        &cookie,
        Some(&json!({"objekt_typ": "einheit", "objekt_id": einheit_id, "art": "wechsel"})),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "Wechsel nach BR B");

    // Detail B zeigt die Einheit
    let (_, vb) = json_request(
        &app,
        "GET",
        &format!("/api/einsaetze/{eid}/bereitstellungsraeume/{br_b}"),
        &cookie,
        None,
    )
    .await;
    let einheiten_b = vb["einheiten"].as_array().unwrap();
    assert_eq!(einheiten_b.len(), 1, "Einheit jetzt in BR B: {vb}");
    assert_eq!(einheiten_b[0]["id"], einheit_id);

    // Detail A zeigt sie nicht mehr
    let (_, va) = json_request(
        &app,
        "GET",
        &format!("/api/einsaetze/{eid}/bereitstellungsraeume/{br_a}"),
        &cookie,
        None,
    )
    .await;
    assert!(
        va["einheiten"].as_array().unwrap().is_empty(),
        "Einheit nicht mehr in BR A: {va}"
    );
}

/// Belegung einer Einheit feuert ein `einheit`-SSE-Event (+ `bereitstellungsraum`),
/// damit die Kräfte-Ansicht live refetchen kann.
#[tokio::test]
async fn belegung_einheit_feuert_einheit_sse() {
    let (app, pool, live) = setup_mit_live().await;
    let cookie = login_cookie(&app, "admin", "startpw12").await;
    let eid = einsatz_anlegen(&app, &cookie).await;
    let br_id = br_anlegen_und_aktivieren(&app, &cookie, eid, "BR SSE").await;

    let einheit_id: i64 = sqlx::query_scalar(
        "INSERT INTO einsatz_einheit (einsatz_id, name) VALUES (?, 'SSE-Zug') RETURNING id",
    )
    .bind(eid)
    .fetch_one(&pool)
    .await
    .unwrap();

    // VOR der Belegung abonnieren, damit das Broadcast-Event ankommt.
    let mut rx = live.abonniere(eid);

    let (s, _) = json_request(
        &app,
        "POST",
        &format!("/api/einsaetze/{eid}/bereitstellungsraeume/{br_id}/belegung"),
        &cookie,
        Some(&json!({"objekt_typ": "einheit", "objekt_id": einheit_id, "art": "eintritt"})),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED);

    // Alle gepufferten Events drainen und auf `einheit` mit objekt_id prüfen.
    let mut sah_einheit = false;
    while let Ok(n) = rx.try_recv() {
        if n.event == "einheit" && n.data.contains(&einheit_id.to_string()) {
            sah_einheit = true;
        }
    }
    assert!(sah_einheit, "Belegung muss ein `einheit`-SSE-Event mit objekt_id feuern");
}

/// Belegung eines Fahrzeugs feuert ein `fahrzeug`-SSE-Event.
#[tokio::test]
async fn belegung_fahrzeug_feuert_fahrzeug_sse() {
    let (app, pool, live) = setup_mit_live().await;
    let cookie = login_cookie(&app, "admin", "startpw12").await;
    let eid = einsatz_anlegen(&app, &cookie).await;
    let br_id = br_anlegen_und_aktivieren(&app, &cookie, eid, "BR SSE Fz").await;

    let fz_id: i64 = sqlx::query_scalar(
        "INSERT INTO einsatz_fahrzeug (einsatz_id, snap_funkrufname) \
         VALUES (?, 'Florian 9/99') RETURNING id",
    )
    .bind(eid)
    .fetch_one(&pool)
    .await
    .unwrap();

    let mut rx = live.abonniere(eid);

    let (s, _) = json_request(
        &app,
        "POST",
        &format!("/api/einsaetze/{eid}/bereitstellungsraeume/{br_id}/belegung"),
        &cookie,
        Some(&json!({"objekt_typ": "fahrzeug", "objekt_id": fz_id, "art": "eintritt"})),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED);

    let mut sah_fahrzeug = false;
    while let Ok(n) = rx.try_recv() {
        if n.event == "fahrzeug" && n.data.contains(&fz_id.to_string()) {
            sah_fahrzeug = true;
        }
    }
    assert!(sah_fahrzeug, "Belegung muss ein `fahrzeug`-SSE-Event mit objekt_id feuern");
}

/// Belegung mit nicht existierendem objekt_id → 404.
#[tokio::test]
async fn belegung_unbekanntes_objekt_404() {
    let (app, _pool) = setup_mit_pool().await;
    let cookie = login_cookie(&app, "admin", "startpw12").await;
    let eid = einsatz_anlegen(&app, &cookie).await;
    let br_id = br_anlegen_und_aktivieren(&app, &cookie, eid, "BR NF").await;

    let (s, _) = json_request(
        &app,
        "POST",
        &format!("/api/einsaetze/{eid}/bereitstellungsraeume/{br_id}/belegung"),
        &cookie,
        Some(&json!({"objekt_typ": "einheit", "objekt_id": 99999, "art": "eintritt"})),
    )
    .await;
    assert_eq!(s, StatusCode::NOT_FOUND);
}
