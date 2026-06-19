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

fn body_mit_funktion(text: &str, empf: &str) -> String {
    serde_json::json!({
        "auftrag_text": text,
        "empfaenger": [{ "empfaenger_typ": "funktion", "funktion_text": empf }]
    })
    .to_string()
}

#[tokio::test]
async fn anlegen_erzeugt_auftrag_und_etb_anordnung() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;

    let (status, json) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{e}/auftraege"),
        &admin,
        Some(&body_mit_funktion("Deich sichern", "Abschnitt Nord")),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    assert_eq!(json["auftrag_text"], "Deich sichern");
    assert!(json["etb_anordnung_id"].is_i64(), "ETB-Anordnung wird erzeugt");
    assert_eq!(json["empfaenger"][0]["snap_anzeige"], "Abschnitt Nord");

    let (_, etb) = anfrage(&app, "GET", &format!("/api/einsaetze/{e}/etb"), &admin, None).await;
    assert!(etb.as_array().unwrap().iter().any(|x| x["typ"] == "anordnung"));
}

#[tokio::test]
async fn anlegen_ohne_empfaenger_ist_400() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let body = r#"{"auftrag_text":"X","empfaenger":[]}"#;
    let (status, _) = anfrage(&app, "POST", &format!("/api/einsaetze/{e}/auftraege"), &admin, Some(body)).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn anlegen_ohne_text_ist_400() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let (status, _) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{e}/auftraege"),
        &admin,
        Some(&body_mit_funktion("   ", "EA1")),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn liste_zeigt_angelegte_auftraege() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    anfrage(&app, "POST", &format!("/api/einsaetze/{e}/auftraege"), &admin, Some(&body_mit_funktion("A", "EA1"))).await;
    let (status, json) = anfrage(&app, "GET", &format!("/api/einsaetze/{e}/auftraege"), &admin, None).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(json.as_array().unwrap().len(), 1);
}

#[tokio::test]
async fn fremder_empfaenger_abschnitt_ist_400() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let body = serde_json::json!({
        "auftrag_text": "X",
        "empfaenger": [{ "empfaenger_typ": "abschnitt", "abschnitt_id": 9999 }]
    })
    .to_string();
    let (status, _) = anfrage(&app, "POST", &format!("/api/einsaetze/{e}/auftraege"), &admin, Some(&body)).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn quittieren_aendert_quittung_nicht_vollzug() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let (_, a) = anfrage(&app, "POST", &format!("/api/einsaetze/{e}/auftraege"), &admin, Some(&body_mit_funktion("X", "EA1"))).await;
    let aid = a["id"].as_i64().unwrap();
    let empf = a["empfaenger"][0]["id"].as_i64().unwrap();

    let (status, json) = anfrage(&app, "POST", &format!("/api/einsaetze/{e}/auftraege/{aid}/empfaenger/{empf}/quittieren"), &admin, None).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(json["quittiert_anzahl"], 1);
    assert_eq!(json["vollzug_status"], "offen");
    assert_eq!(json["bearbeitungsstatus"], "offen");
}

#[tokio::test]
async fn vollzug_melden_erzeugt_etb_meldung_und_setzt_status() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let (_, a) = anfrage(&app, "POST", &format!("/api/einsaetze/{e}/auftraege"), &admin, Some(&body_mit_funktion("X", "EA1"))).await;
    let aid = a["id"].as_i64().unwrap();

    let body = r#"{"status":"vollzogen","vollzugsmeldung":"Deich gehalten"}"#;
    let (status, json) = anfrage(&app, "POST", &format!("/api/einsaetze/{e}/auftraege/{aid}/vollzug"), &admin, Some(body)).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(json["bearbeitungsstatus"], "vollzogen");
    assert_eq!(json["vollzugsmeldung"], "Deich gehalten");

    let (_, etb) = anfrage(&app, "GET", &format!("/api/einsaetze/{e}/etb"), &admin, None).await;
    let typen: Vec<&str> = etb.as_array().unwrap().iter().filter_map(|x| x["typ"].as_str()).collect();
    assert!(typen.contains(&"anordnung"));
    assert!(typen.contains(&"meldung"));
}

#[tokio::test]
async fn abnehmen_vor_vollzug_ist_422() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let (_, a) = anfrage(&app, "POST", &format!("/api/einsaetze/{e}/auftraege"), &admin, Some(&body_mit_funktion("X", "EA1"))).await;
    let aid = a["id"].as_i64().unwrap();
    let (status, _) = anfrage(&app, "POST", &format!("/api/einsaetze/{e}/auftraege/{aid}/abnehmen"), &admin, None).await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
}

#[tokio::test]
async fn beobachter_liest_aber_schreibt_nicht() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    // Vom Admin angelegter Auftrag (echte ids für Empfänger-/Quittier-/Abnahme-Routen).
    let (_, a) = anfrage(&app, "POST", &format!("/api/einsaetze/{e}/auftraege"), &admin, Some(&body_mit_funktion("X", "EA1"))).await;
    let aid = a["id"].as_i64().unwrap();
    let empf = a["empfaenger"][0]["id"].as_i64().unwrap();

    // Zweiter Benutzer mit Einsatz-Rolle 'beobachter'.
    let erika = benutzer_anlegen(&app, &admin, "erika", "keine").await;
    rolle_setzen(&app, &admin, e, erika, "beobachter").await;
    let erika_c = login_cookie(&app, "erika", "erikapw1").await;

    // GET listen ist erlaubt (Lesezugriff).
    let (status, _) = anfrage(&app, "GET", &format!("/api/einsaetze/{e}/auftraege"), &erika_c, None).await;
    assert_eq!(status, StatusCode::OK);

    // POST anlegen → 403 (gültiger Body, damit der Schreibrecht-Guard greift, nicht der Json-Extractor).
    let (status, _) = anfrage(&app, "POST", &format!("/api/einsaetze/{e}/auftraege"), &erika_c, Some(&body_mit_funktion("Y", "EA2"))).await;
    assert_eq!(status, StatusCode::FORBIDDEN);

    // POST quittieren → 403.
    let (status, _) = anfrage(&app, "POST", &format!("/api/einsaetze/{e}/auftraege/{aid}/empfaenger/{empf}/quittieren"), &erika_c, None).await;
    assert_eq!(status, StatusCode::FORBIDDEN);

    // POST vollzug → 403 (gültiger Body 'in_arbeit', damit der Guard greift).
    let (status, _) = anfrage(&app, "POST", &format!("/api/einsaetze/{e}/auftraege/{aid}/vollzug"), &erika_c, Some(r#"{"status":"in_arbeit"}"#)).await;
    assert_eq!(status, StatusCode::FORBIDDEN);

    // POST abnehmen → 403.
    let (status, _) = anfrage(&app, "POST", &format!("/api/einsaetze/{e}/auftraege/{aid}/abnehmen"), &erika_c, None).await;
    assert_eq!(status, StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn cross_einsatz_abnehmen_ist_404() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let a_einsatz = einsatz_anlegen(&app, &admin).await;
    let b_einsatz = einsatz_anlegen(&app, &admin).await;
    let (_, a) = anfrage(&app, "POST", &format!("/api/einsaetze/{a_einsatz}/auftraege"), &admin, Some(&body_mit_funktion("X", "EA1"))).await;
    let aid_a = a["id"].as_i64().unwrap();
    // Auftrag aus A unter Einsatz B abnehmen → 404 (Cross-Einsatz-Schutz).
    let (status, _) = anfrage(&app, "POST", &format!("/api/einsaetze/{b_einsatz}/auftraege/{aid_a}/abnehmen"), &admin, None).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn status_filter_trennt_offen_und_vollzogen() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let (_, a1) = anfrage(&app, "POST", &format!("/api/einsaetze/{e}/auftraege"), &admin, Some(&body_mit_funktion("A", "EA1"))).await;
    let aid1 = a1["id"].as_i64().unwrap();
    anfrage(&app, "POST", &format!("/api/einsaetze/{e}/auftraege"), &admin, Some(&body_mit_funktion("B", "EA2"))).await;

    // A auf vollzogen setzen.
    let (status, _) = anfrage(&app, "POST", &format!("/api/einsaetze/{e}/auftraege/{aid1}/vollzug"), &admin, Some(r#"{"status":"vollzogen","vollzugsmeldung":"x"}"#)).await;
    assert_eq!(status, StatusCode::OK);

    let (status, json) = anfrage(&app, "GET", &format!("/api/einsaetze/{e}/auftraege?status=vollzogen"), &admin, None).await;
    assert_eq!(status, StatusCode::OK);
    let vollzogen = json.as_array().unwrap();
    assert_eq!(vollzogen.len(), 1);
    assert_eq!(vollzogen[0]["auftrag_text"], "A");

    let (status, json) = anfrage(&app, "GET", &format!("/api/einsaetze/{e}/auftraege?status=offen"), &admin, None).await;
    assert_eq!(status, StatusCode::OK);
    let offen = json.as_array().unwrap();
    assert_eq!(offen.len(), 1);
    assert_eq!(offen[0]["auftrag_text"], "B");
}

#[tokio::test]
async fn vollzug_in_arbeit_setzt_status() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let (_, a) = anfrage(&app, "POST", &format!("/api/einsaetze/{e}/auftraege"), &admin, Some(&body_mit_funktion("X", "EA1"))).await;
    let aid = a["id"].as_i64().unwrap();
    let (status, json) = anfrage(&app, "POST", &format!("/api/einsaetze/{e}/auftraege/{aid}/vollzug"), &admin, Some(r#"{"status":"in_arbeit"}"#)).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(json["bearbeitungsstatus"], "in_arbeit");
}

#[tokio::test]
async fn vollzogen_ohne_meldung_ist_400() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let (_, a) = anfrage(&app, "POST", &format!("/api/einsaetze/{e}/auftraege"), &admin, Some(&body_mit_funktion("X", "EA1"))).await;
    let aid = a["id"].as_i64().unwrap();
    let (status, _) = anfrage(&app, "POST", &format!("/api/einsaetze/{e}/auftraege/{aid}/vollzug"), &admin, Some(r#"{"status":"vollzogen"}"#)).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn ungueltiger_vollzug_status_ist_400() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let (_, a) = anfrage(&app, "POST", &format!("/api/einsaetze/{e}/auftraege"), &admin, Some(&body_mit_funktion("X", "EA1"))).await;
    let aid = a["id"].as_i64().unwrap();
    let (status, _) = anfrage(&app, "POST", &format!("/api/einsaetze/{e}/auftraege/{aid}/vollzug"), &admin, Some(r#"{"status":"quatsch","vollzugsmeldung":"x"}"#)).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn abnehmen_nach_vollzug_ist_erfolgreich() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let (_, a) = anfrage(&app, "POST", &format!("/api/einsaetze/{e}/auftraege"), &admin, Some(&body_mit_funktion("X", "EA1"))).await;
    let aid = a["id"].as_i64().unwrap();
    let (status, _) = anfrage(&app, "POST", &format!("/api/einsaetze/{e}/auftraege/{aid}/vollzug"), &admin, Some(r#"{"status":"vollzogen","vollzugsmeldung":"fertig"}"#)).await;
    assert_eq!(status, StatusCode::OK);
    let (status, json) = anfrage(&app, "POST", &format!("/api/einsaetze/{e}/auftraege/{aid}/abnehmen"), &admin, None).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(json["bearbeitungsstatus"], "abgenommen");
}

// --- LFH-87: externer Adressat + Richtungs-Filter ---

#[tokio::test]
async fn anlegen_mit_externem_adressat_und_richtung_extern() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let body = serde_json::json!({
        "auftrag_text": "Lagemeldung an Leitstelle",
        "richtung": "extern",
        "empfaenger": [{ "empfaenger_typ": "extern", "extern_kategorie": "leitstelle", "extern_bezeichnung": "Leitstelle Nord" }]
    }).to_string();
    let (status, json) = anfrage(&app, "POST", &format!("/api/einsaetze/{e}/auftraege"), &admin, Some(&body)).await;
    assert_eq!(status, StatusCode::CREATED, "{json:?}");
    assert_eq!(json["richtung"], "extern");
    assert_eq!(json["empfaenger"][0]["empfaenger_typ"], "extern");
    assert_eq!(json["empfaenger"][0]["extern_kategorie"], "leitstelle");
    assert_eq!(json["empfaenger"][0]["snap_anzeige"], "Leitstelle Nord");
}

#[tokio::test]
async fn extern_ohne_bezeichnung_ist_400() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let body = serde_json::json!({
        "auftrag_text": "X",
        "empfaenger": [{ "empfaenger_typ": "extern", "extern_kategorie": "leitstelle" }]
    }).to_string();
    let (status, _) = anfrage(&app, "POST", &format!("/api/einsaetze/{e}/auftraege"), &admin, Some(&body)).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn extern_ungueltige_kategorie_ist_400() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let body = serde_json::json!({
        "auftrag_text": "X",
        "empfaenger": [{ "empfaenger_typ": "extern", "extern_kategorie": "irgendwer", "extern_bezeichnung": "Y" }]
    }).to_string();
    let (status, _) = anfrage(&app, "POST", &format!("/api/einsaetze/{e}/auftraege"), &admin, Some(&body)).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn extern_plus_zweites_ziel_ist_400() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let body = serde_json::json!({
        "auftrag_text": "X",
        "empfaenger": [{ "empfaenger_typ": "extern", "extern_kategorie": "leitstelle", "extern_bezeichnung": "Y", "funktion_text": "S3" }]
    }).to_string();
    let (status, _) = anfrage(&app, "POST", &format!("/api/einsaetze/{e}/auftraege"), &admin, Some(&body)).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn richtung_filter_trennt_intern_extern() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    anfrage(&app, "POST", &format!("/api/einsaetze/{e}/auftraege"), &admin, Some(&body_mit_funktion("intern-auftrag", "EA"))).await;
    let extern_body = serde_json::json!({
        "auftrag_text": "extern-auftrag", "richtung": "extern",
        "empfaenger": [{ "empfaenger_typ": "extern", "extern_kategorie": "leitstelle", "extern_bezeichnung": "LtS" }]
    }).to_string();
    anfrage(&app, "POST", &format!("/api/einsaetze/{e}/auftraege"), &admin, Some(&extern_body)).await;

    let (status, json) = anfrage(&app, "GET", &format!("/api/einsaetze/{e}/auftraege?richtung=extern"), &admin, None).await;
    assert_eq!(status, StatusCode::OK);
    let liste = json.as_array().unwrap();
    assert_eq!(liste.len(), 1);
    assert_eq!(liste[0]["auftrag_text"], "extern-auftrag");

    let (status, _) = anfrage(&app, "GET", &format!("/api/einsaetze/{e}/auftraege?richtung=quatsch"), &admin, None).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
}

// --- Default-Quittierfrist aus Einstellungen (LFH-133) ---

#[tokio::test]
async fn auftrag_default_quittierfrist_aus_einstellungen() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    // Default-Quittierfrist 60 Min konfigurieren.
    let (s, _) = anfrage(
        &app, "PUT", &format!("/api/einsaetze/{e}/einstellungen"), &admin,
        Some(r#"{"auftrag_quittierung_frist_min":60}"#),
    ).await;
    assert_eq!(s, StatusCode::OK);
    // Auftrag mit explizitem erteilt_at, OHNE frist_at → Frist = Erteilzeit + 60 Min.
    let body = serde_json::json!({
        "auftrag_text": "X", "erteilt_at": "2026-06-19 09:00:00",
        "empfaenger": [{ "empfaenger_typ": "funktion", "funktion_text": "EA" }]
    }).to_string();
    let (status, a) = anfrage(&app, "POST", &format!("/api/einsaetze/{e}/auftraege"), &admin, Some(&body)).await;
    assert_eq!(status, StatusCode::CREATED, "{a:?}");
    assert_eq!(a["frist_at"], "2026-06-19 10:00:00");
}

#[tokio::test]
async fn auftrag_ohne_setting_keine_frist() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    // Ohne Setting + ohne frist_at → keine Frist (heutiges Verhalten).
    let (status, a) = anfrage(&app, "POST", &format!("/api/einsaetze/{e}/auftraege"), &admin, Some(&body_mit_funktion("X", "EA"))).await;
    assert_eq!(status, StatusCode::CREATED);
    assert!(a["frist_at"].is_null());
}

#[tokio::test]
async fn auftrag_explizite_frist_schlaegt_default() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let (s, _) = anfrage(
        &app, "PUT", &format!("/api/einsaetze/{e}/einstellungen"), &admin,
        Some(r#"{"auftrag_quittierung_frist_min":60}"#),
    ).await;
    assert_eq!(s, StatusCode::OK);
    // Expliziter frist_at schlägt den Default.
    let body = serde_json::json!({
        "auftrag_text": "X", "erteilt_at": "2026-06-19 09:00:00", "frist_at": "2026-06-19 09:15:00",
        "empfaenger": [{ "empfaenger_typ": "funktion", "funktion_text": "EA" }]
    }).to_string();
    let (status, a) = anfrage(&app, "POST", &format!("/api/einsaetze/{e}/auftraege"), &admin, Some(&body)).await;
    assert_eq!(status, StatusCode::CREATED, "{a:?}");
    assert_eq!(a["frist_at"], "2026-06-19 09:15:00");
}
