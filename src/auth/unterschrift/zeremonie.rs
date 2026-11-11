//! Zeremonie-Zustand der Unterschriftsschlüssel (design.md D7): zwischen Start und Abschluss einer
//! Registrierung, Gegenzeichnung oder Notübernahme (LLH-1491), kurzlebig im Prozessspeicher wie
//! `auth::webauthn::state` (R10: ein Neustart bricht nur laufende Zeremonien ab). Der Schlüssel zum Eintrag geht als
//! Wert `zeremonie` an den Browser und zurück; der Eintrag ist an das Konto gebunden, das ihn
//! begonnen hat.

use crate::auth::ablauf_speicher::{BegrenzterAblaufSpeicher, Voll};
use std::sync::{LazyLock, Mutex, MutexGuard};
use std::time::{Duration, Instant};
use webauthn_rs::prelude::PasskeyRegistration;

const TTL: Duration = Duration::from_secs(5 * 60);
const OBERGRENZE: usize = 1_000;

/// Eine laufende Zeremonie.
pub enum Zeremonie {
    Registrierung {
        benutzer_id: i64,
        bezeichnung: String,
        zustand: PasskeyRegistration,
    },
    Gegenzeichnung {
        benutzer_id: i64,
        /// Der Schlüssel, der gegengezeichnet wird.
        ziel_id: i64,
        /// Die wörtliche Erklärung; ihr SHA-256 ist die Challenge.
        erklaerung: String,
    },
    /// Notübernahme der Führung eines Einsatzes (LLH-1491, design.md D6).
    Fuehrungserklaerung {
        benutzer_id: i64,
        /// Die Führungsakte (`einsatz_fuehrung.id`).
        akte_id: i64,
        /// Die wörtliche Erklärung; ihr SHA-256 ist die Challenge.
        erklaerung: String,
    },
}

impl Zeremonie {
    fn benutzer_id(&self) -> i64 {
        match self {
            Zeremonie::Registrierung { benutzer_id, .. }
            | Zeremonie::Gegenzeichnung { benutzer_id, .. }
            | Zeremonie::Fuehrungserklaerung { benutzer_id, .. } => *benutzer_id,
        }
    }
}

static STORE: LazyLock<Mutex<BegrenzterAblaufSpeicher<Zeremonie>>> =
    LazyLock::new(|| Mutex::new(BegrenzterAblaufSpeicher::neu(TTL, OBERGRENZE)));

fn speicher() -> MutexGuard<'static, BegrenzterAblaufSpeicher<Zeremonie>> {
    STORE.lock().unwrap_or_else(|p| p.into_inner())
}

/// Legt eine Zeremonie ab und liefert ihren Schlüssel.
pub fn store(z: Zeremonie) -> Result<String, Voll> {
    let key = crate::auth::session::neuer_token();
    speicher().einfuegen(key.clone(), z, Instant::now())?;
    Ok(key)
}

/// Entnimmt die Zeremonie einmalig, nur für das Konto, das sie begonnen hat. Kein `.await` hier
/// (der std-Guard ist bei der Rückkehr frei).
pub fn take(key: &str, benutzer_id: i64) -> Option<Zeremonie> {
    let z = speicher().entnehmen(key, Instant::now())?;
    (z.benutzer_id() == benutzer_id).then_some(z)
}
