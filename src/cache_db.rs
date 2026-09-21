//! Prozess-weiter Cache-Pool für externe Nachschlage-Caches (Reverse-Geocoding,
//! Fachebenen), ausgelagert aus der operativen DB (F09/LFH-240): diese hochfrequenten,
//! nie-fatalen Cache-Writes sollen NICHT um den operativen Writer konkurrieren (der jetzt
//! unter BEGIN-IMMEDIATE-Disziplin läuft). Vorbild: [`crate::karte::tile_cache`] —
//! per-Pfad memoisiert, eigene DB-Datei, kein AppState-Feld (LFH-182-Lektion).
//!
//! Die operativen Migrationen legen `geocoding_cache`/`fachebenen_cache` weiterhin an
//! (Repo-Unit-Tests nutzen sie über `db::test_pool`); in Produktion greifen die Handler
//! auf DIESEN Pool zu (mit Fallback auf den operativen Pool, falls die Cache-DB nicht
//! angelegt werden kann — Cache-Fehler sind nie fatal).

use sqlx::sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePoolOptions};
use sqlx::SqlitePool;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};

static POOLS: OnceLock<Mutex<HashMap<PathBuf, SqlitePool>>> = OnceLock::new();

fn pools() -> &'static Mutex<HashMap<PathBuf, SqlitePool>> {
    POOLS.get_or_init(|| Mutex::new(HashMap::new()))
}

async fn schema_anlegen(pool: &SqlitePool) -> sqlx::Result<()> {
    sqlx::query(
        "CREATE TABLE IF NOT EXISTS geocoding_cache (\
             lat_key     INTEGER NOT NULL, \
             lon_key     INTEGER NOT NULL, \
             ortsname    TEXT    NOT NULL, \
             erstellt_at TEXT    NOT NULL DEFAULT (datetime('now')), \
             PRIMARY KEY (lat_key, lon_key))",
    )
    .execute(pool)
    .await?;
    sqlx::query(
        "CREATE TABLE IF NOT EXISTS fachebenen_cache (\
             schluessel     TEXT    PRIMARY KEY, \
             gespeichert_at INTEGER NOT NULL, \
             antwort_json   TEXT    NOT NULL)",
    )
    .execute(pool)
    .await?;
    // KRITIS-Bestand aus dem OSM-Extrakt (LFH-83, `karte::kritis::bestand`). Der Import
    // tauscht `kritis_objekt` samt Index aus; hier stehen sie nur, damit die Route vor dem
    // ersten Import eine leere Tabelle statt eines Fehlers findet.
    sqlx::query(
        "CREATE TABLE IF NOT EXISTS kritis_objekt (\
             osm_typ         TEXT    NOT NULL, \
             osm_id          INTEGER NOT NULL, \
             lon             REAL    NOT NULL, \
             lat             REAL    NOT NULL, \
             kategorie       TEXT    NOT NULL, \
             properties_json TEXT    NOT NULL, \
             PRIMARY KEY (osm_typ, osm_id))",
    )
    .execute(pool)
    .await?;
    sqlx::query("CREATE INDEX IF NOT EXISTS kritis_objekt_lon_lat ON kritis_objekt (lon, lat)")
        .execute(pool)
        .await?;
    sqlx::query(
        "CREATE TABLE IF NOT EXISTS kritis_zelle (\
             weite  REAL    NOT NULL, \
             x      INTEGER NOT NULL, \
             y      INTEGER NOT NULL, \
             anzahl INTEGER NOT NULL, \
             lon    REAL    NOT NULL, \
             lat    REAL    NOT NULL, \
             PRIMARY KEY (weite, x, y))",
    )
    .execute(pool)
    .await?;
    sqlx::query(
        "CREATE TABLE IF NOT EXISTS kritis_import (\
             id            INTEGER PRIMARY KEY CHECK (id = 1), \
             stand         TEXT    NOT NULL, \
             quelle_url    TEXT    NOT NULL, \
             last_modified TEXT, \
             etag          TEXT, \
             importiert_at INTEGER NOT NULL, \
             anzahl        INTEGER NOT NULL)",
    )
    .execute(pool)
    .await?;
    Ok(())
}

/// Liefert den (memoisierten) Cache-Pool für ein Daten-Verzeichnis. Erzeugt DB-Datei +
/// Schema beim ersten Aufruf. Per-Pfad ⇒ Tests mit eigenem Verzeichnis sind isoliert. Hält
/// den std-Mutex NIE über ein `await` (`!Send`) → Doppel-Check (wie `tile_cache`).
pub async fn cache_pool(daten_dir: &Path) -> sqlx::Result<SqlitePool> {
    let pfad = daten_dir.join("nachschlage-cache.db");
    {
        let map = pools().lock().unwrap();
        if let Some(p) = map.get(&pfad) {
            return Ok(p.clone());
        }
    }
    let _ = std::fs::create_dir_all(daten_dir);
    let pool = SqlitePoolOptions::new()
        .connect_with(
            SqliteConnectOptions::new()
                .filename(&pfad)
                .create_if_missing(true)
                .journal_mode(SqliteJournalMode::Wal),
        )
        .await?;
    schema_anlegen(&pool).await?;
    let mut map = pools().lock().unwrap();
    Ok(map.entry(pfad).or_insert(pool).clone())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn cache_pool_legt_beide_tabellen_an_und_memoisiert() {
        let dir = tempfile::tempdir().unwrap();
        let a = cache_pool(dir.path()).await.unwrap();
        sqlx::query("INSERT INTO geocoding_cache (lat_key, lon_key, ortsname) VALUES (1, 2, 'X')")
            .execute(&a)
            .await
            .unwrap();
        sqlx::query(
            "INSERT INTO fachebenen_cache (schluessel, gespeichert_at, antwort_json) \
             VALUES ('k', 0, '{}')",
        )
        .execute(&a)
        .await
        .unwrap();
        // Zweiter Aufruf für denselben Pfad liefert denselben (memoisierten) Pool.
        let b = cache_pool(dir.path()).await.unwrap();
        let n: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM geocoding_cache")
            .fetch_one(&b)
            .await
            .unwrap();
        assert_eq!(n, 1, "memoisierter Pool sieht denselben Zustand");
    }
}
