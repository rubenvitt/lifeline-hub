//! Kennung der ausgehenden HTTP-Abrufe (LLH-1547, Risiko R14).
//!
//! Jeder Abruf des Servers nach draußen (Geocoder, Fachebenen, Kartenproxy, Kartendownload,
//! karten-service, OIDC, Web Push, Instanzkopplung) nennt sich im `User-Agent` mit Zweck, Softwarestand und
//! Projektadresse, auf Wunsch mit dem Kontakt des Betreibers:
//!
//! `LifelineHub-Geocoder/1.0.0-alpha.182 (+https://github.com/rubenvitt/lifeline-hub; betrieb@example.org)`
//!
//! Die Nutzungsregeln des öffentlichen Nominatim verlangen eine Kennung, über die jemand
//! erreichbar ist. Ohne Kontakt teilen sich alle Installationen dieselbe Kennung; fragt eine zu
//! viel, trifft eine Sperre alle. Darum gibt es `--betreiber-kontakt`.
//!
//! Clients entstehen nur über [`client_builder`]; `tests/ausgehend_kennung_guard.rs` lehnt
//! `reqwest::Client::builder()` und jedes eigene `.user_agent(…)` an anderer Stelle ab.

use std::sync::OnceLock;

/// Adresse des Projekts, über die ein Dienstbetreiber die Software und ihre Entwickler findet.
pub const PROJEKT_ADRESSE: &str = "https://github.com/rubenvitt/lifeline-hub";

/// Höchstlänge des Betreiberkontakts (Zeichen).
pub const KONTAKT_MAX: usize = 200;

static BETREIBER_KONTAKT: OnceLock<String> = OnceLock::new();

/// Zweck eines ausgehenden Abrufs; steht vor dem Schrägstrich der Kennung.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Zweck {
    /// Ortssuche und Rückwärtssuche (Nominatim oder eigene `geocoder_url`).
    Geocoder,
    /// Fachebenen der Lagekarte (Pegel, Wetter, ODL, Warnungen).
    Lagekarte,
    /// Kachel- und Stil-Proxy der Lagekarte.
    Kartenproxy,
    /// Download von Offline-Karten, Adressindex und Katalog.
    Kartendownload,
    /// Bauauftrag an den zentralen karten-service.
    KartenService,
    /// Discovery und Token-Tausch bei der Anmeldung über OIDC.
    Oidc,
    /// Versand an die Push-Dienste der Browser.
    WebPush,
    /// Koppeln und Melden zwischen Lifeline-Hub-Instanzen.
    Instanzkopplung,
}

impl Zweck {
    /// Der Name vor dem Schrägstrich der Kennung.
    fn name(self) -> &'static str {
        match self {
            Zweck::Geocoder => "Geocoder",
            Zweck::Lagekarte => "Lagekarte",
            Zweck::Kartenproxy => "Kartenproxy",
            Zweck::Kartendownload => "Kartendownload",
            Zweck::KartenService => "KartenService",
            Zweck::Oidc => "OIDC",
            Zweck::WebPush => "WebPush",
            Zweck::Instanzkopplung => "Instanzkopplung",
        }
    }
}

/// Prüft den Betreiberkontakt (`--betreiber-kontakt`): getrimmt nicht leer, höchstens
/// [`KONTAKT_MAX`] Zeichen, nur sichtbares ASCII und Leerzeichen, ohne Klammern und Semikolon
/// (sie gliedern den Kommentar der Kennung). Liefert den getrimmten Kontakt.
pub fn kontakt_pruefen(kontakt: &str) -> Result<String, String> {
    let kontakt = kontakt.trim();
    if kontakt.is_empty() {
        return Err("--betreiber-kontakt ist leer".into());
    }
    if kontakt.chars().count() > KONTAKT_MAX {
        return Err(format!(
            "--betreiber-kontakt darf höchstens {KONTAKT_MAX} Zeichen lang sein"
        ));
    }
    if let Some(c) = kontakt
        .chars()
        .find(|c| !(c.is_ascii_graphic() || *c == ' ') || matches!(c, '(' | ')' | ';'))
    {
        return Err(format!(
            "--betreiber-kontakt enthält das unzulässige Zeichen {c:?} (erlaubt: ASCII ohne \
             Klammern und Semikolon, z. B. betrieb@example.org oder https://…)"
        ));
    }
    Ok(kontakt.to_owned())
}

/// Setzt den Betreiberkontakt einmal beim Start, bevor der erste Client entsteht.
pub fn set_betreiber_kontakt(kontakt: Option<String>) {
    if let Some(kontakt) = kontakt {
        let _ = BETREIBER_KONTAKT.set(kontakt);
    }
}

/// Der beim Start gesetzte Betreiberkontakt.
pub fn betreiber_kontakt() -> Option<&'static str> {
    BETREIBER_KONTAKT.get().map(String::as_str)
}

/// Die Kennung für `zweck` mit dem prozessweiten Betreiberkontakt.
pub fn user_agent(zweck: Zweck) -> String {
    kennung(zweck, betreiber_kontakt())
}

/// Baut die Kennung aus Zweck, Softwarestand, Projektadresse und optionalem Kontakt.
fn kennung(zweck: Zweck, kontakt: Option<&str>) -> String {
    let version = env!("CARGO_PKG_VERSION");
    let name = zweck.name();
    match kontakt {
        Some(k) => format!("LifelineHub-{name}/{version} (+{PROJEKT_ADRESSE}; {k})"),
        None => format!("LifelineHub-{name}/{version} (+{PROJEKT_ADRESSE})"),
    }
}

/// Einziger Einstieg für HTTP-Clients des Servers: ein `reqwest::ClientBuilder` mit der Kennung
/// für `zweck`. Zeitlimits, Redirect-Politik und Resolver setzt der Aufrufer wie bisher.
pub fn client_builder(zweck: Zweck) -> reqwest::ClientBuilder {
    reqwest::Client::builder().user_agent(user_agent(zweck))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn kennung_nennt_zweck_version_und_adresse() {
        let ua = kennung(Zweck::Geocoder, None);
        assert_eq!(
            ua,
            format!(
                "LifelineHub-Geocoder/{} (+https://github.com/rubenvitt/lifeline-hub)",
                env!("CARGO_PKG_VERSION")
            )
        );
        assert!(!ua.contains("/1.0 "), "{ua}");
    }

    #[test]
    fn kennung_mit_kontakt() {
        let ua = kennung(Zweck::Lagekarte, Some("betrieb@example.org"));
        assert!(
            ua.ends_with("(+https://github.com/rubenvitt/lifeline-hub; betrieb@example.org)"),
            "{ua}"
        );
        assert!(ua.starts_with("LifelineHub-Lagekarte/"), "{ua}");
    }

    #[test]
    fn jede_kennung_ist_ein_gueltiger_header() {
        for zweck in [
            Zweck::Geocoder,
            Zweck::Lagekarte,
            Zweck::Kartenproxy,
            Zweck::Kartendownload,
            Zweck::KartenService,
            Zweck::Oidc,
            Zweck::WebPush,
            Zweck::Instanzkopplung,
        ] {
            for kontakt in [None, Some("https://drk.example.org/kontakt")] {
                let ua = kennung(zweck, kontakt);
                assert!(reqwest::header::HeaderValue::from_str(&ua).is_ok(), "{ua}");
            }
        }
    }

    #[test]
    fn kontakt_pruefen_trimmt_und_lehnt_ab() {
        assert_eq!(
            kontakt_pruefen("  betrieb@example.org ").as_deref(),
            Ok("betrieb@example.org")
        );
        assert_eq!(
            kontakt_pruefen("https://drk.example.org/kontakt").as_deref(),
            Ok("https://drk.example.org/kontakt")
        );
        assert_eq!(
            kontakt_pruefen("DRK Nord, betrieb@example.org").as_deref(),
            Ok("DRK Nord, betrieb@example.org")
        );
        for falsch in [
            "",
            "   ",
            "a)b",
            "a(b",
            "a;b",
            "zeile\numbruch",
            "tab\tzeichen",
            "betrieb@exämple.org",
        ] {
            assert!(kontakt_pruefen(falsch).is_err(), "{falsch:?}");
        }
        assert!(kontakt_pruefen(&"x".repeat(KONTAKT_MAX)).is_ok());
        assert!(kontakt_pruefen(&"x".repeat(KONTAKT_MAX + 1)).is_err());
    }
}
