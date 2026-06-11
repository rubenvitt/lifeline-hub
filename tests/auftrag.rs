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
