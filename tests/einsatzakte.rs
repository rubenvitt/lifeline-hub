//! Einsatzakte (LLH-1835): `GET /api/incidents/{id}/case-file/attachments.zip`, Spec `einsatzakte`
//! („ZIP mit Anhängen und Tabellen“, „ZIP-Abruf wird protokolliert“, „Vollständig oder gar
//! nicht“, „Ein ZIP-Bau je Einsatz zugleich“).

use crate::common;

use axum::body::{to_bytes, Body};
use axum::http::{header, Request, StatusCode};
use common::*;
use lifeline_hub::einsatzakte::BauSperre;
use std::io::{Cursor, Read};
use tower::ServiceExt;

struct Antwort {
    status: StatusCode,
    typ: String,
    disposition: String,
    bytes: Vec<u8>,
}

async fn zip_laden(app: &axum::Router, cookie: &str, e: i64) -> Antwort {
    let resp = app
        .clone()
        .oneshot(
            Request::builder()
                .method("GET")
                .uri(format!("/api/incidents/{e}/case-file/attachments.zip"))
                .header(header::COOKIE, cookie)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    let status = resp.status();
    let kopf = |n: header::HeaderName| {
        resp.headers()
            .get(n)
            .map(|v| v.to_str().unwrap().to_string())
            .unwrap_or_default()
    };
    let typ = kopf(header::CONTENT_TYPE);
    let disposition = kopf(header::CONTENT_DISPOSITION);
    let bytes = to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap()
        .to_vec();
    Antwort {
        status,
        typ,
        disposition,
        bytes,
    }
}

fn eintraege(bytes: &[u8]) -> Vec<String> {
    let mut zip = zip::ZipArchive::new(Cursor::new(bytes)).unwrap();
    (0..zip.len())
        .map(|i| zip.by_index(i).unwrap().name().unwrap().to_string())
        .collect()
}

fn lies(bytes: &[u8], pfad: &str) -> Vec<u8> {
    let mut zip = zip::ZipArchive::new(Cursor::new(bytes)).unwrap();
    let mut out = Vec::new();
    zip.by_name(pfad).unwrap().read_to_end(&mut out).unwrap();
    out
}

async fn anzahl(pool: &sqlx::SqlitePool, sql: &str, e: i64) -> i64 {
    sqlx::query_scalar(sqlx::AssertSqlSafe(sql.to_string()))
        .bind(e)
        .fetch_one(pool)
        .await
        .unwrap()
}

#[tokio::test]
async fn zip_enthaelt_anhaenge_tabellen_und_inhaltsverzeichnis() {
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    person_anhang(&pool, e).await;
    let png = png_bytes(4, 4);
    erfassungs_datei(&pool, e, Erfassung::Uhs, "plan.png", "image/png", &png).await;
    // „ABC“ ist kein JPEG: lässt sich nicht bereinigen → nicht enthalten, aber verzeichnet.
    schaden_anhang(&pool, e).await;

    let a = zip_laden(&app, &admin, e).await;
    assert_eq!(a.status, StatusCode::OK);
    assert_eq!(a.typ, "application/zip");
    assert!(
        a.disposition.contains("Einsatzakte_") && a.disposition.contains("_Anlagen.zip"),
        "{}",
        a.disposition
    );
    let namen = eintraege(&a.bytes);
    for erwartet in [
        "Tabellen/betroffene.csv",
        "Tabellen/tiere.csv",
        "Tabellen/schaeden.csv",
        "Betroffene/R-001/verletzung.jpg",
        "Unfallhilfsstellen/UHS BHP 1/plan.png",
        "inhalt.csv",
    ] {
        assert!(
            namen.iter().any(|n| n == erwartet),
            "{erwartet} fehlt in {namen:?}"
        );
    }
    assert!(
        !namen.iter().any(|n| n.starts_with("Schaeden/")),
        "unbereinigbar darf nicht enthalten sein: {namen:?}"
    );
    let inhalt = String::from_utf8(lies(&a.bytes, "inhalt.csv")).unwrap();
    assert!(inhalt.contains(
        "\"Schaeden/S-001/dach.jpg\";\"Schaeden\";\"S-001\";\"dach.jpg\";;;\"nein: lässt sich nicht bereinigen\""
    ), "{inhalt}");
    assert!(inhalt.contains("\"Unfallhilfsstellen/UHS BHP 1/plan.png\""));
    let csv = String::from_utf8(lies(&a.bytes, "Tabellen/betroffene.csv")).unwrap();
    assert!(csv.starts_with("registrier_nr;status;sichtung;"), "{csv}");
    assert!(csv.contains("R-001"));
}

#[tokio::test]
async fn zip_protokolliert_betroffene_und_uhs_vor_der_auslieferung() {
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    person_anhang(&pool, e).await;
    erfassungs_datei(
        &pool,
        e,
        Erfassung::Uhs,
        "plan.png",
        "image/png",
        &png_bytes(2, 2),
    )
    .await;

    assert_eq!(zip_laden(&app, &admin, e).await.status, StatusCode::OK);
    assert_eq!(
        anzahl(
            &pool,
            "SELECT COUNT(*) FROM person_zugriff_audit \
             WHERE einsatz_id = ? AND art = 'export' AND person_id IS NULL",
            e
        )
        .await,
        1
    );
    assert_eq!(
        anzahl(
            &pool,
            "SELECT COUNT(*) FROM person_zugriff_audit \
             WHERE einsatz_id = ? AND art = 'anhang' AND person_id IS NOT NULL",
            e
        )
        .await,
        1
    );
    assert_eq!(
        anzahl(
            &pool,
            "SELECT COUNT(*) FROM anhang_zugriff_audit \
             WHERE einsatz_id = ? AND ablage = 'UHS BHP 1' AND fassung = 'bereinigt'",
            e
        )
        .await,
        1
    );
}

#[tokio::test]
async fn geloeschter_anhang_fehlt() {
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let (_, _, linker) = erfassungs_datei(
        &pool,
        e,
        Erfassung::Tier,
        "hund.png",
        "image/png",
        &png_bytes(2, 2),
    )
    .await;
    sqlx::query(
        "UPDATE einsatz_tier_anhang SET geloescht_at = datetime('now'), \
         geloescht_von_id = abgelegt_von_id WHERE id = ?",
    )
    .bind(linker)
    .execute(&pool)
    .await
    .unwrap();

    let a = zip_laden(&app, &admin, e).await;
    assert_eq!(a.status, StatusCode::OK);
    assert!(!eintraege(&a.bytes).iter().any(|n| n.starts_with("Tiere/")));
    let inhalt = String::from_utf8(lies(&a.bytes, "inhalt.csv")).unwrap();
    assert!(!inhalt.contains("hund.png"), "{inhalt}");
}

#[tokio::test]
async fn doppelte_dateinamen_bleiben_unterscheidbar() {
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let png = png_bytes(2, 2);
    let (_, tier, _) =
        erfassungs_datei(&pool, e, Erfassung::Tier, "foto.png", "image/png", &png).await;
    // Ein zweiter Anhang mit gleichem Namen am selben Tier.
    let von: i64 = sqlx::query_scalar("SELECT id FROM benutzer WHERE benutzername = 'admin'")
        .fetch_one(&pool)
        .await
        .unwrap();
    let aid: i64 = sqlx::query_scalar(
        "INSERT INTO anhang (einsatz_id, dateiname, mime, groesse, sha256, daten, hochgeladen_von) \
         VALUES (?, 'foto.png', 'image/png', ?, 'x', ?, ?) RETURNING id",
    )
    .bind(e)
    .bind(png.len() as i64)
    .bind(&png)
    .bind(von)
    .fetch_one(&pool)
    .await
    .unwrap();
    sqlx::query(
        "INSERT INTO einsatz_tier_anhang (einsatz_id, tier_id, anhang_id, abgelegt_von_id) \
         VALUES (?, ?, ?, ?)",
    )
    .bind(e)
    .bind(tier)
    .bind(aid)
    .bind(von)
    .execute(&pool)
    .await
    .unwrap();

    let namen = eintraege(&zip_laden(&app, &admin, e).await.bytes);
    assert!(
        namen.contains(&"Tiere/T-001/foto.png".to_string()),
        "{namen:?}"
    );
    assert!(
        namen.contains(&"Tiere/T-001/foto (2).png".to_string()),
        "{namen:?}"
    );
}

#[tokio::test]
async fn gesperrtes_modul_lehnt_ab_ohne_protokoll() {
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    person_anhang(&pool, e).await;
    let fid = benutzer_anlegen(&app, &admin, "frieda", "keine").await;
    rolle_setzen(&app, &admin, e, fid, "fuehrungspersonal").await;
    let frieda = login_cookie(&app, "frieda", "friedapw1").await;
    let (s, _) = anfrage(
        &app,
        "PUT",
        &format!("/api/incidents/{e}/module-overrides/personen"),
        &admin,
        Some(r#"{"sichtbar":true,"benoetigte_rolle":"admin"}"#),
    )
    .await;
    assert_eq!(s, StatusCode::OK);

    assert_eq!(
        zip_laden(&app, &frieda, e).await.status,
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        anzahl(
            &pool,
            "SELECT COUNT(*) FROM person_zugriff_audit WHERE einsatz_id = ?",
            e
        )
        .await,
        0
    );
}

#[tokio::test]
async fn ausgeblendetes_modul_faellt_weg() {
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    erfassungs_datei(
        &pool,
        e,
        Erfassung::Tier,
        "hund.png",
        "image/png",
        &png_bytes(2, 2),
    )
    .await;
    let (s, _) = anfrage(
        &app,
        "PUT",
        &format!("/api/incidents/{e}/module-overrides/tiere"),
        &admin,
        Some(r#"{"sichtbar":false,"benoetigte_rolle":null}"#),
    )
    .await;
    assert_eq!(s, StatusCode::OK);

    let a = zip_laden(&app, &admin, e).await;
    assert_eq!(a.status, StatusCode::OK);
    let namen = eintraege(&a.bytes);
    assert!(!namen
        .iter()
        .any(|n| n.starts_with("Tiere/") || n == "Tabellen/tiere.csv"));
    assert!(namen.contains(&"Tabellen/betroffene.csv".to_string()));
}

#[tokio::test]
async fn laufender_bau_lehnt_zweiten_abruf_ab() {
    let sperre = BauSperre::default();
    let im_state = sperre.clone();
    let (app, pool) = setup_mit_state(move |s| s.einsatzakte_bau = im_state).await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    person_anhang(&pool, e).await;

    let platz = sperre.belegen(e).unwrap();
    assert_eq!(
        zip_laden(&app, &admin, e).await.status,
        StatusCode::CONFLICT
    );
    assert_eq!(
        anzahl(
            &pool,
            "SELECT COUNT(*) FROM person_zugriff_audit WHERE einsatz_id = ?",
            e
        )
        .await,
        0
    );
    drop(platz);
    assert_eq!(zip_laden(&app, &admin, e).await.status, StatusCode::OK);
}

#[tokio::test]
async fn fremde_organisation_bekommt_nichts() {
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    person_anhang(&pool, e).await;
    fremde_org_anlegen(&pool, "Fremd-Orga", "fremd", "fremdpw123", "fuehrungskraft").await;
    let fremd = login_cookie(&app, "fremd", "fremdpw123").await;
    let s = zip_laden(&app, &fremd, e).await.status;
    assert!(
        s == StatusCode::FORBIDDEN || s == StatusCode::NOT_FOUND,
        "fremde Org: {s}"
    );
}

/// Spec `einsatzakte`, „Aufbewahrungsfrist abgelaufen“: ist die Kategorie `anhaenge` eines
/// abgeschlossenen Einsatzes geschwärzt, fehlen ihre Dateien; ist die Frist des Einsatzes
/// abgelaufen, gibt es kein ZIP.
#[tokio::test]
async fn geschwaerzte_anhaenge_fehlen_und_abgelaufene_frist_sperrt() {
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    erfassungs_datei(
        &pool,
        e,
        Erfassung::Tier,
        "hund.png",
        "image/png",
        &png_bytes(2, 2),
    )
    .await;
    sqlx::query(
        "UPDATE einsatz SET status = 'abgeschlossen', abgeschlossen_at = datetime('now') \
         WHERE id = ?",
    )
    .bind(e)
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query(
        "INSERT INTO einsatz_aufbewahrung_kategorie \
           (einsatz_id, kategorie, rechtsgrundlage, geschwaerzt_at) \
         VALUES (?, 'anhaenge', 'Test', datetime('now')) \
         ON CONFLICT (einsatz_id, kategorie) DO UPDATE SET geschwaerzt_at = datetime('now')",
    )
    .bind(e)
    .execute(&pool)
    .await
    .unwrap();

    let a = zip_laden(&app, &admin, e).await;
    assert_eq!(a.status, StatusCode::OK);
    assert!(!eintraege(&a.bytes).iter().any(|n| n.starts_with("Tiere/")));

    // Frist abgelaufen: Totalsperre, auch für den System-Admin.
    sqlx::query("UPDATE einsatz SET retention_bis = datetime('now', '-1 day') WHERE id = ?")
        .bind(e)
        .execute(&pool)
        .await
        .unwrap();
    assert_eq!(
        zip_laden(&app, &admin, e).await.status,
        StatusCode::FORBIDDEN
    );
}

/// Personendaten nie am gekoppelten Gerät (`frontend/src/druck/AGENTS.md`): ein UHS-Tablet
/// bekommt kein ZIP, auch nicht das seiner eigenen Stelle.
#[tokio::test]
async fn gekoppeltes_geraet_bekommt_kein_zip() {
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    person_anhang(&pool, e).await;
    let (s, v) = anfrage_json(
        &app,
        "POST",
        &format!("/api/incidents/{e}/uhs"),
        &admin,
        Some(&serde_json::json!({"typ": "behandlungsplatz", "bezeichnung": "BHP 1"})),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{v}");
    let uhs = v["id"].as_i64().unwrap();
    let (s, _) = anfrage_json(
        &app,
        "POST",
        &format!("/api/incidents/{e}/uhs/{uhs}/status"),
        &admin,
        Some(&serde_json::json!({"status": "aktiv"})),
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    let (s, v) = anfrage_json(
        &app,
        "POST",
        &format!("/api/incidents/{e}/devices"),
        &admin,
        Some(
            &serde_json::json!({"ansicht": "uhs-tablet", "uhs_id": uhs, "bezeichnung": "Tablet 1"}),
        ),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{v}");
    let code = v["code"]["code"].as_str().unwrap().to_string();
    let resp = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/devices/pair")
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(serde_json::json!({ "code": code }).to_string()))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let geraet = resp
        .headers()
        .get(header::SET_COOKIE)
        .unwrap()
        .to_str()
        .unwrap()
        .split(';')
        .next()
        .unwrap()
        .to_string();

    assert_eq!(
        zip_laden(&app, &geraet, e).await.status,
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        anzahl(
            &pool,
            "SELECT COUNT(*) FROM person_zugriff_audit WHERE einsatz_id = ?",
            e
        )
        .await,
        0
    );
}
