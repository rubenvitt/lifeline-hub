//! Integrationstests für Lage-Snapshots (LFH-321, Inkrement C).
//! Task 1: Persistenz — Metadaten-Liste (ohne `daten`), Volldokument, Einsatz-Scoping.

use lifeline_hub::lage_snapshot::repo;
use serde_json::json;
use sqlx::SqlitePool;

mod common;
use common::{einsatz_anlegen, login_cookie, setup_mit_pool};

/// Pool + frischer Einsatz + Admin-`benutzer_id` für Repo-Level-Tests.
async fn setup() -> (SqlitePool, i64, i64) {
    let (app, pool) = setup_mit_pool().await;
    let cookie = login_cookie(&app, "admin", "startpw12").await;
    let einsatz_id = einsatz_anlegen(&app, &cookie).await;
    let benutzer_id: i64 = sqlx::query_scalar("SELECT id FROM benutzer WHERE benutzername = 'admin'")
        .fetch_one(&pool)
        .await
        .unwrap();
    (pool, einsatz_id, benutzer_id)
}

#[tokio::test]
async fn liste_liefert_metadaten_ohne_daten_einzel_liefert_dokument() {
    let (pool, einsatz_id, benutzer_id) = setup().await;
    let daten = json!({"version": 1, "marker": [{"typ": "uhs", "id": 1}]});
    let id = repo::insert_roh(
        &pool,
        einsatz_id,
        benutzer_id,
        Some("08:00"),
        None,
        "2026-07-24T08:00:00Z",
        &daten,
    )
    .await
    .unwrap();

    let liste = repo::liste_metadaten(&pool, einsatz_id).await.unwrap();
    assert_eq!(liste.len(), 1);
    assert_eq!(liste[0].bezeichnung.as_deref(), Some("08:00"));
    assert_eq!(liste[0].schema_version, 1);
    // Metadaten-DTO trägt strukturell kein `daten`-Feld.
    let v = serde_json::to_value(&liste[0]).unwrap();
    assert!(
        !v.as_object().unwrap().contains_key("daten"),
        "Metadaten dürfen kein daten tragen: {v}"
    );

    let dok = repo::lade_dokument(&pool, einsatz_id, id)
        .await
        .unwrap()
        .expect("Dokument vorhanden");
    assert_eq!(dok.daten, daten);
    assert_eq!(dok.schema_version, 1);
}

#[tokio::test]
async fn lade_und_loesche_sind_einsatz_gescopt() {
    let (pool, einsatz_id, benutzer_id) = setup().await;
    let daten = json!({"version": 1});
    let id = repo::insert_roh(
        &pool,
        einsatz_id,
        benutzer_id,
        None,
        None,
        "2026-07-24T08:00:00Z",
        &daten,
    )
    .await
    .unwrap();

    // Ein fremder Einsatz sieht den Snapshot nicht und kann ihn nicht löschen.
    let fremd = einsatz_id + 999;
    assert!(repo::lade_dokument(&pool, fremd, id).await.unwrap().is_none());
    assert!(!repo::loesche(&pool, fremd, id).await.unwrap());

    // Der eigene Einsatz schon.
    assert!(repo::lade_dokument(&pool, einsatz_id, id).await.unwrap().is_some());
    assert!(repo::loesche(&pool, einsatz_id, id).await.unwrap());
    assert!(repo::liste_metadaten(&pool, einsatz_id).await.unwrap().is_empty());
}
