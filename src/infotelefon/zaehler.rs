//! Zählung der Anrufe am Informationstelefon, gesamt, offen und je Anliegen (LLH-732).
//!
//! Die Zählung folgt DEMSELBEN Filter wie die Liste (`repo::filter_bedingung`): Kennzahlen und
//! Medienlage zählen den ganzen Bestand, nie die geladene Seite (Muster ETB-Zähler, LFH-612).

use super::{InfotelefonAnliegen, InfotelefonStatus};
use crate::error::AppError;
use serde::Serialize;
use utoipa::ToSchema;

/// Zahl der Anrufe je Anliegen. Jedes Anliegen ist Pflichtfeld: eines ohne Anruf steht als 0 da
/// und fehlt nie.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, ToSchema)]
pub struct InfotelefonAnliegenZaehler {
    pub vermisstensuche: i64,
    pub auskunft_lage: i64,
    pub hinweis: i64,
    pub hilfeangebot: i64,
    pub beschwerde: i64,
    pub presse: i64,
    pub sonstiges: i64,
}

/// Antwort von `GET /api/einsaetze/{id}/stab/infotelefon/zaehler`.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, ToSchema)]
pub struct InfotelefonZaehler {
    /// Zahl aller Anrufe, die zum Filter passen; per Konstruktion die Summe über `je_anliegen`.
    pub gesamt: i64,
    /// Davon im Status `offen` (Rückruf steht aus).
    pub offen: i64,
    pub je_anliegen: InfotelefonAnliegenZaehler,
}

impl InfotelefonZaehler {
    /// Baut die Antwort aus den Rohzeilen `(anliegen, status, anzahl)`.
    ///
    /// Ein vollständiger `match` über [`InfotelefonAnliegen`]: ein neues Anliegen bricht den
    /// Build. Ein unbekannter Wert (den der CHECK ausschließt) ist ein 500, kein stilles
    /// Weglassen — eine zu kleine Zahl wäre der schlimmere Fehler.
    pub fn aus_zeilen(zeilen: &[(String, String, i64)]) -> Result<Self, AppError> {
        let mut z = Self::default();
        for (anliegen, status, anzahl) in zeilen {
            let je = &mut z.je_anliegen;
            let feld = match InfotelefonAnliegen::parse(anliegen) {
                Some(InfotelefonAnliegen::Vermisstensuche) => &mut je.vermisstensuche,
                Some(InfotelefonAnliegen::AuskunftLage) => &mut je.auskunft_lage,
                Some(InfotelefonAnliegen::Hinweis) => &mut je.hinweis,
                Some(InfotelefonAnliegen::Hilfeangebot) => &mut je.hilfeangebot,
                Some(InfotelefonAnliegen::Beschwerde) => &mut je.beschwerde,
                Some(InfotelefonAnliegen::Presse) => &mut je.presse,
                Some(InfotelefonAnliegen::Sonstiges) => &mut je.sonstiges,
                None => {
                    return Err(AppError::Internal(format!(
                        "Unbekanntes Anliegen in der Datenbank: {anliegen}"
                    )))
                }
            };
            *feld += anzahl;
            match InfotelefonStatus::parse(status) {
                Some(InfotelefonStatus::Offen) => z.offen += anzahl,
                Some(InfotelefonStatus::Erledigt) => {}
                None => {
                    return Err(AppError::Internal(format!(
                        "Unbekannter Status in der Datenbank: {status}"
                    )))
                }
            }
            z.gesamt += anzahl;
        }
        Ok(z)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn zeile(anliegen: &str, status: &str, n: i64) -> (String, String, i64) {
        (anliegen.into(), status.into(), n)
    }

    #[test]
    fn zeilen_werden_je_anliegen_zugeordnet_und_summiert() {
        let z = InfotelefonZaehler::aus_zeilen(&[
            zeile("auskunft_lage", "erledigt", 2),
            zeile("auskunft_lage", "offen", 1),
            zeile("hinweis", "erledigt", 1),
        ])
        .unwrap();
        assert_eq!(z.gesamt, 4);
        assert_eq!(z.offen, 1);
        assert_eq!(
            z.je_anliegen,
            InfotelefonAnliegenZaehler {
                auskunft_lage: 3,
                hinweis: 1,
                ..Default::default()
            }
        );
    }

    #[test]
    fn leere_gruppierung_ist_null_ueberall() {
        assert_eq!(
            InfotelefonZaehler::aus_zeilen(&[]).unwrap(),
            InfotelefonZaehler::default()
        );
    }

    #[test]
    fn jedes_anliegen_hat_sein_feld() {
        let zeilen: Vec<_> = InfotelefonAnliegen::ALLE
            .iter()
            .map(|a| zeile(a.as_str(), "erledigt", 1))
            .collect();
        let z = InfotelefonZaehler::aus_zeilen(&zeilen).unwrap();
        assert_eq!(z.gesamt, 7);
        let je = serde_json::to_value(&z.je_anliegen).unwrap();
        for a in InfotelefonAnliegen::ALLE {
            assert_eq!(
                je[a.as_str()],
                1,
                "Feld {} heißt wie der Wire-Wert",
                a.as_str()
            );
        }
    }

    #[test]
    fn unbekannte_werte_sind_500() {
        for z in [
            zeile("spende", "erledigt", 1),
            zeile("hinweis", "verschollen", 1),
        ] {
            assert!(matches!(
                InfotelefonZaehler::aus_zeilen(&[z]),
                Err(AppError::Internal(_))
            ));
        }
    }
}
