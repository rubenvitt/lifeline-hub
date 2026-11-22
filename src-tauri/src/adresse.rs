//! Prüfung der Serveradresse (desktop-huelle: „Die Hülle lädt nur eine https-Serveradresse“).
//!
//! Nur `https` mit Hostnamen: Service Worker, Cache Storage und WebAuthn setzen einen Secure
//! Context voraus. Dieselbe Prüfung gilt für die Erststart-Maske und den Deeplink — die Maske
//! hat keine eigene Prüflogik in JS, sie zeigt die Meldung von hier.
//!
//! Ports, die der Webview sperrt, lehnt sie ebenfalls ab (LLH-1987): WebKit lädt dorthin nichts
//! und meldet keinen Ladefehler, das Fenster bliebe leer.

use std::fmt;

use url::Url;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AdressFehler {
    Leer,
    Unlesbar,
    KeinHttps,
    OhneHost,
    MitZugangsdaten,
    GesperrterPort,
}

/// Ports, auf die WebKit nicht navigiert (`Source/WTF/wtf/URL.cpp`, `portAllowed`): die „bad
/// ports“ der Fetch-Spezifikation und Port 0. WebView2 (Chromium) und WebKitGTK sperren dieselben.
/// Aufsteigend sortiert; die gemeinsamen Fälle (`faelle/adresse.json`, `gesperrte_ports`) tragen
/// dieselbe Liste für die iOS-Hülle.
pub const GESPERRTE_PORTS: [u16; 83] = [
    0, 1, 7, 9, 11, 13, 15, 17, 19, 20, 21, 22, 23, 25, 37, 42, 43, 53, 69, 77, 79, 87, 95, 101, 102,
    103, 104, 109, 110, 111, 113, 115, 117, 119, 123, 135, 137, 139, 143, 161, 179, 389, 427, 465,
    512, 513, 514, 515, 526, 530, 531, 532, 540, 548, 554, 556, 563, 587, 601, 636, 989, 990, 993,
    995, 1719, 1720, 1723, 2049, 3659, 4045, 4190, 5060, 5061, 6000, 6566, 6665, 6666, 6667, 6668,
    6669, 6679, 6697, 10080,
];

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
            AdressFehler::GesperrterPort => {
                "Diesen Port sperrt der Webview. Bitte den Server auf einem anderen Port betreiben, z. B. 8443."
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
    // Der Standardport 443 fehlt in `port()`, er ist nie gesperrt.
    if url
        .port()
        .is_some_and(|port| GESPERRTE_PORTS.binary_search(&port).is_ok())
    {
        return Err(AdressFehler::GesperrterPort);
    }
    Ok(url)
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeMap;

    use serde::Deserialize;

    use super::*;

    /// Gemeinsame Fälle beider Hüllen (`src-tauri/AGENTS.md`, „Gemeinsame Fälle“): dieselbe
    /// Datei prüft der Swift-Kern der iOS-Hülle (`ios/LifelineKern`).
    const FAELLE: &str = include_str!("../faelle/adresse.json");

    #[derive(Deserialize)]
    #[serde(deny_unknown_fields)]
    struct Datei {
        #[allow(dead_code)]
        zweck: String,
        meldungen: BTreeMap<String, String>,
        #[allow(dead_code)]
        gesperrte_ports_quelle: String,
        gesperrte_ports: Vec<u16>,
        faelle: Vec<Fall>,
    }

    #[derive(Deserialize)]
    #[serde(deny_unknown_fields)]
    struct Fall {
        beschreibung: String,
        eingabe: String,
        #[serde(default)]
        adresse: Option<String>,
        #[serde(default)]
        fehler: Option<String>,
    }

    const ALLE_FEHLER: [AdressFehler; 6] = [
        AdressFehler::Leer,
        AdressFehler::Unlesbar,
        AdressFehler::KeinHttps,
        AdressFehler::OhneHost,
        AdressFehler::MitZugangsdaten,
        AdressFehler::GesperrterPort,
    ];

    /// Kennwort eines Fehlers in den gemeinsamen Fällen.
    fn kennwort(fehler: &AdressFehler) -> &'static str {
        match fehler {
            AdressFehler::Leer => "leer",
            AdressFehler::Unlesbar => "unlesbar",
            AdressFehler::KeinHttps => "kein_https",
            AdressFehler::OhneHost => "ohne_host",
            AdressFehler::MitZugangsdaten => "mit_zugangsdaten",
            AdressFehler::GesperrterPort => "gesperrter_port",
        }
    }

    fn datei() -> Datei {
        serde_json::from_str(FAELLE).expect("faelle/adresse.json ist lesbar")
    }

    #[test]
    fn jeder_gemeinsame_fall_gilt() {
        let faelle = datei().faelle;
        assert!(faelle.len() >= 16, "nur {} Fälle gelesen", faelle.len());
        for fall in faelle {
            let ist = pruefe_adresse(&fall.eingabe);
            match (&fall.adresse, &fall.fehler) {
                (Some(adresse), None) => assert_eq!(
                    ist.as_ref().map(Url::as_str),
                    Ok(adresse.as_str()),
                    "{}",
                    fall.beschreibung
                ),
                (None, Some(fehler)) => assert_eq!(
                    ist.as_ref().map_err(kennwort).map(Url::as_str),
                    Err(fehler.as_str()),
                    "{}",
                    fall.beschreibung
                ),
                _ => panic!(
                    "{}: genau eins von „adresse“ und „fehler“",
                    fall.beschreibung
                ),
            }
        }
    }

    /// Die iOS-Hülle zeigt dieselben Texte; die Fälle tragen sie, damit beide dagegen prüfen.
    #[test]
    fn meldungen_stehen_wortgleich_in_den_faellen() {
        let meldungen = datei().meldungen;
        assert_eq!(meldungen.len(), ALLE_FEHLER.len(), "{:?}", meldungen.keys());
        for fehler in ALLE_FEHLER {
            assert_eq!(
                meldungen.get(kennwort(&fehler)).map(String::as_str),
                Some(fehler.to_string().as_str()),
                "{fehler:?}"
            );
        }
    }

    #[test]
    fn jeder_fehler_hat_einen_fall() {
        let faelle = datei().faelle;
        for fehler in ALLE_FEHLER {
            assert!(
                faelle
                    .iter()
                    .any(|fall| fall.fehler.as_deref() == Some(kennwort(&fehler))),
                "kein Fall für {fehler:?}"
            );
        }
    }

    /// Die iOS-Hülle prüft gegen die Liste der gemeinsamen Fälle; `binary_search` braucht sie
    /// aufsteigend.
    #[test]
    fn gesperrte_ports_gleichen_den_faellen_und_sind_sortiert() {
        assert_eq!(datei().gesperrte_ports, GESPERRTE_PORTS.to_vec());
        assert!(GESPERRTE_PORTS.windows(2).all(|paar| paar[0] < paar[1]));
    }

    #[test]
    fn jeder_gesperrte_port_wird_abgelehnt() {
        for port in GESPERRTE_PORTS {
            assert_eq!(
                pruefe_adresse(&format!("https://elw.local:{port}")),
                Err(AdressFehler::GesperrterPort),
                "Port {port}"
            );
        }
    }
}
