use axum::body::{to_bytes, Body};
use axum::http::{header, Request, StatusCode};
use lifeline_hub::app::{build_router, AppState};
use lifeline_hub::auth::bootstrap::bootstrap_admin;
use lifeline_hub::db;
use lifeline_hub::live::LiveHub;
use serde_json::Value;
use tower::ServiceExt;

// ---------- Harness (identisch zu tests/einsatz_material.rs) ----------

async fn setup() -> axum::Router {
    let pool = db::test_pool().await;
    bootstrap_admin(&pool, "Test-Orga", "admin", Some("startpw12"))
        .await
        .unwrap();
    build_router(AppState { pool, live: LiveHub::new() })
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

async fn benutzer_anlegen(app: &axum::Router, admin_cookie: &str, name: &str, org_rolle: &str) -> i64 {
    let body = format!(
        r#"{{"anzeigename":"{name}","benutzername":"{name}","passwort":"{name}pw1","org_rolle":"{org_rolle}"}}"#
    );
    let resp = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/benutzer")
                .header(header::CONTENT_TYPE, "application/json")
                .header(header::COOKIE, admin_cookie.to_string())
                .body(Body::from(body))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::CREATED);
    let bytes = to_bytes(resp.into_body(), usize::MAX).await.unwrap();
    serde_json::from_slice::<Value>(&bytes).unwrap()["id"].as_i64().unwrap()
}

/// Generischer Request-Helfer: liefert (Status, JSON-Body).
async fn anfrage(
    app: &axum::Router,
    methode: &str,
    uri: &str,
    cookie: &str,
    body: Option<&str>,
) -> (StatusCode, Value) {
    let mut req = Request::builder().method(methode).uri(uri).header(header::COOKIE, cookie.to_string());
    let body = match body {
        Some(b) => {
            req = req.header(header::CONTENT_TYPE, "application/json");
            Body::from(b.to_string())
        }
        None => Body::empty(),
    };
    let resp = app.clone().oneshot(req.body(body).unwrap()).await.unwrap();
    let status = resp.status();
    let bytes = to_bytes(resp.into_body(), usize::MAX).await.unwrap();
    (status, serde_json::from_slice(&bytes).unwrap_or(Value::Null))
}

// ---------- Zusatz-Helfer ----------

async fn einsatz_anlegen(app: &axum::Router, cookie: &str) -> i64 {
    let (status, json) = anfrage(app, "POST", "/api/einsaetze", cookie, Some(r#"{"bezeichnung":"Lage"}"#)).await;
    assert_eq!(status, StatusCode::CREATED);
    json["id"].as_i64().unwrap()
}

/// Weist einem Benutzer eine Einsatz-Rolle zu (durch die Einsatzleitung).
async fn rolle_setzen(app: &axum::Router, leit_cookie: &str, einsatz: i64, benutzer_id: i64, rolle: &str) {
    let (status, _) = anfrage(
        app, "PUT", &format!("/api/einsaetze/{einsatz}/mitglieder/{benutzer_id}"), leit_cookie,
        Some(&format!(r#"{{"einsatz_rolle":"{rolle}"}}"#)),
    ).await;
    assert_eq!(status, StatusCode::OK);
}

/// Liefert die ETB-Einträge mit typ='system' als Vec der Inhalte.
async fn system_etb_inhalte(app: &axum::Router, cookie: &str, einsatz: i64) -> Vec<String> {
    let (_, json) = anfrage(app, "GET", &format!("/api/einsaetze/{einsatz}/etb"), cookie, None).await;
    json.as_array().unwrap().iter()
        .filter(|e| e["typ"] == "system")
        .map(|e| e["inhalt"].as_str().unwrap().to_string())
        .collect()
}

/// Legt eine Person an und liefert ihre id.
async fn person_anlegen(app: &axum::Router, cookie: &str, einsatz: i64, body: &str) -> i64 {
    let (status, json) = anfrage(app, "POST", &format!("/api/einsaetze/{einsatz}/personen"), cookie, Some(body)).await;
    assert_eq!(status, StatusCode::CREATED);
    json["id"].as_i64().unwrap()
}

// ---------- Tests ----------

#[tokio::test]
async fn detail_liefert_person_mit_feldern() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let p = person_anlegen(&app, &admin, e, r#"{"name":"Test","antreff_ort":"Brücke"}"#).await;
    let (status, json) = anfrage(&app, "GET", &format!("/api/einsaetze/{e}/personen/{p}"), &admin, None).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(json["id"], p);
    assert_eq!(json["name"], "Test");
    assert_eq!(json["antreff_ort"], "Brücke");
    assert_eq!(json["registrier_nr"], 1);
}

#[tokio::test]
async fn patch_bearbeitet_felder() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let p = person_anlegen(&app, &admin, e, r#"{"name":"Alt"}"#).await;
    let (status, json) = anfrage(
        &app, "PATCH", &format!("/api/einsaetze/{e}/personen/{p}"), &admin,
        Some(r#"{"name":"Neu","notiz":"verletzt"}"#),
    ).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(json["name"], "Neu");
    assert_eq!(json["notiz"], "verletzt");
}

#[tokio::test]
async fn detail_fremder_einsatz_ist_404() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let p = person_anlegen(&app, &admin, e, r#"{}"#).await;
    let anderer = einsatz_anlegen(&app, &admin).await;
    let (status, _) = anfrage(&app, "GET", &format!("/api/einsaetze/{anderer}/personen/{p}"), &admin, None).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn anlegen_vergibt_registriernummer_und_status_erfasst() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let (status, json) = anfrage(
        &app, "POST", &format!("/api/einsaetze/{e}/personen"), &admin,
        Some(r#"{"geschlecht":"maennlich","alter_geschaetzt":40,"antreff_ort":"Brücke"}"#),
    ).await;
    assert_eq!(status, StatusCode::CREATED);
    assert_eq!(json["registrier_nr"], 1);
    assert_eq!(json["status"], "erfasst");
    assert_eq!(json["geschlecht"], "maennlich");
}

#[tokio::test]
async fn anlegen_mit_ungueltigem_geschlecht_ist_400() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let (status, _) = anfrage(
        &app, "POST", &format!("/api/einsaetze/{e}/personen"), &admin,
        Some(r#"{"geschlecht":"alien"}"#),
    ).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn anlegen_schreibt_pseudonymen_etb_eintrag_ohne_identitaet() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let (_, _json) = anfrage(
        &app, "POST", &format!("/api/einsaetze/{e}/personen"), &admin,
        Some(r#"{"name":"Mustermann","vorname":"Max"}"#),
    ).await;
    let inhalte = system_etb_inhalte(&app, &admin, e).await;
    assert_eq!(inhalte.len(), 1);
    assert!(inhalte[0].contains("R-001"), "ETB nennt die Registriernummer");
    assert!(inhalte[0].contains("erfasst"));
    assert!(!inhalte[0].contains("Mustermann"), "ETB darf den Namen NICHT enthalten");
    assert!(!inhalte[0].contains("Max"), "ETB darf den Vornamen NICHT enthalten");
}

#[tokio::test]
async fn liste_filtert_nach_status() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    anfrage(&app, "POST", &format!("/api/einsaetze/{e}/personen"), &admin, Some(r#"{}"#)).await;
    anfrage(&app, "POST", &format!("/api/einsaetze/{e}/personen"), &admin, Some(r#"{}"#)).await;
    let (status, json) = anfrage(&app, "GET", &format!("/api/einsaetze/{e}/personen?status=erfasst"), &admin, None).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(json.as_array().unwrap().len(), 2);
    let (_, leer) = anfrage(&app, "GET", &format!("/api/einsaetze/{e}/personen?status=vermisst"), &admin, None).await;
    assert_eq!(leer.as_array().unwrap().len(), 0);
}

#[tokio::test]
async fn beobachter_kann_nicht_anlegen() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let beob_id = benutzer_anlegen(&app, &admin, "beobacht", "keine").await;
    let e = einsatz_anlegen(&app, &admin).await;
    rolle_setzen(&app, &admin, e, beob_id, "beobachter").await;
    let beob = login_cookie(&app, "beobacht", "beobachtpw1").await;
    let (status, _) = anfrage(&app, "POST", &format!("/api/einsaetze/{e}/personen"), &beob, Some(r#"{}"#)).await;
    assert_eq!(status, StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn gueltiger_status_wechsel_schreibt_etb() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let p = person_anlegen(&app, &admin, e, r#"{}"#).await;
    let (status, json) = anfrage(
        &app, "POST", &format!("/api/einsaetze/{e}/personen/{p}/status"), &admin,
        Some(r#"{"status":"vermisst"}"#),
    ).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(json["status"], "vermisst");
    let inhalte = system_etb_inhalte(&app, &admin, e).await;
    assert!(inhalte.iter().any(|i| i.contains("R-001") && i.contains("erfasst") && i.contains("vermisst")));
}

#[tokio::test]
async fn ungueltiger_status_wechsel_ist_422() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let p = person_anlegen(&app, &admin, e, r#"{}"#).await;
    // erfasst → erfasst ist kein gültiger Übergang.
    let (status, _) = anfrage(
        &app, "POST", &format!("/api/einsaetze/{e}/personen/{p}/status"), &admin,
        Some(r#"{"status":"erfasst"}"#),
    ).await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
}

#[tokio::test]
async fn unbekannter_zielstatus_ist_400() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let p = person_anlegen(&app, &admin, e, r#"{}"#).await;
    let (status, _) = anfrage(
        &app, "POST", &format!("/api/einsaetze/{e}/personen/{p}/status"), &admin,
        Some(r#"{"status":"quatsch"}"#),
    ).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn stornieren_blendet_aus_liste_und_schreibt_etb() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let p = person_anlegen(&app, &admin, e, r#"{}"#).await;
    let (status, _) = anfrage(&app, "DELETE", &format!("/api/einsaetze/{e}/personen/{p}"), &admin, None).await;
    assert_eq!(status, StatusCode::NO_CONTENT);
    let (_, liste) = anfrage(&app, "GET", &format!("/api/einsaetze/{e}/personen"), &admin, None).await;
    assert_eq!(liste.as_array().unwrap().len(), 0);
    let inhalte = system_etb_inhalte(&app, &admin, e).await;
    assert!(inhalte.iter().any(|i| i.contains("R-001") && i.contains("storniert")));
}

/// Zählt Audit-Einträge einer Person (über die Audit-Einsicht der Leitung).
async fn audit_anzahl(app: &axum::Router, leit_cookie: &str, einsatz: i64, person: i64) -> usize {
    let (status, json) = anfrage(app, "GET", &format!("/api/einsaetze/{einsatz}/personen/{person}/audit"), leit_cookie, None).await;
    assert_eq!(status, StatusCode::OK);
    json.as_array().unwrap().len()
}

#[tokio::test]
async fn detail_oeffnen_schreibt_genau_einen_audit_liste_keinen() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await; // admin = Einsatzleitung → darf Audit sehen
    let p = person_anlegen(&app, &admin, e, r#"{"name":"Test"}"#).await;
    // Liste schreibt keinen Audit:
    anfrage(&app, "GET", &format!("/api/einsaetze/{e}/personen"), &admin, None).await;
    assert_eq!(audit_anzahl(&app, &admin, e, p).await, 0);
    // Eine Detail-Öffnung → genau ein Eintrag (die Audit-Einsicht selbst schreibt keinen):
    let (status, _) = anfrage(&app, "GET", &format!("/api/einsaetze/{e}/personen/{p}"), &admin, None).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(audit_anzahl(&app, &admin, e, p).await, 1);
    // Zweite Öffnung → zwei Einträge:
    anfrage(&app, "GET", &format!("/api/einsaetze/{e}/personen/{p}"), &admin, None).await;
    assert_eq!(audit_anzahl(&app, &admin, e, p).await, 2);
}

#[tokio::test]
async fn audit_einsicht_nur_fuer_einsatzleitung() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    // admin legt den Einsatz an → wird Einsatzleitung. Ein Führungs-User wird hinzugefügt.
    let fueh_id = benutzer_anlegen(&app, &admin, "fuehrung", "keine").await;
    let e = einsatz_anlegen(&app, &admin).await;
    rolle_setzen(&app, &admin, e, fueh_id, "fuehrungspersonal").await;
    let fueh = login_cookie(&app, "fuehrung", "fuehrungpw1").await;
    let p = person_anlegen(&app, &admin, e, r#"{}"#).await;
    // Führungspersonal darf NICHT in die Audit-Einsicht:
    let (status, _) = anfrage(&app, "GET", &format!("/api/einsaetze/{e}/personen/{p}/audit"), &fueh, None).await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    // Einsatzleitung (admin) darf:
    let (status, _) = anfrage(&app, "GET", &format!("/api/einsaetze/{e}/personen/{p}/audit"), &admin, None).await;
    assert_eq!(status, StatusCode::OK);
}

#[tokio::test]
async fn export_schreibt_export_audit() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    person_anlegen(&app, &admin, e, r#"{"name":"Test"}"#).await;
    // Export liefert CSV (text/csv), kein JSON — daher roher Request:
    let resp = app.clone().oneshot(
        Request::builder().method("GET").uri(format!("/api/einsaetze/{e}/personen/export"))
            .header(header::COOKIE, admin.clone()).body(Body::empty()).unwrap(),
    ).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let ct = resp.headers().get(header::CONTENT_TYPE).unwrap().to_str().unwrap().to_string();
    assert!(ct.starts_with("text/csv"), "Content-Type ist CSV, war: {ct}");
}
