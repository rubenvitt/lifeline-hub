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
    build_router(AppState { pool, live: LiveHub::new(), karten_dir: std::env::temp_dir(), fachebenen: lifeline_hub::karte::FachebenenState::neu(), download_client: lifeline_hub::karte::download::download_client(), download_fortschritt: lifeline_hub::karte::download::neue_fortschritt_map(), karten_service_url: None, karten_service_token: None })
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

/// Legt eine Stamm-Person an (Admin) und liefert deren id.
async fn person_anlegen(app: &axum::Router, admin: &str, name: &str) -> i64 {
    let (status, json) = anfrage(
        app, "POST", "/api/personal", admin,
        Some(&format!(r#"{{"name":"{name}"}}"#)),
    ).await;
    assert_eq!(status, StatusCode::CREATED);
    json["id"].as_i64().unwrap()
}

/// Zählt ETB-Einträge mit typ='system'.
async fn system_etb_anzahl(app: &axum::Router, cookie: &str, einsatz: i64) -> usize {
    let (_, json) = anfrage(app, "GET", &format!("/api/einsaetze/{einsatz}/etb"), cookie, None).await;
    json.as_array().unwrap().iter().filter(|e| e["typ"] == "system").count()
}

// ---------- Tests ----------

#[tokio::test]
async fn disponieren_stamm_setzt_status_und_schreibt_etb() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let person = person_anlegen(&app, &admin, "Thomas Müller").await;

    let (status, json) = anfrage(
        &app, "POST", &format!("/api/einsaetze/{einsatz}/personal"), &admin,
        Some(&format!(r#"{{"personal_id":{person},"staerke_position":"fuehrer"}}"#)),
    ).await;
    assert_eq!(status, StatusCode::CREATED);
    assert_eq!(json["name"], "Thomas Müller");
    assert_eq!(json["status_kategorie"], "gebunden");
    assert_eq!(json["staerke_position"], "fuehrer");
    assert_eq!(json["ist_adhoc"], false);
    assert_eq!(system_etb_anzahl(&app, &admin, einsatz).await, 1);
}

#[tokio::test]
async fn doppelte_stamm_disposition_ist_409() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let person = person_anlegen(&app, &admin, "Thomas").await;
    let body = format!(r#"{{"personal_id":{person}}}"#);
    assert_eq!(anfrage(&app, "POST", &format!("/api/einsaetze/{einsatz}/personal"), &admin, Some(&body)).await.0, StatusCode::CREATED);
    assert_eq!(anfrage(&app, "POST", &format!("/api/einsaetze/{einsatz}/personal"), &admin, Some(&body)).await.0, StatusCode::CONFLICT);
}

#[tokio::test]
async fn adhoc_ohne_stamm() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let (status, json) = anfrage(
        &app, "POST", &format!("/api/einsaetze/{einsatz}/personal"), &admin,
        Some(r#"{"adhoc":{"name":"Notarzt Extern","funktion":"Notarzt","staerke_position":"fuehrer"}}"#),
    ).await;
    assert_eq!(status, StatusCode::CREATED);
    assert_eq!(json["ist_adhoc"], true);
    assert!(json["personal_id"].is_null());
    assert_eq!(json["funktion"], "Notarzt");
}

#[tokio::test]
async fn beobachter_liest_disponiert_nicht() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let erika_id = benutzer_anlegen(&app, &admin, "erika", "keine").await;
    rolle_setzen(&app, &admin, einsatz, erika_id, "beobachter").await;
    let erika = login_cookie(&app, "erika", "erikapw1").await;
    assert_eq!(anfrage(&app, "GET", &format!("/api/einsaetze/{einsatz}/personal"), &erika, None).await.0, StatusCode::OK);
    let person = person_anlegen(&app, &admin, "Thomas").await;
    let (status, _) = anfrage(&app, "POST", &format!("/api/einsaetze/{einsatz}/personal"), &erika, Some(&format!(r#"{{"personal_id":{person}}}"#))).await;
    assert_eq!(status, StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn disponieren_auf_abgeschlossenem_einsatz_ist_409() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let person = person_anlegen(&app, &admin, "Thomas").await;
    assert_eq!(anfrage(&app, "POST", &format!("/api/einsaetze/{einsatz}/abschliessen"), &admin, None).await.0, StatusCode::OK);
    let (status, _) = anfrage(&app, "POST", &format!("/api/einsaetze/{einsatz}/personal"), &admin, Some(&format!(r#"{{"personal_id":{person}}}"#))).await;
    assert_eq!(status, StatusCode::CONFLICT);
}

#[tokio::test]
async fn status_wechsel_und_entfernen_schreiben_etb() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let person = person_anlegen(&app, &admin, "Thomas").await;
    let (_, json) = anfrage(&app, "POST", &format!("/api/einsaetze/{einsatz}/personal"), &admin, Some(&format!(r#"{{"personal_id":{person}}}"#))).await;
    let ep = json["id"].as_i64().unwrap();

    // Anderen 'gebunden'-Status aus dem Seed holen ('im Einsatz').
    let (_, stati) = anfrage(&app, "GET", "/api/personal-status", &admin, None).await;
    let im_einsatz = stati.as_array().unwrap().iter().find(|s| s["label"] == "im Einsatz").unwrap()["id"].as_i64().unwrap();

    assert_eq!(anfrage(&app, "PATCH", &format!("/api/einsaetze/{einsatz}/personal/{ep}"), &admin, Some(&format!(r#"{{"status_id":{im_einsatz}}}"#))).await.0, StatusCode::OK);
    assert_eq!(anfrage(&app, "DELETE", &format!("/api/einsaetze/{einsatz}/personal/{ep}"), &admin, None).await.0, StatusCode::NO_CONTENT);
    // Disponieren + Status-Wechsel + Entfernen = 3 System-Einträge.
    assert_eq!(system_etb_anzahl(&app, &admin, einsatz).await, 3);
}

#[tokio::test]
async fn snapshot_bleibt_nach_stamm_aenderung_bei_abgeschlossenem_einsatz() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let person = person_anlegen(&app, &admin, "Thomas Müller").await;
    anfrage(&app, "POST", &format!("/api/einsaetze/{einsatz}/personal"), &admin, Some(&format!(r#"{{"personal_id":{person}}}"#))).await;
    // Stamm umbenennen.
    anfrage(&app, "PATCH", &format!("/api/personal/{person}"), &admin, Some(r#"{"name":"Thomas NEU"}"#)).await;
    // Aktiver Einsatz → Live.
    let (_, live) = anfrage(&app, "GET", &format!("/api/einsaetze/{einsatz}/personal"), &admin, None).await;
    assert_eq!(live[0]["name"], "Thomas NEU");
    // Abschließen → Snapshot.
    anfrage(&app, "POST", &format!("/api/einsaetze/{einsatz}/abschliessen"), &admin, None).await;
    let (_, snap) = anfrage(&app, "GET", &format!("/api/einsaetze/{einsatz}/personal"), &admin, None).await;
    assert_eq!(snap[0]["name"], "Thomas Müller", "Snapshot bei abgeschlossenem Einsatz");
}

// LFH-4 P2: XOR-Fehlermeldung differenziert both-None vs both-Some.
#[tokio::test]
async fn disponieren_leerer_body_meldet_entweder_oder() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    // Weder personal_id noch adhoc → "angeben", NICHT "nicht beides".
    let (status, json) = anfrage(&app, "POST", &format!("/api/einsaetze/{einsatz}/personal"), &admin, Some("{}")).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(json["error"], "Entweder personal_id (Stamm) oder adhoc angeben");
}

#[tokio::test]
async fn disponieren_beides_meldet_nicht_beides() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let person = person_anlegen(&app, &admin, "Thomas").await;
    // personal_id UND adhoc → "nicht beides".
    let body = format!(r#"{{"personal_id":{person},"adhoc":{{"name":"Extern"}}}}"#);
    let (status, json) = anfrage(&app, "POST", &format!("/api/einsaetze/{einsatz}/personal"), &admin, Some(&body)).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(json["error"], "Entweder personal_id (Stamm) oder adhoc angeben, nicht beides");
}

// LFH-4 P1: staerke_position im Dispo-PATCH ist Tri-State — explizit null entfernt den
// Override, fehlendes Feld lässt ihn unverändert.
#[tokio::test]
async fn dispo_position_explizit_null_entfernt_absent_behaelt() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let person = person_anlegen(&app, &admin, "Thomas").await; // Stamm ohne Position
    let (_, json) = anfrage(
        &app, "POST", &format!("/api/einsaetze/{einsatz}/personal"), &admin,
        Some(&format!(r#"{{"personal_id":{person},"staerke_position":"fuehrer"}}"#)),
    ).await;
    let ep = json["id"].as_i64().unwrap();
    assert_eq!(json["staerke_position"], "fuehrer");

    // Feld absent (nur Bemerkung) → Position unverändert.
    let (_, a) = anfrage(
        &app, "PATCH", &format!("/api/einsaetze/{einsatz}/personal/{ep}"), &admin,
        Some(r#"{"bemerkung":"vor Ort"}"#),
    ).await;
    assert_eq!(a["staerke_position"], "fuehrer", "absentes Feld lässt die Position unverändert");

    // Explizit null → Override entfernt (Stamm hat keine Position → null).
    let (_, b) = anfrage(
        &app, "PATCH", &format!("/api/einsaetze/{einsatz}/personal/{ep}"), &admin,
        Some(r#"{"staerke_position":null}"#),
    ).await;
    assert!(b["staerke_position"].is_null(), "explizit null entfernt den Positions-Override");
}

#[tokio::test]
async fn dispo_position_ungueltiger_wert_ist_400() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let person = person_anlegen(&app, &admin, "Thomas").await;
    let (_, json) = anfrage(
        &app, "POST", &format!("/api/einsaetze/{einsatz}/personal"), &admin,
        Some(&format!(r#"{{"personal_id":{person}}}"#)),
    ).await;
    let ep = json["id"].as_i64().unwrap();
    // Tri-State Some(Some("quatsch")) → die Inline-Validierung lehnt den Wert ab.
    let (status, body) = anfrage(
        &app, "PATCH", &format!("/api/einsaetze/{einsatz}/personal/{ep}"), &admin,
        Some(r#"{"staerke_position":"quatsch"}"#),
    ).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(body["error"], "Ungültige Stärke-Position");
}
