//! Transportzusicherungen des Live-Feeds `GET /api/einsaetze/{id}/live` (LFH-624).
//!
//! Die Sichtbarkeitsregeln des Feeds (Modul-Filter, Replay) prüft `modul_override.rs`;
//! hier steht, WANN und WIE die Verbindung ihr erstes Byte liefert, wie viele Ströme ein
//! Benutzer offen halten darf und wann ein Strom endet (LFH-920, `live::strom`).

use axum::body::Body;
use axum::http::{header, Request, StatusCode};
use http_body_util::BodyExt;
use tower::ServiceExt;

mod common;
use common::{anfrage, einsatz_anlegen, login_cookie, setup, test_state};

use lifeline_hub::live::strom::StromGrenzen;
use lifeline_hub::live::{LiveEvent, LiveHub};
use std::time::Duration;

/// Der Feed schickt sein erstes Byte **sofort**, nicht erst mit dem Keep-Alive.
///
/// Proxies wie `http-proxy-3` (Vite-Dev-Proxy) setzen Status und Header erst mit dem ersten
/// Body-Byte ab. Ohne Ereignis war das der Keep-Alive-Kommentar nach `KeepAlive::default()` =
/// 15 s — so lange stand die Kopfleiste auf „VERBINDE", weil `EventSource.onopen` die Header
/// braucht. Jeder Proxy, der bis zum ersten Byte puffert, verhält sich so.
///
/// Das erste Frame besteht **nur aus Kommentarzeilen** (`:`): der Browser verwirft es,
/// und ohne `id:`-Zeile bleibt die `Last-Event-ID` des Reconnect-Resyncs, wie sie war.
/// Deshalb wird jede Zeile geprüft und nicht bloß der Anfang: ein Kommentar, an dem ein
/// `.id(…)` oder `.event(…)` hängt, beginnt ebenfalls mit `:` und fiele sonst durch.
#[tokio::test]
async fn live_feed_sendet_sein_erstes_byte_sofort() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let eid = einsatz_anlegen(&app, &admin).await;

    let feed = app
        .oneshot(
            Request::builder()
                .uri(format!("/api/einsaetze/{eid}/live"))
                .header(header::COOKIE, admin)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(feed.status(), StatusCode::OK);

    let mut body = feed.into_body();
    // Eine Sekunde liegt weit unter den 15 s des Keep-Alive und lässt Luft gegen Last.
    let frame = tokio::time::timeout(
        std::time::Duration::from_secs(1),
        std::pin::Pin::new(&mut body).frame(),
    )
    .await
    .expect("ohne Ereignis muss der Feed trotzdem sofort ein erstes Frame schicken")
    .expect("Stream darf nicht enden")
    .expect("Frame ohne Fehler");
    let erstes = String::from_utf8_lossy(frame.data_ref().expect("Datenframe")).into_owned();

    assert!(
        erstes.lines().any(|z| z.starts_with(':')),
        "das erste Frame trägt einen SSE-Kommentar, war: {erstes:?}"
    );
    assert!(
        erstes.lines().all(|z| z.is_empty() || z.starts_with(':')),
        "das erste Frame trägt nur Kommentarzeilen, kein id:/event:/data:, war: {erstes:?}"
    );
}

/// Router mit eigenen Stromgrenzen, dazu Pool und Hub.
async fn setup_mit_grenzen(grenzen: StromGrenzen) -> (axum::Router, sqlx::SqlitePool, LiveHub) {
    let pool = lifeline_hub::db::test_pool().await;
    lifeline_hub::auth::bootstrap::bootstrap_admin(&pool, "Test-Orga", "admin", Some("startpw12"))
        .await
        .unwrap();
    let live = LiveHub::mit_stromgrenzen(grenzen);
    let router = lifeline_hub::app::build_router(test_state(&pool, &live));
    (router, pool, live)
}

fn grenzen(je_benutzer: usize, gesamt: usize) -> StromGrenzen {
    StromGrenzen {
        je_benutzer,
        gesamt,
        ..StromGrenzen::default()
    }
}

/// Öffnet `pfad` mit optionaler `Last-Event-ID`; der Body bleibt offen, solange die Response lebt.
async fn oeffnen(
    app: &axum::Router,
    pfad: &str,
    cookie: &str,
    last_event_id: Option<&str>,
) -> axum::response::Response {
    let mut req = Request::builder()
        .uri(pfad)
        .header(header::COOKIE, cookie.to_string());
    if let Some(id) = last_event_id {
        req = req.header("last-event-id", id);
    }
    app.clone()
        .oneshot(req.body(Body::empty()).unwrap())
        .await
        .unwrap()
}

/// Liest einen Strom bis zu seinem Ende; scheitert, wenn er binnen `frist` nicht endet.
async fn bis_zum_ende(resp: axum::response::Response, frist: Duration) -> String {
    let mut body = resp.into_body();
    let mut gelesen = String::new();
    tokio::time::timeout(frist, async {
        while let Some(frame) = std::pin::Pin::new(&mut body).frame().await {
            if let Some(daten) = frame.expect("Frame ohne Fehler").data_ref() {
                gelesen.push_str(&String::from_utf8_lossy(daten));
            }
        }
    })
    .await
    .unwrap_or_else(|_| panic!("der Strom endete nicht binnen {frist:?}, gelesen: {gelesen:?}"));
    gelesen
}

async fn benutzer_id(pool: &sqlx::SqlitePool, name: &str) -> i64 {
    sqlx::query_scalar("SELECT id FROM benutzer WHERE benutzername = ?")
        .bind(name)
        .fetch_one(pool)
        .await
        .unwrap()
}

/// Je Benutzer höchstens N Ströme, Einsatz- und Org-Strom zählen gemeinsam; der überzählige
/// bekommt 429 im `{error}`-Format, und ein geschlossener Strom gibt seinen Platz zurück.
#[tokio::test]
async fn je_benutzer_hoechstens_n_stroeme_und_der_platz_faellt_zurueck() {
    let (app, pool, live) = setup_mit_grenzen(grenzen(2, 100)).await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let eid = einsatz_anlegen(&app, &admin).await;
    let feed = format!("/api/einsaetze/{eid}/live");
    let admin_id = benutzer_id(&pool, "admin").await;

    let erster = oeffnen(&app, &feed, &admin, None).await;
    assert_eq!(erster.status(), StatusCode::OK);
    let zweiter = oeffnen(&app, "/api/live", &admin, None).await;
    assert_eq!(zweiter.status(), StatusCode::OK);
    assert_eq!(live.stroeme.offen(admin_id), 2);

    for pfad in [feed.as_str(), "/api/live"] {
        let dritter = oeffnen(&app, pfad, &admin, None).await;
        assert_eq!(dritter.status(), StatusCode::TOO_MANY_REQUESTS, "{pfad}");
        let text = String::from_utf8_lossy(
            &axum::body::to_bytes(dritter.into_body(), 64 * 1024)
                .await
                .unwrap(),
        )
        .into_owned();
        assert!(text.contains("\"error\""), "{{error}}-Format, war: {text}");
    }

    drop(erster);
    assert_eq!(
        live.stroeme.offen(admin_id),
        1,
        "der Platz fällt mit dem Strom"
    );
    let wieder = oeffnen(&app, &feed, &admin, None).await;
    assert_eq!(
        wieder.status(),
        StatusCode::OK,
        "nach dem Schließen ist Platz"
    );
    drop(zweiter);
}

/// Die Gesamtgrenze greift über Benutzer hinweg mit 503.
#[tokio::test]
async fn gesamtgrenze_greift_mit_503() {
    let (app, _pool, _live) = setup_mit_grenzen(grenzen(5, 1)).await;
    let admin = login_cookie(&app, "admin", "startpw12").await;

    let erster = oeffnen(&app, "/api/live", &admin, None).await;
    assert_eq!(erster.status(), StatusCode::OK);
    let zweiter = oeffnen(&app, "/api/live", &admin, None).await;
    assert_eq!(zweiter.status(), StatusCode::SERVICE_UNAVAILABLE);
    drop(erster);
}

/// Jeder Strom endet nach seiner Lebensdauer und gibt seinen Platz frei; der Reconnect mit
/// `Last-Event-ID` liefert, was dazwischen geschah.
#[tokio::test]
async fn strom_endet_nach_der_lebensdauer_und_der_reconnect_holt_nach() {
    let (app, pool, live) = setup_mit_grenzen(StromGrenzen {
        lebensdauer: Duration::from_millis(400),
        streuung: Duration::ZERO,
        ..StromGrenzen::default()
    })
    .await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let eid = einsatz_anlegen(&app, &admin).await;
    let feed = format!("/api/einsaetze/{eid}/live");
    let admin_id = benutzer_id(&pool, "admin").await;

    let strom = oeffnen(&app, &feed, &admin, None).await;
    assert_eq!(strom.status(), StatusCode::OK);
    live.publiziere_einsatz(eid, LiveEvent::Einsatz);
    let gelesen = bis_zum_ende(strom, Duration::from_secs(5)).await;
    let letzte_id = gelesen
        .lines()
        .filter_map(|z| z.strip_prefix("id: "))
        .last()
        .unwrap_or_else(|| panic!("ein Ereignis mit id:, gelesen: {gelesen:?}"))
        .to_string();
    assert_eq!(
        live.stroeme.offen(admin_id),
        0,
        "das Ende gibt den Platz frei"
    );

    // Während der Browser neu verbindet, geschieht etwas.
    live.publiziere_einsatz(eid, LiveEvent::Einsatz);
    let wieder = oeffnen(&app, &feed, &admin, Some(&letzte_id)).await;
    assert_eq!(wieder.status(), StatusCode::OK);
    let nachgeholt = bis_zum_ende(wieder, Duration::from_secs(5)).await;
    let ids: Vec<&str> = nachgeholt
        .lines()
        .filter_map(|z| z.strip_prefix("id: "))
        .collect();
    assert_eq!(
        ids.len(),
        1,
        "genau das verpasste Ereignis, war: {nachgeholt:?}"
    );
    assert_ne!(ids[0], letzte_id);
    assert!(!nachgeholt.contains("event: lagged"), "{nachgeholt:?}");
}

/// Nach der Abmeldung scheitert der Reconnect am Ende der Lebensdauer mit 401: die Sitzung
/// wirkt spätestens dann (Einsatz- und Org-Strom).
#[tokio::test]
async fn nach_der_abmeldung_scheitert_der_reconnect_mit_401() {
    let (app, _pool, _live) = setup_mit_grenzen(StromGrenzen {
        lebensdauer: Duration::from_millis(300),
        streuung: Duration::ZERO,
        ..StromGrenzen::default()
    })
    .await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let eid = einsatz_anlegen(&app, &admin).await;
    let feed = format!("/api/einsaetze/{eid}/live");

    let einsatz_strom = oeffnen(&app, &feed, &admin, None).await;
    let org_strom = oeffnen(&app, "/api/live", &admin, None).await;
    let (status, _) = anfrage(&app, "POST", "/api/auth/logout", &admin, None).await;
    assert!(status.is_success(), "Abmeldung: {status}");

    bis_zum_ende(einsatz_strom, Duration::from_secs(5)).await;
    bis_zum_ende(org_strom, Duration::from_secs(5)).await;
    for pfad in [feed.as_str(), "/api/live"] {
        let wieder = oeffnen(&app, pfad, &admin, None).await;
        assert_eq!(wieder.status(), StatusCode::UNAUTHORIZED, "{pfad}");
    }
}

/// Beide Ströme schicken gleich zu Beginn eine gestreute Wartezeit für das Neuverbinden
/// (`retry:`), damit die Tabs nach einem Neustart nicht im selben Augenblick zurückkommen.
#[tokio::test]
async fn stroeme_senden_eine_gestreute_wartezeit() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let eid = einsatz_anlegen(&app, &admin).await;

    for pfad in [
        format!("/api/einsaetze/{eid}/live"),
        "/api/live".to_string(),
    ] {
        let resp = oeffnen(&app, &pfad, &admin, None).await;
        let anfang = common::sse_anfang_lesen(resp.into_body(), 300).await;
        let retry: u64 = anfang
            .lines()
            .find_map(|z| z.strip_prefix("retry:"))
            .unwrap_or_else(|| panic!("{pfad}: kein retry:, war {anfang:?}"))
            .trim()
            .parse()
            .expect("retry in Millisekunden");
        assert!((1000..=5000).contains(&retry), "{pfad}: retry {retry}");
    }
}
