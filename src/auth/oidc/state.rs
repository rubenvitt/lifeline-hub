//! Kurzlebiger, prozessweiter State-Store für den OIDC-Authorization-Code-Flow: hält
//! csrf/nonce/pkce_verifier/Ziel-Pfad zwischen `/api/auth/oidc/start` und `/callback`.
//!
//! Plain `String`s statt `openidconnect`-Typen, damit das Modul ohne Netz testbar bleibt.
//!
//! **!Send-Disziplin:** `entnehme` gibt den std-`MutexGuard` frei, bevor der Aufrufer irgendein
//! `.await` ausführt; dieses Modul enthält kein `.await`. Ein Guard über `.await` machte den
//! axum-Handler `!Send`, und current-thread-Tests fangen das nicht ab.

use std::collections::HashMap;
use std::sync::{LazyLock, Mutex};
use std::time::{Duration, Instant};

/// Lebensdauer eines State-Eintrags. Abgelaufene Einträge liefert `entnehme` nicht mehr, auch
/// wenn sie noch in der Map stehen.
const TTL: Duration = Duration::from_secs(10 * 60);

/// Prozessweiter State-Store; kurzlebig, ohne Persistenzbedarf.
static STORE: LazyLock<Mutex<HashMap<String, (StateEintrag, Instant)>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

/// Die an einen state-Key gebundenen Flow-Daten: `nonce` und `pkce_verifier` werden im Callback
/// geprüft, `ziel_pfad` ist das Weiterleitungsziel. Der csrf-Wert selbst ist der Map-Key.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StateEintrag {
    pub nonce: String,
    pub pkce_verifier: String,
    pub ziel_pfad: String,
}

/// Speichert `eintrag` unter `state_key` mit Ablauf `TTL`; ein vorhandener Eintrag wird
/// überschrieben. Räumt vorher abgelaufene Einträge weg, damit abgebrochene oder gespammte
/// Start-Flows die Map nicht unbegrenzt wachsen lassen.
pub fn speichere(state_key: String, eintrag: StateEintrag) {
    let jetzt = Instant::now();
    let ablauf = jetzt + TTL;
    let mut store = STORE.lock().unwrap_or_else(|poison| poison.into_inner());
    store.retain(|_, (_, entry_ablauf)| *entry_ablauf > jetzt);
    store.insert(state_key, (eintrag, ablauf));
}

/// Entnimmt den Eintrag zu `state_key` **einmalig**; ein zweiter Aufruf liefert `None`, ebenso
/// ein unbekannter oder abgelaufener Key. Der Guard ist bei der Rückkehr freigegeben.
pub fn entnehme(state_key: &str) -> Option<StateEintrag> {
    let mut store = STORE.lock().unwrap_or_else(|poison| poison.into_inner());
    let (eintrag, ablauf) = store.remove(state_key)?;
    drop(store);

    if Instant::now() >= ablauf {
        return None;
    }
    Some(eintrag)
}

/// Test-only: Eintrag mit vorgegebener Ablaufzeit, um einen abgelaufenen Eintrag ohne Warten zu
/// erzeugen.
#[cfg(test)]
fn speichere_mit_ablauf(state_key: String, eintrag: StateEintrag, ablauf: Instant) {
    let mut store = STORE.lock().unwrap_or_else(|poison| poison.into_inner());
    store.insert(state_key, (eintrag, ablauf));
}

#[cfg(test)]
mod tests {
    use super::*;

    fn eintrag(ziel: &str) -> StateEintrag {
        StateEintrag {
            nonce: "test-nonce".to_string(),
            pkce_verifier: "test-pkce-verifier".to_string(),
            ziel_pfad: ziel.to_string(),
        }
    }

    #[test]
    fn speichere_dann_entnehme_liefert_denselben_eintrag() {
        let key = "state-roundtrip".to_string();
        let original = eintrag("/einsaetze");

        speichere(key.clone(), original.clone());
        let entnommen = entnehme(&key);

        assert_eq!(entnommen, Some(original));
    }

    #[test]
    fn zweites_entnehme_desselben_keys_liefert_none() {
        let key = "state-einmalig".to_string();
        speichere(key.clone(), eintrag("/ziel"));

        let erstes = entnehme(&key);
        let zweites = entnehme(&key);

        assert!(erstes.is_some());
        assert_eq!(zweites, None);
    }

    #[test]
    fn entnehme_unbekannten_keys_liefert_none() {
        let entnommen = entnehme("state-existiert-nicht");
        assert_eq!(entnommen, None);
    }

    #[test]
    fn abgelaufener_eintrag_liefert_none() {
        let key = "state-abgelaufen".to_string();
        // Kein `Instant::now() - …`: das panickt bei Unterlauf auf Hosts mit kurzer Uptime. Ein
        // Ablauf
        // von „jetzt“ ist einen Moment später bereits abgelaufen.
        let ablauf_in_der_vergangenheit = Instant::now();
        speichere_mit_ablauf(key.clone(), eintrag("/ziel"), ablauf_in_der_vergangenheit);

        let entnommen = entnehme(&key);

        assert_eq!(entnommen, None);
    }

    #[test]
    fn speichere_raeumt_abgelaufene_eintraege_auf() {
        let alt_key = "state-alt-abgelaufen".to_string();
        speichere_mit_ablauf(alt_key.clone(), eintrag("/alt"), Instant::now());

        let neu_key = "state-neu".to_string();
        speichere(neu_key.clone(), eintrag("/neu"));

        let store = STORE.lock().unwrap_or_else(|poison| poison.into_inner());
        assert!(
            !store.contains_key(&alt_key),
            "abgelaufener Eintrag sollte beim naechsten speichere() aufgeraeumt werden"
        );
        assert!(store.contains_key(&neu_key));
    }
}
