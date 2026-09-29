//! Kurzlebiger, prozessweiter State-Store für die WebAuthn-Zeremonien (LFH-275): hält den
//! Zwischenzustand zwischen `…/start` und `…/finish`. Dasselbe Muster wie `oidc/state.rs`
//! (TTL, Einmal-Nutzung, opportunistischer Sweep), rein im Speicher.
//!
//! **!Send-Disziplin:** `entnehme` gibt den std-`MutexGuard` frei, bevor der Aufrufer
//! `session::anlegen().await` ausführt; dieses Modul enthält kein `.await`. Ein Guard über
//! `.await` machte den axum-Handler `!Send`, und current-thread-Tests fangen das nicht ab.

use std::collections::HashMap;
use std::sync::{LazyLock, Mutex};
use std::time::{Duration, Instant};

use webauthn_rs::prelude::{
    DiscoverableAuthentication, PasskeyAuthentication, PasskeyRegistration,
};

/// Lebensdauer eines Zeremonie-Eintrags. Abgelaufene Einträge liefert `entnehme` nicht mehr.
const TTL: Duration = Duration::from_secs(5 * 60);

/// Prozessweiter State-Store; kurzlebig, ohne Persistenzbedarf.
static STORE: LazyLock<Mutex<HashMap<String, (CeremonyZustand, Instant)>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

/// Zwischenzustand EINER laufenden Zeremonie: Registrierung, benutzergebundene oder
/// discoverable (usernameless) Authentifizierung.
pub enum CeremonyZustand {
    Registrierung(PasskeyRegistration),
    Authentifizierung(PasskeyAuthentication),
    /// Discoverable Login (LFH-313): der Client entdeckt den Benutzer selbst, `finish` löst ihn
    /// über den User-Handle des Authenticators auf.
    AuthentifizierungDiscoverable(DiscoverableAuthentication),
}

/// Speichert `zustand` unter `key` mit Ablauf `TTL`; ein vorhandener Eintrag wird
/// überschrieben. Räumt vorher abgelaufene Einträge weg, damit abgebrochene oder gespammte
/// Starts die Map nicht unbegrenzt wachsen lassen.
pub fn speichere(key: String, zustand: CeremonyZustand) {
    let jetzt = Instant::now();
    let ablauf = jetzt + TTL;
    let mut store = STORE.lock().unwrap_or_else(|poison| poison.into_inner());
    store.retain(|_, (_, entry_ablauf)| *entry_ablauf > jetzt);
    store.insert(key, (zustand, ablauf));
}

/// Entnimmt den Eintrag zu `key` **einmalig**; ein zweiter Aufruf liefert `None`, ebenso ein
/// unbekannter oder abgelaufener Key. Der Guard ist bei der Rückkehr freigegeben.
pub fn entnehme(key: &str) -> Option<CeremonyZustand> {
    let mut store = STORE.lock().unwrap_or_else(|poison| poison.into_inner());
    let (zustand, ablauf) = store.remove(key)?;
    drop(store);

    if Instant::now() >= ablauf {
        return None;
    }
    Some(zustand)
}

/// Test-only: Eintrag mit vorgegebener Ablaufzeit, um einen abgelaufenen Eintrag ohne Warten zu
/// erzeugen.
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

    /// Minimales, echtes `Webauthn` zum Anstoßen der „start“-Hälften; baut rein lokal.
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
        // Eine leere Credential-Liste ist für die start-Hälfte zulässig; ein Authenticator wird
        // erst in
        // `finish` gebraucht.
        test_webauthn().start_passkey_authentication(&[]).unwrap().1
    }

    fn authentifizierung_discoverable() -> DiscoverableAuthentication {
        // Discoverable-Start nimmt keine Credential-Liste.
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
        // Kein `Instant::now() - …`: das panickt bei Unterlauf auf Hosts mit kurzer Uptime. Ein
        // Ablauf
        // von „jetzt“ ist einen Moment später bereits abgelaufen.
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
