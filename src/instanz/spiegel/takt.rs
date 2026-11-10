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
            WHERE o.kopplung_id = ?1 AND s.beendet_at IS NULL AND e.status = 'aktiv') \
         OR EXISTS (SELECT 1 FROM spiegel_anhang a JOIN einsatz_spiegel s ON s.einsatz_id = a.einsatz_id \
            JOIN instanz_kopplung_org o ON o.id = s.kopplung_org_id \
            WHERE o.kopplung_id = ?1 AND a.fertig_at IS NULL AND a.angefordert_at IS NOT NULL) \
         OR EXISTS (SELECT 1 FROM spiegel_antrag a JOIN einsatz_spiegel s ON s.einsatz_id = a.einsatz_id \
            JOIN instanz_kopplung_org o ON o.id = s.kopplung_org_id \
            WHERE o.kopplung_id = ?1 AND a.zustand IN ('ausstehend', 'zugestellt')) \
         OR EXISTS (SELECT 1 FROM spiegel_antrag_eingang WHERE kopplung_id = ?1 AND gemeldet_at IS NULL)",
    )
    .bind(kopplung_id)
    .fetch_one(pool)
    .await?)
}

/// Abstand bis zum nächsten Abgleich (D12): kurz bei Aktivität, sonst der Takt der Meldung;
/// Fehler verdoppeln ihn bis zehn Minuten.
pub fn plan_abstand(aktiv: bool, fehlversuche: u32, kurz: u64, melden: u64) -> u64 {
    melden::next_abstand(if aktiv { kurz } else { melden }, fehlversuche)
}

/// Ein Durchlauf: gleicht mit jeder fälligen Kopplung ab, deren Gegenüber den Abgleich kennt.
/// `immer` übergeht den Plan (Tests).
pub async fn durchlauf(
    pool: &SqlitePool,
    router: Option<&axum::Router>,
    immer: bool,
) -> Result<(), AppError> {
    let jetzt = Instant::now();
    if let Err(e) = super::antrag::aufraeumen(pool).await {
        tracing::warn!(error = %e, "Spiegel: Anträge nicht aufgeräumt");
    }
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
        let ergebnis = abgleich::abgleich_einmal(pool, router, &k).await;
        let aktiv = ist_aktiv(pool, k.id).await?;
        let fehlversuche = match &ergebnis {
            Ok(()) => 0,
            Err(f) => {
                tracing::warn!(kopplung = k.id, fehler = %f, "Abgleich der Einsätze gescheitert");
                plan.map_or(1, |p| p.fehlversuche + 1)
            }
        };
        let abstand = plan_abstand(aktiv, fehlversuche, abstand_s(), melden::abstand_s());
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
pub fn start(pool: SqlitePool, router: axum::Router) {
    tokio::spawn(async move {
        let mut takt = tokio::time::interval(Duration::from_secs(1));
        takt.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        loop {
            tokio::select! {
                _ = takt.tick() => {}
                _ = WECKER.notified() => {}
            }
            if let Err(e) = durchlauf(&pool, Some(&router), false).await {
                tracing::warn!(error = %e, "Spiegel: Durchlauf gescheitert");
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn kurzer_takt_nur_bei_aktivitaet_und_fehler_verdoppeln() {
        assert_eq!(plan_abstand(true, 0, 5, 60), 5);
        assert_eq!(
            plan_abstand(false, 0, 5, 60),
            60,
            "ruhige Kopplung im Takt der Meldung"
        );
        assert_eq!(plan_abstand(true, 2, 5, 60), 20);
        assert_eq!(plan_abstand(false, 9, 5, 60), 600, "höchstens zehn Minuten");
    }

    #[tokio::test]
    async fn aktiv_ist_eine_kopplung_mit_aktivem_einsatz_einer_zugeordneten_org() {
        let pool = crate::db::test_pool().await;
        for sql in [
            "INSERT OR IGNORE INTO organisation (id, name) VALUES (1, 'Org')",
            "INSERT INTO instanz_kopplung (id, gegenueber_kennung, gegenueber_schluessel, \
             gegenueber_name, richtung, zustand, gegenueber_adresse) \
             VALUES (1, 'g', 'x', 'G', 'meldet_sich', 'aktiv', 'https://h')",
            "INSERT INTO instanz_kopplung_org (id, kopplung_id, org_id, fremde_org_kennung, \
             fremde_org_name) VALUES (1, 1, 1, 'h/1', 'Org')",
        ] {
            sqlx::query(sql).execute(&pool).await.unwrap();
        }
        assert!(!ist_aktiv(&pool, 1).await.unwrap());
        let id: i64 = sqlx::query_scalar(
            "INSERT INTO einsatz (org_id, bezeichnung) VALUES (1, 'Lage') RETURNING id",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert!(ist_aktiv(&pool, 1).await.unwrap());
        sqlx::query("UPDATE einsatz SET status = 'abgeschlossen' WHERE id = ?")
            .bind(id)
            .execute(&pool)
            .await
            .unwrap();
        assert!(!ist_aktiv(&pool, 1).await.unwrap());
    }

    #[tokio::test]
    async fn wecken_macht_jede_kopplung_faellig() {
        if let Ok(mut p) = PLAN.lock() {
            p.get_or_insert_with(HashMap::new).insert(
                4242,
                Plan {
                    naechster: Instant::now() + Duration::from_secs(600),
                    fehlversuche: 0,
                },
            );
        }
        wecken();
        let plan = PLAN.lock().unwrap().as_ref().unwrap()[&4242];
        assert!(plan.naechster <= Instant::now());
    }
}
