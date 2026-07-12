//! Liest Vektor-Kacheln aus einer MBTiles-Datei (= SQLite). MBTiles speichert `tile_row` in
//! TMS-Orientierung; MapLibre fragt in XYZ → Y-Flip nötig. MVT-Kacheln sind gzip-komprimiert.
use std::path::{Path, PathBuf};
use std::sync::LazyLock;

/// Öffnet eine `.mbtiles`-Datei als read-only-Pool (immutable: keine Sperren, kein WAL-Write).
/// `.filename(pfad)` statt einer `sqlite://`-URI aus `format!` — sonst müssten Sonderzeichen/
/// Leerzeichen im Pfad URI-escaped werden (gleiche API wie der Test-Fixture-Helper).
pub async fn oeffne_readonly(pfad: &Path) -> Result<sqlx::SqlitePool, sqlx::Error> {
    use sqlx::sqlite::SqliteConnectOptions;
    let opts = SqliteConnectOptions::new()
        .filename(pfad)
        .read_only(true)
        .immutable(true);
    sqlx::sqlite::SqlitePoolOptions::new()
        .max_connections(4)
        .connect_with(opts)
        .await
}

/// Liest die Kachel (z/x/y in XYZ) oder `None`. `tile_row = (2^z − 1) − y` (TMS-Flip).
pub async fn lies_tile(
    pool: &sqlx::SqlitePool,
    z: i64,
    x: i64,
    y: i64,
) -> Result<Option<Vec<u8>>, sqlx::Error> {
    let tms_row = (1i64 << z) - 1 - y;
    let row: Option<(Vec<u8>,)> = sqlx::query_as(
        "SELECT tile_data FROM tiles WHERE zoom_level = ?1 AND tile_column = ?2 AND tile_row = ?3",
    )
    .bind(z)
    .bind(x)
    .bind(tms_row)
    .fetch_optional(pool)
    .await?;
    Ok(row.map(|(d,)| d))
}

/// Prozessweiter read-only-Pool der AKTIVEN Offline-MBTiles (genau eine aktive Basemap). Per Pfad
/// gekeyt; bei Karten-Swap (anderer Pfad) wird neu geöffnet. tokio-RwLock, damit der Guard
/// Send-sicher über das await beim Öffnen gehalten werden darf (std-RwLock → !Send, s. axum).
static READER: LazyLock<tokio::sync::RwLock<Option<(PathBuf, sqlx::SqlitePool)>>> =
    LazyLock::new(|| tokio::sync::RwLock::new(None));

/// Liefert den (gecachten) read-only-Pool für `pfad`, öffnet bei Cache-Miss/Pfadwechsel neu.
pub async fn reader_fuer(pfad: &Path) -> Result<sqlx::SqlitePool, sqlx::Error> {
    {
        let g = READER.read().await;
        if let Some((p, pool)) = g.as_ref() {
            if p == pfad {
                return Ok(pool.clone());
            }
        }
    } // read-Guard hier fallen lassen, DANN erst awaiten/öffnen
    let neu = oeffne_readonly(pfad).await?;
    *READER.write().await = Some((pfad.to_path_buf(), neu.clone()));
    Ok(neu)
}

/// Verwirft den gecachten Reader-Pool (nach Löschen/Ersetzen der aktiven Karte aufrufen —
/// sonst würde bei rowid-/Pfad-Wiederverwendung die alte Datei weiterserviert).
pub async fn invalidate_reader() {
    *READER.write().await = None;
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::sqlite::SqlitePoolOptions;

    // Baut eine In-Memory-MBTiles mit genau einer Kachel bei TMS (z=1, col=0, row=1) = XYZ (z=1,x=0,y=0).
    async fn fixture() -> sqlx::SqlitePool {
        let pool = SqlitePoolOptions::new()
            .connect("sqlite::memory:")
            .await
            .unwrap();
        sqlx::query("CREATE TABLE tiles (zoom_level INTEGER, tile_column INTEGER, tile_row INTEGER, tile_data BLOB)")
            .execute(&pool).await.unwrap();
        sqlx::query("INSERT INTO tiles VALUES (1, 0, 1, x'ABCD')")
            .execute(&pool)
            .await
            .unwrap();
        pool
    }

    #[tokio::test]
    async fn liest_kachel_mit_tms_flip() {
        let pool = fixture().await;
        // XYZ y=0 bei z=1 -> TMS row = (2^1 - 1) - 0 = 1 -> Treffer.
        let t = lies_tile(&pool, 1, 0, 0).await.unwrap();
        assert_eq!(t, Some(vec![0xAB, 0xCD]));
    }

    #[tokio::test]
    async fn fehlende_kachel_ist_none() {
        let pool = fixture().await;
        assert_eq!(lies_tile(&pool, 1, 1, 1).await.unwrap(), None);
    }

    /// Schreibt eine Datei-MBTiles mit genau einer Kachel bei TMS (z=1, col=0, row=1) = XYZ
    /// (z=1,x=0,y=0) und `daten` als Inhalt. Eigener SCHREIBBARER Pool (Produktionscode liest
    /// nur read-only); die Datei darf noch nicht existieren (`create_if_missing`).
    async fn schreibe_datei_fixture(pfad: &Path, daten: &[u8]) {
        let opts = SqlitePoolOptions::new().connect_with(
            sqlx::sqlite::SqliteConnectOptions::new()
                .filename(pfad)
                .create_if_missing(true),
        );
        let pool = opts.await.unwrap();
        sqlx::query(
            "CREATE TABLE tiles (zoom_level INTEGER, tile_column INTEGER, tile_row INTEGER, tile_data BLOB)",
        )
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query("INSERT INTO tiles VALUES (1, 0, 1, ?1)")
            .bind(daten)
            .execute(&pool)
            .await
            .unwrap();
        pool.close().await;
    }

    // Beweist: (1) reader_fuer cacht per Pfad (gleicher Pfad, überschriebene Datei liefert noch
    // den alten Inhalt), (2) invalidate_reader() verwirft den Cache und der nächste reader_fuer
    // sieht den neuen Inhalt. Reproduziert den LFH-195-Bug: Karte löschen + neu herunterladen
    // vergibt denselben Pfad (`karte-{id}.mbtiles`, rowid-Wiederverwendung ohne AUTOINCREMENT)
    // bei neuer Inode — ohne Invalidierung würde der alte FD weiterserviert.
    #[tokio::test]
    async fn invalidate_reader_verwirft_gecachten_pool() {
        let dir = tempfile::tempdir().unwrap();
        let pfad = dir.path().join("karte-1.mbtiles");

        schreibe_datei_fixture(&pfad, &[0xAA]).await;
        let pool_a = reader_fuer(&pfad).await.unwrap();
        assert_eq!(lies_tile(&pool_a, 1, 0, 0).await.unwrap(), Some(vec![0xAA]));

        // "Löschen + Neu-Download": gleicher Pfad, neue Inode, anderer Inhalt.
        std::fs::remove_file(&pfad).unwrap();
        schreibe_datei_fixture(&pfad, &[0xBB]).await;

        // Ohne Invalidierung liefert der gecachte Pool (Pfad unverändert) weiterhin A.
        let pool_noch_a = reader_fuer(&pfad).await.unwrap();
        assert_eq!(
            lies_tile(&pool_noch_a, 1, 0, 0).await.unwrap(),
            Some(vec![0xAA])
        );

        // Nach Invalidierung: frischer Pool, liest B.
        invalidate_reader().await;
        let pool_b = reader_fuer(&pfad).await.unwrap();
        assert_eq!(lies_tile(&pool_b, 1, 0, 0).await.unwrap(), Some(vec![0xBB]));
    }
}
