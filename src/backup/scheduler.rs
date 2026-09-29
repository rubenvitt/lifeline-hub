//! Automatische Sicherungen (LFH-251): ein dünner Tokio-`interval`-Task ruft periodisch
//! [`tick_einmal`]; die Logik ist ohne laufenden Scheduler testbar.
//!
//! **Opt-in:** ohne `--backup-verzeichnis` passiert nichts. Jede Sicherung schreibt eine Datei
//! in DB-Größe (die DB trägt BLOB-Anhänge), was auf einem Einsatz-Notebook Platte und I/O
//! spürbar belastet.
//!
//! **Rotation:** es bleiben die jüngsten [`BackupConfig::behalten`] Dateien; ohne Rotation
//! liefe die Platte irgendwann voll, und das ist im Einsatz schlimmer als ein fehlendes Backup.

use crate::error::AppError;
use sqlx::SqlitePool;
use std::path::{Path, PathBuf};
use std::time::Duration;

/// Präfix aller automatisch erzeugten Sicherungen. Dient zugleich als Filter der Rotation,
/// damit fremde Dateien im Zielverzeichnis unangetastet bleiben.
const DATEI_PRAEFIX: &str = "lifeline-auto-";
const DATEI_ENDUNG: &str = ".sqlite";

/// Konfiguration der automatischen Sicherung.
#[derive(Debug, Clone)]
pub struct BackupConfig {
    /// Zielverzeichnis. `None` → Automatik aus (No-op).
    pub verzeichnis: Option<PathBuf>,
    /// Abstand zwischen zwei Sicherungen.
    pub intervall: Duration,
    /// Wie viele Sicherungen aufgehoben werden.
    pub behalten: usize,
}

/// Erzeugt eine Sicherung im Zielverzeichnis, rotiert alte weg und liefert den Pfad.
///
/// Über `erzeuge_sicherung` (nicht `vacuum_into`), das die `session`-Tabelle leert: die Datei
/// liegt potenziell auf einem USB-Medium, Bearer-Tokens haben darin nichts verloren.
pub async fn tick_einmal(
    pool: &SqlitePool,
    verzeichnis: &Path,
    behalten: usize,
    zeitstempel: &str,
) -> Result<PathBuf, AppError> {
    std::fs::create_dir_all(verzeichnis).map_err(|e| {
        AppError::Internal(format!(
            "Backup-Verzeichnis {} nicht anlegbar: {e}",
            verzeichnis.display()
        ))
    })?;

    let ziel = verzeichnis.join(format!("{DATEI_PRAEFIX}{zeitstempel}{DATEI_ENDUNG}"));
    crate::backup::erzeuge_sicherung(pool, &ziel).await?;
    rotiere(verzeichnis, behalten)?;
    Ok(ziel)
}

/// Löscht die ältesten automatischen Sicherungen, bis `behalten` übrig sind. Der Zeitstempel
/// im Namen sortiert lexikographisch wie chronologisch; fremde Dateien filtert das Präfix aus.
fn rotiere(verzeichnis: &Path, behalten: usize) -> Result<(), AppError> {
    let Ok(eintraege) = std::fs::read_dir(verzeichnis) else {
        return Ok(());
    };
    let mut sicherungen: Vec<PathBuf> = eintraege
        .filter_map(Result::ok)
        .map(|e| e.path())
        .filter(|p| {
            p.file_name()
                .and_then(|n| n.to_str())
                .is_some_and(|n| n.starts_with(DATEI_PRAEFIX) && n.ends_with(DATEI_ENDUNG))
        })
        .collect();
    sicherungen.sort();

    let zu_viele = sicherungen.len().saturating_sub(behalten);
    for alt in sicherungen.into_iter().take(zu_viele) {
        match std::fs::remove_file(&alt) {
            Ok(()) => tracing::info!(datei = %alt.display(), "Alte Sicherung rotiert"),
            Err(e) => tracing::warn!(datei = %alt.display(), "Rotation fehlgeschlagen: {e}"),
        }
    }
    Ok(())
}

/// Startet den Hintergrund-Scheduler; ohne Verzeichnis wird kein Task gespawnt.
pub fn starte_backup_scheduler(pool: SqlitePool, config: BackupConfig) {
    let Some(verzeichnis) = config.verzeichnis else {
        return;
    };
    tracing::info!(
        verzeichnis = %verzeichnis.display(),
        intervall_sekunden = config.intervall.as_secs(),
        behalten = config.behalten,
        "Automatische Sicherung aktiv"
    );

    tokio::spawn(async move {
        let mut ticker = tokio::time::interval(config.intervall);
        // Der erste Tick feuert sofort — überspringen, sonst sicherte jeder Serverstart.
        ticker.tick().await;
        loop {
            ticker.tick().await;
            let zeitstempel = chrono::Utc::now().format("%Y%m%dT%H%M%SZ").to_string();
            match tick_einmal(&pool, &verzeichnis, config.behalten, &zeitstempel).await {
                Ok(pfad) => tracing::info!(datei = %pfad.display(), "Sicherung erstellt"),
                Err(e) => tracing::error!("Automatische Sicherung fehlgeschlagen: {e}"),
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn erzeugt_sicherung_und_haelt_die_anzahl() {
        let pool = crate::db::test_pool().await;
        sqlx::query("INSERT INTO organisation (id, name) VALUES (1, 'Testwache')")
            .execute(&pool)
            .await
            .unwrap();
        let dir = tempfile::tempdir().unwrap();

        // Vier Läufe bei behalten=2 → nur die zwei jüngsten bleiben.
        for stempel in ["20260101T000000Z", "20260102T000000Z", "20260103T000000Z"] {
            tick_einmal(&pool, dir.path(), 2, stempel).await.unwrap();
        }

        let mut vorhanden: Vec<String> = std::fs::read_dir(dir.path())
            .unwrap()
            .filter_map(Result::ok)
            .map(|e| e.file_name().to_string_lossy().to_string())
            .collect();
        vorhanden.sort();

        assert_eq!(
            vorhanden,
            vec![
                "lifeline-auto-20260102T000000Z.sqlite",
                "lifeline-auto-20260103T000000Z.sqlite"
            ],
            "es dürfen nur die jüngsten zwei Sicherungen übrig bleiben"
        );
    }

    #[tokio::test]
    async fn rotation_fasst_fremde_dateien_nicht_an() {
        let pool = crate::db::test_pool().await;
        let dir = tempfile::tempdir().unwrap();
        let fremd = dir.path().join("wichtige-handsicherung.sqlite");
        std::fs::write(&fremd, b"nicht anfassen").unwrap();

        for stempel in ["20260101T000000Z", "20260102T000000Z"] {
            tick_einmal(&pool, dir.path(), 1, stempel).await.unwrap();
        }

        assert!(
            fremd.exists(),
            "eine Datei ohne unser Präfix darf die Rotation niemals löschen"
        );
    }

    #[tokio::test]
    async fn sicherung_enthaelt_keine_sessions() {
        let pool = crate::db::test_pool().await;
        // Echter Benutzer, sonst schlägt der FK der session-Tabelle zu.
        crate::auth::bootstrap::bootstrap_admin(&pool, "Testwache", "admin", Some("startpw12"))
            .await
            .unwrap();
        let benutzer_id: i64 = sqlx::query_scalar("SELECT id FROM benutzer LIMIT 1")
            .fetch_one(&pool)
            .await
            .unwrap();
        sqlx::query(
            "INSERT INTO session (token_hash, benutzer_id, expires_at) \
             VALUES ('abc', ?, datetime('now', '+1 day'))",
        )
        .bind(benutzer_id)
        .execute(&pool)
        .await
        .unwrap();
        let dir = tempfile::tempdir().unwrap();

        let pfad = tick_einmal(&pool, dir.path(), 3, "20260101T000000Z")
            .await
            .unwrap();

        // Rotierende Sicherungen landen potenziell auf einem USB-Medium; Bearer-Tokens dürfen darin
        // nicht stehen.
        let kopie = crate::db::connect(pfad.to_str().unwrap()).await.unwrap();
        let anzahl: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM session")
            .fetch_one(&kopie)
            .await
            .unwrap();
        assert_eq!(anzahl, 0, "die Sicherung darf keine Sessions enthalten");
    }
}
