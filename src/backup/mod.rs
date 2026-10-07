pub mod restore;
pub mod scheduler;
pub mod verschluesselung;

pub use verschluesselung::Empfaenger;

use crate::error::AppError;
use sqlx::SqlitePool;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tokio::sync::{OwnedSemaphorePermit, Semaphore};

/// Endung der Teildatei, in die eine Sicherung geschrieben und bereinigt wird, bevor sie per
/// `rename` ihren Endnamen bekommt (LFH-926). Unter dem Endnamen liegt so nie eine halbe oder
/// ungescrubbte Kopie.
pub const TEIL_ENDUNG: &str = ".part";

/// Präfix der Verzeichnisse, in denen `GET /api/backup` seine Kopie neben der Datenbank ablegt
/// (LFH-926). Der Start räumt Reste eines abgebrochenen Prozesses darüber weg.
pub const DOWNLOAD_PRAEFIX: &str = "lifeline-download-";

/// Präfix der Verzeichnisse, in denen eine verschlüsselte Sicherung ihre Klartext-Zwischenkopie
/// neben der Datenbank ablegt (LFH-1002). Der Start räumt Reste eines abgebrochenen Prozesses
/// darüber weg, wie bei [`DOWNLOAD_PRAEFIX`].
pub const ZWISCHEN_PRAEFIX: &str = "lifeline-zwischen-";

/// Lässt höchstens einen Sicherungs-Download zugleich zu (LFH-926): jeder hält eine Vollkopie
/// der Datenbank auf der Platte, bis sein letzter Chunk gesendet ist. Im `AppState`, nicht
/// prozessweit, damit parallel laufende Tests sich nicht gegenseitig sperren.
#[derive(Clone)]
pub struct DownloadSperre(Arc<Semaphore>);

impl Default for DownloadSperre {
    fn default() -> Self {
        Self(Arc::new(Semaphore::new(1)))
    }
}

impl DownloadSperre {
    /// Nimmt die Sperre oder meldet 503, wenn schon ein Download läuft. Der Platz gehört dem
    /// zurückgegebenen Permit und wird mit ihm frei.
    pub fn belegen(&self) -> Result<OwnedSemaphorePermit, AppError> {
        self.0.clone().try_acquire_owned().map_err(|_| {
            AppError::ServiceUnavailable(
                "Sicherung läuft bereits. Bitte warten, bis der laufende Download fertig ist."
                    .into(),
            )
        })
    }
}

/// Pfad der Teildatei zu `ziel` (`<ziel>.part`).
fn teil_pfad(ziel: &Path) -> PathBuf {
    let mut p = ziel.as_os_str().to_owned();
    p.push(TEIL_ENDUNG);
    PathBuf::from(p)
}

/// Löscht die Teildatei samt Rollback-Journal, das `scrub_sessions` im `Delete`-Modus anlegt.
/// Fehlende Dateien sind kein Fehler.
fn teil_entfernen(teil: &Path) {
    let _ = std::fs::remove_file(teil);
    let mut journal = teil.as_os_str().to_owned();
    journal.push("-journal");
    let _ = std::fs::remove_file(PathBuf::from(journal));
}

/// Räumt die Teildatei weg, sobald sie fallen gelassen wird, ohne umbenannt worden zu sein: bei
/// jedem Fehler und auch, wenn der Aufrufer die Sicherung abbricht (Shutdown).
struct Teildatei {
    pfad: PathBuf,
    umbenannt: bool,
}

impl Drop for Teildatei {
    fn drop(&mut self) {
        if !self.umbenannt {
            teil_entfernen(&self.pfad);
        }
    }
}

/// Verzeichnis der Datenbankdatei des Pools, `None` für eine In-Memory-Datenbank.
pub async fn db_verzeichnis(pool: &SqlitePool) -> Result<Option<PathBuf>, AppError> {
    let datei: String =
        sqlx::query_scalar("SELECT file FROM pragma_database_list WHERE name = 'main'")
            .fetch_one(pool)
            .await?;
    Ok(Path::new(&datei)
        .parent()
        .filter(|p| !datei.is_empty() && !p.as_os_str().is_empty())
        .map(Path::to_path_buf))
}

/// Entfernt Download- und Zwischenverzeichnisse ([`DOWNLOAD_PRAEFIX`], [`ZWISCHEN_PRAEFIX`]),
/// die ein abgebrochener Prozess neben der Datenbank zurückgelassen hat. Liefert die Anzahl.
///
/// Dazu zählt der Klartext eines abgebrochenen Restores aus einer verschlüsselten Sicherung
/// ([`restore::ENTSCHLUESSELT_PRAEFIX`]): der Restore entschlüsselt neben die Datenbank, und der
/// nächste Start findet den Rest dort.
pub fn raeume_download_reste(verzeichnis: &Path) -> usize {
    let Ok(eintraege) = std::fs::read_dir(verzeichnis) else {
        return 0;
    };
    let mut anzahl = 0;
    for pfad in eintraege.filter_map(Result::ok).map(|e| e.path()) {
        let unseres = pfad.file_name().and_then(|n| n.to_str()).is_some_and(|n| {
            [
                DOWNLOAD_PRAEFIX,
                ZWISCHEN_PRAEFIX,
                restore::ENTSCHLUESSELT_PRAEFIX,
            ]
            .iter()
            .any(|praefix| n.starts_with(praefix))
        });
        if unseres && pfad.is_dir() {
            match std::fs::remove_dir_all(&pfad) {
                Ok(()) => anzahl += 1,
                Err(e) => tracing::warn!(pfad = %pfad.display(), "Download-Rest bleibt: {e}"),
            }
        }
    }
    anzahl
}

/// Verdoppelt einfache Anführungszeichen, damit ein Pfad sicher als
/// SQL-String-Literal in `VACUUM INTO` eingesetzt werden kann.
/// (SQLite erlaubt für VACUUM INTO keinen Parameter-Bind.)
fn escape_sql_string(pfad: &str) -> String {
    pfad.replace('\'', "''")
}

/// Erzeugt eine konsistente Sicherungskopie der Datenbank in `ziel` per `VACUUM INTO`, das im
/// WAL-Modus auch während Schreibzugriffen einen konsistenten Snapshot schreibt. `ziel` darf
/// noch nicht existieren und muss server-kontrolliert sein, nie ein Client-Pfad. Liefert die
/// Größe in Bytes.
///
/// # Warnung
/// Liefert eine UN-gescrubbte Vollkopie inkl. `session` (Bearer-Tokens). Jeder Export nach
/// außen nimmt `erzeuge_sicherung_mit`; `pub(crate)`, damit kein neuer Export-Pfad das umgeht.
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

/// Leert die `session`-Tabelle in einer geschriebenen Sicherungsdatei.
///
/// Bewusst im `Delete`-Journal-Modus statt WAL: ein `DELETE` im WAL-Modus landete in
/// `<ziel>-wal`, das ein späteres `std::fs::read` der Hauptdatei nicht sähe — die Sessions
/// wären weiter exportiert.
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

/// Wie [`vacuum_into`], aber ohne Session-Tokens in der Kopie: ein geleaktes Backup trägt keine
/// verwertbaren Bearer-Secrets. `passwort_hash`/`totp_secret` bleiben, damit die Sicherung
/// restore-fähig ist. Liefert die Größe in Bytes.
///
/// **Atomar** (LFH-926): VACUUM und Scrub laufen in `<ziel>.part`, nach `fsync` folgt das
/// `rename` auf den Endnamen. Unter `ziel` liegt so nie eine halbe oder ungescrubbte Datei.
/// Scheitert ein Schritt, ist die Teildatei wieder weg. Wird der Aufruf abgebrochen (Shutdown)
/// oder der Prozess hart beendet, kann sie liegen bleiben, auch ungescrubbt: sqlx führt ein
/// laufendes `VACUUM INTO` zu Ende, selbst wenn niemand mehr wartet. Solche Reste räumt
/// `scheduler::raeume_teildateien` beim Start weg.
///
/// `ziel` und `<ziel>.part` dürfen noch nicht existieren; eine fremde `.part` wird nicht
/// gelöscht.
///
/// Immer Klartext; `pub(crate)`, damit jeder Export nach außen über [`erzeuge_sicherung_mit`]
/// läuft und die Empfänger nicht übergehen kann (LFH-1002).
pub(crate) async fn erzeuge_sicherung(pool: &SqlitePool, ziel: &Path) -> Result<u64, AppError> {
    let existiert = |pfad: &Path| {
        AppError::Internal(format!(
            "Sicherungsziel existiert bereits: {}",
            pfad.display()
        ))
    };
    if ziel.exists() {
        return Err(existiert(ziel));
    }
    let teil_pfad = teil_pfad(ziel);
    if teil_pfad.exists() {
        return Err(existiert(&teil_pfad));
    }
    let mut teil = Teildatei {
        pfad: teil_pfad,
        umbenannt: false,
    };

    vacuum_into(pool, &teil.pfad).await?;
    // Fail-closed: scheitert der Scrub, räumt `Teildatei` die un-bereinigte Kopie weg.
    scrub_sessions(&teil.pfad).await?;

    // Schreibend geöffnet: Windows verlangt für `FlushFileBuffers` Schreibrecht am Handle.
    let datei = tokio::fs::OpenOptions::new()
        .read(true)
        .write(true)
        .open(&teil.pfad)
        .await
        .map_err(|e| AppError::Internal(format!("Sicherungsdatei nicht lesbar: {e}")))?;
    datei
        .sync_all()
        .await
        .map_err(|e| AppError::Internal(format!("Sicherungsdatei nicht synchronisiert: {e}")))?;
    let groesse = datei
        .metadata()
        .await
        .map_err(|e| AppError::Internal(format!("Sicherungsdatei nicht lesbar: {e}")))?
        .len();
    drop(datei);

    // `rename` überschreibt; die Prüfung oben liegt VACUUM und Scrub zurück.
    if ziel.exists() {
        return Err(existiert(ziel));
    }
    tokio::fs::rename(&teil.pfad, ziel)
        .await
        .map_err(|e| AppError::Internal(format!("Sicherungsdatei nicht umbenannt: {e}")))?;
    teil.umbenannt = true;
    verzeichnis_synchronisieren(ziel).await;
    Ok(groesse)
}

/// Wie [`erzeuge_sicherung`], aber mit gesetzten `empfaenger` verschlüsselt (LFH-1002): Jeder
/// Export nach außen (CLI, automatische Sicherung, Download) nimmt diese Funktion.
///
/// Ohne Empfänger schreibt sie Klartext wie bisher. Mit Empfängern entsteht die bereinigte
/// Klartext-Kopie in einem Zwischenverzeichnis ([`ZWISCHEN_PRAEFIX`]) **neben der Datenbank**,
/// also auf demselben Volume, und wird von dort als Strom nach `<ziel>.part` verschlüsselt, das
/// erst fertig und festgeschrieben seinen Endnamen bekommt. Das Zwischenverzeichnis verschwindet
/// bei jedem Ausgang, auch bei einem Fehler mitten in der Verschlüsselung. Unter `ziel` liegt
/// damit nie Klartext. Liefert die Größe der geschriebenen Datei in Bytes.
pub async fn erzeuge_sicherung_mit(
    pool: &SqlitePool,
    ziel: &Path,
    empfaenger: &Empfaenger,
) -> Result<u64, AppError> {
    if empfaenger.ist_leer() {
        return erzeuge_sicherung(pool, ziel).await;
    }
    erzeuge_verschluesselt(pool, ziel, empfaenger, |teil| {
        let datei = std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(teil)?;
        Ok(Box::new(datei) as Box<dyn verschluesselung::Ausgabe>)
    })
    .await
}

/// Kern von [`erzeuge_sicherung_mit`] mit Empfängern. `oeffne` legt die Ausgabe an `<ziel>.part`
/// an; Tests reichen hier eine Ausgabe, die mittendrin scheitert.
async fn erzeuge_verschluesselt<F>(
    pool: &SqlitePool,
    ziel: &Path,
    empfaenger: &Empfaenger,
    oeffne: F,
) -> Result<u64, AppError>
where
    F: FnOnce(&Path) -> std::io::Result<Box<dyn verschluesselung::Ausgabe>> + Send + 'static,
{
    let existiert = |pfad: &Path| {
        AppError::Internal(format!(
            "Sicherungsziel existiert bereits: {}",
            pfad.display()
        ))
    };
    if ziel.exists() {
        return Err(existiert(ziel));
    }
    let teil_pfad = teil_pfad(ziel);
    if teil_pfad.exists() {
        return Err(existiert(&teil_pfad));
    }

    // Drop-Guard des Klartexts: das Verzeichnis geht mit `zwischen`, bei Erfolg wie bei Fehler.
    let basis = db_verzeichnis(pool)
        .await?
        .unwrap_or_else(std::env::temp_dir);
    let zwischen = tempfile::Builder::new()
        .prefix(ZWISCHEN_PRAEFIX)
        .tempdir_in(&basis)
        .map_err(|e| AppError::Internal(format!("Zwischenverzeichnis fehlgeschlagen: {e}")))?;
    let klartext = zwischen.path().join("sicherung.sqlite");
    erzeuge_sicherung(pool, &klartext).await?;

    let mut teil = Teildatei {
        pfad: teil_pfad,
        umbenannt: false,
    };
    let teil_pfad = teil.pfad.clone();
    let empfaenger = empfaenger.clone();
    // Fällt dieses Future (Shutdown nach der Frist), endet auch der Thread nach dem nächsten
    // Block, statt die Runtime beim Beenden warten zu lassen.
    let abbruch = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
    let _abbruch_bei_drop = verschluesselung::AbbruchBeiDrop(abbruch.clone());
    tokio::task::spawn_blocking(move || -> std::io::Result<()> {
        // Der Thread hält das Zwischenverzeichnis und löscht es selbst: das Löschen einer Kopie in
        // DB-Größe gehört nicht auf einen Async-Worker.
        let _zwischen = zwischen;
        let ausgabe = oeffne(&teil_pfad)?;
        let mut ausgabe =
            verschluesselung::verschluessele_datei(&klartext, ausgabe, &empfaenger, &abbruch)?;
        ausgabe.festschreiben()
    })
    .await
    .map_err(|e| AppError::Internal(format!("Verschlüsselung abgebrochen: {e}")))?
    .map_err(|e| AppError::Internal(format!("Sicherung nicht verschlüsselt: {e}")))?;

    let groesse = tokio::fs::metadata(&teil.pfad)
        .await
        .map_err(|e| AppError::Internal(format!("Sicherungsdatei nicht lesbar: {e}")))?
        .len();
    if ziel.exists() {
        return Err(existiert(ziel));
    }
    tokio::fs::rename(&teil.pfad, ziel)
        .await
        .map_err(|e| AppError::Internal(format!("Sicherungsdatei nicht umbenannt: {e}")))?;
    teil.umbenannt = true;
    verzeichnis_synchronisieren(ziel).await;
    Ok(groesse)
}

/// Schreibt den Verzeichniseintrag nach dem `rename` fest, damit ein Stromausfall die fertige
/// Sicherung nicht wieder unter dem Teilnamen zeigt. Best effort: manche Dateisysteme (FAT auf
/// USB-Sticks) können ein Verzeichnis nicht synchronisieren.
async fn verzeichnis_synchronisieren(ziel: &Path) {
    #[cfg(unix)]
    if let Some(verzeichnis) = ziel.parent().filter(|p| !p.as_os_str().is_empty()) {
        if let Ok(v) = tokio::fs::File::open(verzeichnis).await {
            let _ = v.sync_all().await;
        }
    }
    #[cfg(not(unix))]
    let _ = ziel;
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

    /// LFH-926: Nach einer gelungenen Sicherung liegt nur die fertige Datei da, keine
    /// Teildatei und kein Journal.
    #[tokio::test]
    async fn sicherung_hinterlaesst_keine_teildatei() {
        let pool = crate::db::test_pool().await;
        let dir = tempfile::tempdir().unwrap();
        let ziel = dir.path().join("backup.sqlite");

        erzeuge_sicherung(&pool, &ziel).await.unwrap();

        let namen: Vec<String> = std::fs::read_dir(dir.path())
            .unwrap()
            .filter_map(Result::ok)
            .map(|e| e.file_name().to_string_lossy().to_string())
            .collect();
        assert_eq!(namen, vec!["backup.sqlite"]);
    }

    /// Scheitert das VACUUM, bleibt weder eine Datei unter dem Endnamen noch eine Teildatei.
    #[tokio::test]
    async fn gescheitertes_vacuum_hinterlaesst_nichts() {
        let pool = crate::db::test_pool().await;
        pool.close().await;
        let dir = tempfile::tempdir().unwrap();
        let ziel = dir.path().join("backup.sqlite");

        assert!(erzeuge_sicherung(&pool, &ziel).await.is_err());

        assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 0);
    }

    /// Die Teildatei verschwindet samt Journal, wenn sie ohne `rename` fallen gelassen wird: so
    /// auch, wenn der Shutdown eine laufende Sicherung abbricht.
    #[test]
    fn teildatei_raeumt_beim_fallenlassen_auf() {
        let dir = tempfile::tempdir().unwrap();
        let teil = teil_pfad(&dir.path().join("backup.sqlite"));
        std::fs::write(&teil, b"halb").unwrap();
        std::fs::write(dir.path().join("backup.sqlite.part-journal"), b"j").unwrap();

        drop(Teildatei {
            pfad: teil.clone(),
            umbenannt: false,
        });

        assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 0);
    }

    /// Eine fremde Teildatei am Zielpfad bleibt unangetastet, die Sicherung scheitert.
    #[tokio::test]
    async fn fremde_teildatei_bleibt_stehen() {
        let pool = crate::db::test_pool().await;
        let dir = tempfile::tempdir().unwrap();
        let ziel = dir.path().join("backup.sqlite");
        let fremd = dir.path().join("backup.sqlite.part");
        std::fs::write(&fremd, b"fremd").unwrap();

        assert!(erzeuge_sicherung(&pool, &ziel).await.is_err());
        assert_eq!(std::fs::read(&fremd).unwrap(), b"fremd");
        assert!(!ziel.exists());
    }

    /// Wie bisher `VACUUM INTO`: eine vorhandene Datei wird nicht überschrieben.
    #[tokio::test]
    async fn vorhandenes_ziel_wird_nicht_ueberschrieben() {
        let pool = crate::db::test_pool().await;
        let dir = tempfile::tempdir().unwrap();
        let ziel = dir.path().join("backup.sqlite");
        std::fs::write(&ziel, b"handsicherung").unwrap();

        assert!(erzeuge_sicherung(&pool, &ziel).await.is_err());
        assert_eq!(std::fs::read(&ziel).unwrap(), b"handsicherung");
    }

    /// Namen der Klartext-Zwischenverzeichnisse neben der Datenbank.
    fn zwischenverzeichnisse(db_dir: &Path) -> Vec<PathBuf> {
        std::fs::read_dir(db_dir)
            .unwrap()
            .filter_map(Result::ok)
            .map(|e| e.path())
            .filter(|p| {
                p.file_name()
                    .and_then(|n| n.to_str())
                    .is_some_and(|n| n.starts_with(ZWISCHEN_PRAEFIX))
            })
            .collect()
    }

    /// LFH-1002: Mit Empfänger beginnt die Sicherung mit dem `age`-Kopf und trägt keinen
    /// SQLite-Klartext; im Zielverzeichnis liegt nur sie, neben der Datenbank bleibt nichts.
    #[tokio::test]
    async fn mit_empfaenger_entsteht_nur_die_verschluesselte_sicherung() {
        let (db_dir, pool) = crate::db::test_pool_datei().await;
        sqlx::query("INSERT INTO organisation (id, name) VALUES (1, 'Test-Orga')")
            .execute(&pool)
            .await
            .unwrap();
        let (empfaenger, identitaet) = verschluesselung::tests::schluesselpaar();
        let ziel_dir = tempfile::tempdir().unwrap();
        let ziel = ziel_dir.path().join("backup.sqlite.age");

        let groesse = erzeuge_sicherung_mit(&pool, &ziel, &empfaenger)
            .await
            .unwrap();

        let bytes = std::fs::read(&ziel).unwrap();
        assert_eq!(groesse, bytes.len() as u64);
        assert!(bytes.starts_with(verschluesselung::AGE_KOPF));
        assert!(
            !bytes
                .windows(b"SQLite format 3".len())
                .any(|w| w == b"SQLite format 3"),
            "die Sicherung darf keinen SQLite-Klartext tragen"
        );
        let namen: Vec<String> = std::fs::read_dir(ziel_dir.path())
            .unwrap()
            .filter_map(Result::ok)
            .map(|e| e.file_name().to_string_lossy().to_string())
            .collect();
        assert_eq!(namen, vec!["backup.sqlite.age"]);
        assert!(zwischenverzeichnisse(db_dir.path()).is_empty());

        // Der Kreis schließt sich: entschlüsselt ist es die bereinigte Datenbank.
        let schluessel =
            verschluesselung::Schluessel::laden(identitaet, None, || unreachable!()).unwrap();
        let klartext = ziel_dir.path().join("zurueck.sqlite");
        schluessel
            .entschluessele_datei(&ziel, std::fs::File::create(&klartext).unwrap())
            .unwrap();
        let zurueck = oeffne_sicherung(&klartext).await;
        let name: String = sqlx::query_scalar("SELECT name FROM organisation WHERE id = 1")
            .fetch_one(&zurueck)
            .await
            .unwrap();
        assert_eq!(name, "Test-Orga");
    }

    /// Ausgabe, die nach einigen Kilobyte scheitert (Medium voll) und dabei festhält, ob die
    /// Klartext-Zwischenkopie in diesem Moment wirklich neben der Datenbank lag.
    struct BrichtAb {
        geschrieben: usize,
        db_dir: PathBuf,
        klartext_lag_da: std::sync::Arc<std::sync::atomic::AtomicBool>,
    }

    impl std::io::Write for BrichtAb {
        fn write(&mut self, puffer: &[u8]) -> std::io::Result<usize> {
            if self.geschrieben > 4096 {
                let da = zwischenverzeichnisse(&self.db_dir)
                    .iter()
                    .any(|d| d.join("sicherung.sqlite").exists());
                self.klartext_lag_da
                    .store(da, std::sync::atomic::Ordering::SeqCst);
                return Err(std::io::Error::other("Medium voll"));
            }
            self.geschrieben += puffer.len();
            Ok(puffer.len())
        }

        fn flush(&mut self) -> std::io::Result<()> {
            Ok(())
        }
    }

    impl verschluesselung::Ausgabe for BrichtAb {
        fn festschreiben(&mut self) -> std::io::Result<()> {
            Ok(())
        }
    }

    /// LFH-1002: Bricht die Verschlüsselung mittendrin ab, verschwindet die Klartext-Kopie, und
    /// unter dem Zielnamen entsteht nichts.
    #[tokio::test]
    async fn abbruch_mitten_in_der_verschluesselung_raeumt_den_klartext_weg() {
        let (db_dir, pool) = crate::db::test_pool_datei().await;
        let (empfaenger, _) = verschluesselung::tests::schluesselpaar();
        let ziel_dir = tempfile::tempdir().unwrap();
        let ziel = ziel_dir.path().join("backup.sqlite.age");
        let klartext_lag_da = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));

        let ausgabe = BrichtAb {
            geschrieben: 0,
            db_dir: db_dir.path().to_path_buf(),
            klartext_lag_da: klartext_lag_da.clone(),
        };
        let ergebnis = erzeuge_verschluesselt(&pool, &ziel, &empfaenger, move |_| {
            Ok(Box::new(ausgabe) as Box<dyn verschluesselung::Ausgabe>)
        })
        .await;

        assert!(ergebnis.is_err());
        assert!(
            klartext_lag_da.load(std::sync::atomic::Ordering::SeqCst),
            "der Abbruch muss die Verschlüsselung treffen, während der Klartext daliegt"
        );
        assert!(
            zwischenverzeichnisse(db_dir.path()).is_empty(),
            "die Klartext-Kopie muss nach dem Abbruch weg sein"
        );
        assert_eq!(std::fs::read_dir(ziel_dir.path()).unwrap().count(), 0);
    }

    /// Ohne Empfänger bleibt es die Klartext-Sicherung von bisher.
    #[tokio::test]
    async fn ohne_empfaenger_bleibt_es_klartext() {
        let pool = crate::db::test_pool().await;
        let dir = tempfile::tempdir().unwrap();
        let ziel = dir.path().join("backup.sqlite");

        erzeuge_sicherung_mit(&pool, &ziel, &Empfaenger::default())
            .await
            .unwrap();

        assert!(std::fs::read(&ziel)
            .unwrap()
            .starts_with(b"SQLite format 3\0"));
    }

    #[test]
    fn zwischenreste_werden_wie_download_reste_geraeumt() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir(dir.path().join("lifeline-zwischen-xyz")).unwrap();
        std::fs::write(
            dir.path().join("lifeline-zwischen-xyz/sicherung.sqlite"),
            b"klartext",
        )
        .unwrap();

        std::fs::create_dir(dir.path().join(".restore-entschluesselt-abc")).unwrap();

        assert_eq!(raeume_download_reste(dir.path()), 2);
        assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 0);
    }

    #[tokio::test]
    async fn db_verzeichnis_folgt_der_datei() {
        let (dir, pool) = crate::db::test_pool_datei().await;
        assert_eq!(
            db_verzeichnis(&pool)
                .await
                .unwrap()
                .unwrap()
                .canonicalize()
                .unwrap(),
            dir.path().canonicalize().unwrap()
        );
        let speicher = crate::db::test_pool().await;
        assert_eq!(db_verzeichnis(&speicher).await.unwrap(), None);
    }

    #[test]
    fn download_reste_werden_geraeumt_fremdes_bleibt() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir(dir.path().join("lifeline-download-abc123")).unwrap();
        std::fs::write(
            dir.path()
                .join("lifeline-download-abc123/lifeline-backup.sqlite"),
            b"kopie",
        )
        .unwrap();
        std::fs::create_dir(dir.path().join("karten")).unwrap();
        std::fs::write(dir.path().join("lifeline.db"), b"db").unwrap();

        assert_eq!(raeume_download_reste(dir.path()), 1);

        let mut namen: Vec<String> = std::fs::read_dir(dir.path())
            .unwrap()
            .filter_map(Result::ok)
            .map(|e| e.file_name().to_string_lossy().to_string())
            .collect();
        namen.sort();
        assert_eq!(namen, vec!["karten", "lifeline.db"]);
    }

    #[test]
    fn download_sperre_laesst_genau_einen_zu() {
        let sperre = DownloadSperre::default();
        let erster = sperre.belegen().unwrap();
        assert!(matches!(
            sperre.clone().belegen(),
            Err(AppError::ServiceUnavailable(_))
        ));
        drop(erster);
        assert!(sperre.belegen().is_ok());
    }

    #[test]
    fn escape_verdoppelt_single_quotes() {
        assert_eq!(escape_sql_string("a'b"), "a''b");
        assert_eq!(escape_sql_string("normal"), "normal");
    }
}
