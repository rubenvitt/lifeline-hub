//! Automatische Sicherungen (LFH-251): ein dünner Tokio-`interval`-Task ruft periodisch
//! [`tick_einmal`]; die Logik ist ohne laufenden Scheduler testbar.
//!
//! **Opt-in:** ohne `--backup-verzeichnis` passiert nichts. Jede Sicherung schreibt eine Datei
//! in DB-Größe (die DB trägt BLOB-Anhänge), was auf einem Einsatz-Notebook Platte und I/O
//! spürbar belastet.
//!
//! **Rotation:** es bleiben die jüngsten [`BackupConfig::behalten`] Dateien; ohne Rotation
//! liefe die Platte irgendwann voll, und das ist im Einsatz schlimmer als ein fehlendes Backup.
//!
//! **Teildateien und Shutdown (LFH-926):** jede Sicherung entsteht als `.part` und bekommt erst
//! fertig bereinigt ihren Endnamen (`backup::erzeuge_sicherung`). Reste eines harten Abbruchs
//! räumen der Start und jeder Tick weg, die Rotation zählt sie nie. Der Task endet auf ein
//! Stoppsignal; der Server wartet begrenzt auf ihn ([`auf_ende_warten`]).

use crate::error::AppError;
use futures::FutureExt;
use sqlx::SqlitePool;
use std::panic::AssertUnwindSafe;
use std::path::{Path, PathBuf};
use std::time::Duration;
use tokio::sync::watch;
use tokio::task::JoinHandle;

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

    // Reste eines abgebrochenen Laufs belegen Platz auf dem Medium, den die neue Sicherung
    // braucht.
    raeume_teildateien(verzeichnis);
    let ziel = verzeichnis.join(format!("{DATEI_PRAEFIX}{zeitstempel}{DATEI_ENDUNG}"));
    crate::backup::erzeuge_sicherung(pool, &ziel).await?;
    rotiere(verzeichnis, behalten)?;
    Ok(ziel)
}

/// Löscht liegengebliebene Teildateien automatischer Sicherungen (`lifeline-auto-*.sqlite.part`
/// samt Journal) aus `verzeichnis`. Liefert die Anzahl; fremde Dateien bleiben.
pub fn raeume_teildateien(verzeichnis: &Path) -> usize {
    let Ok(eintraege) = std::fs::read_dir(verzeichnis) else {
        return 0;
    };
    let teil = format!("{DATEI_ENDUNG}{}", crate::backup::TEIL_ENDUNG);
    let mut anzahl = 0;
    for pfad in eintraege.filter_map(Result::ok).map(|e| e.path()) {
        let ist_rest = pfad.file_name().and_then(|n| n.to_str()).is_some_and(|n| {
            n.starts_with(DATEI_PRAEFIX)
                && (n.ends_with(&teil) || n.ends_with(&format!("{teil}-journal")))
        });
        if !ist_rest {
            continue;
        }
        match std::fs::remove_file(&pfad) {
            Ok(()) => {
                anzahl += 1;
                tracing::info!(datei = %pfad.display(), "Teildatei einer Sicherung entfernt");
            }
            Err(e) => tracing::warn!(datei = %pfad.display(), "Teildatei bleibt: {e}"),
        }
    }
    anzahl
}

/// Löscht die ältesten automatischen Sicherungen, bis `behalten` übrig sind. Der Zeitstempel
/// im Namen sortiert lexikographisch wie chronologisch; fremde Dateien filtert das Präfix aus,
/// Teildateien die Endung. Die jüngste bleibt immer, auch bei `behalten = 0`.
fn rotiere(verzeichnis: &Path, behalten: usize) -> Result<(), AppError> {
    let behalten = behalten.max(1);
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
///
/// Der Task endet, sobald `stopp` auf `true` springt oder sein Sender fällt; eine laufende
/// Sicherung wird dabei zu Ende geschrieben. Das Handle gehört dem Aufrufer
/// ([`auf_ende_warten`]). Ein Absturz des Tasks landet im tracing-Log, statt nur auf stderr.
pub fn starte_backup_scheduler(
    pool: SqlitePool,
    config: BackupConfig,
    mut stopp: watch::Receiver<bool>,
) -> Option<JoinHandle<()>> {
    let verzeichnis = config.verzeichnis?;
    // Die Konfiguration lässt beides nicht zu (`config.rs`); ein Aufrufer ohne Prüfung bekäme
    // sonst einen panickenden Task bzw. eine Rotation, die die frische Sicherung löscht.
    if config.intervall.is_zero() || config.behalten == 0 {
        tracing::error!(
            intervall_sekunden = config.intervall.as_secs(),
            behalten = config.behalten,
            "Automatische Sicherung NICHT aktiv: Intervall und Anzahl müssen größer als 0 sein"
        );
        return None;
    }
    tracing::info!(
        verzeichnis = %verzeichnis.display(),
        intervall_sekunden = config.intervall.as_secs(),
        behalten = config.behalten,
        "Automatische Sicherung aktiv"
    );

    let lauf = async move {
        let mut ticker = tokio::time::interval(config.intervall);
        // Der erste Tick feuert sofort — überspringen, sonst sicherte jeder Serverstart.
        ticker.tick().await;
        loop {
            tokio::select! {
                // Stopp zuerst: dauerte die letzte Sicherung länger als das Intervall, sind beim
                // Signal beide Zweige bereit, und ohne `biased` begänne zufällig noch eine.
                biased;
                // Ein gesendetes `true` oder ein fallender Sender beenden den Task.
                geaendert = stopp.changed() => {
                    if geaendert.is_err() || *stopp.borrow() {
                        break;
                    }
                }
                _ = ticker.tick() => {
                    let zeitstempel = chrono::Utc::now().format("%Y%m%dT%H%M%SZ").to_string();
                    match tick_einmal(&pool, &verzeichnis, config.behalten, &zeitstempel).await {
                        Ok(pfad) => tracing::info!(datei = %pfad.display(), "Sicherung erstellt"),
                        Err(e) => tracing::error!("Automatische Sicherung fehlgeschlagen: {e}"),
                    }
                }
            }
        }
        tracing::info!("Automatische Sicherung beendet");
    };

    Some(tokio::spawn(async move {
        if let Err(panik) = AssertUnwindSafe(lauf).catch_unwind().await {
            let grund = panik
                .downcast_ref::<&str>()
                .map(|s| s.to_string())
                .or_else(|| panik.downcast_ref::<String>().cloned())
                .unwrap_or_default();
            tracing::error!(
                grund = %grund,
                "Automatische Sicherung abgestürzt: bis zum Neustart entstehen KEINE Sicherungen"
            );
        }
    }))
}

/// Wartet nach dem Stoppsignal höchstens `frist` auf das Ende des Scheduler-Tasks und bricht ihn
/// danach ab. Eine dabei abgebrochene Sicherung hinterlässt höchstens eine Teildatei, die der
/// nächste Start entfernt.
pub async fn auf_ende_warten(mut task: JoinHandle<()>, frist: Duration) {
    match tokio::time::timeout(frist, &mut task).await {
        Ok(Ok(())) => {}
        Ok(Err(e)) => tracing::error!("Automatische Sicherung endete mit Fehler: {e}"),
        Err(_) => {
            task.abort();
            tracing::warn!(
                frist_sekunden = frist.as_secs(),
                "Laufende Sicherung beim Herunterfahren abgebrochen; ihre Teildatei entfernt \
                 der nächste Start"
            );
        }
    }
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

    fn namen(dir: &Path) -> Vec<String> {
        let mut namen: Vec<String> = std::fs::read_dir(dir)
            .unwrap()
            .filter_map(Result::ok)
            .map(|e| e.file_name().to_string_lossy().to_string())
            .collect();
        namen.sort();
        namen
    }

    /// LFH-926: Eine Teildatei aus einem abgebrochenen Lauf (samt Journal des Scrubs)
    /// verschwindet beim nächsten Tick und zählt nicht als Sicherung.
    #[tokio::test]
    async fn teildatei_rest_wird_beim_tick_entfernt() {
        let pool = crate::db::test_pool().await;
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(
            dir.path()
                .join("lifeline-auto-20250101T000000Z.sqlite.part"),
            b"halb",
        )
        .unwrap();
        std::fs::write(
            dir.path()
                .join("lifeline-auto-20250101T000000Z.sqlite.part-journal"),
            b"j",
        )
        .unwrap();

        tick_einmal(&pool, dir.path(), 2, "20260101T000000Z")
            .await
            .unwrap();

        assert_eq!(
            namen(dir.path()),
            vec!["lifeline-auto-20260101T000000Z.sqlite"]
        );
    }

    /// LFH-926: Ein gescheiterter Lauf hinterlässt nichts, und die vorhandenen gültigen
    /// Sicherungen bleiben alle.
    #[tokio::test]
    async fn gescheiterter_lauf_laesst_gueltige_sicherungen_stehen() {
        let pool = crate::db::test_pool().await;
        let dir = tempfile::tempdir().unwrap();
        for stempel in ["20260101T000000Z", "20260102T000000Z"] {
            tick_einmal(&pool, dir.path(), 2, stempel).await.unwrap();
        }

        let geschlossen = crate::db::test_pool().await;
        geschlossen.close().await;
        assert!(tick_einmal(&geschlossen, dir.path(), 2, "20260103T000000Z")
            .await
            .is_err());

        assert_eq!(
            namen(dir.path()),
            vec![
                "lifeline-auto-20260101T000000Z.sqlite",
                "lifeline-auto-20260102T000000Z.sqlite"
            ]
        );
    }

    #[test]
    fn rotation_behaelt_immer_die_juengste() {
        let dir = tempfile::tempdir().unwrap();
        for stempel in ["20260101T000000Z", "20260102T000000Z"] {
            std::fs::write(
                dir.path().join(format!("lifeline-auto-{stempel}.sqlite")),
                b"x",
            )
            .unwrap();
        }

        rotiere(dir.path(), 0).unwrap();

        assert_eq!(
            namen(dir.path()),
            vec!["lifeline-auto-20260102T000000Z.sqlite"]
        );
    }

    #[test]
    fn aufraeumen_fasst_nur_eigene_teildateien_an() {
        let dir = tempfile::tempdir().unwrap();
        for name in [
            "lifeline-auto-20260101T000000Z.sqlite",
            "lifeline-auto-20260102T000000Z.sqlite.part",
            "handsicherung.sqlite.part",
        ] {
            std::fs::write(dir.path().join(name), b"x").unwrap();
        }

        assert_eq!(raeume_teildateien(dir.path()), 1);

        assert_eq!(
            namen(dir.path()),
            vec![
                "handsicherung.sqlite.part",
                "lifeline-auto-20260101T000000Z.sqlite"
            ]
        );
    }

    fn config(dir: &Path, intervall: Duration, behalten: usize) -> BackupConfig {
        BackupConfig {
            verzeichnis: Some(dir.to_path_buf()),
            intervall,
            behalten,
        }
    }

    /// LFH-926: Ein Intervall oder eine Anzahl von 0 startet keinen Task, statt einen, der
    /// panickt oder jede Sicherung gleich wieder wegrotiert.
    #[tokio::test]
    async fn ungueltige_werte_starten_keinen_task() {
        let pool = crate::db::test_pool().await;
        let dir = tempfile::tempdir().unwrap();
        let (_tx, rx) = watch::channel(false);

        assert!(starte_backup_scheduler(
            pool.clone(),
            config(dir.path(), Duration::ZERO, 3),
            rx.clone()
        )
        .is_none());
        assert!(
            starte_backup_scheduler(pool, config(dir.path(), Duration::from_secs(60), 0), rx)
                .is_none()
        );
    }

    /// LFH-926: Auf das Stoppsignal endet der Task, der Server kann auf ihn warten.
    #[tokio::test]
    async fn task_endet_auf_stoppsignal() {
        let pool = crate::db::test_pool().await;
        let dir = tempfile::tempdir().unwrap();
        let (tx, rx) = watch::channel(false);

        let task =
            starte_backup_scheduler(pool, config(dir.path(), Duration::from_secs(3600), 3), rx)
                .expect("mit Verzeichnis läuft ein Task");
        tx.send(true).unwrap();

        tokio::time::timeout(Duration::from_secs(5), task)
            .await
            .expect("der Task endet auf das Stoppsignal")
            .expect("ohne Absturz");
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
