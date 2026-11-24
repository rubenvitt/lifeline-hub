//! Feld-CAS und Änderungsvermerk an den Kopfdaten (LLH-1831, LLH-1834; Change
//! `nvhnqynd-konflikt-und-aenderungsvermerk`, Specs `einsatzdaten-bearbeitung` „Zeile der
//! Kopfdaten mit Altwert speichern“ / „Altwerte der Kopfdaten gemeinsam geprüft“ und
//! `aenderungsvermerk`).

use axum::http::StatusCode;
use serde_json::{json, Value};

mod common;
use common::*;

async fn patchen(
    app: &axum::Router,
    cookie: &str,
    einsatz: i64,
    body: Value,
) -> (StatusCode, Value) {
    anfrage_json(
        app,
        "PATCH",
        &format!("/api/einsaetze/{einsatz}"),
        cookie,
        Some(&body),
    )
    .await
}

async fn lesen(app: &axum::Router, cookie: &str, einsatz: i64) -> Value {
    let (status, json) = anfrage(
        app,
        "GET",
        &format!("/api/einsaetze/{einsatz}"),
        cookie,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{json:?}");
    json
}

async fn start() -> (axum::Router, String, i64) {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    (app, admin, einsatz)
}

#[tokio::test]
async fn leitstellen_nr_mit_veraltetem_stand_ist_409_und_schreibt_nichts() {
    let (app, admin, einsatz) = start().await;
    let (s, _) = patchen(&app, &admin, einsatz, json!({"leitstellen_nr": "ILS-4711"})).await;
    assert_eq!(s, StatusCode::OK);

    let (s, j) = patchen(
        &app,
        &admin,
        einsatz,
        json!({"leitstellen_nr": "ILS-4712", "erwartet": {"leitstellen_nr": null}}),
    )
    .await;
    assert_eq!(s, StatusCode::CONFLICT, "{j:?}");
    // Sperrkonflikt ausgezeichnet (src/AGENTS.md, Statuscode-Konvention, LLH-1920).
    assert_eq!(j["grund"], "veraltet", "{j:?}");
    assert_eq!(
        lesen(&app, &admin, einsatz).await["leitstellen_nr"],
        "ILS-4711"
    );
}

#[tokio::test]
async fn andere_zeile_dazwischen_speichert_ohne_rueckfrage() {
    let (app, admin, einsatz) = start().await;
    // B öffnet „Meldende Stelle“ (leer), A speichert inzwischen die Leitstellen-Nr.
    patchen(&app, &admin, einsatz, json!({"leitstellen_nr": "ILS-4711"})).await;
    let (s, j) = patchen(
        &app,
        &admin,
        einsatz,
        json!({"meldende_stelle": "ILS Nord", "erwartet": {"meldende_stelle": null}}),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{j:?}");
    let e = lesen(&app, &admin, einsatz).await;
    assert_eq!(e["meldende_stelle"], "ILS Nord");
    assert_eq!(e["leitstellen_nr"], "ILS-4711");
}

#[tokio::test]
async fn adresse_mit_treffer_scheitert_an_verschobener_koordinate() {
    let (app, admin, einsatz) = start().await;
    patchen(
        &app,
        &admin,
        einsatz,
        json!({"einsatzort_lat": 51.0, "einsatzort_lon": 10.0}),
    )
    .await;
    let (s, j) = patchen(
        &app,
        &admin,
        einsatz,
        json!({
            "einsatzort": "Bahnhofstraße 1",
            "einsatzort_lat": 51.1,
            "einsatzort_lon": 10.4,
            "erwartet": {"einsatzort": null, "einsatzort_lat": null, "einsatzort_lon": null}
        }),
    )
    .await;
    assert_eq!(s, StatusCode::CONFLICT, "{j:?}");
    let e = lesen(&app, &admin, einsatz).await;
    assert_eq!(e["einsatzort_lat"], 51.0);
    assert!(e.get("einsatzort").is_none_or(Value::is_null));
}

#[tokio::test]
async fn halbe_koordinate_erwartet_ist_422() {
    let (app, admin, einsatz) = start().await;
    let (s, j) = patchen(
        &app,
        &admin,
        einsatz,
        json!({
            "einsatzort_lat": 52.5, "einsatzort_lon": 13.4,
            "erwartet": {"einsatzort_lat": null}
        }),
    )
    .await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY, "{j:?}");
}

#[tokio::test]
async fn altwert_ohne_aenderung_ist_422() {
    let (app, admin, einsatz) = start().await;
    let (s, j) = patchen(
        &app,
        &admin,
        einsatz,
        json!({"sachverhalt": "Wasser", "erwartet": {"leitstellen_nr": null}}),
    )
    .await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY, "{j:?}");
}

#[tokio::test]
async fn stimmender_altwert_schreibt() {
    let (app, admin, einsatz) = start().await;
    let alt = lesen(&app, &admin, einsatz).await["bezeichnung"].clone();
    let (s, j) = patchen(
        &app,
        &admin,
        einsatz,
        json!({"bezeichnung": "Hochwasser Nord", "erwartet": {"bezeichnung": alt}}),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{j:?}");
    assert_eq!(
        lesen(&app, &admin, einsatz).await["bezeichnung"],
        "Hochwasser Nord"
    );
}

#[tokio::test]
async fn ohne_altwert_wie_bisher() {
    let (app, admin, einsatz) = start().await;
    patchen(&app, &admin, einsatz, json!({"leitstellen_nr": "ILS-1"})).await;
    let (s, _) = patchen(&app, &admin, einsatz, json!({"leitstellen_nr": "ILS-2"})).await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(
        lesen(&app, &admin, einsatz).await["leitstellen_nr"],
        "ILS-2"
    );
}

// ── Änderungsvermerk (LLH-1834, Spec `aenderungsvermerk`) ──────────────────────────────────

#[tokio::test]
async fn vermerk_nennt_wer_und_wann_und_schreibt_kein_etb() {
    let (app, admin, einsatz) = start().await;
    assert!(
        lesen(&app, &admin, einsatz).await.get("vermerke").is_none(),
        "ohne Änderung seit dem Anlegen kein Vermerk"
    );
    let etb_vorher = system_etb_anzahl(&app, &admin, einsatz).await;
    let (s, antwort) = patchen(&app, &admin, einsatz, json!({"leitstellen_nr": "ILS-4711"})).await;
    assert_eq!(s, StatusCode::OK);
    let v = &lesen(&app, &admin, einsatz).await["vermerke"];
    assert_eq!(v["leitstellen_nr"]["von"], "Administrator", "{v:?}");
    assert!(v["leitstellen_nr"]["at"].is_string());
    assert!(v.get("sachverhalt").is_none(), "nur die geänderte Angabe");
    assert_eq!(
        antwort["vermerke"], *v,
        "die PATCH-Antwort trägt dieselben Vermerke"
    );
    assert_eq!(system_etb_anzahl(&app, &admin, einsatz).await, etb_vorher);
}

#[tokio::test]
async fn koordinate_ist_eine_angabe_im_vermerk() {
    let (app, admin, einsatz) = start().await;
    patchen(
        &app,
        &admin,
        einsatz,
        json!({"einsatzort_lat": 51.0, "einsatzort_lon": 10.0}),
    )
    .await;
    let v = &lesen(&app, &admin, einsatz).await["vermerke"];
    assert!(v.get("einsatzort_koordinate").is_some(), "{v:?}");
    assert!(v.get("einsatzort_lat").is_none());
}

#[tokio::test]
async fn gleicher_wert_und_konflikt_lassen_den_vermerk_stehen() {
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    patchen(&app, &admin, einsatz, json!({"leitstellen_nr": "ILS-4711"})).await;
    // Den Vermerk in die Vergangenheit legen, damit ein neuer Zeitstempel auffiele.
    sqlx::query("UPDATE einsatz_feld_vermerk SET geaendert_at = '2026-01-01 00:00:00'")
        .execute(&pool)
        .await
        .unwrap();
    patchen(&app, &admin, einsatz, json!({"leitstellen_nr": "ILS-4711"})).await;
    let (s, _) = patchen(
        &app,
        &admin,
        einsatz,
        json!({"leitstellen_nr": "ILS-1", "erwartet": {"leitstellen_nr": null}}),
    )
    .await;
    assert_eq!(s, StatusCode::CONFLICT);
    let v = &lesen(&app, &admin, einsatz).await["vermerke"];
    assert_eq!(v["leitstellen_nr"]["at"], "2026-01-01 00:00:00");
}

/// Ein gekoppeltes Gerät der Ansicht `body`: das Sitzungscookie des Geräts.
async fn geraet(app: &axum::Router, admin: &str, einsatz: i64, body: Value) -> String {
    use axum::body::Body;
    use axum::http::{header, Request};
    use tower::ServiceExt;
    let (s, v) = anfrage_json(
        app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/devices"),
        admin,
        Some(&body),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{v}");
    let code = v["code"]["code"].as_str().unwrap();
    let req = Request::builder()
        .method("POST")
        .uri("/api/devices/pair")
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(json!({ "code": code }).to_string()))
        .unwrap();
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    resp.headers()
        .get(header::SET_COOKIE)
        .map(|v| v.to_str().unwrap().split(';').next().unwrap().to_string())
        .expect("Sitzungscookie")
}

/// Ein Gerät bekommt keine Benutzernamen (Review LLH-1834): Kopf, Führungsstelle und Einheiten
/// liefern ihm keine Vermerke, einer Personensitzung schon.
#[tokio::test]
async fn geraet_bekommt_keine_vermerke() {
    let (app, admin, einsatz) = start().await;
    let eid = einheit_bilden(&app, &admin, einsatz, "Trupp 1").await;
    patchen(&app, &admin, einsatz, json!({"leitstellen_nr": "ILS-1"})).await;
    let (s, _) = anfrage_json(
        &app,
        "PATCH",
        &format!("/api/einsaetze/{einsatz}/units/{eid}"),
        &admin,
        Some(&json!({"funkrufname": "Florian 1"})),
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    let (s, _) = anfrage_json(
        &app,
        "PATCH",
        &format!("/api/einsaetze/{einsatz}/command-post"),
        &admin,
        Some(&json!({"rufname": "Florian 10"})),
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    // Gegenprobe: die Personensitzung sieht die Vermerke.
    assert!(lesen(&app, &admin, einsatz).await.get("vermerke").is_some());

    let geraete = [
        json!({"ansicht": "lagemonitor", "bezeichnung": "Monitor"}),
        json!({"ansicht": "einheit", "stelle_id": eid, "bezeichnung": "Tablet Trupp"}),
    ];
    let mut gelesen = std::collections::BTreeSet::new();
    for body in geraete {
        let cookie = geraet(&app, &admin, einsatz, body).await;
        for pfad in [
            format!("/api/einsaetze/{einsatz}"),
            format!("/api/einsaetze/{einsatz}/command-post"),
            format!("/api/einsaetze/{einsatz}/units"),
        ] {
            let (s, j) = anfrage(&app, "GET", &pfad, &cookie, None).await;
            if s != StatusCode::OK {
                continue;
            }
            let objekte: Vec<&Value> = match j.as_array() {
                Some(a) => a.iter().collect(),
                None => vec![&j],
            };
            assert!(!objekte.is_empty(), "{pfad}");
            for o in objekte {
                assert!(o.get("vermerke").is_none(), "{pfad}: {o:?}");
            }
            gelesen.insert(pfad.rsplit('/').next().unwrap().to_string());
        }
    }
    assert!(
        gelesen.contains("units"),
        "ein Gerät liest die Einheiten: {gelesen:?}"
    );
}
