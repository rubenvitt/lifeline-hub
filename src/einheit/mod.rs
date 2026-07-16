pub mod mitglied_repo;
pub mod repo;
pub mod typ_repo;

use crate::sprechgruppe::SprechgruppeAnzeige;
use crate::staerke::Staerke;
use serde::Serialize;
use utoipa::ToSchema;

/// Default-Einheitstyp-Katalog je neu angelegter Organisation
/// (label, soll_fuehrer, soll_unterfuehrer, soll_mannschaft, sortier).
/// **Muss mit dem Seed in `migrations/0015_einheit_typ.sql` übereinstimmen.**
/// `None`-Soll = "alle drei leer" (z. B. Sonstige).
pub const EINHEIT_TYP_STARTLISTE: [(&str, Option<i64>, Option<i64>, Option<i64>, i64); 5] = [
    ("Trupp", Some(0), Some(0), Some(2), 10),
    ("Staffel", Some(0), Some(1), Some(5), 20),
    ("Gruppe", Some(0), Some(1), Some(8), 30),
    ("Zug", Some(1), Some(3), Some(18), 40),
    ("Sonstige", None, None, None, 50),
];

/// Einheitstyp-Katalog-Eintrag (org-weit), inkl. aufgelöster optionaler Soll-Stärke.
/// `aktiv` wird nicht serialisiert (Listen-Endpunkt liefert ohnehin nur aktive).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, ToSchema)]
pub struct EinheitTyp {
    pub id: i64,
    pub label: String,
    /// Standard-Soll-Stärke; `None`, wenn der Typ keine Soll-Stärke definiert.
    pub soll: Option<Staerke>,
    pub sortier: i64,
}

/// Personal-Mitglied einer Einheit (leichtgewichtig für die Einheiten-Anzeige).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, ToSchema)]
pub struct EinheitMitgliedPerson {
    /// `einsatz_personal.id` der Dispozeile.
    pub ep_id: i64,
    pub name: String,
    pub funktion: Option<String>,
    #[schema(value_type = Option<crate::staerke::StaerkePosition>)]
    pub staerke_position: Option<String>,
    /// `true`, wenn diese Person als Führer der Einheit eingetragen ist.
    pub ist_fuehrer: bool,
}

/// Fahrzeug-Mitglied einer Einheit (leichtgewichtig).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, ToSchema)]
pub struct EinheitMitgliedFahrzeug {
    /// `einsatz_fahrzeug.id` der Dispozeile.
    pub ef_id: i64,
    pub funkrufname: String,
    pub fahrzeugtyp: Option<String>,
}

/// Material-Mitglied einer Einheit (leichtgewichtig).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, ToSchema)]
pub struct EinheitMitgliedMaterial {
    /// `einsatz_material.id` der Dispozeile.
    pub em_id: i64,
    pub bezeichnung: String,
    pub menge: i64,
    /// Festes Status-Enum als String (z. B. "einsatzbereit").
    pub status: crate::material::MaterialStatus,
}

/// Aufgelöste Einheiten-Anzeige inkl. Typ/Abschnitt-Labels, Führer-Identität,
/// Mitgliedern und berechneter Stärke. `soll` ist optional (Override → Typ-Default →
/// `None`); `ist`/`ist_kumuliert` sind immer gesetzt.
#[derive(Debug, Clone, PartialEq, Serialize, ToSchema)]
pub struct EinheitAnzeige {
    pub id: i64,
    pub einsatz_id: i64,
    pub abschnitt_id: Option<i64>,
    pub abschnitt_name: Option<String>,
    pub ueber_einheit_id: Option<i64>,
    pub typ_id: Option<i64>,
    pub typ_label: Option<String>,
    pub name: String,
    pub fuehrer_id: Option<i64>,
    pub fuehrer_name: Option<String>,
    pub bemerkung: Option<String>,
    /// Funk/Kommunikation (LFH-108): Freitext-Schlüssel (digitalfunk/mobil/festnetz).
    pub kommunikationsmittel: Option<String>,
    /// Funk/Kommunikation (LFH-108): Rufnummer/Freitext (PII → schwaerze_einsatz).
    pub erreichbarkeit: Option<String>,
    pub sortier: i64,
    pub lat: Option<f64>,
    pub lon: Option<f64>,
    pub tz_fachaufgabe: Option<String>,
    pub tz_organisation: Option<String>,
    /// BR‑1: aktuell bereitgestellter Bereitstellungsraum (NULL = in keinem BR).
    pub aktueller_br_id: Option<i64>,
    pub soll: Option<crate::staerke::Staerke>,
    pub ist: crate::staerke::Staerke,
    pub ist_kumuliert: crate::staerke::Staerke,
    pub personal_mitglieder: Vec<EinheitMitgliedPerson>,
    pub fahrzeug_mitglieder: Vec<EinheitMitgliedFahrzeug>,
    pub material_mitglieder: Vec<EinheitMitgliedMaterial>,
    pub sprechgruppen: Vec<SprechgruppeAnzeige>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn startliste_konsistent() {
        assert_eq!(EINHEIT_TYP_STARTLISTE.len(), 5);
        // Jeder Eintrag hat alle drei Soll-Werte gesetzt ODER alle drei leer.
        for (_, f, u, m, _) in EINHEIT_TYP_STARTLISTE {
            let alle = f.is_some() && u.is_some() && m.is_some();
            let keiner = f.is_none() && u.is_none() && m.is_none();
            assert!(alle || keiner, "Soll muss vollständig oder leer sein");
        }
    }
}
