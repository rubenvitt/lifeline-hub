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
    build_router(AppState {
        pool,
        live: LiveHub::new(),
        karten_dir: std::env::temp_dir(),
        fachebenen: lifeline_hub::karte::FachebenenState::neu(),
        download_client: lifeline_hub::karte::download::download_client(),
        download_fortschritt: lifeline_hub::karte::download::neue_fortschritt_map(),
        karten_service_url: None,
        karten_service_token: None,
    })
}

/// Wie `setup`, liefert aber zusätzlich den Pool (für Direktquery-Verifikation).
/// `SqlitePool` ist billig klonbar und teilt dieselbe In-Memory-DB.
async fn setup_mit_pool() -> (axum::Router, sqlx::SqlitePool) {
    let pool = db::test_pool().await;
    bootstrap_admin(&pool, "Test-Orga", "admin", Some("startpw12"))
        .await
        .unwrap();
    let router = build_router(AppState {
        pool: pool.clone(),
        live: LiveHub::new(),
        karten_dir: std::env::temp_dir(),
        fachebenen: lifeline_hub::karte::FachebenenState::neu(),
        download_client: lifeline_hub::karte::download::download_client(),
        download_fortschritt: lifeline_hub::karte::download::neue_fortschritt_map(),
        karten_service_url: None,
        karten_service_token: None,
    });
    (router, pool)
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

async fn benutzer_anlegen(
    app: &axum::Router,
    admin_cookie: &str,
    name: &str,
    org_rolle: &str,
) -> i64 {
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
    serde_json::from_slice::<Value>(&bytes).unwrap()["id"]
        .as_i64()
        .unwrap()
}

/// Generischer Request-Helfer: liefert (Status, JSON-Body).
async fn anfrage(
    app: &axum::Router,
    methode: &str,
    uri: &str,
    cookie: &str,
    body: Option<&str>,
) -> (StatusCode, Value) {
    let mut req = Request::builder()
        .method(methode)
        .uri(uri)
        .header(header::COOKIE, cookie.to_string());
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
    (
        status,
        serde_json::from_slice(&bytes).unwrap_or(Value::Null),
    )
}

// ---------- Zusatz-Helfer ----------

async fn einsatz_anlegen(app: &axum::Router, cookie: &str) -> i64 {
    let (status, json) = anfrage(
        app,
        "POST",
        "/api/einsaetze",
        cookie,
        Some(r#"{"bezeichnung":"Lage"}"#),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    json["id"].as_i64().unwrap()
}

/// Weist einem Benutzer eine Einsatz-Rolle zu (durch die Einsatzleitung).
async fn rolle_setzen(
    app: &axum::Router,
    leit_cookie: &str,
    einsatz: i64,
    benutzer_id: i64,
    rolle: &str,
) {
    let (status, _) = anfrage(
        app,
        "PUT",
        &format!("/api/einsaetze/{einsatz}/mitglieder/{benutzer_id}"),
        leit_cookie,
        Some(&format!(r#"{{"einsatz_rolle":"{rolle}"}}"#)),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
}

/// Liefert die ETB-Einträge mit typ='system' als Vec der Inhalte.
async fn system_etb_inhalte(app: &axum::Router, cookie: &str, einsatz: i64) -> Vec<String> {
    let (_, json) = anfrage(
        app,
        "GET",
        &format!("/api/einsaetze/{einsatz}/etb"),
        cookie,
        None,
    )
    .await;
    json.as_array()
        .unwrap()
        .iter()
        .filter(|e| e["typ"] == "system")
        .map(|e| e["inhalt"].as_str().unwrap().to_string())
        .collect()
}

/// Legt eine Person an und liefert ihre id.
async fn person_anlegen(app: &axum::Router, cookie: &str, einsatz: i64, body: &str) -> i64 {
    let (status, json) = anfrage(
        app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/personen"),
        cookie,
        Some(body),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    json["id"].as_i64().unwrap()
}

// ---------- Cross-cutting: ETB-Leak + SSE-Payload ----------

#[tokio::test]
async fn etb_enthaelt_keine_identitaet_und_keinen_befundtext() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let p = person_anlegen(&app, &admin, e, r#"{"name":"Mustermann","vorname":"Max"}"#).await;
    // Sichtung + Verbleib + Notiz
    sichten(
        &app,
        &admin,
        e,
        p,
        r#"{"kategorie":"sk1","notiz":"GANZ_GEHEIME_KURZBEGRUENDUNG"}"#,
    )
    .await;
    anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{e}/personen/{p}/verbleib"),
        &admin,
        Some(r#"{"art":"transport","ziel":"KH Mitte"}"#),
    )
    .await;
    anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{e}/personen/{p}/notizen"),
        &admin,
        Some(r#"{"text":"VERTRAULICHER_BEFUND_XYZ"}"#),
    )
    .await;
    let inhalte = system_etb_inhalte(&app, &admin, e).await;
    for i in &inhalte {
        assert!(!i.contains("Mustermann"), "ETB-Leak (name): {i}");
        assert!(!i.contains("Max"), "ETB-Leak (vorname): {i}");
        assert!(
            !i.contains("VERTRAULICHER_BEFUND_XYZ"),
            "ETB-Leak (befundtext): {i}"
        );
        assert!(
            !i.contains("GANZ_GEHEIME_KURZBEGRUENDUNG"),
            "ETB-Leak (sichtungsnotiz): {i}"
        );
    }
    // Notiz darf KEINEN ETB-Eintrag erzeugt haben → kein Eintrag mit "Notiz" o.ä.
    assert!(
        inhalte.iter().all(|i| !i.to_lowercase().contains("notiz")),
        "Notiz darf kein ETB schreiben: {inhalte:?}"
    );
}

#[tokio::test]
async fn sse_person_event_enthaelt_nur_ids_keinen_befundtext() {
    let pool = lifeline_hub::db::test_pool().await;
    lifeline_hub::auth::bootstrap::bootstrap_admin(&pool, "Test-Orga", "admin", Some("startpw12"))
        .await
        .unwrap();
    let live = lifeline_hub::live::LiveHub::new();
    let app = lifeline_hub::app::build_router(lifeline_hub::app::AppState {
        pool: pool.clone(),
        live: live.clone(),
        karten_dir: std::env::temp_dir(),
        fachebenen: lifeline_hub::karte::FachebenenState::neu(),
        download_client: lifeline_hub::karte::download::download_client(),
        download_fortschritt: lifeline_hub::karte::download::neue_fortschritt_map(),
        karten_service_url: None,
        karten_service_token: None,
    });
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let p = person_anlegen(&app, &admin, e, r#"{"name":"Mustermann"}"#).await;
    let mut rx = live.abonniere(e);

    // Eine Notiz auslösen (enthält sensiblen Text → muss im SSE NICHT auftauchen)
    anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{e}/personen/{p}/notizen"),
        &admin,
        Some(r#"{"text":"GEHEIM_XYZ_BEFUND"}"#),
    )
    .await;

    // Es gibt potenziell mehrere Events (etb für vorherige Anlegen-ETB-Einträge); wir
    // suchen das nach der Notiz erwartete `person`-Event und prüfen seinen Payload.
    let mut gefunden = false;
    for _ in 0..10 {
        match tokio::time::timeout(std::time::Duration::from_millis(100), rx.recv()).await {
            Ok(Ok(n)) if n.event == "person" => {
                assert!(
                    !n.data.contains("GEHEIM_XYZ_BEFUND"),
                    "SSE leakt Befundtext: {}",
                    n.data
                );
                assert!(!n.data.contains("Mustermann"), "SSE leakt Name: {}", n.data);
                // Erwartetes Format: { einsatz_id, person_id }
                let v: Value = serde_json::from_str(&n.data).unwrap();
                assert!(v.get("einsatz_id").is_some() && v.get("person_id").is_some());
                assert_eq!(
                    v.as_object().unwrap().len(),
                    2,
                    "person-SSE darf NUR einsatz_id+person_id enthalten"
                );
                gefunden = true;
                break;
            }
            Ok(Ok(_)) => continue, // andere Events ignorieren
            Ok(Err(_)) | Err(_) => break,
        }
    }
    assert!(gefunden, "Kein `person`-SSE-Event empfangen");
}

// ---------- Tests ----------

#[tokio::test]
async fn detail_liefert_person_mit_feldern() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let p = person_anlegen(&app, &admin, e, r#"{"name":"Test","antreff_ort":"Brücke"}"#).await;
    let (status, json) = anfrage(
        &app,
        "GET",
        &format!("/api/einsaetze/{e}/personen/{p}"),
        &admin,
        None,
    )
    .await;
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
        &app,
        "PATCH",
        &format!("/api/einsaetze/{e}/personen/{p}"),
        &admin,
        Some(r#"{"name":"Neu","notiz":"verletzt"}"#),
    )
    .await;
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
    let (status, _) = anfrage(
        &app,
        "GET",
        &format!("/api/einsaetze/{anderer}/personen/{p}"),
        &admin,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn anlegen_vergibt_registriernummer_und_status_erfasst() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let (status, json) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{e}/personen"),
        &admin,
        Some(r#"{"geschlecht":"maennlich","alter_geschaetzt":40,"antreff_ort":"Brücke"}"#),
    )
    .await;
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
        &app,
        "POST",
        &format!("/api/einsaetze/{e}/personen"),
        &admin,
        Some(r#"{"geschlecht":"alien"}"#),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn anlegen_schreibt_pseudonymen_etb_eintrag_ohne_identitaet() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let (_, _json) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{e}/personen"),
        &admin,
        Some(r#"{"name":"Mustermann","vorname":"Max"}"#),
    )
    .await;
    let inhalte = system_etb_inhalte(&app, &admin, e).await;
    assert_eq!(inhalte.len(), 1);
    assert!(
        inhalte[0].contains("R-001"),
        "ETB nennt die Registriernummer"
    );
    assert!(inhalte[0].contains("erfasst"));
    assert!(
        !inhalte[0].contains("Mustermann"),
        "ETB darf den Namen NICHT enthalten"
    );
    assert!(
        !inhalte[0].contains("Max"),
        "ETB darf den Vornamen NICHT enthalten"
    );
}

#[tokio::test]
async fn liste_filtert_nach_status() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{e}/personen"),
        &admin,
        Some(r#"{}"#),
    )
    .await;
    anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{e}/personen"),
        &admin,
        Some(r#"{}"#),
    )
    .await;
    let (status, json) = anfrage(
        &app,
        "GET",
        &format!("/api/einsaetze/{e}/personen?status=erfasst"),
        &admin,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(json.as_array().unwrap().len(), 2);
    let (_, leer) = anfrage(
        &app,
        "GET",
        &format!("/api/einsaetze/{e}/personen?status=vermisst"),
        &admin,
        None,
    )
    .await;
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
    let (status, _) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{e}/personen"),
        &beob,
        Some(r#"{}"#),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn gueltiger_status_wechsel_schreibt_etb() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let p = person_anlegen(&app, &admin, e, r#"{}"#).await;
    let (status, json) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{e}/personen/{p}/status"),
        &admin,
        Some(r#"{"status":"vermisst"}"#),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(json["status"], "vermisst");
    let inhalte = system_etb_inhalte(&app, &admin, e).await;
    assert!(inhalte
        .iter()
        .any(|i| i.contains("R-001") && i.contains("erfasst") && i.contains("vermisst")));
}

#[tokio::test]
async fn ungueltiger_status_wechsel_ist_422() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let p = person_anlegen(&app, &admin, e, r#"{}"#).await;
    // erfasst → erfasst ist kein gültiger Übergang.
    let (status, _) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{e}/personen/{p}/status"),
        &admin,
        Some(r#"{"status":"erfasst"}"#),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
}

#[tokio::test]
async fn unbekannter_zielstatus_ist_400() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let p = person_anlegen(&app, &admin, e, r#"{}"#).await;
    let (status, _) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{e}/personen/{p}/status"),
        &admin,
        Some(r#"{"status":"quatsch"}"#),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn stornieren_blendet_aus_liste_und_schreibt_etb() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let p = person_anlegen(&app, &admin, e, r#"{}"#).await;
    let (status, _) = anfrage(
        &app,
        "DELETE",
        &format!("/api/einsaetze/{e}/personen/{p}"),
        &admin,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::NO_CONTENT);
    let (_, liste) = anfrage(
        &app,
        "GET",
        &format!("/api/einsaetze/{e}/personen"),
        &admin,
        None,
    )
    .await;
    assert_eq!(liste.as_array().unwrap().len(), 0);
    let inhalte = system_etb_inhalte(&app, &admin, e).await;
    assert!(inhalte
        .iter()
        .any(|i| i.contains("R-001") && i.contains("storniert")));
}

/// Zählt Audit-Einträge einer Person (über die Audit-Einsicht der Leitung).
async fn audit_anzahl(app: &axum::Router, leit_cookie: &str, einsatz: i64, person: i64) -> usize {
    let (status, json) = anfrage(
        app,
        "GET",
        &format!("/api/einsaetze/{einsatz}/personen/{person}/audit"),
        leit_cookie,
        None,
    )
    .await;
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
    anfrage(
        &app,
        "GET",
        &format!("/api/einsaetze/{e}/personen"),
        &admin,
        None,
    )
    .await;
    assert_eq!(audit_anzahl(&app, &admin, e, p).await, 0);
    // Eine Detail-Öffnung → genau ein Eintrag (die Audit-Einsicht selbst schreibt keinen):
    let (status, _) = anfrage(
        &app,
        "GET",
        &format!("/api/einsaetze/{e}/personen/{p}"),
        &admin,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(audit_anzahl(&app, &admin, e, p).await, 1);
    // Zweite Öffnung → zwei Einträge:
    anfrage(
        &app,
        "GET",
        &format!("/api/einsaetze/{e}/personen/{p}"),
        &admin,
        None,
    )
    .await;
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
    let (status, _) = anfrage(
        &app,
        "GET",
        &format!("/api/einsaetze/{e}/personen/{p}/audit"),
        &fueh,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    // Einsatzleitung (admin) darf:
    let (status, _) = anfrage(
        &app,
        "GET",
        &format!("/api/einsaetze/{e}/personen/{p}/audit"),
        &admin,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
}

#[tokio::test]
async fn fremder_einsatz_anlegen_ist_403() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    // Ein Nicht-Mitglied (keine Einsatz-Rolle), kein System-Admin.
    benutzer_anlegen(&app, &admin, "aussen", "keine").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let aussen = login_cookie(&app, "aussen", "aussenpw1").await;
    // Lesen ohne Mitgliedschaft: 403 (darf_lesen = false).
    let (status, _) = anfrage(
        &app,
        "GET",
        &format!("/api/einsaetze/{e}/personen"),
        &aussen,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    // Schreiben ohne Mitgliedschaft: 403.
    let (status, _) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{e}/personen"),
        &aussen,
        Some(r#"{}"#),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn abgeschlossener_einsatz_ist_readonly() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let p = person_anlegen(&app, &admin, e, r#"{}"#).await;
    // Einsatz abschließen:
    let (status, _) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{e}/abschliessen"),
        &admin,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    // Lesen weiterhin erlaubt (in der Nachlauffrist):
    let (status, _) = anfrage(
        &app,
        "GET",
        &format!("/api/einsaetze/{e}/personen"),
        &admin,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    // Schreiben blockiert (409 Conflict via fordere_aktiv):
    let (status, _) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{e}/personen"),
        &admin,
        Some(r#"{}"#),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT);
    let (status, _) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{e}/personen/{p}/status"),
        &admin,
        Some(r#"{"status":"vermisst"}"#),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT);
    let (status, _) = anfrage(
        &app,
        "DELETE",
        &format!("/api/einsaetze/{e}/personen/{p}"),
        &admin,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT);
}

#[tokio::test]
async fn beobachter_liest_aber_schreibt_nicht() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let beob_id = benutzer_anlegen(&app, &admin, "beob2", "keine").await;
    let e = einsatz_anlegen(&app, &admin).await;
    rolle_setzen(&app, &admin, e, beob_id, "beobachter").await;
    let p = person_anlegen(&app, &admin, e, r#"{}"#).await;
    let beob = login_cookie(&app, "beob2", "beob2pw1").await;
    // Lesen erlaubt:
    let (status, _) = anfrage(
        &app,
        "GET",
        &format!("/api/einsaetze/{e}/personen"),
        &beob,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    // Detail lesen erlaubt (und auditiert):
    let (status, _) = anfrage(
        &app,
        "GET",
        &format!("/api/einsaetze/{e}/personen/{p}"),
        &beob,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    // Status-Wechsel verboten:
    let (status, _) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{e}/personen/{p}/status"),
        &beob,
        Some(r#"{"status":"vermisst"}"#),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn status_wechsel_auf_stornierte_person_ist_409() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let p = person_anlegen(&app, &admin, e, r#"{}"#).await;
    let (status, _) = anfrage(
        &app,
        "DELETE",
        &format!("/api/einsaetze/{e}/personen/{p}"),
        &admin,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::NO_CONTENT);
    // Status-Wechsel auf bereits stornierte Person → 409 Conflict, KEIN zusätzlicher ETB-Eintrag.
    let vorher = system_etb_inhalte(&app, &admin, e).await.len();
    let (status, _) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{e}/personen/{p}/status"),
        &admin,
        Some(r#"{"status":"vermisst"}"#),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT);
    assert_eq!(
        system_etb_inhalte(&app, &admin, e).await.len(),
        vorher,
        "kein ETB-Eintrag bei abgelehntem Wechsel"
    );
}

#[tokio::test]
async fn doppeltes_stornieren_ist_409() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let p = person_anlegen(&app, &admin, e, r#"{}"#).await;
    let (s1, _) = anfrage(
        &app,
        "DELETE",
        &format!("/api/einsaetze/{e}/personen/{p}"),
        &admin,
        None,
    )
    .await;
    assert_eq!(s1, StatusCode::NO_CONTENT);
    let (s2, _) = anfrage(
        &app,
        "DELETE",
        &format!("/api/einsaetze/{e}/personen/{p}"),
        &admin,
        None,
    )
    .await;
    assert_eq!(s2, StatusCode::CONFLICT);
}

#[tokio::test]
async fn export_entschaerft_formel_injektion() {
    let (app, _pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    // Name mit Formel-Präfix:
    person_anlegen(&app, &admin, e, r#"{"name":"=SUM(A1)"}"#).await;
    let resp = app
        .clone()
        .oneshot(
            Request::builder()
                .method("GET")
                .uri(format!("/api/einsaetze/{e}/personen/export"))
                .header(header::COOKIE, admin.clone())
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let bytes = to_bytes(resp.into_body(), usize::MAX).await.unwrap();
    let csv = String::from_utf8(bytes.to_vec()).unwrap();
    // Der Name darf NICHT roh als Formel erscheinen; er ist mit ' neutralisiert:
    assert!(
        csv.contains("\"'=SUM(A1)\""),
        "Formel-Präfix muss mit Apostroph entschärft sein, CSV war:\n{csv}"
    );
    assert!(
        !csv.contains("\"=SUM(A1)\""),
        "roher Formel-Wert darf nicht im CSV stehen"
    );
}

#[tokio::test]
async fn export_enthaelt_sichtung_spalte() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    // Eine gesichtete Person (SK I) und eine ungesichtete:
    let p1 = person_anlegen(&app, &admin, e, r#"{"name":"Gesichtet"}"#).await;
    sichten(&app, &admin, e, p1, r#"{"kategorie":"sk1"}"#).await;
    person_anlegen(&app, &admin, e, r#"{"name":"Ungesichtet"}"#).await;

    let resp = app
        .clone()
        .oneshot(
            Request::builder()
                .method("GET")
                .uri(format!("/api/einsaetze/{e}/personen/export"))
                .header(header::COOKIE, admin.clone())
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let bytes = to_bytes(resp.into_body(), usize::MAX).await.unwrap();
    let csv = String::from_utf8(bytes.to_vec()).unwrap();

    // Header trägt `sichtung` an Position 3 (direkt nach `status`):
    assert_eq!(
        csv.lines().next().unwrap(),
        "registrier_nr;status;sichtung;name;vorname;geschlecht;alter;antreff_ort"
    );
    // Gesichtete Person trägt den SK-Code in der sichtung-Spalte:
    assert!(
        csv.contains(";\"sk1\";"),
        "gesichtete Person muss sk1 tragen, CSV:\n{csv}"
    );
    // Ungesichtete Person hat ein leeres sichtung-Feld:
    assert!(
        csv.lines()
            .any(|z| z.contains("Ungesichtet") && z.contains(";\"\";\"Ungesichtet\"")),
        "ungesichtete Person muss ein leeres sichtung-Feld haben, CSV:\n{csv}"
    );
}

#[tokio::test]
async fn detail_enthaelt_medizinischen_verlauf_und_genau_einen_audit() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let p = person_anlegen(&app, &admin, e, r#"{}"#).await;
    let (status, json) = anfrage(
        &app,
        "GET",
        &format!("/api/einsaetze/{e}/personen/{p}"),
        &admin,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    // E-2: vier Verlaufs-Arrays sind Teil der Detail-Antwort:
    assert!(json["sichtungen"].is_array());
    assert!(json["notizen"].is_array());
    assert!(json["verbleib"].is_array());
    assert!(json["abgleiche"].is_array());
    // E-1-Felder bleiben top-level (serde flatten):
    assert_eq!(json["registrier_nr"], 1);
    // Cache-Felder sind initial null:
    assert!(json["aktuelle_sichtung"].is_null());
    assert!(json["aktueller_verbleib"].is_null());
    // Genau EIN detail-Audit-Eintrag — auch mit angereicherter Antwort:
    assert_eq!(audit_anzahl(&app, &admin, e, p).await, 1);
}

async fn sichten(
    app: &axum::Router,
    cookie: &str,
    einsatz: i64,
    person: i64,
    body: &str,
) -> (StatusCode, Value) {
    anfrage(
        app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/personen/{person}/sichtung"),
        cookie,
        Some(body),
    )
    .await
}

#[tokio::test]
async fn verbleib_transport_setzt_cache_und_etb_mit_ziel() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let p = person_anlegen(&app, &admin, e, r#"{}"#).await;
    let (s, _) = anfrage(
        &app, "POST", &format!("/api/einsaetze/{e}/personen/{p}/verbleib"), &admin,
        Some(r#"{"art":"transport","transportmittel":"RTW 1","ziel":"KH Mitte","status":"abtransportiert"}"#),
    ).await;
    assert_eq!(s, StatusCode::CREATED);
    let (_, detail) = anfrage(
        &app,
        "GET",
        &format!("/api/einsaetze/{e}/personen/{p}"),
        &admin,
        None,
    )
    .await;
    assert_eq!(detail["aktueller_verbleib"], "Transport → KH Mitte");
    assert_eq!(detail["verbleib"].as_array().unwrap().len(), 1);
    let inhalte = system_etb_inhalte(&app, &admin, e).await;
    assert!(inhalte
        .iter()
        .any(|i| i.contains("R-001") && i.contains("abtransportiert → KH Mitte")));
}

#[tokio::test]
async fn verbleib_ungueltige_art_ist_400_und_ungueltiger_status_auch() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let p = person_anlegen(&app, &admin, e, r#"{}"#).await;
    let (s, _) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{e}/personen/{p}/verbleib"),
        &admin,
        Some(r#"{"art":"teleportation"}"#),
    )
    .await;
    assert_eq!(s, StatusCode::BAD_REQUEST);
    let (s, _) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{e}/personen/{p}/verbleib"),
        &admin,
        Some(r#"{"art":"transport","status":"unterwegs"}"#),
    )
    .await;
    assert_eq!(s, StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn sichtung_ist_append_only_cache_und_etb() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let p = person_anlegen(&app, &admin, e, r#"{"name":"Geheim","vorname":"Sehr"}"#).await;
    // erfasst → Sichtung sk2: hebt Status auf betroffen + Cache + ETB
    let (s, _) = sichten(&app, &admin, e, p, r#"{"kategorie":"sk2"}"#).await;
    assert_eq!(s, StatusCode::CREATED);
    let (s, _) = sichten(
        &app,
        &admin,
        e,
        p,
        r#"{"kategorie":"sk1","notiz":"verschlechtert"}"#,
    )
    .await;
    assert_eq!(s, StatusCode::CREATED);
    // Detail: zwei Sichtungen, neuester Cache + Person ist betroffen
    let (_, detail) = anfrage(
        &app,
        "GET",
        &format!("/api/einsaetze/{e}/personen/{p}"),
        &admin,
        None,
    )
    .await;
    assert_eq!(
        detail["status"], "betroffen",
        "Sichtung hebt erfasst → betroffen"
    );
    assert_eq!(detail["aktuelle_sichtung"], "sk1");
    assert_eq!(detail["sichtungen"].as_array().unwrap().len(), 2);
    // ETB: zwei Sichtungs-Einträge, kein Identitäts-Leak
    let inhalte = system_etb_inhalte(&app, &admin, e).await;
    let sichtung_etb: Vec<_> = inhalte.iter().filter(|i| i.contains("Sichtung")).collect();
    assert_eq!(sichtung_etb.len(), 2);
    assert!(sichtung_etb.iter().all(|i| i.contains("R-001")));
    assert!(sichtung_etb.iter().any(|i| i.contains("SK II")));
    assert!(sichtung_etb.iter().any(|i| i.contains("SK I")));
    assert!(sichtung_etb
        .iter()
        .all(|i| !i.contains("Geheim") && !i.contains("Sehr") && !i.contains("verschlechtert")));
}

#[tokio::test]
async fn sichtung_tot_aendert_admin_status_nicht() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let p = person_anlegen(&app, &admin, e, r#"{}"#).await;
    // Vorab betroffen setzen (kein erfasst-Anheben verfälscht den Test)
    anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{e}/personen/{p}/status"),
        &admin,
        Some(r#"{"status":"betroffen"}"#),
    )
    .await;
    let (s, _) = sichten(&app, &admin, e, p, r#"{"kategorie":"tot"}"#).await;
    assert_eq!(s, StatusCode::CREATED);
    let (_, detail) = anfrage(
        &app,
        "GET",
        &format!("/api/einsaetze/{e}/personen/{p}"),
        &admin,
        None,
    )
    .await;
    assert_eq!(
        detail["status"], "betroffen",
        "Sichtung tot ändert Admin-Status NICHT"
    );
    assert_eq!(detail["aktuelle_sichtung"], "tot");
}

#[tokio::test]
async fn sichtung_bei_vermisst_ist_422_und_unbekannte_kategorie_ist_400() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let p = person_anlegen(&app, &admin, e, r#"{}"#).await;
    anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{e}/personen/{p}/status"),
        &admin,
        Some(r#"{"status":"vermisst"}"#),
    )
    .await;
    let (s, _) = sichten(&app, &admin, e, p, r#"{"kategorie":"sk2"}"#).await;
    assert_eq!(
        s,
        StatusCode::UNPROCESSABLE_ENTITY,
        "vermisste Person ist nicht anwesend"
    );
    let p2 = person_anlegen(&app, &admin, e, r#"{}"#).await;
    let (s, _) = sichten(&app, &admin, e, p2, r#"{"kategorie":"sk7"}"#).await;
    assert_eq!(s, StatusCode::BAD_REQUEST, "unbekannte Kategorie");
}

#[tokio::test]
async fn notiz_erscheint_im_detail_und_erzeugt_keinen_etb() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let p = person_anlegen(&app, &admin, e, r#"{}"#).await;
    let vorher_etb = system_etb_inhalte(&app, &admin, e).await.len();
    let (s, _) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{e}/personen/{p}/notizen"),
        &admin,
        Some(r#"{"text":"Platzwunde Stirn, stabil"}"#),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED);
    let (_, detail) = anfrage(
        &app,
        "GET",
        &format!("/api/einsaetze/{e}/personen/{p}"),
        &admin,
        None,
    )
    .await;
    let notizen = detail["notizen"].as_array().unwrap();
    assert_eq!(notizen.len(), 1);
    assert_eq!(notizen[0]["text"], "Platzwunde Stirn, stabil");
    // KEIN ETB-Eintrag (besondere Kategorie):
    assert_eq!(
        system_etb_inhalte(&app, &admin, e).await.len(),
        vorher_etb,
        "Befundnotiz darf KEINEN ETB-Eintrag erzeugen"
    );
}

#[tokio::test]
async fn notiz_mit_leerem_text_ist_400() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let p = person_anlegen(&app, &admin, e, r#"{}"#).await;
    let (s, _) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{e}/personen/{p}/notizen"),
        &admin,
        Some(r#"{"text":"  "}"#),
    )
    .await;
    assert_eq!(s, StatusCode::BAD_REQUEST);
}

async fn status_setzen(app: &axum::Router, cookie: &str, einsatz: i64, person: i64, status: &str) {
    let body = format!(r#"{{"status":"{status}"}}"#);
    let (s, _) = anfrage(
        app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/personen/{person}/status"),
        cookie,
        Some(&body),
    )
    .await;
    assert_eq!(s, StatusCode::OK);
}

async fn abgleich_anlegen_helper(
    app: &axum::Router,
    cookie: &str,
    einsatz: i64,
    vermisst: i64,
    gefunden: i64,
) -> i64 {
    let body = format!(r#"{{"gefunden_person_id":{gefunden}}}"#);
    let (s, j) = anfrage(
        app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/personen/{vermisst}/abgleich"),
        cookie,
        Some(&body),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED);
    j["id"].as_i64().unwrap()
}

#[tokio::test]
async fn abgleich_anlegen_verdacht_erlaubt_und_in_beiden_details_sichtbar() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let v = person_anlegen(&app, &admin, e, r#"{}"#).await;
    status_setzen(&app, &admin, e, v, "vermisst").await;
    let g = person_anlegen(&app, &admin, e, r#"{}"#).await;
    status_setzen(&app, &admin, e, g, "betroffen").await;
    let (s, j) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{e}/personen/{v}/abgleich"),
        &admin,
        Some(&format!(r#"{{"gefunden_person_id":{g}}}"#)),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED);
    assert_eq!(j["status"], "verdacht");
    // Sichtbar in beiden Detail-Antworten:
    let (_, dv) = anfrage(
        &app,
        "GET",
        &format!("/api/einsaetze/{e}/personen/{v}"),
        &admin,
        None,
    )
    .await;
    assert_eq!(dv["abgleiche"].as_array().unwrap().len(), 1);
    let (_, dg) = anfrage(
        &app,
        "GET",
        &format!("/api/einsaetze/{e}/personen/{g}"),
        &admin,
        None,
    )
    .await;
    assert_eq!(dg["abgleiche"].as_array().unwrap().len(), 1);
}

#[tokio::test]
async fn abgleich_falsche_status_kombination_ist_422() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let v = person_anlegen(&app, &admin, e, r#"{}"#).await; // erfasst, NICHT vermisst
    let g = person_anlegen(&app, &admin, e, r#"{}"#).await;
    status_setzen(&app, &admin, e, g, "betroffen").await;
    // pid-Person ist nicht vermisst → 422
    let (s, _) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{e}/personen/{v}/abgleich"),
        &admin,
        Some(&format!(r#"{{"gefunden_person_id":{g}}}"#)),
    )
    .await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY);
    // Jetzt vermisst, aber gefunden ist erfasst → 422
    status_setzen(&app, &admin, e, v, "vermisst").await;
    let g2 = person_anlegen(&app, &admin, e, r#"{}"#).await; // erfasst
    let (s, _) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{e}/personen/{v}/abgleich"),
        &admin,
        Some(&format!(r#"{{"gefunden_person_id":{g2}}}"#)),
    )
    .await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY);
}

#[tokio::test]
async fn export_schreibt_export_audit() {
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    person_anlegen(&app, &admin, e, r#"{"name":"Test"}"#).await;
    // Export liefert CSV (text/csv), kein JSON — daher roher Request:
    let resp = app
        .clone()
        .oneshot(
            Request::builder()
                .method("GET")
                .uri(format!("/api/einsaetze/{e}/personen/export"))
                .header(header::COOKIE, admin.clone())
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let ct = resp
        .headers()
        .get(header::CONTENT_TYPE)
        .unwrap()
        .to_str()
        .unwrap()
        .to_string();
    assert!(
        ct.starts_with("text/csv"),
        "Content-Type ist CSV, war: {ct}"
    );
    // Verifiziere: genau eine export-Audit-Zeile mit person_id IS NULL.
    let count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM person_zugriff_audit WHERE einsatz_id = ? AND art = 'export' AND person_id IS NULL")
        .bind(e).fetch_one(&pool).await.unwrap();
    assert_eq!(
        count, 1,
        "Export muss genau einen export-Audit-Eintrag schreiben"
    );
}

#[tokio::test]
async fn entscheidung_bestaetigt_meldet_ab_und_schreibt_etb() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let v = person_anlegen(&app, &admin, e, r#"{}"#).await;
    status_setzen(&app, &admin, e, v, "vermisst").await;
    let g = person_anlegen(&app, &admin, e, r#"{}"#).await;
    status_setzen(&app, &admin, e, g, "betroffen").await;
    let aid = abgleich_anlegen_helper(&app, &admin, e, v, g).await;
    let (s, j) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{e}/personen/{v}/abgleich/{aid}/entscheidung"),
        &admin,
        Some(r#"{"entscheidung":"bestaetigt"}"#),
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(j["status"], "bestaetigt");
    // Vermisstmeldung ist abgemeldet:
    let (_, dv) = anfrage(
        &app,
        "GET",
        &format!("/api/einsaetze/{e}/personen/{v}"),
        &admin,
        None,
    )
    .await;
    assert_eq!(dv["status"], "abgemeldet");
    // ETB „Vermisstmeldung R-001 aufgeklärt — identisch mit R-002"
    let inhalte = system_etb_inhalte(&app, &admin, e).await;
    assert!(
        inhalte.iter().any(|i| i.contains("Vermisstmeldung R-001")
            && i.contains("aufgeklärt")
            && i.contains("R-002")),
        "ETB-Bestätigung fehlt oder unvollständig: {inhalte:?}"
    );
}

#[tokio::test]
async fn zweiter_bestaetigter_je_vermisstmeldung_ist_409() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let v = person_anlegen(&app, &admin, e, r#"{}"#).await;
    status_setzen(&app, &admin, e, v, "vermisst").await;
    let g1 = person_anlegen(&app, &admin, e, r#"{}"#).await;
    status_setzen(&app, &admin, e, g1, "betroffen").await;
    let g2 = person_anlegen(&app, &admin, e, r#"{}"#).await;
    status_setzen(&app, &admin, e, g2, "betroffen").await;
    let a1 = abgleich_anlegen_helper(&app, &admin, e, v, g1).await;
    let a2 = abgleich_anlegen_helper(&app, &admin, e, v, g2).await;
    anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{e}/personen/{v}/abgleich/{a1}/entscheidung"),
        &admin,
        Some(r#"{"entscheidung":"bestaetigt"}"#),
    )
    .await;
    let (s, _) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{e}/personen/{v}/abgleich/{a2}/entscheidung"),
        &admin,
        Some(r#"{"entscheidung":"bestaetigt"}"#),
    )
    .await;
    // Achtung: nach dem ersten bestaetigt ist v=abgemeldet → der Status-Check des zweiten Aufrufs greift, BEVOR der Unique-Index feuert. Spec verlangt 409 für den Doppel-bestaetigt; der Unique-Index ist die Garantie, der Status-Check ist freundlicher: beides ist akzeptabel und konsistent.
    assert_eq!(s, StatusCode::CONFLICT);
}

#[tokio::test]
async fn entscheidung_nur_einsatzleitung_und_pid_invariante() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let fueh_id = benutzer_anlegen(&app, &admin, "fuehr2", "keine").await;
    let e = einsatz_anlegen(&app, &admin).await;
    rolle_setzen(&app, &admin, e, fueh_id, "fuehrungspersonal").await;
    let v = person_anlegen(&app, &admin, e, r#"{}"#).await;
    status_setzen(&app, &admin, e, v, "vermisst").await;
    let g = person_anlegen(&app, &admin, e, r#"{}"#).await;
    status_setzen(&app, &admin, e, g, "betroffen").await;
    let aid = abgleich_anlegen_helper(&app, &admin, e, v, g).await;
    // Führungspersonal (Schreibrecht, aber keine Leitung) → 403
    let fueh = login_cookie(&app, "fuehr2", "fuehr2pw1").await;
    let (s, _) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{e}/personen/{v}/abgleich/{aid}/entscheidung"),
        &fueh,
        Some(r#"{"entscheidung":"verworfen"}"#),
    )
    .await;
    assert_eq!(s, StatusCode::FORBIDDEN);
    // pid-Invariante: Aufruf mit falscher pid → 404 (Abgleich gehört dort nicht hin)
    let (s, _) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{e}/personen/{g}/abgleich/{aid}/entscheidung"),
        &admin,
        Some(r#"{"entscheidung":"verworfen"}"#),
    )
    .await;
    assert_eq!(s, StatusCode::NOT_FOUND);
    // Verworfen lässt den Status unverändert:
    let (s, _) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{e}/personen/{v}/abgleich/{aid}/entscheidung"),
        &admin,
        Some(r#"{"entscheidung":"verworfen"}"#),
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    let (_, dv) = anfrage(
        &app,
        "GET",
        &format!("/api/einsaetze/{e}/personen/{v}"),
        &admin,
        None,
    )
    .await;
    assert_eq!(
        dv["status"], "vermisst",
        "verworfen ändert den Status nicht"
    );
}
