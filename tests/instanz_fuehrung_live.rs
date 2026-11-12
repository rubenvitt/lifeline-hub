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
/// Verteiler nicht decken; der erste trägt dieselbe Nummer wie der Einsatz des ELW (LLH-1703).
/// Liefert (Hub, ELW, Verteiler, Einsatz am ELW, Akte am Hub).
async fn setup() -> (Instanz, Instanz, LiveHub, i64, i64) {
    setup_aus(instanz().await).await
}

/// Wie [`setup`], mit einem fertigen Hub (etwa mit eigenem Verteiler für seine Routen).
async fn setup_aus(hub: Instanz) -> (Instanz, Instanz, LiveHub, i64, i64) {
    let live = live_hub();
    let elw = instanz().await;
    for i in [&hub, &elw] {
        lifeline_hub::instanz::fuehrung::save_schalter(&i.pool, true)
            .await
            .unwrap();
    }
    schluessel(&hub).await;
    koppeln(&hub, &elw).await;
    for _ in 0..2 {
        common::einsatz_anlegen(&hub.app, &hub.admin).await;
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

/// Die bisher eingegangenen Ereignisse.
fn ereignisse(rx: &mut Receiver<LiveNachricht>) -> Vec<LiveEvent> {
    let mut alle = Vec::new();
    while let Ok(m) = rx.try_recv() {
        alle.push(m.event);
    }
    alle
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

/// Hub und ELW zählen ihre Einsatznummern unabhängig ab 1. Übernimmt der Hub die Führung, wird
/// sein Spiegel zum eigenen Einsatz und bekommt eine freie Nummer, statt an der Eindeutigkeit zu
/// scheitern (LLH-1703, Spec `einsatznummer`). Der ELW zeigt sie nach dem nächsten Abgleich.
#[tokio::test]
async fn notuebernahme_bei_gleicher_einsatznummer() {
    let _serial = lock_serial().await;
    // Die Routen des Hubs melden über den Verteiler ihres Routers, nicht über den prozessweiten.
    let (app, pool, hub_live) = common::setup_mit_pool_und_live().await;
    let (hub, elw, _live, e, akte) = setup_aus(instanz_aus(app, pool).await).await;
    let nummern = |pool: sqlx::SqlitePool| async move {
        sqlx::query_as::<_, (String, bool)>(
            "SELECT einsatznummer_intern, spiegel = 1 FROM einsatz ORDER BY id",
        )
        .fetch_all(&pool)
        .await
        .unwrap()
    };
    let vorher = nummern(hub.pool.clone()).await;
    let alt = vorher[0].0.clone();
    let (kopf, _) = alt.rsplit_once('-').unwrap();
    let (zweite, neu) = (format!("{kopf}-0002"), format!("{kopf}-0003"));
    assert_eq!(
        vorher,
        vec![
            (alt.clone(), false),
            (zweite.clone(), false),
            (alt.clone(), true)
        ],
        "zwei eigene Einsätze und der Spiegel mit der Nummer des ersten"
    );
    let (s, v) = post(
        &elw,
        &format!("/api/einsaetze/{e}/fuehrung/code"),
        json!({"an": eine::<String>(&hub.pool, "SELECT kennung FROM instanz_identitaet").await}),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    let h: i64 = eine(
        &hub.pool,
        &format!("SELECT einsatz_id FROM einsatz_fuehrung WHERE id = {akte}"),
    )
    .await;
    let mut rx = hub_live.abonniere(h);
    let (s, v) = post(
        &hub,
        &format!("/api/admin/instanz/fuehrung/{akte}/notuebernahme/code"),
        json!({"grund": "per Funk", "code": v["code"]}),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    assert_eq!(
        nummern(hub.pool.clone()).await,
        vec![(alt.clone(), false), (zweite, false), (neu.clone(), false)],
        "der übernommene Einsatz ist eigen und trägt die nächste freie Nummer"
    );
    assert_eq!(
        v["nummer"],
        neu.as_str(),
        "die Antwort nennt die neue Nummer"
    );
    let spur: String = eine(
        &hub.pool,
        "SELECT detail FROM admin_audit WHERE aktion = 'fuehrung_notuebernahme'",
    )
    .await;
    assert!(
        spur.contains(&neu) && !spur.contains(&alt),
        "die Admin-Spur nennt den Einsatz mit seiner neuen Nummer: {spur}"
    );
    // Der Systemeintrag steht im ETB: offene Schirme laden neu (Vollabgleich).
    let gemeldet = ereignisse(&mut rx);
    assert!(
        gemeldet.contains(&LiveEvent::Einsatz) && gemeldet.contains(&LiveEvent::Lagged),
        "{gemeldet:?}"
    );
    let eintraege: Vec<String> = sqlx::query_scalar(
        "SELECT inhalt FROM etb_eintrag WHERE einsatz_id = ? AND typ = 'system' \
         AND inhalt LIKE 'Neue Einsatznummer %'",
    )
    .bind(h)
    .fetch_all(&hub.pool)
    .await
    .unwrap();
    assert_eq!(eintraege.len(), 1, "{eintraege:?}");
    assert!(
        eintraege[0].contains(&neu) && eintraege[0].contains(&alt),
        "{eintraege:?}"
    );
    // Der ELW bestätigt den Code, wird Spiegel und bekommt den Kopf vom Hub.
    for _ in 0..2 {
        elw_meldet(&elw).await;
    }
    let am_elw: (String, bool) =
        sqlx::query_as("SELECT einsatznummer_intern, spiegel = 1 FROM einsatz WHERE id = ?")
            .bind(e)
            .fetch_one(&elw.pool)
            .await
            .unwrap();
    assert_eq!(am_elw, (neu.clone(), true), "der Spiegel am ELW folgt");
    for i in [&hub, &elw] {
        let akte_nummer: Option<String> = sqlx::query_scalar(
            "SELECT f.nummer FROM einsatz_fuehrung f JOIN einsatz e ON e.id = f.einsatz_id \
             WHERE e.einsatznummer_intern = ?",
        )
        .bind(&neu)
        .fetch_one(&i.pool)
        .await
        .unwrap();
        assert_eq!(akte_nummer.as_deref(), Some(neu.as_str()), "Akte folgt");
    }
    // Der Hub gibt die Führung zurück: Der ELW führt wieder, die Nummer bleibt (dort frei).
    let (s, v) = post(
        &hub,
        &format!("/api/einsaetze/{h}/fuehrung/uebergeben"),
        json!({"an": eine::<String>(&elw.pool, "SELECT kennung FROM instanz_identitaet").await}),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    elw_meldet(&elw).await;
    let am_elw: (String, bool) =
        sqlx::query_as("SELECT einsatznummer_intern, spiegel = 1 FROM einsatz WHERE id = ?")
            .bind(e)
            .fetch_one(&elw.pool)
            .await
            .unwrap();
    assert_eq!(am_elw, (neu, false), "die Rückgabe behält die Nummer");
}

/// Die empfangende Seite einer Übergabe wird im Abgleich zum Führer. Auch dort kann der Wechsel
/// ins ETB geschrieben haben: Neben dem Kopf geht ein Vollabgleich an die offenen Schirme.
#[tokio::test]
async fn uebergabe_meldet_am_hub_kopf_und_vollabgleich() {
    let _serial = lock_serial().await;
    let (hub, elw, live, e, akte) = setup().await;
    let h: i64 = eine(
        &hub.pool,
        &format!("SELECT einsatz_id FROM einsatz_fuehrung WHERE id = {akte}"),
    )
    .await;
    let (s, v) = post(
        &elw,
        &format!("/api/einsaetze/{e}/fuehrung/uebergeben"),
        json!({"an": eine::<String>(&hub.pool, "SELECT kennung FROM instanz_identitaet").await}),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    let mut rx = live.abonniere(h);
    melden(&elw).await;
    let spiegel: bool = eine(
        &hub.pool,
        &format!("SELECT spiegel = 1 FROM einsatz WHERE id = {h}"),
    )
    .await;
    assert!(!spiegel, "der Hub führt");
    let gemeldet = ereignisse(&mut rx);
    assert!(
        gemeldet.contains(&LiveEvent::Einsatz) && gemeldet.contains(&LiveEvent::Lagged),
        "{gemeldet:?}"
    );
}
