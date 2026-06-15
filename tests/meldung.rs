use axum::http::StatusCode;
use chrono::{Duration, NaiveDateTime};
use lifeline_hub::app::{build_router, AppState};
use lifeline_hub::live::LiveHub;
use serde_json::Value;
use tower::ServiceExt;

/// Parst einen DB-Zeitstempel aus einer JSON-Antwort.
fn zeit(v: &Value) -> NaiveDateTime {
    NaiveDateTime::parse_from_str(v.as_str().unwrap(), "%Y-%m-%d %H:%M:%S").unwrap()
}

async fn setup() -> axum::Router {
    let pool = lifeline_hub::db::test_pool().await;
    lifeline_hub::auth::bootstrap::bootstrap_admin(&pool, "Test-Orga", "admin", Some("startpw12"))
        .await
        .unwrap();
    build_router(AppState {
        pool,
        live: LiveHub::new(),
        fachebenen: lifeline_hub::karte::FachebenenState::neu(),
    })
}

async fn login_cookie(app: &axum::Router, benutzername: &str, passwort: &str) -> String {
    let body = serde_json::json!({ "benutzername": benutzername, "passwort": passwort }).to_string();
    let res = app
        .clone()
        .oneshot(
            axum::http::Request::builder()
                .method("POST")
                .uri("/api/auth/login")
                .header(axum::http::header::CONTENT_TYPE, "application/json")
                .body(body)
                .unwrap(),
        )
        .await
        .unwrap();
    let cookie = res
        .headers()
        .get(axum::http::header::SET_COOKIE)
        .unwrap()
        .to_str()
        .unwrap();
    cookie.split(';').next().unwrap().to_string()
}

async fn anfrage(
    app: &axum::Router,
    methode: &str,
    uri: &str,
    cookie: &str,
    body: Option<&str>,
) -> (StatusCode, Value) {
    let mut req = axum::http::Request::builder()
        .method(methode)
        .uri(uri)
        .header(axum::http::header::COOKIE, cookie);
    if body.is_some() {
        req = req.header(axum::http::header::CONTENT_TYPE, "application/json");
    }
    let res = app
        .clone()
        .oneshot(req.body(body.unwrap_or("").to_string()).unwrap())
        .await
        .unwrap();
    let status = res.status();
    let bytes = axum::body::to_bytes(res.into_body(), usize::MAX).await.unwrap();
    let json = serde_json::from_slice(&bytes).unwrap_or(Value::Null);
    (status, json)
}

async fn einsatz_anlegen(app: &axum::Router, cookie: &str) -> i64 {
    let (_, json) = anfrage(app, "POST", "/api/einsaetze", cookie, Some(r#"{"bezeichnung":"Lage"}"#)).await;
    json["id"].as_i64().unwrap()
}

async fn benutzer_anlegen(app: &axum::Router, admin: &str, name: &str, org_rolle: &str) -> i64 {
    let body = format!(
        r#"{{"anzeigename":"{name}","benutzername":"{name}","passwort":"{name}pw1","org_rolle":"{org_rolle}"}}"#
    );
    let (status, json) = anfrage(app, "POST", "/api/benutzer", admin, Some(&body)).await;
    assert_eq!(status, StatusCode::CREATED, "{json:?}");
    json["id"].as_i64().unwrap()
}

async fn rolle_setzen(app: &axum::Router, leit: &str, einsatz: i64, benutzer_id: i64, rolle: &str) {
    let (status, _) = anfrage(
        app,
        "PUT",
        &format!("/api/einsaetze/{einsatz}/mitglieder/{benutzer_id}"),
        leit,
        Some(&format!(r#"{{"einsatz_rolle":"{rolle}"}}"#)),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
}

/// Vollständiger, gültiger Meldungs-Body (Pflichtfelder + Default-Vokabular).
/// Negative Fälle überschreiben ein einzelnes Feld present-but-invalid, damit der
/// Schreib-/Validierungs-Guard greift (nicht der Json-Extractor → das wäre 422).
fn meldung_body(absender: &str, meldeweg: &str, inhalt: &str) -> String {
    serde_json::json!({
        "absender": absender,
        "empfaenger": "ELW 1",
        "meldeweg": meldeweg,
        "inhalt": inhalt,
        "ereigniszeit": "2026-06-12 09:00:00"
    })
    .to_string()
}

/// Standard-gültiger Body (Funk, plausible Felder).
fn body_funk() -> String {
    meldung_body("Florian Nord 1", "funk", "Deich instabil")
}

#[tokio::test]
async fn anlegen_erzeugt_meldung_und_etb_eintrag() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;

    let (status, json) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{e}/meldungen"),
        &admin,
        Some(&body_funk()),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{json:?}");
    assert_eq!(json["lfd_nr"], 1);
    assert_eq!(json["status"], "neu");
    assert_eq!(json["absender"], "Florian Nord 1");
    assert!(json["etb_meldung_id"].is_i64(), "ETB-Meldung wird erzeugt");

    // ETB-Kopplung am HTTP-Rand: der ETB enthält einen Eintrag typ='meldung'.
    let (_, etb) = anfrage(&app, "GET", &format!("/api/einsaetze/{e}/etb"), &admin, None).await;
    assert!(etb.as_array().unwrap().iter().any(|x| x["typ"] == "meldung"));
}

#[tokio::test]
async fn anlegen_ohne_absender_ist_400() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let body = meldung_body("", "funk", "Deich instabil");
    let (status, _) = anfrage(&app, "POST", &format!("/api/einsaetze/{e}/meldungen"), &admin, Some(&body)).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn anlegen_ohne_inhalt_ist_400() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let body = meldung_body("Florian Nord 1", "funk", "   ");
    let (status, _) = anfrage(&app, "POST", &format!("/api/einsaetze/{e}/meldungen"), &admin, Some(&body)).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn anlegen_ungueltiger_meldeweg_ist_400() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let body = meldung_body("Florian Nord 1", "brieftaube", "Deich instabil");
    let (status, _) = anfrage(&app, "POST", &format!("/api/einsaetze/{e}/meldungen"), &admin, Some(&body)).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn anlegen_ungueltige_meldungsart_ist_400() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let body = serde_json::json!({
        "absender": "Florian Nord 1",
        "meldeweg": "funk",
        "inhalt": "Deich instabil",
        "meldungsart": "quatsch",
        "ereigniszeit": "2026-06-12 09:00:00"
    })
    .to_string();
    let (status, _) = anfrage(&app, "POST", &format!("/api/einsaetze/{e}/meldungen"), &admin, Some(&body)).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn anlegen_ungueltige_prioritaet_ist_400() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let body = serde_json::json!({
        "absender": "Florian Nord 1",
        "meldeweg": "funk",
        "inhalt": "Deich instabil",
        "prioritaet": "ultra",
        "ereigniszeit": "2026-06-12 09:00:00"
    })
    .to_string();
    let (status, _) = anfrage(&app, "POST", &format!("/api/einsaetze/{e}/meldungen"), &admin, Some(&body)).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn liste_zeigt_angelegte_meldungen() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    anfrage(&app, "POST", &format!("/api/einsaetze/{e}/meldungen"), &admin, Some(&body_funk())).await;
    let (status, json) = anfrage(&app, "GET", &format!("/api/einsaetze/{e}/meldungen"), &admin, None).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(json.as_array().unwrap().len(), 1);
}

#[tokio::test]
async fn beobachter_liest_aber_schreibt_nicht() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    // Vom Admin angelegte Meldung (echte id für status-/zuweisen-/lagerelevant-Routen).
    let (_, m) = anfrage(&app, "POST", &format!("/api/einsaetze/{e}/meldungen"), &admin, Some(&body_funk())).await;
    let mid = m["id"].as_i64().unwrap();

    // Zweiter Benutzer mit Einsatz-Rolle 'beobachter'.
    let erika = benutzer_anlegen(&app, &admin, "erika", "keine").await;
    rolle_setzen(&app, &admin, e, erika, "beobachter").await;
    let erika_c = login_cookie(&app, "erika", "erikapw1").await;

    // GET listen ist erlaubt (Lesezugriff).
    let (status, _) = anfrage(&app, "GET", &format!("/api/einsaetze/{e}/meldungen"), &erika_c, None).await;
    assert_eq!(status, StatusCode::OK);

    // POST anlegen → 403 (gültiger Body, damit der Schreibrecht-Guard greift, nicht der Json-Extractor).
    let (status, _) = anfrage(&app, "POST", &format!("/api/einsaetze/{e}/meldungen"), &erika_c, Some(&body_funk())).await;
    assert_eq!(status, StatusCode::FORBIDDEN);

    // POST status → 403 (gültiger Status-Body, damit der Guard greift).
    let (status, _) = anfrage(&app, "POST", &format!("/api/einsaetze/{e}/meldungen/{mid}/status"), &erika_c, Some(r#"{"status":"gesichtet"}"#)).await;
    assert_eq!(status, StatusCode::FORBIDDEN);

    // POST zuweisen → 403.
    let (status, _) = anfrage(&app, "POST", &format!("/api/einsaetze/{e}/meldungen/{mid}/zuweisen"), &erika_c, Some(r#"{"bearbeiter_id":null}"#)).await;
    assert_eq!(status, StatusCode::FORBIDDEN);

    // POST lagerelevant → 403.
    let (status, _) = anfrage(&app, "POST", &format!("/api/einsaetze/{e}/meldungen/{mid}/lagerelevant"), &erika_c, Some("{}")).await;
    assert_eq!(status, StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn beobachter_liest_lage_meldungen() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let erika = benutzer_anlegen(&app, &admin, "erika", "keine").await;
    rolle_setzen(&app, &admin, e, erika, "beobachter").await;
    let erika_c = login_cookie(&app, "erika", "erikapw1").await;

    let (status, json) = anfrage(&app, "GET", &format!("/api/einsaetze/{e}/lage/meldungen"), &erika_c, None).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(json.as_array().unwrap().len(), 0);
}

#[tokio::test]
async fn cross_einsatz_status_ist_404() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let a_einsatz = einsatz_anlegen(&app, &admin).await;
    let b_einsatz = einsatz_anlegen(&app, &admin).await;
    let (_, m) = anfrage(&app, "POST", &format!("/api/einsaetze/{a_einsatz}/meldungen"), &admin, Some(&body_funk())).await;
    let mid_a = m["id"].as_i64().unwrap();
    // Meldung aus A unter Einsatz B bearbeiten → 404 (Cross-Einsatz-Schutz).
    let (status, _) = anfrage(&app, "POST", &format!("/api/einsaetze/{b_einsatz}/meldungen/{mid_a}/status"), &admin, Some(r#"{"status":"gesichtet"}"#)).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn cross_einsatz_zuweisen_ist_404() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let a_einsatz = einsatz_anlegen(&app, &admin).await;
    let b_einsatz = einsatz_anlegen(&app, &admin).await;
    let (_, m) = anfrage(&app, "POST", &format!("/api/einsaetze/{a_einsatz}/meldungen"), &admin, Some(&body_funk())).await;
    let mid_a = m["id"].as_i64().unwrap();
    let (status, _) = anfrage(&app, "POST", &format!("/api/einsaetze/{b_einsatz}/meldungen/{mid_a}/zuweisen"), &admin, Some(r#"{"bearbeiter_id":null}"#)).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn cross_einsatz_lagerelevant_ist_404() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let a_einsatz = einsatz_anlegen(&app, &admin).await;
    let b_einsatz = einsatz_anlegen(&app, &admin).await;
    let (_, m) = anfrage(&app, "POST", &format!("/api/einsaetze/{a_einsatz}/meldungen"), &admin, Some(&body_funk())).await;
    let mid_a = m["id"].as_i64().unwrap();
    let (status, _) = anfrage(&app, "POST", &format!("/api/einsaetze/{b_einsatz}/meldungen/{mid_a}/lagerelevant"), &admin, Some("{}")).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn status_gueltiger_uebergang_setzt_status() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let (_, m) = anfrage(&app, "POST", &format!("/api/einsaetze/{e}/meldungen"), &admin, Some(&body_funk())).await;
    let mid = m["id"].as_i64().unwrap();

    let (status, json) = anfrage(&app, "POST", &format!("/api/einsaetze/{e}/meldungen/{mid}/status"), &admin, Some(r#"{"status":"in_bearbeitung"}"#)).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(json["status"], "in_bearbeitung");
    assert_eq!(json["ist_offen"], true);
}

#[tokio::test]
async fn status_ungueltig_ist_400() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let (_, m) = anfrage(&app, "POST", &format!("/api/einsaetze/{e}/meldungen"), &admin, Some(&body_funk())).await;
    let mid = m["id"].as_i64().unwrap();
    let (status, _) = anfrage(&app, "POST", &format!("/api/einsaetze/{e}/meldungen/{mid}/status"), &admin, Some(r#"{"status":"archiviert"}"#)).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn status_filter_trennt_offen_und_erledigt() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let (_, m1) = anfrage(&app, "POST", &format!("/api/einsaetze/{e}/meldungen"), &admin, Some(&meldung_body("Florian Nord 1", "funk", "A"))).await;
    let mid1 = m1["id"].as_i64().unwrap();
    anfrage(&app, "POST", &format!("/api/einsaetze/{e}/meldungen"), &admin, Some(&meldung_body("Florian Nord 2", "funk", "B"))).await;

    // m1 auf erledigt setzen.
    let (status, _) = anfrage(&app, "POST", &format!("/api/einsaetze/{e}/meldungen/{mid1}/status"), &admin, Some(r#"{"status":"erledigt"}"#)).await;
    assert_eq!(status, StatusCode::OK);

    let (status, json) = anfrage(&app, "GET", &format!("/api/einsaetze/{e}/meldungen?status=erledigt"), &admin, None).await;
    assert_eq!(status, StatusCode::OK);
    let erledigt = json.as_array().unwrap();
    assert_eq!(erledigt.len(), 1);
    assert_eq!(erledigt[0]["inhalt"], "A");

    let (status, json) = anfrage(&app, "GET", &format!("/api/einsaetze/{e}/meldungen?status=neu"), &admin, None).await;
    assert_eq!(status, StatusCode::OK);
    let neu = json.as_array().unwrap();
    assert_eq!(neu.len(), 1);
    assert_eq!(neu[0]["inhalt"], "B");
}

#[tokio::test]
async fn status_filter_ungueltig_ist_400() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let (status, _) = anfrage(&app, "GET", &format!("/api/einsaetze/{e}/meldungen?status=unsinn"), &admin, None).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn zuweisen_an_mitglied_setzt_bearbeiter() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let (_, m) = anfrage(&app, "POST", &format!("/api/einsaetze/{e}/meldungen"), &admin, Some(&body_funk())).await;
    let mid = m["id"].as_i64().unwrap();

    // Bearbeiter, der Einsatz-Mitglied ist.
    let bea = benutzer_anlegen(&app, &admin, "bearbei", "keine").await;
    rolle_setzen(&app, &admin, e, bea, "beobachter").await;

    let (status, json) = anfrage(&app, "POST", &format!("/api/einsaetze/{e}/meldungen/{mid}/zuweisen"), &admin, Some(&format!(r#"{{"bearbeiter_id":{bea}}}"#))).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(json["bearbeiter_id"], bea);
    assert_eq!(json["bearbeiter_name"], "bearbei");
}

#[tokio::test]
async fn zuweisen_an_nichtmitglied_ist_400() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let (_, m) = anfrage(&app, "POST", &format!("/api/einsaetze/{e}/meldungen"), &admin, Some(&body_funk())).await;
    let mid = m["id"].as_i64().unwrap();

    // Benutzer ohne Mitgliedschaft in diesem Einsatz (kein rolle_setzen).
    let fremd = benutzer_anlegen(&app, &admin, "fremd", "keine").await;
    let (status, _) = anfrage(&app, "POST", &format!("/api/einsaetze/{e}/meldungen/{mid}/zuweisen"), &admin, Some(&format!(r#"{{"bearbeiter_id":{fremd}}}"#))).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn zuweisen_null_gibt_frei() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let (_, m) = anfrage(&app, "POST", &format!("/api/einsaetze/{e}/meldungen"), &admin, Some(&body_funk())).await;
    let mid = m["id"].as_i64().unwrap();
    let bea = benutzer_anlegen(&app, &admin, "bearbei", "keine").await;
    rolle_setzen(&app, &admin, e, bea, "beobachter").await;

    // Erst zuweisen …
    let (status, json) = anfrage(&app, "POST", &format!("/api/einsaetze/{e}/meldungen/{mid}/zuweisen"), &admin, Some(&format!(r#"{{"bearbeiter_id":{bea}}}"#))).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(json["bearbeiter_id"], bea);

    // … dann freigeben (null).
    let (status, json) = anfrage(&app, "POST", &format!("/api/einsaetze/{e}/meldungen/{mid}/zuweisen"), &admin, Some(r#"{"bearbeiter_id":null}"#)).await;
    assert_eq!(status, StatusCode::OK);
    assert!(json["bearbeiter_id"].is_null());
}

#[tokio::test]
async fn statuswechsel_erhaelt_zuweisung() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let (_, m) = anfrage(&app, "POST", &format!("/api/einsaetze/{e}/meldungen"), &admin, Some(&body_funk())).await;
    let mid = m["id"].as_i64().unwrap();
    let bea = benutzer_anlegen(&app, &admin, "bearbei", "keine").await;
    rolle_setzen(&app, &admin, e, bea, "beobachter").await;

    // Zuweisen …
    let (status, _) = anfrage(&app, "POST", &format!("/api/einsaetze/{e}/meldungen/{mid}/zuweisen"), &admin, Some(&format!(r#"{{"bearbeiter_id":{bea}}}"#))).await;
    assert_eq!(status, StatusCode::OK);

    // … reiner Statuswechsel darf den Bearbeiter NICHT clobbern (Regression).
    let (status, json) = anfrage(&app, "POST", &format!("/api/einsaetze/{e}/meldungen/{mid}/status"), &admin, Some(r#"{"status":"erledigt"}"#)).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(json["status"], "erledigt");
    assert_eq!(json["bearbeiter_id"], bea, "Zuweisung bleibt über Statuswechsel erhalten");
}

#[tokio::test]
async fn lagerelevant_erzeugt_lageobjekt_und_ist_idempotent() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let (_, m) = anfrage(&app, "POST", &format!("/api/einsaetze/{e}/meldungen"), &admin, Some(&meldung_body("Florian Nord 1", "funk", "Brücke gesperrt"))).await;
    let mid = m["id"].as_i64().unwrap();

    let (status, json) = anfrage(&app, "POST", &format!("/api/einsaetze/{e}/meldungen/{mid}/lagerelevant"), &admin, Some("{}")).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(json["lagerelevant"], true);
    assert!(json["lage_meldung_id"].is_i64(), "Lageobjekt wird erzeugt");

    // Zweiter Aufruf ist idempotent (UNIQUE meldung_id → kein zweites Lageobjekt).
    let (status, _) = anfrage(&app, "POST", &format!("/api/einsaetze/{e}/meldungen/{mid}/lagerelevant"), &admin, Some("{}")).await;
    assert_eq!(status, StatusCode::OK);

    // GET /lage/meldungen: genau ein Lageobjekt mit Herkunft (lfd_nr + Absender).
    let (status, json) = anfrage(&app, "GET", &format!("/api/einsaetze/{e}/lage/meldungen"), &admin, None).await;
    assert_eq!(status, StatusCode::OK);
    let lage = json.as_array().unwrap();
    assert_eq!(lage.len(), 1, "idempotent: kein zweites Lageobjekt");
    assert_eq!(lage[0]["meldung_lfd_nr"], 1);
    assert_eq!(lage[0]["meldung_absender"], "Florian Nord 1");
    assert_eq!(lage[0]["text"], "Brücke gesperrt");
}

/// Sofortmeldungs-Body (Priorität sofort → implizit bestätigungspflichtig).
fn sofort_body() -> String {
    serde_json::json!({
        "absender": "Florian Nord 1",
        "empfaenger": "ELW 1",
        "meldeweg": "funk",
        "inhalt": "MANV ausgelöst",
        "prioritaet": "sofort",
        "ereigniszeit": "2026-06-12 09:00:00"
    })
    .to_string()
}

#[tokio::test]
async fn sofortmeldung_ist_bestaetigungspflichtig_mit_frist_und_nachfass() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;

    let (status, m) = anfrage(&app, "POST", &format!("/api/einsaetze/{e}/meldungen"), &admin, Some(&sofort_body())).await;
    assert_eq!(status, StatusCode::CREATED, "{m:?}");
    assert_eq!(m["prioritaet"], "sofort");
    assert_eq!(m["bestaetigung_pflicht"], true, "Sofort impliziert Bestätigungspflicht");
    assert!(m["bestaetigung_frist_at"].is_string(), "Frist gesetzt");
    assert_eq!(m["ist_bestaetigt"], false);

    // Nachfass: genau eine offene Auto-Frist-Erinnerung mit Bezug auf die Meldung.
    let (_, erinn) = anfrage(&app, "GET", &format!("/api/einsaetze/{e}/erinnerungen"), &admin, None).await;
    let auto: Vec<_> = erinn.as_array().unwrap().iter()
        .filter(|x| x["quelle"] == "auto_frist" && x["bezug_typ"] == "meldung")
        .collect();
    assert_eq!(auto.len(), 1, "eine Nachfass-Erinnerung je Sofortmeldung");
    assert_eq!(auto[0]["bezug_id"], m["id"]);
}

#[tokio::test]
async fn nicht_sofort_ohne_pflicht_legt_keine_nachfass_an() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let (status, m) = anfrage(&app, "POST", &format!("/api/einsaetze/{e}/meldungen"), &admin, Some(&body_funk())).await;
    assert_eq!(status, StatusCode::CREATED);
    assert_eq!(m["bestaetigung_pflicht"], false);
    assert!(m["bestaetigung_frist_at"].is_null());
    let (_, erinn) = anfrage(&app, "GET", &format!("/api/einsaetze/{e}/erinnerungen"), &admin, None).await;
    assert!(erinn.as_array().unwrap().is_empty(), "keine Auto-Erinnerung ohne Pflicht");
}

#[tokio::test]
async fn bestaetigen_setzt_quittung_und_doppelt_ist_422() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let (_, m) = anfrage(&app, "POST", &format!("/api/einsaetze/{e}/meldungen"), &admin, Some(&sofort_body())).await;
    let mid = m["id"].as_i64().unwrap();

    let (status, json) = anfrage(&app, "POST", &format!("/api/einsaetze/{e}/meldungen/{mid}/bestaetigen"), &admin, None).await;
    assert_eq!(status, StatusCode::OK, "{json:?}");
    assert_eq!(json["ist_bestaetigt"], true);
    assert!(json["bestaetigt_at"].is_string());
    assert_eq!(json["bestaetigt_von_name"], "Administrator");

    // Nachfass-Erinnerung ist nach Bestätigung nicht mehr offen.
    let (_, erinn) = anfrage(&app, "GET", &format!("/api/einsaetze/{e}/erinnerungen?nur_offen=true"), &admin, None).await;
    assert!(erinn.as_array().unwrap().iter().all(|x| x["bezug_typ"] != "meldung"),
            "Bestätigung schließt die offene Nachfass-Erinnerung");

    // Doppel-Bestätigung → 422.
    let (status, _) = anfrage(&app, "POST", &format!("/api/einsaetze/{e}/meldungen/{mid}/bestaetigen"), &admin, None).await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
}

#[tokio::test]
async fn bestaetigen_beobachter_ist_403() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let (_, m) = anfrage(&app, "POST", &format!("/api/einsaetze/{e}/meldungen"), &admin, Some(&sofort_body())).await;
    let mid = m["id"].as_i64().unwrap();

    let erika = benutzer_anlegen(&app, &admin, "erika", "keine").await;
    rolle_setzen(&app, &admin, e, erika, "beobachter").await;
    let erika_c = login_cookie(&app, "erika", "erikapw1").await;

    let (status, _) = anfrage(&app, "POST", &format!("/api/einsaetze/{e}/meldungen/{mid}/bestaetigen"), &erika_c, None).await;
    assert_eq!(status, StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn cross_einsatz_bestaetigen_ist_404() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let a = einsatz_anlegen(&app, &admin).await;
    let b = einsatz_anlegen(&app, &admin).await;
    let (_, m) = anfrage(&app, "POST", &format!("/api/einsaetze/{a}/meldungen"), &admin, Some(&sofort_body())).await;
    let mid_a = m["id"].as_i64().unwrap();
    let (status, _) = anfrage(&app, "POST", &format!("/api/einsaetze/{b}/meldungen/{mid_a}/bestaetigen"), &admin, None).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn sofort_frist_default_ist_fuenf_minuten() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let (status, m) = anfrage(&app, "POST", &format!("/api/einsaetze/{e}/meldungen"), &admin, Some(&sofort_body())).await;
    assert_eq!(status, StatusCode::CREATED);
    // Frist = Eingang + Default (5 Min) — Delta deterministisch, beide Werte aus der Antwort.
    assert_eq!(zeit(&m["bestaetigung_frist_at"]) - zeit(&m["eingang_at"]), Duration::minutes(5));
}

#[tokio::test]
async fn bestaetigung_frist_override_in_minuten() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let body = serde_json::json!({
        "absender": "Florian Nord 1", "meldeweg": "funk", "inhalt": "MANV",
        "prioritaet": "sofort", "ereigniszeit": "2026-06-12 09:00:00",
        "bestaetigung_pflicht": true, "bestaetigung_frist_min": 30
    }).to_string();
    let (status, m) = anfrage(&app, "POST", &format!("/api/einsaetze/{e}/meldungen"), &admin, Some(&body)).await;
    assert_eq!(status, StatusCode::CREATED, "{m:?}");
    assert_eq!(zeit(&m["bestaetigung_frist_at"]) - zeit(&m["eingang_at"]), Duration::minutes(30));
}

#[tokio::test]
async fn bestaetigung_frist_nicht_positiv_ist_400() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let body = serde_json::json!({
        "absender": "Florian Nord 1", "meldeweg": "funk", "inhalt": "MANV",
        "prioritaet": "sofort", "ereigniszeit": "2026-06-12 09:00:00",
        "bestaetigung_pflicht": true, "bestaetigung_frist_min": 0
    }).to_string();
    let (status, _) = anfrage(&app, "POST", &format!("/api/einsaetze/{e}/meldungen"), &admin, Some(&body)).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn sofort_mit_pflicht_false_ueberstimmt_und_legt_keine_nachfass_an() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let body = serde_json::json!({
        "absender": "Florian Nord 1", "meldeweg": "funk", "inhalt": "MANV",
        "prioritaet": "sofort", "ereigniszeit": "2026-06-12 09:00:00",
        "bestaetigung_pflicht": false
    }).to_string();
    let (status, m) = anfrage(&app, "POST", &format!("/api/einsaetze/{e}/meldungen"), &admin, Some(&body)).await;
    assert_eq!(status, StatusCode::CREATED);
    assert_eq!(m["bestaetigung_pflicht"], false, "explizites false überstimmt Sofort-Implikation");
    assert!(m["bestaetigung_frist_at"].is_null());
    let (_, erinn) = anfrage(&app, "GET", &format!("/api/einsaetze/{e}/erinnerungen"), &admin, None).await;
    assert!(erinn.as_array().unwrap().is_empty(), "keine Auto-Erinnerung ohne Pflicht");
}

#[tokio::test]
async fn richtung_filter_trennt_intern_extern() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    // Default intern.
    anfrage(&app, "POST", &format!("/api/einsaetze/{e}/meldungen"), &admin, Some(&body_funk())).await;
    let extern_body = serde_json::json!({
        "absender": "S3", "meldeweg": "funk", "inhalt": "Lage an übergeordnete Führung",
        "meldungsart": "lagemeldung", "richtung": "extern", "ereigniszeit": "2026-06-12 09:00:00"
    }).to_string();
    anfrage(&app, "POST", &format!("/api/einsaetze/{e}/meldungen"), &admin, Some(&extern_body)).await;

    let (status, json) = anfrage(&app, "GET", &format!("/api/einsaetze/{e}/meldungen?richtung=extern"), &admin, None).await;
    assert_eq!(status, StatusCode::OK);
    let liste = json.as_array().unwrap();
    assert_eq!(liste.len(), 1);
    assert_eq!(liste[0]["richtung"], "extern");
    assert_eq!(liste[0]["meldungsart"], "lagemeldung");

    let (status, _) = anfrage(&app, "GET", &format!("/api/einsaetze/{e}/meldungen?richtung=quatsch"), &admin, None).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
}
