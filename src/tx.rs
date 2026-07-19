//! Schreib-Transaktions-Disziplin (F09/LFH-240): `BEGIN IMMEDIATE` + zentrale
//! Busy-Retry-Schicht für den SQLite/WAL-Mehrplatzbetrieb.
//!
//! Hintergrund: Der Pool erlaubt mehrere Verbindungen für Lesen UND Schreiben. Eine
//! schreibende Transaktion, die zuerst liest (read-then-write), nimmt per deferred
//! `BEGIN` einen Read-Snapshot; ihr erster Write ist dann ein Lock-Upgrade, das SQLite
//! bei gehaltenem fremdem Writer SOFORT mit `SQLITE_BUSY` abweist — der `busy_timeout`
//! kann beim Upgrade prinzipbedingt nicht warten (sqlx-sqlite `options/mod.rs:181`).
//! `BEGIN IMMEDIATE` holt den Write-Lock vorab (am BEGIN, wo der `busy_timeout` warten
//! darf) und schließt das Upgrade-Fenster; die Retry-Schicht fängt den Rest (Contention
//! jenseits des Timeouts, `BUSY_SNAPSHOT`) und terminiert nach [`MAX_VERSUCHE`] fachlich
//! (503 via `AppError`) statt als undurchsichtigen 500.
//!
//! Genutzt wird das Makro [`write_retry!`] — es expandiert INLINE in die aufrufende
//! `async fn` (kein Closure/Fn-Trait, damit keine HRTB-Send-/Lifetime-Fallen bei
//! captureten Referenzen wie `notiz: &str`).
//!
//! **Reinheits-Kontrakt:** Der Transaktions-Body darf ausschließlich DB-Arbeit tun.
//! KEINE nicht-idempotenten Seiteneffekte (SSE-Publish, Zähler, Channel-Sends) im Body
//! — die liefen beim Retry doppelt. SSE/Broadcast bleibt (wie im ganzen Projekt, LFH-124)
//! NACH dem Commit in der Route-Schicht.

use std::time::Duration;

/// Höchstzahl der Versuche einer schreibenden Transaktion bei `SQLITE_BUSY`.
///
/// Deckelt zugleich die Worst-Case-Latenz (LFH-302): jeder Versuch kann am `BEGIN IMMEDIATE`
/// bis zum `busy_timeout` (5 s, `db.rs`) warten, bevor er `SQLITE_BUSY` liefert. Hält ein
/// fremder Writer den WAL-Write-Lock durchgehend länger als das Timeout (anomale
/// Massen-Operation), hängt ein konkurrierender Handler also bis zu `MAX_VERSUCHE × 5 s`,
/// bevor er 503 liefert — axum hat kein Default-Request-Timeout, das ihn früher kappen würde.
/// 4 Versuche halten den Worst Case bei ~20 s und kosten im Normalbetrieb nichts: dort löst
/// sich Contention im Millisekundenbereich am BEGIN, mehr als ein bis zwei Versuche kommen
/// praktisch nicht vor.
pub(crate) const MAX_VERSUCHE: u32 = 4;

/// `true`, wenn der Fehler aus der `SQLITE_BUSY`-Familie stammt (Primärcode 5:
/// BUSY, BUSY_SNAPSHOT=517, BUSY_RECOVERY=261, BUSY_TIMEOUT=773). sqlx-sqlite liefert
/// via [`sqlx::error::DatabaseError::code`] den *extended* Result-Code als Dezimalstring,
/// daher `(code & 0xFF) == 5`.
pub(crate) fn ist_busy(err: &sqlx::Error) -> bool {
    let sqlx::Error::Database(db) = err else {
        return false;
    };
    db.code()
        .and_then(|c| c.parse::<i32>().ok())
        .is_some_and(|code| (code & 0xFF) == 5)
}

/// Kurzer linearer Backoff (2 ms je Versuch, gedeckelt). Der SQLite-Writer-Konflikt löst
/// sich im Millisekundenbereich — wir wollen den Request-Handler nicht lange hängen lassen.
pub(crate) async fn backoff(versuch: u32) {
    let ms = u64::from(versuch).saturating_mul(2).min(20);
    tokio::time::sleep(Duration::from_millis(ms)).await;
}

/// Führt einen schreibenden Transaktions-Body mit `BEGIN IMMEDIATE` aus und wiederholt die
/// GANZE Transaktion (BEGIN … COMMIT) bei `SQLITE_BUSY` bis zu [`MAX_VERSUCHE`]-mal.
///
/// Der Body erhält die offene Transaktion als `&mut SqliteConnection` (Name via `|conn|`)
/// und endet mit `Ok(wert)`; `?` im Body terminiert nur die Transaktion, nicht die
/// aufrufende Funktion. Der Ausdruck evaluiert zu `Result<wert, AppError>`. Reinheits-
/// Kontrakt beachten (siehe Modul-Doku): keine Seiteneffekte im Body.
///
/// ```ignore
/// let id = write_retry!(pool, |conn| {
///     let n: i64 = sqlx::query_scalar("SELECT ...").fetch_one(&mut *conn).await?;
///     sqlx::query("UPDATE ...").execute(&mut *conn).await?;
///     Ok(n)
/// })?;
/// ```
#[macro_export]
macro_rules! write_retry {
    ($pool:expr, |$conn:ident| $body:block) => {{
        let __pool: &::sqlx::SqlitePool = $pool;
        let mut __versuch: u32 = 0u32;
        loop {
            __versuch += 1;
            let mut __tx = match __pool.begin_with("BEGIN IMMEDIATE").await {
                ::std::result::Result::Ok(__tx) => __tx,
                ::std::result::Result::Err(__e)
                    if $crate::tx::ist_busy(&__e) && __versuch < $crate::tx::MAX_VERSUCHE =>
                {
                    $crate::tx::backoff(__versuch).await;
                    continue;
                }
                ::std::result::Result::Err(__e) => {
                    break ::std::result::Result::Err(::std::convert::From::from(__e));
                }
            };
            let __res: ::std::result::Result<_, $crate::error::AppError> = async {
                let $conn: &mut ::sqlx::SqliteConnection = &mut *__tx;
                $body
            }
            .await;
            match __res {
                ::std::result::Result::Ok(__wert) => match __tx.commit().await {
                    ::std::result::Result::Ok(()) => break ::std::result::Result::Ok(__wert),
                    ::std::result::Result::Err(__e)
                        if $crate::tx::ist_busy(&__e) && __versuch < $crate::tx::MAX_VERSUCHE =>
                    {
                        $crate::tx::backoff(__versuch).await;
                        continue;
                    }
                    ::std::result::Result::Err(__e) => {
                        break ::std::result::Result::Err(::std::convert::From::from(__e));
                    }
                },
                // Fehler im Body: unter BEGIN IMMEDIATE hält die Tx den Write-Lock ab BEGIN,
                // in-Tx-Statements können also nicht BUSYen (BUSY nur an BEGIN/COMMIT, dort
                // behandelt). Propagieren statt erneut versuchen; __tx fällt aus dem Scope → ROLLBACK.
                ::std::result::Result::Err(__err) => break ::std::result::Result::Err(__err),
            }
        }
    }};
}

#[cfg(test)]
mod tests {
    use crate::error::AppError;

    #[tokio::test(flavor = "multi_thread", worker_threads = 4)]
    async fn nebenlaeufige_read_then_write_ohne_lost_update() {
        // 40 parallele read-then-write-Erhöhungen desselben Zählers. Ohne
        // BEGIN IMMEDIATE + Retry gäbe das Lost Updates bzw. SQLITE_BUSY-Fehler;
        // mit dem Makro muss jede Erhöhung zählen. Braucht das Datei/WAL-Harness (F28).
        let (_dir, pool) = crate::db::test_pool_datei().await;
        sqlx::query("CREATE TABLE zaehler (id INTEGER PRIMARY KEY, wert INTEGER NOT NULL)")
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query("INSERT INTO zaehler (id, wert) VALUES (1, 0)")
            .execute(&pool)
            .await
            .unwrap();

        const N: i64 = 40;
        let mut handles = Vec::new();
        for _ in 0..N {
            let pool = pool.clone();
            handles.push(tokio::spawn(async move {
                let ergebnis: Result<(), AppError> = crate::write_retry!(&pool, |conn| {
                    let wert: i64 = sqlx::query_scalar("SELECT wert FROM zaehler WHERE id = 1")
                        .fetch_one(&mut *conn)
                        .await?;
                    sqlx::query("UPDATE zaehler SET wert = ? WHERE id = 1")
                        .bind(wert + 1)
                        .execute(&mut *conn)
                        .await?;
                    Ok(())
                });
                ergebnis
            }));
        }
        for h in handles {
            h.await.unwrap().unwrap();
        }

        let wert: i64 = sqlx::query_scalar("SELECT wert FROM zaehler WHERE id = 1")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(
            wert, N,
            "jede der {N} Erhöhungen muss zählen (kein Lost Update)"
        );
    }

    #[test]
    fn ist_busy_erkennt_die_busy_familie_nicht_andere() {
        // Reiner Klassifikations-Check ohne DB: andere Fehler sind nicht busy.
        assert!(!super::ist_busy(&sqlx::Error::RowNotFound));
        assert!(!super::ist_busy(&sqlx::Error::PoolClosed));
    }
}
