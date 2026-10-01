pub mod disposition_repo;
pub mod repo;

use crate::wire_enum::wire_enum;
use serde::Serialize;
use utoipa::ToSchema;

// Geteilte Dienststatus-Konstanten (wie Fahrzeug/Personal) aus crate::katalog.
pub use crate::katalog::{DIENSTSTATUS_AUSSER_DIENST, DIENSTSTATUS_IN_DIENST};

/// Interner Material-Stamm-Datensatz (alle Spalten von `material`).
#[derive(Debug, Clone, sqlx::FromRow)]
pub struct Material {
    pub id: i64,
    pub org_id: i64,
    pub bezeichnung: String,
    pub kategorie: Option<String>,
    pub bestandsnummer: Option<String>,
    pub traegerorganisation: Option<String>,
    pub standort: Option<String>,
    pub bemerkung: Option<String>,
    pub dienststatus: String,
    pub angelegt_at: String,
    /// Trägt eine Herkunftsmarke des Demo-Imports (LFH-733), abgeleitet beim Lesen.
    pub demo: bool,
}

impl Material {
    /// Serialisierbare Anzeige (ohne `org_id`).
    pub fn anzeige(&self) -> MaterialAnzeige {
        MaterialAnzeige {
            id: self.id,
            bezeichnung: self.bezeichnung.clone(),
            kategorie: self.kategorie.clone(),
            bestandsnummer: self.bestandsnummer.clone(),
            traegerorganisation: self.traegerorganisation.clone(),
            standort: self.standort.clone(),
            bemerkung: self.bemerkung.clone(),
            dienststatus: self.dienststatus.clone(),
            angelegt_at: self.angelegt_at.clone(),
            demo: self.demo,
        }
    }
}

/// Öffentliche Material-Darstellung (ohne `org_id`).
#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct MaterialAnzeige {
    pub id: i64,
    pub bezeichnung: String,
    pub kategorie: Option<String>,
    pub bestandsnummer: Option<String>,
    pub traegerorganisation: Option<String>,
    pub standort: Option<String>,
    pub bemerkung: Option<String>,
    #[schema(value_type = crate::katalog::Dienststatus)]
    pub dienststatus: String,
    pub angelegt_at: String,
    /// `true`, solange der Demo-Import die Zeile angelegt hat und sie markiert ist (LFH-733).
    pub demo: bool,
}

wire_enum! {
    /// Fester Status einer Material-Dispositionszeile (kein admin-pflegbarer Katalog).
    /// Als TEXT in der DB gespeichert; manuell konvertiert (analog `StaerkePosition`).
    #[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]
    pub enum MaterialStatus {
        Einsatzbereit => "einsatzbereit",
        ImEinsatz => "im_einsatz",
        Defekt => "defekt",
        Verbraucht => "verbraucht",
        DesinfektionNoetig => "desinfektion_noetig",
    }
    try_from = |s| format!("Ungültiger MaterialStatus: {s}");
}

// Non-null, manuell gemappt (`disposition_repo::zu_anzeige` aus dem internen `Row`) —
// TryFrom<String> für `#[sqlx(try_from = "String")]` auf dem internen FromRow-Struct
// (analog `LageZoneTyp` in `src/lage_zone/repo.rs`).

/// Aufgelöste Material-Dispositionszeile: Identität nach der Auflösungsregel
/// (Live aus dem Stamm bei aktivem Einsatz + Material in Dienst, sonst Snapshot);
/// `menge` und `status` kommen **immer** aus der Dispositionszeile.
#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct EinsatzMaterialAnzeige {
    pub id: i64,
    pub einsatz_id: i64,
    /// `None` = Ad-hoc-externes Material (kein Stamm-Bezug).
    pub material_id: Option<i64>,
    /// Zugeordnete Einheit; `None` = freie, nicht zugeordnete Position.
    pub einheit_id: Option<i64>,
    /// Zugeordnete Unfallhilfsstelle; `None` = nicht einer UHS zugeordnet.
    pub uhs_id: Option<i64>,
    pub ist_adhoc: bool,
    pub bezeichnung: String,
    pub kategorie: Option<String>,
    pub bestandsnummer: Option<String>,
    pub traegerorganisation: Option<String>,
    pub menge: i64,
    pub status: MaterialStatus,
    pub bemerkung: Option<String>,
    pub disponiert_at: String,
    pub disponiert_von: Option<i64>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn status_roundtrip() {
        for s in [
            "einsatzbereit",
            "im_einsatz",
            "defekt",
            "verbraucht",
            "desinfektion_noetig",
        ] {
            assert_eq!(MaterialStatus::parse(s).unwrap().as_str(), s);
        }
        assert!(MaterialStatus::parse("unsinn").is_none());
    }

    #[test]
    fn anzeige_ohne_org_id() {
        let m = Material {
            id: 7,
            org_id: 1,
            bezeichnung: "Wolldecke".into(),
            kategorie: Some("Betreuung".into()),
            bestandsnummer: None,
            traegerorganisation: None,
            standort: None,
            bemerkung: None,
            dienststatus: DIENSTSTATUS_IN_DIENST.into(),
            angelegt_at: "2026-05-27 10:00:00".into(),
            demo: false,
        };
        let a = m.anzeige();
        assert_eq!(a.id, 7);
        assert_eq!(a.bezeichnung, "Wolldecke");
        assert_eq!(a.dienststatus, "in_dienst");
    }
}

// ── System-ETB-Wortlaute (LFH-690) ──────────────────────────────────────────────────
// Reine Textbausteine: Handler und Demo-Import rufen dieselbe Funktion, damit ein
// importierter Einsatz dieselben ETB-Texte trägt wie ein echter.

/// System-ETB beim Disponieren von Material (Stamm oder Ad-hoc), mit Menge.
pub fn etb_text_disponiert(bezeichnung: &str, menge: i64) -> String {
    format!("Material «{}» (×{}) disponiert", bezeichnung, menge)
}

#[cfg(test)]
mod etb_text_tests {
    use super::*;

    #[test]
    fn disponiert_mit_menge() {
        assert_eq!(
            etb_text_disponiert("Sandsäcke", 250),
            "Material «Sandsäcke» (×250) disponiert"
        );
    }
}
