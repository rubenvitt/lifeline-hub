//! Persistenz des Versionsstands (Tabelle `instanz_versionsstand`, Migration 0175).
//!
//! Die Tabelle hält genau eine Zeile mit `id = 1`. Nur diese Datei schreibt sie.

use super::{nach_start, Versionsstand};
use crate::error::AppError;
use sqlx::SqlitePool;

/// Der gespeicherte Stand, `None` solange der Server noch nie gestartet wurde.
pub async fn laden(pool: &SqlitePool) -> Result<Option<Versionsstand>, AppError> {
    let zeile = sqlx::query_as::<_, (String, Option<String>, Option<String>)>(
        "SELECT laufend, zuletzt_gestartet, gelesen_bis \
         FROM instanz_versionsstand WHERE id = 1",
    )
    .fetch_optional(pool)
    .await?;

    Ok(
        zeile.map(|(laufend, zuletzt_gestartet, gelesen_bis)| Versionsstand {
            laufend,
            zuletzt_gestartet,
            gelesen_bis,
        }),
    )
}

/// Schreibt den Stand beim Start: Zeile anlegen oder ersetzen. Der Aufruf ist idempotent.
pub async fn beim_start(pool: &SqlitePool, laufend: &str) -> Result<Versionsstand, AppError> {
    let bisher = laden(pool).await?;
    let neu = nach_start(bisher.as_ref(), laufend);
    speichern(pool, &neu).await?;
    Ok(neu)
}

/// Markiert die laufende Version als gelesen. Legt die Zeile an, falls sie fehlt.
pub async fn als_gelesen_markieren(
    pool: &SqlitePool,
    laufend: &str,
) -> Result<Versionsstand, AppError> {
    sqlx::query(
        "INSERT INTO instanz_versionsstand (id, laufend, gelesen_bis) VALUES (1, ?, ?) \
         ON CONFLICT(id) DO UPDATE SET gelesen_bis = excluded.gelesen_bis",
    )
    .bind(laufend)
    .bind(laufend)
    .execute(pool)
    .await?;

    laden(pool)
        .await?
        .ok_or_else(|| AppError::Internal("Versionsstand fehlt nach dem Schreiben".into()))
}

async fn speichern(pool: &SqlitePool, stand: &Versionsstand) -> Result<(), AppError> {
    sqlx::query(
        "INSERT INTO instanz_versionsstand (id, laufend, zuletzt_gestartet, gelesen_bis) \
         VALUES (1, ?, ?, ?) \
         ON CONFLICT(id) DO UPDATE SET \
             laufend = excluded.laufend, \
             zuletzt_gestartet = excluded.zuletzt_gestartet, \
             gelesen_bis = excluded.gelesen_bis",
    )
    .bind(&stand.laufend)
    .bind(&stand.zuletzt_gestartet)
    .bind(&stand.gelesen_bis)
    .execute(pool)
    .await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn ohne_zeile_ist_der_stand_leer() {
        let pool = crate::db::test_pool().await;
        assert_eq!(laden(&pool).await.unwrap(), None);
    }

    #[tokio::test]
    async fn erster_start_legt_die_zeile_an_ohne_hinweis() {
        let pool = crate::db::test_pool().await;
        let stand = beim_start(&pool, "1.0.0-alpha.106").await.unwrap();
        assert_eq!(stand.zuletzt_gestartet, None);
        assert_eq!(stand.gelesen_bis.as_deref(), Some("1.0.0-alpha.106"));
    }

    #[tokio::test]
    async fn update_merkt_die_alte_version_und_behaelt_den_lesestand() {
        let pool = crate::db::test_pool().await;
        beim_start(&pool, "1.0.0-alpha.100").await.unwrap();
        let stand = beim_start(&pool, "1.0.0-alpha.106").await.unwrap();
        assert_eq!(stand.laufend, "1.0.0-alpha.106");
        assert_eq!(stand.zuletzt_gestartet.as_deref(), Some("1.0.0-alpha.100"));
        assert_eq!(stand.gelesen_bis.as_deref(), Some("1.0.0-alpha.100"));
    }

    #[tokio::test]
    async fn zweiter_start_mit_gleicher_version_bleibt_eine_zeile() {
        let pool = crate::db::test_pool().await;
        beim_start(&pool, "1.0.0-alpha.106").await.unwrap();
        beim_start(&pool, "1.0.0-alpha.106").await.unwrap();
        let anzahl: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM instanz_versionsstand")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(anzahl, 1);
    }

    #[tokio::test]
    async fn gelesen_markieren_setzt_die_laufende_version() {
        let pool = crate::db::test_pool().await;
        beim_start(&pool, "1.0.0-alpha.100").await.unwrap();
        beim_start(&pool, "1.0.0-alpha.106").await.unwrap();
        let stand = als_gelesen_markieren(&pool, "1.0.0-alpha.106")
            .await
            .unwrap();
        assert_eq!(stand.gelesen_bis.as_deref(), Some("1.0.0-alpha.106"));
        assert_eq!(stand.zuletzt_gestartet.as_deref(), Some("1.0.0-alpha.100"));
    }

    #[tokio::test]
    async fn gelesen_markieren_legt_fehlende_zeile_an() {
        let pool = crate::db::test_pool().await;
        let stand = als_gelesen_markieren(&pool, "1.0.0-alpha.106")
            .await
            .unwrap();
        assert_eq!(stand.laufend, "1.0.0-alpha.106");
        assert_eq!(stand.gelesen_bis.as_deref(), Some("1.0.0-alpha.106"));
    }
}
