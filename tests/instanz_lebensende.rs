//! Lebensende eines Einsatzes zwischen zwei Instanzen (LLH-1494, Change
//! `tkky2noy-archiv-nachbereitung`, design.md D2–D6): Verwahrung am Hub nach der Nachbereitung,
//! gelöschte Einsätze in beide Richtungen, Soft-Delete und Wiederherstellung am Spiegel, Spiegel
//! am ELW nach der Nachbereitung. Je Instanz eigene DB und eigener Server auf Loopback.

mod common;
mod instanz_hilfen;

use axum::http::StatusCode;
use instanz_hilfen::*;
use lifeline_hub::einsatz::abraeumen::{self, AbraeumArt};
use serde_json::json;

async fn gekoppelt_gemeldet() -> (Instanz, Instanz) {
    let (hub, elw) = gekoppelt().await;
    melden(&elw).await;
    (hub, elw)
}

async fn abgleichen(elw: &Instanz) {
    lifeline_hub::instanz::spiegel::takt::durchlauf(&elw.pool, Some(&elw.app), true)
        .await
        .unwrap();
}

async fn etb_eintrag(i: &Instanz, einsatz: i64, inhalt: &str) {
    let (s, v) = common::anfrage_json(
        &i.app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/etb"),
        &i.admin,
        Some(&json!({ "typ": "meldung", "inhalt": inhalt, "von": "ELW", "an": "EL" })),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{v}");
}

async fn abschliessen(i: &Instanz, einsatz: i64) {
    let (s, v) = common::anfrage(
        &i.app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/abschliessen"),
        &i.admin,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
}

/// Lässt die Nachbereitung eines eigenen Einsatzes ablaufen.
async fn nachbereitung_vorbei(i: &Instanz, einsatz: i64) {
    exec(
        &i.pool,
        &format!(
            "UPDATE einsatz SET nachbereitung_bis = '2000-01-01 00:00:00' WHERE id = {einsatz}"
        ),
    )
    .await;
}

async fn gibt_es(pool: &sqlx::SqlitePool, sql: &str) -> bool {
    eine::<i64>(pool, &format!("SELECT COUNT(*) FROM ({sql})")).await > 0
}

async fn protokoll(pool: &sqlx::SqlitePool, einsatz: i64) -> (String, Option<String>) {
    sqlx::query_as("SELECT art, gegenstelle FROM aufbewahrung_loeschprotokoll WHERE einsatz_id = ?")
        .bind(einsatz)
        .fetch_one(pool)
        .await
        .unwrap()
}

async fn kennung(pool: &sqlx::SqlitePool, einsatz: i64) -> String {
    eine(
        pool,
        &format!("SELECT kennung FROM einsatz WHERE id = {einsatz}"),
    )
    .await
}

/// Der Einsatz des Hubs mit dieser Kennung: (id, spiegel).
async fn am_hub(hub: &Instanz, kennung: &str) -> (i64, bool) {
    sqlx::query_as("SELECT id, spiegel FROM einsatz WHERE kennung = ?")
        .bind(kennung)
        .fetch_one(&hub.pool)
        .await
        .unwrap()
}

async fn etb_texte(pool: &sqlx::SqlitePool, einsatz: i64) -> Vec<String> {
    sqlx::query_scalar("SELECT inhalt FROM etb_eintrag WHERE einsatz_id = ? ORDER BY id")
        .bind(einsatz)
        .fetch_all(pool)
        .await
        .unwrap()
}

#[tokio::test]
async fn nach_der_nachbereitung_verwahrt_der_hub_und_der_elw_raeumt_ab() {
    let (hub, elw) = gekoppelt_gemeldet().await;
    let e = common::einsatz_anlegen_mit(&elw.app, &elw.admin, "Hochwasser").await;
    etb_eintrag(&elw, e, "Lage erkundet").await;
    abgleichen(&elw).await;
    abschliessen(&elw, e).await;
    abgleichen(&elw).await;
    let k = kennung(&elw.pool, e).await;
    assert!(am_hub(&hub, &k).await.1, "erst Spiegel");

    nachbereitung_vorbei(&elw, e).await;
    abgleichen(&elw).await;

    let (h, spiegel) = am_hub(&hub, &k).await;
    assert!(!spiegel, "am Hub ein eigener Einsatz");
    let texte = etb_texte(&hub.pool, h).await;
    assert!(texte.contains(&"Lage erkundet".to_string()), "{texte:?}");
    assert!(
        texte
            .iter()
            .any(|t| t.starts_with("Zur Verwahrung übernommen von ")),
        "{texte:?}"
    );
    assert!(
        !gibt_es(&elw.pool, &format!("SELECT 1 FROM einsatz WHERE id = {e}")).await,
        "am ELW abgeräumt"
    );
    let (art, gegenstelle) = protokoll(&elw.pool, e).await;
    assert_eq!(art, "verwahrt");
    assert!(gegenstelle.is_some());
    // Am Hub ist der Einsatz beschreibbar und wird nicht zurückgeliefert.
    let (s, v) = common::anfrage_json(
        &hub.app,
        "PUT",
        &format!("/api/einsaetze/{h}/nachbereitung"),
        &hub.admin,
        Some(&json!({ "nachbereitung_bis": null })),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    abgleichen(&elw).await;
    assert!(!gibt_es(&elw.pool, "SELECT 1 FROM einsatz_spiegel").await);
}

#[tokio::test]
async fn ein_ohne_netz_angelegter_einsatz_wird_ebenso_verwahrt() {
    let (hub, elw) = gekoppelt_gemeldet().await;
    let e = common::einsatz_anlegen_mit(&elw.app, &elw.admin, "Ohne Netz").await;
    etb_eintrag(&elw, e, "Funkloch").await;
    abschliessen(&elw, e).await;
    nachbereitung_vorbei(&elw, e).await;
    // Abgeschlossene Einsätze liefert der ELW nur, wenn der Hub sie nennt; dieser hier geht als
    // fällige Verwahrung trotzdem hinaus.
    abgleichen(&elw).await;

    let k = format!(
        "{}/{e}",
        eine::<String>(&elw.pool, "SELECT kennung FROM instanz_identitaet").await
    );
    let (h, spiegel) = am_hub(&hub, &k).await;
    assert!(!spiegel);
    assert!(etb_texte(&hub.pool, h)
        .await
        .contains(&"Funkloch".to_string()));
    assert!(!gibt_es(&elw.pool, &format!("SELECT 1 FROM einsatz WHERE id = {e}")).await);
}

#[tokio::test]
async fn die_verwahrung_wartet_auf_einen_anhang_und_gelingt_danach() {
    let (hub, elw) = gekoppelt_gemeldet().await;
    let e = common::einsatz_anlegen(&elw.app, &elw.admin).await;
    // Fünf Stücke: mehr, als die Runden eines Abgleichs nach dem Abruf tragen.
    let bytes: Vec<u8> = (0..5 * 256 * 1024 - 100)
        .map(|i| (i * 7 % 251) as u8)
        .collect();
    sqlx::query(
        "INSERT INTO anhang (einsatz_id, dateiname, mime, groesse, sha256, daten, hochgeladen_von) \
         VALUES (?, 'karte.bin', 'application/octet-stream', ?, 'x', ?, 1)",
    )
    .bind(e)
    .bind(bytes.len() as i64)
    .bind(&bytes)
    .execute(&elw.pool)
    .await
    .unwrap();
    abschliessen(&elw, e).await;
    nachbereitung_vorbei(&elw, e).await;
    abgleichen(&elw).await;

    let grund: Option<String> = eine(
        &elw.pool,
        &format!("SELECT grund FROM einsatz_verwahrung WHERE einsatz_id = {e}"),
    )
    .await;
    assert_eq!(grund.as_deref(), Some("1 Anhang fehlt"));
    let k = kennung(&elw.pool, e).await;
    assert!(am_hub(&hub, &k).await.1, "noch Spiegel");

    for _ in 0..3 {
        abgleichen(&elw).await;
    }
    let (h, spiegel) = am_hub(&hub, &k).await;
    assert!(!spiegel, "nach dem Anhang angenommen");
    let am_hub: Vec<u8> = eine(
        &hub.pool,
        &format!("SELECT daten FROM anhang WHERE einsatz_id = {h}"),
    )
    .await;
    assert_eq!(am_hub, bytes);
    assert!(!gibt_es(&elw.pool, &format!("SELECT 1 FROM einsatz WHERE id = {e}")).await);
}

#[tokio::test]
async fn soft_delete_und_wiederherstellung_kommen_beim_spiegel_an() {
    let (hub, elw) = gekoppelt_gemeldet().await;
    let e = common::einsatz_anlegen(&elw.app, &elw.admin).await;
    abgleichen(&elw).await;
    abschliessen(&elw, e).await;
    abgleichen(&elw).await;
    let k = kennung(&elw.pool, e).await;
    let (s, _) = am_hub(&hub, &k).await;
    let geloescht = |pool: sqlx::SqlitePool| async move {
        eine::<Option<String>>(
            &pool,
            &format!("SELECT geloescht_at FROM einsatz WHERE id = {s}"),
        )
        .await
    };
    assert_eq!(geloescht(hub.pool.clone()).await, None);

    exec(
        &elw.pool,
        &format!("UPDATE einsatz SET geloescht_at = '2026-11-01 00:00:00' WHERE id = {e}"),
    )
    .await;
    abgleichen(&elw).await;
    assert_eq!(
        geloescht(hub.pool.clone()).await.as_deref(),
        Some("2026-11-01 00:00:00")
    );

    exec(
        &elw.pool,
        &format!("UPDATE einsatz SET geloescht_at = NULL WHERE id = {e}"),
    )
    .await;
    abgleichen(&elw).await;
    assert_eq!(geloescht(hub.pool.clone()).await, None);
}

/// Löscht einen eigenen Einsatz so, wie es die Aufbewahrung tut: Protokollzeile, dann weg.
async fn loeschen(i: &Instanz, einsatz: i64) {
    let mut tx = i.pool.begin().await.unwrap();
    abraeumen::vormerken(&mut tx, einsatz, AbraeumArt::Verwahrt, None)
        .await
        .unwrap();
    tx.commit().await.unwrap();
    assert!(abraeumen::ausfuehren(&i.pool, einsatz).await.unwrap());
}

#[tokio::test]
async fn loescht_der_hub_seinen_einsatz_raeumt_der_elw_den_spiegel_ab() {
    let (hub, elw) = gekoppelt_gemeldet().await;
    let e = common::einsatz_anlegen(&hub.app, &hub.admin).await;
    abgleichen(&elw).await;
    abschliessen(&hub, e).await;
    abgleichen(&elw).await;
    let s: i64 = eine(&elw.pool, "SELECT einsatz_id FROM einsatz_spiegel").await;

    loeschen(&hub, e).await;
    abgleichen(&elw).await;

    assert!(!gibt_es(&elw.pool, &format!("SELECT 1 FROM einsatz WHERE id = {s}")).await);
    let (art, _) = protokoll(&elw.pool, s).await;
    assert_eq!(art, "spiegel");
}

#[tokio::test]
async fn loescht_der_elw_seinen_einsatz_raeumt_der_hub_den_spiegel_ab() {
    let (hub, elw) = gekoppelt_gemeldet().await;
    let e = common::einsatz_anlegen(&elw.app, &elw.admin).await;
    abgleichen(&elw).await;
    abschliessen(&elw, e).await;
    abgleichen(&elw).await;
    let s: i64 = eine(&hub.pool, "SELECT einsatz_id FROM einsatz_spiegel").await;
    let andere = common::einsatz_anlegen(&elw.app, &elw.admin).await;
    abgleichen(&elw).await;

    loeschen(&elw, e).await;
    abgleichen(&elw).await;

    assert!(!gibt_es(&hub.pool, &format!("SELECT 1 FROM einsatz WHERE id = {s}")).await);
    let (art, gegenstelle) = protokoll(&hub.pool, s).await;
    assert_eq!(art, "spiegel");
    assert!(gegenstelle.is_some());
    let k = kennung(&elw.pool, andere).await;
    assert!(am_hub(&hub, &k).await.1, "der andere Spiegel bleibt");
}

#[tokio::test]
async fn ein_spiegel_am_elw_geht_nach_der_nachbereitung_der_einsatz_am_hub_bleibt() {
    let (hub, elw) = gekoppelt_gemeldet().await;
    let e = common::einsatz_anlegen(&hub.app, &hub.admin).await;
    abgleichen(&elw).await;
    abschliessen(&hub, e).await;
    nachbereitung_vorbei(&hub, e).await;
    abgleichen(&elw).await;
    let s: i64 = eine(&elw.pool, "SELECT einsatz_id FROM einsatz_spiegel").await;

    assert_eq!(
        abraeumen::phase_r(&elw.pool, "2026-11-11 12:00:00").await,
        1
    );
    assert!(!gibt_es(&elw.pool, &format!("SELECT 1 FROM einsatz WHERE id = {s}")).await);
    abgleichen(&elw).await;
    assert!(
        !gibt_es(&elw.pool, "SELECT 1 FROM einsatz_spiegel").await,
        "nicht neu geliefert"
    );
    assert!(gibt_es(&hub.pool, &format!("SELECT 1 FROM einsatz WHERE id = {e}")).await);
}
