//! Schreib-Transaktions-Disziplin (LFH-240): `BEGIN IMMEDIATE` + zentrale Busy-Retry-Schicht
//! für SQLite/WAL.
//!
//! Eine schreibende Transaktion, die zuerst liest, nimmt per deferred `BEGIN` einen
//! Read-Snapshot; ihr erster Write ist ein Lock-Upgrade, das SQLite bei gehaltenem fremdem
//! Writer SOFORT mit `SQLITE_BUSY` abweist — der `busy_timeout` wartet beim Upgrade nicht.
//! `BEGIN IMMEDIATE` holt den Write-Lock am BEGIN, wo der Timeout wartet; die Retry-Schicht
//! fängt den Rest und endet nach [`MAX_VERSUCHE`] mit 503 statt 500.
//!
//! [`write_retry!`] expandiert inline in die aufrufende `async fn` (kein Closure), damit keine
//! HRTB-Send-/Lifetime-Fallen bei geborgten Referenzen entstehen.
//!
//! **Reinheits-Kontrakt:** der Body darf nur DB-Arbeit tun. Keine nicht-idempotenten
//! Seiteneffekte (SSE-Publish, Zähler, Channel-Sends) — die liefen beim Retry doppelt.
//! SSE/Broadcast bleibt nach dem Commit in der Route-Schicht.

use std::time::Duration;

/// Höchstzahl der Versuche bei `SQLITE_BUSY`. Deckelt zugleich die Worst-Case-Latenz: jeder
/// Versuch kann am `BEGIN IMMEDIATE` bis zum `busy_timeout` (5 s) warten, ein Handler hängt also
/// bis zu ~20 s. Im Normalbetrieb löst sich Contention in Millisekunden.
pub(crate) const MAX_VERSUCHE: u32 = 4;

/// `true` für die `SQLITE_BUSY`-Familie (Primärcode 5: BUSY, BUSY_SNAPSHOT, BUSY_RECOVERY,
/// BUSY_TIMEOUT). sqlx liefert den *extended* Code als Dezimalstring, daher `(code & 0xFF) == 5`.
pub(crate) fn ist_busy(err: &sqlx::Error) -> bool {
    let sqlx::Error::Database(db) = err else {
        return false;
    };
    db.code()
        .and_then(|c| c.parse::<i32>().ok())
        .is_some_and(|code| (code & 0xFF) == 5)
}

/// Kurzer linearer Backoff (2 ms je Versuch, gedeckelt); der Writer-Konflikt löst sich in
/// Millisekunden.
pub(crate) async fn backoff(versuch: u32) {
    let ms = u64::from(versuch).saturating_mul(2).min(20);
    tokio::time::sleep(Duration::from_millis(ms)).await;
}

/// Führt einen schreibenden Transaktions-Body mit `BEGIN IMMEDIATE` aus und wiederholt die GANZE
/// Transaktion bei `SQLITE_BUSY` bis zu [`MAX_VERSUCHE`]-mal.
///
/// Der Body erhält die Transaktion als `&mut SqliteConnection` (`|conn|`) und endet mit
/// `Ok(wert)`; `?` im Body beendet nur die Transaktion. Der Ausdruck ergibt
/// `Result<wert, AppError>`. Reinheits-Kontrakt beachten (s. Modul-Doku).
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
                // Fehler im Body: unter BEGIN IMMEDIATE können in-Tx-Statements nicht BUSYen (nur
                // BEGIN/COMMIT, dort behandelt). Propagieren; `__tx` fällt aus dem Scope →
                // ROLLBACK.
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
        // 40 parallele read-then-write-Erhöhungen desselben Zählers; jede muss zählen. Braucht das
        // Datei/WAL-Harness.
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
