//! Archiv am Ende der Nachbereitung (LLH-1494, Teil 2): Archiv-Schlüssel der Org mit
//! Schlüsselprobe, Archivieren im Purge-Lauf, Archivakte und Download mit Admin-Spur.

use axum::body::{to_bytes, Body};
use axum::http::{header, Request, StatusCode};
use chrono::Utc;
use serde_json::{json, Value};
use sqlx::SqlitePool;
use std::io::Read;
use tower::ServiceExt;

mod common;
use common::{anfrage, anfrage_json, benutzer_anlegen, einsatz_anlegen, login_cookie};

fn probe_lesen(probe: &str, identitaet: &age::x25519::Identity) -> String {
    let leser = age::armor::ArmoredReader::new(probe.as_bytes());
    let mut r = age::Decryptor::new(leser)
        .unwrap()
        .decrypt(std::iter::once(identitaet as &dyn age::Identity))
        .unwrap();
    let mut s = String::new();
    r.read_to_string(&mut s).unwrap();
    s
}

async fn spur(pool: &SqlitePool, aktion: &str) -> Vec<(String, Option<String>)> {
    sqlx::query_as("SELECT ziel, detail FROM admin_audit WHERE aktion = ? ORDER BY id")
        .bind(aktion)
        .fetch_all(pool)
        .await
        .unwrap()
}

/// Trägt einen Schlüssel über die Routen ein und besteht die Probe.
async fn schluessel_eintragen(app: &axum::Router, admin: &str) -> age::x25519::Identity {
    let identitaet = age::x25519::Identity::generate();
    let (s, v) = anfrage_json(
        app,
        "POST",
        "/api/org-archiv-schluessel",
        admin,
        Some(&json!({
            "schluessel": identitaet.to_public().to_string(),
            "bezeichnung": "Tresor Kreisverband",
        })),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{v}");
    let id = v["empfaenger"]["id"].as_i64().unwrap();
    assert!(v["empfaenger"]["geprueft_at"].is_null());
    let code = probe_lesen(v["probe"].as_str().unwrap(), &identitaet);
    let (s, v) = anfrage_json(
        app,
        "POST",
        &format!("/api/org-archiv-schluessel/{id}/pruefen"),
        admin,
        Some(&json!({ "code": code.trim() })),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    assert!(v["geprueft_at"].is_string());
    identitaet
}

#[tokio::test]
async fn schluessel_mit_probe_nur_fuer_admins_und_in_der_admin_spur() {
    let (app, pool) = common::setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    benutzer_anlegen(&app, &admin, "fuehrung", "fuehrungskraft").await;
    let fk = login_cookie(&app, "fuehrung", "fuehrungpw1").await;

    let (s, _) = anfrage(&app, "GET", "/api/org-archiv-schluessel", &fk, None).await;
    assert_eq!(s, StatusCode::FORBIDDEN);
    let (s, _) = anfrage_json(
        &app,
        "POST",
        "/api/org-archiv-schluessel",
        &fk,
        Some(&json!({ "schluessel": "age1x", "bezeichnung": "x" })),
    )
    .await;
    assert_eq!(s, StatusCode::FORBIDDEN);

    // Ein privater Schlüssel wird abgewiesen.
    let privat =
        age::secrecy::ExposeSecret::expose_secret(&age::x25519::Identity::generate().to_string())
            .to_string();
    let (s, v) = anfrage_json(
        &app,
        "POST",
        "/api/org-archiv-schluessel",
        &admin,
        Some(&json!({ "schluessel": privat, "bezeichnung": "x" })),
    )
    .await;
    assert_eq!(s, StatusCode::BAD_REQUEST, "{v}");

    schluessel_eintragen(&app, &admin).await;
    let (s, v) = anfrage(&app, "GET", "/api/org-archiv-schluessel", &admin, None).await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(v.as_array().unwrap().len(), 1);
    assert_eq!(spur(&pool, "archiv_schluessel_eingetragen").await.len(), 1);
    let geprueft = spur(&pool, "archiv_schluessel_geprueft").await;
    assert_eq!(geprueft.len(), 1);
    assert_eq!(geprueft[0].0, "Tresor Kreisverband");

    let id = v[0]["id"].as_i64().unwrap();
    let (s, _) = anfrage(
        &app,
        "DELETE",
        &format!("/api/org-archiv-schluessel/{id}"),
        &admin,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::NO_CONTENT);
    assert_eq!(spur(&pool, "archiv_schluessel_entfernt").await.len(), 1);
}

async fn roh(app: &axum::Router, uri: &str, cookie: &str) -> (StatusCode, Vec<u8>, String) {
    let resp = app
        .clone()
        .oneshot(
            Request::builder()
                .uri(uri)
                .header(header::COOKIE, cookie.to_string())
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    let status = resp.status();
    let name = resp
        .headers()
        .get(header::CONTENT_DISPOSITION)
        .and_then(|h| h.to_str().ok())
        .unwrap_or_default()
        .to_string();
    let bytes = to_bytes(resp.into_body(), usize::MAX).await.unwrap();
    (status, bytes.to_vec(), name)
}

#[tokio::test]
async fn purge_archiviert_und_die_archivakte_liefert_den_block() {
    let (app, pool) = common::setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let identitaet = schluessel_eintragen(&app, &admin).await;
    let id = einsatz_anlegen(&app, &admin).await;
    let (s, v) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{id}/abschliessen"),
        &admin,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    sqlx::query(
        "UPDATE einsatz SET retention_bis = NULL, nachbereitung_bis = datetime('now', '-1 hour') \
         WHERE id = ?",
    )
    .bind(id)
    .execute(&pool)
    .await
    .unwrap();

    let live = lifeline_hub::live::LiveHub::new();
    lifeline_hub::einsatz::purge_scheduler::tick_einmal(&pool, &live, Utc::now()).await;

    let (s, akte) = anfrage(
        &app,
        "GET",
        &format!("/api/aufbewahrung/einsaetze/{id}"),
        &admin,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{akte}");
    assert_eq!(akte["archiv"]["block"], 1);
    assert_eq!(akte["archiv"]["bloecke"], 1);
    assert!(akte["archiv"]["gueltig_bis"].is_null());
    assert_eq!(
        akte["archiv"]["fingerabdruecke"].as_array().unwrap().len(),
        1
    );

    let (s, bytes, name) = roh(
        &app,
        &format!("/api/aufbewahrung/einsaetze/{id}/archiv"),
        &admin,
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    assert!(name.contains("block-1.sqlite.age"), "{name}");
    let mut klar = Vec::new();
    age::Decryptor::new(bytes.as_slice())
        .unwrap()
        .decrypt(std::iter::once(&identitaet as &dyn age::Identity))
        .unwrap()
        .read_to_end(&mut klar)
        .unwrap();
    assert!(klar.starts_with(b"SQLite format 3\0"));
    let abrufe = spur(&pool, "archiv_heruntergeladen").await;
    assert_eq!(abrufe.len(), 1);
    let detail: Value = serde_json::from_str(abrufe[0].1.as_deref().unwrap()).unwrap();
    assert_eq!(detail["block"], 1);

    // Eine fremde Org sieht das Archiv nicht.
    let fremd_org: i64 = sqlx::query_scalar(
        "INSERT INTO organisation (name, tz_organisation) VALUES ('Fremd', 'hilfsorganisation') \
         RETURNING id",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    let hash = lifeline_hub::auth::password::hash("fremdpw12").unwrap();
    sqlx::query(
        "INSERT INTO benutzer (org_id, anzeigename, benutzername, passwort_hash, system_rolle) \
         VALUES (?, 'Fremd', 'fremdadmin', ?, 'admin')",
    )
    .bind(fremd_org)
    .bind(&hash)
    .execute(&pool)
    .await
    .unwrap();
    let fremd = login_cookie(&app, "fremdadmin", "fremdpw12").await;
    let (s, _, _) = roh(
        &app,
        &format!("/api/aufbewahrung/einsaetze/{id}/archiv"),
        &fremd,
    )
    .await;
    assert_eq!(s, StatusCode::FORBIDDEN);
}
