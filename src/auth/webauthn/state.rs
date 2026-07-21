//! Kurzlebiger, prozessweiter State-Store für die beiden WebAuthn-Zeremonien
//! (LFH-275, Increment 4): hält den `PasskeyRegistration`- bzw.
//! `PasskeyAuthentication`-Zwischenzustand zwischen `.../start` (Speichern) und
//! `.../finish` (Entnehmen) vor (Task 5/6).
//!
//! Analog zu `oidc/state.rs` (LFH-41) — 1:1 dasselbe Muster (TTL, Einmal-Nutzung,
//! Guard-sync-only, Poison-safe-Lock, opportunistischer Sweep). Bewusst als reiner
//! In-Memory-Wert (KEIN `serde`) — beide `webauthn-rs`-Typen sind zwar serde-fähig,
//! aber dieses Modul serialisiert nichts: der Zustand lebt nur zwischen zwei
//! Requests desselben Prozesses und muss nie über die Prozessgrenze hinaus.
//!
//! **MUST — !Send-Disziplin** (Global Constraint des Plans
//! `2026-07-14-auth-provider-increment-4-webauthn.md`, „Guard-drop-vor-await"):
//! `entnehme` lockt den std-`Mutex`, `remove`t den Eintrag und gibt den
//! `MutexGuard` SOFORT frei — die Funktion endet, BEVOR der Aufrufer
//! `session::anlegen().await` (Task 6) ausführt. Dieses Modul selbst enthält daher
//! kein einziges `.await`. Ein std-`Mutex`-Guard, der über ein `.await` gehalten
//! wird, macht den umschließenden axum-Handler `!Send` — und current-thread-Tests
//! fangen das nicht ab (Memory: mutex-guard-await-send-axum).

use std::collections::HashMap;
use std::sync::{LazyLock, Mutex};
use std::time::{Duration, Instant};

use webauthn_rs::prelude::{
    DiscoverableAuthentication, PasskeyAuthentication, PasskeyRegistration,
};

/// Lebensdauer eines Ceremony-State-Eintrags. Nach Ablauf liefert `entnehme` `None`,
/// selbst wenn der Eintrag noch physisch in der Map steht (aufgeräumt wird er beim
/// nächsten `entnehme`-Versuch für genau diesen Key bzw. opportunistisch beim
/// nächsten `speichere`).
const TTL: Duration = Duration::from_secs(5 * 60);

/// Prozessweiter State-Store. Bewusst KEIN `AppState`-Feld (siehe Plan) — die
/// Zeremonie ist kurzlebig und pro-Prozess, kein Persistenzbedarf.
static STORE: LazyLock<Mutex<HashMap<String, (CeremonyZustand, Instant)>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

/// Der Zwischenzustand EINER laufenden WebAuthn-Zeremonie: eine Registrierung
/// (`register/start` → `register/finish`, Task 5), eine benutzergebundene
/// Authentifizierung (`auth/start` → `auth/finish`, Task 6) oder eine discoverable/
/// usernameless Authentifizierung (`discoverable/start` → `discoverable/finish`,
/// LFH-313). Alle inneren Typen stammen aus `webauthn-rs` und werden hier als reiner
/// In-Memory-Wert gehalten.
pub enum CeremonyZustand {
    Registrierung(PasskeyRegistration),
    Authentifizierung(PasskeyAuthentication),
    /// Discoverable/usernameless Login (LFH-313). Der Client entdeckt den Benutzer
    /// selbst (leere `allowCredentials`); der `finish`-Handler löst ihn über den
    /// vom Authenticator gelieferten User-Handle auf.
    AuthentifizierungDiscoverable(DiscoverableAuthentication),
}

/// Speichert `zustand` unter `key` mit einer Ablaufzeit von `TTL` ab jetzt. Ein
/// evtl. vorhandener Eintrag unter demselben Key wird überschrieben.
///
/// Räumt vor dem Einfügen opportunistisch alle bereits abgelaufenen Einträge auf
/// — verhindert unbegrenztes Wachstum der Map durch abgebrochene (`.../start` ohne
/// folgenden `.../finish`) oder gespammte Zeremonie-Starts.
pub fn speichere(key: String, zustand: CeremonyZustand) {
    let jetzt = Instant::now();
    let ablauf = jetzt + TTL;
    let mut store = STORE.lock().unwrap_or_else(|poison| poison.into_inner());
    // Opportunistisch abgelaufene Einträge aufräumen — verhindert unbegrenztes
    // Wachstum durch nie abgeholte (abgebrochene/gespammte) .../start-Flows.
    store.retain(|_, (_, entry_ablauf)| *entry_ablauf > jetzt);
    store.insert(key, (zustand, ablauf));
}

/// Entnimmt den Eintrag zu `key` — **einmalig**: der Eintrag wird beim Zugriff aus
/// der Map entfernt, ein zweiter `entnehme`-Aufruf mit demselben Key liefert daher
/// `None`. Liefert ebenso `None`, wenn der Key unbekannt ist oder der Eintrag
/// bereits abgelaufen ist.
///
/// Lockt den Store, `remove`t den Eintrag und gibt den `MutexGuard` frei, bevor die
/// Funktion zurückkehrt — der Aufrufer darf danach beliebig `.await`en, ohne dass
/// ein Guard über die Await-Grenze hinweg gehalten wird.
pub fn entnehme(key: &str) -> Option<CeremonyZustand> {
    let mut store = STORE.lock().unwrap_or_else(|poison| poison.into_inner());
    let (zustand, ablauf) = store.remove(key)?;
    drop(store);

    if Instant::now() >= ablauf {
        return None;
    }
    Some(zustand)
}

/// Test-only: fügt einen Eintrag mit einer explizit vorgegebenen Ablaufzeit ein —
/// erlaubt es, einen bereits abgelaufenen Eintrag zu konstruieren, ohne in echten
/// Tests 5 Minuten warten zu müssen. Nicht außerhalb von Tests exponiert.
#[cfg(test)]
fn speichere_mit_ablauf(key: String, zustand: CeremonyZustand, ablauf: Instant) {
    let mut store = STORE.lock().unwrap_or_else(|poison| poison.into_inner());
    store.insert(key, (zustand, ablauf));
}

#[cfg(test)]
mod tests {
    use super::*;
    use uuid::Uuid;
    use webauthn_rs::prelude::{Url, WebauthnBuilder};

    /// Baut ein minimales, aber ECHTES `Webauthn` (keine gefälschten Zustandswerte)
    /// nur zum Anstoßen der beiden Zeremonie-„start"-Hälften — genau wie in der
    /// Task-Anleitung beschrieben. Netz/Discovery ist dafür nicht nötig
    /// (`WebauthnBuilder` baut rein lokal aus rp_id/rp_origin).
    fn test_webauthn() -> webauthn_rs::Webauthn {
        WebauthnBuilder::new("localhost", &Url::parse("https://localhost").unwrap())
            .unwrap()
            .build()
            .unwrap()
    }

    fn registrierung() -> PasskeyRegistration {
        test_webauthn()
            .start_passkey_registration(Uuid::new_v4(), "u", "U", None)
            .unwrap()
            .1
    }

    fn authentifizierung() -> PasskeyAuthentication {
        // Leere Credential-Liste ist für die START-Hälfte zulässig — die
        // Policy wird von `start_passkey_authentication` fix auf „Required"
        // gesetzt (kein Rückgriff auf `creds.first()`), ein Authenticator wird
        // erst in der (hier nicht getesteten) `finish`-Hälfte gebraucht.
        test_webauthn().start_passkey_authentication(&[]).unwrap().1
    }

    fn authentifizierung_discoverable() -> DiscoverableAuthentication {
        // Discoverable-Start nimmt KEINE Credential-Liste — der Client entdeckt den
        // Benutzer selbst. Reine Challenge-Erzeugung, kein Authenticator nötig.
        test_webauthn()
            .start_discoverable_authentication()
            .unwrap()
            .1
    }

    #[test]
    fn speichere_dann_entnehme_liefert_registrierung_zurueck() {
        let key = "reg-roundtrip".to_string();
        speichere(key.clone(), CeremonyZustand::Registrierung(registrierung()));

        let entnommen = entnehme(&key);

        assert!(matches!(entnommen, Some(CeremonyZustand::Registrierung(_))));
    }

    #[test]
    fn speichere_dann_entnehme_liefert_authentifizierung_zurueck() {
        let key = "auth-roundtrip".to_string();
        speichere(
            key.clone(),
            CeremonyZustand::Authentifizierung(authentifizierung()),
        );

        let entnommen = entnehme(&key);

        assert!(matches!(
            entnommen,
            Some(CeremonyZustand::Authentifizierung(_))
        ));
    }

    #[test]
    fn speichere_dann_entnehme_liefert_discoverable_zurueck() {
        let key = "disc-roundtrip".to_string();
        speichere(
            key.clone(),
            CeremonyZustand::AuthentifizierungDiscoverable(authentifizierung_discoverable()),
        );

        let entnommen = entnehme(&key);

        assert!(matches!(
            entnommen,
            Some(CeremonyZustand::AuthentifizierungDiscoverable(_))
        ));
    }

    #[test]
    fn zweites_entnehme_desselben_keys_liefert_none() {
        let key = "ceremony-einmalig".to_string();
        speichere(key.clone(), CeremonyZustand::Registrierung(registrierung()));

        let erstes = entnehme(&key);
        let zweites = entnehme(&key);

        assert!(erstes.is_some());
        assert!(zweites.is_none());
    }

    #[test]
    fn entnehme_unbekannten_keys_liefert_none() {
        let entnommen = entnehme("ceremony-existiert-nicht");
        assert!(entnommen.is_none());
    }

    #[test]
    fn abgelaufener_eintrag_liefert_none() {
        let key = "ceremony-abgelaufen".to_string();
        // Bewusst kein `Instant::now() - Duration::from_secs(...)`: `Instant`s
        // `Sub` panickt bei Unterlauf, was auf einem Host mit <1h Monotonic-
        // Uptime zuschlagen kann. `entnehme` prüft `jetzt >= ablauf` — ein
        // `ablauf` von "jetzt" liest sich einen Moment später bereits als
        // abgelaufen, ganz ohne Subtraktion.
        let ablauf_in_der_vergangenheit = Instant::now();
        speichere_mit_ablauf(
            key.clone(),
            CeremonyZustand::Registrierung(registrierung()),
            ablauf_in_der_vergangenheit,
        );

        let entnommen = entnehme(&key);

        assert!(entnommen.is_none());
    }

    #[test]
    fn speichere_raeumt_abgelaufene_eintraege_auf() {
        let alt_key = "ceremony-alt-abgelaufen".to_string();
        speichere_mit_ablauf(
            alt_key.clone(),
            CeremonyZustand::Registrierung(registrierung()),
            Instant::now(),
        );

        let neu_key = "ceremony-neu".to_string();
        speichere(
            neu_key.clone(),
            CeremonyZustand::Registrierung(registrierung()),
        );

        let store = STORE.lock().unwrap_or_else(|poison| poison.into_inner());
        assert!(
            !store.contains_key(&alt_key),
            "abgelaufener Eintrag sollte beim naechsten speichere() aufgeraeumt werden"
        );
        assert!(store.contains_key(&neu_key));
    }
}
