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

#[tokio::test]
async fn anlegen_listen_und_erledigen() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;

    let (status, json) = anfrage(&app, "POST", &format!("/api/einsaetze/{e}/erinnerungen"), &admin,
        Some(r#"{"titel":"Lagemeldung","faellig_at":"2026-06-11 10:00","intervall_minuten":30}"#)).await;
    assert_eq!(status, StatusCode::CREATED);
    let eid = json["id"].as_i64().unwrap();
    assert_eq!(json["status"], "offen");
    assert_eq!(json["faellig_at"], "2026-06-11 10:00:00", "auf Sekundenformat normalisiert");

    let (status, liste) = anfrage(&app, "GET", &format!("/api/einsaetze/{e}/erinnerungen?nur_offen=true"), &admin, None).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(liste.as_array().unwrap().len(), 1);

    let (status, _) = anfrage(&app, "POST", &format!("/api/einsaetze/{e}/erinnerungen/{eid}/erledigen"), &admin, None).await;
    assert_eq!(status, StatusCode::OK);

    let (_, liste) = anfrage(&app, "GET", &format!("/api/einsaetze/{e}/erinnerungen?nur_offen=true"), &admin, None).await;
    assert!(liste.as_array().unwrap().is_empty(), "erledigte verschwinden aus offener Liste");
}

#[tokio::test]
async fn anlegen_lehnt_leeren_titel_ab() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let (status, _) = anfrage(&app, "POST", &format!("/api/einsaetze/{e}/erinnerungen"), &admin,
        Some(r#"{"titel":"  ","faellig_at":"2026-06-11 10:00"}"#)).await;
    // Leerer Titel → AppError::Validation → 400 (Bestandskonvention, vgl. src/error.rs + tests/chat.rs).
    assert_eq!(status, StatusCode::BAD_REQUEST);
}

// --- Sachbezug-Guard (LFH-112): Allowlist + einsatz-gescopter Existenz-Check ---

#[tokio::test]
async fn erinnerung_bezug_fremde_meldung_ist_404() {
    // Schreibberechtigter in Einsatz e1 darf keine Meldungs-ID aus e2 referenzieren —
    // sonst Cross-Einsatz-Schreibzugriff über den Scheduler (setze_eskaliert, nicht
    // einsatz-gescopt). Der Guard weist das an der Quelle ab.
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e1 = einsatz_anlegen(&app, &admin).await;
    let e2 = einsatz_anlegen(&app, &admin).await;
    // Fremde Meldung in e2 anlegen.
    let meldung_body = serde_json::json!({
        "absender": "Florian Nord 1", "empfaenger": "ELW 1", "meldeweg": "funk",
        "inhalt": "Deich instabil", "ereigniszeit": "2026-06-12 09:00:00"
    }).to_string();
    let (status, m) = anfrage(&app, "POST", &format!("/api/einsaetze/{e2}/meldungen"), &admin, Some(&meldung_body)).await;
    assert_eq!(status, StatusCode::CREATED);
    let fremde_mid = m["id"].as_i64().unwrap();

    let body = format!(
        r#"{{"titel":"X","faellig_at":"2026-06-11 10:00","bezug_typ":"meldung","bezug_id":{fremde_mid}}}"#
    );
    let (status, _) = anfrage(&app, "POST", &format!("/api/einsaetze/{e1}/erinnerungen"), &admin, Some(&body)).await;
    assert_eq!(status, StatusCode::NOT_FOUND, "fremde Meldungs-ID als Bezug → 404");
}

#[tokio::test]
async fn erinnerung_bezug_unbekannter_typ_ist_400() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let (status, _) = anfrage(&app, "POST", &format!("/api/einsaetze/{e}/erinnerungen"), &admin,
        Some(r#"{"titel":"X","faellig_at":"2026-06-11 10:00","bezug_typ":"schaden","bezug_id":1}"#)).await;
    assert_eq!(status, StatusCode::BAD_REQUEST, "bezug_typ nicht in der Allowlist → Validation");
}

#[tokio::test]
async fn erinnerung_bezug_gueltige_etb_ist_201() {
    // Regression: der EtbPage-Frontend-Pfad postet bezug_typ='etb' + ETB-Eintrag-ID
    // desselben Einsatzes — muss weiter grün bleiben.
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let (status, etb) = anfrage(&app, "POST", &format!("/api/einsaetze/{e}/etb"), &admin,
        Some(r#"{"typ":"meldung","inhalt":"Deich instabil"}"#)).await;
    assert_eq!(status, StatusCode::CREATED);
    let etb_id = etb["id"].as_i64().unwrap();

    let body = format!(
        r#"{{"titel":"Nachverfolgen","faellig_at":"2026-06-11 10:00","bezug_typ":"etb","bezug_id":{etb_id}}}"#
    );
    let (status, json) = anfrage(&app, "POST", &format!("/api/einsaetze/{e}/erinnerungen"), &admin, Some(&body)).await;
    assert_eq!(status, StatusCode::CREATED, "gültiger ETB-Bezug aus demselben Einsatz → 201");
    assert_eq!(json["bezug_typ"], "etb");
    assert_eq!(json["bezug_id"], etb_id);
}

#[tokio::test]
async fn erledigen_anderer_einsatz_ist_404() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e1 = einsatz_anlegen(&app, &admin).await;
    let e2 = einsatz_anlegen(&app, &admin).await;
    let (_, json) = anfrage(&app, "POST", &format!("/api/einsaetze/{e1}/erinnerungen"), &admin,
        Some(r#"{"titel":"X","faellig_at":"2026-06-11 10:00"}"#)).await;
    let eid = json["id"].as_i64().unwrap();
    // Erinnerung von e1 über e2 ansprechen → NotFound.
    let (status, _) = anfrage(&app, "POST", &format!("/api/einsaetze/{e2}/erinnerungen/{eid}/erledigen"), &admin, None).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
}
