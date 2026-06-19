//! Aufbewahrungs-Purge-Scheduler (LFH-135) — gespiegeltes Muster von
//! `erinnerung::scheduler`: ein dünner Tokio-`interval`-Task ruft periodisch
//! `tick_einmal`; die Logik selbst ist mit injiziertem `jetzt` deterministisch
//! testbar. Idempotent über WHERE-Guards in den Repo-Queries.
//!
//! Zwei Phasen:
//! - **Phase A** (reversibel): Einsätze mit abgelaufener Aufbewahrungsfrist werden
//!   soft-gelöscht (`geloescht_at` gesetzt = Karenz-Start). Ab da am Datenzugriff
//!   gesperrt (`darf_lesen`).
//! - **Phase B** (IRREVERSIBEL): nach Ablauf der Karenz (`KARENZ_TAGE`) werden die
//!   Personendaten gescrubbt (`repo::schwaerze_einsatz`), das operative Skelett
//!   (Einsatz, ETB, Zähler) bleibt erhalten. `geschwaerzt_at`-Tombstone = Idempotenz.
//!
//! DATENVERLUST-kritisch: jede Mutation wird zuvor mit `tracing` protokolliert und
//! mit einem ETB-System-Audit begleitet; aktive Einsätze sind durch
//! `status='abgeschlossen'` in jeder Purge-Query hart ausgeschlossen.

use super::repo;
use chrono::{DateTime, Utc};
use sqlx::SqlitePool;
use std::time::Duration;

/// Pollintervall des Purge-Schedulers (10 Minuten — Aufbewahrung ist tagesgenau,
/// kein Sekunden-Druck wie bei Erinnerungen).
const TICK_SEKUNDEN: u64 = 600;

/// Formatiert einen UTC-Zeitpunkt im kanonischen DB-Format.
fn fmt(t: DateTime<Utc>) -> String {
    t.format("%Y-%m-%d %H:%M:%S").to_string()
}

/// Ein Purge-Durchlauf für den Zeitpunkt `jetzt`. Führt Phase A (Soft-Delete) und
/// Phase B (PII-Schwärzung) aus und liefert die Gesamtzahl der mutierten Einsätze.
/// Async + injiziertes `jetzt` = deterministisch testbar. Idempotent: ein zweiter
/// Tick ohne neue Fälligkeiten liefert 0.
pub async fn tick_einmal(pool: &SqlitePool, jetzt: DateTime<Utc>) -> usize {
    let jetzt_s = fmt(jetzt);
    let mut anzahl = 0;

    // --- Phase A: Soft-Delete fälliger Einsätze (reversibel, Karenz-Start) ---
    match repo::faellige_soft_delete(pool, &jetzt_s).await {
        Ok(ids) => {
            for id in ids {
                tracing::info!(einsatz_id = id, "Purge Phase A: Soft-Delete (Aufbewahrungsfrist abgelaufen)");
                match repo::soft_delete_einsatz(pool, id, &jetzt_s).await {
                    Ok(true) => anzahl += 1,
                    Ok(false) => {} // Race: bereits soft-gelöscht.
                    Err(e) => tracing::warn!(einsatz_id = id, "Purge Phase A fehlgeschlagen: {e}"),
                }
            }
        }
        Err(e) => tracing::warn!("Purge Phase A: Abfrage fehlgeschlagen: {e}"),
    }

    // Phase B (PII-Schwärzung nach Karenz) wird in LFH-135 Task 6 ergänzt.

    anzahl
}

/// Startet den Hintergrund-Purge-Scheduler (nur im Produktivlauf aus `main.rs`).
/// Dünner Wrapper um `tick_einmal`; die Logik selbst ist oben testbar.
pub fn starte_purge_scheduler(pool: SqlitePool) {
    tokio::spawn(async move {
        let mut ticker = tokio::time::interval(Duration::from_secs(TICK_SEKUNDEN));
        loop {
            ticker.tick().await;
            tick_einmal(&pool, Utc::now()).await;
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::NaiveDateTime;

    fn t(s: &str) -> DateTime<Utc> {
        NaiveDateTime::parse_from_str(s, "%Y-%m-%d %H:%M:%S")
            .unwrap()
            .and_utc()
    }

    /// Org + Benutzer + ABGESCHLOSSENER Einsatz mit gesetzter, abgelaufener Frist.
    /// Liefert die einsatz_id. `retention_bis` liegt in der Vergangenheit.
    async fn abgeschlossen_mit_frist(
        pool: &SqlitePool,
        retention_bis: &str,
    ) -> i64 {
        sqlx::query("INSERT OR IGNORE INTO organisation (id, name) VALUES (1, 'Orga')")
            .execute(pool)
            .await
            .unwrap();
        let b: i64 = sqlx::query_scalar(
            "INSERT INTO benutzer (org_id, anzeigename, benutzername, passwort_hash) \
             VALUES (1,'L','l','h') RETURNING id",
        )
        .fetch_one(pool)
        .await
        .unwrap();
        sqlx::query_scalar::<_, i64>(
            "INSERT INTO einsatz (org_id, bezeichnung, status, abgeschlossen_at, abgeschlossen_von, retention_bis) \
             VALUES (1,'Lage','abgeschlossen','2026-01-01 00:00:00', ?, ?) RETURNING id",
        )
        .bind(b)
        .bind(retention_bis)
        .fetch_one(pool)
        .await
        .unwrap()
    }

    #[tokio::test]
    async fn phase_a_soft_loescht_nur_abgelaufene_und_ist_idempotent() {
        let pool = crate::db::test_pool().await;
        let id = abgeschlossen_mit_frist(&pool, "2026-06-01 00:00:00").await;

        // Vor Fälligkeit: nichts.
        assert_eq!(tick_einmal(&pool, t("2026-05-01 12:00:00")).await, 0);
        let g: Option<String> = sqlx::query_scalar("SELECT geloescht_at FROM einsatz WHERE id = ?")
            .bind(id)
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(g, None, "vor Ablauf nicht soft-gelöscht");

        // Nach Fälligkeit: genau ein Soft-Delete, Tombstone gesetzt.
        assert_eq!(tick_einmal(&pool, t("2026-06-02 12:00:00")).await, 1);
        let g: Option<String> = sqlx::query_scalar("SELECT geloescht_at FROM einsatz WHERE id = ?")
            .bind(id)
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(g.as_deref(), Some("2026-06-02 12:00:00"));

        // Zweiter Tick: idempotent, kein erneutes Soft-Delete (noch in Karenz, nicht purge-fällig).
        assert_eq!(tick_einmal(&pool, t("2026-06-02 12:05:00")).await, 0);
    }

    #[tokio::test]
    async fn aktiver_einsatz_wird_nie_soft_geloescht() {
        // Sicherheits-Test: ein AKTIVER Einsatz mit (defensiv) abgelaufener Frist darf
        // weder soft-gelöscht noch geschwärzt werden — status='abgeschlossen' ist hart.
        let pool = crate::db::test_pool().await;
        sqlx::query("INSERT OR IGNORE INTO organisation (id, name) VALUES (1, 'Orga')")
            .execute(&pool)
            .await
            .unwrap();
        let id: i64 = sqlx::query_scalar(
            "INSERT INTO einsatz (org_id, bezeichnung, status, retention_bis) \
             VALUES (1,'Aktiv','aktiv','2026-01-01 00:00:00') RETURNING id",
        )
        .fetch_one(&pool)
        .await
        .unwrap();

        assert_eq!(tick_einmal(&pool, t("2027-01-01 12:00:00")).await, 0);
        let (g, s): (Option<String>, Option<String>) =
            sqlx::query_as("SELECT geloescht_at, geschwaerzt_at FROM einsatz WHERE id = ?")
                .bind(id)
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(g, None, "aktiver Einsatz nie soft-gelöscht");
        assert_eq!(s, None, "aktiver Einsatz nie geschwärzt");
    }

    #[tokio::test]
    async fn soft_geloescht_vor_karenz_wird_nicht_geschwaerzt() {
        // Phase B greift erst nach KARENZ_TAGE. Direkt nach dem Soft-Delete (gleicher
        // Tick-Tag) darf nicht geschwärzt werden.
        let pool = crate::db::test_pool().await;
        let id = abgeschlossen_mit_frist(&pool, "2026-06-01 00:00:00").await;
        // Soft-Delete.
        assert_eq!(tick_einmal(&pool, t("2026-06-02 12:00:00")).await, 1);
        // Wenige Tage später (< KARENZ_TAGE): noch keine Schwärzung.
        assert_eq!(tick_einmal(&pool, t("2026-06-10 12:00:00")).await, 0);
        let s: Option<String> = sqlx::query_scalar("SELECT geschwaerzt_at FROM einsatz WHERE id = ?")
            .bind(id)
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(s, None, "vor Ablauf der Karenz nicht geschwärzt");
    }
}
