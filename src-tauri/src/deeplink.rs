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
    use super::*;

    fn url(s: &str) -> Url {
        Url::parse(s).unwrap()
    }

    #[test]
    fn verbinden_mit_server_wird_gelesen() {
        let ziel = deute(&url("lifeline://verbinden?server=https://elw.local:8443")).unwrap();
        assert_eq!(ziel, url("https://elw.local:8443"));
    }

    #[test]
    fn prozentkodierte_adresse_wird_gelesen() {
        let ziel = deute(&url(
            "lifeline://verbinden?server=https%3A%2F%2Felw.local%3A8443%2F",
        ))
        .unwrap();
        assert_eq!(ziel, url("https://elw.local:8443/"));
    }

    #[test]
    fn verbinden_mit_abschliessendem_schraegstrich_im_pfad() {
        assert!(deute(&url("lifeline://verbinden/?server=https://elw.local")).is_some());
    }

    #[test]
    fn fremder_pfad_wird_verworfen() {
        assert_eq!(
            deute(&url("lifeline://trennen?server=https://elw.local:8443")),
            None
        );
        assert_eq!(
            deute(&url("lifeline://verbinden/mehr?server=https://elw.local")),
            None
        );
    }

    /// Den Rücksprung der Anmeldung nimmt nur die laufende `ASWebAuthenticationSession` an
    /// (LFH-818). Von außen bewirkt er über den globalen Weg nichts.
    #[test]
    fn anmeldung_von_aussen_bewirkt_nichts() {
        let code = "0123456789abcdef".repeat(4);
        assert_eq!(
            deute(&url(&format!("lifeline://anmeldung?code={code}"))),
            None
        );
    }

    #[test]
    fn fremdes_schema_wird_verworfen() {
        assert_eq!(
            deute(&url("https://verbinden?server=https://elw.local")),
            None
        );
    }

    #[test]
    fn fehlendes_oder_ungueltiges_ziel_wird_verworfen() {
        assert_eq!(deute(&url("lifeline://verbinden")), None);
        assert_eq!(deute(&url("lifeline://verbinden?server=")), None);
        assert_eq!(
            deute(&url("lifeline://verbinden?server=http://elw.local")),
            None
        );
    }

    #[test]
    fn ohne_gespeicherte_adresse_wird_vorbelegt() {
        let neu = url("https://elw.local:8443");
        assert_eq!(entscheide(None, &neu), Aktion::Vorbelegen(neu.clone()));
    }

    #[test]
    fn abweichende_adresse_braucht_bestaetigung() {
        let alt = url("https://elw.local:8443");
        let neu = url("https://fremd.example");
        assert_eq!(
            entscheide(Some(&alt), &neu),
            Aktion::Bestaetigen(neu.clone())
        );
    }

    #[test]
    fn anderer_port_ist_eine_andere_adresse() {
        let alt = url("https://elw.local:8443");
        let neu = url("https://elw.local:9443");
        assert_eq!(
            entscheide(Some(&alt), &neu),
            Aktion::Bestaetigen(neu.clone())
        );
    }

    #[test]
    fn gleiche_adresse_bewirkt_nichts() {
        let alt = url("https://elw.local:8443");
        assert_eq!(
            entscheide(Some(&alt), &url("https://elw.local:8443/")),
            Aktion::Nichts
        );
        assert_eq!(
            entscheide(Some(&alt), &url("https://ELW.local:8443")),
            Aktion::Nichts
        );
    }
}
