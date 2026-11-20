//! Bestand der Bereitschaft (LLH-1820, Entwurf
//! `docs/superpowers/specs/2026-11-19-efvk5rbs-verwaltung-uebersicht-mitglieder-design.md`):
//! `GET /api/verwaltung/bereitschaft` zählt, was die eigene Organisation für einen Einsatz hat —
//! nur Zahlen, nur mit Verwaltungszugang, ohne Gerätekonten, Stellvertreter und Demo-Zeilen.

use axum::http::StatusCode;
use serde_json::Value;
use sqlx::SqlitePool;

mod common;
use common::{anfrage, benutzer_anlegen, fremde_org_anlegen, login_cookie, setup_mit_pool};

const URI: &str = "/api/verwaltung/bereitschaft";

async fn fahrzeug(app: &axum::Router, admin: &str, name: &str) -> i64 {
    let (s, j) = anfrage(
        app,
        "POST",
        "/api/fahrzeuge",
        admin,
        Some(&format!(r#"{{"funkrufname":"{name}"}}"#)),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{j}");
    j["id"].as_i64().unwrap()
}

async fn personal(app: &axum::Router, admin: &str, name: &str) -> i64 {
    let (s, j) = anfrage(
        app,
        "POST",
        "/api/personal",
        admin,
        Some(&format!(r#"{{"name":"{name}"}}"#)),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{j}");
    j["id"].as_i64().unwrap()
}

/// Einheiten-Vorlage direkt per SQL: der Anlageweg gehört nicht zu dem, was hier geprüft wird.
async fn einheit_vorlage(pool: &SqlitePool, org: i64, aktiv: bool) -> i64 {
    let typ: i64 = sqlx::query_scalar("SELECT id FROM einheit_typ ORDER BY id LIMIT 1")
        .fetch_one(pool)
        .await
        .unwrap();
    sqlx::query_scalar(
        "INSERT INTO einheit_vorlage (org_id, name, typ_id, aktiv) VALUES (?, 'Zug', ?, ?) \
         RETURNING id",
    )
    .bind(org)
    .bind(typ)
    .bind(aktiv)
    .fetch_one(pool)
    .await
    .unwrap()
}

async fn geraetekonto(pool: &SqlitePool, einsatz: i64) {
    let id: i64 = sqlx::query_scalar(
        "INSERT INTO benutzer (org_id, anzeigename, benutzername, passwort_hash, system_rolle, \
                               org_rolle) \
         VALUES (1, 'Lagemonitor', 'geraet-lagemonitor', 'x', 'keiner', 'keine') RETURNING id",
    )
    .fetch_one(pool)
    .await
    .unwrap();
    sqlx::query(
        "INSERT INTO geraet_kopplung (einsatz_id, benutzer_id, ansicht, bezeichnung, \
                                      erstellt_von, laeuft_ab_at) \
         VALUES (?, ?, 'lagemonitor', 'Monitor', 1, datetime('now', '+1 day'))",
    )
    .bind(einsatz)
    .bind(id)
    .execute(pool)
    .await
    .unwrap();
}

#[tokio::test]
async fn zaehlt_den_bestand_der_eigenen_org() {
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;

    fahrzeug(&app, &admin, "Florian 1").await;
    fahrzeug(&app, &admin, "Florian 2").await;
    let ausser = fahrzeug(&app, &admin, "Florian 3").await;
    let (s, _) = anfrage(
        &app,
        "POST",
        &format!("/api/fahrzeuge/{ausser}/ausser-dienst"),
        &admin,
        None,
    )
    .await;
    assert!(s.is_success(), "{s}");
    for n in ["Anna", "Bert", "Cora"] {
        personal(&app, &admin, n).await;
    }
    einheit_vorlage(&pool, 1, true).await;
    einheit_vorlage(&pool, 1, false).await;
    let (s, j) = anfrage(
        &app,
        "POST",
        "/api/einsatz-vorlagen",
        &admin,
        Some(r#"{"bezeichnung":"Testlage LLH-1820","ausgeblendet":[]}"#),
    )
    .await;
    assert!(s.is_success(), "{s} {j}");

    // Benutzer: Admin + zwei aktive; nicht: ein deaktiviertes, ein Gerätekonto, eine fremde Org.
    benutzer_anlegen(&app, &admin, "erika", "keine").await;
    benutzer_anlegen(&app, &admin, "lennart", "fuehrungskraft").await;
    let inaktiv = benutzer_anlegen(&app, &admin, "irene", "keine").await;
    let (s, _) = anfrage(
        &app,
        "POST",
        &format!("/api/benutzer/{inaktiv}/deaktivieren"),
        &admin,
        None,
    )
    .await;
    assert!(s.is_success(), "{s}");
    let einsatz = common::einsatz_anlegen(&app, &admin).await;
    geraetekonto(&pool, einsatz).await;
    let (fremd_org, _) = fremde_org_anlegen(&pool, "Fremd", "fremdi", "fremdpw12", "keine").await;
    einheit_vorlage(&pool, fremd_org, true).await;

    let (s, j) = anfrage(&app, "GET", URI, &admin, None).await;
    assert_eq!(s, StatusCode::OK, "{j}");
    assert_eq!(j["benutzer"], 3, "{j}");
    assert_eq!(j["fahrzeuge"], 2, "{j}");
    assert_eq!(j["personal"], 3, "{j}");
    assert_eq!(j["einheit_vorlagen"], 1, "{j}");
    // Die Grundausstattung bringt Einsatz-Vorlagen mit; gezählt wird jede der eigenen Org.
    let vorlagen: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM einsatz_vorlage WHERE org_id = 1")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert!(vorlagen >= 1);
    assert_eq!(j["einsatz_vorlagen"], vorlagen, "{j}");
    for demo in ["fahrzeuge_demo", "personal_demo", "einheit_vorlagen_demo"] {
        assert_eq!(j[demo], 0, "{demo}: {j}");
    }
}

#[tokio::test]
async fn fuehrungskraft_bekommt_nur_zahlen() {
    let (app, _pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    benutzer_anlegen(&app, &admin, "lennart", "fuehrungskraft").await;
    let fk = login_cookie(&app, "lennart", "lennartpw1").await;

    let (s, j) = anfrage(&app, "GET", URI, &fk, None).await;
    assert_eq!(s, StatusCode::OK, "{j}");
    let mut schluessel: Vec<&str> = j
        .as_object()
        .expect("Objekt")
        .keys()
        .map(String::as_str)
        .collect();
    schluessel.sort();
    assert_eq!(
        schluessel,
        vec![
            "benutzer",
            "einheit_vorlagen",
            "einheit_vorlagen_demo",
            "einsatz_vorlagen",
            "fahrzeuge",
            "fahrzeuge_demo",
            "personal",
            "personal_demo",
        ]
    );
    assert!(
        j.as_object().unwrap().values().all(Value::is_i64),
        "nur Zahlen: {j}"
    );
}

#[tokio::test]
async fn ohne_verwaltungszugang_403() {
    let (app, _pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    benutzer_anlegen(&app, &admin, "erika", "keine").await;
    let erika = login_cookie(&app, "erika", "erikapw1").await;

    let (s, _) = anfrage(&app, "GET", URI, &erika, None).await;
    assert_eq!(s, StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn demo_zaehlt_getrennt() {
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = common::einsatz_anlegen(&app, &admin).await;
    let f = fahrzeug(&app, &admin, "Demo-Florian").await;
    let p = personal(&app, &admin, "Demo-Person").await;
    let v = einheit_vorlage(&pool, 1, true).await;
    // Demo-Marke wie der Import (LFH-733): eine Import-Zeile, darunter die Herkunft je Datensatz.
    let import: i64 = sqlx::query_scalar(
        "INSERT INTO demo_import (org_id, einsatz_id, importiert_von, bericht) \
         VALUES (1, ?, 1, '{}') RETURNING id",
    )
    .bind(einsatz)
    .fetch_one(&pool)
    .await
    .unwrap();
    for (tabelle, id) in [("fahrzeug", f), ("personal", p), ("einheit_vorlage", v)] {
        sqlx::query(
            "INSERT INTO demo_herkunft (import_id, tabelle, datensatz_id) VALUES (?, ?, ?)",
        )
        .bind(import)
        .bind(tabelle)
        .bind(id)
        .execute(&pool)
        .await
        .unwrap();
    }

    let (s, j) = anfrage(&app, "GET", URI, &admin, None).await;
    assert_eq!(s, StatusCode::OK, "{j}");
    assert_eq!(j["fahrzeuge"], 0, "{j}");
    assert_eq!(j["fahrzeuge_demo"], 1, "{j}");
    assert_eq!(j["personal"], 0, "{j}");
    assert_eq!(j["personal_demo"], 1, "{j}");
    assert_eq!(j["einheit_vorlagen"], 0, "{j}");
    assert_eq!(j["einheit_vorlagen_demo"], 1, "{j}");
}
