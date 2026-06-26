use axum::http::StatusCode;
use lifeline_hub::app::{build_router, AppState};
use lifeline_hub::live::LiveHub;
use serde_json::Value;
use tower::ServiceExt;

async fn setup() -> axum::Router {
    let pool = lifeline_hub::db::test_pool().await;
    lifeline_hub::auth::bootstrap::bootstrap_admin(&pool, "Test-Orga", "admin", Some("startpw12"))
        .await
        .unwrap();
    build_router(AppState {
        pool,
        live: LiveHub::new(),
        karten_dir: std::env::temp_dir(), fachebenen: lifeline_hub::karte::FachebenenState::neu(), download_client: lifeline_hub::karte::download::download_client(), download_fortschritt: lifeline_hub::karte::download::neue_fortschritt_map(),
    })
}

async fn login_cookie(app: &axum::Router, benutzername: &str, passwort: &str) -> String {
    let body = serde_json::json!({ "benutzername": benutzername, "passwort": passwort }).to_string();
    let res = app.clone().oneshot(
        axum::http::Request::builder().method("POST").uri("/api/auth/login")
            .header(axum::http::header::CONTENT_TYPE, "application/json").body(body).unwrap(),
    ).await.unwrap();
    let cookie = res.headers().get(axum::http::header::SET_COOKIE).unwrap().to_str().unwrap();
    cookie.split(';').next().unwrap().to_string()
}

async fn anfrage(app: &axum::Router, methode: &str, uri: &str, cookie: &str, body: Option<&str>) -> (StatusCode, Value) {
    let mut req = axum::http::Request::builder().method(methode).uri(uri).header(axum::http::header::COOKIE, cookie);
    if body.is_some() {
        req = req.header(axum::http::header::CONTENT_TYPE, "application/json");
    }
    let res = app.clone().oneshot(req.body(body.unwrap_or("").to_string()).unwrap()).await.unwrap();
    let status = res.status();
    let bytes = axum::body::to_bytes(res.into_body(), usize::MAX).await.unwrap();
    (status, serde_json::from_slice(&bytes).unwrap_or(Value::Null))
}

async fn einsatz_anlegen(app: &axum::Router, cookie: &str) -> i64 {
    let (_, json) = anfrage(app, "POST", "/api/einsaetze", cookie, Some(r#"{"bezeichnung":"Lage"}"#)).await;
    json["id"].as_i64().unwrap()
}

async fn benutzer_anlegen(app: &axum::Router, admin: &str, name: &str) -> i64 {
    let body = format!(r#"{{"anzeigename":"{name}","benutzername":"{name}","passwort":"{name}pw1","org_rolle":"keine"}}"#);
    let (status, json) = anfrage(app, "POST", "/api/benutzer", admin, Some(&body)).await;
    assert_eq!(status, StatusCode::CREATED, "{json:?}");
    json["id"].as_i64().unwrap()
}

async fn rolle_setzen(app: &axum::Router, leit: &str, einsatz: i64, benutzer_id: i64, rolle: &str) {
    let (status, _) = anfrage(app, "PUT", &format!("/api/einsaetze/{einsatz}/mitglieder/{benutzer_id}"),
        leit, Some(&format!(r#"{{"einsatz_rolle":"{rolle}"}}"#))).await;
    assert_eq!(status, StatusCode::OK);
}

fn body() -> String {
    serde_json::json!({
        "art": "RTW", "bezeichnung": "2 RTW zur Verstärkung", "anzahl": 2,
        "adressat_kategorie": "leitstelle", "adressat_bezeichnung": "Leitstelle Nord",
        "prioritaet": "dringend"
    }).to_string()
}

#[tokio::test]
async fn anlegen_erzeugt_nachforderung_und_etb() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let (status, n) = anfrage(&app, "POST", &format!("/api/einsaetze/{e}/nachforderungen"), &admin, Some(&body())).await;
    assert_eq!(status, StatusCode::CREATED, "{n:?}");
    assert_eq!(n["status"], "angefordert");
    assert_eq!(n["anzahl"], 2);
    assert_eq!(n["adressat_kategorie"], "leitstelle");
    assert_eq!(n["ist_offen"], true);
    assert!(n["etb_nachforderung_id"].is_i64());
    // ETB enthält die Anforderung als Meldung.
    let (_, etb) = anfrage(&app, "GET", &format!("/api/einsaetze/{e}/etb"), &admin, None).await;
    assert!(etb.as_array().unwrap().iter().any(|x| x["typ"] == "meldung"));
}

#[tokio::test]
async fn anlegen_ohne_bezeichnung_ist_400() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let b = serde_json::json!({ "art": "RTW", "bezeichnung": "  ", "adressat_kategorie": "leitstelle" }).to_string();
    let (status, _) = anfrage(&app, "POST", &format!("/api/einsaetze/{e}/nachforderungen"), &admin, Some(&b)).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn anlegen_ungueltige_adressat_kategorie_ist_400() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let b = serde_json::json!({ "art": "RTW", "bezeichnung": "x", "adressat_kategorie": "irgendwer" }).to_string();
    let (status, _) = anfrage(&app, "POST", &format!("/api/einsaetze/{e}/nachforderungen"), &admin, Some(&b)).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn status_workflow_und_ungueltiger_uebergang_ist_422() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let (_, n) = anfrage(&app, "POST", &format!("/api/einsaetze/{e}/nachforderungen"), &admin, Some(&body())).await;
    let nid = n["id"].as_i64().unwrap();

    // angefordert → unterwegs ist KEIN erlaubter (Sprung) → 422.
    let (status, _) = anfrage(&app, "POST", &format!("/api/einsaetze/{e}/nachforderungen/{nid}/status"), &admin, Some(r#"{"status":"unterwegs"}"#)).await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);

    // angefordert → zugesagt → unterwegs → eingetroffen (linear).
    for ziel in ["zugesagt", "unterwegs", "eingetroffen"] {
        let (status, j) = anfrage(&app, "POST", &format!("/api/einsaetze/{e}/nachforderungen/{nid}/status"), &admin, Some(&format!(r#"{{"status":"{ziel}"}}"#))).await;
        assert_eq!(status, StatusCode::OK, "{j:?}");
        assert_eq!(j["status"], ziel);
    }
    // eingetroffen ist terminal → weiterer Übergang 422.
    let (status, j) = anfrage(&app, "GET", &format!("/api/einsaetze/{e}/nachforderungen"), &admin, None).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(j.as_array().unwrap()[0]["ist_offen"], false);
}

#[tokio::test]
async fn status_abgelehnt_ueber_status_endpoint_ist_422() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let (_, n) = anfrage(&app, "POST", &format!("/api/einsaetze/{e}/nachforderungen"), &admin, Some(&body())).await;
    let nid = n["id"].as_i64().unwrap();
    // 'abgelehnt' gehört auf den /ablehnen-Pfad → /status weist sauber mit 422 ab (kein 400).
    let (status, _) = anfrage(&app, "POST", &format!("/api/einsaetze/{e}/nachforderungen/{nid}/status"), &admin, Some(r#"{"status":"abgelehnt"}"#)).await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
}

#[tokio::test]
async fn ablehnen_setzt_grund() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let (_, n) = anfrage(&app, "POST", &format!("/api/einsaetze/{e}/nachforderungen"), &admin, Some(&body())).await;
    let nid = n["id"].as_i64().unwrap();
    let (status, j) = anfrage(&app, "POST", &format!("/api/einsaetze/{e}/nachforderungen/{nid}/ablehnen"), &admin, Some(r#"{"grund":"keine Reserven"}"#)).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(j["status"], "abgelehnt");
    assert_eq!(j["abgelehnt_grund"], "keine Reserven");
}

#[tokio::test]
async fn beobachter_liest_aber_schreibt_nicht() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let erika = benutzer_anlegen(&app, &admin, "erika").await;
    rolle_setzen(&app, &admin, e, erika, "beobachter").await;
    let erika_c = login_cookie(&app, "erika", "erikapw1").await;
    let (status, _) = anfrage(&app, "GET", &format!("/api/einsaetze/{e}/nachforderungen"), &erika_c, None).await;
    assert_eq!(status, StatusCode::OK);
    let (status, _) = anfrage(&app, "POST", &format!("/api/einsaetze/{e}/nachforderungen"), &erika_c, Some(&body())).await;
    assert_eq!(status, StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn cross_einsatz_status_ist_404() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let a = einsatz_anlegen(&app, &admin).await;
    let b = einsatz_anlegen(&app, &admin).await;
    let (_, n) = anfrage(&app, "POST", &format!("/api/einsaetze/{a}/nachforderungen"), &admin, Some(&body())).await;
    let nid = n["id"].as_i64().unwrap();
    let (status, _) = anfrage(&app, "POST", &format!("/api/einsaetze/{b}/nachforderungen/{nid}/status"), &admin, Some(r#"{"status":"zugesagt"}"#)).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
}
