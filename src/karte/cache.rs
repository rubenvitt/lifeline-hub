//! Persistenter Cache (SQLite-Tabelle `fachebenen_cache`) mit TTL für Fachebenen-Antworten.
//! Schlüssel: `quelle` bzw. `quelle:<raster-bbox>`. Überlebt Backend-Neustarts.
//!
//! Cache-Fehler (DB-Lese-/Schreibfehler) sind NICHT fatal: Lesen → behandelt als Miss,
//! Schreiben → nur geloggt. Eine erfolgreiche externe Abfrage darf nie an einem
//! Cache-Schreibfehler scheitern.

use crate::karte::typen::FachebeneAntwort;
use sqlx::SqlitePool;

/// Maximalalter, ab dem Einträge beim Schreiben weggeräumt werden (Prune-on-Write).
/// Bewusst über der längsten TTL (KRITIS 24 h) → begrenzt die Tabelle dauerhaft,
/// ohne gültiges Stale-Serving zu verlieren.
const MAX_ALTER_SEKUNDEN: i64 = 2 * 24 * 3600;

fn deserialisiere(json: &str) -> Option<FachebeneAntwort> {
    match serde_json::from_str(json) {
        Ok(a) => Some(a),
        Err(e) => {
            tracing::warn!("Fachebenen-Cache: JSON nicht lesbar: {e}");
            None
        }
    }
}

/// Frischen Eintrag (jünger als `ttl_sekunden`) liefern, sonst None.
pub async fn frisch(pool: &SqlitePool, schluessel: &str, ttl_sekunden: i64) -> Option<FachebeneAntwort> {
    let json: Option<String> = sqlx::query_scalar(
        "SELECT antwort_json FROM fachebenen_cache \
         WHERE schluessel = ? AND unixepoch() - gespeichert_at < ?",
    )
    .bind(schluessel)
    .bind(ttl_sekunden)
    .fetch_optional(pool)
    .await
    .unwrap_or_else(|e| {
        tracing::warn!("Fachebenen-Cache: Lesefehler (frisch): {e}");
        None
    });
    json.and_then(|j| deserialisiere(&j))
}

/// Letzten (auch abgelaufenen) Eintrag liefern — für Stale-Serving bei Quell-Ausfall.
pub async fn stale(pool: &SqlitePool, schluessel: &str) -> Option<FachebeneAntwort> {
    let json: Option<String> =
        sqlx::query_scalar("SELECT antwort_json FROM fachebenen_cache WHERE schluessel = ?")
            .bind(schluessel)
            .fetch_optional(pool)
            .await
            .unwrap_or_else(|e| {
                tracing::warn!("Fachebenen-Cache: Lesefehler (stale): {e}");
                None
            });
    json.and_then(|j| deserialisiere(&j))
}

/// Eintrag speichern (Upsert) und dabei überalterte Einträge wegräumen.
pub async fn setze(pool: &SqlitePool, schluessel: &str, antwort: &FachebeneAntwort) {
    let json = match serde_json::to_string(antwort) {
        Ok(j) => j,
        Err(e) => {
            tracing::warn!("Fachebenen-Cache: Serialisierung fehlgeschlagen: {e}");
            return;
        }
    };
    if let Err(e) = sqlx::query(
        "INSERT INTO fachebenen_cache (schluessel, gespeichert_at, antwort_json) \
         VALUES (?, unixepoch(), ?) \
         ON CONFLICT(schluessel) DO UPDATE SET \
         gespeichert_at = excluded.gespeichert_at, antwort_json = excluded.antwort_json",
    )
    .bind(schluessel)
    .bind(&json)
    .execute(pool)
    .await
    {
        tracing::warn!("Fachebenen-Cache: Schreibfehler: {e}");
        return;
    }
    // Prune-on-Write: überalterte Einträge entfernen (begrenzt die Tabelle dauerhaft).
    if let Err(e) =
        sqlx::query("DELETE FROM fachebenen_cache WHERE unixepoch() - gespeichert_at > ?")
            .bind(MAX_ALTER_SEKUNDEN)
            .execute(pool)
            .await
    {
        tracing::warn!("Fachebenen-Cache: Prune fehlgeschlagen: {e}");
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::karte::typen::{leere_collection, FachebeneAntwort, FachebeneStatus};
    use serde_json::json;

    fn antwort() -> FachebeneAntwort {
        let fc = json!({ "type": "FeatureCollection", "features": [{ "type": "Feature" }] });
        FachebeneAntwort::ok("dwd", "Datenbasis: DWD", Some("2026-06-10".into()), fc)
    }

    #[tokio::test]
    async fn setze_dann_frisch_roundtrip() {
        let pool = crate::db::test_pool().await;
        setze(&pool, "dwd", &antwort()).await;
        let geladen = frisch(&pool, "dwd", 60).await.expect("frischer Eintrag");
        // vollständiger serialize→DB→deserialize Round-Trip
        assert_eq!(geladen.quelle, "dwd");
        assert_eq!(geladen.status, FachebeneStatus::Ok);
        assert_eq!(geladen.attribution, "Datenbasis: DWD");
        assert_eq!(geladen.stand.as_deref(), Some("2026-06-10"));
        assert_eq!(geladen.features["features"].as_array().unwrap().len(), 1);
    }

    #[tokio::test]
    async fn offline_status_roundtrip() {
        // rename_all="lowercase" muss in beide Richtungen funktionieren.
        let pool = crate::db::test_pool().await;
        setze(&pool, "nina", &FachebeneAntwort::offline("nina", "BBK")).await;
        let geladen = stale(&pool, "nina").await.expect("Eintrag");
        assert_eq!(geladen.status, FachebeneStatus::Offline);
    }

    #[tokio::test]
    async fn ttl_null_nicht_frisch_aber_stale() {
        let pool = crate::db::test_pool().await;
        setze(&pool, "dwd", &antwort()).await;
        assert!(frisch(&pool, "dwd", 0).await.is_none());
        assert!(stale(&pool, "dwd").await.is_some());
    }

    #[tokio::test]
    async fn unbekannter_schluessel_ist_none() {
        let pool = crate::db::test_pool().await;
        assert!(frisch(&pool, "x", 60).await.is_none());
        assert!(stale(&pool, "x").await.is_none());
    }

    #[tokio::test]
    async fn upsert_aktualisiert_statt_duplizieren() {
        let pool = crate::db::test_pool().await;
        setze(&pool, "dwd", &FachebeneAntwort::offline("dwd", "a")).await;
        setze(&pool, "dwd", &antwort()).await;
        let n: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM fachebenen_cache WHERE schluessel='dwd'")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(n, 1);
        assert_eq!(frisch(&pool, "dwd", 60).await.unwrap().status, FachebeneStatus::Ok);
    }
}
