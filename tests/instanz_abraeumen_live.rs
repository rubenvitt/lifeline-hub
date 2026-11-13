//! LLH-1713: Räumt der ELW einen Einsatz nach der Verwahrung am Hub ab, erfahren es offene
//! Einsatzseiten (`einsatz`, sie holen den Kopf und räumen am 404) und Einsatzlisten
//! (`einsatzliste`) ohne Neuladen. Eigene Test-Binärdatei: der Live-Verteiler des Abgleichs ist
//! prozessweit (`instanz::stammdaten::set_live`), und hier gehört er dem ELW.

mod common;
mod instanz_hilfen;

use axum::http::StatusCode;
use instanz_hilfen::*;
use lifeline_hub::live::org::OrgLiveEvent;
use lifeline_hub::live::LiveEvent;

#[tokio::test]
async fn verwahrt_der_hub_meldet_der_elw_das_abraeumen_live() {
    let hub = instanz().await;
    let (app, pool, live) = common::setup_mit_pool_und_live().await;
    let elw = instanz_aus(app, pool).await;
    lifeline_hub::instanz::stammdaten::set_live(live.clone());
    schluessel(&hub).await;
    koppeln(&hub, &elw).await;
    melden(&elw).await;
    let abgleichen = || async {
        lifeline_hub::instanz::spiegel::takt::durchlauf(&elw.pool, Some(&elw.app), true)
            .await
            .unwrap();
    };

    let e = common::einsatz_anlegen_mit(&elw.app, &elw.admin, "Hochwasser").await;
    abgleichen().await;
    let (s, v) = common::anfrage(
        &elw.app,
        "POST",
        &format!("/api/einsaetze/{e}/abschliessen"),
        &elw.admin,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    abgleichen().await;
    exec(
        &elw.pool,
        &format!("UPDATE einsatz SET nachbereitung_bis = '2000-01-01 00:00:00' WHERE id = {e}"),
    )
    .await;
    let mut seite = live.abonniere(e);
    let mut org = live.abonniere_org();

    abgleichen().await;

    let weg: bool = eine(
        &elw.pool,
        &format!("SELECT NOT EXISTS (SELECT 1 FROM einsatz WHERE id = {e})"),
    )
    .await;
    assert!(weg, "am ELW abgeräumt");
    let mut ereignisse = Vec::new();
    while let Ok(m) = seite.try_recv() {
        ereignisse.push(m.event);
    }
    assert!(ereignisse.contains(&LiveEvent::Einsatz), "{ereignisse:?}");
    let mut liste = 0;
    while let Ok(m) = org.try_recv() {
        if m.event == OrgLiveEvent::Einsatzliste {
            liste += 1;
        }
    }
    assert!(liste >= 1, "die Einsatzliste erfährt das Abräumen");
}
