//! Ortssuche des Ortsfelds (LFH-1175, Spec `ortsfeld`): Einstieg im Einsatz
//! `GET /api/einsaetze/{id}/ort-suche?q=` (Recht der Einsatzdaten, kein Lagekarten-Recht) und in
//! der Organisation `GET /api/ort-suche?q=` (wer Einsätze anlegen darf).
//!
//! Der Token-Bucket des Geocoders ist prozessweit (1 Anfrage/s) und gilt für alle Tests dieser
//! Binärdatei. Deshalb fragt genau EIN Test den Geocoder, der Reihe nach mit Pausen; die übrigen
//! enden vor dem Geocoder (400, 403) und zählen am Stub nach, dass er still blieb.

use axum::http::StatusCode;
use serde_json::Value;
use std::sync::{Arc, Mutex};
use std::time::Duration;

mod common;
use common::{
    anfrage, benutzer_anlegen, einsatz_anlegen, fremde_org_anlegen, login_cookie, rolle_setzen,
    setup_mit_pool,
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

async fn geocoder_setzen(pool: &sqlx::SqlitePool, org_id: i64, url: &str) {
    sqlx::query(
        "INSERT INTO org_einstellungen (org_id, geocoder_url) VALUES (?, ?) \
         ON CONFLICT(org_id) DO UPDATE SET geocoder_url = excluded.geocoder_url",
    )
    .bind(org_id)
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

/// Lagekarte im Einsatz für alle ausblenden (Modul-Override).
async fn lagekarte_ausblenden(app: &axum::Router, admin: &str, einsatz: i64) {
    let (status, json) = anfrage(
        app,
        "PUT",
        &format!("/api/einsaetze/{einsatz}/modul-overrides/lagekarte"),
        admin,
        Some(r#"{"sichtbar":false,"benoetigte_rolle":null}"#),
    )
    .await;
    assert!(status.is_success(), "Override setzen: {status} {json:?}");
}

fn im_einsatz(einsatz: i64, q: &str) -> String {
    format!("/api/einsaetze/{einsatz}/ort-suche?q={}", url_kodieren(q))
}

fn in_org(q: &str) -> String {
    format!("/api/ort-suche?q={}", url_kodieren(q))
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
    serde_json::json!([{
        "lat": "51.1604", "lon": "10.4514",
        "display_name": "Hauptstraße 12, Musterstadt, Landkreis X, Niedersachsen, 12345, Deutschland",
        "address": { "road": "Hauptstraße", "house_number": "12", "postcode": "12345", "town": "Musterstadt" }
    }])
}

#[tokio::test]
async fn suchtext_unter_drei_oder_ueber_200_zeichen_ist_400_ohne_geocoder() {
    let (app, pool) = setup_mit_pool().await;
    let (base, aufrufe) = such_stub(stub_treffer()).await;
    geocoder_setzen(&pool, 1, &base).await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;

    for q in ["ab", "  ab  ", &"x".repeat(201)] {
        for pfad in [im_einsatz(einsatz, q), in_org(q)] {
            let (status, json) = anfrage(&app, "GET", &pfad, &admin, None).await;
            assert_eq!(status, StatusCode::BAD_REQUEST, "{pfad}: {json:?}");
            assert!(json["error"].is_string(), "{json:?}");
        }
    }
    for pfad in [
        format!("/api/einsaetze/{einsatz}/ort-suche"),
        "/api/ort-suche".to_string(),
    ] {
        let (status, json) = anfrage(&app, "GET", &pfad, &admin, None).await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "{pfad}: {json:?}");
    }
    assert!(aufrufe.lock().unwrap().is_empty());
}

#[tokio::test]
async fn beobachter_ist_403_ohne_geocoder() {
    let (app, pool) = setup_mit_pool().await;
    let (base, aufrufe) = such_stub(stub_treffer()).await;
    geocoder_setzen(&pool, 1, &base).await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let erika_id = benutzer_anlegen(&app, &admin, "erika", "keine").await;
    rolle_setzen(&app, &admin, einsatz, erika_id, "beobachter").await;
    let erika = login_cookie(&app, "erika", "erikapw1").await;

    let (status, _) = anfrage(
        &app,
        "GET",
        &im_einsatz(einsatz, "Hauptstraße 12"),
        &erika,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    assert!(aufrufe.lock().unwrap().is_empty());
}

#[tokio::test]
async fn fremde_org_ist_403_ohne_geocoder() {
    let (app, pool) = setup_mit_pool().await;
    let (base, aufrufe) = such_stub(stub_treffer()).await;
    geocoder_setzen(&pool, 1, &base).await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    fremde_org_anlegen(&pool, "Andere", "andere", "anderepw1", "fuehrungskraft").await;
    let andere = login_cookie(&app, "andere", "anderepw1").await;

    let (status, _) = anfrage(
        &app,
        "GET",
        &im_einsatz(einsatz, "Hauptstraße 12"),
        &andere,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    assert!(aufrufe.lock().unwrap().is_empty());
}

#[tokio::test]
async fn org_suche_ohne_anlegerecht_ist_403_ohne_geocoder() {
    let (app, pool) = setup_mit_pool().await;
    let (base, aufrufe) = such_stub(stub_treffer()).await;
    geocoder_setzen(&pool, 1, &base).await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    benutzer_anlegen(&app, &admin, "helfer", "keine").await;
    let helfer = login_cookie(&app, "helfer", "helferpw1").await;

    let (status, _) = anfrage(&app, "GET", &in_org("Hauptstraße 12"), &helfer, None).await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    assert!(aufrufe.lock().unwrap().is_empty());
}

/// Der einzige Test, der den Geocoder fragt (s. Modulkopf). Zwischen den Anfragen gut eine
/// Sekunde, damit der geteilte Token-Bucket nachfüllt; jede Anfrage mit eigenem Begriff (Cache).
#[tokio::test]
async fn treffer_umgebung_org_grenze_und_ausfall() {
    let (app, pool) = setup_mit_pool().await;
    let (base, aufrufe) = such_stub(stub_treffer()).await;
    geocoder_setzen(&pool, 1, &base).await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    einsatzort_setzen(&pool, einsatz, 51.0, 10.0).await;

    // Führungspersonal ohne Lagekarte: die Lagekarten-Suche sperrt, die Ortssuche nicht.
    let fritz_id = benutzer_anlegen(&app, &admin, "fritz", "keine").await;
    rolle_setzen(&app, &admin, einsatz, fritz_id, "fuehrungspersonal").await;
    let fritz = login_cookie(&app, "fritz", "fritzpw1").await;
    lagekarte_ausblenden(&app, &admin, einsatz).await;
    let (status, _) = anfrage(
        &app,
        "GET",
        &format!("/api/einsaetze/{einsatz}/karte/ort-suche?q=abc"),
        &fritz,
        None,
    )
    .await;
    assert_eq!(
        status,
        StatusCode::FORBIDDEN,
        "Vorbedingung: ohne Lagekarte"
    );

    // 1. Im Einsatz: Treffer mit Kurzadresse, Umgebung des Einsatzorts.
    let (status, json) = anfrage(
        &app,
        "GET",
        &im_einsatz(einsatz, "Hauptstraße 12"),
        &fritz,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{json:?}");
    assert_eq!(json["zustand"], "ok");
    assert_eq!(
        json["treffer"][0]["kurz"],
        "Hauptstraße 12, 12345 Musterstadt"
    );
    assert_eq!(json["treffer"][0]["lat"], 51.1604);
    {
        let a = aufrufe.lock().unwrap();
        assert_eq!(a.len(), 1);
        assert!(
            a[0].contains("viewbox=9.750%2C51.250%2C10.250%2C50.750"),
            "{}",
            a[0]
        );
    }

    // 2. In der Organisation als Führungskraft: Treffer, keine Umgebung.
    benutzer_anlegen(&app, &admin, "fuehrung", "fuehrungskraft").await;
    let fk = login_cookie(&app, "fuehrung", "fuehrungpw1").await;
    tokio::time::sleep(Duration::from_millis(1100)).await;
    let (status, json) = anfrage(&app, "GET", &in_org("Bahnhofstraße 1"), &fk, None).await;
    assert_eq!(status, StatusCode::OK, "{json:?}");
    assert_eq!(json["zustand"], "ok");
    assert_eq!(json["treffer"].as_array().unwrap().len(), 1);
    {
        let a = aufrufe.lock().unwrap();
        assert_eq!(a.len(), 2);
        assert!(!a[1].contains("viewbox"), "{}", a[1]);
    }

    // 3. Org-Grenze: die Führungskraft einer anderen Org fragt deren Geocoder, nicht unseren.
    let (base_fremd, aufrufe_fremd) = such_stub(stub_treffer()).await;
    let (fremd_org, _) =
        fremde_org_anlegen(&pool, "Andere", "andere", "anderepw1", "fuehrungskraft").await;
    geocoder_setzen(&pool, fremd_org, &base_fremd).await;
    let andere = login_cookie(&app, "andere", "anderepw1").await;
    tokio::time::sleep(Duration::from_millis(1100)).await;
    let (status, json) = anfrage(&app, "GET", &in_org("Marktplatz 3"), &andere, None).await;
    assert_eq!(status, StatusCode::OK, "{json:?}");
    assert_eq!(aufrufe_fremd.lock().unwrap().len(), 1);
    assert_eq!(aufrufe.lock().unwrap().len(), 2);

    // 4. Toter Geocoder: 200 mit Zustand, keine Treffer, an beiden Einstiegen.
    geocoder_setzen(&pool, 1, &geschlossener_geocoder()).await;
    for (pfad, cookie) in [
        (im_einsatz(einsatz, "Kirchweg 5"), &fritz),
        (in_org("Kirchweg 6"), &fk),
    ] {
        tokio::time::sleep(Duration::from_millis(1100)).await;
        let (status, json) = anfrage(&app, "GET", &pfad, cookie, None).await;
        assert_eq!(status, StatusCode::OK, "{pfad}: {json:?}");
        assert_eq!(json["zustand"], "nicht_erreichbar");
        assert_eq!(json["treffer"], serde_json::json!([]));
    }
}
