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

/// Pfad einer SQLite-Nebendatei (`-wal`, `-shm`) zur Datenbank `db`.
fn nebendatei(db: &Path, endung: &str) -> std::path::PathBuf {
    let mut p = db.as_os_str().to_owned();
    p.push(endung);
    std::path::PathBuf::from(p)
}

/// Deutet darauf hin, dass gerade jemand mit `ziel` verbunden ist (typischerweise ein
/// laufender Server)?
///
/// SQLite legt im WAL-Modus `-wal` und `-shm` an, sobald die erste Verbindung öffnet, und
/// entfernt sie, wenn die letzte sie sauber schließt. Ihr Vorhandensein ist damit das
/// brauchbare Signal.
///
/// Die im Review und beim Entwurf naheliegenden Alternativen wurden **gemessen und
/// verworfen**:
/// - `flock` interagiert nicht mit SQLites POSIX-Byte-Range-Locks und würde immer gelingen.
/// - `BEGIN EXCLUSIVE` gelingt bei einer offenen, aber untätigen Verbindung ebenfalls —
///   im WAL-Modus blockieren idle Leser keinen Writer. Ein laufender, gerade nicht
///   arbeitender Server wäre damit unsichtbar geblieben.
///
/// Bekannte Unschärfe: nach einem **Absturz** bleiben die Dateien verwaist liegen, dann
/// meldet die Prüfung fälschlich „in Benutzung". Der Fehlertext nennt deshalb den Ausweg.
fn ziel_moeglicherweise_in_benutzung(ziel: &Path) -> bool {
    ["-wal", "-shm"]
        .iter()
        .any(|endung| nebendatei(ziel, endung).exists())
}

/// Spielt die Sicherung `quelle` an die Stelle der Datenbank `ziel` ein.
///
/// Ablauf: Quelle validieren → prüfen, dass niemand auf `ziel` verbunden ist → stale
/// WAL-/SHM-Seitendateien entfernen → **atomar** einhängen (Kopie nach `.tmp`, dann
/// `rename`).
///
/// Die Reihenfolge ist wesentlich: die Benutzungsprüfung muss VOR dem Entfernen der
/// `-wal`/`-shm`-Dateien laufen — sonst zerstört der Restore genau das Signal, das ihn
/// stoppen soll.
/// `server_gestoppt`: Zusicherung des Operators, dass kein Prozess mehr auf `ziel`
/// verbunden ist. Nötig, weil die Erkennung einen abgestürzten Server (verwaiste
/// `-wal`/`-shm`) nicht von einem laufenden unterscheiden kann — und ein Restore gerade
/// nach einem Absturz der wahrscheinlichste Fall ist. Ohne diese Zusicherung wäre der
/// Hauptanwendungsfall blockiert, mit einem stillen Default wäre die Prüfung wertlos.
pub async fn restore_aus_datei(
    quelle: &Path,
    ziel: &Path,
    server_gestoppt: bool,
) -> Result<(), AppError> {
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

    // MUSS vor der Löschschleife stehen (s. Doc oben).
    if ziel_moeglicherweise_in_benutzung(ziel) && !server_gestoppt {
        return Err(AppError::Conflict(format!(
            "Auf {ziel} ist noch eine Verbindung offen oder war es zuletzt \
             (-wal/-shm vorhanden) — vermutlich läuft der Server. Ein Restore über eine \
             laufende Datenbank beschädigt sie.\n\
             Server stoppen und erneut versuchen. Ist er bereits gestoppt (z. B. nach \
             einem Absturz, dann bleiben die Dateien verwaist liegen), den Restore mit \
             --server-gestoppt bestätigen.",
            ziel = ziel.display()
        )));
    }

    // Stale WAL-/SHM-Seitendateien des Ziels entfernen (sonst Vermischung).
    for endung in ["-wal", "-shm"] {
        let datei = nebendatei(ziel, endung);
        if let Err(e) = std::fs::remove_file(&datei) {
            if e.kind() != std::io::ErrorKind::NotFound {
                return Err(AppError::Internal(format!(
                    "Konnte {datei:?} nicht entfernen: {e}"
                )));
            }
        }
    }

    // Atomar einhängen: erst vollständig neben das Ziel kopieren, dann umbenennen.
    // `rename` ist innerhalb desselben Dateisystems atomar — bricht der Vorgang während
    // des Kopierens ab, bleibt die alte Datenbank unversehrt und nur die .tmp-Datei ist
    // unvollständig. Vorher konnte ein Abbruch mitten in `fs::copy` das Ziel zerstören.
    let tmp = nebendatei(ziel, ".restore-tmp");
    std::fs::copy(quelle, &tmp)
        .map_err(|e| AppError::Internal(format!("Kopieren der Sicherung fehlgeschlagen: {e}")))?;
    if let Err(e) = std::fs::rename(&tmp, ziel) {
        // Aufräumen, damit kein Fragment zurückbleibt.
        let _ = std::fs::remove_file(&tmp);
        return Err(AppError::Internal(format!(
            "Einhängen der Sicherung fehlgeschlagen: {e}"
        )));
    }
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
        restore_aus_datei(&sicherung, &ziel, false).await.unwrap();

        // 3. Ziel öffnen und Daten prüfen.
        let pool = crate::db::connect(ziel.to_str().unwrap()).await.unwrap();
        let name: String = sqlx::query_scalar("SELECT name FROM organisation WHERE id = 1")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(name, "Wiederhergestellt");
    }

    /// Bereitet Sicherung + ein Ziel mit vorhandenen `-wal`/`-shm` vor.
    fn ziel_mit_nebendateien(
        dir: &tempfile::TempDir,
    ) -> (std::path::PathBuf, [std::path::PathBuf; 2]) {
        let ziel = dir.path().join("alt.db");
        std::fs::write(&ziel, b"alt").unwrap();
        let wal = dir.path().join("alt.db-wal");
        let shm = dir.path().join("alt.db-shm");
        std::fs::write(&wal, b"stale").unwrap();
        std::fs::write(&shm, b"stale").unwrap();
        (ziel, [wal, shm])
    }

    #[tokio::test]
    async fn offene_nebendateien_stoppen_den_restore() {
        let quell_pool = crate::db::test_pool().await;
        let dir = tempfile::tempdir().unwrap();
        let sicherung = dir.path().join("sicherung.sqlite");
        crate::backup::vacuum_into(&quell_pool, &sicherung)
            .await
            .unwrap();
        let (ziel, _dateien) = ziel_mit_nebendateien(&dir);

        // Ohne Zusicherung: Abbruch. Ein Restore über eine laufende DB beschädigt sie —
        // und -wal/-shm sind das einzige verlässliche Indiz dafür (BEGIN EXCLUSIVE und
        // flock gelingen beide trotz offener Verbindung, gemessen).
        let err = restore_aus_datei(&sicherung, &ziel, false)
            .await
            .unwrap_err();
        assert!(matches!(err, AppError::Conflict(_)), "erwartet: Conflict");

        assert_eq!(
            std::fs::read(&ziel).unwrap(),
            b"alt",
            "das Ziel darf dabei unangetastet bleiben"
        );
    }

    #[tokio::test]
    async fn mit_zusicherung_laeuft_der_restore_und_entfernt_stale_wal_und_shm() {
        let quell_pool = crate::db::test_pool().await;
        let dir = tempfile::tempdir().unwrap();
        let sicherung = dir.path().join("sicherung.sqlite");
        crate::backup::vacuum_into(&quell_pool, &sicherung)
            .await
            .unwrap();
        let (ziel, [wal, shm]) = ziel_mit_nebendateien(&dir);

        // Nach einem Absturz bleiben die Dateien verwaist liegen — genau dann will man
        // restaurieren. Deshalb muss die Zusicherung den Weg freigeben.
        restore_aus_datei(&sicherung, &ziel, true).await.unwrap();

        assert!(!wal.exists(), "stale -wal muss entfernt sein");
        assert!(!shm.exists(), "stale -shm muss entfernt sein");
        assert_ne!(
            std::fs::read(&ziel).unwrap(),
            b"alt",
            "das Ziel muss ersetzt worden sein"
        );
    }

    #[tokio::test]
    async fn restore_hinterlaesst_keine_tmp_datei() {
        let quell_pool = crate::db::test_pool().await;
        let dir = tempfile::tempdir().unwrap();
        let sicherung = dir.path().join("sicherung.sqlite");
        crate::backup::vacuum_into(&quell_pool, &sicherung)
            .await
            .unwrap();

        let ziel = dir.path().join("ziel.db");
        restore_aus_datei(&sicherung, &ziel, false).await.unwrap();

        assert!(
            !nebendatei(&ziel, ".restore-tmp").exists(),
            "die Zwischendatei des atomaren Einhängens muss weg sein"
        );
    }

    #[tokio::test]
    async fn ungueltige_quelle_wird_abgelehnt() {
        let dir = tempfile::tempdir().unwrap();
        let kaputt = dir.path().join("kaputt.sqlite");
        std::fs::write(&kaputt, b"kein gueltiges sqlite").unwrap();
        let ziel = dir.path().join("ziel.db");

        let err = restore_aus_datei(&kaputt, &ziel, false).await.unwrap_err();
        assert!(matches!(err, AppError::Validation(_)));
        assert!(
            !ziel.exists(),
            "Ziel darf bei ungültiger Quelle nicht entstehen"
        );
    }
}
