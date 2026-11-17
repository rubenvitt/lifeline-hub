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
