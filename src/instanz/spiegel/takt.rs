//! Takt des Abgleichs an der meldenden Seite (design.md D12): je Kopplung ein eigener Zeitpunkt.
//! Kurz, solange ein Einsatz der Kopplung aktiv ist oder etwas aussteht, sonst im Takt der
//! Meldung; Fehler verdoppeln den Abstand bis zehn Minuten. Ein neuer Antrag oder eine
//! Anforderung weckt den Lauf sofort ([`wecken`]).

use super::abgleich;
use crate::error::AppError;
use crate::instanz::{melden, repo};
use sqlx::SqlitePool;
use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

static ABSTAND_S: OnceLock<u64> = OnceLock::new();
static WECKER: tokio::sync::Notify = tokio::sync::Notify::const_new();
static PLAN: Mutex<Option<HashMap<i64, Plan>>> = Mutex::new(None);

#[derive(Debug, Clone, Copy)]
struct Plan {
    naechster: Instant,
    fehlversuche: u32,
}

/// Setzt den kurzen Abstand einmal beim Start (`--instanz-spiegel-sekunden`).
pub fn set_abstand(sekunden: u64) {
    let _ = ABSTAND_S.set(sekunden);
}

fn abstand_s() -> u64 {
    ABSTAND_S.get().copied().unwrap_or(5)
}

/// Weckt den Lauf: alle Kopplungen gleichen beim nächsten Durchlauf ab.
pub fn wecken() {
    if let Ok(mut p) = PLAN.lock() {
        if let Some(p) = p.as_mut() {
            for plan in p.values_mut() {
                plan.naechster = Instant::now();
            }
        }
    }
    WECKER.notify_one();
}

/// Ob an einer Kopplung etwas läuft: ein aktiver geführter oder gespiegelter Einsatz einer
/// zugeordneten Org (D12).
pub async fn ist_aktiv(pool: &SqlitePool, kopplung_id: i64) -> Result<bool, AppError> {
    Ok(sqlx::query_scalar(
        "SELECT EXISTS (SELECT 1 FROM einsatz e JOIN instanz_kopplung_org o ON o.org_id = e.org_id \
            WHERE o.kopplung_id = ?1 AND o.widerrufen_at IS NULL AND e.status = 'aktiv' \
            AND e.spiegel = 0) \
         OR EXISTS (SELECT 1 FROM einsatz_spiegel s JOIN einsatz e ON e.id = s.einsatz_id \
            JOIN instanz_kopplung_org o ON o.id = s.kopplung_org_id \
            WHERE o.kopplung_id = ?1 AND s.beendet_at IS NULL AND e.status = 'aktiv')",
    )
    .bind(kopplung_id)
    .fetch_one(pool)
    .await?)
}

/// Ein Durchlauf: gleicht mit jeder fälligen Kopplung ab, deren Gegenüber den Abgleich kennt.
/// `immer` übergeht den Plan (Tests).
pub async fn durchlauf(pool: &SqlitePool, immer: bool) -> Result<(), AppError> {
    let jetzt = Instant::now();
    for k in repo::list_meldend_aktiv(pool).await? {
        if !abgleich::kann_spiegeln(&k) {
            continue;
        }
        let plan = PLAN
            .lock()
            .ok()
            .and_then(|p| p.as_ref().and_then(|p| p.get(&k.id).copied()));
        if !immer && plan.is_some_and(|p| p.naechster > jetzt) {
            continue;
        }
        let ergebnis = abgleich::abgleich_einmal(pool, &k).await;
        let grund = if ist_aktiv(pool, k.id).await? {
            abstand_s()
        } else {
            melden::abstand_s()
        };
        let fehlversuche = match &ergebnis {
            Ok(()) => 0,
            Err(f) => {
                tracing::warn!(kopplung = k.id, fehler = %f, "Abgleich der Einsätze gescheitert");
                plan.map_or(1, |p| p.fehlversuche + 1)
            }
        };
        let abstand = melden::next_abstand(grund, fehlversuche);
        if let Ok(mut p) = PLAN.lock() {
            p.get_or_insert_with(HashMap::new).insert(
                k.id,
                Plan {
                    naechster: Instant::now() + Duration::from_secs(abstand),
                    fehlversuche,
                },
            );
        }
    }
    Ok(())
}

/// Startet den Hintergrund-Task: jede Sekunde ein Durchlauf, sofort nach [`wecken`]. Ohne
/// Kopplung baut er nie eine Verbindung auf.
pub fn start(pool: SqlitePool) {
    tokio::spawn(async move {
        let mut takt = tokio::time::interval(Duration::from_secs(1));
        takt.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        loop {
            tokio::select! {
                _ = takt.tick() => {}
                _ = WECKER.notified() => {}
            }
            if let Err(e) = durchlauf(&pool, false).await {
                tracing::warn!(error = %e, "Spiegel: Durchlauf gescheitert");
            }
        }
    });
}
