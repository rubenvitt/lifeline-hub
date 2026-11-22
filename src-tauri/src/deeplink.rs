//! Deeplink `lifeline://verbinden?server=<https-Adresse>` (Vertrag für LFH-38 „Geräte verbinden“).
//!
//! Zwei reine Schritte: `deute` liest den Link, `entscheide` legt fest, was er gegenüber der
//! gespeicherten Adresse bewirken darf. Ein Link darf nie still auf einen anderen Server umlenken
//! (desktop-huelle: „Ein Serverwechsel per Deeplink wird bestätigt“) — sonst könnte jede Webseite
//! die Hülle auf einen fremden Server lenken, der die Anmeldung abgreift.

use url::Url;

use crate::adresse::pruefe_adresse;

/// Schema, das die Hülle registriert (`tauri.conf.json`, `plugins.deep-link`).
pub const SCHEMA: &str = "lifeline";

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Aktion {
    /// Keine Adresse gespeichert: die Erststart-Maske zeigt die Adresse, verbunden wird erst
    /// mit „Verbinden“.
    Vorbelegen(Url),
    /// Andere Adresse als die gespeicherte: erst nach Bestätigung umschalten.
    Bestaetigen(Url),
    /// Gleiche Adresse: nichts zu tun.
    Nichts,
}

/// Liest einen Deeplink. `None` für alles außer `lifeline://verbinden?server=<gültige Adresse>`.
pub fn deute(link: &Url) -> Option<Url> {
    // `lifeline://verbinden?…`: bei einem Nicht-Standard-Schema ist `verbinden` der Host.
    if link.scheme() != SCHEMA || link.host_str() != Some("verbinden") {
        return None;
    }
    if !matches!(link.path(), "" | "/") {
        return None;
    }
    let (_, ziel) = link
        .query_pairs()
        .find(|(schluessel, _)| schluessel == "server")?;
    pruefe_adresse(&ziel).ok()
}

/// Was ein gültiger Deeplink gegenüber der gespeicherten Adresse bewirkt.
pub fn entscheide(gespeichert: Option<&Url>, neu: &Url) -> Aktion {
    match gespeichert {
        None => Aktion::Vorbelegen(neu.clone()),
        Some(alt) if alt == neu => Aktion::Nichts,
        Some(_) => Aktion::Bestaetigen(neu.clone()),
    }
}

#[cfg(test)]
mod tests {
    use serde::Deserialize;

    use super::*;

    /// Gemeinsame Fälle beider Hüllen (`src-tauri/AGENTS.md`, „Gemeinsame Fälle“): dieselbe
    /// Datei prüft der Swift-Kern der iOS-Hülle (`ios/LifelineKern`).
    const FAELLE: &str = include_str!("../faelle/deeplink.json");

    #[derive(Deserialize)]
    #[serde(deny_unknown_fields)]
    struct Datei {
        #[allow(dead_code)]
        zweck: String,
        deute: Vec<DeuteFall>,
        entscheide: Vec<EntscheideFall>,
        /// Fälle für `Linkregeln.sichererPfad` der iOS-Hülle (Pfad aus einer Push-Meldung);
        /// die Desktop-Hülle hat keinen Push und liest den Abschnitt nicht.
        #[allow(dead_code)]
        push_pfad: serde::de::IgnoredAny,
    }

    #[derive(Deserialize)]
    #[serde(deny_unknown_fields)]
    struct DeuteFall {
        beschreibung: String,
        link: String,
        ziel: Option<String>,
    }

    #[derive(Deserialize)]
    #[serde(deny_unknown_fields)]
    struct EntscheideFall {
        beschreibung: String,
        gespeichert: Option<String>,
        neu: String,
        aktion: String,
    }

    fn url(s: &str) -> Url {
        Url::parse(s).unwrap()
    }

    fn datei() -> Datei {
        serde_json::from_str(FAELLE).expect("faelle/deeplink.json ist lesbar")
    }

    #[test]
    fn jeder_gemeinsame_fall_von_deute_gilt() {
        let faelle = datei().deute;
        assert!(faelle.len() >= 10, "nur {} Fälle gelesen", faelle.len());
        for fall in faelle {
            assert_eq!(
                deute(&url(&fall.link)).as_ref().map(Url::as_str),
                fall.ziel.as_deref(),
                "{}",
                fall.beschreibung
            );
        }
    }

    #[test]
    fn jeder_gemeinsame_fall_von_entscheide_gilt() {
        let faelle = datei().entscheide;
        assert!(faelle.len() >= 5, "nur {} Fälle gelesen", faelle.len());
        for fall in faelle {
            let neu = url(&fall.neu);
            let gespeichert = fall.gespeichert.as_deref().map(url);
            let soll = match fall.aktion.as_str() {
                "vorbelegen" => Aktion::Vorbelegen(neu.clone()),
                "bestaetigen" => Aktion::Bestaetigen(neu.clone()),
                "nichts" => Aktion::Nichts,
                andere => panic!("{}: unbekannte Aktion {andere}", fall.beschreibung),
            };
            assert_eq!(
                entscheide(gespeichert.as_ref(), &neu),
                soll,
                "{}",
                fall.beschreibung
            );
        }
    }
}
