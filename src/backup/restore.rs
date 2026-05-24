use crate::error::AppError;
use sqlx::sqlite::SqliteConnectOptions;
use sqlx::SqlitePool;
use std::path::Path;

/// Prüft, ob `quelle` eine gültige lifeline-hub-Sicherung ist (öffnet die Datei
/// und liest den `app_meta`-Initialisierungsmarker).
async fn ist_gueltige_sicherung(quelle: &Path) -> Result<bool, AppError> {
    let options = SqliteConnectOptions::new().filename(quelle).read_only(true);
    let pool = match SqlitePool::connect_with(options).await {
        Ok(p) => p,
        Err(e) => {
            tracing::warn!("Sicherungsdatei kann nicht geöffnet werden: {e}");
            return Ok(false);
        }
    };
    let marker: Result<String, _> =
        sqlx::query_scalar("SELECT value FROM app_meta WHERE key = 'schema_initialized'")
            .fetch_one(&pool)
            .await;
    pool.close().await;
    Ok(matches!(marker, Ok(v) if v == "1"))
}

/// Spielt die Sicherung `quelle` an die Stelle der Datenbank `ziel` ein.
///
/// Validiert zuerst, dass `quelle` eine echte lifeline-hub-Sicherung ist, und
/// entfernt vor dem Kopieren etwaige stale WAL-/SHM-Seitendateien (`-wal`/`-shm`),
/// damit die ältere DB nicht mit neuem WAL-Inhalt vermischt wird.
///
/// **Voraussetzung:** Der Server darf nicht laufen (keine offene Verbindung auf `ziel`).
///
/// Hinweis: Das Kopieren ist nicht atomar. Bei einem Abbruch während `fs::copy`
/// kann `ziel` in einem inkonsistenten Zustand verbleiben — daher den Server
/// vorher stoppen und vorhandene Sicherungen nicht überschreiben.
pub async fn restore_aus_datei(quelle: &Path, ziel: &Path) -> Result<(), AppError> {
    if !quelle.exists() {
        return Err(AppError::Validation(format!(
            "Sicherungsdatei nicht gefunden: {}",
            quelle.display()
        )));
    }
    if !ist_gueltige_sicherung(quelle).await? {
        return Err(AppError::Validation(
            "Datei ist keine gültige lifeline-hub-Sicherung".into(),
        ));
    }

    // Stale WAL-/SHM-Seitendateien des Ziels entfernen (sonst Vermischung).
    for endung in ["-wal", "-shm"] {
        let mut p = ziel.as_os_str().to_owned();
        p.push(endung);
        let nebendatei = std::path::PathBuf::from(p);
        if let Err(e) = std::fs::remove_file(&nebendatei) {
            if e.kind() != std::io::ErrorKind::NotFound {
                return Err(AppError::Internal(format!(
                    "Konnte {nebendatei:?} nicht entfernen: {e}"
                )));
            }
        }
    }

    std::fs::copy(quelle, ziel)
        .map_err(|e| AppError::Internal(format!("Kopieren der Sicherung fehlgeschlagen: {e}")))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn restore_stellt_daten_wieder_her() {
        // 1. Quell-DB mit Daten anlegen und per vacuum_into sichern.
        let quell_pool = crate::db::test_pool().await;
        sqlx::query("INSERT INTO organisation (id, name) VALUES (1, 'Wiederhergestellt')")
            .execute(&quell_pool)
            .await
            .unwrap();
        let dir = tempfile::tempdir().unwrap();
        let sicherung = dir.path().join("sicherung.sqlite");
        crate::backup::vacuum_into(&quell_pool, &sicherung)
            .await
            .unwrap();

        // 2. Restore in einen frischen Zielpfad.
        let ziel = dir.path().join("wiederhergestellt.db");
        restore_aus_datei(&sicherung, &ziel).await.unwrap();

        // 3. Ziel öffnen und Daten prüfen.
        let pool = crate::db::connect(ziel.to_str().unwrap()).await.unwrap();
        let name: String = sqlx::query_scalar("SELECT name FROM organisation WHERE id = 1")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(name, "Wiederhergestellt");
    }

    #[tokio::test]
    async fn restore_entfernt_stale_wal_und_shm() {
        let quell_pool = crate::db::test_pool().await;
        let dir = tempfile::tempdir().unwrap();
        let sicherung = dir.path().join("sicherung.sqlite");
        crate::backup::vacuum_into(&quell_pool, &sicherung)
            .await
            .unwrap();

        // Ziel mit veralteter DB + stale -wal/-shm vorbereiten.
        let ziel = dir.path().join("alt.db");
        std::fs::write(&ziel, b"alt").unwrap();
        let wal = dir.path().join("alt.db-wal");
        let shm = dir.path().join("alt.db-shm");
        std::fs::write(&wal, b"stale").unwrap();
        std::fs::write(&shm, b"stale").unwrap();

        restore_aus_datei(&sicherung, &ziel).await.unwrap();

        assert!(!wal.exists(), "stale -wal muss entfernt sein");
        assert!(!shm.exists(), "stale -shm muss entfernt sein");
    }

    #[tokio::test]
    async fn ungueltige_quelle_wird_abgelehnt() {
        let dir = tempfile::tempdir().unwrap();
        let kaputt = dir.path().join("kaputt.sqlite");
        std::fs::write(&kaputt, b"kein gueltiges sqlite").unwrap();
        let ziel = dir.path().join("ziel.db");

        let err = restore_aus_datei(&kaputt, &ziel).await.unwrap_err();
        assert!(matches!(err, AppError::Validation(_)));
        assert!(!ziel.exists(), "Ziel darf bei ungültiger Quelle nicht entstehen");
    }
}
