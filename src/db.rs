use sqlx::sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePoolOptions};
use sqlx::SqlitePool;

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

/// Spielt alle eingebetteten Migrationen aus `./migrations` ein.
pub async fn migrate(pool: &SqlitePool) -> Result<(), sqlx::migrate::MigrateError> {
    sqlx::migrate!("./migrations").run(pool).await
}

/// In-Memory-Pool für Tests (eine Verbindung, damit dieselbe DB geteilt wird), mit
/// eingespielten Migrationen.
///
/// **Migriert wird einmal je Testprozess, nicht je Test.** Der erste Aufruf migriert eine
/// Vorlage und hält sie als Abbild (`sqlite3_serialize`); jeder Aufruf spielt es per
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
            let pool = leerer_test_pool().await;
            migrate(&pool).await.expect("Migrationen einspielen");
            let mut conn = pool.acquire().await.expect("Vorlagen-Verbindung");
            let abbild = conn.serialize(None).await.expect("Vorlage serialisieren");
            abbild.to_vec()
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
mod tests {
    use super::*;
    use sqlx::Row;

    #[tokio::test]
    async fn connect_enables_wal_and_foreign_keys() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("test.db");
        let pool = connect(path.to_str().unwrap()).await.unwrap();

        let journal: String = sqlx::query("PRAGMA journal_mode;")
            .fetch_one(&pool)
            .await
            .unwrap()
            .get(0);
        assert_eq!(journal.to_lowercase(), "wal");

        let foreign_keys: i64 = sqlx::query("PRAGMA foreign_keys;")
            .fetch_one(&pool)
            .await
            .unwrap()
            .get(0);
        assert_eq!(foreign_keys, 1);
    }

    /// LFH-725: `secure_delete` ist ein Verbindungs-PRAGMA. Geprüft wird deshalb jede Verbindung,
    /// die der Pool gleichzeitig hergibt, nicht nur die erste.
    #[tokio::test]
    async fn connect_setzt_secure_delete_auf_jeder_verbindung() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("test.db");
        let pool = connect(path.to_str().unwrap()).await.unwrap();

        let mut verbindungen = Vec::new();
        for _ in 0..pool.options().get_max_connections() {
            verbindungen.push(pool.acquire().await.unwrap());
        }
        for conn in &mut verbindungen {
            let wert: i64 = sqlx::query_scalar("PRAGMA secure_delete;")
                .fetch_one(&mut **conn)
                .await
                .unwrap();
            assert_eq!(
                wert, 1,
                "secure_delete muss ON sein (1), nicht OFF (0) oder FAST (2)"
            );
        }
    }

    /// LFH-928: auch `journal_size_limit` ist ein Verbindungs-PRAGMA, deshalb jede Verbindung.
    #[tokio::test]
    async fn connect_begrenzt_den_wal_auf_jeder_verbindung() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("test.db");
        let pool = connect(path.to_str().unwrap()).await.unwrap();

        let mut verbindungen = Vec::new();
        for _ in 0..pool.options().get_max_connections() {
            verbindungen.push(pool.acquire().await.unwrap());
        }
        for conn in &mut verbindungen {
            let wert: i64 = sqlx::query_scalar("PRAGMA journal_size_limit;")
                .fetch_one(&mut **conn)
                .await
                .unwrap();
            assert_eq!(wert, WAL_GRENZE_BYTES);
        }
    }

    /// Produktionsparität: der Datei-Pool der Tests überschreibt wie `connect`.
    #[tokio::test]
    async fn test_pool_datei_setzt_secure_delete() {
        let (_dir, pool) = test_pool_datei().await;
        let wert: i64 = sqlx::query_scalar("PRAGMA secure_delete;")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(wert, 1);
    }

    #[tokio::test]
    async fn connect_setzt_acquire_timeout() {
        // Regressionsschutz für `acquire_timeout`, über den PoolOptions-Getter statt durch
        // Erschöpfen
        // des Pools geprüft.
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("test.db");
        let pool = connect(path.to_str().unwrap()).await.unwrap();

        assert_eq!(
            pool.options().get_acquire_timeout(),
            std::time::Duration::from_secs(10),
            "Produktions-Pool muss acquire_timeout explizit setzen (nicht den 30-s-Default)"
        );
    }

    /// Jede Migrationsnummer genau einmal. Parallele Branches greifen gern zur selben Nummer; beim
    /// Merge kollidiert das textuell nicht, erst beim Einspielen scheitert jeder DB-Test mit einer
    /// Meldung ohne Dateinamen. Dieser Test nennt die Kollision — aber nur im eigenen Stand; gegen
    /// den Ziel-Branch prüft `scripts/check-migrationen.sh` (LFH-658).
    #[test]
    fn migrationsnummern_sind_eindeutig() {
        let mut je_nummer: std::collections::BTreeMap<i64, Vec<String>> = Default::default();
        for m in sqlx::migrate!("./migrations").iter() {
            je_nummer
                .entry(m.version)
                .or_default()
                .push(m.description.to_string());
        }
        let doppelt: Vec<String> = je_nummer
            .iter()
            .filter(|(_, namen)| namen.len() > 1)
            .map(|(nummer, namen)| format!("{nummer:04}: {}", namen.join(", ")))
            .collect();
        assert!(
            doppelt.is_empty(),
            "Migrationsnummer mehrfach vergeben — eine davon auf die nächste freie Nummer \
             umlegen: {doppelt:?}"
        );
    }

    /// sqlx 0.9 spielt eine kleinere Version, die nach einer größeren auftaucht, still nach. Darauf
    /// ruht die Regel „anhängen, nicht einschieben“ aus `scripts/check-migrationen.sh`, die einzige
    /// Stelle, die den Einschub bemerkt. Wird sqlx hier strenger, ist dieser Test rot und die Regel
    /// neu zu bewerten.
    #[tokio::test]
    async fn sqlx_spielt_eingeschobene_kleinere_version_still_nach() {
        use sqlx::migrate::{Migration, MigrationType, Migrator};
        use sqlx::SqlSafeStr;
        use std::borrow::Cow;

        fn migration(version: i64, sql: &'static str) -> Migration {
            Migration::new(
                version,
                Cow::Borrowed("einschub"),
                MigrationType::Simple,
                sql.into_sql_str(),
                false,
            )
        }
        let v1 = migration(1, "CREATE TABLE eingeschoben (id INTEGER);");
        let v2 = migration(2, "CREATE TABLE zuerst (id INTEGER);");

        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect_with(SqliteConnectOptions::new().filename(":memory:"))
            .await
            .unwrap();

        let versionen = || async {
            sqlx::query_scalar::<_, i64>("SELECT version FROM _sqlx_migrations ORDER BY version")
                .fetch_all(&pool)
                .await
                .unwrap()
        };

        let nur_v2 = Migrator {
            migrations: Cow::Owned(vec![v2.clone()]),
            ..Migrator::DEFAULT
        };
        nur_v2.run(&pool).await.expect("v2 allein");
        assert_eq!(versionen().await, vec![2]);

        let beide = Migrator {
            migrations: Cow::Owned(vec![v1, v2]),
            ..Migrator::DEFAULT
        };
        beide
            .run(&pool)
            .await
            .expect("sqlx meldet den Einschub nicht als Fehler");

        assert_eq!(
            versionen().await,
            vec![1, 2],
            "v1 wurde nach v2 nachgespielt"
        );
        sqlx::query("SELECT id FROM eingeschoben")
            .fetch_all(&pool)
            .await
            .expect("die eingeschobene Migration ist angewendet");
    }

    /// Eine Datenbank mit allen Migrationen vor `0151` und den übergebenen Benutzernamen.
    async fn benutzer_vor_0151(namen: &[&str]) -> SqlitePool {
        use sqlx::migrate::Migrator;
        use std::borrow::Cow;

        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect_with(SqliteConnectOptions::new().filename(":memory:"))
            .await
            .unwrap();
        let vorher: Vec<_> = sqlx::migrate!("./migrations")
            .iter()
            .filter(|m| m.version < 151)
            .cloned()
            .collect();
        Migrator {
            migrations: Cow::Owned(vorher),
            ..Migrator::DEFAULT
        }
        .run(&pool)
        .await
        .expect("Migrationen vor 0151");
        sqlx::query("INSERT INTO organisation (id, name) VALUES (1, 'Orga')")
            .execute(&pool)
            .await
            .unwrap();
        for name in namen {
            sqlx::query(
                "INSERT INTO benutzer (org_id, anzeigename, benutzername, passwort_hash) \
                 VALUES (1, 'X', ?, 'h')",
            )
            .bind(name)
            .execute(&pool)
            .await
            .unwrap();
        }
        pool
    }

    /// LFH-981: Zwei Namen, die sich nur in der Schreibweise unterscheiden, brechen `0151` mit
    /// einer lesbaren Meldung ab, und keiner wird umbenannt.
    #[tokio::test]
    async fn migration_0151_bricht_bei_kollision_mit_klarer_meldung_ab() {
        let pool = benutzer_vor_0151(&["max", "Max", "moritz"]).await;

        let fehler = migrate(&pool).await.unwrap_err().to_string();
        assert!(
            fehler.contains("Benutzernamen kollidieren ohne Groß-/Kleinschreibung"),
            "Meldung muss die Kollision nennen, war: {fehler}"
        );

        let namen: Vec<String> =
            sqlx::query_scalar("SELECT benutzername FROM benutzer ORDER BY benutzername")
                .fetch_all(&pool)
                .await
                .unwrap();
        assert_eq!(namen, ["Max", "max", "moritz"], "nichts still umbenannt");
    }

    /// Ohne Kollision läuft `0151` durch, und danach ist `Max` neben `max` vergeben.
    #[tokio::test]
    async fn migration_0151_macht_namen_ohne_schreibweise_eindeutig() {
        let pool = benutzer_vor_0151(&["max", "Moritz"]).await;
        migrate(&pool)
            .await
            .expect("ohne Kollision läuft 0151 durch");

        let err = sqlx::query(
            "INSERT INTO benutzer (org_id, anzeigename, benutzername, passwort_hash) \
             VALUES (1, 'X', 'MAX', 'h')",
        )
        .execute(&pool)
        .await
        .unwrap_err();
        assert!(
            matches!(&err, sqlx::Error::Database(e) if e.is_unique_violation()),
            "MAX neben max muss die Eindeutigkeit verletzen, war: {err:?}"
        );
    }

    /// LLH-1111 (`0184`): Die Rollen-Vorgabe des Stabs wandert je Einsatz und je Organisation auf
    /// die Lagebesprechung, die Ausblendung nicht; ohne Stab-Rolle entsteht keine Zeile.
    #[tokio::test]
    async fn migration_0184_uebernimmt_nur_die_stab_rolle() {
        use sqlx::migrate::Migrator;
        use std::borrow::Cow;

        // Ohne `foreign_keys`: die Vorgaben brauchen hier keinen echten Einsatz.
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect_with(
                SqliteConnectOptions::new()
                    .filename(":memory:")
                    .foreign_keys(false),
            )
            .await
            .unwrap();
        let vorher: Vec<_> = sqlx::migrate!("./migrations")
            .iter()
            .filter(|m| m.version < 184)
            .cloned()
            .collect();
        Migrator {
            migrations: Cow::Owned(vorher),
            ..Migrator::DEFAULT
        }
        .run(&pool)
        .await
        .expect("Migrationen vor 0184");
        // Migrationen schalten Fremdschlüssel selbst wieder ein; die Vorgaben hier brauchen keinen
        // echten Einsatz und keine Organisation.
        sqlx::query("PRAGMA foreign_keys = OFF")
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query(
            "INSERT INTO einsatz_modul_override (einsatz_id, modul_key, sichtbar, benoetigte_rolle) \
             VALUES (1, 'stab', 1, 'fuehrungskraft'), (2, 'stab', 0, NULL), \
                    (3, 'stab', 0, 'admin'), (4, 'etb', 1, 'admin')",
        )
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO org_modul_einstellung (org_id, modul_key, benoetigte_rolle) \
             VALUES (1, 'stab', 'fuehrungskraft'), (2, 'stab', NULL), (3, 'etb', 'admin')",
        )
        .execute(&pool)
        .await
        .unwrap();

        // Nur bis 0184: 0185 deutet die gespeicherte `1` danach zu „erbt“ (NULL) um.
        Migrator {
            migrations: Cow::Owned(
                sqlx::migrate!("./migrations")
                    .iter()
                    .filter(|m| m.version <= 184)
                    .cloned()
                    .collect(),
            ),
            ..Migrator::DEFAULT
        }
        .run(&pool)
        .await
        .expect("0184 läuft durch");

        let einsatz: Vec<(i64, i64, Option<String>)> = sqlx::query_as(
            "SELECT einsatz_id, sichtbar, benoetigte_rolle FROM einsatz_modul_override \
             WHERE modul_key = 'lagebesprechung' ORDER BY einsatz_id",
        )
        .fetch_all(&pool)
        .await
        .unwrap();
        assert_eq!(
            einsatz,
            [
                (1, 1, Some("fuehrungskraft".to_string())),
                // Stab war ausgeblendet UND beschränkt: die Rolle wandert, sichtbar wird 1.
                (3, 1, Some("admin".to_string())),
            ]
        );
        let org: Vec<(i64, Option<String>)> = sqlx::query_as(
            "SELECT org_id, benoetigte_rolle FROM org_modul_einstellung \
             WHERE modul_key = 'lagebesprechung' ORDER BY org_id",
        )
        .fetch_all(&pool)
        .await
        .unwrap();
        assert_eq!(org, [(1, Some("fuehrungskraft".to_string()))]);
    }

    /// LLH-1179 (`0185`): Eine gespeicherte `1` im Einsatz-Override wird zu „erbt“ (`NULL`), denn
    /// bisher gab es keine Ebene darüber; eine `0` bleibt eine Ausblendung, die Rolle bleibt.
    /// Org-Vorgaben tragen danach eine leere Sichtbarkeit (= sichtbar).
    #[tokio::test]
    async fn migration_0185_macht_die_sichtbarkeit_erblich() {
        use sqlx::migrate::Migrator;
        use std::borrow::Cow;

        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect_with(
                SqliteConnectOptions::new()
                    .filename(":memory:")
                    .foreign_keys(false),
            )
            .await
            .unwrap();
        let vorher: Vec<_> = sqlx::migrate!("./migrations")
            .iter()
            .filter(|m| m.version < 185)
            .cloned()
            .collect();
        Migrator {
            migrations: Cow::Owned(vorher),
            ..Migrator::DEFAULT
        }
        .run(&pool)
        .await
        .expect("Migrationen vor 0185");
        sqlx::query("PRAGMA foreign_keys = OFF")
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query(
            "INSERT INTO einsatz_modul_override \
                (einsatz_id, modul_key, sichtbar, benoetigte_rolle, geaendert_at, geaendert_von) \
             VALUES (1, 'stab', 1, 'fuehrungskraft', '2026-10-01 10:00:00', 7), \
                    (1, 'meldungen', 0, NULL, NULL, NULL), \
                    (2, 'etb', 0, 'admin', NULL, NULL)",
        )
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO org_modul_einstellung (org_id, modul_key, benoetigte_rolle) \
             VALUES (1, 'stab', 'fuehrungskraft')",
        )
        .execute(&pool)
        .await
        .unwrap();

        // Genau bis 0185: spätere Migrationen (0186 kopiert die Stab-Rolle auf das Fernmeldewesen)
        // träfen die Vorgaben ohne echten Einsatz bei eingeschalteten Fremdschlüsseln.
        let bis: Vec<_> = sqlx::migrate!("./migrations")
            .iter()
            .filter(|m| m.version <= 185)
            .cloned()
            .collect();
        Migrator {
            migrations: Cow::Owned(bis),
            ..Migrator::DEFAULT
        }
        .run(&pool)
        .await
        .expect("0185 läuft durch");

        let einsatz: Vec<(
            i64,
            String,
            Option<i64>,
            Option<String>,
            Option<String>,
            Option<i64>,
        )> = sqlx::query_as(
            "SELECT einsatz_id, modul_key, sichtbar, benoetigte_rolle, geaendert_at, \
                        geaendert_von \
                 FROM einsatz_modul_override ORDER BY einsatz_id, modul_key",
        )
        .fetch_all(&pool)
        .await
        .unwrap();
        assert_eq!(
            einsatz,
            [
                (1, "meldungen".into(), Some(0), None, None, None),
                (
                    1,
                    "stab".into(),
                    None,
                    Some("fuehrungskraft".into()),
                    Some("2026-10-01 10:00:00".into()),
                    Some(7)
                ),
                (2, "etb".into(), Some(0), Some("admin".into()), None, None),
            ]
        );
        let org: Vec<(String, Option<i64>)> =
            sqlx::query_as("SELECT modul_key, sichtbar FROM org_modul_einstellung")
                .fetch_all(&pool)
                .await
                .unwrap();
        assert_eq!(org, [("stab".to_string(), None)]);

        // Eine neue Zeile ohne Sichtbarkeit erbt: kein DEFAULT 1 mehr. Die Migration schaltet die
        // Fremdschlüssel wieder ein; Einsatz 3 gibt es hier nicht.
        sqlx::query("PRAGMA foreign_keys = OFF")
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query(
            "INSERT INTO einsatz_modul_override (einsatz_id, modul_key, benoetigte_rolle) \
             VALUES (3, 'chat', 'admin')",
        )
        .execute(&pool)
        .await
        .unwrap();
        let neu: Option<i64> =
            sqlx::query_scalar("SELECT sichtbar FROM einsatz_modul_override WHERE einsatz_id = 3")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(neu, None);
    }

    /// LLH-1180 (`0186`): Die Rollen-Vorgabe des Stabs wandert je Einsatz und je Organisation auf
    /// das Fernmeldewesen, die Ausblendung nicht; ohne Stab-Rolle entsteht keine Zeile. Die neue
    /// Zeile erbt die Sichtbarkeit (`NULL`, LLH-1179): eine `1` überstimmte eine spätere
    /// Ausblendung durch die Organisation.
    #[tokio::test]
    async fn migration_0186_uebernimmt_nur_die_stab_rolle() {
        use sqlx::migrate::Migrator;
        use std::borrow::Cow;

        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect_with(
                SqliteConnectOptions::new()
                    .filename(":memory:")
                    .foreign_keys(false),
            )
            .await
            .unwrap();
        let vorher: Vec<_> = sqlx::migrate!("./migrations")
            .iter()
            .filter(|m| m.version < 186)
            .cloned()
            .collect();
        Migrator {
            migrations: Cow::Owned(vorher),
            ..Migrator::DEFAULT
        }
        .run(&pool)
        .await
        .expect("Migrationen vor 0186");
        // Migrationen schalten Fremdschlüssel selbst wieder ein; die Vorgaben hier brauchen keinen
        // echten Einsatz und keine Organisation.
        sqlx::query("PRAGMA foreign_keys = OFF")
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query(
            "INSERT INTO einsatz_modul_override (einsatz_id, modul_key, sichtbar, benoetigte_rolle) \
             VALUES (1, 'stab', NULL, 'fuehrungskraft'), (2, 'stab', 0, NULL), \
                    (3, 'stab', 0, 'admin'), (4, 'etb', NULL, 'admin')",
        )
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO org_modul_einstellung (org_id, modul_key, sichtbar, benoetigte_rolle) \
             VALUES (1, 'stab', NULL, 'fuehrungskraft'), (2, 'stab', 0, NULL), \
                    (3, 'etb', NULL, 'admin'), (4, 'stab', 0, 'admin')",
        )
        .execute(&pool)
        .await
        .unwrap();

        migrate(&pool).await.expect("0186 läuft durch");

        let einsatz: Vec<(i64, Option<i64>, Option<String>)> = sqlx::query_as(
            "SELECT einsatz_id, sichtbar, benoetigte_rolle FROM einsatz_modul_override \
             WHERE modul_key = 'fernmeldewesen' ORDER BY einsatz_id",
        )
        .fetch_all(&pool)
        .await
        .unwrap();
        assert_eq!(
            einsatz,
            [
                (1, None, Some("fuehrungskraft".to_string())),
                // Stab war ausgeblendet UND beschränkt: die Rolle wandert, die Sichtbarkeit erbt.
                (3, None, Some("admin".to_string())),
            ]
        );
        let org: Vec<(i64, Option<i64>, Option<String>)> = sqlx::query_as(
            "SELECT org_id, sichtbar, benoetigte_rolle FROM org_modul_einstellung \
             WHERE modul_key = 'fernmeldewesen' ORDER BY org_id",
        )
        .fetch_all(&pool)
        .await
        .unwrap();
        assert_eq!(
            org,
            [
                (1, None, Some("fuehrungskraft".to_string())),
                (4, None, Some("admin".to_string())),
            ]
        );
    }

    /// LLH-1034: `evakuierung` übernimmt jede Vorgabe von `betreuung` vollständig (Rolle und
    /// Sichtbarkeit), andere Module bleiben unberührt.
    #[tokio::test]
    async fn migration_0224_spiegelt_betreuung_auf_evakuierung() {
        use sqlx::migrate::Migrator;
        use std::borrow::Cow;

        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect_with(
                SqliteConnectOptions::new()
                    .filename(":memory:")
                    .foreign_keys(false),
            )
            .await
            .unwrap();
        let vorher: Vec<_> = sqlx::migrate!("./migrations")
            .iter()
            .filter(|m| m.version < 224)
            .cloned()
            .collect();
        Migrator {
            migrations: Cow::Owned(vorher),
            ..Migrator::DEFAULT
        }
        .run(&pool)
        .await
        .expect("Migrationen vor 0224");
        sqlx::query("PRAGMA foreign_keys = OFF")
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query(
            "INSERT INTO einsatz_modul_override (einsatz_id, modul_key, sichtbar, benoetigte_rolle) \
             VALUES (1, 'betreuung', NULL, 'fuehrungskraft'), (2, 'betreuung', 0, NULL), \
                    (3, 'betreuung', 1, 'admin'), (4, 'etb', 0, 'admin')",
        )
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO org_modul_einstellung (org_id, modul_key, sichtbar, benoetigte_rolle) \
             VALUES (1, 'betreuung', 0, NULL), (2, 'etb', NULL, 'admin'), \
                    (3, 'betreuung', NULL, 'einsatzfuehrung')",
        )
        .execute(&pool)
        .await
        .unwrap();

        migrate(&pool).await.expect("0224 läuft durch");

        let einsatz: Vec<(i64, Option<i64>, Option<String>)> = sqlx::query_as(
            "SELECT einsatz_id, sichtbar, benoetigte_rolle FROM einsatz_modul_override \
             WHERE modul_key = 'evakuierung' ORDER BY einsatz_id",
        )
        .fetch_all(&pool)
        .await
        .unwrap();
        assert_eq!(
            einsatz,
            [
                (1, None, Some("fuehrungskraft".to_string())),
                (2, Some(0), None),
                (3, Some(1), Some("admin".to_string())),
            ]
        );
        let org: Vec<(i64, Option<i64>, Option<String>)> = sqlx::query_as(
            "SELECT org_id, sichtbar, benoetigte_rolle FROM org_modul_einstellung \
             WHERE modul_key = 'evakuierung' ORDER BY org_id",
        )
        .fetch_all(&pool)
        .await
        .unwrap();
        assert_eq!(
            org,
            [
                (1, Some(0), None),
                (3, None, Some("einsatzfuehrung".to_string()))
            ]
        );
        // Die Quelle bleibt unverändert.
        let betreuung: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM einsatz_modul_override WHERE modul_key = 'betreuung'",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(betreuung, 3);
    }

    /// LLH-1053 (Migration `zeitdarstellung`): Aus „Zeitformat“ wird „Zeitdarstellung“. 24h/12h hatte nie Wirkung,
    /// deshalb fallen die Altwerte an Einsatz und Organisation auf NULL (= Vorgabe, taktisch).
    #[tokio::test]
    async fn migration_zeitdarstellung_setzt_altes_zeitformat_auf_vorgabe() {
        use sqlx::migrate::Migrator;
        use std::borrow::Cow;

        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect_with(
                SqliteConnectOptions::new()
                    .filename(":memory:")
                    .foreign_keys(false),
            )
            .await
            .unwrap();
        // Die Nummer wandert beim Umlegen (LFH-1014), deshalb über den Namen.
        let alle = sqlx::migrate!("./migrations");
        let nummer = alle
            .iter()
            .find(|m| m.description == "zeitdarstellung")
            .expect("Migration zeitdarstellung")
            .version;
        let vorher: Vec<_> = alle
            .iter()
            .filter(|m| m.version < nummer)
            .cloned()
            .collect();
        Migrator {
            migrations: Cow::Owned(vorher),
            ..Migrator::DEFAULT
        }
        .run(&pool)
        .await
        .expect("Migrationen vor zeitdarstellung");
        sqlx::query("PRAGMA foreign_keys = OFF")
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query(
            "INSERT INTO einsatz_einstellungen (einsatz_id, zeitformat, zeitzone) \
             VALUES (1, '12h', 'Europe/Berlin'), (2, NULL, NULL)",
        )
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query("INSERT INTO org_einstellungen (org_id, zeitformat) VALUES (1, '24h')")
            .execute(&pool)
            .await
            .unwrap();

        migrate(&pool).await.expect("zeitdarstellung läuft durch");

        let einsatz: Vec<(i64, Option<String>, Option<String>)> = sqlx::query_as(
            "SELECT einsatz_id, zeitdarstellung, zeitzone FROM einsatz_einstellungen \
             ORDER BY einsatz_id",
        )
        .fetch_all(&pool)
        .await
        .unwrap();
        assert_eq!(
            einsatz,
            [
                (1, None, Some("Europe/Berlin".to_string())),
                (2, None, None)
            ],
            "Altwert weg, die übrigen Konventionen bleiben"
        );
        let org: Option<String> =
            sqlx::query_scalar("SELECT zeitdarstellung FROM org_einstellungen WHERE org_id = 1")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(org, None);
    }

    /// Das Abbild in [`test_pool`] muss dieselbe Datenbank liefern wie eine frische Migration.
    /// Verglichen werden der vollständige Schema-Text (Tabellen, Indizes, Trigger, FTS-Schatten)
    /// und die Migrationsbuchhaltung.
    #[tokio::test]
    async fn test_pool_gleicht_einer_frisch_migrierten_db() {
        async fn schema(pool: &SqlitePool) -> Vec<(String, String, Option<String>)> {
            sqlx::query_as(
                "SELECT type, name, sql FROM sqlite_master \
                 WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name",
            )
            .fetch_all(pool)
            .await
            .unwrap()
        }
        async fn migrationen(pool: &SqlitePool) -> Vec<(i64, Vec<u8>)> {
            sqlx::query_as("SELECT version, checksum FROM _sqlx_migrations ORDER BY version")
                .fetch_all(pool)
                .await
                .unwrap()
        }

        let frisch = leerer_test_pool().await;
        migrate(&frisch).await.unwrap();
        let aus_vorlage = test_pool().await;

        assert_eq!(schema(&aus_vorlage).await, schema(&frisch).await);
        let m = migrationen(&aus_vorlage).await;
        assert_eq!(m, migrationen(&frisch).await);
        assert_eq!(m.len(), sqlx::migrate!("./migrations").iter().count());
    }

    /// Jeder Aufruf ist eine eigene Datenbank; geteilt wird nur das Abbild. `foreign_keys` muss das
    /// Einspielen überleben, sonst liefen alle FK-Prüfungen der Suite still ins Leere.
    #[tokio::test]
    async fn test_pool_ist_je_aufruf_isoliert_und_prueft_foreign_keys() {
        let a = test_pool().await;
        let b = test_pool().await;
        sqlx::query("INSERT INTO app_meta (key, value) VALUES ('nur_in_a', 'x')")
            .execute(&a)
            .await
            .unwrap();
        let in_b: i64 = sqlx::query_scalar("SELECT count(*) FROM app_meta WHERE key = 'nur_in_a'")
            .fetch_one(&b)
            .await
            .unwrap();
        assert_eq!(
            in_b, 0,
            "Schreiben in einen Test-Pool darf den nächsten nicht erreichen"
        );

        let fk: i64 = sqlx::query_scalar("PRAGMA foreign_keys")
            .fetch_one(&b)
            .await
            .unwrap();
        assert_eq!(fk, 1);
    }

    #[tokio::test]
    async fn migrations_create_app_meta() {
        let pool = test_pool().await;
        let value: String =
            sqlx::query_scalar("SELECT value FROM app_meta WHERE key = 'schema_initialized'")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(value, "1");
    }

    #[tokio::test]
    async fn test_pool_datei_ist_wal_und_haelt_mehrere_verbindungen() {
        // Prod-Parität: WAL an und mehr als eine Verbindung gleichzeitig — genau das kann
        // `test_pool()` nicht.
        let (_dir, pool) = test_pool_datei().await;

        let mut conn_a = pool.acquire().await.expect("erste Verbindung");
        let mut conn_b = pool
            .acquire()
            .await
            .expect("zweite Verbindung gleichzeitig");

        let journal: String = sqlx::query_scalar("PRAGMA journal_mode;")
            .fetch_one(&mut *conn_a)
            .await
            .unwrap();
        assert_eq!(journal.to_lowercase(), "wal");
        // Beide Verbindungen sind wirklich gleichzeitig nutzbar (kein max_connections(1)-Block):
        let eins: i64 = sqlx::query_scalar("SELECT 1")
            .fetch_one(&mut *conn_b)
            .await
            .unwrap();
        assert_eq!(eins, 1);
    }

    #[tokio::test]
    async fn test_pool_datei_deckt_read_then_write_busy_auf() {
        // Selbstcheck: auf der Datei-/WAL-Konfiguration wird die read-then-write-Upgrade-Kollision
        // als
        // SQLITE_BUSY sichtbar.
        let (_dir, pool) = test_pool_datei().await;
        sqlx::query("INSERT INTO organisation (id, name) VALUES (1, 'Halter')")
            .execute(&pool)
            .await
            .unwrap();

        // Writer B hält den WAL-Write-Lock (BEGIN IMMEDIATE + realer Write).
        let mut tx_b = pool.begin_with("BEGIN IMMEDIATE").await.unwrap();
        sqlx::query("UPDATE organisation SET name = 'B' WHERE id = 1")
            .execute(&mut *tx_b)
            .await
            .unwrap();

        // Reader→Writer A: deferred BEGIN, SELECT, dann Write → Upgrade unter gehaltenem Writer ⇒
        // sofortiges SQLITE_BUSY (der busy_timeout greift beim Lock-Upgrade nicht).
        let mut tx_a = pool.begin().await.unwrap();
        let _: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM organisation")
            .fetch_one(&mut *tx_a)
            .await
            .unwrap();
        let res = sqlx::query("UPDATE organisation SET name = 'A' WHERE id = 1")
            .execute(&mut *tx_a)
            .await;

        assert!(
            res.is_err(),
            "read-then-write-Upgrade unter gehaltenem Writer muss BUSY liefern, nicht still gelingen"
        );
    }

    #[tokio::test]
    async fn auth_migration_creates_tables_and_constraints() {
        let pool = test_pool().await;

        // Organisation + Benutzer anlegen funktioniert.
        sqlx::query("INSERT INTO organisation (id, name) VALUES (1, 'Test-Orga')")
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query(
            "INSERT INTO benutzer (org_id, anzeigename, benutzername, passwort_hash) \
             VALUES (1, 'Max Muster', 'max', 'hash')",
        )
        .execute(&pool)
        .await
        .unwrap();

        // Default-Rolle ist 'keiner', aktiv ist 1.
        let (rolle, aktiv): (String, i64) =
            sqlx::query_as("SELECT system_rolle, aktiv FROM benutzer WHERE benutzername = 'max'")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(rolle, "keiner");
        assert_eq!(aktiv, 1);

        // CHECK-Constraint lehnt ungültige Rolle ab.
        let bad_rolle = sqlx::query(
            "INSERT INTO benutzer (org_id, anzeigename, benutzername, passwort_hash, system_rolle) \
             VALUES (1, 'X', 'x', 'h', 'superadmin')",
        )
        .execute(&pool)
        .await;
        assert!(
            bad_rolle.is_err(),
            "ungültige system_rolle muss abgelehnt werden"
        );

        // UNIQUE-Constraint lehnt doppelten Benutzernamen ab.
        let dup = sqlx::query(
            "INSERT INTO benutzer (org_id, anzeigename, benutzername, passwort_hash) \
             VALUES (1, 'Zweiter Max', 'max', 'h')",
        )
        .execute(&pool)
        .await;
        assert!(dup.is_err(), "doppelter benutzername muss abgelehnt werden");
    }

    #[tokio::test]
    async fn einsatz_migration_creates_tables_and_constraints() {
        let pool = test_pool().await;

        // org_rolle: Default ist 'keine'.
        sqlx::query("INSERT INTO organisation (id, name) VALUES (1, 'Orga')")
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query(
            "INSERT INTO benutzer (org_id, anzeigename, benutzername, passwort_hash) \
             VALUES (1, 'Leit', 'leit', 'h')",
        )
        .execute(&pool)
        .await
        .unwrap();
        let org_rolle: String =
            sqlx::query_scalar("SELECT org_rolle FROM benutzer WHERE benutzername = 'leit'")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(org_rolle, "keine");

        // org_rolle-CHECK lehnt ungültigen Wert ab.
        let bad_org =
            sqlx::query("UPDATE benutzer SET org_rolle = 'chef' WHERE benutzername = 'leit'")
                .execute(&pool)
                .await;
        assert!(
            bad_org.is_err(),
            "ungültige org_rolle muss abgelehnt werden"
        );

        // Einsatz anlegen: status-Default ist 'aktiv'.
        let einsatz_id: i64 = sqlx::query_scalar(
            "INSERT INTO einsatz (org_id, bezeichnung) VALUES (1, 'Sturmlage') RETURNING id",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        let status: String = sqlx::query_scalar("SELECT status FROM einsatz WHERE id = ?")
            .bind(einsatz_id)
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(status, "aktiv");

        // status-CHECK lehnt ungültigen Wert ab.
        let bad_status = sqlx::query("UPDATE einsatz SET status = 'pausiert' WHERE id = ?")
            .bind(einsatz_id)
            .execute(&pool)
            .await;
        assert!(
            bad_status.is_err(),
            "ungültiger status muss abgelehnt werden"
        );

        // Mitgliedschaft anlegen + einsatz_rolle-CHECK.
        let benutzer_id: i64 =
            sqlx::query_scalar("SELECT id FROM benutzer WHERE benutzername = 'leit'")
                .fetch_one(&pool)
                .await
                .unwrap();
        sqlx::query(
            "INSERT INTO einsatz_mitgliedschaft (einsatz_id, benutzer_id, einsatz_rolle) \
             VALUES (?, ?, 'einsatzleitung')",
        )
        .bind(einsatz_id)
        .bind(benutzer_id)
        .execute(&pool)
        .await
        .unwrap();

        let bad_rolle = sqlx::query(
            "INSERT INTO einsatz_mitgliedschaft (einsatz_id, benutzer_id, einsatz_rolle) \
             VALUES (?, ?, 'haeuptling')",
        )
        .bind(einsatz_id)
        .bind(benutzer_id)
        .execute(&pool)
        .await;
        assert!(
            bad_rolle.is_err(),
            "ungültige einsatz_rolle muss abgelehnt werden"
        );

        // PK (einsatz_id, benutzer_id) verhindert Doppel-Mitgliedschaft.
        let dup = sqlx::query(
            "INSERT INTO einsatz_mitgliedschaft (einsatz_id, benutzer_id, einsatz_rolle) \
             VALUES (?, ?, 'beobachter')",
        )
        .bind(einsatz_id)
        .bind(benutzer_id)
        .execute(&pool)
        .await;
        assert!(
            dup.is_err(),
            "doppelte Mitgliedschaft muss abgelehnt werden"
        );
    }

    #[tokio::test]
    async fn einsatzdaten_migration_legt_spalten_und_unique_index_an() {
        let pool = test_pool().await;
        sqlx::query("INSERT INTO organisation (id, name) VALUES (1, 'Orga')")
            .execute(&pool)
            .await
            .unwrap();

        // einsatzart-Default ist 'realeinsatz'; angelegt_at hat den Migrations-Default '' (neue
        // Zeilen
        // bekommen den Wert erst in `repo::anlegen`).
        let id: i64 = sqlx::query_scalar(
            "INSERT INTO einsatz (org_id, bezeichnung, begonnen_at) \
             VALUES (1, 'Lage', '2026-05-23 09:00:00') RETURNING id",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        let (art, angelegt): (String, String) =
            sqlx::query_as("SELECT einsatzart, angelegt_at FROM einsatz WHERE id = ?")
                .bind(id)
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(art, "realeinsatz");
        assert_eq!(
            angelegt, "",
            "neue Zeile: angelegt_at = '' bis repo::anlegen es setzt"
        );

        // einsatzart-CHECK lehnt ungültigen Wert ab.
        let bad = sqlx::query("UPDATE einsatz SET einsatzart = 'quatsch' WHERE id = ?")
            .bind(id)
            .execute(&pool)
            .await;
        assert!(bad.is_err(), "ungültige einsatzart muss abgelehnt werden");

        // Mehrere NULL-Einsatznummern sind erlaubt (Bestand).
        sqlx::query("INSERT INTO einsatz (org_id, bezeichnung) VALUES (1, 'A'), (1, 'B')")
            .execute(&pool)
            .await
            .unwrap();

        // Erste manuelle Nummer ok, Dublette in derselben Org → Unique-Verstoß.
        sqlx::query("UPDATE einsatz SET einsatznummer_intern = '2026-001' WHERE id = ?")
            .bind(id)
            .execute(&pool)
            .await
            .unwrap();
        let dup = sqlx::query("INSERT INTO einsatz (org_id, bezeichnung, einsatznummer_intern) VALUES (1, 'C', '2026-001')")
            .execute(&pool)
            .await;
        assert!(
            dup.is_err(),
            "doppelte Einsatznummer je Org muss abgelehnt werden"
        );
    }

    #[tokio::test]
    async fn etb_migration_legt_tabelle_und_fts_an() {
        let pool = test_pool().await;

        // Org + Benutzer + Einsatz als Voraussetzung anlegen.
        sqlx::query("INSERT INTO organisation (id, name) VALUES (1, 'Orga')")
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query(
            "INSERT INTO benutzer (org_id, anzeigename, benutzername, passwort_hash) \
             VALUES (1, 'Leit', 'leit', 'h')",
        )
        .execute(&pool)
        .await
        .unwrap();
        let einsatz_id: i64 = sqlx::query_scalar(
            "INSERT INTO einsatz (org_id, bezeichnung) VALUES (1, 'Lage') RETURNING id",
        )
        .fetch_one(&pool)
        .await
        .unwrap();

        // Eintrag einfügen (ereigniszeit Pflicht, received_at Default).
        sqlx::query(
            "INSERT INTO etb_eintrag (einsatz_id, lfd_nr, typ, inhalt, erfasser_id, ereigniszeit) \
             VALUES (?, 1, 'meldung', 'Deich bei km 12 instabil', 1, '2026-05-23 10:00:00')",
        )
        .bind(einsatz_id)
        .execute(&pool)
        .await
        .unwrap();

        // received_at wurde per Default gesetzt.
        let received: String =
            sqlx::query_scalar("SELECT received_at FROM etb_eintrag WHERE lfd_nr = 1")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert!(!received.is_empty());

        // typ-CHECK lehnt ungültigen Wert ab.
        let bad_typ = sqlx::query(
            "INSERT INTO etb_eintrag (einsatz_id, lfd_nr, typ, inhalt, erfasser_id, ereigniszeit) \
             VALUES (?, 2, 'geschwafel', 'x', 1, '2026-05-23 10:00:00')",
        )
        .bind(einsatz_id)
        .execute(&pool)
        .await;
        assert!(bad_typ.is_err(), "ungültiger typ muss abgelehnt werden");

        // UNIQUE(einsatz_id, lfd_nr) verhindert doppelte lfd_nr.
        let dup = sqlx::query(
            "INSERT INTO etb_eintrag (einsatz_id, lfd_nr, typ, inhalt, erfasser_id, ereigniszeit) \
             VALUES (?, 1, 'lage', 'y', 1, '2026-05-23 10:00:00')",
        )
        .bind(einsatz_id)
        .execute(&pool)
        .await;
        assert!(dup.is_err(), "doppelte lfd_nr muss abgelehnt werden");

        // FTS5-Trigger hat den Eintrag indiziert: Volltextsuche findet ihn.
        let treffer: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM etb_eintrag_fts WHERE etb_eintrag_fts MATCH 'Deich'",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(treffer, 1, "FTS5-Trigger muss den Eintrag indizieren");
    }

    #[tokio::test]
    async fn etb_client_id_migration_partieller_unique() {
        // client_id trägt die Offline-Idempotenz. Der UNIQUE-Index ist partiell (`WHERE client_id
        // IS
        // NOT NULL`), damit die vielen NULL-Einträge nicht kollidieren.
        let pool = test_pool().await;
        sqlx::query("INSERT INTO organisation (id, name) VALUES (1, 'Orga')")
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query(
            "INSERT INTO benutzer (org_id, anzeigename, benutzername, passwort_hash) \
             VALUES (1, 'Leit', 'leit', 'h')",
        )
        .execute(&pool)
        .await
        .unwrap();
        let e1: i64 = sqlx::query_scalar(
            "INSERT INTO einsatz (org_id, bezeichnung) VALUES (1, 'A') RETURNING id",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        let e2: i64 = sqlx::query_scalar(
            "INSERT INTO einsatz (org_id, bezeichnung) VALUES (1, 'B') RETURNING id",
        )
        .fetch_one(&pool)
        .await
        .unwrap();

        async fn ins(
            pool: &SqlitePool,
            einsatz_id: i64,
            lfd_nr: i64,
            client_id: Option<&str>,
        ) -> Result<(), sqlx::Error> {
            sqlx::query(
                "INSERT INTO etb_eintrag (einsatz_id, lfd_nr, typ, inhalt, erfasser_id, ereigniszeit, client_id) \
                 VALUES (?, ?, 'meldung', 'x', 1, '2026-05-23 10:00:00', ?)",
            )
            .bind(einsatz_id)
            .bind(lfd_nr)
            .bind(client_id)
            .execute(pool)
            .await
            .map(|_| ())
        }

        // (a) client_id ist speicherbar.
        ins(&pool, e1, 1, Some("u1")).await.unwrap();
        // (b) gleiche (einsatz_id, client_id) → UNIQUE-Verletzung (Idempotenz-Backstop).
        assert!(
            ins(&pool, e1, 2, Some("u1")).await.is_err(),
            "doppelte client_id im selben Einsatz muss abgelehnt werden"
        );
        // (c) NULL kollidiert nie (partieller Index nimmt NULL aus).
        ins(&pool, e1, 3, None).await.unwrap();
        ins(&pool, e1, 4, None).await.unwrap();
        // (d) dieselbe client_id in einem ANDEREN Einsatz ist erlaubt (per-Einsatz-eindeutig).
        ins(&pool, e2, 1, Some("u1")).await.unwrap();
    }

    #[tokio::test]
    async fn betreuung_client_id_migration_partieller_unique() {
        // Stand- und Belegungsmeldungen tragen denselben Idempotenzschlüssel — je Meldereihe
        // eindeutig
        // pro Einsatz, NULL beliebig oft.
        let pool = test_pool().await;
        sqlx::query("INSERT INTO organisation (id, name) VALUES (1, 'Orga')")
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query(
            "INSERT INTO benutzer (id, org_id, anzeigename, benutzername, passwort_hash) \
             VALUES (1, 1, 'Leit', 'leit', 'h')",
        )
        .execute(&pool)
        .await
        .unwrap();
        let mut einsaetze = Vec::new();
        for name in ["A", "B"] {
            let e: i64 = sqlx::query_scalar(
                "INSERT INTO einsatz (org_id, bezeichnung) VALUES (1, ?) RETURNING id",
            )
            .bind(name)
            .fetch_one(&pool)
            .await
            .unwrap();
            let etb: i64 = sqlx::query_scalar(
                "INSERT INTO etb_eintrag (einsatz_id, lfd_nr, typ, inhalt, erfasser_id, ereigniszeit) \
                 VALUES (?, 1, 'meldung', 'x', 1, '2026-09-24 10:00:00') RETURNING id",
            )
            .bind(e)
            .fetch_one(&pool)
            .await
            .unwrap();
            let bezirk: i64 = sqlx::query_scalar(
                "INSERT INTO evakuierungsbezirk \
                    (einsatz_id, bezeichnung, plan_personen, plan_erhebung, angelegt_von_id) \
                 VALUES (?, 'Uferstraße', 100, 'gezaehlt', 1) RETURNING id",
            )
            .bind(e)
            .fetch_one(&pool)
            .await
            .unwrap();
            let stelle: i64 = sqlx::query_scalar(
                "INSERT INTO betreuungsstelle (einsatz_id, bezeichnung, art, angelegt_von_id) \
                 VALUES (?, 'Turnhalle', 'betreuungsstelle', 1) RETURNING id",
            )
            .bind(e)
            .fetch_one(&pool)
            .await
            .unwrap();
            einsaetze.push((e, etb, bezirk, stelle));
        }

        async fn stand(
            pool: &SqlitePool,
            (e, etb, bezirk, _): (i64, i64, i64, i64),
            client_id: Option<&str>,
        ) -> Result<(), sqlx::Error> {
            sqlx::query(
                "INSERT INTO evakuierung_stand (bezirk_id, einsatz_id, evakuiert, erhebung, \
                    zeitpunkt_at, erfasst_von_id, etb_eintrag_id, client_id) \
                 VALUES (?, ?, 5, 'gezaehlt', '2026-09-24 10:00:00', 1, ?, ?)",
            )
            .bind(bezirk)
            .bind(e)
            .bind(etb)
            .bind(client_id)
            .execute(pool)
            .await
            .map(|_| ())
        }
        async fn belegung(
            pool: &SqlitePool,
            (e, etb, _, stelle): (i64, i64, i64, i64),
            client_id: Option<&str>,
        ) -> Result<(), sqlx::Error> {
            sqlx::query(
                "INSERT INTO betreuungsstelle_belegung (stelle_id, einsatz_id, belegt, \
                    zeitpunkt_at, erfasst_von_id, etb_eintrag_id, client_id) \
                 VALUES (?, ?, 5, '2026-09-24 10:00:00', 1, ?, ?)",
            )
            .bind(stelle)
            .bind(e)
            .bind(etb)
            .bind(client_id)
            .execute(pool)
            .await
            .map(|_| ())
        }

        let (a, b) = (einsaetze[0], einsaetze[1]);
        stand(&pool, a, Some("s1")).await.unwrap();
        assert!(
            stand(&pool, a, Some("s1")).await.is_err(),
            "Stand-Dublette im Einsatz"
        );
        stand(&pool, a, None).await.unwrap();
        stand(&pool, a, None).await.unwrap();
        stand(&pool, b, Some("s1")).await.unwrap();

        belegung(&pool, a, Some("b1")).await.unwrap();
        assert!(
            belegung(&pool, a, Some("b1")).await.is_err(),
            "Belegungs-Dublette im Einsatz"
        );
        belegung(&pool, a, None).await.unwrap();
        belegung(&pool, a, None).await.unwrap();
        belegung(&pool, b, Some("b1")).await.unwrap();
        // Getrennte Reihen, getrennte Indizes: derselbe Schlüssel in der anderen Reihe kollidiert nicht.
        belegung(&pool, a, Some("s1")).await.unwrap();
    }

    #[tokio::test]
    async fn verpflegung_ausgabe_client_id_migration_partieller_unique() {
        // LFH-688: Ausgaben tragen den Idempotenzschlüssel je Einsatz, nicht je Zeitfenster
        // (design.md D1) — NULL beliebig oft.
        let pool = test_pool().await;
        sqlx::query("INSERT INTO organisation (id, name) VALUES (1, 'Orga')")
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query(
            "INSERT INTO benutzer (id, org_id, anzeigename, benutzername, passwort_hash) \
             VALUES (1, 1, 'Leit', 'leit', 'h')",
        )
        .execute(&pool)
        .await
        .unwrap();
        let mut fenster = Vec::new();
        for name in ["A", "A", "B"] {
            let e: i64 = match fenster.last() {
                Some(&(e, _)) if name == "A" => e,
                _ => sqlx::query_scalar(
                    "INSERT INTO einsatz (org_id, bezeichnung) VALUES (1, ?) RETURNING id",
                )
                .bind(name)
                .fetch_one(&pool)
                .await
                .unwrap(),
            };
            let zf: i64 = sqlx::query_scalar(
                "INSERT INTO verpflegung_zeitfenster (einsatz_id, bezeichnung, von_at, bis_at, \
                    bedarf_kraefte, bedarf_betreute, bedarf_weitere, angelegt_von_id) \
                 VALUES (?, 'Mittag', '2026-09-24 12:00:00', '2026-09-24 13:00:00', 10, 0, 0, 1) \
                 RETURNING id",
            )
            .bind(e)
            .fetch_one(&pool)
            .await
            .unwrap();
            fenster.push((e, zf));
        }

        async fn ausgabe(
            pool: &SqlitePool,
            (e, zf): (i64, i64),
            client_id: Option<&str>,
        ) -> Result<(), sqlx::Error> {
            sqlx::query(
                "INSERT INTO verpflegung_ausgabe (einsatz_id, zeitfenster_id, zeitpunkt_at, \
                    menge, erfasst_von_id, client_id) \
                 VALUES (?, ?, '2026-09-24 12:10:00', 5, 1, ?)",
            )
            .bind(e)
            .bind(zf)
            .bind(client_id)
            .execute(pool)
            .await
            .map(|_| ())
        }

        let (mittag_a, abend_a, mittag_b) = (fenster[0], fenster[1], fenster[2]);
        assert_eq!(mittag_a.0, abend_a.0, "zwei Zeitfenster im selben Einsatz");
        ausgabe(&pool, mittag_a, Some("v1")).await.unwrap();
        assert!(
            ausgabe(&pool, mittag_a, Some("v1")).await.is_err(),
            "Dublette im selben Zeitfenster"
        );
        assert!(
            ausgabe(&pool, abend_a, Some("v1")).await.is_err(),
            "Schlüssel gilt je Einsatz, auch über Zeitfenster hinweg"
        );
        ausgabe(&pool, mittag_a, None).await.unwrap();
        ausgabe(&pool, mittag_a, None).await.unwrap();
        ausgabe(&pool, mittag_b, Some("v1")).await.unwrap();
    }

    #[tokio::test]
    async fn etb_fts_wird_bei_cascade_delete_bereinigt() {
        let pool = test_pool().await;
        sqlx::query("INSERT INTO organisation (id, name) VALUES (1, 'Orga')")
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query(
            "INSERT INTO benutzer (org_id, anzeigename, benutzername, passwort_hash) \
             VALUES (1, 'Leit', 'leit', 'h')",
        )
        .execute(&pool)
        .await
        .unwrap();
        let einsatz_id: i64 = sqlx::query_scalar(
            "INSERT INTO einsatz (org_id, bezeichnung) VALUES (1, 'Lage') RETURNING id",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO etb_eintrag (einsatz_id, lfd_nr, typ, inhalt, erfasser_id, ereigniszeit) \
             VALUES (?, 1, 'meldung', 'Sandsack-Nachschub', 1, '2026-05-23 10:00:00')",
        )
        .bind(einsatz_id)
        .execute(&pool)
        .await
        .unwrap();

        // Einsatz löschen → CASCADE entfernt den Eintrag; AFTER DELETE-Trigger bereinigt FTS.
        sqlx::query("DELETE FROM einsatz WHERE id = ?")
            .bind(einsatz_id)
            .execute(&pool)
            .await
            .unwrap();

        let treffer: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM etb_eintrag_fts WHERE etb_eintrag_fts MATCH 'Sandsack'",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(
            treffer, 0,
            "FTS-Index muss nach Cascade-Delete bereinigt sein"
        );
    }

    #[tokio::test]
    async fn stichwort_vorschlag_migration_legt_tabelle_mit_unique_an() {
        let pool = test_pool().await;
        sqlx::query("INSERT INTO organisation (id, name) VALUES (1, 'Orga')")
            .execute(&pool)
            .await
            .unwrap();

        sqlx::query("INSERT INTO einsatz_stichwort_vorschlag (org_id, text) VALUES (1, 'H1')")
            .execute(&pool)
            .await
            .unwrap();

        // UNIQUE(org_id, text): Dublette je Org abgelehnt.
        let dup =
            sqlx::query("INSERT INTO einsatz_stichwort_vorschlag (org_id, text) VALUES (1, 'H1')")
                .execute(&pool)
                .await;
        assert!(
            dup.is_err(),
            "doppeltes Stichwort je Org muss abgelehnt werden"
        );

        // sortier-Default ist 0.
        let sortier: i64 =
            sqlx::query_scalar("SELECT sortier FROM einsatz_stichwort_vorschlag WHERE text = 'H1'")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(sortier, 0);
    }

    #[tokio::test]
    async fn fahrzeug_migration_constraints() {
        let pool = test_pool().await;
        sqlx::query("INSERT INTO organisation (id, name) VALUES (1, 'Orga')")
            .execute(&pool)
            .await
            .unwrap();

        // dienststatus-Default ist 'in_dienst'.
        let id: i64 = sqlx::query_scalar(
            "INSERT INTO fahrzeug (org_id, funkrufname) VALUES (1, 'Florian 1') RETURNING id",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        let (status, signal): (String, i64) =
            sqlx::query_as("SELECT dienststatus, sondersignal FROM fahrzeug WHERE id = ?")
                .bind(id)
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(status, "in_dienst");
        assert_eq!(signal, 0);

        // dienststatus-CHECK lehnt ungültigen Wert ab.
        let bad = sqlx::query("UPDATE fahrzeug SET dienststatus = 'kaputt' WHERE id = ?")
            .bind(id)
            .execute(&pool)
            .await;
        assert!(
            bad.is_err(),
            "ungültiger dienststatus muss abgelehnt werden"
        );

        // Partieller Unique-Index: doppelter Funkrufname unter aktiven verboten.
        let dup = sqlx::query("INSERT INTO fahrzeug (org_id, funkrufname) VALUES (1, 'Florian 1')")
            .execute(&pool)
            .await;
        assert!(
            dup.is_err(),
            "doppelter aktiver Funkrufname je Org muss abgelehnt werden"
        );

        // Außer Dienst gestellt → Name wieder frei.
        sqlx::query("UPDATE fahrzeug SET dienststatus = 'ausser_dienst' WHERE id = ?")
            .bind(id)
            .execute(&pool)
            .await
            .unwrap();
        let wieder =
            sqlx::query("INSERT INTO fahrzeug (org_id, funkrufname) VALUES (1, 'Florian 1')")
                .execute(&pool)
                .await;
        assert!(
            wieder.is_ok(),
            "Name eines außer Dienst gestellten Fahrzeugs muss frei sein"
        );
    }

    #[tokio::test]
    async fn fahrzeug_status_migration_constraints_und_seed() {
        let pool = test_pool().await;
        // Org nach der Migration angelegt → der Migrations-Seed greift nicht (neue Orgs seedet
        // `bootstrap_admin`).
        sqlx::query("INSERT INTO organisation (id, name) VALUES (1, 'Orga')")
            .execute(&pool)
            .await
            .unwrap();

        // kategorie-CHECK.
        let bad_kat = sqlx::query(
            "INSERT INTO fahrzeug_status (org_id, label, kategorie) VALUES (1, 'X', 'quatsch')",
        )
        .execute(&pool)
        .await;
        assert!(
            bad_kat.is_err(),
            "ungültige kategorie muss abgelehnt werden"
        );

        // fms_anker-CHECK (0..=9).
        let bad_fms = sqlx::query(
            "INSERT INTO fahrzeug_status (org_id, label, kategorie, fms_anker) VALUES (1, 'Y', 'gebunden', 12)",
        )
        .execute(&pool)
        .await;
        assert!(
            bad_fms.is_err(),
            "fms_anker außerhalb 0..=9 muss abgelehnt werden"
        );

        // aktiv-Default ist 1, sortier-Default 0.
        sqlx::query("INSERT INTO fahrzeug_status (org_id, label, kategorie) VALUES (1, 'frei', 'verfuegbar')")
            .execute(&pool)
            .await
            .unwrap();
        let (aktiv, sortier): (i64, i64) =
            sqlx::query_as("SELECT aktiv, sortier FROM fahrzeug_status WHERE label = 'frei'")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(aktiv, 1);
        assert_eq!(sortier, 0);

        // UNIQUE(org_id, label).
        let dup = sqlx::query(
            "INSERT INTO fahrzeug_status (org_id, label, kategorie) VALUES (1, 'frei', 'gebunden')",
        )
        .execute(&pool)
        .await;
        assert!(dup.is_err(), "doppeltes label je Org muss abgelehnt werden");
    }

    #[tokio::test]
    async fn einsatz_fahrzeug_migration_constraints() {
        let pool = test_pool().await;
        sqlx::query("INSERT INTO organisation (id, name) VALUES (1, 'Orga')")
            .execute(&pool)
            .await
            .unwrap();
        let einsatz: i64 = sqlx::query_scalar(
            "INSERT INTO einsatz (org_id, bezeichnung) VALUES (1, 'Lage') RETURNING id",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        let fz: i64 = sqlx::query_scalar(
            "INSERT INTO fahrzeug (org_id, funkrufname) VALUES (1, 'Florian 1') RETURNING id",
        )
        .fetch_one(&pool)
        .await
        .unwrap();

        // Stamm-Disposition.
        sqlx::query(
            "INSERT INTO einsatz_fahrzeug (einsatz_id, fahrzeug_id, snap_funkrufname) \
             VALUES (?, ?, 'Florian 1')",
        )
        .bind(einsatz)
        .bind(fz)
        .execute(&pool)
        .await
        .unwrap();

        // UNIQUE(einsatz_id, fahrzeug_id): dasselbe Stamm-Fahrzeug nicht doppelt.
        let dup = sqlx::query(
            "INSERT INTO einsatz_fahrzeug (einsatz_id, fahrzeug_id, snap_funkrufname) \
             VALUES (?, ?, 'Florian 1')",
        )
        .bind(einsatz)
        .bind(fz)
        .execute(&pool)
        .await;
        assert!(
            dup.is_err(),
            "dasselbe Stamm-Fahrzeug doppelt im Einsatz muss abgelehnt werden"
        );

        // Mehrere Ad-hoc (fahrzeug_id NULL) erlaubt — NULL ist in SQLite-UNIQUE verschieden.
        sqlx::query(
            "INSERT INTO einsatz_fahrzeug (einsatz_id, snap_funkrufname) VALUES (?, 'FW Extern 1')",
        )
        .bind(einsatz)
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO einsatz_fahrzeug (einsatz_id, snap_funkrufname) VALUES (?, 'FW Extern 2')",
        )
        .bind(einsatz)
        .execute(&pool)
        .await
        .unwrap();
        let anzahl: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM einsatz_fahrzeug WHERE einsatz_id = ?")
                .bind(einsatz)
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(anzahl, 3, "1 Stamm + 2 Ad-hoc");

        // Einsatz löschen → CASCADE entfernt die Dispositionszeilen.
        sqlx::query("DELETE FROM einsatz WHERE id = ?")
            .bind(einsatz)
            .execute(&pool)
            .await
            .unwrap();
        let rest: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM einsatz_fahrzeug")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(rest, 0, "CASCADE muss Dispositionszeilen entfernen");
    }

    #[tokio::test]
    async fn einsatzabschnitt_migration_legt_tabelle_und_cascade_an() {
        let pool = test_pool().await;
        sqlx::query("INSERT INTO organisation (id, name) VALUES (1, 'Orga')")
            .execute(&pool)
            .await
            .unwrap();
        let einsatz: i64 = sqlx::query_scalar(
            "INSERT INTO einsatz (org_id, bezeichnung) VALUES (1, 'Lage') RETURNING id",
        )
        .fetch_one(&pool)
        .await
        .unwrap();

        // Oberste Ebene + Unterabschnitt.
        let oben: i64 = sqlx::query_scalar(
            "INSERT INTO einsatzabschnitt (einsatz_id, name) VALUES (?, 'Nord') RETURNING id",
        )
        .bind(einsatz)
        .fetch_one(&pool)
        .await
        .unwrap();
        sqlx::query("INSERT INTO einsatzabschnitt (einsatz_id, ueber_abschnitt_id, name) VALUES (?, ?, 'Nord-1')")
            .bind(einsatz).bind(oben).execute(&pool).await.unwrap();

        // sortier-Default 0, angelegt_at gesetzt.
        let (sortier, angelegt): (i64, String) =
            sqlx::query_as("SELECT sortier, angelegt_at FROM einsatzabschnitt WHERE name = 'Nord'")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(sortier, 0);
        assert!(!angelegt.is_empty());

        // CASCADE: Einsatz löschen entfernt die Abschnitte.
        sqlx::query("DELETE FROM einsatz WHERE id = ?")
            .bind(einsatz)
            .execute(&pool)
            .await
            .unwrap();
        let rest: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM einsatzabschnitt")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(rest, 0, "CASCADE muss Abschnitte entfernen");
    }

    #[tokio::test]
    async fn einheit_typ_migration_constraints_und_nullable_soll() {
        let pool = test_pool().await;
        // Org nach der Migration → der Migrations-Seed greift nicht.
        sqlx::query("INSERT INTO organisation (id, name) VALUES (1, 'Orga')")
            .execute(&pool)
            .await
            .unwrap();

        // Soll vollständig.
        sqlx::query("INSERT INTO einheit_typ (org_id, label, soll_fuehrer, soll_unterfuehrer, soll_mannschaft) VALUES (1, 'Zug', 1, 3, 18)")
            .execute(&pool).await.unwrap();
        // Soll komplett NULL (z. B. Sonstige).
        sqlx::query("INSERT INTO einheit_typ (org_id, label) VALUES (1, 'Sonstige')")
            .execute(&pool)
            .await
            .unwrap();
        let (aktiv, sortier): (i64, i64) =
            sqlx::query_as("SELECT aktiv, sortier FROM einheit_typ WHERE label = 'Sonstige'")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(
            (aktiv, sortier),
            (1, 0),
            "aktiv-Default 1, sortier-Default 0"
        );

        // UNIQUE(org_id, label).
        let dup = sqlx::query("INSERT INTO einheit_typ (org_id, label) VALUES (1, 'Zug')")
            .execute(&pool)
            .await;
        assert!(dup.is_err(), "doppeltes label je Org muss abgelehnt werden");
    }

    #[tokio::test]
    async fn einsatz_einheit_migration_referenzen_und_cascade() {
        let pool = test_pool().await;
        sqlx::query("INSERT INTO organisation (id, name) VALUES (1, 'Orga')")
            .execute(&pool)
            .await
            .unwrap();
        let einsatz: i64 = sqlx::query_scalar(
            "INSERT INTO einsatz (org_id, bezeichnung) VALUES (1, 'Lage') RETURNING id",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        let typ: i64 = sqlx::query_scalar(
            "INSERT INTO einheit_typ (org_id, label) VALUES (1, 'Zug') RETURNING id",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        let abschnitt: i64 = sqlx::query_scalar(
            "INSERT INTO einsatzabschnitt (einsatz_id, name) VALUES (?, 'Nord') RETURNING id",
        )
        .bind(einsatz)
        .fetch_one(&pool)
        .await
        .unwrap();

        // Einheit mit beiden Referenzen + Selbstreferenz (Unter-Einheit).
        let zug: i64 = sqlx::query_scalar(
            "INSERT INTO einsatz_einheit (einsatz_id, abschnitt_id, typ_id, name) VALUES (?, ?, ?, '1. Zug') RETURNING id",
        ).bind(einsatz).bind(abschnitt).bind(typ).fetch_one(&pool).await.unwrap();
        sqlx::query("INSERT INTO einsatz_einheit (einsatz_id, ueber_einheit_id, name) VALUES (?, ?, 'Gruppe Florian 1')")
            .bind(einsatz).bind(zug).execute(&pool).await.unwrap();

        let (sortier, angelegt): (i64, String) = sqlx::query_as(
            "SELECT sortier, angelegt_at FROM einsatz_einheit WHERE name = '1. Zug'",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(sortier, 0);
        assert!(!angelegt.is_empty());

        // CASCADE über Einsatz.
        sqlx::query("DELETE FROM einsatz WHERE id = ?")
            .bind(einsatz)
            .execute(&pool)
            .await
            .unwrap();
        let rest: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM einsatz_einheit")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(rest, 0, "CASCADE muss Einheiten entfernen");
    }

    #[tokio::test]
    async fn einheit_mitgliedschaft_migration_fk_spalte_default_null() {
        let pool = test_pool().await;
        sqlx::query("INSERT INTO organisation (id, name) VALUES (1, 'Orga')")
            .execute(&pool)
            .await
            .unwrap();
        let einsatz: i64 = sqlx::query_scalar(
            "INSERT INTO einsatz (org_id, bezeichnung) VALUES (1, 'Lage') RETURNING id",
        )
        .fetch_one(&pool)
        .await
        .unwrap();

        // Neue Dispozeile: einheit_id ist standardmäßig NULL (freie Kraft).
        let ep: i64 = sqlx::query_scalar(
            "INSERT INTO einsatz_personal (einsatz_id, snap_name) VALUES (?, 'Extern') RETURNING id",
        ).bind(einsatz).fetch_one(&pool).await.unwrap();
        let einheit_id: Option<i64> =
            sqlx::query_scalar("SELECT einheit_id FROM einsatz_personal WHERE id = ?")
                .bind(ep)
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(einheit_id, None);

        // Zuordnen auf eine Einheit funktioniert.
        let einheit: i64 = sqlx::query_scalar(
            "INSERT INTO einsatz_einheit (einsatz_id, name) VALUES (?, 'Trupp') RETURNING id",
        )
        .bind(einsatz)
        .fetch_one(&pool)
        .await
        .unwrap();
        sqlx::query("UPDATE einsatz_personal SET einheit_id = ? WHERE id = ?")
            .bind(einheit)
            .bind(ep)
            .execute(&pool)
            .await
            .unwrap();

        // Auch an einsatz_fahrzeug existiert die Spalte.
        let ef: i64 = sqlx::query_scalar(
            "INSERT INTO einsatz_fahrzeug (einsatz_id, snap_funkrufname) VALUES (?, 'Florian 1') RETURNING id",
        ).bind(einsatz).fetch_one(&pool).await.unwrap();
        sqlx::query("UPDATE einsatz_fahrzeug SET einheit_id = ? WHERE id = ?")
            .bind(einheit)
            .bind(ef)
            .execute(&pool)
            .await
            .unwrap();
        let zuordnung: Option<i64> =
            sqlx::query_scalar("SELECT einheit_id FROM einsatz_fahrzeug WHERE id = ?")
                .bind(ef)
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(zuordnung, Some(einheit));
    }

    #[tokio::test]
    async fn migration_0010_bis_0013_legen_personal_schema_an() {
        let pool = test_pool().await;
        // Tabellen existieren (leeres SELECT wirft nicht).
        for tabelle in [
            "personal",
            "qualifikation",
            "personal_qualifikation",
            "personal_status",
            "einsatz_personal",
        ] {
            let sql = format!("SELECT COUNT(*) FROM {tabelle}");
            let n: i64 = sqlx::query_scalar(sqlx::AssertSqlSafe(&*sql))
                .fetch_one(&pool)
                .await
                .unwrap();
            assert_eq!(n, 0, "{tabelle} startet leer (keine Org auf test_pool)");
        }
    }

    #[tokio::test]
    async fn qualifikation_und_personal_status_schema_akzeptiert_einfuegungen() {
        let pool = test_pool().await;
        // Org nach den Migrationen → der Seed greift nicht; geprüft wird nur, dass ein manuell
        // geseedeter Eintrag einfügbar ist.
        sqlx::query("INSERT INTO organisation (id, name) VALUES (1, 'Orga')")
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query(
            "INSERT INTO qualifikation (org_id, label, sortier) VALUES (1, 'Sanitäter', 10)",
        )
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query("INSERT INTO personal_status (org_id, label, kategorie, sortier) VALUES (1, 'verfügbar', 'verfuegbar', 10)")
            .execute(&pool).await.unwrap();
        let q: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM qualifikation WHERE org_id = 1")
            .fetch_one(&pool)
            .await
            .unwrap();
        let s: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM personal_status WHERE org_id = 1")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!((q, s), (1, 1));
    }

    #[tokio::test]
    async fn personal_schema_constraints() {
        let pool = test_pool().await;
        sqlx::query("INSERT INTO organisation (id, name) VALUES (1, 'Orga')")
            .execute(&pool)
            .await
            .unwrap();

        // Partieller Unique-Index idx_personal_personalnummer: gleiche Personalnummer
        // je Org unter aktiven (in_dienst) Personen verboten.
        let p1: i64 = sqlx::query_scalar(
            "INSERT INTO personal (org_id, name, personalnummer) VALUES (1, 'Anna', 'P-100') RETURNING id",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        let dup = sqlx::query(
            "INSERT INTO personal (org_id, name, personalnummer) VALUES (1, 'Bert', 'P-100')",
        )
        .execute(&pool)
        .await;
        assert!(
            dup.is_err(),
            "doppelte aktive Personalnummer je Org muss abgelehnt werden"
        );

        // Außer Dienst gestellt → Nummer wieder frei.
        sqlx::query("UPDATE personal SET dienststatus = 'ausser_dienst' WHERE id = ?")
            .bind(p1)
            .execute(&pool)
            .await
            .unwrap();
        let wieder = sqlx::query(
            "INSERT INTO personal (org_id, name, personalnummer) VALUES (1, 'Cara', 'P-100')",
        )
        .execute(&pool)
        .await;
        assert!(
            wieder.is_ok(),
            "Nummer einer außer Dienst gestellten Person muss frei sein"
        );

        // Einsatz als Voraussetzung für einsatz_personal.
        let einsatz: i64 = sqlx::query_scalar(
            "INSERT INTO einsatz (org_id, bezeichnung) VALUES (1, 'Lage') RETURNING id",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        let person: i64 = sqlx::query_scalar(
            "INSERT INTO personal (org_id, name) VALUES (1, 'Dora') RETURNING id",
        )
        .fetch_one(&pool)
        .await
        .unwrap();

        // Stamm-Person disponieren.
        sqlx::query(
            "INSERT INTO einsatz_personal (einsatz_id, personal_id, snap_name) VALUES (?, ?, 'Dora')",
        )
        .bind(einsatz)
        .bind(person)
        .execute(&pool)
        .await
        .unwrap();

        // UNIQUE(einsatz_id, personal_id): dieselbe Stamm-Person nicht doppelt.
        let dup = sqlx::query(
            "INSERT INTO einsatz_personal (einsatz_id, personal_id, snap_name) VALUES (?, ?, 'Dora')",
        )
        .bind(einsatz)
        .bind(person)
        .execute(&pool)
        .await;
        assert!(
            dup.is_err(),
            "dieselbe Stamm-Person doppelt im Einsatz muss abgelehnt werden"
        );

        // Mehrere Ad-hoc (personal_id NULL) erlaubt — NULL ist in SQLite-UNIQUE verschieden.
        sqlx::query("INSERT INTO einsatz_personal (einsatz_id, snap_name) VALUES (?, 'Extern 1')")
            .bind(einsatz)
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query("INSERT INTO einsatz_personal (einsatz_id, snap_name) VALUES (?, 'Extern 2')")
            .bind(einsatz)
            .execute(&pool)
            .await
            .unwrap();
        let anzahl: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM einsatz_personal WHERE einsatz_id = ?")
                .bind(einsatz)
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(anzahl, 3, "1 Stamm + 2 Ad-hoc");

        // Einsatz löschen → CASCADE entfernt die Dispositionszeilen.
        sqlx::query("DELETE FROM einsatz WHERE id = ?")
            .bind(einsatz)
            .execute(&pool)
            .await
            .unwrap();
        let rest: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM einsatz_personal")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(rest, 0, "CASCADE muss Dispositionszeilen entfernen");
    }

    #[tokio::test]
    async fn einsatz_tier_migration_legt_tabelle_und_constraints_an() {
        let pool = test_pool().await;

        // Setup: Org, Benutzer, Einsatz, eine Person (als Halter-FK-Ziel).
        sqlx::query("INSERT INTO organisation (id, name) VALUES (1, 'Orga')")
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query(
            "INSERT INTO benutzer (org_id, anzeigename, benutzername, passwort_hash) \
             VALUES (1, 'Leit', 'leit', 'h')",
        )
        .execute(&pool)
        .await
        .unwrap();
        let einsatz_id: i64 = sqlx::query_scalar(
            "INSERT INTO einsatz (org_id, bezeichnung) VALUES (1, 'Lage') RETURNING id",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        let person_id: i64 = sqlx::query_scalar(
            "INSERT INTO einsatz_person (einsatz_id, registrier_nr, erfasst_von, geaendert_von) \
             VALUES (?, 1, 1, 1) RETURNING id",
        )
        .bind(einsatz_id)
        .fetch_one(&pool)
        .await
        .unwrap();

        // Gültiges Tier (Status-Default 'aktiv', spezies gesetzt).
        let tier_id: i64 = sqlx::query_scalar(
            "INSERT INTO einsatz_tier (einsatz_id, registrier_nr, spezies, erfasst_von, geaendert_von) \
             VALUES (?, 1, 'hund', 1, 1) RETURNING id",
        ).bind(einsatz_id).fetch_one(&pool).await.unwrap();
        let status: String = sqlx::query_scalar("SELECT status FROM einsatz_tier WHERE id = ?")
            .bind(tier_id)
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(status, "aktiv", "Status-Default ist aktiv");

        // spezies-CHECK lehnt ungültigen Wert ab.
        let bad_spezies = sqlx::query(
            "INSERT INTO einsatz_tier (einsatz_id, registrier_nr, spezies, erfasst_von, geaendert_von) \
             VALUES (?, 2, 'dinosaurier', 1, 1)",
        ).bind(einsatz_id).execute(&pool).await;
        assert!(
            bad_spezies.is_err(),
            "ungültige spezies muss abgelehnt werden"
        );

        // status-CHECK lehnt ungültigen Wert ab.
        let bad_status = sqlx::query("UPDATE einsatz_tier SET status = 'gestohlen' WHERE id = ?")
            .bind(tier_id)
            .execute(&pool)
            .await;
        assert!(
            bad_status.is_err(),
            "ungültiger status muss abgelehnt werden"
        );

        // Halter-XOR-CHECK: beide gesetzt → Insert-Fehler.
        let bad_halter = sqlx::query(
            "INSERT INTO einsatz_tier \
                (einsatz_id, registrier_nr, spezies, halter_person_id, halter_kontakt, erfasst_von, geaendert_von) \
             VALUES (?, 3, 'katze', ?, 'Frau Müller', 1, 1)",
        ).bind(einsatz_id).bind(person_id).execute(&pool).await;
        assert!(
            bad_halter.is_err(),
            "halter_person_id UND halter_kontakt gleichzeitig muss abgelehnt werden"
        );

        // Abschluss-CHECK: status='abgeschlossen' ohne abschluss_grund → Fehler.
        let bad_abschluss =
            sqlx::query("UPDATE einsatz_tier SET status = 'abgeschlossen' WHERE id = ?")
                .bind(tier_id)
                .execute(&pool)
                .await;
        assert!(
            bad_abschluss.is_err(),
            "abgeschlossen ohne abschluss_grund muss abgelehnt werden"
        );

        // Mit abschluss_grund erlaubt.
        sqlx::query(
            "UPDATE einsatz_tier SET status = 'abgeschlossen', abschluss_grund = 'uebergabe_tierarzt' WHERE id = ?",
        ).bind(tier_id).execute(&pool).await.unwrap();

        // UNIQUE (einsatz_id, registrier_nr): doppelte Nummer je Einsatz → Fehler.
        let dup = sqlx::query(
            "INSERT INTO einsatz_tier (einsatz_id, registrier_nr, spezies, erfasst_von, geaendert_von) \
             VALUES (?, 1, 'hund', 1, 1)",
        ).bind(einsatz_id).execute(&pool).await;
        assert!(
            dup.is_err(),
            "doppelte registrier_nr je Einsatz muss abgelehnt werden"
        );
    }

    // --- Schaden: Constraints ---

    /// Legt Org, Benutzer, Einsatz per rohem SQL an und liefert (benutzer_id, einsatz_id).
    async fn schaden_setup(pool: &sqlx::SqlitePool) -> (i64, i64) {
        sqlx::query("INSERT INTO organisation (name) VALUES ('O')")
            .execute(pool)
            .await
            .unwrap();
        let benutzer_id: i64 = sqlx::query_scalar(
            "INSERT INTO benutzer (org_id, anzeigename, benutzername, passwort_hash, \
                system_rolle, org_rolle) \
             VALUES (1, 'A', 'a', 'x', 'keiner', 'keine') RETURNING id",
        )
        .fetch_one(pool)
        .await
        .unwrap();
        let einsatz_id: i64 = sqlx::query_scalar(
            "INSERT INTO einsatz (org_id, bezeichnung, status) \
             VALUES (1, 'L', 'aktiv') RETURNING id",
        )
        .fetch_one(pool)
        .await
        .unwrap();
        (benutzer_id, einsatz_id)
    }

    async fn schaden_insert_min(
        pool: &sqlx::SqlitePool,
        einsatz_id: i64,
        benutzer_id: i64,
        extra_spalten: &str,
        extra_werte: &str,
    ) -> Result<sqlx::sqlite::SqliteQueryResult, sqlx::Error> {
        let sql = format!(
            "INSERT INTO einsatz_schaden \
                (einsatz_id, registrier_nr, typ, ausmass, ort, erfasst_von, geaendert_von{extra_spalten}) \
             VALUES ({einsatz_id}, 1, 'sachschaden', 'gering', 'Hauptstr. 1', {benutzer_id}, {benutzer_id}{extra_werte})"
        );
        sqlx::query(sqlx::AssertSqlSafe(&*sql)).execute(pool).await
    }

    #[tokio::test]
    async fn schaden_minimal_insert_ok() {
        let pool = test_pool().await;
        let (b, e) = schaden_setup(&pool).await;
        schaden_insert_min(&pool, e, b, "", "")
            .await
            .expect("Minimal-Insert muss gehen");
    }

    #[tokio::test]
    async fn schaden_geschaedigt_xor_check() {
        let pool = test_pool().await;
        let (b, e) = schaden_setup(&pool).await;
        let p: i64 = sqlx::query_scalar(
            "INSERT INTO einsatz_person (einsatz_id, registrier_nr, status, erfasst_von, geaendert_von) \
             VALUES (?, 1, 'betroffen', ?, ?) RETURNING id")
            .bind(e).bind(b).bind(b).fetch_one(&pool).await.unwrap();
        let res = schaden_insert_min(
            &pool,
            e,
            b,
            ", geschaedigt_person_id, geschaedigt_kontakt",
            &format!(", {p}, 'Herr Meier'"),
        )
        .await;
        assert!(
            res.is_err(),
            "FK UND Freitext gleichzeitig muss vom CHECK abgelehnt werden"
        );
    }

    #[tokio::test]
    async fn schaden_status_uebergeben_braucht_adressat() {
        let pool = test_pool().await;
        let (b, e) = schaden_setup(&pool).await;
        let res = schaden_insert_min(&pool, e, b, ", status", ", 'uebergeben'").await;
        assert!(
            res.is_err(),
            "status='uebergeben' ohne uebergeben_an muss CHECK verletzen"
        );
    }

    #[tokio::test]
    async fn schaden_status_abgeschlossen_braucht_grund() {
        let pool = test_pool().await;
        let (b, e) = schaden_setup(&pool).await;
        let res = schaden_insert_min(&pool, e, b, ", status", ", 'abgeschlossen'").await;
        assert!(
            res.is_err(),
            "status='abgeschlossen' ohne abschluss_grund muss CHECK verletzen"
        );
    }

    #[tokio::test]
    async fn schaden_registrier_nr_unique_je_einsatz() {
        let pool = test_pool().await;
        let (b, e) = schaden_setup(&pool).await;
        schaden_insert_min(&pool, e, b, "", "").await.unwrap();
        let res = schaden_insert_min(&pool, e, b, "", "").await;
        assert!(
            res.is_err(),
            "UNIQUE(einsatz_id, registrier_nr) muss greifen"
        );
    }

    // --- Schaden: Geschädigt-Exklusivität (Migration 0033) ---

    /// Legt eine Einsatzkraft (einsatz_personal, Ad-hoc) an und liefert deren id.
    /// einsatz_id + snap_name sind NOT NULL; personal_id darf NULL sein (Ad-hoc extern).
    async fn schaden_personal(pool: &sqlx::SqlitePool, einsatz_id: i64) -> i64 {
        sqlx::query_scalar(
            "INSERT INTO einsatz_personal (einsatz_id, snap_name) VALUES (?, 'Einsatzkraft A') RETURNING id",
        )
        .bind(einsatz_id)
        .fetch_one(pool)
        .await
        .unwrap()
    }

    #[tokio::test]
    async fn schaden_geschaedigt_personal_einzeln_ok() {
        let pool = test_pool().await;
        let (b, e) = schaden_setup(&pool).await;
        let ep = schaden_personal(&pool, e).await;
        schaden_insert_min(&pool, e, b, ", geschaedigt_personal_id", &format!(", {ep}"))
            .await
            .expect("einzelne Einsatzkraft als Geschädigter muss gehen");
    }

    #[tokio::test]
    async fn schaden_geschaedigt_organisation_einzeln_ok() {
        let pool = test_pool().await;
        let (b, e) = schaden_setup(&pool).await;
        // organisation id 1 wird in schaden_setup angelegt.
        schaden_insert_min(&pool, e, b, ", geschaedigt_organisation_id", ", 1")
            .await
            .expect("einzelne eigene Organisation als Geschädigter muss gehen");
    }

    #[tokio::test]
    async fn schaden_geschaedigt_person_und_personal_check() {
        let pool = test_pool().await;
        let (b, e) = schaden_setup(&pool).await;
        let p: i64 = sqlx::query_scalar(
            "INSERT INTO einsatz_person (einsatz_id, registrier_nr, status, erfasst_von, geaendert_von) \
             VALUES (?, 1, 'betroffen', ?, ?) RETURNING id")
            .bind(e).bind(b).bind(b).fetch_one(&pool).await.unwrap();
        let ep = schaden_personal(&pool, e).await;
        let res = schaden_insert_min(
            &pool,
            e,
            b,
            ", geschaedigt_person_id, geschaedigt_personal_id",
            &format!(", {p}, {ep}"),
        )
        .await;
        assert!(
            res.is_err(),
            "Person UND Einsatzkraft gleichzeitig muss vom CHECK abgelehnt werden"
        );
    }

    #[tokio::test]
    async fn schaden_geschaedigt_personal_und_organisation_check() {
        let pool = test_pool().await;
        let (b, e) = schaden_setup(&pool).await;
        let ep = schaden_personal(&pool, e).await;
        let res = schaden_insert_min(
            &pool,
            e,
            b,
            ", geschaedigt_personal_id, geschaedigt_organisation_id",
            &format!(", {ep}, 1"),
        )
        .await;
        assert!(
            res.is_err(),
            "Einsatzkraft UND Organisation gleichzeitig muss vom CHECK abgelehnt werden"
        );
    }

    #[tokio::test]
    async fn schaden_geschaedigt_organisation_und_kontakt_check() {
        let pool = test_pool().await;
        let (b, e) = schaden_setup(&pool).await;
        let res = schaden_insert_min(
            &pool,
            e,
            b,
            ", geschaedigt_organisation_id, geschaedigt_kontakt",
            ", 1, 'Stadtwerke'",
        )
        .await;
        assert!(
            res.is_err(),
            "Organisation UND Freitext gleichzeitig muss vom CHECK abgelehnt werden"
        );
    }

    // --- Migration 0062: uhs-FK-Integrität nach Daten-Bereinigung ---
    //
    // Nach der vollen Migrationskette (inkl. des 0082-Rebuilds) ist `uhs` mit ihren eingehenden
    // FKs nutzbar: uhs, uhs_platz und person_uhs_belegung lassen sich einfügen und lesen. Die
    // CHECK-Ablehnung prüft `migration_0082_uhs_typ_check_ohne_bereitstellungsraum`.
    #[tokio::test]
    async fn migration_0062_uhs_fk_integritaet_nach_datenbereinigung() {
        let pool = test_pool().await;

        // Minimale Stammdaten anlegen (alle NOT-NULL-FKs).
        sqlx::query("INSERT INTO organisation (id, name) VALUES (1, 'Test-Orga')")
            .execute(&pool)
            .await
            .unwrap();
        let benutzer_id: i64 = sqlx::query_scalar(
            "INSERT INTO benutzer (org_id, anzeigename, benutzername, passwort_hash) \
             VALUES (1, 'Leiter', 'leiter', 'hash') RETURNING id",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        let einsatz_id: i64 = sqlx::query_scalar(
            "INSERT INTO einsatz (org_id, bezeichnung) VALUES (1, 'Testlage') RETURNING id",
        )
        .fetch_one(&pool)
        .await
        .unwrap();

        // uhs anlegen.
        let uhs_id: i64 = sqlx::query_scalar(
            "INSERT INTO uhs \
             (einsatz_id, typ, bezeichnung, erfasst_von, geaendert_von) \
             VALUES (?, 'behandlungsplatz', 'BHP 1', ?, ?) RETURNING id",
        )
        .bind(einsatz_id)
        .bind(benutzer_id)
        .bind(benutzer_id)
        .fetch_one(&pool)
        .await
        .expect("uhs-Einfügen muss nach Migration funktionieren");

        // uhs_platz anlegen: FK uhs_platz.uhs_id → uhs(id) muss greifen.
        let platz_id: i64 = sqlx::query_scalar(
            "INSERT INTO uhs_platz (uhs_id, typ, bezeichnung) \
             VALUES (?, 'bett', 'Bett 1') RETURNING id",
        )
        .bind(uhs_id)
        .fetch_one(&pool)
        .await
        .expect("uhs_platz-Einfügen mit FK auf uhs muss funktionieren");

        // einsatz_person anlegen (für person_uhs_belegung.person_id).
        let ep_id: i64 = sqlx::query_scalar(
            "INSERT INTO einsatz_person \
             (einsatz_id, registrier_nr, status, erfasst_von, geaendert_von) \
             VALUES (?, 1, 'betroffen', ?, ?) RETURNING id",
        )
        .bind(einsatz_id)
        .bind(benutzer_id)
        .bind(benutzer_id)
        .fetch_one(&pool)
        .await
        .unwrap();

        // person_uhs_belegung anlegen: FK .uhs_id → uhs(id) NOT NULL muss greifen.
        sqlx::query(
            "INSERT INTO person_uhs_belegung \
             (einsatz_id, person_id, uhs_id, platz_id, art, erfasst_von) \
             VALUES (?, ?, ?, ?, 'eintritt', ?)",
        )
        .bind(einsatz_id)
        .bind(ep_id)
        .bind(uhs_id)
        .bind(platz_id)
        .bind(benutzer_id)
        .execute(&pool)
        .await
        .expect("person_uhs_belegung mit FK auf uhs muss funktionieren");

        // Alle drei Zeilen müssen existieren und FK-konsistent sein.
        let uhs_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM uhs WHERE id = ?")
            .bind(uhs_id)
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(uhs_count, 1, "uhs-Zeile muss nach Migration vorhanden sein");

        let platz_count: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM uhs_platz WHERE uhs_id = ?")
                .bind(uhs_id)
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(platz_count, 1, "uhs_platz-Zeile muss FK auf uhs tragen");

        let belegung_count: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM person_uhs_belegung WHERE uhs_id = ?")
                .bind(uhs_id)
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(
            belegung_count, 1,
            "person_uhs_belegung-Zeile muss FK auf uhs tragen"
        );
    }

    // --- Migration 0082: uhs-typ-CHECK ohne 'bereitstellungsraum' ---
    //
    // Der no-tx-Rebuild lehnt 'bereitstellungsraum' auch auf DB-Ebene ab und erhält die
    // eingehenden FKs, lat/lon und beide Indizes.
    #[tokio::test]
    async fn migration_0082_uhs_typ_check_ohne_bereitstellungsraum() {
        let pool = test_pool().await;

        // Minimale Stammdaten (alle NOT-NULL-FKs von uhs).
        sqlx::query("INSERT INTO organisation (id, name) VALUES (1, 'Test-Orga')")
            .execute(&pool)
            .await
            .unwrap();
        let benutzer_id: i64 = sqlx::query_scalar(
            "INSERT INTO benutzer (org_id, anzeigename, benutzername, passwort_hash) \
             VALUES (1, 'Leiter', 'leiter', 'hash') RETURNING id",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        let einsatz_id: i64 = sqlx::query_scalar(
            "INSERT INTO einsatz (org_id, bezeichnung) VALUES (1, 'Testlage') RETURNING id",
        )
        .fetch_one(&pool)
        .await
        .unwrap();

        // 1) Alle vier gültigen Typen werden akzeptiert.
        for (i, typ) in [
            "patientenablage",
            "behandlungsplatz",
            "verletztensammelstelle",
            "sonstige",
        ]
        .iter()
        .enumerate()
        {
            sqlx::query(
                "INSERT INTO uhs (einsatz_id, typ, bezeichnung, erfasst_von, geaendert_von) \
                 VALUES (?, ?, ?, ?, ?)",
            )
            .bind(einsatz_id)
            .bind(typ)
            .bind(format!("UHS {i}"))
            .bind(benutzer_id)
            .bind(benutzer_id)
            .execute(&pool)
            .await
            .unwrap_or_else(|e| panic!("gültiger typ '{typ}' muss akzeptiert werden: {e}"));
        }

        // 2) Der CHECK lehnt 'bereitstellungsraum' auf DB-Ebene ab.
        let bad = sqlx::query(
            "INSERT INTO uhs (einsatz_id, typ, bezeichnung, erfasst_von, geaendert_von) \
             VALUES (?, 'bereitstellungsraum', 'BR 1', ?, ?)",
        )
        .bind(einsatz_id)
        .bind(benutzer_id)
        .bind(benutzer_id)
        .execute(&pool)
        .await;
        assert!(
            bad.is_err(),
            "typ='bereitstellungsraum' muss der DB-CHECK jetzt ablehnen"
        );

        // 3) lat/lon (Zusatzspalten aus 0034) überleben den Rebuild inhaltlich.
        let uhs_id: i64 = sqlx::query_scalar(
            "INSERT INTO uhs (einsatz_id, typ, bezeichnung, erfasst_von, geaendert_von, lat, lon) \
             VALUES (?, 'behandlungsplatz', 'BHP Geo', ?, ?, 52.5, 13.4) RETURNING id",
        )
        .bind(einsatz_id)
        .bind(benutzer_id)
        .bind(benutzer_id)
        .fetch_one(&pool)
        .await
        .expect("lat/lon-Spalten müssen nach dem Rebuild existieren");
        let (lat, lon): (Option<f64>, Option<f64>) =
            sqlx::query_as("SELECT lat, lon FROM uhs WHERE id = ?")
                .bind(uhs_id)
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(
            (lat, lon),
            (Some(52.5), Some(13.4)),
            "lat/lon müssen erhalten bleiben"
        );

        // 4) Eingehende FKs bleiben intakt: uhs_platz + person_uhs_belegung nutzbar.
        let platz_id: i64 = sqlx::query_scalar(
            "INSERT INTO uhs_platz (uhs_id, typ, bezeichnung) VALUES (?, 'bett', 'Bett 1') RETURNING id",
        )
        .bind(uhs_id)
        .fetch_one(&pool)
        .await
        .expect("uhs_platz-FK auf das rebuildete uhs muss greifen");
        let ep_id: i64 = sqlx::query_scalar(
            "INSERT INTO einsatz_person (einsatz_id, registrier_nr, status, erfasst_von, geaendert_von) \
             VALUES (?, 1, 'betroffen', ?, ?) RETURNING id",
        )
        .bind(einsatz_id)
        .bind(benutzer_id)
        .bind(benutzer_id)
        .fetch_one(&pool)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO person_uhs_belegung (einsatz_id, person_id, uhs_id, platz_id, art, erfasst_von) \
             VALUES (?, ?, ?, ?, 'eintritt', ?)",
        )
        .bind(einsatz_id)
        .bind(ep_id)
        .bind(uhs_id)
        .bind(platz_id)
        .bind(benutzer_id)
        .execute(&pool)
        .await
        .expect("person_uhs_belegung-FK auf das rebuildete uhs muss greifen");

        // 5) Beide Indizes wurden nach dem Table-Rebuild neu angelegt.
        let indizes: Vec<String> = sqlx::query_scalar(
            "SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'uhs' \
             AND name IN ('idx_uhs_einsatz', 'idx_uhs_abschnitt') ORDER BY name",
        )
        .fetch_all(&pool)
        .await
        .unwrap();
        assert_eq!(
            indizes,
            vec![
                "idx_uhs_abschnitt".to_string(),
                "idx_uhs_einsatz".to_string()
            ],
            "beide uhs-Indizes müssen nach dem Rebuild existieren"
        );

        // 6) FK-Konsistenz gesamthaft: kein dangling FK nach dem Rebuild.
        let fk_verletzungen: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM pragma_foreign_key_check()")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(
            fk_verletzungen, 0,
            "PRAGMA foreign_key_check muss nach dem Rebuild leer sein"
        );
    }

    // --- Migration 0119: lage_zone-Rebuild für den Zonentyp 'evakuierungsbezirk' ---
    //
    // Geprüft an einer Zone, die VOR dem Rebuild existiert (auf der leeren Vorlage bliebe ein
    // Kopierfehler unsichtbar): sie übersteht den Umbau samt gefahrengebiet_id und ansicht_id, die
    // Indizes sind die alten plus der neue, kein FK hängt, und der neue Typ ist einfügbar.
    #[tokio::test]
    async fn migration_0119_lage_zone_rebuild_erhaelt_zeilen_und_indizes() {
        use sqlx::migrate::Migrator;
        use std::borrow::Cow;

        let alle: Vec<_> = sqlx::migrate!("./migrations").iter().cloned().collect();
        let bis = |version: i64| Migrator {
            migrations: Cow::Owned(
                alle.iter()
                    .filter(|m| m.version <= version)
                    .cloned()
                    .collect(),
            ),
            ..Migrator::DEFAULT
        };
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect_with(
                SqliteConnectOptions::new()
                    .filename(":memory:")
                    .foreign_keys(true),
            )
            .await
            .unwrap();
        bis(118).run(&pool).await.expect("Migrationen bis 0118");

        let indizes = || async {
            sqlx::query_scalar::<_, String>(
                "SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'lage_zone' \
                 AND sql IS NOT NULL ORDER BY name",
            )
            .fetch_all(&pool)
            .await
            .unwrap()
        };
        let vorher = indizes().await;

        sqlx::query("INSERT INTO organisation (id, name) VALUES (1, 'Orga')")
            .execute(&pool)
            .await
            .unwrap();
        let b: i64 = sqlx::query_scalar(
            "INSERT INTO benutzer (org_id, anzeigename, benutzername, passwort_hash) \
             VALUES (1, 'L', 'l', 'h') RETURNING id",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        let e: i64 = sqlx::query_scalar(
            "INSERT INTO einsatz (org_id, bezeichnung) VALUES (1, 'Lage') RETURNING id",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        let g: i64 = sqlx::query_scalar(
            "INSERT INTO gefahrengebiet (einsatz_id, erstellt_von) VALUES (?, ?) RETURNING id",
        )
        .bind(e)
        .bind(b)
        .fetch_one(&pool)
        .await
        .unwrap();
        let a: i64 = sqlx::query_scalar(
            "INSERT INTO karten_ansicht (einsatz_id, name) VALUES (?, 'Nord') RETURNING id",
        )
        .bind(e)
        .fetch_one(&pool)
        .await
        .unwrap();
        let geo = r#"{"type":"Polygon","coordinates":[[[8,50],[8.1,50],[8.1,50.1],[8,50]]]}"#;
        let z: i64 = sqlx::query_scalar(
            "INSERT INTO lage_zone (einsatz_id, typ, geometrie_typ, geometrie, label, notiz, \
                erstellt_von, gefahrengebiet_id, ansicht_id) \
             VALUES (?, 'gefahrengebiet', 'Polygon', ?, 'Chlorwolke', 'Wind West', ?, ?, ?) \
             RETURNING id",
        )
        .bind(e)
        .bind(geo)
        .bind(b)
        .bind(g)
        .bind(a)
        .fetch_one(&pool)
        .await
        .unwrap();
        let vor_dem_umbau: (
            String,
            String,
            String,
            Option<String>,
            Option<String>,
            i64,
            Option<i64>,
            Option<i64>,
            String,
        ) = sqlx::query_as(
            "SELECT typ, geometrie_typ, geometrie, label, notiz, erstellt_von, \
                        gefahrengebiet_id, ansicht_id, erstellt_at FROM lage_zone WHERE id = ?",
        )
        .bind(z)
        .fetch_one(&pool)
        .await
        .unwrap();

        bis(119)
            .run(&pool)
            .await
            .expect("0119 läuft auf einer DB mit Bestand");

        let nach_dem_umbau: (
            String,
            String,
            String,
            Option<String>,
            Option<String>,
            i64,
            Option<i64>,
            Option<i64>,
            String,
        ) = sqlx::query_as(
            "SELECT typ, geometrie_typ, geometrie, label, notiz, erstellt_von, \
                        gefahrengebiet_id, ansicht_id, erstellt_at FROM lage_zone WHERE id = ?",
        )
        .bind(z)
        .fetch_one(&pool)
        .await
        .expect("die Zone behält ihre id");
        assert_eq!(
            nach_dem_umbau, vor_dem_umbau,
            "Zeile übersteht den Rebuild unverändert"
        );

        let mut erwartet = vorher.clone();
        erwartet.push("idx_lage_zone_evakuierungsbezirk".to_string());
        erwartet.sort();
        assert_eq!(indizes().await, erwartet, "alte Indizes plus der neue");

        let fk: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM pragma_foreign_key_check()")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(fk, 0, "kein hängender Fremdschlüssel nach dem Rebuild");

        sqlx::query(
            "INSERT INTO lage_zone (einsatz_id, typ, geometrie_typ, geometrie, erstellt_von) \
             VALUES (?, 'evakuierungsbezirk', 'Polygon', ?, ?)",
        )
        .bind(e)
        .bind(geo)
        .bind(b)
        .execute(&pool)
        .await
        .expect("der neue Typ steht im CHECK");
        let unbekannt = sqlx::query(
            "INSERT INTO lage_zone (einsatz_id, typ, geometrie_typ, geometrie, erstellt_von) \
             VALUES (?, 'quatsch', 'Polygon', ?, ?)",
        )
        .bind(e)
        .bind(geo)
        .bind(b)
        .execute(&pool)
        .await;
        assert!(unbekannt.is_err(), "der CHECK lehnt weiter Unbekanntes ab");
    }

    // Deckt den Sicherheitsnetz-Zweig von 0082 ab (UPDATE 'bereitstellungsraum' → 'sonstige' vor
    // dem Copy). Auf der leeren Vorlage greift er nie; eine reale DB mit einer solchen Zeile bräche
    // ohne ihn am neuen CHECK. Hier läuft die echte Migration (include_str!) gegen genau diese
    // Alt-DB.
    #[tokio::test]
    async fn migration_0082_sicherheitsnetz_bereinigt_altzeile_vor_rebuild() {
        // Isolierter Pool ohne FK-Zwang: die FKs von 0082 zeigen auf hier fehlende Tabellen.
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect_with(
                SqliteConnectOptions::new()
                    .filename(":memory:")
                    .foreign_keys(false),
            )
            .await
            .expect("In-Memory-Pool");

        // uhs im alten Stand (CHECK erlaubt noch 'bereitstellungsraum', + lat/lon), ohne
        // FK-Klauseln.
        sqlx::query(
            "CREATE TABLE uhs ( \
                id            INTEGER PRIMARY KEY AUTOINCREMENT, \
                einsatz_id    INTEGER NOT NULL, \
                abschnitt_id  INTEGER, \
                typ           TEXT    NOT NULL \
                              CHECK (typ IN ('patientenablage','behandlungsplatz', \
                                             'verletztensammelstelle','bereitstellungsraum','sonstige')), \
                bezeichnung   TEXT    NOT NULL, \
                standort      TEXT, \
                notiz         TEXT, \
                status        TEXT    NOT NULL DEFAULT 'geplant' \
                              CHECK (status IN ('geplant','aktiv','aufgeloest')), \
                erfasst_at    TEXT    NOT NULL DEFAULT '', \
                erfasst_von   INTEGER NOT NULL, \
                geaendert_at  TEXT    NOT NULL DEFAULT '', \
                geaendert_von INTEGER NOT NULL, \
                storniert_at  TEXT, \
                lat           REAL, \
                lon           REAL, \
                UNIQUE (einsatz_id, bezeichnung) \
            )",
        )
        .execute(&pool)
        .await
        .unwrap();

        // Alt-Zeile mit dem inzwischen verbotenen Wert + Geo (muss den Rebuild überleben).
        sqlx::query(
            "INSERT INTO uhs (einsatz_id, typ, bezeichnung, erfasst_von, geaendert_von, lat, lon) \
             VALUES (1, 'bereitstellungsraum', 'BR alt', 1, 1, 48.1, 11.5)",
        )
        .execute(&pool)
        .await
        .unwrap();

        // Die echte Migration 0082 anwenden (Multi-Statement inkl. PRAGMA-Toggle und Rebuild).
        let migration =
            include_str!("../migrations/0082_uhs_typ_check_ohne_bereitstellungsraum.sql");
        sqlx::raw_sql(migration)
            .execute(&pool)
            .await
            .expect("0082 muss auf einer DB mit Alt-Zeile durchlaufen (Sicherheitsnetz greift)");

        // Zeile erhalten, auf 'sonstige' migriert, Geo intakt.
        let (typ, lat, lon): (String, Option<f64>, Option<f64>) =
            sqlx::query_as("SELECT typ, lat, lon FROM uhs WHERE bezeichnung = 'BR alt'")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(
            typ, "sonstige",
            "Alt-Zeile muss auf 'sonstige' migriert sein"
        );
        assert_eq!(
            (lat, lon),
            (Some(48.1), Some(11.5)),
            "lat/lon der Alt-Zeile müssen den Rebuild überleben"
        );

        // Kein Rest mehr mit dem verbotenen Wert.
        let rest: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM uhs WHERE typ = 'bereitstellungsraum'")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(
            rest, 0,
            "nach 0082 darf keine 'bereitstellungsraum'-Zeile verbleiben"
        );
    }

    #[tokio::test]
    async fn migration_0083_legt_auth_provider_schema_an() {
        let pool = test_pool().await;

        // auth_provider-Tabelle existiert und ist leer (Override-Tabelle, kein Reconcile).
        let n: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM auth_provider")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(n, 0);

        // Neue benutzer-Spalten sind vorhanden (Query würde sonst fehlschlagen).
        let cols: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM pragma_table_info('benutzer') \
             WHERE name IN ('oidc_subject','oidc_issuer','totp_secret','totp_aktiviert')",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(cols, 4, "vier neue benutzer-Spalten erwartet");

        // Kind-Tabellen existieren.
        for tabelle in ["webauthn_credential", "totp_recovery_code"] {
            let da: i64 = sqlx::query_scalar(
                "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name = ?",
            )
            .bind(tabelle)
            .fetch_one(&pool)
            .await
            .unwrap();
            assert_eq!(da, 1, "Tabelle {tabelle} fehlt");
        }
    }

    // --- Migration 0089: auftrag_empfaenger.* FK → ON DELETE SET NULL ---
    //
    // Für alle vier Dispositions-FKs: das Löschen der Ziel-Entität gelingt, die Empfänger-Zeile
    // überlebt mit NULL in der FK-Spalte, `snap_anzeige` und `auftrag_id` bleiben.
    #[tokio::test]
    async fn migration_0089_auftrag_empfaenger_fk_set_null_bei_dispo_delete() {
        let pool = test_pool().await;
        sqlx::query("INSERT INTO organisation (id, name) VALUES (1, 'Orga')")
            .execute(&pool)
            .await
            .unwrap();
        let bn: i64 = sqlx::query_scalar(
            "INSERT INTO benutzer (org_id, anzeigename, benutzername, passwort_hash) \
             VALUES (1, 'Leit', 'leit', 'h') RETURNING id",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        let einsatz: i64 = sqlx::query_scalar(
            "INSERT INTO einsatz (org_id, bezeichnung) VALUES (1, 'Lage') RETURNING id",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        let auftrag: i64 = sqlx::query_scalar(
            "INSERT INTO auftrag (einsatz_id, auftrag_text, erteilt_at, erstellt_von_id) \
             VALUES (?, 'Erkunden', '2026-07-17 10:00:00', ?) RETURNING id",
        )
        .bind(einsatz)
        .bind(bn)
        .fetch_one(&pool)
        .await
        .unwrap();

        // Je eine Dispositions-Entität + der referenzierende Empfänger.
        let abschnitt: i64 = sqlx::query_scalar(
            "INSERT INTO einsatzabschnitt (einsatz_id, name) VALUES (?, 'Nord') RETURNING id",
        )
        .bind(einsatz)
        .fetch_one(&pool)
        .await
        .unwrap();
        let einheit: i64 = sqlx::query_scalar(
            "INSERT INTO einsatz_einheit (einsatz_id, name) VALUES (?, '1. Zug') RETURNING id",
        )
        .bind(einsatz)
        .fetch_one(&pool)
        .await
        .unwrap();
        let person: i64 = sqlx::query_scalar(
            "INSERT INTO einsatz_personal (einsatz_id, snap_name) VALUES (?, 'Dora') RETURNING id",
        )
        .bind(einsatz)
        .fetch_one(&pool)
        .await
        .unwrap();
        let fahrzeug: i64 = sqlx::query_scalar(
            "INSERT INTO einsatz_fahrzeug (einsatz_id, snap_funkrufname) VALUES (?, 'Florian 1') RETURNING id",
        )
        .bind(einsatz)
        .fetch_one(&pool)
        .await
        .unwrap();

        // (Spalte, Zieltabelle, Ziel-id, empfaenger_typ)
        let faelle = [
            ("abschnitt_id", "einsatzabschnitt", abschnitt, "abschnitt"),
            ("einheit_id", "einsatz_einheit", einheit, "einheit"),
            ("person_id", "einsatz_personal", person, "person"),
            ("fahrzeug_id", "einsatz_fahrzeug", fahrzeug, "fahrzeug"),
        ];
        for (spalte, _tabelle, ziel, typ) in faelle {
            let sql = format!(
                "INSERT INTO auftrag_empfaenger (auftrag_id, empfaenger_typ, {spalte}, snap_anzeige) \
                 VALUES (?, '{typ}', ?, 'Anzeige {typ}')"
            );
            sqlx::query(sqlx::AssertSqlSafe(&*sql))
                .bind(auftrag)
                .bind(ziel)
                .execute(&pool)
                .await
                .unwrap();
        }

        // Jede Ziel-Entität hart löschen → muss gelingen (kein FK-Block).
        for (spalte, tabelle, ziel, _typ) in faelle {
            let del = format!("DELETE FROM {tabelle} WHERE id = ?");
            sqlx::query(sqlx::AssertSqlSafe(&*del))
                .bind(ziel)
                .execute(&pool)
                .await
                .unwrap_or_else(|e| {
                    panic!("Löschen aus {tabelle} darf nicht am FK scheitern: {e}")
                });

            // Empfänger-Zeile lebt weiter, FK-Spalte ist NULL, Auftrag-Bezug + snap_anzeige intakt.
            let check = format!(
                "SELECT {spalte} IS NULL AND auftrag_id = ? AND snap_anzeige <> '' \
                 FROM auftrag_empfaenger WHERE snap_anzeige = ?"
            );
            let ok: i64 = sqlx::query_scalar(sqlx::AssertSqlSafe(&*check))
                .bind(auftrag)
                .bind(format!("Anzeige {}", _typ_of(spalte)))
                .fetch_one(&pool)
                .await
                .unwrap_or_else(|e| panic!("Empfänger-Zeile für {spalte} muss überleben: {e}"));
            assert_eq!(
                ok, 1,
                "{spalte} muss nach Löschung NULL sein (SET NULL), Zeile bleibt"
            );
        }

        // Keine dangling FKs nach den Löschungen.
        let verletzungen: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM pragma_foreign_key_check()")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(verletzungen, 0, "kein dangling FK nach SET-NULL-Löschungen");
    }

    /// Mappt die FK-Spalte auf den empfaenger_typ.
    fn _typ_of(spalte: &str) -> &'static str {
        match spalte {
            "abschnitt_id" => "abschnitt",
            "einheit_id" => "einheit",
            "person_id" => "person",
            "fahrzeug_id" => "fahrzeug",
            _ => unreachable!(),
        }
    }

    // Deckt den Copy-Branch des 0089-Rebuilds ab: auf der leeren Vorlage kopiert er 0 Zeilen, und
    // ein falscher Spaltenname bliebe unbemerkt. Hier eine befüllte Alt-DB (0057-Form) mit der
    // echten Migration (include_str!).
    #[tokio::test]
    async fn migration_0089_kopiert_bestandsdaten_vollstaendig() {
        // Isolierter Pool ohne FK-Zwang (die 0089-FKs zeigen auf hier fehlende Tabellen).
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect_with(
                SqliteConnectOptions::new()
                    .filename(":memory:")
                    .foreign_keys(false),
            )
            .await
            .expect("In-Memory-Pool");

        // auftrag_empfaenger im 0057-Stand, ohne FK-Klauseln.
        sqlx::query(
            "CREATE TABLE auftrag_empfaenger ( \
                id INTEGER PRIMARY KEY, \
                auftrag_id INTEGER NOT NULL, \
                empfaenger_typ TEXT NOT NULL, \
                abschnitt_id INTEGER, einheit_id INTEGER, person_id INTEGER, fahrzeug_id INTEGER, \
                funktion_text TEXT, extern_kategorie TEXT, extern_bezeichnung TEXT, \
                snap_anzeige TEXT NOT NULL, quittiert_at TEXT, quittiert_von_id INTEGER \
            )",
        )
        .execute(&pool)
        .await
        .unwrap();
        // Vollständig belegte Bestandszeile inkl. der vier Dispositions-FKs; entscheidend ist, dass
        // der
        // Copy sie durchreicht (eine symmetrische Auslassung defaultete sie still auf NULL).
        sqlx::query(
            "INSERT INTO auftrag_empfaenger \
                (id, auftrag_id, empfaenger_typ, abschnitt_id, einheit_id, person_id, fahrzeug_id, \
                 funktion_text, extern_kategorie, extern_bezeichnung, snap_anzeige, quittiert_at, quittiert_von_id) \
             VALUES (7, 42, 'extern', 6, 7, 5, 8, 'Melder', 'leitstelle', 'ILS Musterstadt', 'ILS', '2026-07-17 09:00:00', 3)",
        )
        .execute(&pool)
        .await
        .unwrap();

        // Die echte Migration 0089 anwenden.
        let migration =
            include_str!("../migrations/0089_auftrag_empfaenger_on_delete_set_null.sql");
        sqlx::raw_sql(migration)
            .execute(&pool)
            .await
            .expect("0089 muss auf einer DB mit Bestandsdaten durchlaufen");

        // Alle Spalten der Bestandszeile müssen den Rebuild verlustfrei überleben.
        #[allow(clippy::type_complexity)]
        let (aid, typ, kat, bez, snap, qat, qvon): (
            i64,
            String,
            Option<String>,
            Option<String>,
            String,
            Option<String>,
            Option<i64>,
        ) = sqlx::query_as(
            "SELECT auftrag_id, empfaenger_typ, extern_kategorie, extern_bezeichnung, \
                    snap_anzeige, quittiert_at, quittiert_von_id \
             FROM auftrag_empfaenger WHERE id = 7",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(
            (
                aid,
                typ.as_str(),
                kat.as_deref(),
                bez.as_deref(),
                snap.as_str(),
                qat.as_deref(),
                qvon
            ),
            (
                42,
                "extern",
                Some("leitstelle"),
                Some("ILS Musterstadt"),
                "ILS",
                Some("2026-07-17 09:00:00"),
                Some(3)
            ),
            "die Nicht-Dispo-Spalten müssen den Rebuild verlustfrei überleben"
        );

        // Die vier Dispositions-FKs und funktion_text müssen ebenfalls durchgereicht werden.
        let (ab, ei, pe, fz, fu): (
            Option<i64>,
            Option<i64>,
            Option<i64>,
            Option<i64>,
            Option<String>,
        ) = sqlx::query_as(
            "SELECT abschnitt_id, einheit_id, person_id, fahrzeug_id, funktion_text \
                 FROM auftrag_empfaenger WHERE id = 7",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(
            (ab, ei, pe, fz, fu.as_deref()),
            (Some(6), Some(7), Some(5), Some(8), Some("Melder")),
            "die vier Dispositions-FKs + funktion_text müssen den Copy überleben"
        );

        // Die neue Tabelle trägt jetzt ON DELETE SET NULL auf den vier Dispo-FKs + den Index.
        let ddl: String = sqlx::query_scalar(
            "SELECT sql FROM sqlite_master WHERE type='table' AND name='auftrag_empfaenger'",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(
            ddl.matches("ON DELETE SET NULL").count(),
            4,
            "vier Dispo-FKs müssen ON DELETE SET NULL tragen"
        );
        let idx: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM sqlite_master WHERE type='index' AND name='idx_auftrag_empfaenger_auftrag'",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(idx, 1, "Index muss nach dem Rebuild neu angelegt sein");
    }

    // --- Migration 0090: UNIQUE(einsatz_id, lfd_nr) auf meldung + auftrag ---
    //
    // Die Anzeige-Nummer ist das Referenzmittel im Sprechfunk; der Index schützt sie gegen einen
    // Bug in einem internen Schreibpfad.
    #[tokio::test]
    async fn migration_0090_meldung_lfd_nr_unique_je_einsatz() {
        let pool = test_pool().await;
        sqlx::query("INSERT INTO organisation (id, name) VALUES (1, 'Orga')")
            .execute(&pool)
            .await
            .unwrap();
        let bn: i64 = sqlx::query_scalar(
            "INSERT INTO benutzer (org_id, anzeigename, benutzername, passwort_hash) \
             VALUES (1, 'L', 'l', 'h') RETURNING id",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        let e1: i64 = sqlx::query_scalar(
            "INSERT INTO einsatz (org_id, bezeichnung) VALUES (1, 'A') RETURNING id",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        let e2: i64 = sqlx::query_scalar(
            "INSERT INTO einsatz (org_id, bezeichnung) VALUES (1, 'B') RETURNING id",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        let insert = |einsatz: i64, lfd: i64| {
            let pool = pool.clone();
            async move {
                sqlx::query(
                    "INSERT INTO meldung (einsatz_id, lfd_nr, absender, meldeweg, inhalt, \
                        ereigniszeit, eingang_at, erfasst_von_id) \
                     VALUES (?, ?, 'Nord 1', 'funk', 'x', '2026-07-17 09:00:00', '2026-07-17 09:00:00', ?)",
                )
                .bind(einsatz)
                .bind(lfd)
                .bind(bn)
                .execute(&pool)
                .await
            }
        };
        insert(e1, 1).await.unwrap();
        // Gleiche lfd_nr im selben Einsatz → UNIQUE-Verletzung.
        assert!(
            insert(e1, 1).await.is_err(),
            "doppelte lfd_nr je Einsatz muss abgelehnt werden"
        );
        // Gleiche lfd_nr in einem ANDEREN Einsatz ist erlaubt.
        insert(e2, 1)
            .await
            .expect("lfd_nr je Einsatz unabhängig — anderer Einsatz muss gehen");
    }

    #[tokio::test]
    async fn migration_0090_auftrag_lfd_nr_unique_je_einsatz_mit_null_bestand() {
        let pool = test_pool().await;
        sqlx::query("INSERT INTO organisation (id, name) VALUES (1, 'Orga')")
            .execute(&pool)
            .await
            .unwrap();
        let bn: i64 = sqlx::query_scalar(
            "INSERT INTO benutzer (org_id, anzeigename, benutzername, passwort_hash) \
             VALUES (1, 'L', 'l', 'h') RETURNING id",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        let e: i64 = sqlx::query_scalar(
            "INSERT INTO einsatz (org_id, bezeichnung) VALUES (1, 'A') RETURNING id",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        let insert = |lfd: Option<i64>| {
            let pool = pool.clone();
            async move {
                sqlx::query(
                    "INSERT INTO auftrag (einsatz_id, lfd_nr, auftrag_text, erteilt_at, erstellt_von_id) \
                     VALUES (?, ?, 'x', '2026-07-17 10:00:00', ?)",
                )
                .bind(e)
                .bind(lfd)
                .bind(bn)
                .execute(&pool)
                .await
            }
        };
        insert(Some(1)).await.unwrap();
        assert!(
            insert(Some(1)).await.is_err(),
            "doppelte lfd_nr je Einsatz muss abgelehnt werden"
        );
        // Altbestand: mehrere NULL-lfd_nr bleiben erlaubt (SQLite: NULLs im UNIQUE verschieden).
        insert(None).await.expect("erste NULL-lfd_nr ok");
        insert(None)
            .await
            .expect("mehrere NULL-lfd_nr müssen erlaubt bleiben (Altbestand)");
    }

    // --- Migration 0149: Zeitpunkt des Fristsetzens (LFH-906) ---
    //
    // Befüllung auf einer Alt-DB: eine künftige Frist gilt als jetzt gesetzt, eine abgelaufene
    // als vor ihrem Ablauf gesetzt; ein vorgemerkter Einsatz und einer ohne Frist bleiben NULL.
    #[tokio::test]
    async fn migration_0149_befuellt_retention_gesetzt_at() {
        use sqlx::migrate::Migrator;
        use std::borrow::Cow;

        let alle: Vec<_> = sqlx::migrate!("./migrations").iter().cloned().collect();
        let bis = |version: i64| Migrator {
            migrations: Cow::Owned(
                alle.iter()
                    .filter(|m| m.version <= version)
                    .cloned()
                    .collect(),
            ),
            ..Migrator::DEFAULT
        };
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect_with(
                SqliteConnectOptions::new()
                    .filename(":memory:")
                    .foreign_keys(true),
            )
            .await
            .unwrap();
        bis(148).run(&pool).await.expect("Migrationen bis 0148");
        sqlx::query("INSERT INTO organisation (id, name) VALUES (1, 'Orga')")
            .execute(&pool)
            .await
            .unwrap();
        let einsatz = |frist: Option<&'static str>, vorgemerkt: Option<&'static str>| {
            let pool = pool.clone();
            async move {
                sqlx::query_scalar::<_, i64>(
                    "INSERT INTO einsatz (org_id, bezeichnung, retention_bis, geloescht_at) \
                     VALUES (1, 'Lage', ?, ?) RETURNING id",
                )
                .bind(frist)
                .bind(vorgemerkt)
                .fetch_one(&pool)
                .await
                .unwrap()
            }
        };
        let kuenftig = einsatz(Some("2999-01-01 00:00:00"), None).await;
        let abgelaufen = einsatz(Some("2020-01-01 00:00:00"), None).await;
        let vorgemerkt = einsatz(Some("2020-01-01 00:00:00"), Some("2020-01-02 00:00:00")).await;
        let ohne_frist = einsatz(None, None).await;

        bis(149).run(&pool).await.expect("Migration 0149");

        let gesetzt = |id: i64| {
            let pool = pool.clone();
            async move {
                sqlx::query_scalar::<_, Option<String>>(
                    "SELECT retention_gesetzt_at FROM einsatz WHERE id = ?",
                )
                .bind(id)
                .fetch_one(&pool)
                .await
                .unwrap()
            }
        };
        let jetzt = gesetzt(kuenftig).await.expect("künftige Frist befüllt");
        assert!(
            jetzt.as_str() < "2999-01-01 00:00:00" && crate::zeit::parse_utc(&jetzt).is_some(),
            "künftige Frist gilt als jetzt gesetzt, im kanonischen Format: {jetzt}"
        );
        assert_eq!(
            gesetzt(abgelaufen).await.as_deref(),
            Some("2020-01-01 00:00:00"),
            "abgelaufene Frist gilt als vor ihrem Ablauf gesetzt"
        );
        assert_eq!(gesetzt(vorgemerkt).await, None);
        assert_eq!(gesetzt(ohne_frist).await, None);
    }

    // --- Migration 0158: Zeitpunkt des Setzens einer Kategorie-Frist (LFH-1049) ---
    //
    // Befüllung wie 0149: eine künftige Kategorie-Frist gilt als jetzt gesetzt, eine abgelaufene
    // als vor ihrem Ablauf gesetzt; eine vorgemerkte, eine geschwärzte und eine aufgehobene
    // bleiben NULL.
    #[tokio::test]
    async fn migration_0158_befuellt_kategorie_frist_gesetzt_at() {
        use sqlx::migrate::Migrator;
        use std::borrow::Cow;

        let alle: Vec<_> = sqlx::migrate!("./migrations").iter().cloned().collect();
        let bis = |version: i64| Migrator {
            migrations: Cow::Owned(
                alle.iter()
                    .filter(|m| m.version <= version)
                    .cloned()
                    .collect(),
            ),
            ..Migrator::DEFAULT
        };
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect_with(
                SqliteConnectOptions::new()
                    .filename(":memory:")
                    .foreign_keys(true),
            )
            .await
            .unwrap();
        bis(157).run(&pool).await.expect("Migrationen bis 0157");
        sqlx::query("INSERT INTO organisation (id, name) VALUES (1, 'Orga')")
            .execute(&pool)
            .await
            .unwrap();
        let einsatz: i64 = sqlx::query_scalar(
            "INSERT INTO einsatz (org_id, bezeichnung, status) VALUES (1, 'Lage', 'abgeschlossen') \
             RETURNING id",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        for (k, frist, vorgemerkt, geschwaerzt) in [
            ("behandlung", Some("2999-01-01 00:00:00"), None, None),
            ("personenauskunft", Some("2020-01-01 00:00:00"), None, None),
            (
                "anhaenge",
                Some("2020-01-01 00:00:00"),
                Some("2020-01-02 00:00:00"),
                None,
            ),
            (
                "x_geschwaerzt",
                Some("2020-01-01 00:00:00"),
                None,
                Some("2020-03-01 00:00:00"),
            ),
            ("x_aufgehoben", None, None, None),
        ] {
            sqlx::query(
                "INSERT INTO einsatz_aufbewahrung_kategorie (einsatz_id, kategorie, frist_bis, \
                    rechtsgrundlage, vorgemerkt_at, geschwaerzt_at) VALUES (?, ?, ?, 'RG', ?, ?)",
            )
            .bind(einsatz)
            .bind(k)
            .bind(frist)
            .bind(vorgemerkt)
            .bind(geschwaerzt)
            .execute(&pool)
            .await
            .unwrap();
        }

        bis(158).run(&pool).await.expect("Migration 0158");

        let gesetzt = |k: &'static str| {
            let pool = pool.clone();
            async move {
                sqlx::query_scalar::<_, Option<String>>(
                    "SELECT frist_gesetzt_at FROM einsatz_aufbewahrung_kategorie \
                     WHERE einsatz_id = ? AND kategorie = ?",
                )
                .bind(einsatz)
                .bind(k)
                .fetch_one(&pool)
                .await
                .unwrap()
            }
        };
        let jetzt = gesetzt("behandlung").await.expect("künftige Frist befüllt");
        assert!(
            jetzt.as_str() < "2999-01-01 00:00:00" && crate::zeit::parse_utc(&jetzt).is_some(),
            "künftige Frist gilt als jetzt gesetzt, im kanonischen Format: {jetzt}"
        );
        assert_eq!(
            gesetzt("personenauskunft").await.as_deref(),
            Some("2020-01-01 00:00:00"),
            "abgelaufene Frist gilt als vor ihrem Ablauf gesetzt"
        );
        assert_eq!(gesetzt("anhaenge").await, None);
        assert_eq!(gesetzt("x_geschwaerzt").await, None);
        assert_eq!(gesetzt("x_aufgehoben").await, None);
    }

    // --- Migration 0150: Giftzeilen des Erinnerungs-Planers (LFH-924) ---
    //
    // Alt-DB mit allem, was vor den Eingabegrenzen durchkam: unplausible Intervalle werden
    // einmalig, Zeilen mit unplausiblem Jahr gelten als ausgelöst (auch erledigte); gesunde
    // Zeilen bleiben, wie sie sind.
    #[tokio::test]
    async fn migration_0151_entschaerft_erinnerungs_giftzeilen() {
        use sqlx::migrate::Migrator;
        use std::borrow::Cow;

        let alle: Vec<_> = sqlx::migrate!("./migrations").iter().cloned().collect();
        let bis = |version: i64| Migrator {
            migrations: Cow::Owned(
                alle.iter()
                    .filter(|m| m.version <= version)
                    .cloned()
                    .collect(),
            ),
            ..Migrator::DEFAULT
        };
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect_with(
                SqliteConnectOptions::new()
                    .filename(":memory:")
                    .foreign_keys(true),
            )
            .await
            .unwrap();
        bis(149).run(&pool).await.expect("Migrationen bis 0149");
        sqlx::query("INSERT INTO organisation (id, name) VALUES (1, 'Orga')")
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query(
            "INSERT INTO benutzer (id, org_id, anzeigename, benutzername, passwort_hash) \
             VALUES (1, 1, 'L', 'l', 'h')",
        )
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query("INSERT INTO einsatz (id, org_id, bezeichnung) VALUES (1, 1, 'Lage')")
            .execute(&pool)
            .await
            .unwrap();
        let erinnerung = |faellig: &'static str, intervall: Option<i64>, status: &'static str| {
            let pool = pool.clone();
            async move {
                sqlx::query_scalar::<_, i64>(
                    "INSERT INTO erinnerung (einsatz_id, titel, faellig_at, intervall_minuten, \
                                             status, erstellt_von_id) \
                     VALUES (1, 'X', ?, ?, ?, 1) RETURNING id",
                )
                .bind(faellig)
                .bind(intervall)
                .bind(status)
                .fetch_one(&pool)
                .await
                .unwrap()
            }
        };
        let gesund = erinnerung("2026-06-11 10:00:00", Some(30), "offen").await;
        let wochenrhythmus = erinnerung("2026-06-11 10:00:00", Some(10_080), "offen").await;
        let riesig = erinnerung("2026-06-11 10:00:00", Some(999_999_999_999), "offen").await;
        let null_intervall = erinnerung("2026-06-11 10:00:00", Some(0), "offen").await;
        let jahr_0226 = erinnerung("0226-05-01 10:00:00", Some(1), "offen").await;
        let jahr_negativ = erinnerung("-262000-05-01 10:00:00", Some(1), "offen").await;
        let jahr_fern = erinnerung("+10000-05-01 10:00:00", None, "offen").await;
        let jahr_0226_erledigt = erinnerung("0226-05-01 10:00:00", Some(1), "erledigt").await;

        bis(150).run(&pool).await.expect("Migration 0150");

        let zeile = |id: i64| {
            let pool = pool.clone();
            async move {
                sqlx::query_as::<_, (Option<i64>, Option<String>)>(
                    "SELECT intervall_minuten, zuletzt_ausgeloest_at FROM erinnerung WHERE id = ?",
                )
                .bind(id)
                .fetch_one(&pool)
                .await
                .unwrap()
            }
        };
        assert_eq!(zeile(gesund).await, (Some(30), None));
        assert_eq!(zeile(wochenrhythmus).await, (Some(10_080), None));
        assert_eq!(zeile(riesig).await, (None, None), "einmalig, löst noch aus");
        assert_eq!(zeile(null_intervall).await, (None, None));
        for (id, faellig) in [
            (jahr_0226, "0226-05-01 10:00:00"),
            (jahr_negativ, "-262000-05-01 10:00:00"),
            (jahr_fern, "+10000-05-01 10:00:00"),
        ] {
            assert_eq!(
                zeile(id).await,
                (None, Some(faellig.to_string())),
                "{faellig}: gilt als ausgelöst"
            );
        }
        assert_eq!(
            zeile(jahr_0226_erledigt).await,
            (None, Some("0226-05-01 10:00:00".to_string())),
            "auch erledigte: nach einer Rücknahme liefe sie sonst minütlich"
        );
    }

    // --- Migration 0111: Lagedaten an einsatz_person ---
    //
    // Auf der leeren Vorlage liefe der Backfill über null Zeilen. Hier eine befüllte Alt-DB mit
    // person_verbleib aus der echten 0025 und die echte 0111: zwei Ereignisse in derselben Sekunde
    // entscheidet id DESC.
    #[tokio::test]
    async fn migration_0111_backfill_nimmt_juengstes_verbleib_ereignis() {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect_with(
                SqliteConnectOptions::new()
                    .filename(":memory:")
                    .foreign_keys(false),
            )
            .await
            .expect("In-Memory-Pool");
        sqlx::query(
            "CREATE TABLE einsatz_person ( \
                id INTEGER PRIMARY KEY, status TEXT NOT NULL, geaendert_at TEXT NOT NULL)",
        )
        .execute(&pool)
        .await
        .unwrap();
        sqlx::raw_sql(include_str!("../migrations/0025_person_verbleib.sql"))
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query(
            "INSERT INTO einsatz_person (id, status, geaendert_at) VALUES \
                (1, 'betroffen', '2026-09-22 08:00:00'), \
                (2, 'vermisst',  '2026-09-22 07:30:00'), \
                (3, 'betroffen', '2026-09-22 07:00:00')",
        )
        .execute(&pool)
        .await
        .unwrap();
        // Person 1: id 1 und 2 in derselben Sekunde (id 2 gewinnt); id 3 ist jünger angelegt, aber
        // zeitlich älter — der Zeitpunkt ordnet vor der id.
        sqlx::query(
            "INSERT INTO person_verbleib \
                (id, einsatz_id, person_id, art, ziel, status, zeitpunkt_at, erfasst_von) VALUES \
                (1, 1, 1, 'vor_ort',    NULL,       NULL,              '2026-09-22 10:00:00', 1), \
                (2, 1, 1, 'transport',  'KH Mitte', 'abtransportiert', '2026-09-22 10:00:00', 1), \
                (3, 1, 1, 'entlassung', 'Zuhause',  NULL,              '2026-09-22 09:00:00', 1)",
        )
        .execute(&pool)
        .await
        .unwrap();

        sqlx::raw_sql(include_str!("../migrations/0111_person_lagedaten.sql"))
            .execute(&pool)
            .await
            .expect("0111 muss auf einer befüllten DB durchlaufen");

        type Zeile = (
            Option<String>,
            Option<String>,
            Option<String>,
            Option<String>,
        );
        let lese = |id: i64| {
            let pool = pool.clone();
            async move {
                sqlx::query_as::<_, Zeile>(
                    "SELECT aktuelle_verbleib_art, aktuelles_verbleib_ziel, \
                            aktueller_verbleib_status, vermisst_seit \
                     FROM einsatz_person WHERE id = ?",
                )
                .bind(id)
                .fetch_one(&pool)
                .await
                .unwrap()
            }
        };
        assert_eq!(
            lese(1).await,
            (
                Some("transport".into()),
                Some("KH Mitte".into()),
                Some("abtransportiert".into()),
                None
            ),
            "jüngstes Ereignis nach zeitpunkt_at DESC, id DESC"
        );
        assert_eq!(
            lese(2).await,
            (None, None, None, Some("2026-09-22 07:30:00".into())),
            "Vermisste bekommen vermisst_seit aus geaendert_at, ohne Ereignis bleibt der Cache leer"
        );
        assert_eq!(lese(3).await, (None, None, None, None));

        let ereignisse: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM person_verbleib")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(ereignisse, 3, "kein Verbleib-Ereignis geht verloren");
    }

    /// Schema-Schnappschuss einer Tabelle: Spalten, FKs, Indizes samt Spalten.
    async fn schema_von(pool: &SqlitePool, tabelle: &str) -> Vec<String> {
        let mut aus = Vec::new();
        for (sql, praefix) in [
            (
                "SELECT cid || '|' || name || '|' || type || '|' || \"notnull\" || '|' || \
                        COALESCE(dflt_value, '∅') || '|' || pk \
                 FROM pragma_table_info(?) ORDER BY cid",
                "spalte",
            ),
            (
                "SELECT \"table\" || '|' || \"from\" || '|' || \"to\" || '|' || on_delete \
                 FROM pragma_foreign_key_list(?) ORDER BY id, seq",
                "fk",
            ),
            (
                "SELECT l.name || '|' || l.\"unique\" || '|' || l.origin || '|' || \
                        (SELECT group_concat(i.name, ',') FROM pragma_index_info(l.name) i) \
                 FROM pragma_index_list(?) l ORDER BY l.name",
                "index",
            ),
        ] {
            let zeilen: Vec<String> = sqlx::query_scalar(sqlx::AssertSqlSafe(sql))
                .bind(tabelle)
                .fetch_all(pool)
                .await
                .unwrap();
            aus.extend(zeilen.into_iter().map(|z| format!("{praefix}:{z}")));
        }
        aus
    }

    /// DDL ohne Tabellennamen, Leerraum zusammengefasst — für „nur der CHECK hat sich geändert“.
    fn ddl_normalisiert(sql: &str) -> String {
        let ohne_kopf = sql
            .replacen("CREATE TABLE \"person_verbleib\"", "CREATE TABLE T", 1)
            .replacen("CREATE TABLE person_verbleib_neu", "CREATE TABLE T", 1)
            .replacen("CREATE TABLE person_verbleib", "CREATE TABLE T", 1);
        ohne_kopf.split_whitespace().collect::<Vec<_>>().join(" ")
    }

    /// Alt-DB im 0025-Stand mit FK-Zwang und minimalen Eltern-Tabellen, damit
    /// `foreign_key_check` echte Aussagen trifft.
    async fn alt_db_person_verbleib() -> SqlitePool {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect_with(
                SqliteConnectOptions::new()
                    .filename(":memory:")
                    .foreign_keys(true),
            )
            .await
            .expect("In-Memory-Pool");
        sqlx::raw_sql(
            "CREATE TABLE einsatz (id INTEGER PRIMARY KEY); \
             CREATE TABLE einsatz_person (id INTEGER PRIMARY KEY); \
             CREATE TABLE benutzer (id INTEGER PRIMARY KEY); \
             INSERT INTO einsatz (id) VALUES (1); \
             INSERT INTO einsatz_person (id) VALUES (1), (2); \
             INSERT INTO benutzer (id) VALUES (1);",
        )
        .execute(&pool)
        .await
        .unwrap();
        sqlx::raw_sql(include_str!("../migrations/0025_person_verbleib.sql"))
            .execute(&pool)
            .await
            .unwrap();
        pool
    }

    // --- Migration 0112: Leaf-Rebuild von person_verbleib mit 'notunterkunft' ---
    //
    // Eine befüllte 0025-DB, deren höchste Zeile gelöscht ist (Sequenz > MAX(id)), und die echte
    // 0112: ein vergessener Spaltenname oder eine verlorene Sequenz fiele sonst nicht auf.
    #[tokio::test]
    async fn migration_0112_person_verbleib_rebuild_erhaelt_zeilen_sequenz_und_schema() {
        let pool = alt_db_person_verbleib().await;
        sqlx::query(
            "INSERT INTO person_verbleib \
                (einsatz_id, person_id, art, transportmittel, ziel, status, notiz, zeitpunkt_at, erfasst_von) VALUES \
                (1, 1, 'transport', 'RTW', 'KH Mitte', 'angemeldet', 'n1', '2026-09-22 10:00:00', 1), \
                (1, 2, 'vor_ort', NULL, NULL, NULL, NULL, '2026-09-22 10:01:00', 1), \
                (1, 2, 'entlassung', NULL, 'Zuhause', NULL, 'weg', '2026-09-22 10:02:00', 1)",
        )
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query("DELETE FROM person_verbleib WHERE id = 3")
            .execute(&pool)
            .await
            .unwrap();

        let schema_vorher = schema_von(&pool, "person_verbleib").await;
        let ddl_vorher: String = sqlx::query_scalar(
            "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'person_verbleib'",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        type Zeile = (
            i64,
            i64,
            i64,
            String,
            Option<String>,
            Option<String>,
            Option<String>,
            Option<String>,
            String,
            i64,
        );
        let alle = "SELECT id, einsatz_id, person_id, art, transportmittel, ziel, status, notiz, \
                           zeitpunkt_at, erfasst_von FROM person_verbleib ORDER BY id";
        let zeilen_vorher: Vec<Zeile> = sqlx::query_as(alle).fetch_all(&pool).await.unwrap();

        let migration = include_str!("../migrations/0112_person_verbleib_notunterkunft.sql");
        assert!(
            migration.starts_with("-- no-transaction"),
            "sqlx erkennt die Direktive nur am Dateianfang"
        );
        sqlx::raw_sql(migration)
            .execute(&pool)
            .await
            .expect("0112 muss auf einer befüllten DB durchlaufen");

        let zeilen_nachher: Vec<Zeile> = sqlx::query_as(alle).fetch_all(&pool).await.unwrap();
        assert_eq!(
            zeilen_nachher, zeilen_vorher,
            "alle Zeilen verlustfrei kopiert"
        );
        assert_eq!(
            schema_von(&pool, "person_verbleib").await,
            schema_vorher,
            "Spalten, FKs und Indizes unverändert"
        );
        let ddl_nachher: String = sqlx::query_scalar(
            "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'person_verbleib'",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(
            ddl_normalisiert(&ddl_nachher).replacen(",'notunterkunft'", "", 1),
            ddl_normalisiert(&ddl_vorher),
            "die DDL unterscheidet sich ausschließlich im art-CHECK"
        );
        let reste: Vec<i64> = sqlx::query_scalar(
            "SELECT COUNT(*) FROM sqlite_master WHERE name = 'person_verbleib_neu' \
             UNION ALL SELECT COUNT(*) FROM sqlite_sequence WHERE name = 'person_verbleib_neu'",
        )
        .fetch_all(&pool)
        .await
        .unwrap();
        let reste: i64 = reste.into_iter().sum();
        assert_eq!(reste, 0, "keine Reste der Zwischentabelle");

        // Die Sequenz überlebt: die gelöschte id 3 wird nicht wiedervergeben.
        let neue_id: i64 = sqlx::query_scalar(
            "INSERT INTO person_verbleib (einsatz_id, person_id, art, ziel, erfasst_von) \
             VALUES (1, 1, 'notunterkunft', 'Turnhalle Ost', 1) RETURNING id",
        )
        .fetch_one(&pool)
        .await
        .expect("der neue CHECK nimmt 'notunterkunft'");
        assert_eq!(neue_id, 4, "AUTOINCREMENT-Sequenz bleibt erhalten");
        assert!(
            sqlx::query(
                "INSERT INTO person_verbleib (einsatz_id, person_id, art, erfasst_von) \
                 VALUES (1, 1, 'teleportation', 1)",
            )
            .execute(&pool)
            .await
            .is_err(),
            "der CHECK lehnt unbekannte Arten weiter ab"
        );

        let fk_verletzungen: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM pragma_foreign_key_check")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(fk_verletzungen, 0, "foreign_key_check ist leer");
    }

    // Sind ALLE Zeilen gelöscht, kopiert der Rebuild nichts; ohne Übernahme der Sequenz begänne die
    // Nummerierung wieder bei 1.
    #[tokio::test]
    async fn migration_0112_erhaelt_sequenz_auch_bei_leerer_tabelle() {
        let pool = alt_db_person_verbleib().await;
        sqlx::query(
            "INSERT INTO person_verbleib (einsatz_id, person_id, art, erfasst_von) \
             VALUES (1, 1, 'vor_ort', 1), (1, 1, 'vor_ort', 1)",
        )
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query("DELETE FROM person_verbleib")
            .execute(&pool)
            .await
            .unwrap();

        sqlx::raw_sql(include_str!(
            "../migrations/0112_person_verbleib_notunterkunft.sql"
        ))
        .execute(&pool)
        .await
        .unwrap();

        let neue_id: i64 = sqlx::query_scalar(
            "INSERT INTO person_verbleib (einsatz_id, person_id, art, erfasst_von) \
             VALUES (1, 1, 'notunterkunft', 1) RETURNING id",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(neue_id, 3, "gelöschte ids werden nicht wiedervergeben");
    }

    // --- Migration 0222: Leaf-Rebuild von person_verbleib mit Fahrer-Angabe (LLH-1332) ---
    //
    // Echte Migrationen bis 0221 (FK-Zwang aus, damit Verbleibe ohne vollständigen Einsatz
    // stehen dürfen), befüllt samt Spalten aus 0121/0165/0217 und gelöschter höchster Zeile,
    // dann die echte 0222.
    async fn db_bis_0221() -> SqlitePool {
        use sqlx::migrate::Migrator;
        use std::borrow::Cow;
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect_with(
                SqliteConnectOptions::new()
                    .filename(":memory:")
                    .foreign_keys(false),
            )
            .await
            .expect("In-Memory-Pool");
        let bis: Vec<_> = sqlx::migrate!("./migrations")
            .iter()
            .filter(|m| m.version <= 221)
            .cloned()
            .collect();
        Migrator {
            migrations: Cow::Owned(bis),
            ..Migrator::DEFAULT
        }
        .run(&pool)
        .await
        .expect("0221 läuft durch");
        // Rebuild-Migrationen schalten die Fremdschlüssel am Ende wieder ein.
        sqlx::query("PRAGMA foreign_keys = OFF")
            .execute(&pool)
            .await
            .unwrap();
        pool
    }

    #[tokio::test]
    async fn migration_0222_person_verbleib_rebuild_erhaelt_zeilen_sequenz_und_indizes() {
        let pool = db_bis_0221().await;
        sqlx::query(
            "INSERT INTO person_verbleib \
                (einsatz_id, person_id, art, transportmittel, ziel, status, notiz, zeitpunkt_at, \
                 erfasst_von, betreuungsstelle_id, bestaetigt_personal_id, bestaetigt_name, \
                 client_id, eingegangen_at) VALUES \
                (1, 1, 'transport', 'RTW', 'KH Mitte', 'abtransportiert', 'n1', '2026-10-19 10:00:00', 1, NULL, 4, 'Kim', 'c-1', '2026-10-19 10:00:05'), \
                (1, 2, 'notunterkunft', NULL, 'Turnhalle', NULL, NULL, '2026-10-19 10:01:00', 1, 3, NULL, NULL, NULL, NULL), \
                (1, 2, 'entlassung', NULL, NULL, NULL, NULL, '2026-10-19 10:02:00', 1, NULL, NULL, NULL, NULL, NULL)",
        )
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query("DELETE FROM person_verbleib WHERE id = 3")
            .execute(&pool)
            .await
            .unwrap();
        let schema_vorher = schema_von(&pool, "person_verbleib").await;
        let alle = "SELECT id, einsatz_id, person_id, art, transportmittel, ziel, status, notiz, \
                           zeitpunkt_at, erfasst_von, betreuungsstelle_id, bestaetigt_personal_id, \
                           bestaetigt_name, client_id, eingegangen_at \
                    FROM person_verbleib ORDER BY id";
        let zeilen_vorher: Vec<sqlx::sqlite::SqliteRow> =
            sqlx::query(alle).fetch_all(&pool).await.unwrap();
        let als_text = |zeilen: &[sqlx::sqlite::SqliteRow]| -> Vec<String> {
            zeilen
                .iter()
                .map(|z| {
                    (0..15)
                        .map(|i| {
                            z.try_get::<Option<String>, _>(i)
                                .ok()
                                .flatten()
                                .or_else(|| {
                                    z.try_get::<Option<i64>, _>(i)
                                        .ok()
                                        .flatten()
                                        .map(|n| n.to_string())
                                })
                                .unwrap_or_else(|| "∅".into())
                        })
                        .collect::<Vec<_>>()
                        .join("|")
                })
                .collect()
        };
        let vorher = als_text(&zeilen_vorher);

        let migration = include_str!("../migrations/0222_person_verbleib_transport_durch.sql");
        assert!(
            migration.starts_with("-- no-transaction"),
            "sqlx erkennt die Direktive nur am Dateianfang"
        );
        sqlx::raw_sql(migration)
            .execute(&pool)
            .await
            .expect("0222 muss auf einer befüllten DB durchlaufen");

        let zeilen_nachher: Vec<sqlx::sqlite::SqliteRow> =
            sqlx::query(alle).fetch_all(&pool).await.unwrap();
        assert_eq!(
            als_text(&zeilen_nachher),
            vorher,
            "alle Zeilen verlustfrei kopiert"
        );
        let schema_nachher = schema_von(&pool, "person_verbleib").await;
        let neu: Vec<&String> = schema_nachher
            .iter()
            .filter(|z| !schema_vorher.contains(z))
            .collect();
        assert_eq!(
            neu.len(),
            3,
            "genau zwei neue Spalten und ein neuer FK, sonst nichts: {neu:?}"
        );
        assert!(
            schema_vorher.iter().all(|z| schema_nachher.contains(z)),
            "keine Spalte, kein FK und kein Index geht verloren"
        );

        // Die Sequenz überlebt, und der neue CHECK nimmt die neuen Werte.
        let neue_id: i64 = sqlx::query_scalar(
            "INSERT INTO person_verbleib \
                (einsatz_id, person_id, art, transportmittel, status, transport_durch, \
                 einsatz_fahrzeug_id, erfasst_von) \
             VALUES (1, 1, 'transport', '1/83-1', 'uebergeben', 'eigen', 9, 1) RETURNING id",
        )
        .fetch_one(&pool)
        .await
        .expect("der neue CHECK nimmt 'uebergeben' und 'eigen'");
        assert_eq!(neue_id, 4, "AUTOINCREMENT-Sequenz bleibt erhalten");
        for falsch in [
            "INSERT INTO person_verbleib (einsatz_id, person_id, art, transport_durch, erfasst_von) \
             VALUES (1, 1, 'transport', 'nachbar', 1)",
            "INSERT INTO person_verbleib (einsatz_id, person_id, art, status, erfasst_von) \
             VALUES (1, 1, 'transport', 'angekommen', 1)",
        ] {
            assert!(
                sqlx::query(sqlx::AssertSqlSafe(falsch))
                    .execute(&pool)
                    .await
                    .is_err(),
                "der CHECK lehnt ab: {falsch}"
            );
        }
        // Der eindeutige client_id-Index steht wieder.
        assert!(
            sqlx::query(
                "INSERT INTO person_verbleib (einsatz_id, person_id, art, client_id, erfasst_von) \
                 VALUES (1, 2, 'vor_ort', 'c-1', 1)",
            )
            .execute(&pool)
            .await
            .is_err(),
            "client_id bleibt je Einsatz eindeutig"
        );
        let cache: Vec<String> = sqlx::query_scalar(
            "SELECT name FROM pragma_table_info('einsatz_person') \
             WHERE name IN ('aktueller_transport_durch', 'aktuelles_einsatz_fahrzeug_id') ORDER BY name",
        )
        .fetch_all(&pool)
        .await
        .unwrap();
        assert_eq!(
            cache,
            ["aktueller_transport_durch", "aktuelles_einsatz_fahrzeug_id"]
        );
        let reste: i64 = sqlx::query_scalar(
            "SELECT (SELECT COUNT(*) FROM sqlite_master WHERE name = 'person_verbleib_neu') \
                  + (SELECT COUNT(*) FROM sqlite_sequence WHERE name = 'person_verbleib_neu')",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(reste, 0, "keine Reste der Zwischentabelle");
    }

    const MIGRATION_0141: &str = include_str!("../migrations/0141_person_zugriff_audit_anhang.sql");

    /// Alt-DB im 0132-Stand: die 0021-Alt-DB aus [`alt_db_person_zugriff_audit`], dazu die echte
    /// 0132 — der Ausgangspunkt, auf den 0141 in Produktion trifft.
    async fn alt_db_person_zugriff_audit_0132() -> SqlitePool {
        let pool = alt_db_person_zugriff_audit().await;
        sqlx::raw_sql(MIGRATION_0132).execute(&pool).await.unwrap();
        pool
    }

    // --- Migration 0155: karte_proxy_asset mit Herkunft, Verwaisung und AUTOINCREMENT (LFH-932) ---
    //
    // Alt-DB im 0077-Stand (FK-Zwang an), befüllt, dann die echte 0155.
    #[tokio::test]
    async fn migration_0155_karte_proxy_asset_rebuild_erhaelt_zeilen_und_vergibt_keine_id_neu() {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect_with(
                SqliteConnectOptions::new()
                    .filename(":memory:")
                    .foreign_keys(true),
            )
            .await
            .expect("In-Memory-Pool");
        sqlx::raw_sql(
            "CREATE TABLE karte_online_quelle (id INTEGER PRIMARY KEY); \
             INSERT INTO karte_online_quelle (id) VALUES (1), (2); \
             CREATE TABLE karte_proxy_asset ( \
                 id           INTEGER PRIMARY KEY, \
                 quelle_id    INTEGER NOT NULL REFERENCES karte_online_quelle(id) ON DELETE CASCADE, \
                 upstream_url TEXT    NOT NULL, \
                 art          TEXT    NOT NULL CHECK (art IN ('static', 'template', 'tilejson', 'sprite', 'glyphs')), \
                 erstellt_at  TEXT    NOT NULL DEFAULT (datetime('now')), \
                 UNIQUE (quelle_id, upstream_url, art)); \
             INSERT INTO karte_proxy_asset (id, quelle_id, upstream_url, art, erstellt_at) VALUES \
                 (1, 1, 'https://h/tj', 'tilejson', '2026-07-01 10:00:00'), \
                 (2, 1, 'https://h/{z}', 'template', '2026-07-01 10:00:01'), \
                 (7, 2, 'https://h/s', 'sprite', '2026-07-01 10:00:02');",
        )
        .execute(&pool)
        .await
        .unwrap();

        let migration = include_str!("../migrations/0155_karte_proxy_asset_herkunft.sql");
        assert!(
            migration.starts_with("-- no-transaction"),
            "sqlx erkennt die Direktive nur am Dateianfang"
        );
        sqlx::raw_sql(migration)
            .execute(&pool)
            .await
            .expect("0155 muss auf einer befüllten DB durchlaufen");

        type Zeile = (i64, i64, String, String, String, Option<i64>, Option<i64>);
        let zeilen: Vec<Zeile> = sqlx::query_as(
            "SELECT id, quelle_id, upstream_url, art, erstellt_at, herkunft_id, verwaist_seit \
             FROM karte_proxy_asset ORDER BY id",
        )
        .fetch_all(&pool)
        .await
        .unwrap();
        assert_eq!(
            zeilen,
            vec![
                (
                    1,
                    1,
                    "https://h/tj".into(),
                    "tilejson".into(),
                    "2026-07-01 10:00:00".into(),
                    None,
                    None
                ),
                (
                    2,
                    1,
                    "https://h/{z}".into(),
                    "template".into(),
                    "2026-07-01 10:00:01".into(),
                    None,
                    None
                ),
                (
                    7,
                    2,
                    "https://h/s".into(),
                    "sprite".into(),
                    "2026-07-01 10:00:02".into(),
                    None,
                    None
                ),
            ],
            "ids und Werte bleiben, damit ausgelieferte Proxy-URLs gültig bleiben"
        );
        let schema = schema_von(&pool, "karte_proxy_asset").await;
        for erwartet in [
            "fk:karte_proxy_asset|herkunft_id|id|SET NULL",
            "fk:karte_online_quelle|quelle_id|id|CASCADE",
            "index:idx_karte_proxy_asset_herkunft|0|c|herkunft_id",
            "index:sqlite_autoindex_karte_proxy_asset_1|1|u|quelle_id,upstream_url,art",
        ] {
            assert!(
                schema.contains(&erwartet.to_string()),
                "{erwartet} fehlt: {schema:?}"
            );
        }
        let reste: i64 = sqlx::query_scalar(
            "SELECT (SELECT COUNT(*) FROM sqlite_master WHERE name = 'karte_proxy_asset_neu') \
                  + (SELECT COUNT(*) FROM sqlite_sequence WHERE name = 'karte_proxy_asset_neu')",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(reste, 0, "keine Reste der Zwischentabelle");

        // Die höchste id wird nach dem Löschen nicht neu vergeben.
        sqlx::query("DELETE FROM karte_proxy_asset WHERE id = 7")
            .execute(&pool)
            .await
            .unwrap();
        let neue_id: i64 = sqlx::query_scalar(
            "INSERT INTO karte_proxy_asset (quelle_id, upstream_url, art, herkunft_id) \
             VALUES (1, 'https://h/{z}?v=2', 'template', 1) RETURNING id",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(neue_id, 8, "AUTOINCREMENT");

        // Herkunft löst sich beim Löschen des TileJSON-Slots, die Zeile bleibt.
        sqlx::query("DELETE FROM karte_proxy_asset WHERE id = 1")
            .execute(&pool)
            .await
            .unwrap();
        let herkunft: Option<i64> =
            sqlx::query_scalar("SELECT herkunft_id FROM karte_proxy_asset WHERE id = 8")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(herkunft, None);
        let fk_verletzungen: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM pragma_foreign_key_check")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(fk_verletzungen, 0, "foreign_key_check ist leer");
    }

    // --- Migration 0141: Leaf-Rebuild von person_zugriff_audit mit Art 'anhang' (LFH-757) ---
    //
    // Befüllt mit allen drei Bestandsarten, höchste Zeile gelöscht, dann die echte 0141.
    #[tokio::test]
    async fn migration_0141_person_zugriff_audit_rebuild_erhaelt_zeilen_sequenz_und_schema() {
        let pool = alt_db_person_zugriff_audit_0132().await;
        sqlx::query(
            "INSERT INTO person_zugriff_audit (einsatz_id, person_id, benutzer_id, art, zugriff_at) \
             VALUES (1, 1, 1, 'detail', '2026-10-02 10:00:00'), \
                    (1, NULL, 1, 'druck', '2026-10-02 10:01:00'), \
                    (1, NULL, 1, 'export', '2026-10-02 10:02:00')",
        )
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query("DELETE FROM person_zugriff_audit WHERE id = 3")
            .execute(&pool)
            .await
            .unwrap();

        pruefe_audit_rebuild(&pool, MIGRATION_0141, "anhang").await;
    }

    #[tokio::test]
    async fn migration_0141_erhaelt_sequenz_auch_bei_leerer_tabelle() {
        let pool = alt_db_person_zugriff_audit_0132().await;
        sqlx::query(
            "INSERT INTO person_zugriff_audit (einsatz_id, person_id, benutzer_id, art) \
             VALUES (1, 1, 1, 'detail'), (1, NULL, 1, 'druck')",
        )
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query("DELETE FROM person_zugriff_audit")
            .execute(&pool)
            .await
            .unwrap();
        sqlx::raw_sql(MIGRATION_0141).execute(&pool).await.unwrap();
        let neue_id: i64 = sqlx::query_scalar(
            "INSERT INTO person_zugriff_audit (einsatz_id, person_id, benutzer_id, art) \
             VALUES (1, 1, 1, 'anhang') RETURNING id",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(neue_id, 3, "gelöschte ids werden nicht wiedervergeben");
    }

    const MIGRATION_0143: &str = include_str!("../migrations/0143_auth_audit_passwortwechsel.sql");

    /// Alt-DB im 0091-Stand: Minimal-`benutzer` für den FK und die echte 0091.
    async fn alt_db_auth_audit() -> SqlitePool {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect_with(
                SqliteConnectOptions::new()
                    .filename(":memory:")
                    .foreign_keys(true),
            )
            .await
            .expect("In-Memory-Pool");
        sqlx::raw_sql(
            "CREATE TABLE benutzer (id INTEGER PRIMARY KEY); \
             INSERT INTO benutzer (id) VALUES (1);",
        )
        .execute(&pool)
        .await
        .unwrap();
        sqlx::raw_sql(include_str!("../migrations/0091_auth_audit.sql"))
            .execute(&pool)
            .await
            .unwrap();
        pool
    }

    // --- Migration 0143: Leaf-Rebuild von auth_audit mit den Passwort-Ereignissen (LFH-827) ---
    //
    // Befüllt mit allen drei Bestandsereignissen, höchste Zeile gelöscht (Sequenz > MAX(id)),
    // dann die echte 0143: Zeilen samt ids, Schema, DDL bis auf den CHECK, Sequenz, CHECK-Grenze.
    #[tokio::test]
    async fn migration_0143_auth_audit_rebuild_erhaelt_zeilen_sequenz_und_schema() {
        let pool = alt_db_auth_audit().await;
        sqlx::query(
            "INSERT INTO auth_audit (zeitpunkt, ereignis, benutzername, benutzer_id, peer_ip, provider) \
             VALUES ('2026-10-02 10:00:00', 'login_fehlgeschlagen', 'gibtsnicht', NULL, '10.0.0.9', 'passwort'), \
                    ('2026-10-02 10:01:00', 'login_ok', 'admin', 1, '10.0.0.1', 'oidc'), \
                    ('2026-10-02 10:02:00', 'logout', 'admin', 1, NULL, 'passwort')",
        )
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query("DELETE FROM auth_audit WHERE id = 3")
            .execute(&pool)
            .await
            .unwrap();

        let schema_vorher = schema_von(&pool, "auth_audit").await;
        let ddl = || async {
            let sql: String = sqlx::query_scalar(
                "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'auth_audit'",
            )
            .fetch_one(&pool)
            .await
            .unwrap();
            sql.replacen("CREATE TABLE \"auth_audit\"", "CREATE TABLE T", 1)
                .replacen("CREATE TABLE auth_audit_neu", "CREATE TABLE T", 1)
                .replacen("CREATE TABLE auth_audit", "CREATE TABLE T", 1)
                .split_whitespace()
                .collect::<Vec<_>>()
                .join(" ")
        };
        let ddl_vorher = ddl().await;
        type Zeile = (
            i64,
            String,
            String,
            Option<String>,
            Option<i64>,
            Option<String>,
            String,
        );
        let alle = "SELECT id, zeitpunkt, ereignis, benutzername, benutzer_id, peer_ip, provider \
                    FROM auth_audit ORDER BY id";
        let zeilen_vorher: Vec<Zeile> = sqlx::query_as(alle).fetch_all(&pool).await.unwrap();

        assert!(
            MIGRATION_0143.starts_with("-- no-transaction"),
            "sqlx erkennt die Direktive nur am Dateianfang"
        );
        sqlx::raw_sql(MIGRATION_0143)
            .execute(&pool)
            .await
            .expect("der Rebuild muss auf einer befüllten DB durchlaufen");

        let zeilen_nachher: Vec<Zeile> = sqlx::query_as(alle).fetch_all(&pool).await.unwrap();
        assert_eq!(
            zeilen_nachher, zeilen_vorher,
            "alle Zeilen samt ids verlustfrei kopiert"
        );
        assert_eq!(
            schema_von(&pool, "auth_audit").await,
            schema_vorher,
            "Spalten, FKs und Indizes unverändert"
        );
        assert_eq!(
            ddl().await.replacen(
                ", 'passwort_geaendert', 'passwort_wechsel_abgewiesen'",
                "",
                1
            ),
            ddl_vorher,
            "die DDL unterscheidet sich ausschließlich im ereignis-CHECK"
        );
        let reste: i64 = sqlx::query_scalar(
            "SELECT (SELECT COUNT(*) FROM sqlite_master WHERE name = 'auth_audit_neu') \
                  + (SELECT COUNT(*) FROM sqlite_sequence WHERE name = 'auth_audit_neu')",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(reste, 0, "keine Reste der Zwischentabelle");

        // Die Sequenz überlebt: die gelöschte id 3 wird nicht wiedervergeben.
        for (erwartet, ereignis) in [
            (4, "passwort_geaendert"),
            (5, "passwort_wechsel_abgewiesen"),
        ] {
            let neue_id: i64 = sqlx::query_scalar(
                "INSERT INTO auth_audit (ereignis, benutzername, benutzer_id, provider) \
                 VALUES (?, 'admin', 1, 'passwort') RETURNING id",
            )
            .bind(ereignis)
            .fetch_one(&pool)
            .await
            .expect("der neue CHECK nimmt die Passwort-Ereignisse");
            assert_eq!(neue_id, erwartet, "AUTOINCREMENT-Sequenz bleibt erhalten");
        }
        assert!(
            sqlx::query("INSERT INTO auth_audit (ereignis, provider) VALUES ('foo', 'passwort')")
                .execute(&pool)
                .await
                .is_err(),
            "der CHECK lehnt unbekannte Ereignisse weiter ab"
        );
        let fk_verletzungen: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM pragma_foreign_key_check")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(fk_verletzungen, 0, "foreign_key_check ist leer");
    }

    // Sind ALLE Zeilen gelöscht (etwa vom 90-Tage-Purge), kopiert der Rebuild nichts; ohne
    // Übernahme der Sequenz begänne die Nummerierung wieder bei 1.
    #[tokio::test]
    async fn migration_0143_erhaelt_sequenz_auch_bei_leerer_tabelle() {
        let pool = alt_db_auth_audit().await;
        sqlx::query(
            "INSERT INTO auth_audit (ereignis, provider) \
             VALUES ('login_ok', 'passwort'), ('logout', 'passwort')",
        )
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query("DELETE FROM auth_audit")
            .execute(&pool)
            .await
            .unwrap();
        sqlx::raw_sql(MIGRATION_0143).execute(&pool).await.unwrap();
        let neue_id: i64 = sqlx::query_scalar(
            "INSERT INTO auth_audit (ereignis, provider) \
             VALUES ('passwort_geaendert', 'passwort') RETURNING id",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(neue_id, 3, "gelöschte ids werden nicht wiedervergeben");
    }

    // --- LFH-1092: Sitzungen beenden (0168 Kennung/Gerät, 0169/0170 Audit-CHECKs) ---

    const MIGRATION_0168: &str = include_str!("../migrations/0168_session_kennung_geraet.sql");
    const MIGRATION_0169: &str = include_str!("../migrations/0169_auth_audit_sitzung_beendet.sql");
    const MIGRATION_0170: &str = include_str!("../migrations/0170_admin_audit_sitzung_beendet.sql");

    /// Leerer In-Memory-Pool mit FKs und einem Minimal-`benutzer`.
    async fn minimal_pool_mit_benutzer() -> SqlitePool {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect_with(
                SqliteConnectOptions::new()
                    .filename(":memory:")
                    .foreign_keys(true),
            )
            .await
            .expect("In-Memory-Pool");
        sqlx::raw_sql(
            "CREATE TABLE benutzer (id INTEGER PRIMARY KEY); \
             INSERT INTO benutzer (id) VALUES (1), (2);",
        )
        .execute(&pool)
        .await
        .unwrap();
        pool
    }

    /// DDL einer Tabelle ohne ihren Namen, Leerraum zusammengefasst.
    async fn ddl_ohne_namen(pool: &SqlitePool, tabelle: &str) -> String {
        let sql: String =
            sqlx::query_scalar("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?")
                .bind(tabelle)
                .fetch_one(pool)
                .await
                .unwrap();
        sql.replacen(&format!("CREATE TABLE \"{tabelle}\""), "CREATE TABLE T", 1)
            .replacen(&format!("CREATE TABLE {tabelle}_neu"), "CREATE TABLE T", 1)
            .replacen(&format!("CREATE TABLE {tabelle}"), "CREATE TABLE T", 1)
            .split_whitespace()
            .collect::<Vec<_>>()
            .join(" ")
    }

    #[tokio::test]
    async fn migration_0168_gibt_bestandssitzungen_kennung_und_zuletzt_gesehen() {
        let pool = minimal_pool_mit_benutzer().await;
        // Schema der Sitzung im Stand vor 0168 (0002 + 0087 + 0147), ohne den Kopplungs-FK.
        sqlx::raw_sql(
            "CREATE TABLE session ( \
                 token_hash  TEXT PRIMARY KEY, \
                 benutzer_id INTEGER NOT NULL REFERENCES benutzer(id) ON DELETE CASCADE, \
                 erstellt_at TEXT NOT NULL DEFAULT (datetime('now')), \
                 expires_at  TEXT NOT NULL, \
                 kopplung_id INTEGER); \
             INSERT INTO session (token_hash, benutzer_id, erstellt_at, expires_at) VALUES \
                 ('a', 1, '2026-10-01 08:00:00', '2026-10-08 08:00:00'), \
                 ('b', 1, '2026-10-02 09:00:00', '2026-10-09 09:00:00'), \
                 ('c', 2, '2026-10-03 10:00:00', '2026-10-10 10:00:00');",
        )
        .execute(&pool)
        .await
        .unwrap();

        sqlx::raw_sql(MIGRATION_0168).execute(&pool).await.unwrap();

        let zeilen: Vec<(
            String,
            Option<String>,
            Option<String>,
            String,
            Option<String>,
        )> = sqlx::query_as(
            "SELECT token_hash, kennung, zuletzt_gesehen_at, erstellt_at, geraet \
                 FROM session ORDER BY token_hash",
        )
        .fetch_all(&pool)
        .await
        .unwrap();
        let mut kennungen = std::collections::HashSet::new();
        for (_, kennung, zuletzt, erstellt, geraet) in &zeilen {
            let kennung = kennung
                .as_deref()
                .expect("jede Bestandssitzung hat eine Kennung");
            assert_eq!(kennung.len(), 32, "128 Bit als Hex");
            assert!(kennung
                .chars()
                .all(|c| c.is_ascii_hexdigit() && !c.is_ascii_uppercase()));
            assert!(
                kennungen.insert(kennung.to_string()),
                "Kennungen sind verschieden"
            );
            assert_eq!(zuletzt.as_deref(), Some(erstellt.as_str()));
            assert_eq!(geraet, &None, "das Gerät des Bestands ist unbekannt");
        }
        assert_eq!(zeilen.len(), 3);
        assert!(
            sqlx::query("UPDATE session SET kennung = (SELECT kennung FROM session WHERE token_hash = 'a') WHERE token_hash = 'b'")
                .execute(&pool)
                .await
                .is_err(),
            "die Kennung ist eindeutig"
        );
    }

    #[tokio::test]
    async fn migration_0169_auth_audit_rebuild_erhaelt_zeilen_sequenz_und_schema() {
        let pool = minimal_pool_mit_benutzer().await;
        sqlx::raw_sql(include_str!("../migrations/0091_auth_audit.sql"))
            .execute(&pool)
            .await
            .unwrap();
        sqlx::raw_sql(MIGRATION_0143).execute(&pool).await.unwrap();
        sqlx::query(
            "INSERT INTO auth_audit (zeitpunkt, ereignis, benutzername, benutzer_id, peer_ip, provider) \
             VALUES ('2026-10-02 10:00:00', 'login_ok', 'admin', 1, '10.0.0.1', 'oidc'), \
                    ('2026-10-02 10:01:00', 'passwort_geaendert', 'admin', 1, NULL, 'passwort'), \
                    ('2026-10-02 10:02:00', 'logout', 'admin', 1, NULL, 'passwort')",
        )
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query("DELETE FROM auth_audit WHERE id = 3")
            .execute(&pool)
            .await
            .unwrap();
        let schema_vorher = schema_von(&pool, "auth_audit").await;
        let ddl_vorher = ddl_ohne_namen(&pool, "auth_audit").await;
        type Zeile = (
            i64,
            String,
            String,
            Option<String>,
            Option<i64>,
            Option<String>,
            String,
        );
        let alle = "SELECT id, zeitpunkt, ereignis, benutzername, benutzer_id, peer_ip, provider \
                    FROM auth_audit ORDER BY id";
        let zeilen_vorher: Vec<Zeile> = sqlx::query_as(alle).fetch_all(&pool).await.unwrap();

        assert!(MIGRATION_0169.starts_with("-- no-transaction"));
        sqlx::raw_sql(MIGRATION_0169).execute(&pool).await.unwrap();

        let zeilen_nachher: Vec<Zeile> = sqlx::query_as(alle).fetch_all(&pool).await.unwrap();
        assert_eq!(zeilen_nachher, zeilen_vorher);
        assert_eq!(schema_von(&pool, "auth_audit").await, schema_vorher);
        assert_eq!(
            ddl_ohne_namen(&pool, "auth_audit")
                .await
                .replacen(", 'sitzung_beendet'", "", 1),
            ddl_vorher,
            "die DDL unterscheidet sich ausschließlich im ereignis-CHECK"
        );
        let neue_id: i64 = sqlx::query_scalar(
            "INSERT INTO auth_audit (ereignis, benutzername, benutzer_id, provider) \
             VALUES ('sitzung_beendet', 'admin', 1, 'passwort') RETURNING id",
        )
        .fetch_one(&pool)
        .await
        .expect("der neue CHECK nimmt sitzung_beendet");
        assert_eq!(neue_id, 4, "AUTOINCREMENT-Sequenz bleibt erhalten");
        assert!(sqlx::query(
            "INSERT INTO auth_audit (ereignis, provider) VALUES ('foo', 'passwort')"
        )
        .execute(&pool)
        .await
        .is_err());
        let reste: i64 = sqlx::query_scalar(
            "SELECT (SELECT COUNT(*) FROM sqlite_master WHERE name = 'auth_audit_neu') \
                  + (SELECT COUNT(*) FROM sqlite_sequence WHERE name = 'auth_audit_neu')",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(reste, 0, "keine Reste der Zwischentabelle");
    }

    #[tokio::test]
    async fn migration_0170_admin_audit_rebuild_erhaelt_zeilen_sequenz_und_schema() {
        let pool = minimal_pool_mit_benutzer().await;
        sqlx::raw_sql(include_str!("../migrations/0156_admin_audit.sql"))
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query(
            "INSERT INTO admin_audit (zeitpunkt, aktion, akteur_id, akteur_name, ziel_benutzer_id, ziel, detail, peer_ip) \
             VALUES ('2026-10-02 10:00:00', 'benutzer_angelegt', 1, 'admin', 2, 'max', 'keiner', '10.0.0.1'), \
                    ('2026-10-02 10:01:00', 'anmeldeweg_deaktiviert', 1, 'admin', NULL, 'oidc', NULL, NULL), \
                    ('2026-10-02 10:02:00', 'benutzer_deaktiviert', 1, 'admin', 2, 'max', NULL, NULL)",
        )
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query("DELETE FROM admin_audit WHERE id = 3")
            .execute(&pool)
            .await
            .unwrap();
        let schema_vorher = schema_von(&pool, "admin_audit").await;
        let ddl_vorher = ddl_ohne_namen(&pool, "admin_audit").await;
        type Zeile = (
            i64,
            String,
            String,
            Option<i64>,
            Option<String>,
            Option<i64>,
            String,
            Option<String>,
            Option<String>,
        );
        let alle = "SELECT id, zeitpunkt, aktion, akteur_id, akteur_name, ziel_benutzer_id, ziel, \
                    detail, peer_ip FROM admin_audit ORDER BY id";
        let zeilen_vorher: Vec<Zeile> = sqlx::query_as(alle).fetch_all(&pool).await.unwrap();

        assert!(MIGRATION_0170.starts_with("-- no-transaction"));
        sqlx::raw_sql(MIGRATION_0170).execute(&pool).await.unwrap();

        let zeilen_nachher: Vec<Zeile> = sqlx::query_as(alle).fetch_all(&pool).await.unwrap();
        assert_eq!(zeilen_nachher, zeilen_vorher);
        assert_eq!(schema_von(&pool, "admin_audit").await, schema_vorher);
        assert_eq!(
            ddl_ohne_namen(&pool, "admin_audit")
                .await
                .replacen(", 'sitzung_beendet'", "", 1),
            ddl_vorher,
            "die DDL unterscheidet sich ausschließlich im aktion-CHECK"
        );
        let neue_id: i64 = sqlx::query_scalar(
            "INSERT INTO admin_audit (aktion, akteur_id, ziel_benutzer_id, ziel) \
             VALUES ('sitzung_beendet', 1, 2, 'max') RETURNING id",
        )
        .fetch_one(&pool)
        .await
        .expect("der neue CHECK nimmt sitzung_beendet");
        assert_eq!(neue_id, 4, "AUTOINCREMENT-Sequenz bleibt erhalten");
        assert!(
            sqlx::query("INSERT INTO admin_audit (aktion, ziel) VALUES ('foo', 'x')")
                .execute(&pool)
                .await
                .is_err()
        );
        let reste: i64 = sqlx::query_scalar(
            "SELECT (SELECT COUNT(*) FROM sqlite_master WHERE name = 'admin_audit_neu') \
                  + (SELECT COUNT(*) FROM sqlite_sequence WHERE name = 'admin_audit_neu')",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(reste, 0, "keine Reste der Zwischentabelle");
    }

    // --- LFH-1121: Einmalpasswort (0173 Änderungszwang, 0174 Admin-Spur-CHECK) ---

    const MIGRATION_0173: &str =
        include_str!("../migrations/0173_benutzer_passwort_wechsel_pflicht.sql");
    const MIGRATION_0174: &str = include_str!("../migrations/0174_admin_audit_einmalpasswort.sql");

    #[tokio::test]
    async fn migration_0173_bestandskonten_stehen_nicht_unter_aenderungszwang() {
        let pool = minimal_pool_mit_benutzer().await;

        sqlx::raw_sql(MIGRATION_0173).execute(&pool).await.unwrap();

        let pflichten: Vec<i64> =
            sqlx::query_scalar("SELECT passwort_wechsel_pflicht FROM benutzer ORDER BY id")
                .fetch_all(&pool)
                .await
                .unwrap();
        assert_eq!(
            pflichten,
            vec![0, 0],
            "Bestandskonten melden sich unverändert an"
        );
        sqlx::query("UPDATE benutzer SET passwort_wechsel_pflicht = 1 WHERE id = 1")
            .execute(&pool)
            .await
            .expect("1 ist erlaubt");
        assert!(
            sqlx::query("UPDATE benutzer SET passwort_wechsel_pflicht = 2 WHERE id = 2")
                .execute(&pool)
                .await
                .is_err(),
            "der CHECK lässt nur 0 und 1 zu"
        );
    }

    #[tokio::test]
    async fn migration_0174_admin_audit_rebuild_erhaelt_zeilen_sequenz_und_schema() {
        let pool = minimal_pool_mit_benutzer().await;
        sqlx::raw_sql(include_str!("../migrations/0156_admin_audit.sql"))
            .execute(&pool)
            .await
            .unwrap();
        sqlx::raw_sql(MIGRATION_0170).execute(&pool).await.unwrap();
        sqlx::query(
            "INSERT INTO admin_audit (zeitpunkt, aktion, akteur_id, akteur_name, ziel_benutzer_id, ziel, detail, peer_ip) \
             VALUES ('2026-10-09 10:00:00', 'benutzer_angelegt', 1, 'admin', 2, 'max', 'keiner', '10.0.0.1'), \
                    ('2026-10-09 10:01:00', 'sitzung_beendet', 1, 'admin', 2, 'max', 'Firefox', NULL), \
                    ('2026-10-09 10:02:00', 'benutzer_deaktiviert', 1, 'admin', 2, 'max', NULL, NULL)",
        )
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query("DELETE FROM admin_audit WHERE id = 3")
            .execute(&pool)
            .await
            .unwrap();
        let schema_vorher = schema_von(&pool, "admin_audit").await;
        let ddl_vorher = ddl_ohne_namen(&pool, "admin_audit").await;
        type Zeile = (
            i64,
            String,
            String,
            Option<i64>,
            Option<String>,
            Option<i64>,
            String,
            Option<String>,
            Option<String>,
        );
        let alle = "SELECT id, zeitpunkt, aktion, akteur_id, akteur_name, ziel_benutzer_id, ziel, \
                    detail, peer_ip FROM admin_audit ORDER BY id";
        let zeilen_vorher: Vec<Zeile> = sqlx::query_as(alle).fetch_all(&pool).await.unwrap();

        assert!(MIGRATION_0174.starts_with("-- no-transaction"));
        sqlx::raw_sql(MIGRATION_0174).execute(&pool).await.unwrap();

        let zeilen_nachher: Vec<Zeile> = sqlx::query_as(alle).fetch_all(&pool).await.unwrap();
        assert_eq!(zeilen_nachher, zeilen_vorher);
        assert_eq!(schema_von(&pool, "admin_audit").await, schema_vorher);
        assert_eq!(
            ddl_ohne_namen(&pool, "admin_audit").await.replacen(
                ", 'einmalpasswort_vergeben'",
                "",
                1
            ),
            ddl_vorher,
            "die DDL unterscheidet sich ausschließlich im aktion-CHECK"
        );
        let neue_id: i64 = sqlx::query_scalar(
            "INSERT INTO admin_audit (aktion, akteur_id, ziel_benutzer_id, ziel) \
             VALUES ('einmalpasswort_vergeben', 1, 2, 'max') RETURNING id",
        )
        .fetch_one(&pool)
        .await
        .expect("der neue CHECK nimmt einmalpasswort_vergeben");
        assert_eq!(neue_id, 4, "AUTOINCREMENT-Sequenz bleibt erhalten");
        assert!(
            sqlx::query("INSERT INTO admin_audit (aktion, ziel) VALUES ('foo', 'x')")
                .execute(&pool)
                .await
                .is_err()
        );
        let reste: i64 = sqlx::query_scalar(
            "SELECT (SELECT COUNT(*) FROM sqlite_master WHERE name = 'admin_audit_neu') \
                  + (SELECT COUNT(*) FROM sqlite_sequence WHERE name = 'admin_audit_neu')",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(reste, 0, "keine Reste der Zwischentabelle");
    }

    /// 0115 übernimmt nur Bestandsnummern im exakten Muster `JJJJ-NNN` in die Zahlenspalten. Gegen
    /// die echte Migration auf einem Minimal-Schema: `2026-01` neben `2026-001` ergäbe sonst
    /// dasselbe Zahlenpaar und spränge den Unique-Index mitten in der Migration.
    #[tokio::test]
    async fn migration_0115_uebernimmt_nur_exakte_bestandsnummern() {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect_with(SqliteConnectOptions::new().filename(":memory:"))
            .await
            .expect("In-Memory-Pool");
        sqlx::raw_sql(
            "CREATE TABLE einsatz (id INTEGER PRIMARY KEY, org_id INTEGER NOT NULL, \
                                   einsatznummer_intern TEXT); \
             CREATE UNIQUE INDEX idx_einsatz_nummer ON einsatz(org_id, einsatznummer_intern); \
             CREATE TABLE org_einstellungen (org_id INTEGER PRIMARY KEY); \
             INSERT INTO einsatz (id, org_id, einsatznummer_intern) VALUES \
                 (1, 1, '2026-001'), (2, 1, '2026-01'), (3, 1, 'EN-4711'), (4, 1, NULL), \
                 (5, 1, '2025-007'), (6, 2, '2026-001'), (7, 1, '2026-0010');",
        )
        .execute(&pool)
        .await
        .unwrap();

        sqlx::raw_sql(include_str!("../migrations/0115_einsatznummer_system.sql"))
            .execute(&pool)
            .await
            .expect("0115 muss auf Bestand mit Handwerten durchlaufen");

        let zeilen: Vec<(i64, Option<String>, Option<i64>, Option<i64>)> = sqlx::query_as(
            "SELECT id, einsatznummer_intern, nummer_jahr, nummer_lfd FROM einsatz ORDER BY id",
        )
        .fetch_all(&pool)
        .await
        .unwrap();
        assert_eq!(
            zeilen,
            vec![
                (1, Some("2026-001".into()), Some(2026), Some(1)),
                (2, Some("2026-01".into()), None, None),
                (3, Some("EN-4711".into()), None, None),
                (4, None, None, None),
                (5, Some("2025-007".into()), Some(2025), Some(7)),
                (6, Some("2026-001".into()), Some(2026), Some(1)),
                (7, Some("2026-0010".into()), None, None),
            ],
            "Text bleibt wörtlich; Zahlen nur beim exakten Muster"
        );

        // Neue Präfix-Spalte existiert und ist leer.
        sqlx::query(
            "INSERT INTO org_einstellungen (org_id, einsatz_nummer_praefix) VALUES (1, 'WF-')",
        )
        .execute(&pool)
        .await
        .expect("einsatz_nummer_praefix muss existieren");

        // Unique je (org, jahr, lfd): Dublette abgewiesen, mehrere NULL erlaubt.
        let dup = sqlx::query(
            "INSERT INTO einsatz (org_id, einsatznummer_intern, nummer_jahr, nummer_lfd) \
             VALUES (1, 'E-2026-0001', 2026, 1)",
        )
        .execute(&pool)
        .await;
        assert!(
            dup.is_err(),
            "doppelte (org, jahr, lfd) muss abgewiesen werden"
        );
        sqlx::query("INSERT INTO einsatz (org_id) VALUES (1), (1)")
            .execute(&pool)
            .await
            .expect("mehrere NULL-Zahlenpaare bleiben erlaubt (Altbestand)");
    }

    // --- Migration 0121: Verweis Verbleib → Betreuungsstelle ---
    //
    // Auf der voll migrierten Vorlage: beide Spalten zeigen mit SET NULL auf die Stelle, der
    // partielle Index existiert, der FK-Check ist leer.
    #[tokio::test]
    async fn migration_0121_verbleib_verweist_auf_betreuungsstelle() {
        let pool = test_pool().await;
        for (tabelle, spalte) in [
            ("person_verbleib", "betreuungsstelle_id"),
            ("einsatz_person", "aktuelle_verbleib_betreuungsstelle_id"),
        ] {
            let fk: Vec<(String, String, String)> = sqlx::query_as(
                "SELECT \"table\", \"to\", on_delete FROM pragma_foreign_key_list(?) \
                 WHERE \"from\" = ?",
            )
            .bind(tabelle)
            .bind(spalte)
            .fetch_all(&pool)
            .await
            .unwrap();
            assert_eq!(
                fk,
                vec![("betreuungsstelle".into(), "id".into(), "SET NULL".into())],
                "{tabelle}.{spalte} verweist mit SET NULL auf betreuungsstelle"
            );
        }
        let index: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM sqlite_master WHERE type = 'index' \
             AND name = 'idx_einsatz_person_verbleib_stelle'",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(index, 1, "partieller Index für die Zählung je Stelle");
        let fk_verletzungen: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM pragma_foreign_key_check")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(fk_verletzungen, 0);
    }

    /// Alt-DB im 0021-Stand (`person_zugriff_audit`) mit FK-Zwang und minimalen Eltern-Tabellen.
    async fn alt_db_person_zugriff_audit() -> SqlitePool {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect_with(
                SqliteConnectOptions::new()
                    .filename(":memory:")
                    .foreign_keys(true),
            )
            .await
            .expect("In-Memory-Pool");
        sqlx::raw_sql(
            "CREATE TABLE einsatz (id INTEGER PRIMARY KEY); \
             CREATE TABLE einsatz_person (id INTEGER PRIMARY KEY); \
             CREATE TABLE benutzer (id INTEGER PRIMARY KEY); \
             INSERT INTO einsatz (id) VALUES (1); \
             INSERT INTO einsatz_person (id) VALUES (1); \
             INSERT INTO benutzer (id) VALUES (1);",
        )
        .execute(&pool)
        .await
        .unwrap();
        sqlx::raw_sql(include_str!("../migrations/0021_person_zugriff_audit.sql"))
            .execute(&pool)
            .await
            .unwrap();
        pool
    }

    /// Gemeinsamer Nachweis eines Leaf-Rebuilds von `person_zugriff_audit`, der nur den art-CHECK
    /// um `neue_art` erweitert (0132 `druck`, 0141 `anhang`). Erwartet eine befüllte Alt-DB, deren
    /// Zeile id 3 gelöscht ist (Sequenz > MAX(id)): Zeilen samt ids, Schema, DDL bis auf den
    /// CHECK, keine Reste der Zwischentabelle, Sequenz, CHECK-Grenze, keine FK-Verletzung.
    async fn pruefe_audit_rebuild(pool: &SqlitePool, migration: &'static str, neue_art: &str) {
        let schema_vorher = schema_von(pool, "person_zugriff_audit").await;
        let ddl = || async {
            let sql: String = sqlx::query_scalar(
                "SELECT sql FROM sqlite_master WHERE type = 'table' \
                 AND name = 'person_zugriff_audit'",
            )
            .fetch_one(pool)
            .await
            .unwrap();
            sql.replacen("CREATE TABLE \"person_zugriff_audit\"", "CREATE TABLE T", 1)
                .replacen("CREATE TABLE person_zugriff_audit_neu", "CREATE TABLE T", 1)
                .replacen("CREATE TABLE person_zugriff_audit", "CREATE TABLE T", 1)
                .split_whitespace()
                .collect::<Vec<_>>()
                .join(" ")
        };
        let ddl_vorher = ddl().await;
        type Zeile = (i64, i64, Option<i64>, i64, String, String);
        let alle = "SELECT id, einsatz_id, person_id, benutzer_id, art, zugriff_at \
                    FROM person_zugriff_audit ORDER BY id";
        let zeilen_vorher: Vec<Zeile> = sqlx::query_as(alle).fetch_all(pool).await.unwrap();

        assert!(
            migration.starts_with("-- no-transaction"),
            "sqlx erkennt die Direktive nur am Dateianfang"
        );
        sqlx::raw_sql(migration)
            .execute(pool)
            .await
            .expect("der Rebuild muss auf einer befüllten DB durchlaufen");

        let zeilen_nachher: Vec<Zeile> = sqlx::query_as(alle).fetch_all(pool).await.unwrap();
        assert_eq!(
            zeilen_nachher, zeilen_vorher,
            "alle Zeilen samt ids verlustfrei kopiert"
        );
        assert_eq!(
            schema_von(pool, "person_zugriff_audit").await,
            schema_vorher,
            "Spalten, FKs und Indizes unverändert"
        );
        assert_eq!(
            ddl().await.replacen(&format!(",'{neue_art}'"), "", 1),
            ddl_vorher,
            "die DDL unterscheidet sich ausschließlich im art-CHECK"
        );
        let reste: i64 = sqlx::query_scalar(
            "SELECT (SELECT COUNT(*) FROM sqlite_master WHERE name = 'person_zugriff_audit_neu') \
                  + (SELECT COUNT(*) FROM sqlite_sequence WHERE name = 'person_zugriff_audit_neu')",
        )
        .fetch_one(pool)
        .await
        .unwrap();
        assert_eq!(reste, 0, "keine Reste der Zwischentabelle");

        // Die Sequenz überlebt: die gelöschte id 3 wird nicht wiedervergeben.
        let neue_id: i64 = sqlx::query_scalar(
            "INSERT INTO person_zugriff_audit (einsatz_id, person_id, benutzer_id, art) \
             VALUES (1, NULL, 1, ?) RETURNING id",
        )
        .bind(neue_art)
        .fetch_one(pool)
        .await
        .expect("der neue CHECK nimmt die neue Art");
        assert_eq!(neue_id, 4, "AUTOINCREMENT-Sequenz bleibt erhalten");
        assert!(
            sqlx::query(
                "INSERT INTO person_zugriff_audit (einsatz_id, person_id, benutzer_id, art) \
                 VALUES (1, NULL, 1, 'foo')",
            )
            .execute(pool)
            .await
            .is_err(),
            "der CHECK lehnt unbekannte Arten weiter ab"
        );
        let fk_verletzungen: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM pragma_foreign_key_check")
                .fetch_one(pool)
                .await
                .unwrap();
        assert_eq!(fk_verletzungen, 0, "foreign_key_check ist leer");
    }

    const MIGRATION_0132: &str = include_str!("../migrations/0132_person_zugriff_audit_druck.sql");

    // --- Migration 0132: Leaf-Rebuild von person_zugriff_audit mit Art 'druck' (LFH-727) ---
    //
    // Eine befüllte 0021-DB mit beiden Bestandsarten, deren höchste Zeile gelöscht ist
    // (Sequenz > MAX(id)), und die echte 0132: ein vergessener Spaltenname, eine verlorene Zeile
    // oder Sequenz fiele sonst nicht auf.
    #[tokio::test]
    async fn migration_0132_person_zugriff_audit_rebuild_erhaelt_zeilen_sequenz_und_schema() {
        let pool = alt_db_person_zugriff_audit().await;
        sqlx::query(
            "INSERT INTO person_zugriff_audit (einsatz_id, person_id, benutzer_id, art, zugriff_at) \
             VALUES (1, 1, 1, 'detail', '2026-09-30 10:00:00'), \
                    (1, NULL, 1, 'export', '2026-09-30 10:01:00'), \
                    (1, 1, 1, 'detail', '2026-09-30 10:02:00')",
        )
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query("DELETE FROM person_zugriff_audit WHERE id = 3")
            .execute(&pool)
            .await
            .unwrap();

        pruefe_audit_rebuild(&pool, MIGRATION_0132, "druck").await;
    }

    // Sind ALLE Zeilen gelöscht, kopiert der Rebuild nichts; ohne Übernahme der Sequenz begänne die
    // Nummerierung wieder bei 1.
    #[tokio::test]
    async fn migration_0132_erhaelt_sequenz_auch_bei_leerer_tabelle() {
        let pool = alt_db_person_zugriff_audit().await;
        sqlx::query(
            "INSERT INTO person_zugriff_audit (einsatz_id, person_id, benutzer_id, art) \
             VALUES (1, 1, 1, 'detail'), (1, NULL, 1, 'export')",
        )
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query("DELETE FROM person_zugriff_audit")
            .execute(&pool)
            .await
            .unwrap();
        sqlx::raw_sql(MIGRATION_0132).execute(&pool).await.unwrap();
        let neue_id: i64 = sqlx::query_scalar(
            "INSERT INTO person_zugriff_audit (einsatz_id, person_id, benutzer_id, art) \
             VALUES (1, NULL, 1, 'druck') RETURNING id",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(neue_id, 3, "gelöschte ids werden nicht wiedervergeben");
    }

    // --- Migration 0154: Bytes der Karten-Hintergrundbilder auslagern (LFH-936) ---

    /// Pool mit genau einer Verbindung auf `ort`, ohne Migrationen.
    async fn verbinden(ort: SqliteConnectOptions) -> SqlitePool {
        SqlitePoolOptions::new()
            .max_connections(1)
            .connect_with(ort.foreign_keys(true))
            .await
            .unwrap()
    }

    /// Wie [`verbinden`], mit Migrationen bis `bis`.
    async fn pool_bis(ort: SqliteConnectOptions, bis: i64) -> SqlitePool {
        let pool = verbinden(ort).await;
        migriere_bis(&pool, bis).await;
        pool
    }

    async fn migriere_bis(pool: &SqlitePool, bis: i64) {
        use sqlx::migrate::Migrator;
        use std::borrow::Cow;

        let alle: Vec<_> = sqlx::migrate!("./migrations").iter().cloned().collect();
        Migrator {
            migrations: Cow::Owned(alle.into_iter().filter(|m| m.version <= bis).collect()),
            ..Migrator::DEFAULT
        }
        .run(pool)
        .await
        .unwrap_or_else(|e| panic!("Migrationen bis {bis}: {e}"));
    }

    /// Org, Benutzer, Einsatz auf einer Alt-DB; liefert (einsatz, benutzer).
    async fn bild_grundlage(pool: &SqlitePool) -> (i64, i64) {
        sqlx::query("INSERT INTO organisation (id, name) VALUES (1, 'Orga')")
            .execute(pool)
            .await
            .unwrap();
        let b: i64 = sqlx::query_scalar(
            "INSERT INTO benutzer (org_id, anzeigename, benutzername, passwort_hash) \
             VALUES (1, 'L', 'l', 'h') RETURNING id",
        )
        .fetch_one(pool)
        .await
        .unwrap();
        let e: i64 = sqlx::query_scalar(
            "INSERT INTO einsatz (org_id, bezeichnung) VALUES (1, 'Lage') RETURNING id",
        )
        .fetch_one(pool)
        .await
        .unwrap();
        (e, b)
    }

    fn sha256_hex(daten: &[u8]) -> String {
        use sha2::{Digest, Sha256};
        Sha256::digest(daten)
            .iter()
            .map(|b| format!("{b:02x}"))
            .collect()
    }

    /// Ein Bild im Alt-Schema (Bytes in `karte_hintergrundbild.daten`).
    async fn altes_bild(
        pool: &SqlitePool,
        einsatz: i64,
        benutzer: i64,
        daten: &[u8],
        ansicht: Option<i64>,
    ) -> i64 {
        sqlx::query_scalar(
            "INSERT INTO karte_hintergrundbild (einsatz_id, name, daten, mime, groesse, sha256, \
                ecken_json, opazitaet, sichtbar, reihenfolge, ansicht_id, hochgeladen_von) \
             VALUES (?, 'Lageplan.png', ?, 'image/png', ?, ?, '[[0,0],[1,0],[1,1],[0,1]]', 60, 0, \
                (SELECT COUNT(*) FROM karte_hintergrundbild), ?, ?) RETURNING id",
        )
        .bind(einsatz)
        .bind(daten)
        .bind(daten.len() as i64)
        .bind(sha256_hex(daten))
        .bind(ansicht)
        .bind(benutzer)
        .fetch_one(pool)
        .await
        .unwrap()
    }

    /// Bestandsbilder überstehen den Umbau verlustfrei (Bytes und sha256 gleich, Metadaten samt
    /// `ansicht_id`), die Tabelle trägt keine BLOB-Spalte mehr, Index und Fremdschlüssel stehen,
    /// und das Löschen eines Bilds nimmt seine Bytes per CASCADE mit.
    #[tokio::test]
    async fn migration_0154_lagert_bytes_verlustfrei_aus() {
        let pool = pool_bis(SqliteConnectOptions::new().filename(":memory:"), 153).await;
        let (e, b) = bild_grundlage(&pool).await;
        let ansicht: i64 = sqlx::query_scalar(
            "INSERT INTO karten_ansicht (einsatz_id, name) VALUES (?, 'Nord') RETURNING id",
        )
        .bind(e)
        .fetch_one(&pool)
        .await
        .unwrap();
        let eins: Vec<u8> = (0..70_000u32).map(|i| (i % 251) as u8).collect();
        let zwei: Vec<u8> = (0..5_000u32).map(|i| (i % 13) as u8).collect();
        let bild_eins = altes_bild(&pool, e, b, &eins, Some(ansicht)).await;
        let bild_zwei = altes_bild(&pool, e, b, &zwei, None).await;
        type Meta = (i64, String, i64, String, i64, i64, i64, Option<i64>);
        let meta = || async {
            sqlx::query_as::<_, Meta>(
                "SELECT id, name, groesse, sha256, opazitaet, sichtbar, reihenfolge, ansicht_id \
                 FROM karte_hintergrundbild ORDER BY id",
            )
            .fetch_all(&pool)
            .await
            .unwrap()
        };
        let vorher = meta().await;

        migriere_bis(&pool, 154).await;

        assert_eq!(meta().await, vorher, "Metadaten unverändert");
        let spalten: Vec<(String, String)> =
            sqlx::query_as("SELECT name, type FROM pragma_table_info('karte_hintergrundbild')")
                .fetch_all(&pool)
                .await
                .unwrap();
        assert!(
            spalten
                .iter()
                .all(|(name, typ)| name != "daten" && typ != "BLOB"),
            "keine BLOB-Spalte mehr: {spalten:?}"
        );
        for (id, erwartet) in [(bild_eins, &eins), (bild_zwei, &zwei)] {
            let (daten, sha): (Vec<u8>, String) = sqlx::query_as(
                "SELECT d.daten, b.sha256 FROM karte_hintergrundbild_daten d \
                 JOIN karte_hintergrundbild b ON b.id = d.bild_id WHERE d.bild_id = ?",
            )
            .bind(id)
            .fetch_one(&pool)
            .await
            .unwrap();
            assert_eq!(&daten, erwartet, "Bytes von Bild {id}");
            assert_eq!(sha256_hex(&daten), sha, "sha256 von Bild {id}");
        }
        let index: Option<String> = sqlx::query_scalar(
            "SELECT name FROM sqlite_master WHERE type = 'index' \
             AND name = 'idx_karte_hintergrundbild_einsatz' AND tbl_name = 'karte_hintergrundbild'",
        )
        .fetch_optional(&pool)
        .await
        .unwrap();
        assert!(index.is_some(), "Index auf einsatz_id erhalten");
        // Das RENAME hat den Verweis der Bytes auf den endgültigen Namen umgeschrieben.
        let ziel: Vec<(String, String)> = sqlx::query_as(
            "SELECT \"table\", on_delete FROM pragma_foreign_key_list('karte_hintergrundbild_daten')",
        )
        .fetch_all(&pool)
        .await
        .unwrap();
        assert_eq!(
            ziel,
            vec![("karte_hintergrundbild".to_string(), "CASCADE".to_string())]
        );
        let reste: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM sqlite_master WHERE instr(sql, 'karte_hintergrundbild_neu') > 0",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(reste, 0, "kein Verweis auf die Zwischentabelle");
        let verletzungen: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM pragma_foreign_key_check")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(verletzungen, 0);

        // ON DELETE SET NULL der Ansicht und CASCADE der Bytes gelten weiter.
        sqlx::query("DELETE FROM karten_ansicht WHERE id = ?")
            .bind(ansicht)
            .execute(&pool)
            .await
            .unwrap();
        let ansicht_id: Option<i64> =
            sqlx::query_scalar("SELECT ansicht_id FROM karte_hintergrundbild WHERE id = ?")
                .bind(bild_eins)
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(ansicht_id, None);
        sqlx::query("DELETE FROM karte_hintergrundbild WHERE id = ?")
            .bind(bild_eins)
            .execute(&pool)
            .await
            .unwrap();
        let rest: Vec<i64> = sqlx::query_scalar("SELECT bild_id FROM karte_hintergrundbild_daten")
            .fetch_all(&pool)
            .await
            .unwrap();
        assert_eq!(rest, vec![bild_zwei], "CASCADE nimmt die Bytes mit");
    }

    /// Seiten, die die Verbindung von `pool` seit dem letzten Aufruf aus der Datei lesen musste
    /// (`SQLITE_DBSTATUS_CACHE_MISS`, setzt den Zähler zurück).
    async fn gelesene_seiten(pool: &SqlitePool) -> i64 {
        let mut conn = pool.acquire().await.unwrap();
        let mut handle = conn.lock_handle().await.unwrap();
        let (mut aktuell, mut hoechst) = (0i32, 0i32);
        // SAFETY: `handle` hält die Verbindung gesperrt und den Zeiger gültig; die Funktion liest
        // nur Zähler der Verbindung und schreibt in die zwei lokalen Variablen.
        let rc = unsafe {
            libsqlite3_sys::sqlite3_db_status(
                handle.as_raw_handle().as_ptr(),
                libsqlite3_sys::SQLITE_DBSTATUS_CACHE_MISS,
                &mut aktuell,
                &mut hoechst,
                1,
            )
        };
        assert_eq!(rc, libsqlite3_sys::SQLITE_OK);
        i64::from(aktuell)
    }

    /// Akzeptanz LFH-936: Liste und Download-Metadaten von 5 Bildern à 5 MB lesen nach dem Umbau
    /// weniger als 1 % der Bildseiten. Dieselbe Messung vor dem Umbau ist die Gegenprobe: dort
    /// liest die Liste die Überlaufketten aller Bilder, die Messung wird also rot, wenn die
    /// Bytes wieder vor den Metadaten liegen. Gemessen auf einer Datei-DB mit frischer
    /// Verbindung je Messung (leerer Seiten-Cache).
    #[tokio::test]
    async fn migration_0154_liste_und_meta_lesen_keine_bilddaten() {
        const BILDER: usize = 5;
        const GROESSE: usize = 5 * 1024 * 1024;
        let dir = tempfile::tempdir().unwrap();
        let datei = dir.path().join("bilder.db");
        let ort = || {
            SqliteConnectOptions::new()
                .filename(&datei)
                .create_if_missing(true)
        };
        let pool = pool_bis(ort(), 153).await;
        let (e, b) = bild_grundlage(&pool).await;
        let mut ids = Vec::new();
        for n in 0..BILDER {
            ids.push(altes_bild(&pool, e, b, &vec![n as u8 + 1; GROESSE], None).await);
        }
        let seite: i64 = sqlx::query_scalar("PRAGMA page_size")
            .fetch_one(&pool)
            .await
            .unwrap();
        let bildseiten = (BILDER * GROESSE) as i64 / seite;
        pool.close().await;

        let messen = |ids: Vec<i64>| async move {
            let pool = verbinden(ort()).await;
            // Schema laden, bevor gezählt wird.
            sqlx::query("SELECT 1 FROM karte_hintergrundbild LIMIT 0")
                .execute(&pool)
                .await
                .unwrap();
            gelesene_seiten(&pool).await;
            let liste = crate::karte_hintergrundbild::repo::liste(&pool, e, None)
                .await
                .unwrap();
            assert_eq!(liste.len(), BILDER);
            for id in ids {
                crate::karte_hintergrundbild::repo::meta_fuer_download(&pool, e, id)
                    .await
                    .unwrap();
            }
            let gelesen = gelesene_seiten(&pool).await;
            pool.close().await;
            gelesen
        };

        let vorher = messen(ids.clone()).await;
        assert!(
            vorher > bildseiten / 2,
            "Gegenprobe: im Alt-Schema liest die Liste die Bilddaten ({vorher} von {bildseiten} \
             Seiten) — sonst misst der Test nichts"
        );

        let pool = pool_bis(ort(), 154).await;
        pool.close().await;
        let nachher = messen(ids.clone()).await;
        assert!(
            nachher * 100 < bildseiten,
            "Liste und Metadaten lesen {nachher} Seiten, erlaubt < 1 % von {bildseiten}"
        );

        // Die Bytes selbst kommen unverändert.
        let pool = pool_bis(ort(), 154).await;
        let (_, _, daten) = crate::karte_hintergrundbild::repo::laden_bytes(&pool, e, ids[2])
            .await
            .unwrap();
        assert_eq!(daten, vec![3u8; GROESSE]);
    }

    // --- Migration 0159: Gerätekopplung für weitere Stellen (LFH-1040) ---

    /// Der Rebuild von `geraet_kopplung` hält Codes, Ereignisse und Gerätesitzungen (alle drei
    /// hängen per CASCADE an der Tabelle), nimmt die neuen Ansichten, bindet höchstens eine
    /// Stelle und hält eine Kopplung über das Löschen ihres Abschnitts.
    #[tokio::test]
    async fn migration_0159_erhaelt_kinder_und_bindet_hoechstens_eine_stelle() {
        let pool = pool_bis(SqliteConnectOptions::new().filename(":memory:"), 158).await;
        let (e, b) = bild_grundlage(&pool).await;
        let g: i64 = sqlx::query_scalar(
            "INSERT INTO benutzer (org_id, anzeigename, benutzername, passwort_hash) \
             VALUES (1, 'UHS 1 · Tablet', 'geraet-1', 'h') RETURNING id",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        let uhs: i64 = sqlx::query_scalar(
            "INSERT INTO uhs (einsatz_id, typ, bezeichnung, erfasst_von, geaendert_von) \
             VALUES (?, 'sonstige', 'UHS 1', ?, ?) RETURNING id",
        )
        .bind(e)
        .bind(b)
        .bind(b)
        .fetch_one(&pool)
        .await
        .unwrap();
        let k: i64 = sqlx::query_scalar(
            "INSERT INTO geraet_kopplung (einsatz_id, benutzer_id, ansicht, uhs_id, bezeichnung, \
                erstellt_von, laeuft_ab_at) \
             VALUES (?, ?, 'uhs-tablet', ?, 'Tablet', ?, '2099-01-01 00:00:00') RETURNING id",
        )
        .bind(e)
        .bind(g)
        .bind(uhs)
        .bind(b)
        .fetch_one(&pool)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO geraet_kopplungscode (kopplung_id, code_hash, laeuft_ab_at) \
             VALUES (?, 'hash', '2099-01-01 00:00:00')",
        )
        .bind(k)
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO geraet_kopplung_ereignis (kopplung_id, ereignis, von) \
             VALUES (?, 'angelegt', ?)",
        )
        .bind(k)
        .bind(b)
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO session (token_hash, benutzer_id, expires_at, kopplung_id) \
             VALUES ('s1', ?, '2099-01-01 00:00:00', ?)",
        )
        .bind(g)
        .bind(k)
        .execute(&pool)
        .await
        .unwrap();
        let zaehle = |tabelle: &'static str| {
            let pool = pool.clone();
            async move {
                sqlx::query_scalar::<_, i64>(sqlx::AssertSqlSafe(format!(
                    "SELECT COUNT(*) FROM {tabelle}"
                )))
                .fetch_one(&pool)
                .await
                .unwrap()
            }
        };

        migriere_bis(&pool, 159).await;

        for t in [
            "geraet_kopplung",
            "geraet_kopplungscode",
            "geraet_kopplung_ereignis",
            "session",
        ] {
            assert_eq!(zaehle(t).await, 1, "{t} überlebt den Umbau");
        }
        let (ansicht, uhs_nachher): (String, Option<i64>) =
            sqlx::query_as("SELECT ansicht, uhs_id FROM geraet_kopplung WHERE id = ?")
                .bind(k)
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!((ansicht.as_str(), uhs_nachher), ("uhs-tablet", Some(uhs)));
        let fk_verletzungen: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM pragma_foreign_key_check")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(fk_verletzungen, 0, "foreign_key_check ist leer");
        let reste: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM sqlite_master WHERE name = 'geraet_kopplung_neu'",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(reste, 0, "keine Reste der Zwischentabelle");

        // Die Kaskade wirkt weiter auf die umgebaute Tabelle.
        let abschnitt: i64 = sqlx::query_scalar(
            "INSERT INTO einsatzabschnitt (einsatz_id, name) VALUES (?, 'Nord') RETURNING id",
        )
        .bind(e)
        .fetch_one(&pool)
        .await
        .unwrap();
        let neu =
            |benutzer: &'static str, ansicht: &'static str, uhs: Option<i64>, ab: Option<i64>| {
                let pool = pool.clone();
                async move {
                    let g: i64 = sqlx::query_scalar(
                        "INSERT INTO benutzer (org_id, anzeigename, benutzername, passwort_hash) \
                     VALUES (1, ?, ?, 'h') RETURNING id",
                    )
                    .bind(benutzer)
                    .bind(benutzer)
                    .fetch_one(&pool)
                    .await
                    .unwrap();
                    sqlx::query_scalar::<_, i64>(
                        "INSERT INTO geraet_kopplung (einsatz_id, benutzer_id, ansicht, uhs_id, \
                        abschnitt_id, bezeichnung, erstellt_von, laeuft_ab_at) \
                     VALUES (?, ?, ?, ?, ?, 'Gerät', ?, '2099-01-01 00:00:00') RETURNING id",
                    )
                    .bind(e)
                    .bind(g)
                    .bind(ansicht)
                    .bind(uhs)
                    .bind(ab)
                    .bind(b)
                    .fetch_one(&pool)
                    .await
                }
            };
        let am_abschnitt = neu("a", "einsatzabschnitt", None, Some(abschnitt))
            .await
            .expect("der neue CHECK nimmt 'einsatzabschnitt'");
        for a in ["betreuungsstelle", "bereitstellungsraum", "verpflegung"] {
            neu(a, a, None, None)
                .await
                .unwrap_or_else(|f| panic!("der CHECK nimmt {a}: {f}"));
        }
        assert!(
            neu("x", "teleport", None, None).await.is_err(),
            "unbekannte Ansicht abgelehnt"
        );
        assert!(
            neu("y", "einsatzabschnitt", Some(uhs), Some(abschnitt))
                .await
                .is_err(),
            "höchstens eine Stelle"
        );

        // Ein gelöschter Abschnitt hält die (vorher widerrufene) Kopplung: SET NULL.
        sqlx::query("DELETE FROM einsatzabschnitt WHERE id = ?")
            .bind(abschnitt)
            .execute(&pool)
            .await
            .expect("das Löschen des Abschnitts scheitert nicht am Verweis");
        let ab_nachher: Option<i64> =
            sqlx::query_scalar("SELECT abschnitt_id FROM geraet_kopplung WHERE id = ?")
                .bind(am_abschnitt)
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(ab_nachher, None);

        sqlx::query("DELETE FROM geraet_kopplung WHERE id = ?")
            .bind(k)
            .execute(&pool)
            .await
            .unwrap();
        for t in [
            "geraet_kopplungscode",
            "geraet_kopplung_ereignis",
            "session",
        ] {
            assert_eq!(
                zaehle(t).await,
                0,
                "{t} hängt weiter per CASCADE an der Kopplung"
            );
        }
    }

    // --- Migration 0176: freies_zeichen-Rebuild für die Zeichenbeschreibung (LFH-836, D2) ---
    //
    // Geprüft an einem Zeichen, das VOR dem Rebuild existiert (auf der leeren Vorlage bliebe ein
    // Kopierfehler unsichtbar): es übersteht den Umbau mit allen Spalten, die Fremdschlüssel und
    // der Index sind dieselben, CASCADE und SET NULL wirken weiter, und der CHECK verlangt genau
    // eine Form — Zeichenbeschreibung oder Grundzeichen.
    #[tokio::test]
    async fn migration_0176_freies_zeichen_rebuild_erhaelt_bestand_und_verlangt_genau_eine_form() {
        use sqlx::migrate::Migrator;
        use std::borrow::Cow;

        let alle: Vec<_> = sqlx::migrate!("./migrations").iter().cloned().collect();
        let bis = |version: i64| Migrator {
            migrations: Cow::Owned(
                alle.iter()
                    .filter(|m| m.version <= version)
                    .cloned()
                    .collect(),
            ),
            ..Migrator::DEFAULT
        };
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect_with(
                SqliteConnectOptions::new()
                    .filename(":memory:")
                    .foreign_keys(true),
            )
            .await
            .unwrap();
        bis(175).run(&pool).await.expect("Migrationen bis 0175");

        let indizes = || async {
            sqlx::query_scalar::<_, String>(
                "SELECT name FROM sqlite_master WHERE type = 'index' \
                 AND tbl_name = 'freies_zeichen' AND sql IS NOT NULL ORDER BY name",
            )
            .fetch_all(&pool)
            .await
            .unwrap()
        };
        let fremdschluessel = || async {
            sqlx::query_as::<_, (String, String, String, String)>(
                "SELECT \"table\", \"from\", \"to\", on_delete \
                 FROM pragma_foreign_key_list('freies_zeichen') ORDER BY \"from\"",
            )
            .fetch_all(&pool)
            .await
            .unwrap()
        };
        let indizes_vorher = indizes().await;
        let fks_vorher = fremdschluessel().await;
        assert_eq!(
            fks_vorher.len(),
            3,
            "einsatz, benutzer, karten_ansicht: {fks_vorher:?}"
        );

        sqlx::query("INSERT INTO organisation (id, name) VALUES (1, 'Orga')")
            .execute(&pool)
            .await
            .unwrap();
        let b: i64 = sqlx::query_scalar(
            "INSERT INTO benutzer (org_id, anzeigename, benutzername, passwort_hash) \
             VALUES (1, 'L', 'l', 'h') RETURNING id",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        let e: i64 = sqlx::query_scalar(
            "INSERT INTO einsatz (org_id, bezeichnung) VALUES (1, 'Lage') RETURNING id",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        let a: i64 = sqlx::query_scalar(
            "INSERT INTO karten_ansicht (einsatz_id, name) VALUES (?, 'Nord') RETURNING id",
        )
        .bind(e)
        .fetch_one(&pool)
        .await
        .unwrap();
        let z: i64 = sqlx::query_scalar(
            "INSERT INTO freies_zeichen (einsatz_id, lat, lon, grundzeichen, organisation, \
                fachaufgabe, symbol, einheit, funktion, farbe, label, erstellt_von, ansicht_id) \
             VALUES (?, 50.1, 8.6, 'einheit', 'feuerwehr', 'brandbekaempfung', 'kran', 'zug', \
                'zugtrupp', '#ff0000', 'A', ?, ?) RETURNING id",
        )
        .bind(e)
        .bind(b)
        .bind(a)
        .fetch_one(&pool)
        .await
        .unwrap();
        let zeile = |id: i64| {
            let pool = pool.clone();
            async move {
                let r = sqlx::query(
                    "SELECT einsatz_id, lat, lon, grundzeichen, organisation, fachaufgabe, \
                        symbol, einheit, funktion, farbe, label, erstellt_von, erstellt_at, \
                        geaendert_at, ansicht_id FROM freies_zeichen WHERE id = ?",
                )
                .bind(id)
                .fetch_one(&pool)
                .await
                .expect("das Zeichen behält seine id");
                (
                    (
                        r.get::<i64, _>(0),
                        r.get::<f64, _>(1),
                        r.get::<f64, _>(2),
                        r.get::<Option<String>, _>(3),
                    ),
                    (
                        r.get::<Option<String>, _>(4),
                        r.get::<Option<String>, _>(5),
                        r.get::<Option<String>, _>(6),
                        r.get::<Option<String>, _>(7),
                        r.get::<Option<String>, _>(8),
                        r.get::<Option<String>, _>(9),
                        r.get::<Option<String>, _>(10),
                    ),
                    (
                        r.get::<Option<i64>, _>(11),
                        r.get::<String, _>(12),
                        r.get::<String, _>(13),
                        r.get::<Option<i64>, _>(14),
                    ),
                )
            }
        };
        let vor_dem_umbau = zeile(z).await;

        bis(176)
            .run(&pool)
            .await
            .expect("0176 läuft auf einer DB mit Bestand");

        assert_eq!(
            zeile(z).await,
            vor_dem_umbau,
            "Zeile übersteht den Rebuild unverändert"
        );
        let spec: Option<String> =
            sqlx::query_scalar("SELECT zeichen_spec FROM freies_zeichen WHERE id = ?")
                .bind(z)
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(
            spec, None,
            "kein Backfill: der Bestand behält seine Altform"
        );
        assert_eq!(indizes().await, indizes_vorher, "derselbe Index");
        assert_eq!(
            fremdschluessel().await,
            fks_vorher,
            "dieselben Fremdschlüssel"
        );
        let fk: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM pragma_foreign_key_check()")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(fk, 0, "kein hängender Fremdschlüssel nach dem Rebuild");

        // Genau eine Form: Zeichenbeschreibung ohne Grundzeichen geht …
        let spec_json = r#"{"v":1,"freestanding":{"kind":"pictogram","pictogram":"x"}}"#;
        let neu: i64 = sqlx::query_scalar(
            "INSERT INTO freies_zeichen (einsatz_id, lat, lon, zeichen_spec, erstellt_von) \
             VALUES (?, 50.2, 8.7, ?, ?) RETURNING id",
        )
        .bind(e)
        .bind(spec_json)
        .bind(b)
        .fetch_one(&pool)
        .await
        .expect("Zeichenbeschreibung allein ist eine Form");
        // … beide zugleich nicht …
        let beide = sqlx::query(
            "INSERT INTO freies_zeichen (einsatz_id, lat, lon, grundzeichen, zeichen_spec, \
                erstellt_von) VALUES (?, 50.2, 8.7, 'einheit', ?, ?)",
        )
        .bind(e)
        .bind(spec_json)
        .bind(b)
        .execute(&pool)
        .await;
        assert!(beide.is_err(), "beide Formen zugleich verletzen den CHECK");
        // … und keine auch nicht.
        let keine = sqlx::query(
            "INSERT INTO freies_zeichen (einsatz_id, lat, lon, erstellt_von) \
             VALUES (?, 50.2, 8.7, ?)",
        )
        .bind(e)
        .bind(b)
        .execute(&pool)
        .await;
        assert!(keine.is_err(), "keine Form verletzt den CHECK");
        let umschreiben = sqlx::query("UPDATE freies_zeichen SET zeichen_spec = ? WHERE id = ?")
            .bind(spec_json)
            .bind(z)
            .execute(&pool)
            .await;
        assert!(
            umschreiben.is_err(),
            "auch ein UPDATE darf nicht zwei Formen hinterlassen"
        );

        // SET NULL beim Löschen der Ansicht, CASCADE beim Löschen des Einsatzes.
        sqlx::query("DELETE FROM karten_ansicht WHERE id = ?")
            .bind(a)
            .execute(&pool)
            .await
            .unwrap();
        let ansicht: Option<i64> =
            sqlx::query_scalar("SELECT ansicht_id FROM freies_zeichen WHERE id = ?")
                .bind(z)
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(
            ansicht, None,
            "ON DELETE SET NULL auf karten_ansicht wirkt weiter"
        );
        sqlx::query("DELETE FROM einsatz WHERE id = ?")
            .bind(e)
            .execute(&pool)
            .await
            .unwrap();
        let rest: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM freies_zeichen WHERE id IN (?, ?)")
                .bind(z)
                .bind(neu)
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(rest, 0, "ON DELETE CASCADE auf einsatz wirkt weiter");
    }

    // --- Migration 0182: Einheiten je ETB-Eintrag festhalten (LLH-1175) ---

    /// Die Rückfüllung übernimmt für jeden Auftragseintrag die heutigen Einheiten-Empfänger,
    /// also genau das, was der Filter bis 0181 zeigte; andere Empfängertypen und Einträge ohne
    /// Auftrag bleiben draußen. Die Einsatz-Löschung räumt die Zeilen über `etb_eintrag` ab.
    #[tokio::test]
    async fn migration_0182_fuellt_einheiten_aus_den_heutigen_empfaengern() {
        let pool = pool_bis(SqliteConnectOptions::new().filename(":memory:"), 181).await;
        let (e, b) = bild_grundlage(&pool).await;
        let mut einheiten = Vec::new();
        for name in ["Logistiktrupp", "Sanitätszug", "Bergungsgruppe"] {
            einheiten.push(
                sqlx::query_scalar::<_, i64>(
                    "INSERT INTO einsatz_einheit (einsatz_id, name) VALUES (?, ?) RETURNING id",
                )
                .bind(e)
                .bind(name)
                .fetch_one(&pool)
                .await
                .unwrap(),
            );
        }
        let auftrag: i64 = sqlx::query_scalar(
            "INSERT INTO auftrag (einsatz_id, lfd_nr, auftrag_text, erteilt_at, erstellt_von_id) \
             VALUES (?, 1, 'Sandsäcke', '2026-10-12 10:00:00', ?) RETURNING id",
        )
        .bind(e)
        .bind(b)
        .fetch_one(&pool)
        .await
        .unwrap();
        for einheit in &einheiten[..2] {
            sqlx::query(
                "INSERT INTO auftrag_empfaenger (auftrag_id, empfaenger_typ, einheit_id, snap_anzeige) \
                 VALUES (?, 'einheit', ?, 'x')",
            )
            .bind(auftrag)
            .bind(einheit)
            .execute(&pool)
            .await
            .unwrap();
        }
        sqlx::query(
            "INSERT INTO auftrag_empfaenger (auftrag_id, empfaenger_typ, funktion_text, snap_anzeige) \
             VALUES (?, 'funktion', 'S4', 'S4')",
        )
        .bind(auftrag)
        .execute(&pool)
        .await
        .unwrap();
        let mut eintraege = Vec::new();
        for (lfd, auftrag_id) in [(1, Some(auftrag)), (2, Some(auftrag)), (3, None)] {
            eintraege.push(
                sqlx::query_scalar::<_, i64>(
                    "INSERT INTO etb_eintrag (einsatz_id, lfd_nr, typ, inhalt, erfasser_id, \
                        ereigniszeit, auftrag_id) \
                     VALUES (?, ?, 'anordnung', 'x', ?, '2026-10-12 10:00:00', ?) RETURNING id",
                )
                .bind(e)
                .bind(lfd)
                .bind(b)
                .bind(auftrag_id)
                .fetch_one(&pool)
                .await
                .unwrap(),
            );
        }

        migriere_bis(&pool, 182).await;

        let zeilen: Vec<(i64, i64)> = sqlx::query_as(
            "SELECT eintrag_id, einheit_id FROM etb_eintrag_einheit ORDER BY eintrag_id, einheit_id",
        )
        .fetch_all(&pool)
        .await
        .unwrap();
        let (l, s) = (einheiten[0], einheiten[1]);
        assert_eq!(
            zeilen,
            vec![
                (eintraege[0], l),
                (eintraege[0], s),
                (eintraege[1], l),
                (eintraege[1], s)
            ]
        );

        sqlx::query("DELETE FROM einsatz WHERE id = ?")
            .bind(e)
            .execute(&pool)
            .await
            .unwrap();
        let rest: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM etb_eintrag_einheit")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(rest, 0, "ON DELETE CASCADE über etb_eintrag");
    }

    // --- Migration 0193: Kräfte entlassen statt löschen (LLH-1079) ---

    /// Der Neubau der Zeitachse übernimmt den Bestand Zeile für Zeile (samt Fan-out-Bezug und
    /// Streichung), verweist auf Person und Einheit ohne `ON DELETE` und kennt die Quelle
    /// `disposition`. Die Dispositionstabellen tragen den Lebenszustand, der Bestand bleibt aktiv.
    #[tokio::test]
    async fn migration_0193_baut_die_zeitachse_ohne_kaskade_und_uebernimmt_den_bestand() {
        let pool = pool_bis(SqliteConnectOptions::new().filename(":memory:"), 192).await;
        let (e, b) = bild_grundlage(&pool).await;
        let einheit: i64 = sqlx::query_scalar(
            "INSERT INTO einsatz_einheit (einsatz_id, name) VALUES (?, 'Florian 1') RETURNING id",
        )
        .bind(e)
        .fetch_one(&pool)
        .await
        .unwrap();
        let person: i64 = sqlx::query_scalar(
            "INSERT INTO einsatz_personal (einsatz_id, snap_name, einheit_id) \
             VALUES (?, 'Anna', ?) RETURNING id",
        )
        .bind(e)
        .bind(einheit)
        .fetch_one(&pool)
        .await
        .unwrap();
        let ursprung: i64 = sqlx::query_scalar(
            "INSERT INTO einsatz_kraft_zeitachse \
                (einsatz_id, einheit_id, art, zeitpunkt_at, quelle, erfasst_von, erfasst_at) \
             VALUES (?, ?, 'eintreffen', '2026-10-13 06:40:00', 'status', ?, \
                     '2026-10-13 06:40:01') RETURNING id",
        )
        .bind(e)
        .bind(einheit)
        .bind(b)
        .fetch_one(&pool)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO einsatz_kraft_zeitachse \
                (einsatz_id, personal_id, art, zeitpunkt_at, quelle, ursprung_id, notiz, \
                 erfasst_von, erfasst_at, gestrichen_at, gestrichen_von, streichgrund) \
             VALUES (?, ?, 'eintreffen', '2026-10-13 06:40:00', 'einheit', ?, 'Notiz', ?, \
                     '2026-10-13 06:40:01', '2026-10-13 07:00:00', ?, 'verwechselt')",
        )
        .bind(e)
        .bind(person)
        .bind(ursprung)
        .bind(b)
        .bind(b)
        .execute(&pool)
        .await
        .unwrap();
        #[derive(Debug, PartialEq, sqlx::FromRow)]
        struct Zeile {
            id: i64,
            einsatz_id: i64,
            einheit_id: Option<i64>,
            personal_id: Option<i64>,
            art: String,
            zeitpunkt_at: String,
            quelle: String,
            ursprung_id: Option<i64>,
            notiz: Option<String>,
            erfasst_von: i64,
            erfasst_at: String,
            gestrichen_at: Option<String>,
            gestrichen_von: Option<i64>,
            streichgrund: Option<String>,
        }
        let lies = |pool: SqlitePool| async move {
            sqlx::query_as::<_, Zeile>(
                "SELECT id, einsatz_id, einheit_id, personal_id, art, zeitpunkt_at, quelle, \
                        ursprung_id, notiz, erfasst_von, erfasst_at, gestrichen_at, \
                        gestrichen_von, streichgrund \
                 FROM einsatz_kraft_zeitachse ORDER BY id",
            )
            .fetch_all(&pool)
            .await
            .unwrap()
        };
        let vorher = lies(pool.clone()).await;

        migriere_bis(&pool, 193).await;

        assert_eq!(lies(pool.clone()).await, vorher, "Bestand Zeile für Zeile");
        let fks: Vec<(String, String, String)> = sqlx::query_as(
            "SELECT \"from\", \"table\", on_delete \
             FROM pragma_foreign_key_list('einsatz_kraft_zeitachse') ORDER BY \"from\"",
        )
        .fetch_all(&pool)
        .await
        .unwrap();
        let fk = |spalte: &str| {
            fks.iter()
                .find(|(f, _, _)| f == spalte)
                .map(|(_, t, d)| (t.as_str(), d.as_str()))
                .unwrap_or_else(|| panic!("FK {spalte} fehlt: {fks:?}"))
        };
        assert_eq!(fk("einheit_id"), ("einsatz_einheit", "NO ACTION"));
        assert_eq!(fk("personal_id"), ("einsatz_personal", "NO ACTION"));
        assert_eq!(fk("einsatz_id"), ("einsatz", "CASCADE"));
        assert_eq!(
            fk("ursprung_id"),
            ("einsatz_kraft_zeitachse", "SET NULL"),
            "Selbstbezug auf die neue Tabelle, nicht auf die alte"
        );
        let indizes: Vec<String> = sqlx::query_scalar(
            "SELECT name FROM pragma_index_list('einsatz_kraft_zeitachse') \
             WHERE origin = 'c' ORDER BY name",
        )
        .fetch_all(&pool)
        .await
        .unwrap();
        assert_eq!(
            indizes,
            [
                "idx_zeitachse_einheit",
                "idx_zeitachse_einsatz",
                "idx_zeitachse_personal",
                "idx_zeitachse_ursprung"
            ]
        );
        sqlx::query(
            "INSERT INTO einsatz_kraft_zeitachse \
                (einsatz_id, personal_id, art, zeitpunkt_at, quelle, erfasst_von) \
             VALUES (?, ?, 'entlassung', '2026-10-13 14:00:00', 'disposition', ?)",
        )
        .bind(e)
        .bind(person)
        .bind(b)
        .execute(&pool)
        .await
        .expect("Quelle disposition");

        for tabelle in ["einsatz_personal", "einsatz_fahrzeug", "einsatz_material"] {
            let spalten: Vec<String> = sqlx::query_scalar(sqlx::AssertSqlSafe(format!(
                "SELECT name FROM pragma_table_info('{tabelle}') WHERE name LIKE 'beendet_%' \
                 ORDER BY name"
            )))
            .fetch_all(&pool)
            .await
            .unwrap();
            assert_eq!(
                spalten,
                ["beendet_als", "beendet_at", "beendet_von"],
                "{tabelle}"
            );
        }
        let aktiv: (Option<String>, Option<String>) =
            sqlx::query_as("SELECT beendet_at, beendet_als FROM einsatz_personal WHERE id = ?")
                .bind(person)
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(aktiv, (None, None), "Bestand bleibt aktiv");
        let falsch = sqlx::query("UPDATE einsatz_personal SET beendet_als = 'geloescht'")
            .execute(&pool)
            .await;
        assert!(
            falsch.is_err(),
            "beendet_als kennt nur entlassen und storniert"
        );
        let aufgeloest: Option<String> =
            sqlx::query_scalar("SELECT aufgeloest_at FROM einsatz_einheit WHERE id = ?")
                .bind(einheit)
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(aufgeloest, None);
    }

    // --- Migration 0207: Eintreffen am Bereitstellungsraum (LLH-1075) ---

    /// Zeitachse mit Einheit, Person, Fan-out und Streichung auf dem Stand vor 0207; liefert
    /// (einsatz, benutzer, einheit, person).
    async fn bild_zeitachse_vor_0207(pool: &SqlitePool) -> (i64, i64, i64, i64) {
        let (e, b) = bild_grundlage(pool).await;
        let einheit: i64 = sqlx::query_scalar(
            "INSERT INTO einsatz_einheit (einsatz_id, name) VALUES (?, 'HLF 20') RETURNING id",
        )
        .bind(e)
        .fetch_one(pool)
        .await
        .unwrap();
        let person: i64 = sqlx::query_scalar(
            "INSERT INTO einsatz_personal (einsatz_id, snap_name, einheit_id) \
             VALUES (?, 'Anna', ?) RETURNING id",
        )
        .bind(e)
        .bind(einheit)
        .fetch_one(pool)
        .await
        .unwrap();
        let ursprung: i64 = sqlx::query_scalar(
            "INSERT INTO einsatz_kraft_zeitachse \
                (einsatz_id, einheit_id, art, zeitpunkt_at, quelle, erfasst_von, erfasst_at) \
             VALUES (?, ?, 'eintreffen', '2026-10-15 14:00:00', 'status', ?, \
                     '2026-10-15 14:00:01') RETURNING id",
        )
        .bind(e)
        .bind(einheit)
        .bind(b)
        .fetch_one(pool)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO einsatz_kraft_zeitachse \
                (einsatz_id, personal_id, art, zeitpunkt_at, quelle, ursprung_id, notiz, \
                 erfasst_von, erfasst_at, gestrichen_at, gestrichen_von, streichgrund) \
             VALUES (?, ?, 'eintreffen', '2026-10-15 14:00:00', 'einheit', ?, 'Notiz', ?, \
                     '2026-10-15 14:00:01', '2026-10-15 14:10:00', ?, 'verwechselt'), \
                    (?, ?, 'entlassung', '2026-10-15 16:00:00', 'disposition', NULL, NULL, ?, \
                     '2026-10-15 16:00:01', NULL, NULL, NULL)",
        )
        .bind(e)
        .bind(person)
        .bind(ursprung)
        .bind(b)
        .bind(b)
        .bind(e)
        .bind(person)
        .bind(b)
        .execute(pool)
        .await
        .unwrap();
        (e, b, einheit, person)
    }

    #[derive(Debug, PartialEq, sqlx::FromRow)]
    struct ZeitachseZeile {
        id: i64,
        einsatz_id: i64,
        einheit_id: Option<i64>,
        personal_id: Option<i64>,
        art: String,
        zeitpunkt_at: String,
        quelle: String,
        ursprung_id: Option<i64>,
        notiz: Option<String>,
        erfasst_von: i64,
        erfasst_at: String,
        gestrichen_at: Option<String>,
        gestrichen_von: Option<i64>,
        streichgrund: Option<String>,
    }

    async fn zeitachse_zeilen(pool: &SqlitePool) -> Vec<ZeitachseZeile> {
        sqlx::query_as::<_, ZeitachseZeile>(
            "SELECT id, einsatz_id, einheit_id, personal_id, art, zeitpunkt_at, quelle, \
                    ursprung_id, notiz, erfasst_von, erfasst_at, gestrichen_at, \
                    gestrichen_von, streichgrund \
             FROM einsatz_kraft_zeitachse ORDER BY id",
        )
        .fetch_all(pool)
        .await
        .unwrap()
    }

    /// Der Neubau übernimmt den Bestand Zeile für Zeile samt `id`, `ursprung_id` und Streichung;
    /// Fremdschlüssel und Indizes bleiben wie nach 0193.
    #[tokio::test]
    async fn migration_0207_zeitachse_bestand_erhalten() {
        let pool = pool_bis(SqliteConnectOptions::new().filename(":memory:"), 206).await;
        bild_zeitachse_vor_0207(&pool).await;
        let vorher = zeitachse_zeilen(&pool).await;
        assert_eq!(vorher.len(), 3);

        migriere_bis(&pool, 207).await;

        assert_eq!(
            zeitachse_zeilen(&pool).await,
            vorher,
            "Bestand Zeile für Zeile"
        );
        let fks: Vec<(String, String, String)> = sqlx::query_as(
            "SELECT \"from\", \"table\", on_delete \
             FROM pragma_foreign_key_list('einsatz_kraft_zeitachse') ORDER BY \"from\"",
        )
        .fetch_all(&pool)
        .await
        .unwrap();
        let fk = |spalte: &str| {
            fks.iter()
                .find(|(f, _, _)| f == spalte)
                .map(|(_, t, d)| (t.as_str(), d.as_str()))
                .unwrap_or_else(|| panic!("FK {spalte} fehlt: {fks:?}"))
        };
        assert_eq!(fk("einheit_id"), ("einsatz_einheit", "NO ACTION"));
        assert_eq!(fk("personal_id"), ("einsatz_personal", "NO ACTION"));
        assert_eq!(fk("einsatz_id"), ("einsatz", "CASCADE"));
        assert_eq!(
            fk("ursprung_id"),
            ("einsatz_kraft_zeitachse", "SET NULL"),
            "Selbstbezug auf die neue Tabelle, nicht auf die alte"
        );
        let indizes: Vec<String> = sqlx::query_scalar(
            "SELECT name FROM pragma_index_list('einsatz_kraft_zeitachse') \
             WHERE origin = 'c' ORDER BY name",
        )
        .fetch_all(&pool)
        .await
        .unwrap();
        assert_eq!(
            indizes,
            [
                "idx_zeitachse_einheit",
                "idx_zeitachse_einsatz",
                "idx_zeitachse_personal",
                "idx_zeitachse_ursprung"
            ]
        );
        let alt: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM sqlite_master WHERE name = 'einsatz_kraft_zeitachse_alt'",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(alt, 0, "die alte Tabelle ist weg");
    }

    /// LLH-1107: `lat`/`lon` am Bereitstellungsraum. Eine Bestandszeile von vorher behält jeden
    /// Wert, die Koordinate ist leer; beide Spalten existieren.
    #[tokio::test]
    async fn migration_0209_bereitstellungsraum_lage() {
        let pool = pool_bis(SqliteConnectOptions::new().filename(":memory:"), 208).await;
        let (e, b) = bild_grundlage(&pool).await;
        let a: i64 = sqlx::query_scalar(
            "INSERT INTO einsatzabschnitt (einsatz_id, name) VALUES (?, 'Nord') RETURNING id",
        )
        .bind(e)
        .fetch_one(&pool)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO bereitstellungsraum \
                (id, einsatz_id, abschnitt_id, bezeichnung, standort, notiz, status, \
                 erfasst_at, erfasst_von, geaendert_at, geaendert_von, storniert_at) \
             VALUES (7, ?, ?, 'BR Sportplatz', 'Sportplatz Nord', 'Zufahrt Süd', 'aktiv', \
                     '2026-10-01 08:00:00', ?, '2026-10-01 09:00:00', ?, NULL)",
        )
        .bind(e)
        .bind(a)
        .bind(b)
        .bind(b)
        .execute(&pool)
        .await
        .unwrap();
        type Zeile = (
            i64,
            i64,
            Option<i64>,
            String,
            Option<String>,
            Option<String>,
            String,
            String,
            i64,
            String,
            i64,
            Option<String>,
        );
        let lies = |pool: SqlitePool| async move {
            sqlx::query_as::<_, Zeile>(
                "SELECT id, einsatz_id, abschnitt_id, bezeichnung, standort, notiz, status, \
                        erfasst_at, erfasst_von, geaendert_at, geaendert_von, storniert_at \
                 FROM bereitstellungsraum ORDER BY id",
            )
            .fetch_all(&pool)
            .await
            .unwrap()
        };
        let vorher = lies(pool.clone()).await;

        migriere_bis(&pool, 209).await;

        assert_eq!(lies(pool.clone()).await, vorher, "Bestand unverändert");
        let koordinate: (Option<f64>, Option<f64>) =
            sqlx::query_as("SELECT lat, lon FROM bereitstellungsraum WHERE id = 7")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(koordinate, (None, None));
        let spalten: Vec<(String, String)> = sqlx::query_as(
            "SELECT name, type FROM pragma_table_info('bereitstellungsraum') \
             WHERE name IN ('lat', 'lon') ORDER BY name",
        )
        .fetch_all(&pool)
        .await
        .unwrap();
        assert_eq!(
            spalten,
            [
                ("lat".to_string(), "REAL".to_string()),
                ("lon".to_string(), "REAL".to_string())
            ]
        );
    }

    /// Die Quelle `bereitstellungsraum` ist erlaubt, eine unbekannte scheitert weiter am CHECK.
    #[tokio::test]
    async fn migration_0207_quelle_bereitstellungsraum() {
        let pool = pool_bis(SqliteConnectOptions::new().filename(":memory:"), 207).await;
        let (e, b) = bild_grundlage(&pool).await;
        let einheit: i64 = sqlx::query_scalar(
            "INSERT INTO einsatz_einheit (einsatz_id, name) VALUES (?, 'HLF 20') RETURNING id",
        )
        .bind(e)
        .fetch_one(&pool)
        .await
        .unwrap();
        let einfuegen = |quelle: &'static str| {
            let pool = pool.clone();
            async move {
                sqlx::query(
                    "INSERT INTO einsatz_kraft_zeitachse \
                        (einsatz_id, einheit_id, art, zeitpunkt_at, quelle, erfasst_von) \
                     VALUES (?, ?, 'eintreffen', '2026-10-15 14:30:00', ?, ?)",
                )
                .bind(e)
                .bind(einheit)
                .bind(quelle)
                .bind(b)
                .execute(&pool)
                .await
            }
        };
        einfuegen("bereitstellungsraum")
            .await
            .expect("Quelle bereitstellungsraum");
        assert!(einfuegen("tor").await.is_err(), "unbekannte Quelle");
    }

    /// Eine Einheit oder Person mit Ereignissen lässt sich weiter nicht löschen (FK ohne
    /// `ON DELETE`), das Löschen des Einsatzes nimmt alles mit.
    #[tokio::test]
    async fn migration_0207_kraft_mit_zeitachse_nicht_loeschbar() {
        let pool = pool_bis(SqliteConnectOptions::new().filename(":memory:"), 206).await;
        let (e, _b, einheit, person) = bild_zeitachse_vor_0207(&pool).await;
        migriere_bis(&pool, 207).await;

        sqlx::query("UPDATE einsatz_personal SET einheit_id = NULL WHERE id = ?")
            .bind(person)
            .execute(&pool)
            .await
            .unwrap();
        assert!(
            sqlx::query("DELETE FROM einsatz_einheit WHERE id = ?")
                .bind(einheit)
                .execute(&pool)
                .await
                .is_err(),
            "Einheit mit Zeitachse"
        );
        assert!(
            sqlx::query("DELETE FROM einsatz_personal WHERE id = ?")
                .bind(person)
                .execute(&pool)
                .await
                .is_err(),
            "Person mit Zeitachse"
        );
        sqlx::query("DELETE FROM einsatz WHERE id = ?")
            .bind(e)
            .execute(&pool)
            .await
            .expect("der Einsatz nimmt Kräfte und Zeitachse mit");
        let rest: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM einsatz_kraft_zeitachse")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(rest, 0);
    }

    /// `br_belegung.client_id` ist je Einsatz eindeutig, in einem anderen Einsatz frei und ohne
    /// Schlüssel beliebig oft leer; die Einheit trägt die vier Spalten des Kennzeichens. Ein
    /// späterer Neubau von `br_belegung` (LLH-1085) muss Spalte und Teilindex mitnehmen.
    #[tokio::test]
    async fn migration_0207_br_belegung_client_id() {
        let pool = pool_bis(SqliteConnectOptions::new().filename(":memory:"), 207).await;
        let (e, b) = bild_grundlage(&pool).await;
        let e2: i64 = sqlx::query_scalar(
            "INSERT INTO einsatz (org_id, bezeichnung) VALUES (1, 'Lage 2') RETURNING id",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        let mut raeume = Vec::new();
        for einsatz in [e, e2] {
            raeume.push(
                sqlx::query_scalar::<_, i64>(
                    "INSERT INTO bereitstellungsraum (einsatz_id, bezeichnung, erfasst_von, \
                        geaendert_von) VALUES (?, 'BR Sportplatz', ?, ?) RETURNING id",
                )
                .bind(einsatz)
                .bind(b)
                .bind(b)
                .fetch_one(&pool)
                .await
                .unwrap(),
            );
        }
        let belegen = |einsatz: i64, br: i64, client_id: Option<&'static str>| {
            let pool = pool.clone();
            async move {
                sqlx::query(
                    "INSERT INTO br_belegung \
                        (einsatz_id, br_id, objekt_typ, objekt_id, art, erfasst_von, client_id) \
                     VALUES (?, ?, 'einheit', 1, 'eintritt', ?, ?)",
                )
                .bind(einsatz)
                .bind(br)
                .bind(b)
                .bind(client_id)
                .execute(&pool)
                .await
            }
        };
        belegen(e, raeume[0], Some("a1")).await.unwrap();
        assert!(
            belegen(e, raeume[0], Some("a1")).await.is_err(),
            "derselbe Schlüssel im selben Einsatz"
        );
        belegen(e2, raeume[1], Some("a1"))
            .await
            .expect("derselbe Schlüssel in einem anderen Einsatz");
        belegen(e, raeume[0], None).await.unwrap();
        belegen(e, raeume[0], None)
            .await
            .expect("ohne Schlüssel beliebig oft");

        let spalten: Vec<String> = sqlx::query_scalar(
            "SELECT name FROM pragma_table_info('einsatz_einheit') \
             WHERE name LIKE 'uebernahme_%' OR name LIKE 'uebernommen_%' ORDER BY name",
        )
        .fetch_all(&pool)
        .await
        .unwrap();
        assert_eq!(
            spalten,
            [
                "uebernahme_meldung_id",
                "uebernahme_offen_seit",
                "uebernommen_at",
                "uebernommen_von"
            ]
        );
    }

    // --- LLH-1085: Abruf aus dem Bereitstellungsraum (0208) ---

    #[derive(Debug, PartialEq, sqlx::FromRow)]
    struct BelegungZeile {
        id: i64,
        einsatz_id: i64,
        br_id: i64,
        objekt_typ: String,
        objekt_id: i64,
        art: String,
        notiz: Option<String>,
        zeitpunkt_at: String,
        erfasst_von: i64,
        client_id: Option<String>,
    }

    async fn belegung_zeilen(pool: &SqlitePool) -> Vec<BelegungZeile> {
        sqlx::query_as::<_, BelegungZeile>(
            "SELECT id, einsatz_id, br_id, objekt_typ, objekt_id, art, notiz, zeitpunkt_at, \
                    erfasst_von, client_id \
             FROM br_belegung ORDER BY id",
        )
        .fetch_all(pool)
        .await
        .unwrap()
    }

    /// Der Neubau von `br_belegung` (design.md D4) übernimmt den Bestand Zeile für Zeile samt
    /// `id` und `client_id`, hängt die AUTOINCREMENT-Sequenz um (die gelöschte höchste Zeile
    /// bleibt verbraucht), behält Unique-Teilindex und Indizes und lässt die neuen Arten nur mit
    /// den passenden Bezügen zu.
    #[tokio::test]
    async fn migration_0208_br_belegung_neubau_erhaelt_zeilen_sequenz_und_schema() {
        let pool = pool_bis(SqliteConnectOptions::new().filename(":memory:"), 207).await;
        let (e, b) = bild_grundlage(&pool).await;
        let br: i64 = sqlx::query_scalar(
            "INSERT INTO bereitstellungsraum (einsatz_id, bezeichnung, erfasst_von, \
                geaendert_von) VALUES (?, 'BR Sportplatz', ?, ?) RETURNING id",
        )
        .bind(e)
        .bind(b)
        .bind(b)
        .fetch_one(&pool)
        .await
        .unwrap();
        for (art, notiz, client_id) in [
            ("eintritt", None, Some("c-1")),
            ("wechsel", Some("Notiz"), None),
            ("austritt", None, None),
            ("eintritt", None, None),
        ] {
            sqlx::query(
                "INSERT INTO br_belegung (einsatz_id, br_id, objekt_typ, objekt_id, art, notiz, \
                    zeitpunkt_at, erfasst_von, client_id) \
                 VALUES (?, ?, 'einheit', 7, ?, ?, '2026-10-16 13:42:00', ?, ?)",
            )
            .bind(e)
            .bind(br)
            .bind(art)
            .bind(notiz)
            .bind(b)
            .bind(client_id)
            .execute(&pool)
            .await
            .unwrap();
        }
        sqlx::query("DELETE FROM br_belegung WHERE id = 4")
            .execute(&pool)
            .await
            .unwrap();
        let vorher = belegung_zeilen(&pool).await;
        assert_eq!(vorher.len(), 3);

        migriere_bis(&pool, 208).await;

        assert_eq!(
            belegung_zeilen(&pool).await,
            vorher,
            "Bestand Zeile für Zeile"
        );
        let reste: i64 = sqlx::query_scalar(
            "SELECT (SELECT COUNT(*) FROM sqlite_master WHERE name = 'br_belegung_neu') \
                  + (SELECT COUNT(*) FROM sqlite_sequence WHERE name = 'br_belegung_neu')",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(reste, 0, "keine Reste der Zwischentabelle");
        let seq: i64 =
            sqlx::query_scalar("SELECT seq FROM sqlite_sequence WHERE name = 'br_belegung'")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(seq, 4, "Sequenz bleibt der alte Wert");

        let indizes: Vec<String> = sqlx::query_scalar(
            "SELECT name FROM pragma_index_list('br_belegung') WHERE origin = 'c' ORDER BY name",
        )
        .fetch_all(&pool)
        .await
        .unwrap();
        assert_eq!(
            indizes,
            [
                "idx_br_belegung_auftrag",
                "idx_br_belegung_br",
                "idx_br_belegung_client_id",
                "idx_br_belegung_objekt",
                "idx_br_belegung_ziel_abschnitt"
            ]
        );
        let fks: Vec<(String, String, String)> = sqlx::query_as(
            "SELECT \"from\", \"table\", on_delete \
             FROM pragma_foreign_key_list('br_belegung') ORDER BY \"from\"",
        )
        .fetch_all(&pool)
        .await
        .unwrap();
        assert_eq!(
            fks,
            [
                ("auftrag_id".into(), "auftrag".into(), "SET NULL".into()),
                (
                    "br_id".into(),
                    "bereitstellungsraum".into(),
                    "NO ACTION".into()
                ),
                ("einsatz_id".into(), "einsatz".into(), "CASCADE".into()),
                ("erfasst_von".into(), "benutzer".into(), "NO ACTION".into()),
                (
                    "ziel_abschnitt_id".into(),
                    "einsatzabschnitt".into(),
                    "SET NULL".into()
                ),
            ],
            "mit_abruf_id ohne Fremdschlüssel"
        );

        let abschnitt: i64 = sqlx::query_scalar(
            "INSERT INTO einsatzabschnitt (einsatz_id, name) VALUES (?, 'EA Deich') RETURNING id",
        )
        .bind(e)
        .fetch_one(&pool)
        .await
        .unwrap();
        let auftrag: i64 = sqlx::query_scalar(
            "INSERT INTO auftrag (einsatz_id, auftrag_text, erteilt_at, erstellt_von_id) \
             VALUES (?, 'Sandsackverbau', '2026-10-16 14:30:00', ?) RETURNING id",
        )
        .bind(e)
        .bind(b)
        .fetch_one(&pool)
        .await
        .unwrap();
        let einfuegen = |art: &'static str,
                         ziel: Option<i64>,
                         anzeige: Option<&'static str>,
                         auftrag_id: Option<i64>,
                         mit: Option<i64>,
                         client_id: Option<&'static str>| {
            let pool = pool.clone();
            async move {
                sqlx::query_scalar::<_, i64>(
                    "INSERT INTO br_belegung (einsatz_id, br_id, objekt_typ, objekt_id, art, \
                        erfasst_von, ziel_abschnitt_id, ziel_anzeige, auftrag_id, mit_abruf_id, \
                        client_id) \
                     VALUES (?, ?, 'einheit', 8, ?, ?, ?, ?, ?, ?, ?) RETURNING id",
                )
                .bind(e)
                .bind(br)
                .bind(art)
                .bind(b)
                .bind(ziel)
                .bind(anzeige)
                .bind(auftrag_id)
                .bind(mit)
                .bind(client_id)
                .fetch_one(&pool)
                .await
            }
        };
        let abruf = einfuegen(
            "abruf",
            Some(abschnitt),
            Some("EA Deich"),
            Some(auftrag),
            None,
            None,
        )
        .await
        .expect("Abruf mit Ziel und Auftrag");
        assert_eq!(abruf, 5, "nächster Insert über dem alten Höchstwert");
        einfuegen("abruf", None, None, None, Some(abruf), None)
            .await
            .expect("mitgenommene Untereinheit");
        einfuegen("abruf_aufgehoben", None, None, None, None, None)
            .await
            .expect("Rücknahme");
        assert!(
            einfuegen("eintritt", None, Some("EA Deich"), None, None, None)
                .await
                .is_err(),
            "Ziel nur am Abruf"
        );
        assert!(
            einfuegen("austritt", None, None, None, Some(abruf), None)
                .await
                .is_err(),
            "mit_abruf_id nur am Abruf"
        );
        assert!(
            einfuegen("abruf", None, Some("EA Deich"), None, Some(abruf), None)
                .await
                .is_err(),
            "mitgenommen ohne eigenes Ziel"
        );
        assert!(
            einfuegen("umzug", None, None, None, None, None)
                .await
                .is_err(),
            "unbekannte Art"
        );
        assert!(
            einfuegen("eintritt", None, None, None, None, Some("c-1"))
                .await
                .is_err(),
            "client_id bleibt je Einsatz eindeutig"
        );

        sqlx::query("DELETE FROM einsatzabschnitt WHERE id = ?")
            .bind(abschnitt)
            .execute(&pool)
            .await
            .unwrap();
        let (ziel, anzeige): (Option<i64>, Option<String>) =
            sqlx::query_as("SELECT ziel_abschnitt_id, ziel_anzeige FROM br_belegung WHERE id = ?")
                .bind(abruf)
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!((ziel, anzeige.as_deref()), (None, Some("EA Deich")));
    }

    // --- LLH-1042: Einheiten-Vorlagen (0190) ---

    /// Org, Einheitstyp, zwei Fahrzeuge, eine Person und ein Demo-Kopf mit zwei Marken auf dem
    /// Stand vor 0190.
    async fn bild_vor_0190(pool: &SqlitePool) {
        sqlx::raw_sql(
            "INSERT INTO organisation (id, name) VALUES (1, 'Orga'); \
             INSERT INTO einheit_typ (id, org_id, label) VALUES (1, 1, 'Zug'); \
             INSERT INTO fahrzeug (id, org_id, funkrufname) VALUES (1, 1, 'F 1'), (2, 1, 'F 2'); \
             INSERT INTO personal (id, org_id, name) VALUES (1, 1, 'Erika'); \
             INSERT INTO demo_import (id, org_id, einsatz_id, bericht) VALUES (5, 1, 9, '{}'); \
             INSERT INTO demo_herkunft (import_id, tabelle, datensatz_id) \
                 VALUES (5, 'fahrzeug', 2), (5, 'personal', 1);",
        )
        .execute(pool)
        .await
        .unwrap();
    }

    /// `demo_herkunft` wird für die vierte Art neu gebaut: Zeilen, Spalten, Schlüssel und die
    /// Kaskade an `demo_import` bleiben, nur der CHECK kennt `einheit_vorlage` dazu.
    #[tokio::test]
    async fn migration_0190_baut_demo_herkunft_mit_vierter_art_neu() {
        let pool = pool_bis(SqliteConnectOptions::new().filename(":memory:"), 189).await;
        bild_vor_0190(&pool).await;
        let alle = "SELECT import_id, tabelle, datensatz_id FROM demo_herkunft \
                    ORDER BY tabelle, datensatz_id";
        let vorher: Vec<(i64, String, i64)> = sqlx::query_as(alle).fetch_all(&pool).await.unwrap();
        let schema_vorher = schema_von(&pool, "demo_herkunft").await;
        let ddl_vorher = ddl_ohne_namen(&pool, "demo_herkunft").await;

        migriere_bis(&pool, 190).await;

        let nachher: Vec<(i64, String, i64)> = sqlx::query_as(alle).fetch_all(&pool).await.unwrap();
        assert_eq!(nachher, vorher, "jede Marke übersteht den Neubau");
        assert_eq!(schema_von(&pool, "demo_herkunft").await, schema_vorher);
        assert_eq!(
            ddl_ohne_namen(&pool, "demo_herkunft")
                .await
                .replacen(", 'einheit_vorlage'", "", 1),
            ddl_vorher,
            "die DDL unterscheidet sich ausschließlich im tabelle-CHECK"
        );
        sqlx::query(
            "INSERT INTO demo_herkunft (import_id, tabelle, datensatz_id) \
             VALUES (5, 'einheit_vorlage', 1)",
        )
        .execute(&pool)
        .await
        .expect("der neue CHECK nimmt einheit_vorlage");
        assert!(sqlx::query(
            "INSERT INTO demo_herkunft (import_id, tabelle, datensatz_id) VALUES (5, 'foo', 1)"
        )
        .execute(&pool)
        .await
        .is_err());
        sqlx::query("DELETE FROM demo_import WHERE id = 5")
            .execute(&pool)
            .await
            .unwrap();
        let rest: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM demo_herkunft")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(rest, 0, "die Marken hängen weiter per Kaskade am Kopf");
        let reste: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM sqlite_master WHERE name = 'demo_herkunft_neu'",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(reste, 0, "keine Reste der Zwischentabelle");
    }

    /// Die drei Vorlagen-Tabellen: Name eindeutig nur unter aktiven Vorlagen, Soll alle drei
    /// oder keiner, Position nur aus dem Bestand; die Kindtabellen kaskadieren an der Vorlage,
    /// jeder andere Verweis hält fest (NO ACTION).
    #[tokio::test]
    async fn migration_0190_legt_vorlagen_mit_ihren_regeln_an() {
        let pool = pool_bis(SqliteConnectOptions::new().filename(":memory:"), 189).await;
        bild_vor_0190(&pool).await;
        migriere_bis(&pool, 190).await;

        let vorlage = |name: &'static str, ueber: Option<i64>| {
            sqlx::query_scalar::<_, i64>(
                "INSERT INTO einheit_vorlage (org_id, name, typ_id, ueber_vorlage_id) \
                 VALUES (1, ?, 1, ?) RETURNING id",
            )
            .bind(name)
            .bind(ueber)
        };
        let zug = vorlage("Zug", None).fetch_one(&pool).await.unwrap();
        let staffel = vorlage("Staffel", Some(zug))
            .fetch_one(&pool)
            .await
            .unwrap();
        assert!(
            vorlage("Zug", None).fetch_one(&pool).await.is_err(),
            "zwei aktive Vorlagen gleichen Namens"
        );
        sqlx::query("UPDATE einheit_vorlage SET aktiv = 0 WHERE id = ?")
            .bind(zug)
            .execute(&pool)
            .await
            .unwrap();
        let zweiter = vorlage("Zug", None)
            .fetch_one(&pool)
            .await
            .expect("eine deaktivierte Vorlage gibt ihren Namen frei");
        assert!(
            sqlx::query("UPDATE einheit_vorlage SET aktiv = 1 WHERE id = ?")
                .bind(zug)
                .execute(&pool)
                .await
                .is_err()
        );

        assert!(
            sqlx::query("UPDATE einheit_vorlage SET soll_fuehrer = 1 WHERE id = ?")
                .bind(staffel)
                .execute(&pool)
                .await
                .is_err(),
            "ein halbes Soll verletzt den CHECK"
        );
        sqlx::query(
            "UPDATE einheit_vorlage \
             SET soll_fuehrer = 0, soll_unterfuehrer = 1, soll_mannschaft = 5 WHERE id = ?",
        )
        .bind(staffel)
        .execute(&pool)
        .await
        .expect("ein volles Soll");

        sqlx::query(
            "INSERT INTO einheit_vorlage_fahrzeug (vorlage_id, fahrzeug_id) VALUES (?, 1), (?, 2)",
        )
        .bind(staffel)
        .bind(zweiter)
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO einheit_vorlage_personal \
                (vorlage_id, personal_id, fahrzeug_id, staerke_position) \
             VALUES (?, 1, 1, 'unterfuehrer')",
        )
        .bind(staffel)
        .execute(&pool)
        .await
        .unwrap();
        assert!(
            sqlx::query(
                "INSERT INTO einheit_vorlage_personal (vorlage_id, personal_id, staerke_position) \
                 VALUES (?, 1, 'f')",
            )
            .bind(zweiter)
            .execute(&pool)
            .await
            .is_err(),
            "nur die Positionen des Bestands"
        );

        for (sql, was) in [
            (
                "DELETE FROM fahrzeug WHERE id = 1",
                "Fahrzeug einer Vorlage",
            ),
            (
                "DELETE FROM personal WHERE id = 1",
                "Person einer Stammbesetzung",
            ),
            (
                "DELETE FROM einheit_vorlage WHERE id = 1",
                "Vorlage mit Untereinheit",
            ),
        ] {
            let fehler = sqlx::query(sql).execute(&pool).await.expect_err(was);
            assert!(
                matches!(&fehler, sqlx::Error::Database(e) if e.is_foreign_key_violation()),
                "{was}: {fehler:?}"
            );
        }

        sqlx::query("DELETE FROM einheit_vorlage WHERE id = ?")
            .bind(staffel)
            .execute(&pool)
            .await
            .expect("die Untereinheit fällt samt Kindzeilen");
        let kinder: i64 = sqlx::query_scalar(
            "SELECT (SELECT COUNT(*) FROM einheit_vorlage_fahrzeug WHERE vorlage_id = ?1) \
                  + (SELECT COUNT(*) FROM einheit_vorlage_personal WHERE vorlage_id = ?1)",
        )
        .bind(staffel)
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(kinder, 0, "Kindzeilen kaskadieren an der Vorlage");
    }

    // --- Migration 0191: Zugangsprotokoll je Organisation (LLH-1151) ---

    /// Der Bestand bekommt die Org wie beim Schreiben: Anmeldespur über das Konto, sonst über den
    /// versuchten Namen (ohne Groß-/Kleinschreibung), sonst keine; Admin-Spur über die handelnde
    /// Person, sonst über das Zielkonto.
    #[tokio::test]
    async fn migration_0191_ordnet_den_bestand_seiner_org_zu() {
        let pool = pool_bis(SqliteConnectOptions::new().filename(":memory:"), 190).await;
        sqlx::raw_sql(
            "INSERT INTO organisation (id, name) VALUES (1, 'A'), (2, 'B'); \
             INSERT INTO benutzer (id, org_id, anzeigename, benutzername, passwort_hash) \
             VALUES (10, 1, 'a', 'anna', 'h'), (20, 2, 'b', 'bert', 'h'); \
             INSERT INTO auth_audit (id, ereignis, benutzername, benutzer_id, provider) VALUES \
               (1, 'login_ok', 'anna', 10, 'passwort'), \
               (2, 'logout', NULL, 20, 'passwort'), \
               (3, 'login_fehlgeschlagen', 'BERT', NULL, 'passwort'), \
               (4, 'login_fehlgeschlagen', 'niemand', NULL, 'passwort'); \
             INSERT INTO admin_audit (id, aktion, akteur_id, akteur_name, ziel_benutzer_id, ziel) VALUES \
               (1, 'benutzer_angelegt', 10, 'anna', 10, 'anna'), \
               (2, 'anmeldeweg_aktiviert', 20, 'bert', NULL, 'oidc'), \
               (3, 'benutzer_deaktiviert', NULL, 'weg', 20, 'bert'), \
               (4, 'anmeldeweg_deaktiviert', NULL, 'weg', NULL, 'oidc');",
        )
        .execute(&pool)
        .await
        .unwrap();

        migriere_bis(&pool, 191).await;

        let auth: Vec<Option<i64>> =
            sqlx::query_scalar("SELECT org_id FROM auth_audit ORDER BY id")
                .fetch_all(&pool)
                .await
                .unwrap();
        let admin: Vec<Option<i64>> =
            sqlx::query_scalar("SELECT org_id FROM admin_audit ORDER BY id")
                .fetch_all(&pool)
                .await
                .unwrap();
        assert_eq!(auth, [Some(1), Some(2), Some(2), None]);
        assert_eq!(admin, [Some(1), Some(2), Some(2), None]);
    }

    // --- Migration 0192: Altspalten der freien Zeichen entfernt (LLH-1160) ---
    //
    // Geprüft an Zeilen, die VOR dem Rebuild existieren: eine Altzeile bekommt ihre Altwerte als
    // Hülle `{"v":1,"alt":{…}}` (nur gesetzte Felder), eine Zeile mit Beschreibung behält sie
    // unverändert; ids, Bezeichnung, Ansicht und Zeitstempel bleiben, Fremdschlüssel und Index
    // sind dieselben, und `zeichen_spec` ist danach Pflicht.
    #[tokio::test]
    async fn migration_0192_freies_zeichen_huellt_altzeilen_und_entfernt_altspalten() {
        let pool = pool_bis(SqliteConnectOptions::new().filename(":memory:"), 191).await;
        let (e, b) = bild_grundlage(&pool).await;
        let a: i64 = sqlx::query_scalar(
            "INSERT INTO karten_ansicht (einsatz_id, name) VALUES (?, 'Nord') RETURNING id",
        )
        .bind(e)
        .fetch_one(&pool)
        .await
        .unwrap();
        let indizes = || async {
            sqlx::query_scalar::<_, String>(
                "SELECT name FROM sqlite_master WHERE type = 'index' \
                 AND tbl_name = 'freies_zeichen' AND sql IS NOT NULL ORDER BY name",
            )
            .fetch_all(&pool)
            .await
            .unwrap()
        };
        let fremdschluessel = || async {
            sqlx::query_as::<_, (String, String, String, String)>(
                "SELECT \"table\", \"from\", \"to\", on_delete \
                 FROM pragma_foreign_key_list('freies_zeichen') ORDER BY \"from\"",
            )
            .fetch_all(&pool)
            .await
            .unwrap()
        };
        let indizes_vorher = indizes().await;
        let fks_vorher = fremdschluessel().await;

        let voll: i64 = sqlx::query_scalar(
            "INSERT INTO freies_zeichen (einsatz_id, lat, lon, grundzeichen, organisation, \
                fachaufgabe, symbol, einheit, funktion, farbe, label, erstellt_von, ansicht_id, \
                erstellt_at, geaendert_at) \
             VALUES (?, 50.1, 8.6, 'fahrzeug', 'feuerwehr', 'brandbekaempfung', 'drehleiter', \
                'zug', 'fuehrungskraft', '#ff0000', 'A', ?, ?, '2026-10-01 10:00:00', \
                '2026-10-02 11:00:00') RETURNING id",
        )
        .bind(e)
        .bind(b)
        .bind(a)
        .fetch_one(&pool)
        .await
        .unwrap();
        let knapp: i64 = sqlx::query_scalar(
            "INSERT INTO freies_zeichen (einsatz_id, lat, lon, grundzeichen, erstellt_von) \
             VALUES (?, 50.2, 8.7, 'person', ?) RETURNING id",
        )
        .bind(e)
        .bind(b)
        .fetch_one(&pool)
        .await
        .unwrap();
        let spec = r#"{"v":1,"freestanding":{"kind":"state","state":"developed-fire"}}"#;
        let neu: i64 = sqlx::query_scalar(
            "INSERT INTO freies_zeichen (einsatz_id, lat, lon, zeichen_spec, label, erstellt_von) \
             VALUES (?, 50.3, 8.8, ?, 'B', ?) RETURNING id",
        )
        .bind(e)
        .bind(spec)
        .bind(b)
        .fetch_one(&pool)
        .await
        .unwrap();

        migriere_bis(&pool, 192).await;

        let zeile = |id: i64| {
            let pool = pool.clone();
            async move {
                sqlx::query_as::<_, (f64, String, Option<String>, Option<i64>, String, String)>(
                    "SELECT lat, zeichen_spec, label, ansicht_id, erstellt_at, geaendert_at \
                     FROM freies_zeichen WHERE id = ?",
                )
                .bind(id)
                .fetch_one(&pool)
                .await
                .expect("das Zeichen behält seine id")
            }
        };
        let (lat, huelle, label, ansicht, erstellt, geaendert) = zeile(voll).await;
        assert_eq!(
            serde_json::from_str::<serde_json::Value>(&huelle).unwrap(),
            serde_json::json!({"v": 1, "alt": {
                "grundzeichen": "fahrzeug", "organisation": "feuerwehr",
                "fachaufgabe": "brandbekaempfung", "symbol": "drehleiter", "einheit": "zug",
                "funktion": "fuehrungskraft", "farbe": "#ff0000"
            }}),
            "alle Altwerte in der Hülle"
        );
        assert_eq!(
            (
                lat,
                label.as_deref(),
                ansicht,
                erstellt.as_str(),
                geaendert.as_str()
            ),
            (
                50.1,
                Some("A"),
                Some(a),
                "2026-10-01 10:00:00",
                "2026-10-02 11:00:00"
            ),
            "übrige Spalten unverändert"
        );
        assert_eq!(
            zeile(knapp).await.1,
            r#"{"v":1,"alt":{"grundzeichen":"person"}}"#,
            "nur gesetzte Altwerte, kein null"
        );
        assert_eq!(
            zeile(neu).await.1,
            spec,
            "Beschreibung bleibt Zeichen für Zeichen"
        );

        let spalten: Vec<String> =
            sqlx::query_scalar("SELECT name FROM pragma_table_info('freies_zeichen') ORDER BY cid")
                .fetch_all(&pool)
                .await
                .unwrap();
        assert_eq!(
            spalten,
            [
                "id",
                "einsatz_id",
                "lat",
                "lon",
                "zeichen_spec",
                "label",
                "erstellt_von",
                "erstellt_at",
                "geaendert_at",
                "ansicht_id"
            ],
            "Altspalten entfernt"
        );
        assert_eq!(indizes().await, indizes_vorher, "derselbe Index");
        assert_eq!(
            fremdschluessel().await,
            fks_vorher,
            "dieselben Fremdschlüssel"
        );
        let fk: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM pragma_foreign_key_check()")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(fk, 0, "kein hängender Fremdschlüssel nach dem Rebuild");

        let ohne = sqlx::query(
            "INSERT INTO freies_zeichen (einsatz_id, lat, lon, erstellt_von) VALUES (?, 1, 1, ?)",
        )
        .bind(e)
        .bind(b)
        .execute(&pool)
        .await;
        assert!(ohne.is_err(), "zeichen_spec ist Pflicht");

        sqlx::query("DELETE FROM karten_ansicht WHERE id = ?")
            .bind(a)
            .execute(&pool)
            .await
            .unwrap();
        assert_eq!(
            zeile(voll).await.3,
            None,
            "ON DELETE SET NULL auf karten_ansicht wirkt weiter"
        );
        sqlx::query("DELETE FROM einsatz WHERE id = ?")
            .bind(e)
            .execute(&pool)
            .await
            .unwrap();
        let rest: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM freies_zeichen")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(rest, 0, "ON DELETE CASCADE auf einsatz wirkt weiter");
    }

    /// LLH-1224, design.md D6/D12: `material.art` aus Bestandsnummer und Mengen, Neubau von
    /// `einsatz_material` mit Art, Ausgabe, vier Ort-Spalten und den CHECKs, Übernahme jeder Zeile
    /// (verbrauchtes Verbrauchsgut ganz ausgegeben, Desinfektion → defekt, Einheit und UHS → UHS mit
    /// Bemerkung).
    #[tokio::test]
    async fn migration_0197_material_modell_uebernimmt_art_ausgabe_und_einen_ort() {
        let pool = pool_bis(SqliteConnectOptions::new().filename(":memory:"), 195).await;
        let (e, b) = bild_grundlage(&pool).await;
        let einheit: i64 = sqlx::query_scalar(
            "INSERT INTO einsatz_einheit (einsatz_id, name) VALUES (?, 'Rettungsstaffel') \
             RETURNING id",
        )
        .bind(e)
        .fetch_one(&pool)
        .await
        .unwrap();
        let uhs: i64 = sqlx::query_scalar(
            "INSERT INTO uhs (einsatz_id, typ, bezeichnung, erfasst_von, geaendert_von) \
             VALUES (?, 'patientenablage', 'Turnhalle', ?, ?) RETURNING id",
        )
        .bind(e)
        .bind(b)
        .bind(b)
        .fetch_one(&pool)
        .await
        .unwrap();
        let stamm = |bez: &'static str, nr: Option<&'static str>| {
            sqlx::query_scalar::<_, i64>(
                "INSERT INTO material (org_id, bezeichnung, bestandsnummer) VALUES (1, ?, ?) \
                 RETURNING id",
            )
            .bind(bez)
            .bind(nr)
        };
        let mit_nummer = stamm("Stromerzeuger", Some("INV-1"))
            .fetch_one(&pool)
            .await
            .unwrap();
        let decke = stamm("Wolldecke", None).fetch_one(&pool).await.unwrap();
        let funk = stamm("Funkgerät", None).fetch_one(&pool).await.unwrap();
        // (material_id, einheit, uhs, menge, status, bemerkung, beendet)
        type Alt = (
            Option<i64>,
            Option<i64>,
            Option<i64>,
            i64,
            &'static str,
            Option<&'static str>,
            bool,
        );
        let alt: [Alt; 10] = [
            // Stamm mit Bestandsnummer, auch mit Menge 4: der Stamm bleibt Gerät.
            (Some(mit_nummer), None, None, 1, "verbraucht", None, false),
            (
                Some(decke),
                Some(einheit),
                None,
                50,
                "verbraucht",
                None,
                false,
            ),
            (
                Some(decke),
                None,
                None,
                1,
                "desinfektion_noetig",
                Some("nass"),
                false,
            ),
            (Some(funk), None, Some(uhs), 1, "einsatzbereit", None, false),
            (
                None,
                Some(einheit),
                Some(uhs),
                200,
                "im_einsatz",
                None,
                false,
            ),
            (
                None,
                Some(einheit),
                Some(uhs),
                1,
                "defekt",
                Some("B"),
                false,
            ),
            (None, None, None, 3, "einsatzbereit", None, true),
            (None, Some(einheit), None, 1, "im_einsatz", None, false),
            (
                None,
                Some(einheit),
                Some(uhs),
                10,
                "desinfektion_noetig",
                Some("X"),
                false,
            ),
            (
                Some(mit_nummer),
                None,
                None,
                4,
                "einsatzbereit",
                None,
                false,
            ),
        ];
        let mut ids = Vec::new();
        for (mid, eh, u, menge, status, bem, beendet) in alt {
            let id: i64 = sqlx::query_scalar(
                "INSERT INTO einsatz_material \
                    (einsatz_id, material_id, einheit_id, uhs_id, menge, status, \
                     snap_bezeichnung, bemerkung, disponiert_von, beendet_at, beendet_von, \
                     beendet_als, zuletzt_entlassen_at) \
                 VALUES (?, ?, ?, ?, ?, ?, 'Posten', ?, ?, ?, ?, ?, ?) RETURNING id",
            )
            .bind(e)
            .bind(mid)
            .bind(eh)
            .bind(u)
            .bind(menge)
            .bind(status)
            .bind(bem)
            .bind(b)
            .bind(beendet.then_some("2026-10-13 10:00:00"))
            .bind(beendet.then_some(b))
            .bind(beendet.then_some("entlassen"))
            .bind(beendet.then_some("2026-10-13 10:00:00"))
            .fetch_one(&pool)
            .await
            .unwrap();
            ids.push(id);
        }
        let spalten_vorher: Vec<String> = sqlx::query_scalar(
            "SELECT name FROM pragma_table_info('einsatz_material') ORDER BY cid",
        )
        .fetch_all(&pool)
        .await
        .unwrap();

        migriere_bis(&pool, 197).await;

        let art_stamm = |id: i64| {
            let pool = pool.clone();
            async move {
                sqlx::query_scalar::<_, String>("SELECT art FROM material WHERE id = ?")
                    .bind(id)
                    .fetch_one(&pool)
                    .await
                    .unwrap()
            }
        };
        assert_eq!(art_stamm(mit_nummer).await, "geraet", "Bestandsnummer");
        assert_eq!(
            art_stamm(decke).await,
            "verbrauchsgut",
            "einmal mit Menge 50"
        );
        assert_eq!(art_stamm(funk).await, "geraet", "Vorgabe");

        #[derive(Debug, PartialEq, sqlx::FromRow)]
        struct Neu {
            art: String,
            menge: i64,
            ausgegeben: i64,
            status: String,
            einheit_id: Option<i64>,
            uhs_id: Option<i64>,
            einsatz_fahrzeug_id: Option<i64>,
            br_id: Option<i64>,
            bemerkung: Option<String>,
            beendet_als: Option<String>,
            zuletzt_entlassen_at: Option<String>,
        }
        let neu = |art: &str,
                   menge: i64,
                   ausgegeben: i64,
                   status: &str,
                   einheit_id: Option<i64>,
                   uhs_id: Option<i64>,
                   bemerkung: Option<&str>| Neu {
            art: art.into(),
            menge,
            ausgegeben,
            status: status.into(),
            einheit_id,
            uhs_id,
            einsatz_fahrzeug_id: None,
            br_id: None,
            bemerkung: bemerkung.map(Into::into),
            beendet_als: None,
            zuletzt_entlassen_at: None,
        };
        let zeilen: Vec<Neu> = sqlx::query_as(
            "SELECT art, menge, ausgegeben, status, einheit_id, uhs_id, einsatz_fahrzeug_id, \
                    br_id, bemerkung, beendet_als, zuletzt_entlassen_at \
             FROM einsatz_material ORDER BY id",
        )
        .fetch_all(&pool)
        .await
        .unwrap();
        let einheit_text = "Umstellung Material-Modell: vorher zugleich Einheit «Rettungsstaffel»";
        let status_text = "Umstellung Material-Modell: Status vorher «Desinfektion nötig»";
        assert_eq!(
            zeilen,
            [
                neu("geraet", 1, 0, "verbraucht", None, None, None),
                neu(
                    "verbrauchsgut",
                    50,
                    50,
                    "einsatzbereit",
                    Some(einheit),
                    None,
                    None
                ),
                neu(
                    "verbrauchsgut",
                    1,
                    0,
                    "defekt",
                    None,
                    None,
                    Some(&format!("nass\n{status_text}"))
                ),
                neu("geraet", 1, 0, "einsatzbereit", None, Some(uhs), None),
                neu(
                    "verbrauchsgut",
                    200,
                    0,
                    "im_einsatz",
                    None,
                    Some(uhs),
                    Some(einheit_text)
                ),
                neu(
                    "geraet",
                    1,
                    0,
                    "defekt",
                    None,
                    Some(uhs),
                    Some(&format!("B\n{einheit_text}"))
                ),
                Neu {
                    beendet_als: Some("entlassen".into()),
                    zuletzt_entlassen_at: Some("2026-10-13 10:00:00".into()),
                    ..neu("verbrauchsgut", 3, 0, "einsatzbereit", None, None, None)
                },
                neu("geraet", 1, 0, "im_einsatz", Some(einheit), None, None),
                neu(
                    "verbrauchsgut",
                    10,
                    0,
                    "defekt",
                    None,
                    Some(uhs),
                    Some(&format!("X\n{status_text}\n{einheit_text}"))
                ),
                neu("verbrauchsgut", 4, 0, "einsatzbereit", None, None, None),
            ]
        );
        let ids_nachher: Vec<i64> =
            sqlx::query_scalar("SELECT id FROM einsatz_material ORDER BY id")
                .fetch_all(&pool)
                .await
                .unwrap();
        assert_eq!(ids_nachher, ids, "jede Zeile behält ihre ID");

        let spalten_nachher: Vec<String> = sqlx::query_scalar(
            "SELECT name FROM pragma_table_info('einsatz_material') ORDER BY cid",
        )
        .fetch_all(&pool)
        .await
        .unwrap();
        let mut erwartet = spalten_vorher.clone();
        erwartet.extend(["art", "ausgegeben", "einsatz_fahrzeug_id", "br_id"].map(String::from));
        assert_eq!(
            spalten_nachher, erwartet,
            "dieselben Spalten plus die vier neuen"
        );
        let fks: Vec<(String, String, String)> = sqlx::query_as(
            "SELECT \"from\", \"table\", on_delete \
             FROM pragma_foreign_key_list('einsatz_material') ORDER BY \"from\"",
        )
        .fetch_all(&pool)
        .await
        .unwrap();
        let fk = |spalte: &str| {
            fks.iter()
                .find(|(f, _, _)| f == spalte)
                .map(|(_, t, d)| (t.as_str(), d.as_str()))
                .unwrap_or_else(|| panic!("FK {spalte} fehlt: {fks:?}"))
        };
        assert_eq!(fk("einsatz_id"), ("einsatz", "CASCADE"));
        assert_eq!(fk("material_id"), ("material", "NO ACTION"));
        assert_eq!(fk("einheit_id"), ("einsatz_einheit", "NO ACTION"));
        assert_eq!(fk("einsatz_fahrzeug_id"), ("einsatz_fahrzeug", "NO ACTION"));
        assert_eq!(fk("uhs_id"), ("uhs", "NO ACTION"));
        assert_eq!(fk("br_id"), ("bereitstellungsraum", "NO ACTION"));
        assert_eq!(fk("disponiert_von"), ("benutzer", "NO ACTION"));
        assert_eq!(fk("beendet_von"), ("benutzer", "NO ACTION"));
        let indizes: Vec<String> = sqlx::query_scalar(
            "SELECT name FROM pragma_index_list('einsatz_material') \
             WHERE origin = 'c' ORDER BY name",
        )
        .fetch_all(&pool)
        .await
        .unwrap();
        assert_eq!(
            indizes,
            [
                "idx_einsatz_material_br",
                "idx_einsatz_material_einheit",
                "idx_einsatz_material_einsatz",
                "idx_einsatz_material_fahrzeug",
                "idx_einsatz_material_uhs"
            ]
        );

        // Jede CHECK mit einem verbotenen INSERT, daneben ein erlaubter.
        let einfuegen = |art: Option<&'static str>,
                         menge: i64,
                         ausgegeben: i64,
                         status: &'static str,
                         einheit_id: Option<i64>,
                         uhs_id: Option<i64>| {
            let pool = pool.clone();
            async move {
                sqlx::query(
                    "INSERT INTO einsatz_material \
                        (einsatz_id, snap_bezeichnung, art, menge, ausgegeben, status, \
                         einheit_id, uhs_id) \
                     VALUES (?, 'Probe', ?, ?, ?, ?, ?, ?)",
                )
                .bind(e)
                .bind(art)
                .bind(menge)
                .bind(ausgegeben)
                .bind(status)
                .bind(einheit_id)
                .bind(uhs_id)
                .execute(&pool)
                .await
            }
        };
        let g = Some("geraet");
        let v = Some("verbrauchsgut");
        einfuegen(v, 50, 20, "einsatzbereit", None, Some(uhs))
            .await
            .expect("Verbrauchsgut mit Ausgabe an einer UHS");
        einfuegen(g, 1, 0, "desinfektion_noetig", Some(einheit), None)
            .await
            .expect("Gerät zur Desinfektion an einer Einheit");
        for (fall, ergebnis) in [
            (
                "ohne Art",
                einfuegen(None, 1, 0, "einsatzbereit", None, None).await,
            ),
            (
                "unbekannte Art",
                einfuegen(Some("fass"), 1, 0, "einsatzbereit", None, None).await,
            ),
            (
                "Gerät mit Menge 2",
                einfuegen(g, 2, 0, "einsatzbereit", None, None).await,
            ),
            (
                "Gerät mit Ausgabe",
                einfuegen(g, 1, 1, "einsatzbereit", None, None).await,
            ),
            (
                "Ausgabe über der Menge",
                einfuegen(v, 5, 6, "einsatzbereit", None, None).await,
            ),
            (
                "negative Ausgabe",
                einfuegen(v, 5, -1, "einsatzbereit", None, None).await,
            ),
            (
                "Verbrauchsgut verbraucht",
                einfuegen(v, 5, 0, "verbraucht", None, None).await,
            ),
            (
                "Verbrauchsgut zur Desinfektion",
                einfuegen(v, 5, 0, "desinfektion_noetig", None, None).await,
            ),
            (
                "zwei Orte",
                einfuegen(v, 5, 0, "einsatzbereit", Some(einheit), Some(uhs)).await,
            ),
        ] {
            assert!(ergebnis.is_err(), "{fall} muss abgelehnt werden");
        }
        assert!(
            sqlx::query("UPDATE material SET art = 'fass' WHERE id = ?")
                .bind(decke)
                .execute(&pool)
                .await
                .is_err(),
            "Stamm-Art hat einen CHECK"
        );
        sqlx::query("DELETE FROM einsatz WHERE id = ?")
            .bind(e)
            .execute(&pool)
            .await
            .expect("das Löschen des Einsatzes nimmt Material und Orte in einer Anweisung mit");
    }

    /// LLH-1226, design.md D4: `einsatz_material.nachforderung_id` per ADD COLUMN nach dem Neubau
    /// aus 0197, `ON DELETE SET NULL` wie `verpflegung_ausgabe` (0120), Teilindex; der Bestand bleibt
    /// ohne Bezug, und weder das Löschen einer Nachforderung noch das des Einsatzes bleibt am Bezug
    /// hängen.
    #[tokio::test]
    async fn migration_0198_haengt_nachforderung_an_material() {
        let pool = pool_bis(SqliteConnectOptions::new().filename(":memory:"), 197).await;
        let (e, b) = bild_grundlage(&pool).await;
        let alt: i64 = sqlx::query_scalar(
            "INSERT INTO einsatz_material (einsatz_id, snap_bezeichnung, art, menge, disponiert_von) \
             VALUES (?, 'Wolldecke', 'verbrauchsgut', 50, ?) RETURNING id",
        )
        .bind(e)
        .bind(b)
        .fetch_one(&pool)
        .await
        .unwrap();

        migriere_bis(&pool, 198).await;

        let bezug: Option<i64> =
            sqlx::query_scalar("SELECT nachforderung_id FROM einsatz_material WHERE id = ?")
                .bind(alt)
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(bezug, None, "der Bestand bleibt ohne Bezug");
        let fk: Vec<(String, String)> = sqlx::query_as(
            "SELECT \"table\", on_delete FROM pragma_foreign_key_list('einsatz_material') \
             WHERE \"from\" = 'nachforderung_id'",
        )
        .fetch_all(&pool)
        .await
        .unwrap();
        assert_eq!(
            fk,
            vec![("nachforderung".to_string(), "SET NULL".to_string())]
        );
        let index: Option<String> = sqlx::query_scalar(
            "SELECT sql FROM sqlite_master WHERE type = 'index' \
             AND name = 'idx_einsatz_material_nachforderung'",
        )
        .fetch_optional(&pool)
        .await
        .unwrap();
        let index = index.expect("Teilindex angelegt");
        assert!(
            index.contains("WHERE nachforderung_id IS NOT NULL"),
            "{index}"
        );

        let nachforderung = |bez: &'static str| {
            let pool = pool.clone();
            async move {
                sqlx::query_scalar::<_, i64>(
                    "INSERT INTO nachforderung (einsatz_id, art, bezeichnung, adressat_kategorie, \
                         angefordert_at, erstellt_von_id) \
                     VALUES (?, 'Wolldecke', ?, 'leitstelle', '2026-10-15 08:00:00', ?) \
                     RETURNING id",
                )
                .bind(e)
                .bind(bez)
                .bind(b)
                .fetch_one(&pool)
                .await
                .unwrap()
            }
        };
        let n1 = nachforderung("50 Wolldecken").await;
        let n2 = nachforderung("Decken Halle").await;
        let posten = |n: i64| {
            let pool = pool.clone();
            async move {
                sqlx::query_scalar::<_, i64>(
                    "INSERT INTO einsatz_material \
                        (einsatz_id, snap_bezeichnung, art, menge, disponiert_von, nachforderung_id) \
                     VALUES (?, 'Wolldecke', 'verbrauchsgut', 30, ?, ?) RETURNING id",
                )
                .bind(e)
                .bind(b)
                .bind(n)
                .fetch_one(&pool)
                .await
                .unwrap()
            }
        };
        let p1 = posten(n1).await;
        posten(n2).await;
        sqlx::query("DELETE FROM nachforderung WHERE id = ?")
            .bind(n1)
            .execute(&pool)
            .await
            .expect("der Bezug hält das Löschen der Nachforderung nicht auf");
        let bezug: Option<i64> =
            sqlx::query_scalar("SELECT nachforderung_id FROM einsatz_material WHERE id = ?")
                .bind(p1)
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(bezug, None, "ON DELETE SET NULL");
        sqlx::query("DELETE FROM einsatz WHERE id = ?")
            .bind(e)
            .execute(&pool)
            .await
            .expect("das Löschen des Einsatzes nimmt Material und Nachforderung mit");
        let rest: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM einsatz_material")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(rest, 0);
    }

    /// LLH-1082, design.md D1: `nachforderung.betreuungsstelle_id` per ADD COLUMN, `ON DELETE SET
    /// NULL`, Teilindex; der Bestand bleibt ohne Bezug, und weder das Löschen einer Stelle noch das
    /// des Einsatzes bleibt am Bezug hängen.
    #[tokio::test]
    async fn migration_0231_haengt_betreuungsstelle_an_nachforderung() {
        let pool = pool_bis(SqliteConnectOptions::new().filename(":memory:"), 226).await;
        let (e, b) = bild_grundlage(&pool).await;
        let nachforderung = |bez: &'static str| {
            let pool = pool.clone();
            async move {
                sqlx::query_scalar::<_, i64>(
                    "INSERT INTO nachforderung (einsatz_id, art, bezeichnung, adressat_kategorie, \
                         angefordert_at, erstellt_von_id) \
                     VALUES (?, 'Feldbetten', ?, 'leitstelle', '2026-10-20 08:00:00', ?) \
                     RETURNING id",
                )
                .bind(e)
                .bind(bez)
                .bind(b)
                .fetch_one(&pool)
                .await
                .unwrap()
            }
        };
        let alt = nachforderung("40 Feldbetten").await;

        migriere_bis(&pool, 231).await;

        let bezug: Option<i64> =
            sqlx::query_scalar("SELECT betreuungsstelle_id FROM nachforderung WHERE id = ?")
                .bind(alt)
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(bezug, None, "der Bestand bleibt ohne Bezug");
        let fk: Vec<(String, String)> = sqlx::query_as(
            "SELECT \"table\", on_delete FROM pragma_foreign_key_list('nachforderung') \
             WHERE \"from\" = 'betreuungsstelle_id'",
        )
        .fetch_all(&pool)
        .await
        .unwrap();
        assert_eq!(
            fk,
            vec![("betreuungsstelle".to_string(), "SET NULL".to_string())]
        );
        let index: Option<String> = sqlx::query_scalar(
            "SELECT sql FROM sqlite_master WHERE type = 'index' \
             AND name = 'idx_nachforderung_betreuungsstelle'",
        )
        .fetch_optional(&pool)
        .await
        .unwrap();
        let index = index.expect("Teilindex angelegt");
        assert!(
            index.contains("WHERE betreuungsstelle_id IS NOT NULL"),
            "{index}"
        );

        let stelle: i64 = sqlx::query_scalar(
            "INSERT INTO betreuungsstelle (einsatz_id, bezeichnung, art, angelegt_von_id) \
             VALUES (?, 'Turnhalle Ost', 'notunterkunft', ?) RETURNING id",
        )
        .bind(e)
        .bind(b)
        .fetch_one(&pool)
        .await
        .unwrap();
        let neu = nachforderung("Decken").await;
        sqlx::query("UPDATE nachforderung SET betreuungsstelle_id = ? WHERE id = ?")
            .bind(stelle)
            .bind(neu)
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query("DELETE FROM betreuungsstelle WHERE id = ?")
            .bind(stelle)
            .execute(&pool)
            .await
            .expect("der Bezug hält das Löschen der Stelle nicht auf");
        let bezug: Option<i64> =
            sqlx::query_scalar("SELECT betreuungsstelle_id FROM nachforderung WHERE id = ?")
                .bind(neu)
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(bezug, None, "ON DELETE SET NULL");
        sqlx::query("DELETE FROM einsatz WHERE id = ?")
            .bind(e)
            .execute(&pool)
            .await
            .expect("das Löschen des Einsatzes nimmt Nachforderungen und Stellen mit");
    }

    // ── LLH-1040: Verpflegungsstelle (0206) ─────────────────────────────────────────────────

    /// Ein Zeitfenster mit einer Ausgabe auf einer Alt-DB vor 0206; liefert (zeitfenster, ausgabe).
    async fn verpflegung_bestand(pool: &SqlitePool, e: i64, b: i64) -> (i64, i64) {
        let zf: i64 = sqlx::query_scalar(
            "INSERT INTO verpflegung_zeitfenster \
                (einsatz_id, bezeichnung, von_at, bis_at, bedarf_kraefte, bedarf_betreute, \
                 angelegt_von_id) \
             VALUES (?, 'Mittag', '2026-09-24 10:00:00', '2026-09-24 11:30:00', 180, 70, ?) \
             RETURNING id",
        )
        .bind(e)
        .bind(b)
        .fetch_one(pool)
        .await
        .unwrap();
        let aus: i64 = sqlx::query_scalar(
            "INSERT INTO verpflegung_ausgabe \
                (einsatz_id, zeitfenster_id, zeitpunkt_at, menge, ort, erfasst_von_id) \
             VALUES (?, ?, '2026-09-24 10:10:00', 120, 'Deich', ?) RETURNING id",
        )
        .bind(e)
        .bind(zf)
        .bind(b)
        .fetch_one(pool)
        .await
        .unwrap();
        (zf, aus)
    }

    /// Eine Stelle nach 0206 (`geplant`).
    async fn verpflegungsstelle(pool: &SqlitePool, e: i64, b: i64, bez: &str) -> i64 {
        sqlx::query_scalar(
            "INSERT INTO verpflegungsstelle (einsatz_id, bezeichnung, art, angelegt_von_id) \
             VALUES (?, ?, 'feldkueche', ?) RETURNING id",
        )
        .bind(e)
        .bind(bez)
        .bind(b)
        .fetch_one(pool)
        .await
        .unwrap()
    }

    /// LLH-1040, design.md „Migration Plan“: Zeitfenster und Ausgaben vor der Migration bleiben
    /// unverändert lesbar, die neuen Spalten sind `NULL`, es gibt keine Zuordnung.
    #[tokio::test]
    async fn migration_0206_verpflegungsstelle_bestand() {
        let pool = pool_bis(SqliteConnectOptions::new().filename(":memory:"), 206).await;
        let (e, b) = bild_grundlage(&pool).await;
        let (zf, aus) = verpflegung_bestand(&pool, e, b).await;

        migriere_bis(&pool, 206).await;

        let (bez, kraefte, art): (String, i64, Option<String>) = sqlx::query_as(
            "SELECT bezeichnung, bedarf_kraefte, verpflegungsart FROM verpflegung_zeitfenster \
             WHERE id = ?",
        )
        .bind(zf)
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!((bez.as_str(), kraefte, art), ("Mittag", 180, None));
        let (menge, ort, stelle): (i64, Option<String>, Option<i64>) = sqlx::query_as(
            "SELECT menge, ort, verpflegungsstelle_id FROM verpflegung_ausgabe WHERE id = ?",
        )
        .bind(aus)
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!((menge, ort.as_deref(), stelle), (120, Some("Deich"), None));
        let zuordnungen: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM verpflegung_zeitfenster_stelle")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(zuordnungen, 0);
    }

    /// Unbekannte Art, unbekannter Status, `aufgeloest` ohne Zeitpunkt (und ein Zeitpunkt ohne
    /// `aufgeloest`) sowie eine unbekannte Verpflegungsart scheitern am CHECK.
    #[tokio::test]
    async fn migration_0206_verpflegungsstelle_checks() {
        let pool = pool_bis(SqliteConnectOptions::new().filename(":memory:"), 206).await;
        let (e, b) = bild_grundlage(&pool).await;
        let einfuegen =
            |art: &'static str, status: &'static str, aufgeloest: Option<&'static str>| {
                let pool = pool.clone();
                async move {
                    sqlx::query(
                        "INSERT INTO verpflegungsstelle \
                        (einsatz_id, bezeichnung, art, status, aufgeloest_at, angelegt_von_id) \
                     VALUES (?, ?, ?, ?, ?, ?)",
                    )
                    .bind(e)
                    .bind(format!("{art}-{status}-{aufgeloest:?}"))
                    .bind(art)
                    .bind(status)
                    .bind(aufgeloest)
                    .bind(b)
                    .execute(&pool)
                    .await
                }
            };
        for (fall, ergebnis) in [
            ("Art", einfuegen("kantine", "geplant", None).await),
            ("Status", einfuegen("feldkueche", "geschlossen", None).await),
            (
                "aufgelöst ohne Zeitpunkt",
                einfuegen("feldkueche", "aufgeloest", None).await,
            ),
            (
                "Zeitpunkt ohne aufgelöst",
                einfuegen("feldkueche", "aktiv", Some("2026-09-24 12:00:00")).await,
            ),
        ] {
            assert!(ergebnis.is_err(), "{fall} muss abgelehnt werden");
        }
        for (art, status, aufgeloest) in [
            ("feldkueche", "geplant", None),
            ("ausgabestelle", "aktiv", None),
            ("zufuehrung", "aufgeloest", Some("2026-09-24 12:00:00")),
        ] {
            einfuegen(art, status, aufgeloest)
                .await
                .unwrap_or_else(|f| panic!("{art}/{status}: {f}"));
        }
        let (zf, _) = verpflegung_bestand(&pool, e, b).await;
        for (art, ok) in [
            ("warm", true),
            ("kalt", true),
            ("getraenke", true),
            ("heiss", false),
        ] {
            let r =
                sqlx::query("UPDATE verpflegung_zeitfenster SET verpflegungsart = ? WHERE id = ?")
                    .bind(art)
                    .bind(zf)
                    .execute(&pool)
                    .await;
            assert_eq!(r.is_ok(), ok, "{art}");
        }
    }

    /// Die Bezeichnung ist unter den nicht stornierten Stellen eines Einsatzes eindeutig; nach
    /// dem Storno ist sie wieder frei, in einem anderen Einsatz ohnehin.
    #[tokio::test]
    async fn migration_0206_verpflegungsstelle_bezeichnung_eindeutig() {
        let pool = pool_bis(SqliteConnectOptions::new().filename(":memory:"), 206).await;
        let (e, b) = bild_grundlage(&pool).await;
        let erste = verpflegungsstelle(&pool, e, b, "Zuführung Deich").await;
        let zweite = sqlx::query(
            "INSERT INTO verpflegungsstelle (einsatz_id, bezeichnung, art, angelegt_von_id) \
             VALUES (?, 'Zuführung Deich', 'zufuehrung', ?)",
        )
        .bind(e)
        .bind(b)
        .execute(&pool)
        .await;
        assert!(zweite.is_err(), "zweite gleiche Bezeichnung scheitert");
        let e2: i64 = sqlx::query_scalar(
            "INSERT INTO einsatz (org_id, bezeichnung) VALUES (1, 'Andere Lage') RETURNING id",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        verpflegungsstelle(&pool, e2, b, "Zuführung Deich").await;
        sqlx::query("UPDATE verpflegungsstelle SET storniert_at = datetime('now') WHERE id = ?")
            .bind(erste)
            .execute(&pool)
            .await
            .unwrap();
        verpflegungsstelle(&pool, e, b, "Zuführung Deich").await;
    }

    /// Ein Einsatz mit Stelle, Zuordnung und Ausgabe an der Stelle lässt sich löschen.
    #[tokio::test]
    async fn migration_0206_verpflegungsstelle_einsatz_loeschen() {
        let pool = pool_bis(SqliteConnectOptions::new().filename(":memory:"), 206).await;
        let (e, b) = bild_grundlage(&pool).await;
        let (zf, aus) = verpflegung_bestand(&pool, e, b).await;
        let st = verpflegungsstelle(&pool, e, b, "Feldküche BR Sportplatz").await;
        sqlx::query(
            "INSERT INTO verpflegung_zeitfenster_stelle (einsatz_id, zeitfenster_id, stelle_id) \
             VALUES (?, ?, ?)",
        )
        .bind(e)
        .bind(zf)
        .bind(st)
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query("UPDATE verpflegung_ausgabe SET verpflegungsstelle_id = ? WHERE id = ?")
            .bind(st)
            .bind(aus)
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query("DELETE FROM einsatz WHERE id = ?")
            .bind(e)
            .execute(&pool)
            .await
            .expect("das Löschen des Einsatzes nimmt Stelle, Zuordnung und Ausgabe mit");
        for tabelle in [
            "verpflegungsstelle",
            "verpflegung_zeitfenster_stelle",
            "verpflegung_ausgabe",
        ] {
            let rest: i64 = sqlx::query_scalar(sqlx::AssertSqlSafe(format!(
                "SELECT COUNT(*) FROM {tabelle}"
            )))
            .fetch_one(&pool)
            .await
            .unwrap();
            assert_eq!(rest, 0, "{tabelle}");
        }
    }

    // ── LLH-1055: Empfänger einer Verpflegungsausgabe (0210) ────────────────────────────────

    /// Eine Einheit und ein Abschnitt im Einsatz `e`; liefert (einheit, abschnitt).
    async fn empfaenger_bestand(pool: &SqlitePool, e: i64) -> (i64, i64) {
        let einheit: i64 = sqlx::query_scalar(
            "INSERT INTO einsatz_einheit (einsatz_id, name) VALUES (?, '2. Gruppe') RETURNING id",
        )
        .bind(e)
        .fetch_one(pool)
        .await
        .unwrap();
        let abschnitt: i64 = sqlx::query_scalar(
            "INSERT INTO einsatzabschnitt (einsatz_id, name) VALUES (?, 'Deich') RETURNING id",
        )
        .bind(e)
        .fetch_one(pool)
        .await
        .unwrap();
        (einheit, abschnitt)
    }

    /// LLH-1055, design.md „Migration Plan“: Ausgaben vor der Migration bleiben unverändert
    /// lesbar, die neuen Spalten sind `NULL`; beide Indizes sind da.
    #[tokio::test]
    async fn migration_0210_verpflegung_ausgabe_empfaenger_bestand() {
        let pool = pool_bis(SqliteConnectOptions::new().filename(":memory:"), 209).await;
        let (e, b) = bild_grundlage(&pool).await;
        let (_, aus) = verpflegung_bestand(&pool, e, b).await;

        migriere_bis(&pool, 210).await;

        let (menge, ort, einheit, abschnitt): (i64, Option<String>, Option<i64>, Option<i64>) =
            sqlx::query_as(
                "SELECT menge, ort, einheit_id, abschnitt_id FROM verpflegung_ausgabe WHERE id = ?",
            )
            .bind(aus)
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(
            (menge, ort.as_deref(), einheit, abschnitt),
            (120, Some("Deich"), None, None)
        );
        let indizes: Vec<String> = sqlx::query_scalar(
            "SELECT name FROM sqlite_master WHERE type = 'index' \
             AND tbl_name = 'verpflegung_ausgabe' AND name LIKE 'idx_verpflegung_ausgabe_%' \
             ORDER BY name",
        )
        .fetch_all(&pool)
        .await
        .unwrap();
        for name in [
            "idx_verpflegung_ausgabe_abschnitt",
            "idx_verpflegung_ausgabe_einheit",
        ] {
            assert!(indizes.iter().any(|i| i == name), "{name}: {indizes:?}");
        }
    }

    /// Ein gelöschter Abschnitt oder eine gelöschte Einheit leert nur den Verweis; die Ausgabe
    /// bleibt mit ihrer Menge stehen (`ON DELETE SET NULL`).
    #[tokio::test]
    async fn migration_0210_verpflegung_ausgabe_empfaenger_set_null() {
        let pool = pool_bis(SqliteConnectOptions::new().filename(":memory:"), 210).await;
        let (e, b) = bild_grundlage(&pool).await;
        let (_, aus) = verpflegung_bestand(&pool, e, b).await;
        let (einheit, abschnitt) = empfaenger_bestand(&pool, e).await;
        let (_, aus2) = verpflegung_bestand(&pool, e, b).await;
        sqlx::query("UPDATE verpflegung_ausgabe SET abschnitt_id = ? WHERE id = ?")
            .bind(abschnitt)
            .bind(aus)
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query("UPDATE verpflegung_ausgabe SET einheit_id = ? WHERE id = ?")
            .bind(einheit)
            .bind(aus2)
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query("DELETE FROM einsatzabschnitt WHERE id = ?")
            .bind(abschnitt)
            .execute(&pool)
            .await
            .expect("der Empfänger hält das Löschen des Abschnitts nicht auf");
        sqlx::query("DELETE FROM einsatz_einheit WHERE id = ?")
            .bind(einheit)
            .execute(&pool)
            .await
            .expect("der Empfänger hält das Löschen der Einheit nicht auf");
        for id in [aus, aus2] {
            let (menge, einheit_id, abschnitt_id): (i64, Option<i64>, Option<i64>) =
                sqlx::query_as(
                    "SELECT menge, einheit_id, abschnitt_id FROM verpflegung_ausgabe WHERE id = ?",
                )
                .bind(id)
                .fetch_one(&pool)
                .await
                .unwrap();
            assert_eq!((menge, einheit_id, abschnitt_id), (120, None, None), "{id}");
        }
    }

    /// Ein Einsatz mit je einer Ausgabe an eine Einheit und an einen Abschnitt lässt sich löschen.
    #[tokio::test]
    async fn migration_0210_verpflegung_ausgabe_empfaenger_einsatz_loeschen() {
        let pool = pool_bis(SqliteConnectOptions::new().filename(":memory:"), 210).await;
        let (e, b) = bild_grundlage(&pool).await;
        let (_, aus) = verpflegung_bestand(&pool, e, b).await;
        let (_, aus2) = verpflegung_bestand(&pool, e, b).await;
        let (einheit, abschnitt) = empfaenger_bestand(&pool, e).await;
        sqlx::query("UPDATE verpflegung_ausgabe SET einheit_id = ? WHERE id = ?")
            .bind(einheit)
            .bind(aus)
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query("UPDATE verpflegung_ausgabe SET abschnitt_id = ? WHERE id = ?")
            .bind(abschnitt)
            .bind(aus2)
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query("DELETE FROM einsatz WHERE id = ?")
            .bind(e)
            .execute(&pool)
            .await
            .expect("das Löschen des Einsatzes nimmt Ausgaben, Einheit und Abschnitt mit");
        for tabelle in ["verpflegung_ausgabe", "einsatz_einheit", "einsatzabschnitt"] {
            let rest: i64 = sqlx::query_scalar(sqlx::AssertSqlSafe(format!(
                "SELECT COUNT(*) FROM {tabelle}"
            )))
            .fetch_one(&pool)
            .await
            .unwrap();
            assert_eq!(rest, 0, "{tabelle}");
        }
    }

    // --- LLH-1058: Verpflegungsplan der Organisation (0211) ---

    /// Eine Mahlzeit im Verpflegungsplan nach 0211 in Org 1.
    async fn verpflegung_vorlage(
        pool: &SqlitePool,
        bezeichnung: &str,
        beginn: &str,
        ende: &str,
    ) -> Result<i64, sqlx::Error> {
        sqlx::query_scalar(
            "INSERT INTO verpflegung_vorlage (org_id, bezeichnung, beginn, ende) \
             VALUES (1, ?, ?, ?) RETURNING id",
        )
        .bind(bezeichnung)
        .bind(beginn)
        .bind(ende)
        .fetch_one(pool)
        .await
    }

    /// design.md „Migration Plan“: die Tabelle ist nach dem Einspielen leer und nimmt eine
    /// Mahlzeit mit Vorgaben (aktiv, ohne Art) an; Nachtverpflegung über Mitternacht geht.
    #[tokio::test]
    async fn migration_0211_verpflegung_vorlage_leer_und_vorgaben() {
        let pool = pool_bis(SqliteConnectOptions::new().filename(":memory:"), 211).await;
        bild_grundlage(&pool).await;
        let n: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM verpflegung_vorlage")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(n, 0);
        let id = verpflegung_vorlage(&pool, "Frühstück", "06:30", "08:00")
            .await
            .unwrap();
        let (aktiv, art): (i64, Option<String>) =
            sqlx::query_as("SELECT aktiv, verpflegungsart FROM verpflegung_vorlage WHERE id = ?")
                .bind(id)
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!((aktiv, art), (1, None));
        verpflegung_vorlage(&pool, "Nachtverpflegung", "23:00", "01:00")
            .await
            .expect("Ende vor Beginn ist der Folgetag");
    }

    /// Die CHECKs lehnen „24:00“, „6:30“, „6.30“, gleiches Ende und eine unbekannte Art ab.
    #[tokio::test]
    async fn migration_0211_verpflegung_vorlage_checks() {
        let pool = pool_bis(SqliteConnectOptions::new().filename(":memory:"), 211).await;
        bild_grundlage(&pool).await;
        for (fall, beginn, ende) in [
            ("24:00", "24:00", "08:00"),
            ("6:30", "6:30", "08:00"),
            ("6.30", "06:30", "8.00"),
            ("Minute 60", "06:60", "08:00"),
            ("gleiches Ende", "12:00", "12:00"),
        ] {
            assert!(
                verpflegung_vorlage(&pool, fall, beginn, ende)
                    .await
                    .is_err(),
                "{fall} muss abgelehnt werden"
            );
        }
        let id = verpflegung_vorlage(&pool, "Mittag", "12:00", "13:30")
            .await
            .unwrap();
        for (art, ok) in [
            ("warm", true),
            ("kalt", true),
            ("getraenke", true),
            ("heiss", false),
        ] {
            let r = sqlx::query("UPDATE verpflegung_vorlage SET verpflegungsart = ? WHERE id = ?")
                .bind(art)
                .bind(id)
                .execute(&pool)
                .await;
            assert_eq!(r.is_ok(), ok, "{art}");
        }
        let r = sqlx::query("UPDATE verpflegung_vorlage SET aktiv = 2 WHERE id = ?")
            .bind(id)
            .execute(&pool)
            .await;
        assert!(r.is_err(), "aktiv nur 0 oder 1");
    }

    /// Der Name ist unter den aktiven Mahlzeiten einer Org eindeutig; ein deaktivierter Name ist
    /// wieder frei.
    #[tokio::test]
    async fn migration_0211_verpflegung_vorlage_name_frei_nach_deaktivieren() {
        let pool = pool_bis(SqliteConnectOptions::new().filename(":memory:"), 211).await;
        bild_grundlage(&pool).await;
        let erste = verpflegung_vorlage(&pool, "Mittag", "12:00", "13:30")
            .await
            .unwrap();
        assert!(
            verpflegung_vorlage(&pool, "Mittag", "11:30", "13:00")
                .await
                .is_err(),
            "zweite aktive „Mittag“ scheitert am Index"
        );
        sqlx::query("UPDATE verpflegung_vorlage SET aktiv = 0 WHERE id = ?")
            .bind(erste)
            .execute(&pool)
            .await
            .unwrap();
        verpflegung_vorlage(&pool, "Mittag", "11:30", "13:00")
            .await
            .expect("deaktivierter Name ist wieder frei");
    }

    // --- LLH-1122: Schichtmodelle und Neubau der Ablösung (0212) ---

    /// Eine Schicht im Bestand vor 0212, alle Spalten aus 0114.
    #[derive(Debug, PartialEq, sqlx::FromRow)]
    struct SchichtVor0212 {
        id: i64,
        einsatz_id: i64,
        einheit_id: i64,
        abschnitt_id: Option<i64>,
        beginn_at: String,
        rhythmus_minuten: i64,
        rhythmus_quelle: String,
        faellig_at: String,
        abloesende_einheit_id: Option<i64>,
        status: String,
        vollzogen_at: Option<String>,
        vollzogen_von_id: Option<i64>,
        vorgaenger_id: Option<i64>,
        etb_vollzug_id: Option<i64>,
        angelegt_von_id: i64,
        angelegt_at: String,
    }

    async fn schichten_vor_0212(pool: &SqlitePool) -> Vec<SchichtVor0212> {
        sqlx::query_as(
            "SELECT id, einsatz_id, einheit_id, abschnitt_id, beginn_at, rhythmus_minuten, \
                    rhythmus_quelle, faellig_at, abloesende_einheit_id, status, vollzogen_at, \
                    vollzogen_von_id, vorgaenger_id, etb_vollzug_id, angelegt_von_id, angelegt_at \
             FROM einsatz_abloesung ORDER BY id",
        )
        .fetch_all(pool)
        .await
        .unwrap()
    }

    /// Bestand vor 0212: zwei Einheiten, ein Abschnitt, eine abgelöste Schicht mit Folgeschicht
    /// (Selbstverweis) und eine laufende im Abschnitt; die ids haben eine Lücke. Liefert
    /// (einsatz, benutzer, einheit 1, einheit 2, abschnitt).
    async fn bild_vor_0212(pool: &SqlitePool) -> (i64, i64, i64, i64, i64) {
        let (e, b) = bild_grundlage(pool).await;
        let abschnitt: i64 = sqlx::query_scalar(
            "INSERT INTO einsatzabschnitt (einsatz_id, name) VALUES (?, 'Deich Nord') RETURNING id",
        )
        .bind(e)
        .fetch_one(pool)
        .await
        .unwrap();
        let mut einheiten = Vec::new();
        for name in ["Florian 1", "Florian 2", "Florian 3"] {
            einheiten.push(
                sqlx::query_scalar::<_, i64>(
                    "INSERT INTO einsatz_einheit (einsatz_id, name) VALUES (?, ?) RETURNING id",
                )
                .bind(e)
                .bind(name)
                .fetch_one(pool)
                .await
                .unwrap(),
            );
        }
        let etb: i64 = sqlx::query_scalar(
            "INSERT INTO etb_eintrag (einsatz_id, lfd_nr, typ, inhalt, erfasser_id, ereigniszeit) \
             VALUES (?, 1, 'meldung', 'Ablösung vollzogen', ?, '2026-10-16 11:50:00') RETURNING id",
        )
        .bind(e)
        .bind(b)
        .fetch_one(pool)
        .await
        .unwrap();
        sqlx::raw_sql(sqlx::AssertSqlSafe(format!(
            "INSERT INTO einsatz_abloesung (id, einsatz_id, einheit_id, abschnitt_id, beginn_at, \
                rhythmus_minuten, rhythmus_quelle, faellig_at, abloesende_einheit_id, status, \
                vollzogen_at, vollzogen_von_id, vorgaenger_id, etb_vollzug_id, angelegt_von_id, \
                angelegt_at) VALUES \
             (1, {e}, {e1}, {a}, '2026-10-16 06:00:00', 360, 'abschnitt', '2026-10-16 12:00:00', \
              {e2}, 'abgeloest', '2026-10-16 11:50:00', {b}, NULL, {etb}, {b}, '2026-10-16 06:00:01'), \
             (2, {e}, {e3}, NULL, '2026-10-16 07:00:00', 480, 'einheit', '2026-10-16 15:00:00', \
              NULL, 'laufend', NULL, NULL, NULL, NULL, {b}, '2026-10-16 07:00:01'), \
             (4, {e}, {e2}, {a}, '2026-10-16 11:50:00', 360, 'abschnitt', '2026-10-16 17:50:00', \
              NULL, 'laufend', NULL, NULL, 1, NULL, {b}, '2026-10-16 11:50:01');",
            e1 = einheiten[0],
            e2 = einheiten[1],
            e3 = einheiten[2],
            a = abschnitt,
        )))
        .execute(pool)
        .await
        .unwrap();
        (e, b, einheiten[0], einheiten[1], abschnitt)
    }

    /// Der Neubau übernimmt jede Zeile mit ihrer id, hält den Selbstverweis (das DROP der alten
    /// Tabelle darf `vorgaenger_id` nicht leeren), legt die Indizes wortgleich neu an, zeigt mit
    /// dem Selbstbezug auf die neue Tabelle und lässt keine Reste. Neue Spalten tragen ihre
    /// Vorgaben, `foreign_key_check` ist leer.
    #[tokio::test]
    async fn migration_0212_baut_die_abloesung_neu_und_erhaelt_den_bestand() {
        let pool = pool_bis(SqliteConnectOptions::new().filename(":memory:"), 211).await;
        let (_e, _b, _e1, _e2, abschnitt) = bild_vor_0212(&pool).await;
        let vorher = schichten_vor_0212(&pool).await;
        assert_eq!(vorher.len(), 3);
        assert_eq!(
            vorher[2].vorgaenger_id,
            Some(1),
            "Bild trägt den Selbstverweis"
        );

        migriere_bis(&pool, 212).await;

        assert_eq!(
            schichten_vor_0212(&pool).await,
            vorher,
            "Bestand Zeile für Zeile, ids samt Lücke, Selbstverweis erhalten"
        );
        let neu: Vec<(
            String,
            i64,
            Option<String>,
            Option<i64>,
            Option<String>,
            Option<i64>,
        )> = sqlx::query_as(
            "SELECT art, abschnitt_uebergeben, beendet_at, beendet_von_id, beendet_grund, \
                        abgeloest_abschnitt_vorher_id \
                 FROM einsatz_abloesung ORDER BY id",
        )
        .fetch_all(&pool)
        .await
        .unwrap();
        assert!(
            neu.iter()
                .all(|z| *z == ("einheit".into(), 0, None, None, None, None)),
            "neue Spalten mit ihren Vorgaben: {neu:?}"
        );

        let fks: Vec<(String, String, String)> = sqlx::query_as(
            "SELECT \"from\", \"table\", on_delete \
             FROM pragma_foreign_key_list('einsatz_abloesung') ORDER BY \"from\"",
        )
        .fetch_all(&pool)
        .await
        .unwrap();
        let fk = |spalte: &str| {
            fks.iter()
                .find(|(f, _, _)| f == spalte)
                .map(|(_, t, d)| (t.as_str(), d.as_str()))
                .unwrap_or_else(|| panic!("FK {spalte} fehlt: {fks:?}"))
        };
        assert_eq!(fk("einsatz_id"), ("einsatz", "CASCADE"));
        assert_eq!(fk("einheit_id"), ("einsatz_einheit", "CASCADE"));
        assert_eq!(fk("abschnitt_id"), ("einsatzabschnitt", "SET NULL"));
        assert_eq!(fk("abloesende_einheit_id"), ("einsatz_einheit", "SET NULL"));
        assert_eq!(
            fk("vorgaenger_id"),
            ("einsatz_abloesung", "SET NULL"),
            "Selbstbezug auf die neue Tabelle, nicht auf die alte"
        );
        assert_eq!(fk("etb_vollzug_id"), ("etb_eintrag", "NO ACTION"));
        assert_eq!(
            fk("abgeloest_abschnitt_vorher_id"),
            ("einsatzabschnitt", "SET NULL")
        );
        assert_eq!(fk("beendet_von_id"), ("benutzer", "NO ACTION"));

        let indizes: Vec<(String, i64)> = sqlx::query_as(
            "SELECT name, \"unique\" FROM pragma_index_list('einsatz_abloesung') \
             WHERE origin = 'c' ORDER BY name",
        )
        .fetch_all(&pool)
        .await
        .unwrap();
        assert_eq!(
            indizes,
            [
                ("idx_abloesung_einsatz".to_string(), 0),
                ("idx_abloesung_laufend_je_einheit".to_string(), 1),
                ("idx_abloesung_vorgaenger".to_string(), 0),
            ]
        );
        let teilindizes: Vec<String> = sqlx::query_scalar(
            "SELECT sql FROM sqlite_master WHERE type = 'index' \
               AND name IN ('idx_abloesung_laufend_je_einheit', 'idx_abloesung_vorgaenger') \
             ORDER BY name",
        )
        .fetch_all(&pool)
        .await
        .unwrap();
        assert!(teilindizes[0].contains("WHERE status = 'laufend'"));
        assert!(teilindizes[1].contains("WHERE vorgaenger_id IS NOT NULL"));

        let reste: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM sqlite_master WHERE name LIKE 'einsatz_abloesung_alt%'",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(reste, 0, "keine Reste der alten Tabelle");
        let fk_verletzungen: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM pragma_foreign_key_check")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(fk_verletzungen, 0, "foreign_key_check ist leer");

        // Der Selbstbezug wirkt auf der neuen Tabelle: die abgelöste Schicht fällt, die
        // Folgeschicht verliert nur ihren Verweis.
        sqlx::query("DELETE FROM einsatz_abloesung WHERE id = 1")
            .execute(&pool)
            .await
            .unwrap();
        let vorgaenger: Option<i64> =
            sqlx::query_scalar("SELECT vorgaenger_id FROM einsatz_abloesung WHERE id = 4")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(vorgaenger, None);
        sqlx::query("DELETE FROM einsatzabschnitt WHERE id = ?")
            .bind(abschnitt)
            .execute(&pool)
            .await
            .unwrap();
        let abschnitt_nachher: Option<i64> =
            sqlx::query_scalar("SELECT abschnitt_id FROM einsatz_abloesung WHERE id = 4")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(abschnitt_nachher, None, "Abschnitt fällt per SET NULL");
    }

    /// Die erweiterten CHECKs: Quelle `einsatz`, Status `beendet`, Art `besatzung`; Unbekanntes
    /// scheitert. Die Teilindizes halten weiter höchstens eine laufende Schicht je Einheit.
    #[tokio::test]
    async fn migration_0212_abloesung_checks_und_teilindex() {
        let pool = pool_bis(SqliteConnectOptions::new().filename(":memory:"), 211).await;
        let (e, b, e1, _e2, _a) = bild_vor_0212(&pool).await;
        migriere_bis(&pool, 212).await;
        let einfuegen = |quelle: &'static str, status: &'static str, art: &'static str| {
            let pool = pool.clone();
            async move {
                sqlx::query(
                    "INSERT INTO einsatz_abloesung (einsatz_id, einheit_id, beginn_at, \
                        rhythmus_minuten, rhythmus_quelle, faellig_at, status, art, \
                        angelegt_von_id, beendet_at, beendet_grund) \
                     VALUES (?, ?, '2026-10-16 12:00:00', 720, ?, '2026-10-17 00:00:00', ?, ?, \
                             ?, CASE WHEN ? = 'beendet' THEN '2026-10-16 13:00:00' END, \
                             CASE WHEN ? = 'beendet' THEN 'entlassung' END)",
                )
                .bind(e)
                .bind(e1)
                .bind(quelle)
                .bind(status)
                .bind(art)
                .bind(b)
                .bind(status)
                .bind(status)
                .execute(&pool)
                .await
            }
        };
        einfuegen("einsatz", "laufend", "einheit")
            .await
            .expect("Quelle einsatz");
        assert!(
            einfuegen("einheit", "laufend", "einheit").await.is_err(),
            "zweite laufende Schicht der Einheit"
        );
        einfuegen("einsatz", "beendet", "besatzung")
            .await
            .expect("Status beendet, Art besatzung");
        assert!(einfuegen("org", "beendet", "einheit").await.is_err());
        assert!(einfuegen("einsatz", "offen", "einheit").await.is_err());
        assert!(einfuegen("einsatz", "beendet", "fahrzeug").await.is_err());
        let r = sqlx::query(
            "UPDATE einsatz_abloesung SET abschnitt_uebergeben = 2 WHERE einheit_id = ?",
        )
        .bind(e1)
        .execute(&pool)
        .await;
        assert!(r.is_err(), "abschnitt_uebergeben nur 0 oder 1");
    }

    /// Die Liste der Ablöser: je Schicht und Einheit eine Zeile, fällt mit Schicht und Einheit,
    /// verliert nur den Vorher-Abschnitt mit dem Abschnitt.
    #[tokio::test]
    async fn migration_0212_abloeser_liste() {
        let pool = pool_bis(SqliteConnectOptions::new().filename(":memory:"), 212).await;
        let (e, _b) = bild_grundlage(&pool).await;
        let b: i64 = sqlx::query_scalar("SELECT id FROM benutzer LIMIT 1")
            .fetch_one(&pool)
            .await
            .unwrap();
        let a: i64 = sqlx::query_scalar(
            "INSERT INTO einsatzabschnitt (einsatz_id, name) VALUES (?, 'Nord') RETURNING id",
        )
        .bind(e)
        .fetch_one(&pool)
        .await
        .unwrap();
        let mut einheiten = Vec::new();
        for name in ["A", "B", "C"] {
            einheiten.push(
                sqlx::query_scalar::<_, i64>(
                    "INSERT INTO einsatz_einheit (einsatz_id, name) VALUES (?, ?) RETURNING id",
                )
                .bind(e)
                .bind(name)
                .fetch_one(&pool)
                .await
                .unwrap(),
            );
        }
        let schicht: i64 = sqlx::query_scalar(
            "INSERT INTO einsatz_abloesung (einsatz_id, einheit_id, beginn_at, rhythmus_minuten, \
                rhythmus_quelle, faellig_at, angelegt_von_id) \
             VALUES (?, ?, '2026-10-16 06:00:00', 720, 'einsatz', '2026-10-16 18:00:00', ?) \
             RETURNING id",
        )
        .bind(e)
        .bind(einheiten[0])
        .bind(b)
        .fetch_one(&pool)
        .await
        .unwrap();
        for (einheit, vorher) in [(einheiten[1], Some(a)), (einheiten[2], None)] {
            sqlx::query(
                "INSERT INTO einsatz_abloesung_abloeser (abloesung_id, einheit_id, \
                    abschnitt_vorher_id) VALUES (?, ?, ?)",
            )
            .bind(schicht)
            .bind(einheit)
            .bind(vorher)
            .execute(&pool)
            .await
            .unwrap();
        }
        assert!(
            sqlx::query(
                "INSERT INTO einsatz_abloesung_abloeser (abloesung_id, einheit_id) VALUES (?, ?)"
            )
            .bind(schicht)
            .bind(einheiten[1])
            .execute(&pool)
            .await
            .is_err(),
            "dieselbe Einheit nur einmal je Schicht"
        );
        let zaehle = || {
            let pool = pool.clone();
            async move {
                sqlx::query_as::<_, (i64, i64)>(
                    "SELECT COUNT(*), COUNT(abschnitt_vorher_id) FROM einsatz_abloesung_abloeser",
                )
                .fetch_one(&pool)
                .await
                .unwrap()
            }
        };
        assert_eq!(zaehle().await, (2, 1));
        sqlx::query("DELETE FROM einsatzabschnitt WHERE id = ?")
            .bind(a)
            .execute(&pool)
            .await
            .unwrap();
        assert_eq!(
            zaehle().await,
            (2, 0),
            "Vorher-Abschnitt fällt per SET NULL"
        );
        sqlx::query("DELETE FROM einsatz_einheit WHERE id = ?")
            .bind(einheiten[2])
            .execute(&pool)
            .await
            .unwrap();
        assert_eq!(zaehle().await, (1, 0), "Zeile fällt mit der Einheit");
        sqlx::query("DELETE FROM einsatz_abloesung WHERE id = ?")
            .bind(schicht)
            .execute(&pool)
            .await
            .unwrap();
        assert_eq!(zaehle().await, (0, 0), "Zeilen fallen mit der Schicht");
    }

    /// LLH-1132: 0215 legt die Marke `uebernommen_bei_vollzug` an (Vorgabe 0, nur 0/1) und
    /// übernimmt jede Einzelplanung `abloesende_einheit_id` als genau eine Zeile in die Liste,
    /// laufend wie abgelöst; Schichten ohne Verweis bekommen keine.
    #[tokio::test]
    async fn migration_0215_uebernimmt_die_einzelplanung_in_die_liste() {
        let pool = pool_bis(SqliteConnectOptions::new().filename(":memory:"), 212).await;
        let (e, _b) = bild_grundlage(&pool).await;
        let b: i64 = sqlx::query_scalar("SELECT id FROM benutzer LIMIT 1")
            .fetch_one(&pool)
            .await
            .unwrap();
        let mut einheiten = Vec::new();
        for name in ["A", "B", "C", "D"] {
            einheiten.push(
                sqlx::query_scalar::<_, i64>(
                    "INSERT INTO einsatz_einheit (einsatz_id, name) VALUES (?, ?) RETURNING id",
                )
                .bind(e)
                .bind(name)
                .fetch_one(&pool)
                .await
                .unwrap(),
            );
        }
        let mut schichten = Vec::new();
        for (einheit, abloeser, status) in [
            (einheiten[0], Some(einheiten[1]), "abgeloest"),
            (einheiten[2], Some(einheiten[3]), "laufend"),
            (einheiten[1], None, "laufend"),
        ] {
            schichten.push(
                sqlx::query_scalar::<_, i64>(
                    "INSERT INTO einsatz_abloesung (einsatz_id, einheit_id, beginn_at, \
                        rhythmus_minuten, rhythmus_quelle, faellig_at, abloesende_einheit_id, \
                        status, angelegt_von_id) \
                     VALUES (?, ?, '2026-10-16 06:00:00', 720, 'einheit', \
                        '2026-10-16 18:00:00', ?, ?, ?) RETURNING id",
                )
                .bind(e)
                .bind(einheit)
                .bind(abloeser)
                .bind(status)
                .bind(b)
                .fetch_one(&pool)
                .await
                .unwrap(),
            );
        }

        migriere_bis(&pool, 215).await;

        let liste: Vec<(i64, i64, Option<i64>)> = sqlx::query_as(
            "SELECT abloesung_id, einheit_id, abschnitt_vorher_id FROM einsatz_abloesung_abloeser \
             ORDER BY rowid",
        )
        .fetch_all(&pool)
        .await
        .unwrap();
        assert_eq!(
            liste,
            vec![
                (schichten[0], einheiten[1], None),
                (schichten[1], einheiten[3], None)
            ]
        );
        let marken: Vec<i64> =
            sqlx::query_scalar("SELECT uebernommen_bei_vollzug FROM einsatz_abloesung ORDER BY id")
                .fetch_all(&pool)
                .await
                .unwrap();
        assert_eq!(marken, vec![0, 0, 0], "Vorgabe 0 für den Bestand");
        assert!(
            sqlx::query("UPDATE einsatz_abloesung SET uebernommen_bei_vollzug = 2 WHERE id = ?")
                .bind(schichten[0])
                .execute(&pool)
                .await
                .is_err(),
            "nur 0 oder 1"
        );
    }

    /// LLH-1150: 0216 legt die Besatzung einer Schicht an (alte und neue beim
    /// Besatzungswechsel). Rolle nur `alt`/`neu`, Marke nur 0/1, je Person einmal je Schicht;
    /// die Zeilen fallen mit der Schicht, der Person und dem Einsatz, Vorher-Verweise per SET NULL.
    #[tokio::test]
    async fn migration_0216_besatzung_einer_schicht() {
        let pool = pool_bis(SqliteConnectOptions::new().filename(":memory:"), 216).await;
        let (e, b) = bild_grundlage(&pool).await;
        let einheit: i64 = sqlx::query_scalar(
            "INSERT INTO einsatz_einheit (einsatz_id, name) VALUES (?, 'Florian 1') RETURNING id",
        )
        .bind(e)
        .fetch_one(&pool)
        .await
        .unwrap();
        let schicht: i64 = sqlx::query_scalar(
            "INSERT INTO einsatz_abloesung (einsatz_id, einheit_id, beginn_at, rhythmus_minuten, \
                rhythmus_quelle, faellig_at, angelegt_von_id, art, status) \
             VALUES (?, ?, '2026-10-16 06:00:00', 720, 'einheit', '2026-10-16 18:00:00', ?, \
                'besatzung', 'abgeloest') RETURNING id",
        )
        .bind(e)
        .bind(einheit)
        .bind(b)
        .fetch_one(&pool)
        .await
        .unwrap();
        let mut personen = Vec::new();
        for name in ["Alt", "Neu"] {
            personen.push(
                sqlx::query_scalar::<_, i64>(
                    "INSERT INTO einsatz_personal (einsatz_id, snap_name) VALUES (?, ?) \
                     RETURNING id",
                )
                .bind(e)
                .bind(name)
                .fetch_one(&pool)
                .await
                .unwrap(),
            );
        }
        let zeile = |person: i64, rolle: &'static str, vorher: Option<i64>, fuehrer: i64| {
            let pool = pool.clone();
            async move {
                sqlx::query(
                    "INSERT INTO einsatz_abloesung_besatzung (abloesung_id, personal_id, rolle, \
                        einheit_vorher_id, war_fuehrer) VALUES (?, ?, ?, ?, ?)",
                )
                .bind(schicht)
                .bind(person)
                .bind(rolle)
                .bind(vorher)
                .bind(fuehrer)
                .execute(&pool)
                .await
            }
        };
        zeile(personen[0], "alt", Some(einheit), 1).await.unwrap();
        zeile(personen[1], "neu", None, 0).await.unwrap();
        assert!(
            zeile(personen[0], "neu", None, 0).await.is_err(),
            "je Person einmal je Schicht"
        );
        let andere: i64 = sqlx::query_scalar(
            "INSERT INTO einsatz_personal (einsatz_id, snap_name) VALUES (?, 'X') RETURNING id",
        )
        .bind(e)
        .fetch_one(&pool)
        .await
        .unwrap();
        assert!(
            zeile(andere, "weg", None, 0).await.is_err(),
            "Rolle alt/neu"
        );
        assert!(zeile(andere, "alt", None, 2).await.is_err(), "Marke 0/1");
        let zaehle = || {
            let pool = pool.clone();
            async move {
                sqlx::query_as::<_, (i64, i64)>(
                    "SELECT COUNT(*), COUNT(einheit_vorher_id) FROM einsatz_abloesung_besatzung",
                )
                .fetch_one(&pool)
                .await
                .unwrap()
            }
        };
        assert_eq!(zaehle().await, (2, 1));
        sqlx::query("DELETE FROM einsatz_personal WHERE id = ?")
            .bind(personen[1])
            .execute(&pool)
            .await
            .unwrap();
        assert_eq!(zaehle().await, (1, 1), "Zeile fällt mit der Person");
        sqlx::query("DELETE FROM einsatz_abloesung WHERE id = ?")
            .bind(schicht)
            .execute(&pool)
            .await
            .unwrap();
        assert_eq!(zaehle().await, (0, 0), "Zeilen fallen mit der Schicht");
    }

    /// `demo_herkunft` bekommt die fünfte Art: Marken bleiben, nur der CHECK ist weiter.
    #[tokio::test]
    async fn migration_0212_baut_demo_herkunft_mit_schichtmodell_neu() {
        let pool = pool_bis(SqliteConnectOptions::new().filename(":memory:"), 189).await;
        bild_vor_0190(&pool).await;
        migriere_bis(&pool, 211).await;
        sqlx::query(
            "INSERT INTO demo_herkunft (import_id, tabelle, datensatz_id) \
             VALUES (5, 'einheit_vorlage', 3)",
        )
        .execute(&pool)
        .await
        .unwrap();
        let alle = "SELECT import_id, tabelle, datensatz_id FROM demo_herkunft \
                    ORDER BY tabelle, datensatz_id";
        let vorher: Vec<(i64, String, i64)> = sqlx::query_as(alle).fetch_all(&pool).await.unwrap();
        let schema_vorher = schema_von(&pool, "demo_herkunft").await;
        let ddl_vorher = ddl_ohne_namen(&pool, "demo_herkunft").await;

        migriere_bis(&pool, 212).await;

        let nachher: Vec<(i64, String, i64)> = sqlx::query_as(alle).fetch_all(&pool).await.unwrap();
        assert_eq!(nachher, vorher, "jede Marke übersteht den Neubau");
        assert_eq!(schema_von(&pool, "demo_herkunft").await, schema_vorher);
        assert_eq!(
            ddl_ohne_namen(&pool, "demo_herkunft")
                .await
                .replacen(", 'schichtmodell'", "", 1),
            ddl_vorher,
            "die DDL unterscheidet sich ausschließlich im tabelle-CHECK"
        );
        sqlx::query(
            "INSERT INTO demo_herkunft (import_id, tabelle, datensatz_id) \
             VALUES (5, 'schichtmodell', 1)",
        )
        .execute(&pool)
        .await
        .expect("der neue CHECK nimmt schichtmodell");
        assert!(sqlx::query(
            "INSERT INTO demo_herkunft (import_id, tabelle, datensatz_id) VALUES (5, 'foo', 1)"
        )
        .execute(&pool)
        .await
        .is_err());
        let reste: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM sqlite_master WHERE name = 'demo_herkunft_neu'",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(reste, 0, "keine Reste der Zwischentabelle");
        sqlx::query("DELETE FROM demo_import WHERE id = 5")
            .execute(&pool)
            .await
            .unwrap();
        let rest: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM demo_herkunft")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(rest, 0, "die Marken hängen weiter per Kaskade am Kopf");
    }

    /// Schichtmodell-Tabellen: höchstens eine Vorgabe und jeder Name einmal je Org, Typ und
    /// Werte passen zusammen, Vorgaben 30/120 min; die Kopie am Einsatz fällt mit dem Einsatz
    /// und hängt an keinem Modell.
    #[tokio::test]
    async fn migration_0212_schichtmodell_regeln() {
        let pool = pool_bis(SqliteConnectOptions::new().filename(":memory:"), 212).await;
        let (e, _b) = bild_grundlage(&pool).await;
        sqlx::query("INSERT INTO organisation (id, name) VALUES (2, 'Andere')")
            .execute(&pool)
            .await
            .unwrap();
        let modell = |org: i64,
                      name: &'static str,
                      typ: &'static str,
                      rhythmus: Option<i64>,
                      wechsel: Option<&'static str>,
                      mindest: Option<i64>,
                      vorgabe: i64| {
            let pool = pool.clone();
            async move {
                sqlx::query_scalar::<_, i64>(
                    "INSERT INTO schichtmodell (org_id, bezeichnung, typ, rhythmus_minuten, \
                        wechselzeiten, mindestdauer_minuten, ist_vorgabe) \
                     VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id",
                )
                .bind(org)
                .bind(name)
                .bind(typ)
                .bind(rhythmus)
                .bind(wechsel)
                .bind(mindest)
                .bind(vorgabe)
                .fetch_one(&pool)
                .await
            }
        };
        let san = modell(1, "Sanitätsdienst", "rhythmus", Some(360), None, None, 1)
            .await
            .unwrap();
        let (vorwarnung, vorlauf): (i64, i64) = sqlx::query_as(
            "SELECT vorwarnung_minuten, planungsvorlauf_minuten FROM schichtmodell WHERE id = ?",
        )
        .bind(san)
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!((vorwarnung, vorlauf), (30, 120));
        modell(
            1,
            "Hochwasser",
            "wechselzeiten",
            None,
            Some(r#"["06:00","18:00"]"#),
            Some(240),
            0,
        )
        .await
        .expect("Wechselzeiten");
        assert!(
            modell(1, "Zweite", "rhythmus", Some(60), None, None, 1)
                .await
                .is_err(),
            "zweite Vorgabe der Org"
        );
        modell(2, "Fremd", "rhythmus", Some(60), None, None, 1)
            .await
            .expect("andere Org hat ihre eigene Vorgabe");
        assert!(
            modell(1, "Sanitätsdienst", "rhythmus", Some(60), None, None, 0)
                .await
                .is_err(),
            "Name je Org eindeutig"
        );
        for (typ, r, w, m) in [
            ("rhythmus", None, None, None),
            ("rhythmus", Some(60), Some(r#"["06:00"]"#), Some(0)),
            ("wechselzeiten", None, Some(r#"["06:00"]"#), None),
            ("wechselzeiten", Some(60), Some(r#"["06:00"]"#), Some(0)),
            ("wechselzeiten", None, Some("06:00"), Some(0)),
            ("wechselzeiten", None, Some("[]"), Some(0)),
            ("wechselzeiten", None, Some(r#"["06:00"]"#), Some(1441)),
            ("schicht", Some(60), None, None),
        ] {
            assert!(
                modell(1, "Kaputt", typ, r, w, m, 0).await.is_err(),
                "{typ} {r:?} {w:?} {m:?}"
            );
        }

        sqlx::query(
            "INSERT INTO einsatz_schichtmodell (einsatz_id, bezeichnung, typ, rhythmus_minuten, \
                vorwarnung_minuten, planungsvorlauf_minuten) \
             VALUES (?, 'Sanitätsdienst', 'rhythmus', 360, 30, 120)",
        )
        .bind(e)
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query("DELETE FROM schichtmodell WHERE id = ?")
            .bind(san)
            .execute(&pool)
            .await
            .expect("ein kopiertes Modell lässt sich löschen");
        let kopie: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM einsatz_schichtmodell")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(kopie, 1, "die Kopie bleibt");
        sqlx::query("DELETE FROM einsatz WHERE id = ?")
            .bind(e)
            .execute(&pool)
            .await
            .unwrap();
        let kopie: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM einsatz_schichtmodell")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(kopie, 0, "die Kopie fällt mit dem Einsatz");
    }

    /// LLH-1131: `benachrichtigung` bekommt die Hinweise der Ablösung. Zeilen samt ids, Spalten,
    /// Schlüssel und Indizes bleiben; die DDL unterscheidet sich nur in der `art`-Liste, die
    /// neuen Arten gehen durch, eine unbekannte nicht, und die Kaskade am Einsatz hält.
    #[tokio::test]
    async fn migration_0214_baut_benachrichtigung_mit_den_hinweisen_der_abloesung_neu() {
        let pool = pool_bis(SqliteConnectOptions::new().filename(":memory:"), 213).await;
        let (e, b) = bild_grundlage(&pool).await;
        sqlx::raw_sql(sqlx::AssertSqlSafe(format!(
            "INSERT INTO benachrichtigung (id, einsatz_id, benutzer_id, art, stufe, bezug_typ, \
                bezug_id, ausloeser_id, erstellt_at, quittiert_at) VALUES \
             (3, {e}, {b}, 'abloesung_faellig', 'alarm', 'abloesung', 7, NULL, \
              '2026-10-17 08:00:00', NULL), \
             (9, {e}, {b}, 'auftrag_erteilt', 'hinweis', 'auftrag', 2, {b}, \
              '2026-10-17 08:05:00', '2026-10-17 08:06:00');"
        )))
        .execute(&pool)
        .await
        .unwrap();
        let alle = "SELECT id, art, stufe, bezug_typ, bezug_id, ausloeser_id, erstellt_at, \
                           quittiert_at FROM benachrichtigung ORDER BY id";
        type Zeile = (
            i64,
            String,
            String,
            String,
            i64,
            Option<i64>,
            String,
            Option<String>,
        );
        let vorher: Vec<Zeile> = sqlx::query_as(alle).fetch_all(&pool).await.unwrap();
        let schema_vorher = schema_von(&pool, "benachrichtigung").await;
        let ddl_vorher = ddl_ohne_namen(&pool, "benachrichtigung").await;
        assert!(
            sqlx::query(
                "INSERT INTO benachrichtigung (einsatz_id, benutzer_id, art, stufe, bezug_typ, \
                    bezug_id, erstellt_at) \
                 VALUES (?, ?, 'abloesung_planung', 'hinweis', 'abloesung', 7, 'x')"
            )
            .bind(e)
            .bind(b)
            .execute(&pool)
            .await
            .is_err(),
            "vor 0214 kennt der CHECK die neue Art nicht"
        );

        migriere_bis(&pool, 214).await;

        let nachher: Vec<Zeile> = sqlx::query_as(alle).fetch_all(&pool).await.unwrap();
        assert_eq!(
            nachher, vorher,
            "jede Zeile übersteht den Neubau mit ihrer id"
        );
        assert_eq!(schema_von(&pool, "benachrichtigung").await, schema_vorher);
        assert_eq!(
            ddl_ohne_namen(&pool, "benachrichtigung").await.replacen(
                " 'abloesung_planung', 'abloesung_abloeser',",
                "",
                1
            ),
            ddl_vorher,
            "die DDL unterscheidet sich ausschließlich im art-CHECK"
        );
        for art in ["abloesung_planung", "abloesung_abloeser"] {
            sqlx::query(
                "INSERT INTO benachrichtigung (einsatz_id, benutzer_id, art, stufe, bezug_typ, \
                    bezug_id, erstellt_at) VALUES (?, ?, ?, 'hinweis', 'abloeser_eingetroffen', 7, 'x')",
            )
            .bind(e)
            .bind(b)
            .bind(art)
            .execute(&pool)
            .await
            .unwrap_or_else(|f| panic!("{art}: {f}"));
        }
        assert!(sqlx::query(
            "INSERT INTO benachrichtigung (einsatz_id, benutzer_id, art, stufe, bezug_typ, \
                bezug_id, erstellt_at) VALUES (?, ?, 'erfunden', 'hinweis', 'abloesung', 7, 'x')"
        )
        .bind(e)
        .bind(b)
        .execute(&pool)
        .await
        .is_err());
        let reste: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM sqlite_master WHERE name = 'benachrichtigung_neu'",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(reste, 0, "keine Reste der Zwischentabelle");
        sqlx::query("DELETE FROM einsatz WHERE id = ?")
            .bind(e)
            .execute(&pool)
            .await
            .unwrap();
        let rest: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM benachrichtigung")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(rest, 0, "die Zeilen fallen weiter mit dem Einsatz");
    }

    /// LLH-1051: beide Anlagen-Linker bekommen die Art `lageplan`. Zeilen samt ids, Spalten,
    /// Schlüssel und Indizes bleiben; die DDL unterscheidet sich nur in der `art`-Liste, die neue
    /// Art geht durch, eine unbekannte nicht, und die Kaskade an der Datei hält.
    #[tokio::test]
    async fn migration_0230_baut_die_anlagen_linker_mit_der_art_lageplan_neu() {
        let pool = pool_bis(SqliteConnectOptions::new().filename(":memory:"), 229).await;
        let (e, b) = bild_grundlage(&pool).await;
        let anhang = |name: &'static str| {
            let pool = pool.clone();
            async move {
                sqlx::query_scalar::<_, i64>(
                    "INSERT INTO anhang (einsatz_id, dateiname, mime, groesse, sha256, daten, \
                        hochgeladen_von) VALUES (?, ?, 'image/png', 3, 'x', X'010203', ?) \
                     RETURNING id",
                )
                .bind(e)
                .bind(name)
                .bind(b)
                .fetch_one(&pool)
                .await
                .unwrap()
            }
        };
        let lb: i64 = sqlx::query_scalar(
            "INSERT INTO lagebericht (einsatz_id, vorlage, titel, zeitstand, abschnitte, \
                ersteller_id) VALUES (?, 'lagebericht', 'LB', '2026-10-20 08:00:00', '[]', ?) \
             RETURNING id",
        )
        .bind(e)
        .bind(b)
        .fetch_one(&pool)
        .await
        .unwrap();
        let bf: i64 = sqlx::query_scalar(
            "INSERT INTO befehl (einsatz_id, vorlage, titel, zeitstand, abschnitte, \
                ersteller_id) VALUES (?, 'befehl_lad', 'B', '2026-10-20 08:00:00', '[]', ?) \
             RETURNING id",
        )
        .bind(e)
        .bind(b)
        .fetch_one(&pool)
        .await
        .unwrap();
        let (a1, a2, a3) = (
            anhang("a.png").await,
            anhang("b.png").await,
            anhang("c.png").await,
        );
        sqlx::raw_sql(sqlx::AssertSqlSafe(format!(
            "INSERT INTO lagebericht_anlage (id, einsatz_id, lagebericht_id, anhang_id, art, \
                titel, stand_at, reihenfolge, abgelegt_von_id, abgelegt_at) VALUES \
             (4, {e}, {lb}, {a1}, 'fernmeldeskizze', 'Fernmeldeskizze', '2026-10-20 08:01:00', \
              1, {b}, '2026-10-20 08:02:00'); \
             INSERT INTO befehl_anlage (id, einsatz_id, befehl_id, anhang_id, art, titel, \
                stand_at, reihenfolge, abgelegt_von_id, abgelegt_at) VALUES \
             (7, {e}, {bf}, {a2}, 'fernmeldeskizze', 'Skizze', '2026-10-20 08:03:00', 1, {b}, \
              '2026-10-20 08:04:00');"
        )))
        .execute(&pool)
        .await
        .unwrap();
        type Zeile = (i64, i64, i64, i64, String, String, String, i64, i64, String);
        let mut vorher = Vec::new();
        for (tabelle, spalte) in [
            ("lagebericht_anlage", "lagebericht_id"),
            ("befehl_anlage", "befehl_id"),
        ] {
            let alle = format!(
                "SELECT id, einsatz_id, {spalte}, anhang_id, art, titel, stand_at, reihenfolge, \
                    abgelegt_von_id, abgelegt_at FROM {tabelle} ORDER BY id"
            );
            let zeilen: Vec<Zeile> = sqlx::query_as(sqlx::AssertSqlSafe(alle.clone()))
                .fetch_all(&pool)
                .await
                .unwrap();
            vorher.push((
                tabelle,
                alle,
                zeilen,
                schema_von(&pool, tabelle).await,
                ddl_ohne_namen(&pool, tabelle).await,
            ));
        }
        let lageplan_an = |tabelle: &'static str, spalte: &'static str, dokument: i64| {
            let pool = pool.clone();
            async move {
                sqlx::query(sqlx::AssertSqlSafe(format!(
                    "INSERT INTO {tabelle} (einsatz_id, {spalte}, anhang_id, art, titel, \
                        stand_at, reihenfolge, abgelegt_von_id) \
                     VALUES (?, ?, ?, 'lageplan', 'Lageplan', '2026-10-20 09:00:00', 2, ?)"
                )))
                .bind(e)
                .bind(dokument)
                .bind(a3)
                .bind(b)
                .execute(&pool)
                .await
            }
        };
        assert!(
            lageplan_an("lagebericht_anlage", "lagebericht_id", lb)
                .await
                .is_err(),
            "vor 0230 kennt der CHECK den Lageplan nicht"
        );

        migriere_bis(&pool, 230).await;

        for (tabelle, alle, zeilen, schema, ddl) in &vorher {
            let nachher: Vec<Zeile> = sqlx::query_as(sqlx::AssertSqlSafe(alle.clone()))
                .fetch_all(&pool)
                .await
                .unwrap();
            assert_eq!(
                &nachher, zeilen,
                "{tabelle}: jede Zeile bleibt mit ihrer id"
            );
            assert_eq!(
                &schema_von(&pool, tabelle).await,
                schema,
                "{tabelle}: Schema"
            );
            assert_eq!(
                &ddl_ohne_namen(&pool, tabelle)
                    .await
                    .replacen(", 'lageplan'", "", 1),
                ddl,
                "{tabelle}: die DDL unterscheidet sich ausschließlich im art-CHECK"
            );
            let reste: i64 =
                sqlx::query_scalar("SELECT COUNT(*) FROM sqlite_master WHERE name = ? || '_neu'")
                    .bind(tabelle)
                    .fetch_one(&pool)
                    .await
                    .unwrap();
            assert_eq!(reste, 0, "{tabelle}: keine Reste der Zwischentabelle");
        }
        lageplan_an("lagebericht_anlage", "lagebericht_id", lb)
            .await
            .expect("Lageplan am Lagebericht");
        sqlx::query(
            "INSERT INTO befehl_anlage (einsatz_id, befehl_id, anhang_id, art, titel, stand_at, \
                reihenfolge, abgelegt_von_id) \
             VALUES (?, ?, ?, 'erfunden', 'X', '2026-10-20 09:00:00', 2, ?)",
        )
        .bind(e)
        .bind(bf)
        .bind(anhang("d.png").await)
        .bind(b)
        .execute(&pool)
        .await
        .expect_err("eine unbekannte Art bleibt abgewiesen");
        sqlx::query("DELETE FROM anhang WHERE id = ?")
            .bind(a3)
            .execute(&pool)
            .await
            .unwrap();
        let rest: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM lagebericht_anlage WHERE anhang_id = ?")
                .bind(a3)
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(rest, 0, "der Linker fällt weiter mit seiner Datei");
    }

    // ── LLH-1048: Verpflegungsgerät an einer Verpflegungsstelle (0213) ─────────────────────

    /// Der Rebuild von `geraet_kopplung` (Muster 0159) hält Codes, Ereignisse und
    /// Gerätesitzungen, lässt jede Bestandskopplung ohne Verpflegungsstelle (auch ein
    /// Verpflegungsgerät bleibt einsatzweit), bindet höchstens eine Stelle über alle fünf Spalten
    /// und lässt den Einsatz mit Kopplung und Stelle löschen.
    #[tokio::test]
    async fn migration_0213_erhaelt_kinder_und_bindet_verpflegungsstelle() {
        let pool = pool_bis(SqliteConnectOptions::new().filename(":memory:"), 211).await;
        let (e, b) = bild_grundlage(&pool).await;
        let konto = |name: &'static str| {
            let pool = pool.clone();
            async move {
                sqlx::query_scalar::<_, i64>(
                    "INSERT INTO benutzer (org_id, anzeigename, benutzername, passwort_hash) \
                     VALUES (1, ?, ?, 'h') RETURNING id",
                )
                .bind(name)
                .bind(name)
                .fetch_one(&pool)
                .await
                .unwrap()
            }
        };
        let uhs: i64 = sqlx::query_scalar(
            "INSERT INTO uhs (einsatz_id, typ, bezeichnung, erfasst_von, geaendert_von) \
             VALUES (?, 'sonstige', 'UHS 1', ?, ?) RETURNING id",
        )
        .bind(e)
        .bind(b)
        .bind(b)
        .fetch_one(&pool)
        .await
        .unwrap();
        let tablet: i64 = sqlx::query_scalar(
            "INSERT INTO geraet_kopplung (einsatz_id, benutzer_id, ansicht, uhs_id, bezeichnung, \
                erstellt_von, laeuft_ab_at, gekoppelt_at, letzter_zugriff_at) \
             VALUES (?, ?, 'uhs-tablet', ?, 'Tablet', ?, '2099-01-01 00:00:00', \
                '2026-10-16 08:00:00', '2026-10-16 09:00:00') RETURNING id",
        )
        .bind(e)
        .bind(konto("geraet-1").await)
        .bind(uhs)
        .bind(b)
        .fetch_one(&pool)
        .await
        .unwrap();
        let tresen: i64 = sqlx::query_scalar(
            "INSERT INTO geraet_kopplung (einsatz_id, benutzer_id, ansicht, bezeichnung, \
                erstellt_von, laeuft_ab_at) \
             VALUES (?, ?, 'verpflegung', 'Tresen', ?, '2099-01-01 00:00:00') RETURNING id",
        )
        .bind(e)
        .bind(konto("geraet-2").await)
        .bind(b)
        .fetch_one(&pool)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO geraet_kopplungscode (kopplung_id, code_hash, laeuft_ab_at) \
             VALUES (?, 'hash', '2099-01-01 00:00:00')",
        )
        .bind(tablet)
        .execute(&pool)
        .await
        .unwrap();
        for k in [tablet, tresen] {
            sqlx::query(
                "INSERT INTO geraet_kopplung_ereignis (kopplung_id, ereignis, von) \
                 VALUES (?, 'angelegt', ?)",
            )
            .bind(k)
            .bind(b)
            .execute(&pool)
            .await
            .unwrap();
        }
        sqlx::query(
            "INSERT INTO session (token_hash, benutzer_id, expires_at, kopplung_id) \
             SELECT 's' || id, benutzer_id, '2099-01-01 00:00:00', id FROM geraet_kopplung",
        )
        .execute(&pool)
        .await
        .unwrap();
        let zaehle = |tabelle: &'static str| {
            let pool = pool.clone();
            async move {
                sqlx::query_scalar::<_, i64>(sqlx::AssertSqlSafe(format!(
                    "SELECT COUNT(*) FROM {tabelle}"
                )))
                .fetch_one(&pool)
                .await
                .unwrap()
            }
        };
        type Zeile = (
            i64,
            String,
            Option<i64>,
            String,
            Option<String>,
            Option<String>,
        );
        let bestand = || {
            let pool = pool.clone();
            async move {
                sqlx::query_as::<_, Zeile>(
                    "SELECT id, ansicht, uhs_id, laeuft_ab_at, gekoppelt_at, letzter_zugriff_at \
                     FROM geraet_kopplung ORDER BY id",
                )
                .fetch_all(&pool)
                .await
                .unwrap()
            }
        };
        let vorher = bestand().await;

        migriere_bis(&pool, 213).await;

        for (t, n) in [
            ("geraet_kopplung", 2),
            ("geraet_kopplungscode", 1),
            ("geraet_kopplung_ereignis", 2),
            ("session", 2),
        ] {
            assert_eq!(zaehle(t).await, n, "{t} überlebt den Umbau");
        }
        assert_eq!(bestand().await, vorher, "Bestand 1:1, ids unverändert");
        let gebunden: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM geraet_kopplung WHERE verpflegungsstelle_id IS NOT NULL",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(
            gebunden, 0,
            "Bestandskopplungen bleiben ohne Verpflegungsstelle"
        );
        let fk_verletzungen: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM pragma_foreign_key_check")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(fk_verletzungen, 0, "foreign_key_check ist leer");
        let reste: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM sqlite_master WHERE name = 'geraet_kopplung_neu'",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(reste, 0, "keine Reste der Zwischentabelle");
        for index in [
            "idx_geraet_kopplung_einsatz",
            "idx_geraet_kopplung_abschnitt",
        ] {
            let da: i64 = sqlx::query_scalar(
                "SELECT COUNT(*) FROM sqlite_master WHERE type = 'index' AND name = ?",
            )
            .bind(index)
            .fetch_one(&pool)
            .await
            .unwrap();
            assert_eq!(da, 1, "{index} steht wieder");
        }

        // Neue Bindung an eine Verpflegungsstelle, höchstens eine Stelle über alle Arten.
        let stelle = verpflegungsstelle(&pool, e, b, "Feldküche BR Sportplatz").await;
        let neu = |name: &'static str, uhs: Option<i64>, vs: Option<i64>| {
            let pool = pool.clone();
            let konto = konto(name);
            async move {
                let g = konto.await;
                sqlx::query_scalar::<_, i64>(
                    "INSERT INTO geraet_kopplung (einsatz_id, benutzer_id, ansicht, uhs_id, \
                        verpflegungsstelle_id, bezeichnung, erstellt_von, laeuft_ab_at) \
                     VALUES (?, ?, 'verpflegung', ?, ?, 'Tresen', ?, '2099-01-01 00:00:00') \
                     RETURNING id",
                )
                .bind(e)
                .bind(g)
                .bind(uhs)
                .bind(vs)
                .bind(b)
                .fetch_one(&pool)
                .await
            }
        };
        neu("geraet-3", None, Some(stelle))
            .await
            .expect("Bindung an eine Verpflegungsstelle");
        assert!(
            neu("geraet-4", Some(uhs), Some(stelle)).await.is_err(),
            "höchstens eine Stelle, auch mit der fünften Spalte"
        );
        assert!(
            neu("geraet-5", None, Some(stelle + 1000)).await.is_err(),
            "der Fremdschlüssel prüft die Stelle"
        );

        // Die Kaskade auf die Kinder wirkt weiter.
        sqlx::query("DELETE FROM geraet_kopplung WHERE id = ?")
            .bind(tablet)
            .execute(&pool)
            .await
            .unwrap();
        assert_eq!(zaehle("geraet_kopplungscode").await, 0);
        assert_eq!(zaehle("session").await, 1);

        // Der Einsatz geht mit Stelle und gebundener Kopplung in einem Zug.
        sqlx::query("DELETE FROM einsatz WHERE id = ?")
            .bind(e)
            .execute(&pool)
            .await
            .expect("Einsatz mit gebundenem Verpflegungsgerät löschbar");
        for t in ["geraet_kopplung", "verpflegungsstelle", "session"] {
            assert_eq!(zaehle(t).await, 0, "{t} geht mit dem Einsatz");
        }
    }

    // --- LLH-1138: Erfassungszeit und Idempotenz der Personen-Einträge (0217) ---

    /// `client_id` und `eingegangen_at` an Sichtung, Verbleib und Verlaufsnotiz: nullable, ohne
    /// Vorgabewert (der INSERT setzt die Ankunft), und je Einsatz eindeutig, nur wenn gesetzt.
    #[tokio::test]
    async fn migration_0217_person_verlauf_client_id_und_ankunft() {
        let pool = pool_bis(SqliteConnectOptions::new().filename(":memory:"), 217).await;
        let (e, b) = bild_grundlage(&pool).await;
        let e2: i64 = sqlx::query_scalar(
            "INSERT INTO einsatz (org_id, bezeichnung) VALUES (1, 'Lage 2') RETURNING id",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        let mut personen = Vec::new();
        for einsatz in [e, e2] {
            personen.push(
                sqlx::query_scalar::<_, i64>(
                    "INSERT INTO einsatz_person (einsatz_id, registrier_nr, erfasst_von, \
                        geaendert_von) VALUES (?, 1, ?, ?) RETURNING id",
                )
                .bind(einsatz)
                .bind(b)
                .bind(b)
                .fetch_one(&pool)
                .await
                .unwrap(),
            );
        }
        let einfuegen = [
            "INSERT INTO person_sichtung (einsatz_id, person_id, kategorie, gesichtet_von, \
                client_id) VALUES (?, ?, 'sk2', ?, ?)",
            "INSERT INTO person_verbleib (einsatz_id, person_id, art, erfasst_von, client_id) \
             VALUES (?, ?, 'vor_ort', ?, ?)",
            "INSERT INTO person_verlaufsnotiz (einsatz_id, person_id, text, erfasst_von, \
                client_id) VALUES (?, ?, 'stabil', ?, ?)",
        ];
        for (tabelle, sql) in ["person_sichtung", "person_verbleib", "person_verlaufsnotiz"]
            .into_iter()
            .zip(einfuegen)
        {
            let schreibe = |einsatz: i64, person: i64, client_id: Option<&'static str>| {
                let pool = pool.clone();
                async move {
                    sqlx::query(sql)
                        .bind(einsatz)
                        .bind(person)
                        .bind(b)
                        .bind(client_id)
                        .execute(&pool)
                        .await
                }
            };
            schreibe(e, personen[0], Some("k1")).await.unwrap();
            assert!(
                schreibe(e, personen[0], Some("k1")).await.is_err(),
                "{tabelle}: derselbe Schlüssel im selben Einsatz"
            );
            schreibe(e2, personen[1], Some("k1"))
                .await
                .unwrap_or_else(|f| panic!("{tabelle}: anderer Einsatz: {f}"));
            schreibe(e, personen[0], None).await.unwrap();
            schreibe(e, personen[0], None)
                .await
                .unwrap_or_else(|f| panic!("{tabelle}: ohne Schlüssel beliebig oft: {f}"));
            let ankunft: Vec<Option<String>> = sqlx::query_scalar(sqlx::AssertSqlSafe(format!(
                "SELECT eingegangen_at FROM {tabelle}"
            )))
            .fetch_all(&pool)
            .await
            .unwrap();
            assert!(
                ankunft.iter().all(Option::is_none),
                "{tabelle}: ohne Vorgabewert bleibt die Ankunft leer, der INSERT setzt sie"
            );
        }
    }

    // --- LLH-1326: PAT-Nummer und Kontamination an der Person (0218) ---

    /// `pat_nummer` und `kontamination` sind nullable (NULL = keine Angabe, nicht „nein“), die
    /// PAT-Nummer ist nicht eindeutig, die Kontamination nur 0 oder 1.
    #[tokio::test]
    async fn migration_0218_pat_nummer_und_kontamination() {
        let pool = pool_bis(SqliteConnectOptions::new().filename(":memory:"), 218).await;
        let (e, b) = bild_grundlage(&pool).await;
        let person = |nr: i64, pat: Option<&'static str>, kont: Option<i64>| {
            let pool = pool.clone();
            async move {
                sqlx::query(
                    "INSERT INTO einsatz_person (einsatz_id, registrier_nr, erfasst_von, \
                        geaendert_von, pat_nummer, kontamination) VALUES (?, ?, ?, ?, ?, ?)",
                )
                .bind(e)
                .bind(nr)
                .bind(b)
                .bind(b)
                .bind(pat)
                .bind(kont)
                .execute(&pool)
                .await
            }
        };
        person(1, None, None).await.expect("ohne Angabe");
        person(2, Some("A-4711"), Some(1)).await.unwrap();
        person(3, Some("A-4711"), Some(0))
            .await
            .expect("dieselbe PAT-Nummer zweimal (Tippfehler im Feld)");
        assert!(person(4, None, Some(2)).await.is_err(), "nur 0 oder 1");
    }

    // --- LLH-1325: Transport als Verlauf mit Cache an der Person (0219) ---

    /// `person_transport` nimmt einen vollen Stand je Zeile (jedes Feld einzeln leer, drei leere
    /// heben auf), nur Katalogwerte, und ist je Einsatz über `client_id` eindeutig. Der Cache an
    /// `einsatz_person` trägt dieselben Kataloge.
    #[tokio::test]
    async fn migration_0219_person_transport() {
        let pool = pool_bis(SqliteConnectOptions::new().filename(":memory:"), 219).await;
        let (e, b) = bild_grundlage(&pool).await;
        let p: i64 = sqlx::query_scalar(
            "INSERT INTO einsatz_person (einsatz_id, registrier_nr, erfasst_von, geaendert_von) \
             VALUES (?, 1, ?, ?) RETURNING id",
        )
        .bind(e)
        .bind(b)
        .bind(b)
        .fetch_one(&pool)
        .await
        .unwrap();
        let stand = |prio: Option<&'static str>,
                     art: Option<&'static str>,
                     fach: Option<&'static str>,
                     client_id: Option<&'static str>| {
            let pool = pool.clone();
            async move {
                sqlx::query(
                    "INSERT INTO person_transport (einsatz_id, person_id, prioritaet, art, \
                        fachrichtung, zeitpunkt_at, erfasst_at, erfasst_von, client_id) \
                     VALUES (?, ?, ?, ?, ?, '2026-10-18 10:00:00', '2026-10-18 10:00:05', ?, ?)",
                )
                .bind(e)
                .bind(p)
                .bind(prio)
                .bind(art)
                .bind(fach)
                .bind(b)
                .bind(client_id)
                .execute(&pool)
                .await
            }
        };
        stand(
            Some("dringlich"),
            Some("liegend"),
            Some("unfallchirurgie"),
            Some("t1"),
        )
        .await
        .unwrap();
        stand(None, None, None, None)
            .await
            .expect("drei leere heben auf");
        stand(Some("sofort"), None, Some("psychiatrie"), None)
            .await
            .expect("jedes Feld einzeln leer");
        assert!(
            stand(Some("dringlich"), None, None, Some("t1"))
                .await
                .is_err(),
            "derselbe Schlüssel im selben Einsatz"
        );
        assert!(stand(Some("eilig"), None, None, None).await.is_err());
        assert!(stand(None, Some("fliegend"), None, None).await.is_err());
        assert!(stand(None, None, Some("zahn"), None).await.is_err());

        let cache = |prio: &'static str, art: &'static str, fach: &'static str| {
            let pool = pool.clone();
            async move {
                sqlx::query(
                    "UPDATE einsatz_person SET transport_prioritaet = ?, transport_art = ?, \
                        transport_fachrichtung = ?, transport_at = '2026-10-18 10:00:00' \
                     WHERE id = ?",
                )
                .bind(prio)
                .bind(art)
                .bind(fach)
                .bind(p)
                .execute(&pool)
                .await
            }
        };
        cache("normal", "mit_notarzt", "geburtshilfe")
            .await
            .unwrap();
        assert!(cache("eilig", "sitzend", "kinder").await.is_err());
        assert!(cache("normal", "fliegend", "kinder").await.is_err());
        assert!(cache("normal", "sitzend", "zahn").await.is_err());
    }

    // --- LLH-1324: Maßnahmen am Patienten (0220) ---

    /// `person_massnahme`: nur Katalogwerte, Durchführung und Ankunft Pflicht, Aufheben als
    /// Spalten an der Zeile (leer = gilt), `client_id` je Einsatz eindeutig.
    #[tokio::test]
    async fn migration_0220_person_massnahme() {
        let pool = pool_bis(SqliteConnectOptions::new().filename(":memory:"), 220).await;
        let (e, b) = bild_grundlage(&pool).await;
        let p: i64 = sqlx::query_scalar(
            "INSERT INTO einsatz_person (einsatz_id, registrier_nr, erfasst_von, geaendert_von) \
             VALUES (?, 1, ?, ?) RETURNING id",
        )
        .bind(e)
        .bind(b)
        .bind(b)
        .fetch_one(&pool)
        .await
        .unwrap();
        let massnahme = |art: &'static str, client_id: Option<&'static str>| {
            let pool = pool.clone();
            async move {
                sqlx::query(
                    "INSERT INTO person_massnahme (einsatz_id, person_id, art, zeitpunkt_at, \
                        erfasst_at, erfasst_von, client_id) \
                     VALUES (?, ?, ?, '2026-10-18 14:05:00', '2026-10-18 14:06:00', ?, ?) \
                     RETURNING id",
                )
                .bind(e)
                .bind(p)
                .bind(art)
                .bind(b)
                .bind(client_id)
                .fetch_one(&pool)
                .await
                .map(|r| sqlx::Row::get::<i64, _>(&r, 0))
            }
        };
        for art in [
            "blutstillung",
            "zugang",
            "infusion",
            "sauerstoff",
            "atemweg",
            "analgesie",
            "immobilisation",
            "waermeerhalt",
            "dekontamination",
        ] {
            massnahme(art, None)
                .await
                .unwrap_or_else(|f| panic!("{art}: {f}"));
        }
        assert!(
            massnahme("tourniquet", None).await.is_err(),
            "nur der Katalog"
        );
        let m = massnahme("infusion", Some("m1")).await.unwrap();
        assert!(
            massnahme("infusion", Some("m1")).await.is_err(),
            "derselbe Schlüssel im selben Einsatz"
        );
        let (at, von): (Option<String>, Option<i64>) = sqlx::query_as(
            "SELECT aufgehoben_at, aufgehoben_von_id FROM person_massnahme WHERE id = ?",
        )
        .bind(m)
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!((at, von), (None, None), "eine neue Maßnahme gilt");
        sqlx::query(
            "UPDATE person_massnahme SET aufgehoben_at = '2026-10-18 14:10:00', \
                aufgehoben_von_id = ? WHERE id = ?",
        )
        .bind(b)
        .bind(m)
        .execute(&pool)
        .await
        .unwrap();
    }

    // --- LLH-1113: Verletzungen am Körperschema (0221) ---

    /// `person_verletzung`: Ansicht, Region, Art und Schwere nur aus dem Katalog, Lage je 0..1 und
    /// nur als Paar, Aufheben als Spalten an der Zeile, `client_id` je Einsatz eindeutig.
    #[tokio::test]
    async fn migration_0221_person_verletzung() {
        let pool = pool_bis(SqliteConnectOptions::new().filename(":memory:"), 221).await;
        let (e, b) = bild_grundlage(&pool).await;
        let p: i64 = sqlx::query_scalar(
            "INSERT INTO einsatz_person (einsatz_id, registrier_nr, erfasst_von, geaendert_von) \
             VALUES (?, 1, ?, ?) RETURNING id",
        )
        .bind(e)
        .bind(b)
        .bind(b)
        .fetch_one(&pool)
        .await
        .unwrap();
        #[allow(clippy::type_complexity)]
        let verletzung = |ansicht: &'static str,
                          region: &'static str,
                          art: &'static str,
                          schwere: Option<&'static str>,
                          lage: (Option<f64>, Option<f64>),
                          client_id: Option<&'static str>| {
            let pool = pool.clone();
            async move {
                sqlx::query(
                    "INSERT INTO person_verletzung (einsatz_id, person_id, ansicht, region, art, \
                        schwere, x, y, notiz, zeitpunkt_at, erfasst_at, erfasst_von, client_id) \
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'offen', '2026-10-18 10:00:00', \
                        '2026-10-18 10:00:05', ?, ?)",
                )
                .bind(e)
                .bind(p)
                .bind(ansicht)
                .bind(region)
                .bind(art)
                .bind(schwere)
                .bind(lage.0)
                .bind(lage.1)
                .bind(b)
                .bind(client_id)
                .execute(&pool)
                .await
            }
        };
        let ohne = (None, None);
        for region in [
            "kopf",
            "gesicht",
            "hals",
            "thorax",
            "abdomen",
            "becken",
            "ruecken",
            "wirbelsaeule",
            "gesaess",
            "oberarm_l",
            "oberarm_r",
            "unterarm_l",
            "unterarm_r",
            "hand_l",
            "hand_r",
            "oberschenkel_l",
            "oberschenkel_r",
            "unterschenkel_l",
            "unterschenkel_r",
            "fuss_l",
            "fuss_r",
        ] {
            let ansicht = if ["ruecken", "wirbelsaeule", "gesaess"].contains(&region) {
                "hinten"
            } else {
                "vorn"
            };
            verletzung(ansicht, region, "schmerz", None, ohne, None)
                .await
                .unwrap_or_else(|f| panic!("{region}: {f}"));
        }
        for art in [
            "wunde_blutung",
            "fraktur_verdacht",
            "verbrennung",
            "prellung_schwellung",
            "amputation",
            "schmerz",
            "sonstige",
        ] {
            verletzung(
                "hinten",
                "kopf",
                art,
                Some("schwer"),
                (Some(0.0), Some(1.0)),
                None,
            )
            .await
            .unwrap_or_else(|f| panic!("{art}: {f}"));
        }
        verletzung(
            "vorn",
            "kopf",
            "schmerz",
            Some("leicht"),
            (Some(0.5), Some(0.2)),
            Some("v1"),
        )
        .await
        .unwrap();
        for (fall, ergebnis) in [
            (
                "Schlüssel doppelt",
                verletzung("vorn", "kopf", "schmerz", None, ohne, Some("v1")).await,
            ),
            (
                "Rücken vorn",
                verletzung("vorn", "ruecken", "schmerz", None, ohne, None).await,
            ),
            (
                "Thorax hinten",
                verletzung("hinten", "thorax", "schmerz", None, ohne, None).await,
            ),
            (
                "Ansicht",
                verletzung("seite", "kopf", "schmerz", None, ohne, None).await,
            ),
            (
                "Region",
                verletzung("vorn", "schulter_l", "schmerz", None, ohne, None).await,
            ),
            (
                "Art",
                verletzung("vorn", "kopf", "biss", None, ohne, None).await,
            ),
            (
                "Schwere",
                verletzung("vorn", "kopf", "schmerz", Some("kritisch"), ohne, None).await,
            ),
            (
                "x > 1",
                verletzung(
                    "vorn",
                    "kopf",
                    "schmerz",
                    None,
                    (Some(1.1), Some(0.5)),
                    None,
                )
                .await,
            ),
            (
                "y < 0",
                verletzung(
                    "vorn",
                    "kopf",
                    "schmerz",
                    None,
                    (Some(0.1), Some(-0.1)),
                    None,
                )
                .await,
            ),
            (
                "nur x",
                verletzung("vorn", "kopf", "schmerz", None, (Some(0.1), None), None).await,
            ),
        ] {
            assert!(ergebnis.is_err(), "{fall}");
        }
    }

    /// LLH-1123: `antreff_lat`/`antreff_lon` am Tier. Eine Bestandszeile von vorher behält jeden
    /// Wert, die Koordinate ist leer; beide Spalten existieren als REAL.
    #[tokio::test]
    async fn migration_0227_tier_antreff_koordinate() {
        let pool = pool_bis(SqliteConnectOptions::new().filename(":memory:"), 226).await;
        let (e, b) = bild_grundlage(&pool).await;
        sqlx::query(
            "INSERT INTO einsatz_tier \
                (id, einsatz_id, registrier_nr, status, spezies, rufname, antreff_ort, notiz, \
                 erfasst_at, erfasst_von, geaendert_at, geaendert_von) \
             VALUES (7, ?, 1, 'vermisst', 'grosstier', 'Fritz', 'Weide am Deich', 'x', \
                     '2026-10-01 08:00:00', ?, '2026-10-01 09:00:00', ?)",
        )
        .bind(e)
        .bind(b)
        .bind(b)
        .execute(&pool)
        .await
        .unwrap();
        type Zeile = (
            i64,
            i64,
            i64,
            String,
            String,
            Option<String>,
            Option<String>,
            Option<String>,
            String,
            String,
        );
        let lies = |pool: SqlitePool| async move {
            sqlx::query_as::<_, Zeile>(
                "SELECT id, einsatz_id, registrier_nr, status, spezies, rufname, antreff_ort, \
                        notiz, erfasst_at, geaendert_at \
                 FROM einsatz_tier ORDER BY id",
            )
            .fetch_all(&pool)
            .await
            .unwrap()
        };
        let vorher = lies(pool.clone()).await;

        migriere_bis(&pool, 227).await;

        assert_eq!(lies(pool.clone()).await, vorher, "Bestand unverändert");
        let koordinate: (Option<f64>, Option<f64>) =
            sqlx::query_as("SELECT antreff_lat, antreff_lon FROM einsatz_tier WHERE id = 7")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(koordinate, (None, None));
        let spalten: Vec<(String, String)> = sqlx::query_as(
            "SELECT name, type FROM pragma_table_info('einsatz_tier') \
             WHERE name IN ('antreff_lat', 'antreff_lon') ORDER BY name",
        )
        .fetch_all(&pool)
        .await
        .unwrap();
        assert_eq!(
            spalten,
            [
                ("antreff_lat".to_string(), "REAL".to_string()),
                ("antreff_lon".to_string(), "REAL".to_string())
            ]
        );
    }

    // --- LLH-1043: Kreisangaben an der Zone (0232) ---

    /// `lage_zone` bekommt drei nullable Kreisspalten; Bestandszeilen bleiben unverändert und
    /// lesen sich als freie Fläche (alle drei NULL).
    #[tokio::test]
    async fn migration_0232_lage_zone_kreis_haengt_drei_nullable_spalten_an() {
        let pool = pool_bis(SqliteConnectOptions::new().filename(":memory:"), 231).await;
        let (e, b) = bild_grundlage(&pool).await;
        let poly =
            r#"{"type":"Polygon","coordinates":[[[8.6,50.1],[8.7,50.1],[8.7,50.2],[8.6,50.1]]]}"#;
        let alt: i64 = sqlx::query_scalar(
            "INSERT INTO lage_zone (einsatz_id, typ, geometrie_typ, geometrie, erstellt_von) \
             VALUES (?, 'absperrbereich', 'Polygon', ?, ?) RETURNING id",
        )
        .bind(e)
        .bind(poly)
        .bind(b)
        .fetch_one(&pool)
        .await
        .unwrap();
        migriere_bis(&pool, 232).await;

        let spalten: Vec<(String, String, i64)> = sqlx::query_as(
            "SELECT name, type, \"notnull\" FROM pragma_table_info('lage_zone') \
             WHERE name LIKE 'kreis_%' ORDER BY cid",
        )
        .fetch_all(&pool)
        .await
        .unwrap();
        assert_eq!(
            spalten,
            vec![
                ("kreis_mitte_lat".to_string(), "REAL".to_string(), 0),
                ("kreis_mitte_lon".to_string(), "REAL".to_string(), 0),
                ("kreis_radius_m".to_string(), "REAL".to_string(), 0),
            ]
        );
        let (lat, lon, r, geo): (Option<f64>, Option<f64>, Option<f64>, String) = sqlx::query_as(
            "SELECT kreis_mitte_lat, kreis_mitte_lon, kreis_radius_m, geometrie \
             FROM lage_zone WHERE id = ?",
        )
        .bind(alt)
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!((lat, lon, r), (None, None, None), "Bestand ist kein Kreis");
        assert_eq!(geo, poly, "Geometrie bleibt");
    }

    /// LLH-1375: jede bestehende Organisation bekommt die Startliste der Einsatz-Vorlagen genau
    /// wie `EINSATZ_VORLAGE_STARTLISTE` (Bezeichnung, Einsatzart, Sortierung, ausgeblendete
    /// Module); bestehende Stichworte bleiben ohne Kopplung.
    #[tokio::test]
    async fn migration_0238_seedet_die_startliste() {
        use crate::einsatz_vorlage::EINSATZ_VORLAGE_STARTLISTE;
        use std::collections::BTreeSet;

        let pool = pool_bis(SqliteConnectOptions::new().filename(":memory:"), 232).await;
        sqlx::query("INSERT INTO organisation (id, name) VALUES (1, 'Orga'), (2, 'Zweite')")
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query("INSERT INTO einsatz_stichwort_vorschlag (org_id, text) VALUES (1, 'MANV15')")
            .execute(&pool)
            .await
            .unwrap();
        migriere_bis(&pool, 238).await;

        for org_id in [1_i64, 2] {
            let koepfe: Vec<(i64, String, Option<String>, i64)> = sqlx::query_as(
                "SELECT id, bezeichnung, einsatzart, sortier FROM einsatz_vorlage \
                 WHERE org_id = ? ORDER BY sortier",
            )
            .bind(org_id)
            .fetch_all(&pool)
            .await
            .unwrap();
            assert_eq!(
                koepfe.len(),
                EINSATZ_VORLAGE_STARTLISTE.len(),
                "Org {org_id}"
            );
            for ((id, bezeichnung, einsatzart, sortier), start) in
                koepfe.into_iter().zip(EINSATZ_VORLAGE_STARTLISTE)
            {
                assert_eq!(bezeichnung, start.bezeichnung);
                assert_eq!(einsatzart.as_deref(), Some(start.einsatzart.as_str()));
                assert_eq!(sortier, start.sortier);
                let aus: BTreeSet<String> = sqlx::query_scalar(
                    "SELECT modul_key FROM einsatz_vorlage_modul_aus WHERE vorlage_id = ?",
                )
                .bind(id)
                .fetch_all(&pool)
                .await
                .unwrap()
                .into_iter()
                .collect();
                let erwartet: BTreeSet<String> = start
                    .ausgeblendet()
                    .into_iter()
                    .map(str::to_string)
                    .collect();
                assert_eq!(aus, erwartet, "{}", start.bezeichnung);
            }
        }
        let gekoppelt: Option<i64> =
            sqlx::query_scalar("SELECT vorlage_id FROM einsatz_stichwort_vorschlag")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(gekoppelt, None, "keine mitgelieferte Kopplung");

        // Löschen einer Vorlage lässt den gekoppelten Vorschlag stehen (SET NULL) und nimmt die
        // Modulmenge mit (CASCADE).
        let manv: i64 = sqlx::query_scalar(
            "SELECT id FROM einsatz_vorlage WHERE org_id = 1 AND bezeichnung = 'MANV'",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        sqlx::query("UPDATE einsatz_stichwort_vorschlag SET vorlage_id = ?")
            .bind(manv)
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query("DELETE FROM einsatz_vorlage WHERE id = ?")
            .bind(manv)
            .execute(&pool)
            .await
            .unwrap();
        let (n, kopplung): (i64, Option<i64>) =
            sqlx::query_as("SELECT COUNT(*), MAX(vorlage_id) FROM einsatz_stichwort_vorschlag")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!((n, kopplung), (1, None));
        let rest: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM einsatz_vorlage_modul_aus WHERE vorlage_id = ?",
        )
        .bind(manv)
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(rest, 0);
    }

    // --- LLH-1031: Lagemeldungen werden Spalten der Meldung (0233) ---

    /// Je Meldung der Stand der Lage-Sicht nach 0233: (id, lagerelevant, lage_text, lat, lon,
    /// übergeben_at, übergeben_von, gesehen_at, gesehen_von).
    type LageStand = (
        i64,
        bool,
        Option<String>,
        Option<f64>,
        Option<f64>,
        Option<String>,
        Option<i64>,
        Option<String>,
        Option<i64>,
    );

    /// Vorher übergebene Lagemeldungen bleiben je Zeile unverändert (Text, Ort, Übergabe,
    /// Kenntnisnahme); dazu kommen genau die nie übergebenen Meldungen der Art „Lagemeldung“, als
    /// gesehen. Ein Flag ohne Lageobjekt fällt, `lage_meldung` ist weg (LLH-1027 D5).
    #[tokio::test]
    async fn migration_0233_haengt_lagemeldungen_an_die_meldung_und_loest_lage_meldung_auf() {
        let pool = pool_bis(SqliteConnectOptions::new().filename(":memory:"), 232).await;
        let (e, b) = bild_grundlage(&pool).await;
        let b2: i64 = sqlx::query_scalar(
            "INSERT INTO benutzer (org_id, anzeigename, benutzername, passwort_hash) \
             VALUES (1, 'S2', 's2', 'h') RETURNING id",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        let meldung = |nr: i64, art: &'static str, inhalt: &'static str, flag: bool| {
            let pool = pool.clone();
            async move {
                sqlx::query_scalar::<_, i64>(
                    "INSERT INTO meldung (einsatz_id, lfd_nr, absender, meldeweg, inhalt, \
                        meldungsart, lagerelevant, ereigniszeit, eingang_at, erfasst_von_id) \
                     VALUES (?, ?, 'Florian 1', 'funk', ?, ?, ?, '2026-06-12 09:00:00', \
                             '2026-06-12 09:01:00', ?) RETURNING id",
                )
                .bind(e)
                .bind(nr)
                .bind(inhalt)
                .bind(art)
                .bind(flag)
                .bind(b)
                .fetch_one(&pool)
                .await
                .unwrap()
            }
        };
        // Übergeben mit gleichem Text, gesehen, verortet.
        let gesehen = meldung(1, "rueckmeldung", "Brücke gesperrt", true).await;
        // Übergeben mit eigenem Lage-Text, neu, ohne Ort.
        let eigen = meldung(2, "sonstige", "Pegel 3,20 m", true).await;
        // Art Lagemeldung, übergeben: bleibt, wie sie war (neu).
        let lm_uebergeben = meldung(3, "lagemeldung", "Lage ruhig", true).await;
        // Art Lagemeldung, nie übergeben: kommt dazu, als gesehen.
        let lm_nie = meldung(4, "lagemeldung", "Lage unverändert", false).await;
        // Andere Art, nie übergeben: bleibt draußen.
        let anders = meldung(5, "anfrage", "Wo ist ELW 2?", false).await;
        // Flag ohne Lageobjekt (nur per Handeingriff möglich): fällt.
        let verwaist = meldung(6, "sonstige", "verwaist", true).await;

        for (mid, text, lat, lon, von, at, g_at, g_von) in [
            (
                gesehen,
                "Brücke gesperrt",
                Some(51.4),
                Some(10.4),
                b2,
                "2026-06-12 09:05:00",
                Some("2026-06-12 09:07:00"),
                Some(b),
            ),
            (
                eigen,
                "Pegel steigt",
                None,
                None,
                b,
                "2026-06-12 09:06:00",
                None,
                None,
            ),
            (
                lm_uebergeben,
                "Lage ruhig",
                None,
                None,
                b2,
                "2026-06-12 09:08:00",
                None,
                None,
            ),
        ] {
            sqlx::query(
                "INSERT INTO lage_meldung (einsatz_id, meldung_id, text, lat, lon, \
                    erstellt_von_id, erstellt_at, gesehen_at, gesehen_von_id) \
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            )
            .bind(e)
            .bind(mid)
            .bind(text)
            .bind(lat)
            .bind(lon)
            .bind(von)
            .bind(at)
            .bind(g_at)
            .bind(g_von)
            .execute(&pool)
            .await
            .unwrap();
        }

        migriere_bis(&pool, 233).await;

        let stand: Vec<LageStand> = sqlx::query_as(
            "SELECT id, lagerelevant, lage_text, lat, lon, lage_uebergeben_at, \
                    lage_uebergeben_von_id, lage_gesehen_at, lage_gesehen_von_id \
             FROM meldung ORDER BY lfd_nr",
        )
        .fetch_all(&pool)
        .await
        .unwrap();
        let s = |t: &str| Some(t.to_string());
        assert_eq!(
            stand,
            vec![
                (
                    gesehen,
                    true,
                    None,
                    Some(51.4),
                    Some(10.4),
                    s("2026-06-12 09:05:00"),
                    Some(b2),
                    s("2026-06-12 09:07:00"),
                    Some(b),
                ),
                (
                    eigen,
                    true,
                    s("Pegel steigt"),
                    None,
                    None,
                    s("2026-06-12 09:06:00"),
                    Some(b),
                    None,
                    None,
                ),
                (
                    lm_uebergeben,
                    true,
                    None,
                    None,
                    None,
                    s("2026-06-12 09:08:00"),
                    Some(b2),
                    None,
                    None,
                ),
                (
                    lm_nie,
                    true,
                    None,
                    None,
                    None,
                    s("2026-06-12 09:01:00"),
                    Some(b),
                    s("2026-06-12 09:01:00"),
                    None,
                ),
                (anders, false, None, None, None, None, None, None, None),
                (verwaist, false, None, None, None, None, None, None, None),
            ],
            "gleicher Text heißt NULL (der Wortlaut gilt); nachgezogene Lagemeldung gilt als gesehen"
        );

        let tabelle: Option<String> = sqlx::query_scalar(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'lage_meldung'",
        )
        .fetch_optional(&pool)
        .await
        .unwrap();
        assert_eq!(tabelle, None, "kein Altbestand");
        let index: Option<String> = sqlx::query_scalar(
            "SELECT sql FROM sqlite_master WHERE type = 'index' AND name = 'idx_meldung_lage'",
        )
        .fetch_optional(&pool)
        .await
        .unwrap();
        assert!(
            index.is_some_and(|sql| sql.contains("einsatz_id, lagerelevant")),
            "Index der Lage-Sicht"
        );
    }

    // --- LLH-1089: Ziel und Bedarfszeit an der Nachforderung (0235) ---

    /// Neubau ohne `NOT NULL` an `bezeichnung` (design.md D7): der Bestand bleibt mit seiner id,
    /// alle drei Kinder (ETB, Material, Verpflegungsausgabe) bleiben verbunden, die Kaskade des
    /// DROP läuft nicht, und die Fremdschlüssel sind danach wieder an.
    #[tokio::test]
    async fn migration_0235_baut_nachforderung_um_und_erhaelt_bestand_und_kinder() {
        let pool = pool_bis(SqliteConnectOptions::new().filename(":memory:"), 232).await;
        let (e, b) = bild_grundlage(&pool).await;
        let stelle: i64 = sqlx::query_scalar(
            "INSERT INTO betreuungsstelle (einsatz_id, bezeichnung, art, angelegt_von_id) \
             VALUES (?, 'Turnhalle Ost', 'notunterkunft', ?) RETURNING id",
        )
        .bind(e)
        .bind(b)
        .fetch_one(&pool)
        .await
        .unwrap();
        let n: i64 = sqlx::query_scalar(
            "INSERT INTO nachforderung (einsatz_id, art, bezeichnung, anzahl, adressat_kategorie, \
                adressat_bezeichnung, begruendung, prioritaet, status, zugesagt_at, \
                angefordert_at, erstellt_von_id, erstellt_at, betreuungsstelle_id) \
             VALUES (?, 'RTW', 'Transport aus der UHS', 2, 'leitstelle', 'ILS Nord', 'Lage', \
                'sofort', 'zugesagt', '2026-10-21 08:05:00', '2026-10-21 08:00:00', ?, \
                '2026-10-21 08:00:01', ?) RETURNING id",
        )
        .bind(e)
        .bind(b)
        .bind(stelle)
        .fetch_one(&pool)
        .await
        .unwrap();
        let etb: i64 = sqlx::query_scalar(
            "INSERT INTO etb_eintrag (einsatz_id, lfd_nr, typ, inhalt, erfasser_id, ereigniszeit, \
                nachforderung_id) \
             VALUES (?, 1, 'meldung', 'Nachforderung: 2× RTW', ?, '2026-10-21 08:00:00', ?) \
             RETURNING id",
        )
        .bind(e)
        .bind(b)
        .bind(n)
        .fetch_one(&pool)
        .await
        .unwrap();
        sqlx::query("UPDATE nachforderung SET etb_nachforderung_id = ? WHERE id = ?")
            .bind(etb)
            .bind(n)
            .execute(&pool)
            .await
            .unwrap();
        let posten: i64 = sqlx::query_scalar(
            "INSERT INTO einsatz_material (einsatz_id, snap_bezeichnung, art, nachforderung_id) \
             VALUES (?, 'Trage', 'geraet', ?) RETURNING id",
        )
        .bind(e)
        .bind(n)
        .fetch_one(&pool)
        .await
        .unwrap();
        let (_zf, ausgabe) = verpflegung_bestand(&pool, e, b).await;
        sqlx::query("UPDATE verpflegung_ausgabe SET nachforderung_id = ? WHERE id = ?")
            .bind(n)
            .bind(ausgabe)
            .execute(&pool)
            .await
            .unwrap();
        type Zeile = (
            i64,
            String,
            Option<String>,
            Option<i64>,
            String,
            Option<String>,
            String,
            Option<String>,
            String,
            Option<i64>,
            String,
            Option<i64>,
        );
        // Zwölf Spalten, mehr trägt ein Tupel für `assert_eq!` nicht; die übrigen kopiert dieselbe
        // Spaltenliste des INSERT … SELECT.
        const BESTAND: &str = "SELECT id, art, bezeichnung, anzahl, adressat_kategorie, \
            adressat_bezeichnung, status, zugesagt_at, angefordert_at, \
            etb_nachforderung_id, erstellt_at, betreuungsstelle_id FROM nachforderung ORDER BY id";
        let vorher: Vec<Zeile> = sqlx::query_as(BESTAND).fetch_all(&pool).await.unwrap();

        migriere_bis(&pool, 235).await;

        let nachher: Vec<Zeile> = sqlx::query_as(BESTAND).fetch_all(&pool).await.unwrap();
        assert_eq!(nachher, vorher, "Bestand 1:1 mit id");
        let neu: (Option<i64>, Option<i64>, Option<String>, Option<String>) = sqlx::query_as(
            "SELECT ziel_br_id, ziel_abschnitt_id, ziel_text, benoetigt_bis FROM nachforderung \
             WHERE id = ?",
        )
        .bind(n)
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(neu, (None, None, None, None), "der Bestand hat kein Ziel");
        for (tabelle, id) in [
            ("etb_eintrag", etb),
            ("einsatz_material", posten),
            ("verpflegung_ausgabe", ausgabe),
        ] {
            let bezug: Option<i64> = sqlx::query_scalar(sqlx::AssertSqlSafe(format!(
                "SELECT nachforderung_id FROM {tabelle} WHERE id = ?"
            )))
            .bind(id)
            .fetch_one(&pool)
            .await
            .unwrap();
            assert_eq!(
                bezug,
                Some(n),
                "{tabelle}: das DROP hat die Kaskade nicht ausgelöst"
            );
        }
        let verletzt: Vec<(String, i64, String, i64)> = sqlx::query_as("PRAGMA foreign_key_check")
            .fetch_all(&pool)
            .await
            .unwrap();
        assert!(verletzt.is_empty(), "{verletzt:?}");
        let fk: i64 = sqlx::query_scalar("PRAGMA foreign_keys")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(fk, 1, "Fremdschlüssel wieder an");
        let mut indizes: Vec<String> = sqlx::query_scalar(
            "SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'nachforderung' \
             AND sql IS NOT NULL ORDER BY name",
        )
        .fetch_all(&pool)
        .await
        .unwrap();
        indizes.sort();
        assert_eq!(
            indizes,
            [
                "idx_nachforderung_betreuungsstelle",
                "idx_nachforderung_einsatz",
                "idx_nachforderung_ziel_abschnitt",
                "idx_nachforderung_ziel_br",
            ]
        );
        let tabellen: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM sqlite_master WHERE name = 'nachforderung_neu'",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(tabellen, 0);
    }

    /// Nach 0235: ohne Bezeichnung gültig, höchstens ein Ziel (CHECK), und das Löschen eines
    /// Raums oder Abschnitts löst den Bezug, statt aufgehalten zu werden.
    #[tokio::test]
    async fn migration_0235_ziel_regeln() {
        let pool = pool_bis(SqliteConnectOptions::new().filename(":memory:"), 235).await;
        let (e, b) = bild_grundlage(&pool).await;
        let br: i64 = sqlx::query_scalar(
            "INSERT INTO bereitstellungsraum (einsatz_id, bezeichnung, erfasst_von, geaendert_von) \
             VALUES (?, 'BR Nord', ?, ?) RETURNING id",
        )
        .bind(e)
        .bind(b)
        .bind(b)
        .fetch_one(&pool)
        .await
        .unwrap();
        let abschnitt: i64 = sqlx::query_scalar(
            "INSERT INTO einsatzabschnitt (einsatz_id, name) VALUES (?, 'EA Deich') RETURNING id",
        )
        .bind(e)
        .fetch_one(&pool)
        .await
        .unwrap();
        let anlegen = |br: Option<i64>, abschnitt: Option<i64>, text: Option<&'static str>| {
            let pool = pool.clone();
            async move {
                sqlx::query_scalar::<_, i64>(
                    "INSERT INTO nachforderung (einsatz_id, art, adressat_kategorie, \
                        angefordert_at, erstellt_von_id, ziel_br_id, ziel_abschnitt_id, \
                        ziel_text, benoetigt_bis) \
                     VALUES (?, 'RTW', 'leitstelle', '2026-10-21 08:00:00', ?, ?, ?, ?, \
                        '2026-10-21 09:30:00') RETURNING id",
                )
                .bind(e)
                .bind(b)
                .bind(br)
                .bind(abschnitt)
                .bind(text)
                .fetch_one(&pool)
                .await
            }
        };
        let zum_br = anlegen(Some(br), None, None)
            .await
            .expect("ohne Bezeichnung, mit Ziel BR");
        let zum_abschnitt = anlegen(None, Some(abschnitt), None).await.unwrap();
        anlegen(None, None, Some("Lotsenpunkt Feuerwache"))
            .await
            .expect("Freitext-Ziel");
        anlegen(None, None, None).await.expect("ohne Ziel");
        let fehler = anlegen(Some(br), None, Some("Zufahrt Süd"))
            .await
            .expect_err("zwei Ziele");
        assert!(fehler.to_string().contains("CHECK"), "{fehler}");
        anlegen(Some(br), Some(abschnitt), None)
            .await
            .expect_err("Raum und Abschnitt");

        sqlx::query("DELETE FROM bereitstellungsraum WHERE id = ?")
            .bind(br)
            .execute(&pool)
            .await
            .expect("der Bezug hält das Löschen des Raums nicht auf");
        sqlx::query("DELETE FROM einsatzabschnitt WHERE id = ?")
            .bind(abschnitt)
            .execute(&pool)
            .await
            .expect("der Bezug hält das Auflösen des Abschnitts nicht auf");
        let ziele: Vec<(Option<i64>, Option<i64>)> = sqlx::query_as(
            "SELECT ziel_br_id, ziel_abschnitt_id FROM nachforderung WHERE id IN (?, ?) \
             ORDER BY id",
        )
        .bind(zum_br)
        .bind(zum_abschnitt)
        .fetch_all(&pool)
        .await
        .unwrap();
        assert_eq!(
            ziele,
            vec![(None, None), (None, None)],
            "ON DELETE SET NULL"
        );
        sqlx::query("DELETE FROM einsatz WHERE id = ?")
            .bind(e)
            .execute(&pool)
            .await
            .expect("das Löschen des Einsatzes nimmt die Nachforderungen mit");
    }

    // --- LLH-1097: Zusage, Teilzusage und Zurückziehen an der Nachforderung (0237) ---

    /// Nur ADD COLUMN (design.md D12): der Bestand bleibt mit leeren Zusage-Spalten, eine
    /// Restposition verweist auf ihre zugesagte, `zurueckgezogen` braucht keinen CHECK, und das
    /// Löschen des Einsatzes nimmt beide mit, ohne am Selbstbezug hängenzubleiben.
    #[tokio::test]
    async fn migration_0237_zusage_spalten_teilung_und_status() {
        let pool = pool_bis(SqliteConnectOptions::new().filename(":memory:"), 235).await;
        let (e, b) = bild_grundlage(&pool).await;
        let alt: i64 = sqlx::query_scalar(
            "INSERT INTO nachforderung (einsatz_id, art, anzahl, adressat_kategorie, \
                angefordert_at, erstellt_von_id) \
             VALUES (?, 'RTW', 2, 'leitstelle', '2026-10-22 08:00:00', ?) RETURNING id",
        )
        .bind(e)
        .bind(b)
        .fetch_one(&pool)
        .await
        .unwrap();
        migriere_bis(&pool, 237).await;

        let leer: (
            Option<String>,
            Option<String>,
            Option<i64>,
            Option<i64>,
            Option<String>,
        ) = sqlx::query_as(
            "SELECT zusage_rufnamen, eintreffen_erwartet_at, anzahl_angefordert, \
                    teilung_aus_id, zurueckgezogen_at FROM nachforderung WHERE id = ?",
        )
        .bind(alt)
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(leer, (None, None, None, None, None), "Bestand ohne Zusage");

        sqlx::query(
            "UPDATE nachforderung SET status = 'zugesagt', anzahl = 1, anzahl_angefordert = 2, \
                zusage_rufnamen = '[\"83-1\"]', eintreffen_erwartet_at = '2026-10-22 13:30:00' \
             WHERE id = ?",
        )
        .bind(alt)
        .execute(&pool)
        .await
        .unwrap();
        let rest: i64 = sqlx::query_scalar(
            "INSERT INTO nachforderung (einsatz_id, art, anzahl, adressat_kategorie, \
                angefordert_at, erstellt_von_id, teilung_aus_id) \
             VALUES (?, 'RTW', 1, 'leitstelle', '2026-10-22 08:00:00', ?, ?) RETURNING id",
        )
        .bind(e)
        .bind(b)
        .bind(alt)
        .fetch_one(&pool)
        .await
        .unwrap();
        sqlx::query(
            "UPDATE nachforderung SET status = 'zurueckgezogen', \
                zurueckgezogen_at = '2026-10-22 09:00:00', zurueckgezogen_grund = 'nicht mehr nötig' \
             WHERE id = ?",
        )
        .bind(rest)
        .execute(&pool)
        .await
        .expect("status ohne CHECK nimmt den neuen Wert");
        let verweis: Option<i64> =
            sqlx::query_scalar("SELECT teilung_aus_id FROM nachforderung WHERE id = ?")
                .bind(rest)
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(verweis, Some(alt));
        sqlx::query(
            "INSERT INTO nachforderung (einsatz_id, art, adressat_kategorie, angefordert_at, \
                erstellt_von_id, teilung_aus_id) \
             VALUES (?, 'RTW', 'leitstelle', '2026-10-22 08:00:00', ?, 999999)",
        )
        .bind(e)
        .bind(b)
        .execute(&pool)
        .await
        .expect_err("teilung_aus_id ist ein Fremdschlüssel");

        let index: Option<String> = sqlx::query_scalar(
            "SELECT sql FROM sqlite_master WHERE type = 'index' AND name = 'idx_nachforderung_teilung'",
        )
        .fetch_optional(&pool)
        .await
        .unwrap();
        assert!(
            index.is_some_and(|i| i.contains("WHERE teilung_aus_id IS NOT NULL")),
            "Teilindex"
        );
        let verletzt: Vec<(String,)> = sqlx::query_as("PRAGMA foreign_key_check(nachforderung)")
            .fetch_all(&pool)
            .await
            .unwrap();
        assert!(verletzt.is_empty());

        sqlx::query("DELETE FROM einsatz WHERE id = ?")
            .bind(e)
            .execute(&pool)
            .await
            .expect("das Löschen des Einsatzes nimmt zugesagte und Rest mit");
        let uebrig: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM nachforderung")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(uebrig, 0);
    }

    /// LLH-1114, design.md D2: `ort_lat`/`ort_lon` am Auftrag. Ein Auftrag von vorher behält jeden
    /// Wert und bleibt unverortet; beide Spalten sind `REAL`, nullable, ohne CHECK (das Paar und die
    /// Bindung an `ort` sichert die App). Die Nummer liegt über 0241 (PR #936, Sofortalarm).
    #[tokio::test]
    async fn migration_0242_auftrag_ziel_koordinate() {
        let pool = pool_bis(SqliteConnectOptions::new().filename(":memory:"), 241).await;
        let (e, b) = bild_grundlage(&pool).await;
        sqlx::query(
            "INSERT INTO auftrag (id, einsatz_id, auftrag_text, ort, erteilt_at, erstellt_von_id) \
             VALUES (5, ?, 'Sandsäcke', 'Deich Nord', '2026-10-22 10:00:00', ?)",
        )
        .bind(e)
        .bind(b)
        .execute(&pool)
        .await
        .unwrap();

        migriere_bis(&pool, 242).await;

        let zeile: (String, Option<f64>, Option<f64>) =
            sqlx::query_as("SELECT ort, ort_lat, ort_lon FROM auftrag WHERE id = 5")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(zeile, ("Deich Nord".to_string(), None, None));
        let spalten: Vec<(String, String, i64)> = sqlx::query_as(
            "SELECT name, type, \"notnull\" FROM pragma_table_info('auftrag') \
             WHERE name IN ('ort_lat', 'ort_lon') ORDER BY name",
        )
        .fetch_all(&pool)
        .await
        .unwrap();
        assert_eq!(
            spalten,
            [
                ("ort_lat".to_string(), "REAL".to_string(), 0),
                ("ort_lon".to_string(), "REAL".to_string(), 0)
            ]
        );
    }

    /// LLH-1383 D7: die Einheit trägt ihre Nachforderung als Fremdschlüssel; der Bestand bleibt
    /// ohne Verweis, das Löschen der Nachforderung leert ihn, und das Löschen des Einsatzes nimmt
    /// beides mit.
    #[tokio::test]
    async fn migration_0239_einheit_verweist_auf_nachforderung() {
        let pool = pool_bis(SqliteConnectOptions::new().filename(":memory:"), 237).await;
        let (e, b) = bild_grundlage(&pool).await;
        let alt: i64 = sqlx::query_scalar(
            "INSERT INTO einsatz_einheit (einsatz_id, name) VALUES (?, '83-1') RETURNING id",
        )
        .bind(e)
        .fetch_one(&pool)
        .await
        .unwrap();
        migriere_bis(&pool, 239).await;

        let leer: Option<i64> =
            sqlx::query_scalar("SELECT nachforderung_id FROM einsatz_einheit WHERE id = ?")
                .bind(alt)
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(leer, None, "Bestand ohne Herkunft");

        let n: i64 = sqlx::query_scalar(
            "INSERT INTO nachforderung (einsatz_id, art, anzahl, adressat_kategorie, \
                angefordert_at, erstellt_von_id, status) \
             VALUES (?, 'RTW', 2, 'leitstelle', '2026-10-22 08:00:00', ?, 'eingetroffen') \
             RETURNING id",
        )
        .bind(e)
        .bind(b)
        .fetch_one(&pool)
        .await
        .unwrap();
        let neu: i64 = sqlx::query_scalar(
            "INSERT INTO einsatz_einheit (einsatz_id, name, nachforderung_id) \
             VALUES (?, '83-2', ?) RETURNING id",
        )
        .bind(e)
        .bind(n)
        .fetch_one(&pool)
        .await
        .unwrap();
        sqlx::query("INSERT INTO einsatz_einheit (einsatz_id, name, nachforderung_id) VALUES (?, 'x', 999999)")
            .bind(e)
            .execute(&pool)
            .await
            .expect_err("nachforderung_id ist ein Fremdschlüssel");

        let index: Option<String> = sqlx::query_scalar(
            "SELECT sql FROM sqlite_master WHERE type = 'index' \
               AND name = 'idx_einsatz_einheit_nachforderung'",
        )
        .fetch_optional(&pool)
        .await
        .unwrap();
        assert!(
            index.is_some_and(|i| i.contains("WHERE nachforderung_id IS NOT NULL")),
            "Teilindex"
        );
        let verletzt: Vec<(String,)> = sqlx::query_as("PRAGMA foreign_key_check(einsatz_einheit)")
            .fetch_all(&pool)
            .await
            .unwrap();
        assert!(verletzt.is_empty());

        sqlx::query("DELETE FROM nachforderung WHERE id = ?")
            .bind(n)
            .execute(&pool)
            .await
            .expect("der Verweis hält das Löschen nicht auf");
        let geleert: Option<i64> =
            sqlx::query_scalar("SELECT nachforderung_id FROM einsatz_einheit WHERE id = ?")
                .bind(neu)
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(geleert, None, "ON DELETE SET NULL");

        sqlx::query("DELETE FROM einsatz WHERE id = ?")
            .bind(e)
            .execute(&pool)
            .await
            .expect("das Löschen des Einsatzes nimmt die Einheiten mit");
    }

    /// LLH-1121, design.md D7: `sammelstelle_lat`/`sammelstelle_lon` am Evakuierungsbezirk. Ein
    /// Bezirk von vorher behält jeden Wert und bleibt unverortet; beide Spalten sind `REAL` und
    /// nullable, ohne CHECK (das Paar sichert die App wie bei 0034/0118).
    #[tokio::test]
    async fn migration_0240_sammelstelle_koordinate() {
        let pool = pool_bis(SqliteConnectOptions::new().filename(":memory:"), 239).await;
        let (e, b) = bild_grundlage(&pool).await;
        sqlx::query(
            "INSERT INTO evakuierungsbezirk \
                (id, einsatz_id, bezeichnung, plan_personen, plan_erhebung, raeumung, \
                 sammelstelle, notiz, angelegt_von_id) \
             VALUES (3, ?, 'Uferstraße 12–40', 640, 'geschaetzt', 'laeuft', 'Kirchplatz', \
                     'Zufahrt Nord', ?)",
        )
        .bind(e)
        .bind(b)
        .execute(&pool)
        .await
        .unwrap();
        type Zeile = (
            i64,
            String,
            i64,
            String,
            String,
            Option<String>,
            Option<String>,
        );
        let lies = |pool: SqlitePool| async move {
            sqlx::query_as::<_, Zeile>(
                "SELECT id, bezeichnung, plan_personen, plan_erhebung, raeumung, sammelstelle, \
                        notiz FROM evakuierungsbezirk ORDER BY id",
            )
            .fetch_all(&pool)
            .await
            .unwrap()
        };
        let vorher = lies(pool.clone()).await;

        migriere_bis(&pool, 240).await;

        assert_eq!(lies(pool.clone()).await, vorher, "Bestand unverändert");
        let koordinate: (Option<f64>, Option<f64>) = sqlx::query_as(
            "SELECT sammelstelle_lat, sammelstelle_lon FROM evakuierungsbezirk WHERE id = 3",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(koordinate, (None, None), "der Bestand ist nicht verortet");
        let spalten: Vec<(String, String, i64)> = sqlx::query_as(
            "SELECT name, type, \"notnull\" FROM pragma_table_info('evakuierungsbezirk') \
             WHERE name IN ('sammelstelle_lat', 'sammelstelle_lon') ORDER BY name",
        )
        .fetch_all(&pool)
        .await
        .unwrap();
        assert_eq!(
            spalten,
            [
                ("sammelstelle_lat".to_string(), "REAL".to_string(), 0),
                ("sammelstelle_lon".to_string(), "REAL".to_string(), 0)
            ]
        );
        sqlx::query(
            "UPDATE evakuierungsbezirk SET sammelstelle_lat = 52.1, sammelstelle_lon = 9.35 \
             WHERE id = 3",
        )
        .execute(&pool)
        .await
        .expect("ein Paar lässt sich speichern");
    }

    /// LLH-1388 D2: Bestand ohne Herkunft der Wirkung (0/NULL), der Schalter nimmt nur 0 und 1, die
    /// Belegung ist ein Fremdschlüssel, und das Löschen des Einsatzes nimmt alles mit.
    #[tokio::test]
    async fn migration_0246_einheit_haelt_die_wirkung_der_uebernahme() {
        let pool = pool_bis(SqliteConnectOptions::new().filename(":memory:"), 239).await;
        let (e, b) = bild_grundlage(&pool).await;
        let alt: i64 = sqlx::query_scalar(
            "INSERT INTO einsatz_einheit (einsatz_id, name) VALUES (?, '83-1') RETURNING id",
        )
        .bind(e)
        .fetch_one(&pool)
        .await
        .unwrap();
        migriere_bis(&pool, 246).await;

        let (angelegt, belegung): (i64, Option<i64>) = sqlx::query_as(
            "SELECT nachforderung_angelegt, nachforderung_belegung_id FROM einsatz_einheit \
             WHERE id = ?",
        )
        .bind(alt)
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(
            (angelegt, belegung),
            (0, None),
            "Bestand: verknüpft, ohne Buchung"
        );

        sqlx::query("UPDATE einsatz_einheit SET nachforderung_angelegt = 2 WHERE id = ?")
            .bind(alt)
            .execute(&pool)
            .await
            .expect_err("nur 0 oder 1");
        sqlx::query("UPDATE einsatz_einheit SET nachforderung_belegung_id = 999999 WHERE id = ?")
            .bind(alt)
            .execute(&pool)
            .await
            .expect_err("nachforderung_belegung_id ist ein Fremdschlüssel");

        let br: i64 = sqlx::query_scalar(
            "INSERT INTO bereitstellungsraum (einsatz_id, bezeichnung, erfasst_von, geaendert_von) \
             VALUES (?, 'Nord', ?, ?) RETURNING id",
        )
        .bind(e)
        .bind(b)
        .bind(b)
        .fetch_one(&pool)
        .await
        .unwrap();
        let eintritt: i64 = sqlx::query_scalar(
            "INSERT INTO br_belegung (einsatz_id, br_id, objekt_typ, objekt_id, art, erfasst_von) \
             VALUES (?, ?, 'einheit', ?, 'eintritt', ?) RETURNING id",
        )
        .bind(e)
        .bind(br)
        .bind(alt)
        .bind(b)
        .fetch_one(&pool)
        .await
        .unwrap();
        sqlx::query(
            "UPDATE einsatz_einheit SET nachforderung_angelegt = 1, nachforderung_belegung_id = ? \
             WHERE id = ?",
        )
        .bind(eintritt)
        .bind(alt)
        .execute(&pool)
        .await
        .unwrap();
        let verletzt: Vec<(String,)> = sqlx::query_as("PRAGMA foreign_key_check(einsatz_einheit)")
            .fetch_all(&pool)
            .await
            .unwrap();
        assert!(verletzt.is_empty());

        sqlx::query("DELETE FROM einsatz WHERE id = ?")
            .bind(e)
            .execute(&pool)
            .await
            .expect("das Löschen des Einsatzes nimmt Einheit und Belegung mit");
    }
}
