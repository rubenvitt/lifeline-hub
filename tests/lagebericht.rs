use axum::body::{to_bytes, Body};
use axum::http::{header, Request, StatusCode};
use lifeline_hub::app::{build_router, AppState};
use lifeline_hub::auth::bootstrap::bootstrap_admin;
use lifeline_hub::db;
use lifeline_hub::live::LiveHub;
use serde_json::Value;
use tower::ServiceExt;

async fn setup() -> axum::Router {
    let pool = db::test_pool().await;
    bootstrap_admin(&pool, "Test-Orga", "admin", Some("startpw12")).await.unwrap();
    build_router(AppState { pool, live: LiveHub::new(), karten_dir: std::env::temp_dir(), fachebenen: lifeline_hub::karte::FachebenenState::neu() })
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
    assert_eq!(status, StatusCode::CREATED);
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
    assert_eq!(status, StatusCode::CREATED);
    json["id"].as_i64().unwrap()
}

async fn rolle_setzen(app: &axum::Router, leit: &str, einsatz: i64, benutzer_id: i64, rolle: &str) {
    let (status, _) = anfrage(app, "PUT", &format!("/api/einsaetze/{einsatz}/mitglieder/{benutzer_id}"), leit,
        Some(&format!(r#"{{"einsatz_rolle":"{rolle}"}}"#))).await;
    assert_eq!(status, StatusCode::OK);
}

#[tokio::test]
async fn anlegen_und_liste() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let (status, json) = anfrage(&app, "POST", &format!("/api/einsaetze/{einsatz}/lageberichte"), &admin,
        Some(r#"{"vorlage":"lagebericht","titel":"Lage 10:00"}"#)).await;
    assert_eq!(status, StatusCode::CREATED);
    assert_eq!(json["vorlage"], "lagebericht");
    assert_eq!(json["status"], "entwurf");
    assert_eq!(json["abschnitte"].as_array().unwrap().len(), 7);
    let (_, liste) = anfrage(&app, "GET", &format!("/api/einsaetze/{einsatz}/lageberichte"), &admin, None).await;
    assert_eq!(liste.as_array().unwrap().len(), 1);
}

#[tokio::test]
async fn freigabe_schreibt_genau_einen_lage_etb_eintrag() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let (_, lb) = anfrage(&app, "POST", &format!("/api/einsaetze/{einsatz}/lageberichte"), &admin,
        Some(r#"{"vorlage":"freitext","titel":"Lage 10:00"}"#)).await;
    let lid = lb["id"].as_i64().unwrap();
    let (s, _) = anfrage(&app, "PATCH", &format!("/api/einsaetze/{einsatz}/lageberichte/{lid}"), &admin,
        Some(r#"{"abschnitte":[{"schluessel":"text","text":"Hochwasser steigt."}]}"#)).await;
    assert_eq!(s, StatusCode::OK);
    let (s, frei) = anfrage(&app, "POST", &format!("/api/einsaetze/{einsatz}/lageberichte/{lid}/freigeben"), &admin, None).await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(frei["status"], "freigegeben");
    assert!(frei["etb_eintrag_id"].is_i64());
    let (_, etb) = anfrage(&app, "GET", &format!("/api/einsaetze/{einsatz}/etb"), &admin, None).await;
    let lage: Vec<&serde_json::Value> = etb.as_array().unwrap().iter().filter(|e| e["typ"] == "lage").collect();
    assert_eq!(lage.len(), 1);
    assert!(lage[0]["inhalt"].as_str().unwrap().contains("Hochwasser steigt."));
    assert_eq!(lage[0]["lagebericht_id"], lid);
}

#[tokio::test]
async fn freigegebener_bericht_nicht_mehr_patchbar() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let (_, lb) = anfrage(&app, "POST", &format!("/api/einsaetze/{einsatz}/lageberichte"), &admin,
        Some(r#"{"vorlage":"freitext","titel":"X"}"#)).await;
    let lid = lb["id"].as_i64().unwrap();
    anfrage(&app, "PATCH", &format!("/api/einsaetze/{einsatz}/lageberichte/{lid}"), &admin,
        Some(r#"{"abschnitte":[{"schluessel":"text","text":"A"}]}"#)).await;
    anfrage(&app, "POST", &format!("/api/einsaetze/{einsatz}/lageberichte/{lid}/freigeben"), &admin, None).await;
    let (s, _) = anfrage(&app, "PATCH", &format!("/api/einsaetze/{einsatz}/lageberichte/{lid}"), &admin,
        Some(r#"{"titel":"Neu"}"#)).await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY);
}

#[tokio::test]
async fn freigabe_leerer_bericht_422() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let (_, lb) = anfrage(&app, "POST", &format!("/api/einsaetze/{einsatz}/lageberichte"), &admin,
        Some(r#"{"vorlage":"freitext","titel":"X"}"#)).await;
    let lid = lb["id"].as_i64().unwrap();
    let (s, _) = anfrage(&app, "POST", &format!("/api/einsaetze/{einsatz}/lageberichte/{lid}/freigeben"), &admin, None).await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY);
}

#[tokio::test]
async fn fortschreiben_erzeugt_version_2() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let (_, lb) = anfrage(&app, "POST", &format!("/api/einsaetze/{einsatz}/lageberichte"), &admin,
        Some(r#"{"vorlage":"freitext","titel":"Lage"}"#)).await;
    let lid = lb["id"].as_i64().unwrap();
    anfrage(&app, "PATCH", &format!("/api/einsaetze/{einsatz}/lageberichte/{lid}"), &admin,
        Some(r#"{"abschnitte":[{"schluessel":"text","text":"A"}]}"#)).await;
    anfrage(&app, "POST", &format!("/api/einsaetze/{einsatz}/lageberichte/{lid}/freigeben"), &admin, None).await;
    let (s, fort) = anfrage(&app, "POST", &format!("/api/einsaetze/{einsatz}/lageberichte/{lid}/fortschreiben"), &admin,
        Some(r#"{}"#)).await;
    assert_eq!(s, StatusCode::CREATED);
    assert_eq!(fort["version"], 2);
    assert_eq!(fort["vorgaenger_id"], lid);
    assert_eq!(fort["status"], "entwurf");
    // Fortschreibung übernimmt die Inhalte des freigegebenen Vorgängers als Ausgangspunkt.
    assert_eq!(fort["abschnitte"][0]["text"], "A");
}

#[tokio::test]
async fn beobachter_liest_aber_schreibt_nicht() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let beo = benutzer_anlegen(&app, &admin, "erika", "keine").await;
    rolle_setzen(&app, &admin, einsatz, beo, "beobachter").await;
    let erika = login_cookie(&app, "erika", "erikapw1").await;
    assert_eq!(anfrage(&app, "GET", &format!("/api/einsaetze/{einsatz}/lageberichte"), &erika, None).await.0, StatusCode::OK);
    assert_eq!(
        anfrage(&app, "POST", &format!("/api/einsaetze/{einsatz}/lageberichte"), &erika,
            Some(r#"{"vorlage":"freitext","titel":"X"}"#)).await.0,
        StatusCode::FORBIDDEN
    );
}
