//! Physische Entfernung geschwärzter Werte (LFH-725).
//!
//! `secure_delete = ON` in [`super::connect`] nullt freigewordenen Platz, aber zunächst nur in
//! den Seitenabbildern im WAL; die Hauptdatei trägt den Vorzustand bis zum Checkpoint weiter,
//! und der WAL selbst behält alte Frames, bis er gekürzt wird. Deshalb nach einer Schwärzung
//! [`wal_zurueckschreiben`]. Was vor LFH-725 freigeworden ist, erreicht `secure_delete` nicht
//! mehr; das räumt [`bereinige_altbestand_einmalig`] beim Serverstart.
//!
//! Herleitung und Messung:
//! `openspec/changes/archive/2026-10-01-lfh-725-schwaerzung-physisch-ueberschreiben/design.md`;
//! die Schreibsperre der Schwärzung bei vielen Anhängen (Nachlauf je Anhang, LFH-905):
//! `openspec/changes/lfh-905-schwaerzung-schreibsperre-begrenzen/design.md`.

use sqlx::SqlitePool;

/// Schlüssel in `app_meta`: der Altbestand ist einmal per `VACUUM` neu aufgebaut.
const MARKER_ALTBESTAND: &str = "physisch_bereinigt_lfh725";

/// Schreibt den WAL vollständig in die Hauptdatei zurück und kürzt ihn auf null Bytes
/// (`wal_checkpoint(TRUNCATE)`). `true` nur, wenn das vollständig gelang.
///
/// `false` heißt: eine andere Verbindung (eine Lesetransaktion oder ein Schreibender) hielt den
/// Rückschrieb auch nach `busy_timeout` auf. Der Aufrufer holt ihn dann später nach. Während
/// des Wartens sind Schreibende blockiert — deshalb nur nach einer Schwärzung, nicht
/// periodisch.
pub async fn wal_zurueckschreiben(pool: &SqlitePool) -> Result<bool, sqlx::Error> {
    let (busy, _frames, _zurueckgeschrieben): (i64, i64, i64) =
        sqlx::query_as("PRAGMA wal_checkpoint(TRUNCATE)")
            .fetch_one(pool)
            .await?;
    Ok(busy == 0)
}

/// Baut die Datenbank genau einmal per `VACUUM` neu auf, damit Bytes, die vor LFH-725
/// freigeworden sind (frühere Schwärzungen, gelöschte Anhänge), nicht in Freeblocks und auf
/// Freelist-Seiten stehen bleiben. `Ok(true)`, wenn der Neuaufbau jetzt lief; `Ok(false)`, wenn
/// der Marker schon gesetzt war.
///
/// Der Marker wird erst nach dem `VACUUM` gesetzt: scheitert es (etwa an fehlendem
/// Plattenplatz, es braucht vorübergehend bis zur doppelten DB-Größe: eine temporäre Kopie und
/// den WAL), versucht der nächste Start es erneut.
pub async fn bereinige_altbestand_einmalig(pool: &SqlitePool) -> Result<bool, sqlx::Error> {
    let erledigt: Option<String> = sqlx::query_scalar("SELECT value FROM app_meta WHERE key = ?")
        .bind(MARKER_ALTBESTAND)
        .fetch_optional(pool)
        .await?;
    if erledigt.is_some() {
        return Ok(false);
    }

    tracing::info!(
        "Beginne einmaligen Neuaufbau des Altbestands (VACUUM, LFH-725); dauert je nach \
         Datenbankgröße bis zu Minuten"
    );
    sqlx::query("VACUUM").execute(pool).await?;
    sqlx::query(
        "INSERT INTO app_meta (key, value) VALUES (?, datetime('now')) \
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    )
    .bind(MARKER_ALTBESTAND)
    .execute(pool)
    .await?;
    // Das VACUUM steht bis hierhin nur im WAL; erst der Rückschrieb ersetzt die alten Seiten.
    // Bleibt er blockiert, holt ihn der erste Purge-Tick nach (startet mit ausstehendem
    // Rückschrieb, `einsatz::purge_scheduler`).
    if !wal_zurueckschreiben(pool).await? {
        tracing::warn!(
            "Neuaufbau des Altbestands: WAL-Rückschrieb blockiert, der Purge-Lauf holt ihn nach"
        );
    }
    Ok(true)
}

/// Kommt `nadel` als Bytefolge in der Datenbankdatei oder ihrem WAL vor?
#[cfg(test)]
pub(crate) fn datei_oder_wal_enthaelt(db: &std::path::Path, nadel: &[u8]) -> bool {
    let mut wal = db.as_os_str().to_owned();
    wal.push("-wal");
    [db.to_path_buf(), std::path::PathBuf::from(wal)]
        .iter()
        .filter_map(|p| std::fs::read(p).ok())
        .any(|bytes| bytes.windows(nadel.len()).any(|w| w == nadel))
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePoolOptions};

    const KLARTEXT: &[u8] = b"LFH725-ALTBESTAND-KLARTEXT";

    /// Pool wie vor LFH-725: WAL, aber ohne `secure_delete`.
    async fn pool_ohne_secure_delete(pfad: &std::path::Path) -> SqlitePool {
        let options = SqliteConnectOptions::new()
            .filename(pfad)
            .create_if_missing(true)
            .journal_mode(SqliteJournalMode::Wal)
            .pragma("secure_delete", "OFF");
        SqlitePoolOptions::new()
            .max_connections(1)
            .connect_with(options)
            .await
            .unwrap()
    }

    /// Legt `KLARTEXT` an, löscht ihn ohne `secure_delete` wieder und schreibt zurück: die Bytes
    /// stehen danach nur noch in freigewordenem Platz der Hauptdatei.
    async fn pflanze_altbytes(pool: &SqlitePool, nadel: &[u8]) {
        sqlx::query("CREATE TABLE IF NOT EXISTS alt (id INTEGER PRIMARY KEY, daten BLOB)")
            .execute(pool)
            .await
            .unwrap();
        sqlx::query("INSERT INTO alt (daten) VALUES (?)")
            .bind(nadel.repeat(400))
            .execute(pool)
            .await
            .unwrap();
        sqlx::query("DELETE FROM alt").execute(pool).await.unwrap();
        assert!(wal_zurueckschreiben(pool).await.unwrap());
    }

    #[tokio::test]
    async fn wal_zurueckschreiben_kuerzt_den_wal() {
        let (dir, pool) = super::super::test_pool_datei().await;
        sqlx::query("INSERT INTO app_meta (key, value) VALUES ('lfh725-test', 'x')")
            .execute(&pool)
            .await
            .unwrap();
        let wal = dir.path().join("test.db-wal");
        assert!(std::fs::metadata(&wal).unwrap().len() > 0, "Vorbedingung");

        assert!(wal_zurueckschreiben(&pool).await.unwrap());
        assert_eq!(std::fs::metadata(&wal).unwrap().len(), 0);
    }

    /// Ein Lesender mit älterem Stand verhindert den vollständigen Rückschrieb; das meldet die
    /// Funktion als `false` statt als Erfolg. Wartet einmal `busy_timeout` (5 s).
    #[tokio::test]
    async fn wal_zurueckschreiben_meldet_blockierenden_leser() {
        let (_dir, pool) = super::super::test_pool_datei().await;
        let mut leser = pool.acquire().await.unwrap();
        sqlx::query("BEGIN").execute(&mut *leser).await.unwrap();
        sqlx::query("SELECT count(*) FROM app_meta")
            .execute(&mut *leser)
            .await
            .unwrap();
        sqlx::query("INSERT INTO app_meta (key, value) VALUES ('lfh725-test', 'x')")
            .execute(&pool)
            .await
            .unwrap();

        assert!(!wal_zurueckschreiben(&pool).await.unwrap());

        sqlx::query("COMMIT").execute(&mut *leser).await.unwrap();
        drop(leser);
        assert!(wal_zurueckschreiben(&pool).await.unwrap());
    }

    #[tokio::test]
    async fn altbestand_wird_einmal_neu_aufgebaut() {
        let dir = tempfile::tempdir().unwrap();
        let pfad = dir.path().join("alt.db");

        let alt = pool_ohne_secure_delete(&pfad).await;
        sqlx::query("CREATE TABLE app_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)")
            .execute(&alt)
            .await
            .unwrap();
        pflanze_altbytes(&alt, KLARTEXT).await;
        alt.close().await;
        assert!(
            datei_oder_wal_enthaelt(&pfad, KLARTEXT),
            "Vorbedingung: ohne secure_delete bleiben die gelöschten Bytes in der Datei"
        );

        let pool = super::super::connect(pfad.to_str().unwrap()).await.unwrap();
        assert!(bereinige_altbestand_einmalig(&pool).await.unwrap());
        assert!(!datei_oder_wal_enthaelt(&pfad, KLARTEXT));
        pool.close().await;

        // Zweiter Start: kein Neuaufbau. Ein inzwischen ohne secure_delete gelöschter Wert bleibt
        // deshalb stehen — der Beleg, dass kein VACUUM lief.
        let zweiter = b"LFH725-NACH-DEM-MARKER";
        let alt = pool_ohne_secure_delete(&pfad).await;
        pflanze_altbytes(&alt, zweiter).await;
        alt.close().await;
        let pool = super::super::connect(pfad.to_str().unwrap()).await.unwrap();
        assert!(!bereinige_altbestand_einmalig(&pool).await.unwrap());
        assert!(datei_oder_wal_enthaelt(&pfad, zweiter));
    }

    /// Messung OFF gegen ON (LFH-725, `design.md`, Entscheidung 5) und Nachlauf je Anhang
    /// (LFH-905, Modus `ON-einzeln`). Nicht Teil der Suite:
    /// `cargo test --release --lib secure_delete_messung -- --ignored --nocapture`.
    /// Anhangsgrößen in MB über `LFH725_MB` (Vorgabe `50,500`).
    ///
    /// Während Schwärzung und Rückschrieb schreibt eine zweite Verbindung fortlaufend kurze
    /// Transaktionen wie ein laufender Einsatz; `warten max` ist ihre längste Wartezeit, also die
    /// Schreibsperre, die andere Einsätze spüren. Der Pool läuft wie in Produktion mit dem
    /// automatischen Checkpoint (LFH-725 maß ohne, um die WAL-Größe zu zeigen); `WAL` ist deshalb
    /// der höchste Stand der Datei, nicht die Summe.
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    #[ignore]
    async fn secure_delete_messung() {
        use sqlx::Connection;
        use std::sync::atomic::{AtomicBool, Ordering};
        use std::sync::Arc;
        use std::time::{Duration, Instant};

        fn zufall(n: usize, mut x: u64) -> Vec<u8> {
            let mut v = Vec::with_capacity(n);
            while v.len() < n {
                x ^= x << 13;
                x ^= x >> 7;
                x ^= x << 17;
                v.extend_from_slice(&x.to_le_bytes());
            }
            v.truncate(n);
            v
        }
        fn mb(n: u64) -> f64 {
            n as f64 / 1e6
        }

        let groessen: Vec<usize> = std::env::var("LFH725_MB")
            .unwrap_or_else(|_| "50,500".into())
            .split(',')
            .map(|s| s.trim().parse().unwrap())
            .collect();

        for &anhang_mb in &groessen {
            for modus in ["OFF", "ON", "ON-einzeln"] {
                let einzeln = modus == "ON-einzeln";
                let dir = tempfile::tempdir().unwrap();
                let pfad = dir.path().join("mess.db");
                let wal = dir.path().join("mess.db-wal");
                let optionen = SqliteConnectOptions::new()
                    .filename(&pfad)
                    .create_if_missing(true)
                    .journal_mode(SqliteJournalMode::Wal)
                    .busy_timeout(Duration::from_secs(120))
                    .pragma("secure_delete", if einzeln { "ON" } else { modus });
                let pool = SqlitePoolOptions::new()
                    .max_connections(1)
                    .connect_with(optionen.clone())
                    .await
                    .unwrap();
                for ddl in [
                    "CREATE TABLE etb (id INTEGER PRIMARY KEY, inhalt TEXT NOT NULL)",
                    "CREATE TABLE person (id INTEGER PRIMARY KEY, name TEXT, notiz TEXT)",
                    "CREATE TABLE anhang (id INTEGER PRIMARY KEY, daten BLOB NOT NULL)",
                ] {
                    sqlx::query(ddl).execute(&pool).await.unwrap();
                }

                // Last 1: Anhängen wie ETB/Meldungen, eine Transaktion je Eintrag.
                let t = Instant::now();
                for i in 0..5000 {
                    sqlx::query("INSERT INTO etb (inhalt) VALUES (?)")
                        .bind(format!("Lagemeldung {i}: ").repeat(12))
                        .execute(&pool)
                        .await
                        .unwrap();
                }
                let anhaengen = t.elapsed();
                assert!(wal_zurueckschreiben(&pool).await.unwrap());

                // Bestand für die Schwärzung: 2000 Personen, Anhänge zu je 1 MB.
                for i in 0..2000 {
                    sqlx::query("INSERT INTO person (name, notiz) VALUES (?, ?)")
                        .bind(format!("Person {i}"))
                        .bind("Notiz ".repeat(30))
                        .execute(&pool)
                        .await
                        .unwrap();
                }
                for i in 0..anhang_mb {
                    sqlx::query("INSERT INTO anhang (daten) VALUES (?)")
                        .bind(zufall(1_000_000, 0x9E37_79B9_7F4A_7C15 ^ i as u64))
                        .execute(&pool)
                        .await
                        .unwrap();
                }
                assert!(wal_zurueckschreiben(&pool).await.unwrap());

                // Ein laufender Einsatz schreibt nebenher; gemessen wird seine längste Wartezeit.
                let stopp = Arc::new(AtomicBool::new(false));
                let schreiber = {
                    let stopp = stopp.clone();
                    let mut conn = sqlx::SqliteConnection::connect_with(&optionen)
                        .await
                        .unwrap();
                    tokio::spawn(async move {
                        let mut max = Duration::ZERO;
                        while !stopp.load(Ordering::Relaxed) {
                            let t = Instant::now();
                            sqlx::query("BEGIN IMMEDIATE")
                                .execute(&mut conn)
                                .await
                                .unwrap();
                            sqlx::query("INSERT INTO etb (inhalt) VALUES ('laufend')")
                                .execute(&mut conn)
                                .await
                                .unwrap();
                            sqlx::query("COMMIT").execute(&mut conn).await.unwrap();
                            max = max.max(t.elapsed());
                            tokio::time::sleep(Duration::from_millis(20)).await;
                        }
                        max
                    })
                };
                tokio::time::sleep(Duration::from_millis(100)).await;

                // Last 2: Schwärzung. Eine Transaktion (OFF, ON), oder atomar ohne Anhänge und
                // danach je Anhang eine Transaktion (ON-einzeln).
                let t = Instant::now();
                let mut tx = pool.begin().await.unwrap();
                sqlx::query("UPDATE person SET name = NULL, notiz = NULL")
                    .execute(&mut *tx)
                    .await
                    .unwrap();
                if !einzeln {
                    sqlx::query("DELETE FROM anhang")
                        .execute(&mut *tx)
                        .await
                        .unwrap();
                }
                tx.commit().await.unwrap();
                let mut laengste = t.elapsed();
                if einzeln {
                    let ids: Vec<i64> = sqlx::query_scalar("SELECT id FROM anhang")
                        .fetch_all(&pool)
                        .await
                        .unwrap();
                    for id in ids {
                        let t1 = Instant::now();
                        sqlx::query("DELETE FROM anhang WHERE id = ?")
                            .bind(id)
                            .execute(&pool)
                            .await
                            .unwrap();
                        laengste = laengste.max(t1.elapsed());
                    }
                }
                let schwaerzen = t.elapsed();
                let schwaerzen_wal = std::fs::metadata(&wal).unwrap().len();

                // Last 3: Rückschrieb danach.
                let t = Instant::now();
                assert!(wal_zurueckschreiben(&pool).await.unwrap());
                let rueckschrieb = t.elapsed();

                stopp.store(true, Ordering::Relaxed);
                let warten = schreiber.await.unwrap();

                println!(
                    "anhang={anhang_mb} MB modus={modus}: anhaengen {:.2} s | \
                     schwaerzen {:.2} s (laengste Tx {:.2} s) / WAL {:.1} MB | \
                     rueckschrieb {:.2} s | warten max {:.2} s",
                    anhaengen.as_secs_f64(),
                    schwaerzen.as_secs_f64(),
                    laengste.as_secs_f64(),
                    mb(schwaerzen_wal),
                    rueckschrieb.as_secs_f64(),
                    warten.as_secs_f64(),
                );
                pool.close().await;
            }
        }
    }
}
