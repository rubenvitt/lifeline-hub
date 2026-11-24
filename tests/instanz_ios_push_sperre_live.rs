//! LLH-2074 (Review): Beginnt oder endet die Sperre des Hubs am Push-Relais, erfahren offene
//! Einsatzseiten am ELW es ohne Neuladen (`einsatz`), damit das Band erscheint bzw. verschwindet.
//! Eigene Test-Binärdatei: der Live-Verteiler des Abgleichs ist prozessweit
//! (`instanz::stammdaten::set_live`), und hier gehört er dem ELW.

mod common;
mod instanz_hilfen;

use common::relais::relais_doppel;
use instanz_hilfen::*;
use lifeline_hub::live::{LiveEvent, LiveNachricht};
use tokio::sync::broadcast::Receiver;

fn kopf_gemeldet(rx: &mut Receiver<LiveNachricht>) -> bool {
    let mut gefunden = false;
    while let Ok(m) = rx.try_recv() {
        gefunden |= m.event == LiveEvent::Einsatz;
    }
    gefunden
}

#[tokio::test]
async fn beginn_und_ende_der_sperre_melden_den_einsatzkopf() {
    let (app, pool, live) = common::setup_mit_pool_und_live().await;
    let relais = relais_doppel().await;
    live.ios_push_einrichten(relais.ios_push(&pool));
    let hub = instanz_aus(app, pool).await;
    let (app, pool, elw_live) = common::setup_mit_pool_und_live().await;
    let elw = instanz_aus(app, pool).await;
    lifeline_hub::instanz::stammdaten::set_live(elw_live.clone());
    schluessel(&hub).await;
    koppeln(&hub, &elw).await;
    melden(&elw).await;
    let e = common::einsatz_anlegen_mit(&elw.app, &elw.admin, "Hochwasser").await;
    // Ein Konto vom Hub, wie es die Stammdaten liefern: nur dann zeigt der Einsatz die Sperre.
    exec(
        &elw.pool,
        "INSERT INTO stammdaten_herkunft (kopplung_org_id, org_id, art, fremder_schluessel, \
         lokaler_schluessel) SELECT id, org_id, 'konto', 'h-test', '999' \
         FROM instanz_kopplung_org LIMIT 1",
    )
    .await;
    let mut seite = elw_live.abonniere(e);

    melden(&elw).await;
    assert!(
        !kopf_gemeldet(&mut seite),
        "ohne Änderung kein Kopf-Ereignis"
    );

    exec(
        &hub.pool,
        "INSERT INTO ios_push_relais (id, server_id, geheimnis, gesperrt_at) \
         VALUES (1, 's', 'g', '2026-11-23 08:15:00')",
    )
    .await;
    melden(&elw).await;
    assert!(kopf_gemeldet(&mut seite), "Beginn der Sperre");

    melden(&elw).await;
    assert!(
        !kopf_gemeldet(&mut seite),
        "unveränderte Sperre meldet nichts"
    );

    exec(&hub.pool, "UPDATE ios_push_relais SET gesperrt_at = NULL").await;
    melden(&elw).await;
    assert!(kopf_gemeldet(&mut seite), "Ende der Sperre");
}
