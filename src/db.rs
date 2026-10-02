use sqlx::sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePoolOptions};
use sqlx::SqlitePool;

mod physisch;
#[cfg(test)]
pub(crate) use physisch::datei_oder_wal_enthaelt;
pub use physisch::{bereinige_altbestand_einmalig, wal_zurueckschreiben};

/// Öffnet einen SQLite-Pool auf der angegebenen Datei.
/// Aktiviert WAL-Journal, Foreign Keys und legt die Datei bei Bedarf an.
///
/// `secure_delete = ON` auf jeder Verbindung (LFH-725): SQLite nullt freigewordenen Platz,
/// statt die alten Bytes stehen zu lassen — sonst wären geschwärzte Werte mit einem Hex-Editor
/// wiederherstellbar. Nicht `FAST`: das lässt die Overflow-Seiten gelöschter Anhang-BLOBs
/// ungenullt auf der Freelist. Den Rest erledigt [`wal_zurueckschreiben`] nach der Schwärzung;
/// Messung und Herleitung in
/// `openspec/changes/archive/2026-10-01-lfh-725-schwaerzung-physisch-ueberschreiben/design.md`.
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
        .pragma("secure_delete", "ON");

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
        .pragma("secure_delete", "ON");

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

        let schema_vorher = schema_von(&pool, "person_zugriff_audit").await;
        let ddl = || async {
            let sql: String = sqlx::query_scalar(
                "SELECT sql FROM sqlite_master WHERE type = 'table' \
                 AND name = 'person_zugriff_audit'",
            )
            .fetch_one(&pool)
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
        let zeilen_vorher: Vec<Zeile> = sqlx::query_as(alle).fetch_all(&pool).await.unwrap();

        assert!(
            MIGRATION_0132.starts_with("-- no-transaction"),
            "sqlx erkennt die Direktive nur am Dateianfang"
        );
        sqlx::raw_sql(MIGRATION_0132)
            .execute(&pool)
            .await
            .expect("0132 muss auf einer befüllten DB durchlaufen");

        let zeilen_nachher: Vec<Zeile> = sqlx::query_as(alle).fetch_all(&pool).await.unwrap();
        assert_eq!(
            zeilen_nachher, zeilen_vorher,
            "alle Zeilen samt ids verlustfrei kopiert"
        );
        assert_eq!(
            schema_von(&pool, "person_zugriff_audit").await,
            schema_vorher,
            "Spalten, FKs und Indizes unverändert"
        );
        assert_eq!(
            ddl().await.replacen(",'druck'", "", 1),
            ddl_vorher,
            "die DDL unterscheidet sich ausschließlich im art-CHECK"
        );
        let reste: i64 = sqlx::query_scalar(
            "SELECT (SELECT COUNT(*) FROM sqlite_master WHERE name = 'person_zugriff_audit_neu') \
                  + (SELECT COUNT(*) FROM sqlite_sequence WHERE name = 'person_zugriff_audit_neu')",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(reste, 0, "keine Reste der Zwischentabelle");

        // Die Sequenz überlebt: die gelöschte id 3 wird nicht wiedervergeben.
        let neue_id: i64 = sqlx::query_scalar(
            "INSERT INTO person_zugriff_audit (einsatz_id, person_id, benutzer_id, art) \
             VALUES (1, NULL, 1, 'druck') RETURNING id",
        )
        .fetch_one(&pool)
        .await
        .expect("der neue CHECK nimmt 'druck'");
        assert_eq!(neue_id, 4, "AUTOINCREMENT-Sequenz bleibt erhalten");
        assert!(
            sqlx::query(
                "INSERT INTO person_zugriff_audit (einsatz_id, person_id, benutzer_id, art) \
                 VALUES (1, NULL, 1, 'foo')",
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
}
