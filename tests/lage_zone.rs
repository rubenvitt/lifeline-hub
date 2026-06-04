//! L-3 Gefahren- & Absperrzonen — Backend-Integrationstests.
//!
//! Deckt ab: CRUD + ETB-Wortlaut («eingerichtet/geändert/aufgehoben»), 422 bei
//! ungültigem typ/geometrie_typ und Geometrie-Klassen-Mismatch (POST und PATCH),
//! ETB-Regeln (notiz/farbe schreiben KEINEN ETB, label/typ schon), SSE-Event
//! `lage_zone` bei POST/PATCH/DELETE und reguläre Org-Isolation (Fremd-Nutzer ohne
//! Mitgliedschaft, org_rolle="keine").
//!
//! Harness 1:1 aus tests/einsatzabschnitt.rs (+ etb.rs); `setup()` liefert zusätzlich
//! den LiveHub-Klon (teilt den inneren Arc mit dem AppState), damit der SSE-Test direkt
//! via `live.abonniere(einsatz_id)` mithören kann.

use axum::body::{to_bytes, Body};
use axum::http::{header, Request, StatusCode};
use lifeline_hub::app::{build_router, AppState};
use lifeline_hub::auth::bootstrap::bootstrap_admin;
use lifeline_hub::db;
use lifeline_hub::live::{LiveHub, LiveNachricht};
use serde_json::{json, Value};
use std::time::Duration;
use tokio::sync::broadcast::Receiver;
use tower::ServiceExt;

const POLY: &str = r#"{"type":"Polygon","coordinates":[[[8.6,50.1],[8.7,50.1],[8.7,50.2],[8.6,50.1]]]}"#;
const LINE: &str = r#"{"type":"LineString","coordinates":[[8.6,50.1],[8.7,50.2]]}"#;

async fn setup() -> (axum::Router, LiveHub) {
    let pool = db::test_pool().await;
    bootstrap_admin(&pool, "Test-Orga", "admin", Some("startpw12")).await.unwrap();
    let live = LiveHub::new();
    let router = build_router(AppState { pool, live: live.clone() });
    (router, live)
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

/// Legt einen Benutzer in der Bootstrap-Org an (POST /api/benutzer). 1:1 aus
/// tests/einsatzabschnitt.rs — Passwort-Konvention ist `{name}pw1`.
async fn benutzer_anlegen(app: &axum::Router, admin: &str, name: &str, org_rolle: &str) -> i64 {
    let body = format!(r#"{{"anzeigename":"{name}","benutzername":"{name}","passwort":"{name}pw1","org_rolle":"{org_rolle}"}}"#);
    let (status, json) = anfrage(app, "POST", "/api/benutzer", admin, Some(&body)).await;
    assert_eq!(status, StatusCode::CREATED);
    json["id"].as_i64().unwrap()
}

/// Fremder Nutzer ohne Einsatz-Mitgliedschaft und ohne höhere Berechtigung
/// (org_rolle="keine") — liefert dessen Login-Cookie. Vorbild: Org-Isolations-Test
/// in tests/einsatzabschnitt.rs (`fremde_org_kann_abschnitte_nicht_lesen_oder_schreiben`).
async fn fremder_nutzer(app: &axum::Router, admin: &str) -> String {
    benutzer_anlegen(app, admin, "fremd", "keine").await;
    login_cookie(app, "fremd", "fremdpw1").await
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
    assert_eq!(status, StatusCode::CREATED, "Einsatz anlegen: {json:?}");
    json["id"].as_i64().unwrap()
}

async fn system_etb_inhalte(app: &axum::Router, cookie: &str, einsatz: i64) -> Vec<String> {
    let (_, json) = anfrage(app, "GET", &format!("/api/einsaetze/{einsatz}/etb"), cookie, None).await;
    json.as_array().unwrap().iter().filter(|e| e["typ"] == "system")
        .map(|e| e["inhalt"].as_str().unwrap().to_string()).collect()
}

async fn recv_until_tag(rx: &mut Receiver<LiveNachricht>, tag: &str, timeout: Duration) -> LiveNachricht {
    loop {
        let n = tokio::time::timeout(timeout, rx.recv()).await
            .unwrap_or_else(|_| panic!("Timeout: kein '{tag}'-Event empfangen"))
            .expect("Broadcast-Kanal geschlossen");
        if n.event == tag { return n; }
    }
}

#[tokio::test]
async fn anlegen_setzt_zone_und_schreibt_etb_eingerichtet() {
    let (app, _live) = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;

    let body = json!({"typ":"gefahrengebiet","geometrie_typ":"Polygon","geometrie":POLY,"label":"Chemie Halle 3"}).to_string();
    let (status, z) = anfrage(&app, "POST", &format!("/api/einsaetze/{einsatz}/zonen"), &admin, Some(&body)).await;
    assert_eq!(status, StatusCode::CREATED, "{z:?}");
    assert_eq!(z["typ"], "gefahrengebiet");
    assert_eq!(z["geometrie_typ"], "Polygon");

    let (_, liste) = anfrage(&app, "GET", &format!("/api/einsaetze/{einsatz}/zonen"), &admin, None).await;
    assert_eq!(liste.as_array().unwrap().len(), 1);

    let etb = system_etb_inhalte(&app, &admin, einsatz).await;
    assert!(etb.iter().any(|i| i == "Gefahrengebiet «Chemie Halle 3» eingerichtet"), "ETB: {etb:?}");
}

#[tokio::test]
async fn ungueltiger_typ_und_geometrie_typ_sind_422() {
    let (app, _live) = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;

    let b1 = json!({"typ":"quatsch","geometrie_typ":"Polygon","geometrie":POLY}).to_string();
    assert_eq!(anfrage(&app, "POST", &format!("/api/einsaetze/{einsatz}/zonen"), &admin, Some(&b1)).await.0, StatusCode::UNPROCESSABLE_ENTITY);

    let b2 = json!({"typ":"absperrgrenze","geometrie_typ":"Polygon","geometrie":POLY}).to_string();
    assert_eq!(anfrage(&app, "POST", &format!("/api/einsaetze/{einsatz}/zonen"), &admin, Some(&b2)).await.0, StatusCode::UNPROCESSABLE_ENTITY);

    let b3 = json!({"typ":"gefahrengebiet","geometrie_typ":"Polygon","geometrie":LINE}).to_string();
    assert_eq!(anfrage(&app, "POST", &format!("/api/einsaetze/{einsatz}/zonen"), &admin, Some(&b3)).await.0, StatusCode::UNPROCESSABLE_ENTITY);
}

#[tokio::test]
async fn patch_typ_oder_label_schreibt_etb_geaendert_notiz_und_farbe_nicht() {
    let (app, _live) = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let body = json!({"typ":"freie_skizze","geometrie_typ":"Polygon","geometrie":POLY,"label":"A","farbe":"#00ff00"}).to_string();
    let (_, z) = anfrage(&app, "POST", &format!("/api/einsaetze/{einsatz}/zonen"), &admin, Some(&body)).await;
    let zid = z["id"].as_i64().unwrap();
    let basis = system_etb_inhalte(&app, &admin, einsatz).await.len();

    anfrage(&app, "PATCH", &format!("/api/einsaetze/{einsatz}/zonen/{zid}"), &admin, Some(r#"{"notiz":"egal"}"#)).await;
    assert_eq!(system_etb_inhalte(&app, &admin, einsatz).await.len(), basis, "notiz darf keinen ETB erzeugen");

    anfrage(&app, "PATCH", &format!("/api/einsaetze/{einsatz}/zonen/{zid}"), &admin, Some(r##"{"farbe":"#ff0000"}"##)).await;
    assert_eq!(system_etb_inhalte(&app, &admin, einsatz).await.len(), basis, "farbe darf keinen ETB erzeugen");

    anfrage(&app, "PATCH", &format!("/api/einsaetze/{einsatz}/zonen/{zid}"), &admin, Some(r#"{"label":"B"}"#)).await;
    let etb = system_etb_inhalte(&app, &admin, einsatz).await;
    assert_eq!(etb.len(), basis + 1, "label-Änderung muss genau einen ETB erzeugen");
    assert!(etb.iter().any(|i| i == "Freie Skizze «B» geändert"), "ETB: {etb:?}");
}

#[tokio::test]
async fn patch_typ_weg_von_freie_skizze_nullt_farbe() {
    let (app, _live) = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    // Freie Skizze (Polygon) mit Farbe; gefahrengebiet ist ebenfalls Polygon → Typ-Wechsel zulässig.
    let body = json!({"typ":"freie_skizze","geometrie_typ":"Polygon","geometrie":POLY,"farbe":"#00ff00"}).to_string();
    let (_, z) = anfrage(&app, "POST", &format!("/api/einsaetze/{einsatz}/zonen"), &admin, Some(&body)).await;
    let zid = z["id"].as_i64().unwrap();
    assert_eq!(z["farbe"], "#00ff00");

    let (status, nach) = anfrage(&app, "PATCH", &format!("/api/einsaetze/{einsatz}/zonen/{zid}"), &admin, Some(r#"{"typ":"gefahrengebiet"}"#)).await;
    assert_eq!(status, StatusCode::OK, "{nach:?}");
    assert_eq!(nach["typ"], "gefahrengebiet");
    assert!(nach["farbe"].is_null(), "farbe muss beim Wechsel weg von freie_skizze genullt werden: {nach:?}");
}

#[tokio::test]
async fn patch_typ_inkompatibel_zur_geometrie_ist_422() {
    let (app, _live) = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let body = json!({"typ":"absperrgrenze","geometrie_typ":"LineString","geometrie":LINE}).to_string();
    let (_, z) = anfrage(&app, "POST", &format!("/api/einsaetze/{einsatz}/zonen"), &admin, Some(&body)).await;
    let zid = z["id"].as_i64().unwrap();
    let (status, _) = anfrage(&app, "PATCH", &format!("/api/einsaetze/{einsatz}/zonen/{zid}"), &admin, Some(r#"{"typ":"gefahrengebiet"}"#)).await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
}

#[tokio::test]
async fn delete_schreibt_etb_aufgehoben() {
    let (app, _live) = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let body = json!({"typ":"sperrgebiet","geometrie_typ":"Polygon","geometrie":POLY,"label":"Tor 2"}).to_string();
    let (_, z) = anfrage(&app, "POST", &format!("/api/einsaetze/{einsatz}/zonen"), &admin, Some(&body)).await;
    let zid = z["id"].as_i64().unwrap();
    let (status, _) = anfrage(&app, "DELETE", &format!("/api/einsaetze/{einsatz}/zonen/{zid}"), &admin, None).await;
    assert_eq!(status, StatusCode::NO_CONTENT);
    let etb = system_etb_inhalte(&app, &admin, einsatz).await;
    assert!(etb.iter().any(|i| i == "Sperrgebiet «Tor 2» aufgehoben"), "ETB: {etb:?}");
    let (_, liste) = anfrage(&app, "GET", &format!("/api/einsaetze/{einsatz}/zonen"), &admin, None).await;
    assert_eq!(liste.as_array().unwrap().len(), 0);
}

#[tokio::test]
async fn sse_feuert_bei_post_patch_delete() {
    let (app, live) = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let mut rx = live.abonniere(einsatz);

    let body = json!({"typ":"gefahrengebiet","geometrie_typ":"Polygon","geometrie":POLY}).to_string();
    let (_, z) = anfrage(&app, "POST", &format!("/api/einsaetze/{einsatz}/zonen"), &admin, Some(&body)).await;
    let n = recv_until_tag(&mut rx, "lage_zone", Duration::from_secs(1)).await;
    let v: Value = serde_json::from_str(&n.data).unwrap();
    assert_eq!(v["einsatz_id"], einsatz);
    let zid = z["id"].as_i64().unwrap();

    anfrage(&app, "PATCH", &format!("/api/einsaetze/{einsatz}/zonen/{zid}"), &admin, Some(r#"{"label":"X"}"#)).await;
    recv_until_tag(&mut rx, "lage_zone", Duration::from_secs(1)).await;

    anfrage(&app, "DELETE", &format!("/api/einsaetze/{einsatz}/zonen/{zid}"), &admin, None).await;
    recv_until_tag(&mut rx, "lage_zone", Duration::from_secs(1)).await;
}

#[tokio::test]
async fn org_isolation_fremder_nutzer_kann_zonen_nicht_lesen_oder_schreiben() {
    let (app, _live) = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let body = json!({"typ":"gefahrengebiet","geometrie_typ":"Polygon","geometrie":POLY}).to_string();
    let (_, z) = anfrage(&app, "POST", &format!("/api/einsaetze/{einsatz}/zonen"), &admin, Some(&body)).await;
    let zid = z["id"].as_i64().unwrap();

    let fremd_c = fremder_nutzer(&app, &admin).await;

    let get = anfrage(&app, "GET", &format!("/api/einsaetze/{einsatz}/zonen"), &fremd_c, None).await.0;
    assert!(matches!(get, StatusCode::FORBIDDEN | StatusCode::NOT_FOUND), "GET: {get}");
    let post = anfrage(&app, "POST", &format!("/api/einsaetze/{einsatz}/zonen"), &fremd_c, Some(&body)).await.0;
    assert!(matches!(post, StatusCode::FORBIDDEN | StatusCode::NOT_FOUND), "POST: {post}");
    let patch = anfrage(&app, "PATCH", &format!("/api/einsaetze/{einsatz}/zonen/{zid}"), &fremd_c, Some(r#"{"label":"x"}"#)).await.0;
    assert!(matches!(patch, StatusCode::FORBIDDEN | StatusCode::NOT_FOUND), "PATCH: {patch}");
    let del = anfrage(&app, "DELETE", &format!("/api/einsaetze/{einsatz}/zonen/{zid}"), &fremd_c, None).await.0;
    assert!(matches!(del, StatusCode::FORBIDDEN | StatusCode::NOT_FOUND), "DELETE: {del}");
}

#[tokio::test]
async fn gefahrengebiet_mit_zuordnung_macht_lazy_create() {
    let (app, _live) = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let body = json!({"typ":"gefahrengebiet","geometrie_typ":"Polygon","geometrie":POLY,"gefahrentyp":"brand","schutzobjekt":"menschen"}).to_string();
    let (status, z) = anfrage(&app, "POST", &format!("/api/einsaetze/{einsatz}/zonen"), &admin, Some(&body)).await;
    assert_eq!(status, StatusCode::CREATED, "{z:?}");
    assert_eq!(z["gefahrentyp"], "brand");
    assert_eq!(z["schutzobjekt"], "menschen");
    // Lazy-Create legt eine keine-Zelle an → NICHT in der Matrix-Liste (kein Phantom),
    // aber die Matrix bleibt leer (keine != gelistet).
    let (_, matrix) = anfrage(&app, "GET", &format!("/api/einsaetze/{einsatz}/gefahrenmatrix"), &admin, None).await;
    assert_eq!(matrix.as_array().unwrap().len(), 0);
}

#[tokio::test]
async fn zuordnung_an_nicht_gefahrengebiet_ist_422() {
    let (app, _live) = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let body = json!({"typ":"absperrbereich","geometrie_typ":"Polygon","geometrie":POLY,"gefahrentyp":"brand","schutzobjekt":"menschen"}).to_string();
    assert_eq!(anfrage(&app, "POST", &format!("/api/einsaetze/{einsatz}/zonen"), &admin, Some(&body)).await.0, StatusCode::UNPROCESSABLE_ENTITY);
}

#[tokio::test]
async fn nur_eines_der_zuordnungsfelder_ist_422() {
    let (app, _live) = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let body = json!({"typ":"gefahrengebiet","geometrie_typ":"Polygon","geometrie":POLY,"gefahrentyp":"brand"}).to_string();
    assert_eq!(anfrage(&app, "POST", &format!("/api/einsaetze/{einsatz}/zonen"), &admin, Some(&body)).await.0, StatusCode::UNPROCESSABLE_ENTITY);
}

#[tokio::test]
async fn patch_entfernt_zuordnung_ohne_matrixzelle_zu_loeschen() {
    let (app, _live) = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    // Zelle aktiv setzen (warnstufe hoch) → Matrix hat 1 Eintrag.
    anfrage(&app, "PUT", &format!("/api/einsaetze/{einsatz}/gefahrenmatrix/bewertung"), &admin,
        Some(&json!({"gefahrentyp":"brand","schutzobjekt":"menschen","warnstufe":"hoch"}).to_string())).await;
    let body = json!({"typ":"gefahrengebiet","geometrie_typ":"Polygon","geometrie":POLY,"gefahrentyp":"brand","schutzobjekt":"menschen"}).to_string();
    let (_, z) = anfrage(&app, "POST", &format!("/api/einsaetze/{einsatz}/zonen"), &admin, Some(&body)).await;
    let zid = z["id"].as_i64().unwrap();

    // Zuordnung entfernen (beide → null).
    let (status, z2) = anfrage(&app, "PATCH", &format!("/api/einsaetze/{einsatz}/zonen/{zid}"), &admin,
        Some(r#"{"gefahrentyp":null,"schutzobjekt":null}"#)).await;
    assert_eq!(status, StatusCode::OK, "{z2:?}");
    assert!(z2["gefahrentyp"].is_null());
    assert!(z2["schutzobjekt"].is_null());
    // Matrix-Zelle bleibt unangetastet.
    let (_, matrix) = anfrage(&app, "GET", &format!("/api/einsaetze/{einsatz}/gefahrenmatrix"), &admin, None).await;
    assert_eq!(matrix.as_array().unwrap().len(), 1);
    assert_eq!(matrix[0]["warnstufe"], "hoch");
}
