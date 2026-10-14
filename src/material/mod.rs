pub mod disposition_repo;
pub mod repo;

use crate::wire_enum::wire_enum;
use serde::Serialize;
use utoipa::ToSchema;

// Geteilte Dienststatus-Konstanten (wie Fahrzeug/Personal) aus crate::katalog.
pub use crate::katalog::{DIENSTSTATUS_AUSSER_DIENST, DIENSTSTATUS_IN_DIENST};

/// Bezeichnung, Kategorie, Bestandsnummer und Trägerorganisation eines Ad-hoc-Postens, beim
/// Disponieren und beim Korrigieren (LLH-1093, Spec `material-liste`); die Bezeichnung gelangt
/// ins ETB. Wie `personal::ADHOC_TEXT_MAX`.
pub const ADHOC_TEXT_MAX: usize = 200;

/// Bemerkung zu einem Material-Posten im Einsatz (LLH-1093); wie `personal::BEMERKUNG_MAX`.
pub const BEMERKUNG_MAX: usize = 2_000;

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
    /// Demo-Herkunft (LFH-733): wahr, solange `demo_herkunft` die Zeile markiert. Live gelesen
    /// über `SPALTEN`, kein gespeichertes Flag.
    pub ist_demo: bool,
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
            ist_demo: self.ist_demo,
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
    /// Trägt die Zeile eine Demo-Marke (LFH-733, Spec `demo-daten`)? Live aus `demo_herkunft`.
    pub ist_demo: bool,
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
    /// Trägt der Stamm-Datensatz eine Demo-Marke (LFH-733, Spec `demo-daten`)? Live aus
    /// `demo_herkunft`, unabhängig von der Live-oder-Snapshot-Regel; Ad-hoc ist nie Demo.
    pub ist_demo: bool,
    /// Ende der Disposition (LLH-1079, Spec `kraefte-entlassung`); fehlt bei aktivem Material.
    /// Nur `GET …/material?entlassene=1` liefert beendete Zeilen, und zwar nur herausgenommene
    /// (`beendet_als = entlassen`; die Oberfläche sagt „aus dem Einsatz genommen“).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub beendet_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub beendet_von: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[schema(value_type = Option<crate::entlassung::BeendetAls>)]
    pub beendet_als: Option<String>,
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
            ist_demo: false,
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

/// System-ETB beim Herausnehmen aus dem Einsatz (LLH-1079, Wortlaut LLH-1093 Nr. 3: Material
/// wird nicht „entlassen“). Der Name der Einheit steht nur hier.
pub fn etb_text_aus_einsatz_genommen(
    bezeichnung: &str,
    menge: i64,
    einheit: Option<&str>,
) -> String {
    match einheit {
        Some(e) => {
            format!("Material «{bezeichnung}» (×{menge}, Einheit «{e}») aus dem Einsatz genommen")
        }
        None => format!("Material «{bezeichnung}» (×{menge}) aus dem Einsatz genommen"),
    }
}

/// System-ETB beim Stornieren einer Fehldisposition (LLH-1079, design.md D3).
pub fn etb_text_storniert(bezeichnung: &str, menge: i64) -> String {
    format!("Material «{bezeichnung}» (×{menge}) storniert (Fehldisposition)")
}

/// System-ETB beim erneuten Disponieren (LLH-1079, design.md D7).
pub fn etb_text_erneut_disponiert(bezeichnung: &str, menge: i64) -> String {
    format!("Material «{bezeichnung}» (×{menge}) erneut disponiert")
}

#[cfg(test)]
mod etb_text_tests {
    use super::*;

    #[test]
    fn aus_einsatz_genommen_storniert_erneut() {
        assert_eq!(
            etb_text_aus_einsatz_genommen("Sandsäcke", 250, Some("1. Zug")),
            "Material «Sandsäcke» (×250, Einheit «1. Zug») aus dem Einsatz genommen"
        );
        assert_eq!(
            etb_text_aus_einsatz_genommen("Sandsäcke", 250, None),
            "Material «Sandsäcke» (×250) aus dem Einsatz genommen"
        );
        assert_eq!(
            etb_text_storniert("Sandsäcke", 3),
            "Material «Sandsäcke» (×3) storniert (Fehldisposition)"
        );
        assert_eq!(
            etb_text_erneut_disponiert("Sandsäcke", 3),
            "Material «Sandsäcke» (×3) erneut disponiert"
        );
    }

    #[test]
    fn disponiert_mit_menge() {
        assert_eq!(
            etb_text_disponiert("Sandsäcke", 250),
            "Material «Sandsäcke» (×250) disponiert"
        );
    }
}
