use axum::body::{to_bytes, Body};
use axum::http::{header, Request, StatusCode};
use lifeline_hub::app::{build_router, AppState};
use lifeline_hub::auth::bootstrap::bootstrap_admin;
use lifeline_hub::db;
use lifeline_hub::live::LiveHub;
use serde_json::Value;
use tower::ServiceExt;

// ---------- Harness (identisch zu tests/einsatz_fahrzeug.rs) ----------

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

/// Zählt ETB-Einträge mit typ='system'.
async fn system_etb_anzahl(app: &axum::Router, cookie: &str, einsatz: i64) -> usize {
    let (_, json) = anfrage(app, "GET", &format!("/api/einsaetze/{einsatz}/etb"), cookie, None).await;
    json.as_array().unwrap().iter().filter(|e| e["typ"] == "system").count()
}

/// Legt Stamm-Material an (Admin) und liefert dessen id.
async fn material_anlegen(app: &axum::Router, admin: &str, bezeichnung: &str) -> i64 {
    let (status, json) = anfrage(
        app, "POST", "/api/material", admin,
        Some(&format!(r#"{{"bezeichnung":"{bezeichnung}","kategorie":"Betreuung"}}"#)),
    ).await;
    assert_eq!(status, StatusCode::CREATED);
    json["id"].as_i64().unwrap()
}

// ---------- Tests ----------

#[tokio::test]
async fn disponieren_stamm_mit_menge_schreibt_etb() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let mat = material_anlegen(&app, &admin, "Wolldecke").await;

    let (status, json) = anfrage(
        &app, "POST", &format!("/api/einsaetze/{einsatz}/material"), &admin,
        Some(&format!(r#"{{"material_id":{mat},"menge":50}}"#)),
    ).await;
    assert_eq!(status, StatusCode::CREATED);
    assert_eq!(json["bezeichnung"], "Wolldecke");
    assert_eq!(json["menge"], 50);
    assert_eq!(json["status"], "einsatzbereit");
    assert_eq!(json["ist_adhoc"], false);

    assert_eq!(system_etb_anzahl(&app, &admin, einsatz).await, 1, "Disponieren schreibt 1 System-ETB");
}

#[tokio::test]
async fn dasselbe_material_mehrfach_disponierbar() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let mat = material_anlegen(&app, &admin, "Wolldecke").await;
    let body = format!(r#"{{"material_id":{mat},"menge":30}}"#);
    assert_eq!(anfrage(&app, "POST", &format!("/api/einsaetze/{einsatz}/material"), &admin, Some(&body)).await.0, StatusCode::CREATED);
    assert_eq!(anfrage(&app, "POST", &format!("/api/einsaetze/{einsatz}/material"), &admin, Some(&body)).await.0, StatusCode::CREATED, "kein Conflict");
    let (_, liste) = anfrage(&app, "GET", &format!("/api/einsaetze/{einsatz}/material"), &admin, None).await;
    assert_eq!(liste.as_array().unwrap().len(), 2);
}

#[tokio::test]
async fn adhoc_ohne_stamm_mit_pflicht_bezeichnung() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;

    let (status, json) = anfrage(
        &app, "POST", &format!("/api/einsaetze/{einsatz}/material"), &admin,
        Some(r#"{"adhoc":{"bezeichnung":"Spende-Decken","traegerorganisation":"THW"},"menge":100}"#),
    ).await;
    assert_eq!(status, StatusCode::CREATED);
    assert_eq!(json["ist_adhoc"], true);
    assert!(json["material_id"].is_null());
    assert_eq!(json["menge"], 100);
}

#[tokio::test]
async fn menge_unter_eins_ist_400() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let mat = material_anlegen(&app, &admin, "Wolldecke").await;
    let (status, _) = anfrage(
        &app, "POST", &format!("/api/einsaetze/{einsatz}/material"), &admin,
        Some(&format!(r#"{{"material_id":{mat},"menge":0}}"#)),
    ).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn beobachter_liest_nicht_disponiert_nicht() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let erika_id = benutzer_anlegen(&app, &admin, "erika", "keine").await;
    rolle_setzen(&app, &admin, einsatz, erika_id, "beobachter").await;
    let erika = login_cookie(&app, "erika", "erikapw1").await;

    assert_eq!(anfrage(&app, "GET", &format!("/api/einsaetze/{einsatz}/material"), &erika, None).await.0, StatusCode::OK);
    let mat = material_anlegen(&app, &admin, "Wolldecke").await;
    let (status, _) = anfrage(&app, "POST", &format!("/api/einsaetze/{einsatz}/material"), &erika, Some(&format!(r#"{{"material_id":{mat}}}"#))).await;
    assert_eq!(status, StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn disponieren_auf_abgeschlossenem_einsatz_ist_409() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let mat = material_anlegen(&app, &admin, "Wolldecke").await;
    assert_eq!(anfrage(&app, "POST", &format!("/api/einsaetze/{einsatz}/abschliessen"), &admin, None).await.0, StatusCode::OK);
    let (status, _) = anfrage(&app, "POST", &format!("/api/einsaetze/{einsatz}/material"), &admin, Some(&format!(r#"{{"material_id":{mat}}}"#))).await;
    assert_eq!(status, StatusCode::CONFLICT);
}

#[tokio::test]
async fn menge_und_status_aenderung_schreiben_je_einen_etb() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let mat = material_anlegen(&app, &admin, "Wolldecke").await;
    let (_, json) = anfrage(&app, "POST", &format!("/api/einsaetze/{einsatz}/material"), &admin, Some(&format!(r#"{{"material_id":{mat},"menge":50}}"#))).await;
    let em = json["id"].as_i64().unwrap();

    // Menge UND Status in einem PATCH → +2 System-ETB.
    let (status, json) = anfrage(&app, "PATCH", &format!("/api/einsaetze/{einsatz}/material/{em}"), &admin, Some(r#"{"menge":30,"status":"defekt"}"#)).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(json["menge"], 30);
    assert_eq!(json["status"], "defekt");

    // Disponieren (1) + Menge (1) + Status (1) = 3.
    assert_eq!(system_etb_anzahl(&app, &admin, einsatz).await, 3);
}

#[tokio::test]
async fn ungueltiger_status_ist_400() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let mat = material_anlegen(&app, &admin, "Wolldecke").await;
    let (_, json) = anfrage(&app, "POST", &format!("/api/einsaetze/{einsatz}/material"), &admin, Some(&format!(r#"{{"material_id":{mat}}}"#))).await;
    let em = json["id"].as_i64().unwrap();
    let (status, _) = anfrage(&app, "PATCH", &format!("/api/einsaetze/{einsatz}/material/{em}"), &admin, Some(r#"{"status":"kaputtnochmal"}"#)).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn reine_bemerkung_schreibt_keinen_etb() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let mat = material_anlegen(&app, &admin, "Wolldecke").await;
    let (_, json) = anfrage(&app, "POST", &format!("/api/einsaetze/{einsatz}/material"), &admin, Some(&format!(r#"{{"material_id":{mat}}}"#))).await;
    let em = json["id"].as_i64().unwrap();

    let (_, gesetzt) = anfrage(&app, "PATCH", &format!("/api/einsaetze/{einsatz}/material/{em}"), &admin, Some(r#"{"bemerkung":"Lagerhalle 2"}"#)).await;
    assert_eq!(gesetzt["bemerkung"], "Lagerhalle 2");
    assert_eq!(system_etb_anzahl(&app, &admin, einsatz).await, 1, "nur die Disposition selbst");
}

#[tokio::test]
async fn entfernen_schreibt_etb() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let mat = material_anlegen(&app, &admin, "Wolldecke").await;
    let (_, json) = anfrage(&app, "POST", &format!("/api/einsaetze/{einsatz}/material"), &admin, Some(&format!(r#"{{"material_id":{mat}}}"#))).await;
    let em = json["id"].as_i64().unwrap();
    let (status, _) = anfrage(&app, "DELETE", &format!("/api/einsaetze/{einsatz}/material/{em}"), &admin, None).await;
    assert_eq!(status, StatusCode::NO_CONTENT);
    assert_eq!(system_etb_anzahl(&app, &admin, einsatz).await, 2, "Disponieren + Entfernen");
}

#[tokio::test]
async fn org_isolation_fremdes_material_nicht_disponierbar() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let (status, _) = anfrage(&app, "POST", &format!("/api/einsaetze/{einsatz}/material"), &admin, Some(r#"{"material_id":999999}"#)).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn patch_und_delete_unbekannte_em_id_sind_404() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let (status, _) = anfrage(&app, "PATCH", &format!("/api/einsaetze/{einsatz}/material/999999"), &admin, Some(r#"{"menge":5}"#)).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    let (status, _) = anfrage(&app, "DELETE", &format!("/api/einsaetze/{einsatz}/material/999999"), &admin, None).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn patch_menge_unter_eins_ist_400() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let mat = material_anlegen(&app, &admin, "Wolldecke").await;
    let (_, json) = anfrage(&app, "POST", &format!("/api/einsaetze/{einsatz}/material"), &admin, Some(&format!(r#"{{"material_id":{mat}}}"#))).await;
    let em = json["id"].as_i64().unwrap();
    let (status, _) = anfrage(&app, "PATCH", &format!("/api/einsaetze/{einsatz}/material/{em}"), &admin, Some(r#"{"menge":0}"#)).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
}
