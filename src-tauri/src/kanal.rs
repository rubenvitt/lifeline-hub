//! Update-Kanal der Hülle (LLH-1280, LLH-1545): `<app_config_dir>/kanal.json` mit
//! `{ "kanal": "alpha" }` oder `{ "kanal": "beta" }`.
//!
//! Eine Vorabversion bestimmt den Kanal selbst: `…-beta.N` liest den Beta-Kanal, jede andere
//! Vorabversion den Alpha-Kanal. Wer eine Vorabversion des anderen Kanals installiert, wechselt
//! damit. Eine Hülle, die einmal als Vorabversion lief, bleibt in ihrem Kanal, auch nachdem sie
//! ein stabiles Release aus dem Kanal installiert hat (beide Kanäle führen stabile Releases mit,
//! SemVer ordnet `1.0.0` nach `1.0.0-alpha.N` und `1.0.0-beta.N`). Ohne gemerkten Kanal verlöre
//! sie mit dem ersten stabilen Update die Vorabversionen. Eine stabil installierte Hülle, die nie
//! eine Vorabversion war, bleibt im stabilen Kanal. Zurück zu „stabil“: Datei löschen und eine
//! stabile Version installieren.
//!
//! Eine fehlende, unlesbare oder unbekannte Datei heißt „nichts gemerkt“ — dann entscheidet die
//! installierte Version, wie beim ersten Start.

use std::fs;
use std::io;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

pub const DATEINAME: &str = "kanal.json";

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Kanal {
    Stabil,
    Alpha,
    Beta,
}

#[derive(Serialize, Deserialize)]
struct Datei {
    kanal: Kanal,
}

/// Vorabkennung nach SemVer (der Teil nach dem ersten `-` vor einem `+`), sonst `None`.
fn vorabkennung(version: &str) -> Option<&str> {
    let ohne_build = version.split('+').next().unwrap_or(version);
    ohne_build.split_once('-').map(|(_, vorab)| vorab)
}

/// Der Kanal für die installierte `version`: eine Vorabversion bestimmt ihn selbst (`beta…` →
/// Beta, sonst Alpha), eine stabile behält den gemerkten.
pub fn bestimmen(version: &str, gemerkt: Option<Kanal>) -> Kanal {
    match vorabkennung(version) {
        Some(vorab) if vorab.split('.').next() == Some("beta") => Kanal::Beta,
        Some(_) => Kanal::Alpha,
        None => gemerkt.unwrap_or(Kanal::Stabil),
    }
}

pub fn pfad(konfig_dir: &Path) -> PathBuf {
    konfig_dir.join(DATEINAME)
}

/// Der gemerkte Kanal — oder `None`.
pub fn lesen(konfig_dir: &Path) -> Option<Kanal> {
    let inhalt = fs::read_to_string(pfad(konfig_dir)).ok()?;
    let datei: Datei = serde_json::from_str(&inhalt).ok()?;
    Some(datei.kanal)
}

/// Merkt den Kanal; legt das Verzeichnis bei Bedarf an.
pub fn schreiben(konfig_dir: &Path, kanal: Kanal) -> io::Result<()> {
    fs::create_dir_all(konfig_dir)?;
    fs::write(
        pfad(konfig_dir),
        serde_json::to_vec_pretty(&Datei { kanal })?,
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn vorabversion_bestimmt_den_kanal() {
        assert_eq!(bestimmen("1.0.0-alpha.130", None), Kanal::Alpha);
        assert_eq!(bestimmen("1.1.0-beta.2+abc", None), Kanal::Beta);
        assert_eq!(bestimmen("1.0.0-beta.1", None), Kanal::Beta);
        // Eine andere Vorabkennung bleibt beim Alpha-Kanal wie vor LLH-1545.
        assert_eq!(bestimmen("1.0.0-rc.1", None), Kanal::Alpha);
        // „betaX“ ist nicht „beta“.
        assert_eq!(bestimmen("1.0.0-betax.1", None), Kanal::Alpha);
    }

    #[test]
    fn installierte_vorabversion_wechselt_den_gemerkten_kanal() {
        assert_eq!(bestimmen("1.0.0-beta.1", Some(Kanal::Alpha)), Kanal::Beta);
        assert_eq!(
            bestimmen("1.0.0-alpha.181", Some(Kanal::Beta)),
            Kanal::Alpha
        );
        assert_eq!(bestimmen("1.0.0-beta.1", Some(Kanal::Stabil)), Kanal::Beta);
    }

    #[test]
    fn stabile_version_ohne_gemerkten_kanal_ist_stabil() {
        assert_eq!(bestimmen("1.0.0", None), Kanal::Stabil);
        assert_eq!(bestimmen("1.0.0", Some(Kanal::Stabil)), Kanal::Stabil);
        // Bindestrich nur in den Build-Metadaten: keine Vorabversion.
        assert_eq!(bestimmen("1.0.0+build-7", None), Kanal::Stabil);
    }

    #[test]
    fn gemerkter_vorabkanal_bleibt_nach_stabilem_update() {
        assert_eq!(bestimmen("1.0.0", Some(Kanal::Alpha)), Kanal::Alpha);
        assert_eq!(bestimmen("1.0.0", Some(Kanal::Beta)), Kanal::Beta);
    }

    #[test]
    fn geschrieben_wird_wieder_gelesen() {
        let dir = tempfile::tempdir().unwrap();
        let unter = dir.path().join("neu/tiefer");
        schreiben(&unter, Kanal::Alpha).unwrap();
        assert_eq!(lesen(&unter), Some(Kanal::Alpha));
        assert!(fs::read_to_string(pfad(&unter))
            .unwrap()
            .contains(r#""kanal": "alpha""#));
        schreiben(&unter, Kanal::Beta).unwrap();
        assert_eq!(lesen(&unter), Some(Kanal::Beta));
        assert!(fs::read_to_string(pfad(&unter))
            .unwrap()
            .contains(r#""kanal": "beta""#));
    }

    #[test]
    fn fehlende_kaputte_oder_unbekannte_datei_ist_nichts_gemerkt() {
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(lesen(dir.path()), None);
        fs::write(pfad(dir.path()), "{ kein json").unwrap();
        assert_eq!(lesen(dir.path()), None);
        fs::write(pfad(dir.path()), r#"{ "kanal": "gamma" }"#).unwrap();
        assert_eq!(lesen(dir.path()), None);
    }
}
