//! Kurzlebiger, prozessweiter State-Store für den zweistufigen Passwort→TOTP-Login (LFH-43):
//! hält die `benutzer_id` zwischen `POST /api/auth/login` und `POST /api/auth/totp/finish`, dazu
//! den Passwort-Hash, gegen den der Passwortschritt geprüft hat (LFH-1121): hat sich das Passwort
//! dazwischen geändert (etwa ein neues Einmalpasswort der Administration), gilt der Schritt nicht
//! mehr.
//! Dasselbe Muster wie `oidc/state.rs`. Der Client bekommt nur einen hochentropischen Key im
//! HttpOnly-Cookie `mfa_pending`, nie die `benutzer_id`.
//!
//! **Pending-State → Session:** `/auth/totp/finish` leitet die `benutzer_id` AUS diesem Store
//! ab — nie aus client-gelieferten Anmeldedaten.
//!
//! **Begrenzt** (LFH-919, [`BegrenzterAblaufSpeicher`]): höchstens [`OBERGRENZE`] offene
//! Anmeldungen; darüber antwortet der Login mit 503. Bewusst **kein** Ersatz je Person wie beim
//! Einmalcode der Hülle: ein Funktionskonto meldet sich oft auf zwei Geräten zugleich an, und
//! der zweite Login machte den ersten zwischen Passwort und Code still ungültig, während die
//! Person noch ihren Code abtippt. Wachsen kann der Speicher hier nur mit richtigem Passwort,
//! gebremst durch die KDF; ein Innentäter mit eigenem TOTP-Konto könnte ihn mit vielen Logins
//! dennoch füllen und TOTP-Anmeldungen bis zum Ablauf (5 min) mit 503 abweisen lassen.
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
/// Ein offener Zwischenschritt nach bestandenem Passwort.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Offen {
    pub benutzer_id: i64,
    /// `passwort_hash` des Kontos zum Zeitpunkt der Passwortprüfung.
    pub passwort_hash: String,
}

static STORE: LazyLock<Mutex<BegrenzterAblaufSpeicher<Offen>>> =
    LazyLock::new(|| Mutex::new(neuer_speicher()));

fn neuer_speicher() -> BegrenzterAblaufSpeicher<Offen> {
    BegrenzterAblaufSpeicher::neu(TTL, OBERGRENZE)
}

fn store() -> MutexGuard<'static, BegrenzterAblaufSpeicher<Offen>> {
    STORE.lock().unwrap_or_else(|poison| poison.into_inner())
}

/// Speichert den Zwischenschritt unter `key` mit Ablauf `TTL`; ein vorhandener Eintrag wird
/// überschrieben. Bei [`OBERGRENZE`] offenen Anmeldungen wird nicht eingefügt ([`Voll`]).
pub fn speichere(key: String, offen: Offen) -> Result<(), Voll> {
    store().einfuegen(key, offen, Instant::now())
}

/// Entnimmt die `benutzer_id` zu `key` **einmalig**; ein zweiter Aufruf liefert `None`, ebenso
/// ein unbekannter oder abgelaufener Key. Der Guard ist bei der Rückkehr freigegeben.
pub fn entnehme(key: &str) -> Option<Offen> {
    store().entnehmen(key, Instant::now())
}

/// Test-only: Eintrag mit vorgegebener Ablaufzeit, um einen abgelaufenen Eintrag ohne Warten zu
/// erzeugen.
#[cfg(test)]
fn speichere_mit_ablauf(key: String, offen: Offen, ablauf: Instant) {
    store().einfuegen_mit_ablauf(key, offen, ablauf);
}

#[cfg(test)]
mod tests {
    use super::*;

    fn offen(benutzer_id: i64) -> Offen {
        Offen {
            benutzer_id,
            passwort_hash: format!("hash-{benutzer_id}"),
        }
    }

    #[test]
    fn speichere_dann_entnehme_liefert_dieselbe_benutzer_id() {
        let key = "mfa-roundtrip".to_string();

        speichere(key.clone(), offen(42)).unwrap();
        let entnommen = entnehme(&key);

        assert_eq!(entnommen, Some(offen(42)));
    }

    #[test]
    fn zweites_entnehme_desselben_keys_liefert_none() {
        let key = "mfa-einmalig".to_string();
        speichere(key.clone(), offen(7)).unwrap();

        let erstes = entnehme(&key);
        let zweites = entnehme(&key);

        assert_eq!(erstes, Some(offen(7)));
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
        speichere_mit_ablauf(key.clone(), offen(99), ablauf_in_der_vergangenheit);

        let entnommen = entnehme(&key);

        assert_eq!(entnommen, None);
    }

    /// Am eigenen Speicher statt am prozessweiten: der ist mit den übrigen Tests geteilt.
    #[test]
    fn die_anmeldung_ueber_der_obergrenze_wird_abgewiesen() {
        let mut s = neuer_speicher();
        let jetzt = Instant::now();
        for n in 0..OBERGRENZE {
            s.einfuegen(format!("k{n}"), offen(1), jetzt).unwrap();
        }
        assert_eq!(s.einfuegen("zuviel".into(), offen(1), jetzt), Err(Voll));
    }
}
