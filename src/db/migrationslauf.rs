//! Migrationslauf mit atomaren Tabellenumbauten (LLH-1659).
//!
//! Eine Migration, deren erste Zeile `-- no-transaction` lautet, führt sqlx 0.9 Anweisung für
//! Anweisung aus; jede wird sofort fest, die Buchung in `_sqlx_migrations` kommt erst am Ende.
//! Bricht so ein Tabellenumbau ab (SQL-Fehler, Absturz), bleibt `X_neu` stehen oder `X` fehlt,
//! und jeder weitere Start scheitert an `CREATE TABLE X_neu`, auch mit berichtigten Daten.
//!
//! Der Marker steht dort, weil `PRAGMA foreign_keys = OFF` in einer offenen Transaktion nichts
//! bewirkt. SQLite empfiehlt für Tabellenumbauten deshalb: Pragma außen, Umbau in einer
//! Transaktion. Genau das macht [`einspielen`], ohne eine Migrationsdatei anzufassen:
//!
//! - Eine Marker-Migration ohne eigenes `COMMIT` reicht es an sqlx als gewöhnliche Migration
//!   weiter (gleicher Text, also gleiche Prüfsumme). sqlx führt dann Rumpf und Buchung in einer
//!   Transaktion aus, ganz oder gar nicht.
//! - Schaltet der Rumpf die Fremdschlüssel aus, tut der Lauf das vorher auf der
//!   Migrationsverbindung selbst und schaltet sie danach wieder ein. Die Pragmas im Rumpf sind in
//!   der Transaktion wirkungslos.
//! - Eine Marker-Migration mit eigenem `BEGIN … COMMIT` (0325) läuft wie bisher.
//!
//! Regel für neue Migrationen (AGENTS.md, „Backend — Migrationen ohne Transaktion“): den Marker
//! nur, wenn der Umbau `PRAGMA foreign_keys = OFF` braucht. Wächter:
//! [`tests::neue_marker_migration_schaltet_fremdschluessel_aus`].

use std::borrow::Cow;

use sqlx::migrate::{MigrateError, Migration, Migrator};
use sqlx::SqlitePool;

/// Wie eine Migration eingespielt wird.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum Rahmen {
    /// Ohne Marker: sqlx rahmt sie selbst in eine Transaktion.
    Sqlx,
    /// Mit Marker, ohne eigenes `COMMIT`: der Lauf rahmt sie in eine Transaktion,
    /// bei `fk_aus` mit ausgeschalteten Fremdschlüsseln.
    Atomar { fk_aus: bool },
    /// Mit Marker und eigenem `BEGIN … COMMIT`: läuft unverändert ohne äußere Transaktion.
    Eigen,
}

pub(super) fn rahmen(m: &Migration) -> Rahmen {
    if !m.no_tx {
        return Rahmen::Sqlx;
    }
    let anweisungen = ohne_kommentare(m.sql.as_str());
    if hat_eigenes_commit(&anweisungen) {
        Rahmen::Eigen
    } else {
        Rahmen::Atomar {
            fk_aus: schaltet_fk_aus(&anweisungen),
        }
    }
}

/// Der SQL-Text ohne `--`-Kommentare, in Kleinbuchstaben, eine Zeile je Quellzeile.
fn ohne_kommentare(sql: &str) -> Vec<String> {
    sql.lines()
        .map(|zeile| {
            zeile
                .split_once("--")
                .map_or(zeile, |(vorn, _)| vorn)
                .trim()
                .to_lowercase()
        })
        .filter(|zeile| !zeile.is_empty())
        .collect()
}

/// `COMMIT` statt `BEGIN`: ein Trigger-Rumpf enthält `BEGIN … END`, aber nie `COMMIT`.
fn hat_eigenes_commit(zeilen: &[String]) -> bool {
    zeilen.iter().any(|z| {
        z.strip_prefix("commit")
            .is_some_and(|rest| rest.is_empty() || rest.starts_with([';', ' ', '\t']))
    })
}

fn schaltet_fk_aus(zeilen: &[String]) -> bool {
    zeilen.iter().any(|z| {
        let dicht: String = z.chars().filter(|c| !c.is_whitespace()).collect();
        ["off", "0", "false", "no"]
            .iter()
            .any(|wert| dicht.starts_with(&format!("pragmaforeign_keys={wert}")))
    })
}

/// Spielt alle ausstehenden Migrationen aus `quelle` ein, Marker-Migrationen atomar (s. Modul).
pub(super) async fn einspielen(quelle: Migrator, pool: &SqlitePool) -> Result<(), MigrateError> {
    let einteilung: Vec<(i64, Rahmen)> = quelle.iter().map(|m| (m.version, rahmen(m))).collect();
    let umgeleitet: Vec<Migration> = quelle
        .iter()
        .map(|m| match rahmen(m) {
            Rahmen::Atomar { .. } => Migration::new(
                m.version,
                m.description.clone(),
                m.migration_type,
                m.sql.clone(),
                false,
            ),
            Rahmen::Sqlx | Rahmen::Eigen => m.clone(),
        })
        .collect();
    let migrator = Migrator {
        migrations: Cow::Owned(umgeleitet),
        ..quelle
    };

    // Eine Verbindung für den ganzen Lauf: `foreign_keys` gilt je Verbindung. Nach jedem Umbau
    // gilt wieder der Stand, mit dem der Lauf die Verbindung bekam (im Betrieb an, s.
    // [`super::connect`]; ein Migrationstest darf sie bewusst ausgeschaltet übergeben).
    let mut conn = pool.acquire().await?;
    let vorher: i64 = sqlx::query_scalar("PRAGMA foreign_keys")
        .fetch_one(&mut *conn)
        .await?;
    let zuruecksetzen = if vorher == 0 {
        "PRAGMA foreign_keys = OFF"
    } else {
        "PRAGMA foreign_keys = ON"
    };

    // `run_direct` statt `run`/`run_to`: Diese gehen über `Acquire<'a>`, und ihr Future ist dann
    // nicht für jede Lebensdauer `Send`. `db::migrate` läuft auch im Archivbau unter
    // `tokio::spawn` (Purge-Scheduler), dort bräche der Bau. `run`/`run_to` rufen intern
    // dasselbe `run_direct(…, false)`.
    let ergebnis = async {
        for (version, r) in &einteilung {
            if *r != (Rahmen::Atomar { fk_aus: true }) {
                continue;
            }
            migrator
                .run_direct(Some(version - 1), &mut *conn, false)
                .await?;
            sqlx::query("PRAGMA foreign_keys = OFF")
                .execute(&mut *conn)
                .await?;
            let umbau = migrator.run_direct(Some(*version), &mut *conn, false).await;
            sqlx::query(zuruecksetzen).execute(&mut *conn).await?;
            umbau?;
        }
        migrator.run_direct(None, &mut *conn, false).await
    }
    .await;

    if ergebnis.is_err() {
        // Ein abgebrochener Umbau ist zurückgerollt, bevor das Zurücksetzen oben läuft (sqlx
        // reiht das ROLLBACK des fallen gelassenen Transaktionsobjekts davor ein). Steht das
        // Pragma trotzdem nicht wieder auf dem alten Wert, war noch eine Transaktion offen:
        // diese Verbindung nicht an den Pool zurückgeben.
        let jetzt: Option<i64> = sqlx::query_scalar("PRAGMA foreign_keys")
            .fetch_one(&mut *conn)
            .await
            .ok();
        if jetzt != Some(vorher) {
            conn.close_on_drop();
        }
    }
    ergebnis
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::migrate::MigrationType;
    use sqlx::SqlSafeStr;

    /// Letzte Migration, als LLH-1659 den Lauf umstellte. Bis hierhin ist die Einteilung
    /// festgeschrieben; danach gilt die Regel aus dem Modulkommentar.
    const BESTAND_BIS: i64 = 325;

    fn versionen(filter: impl Fn(Rahmen) -> bool) -> Vec<i64> {
        sqlx::migrate!("./migrations")
            .iter()
            .filter(|m| m.version <= BESTAND_BIS && filter(rahmen(m)))
            .map(|m| m.version)
            .collect()
    }

    /// Welche veröffentlichte Migration wie läuft. Ändert sich das, läuft eine bereits
    /// eingespielte Datei auf neuen Installationen anders als auf alten.
    #[test]
    fn einteilung_des_bestands_ist_festgeschrieben() {
        assert_eq!(
            versionen(|r| r == Rahmen::Atomar { fk_aus: true }),
            [78, 79, 82, 119, 159, 176, 185, 192, 213, 235, 286],
            "Umbauten mit ausgeschalteten Fremdschlüsseln"
        );
        assert_eq!(
            versionen(|r| r == Rahmen::Atomar { fk_aus: false }),
            [112, 132, 141, 143, 155, 169, 170, 174, 222, 269, 301, 307, 309, 311, 317],
            "Blatt-Umbauten, bei denen der Marker unnötig war"
        );
        assert_eq!(
            versionen(|r| r == Rahmen::Eigen),
            [325],
            "eigene Transaktion"
        );
    }

    /// Neue Migrationen tragen `-- no-transaction` nur, wenn sie die Fremdschlüssel ausschalten.
    /// Ein Blatt-Umbau läuft ohne Marker in der Transaktion von sqlx (Muster 0208, 0324).
    #[test]
    fn neue_marker_migration_schaltet_fremdschluessel_aus() {
        let verstoesse: Vec<String> = sqlx::migrate!("./migrations")
            .iter()
            .filter(|m| m.version > BESTAND_BIS && m.no_tx)
            .filter(|m| !schaltet_fk_aus(&ohne_kommentare(m.sql.as_str())))
            .map(|m| format!("{:04}_{}", m.version, m.description))
            .collect();
        assert!(
            verstoesse.is_empty(),
            "`-- no-transaction` ohne `PRAGMA foreign_keys = OFF` — Marker entfernen, sqlx rahmt \
             den Umbau dann selbst in eine Transaktion: {verstoesse:?}"
        );
    }

    #[test]
    fn umgeleitete_migration_behaelt_ihre_pruefsumme() {
        for m in sqlx::migrate!("./migrations").iter().filter(|m| m.no_tx) {
            let neu = Migration::new(
                m.version,
                m.description.clone(),
                m.migration_type,
                m.sql.clone(),
                false,
            );
            assert_eq!(neu.checksum, m.checksum, "Prüfsumme {:04}", m.version);
        }
    }

    #[test]
    fn erkennung_von_pragma_und_commit() {
        let zeilen = |sql: &str| ohne_kommentare(sql);
        assert!(schaltet_fk_aus(&zeilen("PRAGMA  foreign_keys=OFF;")));
        assert!(schaltet_fk_aus(&zeilen("pragma foreign_keys = 0;")));
        assert!(!schaltet_fk_aus(&zeilen(
            "-- PRAGMA foreign_keys = OFF\nSELECT 1;"
        )));
        assert!(!schaltet_fk_aus(&zeilen("PRAGMA foreign_keys = ON;")));
        assert!(hat_eigenes_commit(&zeilen("BEGIN;\nSELECT 1;\nCOMMIT;")));
        assert!(!hat_eigenes_commit(&zeilen(
            "CREATE TRIGGER t AFTER INSERT ON a\nBEGIN\n  SELECT 1;\nEND;"
        )));
        assert!(!hat_eigenes_commit(&zeilen("-- COMMIT;\nSELECT 1;")));
    }

    // --- Verhalten an einem nachgebauten Umbau -------------------------------------------

    fn migration(version: i64, sql: &'static str) -> Migration {
        Migration::new(
            version,
            Cow::Borrowed("probe"),
            MigrationType::Simple,
            sql.into_sql_str(),
            sql.starts_with("-- no-transaction"),
        )
    }

    fn migrator(migrationen: Vec<Migration>) -> Migrator {
        Migrator {
            migrations: Cow::Owned(migrationen),
            ..Migrator::DEFAULT
        }
    }

    /// `eltern` hat ein Kind mit `ON DELETE CASCADE` und eine Zeile mit leerem Namen, die der
    /// neue CHECK abweist.
    const GRUNDLAGE: &str = "
        CREATE TABLE eltern (id INTEGER PRIMARY KEY, name TEXT NOT NULL);
        CREATE TABLE kind (
            id INTEGER PRIMARY KEY,
            eltern_id INTEGER NOT NULL REFERENCES eltern(id) ON DELETE CASCADE
        );
        INSERT INTO eltern VALUES (1, 'a'), (2, '');
        INSERT INTO kind VALUES (1, 1), (2, 2);
    ";

    /// Umbau nach dem Muster 0159: Pragma aus, neu anlegen, umfüllen, alte weg, umbenennen.
    const UMBAU: &str = "-- no-transaction
PRAGMA foreign_keys = OFF;
CREATE TABLE eltern_neu (id INTEGER PRIMARY KEY, name TEXT NOT NULL CHECK (name <> ''));
INSERT INTO eltern_neu (id, name) SELECT id, name FROM eltern;
DROP TABLE eltern;
ALTER TABLE eltern_neu RENAME TO eltern;
PRAGMA foreign_keys = ON;
";

    /// Datei mit eigener Verbindung je Lauf, wie im Betrieb.
    async fn datei_pool() -> (tempfile::TempDir, SqlitePool) {
        let dir = tempfile::tempdir().unwrap();
        let pool = sqlx::sqlite::SqlitePoolOptions::new()
            .max_connections(1)
            .connect_with(
                sqlx::sqlite::SqliteConnectOptions::new()
                    .filename(dir.path().join("probe.db"))
                    .create_if_missing(true)
                    .foreign_keys(true),
            )
            .await
            .unwrap();
        (dir, pool)
    }

    async fn tabellen(pool: &SqlitePool) -> Vec<String> {
        sqlx::query_scalar(
            "SELECT name FROM sqlite_master WHERE type = 'table' \
             AND name NOT LIKE 'sqlite_%' AND name <> '_sqlx_migrations' ORDER BY name",
        )
        .fetch_all(pool)
        .await
        .unwrap()
    }

    async fn gebucht(pool: &SqlitePool) -> Vec<i64> {
        sqlx::query_scalar("SELECT version FROM _sqlx_migrations ORDER BY version")
            .fetch_all(pool)
            .await
            .unwrap()
    }

    async fn zaehle(pool: &SqlitePool, tabelle: &'static str) -> i64 {
        sqlx::query_scalar(sqlx::AssertSqlSafe(format!(
            "SELECT COUNT(*) FROM {tabelle}"
        )))
        .fetch_one(pool)
        .await
        .unwrap()
    }

    async fn fk_an(pool: &SqlitePool) -> i64 {
        sqlx::query_scalar("PRAGMA foreign_keys")
            .fetch_one(pool)
            .await
            .unwrap()
    }

    async fn berichtigen(pool: &SqlitePool) {
        sqlx::query("UPDATE eltern SET name = 'b' WHERE id = 2")
            .execute(pool)
            .await
            .unwrap();
    }

    /// Der Fehler, um den es geht: sqlx allein lässt nach einem SQL-Fehler `eltern_neu` stehen,
    /// und auch mit berichtigten Daten scheitert jeder weitere Lauf.
    #[tokio::test]
    async fn sqlx_allein_hinterlaesst_halben_umbau() {
        let (_dir, pool) = datei_pool().await;
        let m = migrator(vec![migration(1, GRUNDLAGE), migration(2, UMBAU)]);

        m.run(&pool)
            .await
            .expect_err("CHECK weist die leere Zeile ab");
        assert_eq!(tabellen(&pool).await, ["eltern", "eltern_neu", "kind"]);

        berichtigen(&pool).await;
        let fehler = m.run(&pool).await.unwrap_err().to_string();
        assert!(fehler.contains("eltern_neu"), "{fehler}");
    }

    #[tokio::test]
    async fn abgebrochener_umbau_hinterlaesst_nichts_und_laeuft_nach_berichtigung_durch() {
        let (_dir, pool) = datei_pool().await;
        let m = || migrator(vec![migration(1, GRUNDLAGE), migration(2, UMBAU)]);

        einspielen(m(), &pool)
            .await
            .expect_err("CHECK weist die leere Zeile ab");
        assert_eq!(
            tabellen(&pool).await,
            ["eltern", "kind"],
            "keine halbe Tabelle"
        );
        assert_eq!(gebucht(&pool).await, [1], "Umbau nicht gebucht");
        assert_eq!(zaehle(&pool, "eltern").await, 2);
        assert_eq!(fk_an(&pool).await, 1, "Fremdschlüssel wieder an");

        berichtigen(&pool).await;
        einspielen(m(), &pool).await.expect("nach Berichtigung");
        assert_eq!(gebucht(&pool).await, [1, 2]);
        assert_eq!(
            zaehle(&pool, "kind").await,
            2,
            "DROP TABLE eltern löst keine Kaskade aus: das Pragma wirkt"
        );
        assert_eq!(fk_an(&pool).await, 1, "Fremdschlüssel wieder an");
        let check: String =
            sqlx::query_scalar("SELECT sql FROM sqlite_master WHERE name = 'eltern'")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert!(check.contains("CHECK"), "neues Schema: {check}");
    }

    /// Der Lauf lässt `foreign_keys` so, wie er die Verbindung bekam (Migrationstests schalten
    /// es für Altbestand bewusst aus), und gibt sie nach einem sauber zurückgerollten Abbruch
    /// weiter: die `:memory:`-Datenbank bleibt erhalten.
    #[tokio::test]
    async fn fremdschluessel_stand_der_verbindung_bleibt_auch_nach_abbruch() {
        let pool = super::super::leerer_test_pool().await;
        sqlx::query("PRAGMA foreign_keys = OFF")
            .execute(&pool)
            .await
            .unwrap();
        let m = || migrator(vec![migration(1, GRUNDLAGE), migration(2, UMBAU)]);

        einspielen(m(), &pool).await.expect_err("CHECK");
        assert_eq!(
            tabellen(&pool).await,
            ["eltern", "kind"],
            "Verbindung noch dieselbe"
        );
        assert_eq!(fk_an(&pool).await, 0);

        berichtigen(&pool).await;
        einspielen(m(), &pool).await.expect("nach Berichtigung");
        assert_eq!(gebucht(&pool).await, [1, 2]);
        assert_eq!(fk_an(&pool).await, 0);
    }

    /// Abbruch zwischen `DROP` und `RENAME`, der Fall aus der Aufgabe: ohne Transaktion fehlte
    /// `eltern` danach ganz.
    #[tokio::test]
    async fn abbruch_nach_drop_laesst_alte_tabelle_stehen() {
        let (_dir, pool) = datei_pool().await;
        let abbruch = "-- no-transaction
PRAGMA foreign_keys = OFF;
CREATE TABLE eltern_neu (id INTEGER PRIMARY KEY, name TEXT NOT NULL);
INSERT INTO eltern_neu (id, name) SELECT id, name FROM eltern;
DROP TABLE eltern;
INSERT INTO gibt_es_nicht VALUES (1);
ALTER TABLE eltern_neu RENAME TO eltern;
PRAGMA foreign_keys = ON;
";
        einspielen(
            migrator(vec![migration(1, GRUNDLAGE), migration(2, abbruch)]),
            &pool,
        )
        .await
        .expect_err("gibt_es_nicht");

        assert_eq!(tabellen(&pool).await, ["eltern", "kind"]);
        assert_eq!(zaehle(&pool, "eltern").await, 2);
        assert_eq!(zaehle(&pool, "kind").await, 2);
        assert_eq!(gebucht(&pool).await, [1]);
    }

    /// Blatt-Umbau mit Marker, aber ohne Pragma (wie 0301): ebenfalls ganz oder gar nicht.
    #[tokio::test]
    async fn blatt_umbau_mit_marker_ohne_pragma_ist_atomar() {
        let (_dir, pool) = datei_pool().await;
        let blatt = "-- no-transaction
CREATE TABLE kind_neu (
    id INTEGER PRIMARY KEY,
    eltern_id INTEGER NOT NULL REFERENCES eltern(id) ON DELETE CASCADE CHECK (eltern_id < 2)
);
INSERT INTO kind_neu SELECT id, eltern_id FROM kind;
DROP TABLE kind;
ALTER TABLE kind_neu RENAME TO kind;
";
        einspielen(
            migrator(vec![migration(1, GRUNDLAGE), migration(2, blatt)]),
            &pool,
        )
        .await
        .expect_err("CHECK weist kind 2 ab");

        assert_eq!(tabellen(&pool).await, ["eltern", "kind"]);
        assert_eq!(zaehle(&pool, "kind").await, 2);
        assert_eq!(gebucht(&pool).await, [1]);
    }

    /// Die echte Kette ergibt mit dem neuen Lauf dasselbe Schema und dieselben Buchungen wie
    /// mit sqlx allein.
    #[tokio::test]
    async fn ganze_kette_ergibt_dasselbe_schema_wie_sqlx_allein() {
        async fn stand(
            pool: &SqlitePool,
        ) -> (Vec<(String, String, Option<String>)>, Vec<(i64, Vec<u8>)>) {
            let schema = sqlx::query_as(
                "SELECT type, name, sql FROM sqlite_master \
                 WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name",
            )
            .fetch_all(pool)
            .await
            .unwrap();
            let buchungen =
                sqlx::query_as("SELECT version, checksum FROM _sqlx_migrations ORDER BY version")
                    .fetch_all(pool)
                    .await
                    .unwrap();
            (schema, buchungen)
        }

        let bisher = super::super::leerer_test_pool().await;
        sqlx::migrate!("./migrations").run(&bisher).await.unwrap();
        let neu = super::super::leerer_test_pool().await;
        einspielen(sqlx::migrate!("./migrations"), &neu)
            .await
            .unwrap();

        assert_eq!(stand(&neu).await, stand(&bisher).await);
        assert_eq!(fk_an(&neu).await, 1);
    }
}
