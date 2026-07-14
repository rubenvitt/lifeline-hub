//! Kurzlebiger, prozessweiter State-Store für den OIDC-Authorization-Code-Flow
//! (LFH-41, Increment 3): hält `csrf`/`nonce`/`pkce_verifier`/Ziel-Pfad zwischen
//! `GET /api/auth/oidc/start` (Speichern) und `GET /api/auth/oidc/callback`
//! (Entnehmen) vor.
//!
//! Bewusst als plain `String`s statt `openidconnect`-Typen (`Nonce`,
//! `PkceCodeVerifier`, …) — entkoppelt dieses Modul von der `openidconnect`-Crate
//! und hält es ohne Netz/Discovery testbar. Der Callback-Handler (Task 6)
//! rekonstruiert `Nonce::new(s)` / `PkceCodeVerifier::new(s)` aus den Strings.
//!
//! **MUST — !Send-Disziplin** (Global Constraint des Plans
//! `2026-07-14-auth-provider-increment-3-oidc-sso.md`): `entnehme` lockt den
//! std-`Mutex`, `remove`t den Eintrag und gibt den `MutexGuard` SOFORT frei —
//! die Funktion endet, BEVOR der Aufrufer irgendein `.await` ausführt. Dieses
//! Modul selbst enthält daher kein einziges `.await`. Ein std-`Mutex`-Guard, der
//! über ein `.await` gehalten wird, macht den umschließenden axum-Handler
//! `!Send` — und current-thread-Tests fangen das nicht ab (Memory:
//! mutex-guard-await-send-axum).

use std::collections::HashMap;
use std::sync::{LazyLock, Mutex};
use std::time::{Duration, Instant};

/// Lebensdauer eines State-Eintrags. Nach Ablauf liefert `entnehme` `None`,
/// selbst wenn der Eintrag noch physisch in der Map steht (aufgeräumt wird er
/// beim nächsten `entnehme`-Versuch für genau diesen Key).
const TTL: Duration = Duration::from_secs(10 * 60);

/// Prozessweiter State-Store. Bewusst KEIN `AppState`-Feld (siehe Plan)
/// — der Flow ist kurzlebig und pro-Prozess, kein Persistenzbedarf.
static STORE: LazyLock<Mutex<HashMap<String, (StateEintrag, Instant)>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

/// Ein an einen state-Key gebundener Satz aus csrf-Flow-Daten: `nonce` und
/// `pkce_verifier` werden gegen die IdP-Antwort im Callback geprüft,
/// `ziel_pfad` ist die Seite, auf die nach erfolgreichem Login weitergeleitet
/// wird. Der `csrf`-Wert selbst ist der Map-Key (`state_key`) — er steckt
/// nicht redundant im Eintrag.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StateEintrag {
    pub nonce: String,
    pub pkce_verifier: String,
    pub ziel_pfad: String,
}

/// Speichert `eintrag` unter `state_key` mit einer Ablaufzeit von `TTL` ab
/// jetzt. Ein evtl. vorhandener Eintrag unter demselben Key wird überschrieben.
pub fn speichere(state_key: String, eintrag: StateEintrag) {
    let ablauf = Instant::now() + TTL;
    let mut store = STORE.lock().unwrap_or_else(|poison| poison.into_inner());
    store.insert(state_key, (eintrag, ablauf));
}

/// Entnimmt den Eintrag zu `state_key` — **einmalig**: der Eintrag wird beim
/// Zugriff aus der Map entfernt, ein zweiter `entnehme`-Aufruf mit demselben Key
/// liefert daher `None`. Liefert ebenso `None`, wenn der Key unbekannt ist oder
/// der Eintrag bereits abgelaufen ist.
///
/// Lockt den Store, `remove`t den Eintrag und gibt den `MutexGuard` frei, bevor
/// die Funktion zurückkehrt — der Aufrufer darf danach beliebig `.await`en,
/// ohne dass ein Guard über die Await-Grenze hinweg gehalten wird.
pub fn entnehme(state_key: &str) -> Option<StateEintrag> {
    let mut store = STORE.lock().unwrap_or_else(|poison| poison.into_inner());
    let (eintrag, ablauf) = store.remove(state_key)?;
    drop(store);

    if Instant::now() >= ablauf {
        return None;
    }
    Some(eintrag)
}

/// Test-only: fügt einen Eintrag mit einer explizit vorgegebenen Ablaufzeit
/// ein — erlaubt es, einen bereits abgelaufenen Eintrag zu konstruieren, ohne
/// in echten Tests 10 Minuten warten zu müssen. Nicht außerhalb von Tests
/// exponiert.
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
        let ablauf_in_der_vergangenheit = Instant::now() - Duration::from_secs(3600);
        speichere_mit_ablauf(key.clone(), eintrag("/ziel"), ablauf_in_der_vergangenheit);

        let entnommen = entnehme(&key);

        assert_eq!(entnommen, None);
    }
}
