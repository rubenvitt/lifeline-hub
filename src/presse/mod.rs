//! Presse- und Medienarbeit des Sachgebiets S5 (LFH-554), Zielkontext Stabsraum.
//!
//! Zwei Teile:
//! - **Presse-Log** ([`repo`]): Medienkontakte des Einsatzes, also Anfragen von Redaktionen,
//!   Abstimmungen mit anderen Pressestellen und Termine. Eine Anfrage wird mit der gegebenen
//!   Antwort beantwortet oder abgelehnt, Abstimmung und Termin werden erledigt; jeder Zielstatus
//!   lässt sich nach `offen` zurücknehmen. Wer eine Aussage freigegeben hat, steht als Freitext
//!   da (`freigabe_durch`), kein eigener Freigabe-Workflow je Anfrage (design.md D5).
//! - **Pressemitteilung** ([`mitteilung`]): dritte Art des Vorlagendokuments neben Lagebericht
//!   und Befehl. Freigeben darf nur die Einsatzleitung; das Gate sitzt an der Route.
//!
//! Die Routen liegen unter `/api/einsaetze/{id}/stab/…` und erben damit die Sperre des
//! Stab-Moduls (`PFAD_KEY`, Längster-Präfix). Ein Sachgebiet ist kein Modul (LFH-46).
//!
//! Spec: `openspec/changes/lfh-554-presse-medienarbeit-s5/`

use crate::wire_enum::wire_enum;
use serde::Serialize;
use utoipa::ToSchema;

pub mod mitteilung;
pub mod repo;

wire_enum! {
    /// Art eines Medienkontakts. Wire == `as_str()`.
    #[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]
    pub enum MedienkontaktArt {
        /// Anfrage einer Redaktion.
        Anfrage => "anfrage",
        /// Abstimmung mit einer Behörden- oder Organisations-Pressestelle.
        Abstimmung => "abstimmung",
        /// Pressekonferenz, Interview, Dreh vor Ort.
        Termin => "termin",
    }
}

wire_enum! {
    /// Status eines Medienkontakts. Wire == `as_str()`.
    #[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]
    pub enum MedienkontaktStatus {
        Offen => "offen",
        /// Nur Anfragen; trägt die gegebene Antwort.
        Beantwortet => "beantwortet",
        /// Nur Anfragen.
        Abgelehnt => "abgelehnt",
        /// Nur Abstimmungen und Termine.
        Erledigt => "erledigt",
    }
}

impl MedienkontaktArt {
    /// Die Zielstatus, die diese Art von `offen` aus erreichen darf (design.md D3; der CHECK in
    /// `0127_presse.sql` ist das Netz).
    pub fn erlaubte_ziele(self) -> &'static [MedienkontaktStatus] {
        match self {
            MedienkontaktArt::Anfrage => &[
                MedienkontaktStatus::Beantwortet,
                MedienkontaktStatus::Abgelehnt,
            ],
            MedienkontaktArt::Abstimmung | MedienkontaktArt::Termin => {
                &[MedienkontaktStatus::Erledigt]
            }
        }
    }
}

/// Öffentliche Darstellung eines Medienkontakts.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, ToSchema)]
pub struct MedienkontaktAnzeige {
    pub id: i64,
    pub einsatz_id: i64,
    pub art: MedienkontaktArt,
    pub medium: String,
    pub thema: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub kontakt_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub kontakt_erreichbarkeit: Option<String>,
    pub eingang_at: String,
    pub status: MedienkontaktStatus,
    /// Die gegebene Antwort. Bleibt bei einer Rücknahme nach `offen` stehen.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub antwort: Option<String>,
    /// Wer die Aussage freigegeben hat (Freitext, etwa „EL mündlich 14:20“).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub freigabe_durch: Option<String>,
    /// Freigegebene Pressemitteilung desselben Einsatzes, auf die die Antwort verweist.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pressemitteilung_id: Option<i64>,
    /// Wer den Status zuletzt gesetzt hat, und wann.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bearbeitet_von_id: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bearbeitet_von_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bearbeitet_at: Option<String>,
    pub angelegt_von_id: i64,
    pub angelegt_at: String,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn art_bestimmt_die_ziele() {
        use MedienkontaktStatus::*;
        assert_eq!(
            MedienkontaktArt::Anfrage.erlaubte_ziele(),
            &[Beantwortet, Abgelehnt]
        );
        assert_eq!(MedienkontaktArt::Termin.erlaubte_ziele(), &[Erledigt]);
        assert_eq!(MedienkontaktArt::Abstimmung.erlaubte_ziele(), &[Erledigt]);
    }

    #[test]
    fn enums_parse_rund() {
        for a in MedienkontaktArt::ALLE {
            assert_eq!(MedienkontaktArt::parse(a.as_str()), Some(a));
        }
        for s in MedienkontaktStatus::ALLE {
            assert_eq!(MedienkontaktStatus::parse(s.as_str()), Some(s));
        }
        assert_eq!(MedienkontaktArt::parse("leserbrief"), None);
    }
}
