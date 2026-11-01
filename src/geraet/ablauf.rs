//! Ablauf einer Kopplung an einer Verpflegungsstelle (LLH-1316).
//!
//! Eine Kopplung endet still, sobald `laeuft_ab_at` verstrichen ist; kein Schreibweg läuft dabei.
//! Die Stellenliste der Verpflegung zeigt an jeder Stelle `geraet_gekoppelt` und sperrt danach
//! „Stornieren“. Damit sie nicht bis zum nächsten Abruf einen veralteten Stand zeigt, meldet der
//! Takt des Erinnerungs-Planers ([`crate::erinnerung::scheduler`]) je Einsatz ein `verpflegung`,
//! sobald dort eine solche Kopplung im Fenster `(seit, bis]` abgelaufen ist.
//!
//! Das Fenster ([`AblaufFenster`]) führt der Planer im Speicher. Ein Ablauf während eines Neustarts bleibt ungemeldet:
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
/// der Einsätze; ein Fehler der Abfrage geht an den Aufrufer, damit er das Fenster behält.
pub async fn melde_abgelaufene(
    pool: &SqlitePool,
    live: &LiveHub,
    seit: DateTime<Utc>,
    bis: DateTime<Utc>,
) -> Result<usize, sqlx::Error> {
    let einsaetze = einsaetze_mit_ablauf(pool, seit, bis).await?;
    for einsatz_id in &einsaetze {
        live.publiziere_einsatz(*einsatz_id, LiveEvent::Verpflegung);
    }
    Ok(einsaetze.len())
}

/// Führt das Fenster von Takt zu Takt. Es rückt nur nach einer gelungenen Prüfung vor: scheitert
/// die Abfrage, prüft der nächste Takt dasselbe Fenster mit, statt den Ablauf zu verlieren.
#[derive(Debug, Clone, Copy)]
pub struct AblaufFenster {
    letzter: DateTime<Utc>,
}

impl AblaufFenster {
    /// Beginnt bei `start`: Abläufe davor gelten als bekannt.
    pub fn ab(start: DateTime<Utc>) -> Self {
        Self { letzter: start }
    }

    /// Ein Takt bis `jetzt`. Liefert die Zahl der gemeldeten Einsätze.
    pub async fn takt(
        &mut self,
        pool: &SqlitePool,
        live: &LiveHub,
        jetzt: DateTime<Utc>,
    ) -> Result<usize, sqlx::Error> {
        let n = melde_abgelaufene(pool, live, self.letzter, jetzt).await?;
        self.letzter = jetzt;
        Ok(n)
    }
}
