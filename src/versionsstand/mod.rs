//! Versionsstand der Instanz (Spec `versionsstand`, Change neuigkeiten-versionshinweise).
//!
//! Der Server schreibt beim Start seine Version in eine Zeile je Instanz und erkennt daraus einen
//! Versionswechsel. `gelesen_bis` bleibt dabei unberührt, damit ein ungelesener Hinweis bestehen
//! bleibt. Die Übergänge stehen hier als reine Funktionen, die Persistenz in [`repo`].

pub mod repo;

use serde::Serialize;
use utoipa::ToSchema;

/// Die Antwort von `GET /api/versionsstand` und `POST /api/versionsstand/gelesen`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, ToSchema)]
pub struct VersionsstandAnzeige {
    /// Die laufende Version des Servers.
    pub laufend: String,
    /// Die Version davor, nur wenn ein Versionswechsel stattfand.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub zuletzt_gestartet: Option<String>,
    /// Die Version, bis zu der die Neuigkeiten als gelesen gelten.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub gelesen_bis: Option<String>,
}

impl From<Versionsstand> for VersionsstandAnzeige {
    fn from(s: Versionsstand) -> Self {
        Self {
            laufend: s.laufend,
            zuletzt_gestartet: s.zuletzt_gestartet,
            gelesen_bis: s.gelesen_bis,
        }
    }
}

/// Der gespeicherte Stand einer Instanz.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Versionsstand {
    /// Die Version, die der Server zuletzt gestartet hat.
    pub laufend: String,
    /// Die Version davor, sobald ein Wechsel stattfand.
    pub zuletzt_gestartet: Option<String>,
    /// Die Version, bis zu der die Neuigkeiten als gelesen gelten.
    pub gelesen_bis: Option<String>,
}

/// Der Stand nach einem Start mit `laufend`.
///
/// Ohne Zeile legt der erste Start den Stand an und markiert die laufende Version als gelesen:
/// eine frische Instanz bekommt keinen Hinweis. Gleiche Version lässt alles stehen. Eine andere
/// Version schiebt die bisherige nach `zuletzt_gestartet`, und `gelesen_bis` bleibt.
pub fn nach_start(bisher: Option<&Versionsstand>, laufend: &str) -> Versionsstand {
    match bisher {
        None => Versionsstand {
            laufend: laufend.to_owned(),
            zuletzt_gestartet: None,
            gelesen_bis: Some(laufend.to_owned()),
        },
        Some(stand) if stand.laufend == laufend => stand.clone(),
        Some(stand) => Versionsstand {
            laufend: laufend.to_owned(),
            zuletzt_gestartet: Some(stand.laufend.clone()),
            gelesen_bis: stand.gelesen_bis.clone(),
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn stand(laufend: &str, zuletzt: Option<&str>, gelesen: Option<&str>) -> Versionsstand {
        Versionsstand {
            laufend: laufend.into(),
            zuletzt_gestartet: zuletzt.map(Into::into),
            gelesen_bis: gelesen.map(Into::into),
        }
    }

    #[test]
    fn erster_start_markiert_die_laufende_version_als_gelesen() {
        assert_eq!(
            nach_start(None, "1.0.0-alpha.106"),
            stand("1.0.0-alpha.106", None, Some("1.0.0-alpha.106"))
        );
    }

    #[test]
    fn gleiche_version_nach_neustart_aendert_nichts() {
        let bisher = stand(
            "1.0.0-alpha.106",
            Some("1.0.0-alpha.100"),
            Some("1.0.0-alpha.100"),
        );
        assert_eq!(nach_start(Some(&bisher), "1.0.0-alpha.106"), bisher);
    }

    #[test]
    fn update_schiebt_die_alte_version_und_laesst_den_lesestand() {
        let bisher = stand("1.0.0-alpha.100", None, Some("1.0.0-alpha.100"));
        assert_eq!(
            nach_start(Some(&bisher), "1.0.0-alpha.106"),
            stand(
                "1.0.0-alpha.106",
                Some("1.0.0-alpha.100"),
                Some("1.0.0-alpha.100")
            )
        );
    }

    #[test]
    fn wechsel_in_den_stabilen_kanal_zaehlt_als_versionswechsel() {
        let bisher = stand("1.0.0-alpha.106", None, Some("1.0.0-alpha.106"));
        assert_eq!(
            nach_start(Some(&bisher), "1.0.0"),
            stand("1.0.0", Some("1.0.0-alpha.106"), Some("1.0.0-alpha.106"))
        );
    }
}
