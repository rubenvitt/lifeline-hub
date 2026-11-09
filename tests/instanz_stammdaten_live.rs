//! Spec `org-live`, „Eine übernommene Nachlieferung frischt die Stammdaten“ (LLH-1493). Eigene
//! Test-Binärdatei: der Live-Verteiler des Melde-Tasks ist prozessweit
//! (`instanz::stammdaten::set_live`), andere Tests dürfen ihn nicht mitbenutzen.

mod common;
mod instanz_hilfen;

use instanz_hilfen::*;
use lifeline_hub::live::org::OrgLiveEvent;

fn stammdaten_ereignisse(
    rx: &mut tokio::sync::broadcast::Receiver<lifeline_hub::live::org::OrgNachricht>,
) -> usize {
    let mut n = 0;
    while let Ok(m) = rx.try_recv() {
        if m.org_id == 1 && m.event == OrgLiveEvent::Stammdaten {
            n += 1;
        }
    }
    n
}

#[tokio::test]
async fn nachlieferung_mit_aenderung_meldet_stammdaten_ohne_aenderung_nicht() {
    let hub = instanz().await;
    let (app, pool, live) = common::setup_mit_pool_und_live().await;
    let elw = instanz_aus(app, pool).await;
    lifeline_hub::instanz::stammdaten::set_live(live.clone());
    schluessel(&hub).await;
    koppeln(&hub, &elw).await;
    melden(&elw).await;
    let mut rx = live.abonniere_org();
    exec(
        &hub.pool,
        "INSERT INTO fahrzeug (org_id, funkrufname) VALUES (1, 'Neu vom Hub')",
    )
    .await;
    melden(&elw).await;
    assert_eq!(stammdaten_ereignisse(&mut rx), 1);
    melden(&elw).await;
    assert_eq!(
        stammdaten_ereignisse(&mut rx),
        0,
        "leere Nachlieferung meldet nichts"
    );
}
