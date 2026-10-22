//! Ortssuche aus dem Adressindex der Offline-Karten (LLH-1119, Spec `lagekarte-ortssuche`,
//! „Adresssuche aus der Offline-Karte“): ohne Netz an allen drei Einstiegen, lokale Treffer vorn,
//! Geocoder ergänzt ohne Duplikate, und mit vollen lokalen Plätzen geht nichts hinaus.
//!
//! Eigene Binärdatei: der Token-Bucket des Geocoders ist prozessweit (1 Anfrage/s). Die Anfragen,
//! die den Geocoder erreichen, laufen in EINEM Test der Reihe nach mit Pausen.

use axum::http::StatusCode;
use serde_json::Value;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::Duration;

mod common;
use common::{anfrage, einsatz_anlegen, login_cookie};

/// Stub für `/search`: zählt Aufrufe.
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

/// App mit eigenem Kartenverzeichnis, darin der Fixture-Index „Testgebiet“.
async fn setup_mit_index() -> (axum::Router, sqlx::SqlitePool, PathBuf) {
    let kd = lifeline_hub::db::test_karten_dir();
    std::fs::copy(
        std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("tests/fixtures/adressindex/testgebiet.adressen.sqlite"),
        kd.join("testgebiet.adressen.sqlite"),
    )
    .unwrap();
    let k = kd.clone();
    let (app, pool) = common::setup_mit_state(move |s| s.karten_dir = k).await;
    (app, pool, kd)
}

fn kodiert(s: &str) -> String {
    s.bytes()
        .map(|b| match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'.' | b'_' | b'~' => {
                (b as char).to_string()
            }
            _ => format!("%{b:02X}"),
        })
        .collect()
}

fn namen_und_quellen(json: &Value) -> Vec<(String, String)> {
    json["treffer"]
        .as_array()
        .unwrap()
        .iter()
        .map(|t| {
            (
                t["name"].as_str().unwrap().to_string(),
                t["quelle"].as_str().unwrap().to_string(),
            )
        })
        .collect()
}

/// Akzeptanzkriterium: ohne Netz findet die Ortssuche „Hauptstraße 12, Musterstadt“ — an allen
/// drei Einstiegen. Danach mit Netz: lokaler Treffer vorn, der Geocoder ergänzt, sein Duplikat
/// fällt weg.
#[tokio::test]
async fn ohne_netz_an_allen_einstiegen_mit_netz_lokal_vorn() {
    let (app, pool, _kd) = setup_mit_index().await;
    geocoder_setzen(&pool, &geschlossener_geocoder()).await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let q = kodiert("Hauptstraße 12, Musterstadt");

    for pfad in [
        format!("/api/einsaetze/{einsatz}/karte/ort-suche?q={q}"),
        format!("/api/einsaetze/{einsatz}/ort-suche?q={q}"),
        format!("/api/ort-suche?q={q}"),
    ] {
        let (status, json) = anfrage(&app, "GET", &pfad, &admin, None).await;
        assert_eq!(status, StatusCode::OK, "{pfad}: {json:?}");
        // Geocoder nicht erreichbar, aber lokale Treffer: der Zustand ist „ok“.
        assert_eq!(json["zustand"], "ok", "{pfad}");
        assert_eq!(
            namen_und_quellen(&json),
            [(
                "Hauptstraße 12, 12345 Musterstadt".to_string(),
                "offline_karte".to_string()
            )],
            "{pfad}"
        );
        assert_eq!(json["treffer"][0]["lat"], 52.62);
        assert_eq!(json["treffer"][0]["lon"], 13.78);
        tokio::time::sleep(Duration::from_millis(1100)).await;
    }

    // Ohne lokalen Treffer und ohne Netz bleibt es bei „nicht erreichbar“.
    let (_, json) = anfrage(
        &app,
        "GET",
        &format!("/api/ort-suche?q={}", kodiert("Marktplatz 3, Anderswo")),
        &admin,
        None,
    )
    .await;
    assert_eq!(json["zustand"], "nicht_erreichbar");
    assert_eq!(json["treffer"].as_array().unwrap().len(), 0);
    tokio::time::sleep(Duration::from_millis(1100)).await;

    // Mit Netz: der Geocoder liefert den Ort ein zweites Mal (15 m daneben) und einen weiteren.
    let (base, aufrufe) = such_stub(serde_json::json!([
        {
            "lat": "52.62013", "lon": "13.78",
            "display_name": "12, Hauptstraße, Musterstadt, Landkreis X, 12345, Deutschland",
            "address": { "road": "Hauptstraße", "house_number": "12", "postcode": "12345", "town": "Musterstadt" }
        },
        {
            "lat": "52.6300", "lon": "13.8000",
            "display_name": "Hauptstraße 12a, Musterstadt",
            "address": { "road": "Hauptstraße", "house_number": "12a", "postcode": "12345", "town": "Musterstadt" }
        }
    ]))
    .await;
    geocoder_setzen(&pool, &base).await;
    let (status, json) = anfrage(&app, "GET", &format!("/api/ort-suche?q={q}"), &admin, None).await;
    assert_eq!(status, StatusCode::OK, "{json:?}");
    assert_eq!(json["zustand"], "ok");
    assert_eq!(
        namen_und_quellen(&json),
        [
            (
                "Hauptstraße 12, 12345 Musterstadt".to_string(),
                "offline_karte".to_string()
            ),
            (
                "Hauptstraße 12a, Musterstadt".to_string(),
                "geocoder".to_string()
            ),
        ]
    );
    assert_eq!(aufrufe.lock().unwrap().len(), 1);
}

/// Datenschutz: füllen die lokalen Treffer alle fünf Plätze, geht keine Anfrage an den Geocoder.
#[tokio::test]
async fn volle_lokale_treffer_fragen_den_geocoder_nicht() {
    let (app, pool, _kd) = setup_mit_index().await;
    let (base, aufrufe) = such_stub(serde_json::json!([])).await;
    geocoder_setzen(&pool, &base).await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let (status, json) = anfrage(&app, "GET", "/api/ort-suche?q=Musterstadt", &admin, None).await;
    assert_eq!(status, StatusCode::OK, "{json:?}");
    let t = namen_und_quellen(&json);
    assert_eq!(t.len(), 5, "{t:?}");
    assert!(t.iter().all(|(_, q)| q == "offline_karte"), "{t:?}");
    // Der Ort selbst steht vorn.
    assert_eq!(t[0].0, "Musterstadt");
    assert!(aufrufe.lock().unwrap().is_empty());
}
