//! Gerätekopplung (LFH-892): Verwaltung durch die Einsatzleitung, Einlösen des Codes,
//! Durchsetzung an der Sitzung und sofortiger Widerruf.
//!
//! Spec: `openspec/changes/lfh-892-funktionsansichten-geraete/specs/geraete-kopplung/spec.md`.

use axum::body::{to_bytes, Body};
use axum::extract::ConnectInfo;
use axum::http::{header, Request, StatusCode};
use serde_json::{json, Value};
use std::net::SocketAddr;
use std::time::Duration;
use tower::ServiceExt;

mod common;
use common::{
    anfrage, anfrage_json, benutzer_anlegen, einsatz_anlegen, einsatz_anlegen_mit, login_cookie,
    rolle_setzen, setup_mit_pool_und_live, system_etb_inhalte,
};

// ---------- Helfer ----------

struct Antwort {
    status: StatusCode,
    cookie: Option<String>,
    body: Value,
}

/// `POST /api/geraete/koppeln` ohne Sitzung, optional von einer festen Adresse.
async fn koppeln(app: &axum::Router, code: &str, peer: Option<SocketAddr>) -> Antwort {
    let mut req = Request::builder()
        .method("POST")
        .uri("/api/geraete/koppeln")
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(json!({ "code": code }).to_string()))
        .unwrap();
    if let Some(p) = peer {
        req.extensions_mut().insert(ConnectInfo(p));
    }
    let resp = app.clone().oneshot(req).await.unwrap();
    let status = resp.status();
    let cookie = resp
        .headers()
        .get(header::SET_COOKIE)
        .map(|v| v.to_str().unwrap().split(';').next().unwrap().to_string());
    let bytes = to_bytes(resp.into_body(), usize::MAX).await.unwrap();
    Antwort {
        status,
        cookie,
        body: serde_json::from_slice(&bytes).unwrap_or(Value::Null),
    }
}

/// Legt eine aktive UHS an.
async fn uhs_anlegen(app: &axum::Router, cookie: &str, einsatz: i64, bez: &str) -> i64 {
    let (s, v) = anfrage_json(
        app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/uhs"),
        cookie,
        Some(&json!({"typ": "behandlungsplatz", "bezeichnung": bez})),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{v}");
    let uhs = v["id"].as_i64().unwrap();
    let (s, _) = anfrage_json(
        app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/uhs/{uhs}/status"),
        cookie,
        Some(&json!({"status": "aktiv"})),
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    uhs
}

async fn anlegen(
    app: &axum::Router,
    cookie: &str,
    einsatz: i64,
    body: Value,
) -> (StatusCode, Value) {
    anfrage_json(
        app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/geraete"),
        cookie,
        Some(&body),
    )
    .await
}

/// Kopplung anlegen (201) und `(kopplung_id, code)` liefern.
async fn kopplung(app: &axum::Router, cookie: &str, einsatz: i64, body: Value) -> (i64, String) {
    let (s, v) = anlegen(app, cookie, einsatz, body).await;
    assert_eq!(s, StatusCode::CREATED, "{v}");
    (
        v["kopplung"]["id"].as_i64().unwrap(),
        v["code"]["code"].as_str().unwrap().to_string(),
    )
}

/// Ein gekoppeltes UHS-Tablet: `(kopplung_id, geräte-cookie)`.
async fn tablet(app: &axum::Router, cookie: &str, einsatz: i64, uhs: i64) -> (i64, String) {
    let (id, code) = kopplung(
        app,
        cookie,
        einsatz,
        json!({"ansicht": "uhs-tablet", "uhs_id": uhs, "bezeichnung": "Tablet 1"}),
    )
    .await;
    let a = koppeln(app, &code, None).await;
    assert_eq!(a.status, StatusCode::OK, "{:?}", a.body);
    (id, a.cookie.expect("Sitzungscookie"))
}

async fn me(app: &axum::Router, cookie: &str) -> (StatusCode, Value) {
    anfrage(app, "GET", "/api/auth/me", cookie, None).await
}

async fn widerrufen(app: &axum::Router, cookie: &str, einsatz: i64, id: i64) {
    let (s, v) = anfrage(
        app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/geraete/{id}/widerrufen"),
        cookie,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    assert_eq!(v["status"], "widerrufen");
}

async fn geraetekonto(pool: &sqlx::SqlitePool, kopplung_id: i64) -> (i64, String) {
    sqlx::query_as(
        "SELECT b.id, b.benutzername FROM geraet_kopplung gk JOIN benutzer b ON b.id = gk.benutzer_id \
         WHERE gk.id = ?",
    )
    .bind(kopplung_id)
    .fetch_one(pool)
    .await
    .unwrap()
}

// ---------- Verwaltung ----------

#[tokio::test]
async fn fuehrungspersonal_darf_nicht_koppeln() {
    let (app, pool, _live) = setup_mit_pool_und_live().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let fp = benutzer_anlegen(&app, &admin, "fuehrung", "keine").await;
    rolle_setzen(&app, &admin, einsatz, fp, "fuehrungspersonal").await;
    let fp = login_cookie(&app, "fuehrung", "fuehrungpw1").await;

    let (s, _) = anlegen(
        &app,
        &fp,
        einsatz,
        json!({"ansicht": "lagemonitor", "bezeichnung": "Monitor"}),
    )
    .await;
    assert_eq!(s, StatusCode::FORBIDDEN);
    let anzahl: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM geraet_kopplung")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(anzahl, 0, "keine Kopplung entstanden");
    let (s, _) = anfrage(
        &app,
        "GET",
        &format!("/api/einsaetze/{einsatz}/geraete"),
        &fp,
        None,
    )
    .await;
    assert_eq!(
        s,
        StatusCode::FORBIDDEN,
        "Übersicht nur für die Einsatzleitung"
    );
}

#[tokio::test]
async fn anlegen_prueft_eingaben() {
    let (app, _pool, _live) = setup_mit_pool_und_live().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let uhs = uhs_anlegen(&app, &admin, einsatz, "UHS Nord").await;

    let faelle = [
        json!({"ansicht": "uhs-tablet", "bezeichnung": "Tablet 1"}),
        json!({"ansicht": "lagemonitor", "uhs_id": uhs, "bezeichnung": "Monitor"}),
        json!({"ansicht": "kiosk", "bezeichnung": "X"}),
        json!({"ansicht": "lagemonitor", "bezeichnung": "  "}),
        json!({"ansicht": "lagemonitor", "bezeichnung": "x".repeat(61)}),
        json!({"ansicht": "lagemonitor", "bezeichnung": "M", "laeuft_ab_at": "2020-01-01 00:00"}),
        json!({"ansicht": "lagemonitor", "bezeichnung": "M", "laeuft_ab_at": "unsinn"}),
    ];
    for body in faelle {
        let (s, v) = anlegen(&app, &admin, einsatz, body.clone()).await;
        assert_eq!(s, StatusCode::BAD_REQUEST, "{body} → {v}");
    }

    // Über 72 Stunden ab jetzt.
    let zu_weit = (chrono::Utc::now() + chrono::Duration::hours(73))
        .format("%Y-%m-%d %H:%M:%S")
        .to_string();
    let (s, _) = anlegen(
        &app,
        &admin,
        einsatz,
        json!({"ansicht": "lagemonitor", "bezeichnung": "M", "laeuft_ab_at": zu_weit}),
    )
    .await;
    assert_eq!(s, StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn uhs_eines_anderen_einsatzes_ist_404() {
    let (app, _pool, _live) = setup_mit_pool_und_live().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let anderer = einsatz_anlegen_mit(&app, &admin, "Anderer").await;
    let fremde_uhs = uhs_anlegen(&app, &admin, anderer, "UHS Süd").await;

    let (s, _) = anlegen(
        &app,
        &admin,
        einsatz,
        json!({"ansicht": "uhs-tablet", "uhs_id": fremde_uhs, "bezeichnung": "Tablet 1"}),
    )
    .await;
    assert_eq!(s, StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn kein_koppeln_am_abgeschlossenen_einsatz() {
    let (app, _pool, _live) = setup_mit_pool_und_live().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let (s, _) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/abschliessen"),
        &admin,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK);

    let (s, _) = anlegen(
        &app,
        &admin,
        einsatz,
        json!({"ansicht": "lagemonitor", "bezeichnung": "Monitor"}),
    )
    .await;
    assert_eq!(s, StatusCode::CONFLICT);
}

// ---------- Code ----------

#[tokio::test]
async fn code_einloesen_gibt_eine_geraetesitzung() {
    let (app, _pool, _live) = setup_mit_pool_und_live().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let uhs = uhs_anlegen(&app, &admin, einsatz, "UHS Nord").await;
    let (id, code) = kopplung(
        &app,
        &admin,
        einsatz,
        json!({"ansicht": "uhs-tablet", "uhs_id": uhs, "bezeichnung": "Tablet 1"}),
    )
    .await;
    assert_eq!(code.len(), 8);

    // Kleinschreibung und Bindestrich stören nicht.
    let eingabe = format!("{}-{}", &code[..4], &code[4..]).to_lowercase();
    let a = koppeln(&app, &eingabe, None).await;
    assert_eq!(a.status, StatusCode::OK, "{:?}", a.body);
    assert_eq!(a.body["ansicht"], "uhs-tablet");
    let geraet = a.cookie.unwrap();

    let (s, v) = me(&app, &geraet).await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(v["geraet"]["kopplung_id"], id);
    assert_eq!(v["geraet"]["einsatz_id"], einsatz);
    assert_eq!(v["geraet"]["uhs_id"], uhs);
    assert_eq!(v["geraet"]["stelle"], "UHS Nord");
    assert_eq!(v["geraet"]["bezeichnung"], "Tablet 1");
    assert_eq!(v["anzeigename"], "UHS Nord · Tablet 1");

    // Eine Person sieht `geraet: null`.
    let (_, v) = me(&app, &admin).await;
    assert!(v["geraet"].is_null());

    // Die Übersicht zeigt die Kopplung als aktiv.
    let (s, v) = anfrage(
        &app,
        "GET",
        &format!("/api/einsaetze/{einsatz}/geraete"),
        &admin,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(v["kopplungen"][0]["status"], "aktiv");
    assert!(v["kopplungen"][0]["gekoppelt_at"].is_string());
}

#[tokio::test]
async fn code_gilt_nur_einmal() {
    let (app, pool, _live) = setup_mit_pool_und_live().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let (id, code) = kopplung(
        &app,
        &admin,
        einsatz,
        json!({"ansicht": "lagemonitor", "bezeichnung": "Monitor"}),
    )
    .await;
    assert_eq!(koppeln(&app, &code, None).await.status, StatusCode::OK);
    let zweites = koppeln(&app, &code, None).await;
    assert_eq!(zweites.status, StatusCode::UNAUTHORIZED);
    assert!(zweites.cookie.is_none());
    let sitzungen: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM session WHERE kopplung_id = ?")
        .bind(id)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(sitzungen, 1, "keine zweite Sitzung");
}

#[tokio::test]
async fn falscher_und_abgelaufener_code_antworten_gleich() {
    let (app, pool, _live) = setup_mit_pool_und_live().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let (_, code) = kopplung(
        &app,
        &admin,
        einsatz,
        json!({"ansicht": "lagemonitor", "bezeichnung": "Monitor"}),
    )
    .await;
    sqlx::query("UPDATE geraet_kopplungscode SET laeuft_ab_at = datetime('now', '-1 minute')")
        .execute(&pool)
        .await
        .unwrap();

    let abgelaufen = koppeln(&app, &code, None).await;
    let unbekannt = koppeln(&app, "ZZZZZZZZ", None).await;
    let unform = koppeln(&app, "kurz", None).await;
    for a in [&abgelaufen, &unbekannt, &unform] {
        assert_eq!(a.status, StatusCode::UNAUTHORIZED);
        assert!(a.cookie.is_none());
    }
    assert_eq!(abgelaufen.body, unbekannt.body);
    assert_eq!(unbekannt.body, unform.body);
}

#[tokio::test]
async fn zu_viele_fehlversuche_sperren_die_adresse() {
    let (app, _pool, _live) = setup_mit_pool_und_live().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let (_, code) = kopplung(
        &app,
        &admin,
        einsatz,
        json!({"ansicht": "lagemonitor", "bezeichnung": "Monitor"}),
    )
    .await;
    // Eigene Adresse, damit parallele Tests die globale Sperre nicht teilen.
    let peer: SocketAddr = "203.0.113.92:40000".parse().unwrap();
    for i in 0..10 {
        let a = koppeln(&app, "ZZZZZZZZ", Some(peer)).await;
        assert_eq!(a.status, StatusCode::UNAUTHORIZED, "Versuch {i}");
    }
    let a = koppeln(&app, &code, Some(peer)).await;
    assert_eq!(
        a.status,
        StatusCode::TOO_MANY_REQUESTS,
        "auch für einen richtigen Code"
    );
    // Der Code ist nicht verbraucht: von einer anderen Adresse gilt er.
    let frei: SocketAddr = "203.0.113.93:40000".parse().unwrap();
    assert_eq!(
        koppeln(&app, &code, Some(frei)).await.status,
        StatusCode::OK
    );
}

#[tokio::test]
async fn neuer_code_beendet_das_alte_geraet() {
    let (app, _pool, _live) = setup_mit_pool_und_live().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let uhs = uhs_anlegen(&app, &admin, einsatz, "UHS Nord").await;
    let (id, erstes) = tablet(&app, &admin, einsatz, uhs).await;

    let (s, v) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/geraete/{id}/code"),
        &admin,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    // Bis zur Einlösung arbeitet das alte Gerät weiter.
    assert_eq!(me(&app, &erstes).await.0, StatusCode::OK);

    let zweites = koppeln(&app, v["code"]["code"].as_str().unwrap(), None).await;
    assert_eq!(zweites.status, StatusCode::OK);
    assert_eq!(me(&app, &erstes).await.0, StatusCode::UNAUTHORIZED);
    assert_eq!(me(&app, &zweites.cookie.unwrap()).await.0, StatusCode::OK);
}

// ---------- Ende der Kopplung ----------

#[tokio::test]
async fn abgelaufene_kopplung_ist_401() {
    let (app, pool, _live) = setup_mit_pool_und_live().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let uhs = uhs_anlegen(&app, &admin, einsatz, "UHS Nord").await;
    let (id, geraet) = tablet(&app, &admin, einsatz, uhs).await;
    assert_eq!(me(&app, &geraet).await.0, StatusCode::OK);

    sqlx::query(
        "UPDATE geraet_kopplung SET laeuft_ab_at = datetime('now', '-1 minute') WHERE id = ?",
    )
    .bind(id)
    .execute(&pool)
    .await
    .unwrap();
    assert_eq!(me(&app, &geraet).await.0, StatusCode::UNAUTHORIZED);
    let (_, v) = anfrage(
        &app,
        "GET",
        &format!("/api/einsaetze/{einsatz}/geraete"),
        &admin,
        None,
    )
    .await;
    assert_eq!(v["kopplungen"][0]["status"], "abgelaufen");
}

#[tokio::test]
async fn verlaengern_hebt_das_ende_an() {
    let (app, _pool, _live) = setup_mit_pool_und_live().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let (id, _) = kopplung(
        &app,
        &admin,
        einsatz,
        json!({"ansicht": "lagemonitor", "bezeichnung": "Monitor"}),
    )
    .await;
    let ende = (chrono::Utc::now() + chrono::Duration::hours(48))
        .format("%Y-%m-%d %H:%M:%S")
        .to_string();
    let (s, v) = anfrage_json(
        &app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/geraete/{id}/verlaengern"),
        &admin,
        Some(&json!({"laeuft_ab_at": ende})),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    assert_eq!(v["laeuft_ab_at"], ende);

    let zu_weit = (chrono::Utc::now() + chrono::Duration::hours(80))
        .format("%Y-%m-%d %H:%M:%S")
        .to_string();
    let (s, _) = anfrage_json(
        &app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/geraete/{id}/verlaengern"),
        &admin,
        Some(&json!({"laeuft_ab_at": zu_weit})),
    )
    .await;
    assert_eq!(s, StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn einsatzabschluss_beendet_jede_kopplung() {
    let (app, _pool, _live) = setup_mit_pool_und_live().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let uhs = uhs_anlegen(&app, &admin, einsatz, "UHS Nord").await;
    let (_, geraet) = tablet(&app, &admin, einsatz, uhs).await;
    let mut strom = live_geraet(&app, &geraet, einsatz).await;

    let (s, _) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/abschliessen"),
        &admin,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    assert!(
        strom_endet(&mut strom).await,
        "Live-Kanal endet mit dem Abschluss"
    );
    assert_eq!(me(&app, &geraet).await.0, StatusCode::UNAUTHORIZED);
}

/// Öffnet den Live-Kanal eines Geräts und liefert den offenen Body.
async fn live_geraet(app: &axum::Router, cookie: &str, einsatz: i64) -> Body {
    let resp = common::live_oeffnen(app, cookie, einsatz).await;
    resp.into_body()
}

/// Liest den Strom, bis er endet (`true`) oder 3 s lang offen bleibt (`false`). Gelesene
/// Ereignisnamen landen in `ereignisse`.
async fn strom_lesen(body: &mut Body, ereignisse: &mut Vec<String>, frist: Duration) -> bool {
    use http_body_util::BodyExt;
    let ende = tokio::time::Instant::now() + frist;
    loop {
        let rest = ende.saturating_duration_since(tokio::time::Instant::now());
        match tokio::time::timeout(rest, std::pin::Pin::new(&mut *body).frame()).await {
            Err(_) => return false,
            Ok(None) => return true,
            Ok(Some(Err(_))) => return true,
            Ok(Some(Ok(frame))) => {
                if let Some(daten) = frame.data_ref() {
                    for zeile in String::from_utf8_lossy(daten).lines() {
                        if let Some(name) = zeile.strip_prefix("event:") {
                            ereignisse.push(name.trim().to_string());
                        }
                    }
                }
            }
        }
    }
}

async fn strom_endet(body: &mut Body) -> bool {
    strom_lesen(body, &mut Vec::new(), Duration::from_secs(3)).await
}

#[tokio::test]
async fn widerruf_schliesst_den_offenen_kanal_und_sperrt_die_naechste_anfrage() {
    let (app, _pool, _live) = setup_mit_pool_und_live().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let uhs = uhs_anlegen(&app, &admin, einsatz, "UHS Nord").await;
    let (id, geraet) = tablet(&app, &admin, einsatz, uhs).await;
    let (_, monitor_code) = kopplung(
        &app,
        &admin,
        einsatz,
        json!({"ansicht": "lagemonitor", "bezeichnung": "Monitor"}),
    )
    .await;
    let monitor = koppeln(&app, &monitor_code, None).await.cookie.unwrap();

    let mut strom = live_geraet(&app, &geraet, einsatz).await;
    let mut monitor_strom = live_geraet(&app, &monitor, einsatz).await;
    // Der Strom ist offen, solange niemand widerruft.
    assert!(!strom_lesen(&mut strom, &mut Vec::new(), Duration::from_millis(300)).await);

    widerrufen(&app, &admin, einsatz, id).await;
    assert!(
        strom_endet(&mut strom).await,
        "der Server schließt den Kanal"
    );
    assert_eq!(me(&app, &geraet).await.0, StatusCode::UNAUTHORIZED);

    // Das andere Gerät arbeitet weiter.
    assert!(
        !strom_lesen(
            &mut monitor_strom,
            &mut Vec::new(),
            Duration::from_millis(300)
        )
        .await,
        "der Kanal des Monitors bleibt offen"
    );
    assert_eq!(me(&app, &monitor).await.0, StatusCode::OK);

    // Ein zweiter Widerruf ändert nichts und schreibt keinen zweiten Eintrag.
    widerrufen(&app, &admin, einsatz, id).await;
    let widerrufe = system_etb_inhalte(&app, &admin, einsatz)
        .await
        .into_iter()
        .filter(|t| t.contains("widerrufen"))
        .count();
    assert_eq!(widerrufe, 1);
}

#[tokio::test]
async fn live_kanal_des_tablets_traegt_kein_etb() {
    let (app, pool, live) = setup_mit_pool_und_live().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let uhs = uhs_anlegen(&app, &admin, einsatz, "UHS Nord").await;
    let (_, geraet) = tablet(&app, &admin, einsatz, uhs).await;

    let mut tablet_strom = live_geraet(&app, &geraet, einsatz).await;
    let mut admin_strom = live_geraet(&app, &admin, einsatz).await;
    let etb_id: i64 = sqlx::query_scalar("SELECT MAX(id) FROM etb_eintrag WHERE einsatz_id = ?")
        .bind(einsatz)
        .fetch_one(&pool)
        .await
        .unwrap();
    live.publiziere(einsatz, etb_id);

    let mut beim_admin = Vec::new();
    strom_lesen(
        &mut admin_strom,
        &mut beim_admin,
        Duration::from_millis(500),
    )
    .await;
    assert!(
        beim_admin.iter().any(|e| e == "etb"),
        "Gegenprobe: {beim_admin:?}"
    );
    let mut beim_tablet = Vec::new();
    strom_lesen(
        &mut tablet_strom,
        &mut beim_tablet,
        Duration::from_millis(500),
    )
    .await;
    assert!(!beim_tablet.iter().any(|e| e == "etb"), "{beim_tablet:?}");
}

// ---------- Schranke ----------

#[tokio::test]
async fn geraet_erreicht_nur_gelistete_routen_seines_einsatzes() {
    let (app, _pool, _live) = setup_mit_pool_und_live().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let anderer = einsatz_anlegen_mit(&app, &admin, "Anderer").await;
    let uhs = uhs_anlegen(&app, &admin, einsatz, "UHS Nord").await;
    let (_, geraet) = tablet(&app, &admin, einsatz, uhs).await;

    let (s, _) = anfrage(
        &app,
        "GET",
        &format!("/api/einsaetze/{einsatz}"),
        &geraet,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK, "Einsatzkopf ist gelistet");

    for (methode, uri) in [
        ("GET", format!("/api/einsaetze/{einsatz}/etb")),
        ("GET", format!("/api/einsaetze/{einsatz}/geraete")),
        ("GET", "/api/einsaetze".to_string()),
        ("GET", "/api/benutzer".to_string()),
        ("POST", format!("/api/einsaetze/{einsatz}/abschliessen")),
        ("GET", "/api/live".to_string()),
    ] {
        let (s, _) = anfrage(&app, methode, &uri, &geraet, None).await;
        assert_eq!(s, StatusCode::FORBIDDEN, "{methode} {uri}");
    }

    let (s, _) = anfrage(
        &app,
        "GET",
        &format!("/api/einsaetze/{anderer}"),
        &geraet,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::NOT_FOUND, "anderer Einsatz");
}

#[tokio::test]
async fn modulfreigaben_des_geraets_folgen_der_ansicht() {
    let (app, _pool, _live) = setup_mit_pool_und_live().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let uhs = uhs_anlegen(&app, &admin, einsatz, "UHS Nord").await;
    let (_, geraet) = tablet(&app, &admin, einsatz, uhs).await;

    let (s, v) = anfrage(
        &app,
        "GET",
        &format!("/api/einsaetze/{einsatz}/modul-freigaben"),
        &geraet,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    // Antwort: Modul-Key → Freigabe.
    let sichtbar: Vec<&String> = v
        .as_object()
        .unwrap()
        .iter()
        .filter(|(_, f)| f["sichtbar"] == true)
        .map(|(k, _)| k)
        .collect();
    assert!(!sichtbar.is_empty(), "{v}");
    for m in sichtbar {
        assert!(
            ["unfallhilfsstellen", "personen"].contains(&m.as_str()),
            "Modul {m} gehört nicht zum Tablet: {v}"
        );
    }
}

#[tokio::test]
async fn modulfreigabe_sperrt_zusaetzlich() {
    let (app, _pool, _live) = setup_mit_pool_und_live().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let uhs = uhs_anlegen(&app, &admin, einsatz, "UHS Nord").await;
    let (_, geraet) = tablet(&app, &admin, einsatz, uhs).await;

    let (s, v) = anfrage_json(
        &app,
        "PUT",
        &format!("/api/einsaetze/{einsatz}/modul-overrides/personen"),
        &admin,
        Some(&json!({"sichtbar": true, "benoetigte_rolle": "fuehrungskraft"})),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");

    let (_, v) = anfrage(
        &app,
        "GET",
        &format!("/api/einsaetze/{einsatz}/modul-freigaben"),
        &geraet,
        None,
    )
    .await;
    assert_eq!(v["personen"]["zugriff"], false, "{v}");
    assert_eq!(v["unfallhilfsstellen"]["zugriff"], true, "{v}");

    // Die Kopplungsmaske nennt die Sperre vorab.
    let (_, v) = anfrage(
        &app,
        "GET",
        &format!("/api/einsaetze/{einsatz}/geraete"),
        &admin,
        None,
    )
    .await;
    let tablet = v["sperren"]
        .as_array()
        .unwrap()
        .iter()
        .find(|s| s["ansicht"] == "uhs-tablet")
        .unwrap();
    assert_eq!(tablet["gesperrte_module"], json!(["personen"]));
}

// ---------- Gerätekonto ----------

#[tokio::test]
async fn geraetekonto_ist_keine_person() {
    let (app, pool, _live) = setup_mit_pool_und_live().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let (id, _) = kopplung(
        &app,
        &admin,
        einsatz,
        json!({"ansicht": "lagemonitor", "bezeichnung": "Monitor"}),
    )
    .await;
    let (konto, benutzername) = geraetekonto(&pool, id).await;

    let (s, v) = anfrage(&app, "GET", "/api/benutzer", &admin, None).await;
    assert_eq!(s, StatusCode::OK);
    assert!(
        v.as_array().unwrap().iter().all(|b| b["id"] != konto),
        "Benutzerliste ohne Gerätekonto: {v}"
    );
    for (methode, uri, body) in [
        (
            "PATCH",
            format!("/api/benutzer/{konto}"),
            Some(r#"{"anzeigename":"X"}"#),
        ),
        ("POST", format!("/api/benutzer/{konto}/deaktivieren"), None),
        ("POST", format!("/api/benutzer/{konto}/totp/reset"), None),
        (
            "PUT",
            format!("/api/einsaetze/{einsatz}/mitglieder/{konto}"),
            Some(r#"{"einsatz_rolle":"fuehrungspersonal"}"#),
        ),
    ] {
        let (s, v) = anfrage(&app, methode, &uri, &admin, body).await;
        assert_eq!(s, StatusCode::NOT_FOUND, "{methode} {uri}: {v}");
    }

    // Passwortanmeldung scheitert wie mit falschem Passwort.
    let falsch = anfrage(
        &app,
        "POST",
        "/api/auth/login",
        "",
        Some(&json!({"benutzername": "admin", "passwort": "falsch"}).to_string()),
    )
    .await;
    let geraet = anfrage(
        &app,
        "POST",
        "/api/auth/login",
        "",
        Some(&json!({"benutzername": benutzername, "passwort": "irgendwas"}).to_string()),
    )
    .await;
    assert_eq!(geraet.0, StatusCode::UNAUTHORIZED);
    assert_eq!(geraet, falsch);
}

// ---------- Audit ----------

#[tokio::test]
async fn kopplung_ist_auditiert() {
    let (app, pool, _live) = setup_mit_pool_und_live().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let uhs = uhs_anlegen(&app, &admin, einsatz, "UHS Nord").await;
    let (id, code) = kopplung(
        &app,
        &admin,
        einsatz,
        json!({"ansicht": "uhs-tablet", "uhs_id": uhs, "bezeichnung": "Tablet 1"}),
    )
    .await;
    let (konto, _) = geraetekonto(&pool, id).await;
    let peer: SocketAddr = "203.0.113.94:40000".parse().unwrap();
    sqlx::query("DELETE FROM auth_audit")
        .execute(&pool)
        .await
        .unwrap();

    assert_eq!(
        koppeln(&app, "ZZZZZZZZ", Some(peer)).await.status,
        StatusCode::UNAUTHORIZED
    );
    assert_eq!(
        koppeln(&app, &code, Some(peer)).await.status,
        StatusCode::OK
    );
    widerrufen(&app, &admin, einsatz, id).await;

    let audit: Vec<(String, String, Option<i64>, Option<String>)> = sqlx::query_as(
        "SELECT ereignis, provider, benutzer_id, peer_ip FROM auth_audit ORDER BY id",
    )
    .fetch_all(&pool)
    .await
    .unwrap();
    let ip = Some("203.0.113.94".to_string());
    assert_eq!(
        audit,
        [
            (
                "login_fehlgeschlagen".into(),
                "geraetecode".into(),
                None,
                ip.clone()
            ),
            ("login_ok".into(), "geraetecode".into(), Some(konto), ip),
        ]
    );

    let spur: Vec<String> = sqlx::query_scalar(
        "SELECT ereignis FROM geraet_kopplung_ereignis WHERE kopplung_id = ? ORDER BY id",
    )
    .bind(id)
    .fetch_all(&pool)
    .await
    .unwrap();
    assert_eq!(
        spur,
        ["angelegt", "code_ausgestellt", "eingeloest", "widerrufen"]
    );

    let (_, etb) = anfrage(
        &app,
        "GET",
        &format!("/api/einsaetze/{einsatz}/etb"),
        &admin,
        None,
    )
    .await;
    let system: Vec<(&str, &str)> = etb
        .as_array()
        .unwrap()
        .iter()
        .filter(|e| e["typ"] == "system")
        .map(|e| {
            (
                e["inhalt"].as_str().unwrap(),
                e["erfasser_name"].as_str().unwrap(),
            )
        })
        .collect();
    let finde = |wort: &str| {
        system
            .iter()
            .find(|(t, _)| t.contains("UHS Nord · Tablet 1") && t.contains(wort))
            .unwrap_or_else(|| panic!("kein ETB-Eintrag „{wort}“: {system:?}"))
    };
    finde("angelegt");
    assert_eq!(
        finde("gekoppelt").1,
        "UHS Nord · Tablet 1",
        "Erfasser ist das Gerät"
    );
    assert!(finde("widerrufen").0.contains("widerrufen von"));
}

// ---------- Stellenbindung (Subtask UHS-Tablet) ----------

/// Zwei aktive UHS und ein Tablet der ersten: `(einsatz, nord, sued, tablet-cookie)`.
async fn zwei_uhs_mit_tablet(app: &axum::Router, admin: &str) -> (i64, i64, i64, String) {
    let einsatz = einsatz_anlegen(app, admin).await;
    let nord = uhs_anlegen(app, admin, einsatz, "UHS Nord").await;
    let sued = uhs_anlegen(app, admin, einsatz, "UHS Süd").await;
    let (_, geraet) = tablet(app, admin, einsatz, nord).await;
    (einsatz, nord, sued, geraet)
}

/// Person mit Eintritt in `uhs` (Aufnahme in einem Schritt), angelegt von `cookie`.
async fn person_in(app: &axum::Router, cookie: &str, einsatz: i64, uhs: Option<i64>) -> Value {
    let mut body = json!({"name": "Muster", "vorname": "Max"});
    if let Some(u) = uhs {
        body["uhs_id"] = json!(u);
    }
    let (s, v) = anfrage_json(
        app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/personen"),
        cookie,
        Some(&body),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{v}");
    v
}

#[tokio::test]
async fn tablet_kennt_nur_die_eigene_uhs() {
    let (app, _pool, _live) = setup_mit_pool_und_live().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let (einsatz, nord, sued, geraet) = zwei_uhs_mit_tablet(&app, &admin).await;

    let (s, v) = anfrage(
        &app,
        "GET",
        &format!("/api/einsaetze/{einsatz}/uhs"),
        &geraet,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    let ids: Vec<i64> = v
        .as_array()
        .unwrap()
        .iter()
        .map(|u| u["id"].as_i64().unwrap())
        .collect();
    assert_eq!(ids, vec![nord], "UHS-Liste nur mit der eigenen UHS");

    let (s, v) = anfrage(
        &app,
        "GET",
        &format!("/api/einsaetze/{einsatz}/uhs/{nord}"),
        &geraet,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    assert_eq!(v["material"], json!([]), "Das Tablet liest kein Material");

    let (s, _) = anfrage(
        &app,
        "GET",
        &format!("/api/einsaetze/{einsatz}/uhs/{sued}"),
        &geraet,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::NOT_FOUND, "fremde UHS");

    // Der Personenzähler zählt den ganzen Einsatz und fehlt deshalb am Tablet.
    person_in(&app, &admin, einsatz, Some(sued)).await;
    let (s, v) = anfrage(
        &app,
        "GET",
        &format!("/api/einsaetze/{einsatz}/modul-zaehler"),
        &geraet,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    assert!(v.get("personen").is_none(), "{v}");
}

#[tokio::test]
async fn tablet_setzt_verfuegbarkeit_aber_bearbeitet_den_grundriss_nicht() {
    let (app, _pool, _live) = setup_mit_pool_und_live().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let (einsatz, nord, sued, geraet) = zwei_uhs_mit_tablet(&app, &admin).await;
    let platz = |uhs: i64| {
        let app = app.clone();
        let admin = admin.clone();
        async move {
            let (s, v) = anfrage_json(
                &app,
                "POST",
                &format!("/api/einsaetze/{einsatz}/uhs/{uhs}/plaetze"),
                &admin,
                Some(&json!({"typ": "bett", "bezeichnung": "B1"})),
            )
            .await;
            assert_eq!(s, StatusCode::CREATED, "{v}");
            v["id"].as_i64().unwrap()
        }
    };
    let platz_nord = platz(nord).await;
    let platz_sued = platz(sued).await;

    let (s, v) = anfrage_json(
        &app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/uhs/{nord}/plaetze"),
        &geraet,
        Some(&json!({"typ": "bett", "bezeichnung": "B2"})),
    )
    .await;
    assert_eq!(s, StatusCode::FORBIDDEN, "Grundriss bearbeiten: {v}");

    let verfuegbarkeit = |uhs: i64, pid: i64| {
        format!("/api/einsaetze/{einsatz}/uhs/{uhs}/plaetze/{pid}/verfuegbarkeit")
    };
    let (s, v) = anfrage_json(
        &app,
        "POST",
        &verfuegbarkeit(nord, platz_nord),
        &geraet,
        Some(&json!({"verfuegbarkeit": "gesperrt"})),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "eigene UHS: {v}");
    let (s, _) = anfrage_json(
        &app,
        "POST",
        &verfuegbarkeit(sued, platz_sued),
        &geraet,
        Some(&json!({"verfuegbarkeit": "gesperrt"})),
    )
    .await;
    assert_eq!(s, StatusCode::NOT_FOUND, "fremde UHS");
}

#[tokio::test]
async fn aufnahme_am_tablet_steht_im_eingang_der_eigenen_uhs() {
    let (app, _pool, _live) = setup_mit_pool_und_live().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let (einsatz, nord, sued, geraet) = zwei_uhs_mit_tablet(&app, &admin).await;

    // Ohne Angabe bucht der Server in die eigene UHS, im selben Schritt.
    let p = person_in(&app, &geraet, einsatz, None).await;
    assert_eq!(p["aktuelle_uhs_id"], json!(nord), "{p}");
    assert_eq!(
        p["aktueller_platz_id"],
        Value::Null,
        "Eingang ohne Platz: {p}"
    );

    let (s, v) = anfrage(
        &app,
        "GET",
        &format!("/api/einsaetze/{einsatz}/personen"),
        &geraet,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    assert!(
        v.as_array().unwrap().iter().any(|x| x["id"] == p["id"]),
        "in der Patientenliste des Tablets: {v}"
    );

    // Eine andere UHS lässt das Tablet nicht zu.
    let (s, v) = anfrage_json(
        &app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/personen"),
        &geraet,
        Some(&json!({"name": "Fremd", "uhs_id": sued})),
    )
    .await;
    assert_eq!(s, StatusCode::FORBIDDEN, "{v}");
}

#[tokio::test]
async fn aufnahme_scheitert_ganz_wenn_der_eintritt_scheitert() {
    let (app, pool, _live) = setup_mit_pool_und_live().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let (einsatz, nord, _sued, geraet) = zwei_uhs_mit_tablet(&app, &admin).await;
    let (s, v) = anfrage_json(
        &app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/uhs/{nord}/status"),
        &admin,
        Some(&json!({"status": "aufgeloest"})),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    let vorher: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM einsatz_person WHERE einsatz_id = ?")
            .bind(einsatz)
            .fetch_one(&pool)
            .await
            .unwrap();

    let (s, v) = anfrage_json(
        &app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/personen"),
        &geraet,
        Some(&json!({"name": "Muster"})),
    )
    .await;
    assert!(
        s.is_client_error(),
        "aufgelöste UHS nimmt niemanden auf: {s} {v}"
    );
    let nachher: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM einsatz_person WHERE einsatz_id = ?")
            .bind(einsatz)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(nachher, vorher, "keine Person ohne Eintritt");
}

#[tokio::test]
async fn person_der_anderen_uhs_ist_fuer_das_tablet_404() {
    let (app, _pool, _live) = setup_mit_pool_und_live().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let (einsatz, _nord, sued, geraet) = zwei_uhs_mit_tablet(&app, &admin).await;
    let fremd = person_in(&app, &admin, einsatz, Some(sued)).await;
    let ohne = person_in(&app, &admin, einsatz, None).await;

    let (_, liste) = anfrage(
        &app,
        "GET",
        &format!("/api/einsaetze/{einsatz}/personen"),
        &geraet,
        None,
    )
    .await;
    assert_eq!(liste, json!([]), "keine fremde Person in der Liste");

    for p in [&fremd, &ohne] {
        let pid = p["id"].as_i64().unwrap();
        let basis = format!("/api/einsaetze/{einsatz}/personen/{pid}");
        for (methode, uri, body) in [
            ("GET", basis.clone(), None),
            ("PATCH", basis.clone(), Some(json!({"name": "X"}))),
            (
                "POST",
                format!("{basis}/sichtung"),
                Some(json!({"kategorie": "sk2"})),
            ),
            (
                "POST",
                format!("{basis}/verbleib"),
                Some(json!({"art": "entlassung"})),
            ),
            (
                "POST",
                format!("{basis}/notizen"),
                Some(json!({"text": "x"})),
            ),
            (
                "POST",
                format!("{basis}/uhs-belegung"),
                Some(json!({"art": "austritt"})),
            ),
        ] {
            let (s, v) = anfrage_json(&app, methode, &uri, &geraet, body.as_ref()).await;
            assert_eq!(s, StatusCode::NOT_FOUND, "{methode} {uri}: {v}");
        }
    }
}

#[tokio::test]
async fn tablet_bucht_nicht_in_eine_fremde_uhs() {
    let (app, _pool, _live) = setup_mit_pool_und_live().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let (einsatz, _nord, sued, geraet) = zwei_uhs_mit_tablet(&app, &admin).await;
    let p = person_in(&app, &geraet, einsatz, None).await;
    let pid = p["id"].as_i64().unwrap();

    let (s, v) = anfrage_json(
        &app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/personen/{pid}/uhs-belegung"),
        &geraet,
        Some(&json!({"art": "wechsel", "uhs_id": sued})),
    )
    .await;
    assert_eq!(s, StatusCode::FORBIDDEN, "Wechsel in die UHS Süd: {v}");

    // Die Einsatzleitung verlegt die Person; danach nimmt das Tablet sie nicht mehr heraus.
    let (s, v) = anfrage_json(
        &app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/personen/{pid}/uhs-belegung"),
        &admin,
        Some(&json!({"art": "wechsel", "uhs_id": sued})),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{v}");
    let (s, v) = anfrage_json(
        &app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/personen/{pid}/uhs-belegung"),
        &geraet,
        Some(&json!({"art": "austritt"})),
    )
    .await;
    assert_eq!(s, StatusCode::FORBIDDEN, "Austritt aus der UHS Süd: {v}");
}

#[tokio::test]
async fn tablet_traegt_den_verbleib_nach_dem_austritt_ein() {
    let (app, _pool, _live) = setup_mit_pool_und_live().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let (einsatz, _nord, _sued, geraet) = zwei_uhs_mit_tablet(&app, &admin).await;
    let p = person_in(&app, &geraet, einsatz, None).await;
    let pid = p["id"].as_i64().unwrap();

    let (s, v) = anfrage_json(
        &app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/personen/{pid}/uhs-belegung"),
        &geraet,
        Some(&json!({"art": "austritt"})),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "Austritt aus der eigenen UHS: {v}");

    let (s, v) = anfrage_json(
        &app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/personen/{pid}/verbleib"),
        &geraet,
        Some(&json!({"art": "transport", "ziel": "KH Mitte"})),
    )
    .await;
    assert!(s.is_success(), "Verbleib nach Austritt: {s} {v}");
    let (s, v) = anfrage(
        &app,
        "GET",
        &format!("/api/einsaetze/{einsatz}/personen/{pid}"),
        &geraet,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    assert_eq!(v["abgleiche"], json!([]), "kein Abgleich am Gerät");
}
