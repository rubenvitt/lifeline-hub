//! LFH-170 Freie taktische Zeichen — Backend-Integrationstests.
//!
//! Deckt ab: CRUD (POST→GET→PATCH→DELETE), Whole-Spec-Overwrite (fehlende Overlays →
//! NULL, lat/lon unverändert), 422 bei fehlendem/leerem grundzeichen, 404 für fremden
//! Einsatz bzw. fremde zeichen-id, Gate-Matrix (GET braucht Lesezugriff+Modul; POST/PATCH/
//! DELETE Schreibrecht+aktiv+Modul; Org-Isolation), SSE-Event `freies_zeichen` (Wire-Tag +
//! Payload load-bearing für das Frontend).
//!
//! Harness 1:1 aus tests/lage_zone.rs; `setup()` liefert zusätzlich den LiveHub-Klon
//! (teilt den inneren Arc mit dem AppState), damit der SSE-Test direkt mithören kann.

use axum::http::StatusCode;
use lifeline_hub::app::{build_router, AppState};
use lifeline_hub::auth::bootstrap::bootstrap_admin;
use lifeline_hub::db;
use lifeline_hub::live::{LiveHub, LiveNachricht};
use serde_json::{json, Value};
use std::time::Duration;
use tokio::sync::broadcast::Receiver;

mod common;
use common::{anfrage, benutzer_anlegen, einsatz_anlegen, login_cookie};

async fn setup() -> (axum::Router, LiveHub) {
    let pool = db::test_pool().await;
    bootstrap_admin(&pool, "Test-Orga", "admin", Some("startpw12"))
        .await
        .unwrap();
    let live = LiveHub::new();
    let router = build_router(AppState {
        pool,
        live: live.clone(),
        karten_dir: std::env::temp_dir(),
        fachebenen: lifeline_hub::karte::FachebenenState::neu(),
        download_client: lifeline_hub::karte::download::download_client(),
        download_fortschritt: lifeline_hub::karte::download::neue_fortschritt_map(),
        karten_service_url: None,
        karten_service_token: None,
    });
    (router, live)
}

/// Wie `setup()`, liefert aber zusätzlich den Pool-Klon für den Test-Shortcut „Einsatz
/// abschließen" (direkter DB-UPDATE, umgeht die Abschluss-Route). Vorbild: `setup_mit_pool`
/// in tests/einsatz_uhs.rs.
async fn setup_mit_pool() -> (axum::Router, sqlx::SqlitePool) {
    let pool = db::test_pool().await;
    bootstrap_admin(&pool, "Test-Orga", "admin", Some("startpw12"))
        .await
        .unwrap();
    let router = build_router(AppState {
        pool: pool.clone(),
        live: LiveHub::new(),
        karten_dir: std::env::temp_dir(),
        fachebenen: lifeline_hub::karte::FachebenenState::neu(),
        download_client: lifeline_hub::karte::download::download_client(),
        download_fortschritt: lifeline_hub::karte::download::neue_fortschritt_map(),
        karten_service_url: None,
        karten_service_token: None,
    });
    (router, pool)
}

/// Fremder Nutzer ohne Einsatz-Mitgliedschaft und ohne höhere Berechtigung (org_rolle="keine").
async fn fremder_nutzer(app: &axum::Router, admin: &str) -> String {
    benutzer_anlegen(app, admin, "fremd", "keine").await;
    login_cookie(app, "fremd", "fremdpw1").await
}

async fn recv_until_tag(
    rx: &mut Receiver<LiveNachricht>,
    tag: &str,
    timeout: Duration,
) -> LiveNachricht {
    loop {
        let n = tokio::time::timeout(timeout, rx.recv())
            .await
            .unwrap_or_else(|_| panic!("Timeout: kein '{tag}'-Event empfangen"))
            .expect("Broadcast-Kanal geschlossen");
        if n.event.as_str() == tag {
            return n;
        }
    }
}

fn neu_body() -> String {
    json!({
        "lat": 50.1, "lon": 8.6, "grundzeichen": "einheit",
        "organisation": "feuerwehr", "fachaufgabe": "brandbekaempfung",
        "einheit": "zug", "farbe": "#ff0000", "label": "A"
    })
    .to_string()
}

#[tokio::test]
async fn anlegen_und_liste() {
    let (app, _live) = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;

    let (status, z) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/freie-zeichen"),
        &admin,
        Some(&neu_body()),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{z:?}");
    assert_eq!(z["grundzeichen"], "einheit");
    assert_eq!(z["organisation"], "feuerwehr");
    assert_eq!(z["lat"], 50.1);
    assert_eq!(z["lon"], 8.6);

    let (_, liste) = anfrage(
        &app,
        "GET",
        &format!("/api/einsaetze/{einsatz}/freie-zeichen"),
        &admin,
        None,
    )
    .await;
    assert_eq!(liste.as_array().unwrap().len(), 1);
}

/// Fehlendes Pflichtfeld ist ein FORMALER Fehler → 400 (LFH-267/F22).
///
/// `AnlegenBody.grundzeichen` ist ein `String` ohne `#[serde(default)]`, der Body scheitert
/// also schon am Extractor — der Handler läuft nie an. Vor LFH-267 lieferte axums
/// `JsonDataError` dafür 422; seit dem `JsonBody`-Wrapper ist es 400. Die Trennlinie zum
/// Test darunter ist genau die Konvention: strukturell fehlend = 400, leerer Wert = 422.
#[tokio::test]
async fn fehlendes_grundzeichen_ist_400() {
    let (app, _live) = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;

    let body = json!({"lat": 50.1, "lon": 8.6}).to_string();
    assert_eq!(
        anfrage(
            &app,
            "POST",
            &format!("/api/einsaetze/{einsatz}/freie-zeichen"),
            &admin,
            Some(&body)
        )
        .await
        .0,
        StatusCode::BAD_REQUEST
    );
}

/// Vorhandenes, aber leeres Pflichtfeld ist ein FACHLICHER Fehler → 422.
///
/// Der Body ist strukturell gültig, der Extractor lässt ihn durch; erst die
/// Handler-Validierung lehnt den Whitespace-only-Wert ab.
#[tokio::test]
async fn leeres_grundzeichen_ist_422() {
    let (app, _live) = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;

    let body = json!({"lat": 50.1, "lon": 8.6, "grundzeichen": "   "}).to_string();
    assert_eq!(
        anfrage(
            &app,
            "POST",
            &format!("/api/einsaetze/{einsatz}/freie-zeichen"),
            &admin,
            Some(&body)
        )
        .await
        .0,
        StatusCode::UNPROCESSABLE_ENTITY
    );
}

#[tokio::test]
async fn crud_whole_spec_haelt_lat_lon() {
    let (app, _live) = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;

    let (_, z) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/freie-zeichen"),
        &admin,
        Some(&neu_body()),
    )
    .await;
    let zid = z["id"].as_i64().unwrap();

    // Whole-Spec-PATCH: nur grundzeichen + symbol; alle anderen Overlays fallen weg (NULL).
    let patch = json!({"grundzeichen": "fahrzeug", "symbol": "kran"}).to_string();
    let (status, n) = anfrage(
        &app,
        "PATCH",
        &format!("/api/einsaetze/{einsatz}/freie-zeichen/{zid}"),
        &admin,
        Some(&patch),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{n:?}");
    assert_eq!(n["grundzeichen"], "fahrzeug");
    assert_eq!(n["symbol"], "kran");
    assert!(n["organisation"].is_null(), "Overlay weg → NULL: {n:?}");
    assert!(n["fachaufgabe"].is_null());
    assert!(n["einheit"].is_null());
    assert!(n["farbe"].is_null());
    assert!(n["label"].is_null());
    // lat/lon nicht verschiebbar.
    assert_eq!(n["lat"], 50.1);
    assert_eq!(n["lon"], 8.6);

    // DELETE → Liste leer.
    let (status, _) = anfrage(
        &app,
        "DELETE",
        &format!("/api/einsaetze/{einsatz}/freie-zeichen/{zid}"),
        &admin,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::NO_CONTENT);
    let (_, liste) = anfrage(
        &app,
        "GET",
        &format!("/api/einsaetze/{einsatz}/freie-zeichen"),
        &admin,
        None,
    )
    .await;
    assert_eq!(liste.as_array().unwrap().len(), 0);
}

#[tokio::test]
async fn patch_und_delete_fremder_einsatz_oder_id_ist_404() {
    let (app, _live) = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let a = einsatz_anlegen(&app, &admin).await;
    let b = einsatz_anlegen(&app, &admin).await;

    let (_, z) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{a}/freie-zeichen"),
        &admin,
        Some(&neu_body()),
    )
    .await;
    let zid = z["id"].as_i64().unwrap();

    // Zeichen aus A über Einsatz B ansprechen → 404.
    let patch = json!({"grundzeichen": "fahrzeug"}).to_string();
    assert_eq!(
        anfrage(
            &app,
            "PATCH",
            &format!("/api/einsaetze/{b}/freie-zeichen/{zid}"),
            &admin,
            Some(&patch)
        )
        .await
        .0,
        StatusCode::NOT_FOUND
    );
    assert_eq!(
        anfrage(
            &app,
            "DELETE",
            &format!("/api/einsaetze/{b}/freie-zeichen/{zid}"),
            &admin,
            None
        )
        .await
        .0,
        StatusCode::NOT_FOUND
    );

    // Unbekannte zeichen-id im richtigen Einsatz → 404.
    assert_eq!(
        anfrage(
            &app,
            "PATCH",
            &format!("/api/einsaetze/{a}/freie-zeichen/999999"),
            &admin,
            Some(&patch)
        )
        .await
        .0,
        StatusCode::NOT_FOUND
    );
}

#[tokio::test]
async fn org_isolation_fremder_nutzer_kann_nicht_lesen_oder_schreiben() {
    let (app, _live) = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let (_, z) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/freie-zeichen"),
        &admin,
        Some(&neu_body()),
    )
    .await;
    let zid = z["id"].as_i64().unwrap();

    let fremd_c = fremder_nutzer(&app, &admin).await;

    let get = anfrage(
        &app,
        "GET",
        &format!("/api/einsaetze/{einsatz}/freie-zeichen"),
        &fremd_c,
        None,
    )
    .await
    .0;
    assert!(
        matches!(get, StatusCode::FORBIDDEN | StatusCode::NOT_FOUND),
        "GET: {get}"
    );
    let post = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/freie-zeichen"),
        &fremd_c,
        Some(&neu_body()),
    )
    .await
    .0;
    assert!(
        matches!(post, StatusCode::FORBIDDEN | StatusCode::NOT_FOUND),
        "POST: {post}"
    );
    let patch = anfrage(
        &app,
        "PATCH",
        &format!("/api/einsaetze/{einsatz}/freie-zeichen/{zid}"),
        &fremd_c,
        Some(&json!({"grundzeichen": "fahrzeug"}).to_string()),
    )
    .await
    .0;
    assert!(
        matches!(patch, StatusCode::FORBIDDEN | StatusCode::NOT_FOUND),
        "PATCH: {patch}"
    );
    let del = anfrage(
        &app,
        "DELETE",
        &format!("/api/einsaetze/{einsatz}/freie-zeichen/{zid}"),
        &fremd_c,
        None,
    )
    .await
    .0;
    assert!(
        matches!(del, StatusCode::FORBIDDEN | StatusCode::NOT_FOUND),
        "DELETE: {del}"
    );
}

#[tokio::test]
async fn sse_feuert_bei_post_patch_delete() {
    let (app, live) = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let mut rx = live.abonniere(einsatz);

    let (_, z) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/freie-zeichen"),
        &admin,
        Some(&neu_body()),
    )
    .await;
    let zid = z["id"].as_i64().unwrap();
    let n = recv_until_tag(&mut rx, "freies_zeichen", Duration::from_secs(1)).await;
    let v: Value = serde_json::from_str(&n.data).unwrap();
    assert_eq!(v["einsatz_id"], einsatz);
    assert_eq!(v["zeichen_id"], zid);

    anfrage(
        &app,
        "PATCH",
        &format!("/api/einsaetze/{einsatz}/freie-zeichen/{zid}"),
        &admin,
        Some(&json!({"grundzeichen": "fahrzeug"}).to_string()),
    )
    .await;
    recv_until_tag(&mut rx, "freies_zeichen", Duration::from_secs(1)).await;

    anfrage(
        &app,
        "DELETE",
        &format!("/api/einsaetze/{einsatz}/freie-zeichen/{zid}"),
        &admin,
        None,
    )
    .await;
    recv_until_tag(&mut rx, "freies_zeichen", Duration::from_secs(1)).await;
}

#[tokio::test]
async fn abgeschlossener_einsatz_blockt_schreibrouten() {
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;

    // Zeichen anlegen, solange der Einsatz noch aktiv ist (für den PATCH/DELETE-Pfad).
    let (_, z) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/freie-zeichen"),
        &admin,
        Some(&neu_body()),
    )
    .await;
    let zid = z["id"].as_i64().unwrap();

    // Einsatz direkt in DB abschließen (Test-Shortcut, umgeht die Abschluss-Route mit
    // Nachlauffrist-Effekten — wir wollen nur `fordere_aktiv` prüfen). Muster: tests/einsatz_uhs.rs.
    sqlx::query(
        "UPDATE einsatz SET status = 'abgeschlossen', \
         abgeschlossen_at = strftime('%Y-%m-%d %H:%M:%S','now') WHERE id = ?",
    )
    .bind(einsatz)
    .execute(&pool)
    .await
    .unwrap();

    // `fordere_aktiv` läuft vor der Zeichen-id-Auflösung → POST/PATCH/DELETE liefern alle 409
    // (kein 404), obwohl der Admin Schreibrecht + Modul-Zugriff hat: der Abschluss ist der
    // einzige greifende Gate.
    let post = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/freie-zeichen"),
        &admin,
        Some(&neu_body()),
    )
    .await
    .0;
    assert_eq!(
        post,
        StatusCode::CONFLICT,
        "POST auf abgeschlossenem Einsatz → 409"
    );

    let patch = anfrage(
        &app,
        "PATCH",
        &format!("/api/einsaetze/{einsatz}/freie-zeichen/{zid}"),
        &admin,
        Some(&json!({"grundzeichen": "fahrzeug"}).to_string()),
    )
    .await
    .0;
    assert_eq!(
        patch,
        StatusCode::CONFLICT,
        "PATCH auf abgeschlossenem Einsatz → 409"
    );

    let del = anfrage(
        &app,
        "DELETE",
        &format!("/api/einsaetze/{einsatz}/freie-zeichen/{zid}"),
        &admin,
        None,
    )
    .await
    .0;
    assert_eq!(
        del,
        StatusCode::CONFLICT,
        "DELETE auf abgeschlossenem Einsatz → 409"
    );
}
