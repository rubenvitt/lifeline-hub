//! Persistenter Reverse-Geocoding-Cache (Tabelle `geocoding_cache`). Schlüssel = auf
//! ~100 m gerundete Koordinate als INTEGER-Paar. Cache-Fehler sind nicht fatal:
//! Lesen → Miss, Schreiben → nur geloggt (eine erfolgreiche Geocodierung darf nie an
//! einem Cache-Schreibfehler scheitern — Stil von `karte/cache.rs`).

use sqlx::SqlitePool;

/// Koordinate → ganzzahliger Cache-Schlüssel (3 Nachkommastellen, ~100 m).
pub fn schluessel(lat: f64, lon: f64) -> (i64, i64) {
    ((lat * 1000.0).round() as i64, (lon * 1000.0).round() as i64)
}

/// Cache-Treffer (Ortsname) oder None.
pub async fn lese(pool: &SqlitePool, lat_key: i64, lon_key: i64) -> Option<String> {
    sqlx::query_scalar::<_, String>(
        "SELECT ortsname FROM geocoding_cache WHERE lat_key = ? AND lon_key = ?",
    )
    .bind(lat_key)
    .bind(lon_key)
    .fetch_optional(pool)
    .await
    .unwrap_or_else(|e| {
        tracing::warn!("Geocoding-Cache: Lesefehler: {e}");
        None
    })
}

/// Ortsnamen speichern (Upsert auf den Koordinaten-Schlüssel).
pub async fn schreibe(pool: &SqlitePool, lat_key: i64, lon_key: i64, ortsname: &str) {
    if let Err(e) = sqlx::query(
        "INSERT INTO geocoding_cache (lat_key, lon_key, ortsname) VALUES (?, ?, ?) \
         ON CONFLICT(lat_key, lon_key) DO UPDATE SET \
         ortsname = excluded.ortsname, erstellt_at = datetime('now')",
    )
    .bind(lat_key)
    .bind(lon_key)
    .bind(ortsname)
    .execute(pool)
    .await
    {
        tracing::warn!("Geocoding-Cache: Schreibfehler: {e}");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn schluessel_rundet_auf_drei_nachkommastellen() {
        assert_eq!(schluessel(51.16040, 10.45140), (51160, 10451));
        // Nachbarpunkte innerhalb ~100 m teilen denselben Schlüssel.
        assert_eq!(schluessel(51.16042, 10.45138), schluessel(51.16040, 10.45140));
    }

    #[tokio::test]
    async fn schreibe_dann_lese_roundtrip() {
        let pool = crate::db::test_pool().await;
        let (la, lo) = schluessel(51.1604, 10.4514);
        assert!(lese(&pool, la, lo).await.is_none());
        schreibe(&pool, la, lo, "Hauptstr. 5, Musterstadt").await;
        assert_eq!(lese(&pool, la, lo).await.as_deref(), Some("Hauptstr. 5, Musterstadt"));
    }

    #[tokio::test]
    async fn schreibe_ist_idempotent_upsert() {
        let pool = crate::db::test_pool().await;
        let (la, lo) = schluessel(51.0, 10.0);
        schreibe(&pool, la, lo, "Alt").await;
        schreibe(&pool, la, lo, "Neu").await;
        assert_eq!(lese(&pool, la, lo).await.as_deref(), Some("Neu"));
        let n: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM geocoding_cache")
            .fetch_one(&pool).await.unwrap();
        assert_eq!(n, 1);
    }
}
