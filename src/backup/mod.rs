pub mod restore;

use crate::error::AppError;
use sqlx::SqlitePool;
use std::path::Path;

/// Verdoppelt einfache Anführungszeichen, damit ein Pfad sicher als
/// SQL-String-Literal in `VACUUM INTO` eingesetzt werden kann.
/// (SQLite erlaubt für VACUUM INTO keinen Parameter-Bind.)
fn escape_sql_string(pfad: &str) -> String {
    pfad.replace('\'', "''")
}

/// Erzeugt eine konsistente Sicherungskopie der Datenbank in `ziel`.
///
/// Nutzt `VACUUM INTO`, das im WAL-Modus auch während laufender Schreibzugriffe
/// einen konsistenten Snapshot als einzelne Datei schreibt. `ziel` darf noch
/// nicht existieren (sonst schlägt VACUUM INTO fehl) und muss server-kontrolliert
/// sein — niemals ein direkt vom Client gelieferter Pfad.
///
/// Liefert die Größe der erzeugten Datei in Bytes.
pub async fn vacuum_into(pool: &SqlitePool, ziel: &Path) -> Result<u64, AppError> {
    let ziel_str = ziel
        .to_str()
        .ok_or_else(|| AppError::Internal("Sicherungspfad ist kein gültiges UTF-8".into()))?;
    let sql = format!("VACUUM INTO '{}'", escape_sql_string(ziel_str));
    sqlx::query(sqlx::AssertSqlSafe(&*sql))
        .execute(pool)
        .await?;

    let groesse = std::fs::metadata(ziel)
        .map_err(|e| AppError::Internal(format!("Sicherungsdatei nicht lesbar: {e}")))?
        .len();
    Ok(groesse)
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::sqlite::SqliteConnectOptions;
    use sqlx::SqlitePool;

    /// Öffnet eine Sicherungsdatei als eigenen Pool und liest sie.
    async fn oeffne_sicherung(pfad: &Path) -> SqlitePool {
        let options = SqliteConnectOptions::new().filename(pfad).read_only(true);
        SqlitePool::connect_with(options).await.unwrap()
    }

    #[tokio::test]
    async fn sicherung_enthaelt_die_daten() {
        let pool = crate::db::test_pool().await;
        sqlx::query("INSERT INTO organisation (id, name) VALUES (1, 'Test-Orga')")
            .execute(&pool)
            .await
            .unwrap();

        let dir = tempfile::tempdir().unwrap();
        let ziel = dir.path().join("backup.sqlite");

        let groesse = vacuum_into(&pool, &ziel).await.unwrap();
        assert!(groesse > 0, "Sicherungsdatei muss Inhalt haben");
        assert!(ziel.exists());

        // Die ersten Bytes einer SQLite-Datei sind die Magic-Bytes.
        let bytes = std::fs::read(&ziel).unwrap();
        assert!(
            bytes.starts_with(b"SQLite format 3\0"),
            "Datei muss eine echte SQLite-Datenbank sein"
        );

        // Sicherung öffnen und Daten verifizieren.
        let backup_pool = oeffne_sicherung(&ziel).await;
        let name: String = sqlx::query_scalar("SELECT name FROM organisation WHERE id = 1")
            .fetch_one(&backup_pool)
            .await
            .unwrap();
        assert_eq!(name, "Test-Orga");
    }

    #[tokio::test]
    async fn zielpfad_mit_anfuehrungszeichen_ist_sicher() {
        let pool = crate::db::test_pool().await;
        let dir = tempfile::tempdir().unwrap();
        // Pfad mit Single Quote — darf nicht zu SQL-Injection/Fehler führen.
        let ziel = dir.path().join("o'brien-backup.sqlite");

        let groesse = vacuum_into(&pool, &ziel).await.unwrap();
        assert!(groesse > 0);
        assert!(ziel.exists());
    }

    #[test]
    fn escape_verdoppelt_single_quotes() {
        assert_eq!(escape_sql_string("a'b"), "a''b");
        assert_eq!(escape_sql_string("normal"), "normal");
    }
}
