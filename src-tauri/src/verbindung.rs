//! Gespeicherte Serveradresse: `<app_config_dir>/verbindung.json` mit `{ "server": "…" }`.
//!
//! Eine fehlende, unlesbare oder ungültige Datei heißt „keine Adresse“ — die Hülle zeigt dann
//! die Erststart-Maske, statt an einer kaputten Datei zu scheitern. Beim Lesen wird dieselbe
//! Prüfung angelegt wie bei der Eingabe: eine von Hand auf `http` geänderte Datei lädt nicht.

use std::fs;
use std::io;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use url::Url;

use crate::adresse::pruefe_adresse;

pub const DATEINAME: &str = "verbindung.json";

#[derive(Serialize, Deserialize)]
struct Datei {
    server: String,
}

pub fn pfad(konfig_dir: &Path) -> PathBuf {
    konfig_dir.join(DATEINAME)
}

/// Die gespeicherte, gültige Adresse — oder `None`.
pub fn lesen(konfig_dir: &Path) -> Option<Url> {
    let inhalt = fs::read_to_string(pfad(konfig_dir)).ok()?;
    let datei: Datei = serde_json::from_str(&inhalt).ok()?;
    pruefe_adresse(&datei.server).ok()
}

/// Speichert die Adresse; legt das Verzeichnis bei Bedarf an.
pub fn schreiben(konfig_dir: &Path, server: &Url) -> io::Result<()> {
    fs::create_dir_all(konfig_dir)?;
    let datei = Datei {
        server: server.to_string(),
    };
    fs::write(pfad(konfig_dir), serde_json::to_vec_pretty(&datei)?)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn geschrieben_wird_wieder_gelesen() {
        let dir = tempfile::tempdir().unwrap();
        let unter = dir.path().join("neu/tiefer");
        let url = Url::parse("https://elw.local:8443").unwrap();
        schreiben(&unter, &url).unwrap();
        assert_eq!(lesen(&unter), Some(url));
    }

    #[test]
    fn fehlende_datei_ist_keine_adresse() {
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(lesen(dir.path()), None);
    }

    #[test]
    fn kaputte_datei_ist_keine_adresse() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(pfad(dir.path()), "{ kein json").unwrap();
        assert_eq!(lesen(dir.path()), None);
    }

    #[test]
    fn von_hand_auf_http_geaendert_ist_keine_adresse() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(pfad(dir.path()), r#"{ "server": "http://elw.local:8080" }"#).unwrap();
        assert_eq!(lesen(dir.path()), None);
    }
}
