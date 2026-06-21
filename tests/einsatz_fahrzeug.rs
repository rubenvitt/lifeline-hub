use axum::body::{to_bytes, Body};
use axum::http::{header, Request, StatusCode};
use lifeline_hub::app::{build_router, AppState};
use lifeline_hub::auth::bootstrap::bootstrap_admin;
use lifeline_hub::db;
use lifeline_hub::live::LiveHub;
use serde_json::Value;
use tower::ServiceExt;

// ---------- Harness (identisch zu tests/fahrzeug.rs) ----------

async fn setup() -> axum::Router {
    let pool = db::test_pool().await;
    bootstrap_admin(&pool, "Test-Orga", "admin", Some("startpw12"))
        .await
        .unwrap();
    build_router(AppState { pool, live: LiveHub::new(), fachebenen: lifeline_hub::karte::FachebenenState::neu() })
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

/// Legt ein Stamm-Fahrzeug an (Admin) und liefert dessen id.
async fn fahrzeug_anlegen(app: &axum::Router, admin: &str, funkrufname: &str) -> i64 {
    let (status, json) = anfrage(
        app, "POST", "/api/fahrzeuge", admin,
        Some(&format!(r#"{{"funkrufname":"{funkrufname}","kennzeichen":"XX-AB 1"}}"#)),
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
    let fz = fahrzeug_anlegen(&app, &admin, "Florian 1").await;

    let (status, json) = anfrage(
        &app, "POST", &format!("/api/einsaetze/{einsatz}/fahrzeuge"), &admin,
        Some(&format!(r#"{{"fahrzeug_id":{fz}}}"#)),
    ).await;
    assert_eq!(status, StatusCode::CREATED);
    assert_eq!(json["funkrufname"], "Florian 1");
    assert_eq!(json["status_kategorie"], "gebunden");
    assert_eq!(json["ist_adhoc"], false);

    assert_eq!(system_etb_anzahl(&app, &admin, einsatz).await, 1, "Disponieren schreibt 1 System-ETB");
}

#[tokio::test]
async fn doppelte_stamm_disposition_ist_409() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let fz = fahrzeug_anlegen(&app, &admin, "Florian 1").await;
    let body = format!(r#"{{"fahrzeug_id":{fz}}}"#);
    assert_eq!(anfrage(&app, "POST", &format!("/api/einsaetze/{einsatz}/fahrzeuge"), &admin, Some(&body)).await.0, StatusCode::CREATED);
    assert_eq!(anfrage(&app, "POST", &format!("/api/einsaetze/{einsatz}/fahrzeuge"), &admin, Some(&body)).await.0, StatusCode::CONFLICT);
}

#[tokio::test]
async fn adhoc_disposition_ohne_stamm() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;

    let (status, json) = anfrage(
        &app, "POST", &format!("/api/einsaetze/{einsatz}/fahrzeuge"), &admin,
        Some(r#"{"adhoc":{"funkrufname":"FW Extern 1","traegerorganisation":"Feuerwehr"}}"#),
    ).await;
    assert_eq!(status, StatusCode::CREATED);
    assert_eq!(json["ist_adhoc"], true);
    assert!(json["fahrzeug_id"].is_null());
}

#[tokio::test]
async fn beobachter_darf_lesen_aber_nicht_disponieren() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let erika_id = benutzer_anlegen(&app, &admin, "erika", "keine").await;
    rolle_setzen(&app, &admin, einsatz, erika_id, "beobachter").await;
    let erika = login_cookie(&app, "erika", "erikapw1").await;

    // Lesen erlaubt.
    assert_eq!(anfrage(&app, "GET", &format!("/api/einsaetze/{einsatz}/fahrzeuge"), &erika, None).await.0, StatusCode::OK);
    // Disponieren verboten.
    let fz = fahrzeug_anlegen(&app, &admin, "Florian 1").await;
    let (status, _) = anfrage(&app, "POST", &format!("/api/einsaetze/{einsatz}/fahrzeuge"), &erika, Some(&format!(r#"{{"fahrzeug_id":{fz}}}"#))).await;
    assert_eq!(status, StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn fuehrungspersonal_darf_disponieren_nicht_mitglied_nicht() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let fz = fahrzeug_anlegen(&app, &admin, "Florian 1").await;

    // Führungspersonal darf.
    let f_id = benutzer_anlegen(&app, &admin, "fritz", "keine").await;
    rolle_setzen(&app, &admin, einsatz, f_id, "fuehrungspersonal").await;
    let fritz = login_cookie(&app, "fritz", "fritzpw1").await;
    assert_eq!(
        anfrage(&app, "POST", &format!("/api/einsaetze/{einsatz}/fahrzeuge"), &fritz, Some(&format!(r#"{{"fahrzeug_id":{fz}}}"#))).await.0,
        StatusCode::CREATED
    );

    // Nicht-Mitglied (ohne höhere Berechtigung) darf weder lesen noch schreiben.
    benutzer_anlegen(&app, &admin, "norbert", "keine").await;
    let norbert = login_cookie(&app, "norbert", "norbertpw1").await;
    assert_eq!(anfrage(&app, "GET", &format!("/api/einsaetze/{einsatz}/fahrzeuge"), &norbert, None).await.0, StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn disponieren_auf_abgeschlossenem_einsatz_ist_409() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let fz = fahrzeug_anlegen(&app, &admin, "Florian 1").await;
    assert_eq!(anfrage(&app, "POST", &format!("/api/einsaetze/{einsatz}/abschliessen"), &admin, None).await.0, StatusCode::OK);

    let (status, _) = anfrage(&app, "POST", &format!("/api/einsaetze/{einsatz}/fahrzeuge"), &admin, Some(&format!(r#"{{"fahrzeug_id":{fz}}}"#))).await;
    assert_eq!(status, StatusCode::CONFLICT);
}

#[tokio::test]
async fn status_wechsel_und_entfernen_schreiben_etb() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let fz = fahrzeug_anlegen(&app, &admin, "Florian 1").await;
    let (_, json) = anfrage(&app, "POST", &format!("/api/einsaetze/{einsatz}/fahrzeuge"), &admin, Some(&format!(r#"{{"fahrzeug_id":{fz}}}"#))).await;
    let ef = json["id"].as_i64().unwrap();

    // Anderen 'gebunden'-Status aus dem Seed holen ('4 – Am Einsatzort').
    let (_, stati) = anfrage(&app, "GET", "/api/fahrzeug-status", &admin, None).await;
    let am_einsatzort = stati.as_array().unwrap().iter().find(|s| s["label"] == "4 – Am Einsatzort").unwrap()["id"].as_i64().unwrap();

    let (status, _) = anfrage(&app, "PATCH", &format!("/api/einsaetze/{einsatz}/fahrzeuge/{ef}"), &admin, Some(&format!(r#"{{"status_id":{am_einsatzort}}}"#))).await;
    assert_eq!(status, StatusCode::OK);

    let (status, _) = anfrage(&app, "DELETE", &format!("/api/einsaetze/{einsatz}/fahrzeuge/{ef}"), &admin, None).await;
    assert_eq!(status, StatusCode::NO_CONTENT);

    // Disponieren + Status-Wechsel + Entfernen = 3 System-Einträge.
    assert_eq!(system_etb_anzahl(&app, &admin, einsatz).await, 3);
}

#[tokio::test]
async fn bemerkung_setzen_und_leeren() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let fz = fahrzeug_anlegen(&app, &admin, "Florian 1").await;
    let (_, json) = anfrage(&app, "POST", &format!("/api/einsaetze/{einsatz}/fahrzeuge"), &admin, Some(&format!(r#"{{"fahrzeug_id":{fz}}}"#))).await;
    let ef = json["id"].as_i64().unwrap();

    // Setzen.
    let (_, gesetzt) = anfrage(&app, "PATCH", &format!("/api/einsaetze/{einsatz}/fahrzeuge/{ef}"), &admin, Some(r#"{"bemerkung":"Tank halb"}"#)).await;
    assert_eq!(gesetzt["bemerkung"], "Tank halb");

    // Leeren: leerer String überschreibt (Wert verschwindet).
    let (_, geleert) = anfrage(&app, "PATCH", &format!("/api/einsaetze/{einsatz}/fahrzeuge/{ef}"), &admin, Some(r#"{"bemerkung":""}"#)).await;
    assert_eq!(geleert["bemerkung"], "", "leere Bemerkung darf den alten Wert nicht behalten");

    // status_id absent → Status bleibt; eine reine Bemerkung-Änderung schreibt KEINEN ETB.
    assert_eq!(system_etb_anzahl(&app, &admin, einsatz).await, 1, "nur die Disposition selbst");
}

// LFH-4 P2: XOR-Fehlermeldung differenziert both-None vs both-Some.
#[tokio::test]
async fn disponieren_leerer_body_meldet_entweder_oder() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    // Weder fahrzeug_id noch adhoc → "angeben", NICHT "nicht beides".
    let (status, json) = anfrage(&app, "POST", &format!("/api/einsaetze/{einsatz}/fahrzeuge"), &admin, Some("{}")).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(json["error"], "Entweder fahrzeug_id (Stamm) oder adhoc angeben");
}

#[tokio::test]
async fn disponieren_beides_meldet_nicht_beides() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let fz = fahrzeug_anlegen(&app, &admin, "Florian 1").await;
    // fahrzeug_id UND adhoc → "nicht beides".
    let body = format!(r#"{{"fahrzeug_id":{fz},"adhoc":{{"funkrufname":"FW Extern"}}}}"#);
    let (status, json) = anfrage(&app, "POST", &format!("/api/einsaetze/{einsatz}/fahrzeuge"), &admin, Some(&body)).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(json["error"], "Entweder fahrzeug_id (Stamm) oder adhoc angeben, nicht beides");
}
