//! L-2 Lage/Taktik — Backend-Integrationstests.
//!
//! Deckt ab: Verorten ohne ETB, Geo-Paar-Semantik (Partial-Merge + unpaariges 422),
//! Karten-Lesedaten (aufgelöste Einheiten verschwinden, Führungskräfte nur Leader),
//! reguläre Org-Isolation (Fremd-Nutzer ohne Mitgliedschaft) sowie Live-Events bei
//! Geo-PATCH und K&M-Mutation.
//!
//! Harness identisch zu tests/einsatz_einheit.rs; `setup()` liefert hier zusätzlich
//! den `LiveHub`-Klon (teilt denselben inneren Zustand wie der im AppState), damit
//! der SSE-Test direkt via `live.abonniere(einsatz_id)` mithören kann.

use axum::body::{to_bytes, Body};
use axum::http::{header, Request, StatusCode};
use lifeline_hub::app::{build_router, AppState};
use lifeline_hub::auth::bootstrap::bootstrap_admin;
use lifeline_hub::db;
use lifeline_hub::live::{LiveHub, LiveNachricht};
use serde_json::Value;
use sqlx::SqlitePool;
use std::time::Duration;
use tokio::sync::broadcast::Receiver;
use tower::ServiceExt;

// ---------- Harness ----------

/// Baut Router + DB mit Bootstrap-Admin und liefert (Router, LiveHub-Klon, Pool).
/// Der zurückgegebene LiveHub teilt den inneren `Arc`-Zustand mit dem im AppState,
/// sodass `abonniere` echte Events der Handler empfängt.
async fn setup() -> (axum::Router, LiveHub, SqlitePool) {
    let pool = db::test_pool().await;
    bootstrap_admin(&pool, "Test-Orga", "admin", Some("startpw12")).await.unwrap();
    let live = LiveHub::new();
    let app = build_router(AppState { pool: pool.clone(), live: live.clone(), karten_dir: std::env::temp_dir(), fachebenen: lifeline_hub::karte::FachebenenState::neu() });
    (app, live, pool)
}

async fn login_cookie(app: &axum::Router, benutzername: &str, passwort: &str) -> String {
    let body = format!(r#"{{"benutzername":"{benutzername}","passwort":"{passwort}"}}"#);
    let resp = app.clone().oneshot(
        Request::builder().method("POST").uri("/api/auth/login")
            .header(header::CONTENT_TYPE, "application/json").body(Body::from(body)).unwrap(),
    ).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    resp.headers().get(header::SET_COOKIE).unwrap().to_str().unwrap()
        .split(';').next().unwrap().to_string()
}

async fn anfrage(app: &axum::Router, methode: &str, uri: &str, cookie: &str, body: Option<&str>) -> (StatusCode, Value) {
    let mut req = Request::builder().method(methode).uri(uri).header(header::COOKIE, cookie.to_string());
    let body = match body {
        Some(b) => { req = req.header(header::CONTENT_TYPE, "application/json"); Body::from(b.to_string()) }
        None => Body::empty(),
    };
    let resp = app.clone().oneshot(req.body(body).unwrap()).await.unwrap();
    let status = resp.status();
    let bytes = to_bytes(resp.into_body(), usize::MAX).await.unwrap();
    (status, serde_json::from_slice(&bytes).unwrap_or(Value::Null))
}

async fn einsatz_anlegen(app: &axum::Router, cookie: &str) -> i64 {
    let (status, json) = anfrage(app, "POST", "/api/einsaetze", cookie, Some(r#"{"bezeichnung":"Lage"}"#)).await;
    assert_eq!(status, StatusCode::CREATED);
    json["id"].as_i64().unwrap()
}

async fn einheit_bilden(app: &axum::Router, cookie: &str, einsatz: i64, name: &str) -> i64 {
    let (s, json) = anfrage(app, "POST", &format!("/api/einsaetze/{einsatz}/einheiten"), cookie,
        Some(&format!(r#"{{"name":"{name}"}}"#))).await;
    assert_eq!(s, StatusCode::CREATED);
    json["id"].as_i64().unwrap()
}

/// Stamm anlegen + in den Einsatz disponieren → liefert die einsatz_personal.id.
async fn person_anlegen(app: &axum::Router, cookie: &str, einsatz: i64, name: &str) -> i64 {
    let (s1, stamm) = anfrage(app, "POST", "/api/personal", cookie, Some(&format!(r#"{{"name":"{name}"}}"#))).await;
    assert_eq!(s1, StatusCode::CREATED);
    let pid = stamm["id"].as_i64().unwrap();
    let (s2, dispo) = anfrage(app, "POST", &format!("/api/einsaetze/{einsatz}/personal"), cookie,
        Some(&format!(r#"{{"personal_id":{pid}}}"#))).await;
    assert_eq!(s2, StatusCode::CREATED);
    dispo["id"].as_i64().unwrap()
}

/// Anzahl ETB-Einträge (gesamt) im Einsatz.
async fn etb_anzahl(app: &axum::Router, cookie: &str, einsatz: i64) -> usize {
    let (s, json) = anfrage(app, "GET", &format!("/api/einsaetze/{einsatz}/etb"), cookie, None).await;
    assert_eq!(s, StatusCode::OK);
    json.as_array().unwrap().len()
}

/// Empfängt Events bis zum gewünschten Event-Tag oder bricht nach `timeout` ab.
/// `bilden` feuert ZWEI Events (zuerst "etb", dann "einheit"); diese Drain-Logik
/// überspringt die Zwischen-Events und leert dabei den Puffer.
async fn recv_until_tag(rx: &mut Receiver<LiveNachricht>, tag: &str, timeout: Duration) -> LiveNachricht {
    loop {
        let n = tokio::time::timeout(timeout, rx.recv()).await
            .unwrap_or_else(|_| panic!("Timeout: kein '{tag}'-Event empfangen"))
            .expect("Broadcast-Kanal geschlossen");
        if n.event == tag {
            return n;
        }
    }
}

// ---------- Fall 1: Verorten erzeugt KEINEN ETB-Eintrag ----------

#[tokio::test]
async fn verorten_erzeugt_keinen_etb() {
    let (app, _live, _pool) = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let eid = einheit_bilden(&app, &admin, einsatz, "1. Zug").await; // Bilden DARF ETB erzeugen.

    let vorher = etb_anzahl(&app, &admin, einsatz).await;
    // Positive Kontrolle: ohne diesen Assert wäre vorher=0=nachher fälschlich grün,
    // falls das ETB-System komplett kaputt wäre.
    assert!(vorher >= 1, "bilden muss mindestens einen ETB-Eintrag erzeugt haben — ETB-Baseline ist kaputt");
    let (s, _) = anfrage(&app, "PATCH", &format!("/api/einsaetze/{einsatz}/einheiten/{eid}/position"), &admin,
        Some(r#"{"lat":52.5,"lon":13.4,"tz_fachaufgabe":"fuehrung"}"#)).await;
    assert_eq!(s, StatusCode::OK);
    let nachher = etb_anzahl(&app, &admin, einsatz).await;
    assert_eq!(vorher, nachher, "Geo-PATCH darf KEINEN ETB-Eintrag schreiben");
}

// ---------- Fall 2: Geo-Paar + Partial-Merge ----------

#[tokio::test]
async fn geo_paar_partial_merge_und_unpaarig_422() {
    let (app, _live, _pool) = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let eid = einheit_bilden(&app, &admin, einsatz, "1. Zug").await;
    let pos = format!("/api/einsaetze/{einsatz}/einheiten/{eid}/position");

    // 1) lat+lon gemeinsam setzen → 200.
    let (s, json) = anfrage(&app, "PATCH", &pos, &admin, Some(r#"{"lat":52.5,"lon":13.4}"#)).await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(json["lat"], 52.5);
    assert_eq!(json["lon"], 13.4);

    // 2) nur tz_fachaufgabe patchen → 200, lat/lon bleiben erhalten (Partial-Merge).
    let (s, json) = anfrage(&app, "PATCH", &pos, &admin, Some(r#"{"tz_fachaufgabe":"betreuung"}"#)).await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(json["lat"], 52.5, "lat muss nach reinem tz-Patch bestehen bleiben");
    assert_eq!(json["lon"], 13.4, "lon muss nach reinem tz-Patch bestehen bleiben");
    assert_eq!(json["tz_fachaufgabe"], "betreuung");

    // 3) {"lat":null} allein → 422 (unpaarig: lat leer, lon noch gesetzt).
    let (s, _) = anfrage(&app, "PATCH", &pos, &admin, Some(r#"{"lat":null}"#)).await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY, "unpaariges lat=null muss 422 liefern");
}

// ---------- Fall 3: Filter Aufgelöstes + Führungskräfte nur Leader ----------

#[tokio::test]
async fn aufgeloeste_verschwinden_und_karte_zeigt_nur_leader() {
    let (app, _live, _pool) = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;

    // Einheit auflösen → verschwindet aus GET .../einheiten.
    let weg = einheit_bilden(&app, &admin, einsatz, "Auflöser").await;
    let bleibt = einheit_bilden(&app, &admin, einsatz, "Bleibt").await;
    assert_eq!(
        anfrage(&app, "DELETE", &format!("/api/einsaetze/{einsatz}/einheiten/{weg}"), &admin, None).await.0,
        StatusCode::NO_CONTENT
    );
    let (_, liste) = anfrage(&app, "GET", &format!("/api/einsaetze/{einsatz}/einheiten"), &admin, None).await;
    let ids: Vec<i64> = liste.as_array().unwrap().iter().map(|e| e["id"].as_i64().unwrap()).collect();
    assert!(!ids.contains(&weg), "aufgelöste Einheit darf nicht mehr gelistet werden");
    assert!(ids.contains(&bleibt));

    // Personal: einer wird Einheitsführer, einer bleibt normal.
    let chef = person_anlegen(&app, &admin, einsatz, "Chef").await;
    let normal = person_anlegen(&app, &admin, einsatz, "Helfer").await;
    // Chef in die verbleibende Einheit, dann als Führer setzen.
    assert_eq!(
        anfrage(&app, "PUT", &format!("/api/einsaetze/{einsatz}/einheiten/{bleibt}/personal/{chef}"), &admin, None).await.0,
        StatusCode::NO_CONTENT
    );
    let (s, _) = anfrage(&app, "PATCH", &format!("/api/einsaetze/{einsatz}/einheiten/{bleibt}"), &admin,
        Some(&format!(r#"{{"name":"Bleibt","fuehrer_id":{chef}}}"#))).await;
    assert_eq!(s, StatusCode::OK);

    // Karten-Führungskräfte enthält nur den Leader (Chef), nicht den normalen Helfer.
    let (s, fk) = anfrage(&app, "GET", &format!("/api/einsaetze/{einsatz}/karte/fuehrungskraefte"), &admin, None).await;
    assert_eq!(s, StatusCode::OK);
    let fk_ids: Vec<i64> = fk.as_array().unwrap().iter().map(|p| p["id"].as_i64().unwrap()).collect();
    assert!(fk_ids.contains(&chef), "Einheitsführer muss in karte/fuehrungskraefte erscheinen");
    assert!(!fk_ids.contains(&normal), "normales Personal darf NICHT in karte/fuehrungskraefte erscheinen");
    assert_eq!(fk_ids.len(), 1, "nur der eine Leader darf gelistet sein");
}

// ---------- Fall 4: Org-Isolation (regulärer Fremd-Nutzer) ----------

#[tokio::test]
async fn fremder_org_nutzer_wird_abgewiesen() {
    let (app, _live, pool) = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let eid = einheit_bilden(&app, &admin, einsatz, "1. Zug").await;

    // Zweite Organisation + Nutzer in Org B (system_rolle='keiner', org_rolle default 'keine',
    // keine Einsatz-Mitgliedschaft). Passwort-Hash vom Bootstrap-Admin wiederverwenden
    // (gleicher Klartext "startpw12") — unabhängig von der Sichtbarkeit des password-Moduls.
    let org_b: i64 = sqlx::query_scalar("INSERT INTO organisation (name) VALUES ('Fremd-Orga') RETURNING id")
        .fetch_one(&pool).await.unwrap();
    let admin_hash: String = sqlx::query_scalar("SELECT passwort_hash FROM benutzer WHERE benutzername = 'admin'")
        .fetch_one(&pool).await.unwrap();
    sqlx::query(
        "INSERT INTO benutzer (org_id, anzeigename, benutzername, passwort_hash, system_rolle) \
         VALUES (?, 'Fremd', 'fremd', ?, 'keiner')",
    ).bind(org_b).bind(&admin_hash).execute(&pool).await.unwrap();

    let fremd = login_cookie(&app, "fremd", "startpw12").await;

    // Lesen ist verboten (kein Mitglied, keine höhere Berechtigung) → 403.
    assert_eq!(
        anfrage(&app, "GET", &format!("/api/einsaetze/{einsatz}/einheiten"), &fremd, None).await.0,
        StatusCode::FORBIDDEN
    );
    // Geo-PATCH ebenso → 403 (Schreibrecht-Gate vor Laden) oder 404.
    let s = anfrage(&app, "PATCH", &format!("/api/einsaetze/{einsatz}/einheiten/{eid}/position"), &fremd,
        Some(r#"{"lat":52.5,"lon":13.4}"#)).await.0;
    assert!(matches!(s, StatusCode::FORBIDDEN | StatusCode::NOT_FOUND), "Fremd-PATCH muss 403/404 sein, war {s}");
}

// ---------- Fall 5: SSE feuert bei Geo-PATCH UND K&M-Mutation ----------

#[tokio::test]
async fn sse_feuert_bei_kum_mutation_und_geo_patch() {
    let (app, live, _pool) = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await; // Anlage ist kein gemessenes Event.

    // VOR den Aktionen abonnieren — derselbe Arc wie im AppState.
    let mut rx = live.abonniere(einsatz);
    let kurz = Duration::from_secs(2);

    // K&M-Mutation: Einheit bilden → feuert "etb" + "einheit"; auf "einheit" warten.
    let eid = einheit_bilden(&app, &admin, einsatz, "1. Zug").await;
    let n = recv_until_tag(&mut rx, "einheit", kurz).await;
    assert!(n.data.contains(&format!("\"einheit_id\":{eid}")), "Event-Payload muss die einheit_id tragen");

    // Geo-PATCH auf dieselbe Einheit → erneut ein "einheit"-Event (ohne ETB).
    let (s, _) = anfrage(&app, "PATCH", &format!("/api/einsaetze/{einsatz}/einheiten/{eid}/position"), &admin,
        Some(r#"{"lat":52.5,"lon":13.4}"#)).await;
    assert_eq!(s, StatusCode::OK);
    let n = recv_until_tag(&mut rx, "einheit", kurz).await;
    assert!(n.data.contains(&format!("\"einheit_id\":{eid}")));
}
