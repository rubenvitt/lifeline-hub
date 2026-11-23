//! Mitglieder schon beim Anlegen (LLH-1820, Entwurf
//! `docs/superpowers/specs/2026-11-19-efvk5rbs-verwaltung-uebersicht-mitglieder-design.md`):
//! `POST /api/einsaetze` mit `mitglieder` nimmt die Personen in derselben Transaktion auf. Jede
//! ungültige Angabe ist 400, und dann entsteht nichts — weder Einsatz noch Mitgliedschaft noch
//! Benachrichtigung.

use axum::http::StatusCode;
use serde_json::{json, Value};
use sqlx::SqlitePool;

mod common;
use common::{anfrage, benutzer_anlegen, fremde_org_anlegen, login_cookie, setup_mit_pool};

/// Eine Führungskraft ohne Systemrolle (sie legt an) und der Admin-Cookie.
async fn aufbau() -> (axum::Router, SqlitePool, String, String, i64) {
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let fk_id = benutzer_anlegen(&app, &admin, "lennart", "fuehrungskraft").await;
    let fk = login_cookie(&app, "lennart", "lennartpw1").await;
    (app, pool, admin, fk, fk_id)
}

async fn anlegen(app: &axum::Router, cookie: &str, mitglieder: Value) -> (StatusCode, Value) {
    let body = json!({ "bezeichnung": "Lage", "mitglieder": mitglieder }).to_string();
    anfrage(app, "POST", "/api/einsaetze", cookie, Some(&body)).await
}

async fn zahl(pool: &SqlitePool, tabelle: &str) -> i64 {
    sqlx::query_scalar(sqlx::AssertSqlSafe(format!(
        "SELECT COUNT(*) FROM {tabelle}"
    )))
    .fetch_one(pool)
    .await
    .unwrap()
}

/// Einsätze, Mitgliedschaften und Benachrichtigungen — was eine Ablehnung nicht ändern darf.
async fn bestand(pool: &SqlitePool) -> (i64, i64, i64) {
    (
        zahl(pool, "einsatz").await,
        zahl(pool, "einsatz_mitgliedschaft").await,
        zahl(pool, "benachrichtigung").await,
    )
}

async fn deaktivieren(app: &axum::Router, admin: &str, id: i64) {
    let (s, _) = anfrage(
        app,
        "POST",
        &format!("/api/users/{id}/deactivate"),
        admin,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK);
}

async fn rollen(app: &axum::Router, cookie: &str, einsatz: i64) -> Vec<(i64, String)> {
    let (s, j) = anfrage(
        app,
        "GET",
        &format!("/api/einsaetze/{einsatz}/mitglieder"),
        cookie,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{j}");
    let mut r: Vec<(i64, String)> = j
        .as_array()
        .unwrap()
        .iter()
        .map(|m| {
            (
                m["benutzer_id"].as_i64().unwrap(),
                m["einsatz_rolle"].as_str().unwrap().to_string(),
            )
        })
        .collect();
    r.sort();
    r
}

/// Prüft die Ablehnung: 400 und kein Bestand geändert.
async fn abgelehnt(app: &axum::Router, pool: &SqlitePool, fk: &str, mitglieder: Value) -> String {
    let vorher = bestand(pool).await;
    let (s, j) = anlegen(app, fk, mitglieder).await;
    assert_eq!(s, StatusCode::BAD_REQUEST, "{j}");
    assert_eq!(bestand(pool).await, vorher, "nichts geschrieben: {j}");
    j["error"].as_str().unwrap_or_default().to_string()
}

#[tokio::test]
async fn mitglieder_kommen_mit_dem_einsatz() {
    let (app, _pool, admin, fk, fk_id) = aufbau().await;
    let anna = benutzer_anlegen(&app, &admin, "annika", "keine").await;
    let bert = benutzer_anlegen(&app, &admin, "bertram", "keine").await;

    let (s, j) = anlegen(
        &app,
        &fk,
        json!([
            { "benutzer_id": anna, "rolle": "fuehrungspersonal" },
            { "benutzer_id": bert, "rolle": "beobachter" },
        ]),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{j}");
    let einsatz = j["id"].as_i64().unwrap();
    let mut erwartet = vec![
        (fk_id, "einsatzleitung".to_string()),
        (anna, "fuehrungspersonal".to_string()),
        (bert, "beobachter".to_string()),
    ];
    erwartet.sort();
    assert_eq!(rollen(&app, &fk, einsatz).await, erwartet);
}

#[tokio::test]
async fn aufgenommene_bekommen_den_hinweis() {
    let (app, pool, admin, fk, fk_id) = aufbau().await;
    let anna = benutzer_anlegen(&app, &admin, "annika", "keine").await;
    let bert = benutzer_anlegen(&app, &admin, "bertram", "keine").await;

    let (s, j) = anlegen(
        &app,
        &fk,
        json!([
            { "benutzer_id": anna, "rolle": "fuehrungspersonal" },
            { "benutzer_id": bert, "rolle": "beobachter" },
        ]),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{j}");
    let einsatz = j["id"].as_i64().unwrap();
    for (wer, erwartet) in [(anna, 1), (bert, 1), (fk_id, 0)] {
        let n: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM benachrichtigung \
             WHERE art = 'einsatz_aufnahme' AND benutzer_id = ? AND einsatz_id = ?",
        )
        .bind(wer)
        .bind(einsatz)
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(n, erwartet, "Aufnahme-Hinweis für {wer}");
    }
}

#[tokio::test]
async fn ohne_mitglieder_wie_bisher() {
    let (app, _pool, _admin, fk, fk_id) = aufbau().await;
    for body in [
        r#"{"bezeichnung":"Lage"}"#,
        r#"{"bezeichnung":"Lage","mitglieder":[]}"#,
    ] {
        let (s, j) = anfrage(&app, "POST", "/api/einsaetze", &fk, Some(body)).await;
        assert_eq!(s, StatusCode::CREATED, "{j}");
        let einsatz = j["id"].as_i64().unwrap();
        assert_eq!(
            rollen(&app, &fk, einsatz).await,
            vec![(fk_id, "einsatzleitung".to_string())]
        );
    }
}

#[tokio::test]
async fn fremde_person_bricht_anlegen_ab() {
    let (app, pool, _admin, fk, _) = aufbau().await;
    let (_, fremd) = fremde_org_anlegen(&pool, "Fremd", "fritz", "fritzpw12", "keine").await;
    abgelehnt(
        &app,
        &pool,
        &fk,
        json!([{ "benutzer_id": fremd, "rolle": "beobachter" }]),
    )
    .await;
}

#[tokio::test]
async fn ungueltige_person_hinterlaesst_nichts() {
    let (app, pool, admin, fk, _) = aufbau().await;
    let anna = benutzer_anlegen(&app, &admin, "annika", "keine").await;
    let bert = benutzer_anlegen(&app, &admin, "bertram", "keine").await;
    let irene = benutzer_anlegen(&app, &admin, "irene", "keine").await;
    deaktivieren(&app, &admin, irene).await;

    let meldung = abgelehnt(
        &app,
        &pool,
        &fk,
        json!([
            { "benutzer_id": anna, "rolle": "fuehrungspersonal" },
            { "benutzer_id": bert, "rolle": "beobachter" },
            { "benutzer_id": irene, "rolle": "beobachter" },
        ]),
    )
    .await;
    // Eine Person der eigenen Org nennt die Meldung beim Namen.
    assert!(meldung.contains("irene"), "{meldung}");
}

#[tokio::test]
async fn doppelte_person_400() {
    let (app, pool, admin, fk, _) = aufbau().await;
    let anna = benutzer_anlegen(&app, &admin, "annika", "keine").await;
    abgelehnt(
        &app,
        &pool,
        &fk,
        json!([
            { "benutzer_id": anna, "rolle": "fuehrungspersonal" },
            { "benutzer_id": anna, "rolle": "beobachter" },
        ]),
    )
    .await;
}

#[tokio::test]
async fn anlegende_person_in_liste_400() {
    let (app, pool, _admin, fk, fk_id) = aufbau().await;
    abgelehnt(
        &app,
        &pool,
        &fk,
        json!([{ "benutzer_id": fk_id, "rolle": "beobachter" }]),
    )
    .await;
}

#[tokio::test]
async fn unbekannte_rolle_400() {
    let (app, pool, admin, fk, _) = aufbau().await;
    let anna = benutzer_anlegen(&app, &admin, "annika", "keine").await;
    abgelehnt(
        &app,
        &pool,
        &fk,
        json!([{ "benutzer_id": anna, "rolle": "chef" }]),
    )
    .await;
}

#[tokio::test]
async fn geraetekonto_400() {
    let (app, pool, admin, fk, _) = aufbau().await;
    let einsatz = common::einsatz_anlegen(&app, &admin).await;
    let geraet: i64 = sqlx::query_scalar(
        "INSERT INTO benutzer (org_id, anzeigename, benutzername, passwort_hash, system_rolle, \
                               org_rolle) \
         VALUES (1, 'Lagemonitor', 'geraet-lagemonitor', 'x', 'keiner', 'keine') RETURNING id",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    sqlx::query(
        "INSERT INTO geraet_kopplung (einsatz_id, benutzer_id, ansicht, bezeichnung, \
                                      erstellt_von, laeuft_ab_at) \
         VALUES (?, ?, 'lagemonitor', 'Monitor', 1, datetime('now', '+1 day'))",
    )
    .bind(einsatz)
    .bind(geraet)
    .execute(&pool)
    .await
    .unwrap();
    abgelehnt(
        &app,
        &pool,
        &fk,
        json!([{ "benutzer_id": geraet, "rolle": "beobachter" }]),
    )
    .await;
}

#[tokio::test]
async fn zu_viele_mitglieder_400() {
    let (app, pool, _admin, fk, _) = aufbau().await;
    let liste: Vec<Value> = (0..=lifeline_hub::einsatz::MITGLIEDER_MAX as i64)
        .map(|i| json!({ "benutzer_id": 10_000 + i, "rolle": "beobachter" }))
        .collect();
    abgelehnt(&app, &pool, &fk, Value::Array(liste)).await;
}

#[tokio::test]
async fn fremde_und_unbekannte_melden_gleich() {
    // Ob eine Kennung in einer fremden Org existiert, lässt sich an der Meldung nicht ablesen.
    let (app, pool, _admin, fk, _) = aufbau().await;
    let (_, fremd) = fremde_org_anlegen(&pool, "Fremd", "fritz", "fritzpw12", "keine").await;
    let unbekannt = fremd + 1000;
    let a = abgelehnt(
        &app,
        &pool,
        &fk,
        json!([{ "benutzer_id": fremd, "rolle": "beobachter" }]),
    )
    .await;
    let b = abgelehnt(
        &app,
        &pool,
        &fk,
        json!([{ "benutzer_id": unbekannt, "rolle": "beobachter" }]),
    )
    .await;
    assert_eq!(
        a.replace(&fremd.to_string(), "#"),
        b.replace(&unbekannt.to_string(), "#")
    );
}
