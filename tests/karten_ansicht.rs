use axum::body::{to_bytes, Body};
use axum::http::{header, Request, StatusCode};
use lifeline_hub::app::{build_router, AppState};
use lifeline_hub::auth::bootstrap::bootstrap_admin;
use lifeline_hub::db;
use lifeline_hub::live::LiveHub;
use serde_json::{json, Value};
use tower::ServiceExt;

mod common;
use common::login_cookie;

// ---------- Harness ----------

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

async fn anfrage(
    app: &axum::Router,
    method: &str,
    uri: &str,
    cookie: &str,
    body: Option<&Value>,
) -> (StatusCode, Value) {
    let mut req = Request::builder()
        .method(method)
        .uri(uri)
        .header(header::COOKIE, cookie);
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

async fn einsatz_anlegen(app: &axum::Router, cookie: &str) -> i64 {
    let (s, v) = anfrage(
        app,
        "POST",
        "/api/einsaetze",
        cookie,
        Some(&json!({"bezeichnung":"Lage"})),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "einsatz_anlegen: {v:?}");
    v["id"].as_i64().unwrap()
}

async fn einstellungen_setzen(app: &axum::Router, cookie: &str, einsatz: i64, body: &Value) {
    let (s, v) = anfrage(
        app,
        "PUT",
        &format!("/api/einsaetze/{einsatz}/einstellungen"),
        cookie,
        Some(body),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "einstellungen_setzen: {v:?}");
}

// ---------- Tests ----------

/// Existiert für einen Einsatz keine Ansicht, legt der GET-Handler lazy eine
/// Standardansicht an, gespeist aus `einsatz_einstellungen`.
#[tokio::test]
async fn standardansicht_wird_lazy_geseedet_aus_einstellungen() {
    let (app, _pool) = setup_mit_pool().await;
    let cookie = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &cookie).await;

    einstellungen_setzen(
        &app,
        &cookie,
        e,
        &json!({
            "basemap_modus": "offline",
            "fachebenen_sichtbar": {"nina": true, "dwd": false, "pegelonline": false, "kritis": false}
        }),
    )
    .await;

    let (s, v) = anfrage(
        &app,
        "GET",
        &format!("/api/einsaetze/{e}/karten-ansichten"),
        &cookie,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v:?}");
    let ansichten = v.as_array().expect("Liste");
    assert_eq!(ansichten.len(), 1, "genau eine Standardansicht: {v:?}");
    assert_eq!(ansichten[0]["name"], "Standard");
    assert_eq!(ansichten[0]["ist_standard"], true);
    assert_eq!(
        ansichten[0]["basemap_modus"], "offline",
        "basemap aus einstellungen geseedet: {v:?}"
    );
}

/// Zweiter GET seedet nicht neu — genau eine Standardansicht bleibt bestehen.
#[tokio::test]
async fn zweiter_get_seedet_nicht_neu() {
    let (app, _pool) = setup_mit_pool().await;
    let cookie = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &cookie).await;

    let url = format!("/api/einsaetze/{e}/karten-ansichten");
    let (_, v1) = anfrage(&app, "GET", &url, &cookie, None).await;
    let (_, v2) = anfrage(&app, "GET", &url, &cookie, None).await;
    assert_eq!(v1.as_array().unwrap().len(), 1);
    assert_eq!(v2.as_array().unwrap().len(), 1, "kein Doppel-Seed");
    assert_eq!(v1[0]["id"], v2[0]["id"], "dieselbe Ansicht");
}

/// GET auf einen nicht existierenden Einsatz → 404 über den EinsatzKontext-Extractor.
#[tokio::test]
async fn get_nicht_existenter_einsatz_ist_404() {
    let (app, _pool) = setup_mit_pool().await;
    let cookie = login_cookie(&app, "admin", "startpw12").await;
    let (s, _) = anfrage(
        &app,
        "GET",
        "/api/einsaetze/999999/karten-ansichten",
        &cookie,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::NOT_FOUND);
}

/// „Für den Einsatz speichern": PATCH überschreibt die Konfiguration der Standardansicht
/// und der Stand überlebt einen erneuten GET.
#[tokio::test]
async fn patch_ueberschreibt_konfiguration() {
    let (app, _pool) = setup_mit_pool().await;
    let cookie = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &cookie).await;

    let url = format!("/api/einsaetze/{e}/karten-ansichten");
    let (_, v) = anfrage(&app, "GET", &url, &cookie, None).await;
    let aid = v[0]["id"].as_i64().unwrap();

    let (s, v) = anfrage(
        &app,
        "PATCH",
        &format!("{url}/{aid}"),
        &cookie,
        Some(&json!({
            "basemap_modus": "online",
            "karten_theme": "dark",
            "layer_sichtbar": {"melder": true, "zone": false},
            "fachebenen_sichtbar": {"nina": true, "dwd": false, "pegelonline": false, "kritis": false},
            "zoom": 14.5
        })),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v:?}");
    assert_eq!(v["basemap_modus"], "online");
    assert_eq!(v["karten_theme"], "dark");
    assert_eq!(v["zoom"], 14.5);
    assert_eq!(v["layer_sichtbar"]["zone"], false);

    let (_, v2) = anfrage(&app, "GET", &url, &cookie, None).await;
    assert_eq!(
        v2[0]["basemap_modus"], "online",
        "Stand persistiert: {v2:?}"
    );
    assert_eq!(v2[0]["karten_theme"], "dark");
    assert_eq!(v2.as_array().unwrap().len(), 1, "kein Neu-Seed durch PATCH");
}

/// Unbekannter `basemap_modus` scheitert am Feld selbst → 400 (LFH-267).
#[tokio::test]
async fn patch_unbekannter_basemap_modus_ist_400() {
    let (app, _pool) = setup_mit_pool().await;
    let cookie = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &cookie).await;
    let url = format!("/api/einsaetze/{e}/karten-ansichten");
    let (_, v) = anfrage(&app, "GET", &url, &cookie, None).await;
    let aid = v[0]["id"].as_i64().unwrap();

    let (s, _) = anfrage(
        &app,
        "PATCH",
        &format!("{url}/{aid}"),
        &cookie,
        Some(&json!({"basemap_modus": "satellit"})),
    )
    .await;
    assert_eq!(s, StatusCode::BAD_REQUEST);
}

/// Unbekanntes `karten_theme` scheitert am Feld selbst → 400 (LFH-267).
#[tokio::test]
async fn patch_unbekanntes_theme_ist_400() {
    let (app, _pool) = setup_mit_pool().await;
    let cookie = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &cookie).await;
    let url = format!("/api/einsaetze/{e}/karten-ansichten");
    let (_, v) = anfrage(&app, "GET", &url, &cookie, None).await;
    let aid = v[0]["id"].as_i64().unwrap();

    let (s, _) = anfrage(
        &app,
        "PATCH",
        &format!("{url}/{aid}"),
        &cookie,
        Some(&json!({"karten_theme": "neon"})),
    )
    .await;
    assert_eq!(s, StatusCode::BAD_REQUEST);
}

// ---------- B (LFH-320): Ansichts-CRUD ----------

/// Seedet die Standardansicht und liefert ihre id.
async fn standard_aid(app: &axum::Router, cookie: &str, einsatz: i64) -> i64 {
    let (_, v) = anfrage(
        app,
        "GET",
        &format!("/api/einsaetze/{einsatz}/karten-ansichten"),
        cookie,
        None,
    )
    .await;
    v[0]["id"].as_i64().unwrap()
}

/// POST legt eine zweite, benannte Ansicht an — nicht Standard, reiht hinter die
/// Standardansicht ein. GET zeigt danach zwei Ansichten.
#[tokio::test]
async fn post_legt_zweite_ansicht_an() {
    let (app, _pool) = setup_mit_pool().await;
    let cookie = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &cookie).await;
    let url = format!("/api/einsaetze/{e}/karten-ansichten");
    standard_aid(&app, &cookie, e).await; // seed

    let (s, v) = anfrage(
        &app,
        "POST",
        &url,
        &cookie,
        Some(&json!({"name": "Abschnitt Nord", "basemap_modus": "online"})),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{v:?}");
    assert_eq!(v["name"], "Abschnitt Nord");
    assert_eq!(v["ist_standard"], false, "neue Ansicht ist nicht Standard");
    assert_eq!(v["basemap_modus"], "online");

    let (_, liste) = anfrage(&app, "GET", &url, &cookie, None).await;
    assert_eq!(
        liste.as_array().unwrap().len(),
        2,
        "zwei Ansichten: {liste:?}"
    );
}

/// POST mit leerem Namen scheitert am Feld selbst → 400 (LFH-267).
#[tokio::test]
async fn post_leerer_name_ist_400() {
    let (app, _pool) = setup_mit_pool().await;
    let cookie = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &cookie).await;
    standard_aid(&app, &cookie, e).await;
    let (s, _) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{e}/karten-ansichten"),
        &cookie,
        Some(&json!({"name": "   "})),
    )
    .await;
    assert_eq!(s, StatusCode::BAD_REQUEST);
}

/// POST mit unbekanntem basemap_modus scheitert am Feld → 400 (LFH-267).
#[tokio::test]
async fn post_unbekannter_basemap_modus_ist_400() {
    let (app, _pool) = setup_mit_pool().await;
    let cookie = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &cookie).await;
    standard_aid(&app, &cookie, e).await;
    let (s, _) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{e}/karten-ansichten"),
        &cookie,
        Some(&json!({"name": "X", "basemap_modus": "satellit"})),
    )
    .await;
    assert_eq!(s, StatusCode::BAD_REQUEST);
}

/// PATCH `{name}` benennt um, ohne die Konfiguration zu berühren.
#[tokio::test]
async fn patch_benennt_um_ohne_config_zu_beruehren() {
    let (app, _pool) = setup_mit_pool().await;
    let cookie = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &cookie).await;
    let url = format!("/api/einsaetze/{e}/karten-ansichten");
    let aid = standard_aid(&app, &cookie, e).await;

    // Config setzen
    anfrage(
        &app,
        "PATCH",
        &format!("{url}/{aid}"),
        &cookie,
        Some(&json!({"basemap_modus": "online", "karten_theme": "dark"})),
    )
    .await;
    // Nur umbenennen
    let (s, v) = anfrage(
        &app,
        "PATCH",
        &format!("{url}/{aid}"),
        &cookie,
        Some(&json!({"name": "Gesamtlage"})),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v:?}");
    assert_eq!(v["name"], "Gesamtlage");
    assert_eq!(
        v["basemap_modus"], "online",
        "Config bleibt beim reinen Umbenennen unberührt: {v:?}"
    );
    assert_eq!(v["karten_theme"], "dark");
}

/// PATCH `{ist_standard:true}` auf eine zweite Ansicht macht sie zum Standard und
/// entzieht der bisherigen das Flag — genau eine Standardansicht (Index hält).
#[tokio::test]
async fn patch_standard_setzen_verschiebt_flag() {
    let (app, _pool) = setup_mit_pool().await;
    let cookie = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &cookie).await;
    let url = format!("/api/einsaetze/{e}/karten-ansichten");
    let alt_standard = standard_aid(&app, &cookie, e).await;

    let (_, neu) = anfrage(&app, "POST", &url, &cookie, Some(&json!({"name": "Neu"}))).await;
    let neu_aid = neu["id"].as_i64().unwrap();

    let (s, v) = anfrage(
        &app,
        "PATCH",
        &format!("{url}/{neu_aid}"),
        &cookie,
        Some(&json!({"ist_standard": true})),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v:?}");
    assert_eq!(v["ist_standard"], true);

    let (_, liste) = anfrage(&app, "GET", &url, &cookie, None).await;
    let standards: Vec<i64> = liste
        .as_array()
        .unwrap()
        .iter()
        .filter(|a| a["ist_standard"] == true)
        .map(|a| a["id"].as_i64().unwrap())
        .collect();
    assert_eq!(
        standards,
        vec![neu_aid],
        "genau der neue ist Standard: {liste:?}"
    );
    assert!(
        !standards.contains(&alt_standard),
        "alte Standardansicht hat das Flag verloren"
    );
}

/// Die Standardansicht ist nicht löschbar → 422 (Zusammenhang verbietet die Aktion).
#[tokio::test]
async fn delete_standardansicht_ist_422() {
    let (app, _pool) = setup_mit_pool().await;
    let cookie = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &cookie).await;
    let url = format!("/api/einsaetze/{e}/karten-ansichten");
    let standard = standard_aid(&app, &cookie, e).await;
    // eine zweite Ansicht existiert, damit „letzte" nicht der Grund ist
    anfrage(&app, "POST", &url, &cookie, Some(&json!({"name": "Zwei"}))).await;

    let (s, _) = anfrage(&app, "DELETE", &format!("{url}/{standard}"), &cookie, None).await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY);
}

/// Die letzte verbleibende Ansicht ist nicht löschbar → 422.
#[tokio::test]
async fn delete_letzte_ansicht_ist_422() {
    let (app, _pool) = setup_mit_pool().await;
    let cookie = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &cookie).await;
    let url = format!("/api/einsaetze/{e}/karten-ansichten");
    let standard = standard_aid(&app, &cookie, e).await;
    let (s, _) = anfrage(&app, "DELETE", &format!("{url}/{standard}"), &cookie, None).await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY, "letzte Ansicht bleibt");
}

/// Ansicht löschen mit `?objekte=freigeben` (Default): die auf ihr angelegten Objekte
/// fallen auf `ansicht_id = NULL` zurück (bleiben einsatzweit sichtbar).
#[tokio::test]
async fn delete_freigeben_gibt_objekte_frei() {
    let (app, _pool) = setup_mit_pool().await;
    let cookie = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &cookie).await;
    let url = format!("/api/einsaetze/{e}/karten-ansichten");
    standard_aid(&app, &cookie, e).await;
    let (_, neu) = anfrage(&app, "POST", &url, &cookie, Some(&json!({"name": "Nord"}))).await;
    let aid = neu["id"].as_i64().unwrap();

    // Zone auf der neuen Ansicht anlegen
    let (zs, zone) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{e}/zonen"),
        &cookie,
        Some(&json!({
            "typ": "absperrbereich", "geometrie_typ": "Polygon",
            "geometrie": "{\"type\":\"Polygon\",\"coordinates\":[[[8.6,50.1],[8.7,50.1],[8.7,50.2],[8.6,50.1]]]}",
            "ansicht_id": aid
        })),
    )
    .await;
    assert_eq!(zs, StatusCode::CREATED, "{zone:?}");
    let zid = zone["id"].as_i64().unwrap();

    // freigeben (Default)
    let (s, _) = anfrage(
        &app,
        "DELETE",
        &format!("{url}/{aid}?objekte=freigeben"),
        &cookie,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::NO_CONTENT);

    // Zone existiert noch, nun ohne ansicht_id (auf allen Ansichten)
    let (_, zonen) = anfrage(
        &app,
        "GET",
        &format!("/api/einsaetze/{e}/zonen"),
        &cookie,
        None,
    )
    .await;
    let z = zonen
        .as_array()
        .unwrap()
        .iter()
        .find(|z| z["id"].as_i64() == Some(zid))
        .expect("Zone bleibt bestehen");
    assert!(
        z.get("ansicht_id").is_none() || z["ansicht_id"].is_null(),
        "ansicht_id ist freigegeben (NULL/absent): {z:?}"
    );
}

/// Ansicht löschen mit `?objekte=loeschen`: die auf ihr angelegten Objekte verschwinden.
#[tokio::test]
async fn delete_loeschen_entfernt_objekte() {
    let (app, _pool) = setup_mit_pool().await;
    let cookie = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &cookie).await;
    let url = format!("/api/einsaetze/{e}/karten-ansichten");
    standard_aid(&app, &cookie, e).await;
    let (_, neu) = anfrage(&app, "POST", &url, &cookie, Some(&json!({"name": "Nord"}))).await;
    let aid = neu["id"].as_i64().unwrap();

    let (_, zone) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{e}/zonen"),
        &cookie,
        Some(&json!({
            "typ": "absperrbereich", "geometrie_typ": "Polygon",
            "geometrie": "{\"type\":\"Polygon\",\"coordinates\":[[[8.6,50.1],[8.7,50.1],[8.7,50.2],[8.6,50.1]]]}",
            "ansicht_id": aid
        })),
    )
    .await;
    let zid = zone["id"].as_i64().unwrap();

    let (s, _) = anfrage(
        &app,
        "DELETE",
        &format!("{url}/{aid}?objekte=loeschen"),
        &cookie,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::NO_CONTENT);

    let (_, zonen) = anfrage(
        &app,
        "GET",
        &format!("/api/einsaetze/{e}/zonen"),
        &cookie,
        None,
    )
    .await;
    assert!(
        !zonen
            .as_array()
            .unwrap()
            .iter()
            .any(|z| z["id"].as_i64() == Some(zid)),
        "Zone ist mitgelöscht: {zonen:?}"
    );
}

/// DELETE einer Ansicht eines FREMDEN Einsatzes → 404.
#[tokio::test]
async fn delete_fremde_ansicht_ist_404() {
    let (app, _pool) = setup_mit_pool().await;
    let cookie = login_cookie(&app, "admin", "startpw12").await;
    let e1 = einsatz_anlegen(&app, &cookie).await;
    let e2 = einsatz_anlegen(&app, &cookie).await;
    let fremde = standard_aid(&app, &cookie, e2).await;
    // e2 braucht zwei Ansichten, damit nicht „letzte" der ablehnende Grund wäre
    anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{e2}/karten-ansichten"),
        &cookie,
        Some(&json!({"name": "Zwei"})),
    )
    .await;
    let (s, _) = anfrage(
        &app,
        "DELETE",
        &format!("/api/einsaetze/{e1}/karten-ansichten/{fremde}"),
        &cookie,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::NOT_FOUND);
}

/// PATCH auf eine Ansicht, die zu einem ANDEREN Einsatz gehört → 404 (einsatz-skopiert).
#[tokio::test]
async fn patch_fremde_ansicht_ist_404() {
    let (app, _pool) = setup_mit_pool().await;
    let cookie = login_cookie(&app, "admin", "startpw12").await;
    let e1 = einsatz_anlegen(&app, &cookie).await;
    let e2 = einsatz_anlegen(&app, &cookie).await;

    // Ansicht von e2 seeden
    let (_, v2) = anfrage(
        &app,
        "GET",
        &format!("/api/einsaetze/{e2}/karten-ansichten"),
        &cookie,
        None,
    )
    .await;
    let fremde_aid = v2[0]["id"].as_i64().unwrap();

    // …über e1 patchen → 404
    let (s, _) = anfrage(
        &app,
        "PATCH",
        &format!("/api/einsaetze/{e1}/karten-ansichten/{fremde_aid}"),
        &cookie,
        Some(&json!({"basemap_modus": "blind"})),
    )
    .await;
    assert_eq!(s, StatusCode::NOT_FOUND);
}
