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
    build_router(AppState { pool, live: LiveHub::new(), fachebenen: lifeline_hub::karte::FachebenenState::neu() })
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

async fn person_anlegen(app: &axum::Router, admin: &str, einsatz: i64, name: &str) -> i64 {
    // Stamm anlegen + in den Einsatz disponieren → liefert die einsatz_personal.id.
    let (s1, stamm) = anfrage(app, "POST", "/api/personal", admin, Some(&format!(r#"{{"name":"{name}"}}"#))).await;
    assert_eq!(s1, StatusCode::CREATED);
    let pid = stamm["id"].as_i64().unwrap();
    let (s2, dispo) = anfrage(app, "POST", &format!("/api/einsaetze/{einsatz}/personal"), admin,
        Some(&format!(r#"{{"personal_id":{pid}}}"#))).await;
    assert_eq!(s2, StatusCode::CREATED);
    dispo["id"].as_i64().unwrap()
}

async fn system_etb_anzahl(app: &axum::Router, cookie: &str, einsatz: i64) -> usize {
    let (_, json) = anfrage(app, "GET", &format!("/api/einsaetze/{einsatz}/etb"), cookie, None).await;
    json.as_array().unwrap().iter().filter(|e| e["typ"] == "system").count()
}

#[tokio::test]
async fn anlegen_schreibt_etb_und_liste_zeigt_abschnitt() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let (status, json) = anfrage(&app, "POST", &format!("/api/einsaetze/{einsatz}/abschnitte"), &admin,
        Some(r#"{"name":"Nord"}"#)).await;
    assert_eq!(status, StatusCode::CREATED);
    assert_eq!(json["name"], "Nord");
    assert_eq!(system_etb_anzahl(&app, &admin, einsatz).await, 1);

    let (_, liste) = anfrage(&app, "GET", &format!("/api/einsaetze/{einsatz}/abschnitte"), &admin, None).await;
    assert_eq!(liste.as_array().unwrap().len(), 1);
}

#[tokio::test]
async fn leiter_setzen_und_aufloesen() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let leiter = person_anlegen(&app, &admin, einsatz, "Leiter Nord").await;
    // Snapshot vor den Abschnitt-Aktionen (person_anlegen schreibt ebenfalls System-ETB).
    let etb_vorher = system_etb_anzahl(&app, &admin, einsatz).await;
    let (s, json) = anfrage(&app, "POST", &format!("/api/einsaetze/{einsatz}/abschnitte"), &admin,
        Some(&format!(r#"{{"name":"Nord","leiter_id":{leiter}}}"#))).await;
    assert_eq!(s, StatusCode::CREATED);
    assert_eq!(json["leiter_name"], "Leiter Nord");
    let aid = json["id"].as_i64().unwrap();

    assert_eq!(anfrage(&app, "DELETE", &format!("/api/einsaetze/{einsatz}/abschnitte/{aid}"), &admin, None).await.0, StatusCode::NO_CONTENT);
    // angelegt + aufgelöst = 2 zusätzliche System-Einträge.
    assert_eq!(system_etb_anzahl(&app, &admin, einsatz).await, etb_vorher + 2);
}

#[tokio::test]
async fn beobachter_liest_aber_schreibt_nicht() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let erika = benutzer_anlegen(&app, &admin, "erika", "keine").await;
    rolle_setzen(&app, &admin, einsatz, erika, "beobachter").await;
    let erika_c = login_cookie(&app, "erika", "erikapw1").await;
    assert_eq!(anfrage(&app, "GET", &format!("/api/einsaetze/{einsatz}/abschnitte"), &erika_c, None).await.0, StatusCode::OK);
    assert_eq!(anfrage(&app, "POST", &format!("/api/einsaetze/{einsatz}/abschnitte"), &erika_c, Some(r#"{"name":"X"}"#)).await.0, StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn abgeschlossener_einsatz_ist_409() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    anfrage(&app, "POST", &format!("/api/einsaetze/{einsatz}/abschliessen"), &admin, None).await;
    assert_eq!(anfrage(&app, "POST", &format!("/api/einsaetze/{einsatz}/abschnitte"), &admin, Some(r#"{"name":"X"}"#)).await.0, StatusCode::CONFLICT);
}

#[tokio::test]
async fn fremde_org_kann_abschnitte_nicht_lesen_oder_schreiben() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    // Fremde Org B mit eigenem Admin (kein System-Admin auf Org A).
    // Bootstrap legt nur eine Org an; hier zweiten Nutzer OHNE Mitgliedschaft + ohne höhere Rolle.
    let fremd = benutzer_anlegen(&app, &admin, "fremd", "keine").await;
    let _ = fremd;
    let fremd_c = login_cookie(&app, "fremd", "fremdpw1").await;
    // Kein Mitglied, keine höhere Berechtigung → Forbidden bzw. NotFound.
    let status_get = anfrage(&app, "GET", &format!("/api/einsaetze/{einsatz}/abschnitte"), &fremd_c, None).await.0;
    assert!(matches!(status_get, StatusCode::FORBIDDEN | StatusCode::NOT_FOUND));
    let status_post = anfrage(&app, "POST", &format!("/api/einsaetze/{einsatz}/abschnitte"), &fremd_c, Some(r#"{"name":"X"}"#)).await.0;
    assert!(matches!(status_post, StatusCode::FORBIDDEN | StatusCode::NOT_FOUND));
}
