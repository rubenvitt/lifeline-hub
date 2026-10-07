use crate::backup::verschluesselung::{self, Schluessel};
use crate::error::AppError;
use sqlx::sqlite::SqliteConnectOptions;
use sqlx::SqlitePool;
use std::path::Path;

/// Präfix des Verzeichnisses neben der Ziel-Datenbank, in das eine verschlüsselte Sicherung vor
/// dem Prüfen entschlüsselt wird (LFH-1002). Reste eines abgebrochenen Restores räumt der
/// nächste Serverstart weg (`backup::raeume_download_reste`).
pub const ENTSCHLUESSELT_PRAEFIX: &str = ".restore-entschluesselt-";

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

/// Ist `ziel` möglicherweise gerade verbunden (etwa von einem laufenden Server)?
///
/// SQLite legt im WAL-Modus `-wal` und `-shm` an, sobald die erste Verbindung öffnet, und
/// entfernt sie beim sauberen Schließen der letzten. Das ist das brauchbare Signal: `flock`
/// interagiert nicht mit SQLites Byte-Range-Locks, und `BEGIN EXCLUSIVE` gelingt auch bei einer
/// offenen, untätigen Verbindung.
///
/// Nach einem **Absturz** bleiben die Dateien verwaist liegen, dann meldet die Prüfung
/// fälschlich „in Benutzung“; der Fehlertext nennt den Ausweg.
fn ziel_moeglicherweise_in_benutzung(ziel: &Path) -> bool {
    ["-wal", "-shm"]
        .iter()
        .any(|endung| nebendatei(ziel, endung).exists())
}

/// Spielt die Sicherung `quelle` an die Stelle der Datenbank `ziel` ein: Quelle validieren →
/// prüfen, dass niemand auf `ziel` verbunden ist → verwaiste WAL-/SHM-Dateien entfernen →
/// **atomar** einhängen (Kopie nach `.tmp`, dann `rename`).
///
/// Die Benutzungsprüfung muss VOR dem Entfernen von `-wal`/`-shm` laufen, sonst zerstört der
/// Restore genau das Signal, das ihn stoppen soll.
///
/// `server_gestoppt`: Zusicherung des Operators, dass nichts mehr auf `ziel` verbunden ist.
/// Nötig, weil die Erkennung einen abgestürzten Server nicht von einem laufenden unterscheiden
/// kann — und nach einem Absturz ist ein Restore am wahrscheinlichsten.
pub async fn restore_aus_datei(
    quelle: &Path,
    ziel: &Path,
    server_gestoppt: bool,
) -> Result<(), AppError> {
    restore_aus_datei_mit(quelle, ziel, server_gestoppt, None).await
}

/// Wie [`restore_aus_datei`], erkennt aber eine verschlüsselte Sicherung am `age`-Kopf
/// (LFH-1002) und entschlüsselt sie mit `schluessel`.
///
/// Der Klartext entsteht in einem Verzeichnis **neben dem Ziel** (dasselbe Volume), wird dort
/// geprüft und per `rename` eingehängt. Ein falscher Schlüssel, ein beschädigter Strom oder eine
/// ungültige Datenbank brechen ab, bevor am Ziel etwas geändert ist; das Verzeichnis verschwindet
/// bei jedem Ausgang.
pub async fn restore_aus_datei_mit(
    quelle: &Path,
    ziel: &Path,
    server_gestoppt: bool,
    schluessel: Option<&Schluessel>,
) -> Result<(), AppError> {
    if !quelle.exists() {
        return Err(AppError::Validation(format!(
            "Sicherungsdatei nicht gefunden: {}",
            quelle.display()
        )));
    }
    let verschluesselt = verschluesselung::ist_verschluesselt(quelle)
        .map_err(|e| AppError::Validation(format!("Sicherungsdatei nicht lesbar: {e}")))?;
    // Hält den entschlüsselten Klartext; fällt er, ist der Klartext weg.
    let mut _entschluesselt: Option<tempfile::TempDir> = None;
    let quelle = if verschluesselt {
        let schluessel = schluessel.ok_or_else(|| {
            AppError::Validation(
                "Die Sicherung ist verschlüsselt: den privaten Schlüssel mit --identitaet angeben"
                    .into(),
            )
        })?;
        let basis = ziel
            .parent()
            .filter(|p| !p.as_os_str().is_empty())
            .unwrap_or(Path::new("."));
        let verzeichnis = tempfile::Builder::new()
            .prefix(ENTSCHLUESSELT_PRAEFIX)
            .tempdir_in(basis)
            .map_err(|e| AppError::Internal(format!("Entschlüsseln nicht möglich: {e}")))?;
        let klartext = verzeichnis.path().join("sicherung.sqlite");
        let datei = std::fs::File::create_new(&klartext)
            .map_err(|e| AppError::Internal(format!("Entschlüsseln nicht möglich: {e}")))?;
        schluessel
            .entschluessele_datei(quelle, datei)?
            .sync_all()
            .map_err(|e| AppError::Internal(format!("Entschlüsselte Sicherung: {e}")))?;
        _entschluesselt = Some(verzeichnis);
        klartext
    } else {
        quelle.to_path_buf()
    };
    let quelle = quelle.as_path();

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

    // Atomar einhängen: vollständig neben das Ziel kopieren, dann umbenennen. `rename` ist im
    // selben Dateisystem atomar; ein Abbruch beim Kopieren lässt die alte Datenbank unversehrt.
    // Der entschlüsselte Klartext liegt schon neben dem Ziel und wird direkt umbenannt.
    let tmp = nebendatei(ziel, ".restore-tmp");
    if verschluesselt {
        std::fs::rename(quelle, &tmp)
    } else {
        std::fs::copy(quelle, &tmp).map(|_| ())
    }
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

        // Ohne Zusicherung: Abbruch. Ein Restore über eine laufende DB beschädigt sie.
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
        // restaurieren;
        // die Zusicherung gibt den Weg frei.
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

    /// Eine verschlüsselte Sicherung mit Daten und der Schlüssel dazu (LFH-1002).
    async fn verschluesselte_sicherung(
        dir: &tempfile::TempDir,
    ) -> (std::path::PathBuf, Schluessel, Schluessel) {
        let quell_pool = crate::db::test_pool().await;
        sqlx::query("INSERT INTO organisation (id, name) VALUES (1, 'Verschlüsselt')")
            .execute(&quell_pool)
            .await
            .unwrap();
        let (empfaenger, identitaet) = verschluesselung::tests::schluesselpaar();
        let (_, fremd) = verschluesselung::tests::schluesselpaar();
        let sicherung = dir.path().join("sicherung.sqlite.age");
        crate::backup::erzeuge_sicherung_mit(&quell_pool, &sicherung, &empfaenger)
            .await
            .unwrap();
        let laden = |id| Schluessel::laden(id, None, || unreachable!()).unwrap();
        (sicherung, laden(identitaet), laden(fremd))
    }

    /// Einträge im Verzeichnis außer den genannten.
    fn uebrige(dir: &Path, bekannt: &[&str]) -> Vec<String> {
        let mut namen: Vec<String> = std::fs::read_dir(dir)
            .unwrap()
            .filter_map(Result::ok)
            .map(|e| e.file_name().to_string_lossy().to_string())
            .filter(|n| !bekannt.contains(&n.as_str()))
            .collect();
        namen.sort();
        namen
    }

    #[tokio::test]
    async fn verschluesselte_sicherung_mit_richtigem_schluessel() {
        let dir = tempfile::tempdir().unwrap();
        let (sicherung, schluessel, _) = verschluesselte_sicherung(&dir).await;
        let ziel_dir = tempfile::tempdir().unwrap();
        let ziel = ziel_dir.path().join("lifeline.db");

        restore_aus_datei_mit(&sicherung, &ziel, false, Some(&schluessel))
            .await
            .unwrap();

        let pool = crate::db::connect(ziel.to_str().unwrap()).await.unwrap();
        let name: String = sqlx::query_scalar("SELECT name FROM organisation WHERE id = 1")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(name, "Verschlüsselt");
        pool.close().await;
        assert!(
            uebrige(ziel_dir.path(), &["lifeline.db"]).is_empty(),
            "kein entschlüsselter Klartext bleibt neben der Datenbank liegen"
        );
    }

    #[tokio::test]
    async fn falscher_schluessel_bricht_ohne_teilschreiben_ab() {
        let dir = tempfile::tempdir().unwrap();
        let (sicherung, _, fremd) = verschluesselte_sicherung(&dir).await;
        let ziel_dir = tempfile::tempdir().unwrap();
        let ziel = ziel_dir.path().join("lifeline.db");
        std::fs::write(&ziel, b"alt").unwrap();

        let err = restore_aus_datei_mit(&sicherung, &ziel, true, Some(&fremd))
            .await
            .unwrap_err();

        assert!(matches!(err, AppError::Validation(m) if m.contains("passt nicht")));
        assert_eq!(std::fs::read(&ziel).unwrap(), b"alt");
        assert!(uebrige(ziel_dir.path(), &["lifeline.db"]).is_empty());
    }

    /// Ein abgeschnittener Strom scheitert erst mitten im Entschlüsseln: auch dann bleibt das Ziel
    /// unberührt und kein Teil-Klartext liegen.
    #[tokio::test]
    async fn abgeschnittene_sicherung_bricht_ohne_teilschreiben_ab() {
        let dir = tempfile::tempdir().unwrap();
        let (sicherung, schluessel, _) = verschluesselte_sicherung(&dir).await;
        let bytes = std::fs::read(&sicherung).unwrap();
        std::fs::write(&sicherung, &bytes[..bytes.len() - 100]).unwrap();
        let ziel_dir = tempfile::tempdir().unwrap();
        let ziel = ziel_dir.path().join("lifeline.db");
        std::fs::write(&ziel, b"alt").unwrap();

        assert!(
            restore_aus_datei_mit(&sicherung, &ziel, true, Some(&schluessel))
                .await
                .is_err()
        );

        assert_eq!(std::fs::read(&ziel).unwrap(), b"alt");
        assert!(uebrige(ziel_dir.path(), &["lifeline.db"]).is_empty());
    }

    #[tokio::test]
    async fn verschluesselte_sicherung_ohne_schluessel_wird_abgelehnt() {
        let dir = tempfile::tempdir().unwrap();
        let (sicherung, _, _) = verschluesselte_sicherung(&dir).await;
        let ziel = dir.path().join("ziel.db");

        let err = restore_aus_datei(&sicherung, &ziel, false)
            .await
            .unwrap_err();

        assert!(matches!(err, AppError::Validation(m) if m.contains("--identitaet")));
        assert!(!ziel.exists());
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
