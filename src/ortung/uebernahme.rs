//! Übernahme der Ablage `position_letzte` in das gekoppelte Einsatzfahrzeug (LLH-2091, Entwurf
//! „Übernahme“, ADR-0103). Ein eigener Schritt nach dem Einwurf: die Antwort des Einwurfs hängt
//! weder von der Kopplung noch vom Ergebnis ab (ADR-0023).
//!
//! - **Geschrieben** wird über den Positionsbaustein [`crate::ortung::schreibe_position`] mit
//!   Quelle `einwurf` und der Messzeit des Geräts, geklemmt mit
//!   [`crate::ortung::klemme_zeitpunkt`]. Vorrang hat damit die Regel des Bausteins: der jüngere
//!   Zeitpunkt gewinnt, eine manuelle Position gilt im Moment des Setzens immer.
//! - **Nur mit Org-Schalter** „Ortung im Einsatz“ (ADR-0101): ist er aus, schreibt die Übernahme
//!   nichts; die Kopplung bleibt stehen.
//! - **Drossel** je Fahrzeug über `position_aktualisiert_at`: liegt die Messzeit eines Fixes
//!   weniger als [`ORTUNG_DROSSEL_S`] nach der gespeicherten Einwurf-Position, wird nicht
//!   geschrieben, sondern genau ein Nachlauf vorgemerkt, der die jüngste Position nach Ablauf
//!   übernimmt. Beide Zeiten stammen vom selben Gerät; ein Versatz der Geräteuhr hebt sich auf.
//!   Der Nachlauf lebt nur im Speicher; ein Neustart verliert höchstens einen, der nächste Fix
//!   holt ihn nach.

use crate::app::AppState;
use crate::error::AppError;
use crate::log_drossel::SammelzeileJe;
use crate::ortung::{
    klemme_zeitpunkt, publiziere, schreibe_position, Ortungsziel, Positionsquelle,
};
use crate::write_retry;
use crate::zeit;
use sqlx::{SqliteConnection, SqlitePool};
use std::collections::HashSet;
use std::sync::Mutex;
use std::time::Duration;

/// Mindestabstand der Messzeiten zweier Schreibvorgänge der Ortung je Fahrzeug, in Sekunden.
pub const ORTUNG_DROSSEL_S: i64 = 15;

/// Ergebnis eines Übernahmeversuchs.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Uebernahme {
    /// Die Position steht jetzt am Einsatzfahrzeug; der Aufrufer meldet es nach dem Commit live.
    Geschrieben { einsatz_id: i64, ef_id: i64 },
    /// Zu kurz nach dem letzten Schreiben; es wurde nichts geändert, ein Nachlauf ist fällig.
    Gedrosselt { ef_id: i64 },
    /// Keine Kopplung, Org-Schalter aus, kein aktives Fahrzeug im aktiven eigenen Einsatz, oder
    /// nichts Neueres.
    Nichts,
}

/// Schlüssel eines vorgemerkten Nachlaufs: die Datenbank (Adresse des Pools) und das Fahrzeug.
/// Die Datenbank gehört dazu, weil Einsatzfahrzeug-Nummern nur je Datenbank gelten; so teilen
/// sich Tests mit je eigener Datenbank die Menge nicht.
type NachlaufKey = (usize, i64);

/// Fahrzeuge mit vorgemerktem Nachlauf (je Fahrzeug höchstens einer).
static NACHLAUF: Mutex<Option<HashSet<NachlaufKey>>> = Mutex::new(None);

fn nachlauf_menge<T>(f: impl FnOnce(&mut HashSet<NachlaufKey>) -> T) -> T {
    let mut g = NACHLAUF.lock().unwrap_or_else(|e| e.into_inner());
    f(g.get_or_insert_with(HashSet::new))
}

fn nachlauf_key(pool: &SqlitePool, ef_id: i64) -> NachlaufKey {
    (std::ptr::from_ref(pool.options()) as usize, ef_id)
}

/// Testhaken: ist für das Einsatzfahrzeug ein Nachlauf vorgemerkt?
pub fn is_nachlauf_vorgemerkt(pool: &SqlitePool, ef_id: i64) -> bool {
    nachlauf_menge(|m| m.contains(&nachlauf_key(pool, ef_id)))
}

thread_local! {
    /// Verkürzte Wartezeit des Nachlaufs für Tests; gilt für den Thread, der ihn vormerkt (ein
    /// Test mit eigener Laufzeit ist eigener Thread), nie für andere Tests.
    static VERZOEGERUNG: std::cell::Cell<Option<Duration>> = const { std::cell::Cell::new(None) };
}

/// Testhaken: kürzt die Wartezeit des Nachlaufs, den dieser Thread danach vormerkt. Ohne
/// Aufruf gilt [`ORTUNG_DROSSEL_S`].
pub fn set_nachlauf_verzoegerung(d: Duration) {
    VERZOEGERUNG.with(|v| v.set(Some(d)));
}

/// Entfernt die Vormerkung, auch wenn die Aufgabe abgebrochen wird (Ende der Laufzeit).
struct NachlaufWache(NachlaufKey);

impl Drop for NachlaufWache {
    fn drop(&mut self) {
        nachlauf_menge(|m| m.remove(&self.0));
    }
}

/// Übernimmt die Ablage der Kennung in das gekoppelte Fahrzeug. `jetzt` ist die Serverzeit
/// (`zeit::FORMAT`) für die Klemme der Messzeit; Tests geben sie vor. Gehört in eine
/// Schreibtransaktion des Aufrufers.
pub async fn apply_position_tx(
    conn: &mut SqliteConnection,
    zugang_id: &str,
    kennung: &str,
    jetzt: &str,
) -> Result<Uebernahme, AppError> {
    apply_position_gedrosselt_tx(conn, zugang_id, kennung, jetzt, true).await
}

/// Wie [`apply_position_tx`]; `drosseln = false` für den Nachlauf, der die Drossel schon
/// abgewartet hat.
async fn apply_position_gedrosselt_tx(
    conn: &mut SqliteConnection,
    zugang_id: &str,
    kennung: &str,
    jetzt: &str,
    drosseln: bool,
) -> Result<Uebernahme, AppError> {
    type Zeile = (i64, i64, f64, f64, String, Option<String>, Option<String>);
    let zeile: Option<Zeile> = sqlx::query_as(
        "SELECT k.einsatz_fahrzeug_id, k.einsatz_id, p.lat, p.lon, p.gemessen_at, \
                ef.position_quelle, ef.position_aktualisiert_at \
         FROM ortung_kopplung k \
         JOIN einsatz_fahrzeug ef ON ef.id = k.einsatz_fahrzeug_id AND ef.beendet_at IS NULL \
         JOIN einsatz e ON e.id = ef.einsatz_id AND e.status = 'aktiv' AND e.spiegel = 0 \
         JOIN org_einstellungen o ON o.org_id = k.org_id AND o.ortung_im_einsatz = 1 \
         JOIN position_letzte p ON p.zugang_id = k.zugang_id AND p.kennung = k.kennung \
         WHERE k.zugang_id = ? AND k.kennung = ?",
    )
    .bind(zugang_id)
    .bind(kennung)
    .fetch_optional(&mut *conn)
    .await?;
    let Some((ef_id, einsatz_id, breite, laenge, gemessen_at, quelle, aktualisiert_at)) = zeile
    else {
        return Ok(Uebernahme::Nichts);
    };
    schreibe_gedrosselt(
        conn,
        Fix {
            ef_id,
            einsatz_id,
            breite,
            laenge,
            gemessen_at: &gemessen_at,
            quelle: quelle.as_deref(),
            aktualisiert_at: aktualisiert_at.as_deref(),
        },
        jetzt,
        drosseln,
    )
    .await
}

/// Position über den Hub (LLH-2119): wie [`apply_position_tx`], nur dass die Position aus der
/// Antwort des Hubs kommt statt aus `position_letzte` und die Kopplung an einem Zugang des Hubs
/// hängt (`fremder_zugang_id`). `org_id` ist die Org, unter deren Kennung die Position kam; nur
/// Kopplungszeilen dieser Org werden getroffen (ADR-0105, ADR-0039). Die Drossel gilt; ein
/// Nachlauf wird **nicht** vorgemerkt: der nächste Abgleich bringt die jüngste Position ohnehin
/// (Entwurf, „Übernahme am ELW“). Gehört in eine Schreibtransaktion des Aufrufers.
#[allow(clippy::too_many_arguments)]
pub async fn apply_remote_position_tx(
    conn: &mut SqliteConnection,
    instanz_kopplung_id: i64,
    org_id: i64,
    zugang_id: &str,
    kennung: &str,
    lat: f64,
    lon: f64,
    measured_at: &str,
    jetzt: &str,
) -> Result<Uebernahme, AppError> {
    let zeile: Option<(i64, i64, Option<String>, Option<String>)> = sqlx::query_as(
        "SELECT k.einsatz_fahrzeug_id, k.einsatz_id, \
                ef.position_quelle, ef.position_aktualisiert_at \
         FROM ortung_kopplung k \
         JOIN einsatz_fahrzeug ef ON ef.id = k.einsatz_fahrzeug_id AND ef.beendet_at IS NULL \
         JOIN einsatz e ON e.id = ef.einsatz_id AND e.status = 'aktiv' AND e.spiegel = 0 \
         JOIN org_einstellungen o ON o.org_id = k.org_id AND o.ortung_im_einsatz = 1 \
         WHERE k.instanz_kopplung_id = ? AND k.org_id = ? AND k.fremder_zugang_id = ? \
           AND k.kennung = ?",
    )
    .bind(instanz_kopplung_id)
    .bind(org_id)
    .bind(zugang_id)
    .bind(kennung)
    .fetch_optional(&mut *conn)
    .await?;
    let Some((ef_id, einsatz_id, quelle, aktualisiert_at)) = zeile else {
        return Ok(Uebernahme::Nichts);
    };
    schreibe_gedrosselt(
        conn,
        Fix {
            ef_id,
            einsatz_id,
            breite: lat,
            laenge: lon,
            gemessen_at: measured_at,
            quelle: quelle.as_deref(),
            aktualisiert_at: aktualisiert_at.as_deref(),
        },
        jetzt,
        true,
    )
    .await
}

/// Eine fertige Position mit dem Stand des Fahrzeugs, in das sie soll.
struct Fix<'a> {
    ef_id: i64,
    einsatz_id: i64,
    breite: f64,
    laenge: f64,
    gemessen_at: &'a str,
    quelle: Option<&'a str>,
    aktualisiert_at: Option<&'a str>,
}

/// Gemeinsame Prüf- und Schreiblogik beider Wege (Ablage und Hub): Klemme, Vergleich mit der
/// eigenen Quelle, Drossel, dann der Positionsbaustein.
async fn schreibe_gedrosselt(
    conn: &mut SqliteConnection,
    fix: Fix<'_>,
    jetzt: &str,
    drosseln: bool,
) -> Result<Uebernahme, AppError> {
    let Fix {
        ef_id,
        einsatz_id,
        breite,
        laenge,
        gemessen_at,
        quelle,
        aktualisiert_at,
    } = fix;
    let zeitpunkt = klemme_zeitpunkt(gemessen_at, jetzt);

    // Nur gegen die eigene Quelle: was schon steht (oder Jüngeres), ist nichts Neues, und ein
    // Fix knapp danach wird gedrosselt. Gegen `manuell` und `helfer` entscheidet allein der
    // Baustein.
    if quelle == Some(Positionsquelle::Einwurf.as_str()) {
        let alt = aktualisiert_at.and_then(zeit::parse);
        let neu = zeit::parse(&zeitpunkt);
        if let (Some(alt), Some(neu)) = (alt, neu) {
            if neu <= alt {
                return Ok(Uebernahme::Nichts);
            }
            if drosseln && (neu - alt).num_seconds() < ORTUNG_DROSSEL_S {
                return Ok(Uebernahme::Gedrosselt { ef_id });
            }
        }
    }

    let geschrieben = schreibe_position(
        conn,
        einsatz_id,
        Ortungsziel::Fahrzeug(ef_id),
        breite,
        laenge,
        &zeitpunkt,
        Positionsquelle::Einwurf,
    )
    .await?;
    Ok(if geschrieben {
        Uebernahme::Geschrieben { einsatz_id, ef_id }
    } else {
        Uebernahme::Nichts
    })
}

/// Übernahme nach dem Einwurf: eigene Transaktion, danach live melden bzw. den Nachlauf
/// vormerken. Fehler wirken nicht auf den Einwurf; sie werden ohne Kennung als Sammelzeile
/// gezählt.
pub async fn apply_position(state: &AppState, zugang_id: &str, kennung: &str) {
    uebernehmen_und_melden(state, zugang_id, kennung, true).await;
}

async fn uebernehmen_und_melden(state: &AppState, zugang_id: &str, kennung: &str, drosseln: bool) {
    let jetzt = zeit::jetzt();
    let ergebnis = write_retry!(&state.pool, |conn| {
        apply_position_gedrosselt_tx(conn, zugang_id, kennung, &jetzt, drosseln).await
    });
    match ergebnis {
        Ok(Uebernahme::Geschrieben { einsatz_id, ef_id }) => {
            publiziere(state, einsatz_id, Ortungsziel::Fahrzeug(ef_id));
        }
        Ok(Uebernahme::Gedrosselt { ef_id }) => schedule_nachlauf(state, ef_id),
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
fn schedule_nachlauf(state: &AppState, ef_id: i64) {
    let key = nachlauf_key(&state.pool, ef_id);
    if !nachlauf_menge(|m| m.insert(key)) {
        return;
    }
    let wache = NachlaufWache(key);
    let state = state.clone();
    let warten = VERZOEGERUNG
        .with(|v| v.get())
        .unwrap_or(Duration::from_secs(ORTUNG_DROSSEL_S as u64));
    tokio::spawn(async move {
        run_nachlauf(state, ef_id, wache, warten).await;
    });
}

/// Wartet die Drossel ab und übernimmt dann die jüngste Position der Kennung, die *jetzt* an
/// das Fahrzeug gekoppelt ist (eine Neukopplung während des Wartens ersetzt die Kennung). Die
/// Vormerkung fällt vor dem Lauf weg, damit ein erneut gedrosselter Fix wieder einen Nachlauf
/// vormerken kann; die Drossel gilt für den Nachlauf nicht mehr, er kommt frühestens 15 s nach
/// dem gedrosselten Fix.
async fn run_nachlauf(state: AppState, ef_id: i64, wache: NachlaufWache, warten: Duration) {
    tokio::time::sleep(warten).await;
    drop(wache);
    let kopplung: Result<Option<(String, String)>, _> = sqlx::query_as(
        "SELECT zugang_id, kennung FROM ortung_kopplung \
         WHERE einsatz_fahrzeug_id = ? AND zugang_id IS NOT NULL",
    )
    .bind(ef_id)
    .fetch_optional(&state.pool)
    .await;
    if let Ok(Some((zugang_id, kennung))) = kopplung {
        uebernehmen_und_melden(&state, &zugang_id, &kennung, false).await;
    }
}
