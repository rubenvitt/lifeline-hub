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
    build_router(AppState { pool, live: LiveHub::new(), karten_dir: std::env::temp_dir(), fachebenen: lifeline_hub::karte::FachebenenState::neu(), download_client: lifeline_hub::karte::download::download_client(), download_fortschritt: lifeline_hub::karte::download::neue_fortschritt_map(), karten_service_url: None, karten_service_token: None })
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

/// GET kanaele legt den Default-Kanal an und gibt ihn zurück.
async fn default_kanal(app: &axum::Router, einsatz: i64, cookie: &str) -> i64 {
    let (status, json) = anfrage(app, "GET", &format!("/api/einsaetze/{einsatz}/chat/kanaele"), cookie, None).await;
    assert_eq!(status, StatusCode::OK);
    let arr = json.as_array().unwrap();
    assert_eq!(arr.len(), 1);
    assert_eq!(arr[0]["name"], "Allgemein");
    arr[0]["id"].as_i64().unwrap()
}

#[tokio::test]
async fn senden_und_lesen() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let kid = default_kanal(&app, einsatz, &admin).await;

    let (s, m) = anfrage(&app, "POST", &format!("/api/einsaetze/{einsatz}/chat/kanaele/{kid}/nachrichten"), &admin,
        Some(r#"{"inhalt":"Funktionsabstimmung S2/S3"}"#)).await;
    assert_eq!(s, StatusCode::CREATED);
    assert_eq!(m["inhalt"], "Funktionsabstimmung S2/S3");

    let (_, liste) = anfrage(&app, "GET", &format!("/api/einsaetze/{einsatz}/chat/kanaele/{kid}/nachrichten"), &admin, None).await;
    assert_eq!(liste.as_array().unwrap().len(), 1);
}

#[tokio::test]
async fn beobachter_liest_aber_schreibt_nicht() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let kid = default_kanal(&app, einsatz, &admin).await;
    let beo = benutzer_anlegen(&app, &admin, "erika", "keine").await;
    rolle_setzen(&app, &admin, einsatz, beo, "beobachter").await;
    let erika = login_cookie(&app, "erika", "erikapw1").await;

    assert_eq!(anfrage(&app, "GET", &format!("/api/einsaetze/{einsatz}/chat/kanaele/{kid}/nachrichten"), &erika, None).await.0, StatusCode::OK);
    assert_eq!(
        anfrage(&app, "POST", &format!("/api/einsaetze/{einsatz}/chat/kanaele/{kid}/nachrichten"), &erika,
            Some(r#"{"inhalt":"darf nicht"}"#)).await.0,
        StatusCode::FORBIDDEN
    );
}

#[tokio::test]
async fn fremde_nachricht_nicht_bearbeitbar_auch_nicht_durch_leitung() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await; // Einsatzleitung (Anleger)
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let kid = default_kanal(&app, einsatz, &admin).await;
    let fp = benutzer_anlegen(&app, &admin, "frank", "keine").await;
    rolle_setzen(&app, &admin, einsatz, fp, "fuehrungspersonal").await;
    let frank = login_cookie(&app, "frank", "frankpw1").await;

    let (_, m) = anfrage(&app, "POST", &format!("/api/einsaetze/{einsatz}/chat/kanaele/{kid}/nachrichten"), &frank,
        Some(r#"{"inhalt":"von frank"}"#)).await;
    let mid = m["id"].as_i64().unwrap();

    let (s, _) = anfrage(&app, "PATCH", &format!("/api/einsaetze/{einsatz}/chat/nachrichten/{mid}"), &admin,
        Some(r#"{"inhalt":"fremd geändert"}"#)).await;
    assert_eq!(s, StatusCode::FORBIDDEN);

    // Eigene Nachricht darf der Autor löschen → 204.
    let (s, _) = anfrage(&app, "DELETE", &format!("/api/einsaetze/{einsatz}/chat/nachrichten/{mid}"), &frank, None).await;
    assert_eq!(s, StatusCode::NO_CONTENT);
}

#[tokio::test]
async fn kanal_eines_anderen_einsatzes_ist_nicht_erreichbar() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz_a = einsatz_anlegen(&app, &admin).await;
    let einsatz_b = einsatz_anlegen(&app, &admin).await;
    let kid_b = default_kanal(&app, einsatz_b, &admin).await;

    let (s, _) = anfrage(&app, "POST", &format!("/api/einsaetze/{einsatz_a}/chat/kanaele/{kid_b}/nachrichten"), &admin,
        Some(r#"{"inhalt":"falscher Einsatz"}"#)).await;
    assert_eq!(s, StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn heraufstufen_erzeugt_etb_und_sperrt_doppelt() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let kid = default_kanal(&app, einsatz, &admin).await;
    let (_, m) = anfrage(&app, "POST", &format!("/api/einsaetze/{einsatz}/chat/kanaele/{kid}/nachrichten"), &admin,
        Some(r#"{"inhalt":"Deich km12 instabil"}"#)).await;
    let mid = m["id"].as_i64().unwrap();

    let (s, hoch) = anfrage(&app, "POST", &format!("/api/einsaetze/{einsatz}/chat/nachrichten/{mid}/heraufstufen-etb"), &admin,
        Some(r#"{"typ":"meldung"}"#)).await;
    assert_eq!(s, StatusCode::OK);
    assert!(hoch["etb_eintrag_id"].is_i64());

    let (_, etb) = anfrage(&app, "GET", &format!("/api/einsaetze/{einsatz}/etb"), &admin, None).await;
    let meldungen: Vec<&Value> = etb.as_array().unwrap().iter().filter(|e| e["typ"] == "meldung").collect();
    assert_eq!(meldungen.len(), 1);
    assert!(meldungen[0]["inhalt"].as_str().unwrap().contains("Deich km12 instabil"));

    let (s, _) = anfrage(&app, "POST", &format!("/api/einsaetze/{einsatz}/chat/nachrichten/{mid}/heraufstufen-etb"), &admin,
        Some(r#"{"typ":"meldung"}"#)).await;
    assert_eq!(s, StatusCode::CONFLICT);
}

#[tokio::test]
async fn heraufstufen_lehnt_unzulaessige_typen_ab() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let kid = default_kanal(&app, einsatz, &admin).await;
    let (_, m) = anfrage(&app, "POST", &format!("/api/einsaetze/{einsatz}/chat/kanaele/{kid}/nachrichten"), &admin,
        Some(r#"{"inhalt":"x"}"#)).await;
    let mid = m["id"].as_i64().unwrap();

    for typ in ["system", "berichtigung", "quatsch"] {
        let (s, _) = anfrage(&app, "POST", &format!("/api/einsaetze/{einsatz}/chat/nachrichten/{mid}/heraufstufen-etb"), &admin,
            Some(&format!(r#"{{"typ":"{typ}"}}"#))).await;
        assert_eq!(s, StatusCode::BAD_REQUEST, "Typ {typ} muss abgelehnt werden");
    }
}

#[tokio::test]
async fn heraufstufen_zu_auftrag_erzeugt_auftrag_und_markiert_nachricht() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let kid = default_kanal(&app, einsatz, &admin).await;
    let (_, m) = anfrage(&app, "POST", &format!("/api/einsaetze/{einsatz}/chat/kanaele/{kid}/nachrichten"), &admin,
        Some(r#"{"inhalt":"Tank 5000 anfordern"}"#)).await;
    let mid = m["id"].as_i64().unwrap();

    // Heraufstufen zu Auftrag mit Funktions-Empfänger + Priorität.
    let body = r#"{"auftrag_text":"Tank 5000 anfordern","prioritaet":"dringend","empfaenger":[{"empfaenger_typ":"funktion","funktion_text":"S4"}]}"#;
    let (s, hoch) = anfrage(&app, "POST", &format!("/api/einsaetze/{einsatz}/chat/nachrichten/{mid}/heraufstufen-auftrag"), &admin,
        Some(body)).await;
    assert_eq!(s, StatusCode::CREATED);
    assert!(hoch["auftrag_id"].is_i64(), "Nachricht trägt den Rückverweis auf den Auftrag");

    // Auftrag landet dokumentiert im Auftrag-Modul (inkl. Priorität).
    let (_, auftraege) = anfrage(&app, "GET", &format!("/api/einsaetze/{einsatz}/auftraege"), &admin, None).await;
    let arr = auftraege.as_array().unwrap();
    assert_eq!(arr.len(), 1);
    assert_eq!(arr[0]["auftrag_text"], "Tank 5000 anfordern");
    assert_eq!(arr[0]["prioritaet"], "dringend");
    assert!(arr[0]["etb_anordnung_id"].is_i64(), "ETB-Anordnung im selben Commit");

    // Doppel-Heraufstufung zu Auftrag → Conflict.
    let (s, _) = anfrage(&app, "POST", &format!("/api/einsaetze/{einsatz}/chat/nachrichten/{mid}/heraufstufen-auftrag"), &admin,
        Some(body)).await;
    assert_eq!(s, StatusCode::CONFLICT);
}

#[tokio::test]
async fn heraufstufen_zu_auftrag_ohne_empfaenger_wird_abgelehnt() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let kid = default_kanal(&app, einsatz, &admin).await;
    let (_, m) = anfrage(&app, "POST", &format!("/api/einsaetze/{einsatz}/chat/kanaele/{kid}/nachrichten"), &admin,
        Some(r#"{"inhalt":"x"}"#)).await;
    let mid = m["id"].as_i64().unwrap();

    // Gleiche Validierung wie POST /auftraege: ohne Empfänger → 400, keine Heraufstufung.
    let (s, _) = anfrage(&app, "POST", &format!("/api/einsaetze/{einsatz}/chat/nachrichten/{mid}/heraufstufen-auftrag"), &admin,
        Some(r#"{"auftrag_text":"x","empfaenger":[]}"#)).await;
    assert_eq!(s, StatusCode::BAD_REQUEST);

    let (_, nachher) = anfrage(&app, "GET", &format!("/api/einsaetze/{einsatz}/chat/kanaele/{kid}/nachrichten"), &admin, None).await;
    assert!(nachher.as_array().unwrap()[0]["auftrag_id"].is_null(), "keine Markierung bei Validierungsfehler");
}

// ---- Sachbezug (LFH-103) ----

/// Legt einen minimalen Schaden an und liefert dessen id (Bezug-Ziel der Tests).
async fn schaden_anlegen(app: &axum::Router, einsatz: i64, cookie: &str) -> i64 {
    let (s, j) = anfrage(app, "POST", &format!("/api/einsaetze/{einsatz}/schaeden"), cookie,
        Some(r#"{"typ":"sachschaden","ausmass":"gering","ort":"B5 km12"}"#)).await;
    assert_eq!(s, StatusCode::CREATED);
    j["id"].as_i64().unwrap()
}

async fn nachricht_anlegen(app: &axum::Router, einsatz: i64, kid: i64, cookie: &str, inhalt: &str) -> i64 {
    let (s, m) = anfrage(app, "POST", &format!("/api/einsaetze/{einsatz}/chat/kanaele/{kid}/nachrichten"), cookie,
        Some(&format!(r#"{{"inhalt":"{inhalt}"}}"#))).await;
    assert_eq!(s, StatusCode::CREATED);
    m["id"].as_i64().unwrap()
}

#[tokio::test]
async fn bezug_setzen_anzeigen_und_loesen() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let kid = default_kanal(&app, einsatz, &admin).await;
    let mid = nachricht_anlegen(&app, einsatz, kid, &admin, "Lage am Deich").await;
    let sid = schaden_anlegen(&app, einsatz, &admin).await;

    // Setzen → 200, Antwort trägt den Bezug.
    let (s, n) = anfrage(&app, "PUT", &format!("/api/einsaetze/{einsatz}/chat/nachrichten/{mid}/bezug"), &admin,
        Some(&format!(r#"{{"typ":"schaden","ziel_id":{sid}}}"#))).await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(n["bezug_typ"], "schaden");
    assert_eq!(n["bezug_id"], sid);

    // In der Liste sichtbar.
    let (_, liste) = anfrage(&app, "GET", &format!("/api/einsaetze/{einsatz}/chat/kanaele/{kid}/nachrichten"), &admin, None).await;
    assert_eq!(liste.as_array().unwrap()[0]["bezug_typ"], "schaden");
    assert_eq!(liste.as_array().unwrap()[0]["bezug_id"], sid);

    // Lösen → 200, Bezug wieder leer (both-or-neither).
    let (s, n) = anfrage(&app, "DELETE", &format!("/api/einsaetze/{einsatz}/chat/nachrichten/{mid}/bezug"), &admin, None).await;
    assert_eq!(s, StatusCode::OK);
    assert!(n["bezug_typ"].is_null());
    assert!(n["bezug_id"].is_null());
}

#[tokio::test]
async fn bezug_auf_fremden_einsatz_abgelehnt() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz_a = einsatz_anlegen(&app, &admin).await;
    let einsatz_b = einsatz_anlegen(&app, &admin).await;
    let kid_a = default_kanal(&app, einsatz_a, &admin).await;
    let mid = nachricht_anlegen(&app, einsatz_a, kid_a, &admin, "in A").await;
    let sid_b = schaden_anlegen(&app, einsatz_b, &admin).await;

    // Bezug auf ein Objekt aus einem anderen Einsatz → Cross-Einsatz-Guard, 400.
    let (s, _) = anfrage(&app, "PUT", &format!("/api/einsaetze/{einsatz_a}/chat/nachrichten/{mid}/bezug"), &admin,
        Some(&format!(r#"{{"typ":"schaden","ziel_id":{sid_b}}}"#))).await;
    assert_eq!(s, StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn bezug_ungueltiger_typ_abgelehnt() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let kid = default_kanal(&app, einsatz, &admin).await;
    let mid = nachricht_anlegen(&app, einsatz, kid, &admin, "x").await;

    let (s, _) = anfrage(&app, "PUT", &format!("/api/einsaetze/{einsatz}/chat/nachrichten/{mid}/bezug"), &admin,
        Some(r#"{"typ":"quatsch","ziel_id":1}"#)).await;
    assert_eq!(s, StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn bezug_durch_schreibberechtigten_nicht_nur_autor() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let kid = default_kanal(&app, einsatz, &admin).await;
    let mid = nachricht_anlegen(&app, einsatz, kid, &admin, "von admin").await;
    let sid = schaden_anlegen(&app, einsatz, &admin).await;

    // Anderer Schreibberechtigter (kein Autor) darf den Bezug setzen — anders als
    // Bearbeiten/Löschen (fordere_autor); hier zählt nur das Schreibrecht.
    let fp = benutzer_anlegen(&app, &admin, "frank", "keine").await;
    rolle_setzen(&app, &admin, einsatz, fp, "fuehrungspersonal").await;
    let frank = login_cookie(&app, "frank", "frankpw1").await;

    let (s, n) = anfrage(&app, "PUT", &format!("/api/einsaetze/{einsatz}/chat/nachrichten/{mid}/bezug"), &frank,
        Some(&format!(r#"{{"typ":"schaden","ziel_id":{sid}}}"#))).await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(n["bezug_typ"], "schaden");
}

#[tokio::test]
async fn bezug_durch_beobachter_verboten() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let kid = default_kanal(&app, einsatz, &admin).await;
    let mid = nachricht_anlegen(&app, einsatz, kid, &admin, "x").await;
    let sid = schaden_anlegen(&app, einsatz, &admin).await;
    let beo = benutzer_anlegen(&app, &admin, "erika", "keine").await;
    rolle_setzen(&app, &admin, einsatz, beo, "beobachter").await;
    let erika = login_cookie(&app, "erika", "erikapw1").await;

    let (s, _) = anfrage(&app, "PUT", &format!("/api/einsaetze/{einsatz}/chat/nachrichten/{mid}/bezug"), &erika,
        Some(&format!(r#"{{"typ":"schaden","ziel_id":{sid}}}"#))).await;
    assert_eq!(s, StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn bezug_an_geloeschter_nachricht_ist_konflikt() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let kid = default_kanal(&app, einsatz, &admin).await;
    let mid = nachricht_anlegen(&app, einsatz, kid, &admin, "x").await;
    let sid = schaden_anlegen(&app, einsatz, &admin).await;
    let (s, _) = anfrage(&app, "DELETE", &format!("/api/einsaetze/{einsatz}/chat/nachrichten/{mid}"), &admin, None).await;
    assert_eq!(s, StatusCode::NO_CONTENT);

    let (s, _) = anfrage(&app, "PUT", &format!("/api/einsaetze/{einsatz}/chat/nachrichten/{mid}/bezug"), &admin,
        Some(&format!(r#"{{"typ":"schaden","ziel_id":{sid}}}"#))).await;
    assert_eq!(s, StatusCode::CONFLICT);
}
