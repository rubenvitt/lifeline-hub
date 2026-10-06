//! Kurzlebiger, prozessweiter State-Store für die WebAuthn-Zeremonien (LFH-275): hält den
//! Zwischenzustand zwischen `…/start` und `…/finish`. Dasselbe Muster wie `oidc/state.rs`
//! (TTL, Einmal-Nutzung, [`BegrenzterAblaufSpeicher`] mit Obergrenze und gedrosseltem
//! Aufräumlauf, LFH-919), rein im Speicher. Ist er voll, antworten die Starts mit 503.
//!
//! **!Send-Disziplin:** `entnehme` gibt den std-`MutexGuard` frei, bevor der Aufrufer
//! `session::anlegen().await` ausführt; dieses Modul enthält kein `.await`. Ein Guard über
//! `.await` machte den axum-Handler `!Send`, und current-thread-Tests fangen das nicht ab.

use std::sync::{LazyLock, Mutex, MutexGuard};
use std::time::{Duration, Instant};

use webauthn_rs::prelude::{
    DiscoverableAuthentication, PasskeyAuthentication, PasskeyRegistration,
};

use crate::auth::ablauf_speicher::{BegrenzterAblaufSpeicher, Voll};

/// Lebensdauer eines Zeremonie-Eintrags. Abgelaufene Einträge liefert `entnehme` nicht mehr.
const TTL: Duration = Duration::from_secs(5 * 60);

/// Höchstzahl offener Zeremonien aller Arten zusammen; schützt nur den Speicher.
pub const OBERGRENZE: usize = 10_000;

/// Prozessweiter State-Store; kurzlebig, ohne Persistenzbedarf.
static STORE: LazyLock<Mutex<BegrenzterAblaufSpeicher<CeremonyZustand>>> =
    LazyLock::new(|| Mutex::new(neuer_speicher()));

fn neuer_speicher() -> BegrenzterAblaufSpeicher<CeremonyZustand> {
    BegrenzterAblaufSpeicher::neu(TTL, OBERGRENZE)
}

fn store() -> MutexGuard<'static, BegrenzterAblaufSpeicher<CeremonyZustand>> {
    STORE.lock().unwrap_or_else(|poison| poison.into_inner())
}

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
/// überschrieben. Bei [`OBERGRENZE`] offenen Zeremonien wird nicht eingefügt ([`Voll`]).
pub fn speichere(key: String, zustand: CeremonyZustand) -> Result<(), Voll> {
    store().einfuegen(key, zustand, Instant::now())
}

/// Entnimmt den Eintrag zu `key` **einmalig**; ein zweiter Aufruf liefert `None`, ebenso ein
/// unbekannter oder abgelaufener Key. Der Guard ist bei der Rückkehr freigegeben.
pub fn entnehme(key: &str) -> Option<CeremonyZustand> {
    store().entnehmen(key, Instant::now())
}

/// Test-Hook: lässt nur noch Platz für `platz` weitere Einträge (`None`: zurück auf die
/// [`OBERGRENZE`]), damit ein Integrationstest die Grenze mit wenigen Anfragen erreicht. Nicht
/// `cfg(test)`, kein Aufrufer im Produktcode; nur in einem eigenen Test-Binary aufrufen, der
/// Speicher ist prozessweit.
#[doc(hidden)]
pub fn platz_fuer_tests(platz: Option<usize>) {
    let mut store = store();
    let grenze = platz.map_or(OBERGRENZE, |p| store.len() + p);
    store.obergrenze_setzen(grenze);
}

/// Test-only: Eintrag mit vorgegebener Ablaufzeit, um einen abgelaufenen Eintrag ohne Warten zu
/// erzeugen.
#[cfg(test)]
fn speichere_mit_ablauf(key: String, zustand: CeremonyZustand, ablauf: Instant) {
    store().einfuegen_mit_ablauf(key, zustand, ablauf);
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
        speichere(key.clone(), CeremonyZustand::Registrierung(registrierung())).unwrap();

        let entnommen = entnehme(&key);

        assert!(matches!(entnommen, Some(CeremonyZustand::Registrierung(_))));
    }

    #[test]
    fn speichere_dann_entnehme_liefert_authentifizierung_zurueck() {
        let key = "auth-roundtrip".to_string();
        speichere(
            key.clone(),
            CeremonyZustand::Authentifizierung(authentifizierung()),
        )
        .unwrap();

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
        )
        .unwrap();

        let entnommen = entnehme(&key);

        assert!(matches!(
            entnommen,
            Some(CeremonyZustand::AuthentifizierungDiscoverable(_))
        ));
    }

    #[test]
    fn zweites_entnehme_desselben_keys_liefert_none() {
        let key = "ceremony-einmalig".to_string();
        speichere(key.clone(), CeremonyZustand::Registrierung(registrierung())).unwrap();

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

    /// Am eigenen Speicher statt am prozessweiten: der ist mit den übrigen Tests geteilt.
    #[test]
    fn die_zeremonie_ueber_der_obergrenze_wird_abgewiesen() {
        let mut s = neuer_speicher();
        let jetzt = Instant::now();
        let zustand = authentifizierung_discoverable();
        for n in 0..OBERGRENZE {
            s.einfuegen(
                format!("k{n}"),
                CeremonyZustand::AuthentifizierungDiscoverable(zustand.clone()),
                jetzt,
            )
            .unwrap();
        }
        let zuviel = s.einfuegen(
            "zuviel".into(),
            CeremonyZustand::AuthentifizierungDiscoverable(zustand),
            jetzt,
        );
        assert!(matches!(zuviel, Err(Voll)));
        assert_eq!(s.len(), OBERGRENZE);
    }
}
