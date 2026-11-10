//! Spec `einsatz-spiegel`, „Der Spiegel zeigt seine Herkunft und seinen Stand“ (LLH-1492): nach
//! einer Übernahme gleichen offene Seiten den Einsatz ab (`lagged`), ein neuer Spiegel erscheint
//! in der Einsatzliste. Eigene Test-Binärdatei: der Live-Verteiler der Hintergrund-Tasks ist
//! prozessweit (`instanz::stammdaten::set_live`).

mod common;
mod instanz_hilfen;

use axum::http::StatusCode;
use instanz_hilfen::*;
use lifeline_hub::live::org::OrgLiveEvent;
use lifeline_hub::live::LiveEvent;
use serde_json::json;

#[tokio::test]
async fn uebernahme_meldet_lagged_und_ein_neuer_spiegel_die_einsatzliste() {
    let (app, pool, live) = common::setup_mit_pool_und_live().await;
    let hub = instanz_aus(app, pool).await;
    let elw = instanz().await;
    lifeline_hub::instanz::stammdaten::set_live(live.clone());
    schluessel(&hub).await;
    koppeln(&hub, &elw).await;
    melden(&elw).await;
    let mut org = live.abonniere_org();
    let e = common::einsatz_anlegen(&elw.app, &elw.admin).await;
    lifeline_hub::instanz::spiegel::takt::durchlauf(&elw.pool, Some(&elw.app), true)
        .await
        .unwrap();
    let mut liste = 0;
    while let Ok(m) = org.try_recv() {
        if m.event == OrgLiveEvent::Einsatzliste {
            liste += 1;
        }
    }
    assert!(liste >= 1, "neuer Spiegel meldet die Einsatzliste");
    let s: i64 = eine(&hub.pool, "SELECT einsatz_id FROM einsatz_spiegel").await;
    let mut rx = live.abonniere(s);
    let (st, v) = common::anfrage_json(
        &elw.app,
        "POST",
        &format!("/api/einsaetze/{e}/etb"),
        &elw.admin,
        Some(&json!({ "typ": "meldung", "inhalt": "Neu", "von": "A", "an": "B" })),
    )
    .await;
    assert_eq!(st, StatusCode::CREATED, "{v}");
    lifeline_hub::instanz::spiegel::takt::durchlauf(&elw.pool, Some(&elw.app), true)
        .await
        .unwrap();
    let m = rx.try_recv().expect("ein Ereignis nach der Übernahme");
    assert_eq!(m.event, LiveEvent::Lagged);
    assert!(rx.try_recv().is_err(), "genau eines je Paket");
    lifeline_hub::instanz::spiegel::takt::durchlauf(&elw.pool, Some(&elw.app), true)
        .await
        .unwrap();
    assert!(rx.try_recv().is_err(), "ohne Änderung kein Ereignis");
}
