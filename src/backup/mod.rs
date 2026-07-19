pub mod restore;
pub mod scheduler;

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
///
/// # Warnung
/// Liefert eine UN-gescrubbte Vollkopie inkl. der `session`-Tabelle (Bearer-Tokens).
/// Für JEDEN nach außen gehenden Export `erzeuge_sicherung` nutzen — das scrubbt die
/// Sessions. `pub(crate)`, damit kein neuer Export-Pfad diese Bereinigung umgeht.
pub(crate) async fn vacuum_into(pool: &SqlitePool, ziel: &Path) -> Result<u64, AppError> {
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

/// Leert die `session`-Tabelle in einer bereits geschriebenen Sicherungsdatei.
///
/// Öffnet die Datei bewusst im `Delete`-Journal-Modus, NICHT im sqlx-Default WAL: ein
/// `DELETE` im WAL-Modus landete in einem `<ziel>-wal`-Seitenfile, das ein späteres
/// `std::fs::read` der Hauptdatei (Download/CLI-Ausgabe) nicht sähe — die Sessions wären
/// weiterhin exportiert.
async fn scrub_sessions(ziel: &Path) -> Result<(), AppError> {
    use sqlx::sqlite::{SqliteConnectOptions, SqliteJournalMode};

    let options = SqliteConnectOptions::new()
        .filename(ziel)
        .journal_mode(SqliteJournalMode::Delete);
    let pool = SqlitePool::connect_with(options).await?;
    sqlx::query("DELETE FROM session").execute(&pool).await?;
    pool.close().await;
    Ok(())
}

/// Erzeugt eine konsistente Sicherung wie [`vacuum_into`], entfernt aber die flüchtigen
/// Session-Tokens aus der exportierten Kopie: ein geleaktes Backup soll keine verwertbaren
/// Bearer-Secrets nach außen tragen (Defense-in-Depth; Sessions sind ohnehin re-loginbar).
/// `passwort_hash`/`totp_secret` bleiben erhalten, damit die Sicherung restore-fähig ist.
/// Liefert die Größe der bereinigten Datei in Bytes.
pub async fn erzeuge_sicherung(pool: &SqlitePool, ziel: &Path) -> Result<u64, AppError> {
    vacuum_into(pool, ziel).await?;
    // Fail-closed: schlägt der Session-Scrub fehl, darf keine un-bereinigte Teildatei
    // (noch mit session-Zeilen) am Zielpfad zurückbleiben. Der HTTP-Pfad räumt via tempdir
    // ohnehin auf; der CLI-Pfad schreibt an einen User-Pfad und würde es sonst nicht.
    if let Err(e) = scrub_sessions(ziel).await {
        let _ = std::fs::remove_file(ziel);
        return Err(e);
    }

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
    async fn sicherung_enthaelt_keine_sessions() {
        let pool = crate::db::test_pool().await;
        sqlx::query("INSERT INTO organisation (id, name) VALUES (1, 'Test-Orga')")
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query(
            "INSERT INTO benutzer (org_id, anzeigename, benutzername, passwort_hash, aktiv) \
             VALUES (1, 'Max', 'max', 'hash', 1)",
        )
        .execute(&pool)
        .await
        .unwrap();
        let bid: i64 = sqlx::query_scalar("SELECT id FROM benutzer WHERE benutzername = 'max'")
            .fetch_one(&pool)
            .await
            .unwrap();
        sqlx::query(
            "INSERT INTO session (token_hash, benutzer_id, expires_at) \
             VALUES ('irgendein-hash', ?, datetime('now', '+7 days'))",
        )
        .bind(bid)
        .execute(&pool)
        .await
        .unwrap();

        let dir = tempfile::tempdir().unwrap();
        let ziel = dir.path().join("backup.sqlite");
        erzeuge_sicherung(&pool, &ziel).await.unwrap();

        let backup_pool = oeffne_sicherung(&ziel).await;
        let sessions: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM session")
            .fetch_one(&backup_pool)
            .await
            .unwrap();
        assert_eq!(sessions, 0, "Sicherung darf keine Sessions enthalten");
        // Fachdaten müssen die Bereinigung überleben.
        let orgs: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM organisation")
            .fetch_one(&backup_pool)
            .await
            .unwrap();
        assert_eq!(orgs, 1, "Fachdaten müssen erhalten bleiben");
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
