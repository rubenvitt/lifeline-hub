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

async fn benutzer_anlegen(app: &axum::Router, admin: &str, name: &str, org_rolle: &str) -> i64 {
    let body = format!(
        r#"{{"anzeigename":"{name}","benutzername":"{name}","passwort":"{name}pw1","org_rolle":"{org_rolle}"}}"#
    );
    let (status, json) = anfrage(app, "POST", "/api/benutzer", admin, Some(&body)).await;
    assert_eq!(status, StatusCode::CREATED);
    json["id"].as_i64().unwrap()
}

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

async fn person_anlegen(app: &axum::Router, admin: &str, einsatz: i64, name: &str) -> i64 {
    // Stamm anlegen + in den Einsatz disponieren → liefert die einsatz_personal.id.
    let (s1, stamm) = anfrage(
        app,
        "POST",
        "/api/personal",
        admin,
        Some(&format!(r#"{{"name":"{name}"}}"#)),
    )
    .await;
    assert_eq!(s1, StatusCode::CREATED);
    let pid = stamm["id"].as_i64().unwrap();
    let (s2, dispo) = anfrage(
        app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/personal"),
        admin,
        Some(&format!(r#"{{"personal_id":{pid}}}"#)),
    )
    .await;
    assert_eq!(s2, StatusCode::CREATED);
    dispo["id"].as_i64().unwrap()
}

async fn system_etb_anzahl(app: &axum::Router, cookie: &str, einsatz: i64) -> usize {
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
        .count()
}

async fn einheit_bilden(app: &axum::Router, cookie: &str, einsatz: i64, name: &str) -> i64 {
    let (s, json) = anfrage(
        app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/einheiten"),
        cookie,
        Some(&format!(r#"{{"name":"{name}"}}"#)),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED);
    json["id"].as_i64().unwrap()
}

#[tokio::test]
async fn bilden_schreibt_etb_und_liefert_nullstaerke() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let (s, json) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/einheiten"),
        &admin,
        Some(r#"{"name":"1. Zug"}"#),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED);
    assert_eq!(json["name"], "1. Zug");
    assert_eq!(json["ist"]["mannschaft"], 0);
    assert!(json["soll"].is_null());
    assert_eq!(system_etb_anzahl(&app, &admin, einsatz).await, 1);
}

#[tokio::test]
async fn mitglied_zuordnen_wechseln_freigeben_mit_etb() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let a = einheit_bilden(&app, &admin, einsatz, "A").await;
    let b = einheit_bilden(&app, &admin, einsatz, "B").await;
    let ep = person_anlegen(&app, &admin, einsatz, "Anna").await; // disponiert ins Personal

    assert_eq!(
        anfrage(
            &app,
            "PUT",
            &format!("/api/einsaetze/{einsatz}/einheiten/{a}/personal/{ep}"),
            &admin,
            None
        )
        .await
        .0,
        StatusCode::NO_CONTENT
    );
    // In A sichtbar.
    let (_, liste) = anfrage(
        &app,
        "GET",
        &format!("/api/einsaetze/{einsatz}/einheiten"),
        &admin,
        None,
    )
    .await;
    let einheit_a = liste
        .as_array()
        .unwrap()
        .iter()
        .find(|e| e["id"] == a)
        .unwrap();
    assert_eq!(
        einheit_a["personal_mitglieder"].as_array().unwrap().len(),
        1
    );

    // Wechsel zu B → A verliert sie.
    anfrage(
        &app,
        "PUT",
        &format!("/api/einsaetze/{einsatz}/einheiten/{b}/personal/{ep}"),
        &admin,
        None,
    )
    .await;
    let (_, liste2) = anfrage(
        &app,
        "GET",
        &format!("/api/einsaetze/{einsatz}/einheiten"),
        &admin,
        None,
    )
    .await;
    let einheit_a2 = liste2
        .as_array()
        .unwrap()
        .iter()
        .find(|e| e["id"] == a)
        .unwrap();
    assert!(einheit_a2["personal_mitglieder"]
        .as_array()
        .unwrap()
        .is_empty());

    // Freigeben.
    assert_eq!(
        anfrage(
            &app,
            "DELETE",
            &format!("/api/einsaetze/{einsatz}/einheiten/{b}/personal/{ep}"),
            &admin,
            None
        )
        .await
        .0,
        StatusCode::NO_CONTENT
    );
}

#[tokio::test]
async fn freier_pool_zeigt_einheit_id_null() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let a = einheit_bilden(&app, &admin, einsatz, "A").await;
    let ep = person_anlegen(&app, &admin, einsatz, "Anna").await;
    // Vor Zuordnung: einheit_id null im Personal.
    let (_, personal) = anfrage(
        &app,
        "GET",
        &format!("/api/einsaetze/{einsatz}/personal"),
        &admin,
        None,
    )
    .await;
    assert!(personal
        .as_array()
        .unwrap()
        .iter()
        .find(|p| p["id"] == ep)
        .unwrap()["einheit_id"]
        .is_null());
    // Nach Zuordnung: einheit_id gesetzt.
    anfrage(
        &app,
        "PUT",
        &format!("/api/einsaetze/{einsatz}/einheiten/{a}/personal/{ep}"),
        &admin,
        None,
    )
    .await;
    let (_, personal2) = anfrage(
        &app,
        "GET",
        &format!("/api/einsaetze/{einsatz}/personal"),
        &admin,
        None,
    )
    .await;
    assert_eq!(
        personal2
            .as_array()
            .unwrap()
            .iter()
            .find(|p| p["id"] == ep)
            .unwrap()["einheit_id"],
        a
    );
}

#[tokio::test]
async fn fuehrer_nur_mitglied_dieser_einheit() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let a = einheit_bilden(&app, &admin, einsatz, "A").await;
    let ep = person_anlegen(&app, &admin, einsatz, "Chef").await;
    // Nicht-Mitglied als Führer bei gleichzeitigem Namens-Edit → 400 UND kein Teil-Update.
    let body_umbenennen = format!(r#"{{"name":"A-NEU","fuehrer_id":{ep}}}"#);
    assert_eq!(
        anfrage(
            &app,
            "PATCH",
            &format!("/api/einsaetze/{einsatz}/einheiten/{a}"),
            &admin,
            Some(&body_umbenennen)
        )
        .await
        .0,
        StatusCode::BAD_REQUEST
    );
    // Name darf NICHT geändert worden sein (Führer-Prüfung läuft vor jedem Write).
    let (_, liste) = anfrage(
        &app,
        "GET",
        &format!("/api/einsaetze/{einsatz}/einheiten"),
        &admin,
        None,
    )
    .await;
    assert_eq!(
        liste
            .as_array()
            .unwrap()
            .iter()
            .find(|e| e["id"] == a)
            .unwrap()["name"],
        "A"
    );
    // Nach Zuordnung erlaubt.
    anfrage(
        &app,
        "PUT",
        &format!("/api/einsaetze/{einsatz}/einheiten/{a}/personal/{ep}"),
        &admin,
        None,
    )
    .await;
    let (s, json) = anfrage(
        &app,
        "PATCH",
        &format!("/api/einsaetze/{einsatz}/einheiten/{a}"),
        &admin,
        Some(&body_umbenennen),
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(json["fuehrer_id"], ep);
    assert_eq!(json["name"], "A-NEU");
}

#[tokio::test]
async fn aufloesen_gibt_mitglieder_frei() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let a = einheit_bilden(&app, &admin, einsatz, "A").await;
    let ep = person_anlegen(&app, &admin, einsatz, "Anna").await;
    anfrage(
        &app,
        "PUT",
        &format!("/api/einsaetze/{einsatz}/einheiten/{a}/personal/{ep}"),
        &admin,
        None,
    )
    .await;
    assert_eq!(
        anfrage(
            &app,
            "DELETE",
            &format!("/api/einsaetze/{einsatz}/einheiten/{a}"),
            &admin,
            None
        )
        .await
        .0,
        StatusCode::NO_CONTENT
    );
    // Person wieder frei.
    let (_, personal) = anfrage(
        &app,
        "GET",
        &format!("/api/einsaetze/{einsatz}/personal"),
        &admin,
        None,
    )
    .await;
    assert!(personal
        .as_array()
        .unwrap()
        .iter()
        .find(|p| p["id"] == ep)
        .unwrap()["einheit_id"]
        .is_null());
}

#[tokio::test]
async fn beobachter_darf_nicht_bilden() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let erika = benutzer_anlegen(&app, &admin, "erika", "keine").await;
    rolle_setzen(&app, &admin, einsatz, erika, "beobachter").await;
    let erika_c = login_cookie(&app, "erika", "erikapw1").await;
    assert_eq!(
        anfrage(
            &app,
            "GET",
            &format!("/api/einsaetze/{einsatz}/einheiten"),
            &erika_c,
            None
        )
        .await
        .0,
        StatusCode::OK
    );
    assert_eq!(
        anfrage(
            &app,
            "POST",
            &format!("/api/einsaetze/{einsatz}/einheiten"),
            &erika_c,
            Some(r#"{"name":"X"}"#)
        )
        .await
        .0,
        StatusCode::FORBIDDEN
    );
}

#[tokio::test]
async fn fremder_nutzer_ohne_mitgliedschaft_kann_einheiten_nicht_lesen_oder_bilden() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    // Nutzer ohne Mitgliedschaft und ohne höhere Berechtigung anlegen.
    let _fremd = benutzer_anlegen(&app, &admin, "fremd", "keine").await;
    let fremd_c = login_cookie(&app, "fremd", "fremdpw1").await;
    // Kein Mitglied, keine höhere Berechtigung → Forbidden bzw. NotFound.
    let status_get = anfrage(
        &app,
        "GET",
        &format!("/api/einsaetze/{einsatz}/einheiten"),
        &fremd_c,
        None,
    )
    .await
    .0;
    assert!(matches!(
        status_get,
        StatusCode::FORBIDDEN | StatusCode::NOT_FOUND
    ));
    let status_post = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/einheiten"),
        &fremd_c,
        Some(r#"{"name":"X"}"#),
    )
    .await
    .0;
    assert!(matches!(
        status_post,
        StatusCode::FORBIDDEN | StatusCode::NOT_FOUND
    ));
}

#[tokio::test]
async fn bilden_auf_abgeschlossenem_einsatz_ist_409() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/abschliessen"),
        &admin,
        None,
    )
    .await;
    assert_eq!(
        anfrage(
            &app,
            "POST",
            &format!("/api/einsaetze/{einsatz}/einheiten"),
            &admin,
            Some(r#"{"name":"X"}"#)
        )
        .await
        .0,
        StatusCode::CONFLICT
    );
}
