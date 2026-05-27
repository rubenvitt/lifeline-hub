pub mod disposition_repo;
pub mod repo;

use serde::Serialize;

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
        }
    }
}

/// Öffentliche Material-Darstellung (ohne `org_id`).
#[derive(Debug, Clone, Serialize)]
pub struct MaterialAnzeige {
    pub id: i64,
    pub bezeichnung: String,
    pub kategorie: Option<String>,
    pub bestandsnummer: Option<String>,
    pub traegerorganisation: Option<String>,
    pub standort: Option<String>,
    pub bemerkung: Option<String>,
    pub dienststatus: String,
    pub angelegt_at: String,
}

/// Fester Status einer Material-Dispositionszeile (kein admin-pflegbarer Katalog).
/// Als TEXT in der DB gespeichert; manuell konvertiert (analog `StaerkePosition`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub enum MaterialStatus {
    Einsatzbereit,
    ImEinsatz,
    Defekt,
    Verbraucht,
    DesinfektionNoetig,
}

impl MaterialStatus {
    /// DB-/API-Stringrepräsentation. **Muss exakt dem CHECK-Constraint in
    /// `migrations/0019_einsatz_material.sql` entsprechen.**
    pub fn as_str(&self) -> &'static str {
        match self {
            MaterialStatus::Einsatzbereit => "einsatzbereit",
            MaterialStatus::ImEinsatz => "im_einsatz",
            MaterialStatus::Defekt => "defekt",
            MaterialStatus::Verbraucht => "verbraucht",
            MaterialStatus::DesinfektionNoetig => "desinfektion_noetig",
        }
    }

    /// Parst einen Statusstring; `None` bei ungültigem Wert.
    pub fn parse(s: &str) -> Option<MaterialStatus> {
        match s {
            "einsatzbereit" => Some(MaterialStatus::Einsatzbereit),
            "im_einsatz" => Some(MaterialStatus::ImEinsatz),
            "defekt" => Some(MaterialStatus::Defekt),
            "verbraucht" => Some(MaterialStatus::Verbraucht),
            "desinfektion_noetig" => Some(MaterialStatus::DesinfektionNoetig),
            _ => None,
        }
    }
}

/// Aufgelöste Material-Dispositionszeile: Identität nach der Auflösungsregel
/// (Live aus dem Stamm bei aktivem Einsatz + Material in Dienst, sonst Snapshot);
/// `menge` und `status` kommen **immer** aus der Dispositionszeile.
#[derive(Debug, Clone, Serialize)]
pub struct EinsatzMaterialAnzeige {
    pub id: i64,
    pub einsatz_id: i64,
    /// `None` = Ad-hoc-externes Material (kein Stamm-Bezug).
    pub material_id: Option<i64>,
    /// Zugeordnete Einheit; `None` = freie, nicht zugeordnete Position.
    pub einheit_id: Option<i64>,
    pub ist_adhoc: bool,
    pub bezeichnung: String,
    pub kategorie: Option<String>,
    pub bestandsnummer: Option<String>,
    pub traegerorganisation: Option<String>,
    pub menge: i64,
    pub status: String,
    pub bemerkung: Option<String>,
    pub disponiert_at: String,
    pub disponiert_von: Option<i64>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn status_roundtrip() {
        for s in ["einsatzbereit", "im_einsatz", "defekt", "verbraucht", "desinfektion_noetig"] {
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
        };
        let a = m.anzeige();
        assert_eq!(a.id, 7);
        assert_eq!(a.bezeichnung, "Wolldecke");
        assert_eq!(a.dienststatus, "in_dienst");
    }
}
