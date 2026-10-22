use axum::body::{to_bytes, Body};
use axum::http::{header, Request, StatusCode};
use lifeline_hub::db;
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
    let kd = db::test_karten_dir();
    let (router, pool) = common::setup_mit_state(|s| s.karten_dir = kd.clone()).await;
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
    common::zwang_aufheben("gast").await;
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

// ---------------------------------------------------------------------------------------------
// Einstieg ohne Einsatz: GET /api/ort-vorschau?lat=&lon= (LLH-1376, Spec `ortsfeld`, „Ortsname
// als Vorschlag“). Wer Einsätze anlegen darf; nur der Ortsname, keine Peilung (kein Bezugspunkt).
// ---------------------------------------------------------------------------------------------

/// Stub für `/reverse`: antwortet mit `display_name` und zählt die Aufrufe.
async fn reverse_stub(
    display_name: &str,
) -> (String, std::sync::Arc<std::sync::atomic::AtomicUsize>) {
    use std::sync::atomic::{AtomicUsize, Ordering};
    let zaehler = std::sync::Arc::new(AtomicUsize::new(0));
    let z = zaehler.clone();
    let name = display_name.to_string();
    let app = axum::Router::new().route(
        "/reverse",
        axum::routing::get(move || {
            let z = z.clone();
            let name = name.clone();
            async move {
                z.fetch_add(1, Ordering::SeqCst);
                axum::Json(serde_json::json!({ "display_name": name }))
            }
        }),
    );
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move {
        axum::serve(listener, app).await.ok();
    });
    (format!("http://{addr}"), zaehler)
}

async fn geocoder_setzen(pool: &sqlx::SqlitePool, url: &str) {
    sqlx::query("UPDATE org_einstellungen SET geocoder_url = ? WHERE org_id = 1")
        .bind(url)
        .execute(pool)
        .await
        .unwrap();
}

#[tokio::test]
async fn org_vorschau_ohne_anlegerecht_ist_403_ohne_geocoder() {
    let (app, pool, _kd) = setup_mit_pool().await;
    let (base, aufrufe) = reverse_stub("Marktplatz 3, Musterstadt").await;
    geocoder_setzen(&pool, &base).await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    common::benutzer_anlegen(&app, &admin, "helfer", "keine").await;
    let helfer = login_cookie(&app, "helfer", "helferpw1").await;

    // Das Recht kommt vor der Koordinate: auch eine ungültige ist ohne Recht 403, nie 400.
    for uri in [
        "/api/ort-vorschau?lat=50.71&lon=9.71",
        "/api/ort-vorschau?lat=999&lon=9.71",
    ] {
        let (s, _v) = get(&app, uri, &helfer).await;
        assert_eq!(s, StatusCode::FORBIDDEN, "{uri}");
    }
    assert_eq!(aufrufe.load(std::sync::atomic::Ordering::SeqCst), 0);
}

#[tokio::test]
async fn org_vorschau_liefert_den_ortsnamen_ohne_peilung() {
    let (app, pool, kd) = setup_mit_pool().await;
    // Ein Einsatz mit verortetem Einsatzort darf keine Peilung erzeugen: ohne Einsatz kein Bezug.
    einsatz_mit_einsatzort(&pool).await;
    let (la, lo) = lifeline_hub::geocoding::cache::schluessel(50.72, 9.72);
    let cache = lifeline_hub::cache_db::cache_pool(&kd).await.unwrap();
    lifeline_hub::geocoding::cache::schreibe(&cache, la, lo, "Lindenweg 2, Musterdorf").await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    common::benutzer_anlegen(&app, &admin, "fuehrung", "fuehrungskraft").await;
    let fk = login_cookie(&app, "fuehrung", "fuehrungpw1").await;

    let (s, v) = get(&app, "/api/ort-vorschau?lat=50.72&lon=9.72", &fk).await;
    assert_eq!(s, StatusCode::OK, "{v:?}");
    assert_eq!(v["ortsname"].as_str(), Some("Lindenweg 2, Musterdorf"));
    assert!(
        !v.as_object().unwrap().contains_key("peilung"),
        "peilung muss ABSENT sein: {v:?}"
    );
}

/// „Nicht erreichbar“ und „ausgelastet“ sind 200 ohne Ortsname, nie ein Fehlerstatus. Zwei
/// Anfragen im selben Augenblick an einen antwortenden Geocoder: der Token-Bucket (1/s,
/// prozessweit) lässt höchstens eine durch, die andere kommt ausgelastet zurück.
#[tokio::test]
async fn org_vorschau_ausgelastet_oder_nicht_erreichbar_ist_200_ohne_ortsname() {
    let (app, pool, _kd) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;

    // Nicht erreichbar (geschlossener Port aus `setup_mit_pool`).
    let (s, v) = get(&app, "/api/ort-vorschau?lat=50.73&lon=9.73", &admin).await;
    assert_eq!(s, StatusCode::OK, "{v:?}");
    assert_eq!(v, serde_json::json!({}));

    // Ausgelastet.
    let (base, aufrufe) = reverse_stub("Am Anger 1, Musterdorf").await;
    geocoder_setzen(&pool, &base).await;
    let (a, b) = tokio::join!(
        get(&app, "/api/ort-vorschau?lat=50.74&lon=9.74", &admin),
        get(&app, "/api/ort-vorschau?lat=50.75&lon=9.75", &admin),
    );
    assert_eq!((a.0, b.0), (StatusCode::OK, StatusCode::OK));
    assert!(aufrufe.load(std::sync::atomic::Ordering::SeqCst) <= 1);
    let ohne_namen = [&a.1, &b.1]
        .iter()
        .filter(|v| !v.as_object().unwrap().contains_key("ortsname"))
        .count();
    assert!(
        ohne_namen >= 1,
        "eine Anfrage muss ausgelastet sein: {a:?} {b:?}"
    );
}

#[tokio::test]
async fn org_vorschau_ungueltige_koordinate_ist_400_ohne_login_401() {
    let (app, _pool, _kd) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let (s, _v) = get(&app, "/api/ort-vorschau?lat=10&lon=181", &admin).await;
    assert_eq!(s, StatusCode::BAD_REQUEST);
    let (s, _v) = get(&app, "/api/ort-vorschau?lat=50.7&lon=9.7", "").await;
    assert_eq!(s, StatusCode::UNAUTHORIZED);
}
