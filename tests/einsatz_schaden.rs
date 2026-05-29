use axum::body::{to_bytes, Body};
use axum::http::{header, Request, StatusCode};
use lifeline_hub::app::{build_router, AppState};
use lifeline_hub::auth::bootstrap::bootstrap_admin;
use lifeline_hub::db;
use lifeline_hub::live::LiveHub;
use serde_json::{json, Value};
use tower::ServiceExt;

// ---------- Harness ----------

async fn setup_mit_pool() -> (axum::Router, sqlx::SqlitePool) {
    let pool = db::test_pool().await;
    bootstrap_admin(&pool, "Test-Orga", "admin", Some("startpw12")).await.unwrap();
    let router = build_router(AppState { pool: pool.clone(), live: LiveHub::new() });
    (router, pool)
}

async fn setup() -> axum::Router {
    setup_mit_pool().await.0
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

async fn anfrage(
    app: &axum::Router,
    method: &str,
    uri: &str,
    cookie: &str,
    body: Option<&Value>,
) -> (StatusCode, Value) {
    let mut req = Request::builder().method(method).uri(uri).header(header::COOKIE, cookie);
    let body = match body {
        Some(b) => {
            req = req.header(header::CONTENT_TYPE, "application/json");
            Body::from(b.to_string())
        }
        None => Body::empty(),
    };
    let resp = app.clone().oneshot(req.body(body).unwrap()).await.unwrap();
    let status = resp.status();
    let bytes = to_bytes(resp.into_body(), 1024 * 1024).await.unwrap();
    let value = if bytes.is_empty() {
        Value::Null
    } else {
        serde_json::from_slice(&bytes).unwrap_or(Value::Null)
    };
    (status, value)
}

// ---------- Domänen-Helfer ----------

async fn einsatz_anlegen(app: &axum::Router, cookie: &str) -> i64 {
    let (s, v) = anfrage(app, "POST", "/api/einsaetze", cookie, Some(&json!({"bezeichnung":"Lage"}))).await;
    assert_eq!(s, StatusCode::CREATED);
    v["id"].as_i64().unwrap()
}

async fn benutzer_anlegen(app: &axum::Router, admin_cookie: &str, name: &str, org_rolle: &str) -> i64 {
    let (s, v) = anfrage(
        app,
        "POST",
        "/api/benutzer",
        admin_cookie,
        Some(&json!({
            "anzeigename": name, "benutzername": name,
            "passwort": format!("{name}pw1"), "org_rolle": org_rolle
        })),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "benutzer_anlegen: {v:?}");
    v["id"].as_i64().unwrap()
}

async fn rolle_setzen(app: &axum::Router, leit_cookie: &str, einsatz: i64, benutzer_id: i64, rolle: &str) {
    let (s, _) = anfrage(
        app,
        "PUT",
        &format!("/api/einsaetze/{einsatz}/mitglieder/{benutzer_id}"),
        leit_cookie,
        Some(&json!({ "einsatz_rolle": rolle })),
    )
    .await;
    assert_eq!(s, StatusCode::OK);
}

async fn person_anlegen(app: &axum::Router, cookie: &str, einsatz: i64) -> i64 {
    let (s, v) = anfrage(app, "POST", &format!("/api/einsaetze/{einsatz}/personen"), cookie, Some(&json!({}))).await;
    assert_eq!(s, StatusCode::CREATED);
    v["id"].as_i64().unwrap()
}

async fn schaden_anlegen(app: &axum::Router, cookie: &str, einsatz: i64, body: &Value) -> i64 {
    let (s, v) = anfrage(app, "POST", &format!("/api/einsaetze/{einsatz}/schaeden"), cookie, Some(body)).await;
    assert_eq!(s, StatusCode::CREATED, "schaden_anlegen: {v:?}");
    v["id"].as_i64().unwrap()
}

/// ETB-Einträge mit typ='system' als Vec der Inhalte.
async fn system_etb_inhalte(app: &axum::Router, cookie: &str, einsatz: i64) -> Vec<String> {
    let (_, json) = anfrage(app, "GET", &format!("/api/einsaetze/{einsatz}/etb"), cookie, None).await;
    json.as_array()
        .unwrap()
        .iter()
        .filter(|e| e["typ"] == "system")
        .map(|e| e["inhalt"].as_str().unwrap().to_string())
        .collect()
}

fn gueltig() -> Value {
    json!({ "typ": "sachschaden", "ausmass": "gering", "ort": "Hauptstr. 1" })
}

// ---------- Tests: CRUD + Registriernummer + Status ----------

#[tokio::test]
async fn anlegen_vergibt_s_nummer_und_status_offen() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let (s, v) = anfrage(&app, "POST", &format!("/api/einsaetze/{e}/schaeden"), &admin,
        Some(&json!({"typ":"umweltschaden","ausmass":"gross","ort":"Hauptstr. 17"}))).await;
    assert_eq!(s, StatusCode::CREATED);
    assert_eq!(v["registrier_nr"], 1);
    assert_eq!(v["status"], "offen");
    assert_eq!(v["typ"], "umweltschaden");
    assert_eq!(v["ausmass"], "gross");
}

#[tokio::test]
async fn registriernr_fortlaufend_je_einsatz() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let _ = schaden_anlegen(&app, &admin, e, &gueltig()).await;
    let (_, v2) = anfrage(&app, "POST", &format!("/api/einsaetze/{e}/schaeden"), &admin, Some(&gueltig())).await;
    assert_eq!(v2["registrier_nr"], 2);
}

#[tokio::test]
async fn anlegen_ohne_pflichtfelder_ist_422() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    for body in [json!({"ausmass":"gering","ort":"X"}), json!({"typ":"sachschaden","ort":"X"}),
                 json!({"typ":"sachschaden","ausmass":"gering"})] {
        let (s, _) = anfrage(&app, "POST", &format!("/api/einsaetze/{e}/schaeden"), &admin, Some(&body)).await;
        assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY, "fehlt Pflichtfeld → 422: {body}");
    }
}

#[tokio::test]
async fn anlegen_mit_status_ungleich_offen_ist_422() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let mut body = gueltig();
    body["status"] = json!("abgeschlossen");
    let (s, _) = anfrage(&app, "POST", &format!("/api/einsaetze/{e}/schaeden"), &admin, Some(&body)).await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY);
}

#[tokio::test]
async fn uebergeben_setzt_status_und_adressat() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let sid = schaden_anlegen(&app, &admin, e, &gueltig()).await;
    let (s, v) = anfrage(&app, "POST", &format!("/api/einsaetze/{e}/schaeden/{sid}/uebergeben"), &admin,
        Some(&json!({"uebergeben_an":"Stadtwerke"}))).await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(v["status"], "uebergeben");
    assert_eq!(v["uebergeben_an"], "Stadtwerke");
    assert!(v["uebergeben_at"].is_string());
}

#[tokio::test]
async fn uebergeben_ohne_adressat_ist_422() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let sid = schaden_anlegen(&app, &admin, e, &gueltig()).await;
    let (s, _) = anfrage(&app, "POST", &format!("/api/einsaetze/{e}/schaeden/{sid}/uebergeben"), &admin,
        Some(&json!({}))).await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY);
}

#[tokio::test]
async fn uebergeben_aus_abgeschlossen_ist_409() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let sid = schaden_anlegen(&app, &admin, e, &gueltig()).await;
    anfrage(&app, "POST", &format!("/api/einsaetze/{e}/schaeden/{sid}/abschliessen"), &admin,
        Some(&json!({"abschluss_grund":"behoben"}))).await;
    let (s, _) = anfrage(&app, "POST", &format!("/api/einsaetze/{e}/schaeden/{sid}/uebergeben"), &admin,
        Some(&json!({"uebergeben_an":"Bauhof"}))).await;
    assert_eq!(s, StatusCode::CONFLICT);
}

#[tokio::test]
async fn abschliessen_aus_offen_und_aus_uebergeben_ok() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let s1 = schaden_anlegen(&app, &admin, e, &gueltig()).await;
    let (a1, v1) = anfrage(&app, "POST", &format!("/api/einsaetze/{e}/schaeden/{s1}/abschliessen"), &admin,
        Some(&json!({"abschluss_grund":"behoben"}))).await;
    assert_eq!(a1, StatusCode::OK);
    assert_eq!(v1["status"], "abgeschlossen");
    let s2 = schaden_anlegen(&app, &admin, e, &gueltig()).await;
    anfrage(&app, "POST", &format!("/api/einsaetze/{e}/schaeden/{s2}/uebergeben"), &admin,
        Some(&json!({"uebergeben_an":"Bauhof"}))).await;
    let (a2, _) = anfrage(&app, "POST", &format!("/api/einsaetze/{e}/schaeden/{s2}/abschliessen"), &admin,
        Some(&json!({"abschluss_grund":"behoben"}))).await;
    assert_eq!(a2, StatusCode::OK);
}

#[tokio::test]
async fn abschliessen_ohne_grund_ist_422() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let sid = schaden_anlegen(&app, &admin, e, &gueltig()).await;
    let (s, _) = anfrage(&app, "POST", &format!("/api/einsaetze/{e}/schaeden/{sid}/abschliessen"), &admin,
        Some(&json!({}))).await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY);
}

#[tokio::test]
async fn abschliessen_aus_abgeschlossen_ist_409() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let sid = schaden_anlegen(&app, &admin, e, &gueltig()).await;
    anfrage(&app, "POST", &format!("/api/einsaetze/{e}/schaeden/{sid}/abschliessen"), &admin,
        Some(&json!({"abschluss_grund":"behoben"}))).await;
    let (s, _) = anfrage(&app, "POST", &format!("/api/einsaetze/{e}/schaeden/{sid}/abschliessen"), &admin,
        Some(&json!({"abschluss_grund":"behoben"}))).await;
    assert_eq!(s, StatusCode::CONFLICT);
}

#[tokio::test]
async fn abschliessen_haengt_notiz_an_beschreibung_an() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let mut body = gueltig();
    body["beschreibung"] = json!("Erstbefund");
    let sid = schaden_anlegen(&app, &admin, e, &body).await;
    anfrage(&app, "POST", &format!("/api/einsaetze/{e}/schaeden/{sid}/abschliessen"), &admin,
        Some(&json!({"abschluss_grund":"behoben","notiz":"vor Ort erledigt"}))).await;
    let (_, v) = anfrage(&app, "GET", &format!("/api/einsaetze/{e}/schaeden/{sid}"), &admin, None).await;
    let beschr = v["beschreibung"].as_str().unwrap();
    assert!(beschr.contains("Erstbefund"));
    assert!(beschr.contains("vor Ort erledigt"));
}

// ---------- Tests: Geschädigt-Exklusivität + Soft-Delete + PATCH-Effektivzustand ----------

#[tokio::test]
async fn geschaedigt_beide_felder_ist_422() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let p = person_anlegen(&app, &admin, e).await;
    let mut body = gueltig();
    body["geschaedigt_person_id"] = json!(p);
    body["geschaedigt_kontakt"] = json!("Herr Meier");
    let (s, _) = anfrage(&app, "POST", &format!("/api/einsaetze/{e}/schaeden"), &admin, Some(&body)).await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY);
}

#[tokio::test]
async fn geschaedigt_fk_auf_storniert_person_bleibt_zulaessig() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let p = person_anlegen(&app, &admin, e).await;
    let mut body = gueltig();
    body["geschaedigt_person_id"] = json!(p);
    let sid = schaden_anlegen(&app, &admin, e, &body).await;
    let (s_del, _) = anfrage(&app, "DELETE", &format!("/api/einsaetze/{e}/personen/{p}"), &admin, None).await;
    assert!(s_del == StatusCode::NO_CONTENT || s_del == StatusCode::OK);
    let (s, v) = anfrage(&app, "GET", &format!("/api/einsaetze/{e}/schaeden/{sid}"), &admin, None).await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(v["geschaedigt_person_id"], json!(p));
    assert!(v["geschaedigt_storniert_at"].is_string(), "Join zeigt storniert-Marke");
}

#[tokio::test]
async fn patch_loescht_uebergeben_an_bei_status_uebergeben_ist_422() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let sid = schaden_anlegen(&app, &admin, e, &gueltig()).await;
    anfrage(&app, "POST", &format!("/api/einsaetze/{e}/schaeden/{sid}/uebergeben"), &admin,
        Some(&json!({"uebergeben_an":"Stadtwerke"}))).await;
    let (s, _) = anfrage(&app, "PATCH", &format!("/api/einsaetze/{e}/schaeden/{sid}"), &admin,
        Some(&json!({"uebergeben_an": null}))).await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY, "darf 422 sein, NICHT 500");
}

#[tokio::test]
async fn patch_geschaedigt_xor_effektivzustand_ist_422() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let p = person_anlegen(&app, &admin, e).await;
    let mut body = gueltig();
    body["geschaedigt_kontakt"] = json!("Herr Meier");
    let sid = schaden_anlegen(&app, &admin, e, &body).await;
    let (s, _) = anfrage(&app, "PATCH", &format!("/api/einsaetze/{e}/schaeden/{sid}"), &admin,
        Some(&json!({"geschaedigt_person_id": p}))).await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY);
}

#[tokio::test]
async fn soft_delete_blendet_aus_und_doppelt_ist_409() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let sid = schaden_anlegen(&app, &admin, e, &gueltig()).await;
    let (s1, _) = anfrage(&app, "DELETE", &format!("/api/einsaetze/{e}/schaeden/{sid}"), &admin, None).await;
    assert_eq!(s1, StatusCode::NO_CONTENT);
    let (_, liste) = anfrage(&app, "GET", &format!("/api/einsaetze/{e}/schaeden"), &admin, None).await;
    assert_eq!(liste.as_array().unwrap().len(), 0, "storniert nicht in Default-Liste");
    let (_, liste2) = anfrage(&app, "GET", &format!("/api/einsaetze/{e}/schaeden?inkl_storniert=true"), &admin, None).await;
    assert_eq!(liste2.as_array().unwrap().len(), 1, "mit inkl_storniert sichtbar");
    let (s2, _) = anfrage(&app, "DELETE", &format!("/api/einsaetze/{e}/schaeden/{sid}"), &admin, None).await;
    assert_eq!(s2, StatusCode::CONFLICT, "doppeltes Stornieren → 409");
}

#[tokio::test]
async fn patch_auf_storniertem_schaden_ist_409() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let sid = schaden_anlegen(&app, &admin, e, &gueltig()).await;
    anfrage(&app, "DELETE", &format!("/api/einsaetze/{e}/schaeden/{sid}"), &admin, None).await;
    let (s, _) = anfrage(&app, "PATCH", &format!("/api/einsaetze/{e}/schaeden/{sid}"), &admin,
        Some(&json!({"ausmass":"gross"}))).await;
    assert_eq!(s, StatusCode::CONFLICT);
}

#[tokio::test]
async fn liste_filtert_nach_status_typ_ausmass() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    schaden_anlegen(&app, &admin, e, &json!({"typ":"umweltschaden","ausmass":"gross","ort":"A"})).await;
    schaden_anlegen(&app, &admin, e, &json!({"typ":"sachschaden","ausmass":"gering","ort":"B"})).await;
    let (_, nur_umwelt) = anfrage(&app, "GET", &format!("/api/einsaetze/{e}/schaeden?typ=umweltschaden"), &admin, None).await;
    assert_eq!(nur_umwelt.as_array().unwrap().len(), 1);
    let (_, nur_gross) = anfrage(&app, "GET", &format!("/api/einsaetze/{e}/schaeden?ausmass=gross"), &admin, None).await;
    assert_eq!(nur_gross.as_array().unwrap().len(), 1);
}
