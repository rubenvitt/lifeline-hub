//! Zustellung von Aufträgen an die Helfer-App (Stufe 2, Spec
//! `docs/superpowers/specs/2026-11-25-c19brpvf-helfer-pager-design.md`, ADR-0111).
//!
//! - [`resolve`] bestimmt die Pager-Empfänger eines Auftrags frisch: bestätigte, nicht beendete
//!   Helfer-Kopplungen des aktiven Einsatzes mit einer eigenen Empfängerzeile
//!   ([`crate::helfer::auftraege::PAGER_EMPFAENGER`], [`crate::helfer::auftraege::EIGENE_ZEILE`]).
//! - [`deliver`] (nach dem Erteilen und nach einer Berichtigung) zählt die noch nicht
//!   ausgelieferten Zeilen (`helfer_gesendet IS NULL`), meldet allen Zielen live und schickt den
//!   Zielen, für die der Auftrag neu ist, einen iOS-Push über das Relais.
//! - [`notify_changed`] (Quittung, Aufhebung) meldet nur live.
//!
//! Die Zustellung lässt das Erteilen nie scheitern: Fehler werden ohne Token und Nutzlast geloggt.

use crate::app::AppState;
use crate::error::AppError;
use crate::helfer::auftraege::{EIGENE_ZEILE, PAGER_EMPFAENGER};
use serde::Serialize;
use sqlx::SqlitePool;
use std::collections::BTreeMap;

/// Bundle-ID der Helfer-App; geht als `thema` an das Relais (`apns-topic`).
pub const HELFER_BUNDLE_ID: &str = "dev.rubeen.lifeline.helfer";

/// Größte Länge des Auftragstexts in der Nutzlast (Zeichen); der Umschlag muss in
/// [`crate::ios_push::UMSCHLAG_MAX`] passen.
pub const TEXT_MAX_ZEICHEN: usize = 600;

/// Eine Helfer-Kopplung, an die ein Auftrag geht.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PagerZiel {
    pub kopplung_id: i64,
    /// Die eigenen Empfängerzeilen des Auftrags.
    pub empfaenger_ids: Vec<i64>,
    /// Alle eigenen Zeilen sind noch nicht ausgeliefert: der Auftrag ist für diese Kopplung neu.
    pub is_new: bool,
    /// Anzeige der ersten eigenen Zeile (Titel der Mitteilung).
    pub titel: String,
}

#[derive(sqlx::FromRow)]
struct Treffer {
    kopplung_id: i64,
    empfaenger_id: i64,
    neu: bool,
    empfaenger_typ: String,
    snap_anzeige: String,
}

/// Die Pager-Empfänger des Auftrags, frisch aus der Datenbank; leer nach Einsatzende, Widerruf
/// oder Ablauf.
pub async fn resolve(
    pool: &SqlitePool,
    einsatz_id: i64,
    auftrag_id: i64,
) -> Result<Vec<PagerZiel>, AppError> {
    let treffer: Vec<Treffer> = sqlx::query_as(sqlx::AssertSqlSafe(format!(
        "SELECT gk.id AS kopplung_id, ae.id AS empfaenger_id, \
                ae.helfer_gesendet IS NULL AS neu, ae.empfaenger_typ, ae.snap_anzeige \
         FROM auftrag a \
         JOIN einsatz e ON e.id = a.einsatz_id \
         JOIN geraet_kopplung gk ON gk.einsatz_id = a.einsatz_id \
         JOIN auftrag_empfaenger ae ON ae.auftrag_id = a.id \
         WHERE a.id = ? AND a.einsatz_id = ? AND a.aufgehoben_at IS NULL \
           AND {PAGER_EMPFAENGER} AND {EIGENE_ZEILE} \
         ORDER BY gk.id, ae.id"
    )))
    .bind(auftrag_id)
    .bind(einsatz_id)
    .fetch_all(pool)
    .await?;
    let mut ziele: BTreeMap<i64, PagerZiel> = BTreeMap::new();
    for t in treffer {
        let titel = if t.empfaenger_typ == "person" {
            "An dich".to_string()
        } else {
            t.snap_anzeige
        };
        let z = ziele.entry(t.kopplung_id).or_insert_with(|| PagerZiel {
            kopplung_id: t.kopplung_id,
            empfaenger_ids: Vec::new(),
            is_new: true,
            titel,
        });
        z.empfaenger_ids.push(t.empfaenger_id);
        z.is_new &= t.neu;
    }
    Ok(ziele.into_values().collect())
}

/// Der Klartext eines Auftrags für den Mitteilungsdienst der Helfer-App. Kurze Feldnamen wie
/// [`crate::ios_push::inhalt::Klartext`]; Testvektor in `src-tauri/faelle/helfer-auftrag.json`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct PagerKlartext {
    pub v: u8,
    /// Anzeigename dieser Instanz.
    pub s: String,
    pub art: &'static str,
    /// Einsatz.
    pub e: i64,
    /// Auftrag.
    pub t: i64,
    pub titel: String,
    pub text: String,
}

/// Kürzt `text` auf höchstens `max` Zeichen, mit `…` am Ende.
pub fn kuerzen(text: &str, max: usize) -> String {
    if text.chars().count() <= max {
        return text.to_string();
    }
    let mut k: String = text.chars().take(max.saturating_sub(1)).collect();
    k.push('…');
    k
}

async fn zaehle_neue_zeilen(
    pool: &SqlitePool,
    auftrag_id: i64,
    ziele: &[PagerZiel],
) -> Result<(), AppError> {
    let mut je_zeile: BTreeMap<i64, i64> = BTreeMap::new();
    for z in ziele {
        for e in &z.empfaenger_ids {
            *je_zeile.entry(*e).or_default() += 1;
        }
    }
    let zaehlung =
        serde_json::to_string(&je_zeile).map_err(|e| AppError::Internal(e.to_string()))?;
    // Nur Zeilen der Typen, die ein Helfer empfangen kann; ohne Treffer 0.
    sqlx::query(
        "UPDATE auftrag_empfaenger \
         SET helfer_gesendet = COALESCE((SELECT value FROM json_each(?1) \
                                          WHERE key = CAST(auftrag_empfaenger.id AS TEXT)), 0) \
         WHERE auftrag_id = ?2 AND helfer_gesendet IS NULL \
           AND empfaenger_typ IN ('einheit', 'fahrzeug', 'person')",
    )
    .bind(zaehlung)
    .bind(auftrag_id)
    .execute(pool)
    .await?;
    Ok(())
}

async fn deliver_inner(state: &AppState, einsatz_id: i64, auftrag_id: i64) -> Result<(), AppError> {
    let ziele = resolve(&state.pool, einsatz_id, auftrag_id).await?;
    zaehle_neue_zeilen(&state.pool, auftrag_id, &ziele).await?;
    state
        .live
        .melde_helfer_auftrag(ziele.iter().map(|z| z.kopplung_id).collect(), auftrag_id);
    let neu: Vec<&PagerZiel> = ziele.iter().filter(|z| z.is_new).collect();
    let Some(ios) = state.live.ios_push() else {
        return Ok(());
    };
    if neu.is_empty() {
        return Ok(());
    }
    let text: String = sqlx::query_scalar("SELECT auftrag_text FROM auftrag WHERE id = ?")
        .bind(auftrag_id)
        .fetch_one(&state.pool)
        .await?;
    let ids: Vec<i64> = neu.iter().map(|z| z.kopplung_id).collect();
    let anmeldungen = crate::helfer::push::load_registrations(&state.pool, &ids).await?;
    let sendungen: Vec<_> = anmeldungen
        .into_iter()
        .filter_map(|a| {
            let z = neu.iter().find(|z| z.kopplung_id == a.kopplung_id)?;
            Some((
                a,
                PagerKlartext {
                    v: 1,
                    s: crate::instanz::name().to_owned(),
                    art: "auftrag",
                    e: einsatz_id,
                    t: auftrag_id,
                    titel: z.titel.clone(),
                    text: kuerzen(&text, TEXT_MAX_ZEICHEN),
                },
            ))
        })
        .collect();
    ios.versenden_helfer(auftrag_id, sendungen);
    Ok(())
}

/// Stellt einen erteilten oder berichtigten Auftrag zu: zählt neue Zeilen, meldet live, schickt
/// iOS-Push an die Ziele, für die er neu ist. Fehler loggt es nur.
pub async fn deliver(state: &AppState, einsatz_id: i64, auftrag_id: i64) {
    if let Err(e) = deliver_inner(state, einsatz_id, auftrag_id).await {
        tracing::warn!(einsatz_id, auftrag_id, fehler = %e, "Zustellung an Helfer-Apps fehlgeschlagen");
    }
}

/// Die Helfer-Kopplungen, denen der Auftrag gerade gehört (Pager-Empfänger mit eigener Zeile,
/// auch bei aufgehobenem Auftrag).
pub async fn kopplungen(
    pool: &SqlitePool,
    einsatz_id: i64,
    auftrag_id: i64,
) -> Result<Vec<i64>, AppError> {
    Ok(sqlx::query_scalar(sqlx::AssertSqlSafe(format!(
        "SELECT DISTINCT gk.id FROM auftrag a \
         JOIN einsatz e ON e.id = a.einsatz_id \
         JOIN geraet_kopplung gk ON gk.einsatz_id = a.einsatz_id \
         JOIN auftrag_empfaenger ae ON ae.auftrag_id = a.id \
         WHERE a.id = ? AND a.einsatz_id = ? AND {PAGER_EMPFAENGER} AND {EIGENE_ZEILE} \
         ORDER BY gk.id"
    )))
    .bind(auftrag_id)
    .bind(einsatz_id)
    .fetch_all(pool)
    .await?)
}

/// Meldet den Helfer-Apps eines Auftrags eine Änderung (Quittung, Aufhebung), nur live.
pub async fn notify_changed(state: &AppState, einsatz_id: i64, auftrag_id: i64) {
    match kopplungen(&state.pool, einsatz_id, auftrag_id).await {
        Ok(ids) => state.live.melde_helfer_auftrag(ids, auftrag_id),
        Err(e) => tracing::warn!(einsatz_id, auftrag_id, fehler = %e, "Helfer-Apps nicht gemeldet"),
    }
}

/// Meldet Kopplungen, die den Auftrag bis eben hatten (eine Berichtigung hat ihre Zeile entfernt),
/// damit offene Apps neu laden. `vorher` stammt aus [`kopplungen`] vor der Änderung.
pub fn notify_removed(state: &AppState, vorher: Vec<i64>, auftrag_id: i64) {
    state.live.melde_helfer_auftrag(vorher, auftrag_id);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn kuerzen_haengt_auslassung_an() {
        assert_eq!(kuerzen("Zelt 3", 10), "Zelt 3");
        assert_eq!(kuerzen("Verletzte Person", 6), "Verle…");
        assert_eq!(kuerzen("Ääääää", 3), "Ää…");
    }
}
