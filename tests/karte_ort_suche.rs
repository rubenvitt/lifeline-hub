//! Adresssuche der Lagekarte (LFH-638, Spec `lagekarte-ortssuche`):
//! `GET /api/einsaetze/{id}/karte/ort-suche?q=`.
//!
//! Der Token-Bucket des Geocoders ist prozessweit (1 Anfrage/s) und gilt für alle Tests dieser
//! Binärdatei. Deshalb fragt genau EIN Test den Geocoder, und das der Reihe nach mit Pausen; die
//! übrigen enden vor dem Geocoder (400, 403) und zählen am Stub nach, dass er still blieb.

use axum::http::StatusCode;
use serde_json::Value;
use std::sync::{Arc, Mutex};
use std::time::Duration;

mod common;
use common::{
    anfrage, benutzer_anlegen, einsatz_anlegen, login_cookie, rolle_setzen, setup_mit_pool,
};

/// Stub für `/search`: zählt Aufrufe und merkt sich die rohen Query-Strings.
async fn such_stub(antwort: Value) -> (String, Arc<Mutex<Vec<String>>>) {
    let aufrufe: Arc<Mutex<Vec<String>>> = Arc::new(Mutex::new(Vec::new()));
    let mitschnitt = aufrufe.clone();
    let app = axum::Router::new().route(
        "/search",
        axum::routing::get(move |uri: axum::http::Uri| {
            let a = antwort.clone();
            let m = mitschnitt.clone();
            async move {
                m.lock()
                    .unwrap()
                    .push(uri.query().unwrap_or_default().to_string());
                axum::Json(a)
            }
        }),
    );
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move {
        axum::serve(listener, app).await.ok();
    });
    (format!("http://{addr}"), aufrufe)
}

fn geschlossener_geocoder() -> String {
    let l = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let port = l.local_addr().unwrap().port();
    drop(l);
    format!("http://127.0.0.1:{port}")
}

async fn geocoder_setzen(pool: &sqlx::SqlitePool, url: &str) {
    sqlx::query(
        "INSERT INTO org_einstellungen (org_id, geocoder_url) VALUES (1, ?) \
         ON CONFLICT(org_id) DO UPDATE SET geocoder_url = excluded.geocoder_url",
    )
    .bind(url)
    .execute(pool)
    .await
    .unwrap();
}

async fn einsatzort_setzen(pool: &sqlx::SqlitePool, einsatz: i64, lat: f64, lon: f64) {
    sqlx::query("UPDATE einsatz SET einsatzort_lat = ?, einsatzort_lon = ? WHERE id = ?")
        .bind(lat)
        .bind(lon)
        .bind(einsatz)
        .execute(pool)
        .await
        .unwrap();
}

fn uri(einsatz: i64, q: &str) -> String {
    let kodiert: String = url_kodieren(q);
    format!("/api/einsaetze/{einsatz}/karte/ort-suche?q={kodiert}")
}

/// Minimal-Kodierung für die Testeingaben (Leerzeichen, Komma, Umlaute).
fn url_kodieren(s: &str) -> String {
    s.bytes()
        .map(|b| match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'.' | b'_' | b'~' => {
                (b as char).to_string()
            }
            _ => format!("%{b:02X}"),
        })
        .collect()
}

fn stub_treffer() -> Value {
    serde_json::json!([
        { "lat": "51.1604", "lon": "10.4514", "display_name": "Hauptstraße 12, Musterstadt" }
    ])
}

#[tokio::test]
async fn suchtext_unter_drei_oder_ueber_200_zeichen_ist_400_ohne_geocoder() {
    let (app, pool) = setup_mit_pool().await;
    let (base, aufrufe) = such_stub(stub_treffer()).await;
    geocoder_setzen(&pool, &base).await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;

    for q in ["ab", "  ab  ", &"x".repeat(201)] {
        let (status, json) = anfrage(&app, "GET", &uri(einsatz, q), &admin, None).await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "{q:?}: {json:?}");
        assert!(json["error"].is_string(), "{json:?}");
    }
    // Fehlender Parameter: ebenfalls 400 im `{error}`-Format.
    let (status, json) = anfrage(
        &app,
        "GET",
        &format!("/api/einsaetze/{einsatz}/karte/ort-suche"),
        &admin,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST, "{json:?}");
    assert!(json["error"].is_string(), "{json:?}");
    assert!(aufrufe.lock().unwrap().is_empty());
}

#[tokio::test]
async fn ohne_lagekarte_modul_ist_403_ohne_geocoder() {
    let (app, pool) = setup_mit_pool().await;
    let (base, aufrufe) = such_stub(stub_treffer()).await;
    geocoder_setzen(&pool, &base).await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let erika_id = benutzer_anlegen(&app, &admin, "erika", "keine").await;
    rolle_setzen(&app, &admin, einsatz, erika_id, "beobachter").await;
    let erika = login_cookie(&app, "erika", "erikapw1").await;

    // Mit Modul: die Route ist erreichbar (400 am Suchtext beweist den Durchgang ohne Geocoder).
    let (status, _) = anfrage(&app, "GET", &uri(einsatz, "ab"), &erika, None).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);

    let (status, json) = anfrage(
        &app,
        "PUT",
        &format!("/api/einsaetze/{einsatz}/modul-overrides/lagekarte"),
        &admin,
        Some(r#"{"sichtbar":false,"benoetigte_rolle":null}"#),
    )
    .await;
    assert!(status.is_success(), "Override setzen: {status} {json:?}");

    let (status, _) = anfrage(&app, "GET", &uri(einsatz, "Hauptstraße 12"), &erika, None).await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    assert!(aufrufe.lock().unwrap().is_empty());
}

#[tokio::test]
async fn nichtmitglied_ist_403() {
    let (app, pool) = setup_mit_pool().await;
    let (base, aufrufe) = such_stub(stub_treffer()).await;
    geocoder_setzen(&pool, &base).await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    benutzer_anlegen(&app, &admin, "fremd", "keine").await;
    let fremd = login_cookie(&app, "fremd", "fremdpw1").await;
    let (status, _) = anfrage(&app, "GET", &uri(einsatz, "Hauptstraße 12"), &fremd, None).await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    assert!(aufrufe.lock().unwrap().is_empty());
}

/// Der einzige Test, der den Geocoder fragt (s. Modulkopf): Treffer mit und ohne Einsatzort,
/// danach der tote Geocoder. Zwischen den Anfragen eine Sekunde, damit der geteilte
/// Token-Bucket nachfüllt.
#[tokio::test]
async fn treffer_viewbox_und_ausfall() {
    let (app, pool) = setup_mit_pool().await;
    let (base, aufrufe) = such_stub(stub_treffer()).await;
    geocoder_setzen(&pool, &base).await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;

    // 1. Ohne verorteten Einsatzort: Treffer, keine Viewbox.
    let (status, json) = anfrage(&app, "GET", &uri(einsatz, "Hauptstraße 12"), &admin, None).await;
    assert_eq!(status, StatusCode::OK, "{json:?}");
    assert_eq!(json["zustand"], "ok");
    assert_eq!(
        json["treffer"],
        serde_json::json!([
            { "lat": 51.1604, "lon": 10.4514, "name": "Hauptstraße 12, Musterstadt" }
        ])
    );
    {
        let a = aufrufe.lock().unwrap();
        assert_eq!(a.len(), 1);
        assert!(!a[0].contains("viewbox"), "{}", a[0]);
    }

    // 2. Mit Einsatzort: Viewbox ±0,25° um ihn, bounded=0. Anderer Begriff (Cache).
    einsatzort_setzen(&pool, einsatz, 51.0, 10.0).await;
    tokio::time::sleep(Duration::from_millis(1100)).await;
    let (status, json) = anfrage(&app, "GET", &uri(einsatz, "Bahnhofstraße 1"), &admin, None).await;
    assert_eq!(status, StatusCode::OK, "{json:?}");
    assert_eq!(json["zustand"], "ok");
    {
        let a = aufrufe.lock().unwrap();
        assert_eq!(a.len(), 2);
        assert!(
            a[1].contains("viewbox=9.750%2C51.250%2C10.250%2C50.750"),
            "{}",
            a[1]
        );
        assert!(a[1].contains("bounded=0"), "{}", a[1]);
    }

    // 3. Toter Geocoder: 200 mit Zustand, keine Treffer.
    geocoder_setzen(&pool, &geschlossener_geocoder()).await;
    tokio::time::sleep(Duration::from_millis(1100)).await;
    let (status, json) = anfrage(&app, "GET", &uri(einsatz, "Marktplatz 3"), &admin, None).await;
    assert_eq!(status, StatusCode::OK, "{json:?}");
    assert_eq!(json["zustand"], "nicht_erreichbar");
    assert_eq!(json["treffer"], serde_json::json!([]));
}
