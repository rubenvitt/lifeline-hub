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

/// Disponiert eine Ad-hoc-Einsatzkraft in den Einsatz und liefert deren einsatz_personal-id.
async fn personal_disponieren(app: &axum::Router, cookie: &str, einsatz: i64, name: &str) -> i64 {
    let (s, v) = anfrage(
        app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/personal"),
        cookie,
        Some(&json!({ "adhoc": { "name": name } })),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "personal_disponieren: {v:?}");
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

// ---------- Tests: ETB-Leak ----------

#[tokio::test]
async fn anlegen_etb_nennt_ort_aber_nicht_geschaedigt_oder_beschreibung() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    schaden_anlegen(&app, &admin, e, &json!({
        "typ":"umweltschaden","ausmass":"gross","ort":"Hauptstr. 17",
        "beschreibung":"GEHEIM_BESCHREIBUNG","geschaedigt_kontakt":"Frau GEHEIM"
    })).await;
    let inhalte = system_etb_inhalte(&app, &admin, e).await;
    assert_eq!(inhalte.len(), 1);
    assert!(inhalte[0].contains("S-001"), "ETB nennt Registriernummer");
    assert!(inhalte[0].contains("umweltschaden"), "ETB nennt Typ");
    assert!(inhalte[0].contains("gross"), "ETB nennt Ausmaß");
    assert!(inhalte[0].contains("Hauptstr. 17"), "ETB nennt den Ort (Lagebild)");
    assert!(!inhalte[0].contains("GEHEIM"), "ETB-Leak: weder beschreibung noch geschaedigt_kontakt");
}

#[tokio::test]
async fn lifecycle_etb_je_event_ein_eintrag_ohne_leak() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let p = person_anlegen(&app, &admin, e).await; // FK-Geschädigter (R-001)
    let sid = schaden_anlegen(&app, &admin, e, &json!({
        "typ":"sachschaden","ausmass":"mittel","ort":"Wald hinter Müllers Hof",
        "geschaedigt_person_id": p
    })).await;
    anfrage(&app, "POST", &format!("/api/einsaetze/{e}/schaeden/{sid}/uebergeben"), &admin,
        Some(&json!({"uebergeben_an":"Bauhof"}))).await;
    anfrage(&app, "POST", &format!("/api/einsaetze/{e}/schaeden/{sid}/abschliessen"), &admin,
        Some(&json!({"abschluss_grund":"behoben","notiz":"GEHEIM_NOTIZ"}))).await;
    anfrage(&app, "DELETE", &format!("/api/einsaetze/{e}/schaeden/{sid}"), &admin, None).await;

    let inhalte = system_etb_inhalte(&app, &admin, e).await;
    // NUR die Schaden-eigenen Einträge prüfen: Das Anlegen der Geschädigt-Person (E‑1)
    // schreibt selbst einen system-ETB-Eintrag mit IHRER R-Nr — das ist kein Leak des
    // Schadens. Auf S-001 filtern macht den Test robust.
    let schaden_eintraege: Vec<&String> = inhalte.iter().filter(|i| i.contains("S-001")).collect();
    assert_eq!(
        schaden_eintraege.len(),
        4,
        "Schaden-Lifecycle: Anlegen + uebergeben + abschliessen + storno: {schaden_eintraege:?}"
    );
    for i in &schaden_eintraege {
        assert!(!i.contains("GEHEIM_NOTIZ"), "Leak: Abschluss-Notiz im ETB: {i}");
        assert!(!i.contains("R-001"), "Leak: Geschädigt-R-Nr im Schaden-ETB: {i}");
    }
    assert!(schaden_eintraege.iter().any(|i| i.contains("übergeben an Bauhof")));
    assert!(schaden_eintraege.iter().any(|i| i.contains("abgeschlossen (behoben)")));
    assert!(schaden_eintraege.iter().any(|i| i.contains("S-001 storniert")));
}

// ---------- Tests: Rechte-Matrix + Org-Isolation + Read-only ----------

#[tokio::test]
async fn beobachter_kann_lesen_nicht_schreiben() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let beob_id = benutzer_anlegen(&app, &admin, "beobachter", "keine").await;
    let e = einsatz_anlegen(&app, &admin).await;
    rolle_setzen(&app, &admin, e, beob_id, "beobachter").await;
    schaden_anlegen(&app, &admin, e, &gueltig()).await;
    let beob = login_cookie(&app, "beobachter", "beobachterpw1").await;
    let (s_get, _) = anfrage(&app, "GET", &format!("/api/einsaetze/{e}/schaeden"), &beob, None).await;
    assert_eq!(s_get, StatusCode::OK);
    let (s_post, _) = anfrage(&app, "POST", &format!("/api/einsaetze/{e}/schaeden"), &beob, Some(&gueltig())).await;
    assert_eq!(s_post, StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn fremder_einsatz_ohne_mitgliedschaft_ist_403() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    benutzer_anlegen(&app, &admin, "fremder", "keine").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let fremd = login_cookie(&app, "fremder", "fremderpw1").await;
    let (s, _) = anfrage(&app, "GET", &format!("/api/einsaetze/{e}/schaeden"), &fremd, None).await;
    assert_eq!(s, StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn geschaedigt_aus_fremdem_einsatz_ist_404() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e1 = einsatz_anlegen(&app, &admin).await;
    let e2 = einsatz_anlegen(&app, &admin).await;
    let p_fremd = person_anlegen(&app, &admin, e2).await;
    let mut body = gueltig();
    body["geschaedigt_person_id"] = json!(p_fremd);
    let (s, _) = anfrage(&app, "POST", &format!("/api/einsaetze/{e1}/schaeden"), &admin, Some(&body)).await;
    assert_eq!(s, StatusCode::NOT_FOUND, "Geschädigt aus fremdem Einsatz → 404");
}

#[tokio::test]
async fn abgeschlossener_einsatz_ist_read_only() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let sid = schaden_anlegen(&app, &admin, e, &gueltig()).await;
    anfrage(&app, "POST", &format!("/api/einsaetze/{e}/abschliessen"), &admin, Some(&json!({}))).await;
    let (s_get, _) = anfrage(&app, "GET", &format!("/api/einsaetze/{e}/schaeden"), &admin, None).await;
    assert_eq!(s_get, StatusCode::OK, "Lesen bleibt erlaubt (Nachlauffrist)");
    let (s_post, _) = anfrage(&app, "POST", &format!("/api/einsaetze/{e}/schaeden"), &admin, Some(&gueltig())).await;
    assert_eq!(s_post, StatusCode::CONFLICT, "Schreiben auf abgeschlossenem Einsatz → 409");
    let (s_del, _) = anfrage(&app, "DELETE", &format!("/api/einsaetze/{e}/schaeden/{sid}"), &admin, None).await;
    assert_eq!(s_del, StatusCode::CONFLICT);
}

/// PINNT das aktuelle Cross-Org-Verhalten von `darf_lesen` (mögliche Isolations-Lücke
/// über `ist_hoehere_berechtigung`). Schlägt der LESE-Teil fehl, hat sich das Gate geändert —
/// dann Sicherheitslage neu bewerten, NICHT den Test stumpf anpassen.
/// bootstrap_admin ist nicht ein 2. Mal aufrufbar → zweite Org per rohem SQL; der
/// bestehende System-Admin (org 1) hat selbst höhere Berechtigung und liest org-übergreifend.
#[tokio::test]
async fn hoehere_berechtigung_liest_fremde_org_pin_schreiben_403() {
    let (app, pool) = setup_mit_pool().await; // "Test-Orga" (org 1) + System-Admin "admin"
    let admin = login_cookie(&app, "admin", "startpw12").await;

    let org2: i64 = sqlx::query_scalar("INSERT INTO organisation (name) VALUES ('Fremd-Orga') RETURNING id")
        .fetch_one(&pool).await.unwrap();
    let u2: i64 = sqlx::query_scalar(
        "INSERT INTO benutzer (org_id, anzeigename, benutzername, passwort_hash) \
         VALUES (?, 'F', 'fremduser', 'x') RETURNING id")
        .bind(org2).fetch_one(&pool).await.unwrap();
    let e2: i64 = sqlx::query_scalar(
        "INSERT INTO einsatz (org_id, bezeichnung, status) VALUES (?, 'Fremd-Lage', 'aktiv') RETURNING id")
        .bind(org2).fetch_one(&pool).await.unwrap();
    sqlx::query(
        "INSERT INTO einsatz_schaden (einsatz_id, registrier_nr, typ, ausmass, ort, erfasst_von, geaendert_von) \
         VALUES (?, 1, 'sachschaden', 'gering', 'Fremdstr. 1', ?, ?)")
        .bind(e2).bind(u2).bind(u2).execute(&pool).await.unwrap();

    // LESEN: aktuelles Verhalten festhalten (erwartet: 200 wegen ist_hoehere_berechtigung-Bypass).
    let (s_get, v) = anfrage(&app, "GET", &format!("/api/einsaetze/{e2}/schaeden"), &admin, None).await;
    assert_eq!(s_get, StatusCode::OK, "PIN: höhere Berechtigung liest org-übergreifend (Lücke dokumentiert)");
    assert_eq!(v.as_array().unwrap().len(), 1, "Schaden der fremden Org ist sichtbar");

    // SCHREIBEN: muss IMMER 403 sein — Schreib-Gate kennt keinen Bypass (admin ist nicht Mitglied von e2).
    let (s_post, _) = anfrage(&app, "POST", &format!("/api/einsaetze/{e2}/schaeden"), &admin, Some(&gueltig())).await;
    assert_eq!(s_post, StatusCode::FORBIDDEN, "fremde Org schreiben → 403");
}

// ---------- Tests: 4‑Wege-Geschädigter (Einsatzkraft / eigene Org / extern) ----------

#[tokio::test]
async fn anlegen_mit_geschaedigt_einsatzkraft_ist_201_mit_name() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let ep = personal_disponieren(&app, &admin, e, "Einsatzkraft Alpha").await;
    let mut body = gueltig();
    body["geschaedigt_personal_id"] = json!(ep);
    let (s, v) = anfrage(&app, "POST", &format!("/api/einsaetze/{e}/schaeden"), &admin, Some(&body)).await;
    assert_eq!(s, StatusCode::CREATED, "Einsatzkraft als Geschädigter: {v:?}");
    assert_eq!(v["geschaedigt_personal_id"], json!(ep));
    assert_eq!(v["geschaedigt_personal_name"], json!("Einsatzkraft Alpha"));
}

#[tokio::test]
async fn anlegen_mit_geschaedigt_einsatzkraft_aus_fremdem_einsatz_ist_404() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e1 = einsatz_anlegen(&app, &admin).await;
    let e2 = einsatz_anlegen(&app, &admin).await;
    let ep_fremd = personal_disponieren(&app, &admin, e2, "Fremde Kraft").await;
    let mut body = gueltig();
    body["geschaedigt_personal_id"] = json!(ep_fremd);
    let (s, _) = anfrage(&app, "POST", &format!("/api/einsaetze/{e1}/schaeden"), &admin, Some(&body)).await;
    assert_eq!(s, StatusCode::NOT_FOUND, "Einsatzkraft aus fremdem Einsatz → 404");
}

#[tokio::test]
async fn anlegen_mit_geschaedigt_organisation_erzwingt_eigene_org() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    // Bewusst eine unsinnige/fremde Org-id senden — der Server muss sie ignorieren
    // und IMMER die eigene Org des Einsatzes setzen.
    let mut body = gueltig();
    body["geschaedigt_organisation_id"] = json!(99999);
    let (s, v) = anfrage(&app, "POST", &format!("/api/einsaetze/{e}/schaeden"), &admin, Some(&body)).await;
    assert_eq!(s, StatusCode::CREATED, "eigene Org als Geschädigter: {v:?}");
    let zurueck = v["geschaedigt_organisation_id"].as_i64().unwrap();
    assert_ne!(zurueck, 99999, "Client-Org-id darf NICHT übernommen werden");
    assert!(v["geschaedigt_organisation_name"].is_string(), "Org-Name aufgelöst");
    // Die eigene Org ist die bootstrap-Org (id 1).
    assert_eq!(zurueck, 1, "abgeleitet aus einsatz.org_id");
}

#[tokio::test]
async fn anlegen_mit_zwei_geschaedigt_quellen_ist_422() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let ep = personal_disponieren(&app, &admin, e, "Kraft").await;
    // person + personal
    let p = person_anlegen(&app, &admin, e).await;
    let mut body = gueltig();
    body["geschaedigt_person_id"] = json!(p);
    body["geschaedigt_personal_id"] = json!(ep);
    let (s1, _) = anfrage(&app, "POST", &format!("/api/einsaetze/{e}/schaeden"), &admin, Some(&body)).await;
    assert_eq!(s1, StatusCode::UNPROCESSABLE_ENTITY, "Person + Einsatzkraft → 422");
    // personal + organisation
    let mut body2 = gueltig();
    body2["geschaedigt_personal_id"] = json!(ep);
    body2["geschaedigt_organisation_id"] = json!(1);
    let (s2, _) = anfrage(&app, "POST", &format!("/api/einsaetze/{e}/schaeden"), &admin, Some(&body2)).await;
    assert_eq!(s2, StatusCode::UNPROCESSABLE_ENTITY, "Einsatzkraft + Org → 422");
}

#[tokio::test]
async fn patch_geschaedigt_personal_auf_kontakt_effektivzustand_ist_422() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let ep = personal_disponieren(&app, &admin, e, "Kraft").await;
    // Schaden mit Freitext-Kontakt anlegen ...
    let mut body = gueltig();
    body["geschaedigt_kontakt"] = json!("Stadtwerke");
    let sid = schaden_anlegen(&app, &admin, e, &body).await;
    // ... dann per PATCH eine Einsatzkraft setzen OHNE den Kontakt zu löschen → 422 (nicht 500).
    let (s, _) = anfrage(&app, "PATCH", &format!("/api/einsaetze/{e}/schaeden/{sid}"), &admin,
        Some(&json!({"geschaedigt_personal_id": ep}))).await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY, "Effektivzustand 2 Quellen → 422, NICHT 500");
}

#[tokio::test]
async fn patch_geschaedigt_organisation_erzwingt_eigene_org() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let sid = schaden_anlegen(&app, &admin, e, &gueltig()).await;
    // Bewusst eine unsinnige/fremde Org-id senden — der Server muss sie ignorieren
    // und IMMER die eigene Org des Einsatzes setzen.
    let (s, _) = anfrage(&app, "PATCH", &format!("/api/einsaetze/{e}/schaeden/{sid}"), &admin,
        Some(&json!({"geschaedigt_organisation_id": 99999}))).await;
    assert_eq!(s, StatusCode::OK, "PATCH mit bogus Org-id: erwartet 200");
    let (s_get, v) = anfrage(&app, "GET", &format!("/api/einsaetze/{e}/schaeden/{sid}"), &admin, None).await;
    assert_eq!(s_get, StatusCode::OK);
    let zurueck = v["geschaedigt_organisation_id"].as_i64().unwrap();
    assert_ne!(zurueck, 99999, "Client-Org-id darf NICHT übernommen werden");
    assert!(v["geschaedigt_organisation_name"].is_string(), "Org-Name aufgelöst");
    // Die eigene Org ist die bootstrap-Org (id 1).
    assert_eq!(zurueck, 1, "abgeleitet aus einsatz.org_id");
}

// ---------- Tests: Verortung (lat/lon) ----------

#[tokio::test]
async fn schaden_verorten_setzt_lat_lon() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let sid = schaden_anlegen(&app, &admin, e, &gueltig()).await;
    let (s, v) = anfrage(&app, "PATCH", &format!("/api/einsaetze/{e}/schaeden/{sid}"), &admin,
        Some(&json!({"lat": 51.0, "lon": 7.0}))).await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(v["lat"].as_f64(), Some(51.0));
    assert_eq!(v["lon"].as_f64(), Some(7.0));
}

#[tokio::test]
async fn schaden_verorten_nur_lon_ist_422() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let sid = schaden_anlegen(&app, &admin, e, &gueltig()).await;
    let (s, _) = anfrage(&app, "PATCH", &format!("/api/einsaetze/{e}/schaeden/{sid}"), &admin,
        Some(&json!({"lon": 7.0}))).await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY, "darf 422 sein, NICHT 500");
}

#[tokio::test]
async fn schaden_verorten_nur_lat_ist_422() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let sid = schaden_anlegen(&app, &admin, e, &gueltig()).await;
    let (s, _) = anfrage(&app, "PATCH", &format!("/api/einsaetze/{e}/schaeden/{sid}"), &admin,
        Some(&json!({"lat": 51.0}))).await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY, "darf 422 sein, NICHT 500");
}

#[tokio::test]
async fn schaden_verorten_ausserhalb_range_ist_422() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let sid = schaden_anlegen(&app, &admin, e, &gueltig()).await;
    let (s, _) = anfrage(&app, "PATCH", &format!("/api/einsaetze/{e}/schaeden/{sid}"), &admin,
        Some(&json!({"lat": 99.0, "lon": 7.0}))).await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY);
    let (s, _) = anfrage(&app, "PATCH", &format!("/api/einsaetze/{e}/schaeden/{sid}"), &admin,
        Some(&json!({"lat": 51.0, "lon": 200.0}))).await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY);
}

#[tokio::test]
async fn schaden_verorten_loeschen_setzt_null() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let sid = schaden_anlegen(&app, &admin, e, &gueltig()).await;
    let (s, _) = anfrage(&app, "PATCH", &format!("/api/einsaetze/{e}/schaeden/{sid}"), &admin,
        Some(&json!({"lat": 51.0, "lon": 7.0}))).await;
    assert_eq!(s, StatusCode::OK);
    let (s, v) = anfrage(&app, "PATCH", &format!("/api/einsaetze/{e}/schaeden/{sid}"), &admin,
        Some(&json!({"lat": null, "lon": null}))).await;
    assert_eq!(s, StatusCode::OK);
    assert!(v["lat"].is_null());
    assert!(v["lon"].is_null());
}
