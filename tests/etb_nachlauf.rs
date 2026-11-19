//! Wächter für unverteilte ETB-Einträge (LLH-1976, `src/AGENTS.md`, „ETB live verteilen“):
//! `etb::nachlauf::klammer` meldet jeden in ihr committeten ETB-Eintrag, der nicht per
//! `LiveHub::publiziere` hinausging.

mod common;

use common::*;
use lifeline_hub::etb::nachlauf::{klammer, ohne_verteilung};
use sqlx::SqlitePool;

async fn admin_id(pool: &SqlitePool) -> i64 {
    sqlx::query_scalar("SELECT id FROM benutzer WHERE benutzername = 'admin'")
        .fetch_one(pool)
        .await
        .unwrap()
}

/// Schreibt einen System-Eintrag in einer eigenen Transaktion und committet sie.
async fn schreiben(pool: &SqlitePool, einsatz: i64, erfasser: i64, text: &str) -> i64 {
    let mut tx = pool.begin().await.unwrap();
    let id = lifeline_hub::etb::system_audit_tx(&mut tx, einsatz, erfasser, 1, text)
        .await
        .unwrap();
    tx.commit().await.unwrap();
    id
}

async fn vorbereiten() -> (SqlitePool, lifeline_hub::live::LiveHub, i64, i64) {
    let (app, pool, live) = setup_mit_pool_und_live().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let erfasser = admin_id(&pool).await;
    (pool, live, einsatz, erfasser)
}

#[tokio::test]
async fn schreiben_ohne_verteilen_ist_eine_luecke() {
    let (pool, _live, einsatz, erfasser) = vorbereiten().await;
    let (id, luecken) = klammer(&pool, schreiben(&pool, einsatz, erfasser, "unverteilt")).await;
    assert_eq!(luecken.len(), 1, "eine Lücke erwartet: {luecken:?}");
    assert_eq!(luecken[0].etb_id, id);
    assert_eq!(luecken[0].einsatz_id, einsatz);
    assert_eq!(luecken[0].inhalt, "unverteilt");
}

#[tokio::test]
async fn schreiben_und_verteilen_ist_keine_luecke() {
    let (pool, live, einsatz, erfasser) = vorbereiten().await;
    let ((), luecken) = klammer(&pool, async {
        let id = schreiben(&pool, einsatz, erfasser, "verteilt").await;
        live.publiziere(einsatz, id);
    })
    .await;
    assert!(luecken.is_empty(), "{luecken:?}");
}

#[tokio::test]
async fn zurueckgerollt_ist_keine_luecke() {
    let (pool, _live, einsatz, erfasser) = vorbereiten().await;
    let ((), luecken) = klammer(&pool, async {
        let mut tx = pool.begin().await.unwrap();
        lifeline_hub::etb::system_audit_tx(&mut tx, einsatz, erfasser, 1, "zurück")
            .await
            .unwrap();
        tx.rollback().await.unwrap();
    })
    .await;
    assert!(luecken.is_empty(), "{luecken:?}");
}

#[tokio::test]
async fn ohne_verteilung_nimmt_aus() {
    let (pool, _live, einsatz, erfasser) = vorbereiten().await;
    let (_, luecken) = klammer(
        &pool,
        ohne_verteilung("Test", schreiben(&pool, einsatz, erfasser, "ausgenommen")),
    )
    .await;
    assert!(luecken.is_empty(), "{luecken:?}");
}

#[tokio::test]
async fn innere_klammer_prueft_nicht_die_aeussere_schon() {
    let (pool, _live, einsatz, erfasser) = vorbereiten().await;
    let ((_, innen), aussen) = klammer(
        &pool,
        klammer(&pool, schreiben(&pool, einsatz, erfasser, "innen")),
    )
    .await;
    assert!(innen.is_empty(), "innere Klammer prüft nicht: {innen:?}");
    assert_eq!(aussen.len(), 1, "äußere Klammer prüft: {aussen:?}");
}

#[tokio::test]
async fn aeussere_ausnahme_deckt_innere_klammer() {
    let (pool, _live, einsatz, erfasser) = vorbereiten().await;
    let (_, aussen) = klammer(
        &pool,
        ohne_verteilung(
            "Test",
            klammer(&pool, schreiben(&pool, einsatz, erfasser, "innen")),
        ),
    )
    .await;
    assert!(aussen.is_empty(), "{aussen:?}");
}

#[tokio::test]
async fn ohne_klammer_kein_effekt() {
    let (pool, live, einsatz, erfasser) = vorbereiten().await;
    let id = schreiben(&pool, einsatz, erfasser, "frei").await;
    live.publiziere(einsatz, id);
    ohne_verteilung(
        "Test",
        schreiben(&pool, einsatz, erfasser, "frei, ausgenommen"),
    )
    .await;
}
