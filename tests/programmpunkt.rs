//! Programmpunkte der Veranstaltung (LLH-1570, Spec `ablaufplan`): `GET`/`POST
//! /api/einsaetze/{id}/programmpunkte`, `PATCH`/`DELETE …/{pid}` und das Feld `programm` des
//! Lagemonitors. Herleitung: `/mnt/project-files/llh-1570/design.md` (D1–D4).

use axum::body::{to_bytes, Body};
use axum::http::{header, Request, StatusCode};
use lifeline_hub::live::{LiveEvent, LiveNachricht};
use serde_json::{json, Value};
use tokio::sync::broadcast::Receiver;
use tower::ServiceExt;

mod common;
use common::*;

fn pfad(einsatz: i64) -> String {
    format!("/api/einsaetze/{einsatz}/programmpunkte")
}

/// Wire-Zeit (UTC, `YYYY-MM-DD HH:MM:SS`) relativ zu jetzt.
fn ab_jetzt(minuten: i64) -> String {
    (chrono::Utc::now() + chrono::Duration::minutes(minuten))
        .format("%Y-%m-%d %H:%M:%S")
        .to_string()
}

async fn anlegen(
    app: &axum::Router,
    cookie: &str,
    einsatz: i64,
    bezeichnung: &str,
    zeitpunkt: &str,
) -> (StatusCode, Value) {
    anfrage_json(
        app,
        "POST",
        &pfad(einsatz),
        cookie,
        Some(&json!({"bezeichnung": bezeichnung, "zeitpunkt_at": zeitpunkt})),
    )
    .await
}

async fn angelegt(app: &axum::Router, cookie: &str, einsatz: i64, b: &str, z: &str) -> i64 {
    let (s, v) = anlegen(app, cookie, einsatz, b, z).await;
    assert_eq!(s, StatusCode::CREATED, "{v}");
    v["id"].as_i64().unwrap()
}

async fn liste(app: &axum::Router, cookie: &str, einsatz: i64) -> Vec<Value> {
    let (s, v) = anfrage(app, "GET", &pfad(einsatz), cookie, None).await;
    assert_eq!(s, StatusCode::OK, "{v}");
    v.as_array().unwrap().clone()
}

/// Ein gekoppelter Lagemonitor: das Sitzungscookie des Geräts.
async fn lagemonitor(app: &axum::Router, admin: &str, einsatz: i64) -> String {
    let (s, v) = anfrage_json(
        app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/geraete"),
        admin,
        Some(&json!({"ansicht": "lagemonitor", "bezeichnung": "Monitor"})),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{v}");
    let code = v["code"]["code"].as_str().unwrap();
    let req = Request::builder()
        .method("POST")
        .uri("/api/geraete/koppeln")
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

fn kopf_events(rx: &mut Receiver<LiveNachricht>) -> usize {
    let mut n = 0;
    while let Ok(nachricht) = rx.try_recv() {
        if nachricht.event == LiveEvent::Einsatz {
            n += 1;
        }
    }
    n
}

#[tokio::test]
async fn anlegen_aendern_loeschen_mit_ereignis() {
    let (app, _pool, live) = setup_mit_pool_und_live().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let mut rx = live.abonniere(einsatz);

    assert!(liste(&app, &admin, einsatz).await.is_empty());

    // Formulareingabe mit `T` wird kanonisch; die Liste steht nach Zeit, nicht nach Anlage.
    let feuerwerk = angelegt(&app, &admin, einsatz, "  Feuerwerk ", "2026-09-13T22:00").await;
    let einlass = angelegt(&app, &admin, einsatz, "Einlass", "2026-09-13 16:00:00").await;
    assert_eq!(kopf_events(&mut rx), 2);
    let l = liste(&app, &admin, einsatz).await;
    assert_eq!(l.len(), 2);
    assert_eq!(l[0]["id"], einlass);
    assert_eq!(l[1]["id"], feuerwerk);
    assert_eq!(l[1]["bezeichnung"], "Feuerwerk");
    assert_eq!(l[1]["zeitpunkt_at"], "2026-09-13 22:00:00");

    // PATCH nur der Bezeichnung lässt den Zeitpunkt stehen und umgekehrt.
    let (s, v) = anfrage_json(
        &app,
        "PATCH",
        &format!("{}/{feuerwerk}", pfad(einsatz)),
        &admin,
        Some(&json!({"bezeichnung": "Höhenfeuerwerk"})),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    assert_eq!(v["bezeichnung"], "Höhenfeuerwerk");
    assert_eq!(v["zeitpunkt_at"], "2026-09-13 22:00:00");
    let (s, v) = anfrage_json(
        &app,
        "PATCH",
        &format!("{}/{feuerwerk}", pfad(einsatz)),
        &admin,
        Some(&json!({"zeitpunkt_at": "2026-09-13 15:00"})),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    assert_eq!(v["bezeichnung"], "Höhenfeuerwerk");
    assert_eq!(v["zeitpunkt_at"], "2026-09-13 15:00:00");
    assert_eq!(kopf_events(&mut rx), 2);
    assert_eq!(liste(&app, &admin, einsatz).await[0]["id"], feuerwerk);

    let (s, _) = anfrage(
        &app,
        "DELETE",
        &format!("{}/{feuerwerk}", pfad(einsatz)),
        &admin,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::NO_CONTENT);
    assert_eq!(kopf_events(&mut rx), 1);
    let l = liste(&app, &admin, einsatz).await;
    assert_eq!(l.len(), 1);
    assert_eq!(l[0]["id"], einlass);
}

#[tokio::test]
async fn eingaben_werden_geprueft() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let z = "2026-09-13 16:00";

    for (bezeichnung, zeitpunkt) in [
        ("   ", z),
        (&*"x".repeat(101), z),
        ("Einlass", "unsinn"),
        ("Einlass", "1899-01-01 12:00"),
    ] {
        let (s, v) = anlegen(&app, &admin, einsatz, bezeichnung, zeitpunkt).await;
        assert_eq!(
            s,
            StatusCode::BAD_REQUEST,
            "{bezeichnung:?} {zeitpunkt}: {v}"
        );
    }
    // Genau an der Grenze geht es.
    let (s, v) = anlegen(&app, &admin, einsatz, &"x".repeat(100), z).await;
    assert_eq!(s, StatusCode::CREATED, "{v}");
    let id = v["id"].as_i64().unwrap();

    let punkt = format!("{}/{id}", pfad(einsatz));
    for body in [
        json!({"bezeichnung": ""}),
        json!({"bezeichnung": "x".repeat(101)}),
        json!({"zeitpunkt_at": "unsinn"}),
    ] {
        let (s, v) = anfrage_json(&app, "PATCH", &punkt, &admin, Some(&body)).await;
        assert_eq!(s, StatusCode::BAD_REQUEST, "{body}: {v}");
    }
}

#[tokio::test]
async fn hoechstens_fuenfzig_je_einsatz() {
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    for i in 0..50 {
        sqlx::query(
            "INSERT INTO programmpunkt (einsatz_id, bezeichnung, zeitpunkt_at, erstellt_von_id) \
             VALUES (?, ?, '2026-09-13 16:00:00', 1)",
        )
        .bind(einsatz)
        .bind(format!("Punkt {i}"))
        .execute(&pool)
        .await
        .unwrap();
    }
    let (s, v) = anlegen(&app, &admin, einsatz, "Einer zu viel", "2026-09-13 17:00").await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY, "{v}");
    assert_eq!(liste(&app, &admin, einsatz).await.len(), 50);
}

#[tokio::test]
async fn beobachter_liest_und_darf_nicht_schreiben() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let id = angelegt(&app, &admin, einsatz, "Einlass", "2026-09-13 16:00").await;
    let bid = benutzer_anlegen(&app, &admin, "beobachterin", "keine").await;
    rolle_setzen(&app, &admin, einsatz, bid, "beobachter").await;
    let bea = login_cookie(&app, "beobachterin", "beobachterinpw1").await;

    assert_eq!(liste(&app, &bea, einsatz).await.len(), 1);
    let (s, _) = anlegen(&app, &bea, einsatz, "Ende", "2026-09-13 23:00").await;
    assert_eq!(s, StatusCode::FORBIDDEN);
    let punkt = format!("{}/{id}", pfad(einsatz));
    let body = json!({"bezeichnung": "Ende"});
    let (s, _) = anfrage_json(&app, "PATCH", &punkt, &bea, Some(&body)).await;
    assert_eq!(s, StatusCode::FORBIDDEN);
    let (s, _) = anfrage(&app, "DELETE", &punkt, &bea, None).await;
    assert_eq!(s, StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn ohne_lesezugriff_wie_beim_einsatzkopf() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    benutzer_anlegen(&app, &admin, "fremd", "keine").await;
    let fremd = login_cookie(&app, "fremd", "fremdpw1").await;

    let (kopf, _) = anfrage(
        &app,
        "GET",
        &format!("/api/einsaetze/{einsatz}"),
        &fremd,
        None,
    )
    .await;
    assert!(kopf.is_client_error(), "Vorbedingung: {kopf}");
    let (s, _) = anfrage(&app, "GET", &pfad(einsatz), &fremd, None).await;
    assert_eq!(s, kopf);
    let (s, _) = anlegen(&app, &fremd, einsatz, "Einlass", "2026-09-13 16:00").await;
    assert!(s.is_client_error(), "{s}");
}

#[tokio::test]
async fn punkt_eines_anderen_einsatzes_ist_404() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let a = einsatz_anlegen(&app, &admin).await;
    let b = einsatz_anlegen_mit(&app, &admin, "Zweiter").await;
    let id = angelegt(&app, &admin, a, "Einlass", "2026-09-13 16:00").await;

    let fremd_pfad = format!("{}/{id}", pfad(b));
    let body = json!({"bezeichnung": "Ende"});
    let (s, _) = anfrage_json(&app, "PATCH", &fremd_pfad, &admin, Some(&body)).await;
    assert_eq!(s, StatusCode::NOT_FOUND);
    let (s, _) = anfrage(&app, "DELETE", &fremd_pfad, &admin, None).await;
    assert_eq!(s, StatusCode::NOT_FOUND);
    let (s, _) = anfrage(&app, "DELETE", &format!("{}/999999", pfad(a)), &admin, None).await;
    assert_eq!(s, StatusCode::NOT_FOUND);
    assert_eq!(liste(&app, &admin, a).await[0]["bezeichnung"], "Einlass");
    assert!(liste(&app, &admin, b).await.is_empty());
}

#[tokio::test]
async fn abgeschlossener_einsatz_liest_und_ist_409_beim_schreiben() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let id = angelegt(&app, &admin, einsatz, "Einlass", "2026-09-13 16:00").await;
    let (s, _) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/abschliessen"),
        &admin,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK, "Vorbedingung");

    assert_eq!(liste(&app, &admin, einsatz).await.len(), 1);
    let (s, _) = anlegen(&app, &admin, einsatz, "Ende", "2026-09-13 23:00").await;
    assert_eq!(s, StatusCode::CONFLICT);
    let punkt = format!("{}/{id}", pfad(einsatz));
    let body = json!({"bezeichnung": "Ende"});
    let (s, _) = anfrage_json(&app, "PATCH", &punkt, &admin, Some(&body)).await;
    assert_eq!(s, StatusCode::CONFLICT);
    let (s, _) = anfrage(&app, "DELETE", &punkt, &admin, None).await;
    assert_eq!(s, StatusCode::CONFLICT);
}

/// Spec `ablaufplan`, „Lagemonitor zeigt den Ablauf“: höchstens drei anstehende Punkte nach Zeit,
/// verstrichene fallen heraus.
#[tokio::test]
async fn lagemonitor_traegt_die_naechsten_drei_programmpunkte() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let lagebild = format!("/api/einsaetze/{einsatz}/lagemonitor");
    let monitor = lagemonitor(&app, &admin, einsatz).await;

    let (s, v) = anfrage(&app, "GET", &lagebild, &monitor, None).await;
    assert_eq!(s, StatusCode::OK, "{v}");
    assert_eq!(v["programm"], json!([]));
    // Die Liste selbst liest das Gerät nicht: es bekommt nur das verdichtete Lagebild.
    let (s, _) = anfrage(&app, "GET", &pfad(einsatz), &monitor, None).await;
    assert_eq!(s, StatusCode::FORBIDDEN);

    angelegt(&app, &admin, einsatz, "Einlass", &ab_jetzt(-30)).await;
    for (b, m) in [
        ("Ende", 240),
        ("Feuerwerk", 90),
        ("Zugabe", 200),
        ("Pause", 60),
    ] {
        angelegt(&app, &admin, einsatz, b, &ab_jetzt(m)).await;
    }
    let (s, v) = anfrage(&app, "GET", &lagebild, &monitor, None).await;
    assert_eq!(s, StatusCode::OK, "{v}");
    let namen: Vec<&str> = v["programm"]
        .as_array()
        .unwrap()
        .iter()
        .map(|p| p["bezeichnung"].as_str().unwrap())
        .collect();
    assert_eq!(namen, ["Pause", "Feuerwerk", "Zugabe"]);
    assert!(v["programm"][0]["zeitpunkt_at"].is_string());
}

/// Die externe Schnittstelle (LLH-1484) bleibt unverändert: sie trägt keine Programmpunkte.
#[tokio::test]
async fn lagemonitor_schnittstelle_traegt_kein_programm() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    angelegt(&app, &admin, einsatz, "Feuerwerk", &ab_jetzt(90)).await;
    let (s, v) = anfrage_json(
        &app,
        "POST",
        "/api/lagemonitor-zugaenge",
        &admin,
        Some(&json!({"bezeichnung": "Leitstelle"})),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{v}");
    let zid = v["zugang"]["id"].as_i64().unwrap();
    let schluessel = v["schluessel"].as_str().unwrap().to_string();
    let (s, v) = anfrage(
        &app,
        "PUT",
        &format!("/api/einsaetze/{einsatz}/lagemonitor-zugaenge/{zid}/freigabe"),
        &admin,
        None,
    )
    .await;
    assert!(s.is_success(), "{s} {v}");

    let req = Request::builder()
        .method("GET")
        .uri("/api/lagemonitor/v1/lage")
        .header(header::AUTHORIZATION, format!("Bearer {schluessel}"))
        .body(Body::empty())
        .unwrap();
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let text = String::from_utf8(
        to_bytes(resp.into_body(), usize::MAX)
            .await
            .unwrap()
            .to_vec(),
    )
    .unwrap();
    assert!(!text.contains("Feuerwerk"), "{text}");
    assert!(!text.contains("\"programm\""), "{text}");
}
