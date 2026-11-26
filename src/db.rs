use sqlx::sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePoolOptions};
use sqlx::SqlitePool;

mod migrationslauf;
mod physisch;
pub mod suche;
#[cfg(test)]
pub(crate) use physisch::datei_oder_wal_enthaelt;
pub use physisch::{bereinige_altbestand_einmalig, wal_zurueckschreiben};

/// Größe, auf die SQLite die WAL-Datei nach einem zurücksetzenden Checkpoint stutzt (64 MiB,
/// `PRAGMA journal_size_limit`, s. [`connect`]).
pub const WAL_GRENZE_BYTES: i64 = 64 * 1024 * 1024;

/// Öffnet einen SQLite-Pool auf der angegebenen Datei.
/// Aktiviert WAL-Journal, Foreign Keys und legt die Datei bei Bedarf an.
///
/// `secure_delete = ON` auf jeder Verbindung (LFH-725): SQLite nullt freigewordenen Platz,
/// statt die alten Bytes stehen zu lassen — sonst wären geschwärzte Werte mit einem Hex-Editor
/// wiederherstellbar. Nicht `FAST`: das lässt die Overflow-Seiten gelöschter Anhang-BLOBs
/// ungenullt auf der Freelist. Den Rest erledigt [`wal_zurueckschreiben`] nach der Schwärzung;
/// Messung und Herleitung in
/// `openspec/changes/archive/2026-10-01-lfh-725-schwaerzung-physisch-ueberschreiben/design.md`.
///
/// `journal_size_limit` (LFH-928): mit `secure_delete = ON` schreibt jedes gelöschte MB ein MB
/// genullter Seiten ins WAL (Messung LFH-725, design.md Abschnitt 5). Ohne Grenze behält die
/// WAL-Datei nach einem großen Upload oder Sweep ihren Höchststand bis zum nächsten Kürzen;
/// mit ihr stutzt SQLite sie nach jedem Checkpoint, der den WAL zurücksetzt, auf
/// [`WAL_GRENZE_BYTES`].
pub async fn connect(db_path: &str) -> Result<SqlitePool, sqlx::Error> {
    let options = SqliteConnectOptions::new()
        .filename(db_path)
        .create_if_missing(true)
        .journal_mode(SqliteJournalMode::Wal)
        // `busy_timeout` explizit (entspricht der sqlx-Vorgabe): darauf baut die Writer-Disziplin
        // (`BEGIN IMMEDIATE` + Busy-Retry in `src/tx.rs`). Beim Lock-Upgrade greift er nicht —
        // dafür
        // `BEGIN IMMEDIATE`.
        .busy_timeout(std::time::Duration::from_secs(5))
        .foreign_keys(true)
        .pragma("secure_delete", "ON")
        .pragma("journal_size_limit", WAL_GRENZE_BYTES.to_string());

    SqlitePoolOptions::new()
        .max_connections(5)
        // `acquire_timeout` explizit: die sqlx-Vorgabe von 30 s ließe Backpressure als stillen
        // Hänger
        // erscheinen, der am Ende als 500 endet; 10 s macht daraus schnellen Lastabwurf (503).
        //
        // Nicht kürzer: `write_retry!` checkt ERST eine Verbindung aus und wartet DANN bis zu
        // `busy_timeout` (5 s) am BEGIN. Unter Schreib-Contention können alle Slots legitim in
        // dieser
        // Phase stehen; jeder Wert < 5 s wiese nebenläufige Leser ab, obwohl der Pool nicht
        // erschöpft
        // ist. Den Worst Case eines Schreibers (4 × 5 s, s. `src/tx.rs`) deckt der Wert bewusst
        // nicht
        // ab — ein Leser soll dann 503 sehen.
        .acquire_timeout(std::time::Duration::from_secs(10))
        .connect_with(options)
        .await
}

/// Stellt sicher, dass die Verbindung Fremdschlüssel **sofort** prüft, bevor ein Löschweg sich
/// auf `ON DELETE CASCADE` oder auf eine FK-Verletzung verlässt. Ohne Prüfung liefe die Kaskade
/// nicht, und abhängige Zeilen blieben verwaist stehen; aufgeschoben käme ein Fehler erst beim
/// COMMIT. Beides ist heute ausgeschlossen — die Prüfung hält es zur Laufzeit fest, statt es
/// anzunehmen. `zweck` steht in der Fehlermeldung (Demo-Daten entfernen, endgültige Löschung).
pub(crate) async fn fk_pruefung_sicherstellen(
    conn: &mut sqlx::SqliteConnection,
    zweck: &str,
) -> Result<(), crate::error::AppError> {
    let an: i64 = sqlx::query_scalar("PRAGMA foreign_keys")
        .fetch_one(&mut *conn)
        .await?;
    let aufgeschoben: i64 = sqlx::query_scalar("PRAGMA defer_foreign_keys")
        .fetch_one(&mut *conn)
        .await?;
    if an != 1 || aufgeschoben != 0 {
        return Err(crate::error::AppError::Internal(format!(
            "{zweck} verweigert: foreign_keys={an}, defer_foreign_keys={aufgeschoben}"
        )));
    }
    Ok(())
}

/// Spielt alle eingebetteten Migrationen aus `./migrations` ein. Eine Migration mit
/// `-- no-transaction` läuft dabei trotzdem ganz oder gar nicht (LLH-1659, [`migrationslauf`]).
pub async fn migrate(pool: &SqlitePool) -> Result<(), sqlx::migrate::MigrateError> {
    migrationslauf::einspielen(sqlx::migrate!("./migrations"), pool).await
}

/// Ob die Datenbank genau auf dem Stand dieser Version ist: alle eingebetteten Migrationen
/// eingespielt, keine fremde dazu. Für Befehle, die neben dem laufenden Server schreiben und
/// darum selbst nicht migrieren dürfen (LLH-1494). Liefert die Abweichung als Text.
pub async fn stand_abweichung(pool: &SqlitePool) -> Result<Option<String>, sqlx::Error> {
    let eingespielt: Vec<i64> =
        sqlx::query_scalar("SELECT version FROM _sqlx_migrations WHERE success ORDER BY version")
            .fetch_all(pool)
            .await?;
    let eigene: Vec<i64> = sqlx::migrate!("./migrations")
        .iter()
        .map(|m| m.version)
        .collect();
    let fehlen = eigene.iter().filter(|v| !eingespielt.contains(v)).count();
    let fremd = eingespielt.iter().filter(|v| !eigene.contains(v)).count();
    Ok(match (fehlen, fremd) {
        (0, 0) => None,
        (n, 0) => Some(format!("{n} Migrationen dieser Version fehlen")),
        (_, n) => Some(format!(
            "{n} Migrationen einer neueren Version sind eingespielt"
        )),
    })
}

/// In-Memory-Pool für Tests (eine Verbindung, damit dieselbe DB geteilt wird), mit
/// eingespielten Migrationen.
///
/// **Migriert wird einmal je Stand, nicht je Test und nicht je Prozess.** Der erste Aufruf liest
/// die Vorlage aus [`vorlagen_datei`] oder migriert sie dort hin, und hält sie als Abbild
/// (`sqlite3_serialize`); jeder Aufruf spielt es per
/// `sqlite3_deserialize` in eine FRISCHE `:memory:`-Verbindung ein. Art, Schema und
/// `_sqlx_migrations` sind dieselben wie nach einer Migration, und jeder Test bekommt seine
/// eigene Kopie.
///
/// Wer eine Migration selbst prüfen will, nimmt [`migrate`] auf einem eigenen Pool: hier läuft
/// die Migrationskette nur beim ersten Aufruf.
pub async fn test_pool() -> SqlitePool {
    static VORLAGE: tokio::sync::OnceCell<Vec<u8>> = tokio::sync::OnceCell::const_new();

    let vorlage = VORLAGE
        .get_or_init(|| async {
            let datei = vorlagen_datei();
            if let Ok(abbild) = std::fs::read(&datei) {
                return abbild;
            }
            let pool = leerer_test_pool().await;
            migrate(&pool).await.expect("Migrationen einspielen");
            let mut conn = pool.acquire().await.expect("Vorlagen-Verbindung");
            let abbild = conn.serialize(None).await.expect("Vorlage serialisieren");
            let abbild = abbild.to_vec();
            vorlage_ablegen(&datei, &abbild);
            abbild
        })
        .await;

    let pool = leerer_test_pool().await;
    {
        let mut conn = pool.acquire().await.expect("Test-Verbindung");
        let abbild =
            sqlx::sqlite::SqliteOwnedBuf::try_from(vorlage.as_slice()).expect("Abbild kopieren");
        conn.deserialize(None, abbild, false)
            .await
            .expect("Vorlage einspielen");
    }
    pool
}

/// Wo [`test_pool`] seine Vorlage zwischen Testprozessen teilt.
///
/// Jede Datei unter `tests/` ist ein eigener Prozess, und die Migrationskette kostet im
/// Debug-Build rund zehn Sekunden: bei knapp 300 Binaries allein gut 45 Minuten der Rust-Suite,
/// die damit am 25.11.2026 über den Job-Timeout lief. Der erste Prozess legt das Abbild ab, die
/// folgenden lesen es.
///
/// Der Name hängt an allem, was das Abbild bestimmt: Version und Prüfsumme jeder eingebetteten
/// Migration sowie der Quelltext dieser Datei und des Migrationslaufs. Ändert sich eines davon,
/// entsteht eine neue Datei; eine veraltete Vorlage kann so nicht gelesen werden.
fn vorlagen_datei() -> std::path::PathBuf {
    use sha2::{Digest, Sha256};
    let mut hash = Sha256::new();
    for m in sqlx::migrate!("./migrations").iter() {
        hash.update(m.version.to_le_bytes());
        hash.update(&m.checksum);
    }
    hash.update(include_bytes!("db.rs"));
    hash.update(include_bytes!("db/migrationslauf.rs"));
    let kennung: String = hash.finalize()[..16]
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect();
    std::env::temp_dir().join(format!("lifeline-hub-testvorlage-{kennung}.sqlite"))
}

/// Legt die Vorlage atomar ab (erst schreiben, dann umbenennen): ein paralleler Prozess liest
/// die ganze Datei oder keine. Scheitert das, migriert der nächste Prozess eben selbst.
fn vorlage_ablegen(datei: &std::path::Path, abbild: &[u8]) {
    let zwischen = datei.with_extension(format!("{}.tmp", std::process::id()));
    if std::fs::write(&zwischen, abbild).is_ok() && std::fs::rename(&zwischen, datei).is_err() {
        let _ = std::fs::remove_file(&zwischen);
    }
}

/// Die leere Hülle von [`test_pool`]: eine `:memory:`-Verbindung mit Foreign Keys.
///
/// `max_connections(1)` ist tragend: jede weitere Verbindung auf `:memory:` wäre eine eigene,
/// leere Datenbank. `foreign_keys` ist eine Verbindungs-Einstellung und überlebt das Einspielen
/// des Abbilds.
async fn leerer_test_pool() -> SqlitePool {
    let options = SqliteConnectOptions::new()
        .filename(":memory:")
        .foreign_keys(true);

    SqlitePoolOptions::new()
        .max_connections(1)
        .connect_with(options)
        .await
        .expect("In-Memory-Pool")
}

/// Datei-basierter Pool mit Produktions-Parität (WAL, mehrere Verbindungen, `busy_timeout`) für
/// Nebenläufigkeits-/Locking-Tests; erst damit wird die `SQLITE_BUSY`-Fehlerklasse sichtbar.
///
/// Der `TempDir`-Guard kommt mit zurück und MUSS gehalten werden (`let (_dir, pool) = …`, nicht
/// `let (_, pool)`), sonst verschwindet die Datei mitten im Test.
///
/// Ohne `acquire_timeout`: `tx::tests::nebenlaeufige_read_then_write_ohne_lost_update` lässt
/// viele Tasks in der Pool-Queue warten, ein Timeout brächte dort nur Flakiness. Die
/// Timeout-Konfiguration prüft `connect_setzt_acquire_timeout`.
pub async fn test_pool_datei() -> (tempfile::TempDir, SqlitePool) {
    let dir = tempfile::tempdir().expect("Temp-Verzeichnis");
    let path = dir.path().join("test.db");
    let options = SqliteConnectOptions::new()
        .filename(&path)
        .create_if_missing(true)
        .journal_mode(SqliteJournalMode::Wal)
        .busy_timeout(std::time::Duration::from_secs(5))
        .foreign_keys(true)
        .pragma("secure_delete", "ON")
        .pragma("journal_size_limit", WAL_GRENZE_BYTES.to_string());

    let pool = SqlitePoolOptions::new()
        .max_connections(5)
        .connect_with(options)
        .await
        .expect("Datei-Pool");

    migrate(&pool).await.expect("Migrationen einspielen");
    (dir, pool)
}

/// Eindeutiges Daten-/Karten-Verzeichnis je Aufruf, damit per Pfad memoisierte Cache-DBs
/// (`cache_db`, `karte::tile_cache`) sich zwischen Tests nicht kontaminieren. Ohne Cleanup
/// (kleines Verzeichnis unter `temp_dir`).
pub fn test_karten_dir() -> std::path::PathBuf {
    use std::sync::atomic::{AtomicU64, Ordering};
    static N: AtomicU64 = AtomicU64::new(0);
    let n = N.fetch_add(1, Ordering::Relaxed);
    let dir = std::env::temp_dir().join(format!("lifeline-test-{}-{n}", std::process::id()));
    let _ = std::fs::create_dir_all(&dir);
    dir
}

#[cfg(test)]
mod tests;
