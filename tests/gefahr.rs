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

async fn benutzer_anlegen(app: &axum::Router, admin: &str, name: &str, org_rolle: &str) -> i64 {
    let body = format!(r#"{{"anzeigename":"{name}","benutzername":"{name}","passwort":"{name}pw1","org_rolle":"{org_rolle}"}}"#);
    let (status, json) = anfrage(app, "POST", "/api/benutzer", admin, Some(&body)).await;
    assert_eq!(status, StatusCode::CREATED, "{json:?}");
    json["id"].as_i64().unwrap()
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
    assert_eq!(status, StatusCode::CREATED, "{json:?}");
    json["id"].as_i64().unwrap()
}

async fn rolle_setzen(app: &axum::Router, leit: &str, einsatz: i64, benutzer_id: i64, rolle: &str) {
    let (status, _) = anfrage(app, "PUT", &format!("/api/einsaetze/{einsatz}/mitglieder/{benutzer_id}"), leit,
        Some(&format!(r#"{{"einsatz_rolle":"{rolle}"}}"#))).await;
    assert_eq!(status, StatusCode::OK);
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

fn bewertung(typ: &str, objekt: &str, warn: &str) -> String {
    json!({"gefahrentyp": typ, "schutzobjekt": objekt, "warnstufe": warn}).to_string()
}

#[tokio::test]
async fn matrix_leer_dann_put_dann_upsert() {
    let (app, _live) = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;

    let (_, leer) = anfrage(&app, "GET", &format!("/api/einsaetze/{einsatz}/gefahrenmatrix"), &admin, None).await;
    assert_eq!(leer.as_array().unwrap().len(), 0);

    let (status, z) = anfrage(&app, "PUT", &format!("/api/einsaetze/{einsatz}/gefahrenmatrix/bewertung"), &admin, Some(&bewertung("brand", "menschen", "hoch"))).await;
    assert_eq!(status, StatusCode::OK, "{z:?}");
    assert_eq!(z["warnstufe"], "hoch");

    let (_, liste) = anfrage(&app, "GET", &format!("/api/einsaetze/{einsatz}/gefahrenmatrix"), &admin, None).await;
    assert_eq!(liste.as_array().unwrap().len(), 1);

    anfrage(&app, "PUT", &format!("/api/einsaetze/{einsatz}/gefahrenmatrix/bewertung"), &admin, Some(&bewertung("brand", "menschen", "akut"))).await;
    let (_, liste2) = anfrage(&app, "GET", &format!("/api/einsaetze/{einsatz}/gefahrenmatrix"), &admin, None).await;
    assert_eq!(liste2.as_array().unwrap().len(), 1, "UPSERT, keine zweite Zeile");
    assert_eq!(liste2[0]["warnstufe"], "akut");
}

#[tokio::test]
async fn keine_leert_die_zelle() {
    let (app, _live) = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    anfrage(&app, "PUT", &format!("/api/einsaetze/{einsatz}/gefahrenmatrix/bewertung"), &admin, Some(&bewertung("brand", "menschen", "hoch"))).await;
    anfrage(&app, "PUT", &format!("/api/einsaetze/{einsatz}/gefahrenmatrix/bewertung"), &admin, Some(&bewertung("brand", "menschen", "keine"))).await;
    let (_, liste) = anfrage(&app, "GET", &format!("/api/einsaetze/{einsatz}/gefahrenmatrix"), &admin, None).await;
    assert_eq!(liste.as_array().unwrap().len(), 0, "keine darf kein Phantom hinterlassen");
}

#[tokio::test]
async fn ungueltiger_enum_und_kombination_sind_422() {
    let (app, _live) = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let u = format!("/api/einsaetze/{einsatz}/gefahrenmatrix/bewertung");

    assert_eq!(anfrage(&app, "PUT", &u, &admin, Some(&bewertung("quatsch", "menschen", "hoch"))).await.0, StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(anfrage(&app, "PUT", &u, &admin, Some(&bewertung("brand", "quatsch", "hoch"))).await.0, StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(anfrage(&app, "PUT", &u, &admin, Some(&bewertung("brand", "menschen", "quatsch"))).await.0, StatusCode::UNPROCESSABLE_ENTITY);
    // Ungültige Kombination: sachwerte × atemgifte.
    assert_eq!(anfrage(&app, "PUT", &u, &admin, Some(&bewertung("atemgifte", "sachwerte", "hoch"))).await.0, StatusCode::UNPROCESSABLE_ENTITY);
}

#[tokio::test]
async fn etb_bei_warnstufenwechsel_nicht_bei_reiner_beschreibung() {
    let (app, _live) = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let u = format!("/api/einsaetze/{einsatz}/gefahrenmatrix/bewertung");

    anfrage(&app, "PUT", &u, &admin, Some(&bewertung("brand", "menschen", "hoch"))).await;
    let etb = system_etb_inhalte(&app, &admin, einsatz).await;
    assert!(etb.iter().any(|i| i == "Gefahr «Brand» für «Menschen» auf Warnstufe «hoch» gesetzt."), "ETB: {etb:?}");
    let basis = etb.len();

    // Gleiche Warnstufe, nur Beschreibung → KEIN neuer ETB-Eintrag.
    let nur_beschreibung = json!({"gefahrentyp":"brand","schutzobjekt":"menschen","warnstufe":"hoch","beschreibung":"Dachstuhl"}).to_string();
    anfrage(&app, "PUT", &u, &admin, Some(&nur_beschreibung)).await;
    assert_eq!(system_etb_inhalte(&app, &admin, einsatz).await.len(), basis, "Beschreibung allein darf keinen ETB erzeugen");

    // Warnstufe → keine: ETB „aufgehoben".
    anfrage(&app, "PUT", &u, &admin, Some(&bewertung("brand", "menschen", "keine"))).await;
    let etb2 = system_etb_inhalte(&app, &admin, einsatz).await;
    assert_eq!(etb2.len(), basis + 1);
    assert!(etb2.iter().any(|i| i == "Gefahr «Brand» für «Menschen» aufgehoben."), "ETB: {etb2:?}");
}

#[tokio::test]
async fn sse_feuert_bei_put() {
    let (app, live) = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let mut rx = live.abonniere(einsatz);
    anfrage(&app, "PUT", &format!("/api/einsaetze/{einsatz}/gefahrenmatrix/bewertung"), &admin, Some(&bewertung("brand", "menschen", "hoch"))).await;
    let n = recv_until_tag(&mut rx, "gefahr", Duration::from_secs(1)).await;
    let v: Value = serde_json::from_str(&n.data).unwrap();
    assert_eq!(v["einsatz_id"], einsatz);
}

#[tokio::test]
async fn berechtigung_beobachter_liest_schreibt_nicht() {
    let (app, _live) = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let erika = benutzer_anlegen(&app, &admin, "erika", "keine").await;
    rolle_setzen(&app, &admin, einsatz, erika, "beobachter").await;
    let erika_c = login_cookie(&app, "erika", "erikapw1").await;
    assert_eq!(anfrage(&app, "GET", &format!("/api/einsaetze/{einsatz}/gefahrenmatrix"), &erika_c, None).await.0, StatusCode::OK);
    assert_eq!(anfrage(&app, "PUT", &format!("/api/einsaetze/{einsatz}/gefahrenmatrix/bewertung"), &erika_c, Some(&bewertung("brand", "menschen", "hoch"))).await.0, StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn org_isolation_fremder_nutzer_abgewiesen() {
    let (app, _live) = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    benutzer_anlegen(&app, &admin, "fremd", "keine").await;
    let fremd = login_cookie(&app, "fremd", "fremdpw1").await;
    let get = anfrage(&app, "GET", &format!("/api/einsaetze/{einsatz}/gefahrenmatrix"), &fremd, None).await.0;
    assert!(matches!(get, StatusCode::FORBIDDEN | StatusCode::NOT_FOUND), "GET: {get}");
    let put = anfrage(&app, "PUT", &format!("/api/einsaetze/{einsatz}/gefahrenmatrix/bewertung"), &fremd, Some(&bewertung("brand", "menschen", "hoch"))).await.0;
    assert!(matches!(put, StatusCode::FORBIDDEN | StatusCode::NOT_FOUND), "PUT: {put}");
}
