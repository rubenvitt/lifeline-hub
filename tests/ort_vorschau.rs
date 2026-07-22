use axum::body::{to_bytes, Body};
use axum::http::{header, Request, StatusCode};
use lifeline_hub::app::{build_router, AppState};
use lifeline_hub::auth::bootstrap::bootstrap_admin;
use lifeline_hub::db;
use lifeline_hub::live::LiveHub;
use serde_json::Value;
use tower::ServiceExt;

mod common;
use common::login_cookie;

/// Gibt eine garantiert verweigerte Geocoder-URL zurück (Ephemeral-Port binden + sofort freigeben).
fn geschlossener_geocoder() -> String {
    let l = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let port = l.local_addr().unwrap().port();
    drop(l);
    format!("http://127.0.0.1:{port}")
}

async fn setup_mit_pool() -> (axum::Router, sqlx::SqlitePool, std::path::PathBuf) {
    let pool = db::test_pool().await;
    bootstrap_admin(&pool, "Test-Orga", "admin", Some("startpw12"))
        .await
        .unwrap();
    // Deterministisch: Org-1-Geocoder auf garantiert verweigerte Adresse setzen,
    // damit ortsname-null-Tests netzunabhängig bleiben (Cache-Treffer umgehen dies).
    sqlx::query(
        "INSERT INTO org_einstellungen (org_id, geocoder_url) VALUES (1, ?) \
         ON CONFLICT(org_id) DO UPDATE SET geocoder_url = excluded.geocoder_url",
    )
    .bind(geschlossener_geocoder())
    .execute(&pool)
    .await
    .unwrap();
    let kd = db::test_karten_dir();
    let router = build_router(AppState {
        pool: pool.clone(),
        live: LiveHub::new(),
        karten_dir: kd.clone(),
        fachebenen: lifeline_hub::karte::FachebenenState::neu(),
        download_client: lifeline_hub::karte::download::download_client(),
        download_fortschritt: lifeline_hub::karte::download::neue_fortschritt_map(),
        karten_service_url: None,
        karten_service_token: None,
    });
    (router, pool, kd)
}

async fn get(app: &axum::Router, uri: &str, cookie: &str) -> (StatusCode, Value) {
    let resp = app
        .clone()
        .oneshot(
            Request::builder()
                .method("GET")
                .uri(uri)
                .header(header::COOKIE, cookie)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    let status = resp.status();
    let bytes = to_bytes(resp.into_body(), 1024 * 1024).await.unwrap();
    let v = if bytes.is_empty() {
        Value::Null
    } else {
        serde_json::from_slice(&bytes).unwrap_or(Value::Null)
    };
    (status, v)
}

/// Einsatz mit verortetem Einsatzort (51.0,10.0) anlegen; liefert einsatz_id.
async fn einsatz_mit_einsatzort(pool: &sqlx::SqlitePool) -> i64 {
    sqlx::query_scalar::<_, i64>(
        "INSERT INTO einsatz (org_id, bezeichnung, einsatzort, einsatzort_lat, einsatzort_lon) \
         VALUES (1, 'Lage', 'Rathaus', 51.0, 10.0) RETURNING id",
    )
    .fetch_one(pool)
    .await
    .unwrap()
}

async fn post_json(
    app: &axum::Router,
    uri: &str,
    cookie: &str,
    body: Value,
) -> (StatusCode, Value) {
    let resp = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(uri)
                .header(header::COOKIE, cookie)
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(body.to_string()))
                .unwrap(),
        )
        .await
        .unwrap();
    let status = resp.status();
    let bytes = to_bytes(resp.into_body(), 1024 * 1024).await.unwrap();
    let v = if bytes.is_empty() {
        Value::Null
    } else {
        serde_json::from_slice(&bytes).unwrap_or(Value::Null)
    };
    (status, v)
}

#[tokio::test]
async fn shape_mit_peilung_und_ortsname_null() {
    let (app, pool, _kd) = setup_mit_pool().await;
    let cookie = login_cookie(&app, "admin", "startpw12").await;
    let eid = einsatz_mit_einsatzort(&pool).await;
    // Anfrage 0.1° südlich des Einsatzorts → Peilung Richtung Norden.
    let (s, v) = get(
        &app,
        &format!("/api/einsaetze/{eid}/ort-vorschau?lat=50.9&lon=10.0"),
        &cookie,
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    // LFH-265: `ortsname` ist ABSENT, nicht present-null. `assert_eq!(v["ortsname"],
    // Value::Null)` wäre hier BLIND — serde_json liefert beim Index-Zugriff auf einen
    // fehlenden Key ebenfalls `Value::Null` und bliebe nach der Wire-Änderung grün.
    let o = v.as_object().unwrap();
    assert!(
        !o.contains_key("ortsname"),
        "ortsname muss ABSENT sein, nicht present-null"
    ); // Phase 1
    assert!(
        o.contains_key("peilung"),
        "peilung ist gesetzt und muss da sein"
    );
    assert_eq!(v["peilung"]["richtung"].as_str(), Some("N"));
    assert_eq!(v["peilung"]["bezug_label"].as_str(), Some("Rathaus"));
    assert!(v["peilung"]["distanz_m"].as_f64().unwrap() > 0.0);
}

#[tokio::test]
async fn ohne_marker_ist_peilung_null() {
    let (app, pool, _kd) = setup_mit_pool().await;
    let cookie = login_cookie(&app, "admin", "startpw12").await;
    // Einsatz OHNE einsatzort_lat/lon.
    let eid = sqlx::query_scalar::<_, i64>(
        "INSERT INTO einsatz (org_id, bezeichnung) VALUES (1, 'Leer') RETURNING id",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    let (s, v) = get(
        &app,
        &format!("/api/einsaetze/{eid}/ort-vorschau?lat=50.9&lon=10.0"),
        &cookie,
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    // LFH-265: beide Felder ABSENT (siehe shape_mit_peilung_und_ortsname_null) — der Body ist
    // hier folglich das leere Objekt.
    let o = v.as_object().unwrap();
    assert!(!o.contains_key("peilung"), "peilung muss ABSENT sein");
    assert!(!o.contains_key("ortsname"), "ortsname muss ABSENT sein");
}

#[tokio::test]
async fn exclude_schliesst_einsatzort_aus() {
    let (app, pool, _kd) = setup_mit_pool().await;
    let cookie = login_cookie(&app, "admin", "startpw12").await;
    let eid = einsatz_mit_einsatzort(&pool).await;
    // Einsatzort ausschließen → kein weiterer Marker → peilung null.
    let uri =
        format!("/api/einsaetze/{eid}/ort-vorschau?lat=50.9&lon=10.0&exclude=einsatzort:{eid}");
    let (s, v) = get(&app, &uri, &cookie).await;
    assert_eq!(s, StatusCode::OK);
    // LFH-265: ABSENT statt present-null (contains_key, sonst blind — s. o.).
    assert!(
        !v.as_object().unwrap().contains_key("peilung"),
        "peilung muss ABSENT sein"
    );
}

#[tokio::test]
async fn nicht_mitglied_wird_abgewiesen() {
    let (app, pool, _kd) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let eid = einsatz_mit_einsatzort(&pool).await;
    // Regulärer Benutzer (keine Org-Rolle), KEIN Einsatz-Mitglied → kein Lesezugriff.
    // Deterministisch unabhängig von etwaiger Cross-Org-/Admin-Lesepolitik.
    let (s, _v) = post_json(&app, "/api/benutzer", &admin, serde_json::json!({
        "anzeigename": "gast", "benutzername": "gast", "passwort": "gastpw12", "org_rolle": "keine"
    })).await;
    assert_eq!(s, StatusCode::CREATED);
    let gast = login_cookie(&app, "gast", "gastpw12").await;
    let (s, _v) = get(
        &app,
        &format!("/api/einsaetze/{eid}/ort-vorschau?lat=50.9&lon=10.0"),
        &gast,
    )
    .await;
    assert!(
        s.is_client_error(),
        "Nicht-Mitglied darf nicht lesen, war {s}"
    );
}

#[tokio::test]
async fn ohne_login_ist_401() {
    let (app, pool, _kd) = setup_mit_pool().await;
    let eid = einsatz_mit_einsatzort(&pool).await;
    let resp = app
        .clone()
        .oneshot(
            Request::builder()
                .method("GET")
                .uri(format!(
                    "/api/einsaetze/{eid}/ort-vorschau?lat=50.9&lon=10.0"
                ))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn ortsname_aus_cache_ohne_netz() {
    let (app, pool, kd) = setup_mit_pool().await;
    let cookie = login_cookie(&app, "admin", "startpw12").await;
    let eid = einsatz_mit_einsatzort(&pool).await;
    // Cache vorbefüllen — in der ausgelagerten Cache-DB (F09/LFH-240), wo der Handler jetzt liest;
    // per-Pfad memoisiert liefert cache_pool(kd) denselben Pool wie der Handler (state.karten_dir=kd).
    let (la, lo) = lifeline_hub::geocoding::cache::schluessel(50.9, 10.0);
    let cache = lifeline_hub::cache_db::cache_pool(&kd).await.unwrap();
    lifeline_hub::geocoding::cache::schreibe(&cache, la, lo, "Teststr. 1, Musterstadt").await;

    let (s, v) = get(
        &app,
        &format!("/api/einsaetze/{eid}/ort-vorschau?lat=50.9&lon=10.0"),
        &cookie,
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(v["ortsname"].as_str(), Some("Teststr. 1, Musterstadt"));
    assert_eq!(v["peilung"]["richtung"].as_str(), Some("N")); // Peilung steht weiterhin
}

#[tokio::test]
async fn out_of_range_koordinate_ist_400() {
    let (app, pool, _kd) = setup_mit_pool().await;
    let cookie = login_cookie(&app, "admin", "startpw12").await;
    let eid = einsatz_mit_einsatzort(&pool).await;
    // lat=999 liegt außerhalb des gültigen Bereichs (-90..=90) → Handler gibt 400 zurück.
    let (s, _v) = get(
        &app,
        &format!("/api/einsaetze/{eid}/ort-vorschau?lat=999&lon=10.0"),
        &cookie,
    )
    .await;
    assert_eq!(s, StatusCode::BAD_REQUEST);
}
