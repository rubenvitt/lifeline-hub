//! Führung je Einsatz (LLH-1491, Spec `instanz-fuehrung`), Live-Ereignisse aus dem Austausch
//! (LLH-1674): Auch ein Wechsel, der nur Art und Verlauf ändert, meldet den Einsatzkopf. Eigene
//! Test-Binärdatei: der Live-Verteiler der Hintergrund-Tasks ist prozessweit
//! (`instanz::stammdaten::set_live`), alle Tests hier teilen ihn und laufen nacheinander.

mod common;
mod instanz_hilfen;

use axum::http::StatusCode;
use instanz_hilfen::*;
use lifeline_hub::auth::unterschrift::pruefen::test_authenticator::SoftwarePasskey;
use lifeline_hub::live::{LiveEvent, LiveHub, LiveNachricht};
use serde_json::{json, Value};
use std::sync::OnceLock;
use tokio::sync::broadcast::Receiver;
use tokio::sync::{Mutex, MutexGuard};

/// Der prozessweite Verteiler, einmal gesetzt.
fn live_hub() -> LiveHub {
    static LIVE_HUB: OnceLock<LiveHub> = OnceLock::new();
    LIVE_HUB
        .get_or_init(|| {
            let live = LiveHub::new();
            lifeline_hub::instanz::stammdaten::set_live(live.clone());
            live
        })
        .clone()
}

/// Nacheinander: Die Einsatz-IDs der Tests decken sich auf dem gemeinsamen Verteiler.
async fn lock_serial() -> MutexGuard<'static, ()> {
    static SERIAL_LOCK: Mutex<()> = Mutex::const_new(());
    SERIAL_LOCK.lock().await
}

async fn post(i: &Instanz, pfad: &str, body: Value) -> (StatusCode, Value) {
    common::anfrage_json(&i.app, "POST", pfad, &i.admin, Some(&body)).await
}

/// Der ELW meldet sich, dann zwei Runden Abgleich der Einsätze (wie `tests/instanz_fuehrung.rs`).
async fn elw_meldet(elw: &Instanz) {
    melden(elw).await;
    for _ in 0..2 {
        lifeline_hub::instanz::spiegel::takt::durchlauf(&elw.pool, Some(&elw.app), true)
            .await
            .unwrap();
    }
}

/// Hub und ELW gekoppelt, Führung an, ein Einsatz des ELW am Hub gespiegelt. Der Hub legt vorher
/// zwei eigene Einsätze an, damit sich die Einsatz-IDs beider Seiten auf dem gemeinsamen
/// Verteiler nicht decken. Liefert (Hub, ELW, Verteiler, Einsatz am ELW, Akte am Hub).
async fn setup() -> (Instanz, Instanz, LiveHub, i64, i64) {
    let live = live_hub();
    let elw = instanz().await;
    let hub = instanz().await;
    for i in [&hub, &elw] {
        lifeline_hub::instanz::fuehrung::save_schalter(&i.pool, true)
            .await
            .unwrap();
    }
    schluessel(&hub).await;
    koppeln(&hub, &elw).await;
    // Eigene Nummern weit weg von denen des ELW: Eine Notübernahme macht den Spiegel zum eigenen
    // Einsatz, und dessen Nummer muss am Hub frei sein.
    for _ in 0..2 {
        let h = common::einsatz_anlegen(&hub.app, &hub.admin).await;
        exec(
            &hub.pool,
            &format!(
                "UPDATE einsatz SET nummer_lfd = 900 + id, \
                 einsatznummer_intern = 'E-2026-0' || (900 + id) WHERE id = {h}"
            ),
        )
        .await;
    }
    let e = common::einsatz_anlegen(&elw.app, &elw.admin).await;
    elw_meldet(&elw).await;
    let akte: i64 = eine(
        &hub.pool,
        "SELECT id FROM einsatz_fuehrung WHERE kennung NOT LIKE \
         (SELECT kennung FROM instanz_identitaet) || '/%'",
    )
    .await;
    (hub, elw, live, e, akte)
}

fn has_kopf(rx: &mut Receiver<LiveNachricht>) -> bool {
    let mut found = false;
    while let Ok(m) = rx.try_recv() {
        found |= m.event == LiveEvent::Einsatz;
    }
    found
}

#[tokio::test]
async fn bestaetigter_code_meldet_den_einsatzkopf_am_elw() {
    let _serial = lock_serial().await;
    let (hub, elw, live, e, akte) = setup().await;
    let (s, v) = post(
        &elw,
        &format!("/api/einsaetze/{e}/fuehrung/code"),
        json!({"an": eine::<String>(&hub.pool, "SELECT kennung FROM instanz_identitaet").await}),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    let (s, v) = post(
        &hub,
        &format!("/api/admin/instanz/fuehrung/{akte}/notuebernahme/code"),
        json!({"grund": "per Funk", "code": v["code"]}),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    let mut rx = live.abonniere(e);
    melden(&elw).await;
    let art: String = eine(
        &elw.pool,
        &format!("SELECT art FROM einsatz_fuehrung_verlauf WHERE fuehrung_id = (SELECT id FROM einsatz_fuehrung WHERE einsatz_id = {e}) ORDER BY id DESC LIMIT 1"),
    )
    .await;
    assert_eq!(art, "notuebernahme", "der Code ist bestätigt");
    assert!(has_kopf(&mut rx), "der Wechsel meldet den Einsatzkopf");
}

#[tokio::test]
async fn bestaetigung_des_gegenuebers_meldet_den_einsatzkopf_am_hub() {
    let _serial = lock_serial().await;
    let (hub, elw, live, e, akte) = setup().await;
    let (s, start) = post(
        &hub,
        &format!("/api/admin/instanz/fuehrung/{akte}/notuebernahme/start"),
        json!({"grund": "ELW still"}),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{start}");
    let assertion = SoftwarePasskey::new("a", [1u8; 32]).sign(
        start["erklaerung"].as_str().unwrap(),
        ORIGIN,
        RP,
        0x05,
    );
    let (s, v) = post(
        &hub,
        &format!("/api/admin/instanz/fuehrung/{akte}/notuebernahme/abschluss"),
        json!({"zeremonie": start["zeremonie"], "assertion": assertion}),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    melden(&elw).await;
    let (s, v) = post(
        &elw,
        &format!("/api/einsaetze/{e}/fuehrung/bestaetigen"),
        json!({}),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    let spiegel: i64 = eine(
        &hub.pool,
        &format!("SELECT einsatz_id FROM einsatz_fuehrung WHERE id = {akte}"),
    )
    .await;
    let mut rx = live.abonniere(spiegel);
    melden(&elw).await;
    let art: String = eine(
        &hub.pool,
        &format!("SELECT art FROM einsatz_fuehrung WHERE id = {akte}"),
    )
    .await;
    assert_eq!(art, "bestaetigt");
    assert!(has_kopf(&mut rx), "der Wechsel meldet den Einsatzkopf");
}
