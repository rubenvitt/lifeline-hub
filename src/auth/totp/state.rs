//! Kurzlebiger, prozessweiter State-Store für den zweistufigen Passwort→TOTP-Login
//! (LFH-43, Increment 5): hält die `benutzer_id` zwischen dem Passwort-Schritt
//! (`POST /api/auth/login`, Passwort ok + `totp_aktiviert` → Speichern) und dem
//! TOTP-Schritt (`POST /api/auth/totp/finish`, Entnehmen) vor.
//!
//! Analog zu `oidc/state.rs` (LFH-41) und `webauthn/state.rs` (LFH-275) — 1:1
//! dasselbe Muster (TTL, Einmal-Nutzung, Guard-sync-only, Poison-safe-Lock,
//! opportunistischer Sweep). Der Pending-Key ist der Träger des HttpOnly-Cookies
//! `mfa_pending` (Task 5) — NICHT die `benutzer_id` selbst wird an den Client
//! gegeben, nur ein high-entropy Token, der auf diesen Store zeigt.
//!
//! **MUST — Pending-State→Session-Gating** (Global Constraint des Plans
//! `2026-07-14-auth-provider-increment-5-mfa-totp.md`, „der Crux"): `/auth/totp/finish`
//! leitet `benutzer_id` AUS diesem Store ab — NIE aus einem client-gelieferten
//! Username/Passwort. Der Store ist die einzige Brücke zwischen dem Passwort-Schritt
//! und der Session-Anlage für `totp_aktiviert`-Nutzer.
//!
//! **MUST — !Send-Disziplin** (Global Constraint „Guard-drop-vor-await"): `entnehme`
//! lockt den std-`Mutex`, `remove`t den Eintrag und gibt den `MutexGuard` SOFORT
//! frei — die Funktion endet, BEVOR der Aufrufer `session::anlegen().await` (Task 5)
//! ausführt. Dieses Modul selbst enthält daher kein einziges `.await`. Ein
//! std-`Mutex`-Guard, der über ein `.await` gehalten wird, macht den umschließenden
//! axum-Handler `!Send` — und current-thread-Tests fangen das nicht ab (Memory:
//! mutex-guard-await-send-axum).

use std::collections::HashMap;
use std::sync::{LazyLock, Mutex};
use std::time::{Duration, Instant};

/// Lebensdauer eines Pending-MFA-Eintrags. Nach Ablauf liefert `entnehme` `None`,
/// selbst wenn der Eintrag noch physisch in der Map steht (aufgeräumt wird er beim
/// nächsten `entnehme`-Versuch für genau diesen Key bzw. opportunistisch beim
/// nächsten `speichere`).
const TTL: Duration = Duration::from_secs(5 * 60);

/// Prozessweiter State-Store. Bewusst KEIN `AppState`-Feld (siehe Plan) — der
/// Pending-MFA-Zustand ist kurzlebig und pro-Prozess, kein Persistenzbedarf.
static STORE: LazyLock<Mutex<HashMap<String, (i64, Instant)>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

/// Speichert `benutzer_id` unter `key` mit einer Ablaufzeit von `TTL` ab jetzt. Ein
/// evtl. vorhandener Eintrag unter demselben Key wird überschrieben.
///
/// Räumt vor dem Einfügen opportunistisch alle bereits abgelaufenen Einträge auf —
/// verhindert unbegrenztes Wachstum der Map durch abgebrochene (Passwort ok, aber nie
/// abgeschlossener TOTP-Schritt) oder gespammte Login-Versuche.
pub fn speichere(key: String, benutzer_id: i64) {
    let jetzt = Instant::now();
    let ablauf = jetzt + TTL;
    let mut store = STORE.lock().unwrap_or_else(|poison| poison.into_inner());
    // Opportunistisch abgelaufene Einträge aufräumen — verhindert unbegrenztes
    // Wachstum durch nie abgeholte (abgebrochene/gespammte) Passwort→TOTP-Flows.
    store.retain(|_, (_, entry_ablauf)| *entry_ablauf > jetzt);
    store.insert(key, (benutzer_id, ablauf));
}

/// Entnimmt die `benutzer_id` zu `key` — **einmalig**: der Eintrag wird beim Zugriff
/// aus der Map entfernt, ein zweiter `entnehme`-Aufruf mit demselben Key liefert daher
/// `None`. Liefert ebenso `None`, wenn der Key unbekannt ist oder der Eintrag bereits
/// abgelaufen ist.
///
/// Lockt den Store, `remove`t den Eintrag und gibt den `MutexGuard` frei, bevor die
/// Funktion zurückkehrt — der Aufrufer darf danach beliebig `.await`en, ohne dass ein
/// Guard über die Await-Grenze hinweg gehalten wird.
pub fn entnehme(key: &str) -> Option<i64> {
    let mut store = STORE.lock().unwrap_or_else(|poison| poison.into_inner());
    let (benutzer_id, ablauf) = store.remove(key)?;
    drop(store);

    if Instant::now() >= ablauf {
        return None;
    }
    Some(benutzer_id)
}

/// Test-only: fügt einen Eintrag mit einer explizit vorgegebenen Ablaufzeit ein —
/// erlaubt es, einen bereits abgelaufenen Eintrag zu konstruieren, ohne in echten
/// Tests 5 Minuten warten zu müssen. Nicht außerhalb von Tests exponiert.
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
        // Bewusst kein `Instant::now() - Duration::from_secs(...)`: `Instant`s `Sub`
        // panickt bei Unterlauf, was auf einem Host mit <1h Monotonic-Uptime
        // zuschlagen kann. `entnehme` prüft `jetzt >= ablauf` — ein `ablauf` von
        // "jetzt" liest sich einen Moment später bereits als abgelaufen, ganz ohne
        // Subtraktion.
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
