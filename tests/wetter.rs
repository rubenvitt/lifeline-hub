//! Integrationstests des Wetters am Einsatzort (LFH-633), `GET /api/einsaetze/{id}/wetter`.
//!
//! Spec: `openspec/changes/lfh-633-fachmodul-wetter-pegel/specs/lage-wetter-pegel/spec.md`.
//!
//! **Kein Test geht ins Netz.** Jeder Router bekommt eine Bright-Sky-Attrappe auf
//! `127.0.0.1` (oder eine tote Adresse) und ein EIGENES `karten_dir` (Tempdir): der
//! Nachschlage-Cache ist je Pfad prozessweit memoisiert, und die Schlüssel hängen nur an der
//! gerundeten Koordinate — mit einem geteilten Verzeichnis sickerten Stände von Test zu Test.
//! Alle Zeitpunkte der Attrappe sind relativ zu `Utc::now()`, damit die Suite nicht altert.

use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};

use axum::http::StatusCode;
use chrono::{SecondsFormat, Utc};
use lifeline_hub::app::{build_router, AppState};
use lifeline_hub::auth::bootstrap::bootstrap_admin;
use serde_json::{json, Value};

mod common;
use common::*;

struct Umgebung {
    app: axum::Router,
    pool: sqlx::SqlitePool,
    _dir: tempfile::TempDir,
}

async fn setup_mit_basis(basis: &str) -> Umgebung {
    let pool = lifeline_hub::db::test_pool().await;
    bootstrap_admin(&pool, "Test-Orga", "admin", Some("startpw12"))
        .await
        .unwrap();
    let dir = tempfile::tempdir().unwrap();
    let app = build_router(AppState {
        pool: pool.clone(),
        live: lifeline_hub::live::LiveHub::new(),
        karten_dir: dir.path().to_path_buf(),
        fachebenen: lifeline_hub::karte::FachebenenState::neu()
            .mit_pegel_basis_url("http://127.0.0.1:1")
            .mit_wetter_basis_url(basis),
        download_client: lifeline_hub::karte::download::download_client(),
        download_fortschritt: lifeline_hub::karte::download::neue_fortschritt_map(),
        karten_service_url: None,
        karten_service_token: None,
    });
    Umgebung {
        app,
        pool,
        _dir: dir,
    }
}

/// Bright-Sky-Attrappe: `/alerts` und `/weather` mit festen Körpern, jede Anfrage gezählt
/// und ihre Anfragezeile mitgeschrieben.
struct Attrappe {
    basis: String,
    anfragen: Arc<Mutex<Vec<String>>>,
    zaehler: Arc<AtomicUsize>,
}

async fn attrappe(alerts: Value, weather: Value) -> Attrappe {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let basis = format!("http://{}", listener.local_addr().unwrap());
    let anfragen = Arc::new(Mutex::new(Vec::new()));
    let zaehler = Arc::new(AtomicUsize::new(0));
    let (a2, z2) = (anfragen.clone(), zaehler.clone());
    tokio::spawn(async move {
        while let Ok((mut sock, _)) = listener.accept().await {
            let (a2, z2) = (a2.clone(), z2.clone());
            let (alerts, weather) = (alerts.clone(), weather.clone());
            tokio::spawn(async move {
                z2.fetch_add(1, Ordering::SeqCst);
                let mut puffer = vec![0u8; 4096];
                let n = sock.read(&mut puffer).await.unwrap_or(0);
                let zeile = String::from_utf8_lossy(&puffer[..n])
                    .lines()
                    .next()
                    .unwrap_or_default()
                    .to_string();
                let body = if zeile.contains("/alerts") {
                    alerts.to_string()
                } else {
                    weather.to_string()
                };
                a2.lock().unwrap().push(zeile);
                let antwort = format!(
                    "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\n\
                     Content-Length: {}\r\nConnection: close\r\n\r\n{body}",
                    body.len()
                );
                let _ = sock.write_all(antwort.as_bytes()).await;
            });
        }
    });
    Attrappe {
        basis,
        anfragen,
        zaehler,
    }
}

fn zeit(h: i64) -> String {
    (Utc::now() + chrono::Duration::hours(h)).to_rfc3339_opts(SecondsFormat::Secs, true)
}

fn volle_stunde(h: i64) -> String {
    let jetzt = Utc::now();
    let beginn = jetzt - chrono::Duration::seconds(jetzt.timestamp().rem_euclid(3600));
    (beginn + chrono::Duration::hours(h)).to_rfc3339_opts(SecondsFormat::Secs, true)
}

/// Warnungen wie Bright Sky sie liefert: eine gilt jetzt (mäßig), eine ist angekündigt
/// (schwer), eine ist abgelaufen, eine ist `health`.
fn alerts() -> Value {
    json!({
        "alerts": [
            { "id": 1, "category": "met", "severity": "moderate", "event_de": "STURMBÖEN",
              "headline_de": "Amtliche WARNUNG vor STURMBÖEN",
              "description_de": "Es treten Sturmböen auf.",
              "instruction_de": "Gegenstände sichern.",
              "effective": zeit(-2), "onset": zeit(-1), "expires": zeit(2) },
            { "id": 2, "category": "met", "severity": "severe", "event_de": "ORKANARTIGE BÖEN",
              "headline_de": "Amtliche UNWETTERWARNUNG vor ORKANARTIGEN BÖEN",
              "description_de": null, "instruction_de": null,
              "effective": zeit(-1), "onset": zeit(3), "expires": zeit(6) },
            { "id": 3, "category": "met", "severity": "minor", "event_de": "WINDBÖEN",
              "headline_de": "Amtliche WARNUNG vor WINDBÖEN",
              "effective": zeit(-6), "onset": zeit(-5), "expires": zeit(-1) },
            { "id": 4, "category": "health", "severity": "moderate", "event_de": "HITZE",
              "headline_de": "Amtliche WARNUNG vor HITZE",
              "effective": zeit(-1), "onset": zeit(-1), "expires": zeit(5) }
        ],
        "location": { "warn_cell_id": 704011001, "name": "Stadt Bremen",
                      "name_short": "Bremen", "district": "Bremen", "state": "Bremen",
                      "state_short": "HB" }
    })
}

/// 25 Stunden ab der NÄCHSTEN vollen Stunde: so fällt auch dann keine als vergangen weg,
/// wenn der Test über eine Stundengrenze läuft.
fn weather() -> Value {
    let stunden: Vec<Value> = (1..26)
        .map(|h| {
            json!({ "timestamp": volle_stunde(h), "source_id": 2977,
                    "temperature": 18.6, "precipitation": 0.0,
                    "precipitation_probability": if h == 2 { Value::Null } else { json!(20) },
                    "wind_speed": 11.1, "wind_gust_speed": 18.5, "wind_direction": 192 })
        })
        .collect();
    json!({
        "weather": stunden,
        "sources": [{ "id": 2977, "station_name": "BREMEN", "distance": 4200.0,
                      "observation_type": "forecast" }]
    })
}

fn pfad(einsatz: i64) -> String {
    format!("/api/einsaetze/{einsatz}/wetter")
}

/// Einsatzort per Kopfdaten-PATCH setzen. Bremen-Mitte, nicht auf einer Rundungsgrenze.
async fn ort_setzen(app: &axum::Router, cookie: &str, einsatz: i64) {
    let (status, json) = anfrage(
        app,
        "PATCH",
        &format!("/api/einsaetze/{einsatz}"),
        cookie,
        Some(r#"{"einsatzort_lat":53.0793,"einsatzort_lon":8.8017}"#),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{json:?}");
}

#[tokio::test]
async fn ohne_ort_kein_ort_und_keine_anfrage() {
    let a = attrappe(alerts(), weather()).await;
    let u = setup_mit_basis(&a.basis).await;
    let admin = login_cookie(&u.app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&u.app, &admin).await;

    let (status, json) = anfrage(&u.app, "GET", &pfad(einsatz), &admin, None).await;
    assert_eq!(status, StatusCode::OK, "{json:?}");
    assert_eq!(
        json,
        json!({
            "warnungen": { "zustand": "kein_ort" },
            "vorhersage": { "zustand": "kein_ort" }
        })
    );
    tokio::time::sleep(std::time::Duration::from_millis(100)).await;
    assert_eq!(a.zaehler.load(Ordering::SeqCst), 0, "kein Abruf ohne Ort");
}

#[tokio::test]
async fn mit_ort_warnungen_samt_gemeinde_und_vorhersage() {
    let roh = alerts();
    let wetter_roh = weather();
    let a = attrappe(roh.clone(), wetter_roh.clone()).await;
    let u = setup_mit_basis(&a.basis).await;
    let admin = login_cookie(&u.app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&u.app, &admin).await;
    ort_setzen(&u.app, &admin, einsatz).await;

    let (status, json) = anfrage(&u.app, "GET", &pfad(einsatz), &admin, None).await;
    assert_eq!(status, StatusCode::OK, "{json:?}");
    assert_eq!(
        json["ort"],
        json!({ "name": "Stadt Bremen", "kreis": "Bremen", "land": "Bremen" })
    );

    let w = &json["warnungen"];
    assert_eq!(w["zustand"], "ok");
    assert!(w["abgerufen_at"].as_str().unwrap().ends_with('Z'));
    let daten = w["daten"].as_array().unwrap();
    assert_eq!(daten.len(), 2, "abgelaufene und `health` fehlen: {daten:?}");
    // Stufe absteigend: die angekündigte Unwetterwarnung steht vorn.
    assert_eq!(daten[0]["stufe"], "schwer");
    assert_eq!(daten[0]["ereignis"], "ORKANARTIGE BÖEN");
    assert!(!daten[0].as_object().unwrap().contains_key("beschreibung"));
    assert_eq!(daten[1]["stufe"], "maessig");
    assert_eq!(daten[1]["ueberschrift"], "Amtliche WARNUNG vor STURMBÖEN");
    assert_eq!(daten[1]["beschreibung"], "Es treten Sturmböen auf.");
    assert_eq!(daten[1]["handlungsempfehlung"], "Gegenstände sichern.");
    assert_eq!(daten[1]["beginn"], roh["alerts"][0]["onset"]);
    assert_eq!(daten[1]["ende"], roh["alerts"][0]["expires"]);

    let v = &json["vorhersage"];
    assert_eq!(v["zustand"], "ok");
    assert_eq!(v["daten"]["station"], "BREMEN");
    assert_eq!(v["daten"]["entfernung_m"], 4200.0);
    let stunden = v["daten"]["stunden"].as_array().unwrap();
    assert_eq!(stunden.len(), 25);
    assert_eq!(
        stunden[0]["zeitpunkt"],
        wetter_roh["weather"][0]["timestamp"]
    );
    assert_eq!(stunden[0]["niederschlag_wahrscheinlichkeit"], 20.0);
    assert!(
        !stunden[1]
            .as_object()
            .unwrap()
            .contains_key("niederschlag_wahrscheinlichkeit"),
        "ein fehlender Wert fehlt, er wird nicht 0"
    );

    // Nur die gerundete Koordinate geht an die Quelle, und ein zweiter Aufruf kommt aus dem
    // Cache.
    let anfragen = a.anfragen.lock().unwrap().clone();
    assert_eq!(anfragen.len(), 2, "{anfragen:?}");
    assert!(
        anfragen
            .iter()
            .all(|z| z.contains("lat=53.08&lon=8.80") && !z.contains("53.079")),
        "{anfragen:?}"
    );
    anfrage(&u.app, "GET", &pfad(einsatz), &admin, None).await;
    assert_eq!(a.zaehler.load(Ordering::SeqCst), 2, "frisch aus dem Cache");
}

#[tokio::test]
async fn tote_quelle_ist_ausfall_fuer_beide_und_trotzdem_200() {
    let u = setup_mit_basis("http://127.0.0.1:1").await;
    let admin = login_cookie(&u.app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&u.app, &admin).await;
    ort_setzen(&u.app, &admin, einsatz).await;

    let (status, json) = anfrage(&u.app, "GET", &pfad(einsatz), &admin, None).await;
    assert_eq!(status, StatusCode::OK, "{json:?}");
    assert_eq!(
        json,
        json!({
            "warnungen": { "zustand": "ausfall" },
            "vorhersage": { "zustand": "ausfall" }
        })
    );
    // Die Pegel bleiben davon unberührt.
    let (status, _) = anfrage(
        &u.app,
        "GET",
        &format!("/api/einsaetze/{einsatz}/pegel"),
        &admin,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
}

#[tokio::test]
async fn beobachter_liest() {
    let u = setup_mit_basis("http://127.0.0.1:1").await;
    let admin = login_cookie(&u.app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&u.app, &admin).await;
    let beob = benutzer_anlegen(&u.app, &admin, "beobachter", "keine").await;
    rolle_setzen(&u.app, &admin, einsatz, beob, "beobachter").await;
    let beob_cookie = login_cookie(&u.app, "beobachter", "beobachterpw1").await;

    let (status, json) = anfrage(&u.app, "GET", &pfad(einsatz), &beob_cookie, None).await;
    assert_eq!(status, StatusCode::OK, "{json:?}");
    assert_eq!(json["warnungen"]["zustand"], "kein_ort");
}

/// Modul ausgeblendet → 403 fürs Mitglied; die Pegel-Liste antwortet weiter mit 200.
#[tokio::test]
async fn modul_ausgeblendet_ist_403_pegel_bleiben_200() {
    let u = setup_mit_basis("http://127.0.0.1:1").await;
    let admin = login_cookie(&u.app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&u.app, &admin).await;
    let fid = benutzer_anlegen(&u.app, &admin, "frieda", "keine").await;
    rolle_setzen(&u.app, &admin, einsatz, fid, "fuehrungspersonal").await;
    let frieda = login_cookie(&u.app, "frieda", "friedapw1").await;

    let (status, json) = anfrage(
        &u.app,
        "PUT",
        &format!("/api/einsaetze/{einsatz}/modul-overrides/wetter-pegel"),
        &admin,
        Some(r#"{"sichtbar":false,"benoetigte_rolle":null}"#),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{json:?}");

    let (status, _) = anfrage(&u.app, "GET", &pfad(einsatz), &frieda, None).await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    for suffix in ["pegel", "pegel/verlauf"] {
        let (status, _) = anfrage(
            &u.app,
            "GET",
            &format!("/api/einsaetze/{einsatz}/{suffix}"),
            &frieda,
            None,
        )
        .await;
        assert_eq!(status, StatusCode::OK, "{suffix} bleibt modul-los");
    }
}

#[tokio::test]
async fn fremde_org_wird_abgewiesen() {
    let a = attrappe(alerts(), weather()).await;
    let u = setup_mit_basis(&a.basis).await;
    let admin = login_cookie(&u.app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&u.app, &admin).await;
    ort_setzen(&u.app, &admin, einsatz).await;
    fremde_org_anlegen(&u.pool, "Fremd-Orga", "fremd", "fremdpw1", "fuehrungskraft").await;
    let fremd = login_cookie(&u.app, "fremd", "fremdpw1").await;

    // Der Org-Floor des Einsatz-Kontexts antwortet plattformweit mit 403 (wie bei den
    // Pegel-Routen); ein unbekannter Einsatz ist 404. Beides ohne Abruf bei der Quelle.
    let (status, json) = anfrage(&u.app, "GET", &pfad(einsatz), &fremd, None).await;
    assert_eq!(status, StatusCode::FORBIDDEN, "{json:?}");
    assert!(json.get("warnungen").is_none());
    let (status, _) = anfrage(&u.app, "GET", &pfad(999_999), &admin, None).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    tokio::time::sleep(std::time::Duration::from_millis(100)).await;
    assert_eq!(a.zaehler.load(Ordering::SeqCst), 0);
}
