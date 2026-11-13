//! Bestand der Stammdaten (LLH-1871, Change `n2ge2224-reste-nach-restore-abraeumen`, Spec
//! `stammdaten-verteilung`): Was die erreichte Seite einer Org noch führt, und eine Prüfsumme
//! darüber. Die meldende Seite meldet die Prüfsumme ihrer übernommenen Zeilen (D3). Weicht sie ab,
//! schickt die erreichte Seite die Liste ihres Bestands (D5), und die meldende Seite räumt ab, was
//! darin fehlt (D7). So verschwindet am ELW auch, was ein zurückgespielter Hub verloren hat und
//! nie mehr als Löschung liefert.
//!
//! **Der Bestand muss zu [`super::liefern`] passen** (D4): Ein Schlüssel steht genau dann darin,
//! wenn die Lieferung für ihn keine Löschung baut. Eine neue Sonderregel in `build_lieferung` oder
//! `load_daten` gehört auch in [`load`]; der Test `bestand_ist_was_als_zeile_geliefert_wird` hält
//! beides zusammen.

use super::art::{self, Schluessel};
use super::StammdatenArt;
use crate::error::AppError;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use sqlx::SqliteConnection;
use std::collections::{HashMap, HashSet};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

/// Länge der Prüfsumme in Zeichen (hex, die ersten 128 Bit von SHA-256): genug, um eine
/// Abweichung zu erkennen, und klein genug für die Meldung (`extractor::BODY_MAX`).
pub const CHECKSUM_LEN: usize = 32;
/// Höchstzahl Schlüssel des Bestands je Antwort (`src/AGENTS.md`, Listen von außen).
pub const BESTAND_STAMMDATEN_MAX: usize = 100_000;
/// Bleibt dieselbe Abweichung bestehen, geht die Liste höchstens so oft (D6).
pub const SEND_THROTTLE: Duration = Duration::from_secs(10 * 60);

/// Der Bestand einer Art: alle Schlüssel, die die erreichte Seite in dieser Org führt. Steht eine
/// Art in der Liste, räumt die meldende Seite sie ab, auch mit leerer Liste.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct StammdatenBestand {
    /// Wire-Wert von [`StammdatenArt`].
    pub art: String,
    pub schluessel: Vec<String>,
}

/// Prüfsumme über Paare `(art, schluessel)`, unabhängig von ihrer Reihenfolge (D3).
pub fn checksum(paare: &[(String, String)]) -> String {
    let mut sortiert: Vec<&(String, String)> = paare.iter().collect();
    sortiert.sort();
    let mut h = Sha256::new();
    for (art, schluessel) in sortiert {
        h.update(art.as_bytes());
        h.update([0x1f]);
        h.update(schluessel.as_bytes());
        h.update([b'\n']);
    }
    let summe = h.finalize();
    summe[..CHECKSUM_LEN / 2]
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}

/// Die Paare eines Bestands.
pub fn pairs(bestand: &[StammdatenBestand]) -> Vec<(String, String)> {
    bestand
        .iter()
        .flat_map(|b| b.schluessel.iter().map(|s| (b.art.clone(), s.clone())))
        .collect()
}

/// Meldende Seite: die übernommenen Zeilen einer Org-Zuordnung als `(art, fremder_schluessel)`.
pub async fn load_herkunft(
    conn: &mut SqliteConnection,
    kopplung_org_id: i64,
) -> Result<Vec<(String, String)>, AppError> {
    Ok(sqlx::query_as(
        "SELECT art, fremder_schluessel FROM stammdaten_herkunft WHERE kopplung_org_id = ?",
    )
    .bind(kopplung_org_id)
    .fetch_all(&mut *conn)
    .await?)
}

/// Erreichte Seite: der Bestand der Org in den Arten `arten`, je Art in der Reihenfolge von
/// [`art::BESCHREIBUNGEN`] (D4). Wie beim Liefern zählt nur der Bereich einer Art; Stellvertreter-,
/// Archiv- und Gerätekonten fehlen, denn sie gehen als Löschung hinaus. Was nie im Änderungslog
/// stand, ging nie hinaus und fehlt ebenfalls.
pub async fn load(
    conn: &mut SqliteConnection,
    org_id: i64,
    arten: &HashSet<StammdatenArt>,
) -> Result<Vec<StammdatenBestand>, AppError> {
    let mut aus = Vec::new();
    for b in art::BESCHREIBUNGEN
        .iter()
        .filter(|b| arten.contains(&b.art))
    {
        let t = b.tabelle;
        let schluessel = match b.schluessel {
            Schluessel::Id => format!("CAST({t}.id AS TEXT)"),
            Schluessel::Spalte(s) => format!("{t}.{s}"),
            Schluessel::Org => "''".to_string(),
        };
        let bereich = b
            .bereich
            .map(|bed| format!(" AND ({bed})"))
            .unwrap_or_default();
        let konto = if b.art == StammdatenArt::Konto {
            format!(
                " AND NOT EXISTS (SELECT 1 FROM spiegel_konto s WHERE s.benutzer_id = {t}.id) \
                 AND NOT EXISTS (SELECT 1 FROM archiv_konto a WHERE a.benutzer_id = {t}.id) \
                 AND NOT EXISTS (SELECT 1 FROM geraet_kopplung g WHERE g.benutzer_id = {t}.id)"
            )
        } else {
            String::new()
        };
        let sql = format!(
            "SELECT {schluessel} FROM {t} WHERE {t}.org_id = ?1{bereich}{konto} \
             AND EXISTS (SELECT 1 FROM stammdaten_aenderung l WHERE l.org_id = ?1 \
                         AND l.art = ?2 AND l.schluessel = {schluessel}) \
             ORDER BY 1"
        );
        let schluessel: Vec<String> = sqlx::query_scalar(sqlx::AssertSqlSafe(sql))
            .bind(org_id)
            .bind(b.art.as_str())
            .fetch_all(&mut *conn)
            .await?;
        aus.push(StammdatenBestand {
            art: b.art.as_str().to_string(),
            schluessel,
        });
    }
    Ok(aus)
}

type Throttle = HashMap<(String, i64), (String, Instant)>;

fn throttle() -> &'static Mutex<Throttle> {
    static THROTTLE: OnceLock<Mutex<Throttle>> = OnceLock::new();
    THROTTLE.get_or_init(|| Mutex::new(HashMap::new()))
}

/// Ob die Liste an diese Kopplungs-Org gehen darf (D6): beim ersten Mal, bei einer anderen
/// Prüfsumme der meldenden Seite oder [`SEND_THROTTLE`] nach der letzten Liste. `kennung` ist die
/// eigene Instanzkennung: Mehrere Instanzen in einem Prozess (Tests) teilen sich die Bremse.
pub fn can_send(kennung: &str, kopplung_org_id: i64, checksum: &str, jetzt: Instant) -> bool {
    let entries = throttle().lock().unwrap_or_else(|e| e.into_inner());
    match entries.get(&(kennung.to_string(), kopplung_org_id)) {
        Some((sum, last)) => {
            sum != checksum || jetzt.saturating_duration_since(*last) >= SEND_THROTTLE
        }
        None => true,
    }
}

/// Hält fest, dass die Liste gegangen ist. Erst nach dem Commit der Antwort aufrufen: Eine
/// wiederholte Transaktion unterdrückte die Liste sonst (D6).
pub fn mark_sent(kennung: &str, kopplung_org_id: i64, checksum: &str, jetzt: Instant) {
    throttle().lock().unwrap_or_else(|e| e.into_inner()).insert(
        (kennung.to_string(), kopplung_org_id),
        (checksum.to_string(), jetzt),
    );
}

/// Prüfsumme und Zeitpunkt der letzten Liste an diese Kopplungs-Org, falls eine ging. Nur lesend,
/// für die Integrationstests.
pub fn last_sent(kennung: &str, kopplung_org_id: i64) -> Option<(String, Instant)> {
    throttle()
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .get(&(kennung.to_string(), kopplung_org_id))
        .cloned()
}

#[cfg(test)]
mod tests;
