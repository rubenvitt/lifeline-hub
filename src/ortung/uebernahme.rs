//! Übernahme der Ablage `position_letzte` in das gekoppelte Einsatzfahrzeug (LLH-2091, Entwurf
//! „Übernahme“). Ein eigener Schritt nach dem Einwurf: die Antwort des Einwurfs hängt weder von
//! der Kopplung noch vom Ergebnis ab (ADR-0023).
//!
//! - **Vorrang** über `position_gesetzt_at` (Serverzeit): nur ein Fix, der später *empfangen*
//!   wurde als die letzte Setzung, wird übernommen. Eine falsch gehende Geräteuhr ändert daran
//!   nichts; Quelle und Zeiten NULL (gelöschte Position) zählen als älter.
//! - **Drossel** je Fahrzeug: weniger als [`ORTUNG_DROSSEL_S`] nach dem letzten Schreiben aus der
//!   Ortung wird nicht geschrieben, sondern genau ein Nachlauf vorgemerkt, der die jüngste
//!   Position nach Ablauf übernimmt. Der Nachlauf lebt nur im Speicher; ein Neustart verliert
//!   höchstens einen, der nächste Fix holt ihn nach.

use crate::app::AppState;
use crate::error::AppError;
use crate::live::LiveEvent;
use crate::log_drossel::SammelzeileJe;
use crate::write_retry;
use crate::zeit;
use sqlx::SqliteConnection;
use std::collections::HashSet;
use std::sync::Mutex;
use std::time::Duration;

/// Mindestabstand zwischen zwei Schreibvorgängen der Ortung je Fahrzeug, in Sekunden.
pub const ORTUNG_DROSSEL_S: i64 = 15;

/// Ergebnis eines Übernahmeversuchs.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Uebernahme {
    /// Die Position steht jetzt am Einsatzfahrzeug; der Aufrufer meldet es nach dem Commit live.
    Geschrieben { einsatz_id: i64, ef_id: i64 },
    /// Zu kurz nach dem letzten Schreiben; es wurde nichts geändert, ein Nachlauf ist fällig.
    Gedrosselt { ef_id: i64 },
    /// Keine Kopplung, kein aktives Fahrzeug im aktiven eigenen Einsatz, oder nichts Neueres.
    Nichts,
}

/// Fahrzeuge mit vorgemerktem Nachlauf (je Fahrzeug höchstens einer).
static NACHLAUF: Mutex<Option<HashSet<i64>>> = Mutex::new(None);

fn nachlauf_menge<T>(f: impl FnOnce(&mut HashSet<i64>) -> T) -> T {
    let mut g = NACHLAUF.lock().unwrap_or_else(|e| e.into_inner());
    f(g.get_or_insert_with(HashSet::new))
}

/// Testhaken: ist für das Einsatzfahrzeug ein Nachlauf vorgemerkt?
pub fn is_nachlauf_vorgemerkt(ef_id: i64) -> bool {
    nachlauf_menge(|m| m.contains(&ef_id))
}

/// Übernimmt die Ablage der Kennung in das gekoppelte Fahrzeug. `jetzt` ist die Serverzeit
/// (`zeit::FORMAT`); Tests geben sie vor. Gehört in eine Schreibtransaktion des Aufrufers.
pub async fn apply_position_tx(
    conn: &mut SqliteConnection,
    zugang_id: &str,
    kennung: &str,
    jetzt: &str,
) -> Result<Uebernahme, AppError> {
    type Zeile = (
        i64,
        i64,
        f64,
        f64,
        String,
        String,
        Option<String>,
        Option<String>,
    );
    let zeile: Option<Zeile> = sqlx::query_as(
        "SELECT k.einsatz_fahrzeug_id, k.einsatz_id, p.lat, p.lon, p.gemessen_at, p.empfangen_at, \
                ef.position_quelle, ef.position_gesetzt_at \
         FROM ortung_kopplung k \
         JOIN einsatz_fahrzeug ef ON ef.id = k.einsatz_fahrzeug_id AND ef.beendet_at IS NULL \
         JOIN einsatz e ON e.id = ef.einsatz_id AND e.status = 'aktiv' AND e.spiegel = 0 \
         JOIN position_letzte p ON p.zugang_id = k.zugang_id AND p.kennung = k.kennung \
         WHERE k.zugang_id = ? AND k.kennung = ? \
           AND p.empfangen_at > COALESCE(ef.position_gesetzt_at, '')",
    )
    .bind(zugang_id)
    .bind(kennung)
    .fetch_optional(&mut *conn)
    .await?;
    let Some((ef_id, einsatz_id, lat, lon, gemessen_at, empfangen_at, quelle, gesetzt_at)) = zeile
    else {
        return Ok(Uebernahme::Nichts);
    };

    if quelle.as_deref() == Some("ortung") {
        let zuletzt = gesetzt_at.as_deref().and_then(zeit::parse);
        let jetzt_t = zeit::parse(jetzt);
        if let (Some(zuletzt), Some(jetzt_t)) = (zuletzt, jetzt_t) {
            if (jetzt_t - zuletzt).num_seconds() < ORTUNG_DROSSEL_S {
                return Ok(Uebernahme::Gedrosselt { ef_id });
            }
        }
    }

    sqlx::query(
        "UPDATE einsatz_fahrzeug SET lat = ?, lon = ?, position_quelle = 'ortung', \
         position_gemessen_at = ?, position_gesetzt_at = ? WHERE id = ?",
    )
    .bind(lat)
    .bind(lon)
    .bind(gemessen_at)
    .bind(empfangen_at)
    .bind(ef_id)
    .execute(&mut *conn)
    .await?;
    Ok(Uebernahme::Geschrieben { einsatz_id, ef_id })
}

/// Übernahme nach dem Einwurf: eigene Transaktion, danach live melden bzw. den Nachlauf
/// vormerken. Fehler wirken nicht auf den Einwurf; sie werden ohne Kennung als Sammelzeile
/// gezählt.
pub async fn apply_position(state: &AppState, zugang_id: &str, kennung: &str) {
    let jetzt = zeit::jetzt();
    let ergebnis = write_retry!(&state.pool, |conn| {
        apply_position_tx(conn, zugang_id, kennung, &jetzt).await
    });
    match ergebnis {
        Ok(Uebernahme::Geschrieben { einsatz_id, ef_id }) => {
            state
                .live
                .publiziere_objekt(einsatz_id, LiveEvent::Fahrzeug, "fahrzeug_id", ef_id);
        }
        Ok(Uebernahme::Gedrosselt { ef_id }) => schedule_nachlauf(state, zugang_id, kennung, ef_id),
        Ok(Uebernahme::Nichts) => {}
        Err(_) => {
            static FEHLER: SammelzeileJe = SammelzeileJe::neu();
            if let Some(f) = FEHLER.zaehlen(zugang_id) {
                tracing::warn!(
                    zugang = %zugang_id,
                    anzahl = f.anzahl,
                    seit_s = f.seit_s,
                    "Übernahme einer Position in die Ortung fehlgeschlagen, Sammelzeile"
                );
            }
        }
    }
}

/// Merkt für das Fahrzeug einen Nachlauf vor, falls noch keiner läuft.
fn schedule_nachlauf(state: &AppState, zugang_id: &str, kennung: &str, ef_id: i64) {
    if !nachlauf_menge(|m| m.insert(ef_id)) {
        return;
    }
    let state = state.clone();
    let zugang_id = zugang_id.to_string();
    let kennung = kennung.to_string();
    tokio::spawn(async move {
        run_nachlauf(state, zugang_id, kennung, ef_id).await;
    });
}

/// Wartet die Drossel ab und übernimmt dann die jüngste Position. Der Eintrag fällt vor dem
/// Lauf weg, damit ein erneut gedrosselter Lauf wieder einen Nachlauf vormerken kann.
async fn run_nachlauf(state: AppState, zugang_id: String, kennung: String, ef_id: i64) {
    tokio::time::sleep(Duration::from_secs(ORTUNG_DROSSEL_S as u64)).await;
    nachlauf_menge(|m| m.remove(&ef_id));
    apply_position(&state, &zugang_id, &kennung).await;
}
