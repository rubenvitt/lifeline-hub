//! Kurzlebiger, prozessweiter State-Store für den zweistufigen Passwort→TOTP-Login (LFH-43):
//! hält die `benutzer_id` zwischen `POST /api/auth/login` und `POST /api/auth/totp/finish`.
//! Dasselbe Muster wie `oidc/state.rs`. Der Client bekommt nur einen hochentropischen Key im
//! HttpOnly-Cookie `mfa_pending`, nie die `benutzer_id`.
//!
//! **Pending-State → Session:** `/auth/totp/finish` leitet die `benutzer_id` AUS diesem Store
//! ab — nie aus client-gelieferten Anmeldedaten.
//!
//! **Begrenzt** (LFH-919, [`BegrenzterAblaufSpeicher`]): höchstens [`OBERGRENZE`] offene
//! Anmeldungen; darüber antwortet der Login mit 503. Bewusst **kein** Ersatz je Person wie beim
//! Einmalcode der Hülle: ein Funktionskonto meldet sich oft auf zwei Geräten zugleich an, und
//! der zweite Login machte den ersten zwischen Passwort und Code still ungültig. Wachsen kann
//! der Speicher hier ohnehin nur mit richtigem Passwort.
//!
//! **!Send-Disziplin:** `entnehme` gibt den std-`MutexGuard` frei, bevor der Aufrufer
//! `session::anlegen().await` ausführt; dieses Modul enthält kein `.await`.

use std::sync::{LazyLock, Mutex, MutexGuard};
use std::time::{Duration, Instant};

use crate::auth::ablauf_speicher::{BegrenzterAblaufSpeicher, Voll};

/// Lebensdauer eines Pending-Eintrags. Abgelaufene Einträge liefert `entnehme` nicht mehr.
const TTL: Duration = Duration::from_secs(5 * 60);

/// Höchstzahl offener Anmeldungen zwischen Passwort und Zweitfaktor.
pub const OBERGRENZE: usize = 10_000;

/// Prozessweiter State-Store; kurzlebig, ohne Persistenzbedarf.
static STORE: LazyLock<Mutex<BegrenzterAblaufSpeicher<i64>>> =
    LazyLock::new(|| Mutex::new(neuer_speicher()));

fn neuer_speicher() -> BegrenzterAblaufSpeicher<i64> {
    BegrenzterAblaufSpeicher::neu(TTL, OBERGRENZE)
}

fn store() -> MutexGuard<'static, BegrenzterAblaufSpeicher<i64>> {
    STORE.lock().unwrap_or_else(|poison| poison.into_inner())
}

/// Speichert `benutzer_id` unter `key` mit Ablauf `TTL`; ein vorhandener Eintrag wird
/// überschrieben. Bei [`OBERGRENZE`] offenen Anmeldungen wird nicht eingefügt ([`Voll`]).
pub fn speichere(key: String, benutzer_id: i64) -> Result<(), Voll> {
    store().einfuegen(key, benutzer_id, Instant::now())
}

/// Entnimmt die `benutzer_id` zu `key` **einmalig**; ein zweiter Aufruf liefert `None`, ebenso
/// ein unbekannter oder abgelaufener Key. Der Guard ist bei der Rückkehr freigegeben.
pub fn entnehme(key: &str) -> Option<i64> {
    store().entnehmen(key, Instant::now())
}

/// Test-only: Eintrag mit vorgegebener Ablaufzeit, um einen abgelaufenen Eintrag ohne Warten zu
/// erzeugen.
#[cfg(test)]
fn speichere_mit_ablauf(key: String, benutzer_id: i64, ablauf: Instant) {
    store().einfuegen_mit_ablauf(key, benutzer_id, ablauf);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn speichere_dann_entnehme_liefert_dieselbe_benutzer_id() {
        let key = "mfa-roundtrip".to_string();

        speichere(key.clone(), 42).unwrap();
        let entnommen = entnehme(&key);

        assert_eq!(entnommen, Some(42));
    }

    #[test]
    fn zweites_entnehme_desselben_keys_liefert_none() {
        let key = "mfa-einmalig".to_string();
        speichere(key.clone(), 7).unwrap();

        let erstes = entnehme(&key);
        let zweites = entnehme(&key);

        assert_eq!(erstes, Some(7));
        assert_eq!(zweites, None);
    }

    #[test]
    fn entnehme_unbekannten_keys_liefert_none() {
        let entnommen = entnehme("mfa-existiert-nicht");
        assert_eq!(entnommen, None);
    }

    #[test]
    fn abgelaufener_eintrag_liefert_none() {
        let key = "mfa-abgelaufen".to_string();
        // Kein `Instant::now() - …`: das panickt bei Unterlauf auf Hosts mit kurzer Uptime. Ein
        // Ablauf
        // von „jetzt“ ist einen Moment später bereits abgelaufen.
        let ablauf_in_der_vergangenheit = Instant::now();
        speichere_mit_ablauf(key.clone(), 99, ablauf_in_der_vergangenheit);

        let entnommen = entnehme(&key);

        assert_eq!(entnommen, None);
    }

    /// Am eigenen Speicher statt am prozessweiten: der ist mit den übrigen Tests geteilt.
    #[test]
    fn die_anmeldung_ueber_der_obergrenze_wird_abgewiesen() {
        let mut s = neuer_speicher();
        let jetzt = Instant::now();
        for n in 0..OBERGRENZE {
            s.einfuegen(format!("k{n}"), 1, jetzt).unwrap();
        }
        assert_eq!(s.einfuegen("zuviel".into(), 1, jetzt), Err(Voll));
    }
}
