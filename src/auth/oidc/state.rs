//! Kurzlebiger, prozessweiter State-Store für den OIDC-Authorization-Code-Flow: hält
//! csrf/nonce/pkce_verifier/Ziel-Pfad zwischen `/api/auth/oidc/start` und `/callback`.
//!
//! Plain `String`s statt `openidconnect`-Typen, damit das Modul ohne Netz testbar bleibt.
//!
//! **Begrenzt** (LFH-919, [`BegrenzterAblaufSpeicher`]): höchstens [`OBERGRENZE`] offene
//! Flows; darüber legt `oidc/start` keinen an und antwortet mit 503. Abgelaufenes räumt ein
//! neuer Eintrag weg, höchstens einmal je Sekunde statt bei jedem Start.
//!
//! **!Send-Disziplin:** `entnehme` gibt den std-`MutexGuard` frei, bevor der Aufrufer irgendein
//! `.await` ausführt; dieses Modul enthält kein `.await`. Ein Guard über `.await` machte den
//! axum-Handler `!Send`, und current-thread-Tests fangen das nicht ab.

use std::sync::{LazyLock, Mutex, MutexGuard};
use std::time::{Duration, Instant};

use crate::auth::ablauf_speicher::{BegrenzterAblaufSpeicher, Voll};

/// Lebensdauer eines State-Eintrags. Abgelaufene Einträge liefert `entnehme` nicht mehr, auch
/// wenn sie noch im Speicher stehen.
const TTL: Duration = Duration::from_secs(10 * 60);

/// Höchstzahl offener Flows. Eine Wache meldet sich in Minuten an, nicht zu Tausenden; die
/// Grenze schützt nur den Speicher (`ziel_pfad` bis 512 Zeichen, s. `routes/auth.rs`).
pub const OBERGRENZE: usize = 10_000;

/// Prozessweiter State-Store; kurzlebig, ohne Persistenzbedarf.
static STORE: LazyLock<Mutex<BegrenzterAblaufSpeicher<StateEintrag>>> =
    LazyLock::new(|| Mutex::new(neuer_speicher()));

fn neuer_speicher() -> BegrenzterAblaufSpeicher<StateEintrag> {
    BegrenzterAblaufSpeicher::neu(TTL, OBERGRENZE)
}

fn store() -> MutexGuard<'static, BegrenzterAblaufSpeicher<StateEintrag>> {
    STORE.lock().unwrap_or_else(|poison| poison.into_inner())
}

/// Die an einen state-Key gebundenen Flow-Daten: `nonce` und `pkce_verifier` werden im Callback
/// geprüft, `ziel_pfad` ist das Weiterleitungsziel. Der csrf-Wert selbst ist der Map-Key.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StateEintrag {
    pub nonce: String,
    pub pkce_verifier: String,
    pub ziel_pfad: String,
}

/// Speichert `eintrag` unter `state_key` mit Ablauf `TTL`; ein vorhandener Eintrag wird
/// überschrieben. Bei [`OBERGRENZE`] offenen Flows wird nicht eingefügt ([`Voll`]).
pub fn speichere(state_key: String, eintrag: StateEintrag) -> Result<(), Voll> {
    store().einfuegen(state_key, eintrag, Instant::now())
}

/// Entnimmt den Eintrag zu `state_key` **einmalig**; ein zweiter Aufruf liefert `None`, ebenso
/// ein unbekannter oder abgelaufener Key. Der Guard ist bei der Rückkehr freigegeben.
pub fn entnehme(state_key: &str) -> Option<StateEintrag> {
    store().entnehmen(state_key, Instant::now())
}

/// Test-Hook: lässt nur noch Platz für `platz` weitere Einträge (`None`: zurück auf die
/// [`OBERGRENZE`]), damit ein Integrationstest die Grenze mit wenigen Anfragen erreicht. Nicht
/// `cfg(test)`, kein Aufrufer im Produktcode. Der Speicher ist prozessweit: nur in einem
/// Test-Binary aufrufen, dessen Tests nacheinander laufen (`NACHEINANDER` in
/// `tests/anmelde_start_grenzen.rs`, `tests/app_anmeldung.rs`).
#[doc(hidden)]
pub fn platz_fuer_tests(platz: Option<usize>) {
    let mut store = store();
    let grenze = platz.map_or(OBERGRENZE, |p| store.len() + p);
    store.obergrenze_setzen(grenze);
}

/// Test-only: Eintrag mit vorgegebener Ablaufzeit, um einen abgelaufenen Eintrag ohne Warten zu
/// erzeugen.
#[cfg(test)]
fn speichere_mit_ablauf(state_key: String, eintrag: StateEintrag, ablauf: Instant) {
    store().einfuegen_mit_ablauf(state_key, eintrag, ablauf);
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

        speichere(key.clone(), original.clone()).unwrap();
        let entnommen = entnehme(&key);

        assert_eq!(entnommen, Some(original));
    }

    #[test]
    fn zweites_entnehme_desselben_keys_liefert_none() {
        let key = "state-einmalig".to_string();
        speichere(key.clone(), eintrag("/ziel")).unwrap();

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

    /// Am eigenen Speicher statt am prozessweiten: der ist mit den übrigen Tests geteilt.
    #[test]
    fn der_eintrag_ueber_der_obergrenze_wird_abgewiesen() {
        let mut s = neuer_speicher();
        let jetzt = Instant::now();
        for n in 0..OBERGRENZE {
            s.einfuegen(format!("k{n}"), eintrag("/"), jetzt).unwrap();
        }
        assert_eq!(s.einfuegen("zuviel".into(), eintrag("/"), jetzt), Err(Voll));
        assert_eq!(s.len(), OBERGRENZE);
    }
}
