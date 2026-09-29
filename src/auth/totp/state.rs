//! Kurzlebiger, prozessweiter State-Store für den zweistufigen Passwort→TOTP-Login (LFH-43):
//! hält die `benutzer_id` zwischen `POST /api/auth/login` und `POST /api/auth/totp/finish`.
//! Dasselbe Muster wie `oidc/state.rs`. Der Client bekommt nur einen hochentropischen Key im
//! HttpOnly-Cookie `mfa_pending`, nie die `benutzer_id`.
//!
//! **Pending-State → Session:** `/auth/totp/finish` leitet die `benutzer_id` AUS diesem Store
//! ab — nie aus client-gelieferten Anmeldedaten.
//!
//! **!Send-Disziplin:** `entnehme` gibt den std-`MutexGuard` frei, bevor der Aufrufer
//! `session::anlegen().await` ausführt; dieses Modul enthält kein `.await`.

use std::collections::HashMap;
use std::sync::{LazyLock, Mutex};
use std::time::{Duration, Instant};

/// Lebensdauer eines Pending-Eintrags. Abgelaufene Einträge liefert `entnehme` nicht mehr.
const TTL: Duration = Duration::from_secs(5 * 60);

/// Prozessweiter State-Store; kurzlebig, ohne Persistenzbedarf.
static STORE: LazyLock<Mutex<HashMap<String, (i64, Instant)>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

/// Speichert `benutzer_id` unter `key` mit Ablauf `TTL`; ein vorhandener Eintrag wird
/// überschrieben. Räumt vorher abgelaufene Einträge weg, damit abgebrochene oder gespammte
/// Logins die Map nicht unbegrenzt wachsen lassen.
pub fn speichere(key: String, benutzer_id: i64) {
    let jetzt = Instant::now();
    let ablauf = jetzt + TTL;
    let mut store = STORE.lock().unwrap_or_else(|poison| poison.into_inner());
    store.retain(|_, (_, entry_ablauf)| *entry_ablauf > jetzt);
    store.insert(key, (benutzer_id, ablauf));
}

/// Entnimmt die `benutzer_id` zu `key` **einmalig**; ein zweiter Aufruf liefert `None`, ebenso
/// ein unbekannter oder abgelaufener Key. Der Guard ist bei der Rückkehr freigegeben.
pub fn entnehme(key: &str) -> Option<i64> {
    let mut store = STORE.lock().unwrap_or_else(|poison| poison.into_inner());
    let (benutzer_id, ablauf) = store.remove(key)?;
    drop(store);

    if Instant::now() >= ablauf {
        return None;
    }
    Some(benutzer_id)
}

/// Test-only: Eintrag mit vorgegebener Ablaufzeit, um einen abgelaufenen Eintrag ohne Warten zu
/// erzeugen.
#[cfg(test)]
fn speichere_mit_ablauf(key: String, benutzer_id: i64, ablauf: Instant) {
    let mut store = STORE.lock().unwrap_or_else(|poison| poison.into_inner());
    store.insert(key, (benutzer_id, ablauf));
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn speichere_dann_entnehme_liefert_dieselbe_benutzer_id() {
        let key = "mfa-roundtrip".to_string();

        speichere(key.clone(), 42);
        let entnommen = entnehme(&key);

        assert_eq!(entnommen, Some(42));
    }

    #[test]
    fn zweites_entnehme_desselben_keys_liefert_none() {
        let key = "mfa-einmalig".to_string();
        speichere(key.clone(), 7);

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

    #[test]
    fn speichere_raeumt_abgelaufene_eintraege_auf() {
        let alt_key = "mfa-alt-abgelaufen".to_string();
        speichere_mit_ablauf(alt_key.clone(), 1, Instant::now());

        let neu_key = "mfa-neu".to_string();
        speichere(neu_key.clone(), 2);

        let store = STORE.lock().unwrap_or_else(|poison| poison.into_inner());
        assert!(
            !store.contains_key(&alt_key),
            "abgelaufener Eintrag sollte beim naechsten speichere() aufgeraeumt werden"
        );
        assert!(store.contains_key(&neu_key));
    }
}
