//! Informationstelefon (Bürgertelefon) des Sachgebiets S5 (LFH-554): ein Protokoll der Anrufe
//! aus der Bevölkerung mit Anliegen, Notiz und Rückrufbedarf.
//!
//! Ein Anruf mit Rückrufbedarf beginnt `offen` und braucht eine Rückrufnummer, jeder andere
//! beginnt `erledigt`. Ein offener Rückruf wird erledigt und lässt sich wieder öffnen. Gelöscht
//! wird nichts. Name, Rückrufnummer und Notiz sind personenbezogen (Schwärzungs-Registry) und
//! fehlen in jeder Ableitung (Medienlage, Lagebericht).
//!
//! Die Routen liegen unter `/api/einsaetze/{id}/stab/infotelefon` und erben die Stab-Sperre.
//!
//! Spec: `openspec/changes/archive/2026-09-30-lfh-554-presse-medienarbeit-s5/specs/stab-infotelefon/`

use crate::wire_enum::wire_enum;
use serde::Serialize;
use utoipa::ToSchema;

pub mod repo;

wire_enum! {
    /// Anliegen eines Anrufs. Wire == `as_str()`.
    #[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]
    pub enum InfotelefonAnliegen {
        /// Angehörige suchen eine Person; die Personenauskunft ist ein eigener Weg.
        Vermisstensuche => "vermisstensuche",
        AuskunftLage => "auskunft_lage",
        /// Ein Hinweis aus der Bevölkerung zur Lage.
        Hinweis => "hinweis",
        Hilfeangebot => "hilfeangebot",
        Beschwerde => "beschwerde",
        /// Eine Presseanfrage, die am Bürgertelefon ankam.
        Presse => "presse",
        Sonstiges => "sonstiges",
    }
}

wire_enum! {
    /// Status eines Anrufs. Wire == `as_str()`.
    #[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]
    pub enum InfotelefonStatus {
        /// Ein Rückruf steht aus.
        Offen => "offen",
        Erledigt => "erledigt",
    }
}

/// Öffentliche Darstellung eines Anrufs.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, ToSchema)]
pub struct InfotelefonAnrufAnzeige {
    pub id: i64,
    pub einsatz_id: i64,
    pub anliegen: InfotelefonAnliegen,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub notiz: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub anrufer_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rueckruf: Option<String>,
    pub status: InfotelefonStatus,
    pub eingang_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub erledigt_von_id: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub erledigt_von_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub erledigt_at: Option<String>,
    pub angelegt_von_id: i64,
    pub angelegt_at: String,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn enums_parse_rund() {
        for a in InfotelefonAnliegen::ALLE {
            assert_eq!(InfotelefonAnliegen::parse(a.as_str()), Some(a));
        }
        for s in InfotelefonStatus::ALLE {
            assert_eq!(InfotelefonStatus::parse(s.as_str()), Some(s));
        }
        assert_eq!(InfotelefonAnliegen::ALLE.len(), 7);
        assert_eq!(InfotelefonAnliegen::parse("spende"), None);
    }
}
