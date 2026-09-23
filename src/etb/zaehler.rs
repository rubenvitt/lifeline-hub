//! Exakte ETB-Zählung eines Einsatzes, gesamt und je Typ (LFH-612, Neuentwurf S4: ETB-Kopf
//! „412 Einträge" und Bilanz-Leiste).
//!
//! Die Zählung folgt DEMSELBEN Filter wie die Liste (`repo::filter_bedingung`) — der Kopf
//! zeigt „n Treffer", und n muss genau die Menge sein, die die Liste seitenweise liefert.

use super::EtbTyp;
use crate::error::AppError;
use serde::Serialize;
use utoipa::ToSchema;

/// Zahl der Einträge je Eintragstyp. Jeder Typ ist Pflichtfeld: ein Typ ohne Einträge
/// steht als 0 da und fehlt nie — sonst hieße ein fehlendes Feld zweierlei.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, ToSchema)]
pub struct EtbTypZaehler {
    pub meldung: i64,
    pub anordnung: i64,
    pub lage: i64,
    pub entscheidung: i64,
    pub system: i64,
    pub berichtigung: i64,
}

/// Antwort von `GET /api/einsaetze/{id}/etb/zaehler`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, ToSchema)]
pub struct EtbZaehlerAnzeige {
    /// Zahl aller Einträge, die zum Filter passen (ohne Filter: das ganze Tagebuch).
    /// Per Konstruktion die Summe über `je_typ`.
    pub gesamt: i64,
    pub je_typ: EtbTypZaehler,
}

impl EtbZaehlerAnzeige {
    /// Baut die Antwort aus den Rohzeilen `(typ, anzahl)` der Gruppierung.
    ///
    /// Die Zuordnung ist ein vollständiger `match` über [`EtbTyp`]: eine neue Variante bricht
    /// den Build, statt still aus der Bilanz zu fallen. Ein Typstring, den `parse` nicht
    /// kennt, schließt der CHECK aus `0004_etb.sql` aus — trifft er trotzdem ein, ist das
    /// ein 500 und kein stilles Weglassen: eine Gesamtzahl, die kleiner ist als der
    /// Bestand, wäre der schlimmere Fehler.
    pub fn aus_zeilen(zeilen: &[(String, i64)]) -> Result<Self, AppError> {
        let mut je_typ = EtbTypZaehler::default();
        for (typ, anzahl) in zeilen {
            let feld = match EtbTyp::parse(typ) {
                Some(EtbTyp::Meldung) => &mut je_typ.meldung,
                Some(EtbTyp::Anordnung) => &mut je_typ.anordnung,
                Some(EtbTyp::Lage) => &mut je_typ.lage,
                Some(EtbTyp::Entscheidung) => &mut je_typ.entscheidung,
                Some(EtbTyp::System) => &mut je_typ.system,
                Some(EtbTyp::Berichtigung) => &mut je_typ.berichtigung,
                None => {
                    return Err(AppError::Internal(format!(
                        "Unbekannter ETB-Typ in der Datenbank: {typ}"
                    )))
                }
            };
            *feld += anzahl;
        }
        let gesamt = zeilen.iter().map(|(_, n)| n).sum();
        Ok(Self { gesamt, je_typ })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn zeilen_werden_je_typ_zugeordnet_und_summiert() {
        let z = EtbZaehlerAnzeige::aus_zeilen(&[
            ("meldung".into(), 3),
            ("anordnung".into(), 1),
            ("system".into(), 1),
        ])
        .unwrap();
        assert_eq!(z.gesamt, 5);
        assert_eq!(
            z.je_typ,
            EtbTypZaehler {
                meldung: 3,
                anordnung: 1,
                system: 1,
                ..Default::default()
            }
        );
    }

    #[test]
    fn leere_gruppierung_ist_null_ueberall() {
        let z = EtbZaehlerAnzeige::aus_zeilen(&[]).unwrap();
        assert_eq!(z.gesamt, 0);
        assert_eq!(z.je_typ, EtbTypZaehler::default());
    }

    #[test]
    fn unbekannter_typ_ist_fehler_statt_stiller_luecke() {
        assert!(EtbZaehlerAnzeige::aus_zeilen(&[("unsinn".into(), 2)]).is_err());
    }
}
