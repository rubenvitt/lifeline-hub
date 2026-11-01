//! Ablauf einer Kopplung an einer Verpflegungsstelle (LLH-1316).
//!
//! Eine Kopplung endet still, sobald `laeuft_ab_at` verstrichen ist; kein Schreibweg läuft dabei.
//! Die Stellenliste der Verpflegung zeigt an jeder Stelle `geraet_gekoppelt` und sperrt danach
//! „Stornieren“. Damit sie nicht bis zum nächsten Abruf einen veralteten Stand zeigt, meldet der
//! Takt des Erinnerungs-Planers ([`crate::erinnerung::scheduler`]) je Einsatz ein `verpflegung`,
//! sobald dort eine solche Kopplung im Fenster `(seit, bis]` abgelaufen ist.
//!
//! Das Fenster führt der Planer im Speicher. Ein Ablauf während eines Neustarts bleibt ungemeldet:
//! nach dem Neustart holen die Clients ohnehin alles neu (neuer Live-Kanal, Lücke).

use crate::live::{LiveEvent, LiveHub};
use chrono::{DateTime, Utc};
use sqlx::SqlitePool;

/// Einsätze mit einer nicht widerrufenen Kopplung an einer Verpflegungsstelle, deren Ende in
/// `(seit, bis]` liegt.
pub async fn einsaetze_mit_ablauf(
    pool: &SqlitePool,
    seit: DateTime<Utc>,
    bis: DateTime<Utc>,
) -> Result<Vec<i64>, sqlx::Error> {
    sqlx::query_scalar(
        "SELECT DISTINCT einsatz_id FROM geraet_kopplung \
         WHERE verpflegungsstelle_id IS NOT NULL AND widerrufen_at IS NULL \
           AND laeuft_ab_at > ? AND laeuft_ab_at <= ? \
         ORDER BY einsatz_id",
    )
    .bind(crate::zeit::formatiere_utc(seit))
    .bind(crate::zeit::formatiere_utc(bis))
    .fetch_all(pool)
    .await
}

/// Meldet je betroffenem Einsatz ein `verpflegung` (Nutzlast `{einsatz_id}`). Liefert die Zahl
/// der Einsätze. Ein Fehler der Abfrage wird geloggt; der nächste Takt sieht nur sein Fenster.
pub async fn melde_abgelaufene(
    pool: &SqlitePool,
    live: &LiveHub,
    seit: DateTime<Utc>,
    bis: DateTime<Utc>,
) -> usize {
    match einsaetze_mit_ablauf(pool, seit, bis).await {
        Ok(einsaetze) => {
            for einsatz_id in &einsaetze {
                live.publiziere_einsatz(*einsatz_id, LiveEvent::Verpflegung);
            }
            einsaetze.len()
        }
        Err(e) => {
            tracing::warn!("Abgelaufene Gerätekopplungen nicht gemeldet: {e}");
            0
        }
    }
}
