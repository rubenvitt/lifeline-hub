//! Prüfung der Serveradresse (desktop-huelle: „Die Hülle lädt nur eine https-Serveradresse“).
//!
//! Nur `https` mit Hostnamen: Service Worker, Cache Storage und WebAuthn setzen einen Secure
//! Context voraus. Dieselbe Prüfung gilt für die Erststart-Maske und den Deeplink — die Maske
//! hat keine eigene Prüflogik in JS, sie zeigt die Meldung von hier.

use std::fmt;

use url::Url;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AdressFehler {
    Leer,
    Unlesbar,
    KeinHttps,
    OhneHost,
    MitZugangsdaten,
}

impl fmt::Display for AdressFehler {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(match self {
            AdressFehler::Leer => "Bitte die Adresse des Einsatzservers eingeben.",
            AdressFehler::Unlesbar => {
                "Das ist keine gültige Adresse. Beispiel: https://elw.local:8443"
            }
            AdressFehler::KeinHttps => {
                "Nur https-Adressen sind möglich: Offline-Betrieb und Passkey brauchen eine gesicherte Verbindung."
            }
            AdressFehler::OhneHost => "Der Adresse fehlt der Hostname, z. B. elw.local.",
            AdressFehler::MitZugangsdaten => {
                "Die Adresse darf keinen Namen und kein Passwort vor „@“ enthalten."
            }
        })
    }
}

/// Liest eine eingegebene Adresse. Leerraum an den Rändern wird ignoriert.
pub fn pruefe_adresse(eingabe: &str) -> Result<Url, AdressFehler> {
    let eingabe = eingabe.trim();
    if eingabe.is_empty() {
        return Err(AdressFehler::Leer);
    }
    let url = Url::parse(eingabe).map_err(|fehler| match fehler {
        url::ParseError::EmptyHost => AdressFehler::OhneHost,
        _ => AdressFehler::Unlesbar,
    })?;
    if url.scheme() != "https" {
        return Err(AdressFehler::KeinHttps);
    }
    // Der URL-Standard „repariert“ `https:///einsatz` still zu Host `einsatz`. Wer drei
    // Schrägstriche tippt, hat den Hostnamen vergessen — nicht `einsatz` gemeint.
    let nach_schema = &eingabe[eingabe.find(':').map_or(0, |i| i + 1)..];
    if nach_schema.starts_with("///") || url.host_str().is_none_or(str::is_empty) {
        return Err(AdressFehler::OhneHost);
    }
    // `https://elw.local:8443@evil.example` hat den Host `evil.example` — im Bestätigungsdialog
    // läse sich der vorn stehende Name wie der vertraute Server.
    if !url.username().is_empty() || url.password().is_some() {
        return Err(AdressFehler::MitZugangsdaten);
    }
    Ok(url)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn https_mit_host_und_port_ist_gueltig() {
        let url = pruefe_adresse("https://elw.local:8443").unwrap();
        assert_eq!(url.as_str(), "https://elw.local:8443/");
    }

    #[test]
    fn leerraum_wird_getrimmt() {
        let url = pruefe_adresse("  https://elw.local:8443 \n").unwrap();
        assert_eq!(url.host_str(), Some("elw.local"));
    }

    #[test]
    fn http_wird_mit_verweis_auf_https_abgelehnt() {
        let fehler = pruefe_adresse("http://elw.local:8080").unwrap_err();
        assert_eq!(fehler, AdressFehler::KeinHttps);
        assert!(fehler.to_string().contains("https"));
    }

    #[test]
    fn andere_schemata_werden_abgelehnt() {
        assert_eq!(
            pruefe_adresse("file:///etc/passwd"),
            Err(AdressFehler::KeinHttps)
        );
        assert_eq!(
            pruefe_adresse("lifeline://verbinden"),
            Err(AdressFehler::KeinHttps)
        );
    }

    #[test]
    fn https_ohne_hostname_nennt_den_hostnamen() {
        for eingabe in ["https://", "https:///einsatz"] {
            let fehler = pruefe_adresse(eingabe).unwrap_err();
            assert!(
                matches!(fehler, AdressFehler::OhneHost),
                "{eingabe}: {fehler:?}"
            );
            assert!(fehler.to_string().contains("Hostname"));
        }
    }

    #[test]
    fn zugangsdaten_in_der_adresse_werden_abgelehnt() {
        // `elw.local` ist hier Benutzername, der Host ist `evil.example` — im Bestätigungsdialog
        // läse sich das wie der vertraute Server.
        for eingabe in [
            "https://elw.local:8443@evil.example",
            "https://nutzer@elw.local:8443",
        ] {
            let fehler = pruefe_adresse(eingabe).unwrap_err();
            assert_eq!(fehler, AdressFehler::MitZugangsdaten, "{eingabe}");
            assert!(fehler.to_string().contains("@"));
        }
    }

    #[test]
    fn leere_eingabe_und_unsinn() {
        assert_eq!(pruefe_adresse("   "), Err(AdressFehler::Leer));
        assert_eq!(pruefe_adresse("elw.local"), Err(AdressFehler::Unlesbar));
    }
}
