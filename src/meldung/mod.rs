//! Meldungen (eingehend) (LFH-54): Bottom-up-Strang des Führungsvorgangs
//! (digitaler Meldekopf). Strukturierte Erfassung (Nachrichtenvordruck),
//! linearer Triage-Status, ETB-Kopplung. Baut auf dem Kommunikations-Unterbau
//! (`MeldeWeg`-Vokabular, LFH-84) und spiegelt das Aufträge-Template (LFH-52).
pub mod repo;

use serde::Serialize;
use utoipa::ToSchema;

/// Meldeweg-Vokabular: Single Source of Truth bleibt das ETB-Modul (über den
/// Kommunikations-Unterbau re-exportiert), keine Eigendefinition.
pub use crate::kommunikation::MeldeWeg;
use crate::kommunikation::{Prioritaet, Richtung};

/// Priorität/Dringlichkeit (TEXT in der DB, im Code validiert).
pub const PRIO_SOFORT: &str = "sofort";
pub const PRIO_DRINGEND: &str = "dringend";
pub const PRIO_NORMAL: &str = "normal";

/// Default-Bestätigungsfrist (Minuten ab Eingang) für bestätigungspflichtige
/// Sofortmeldungen (LFH-97), wenn der Absetzer kein Override angibt.
pub const BESTAETIGUNG_FRIST_DEFAULT_MIN: i64 = 5;

/// Meldungsart (Nachrichtenvordruck-Klassifikation).
pub const ART_LAGEMELDUNG: &str = "lagemeldung";
pub const ART_SOFORTMELDUNG: &str = "sofortmeldung";
pub const ART_RUECKMELDUNG: &str = "rueckmeldung";
pub const ART_VOLLZUGSMELDUNG: &str = "vollzugsmeldung";
pub const ART_ANFRAGE: &str = "anfrage";
pub const ART_SONSTIGE: &str = "sonstige";

/// Triage-Status einer Meldung (Schema-Anker für die OpenAPI-Union, LFH-120). Wire == `status`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum MeldungStatus {
    Neu,
    Gesichtet,
    InBearbeitung,
    Erledigt,
}

impl MeldungStatus {
    /// DB-/API-Stringrepräsentation.
    pub fn as_str(&self) -> &'static str {
        match self {
            MeldungStatus::Neu => STATUS_NEU,
            MeldungStatus::Gesichtet => STATUS_GESICHTET,
            MeldungStatus::InBearbeitung => STATUS_IN_BEARBEITUNG,
            MeldungStatus::Erledigt => STATUS_ERLEDIGT,
        }
    }

    /// Parst einen gespeicherten/übergebenen Triage-Status; `None` bei ungültigem Wert.
    pub fn parse(s: &str) -> Option<MeldungStatus> {
        match s {
            STATUS_NEU => Some(MeldungStatus::Neu),
            STATUS_GESICHTET => Some(MeldungStatus::Gesichtet),
            STATUS_IN_BEARBEITUNG => Some(MeldungStatus::InBearbeitung),
            STATUS_ERLEDIGT => Some(MeldungStatus::Erledigt),
            _ => None,
        }
    }
}

impl TryFrom<String> for MeldungStatus {
    type Error = String;

    fn try_from(s: String) -> Result<Self, Self::Error> {
        MeldungStatus::parse(&s).ok_or_else(|| format!("Ungültiger MeldungStatus: {s}"))
    }
}

/// Meldungsart (Schema-Anker für die OpenAPI-Union, LFH-120). Wire == `meldungsart`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum Meldungsart {
    Lagemeldung,
    Sofortmeldung,
    Rueckmeldung,
    Vollzugsmeldung,
    Anfrage,
    Sonstige,
}

impl Meldungsart {
    /// DB-/API-Stringrepräsentation.
    pub fn as_str(&self) -> &'static str {
        match self {
            Meldungsart::Lagemeldung => ART_LAGEMELDUNG,
            Meldungsart::Sofortmeldung => ART_SOFORTMELDUNG,
            Meldungsart::Rueckmeldung => ART_RUECKMELDUNG,
            Meldungsart::Vollzugsmeldung => ART_VOLLZUGSMELDUNG,
            Meldungsart::Anfrage => ART_ANFRAGE,
            Meldungsart::Sonstige => ART_SONSTIGE,
        }
    }

    /// Parst eine gespeicherte/übergebene Meldungsart; `None` bei ungültigem Wert.
    pub fn parse(s: &str) -> Option<Meldungsart> {
        match s {
            ART_LAGEMELDUNG => Some(Meldungsart::Lagemeldung),
            ART_SOFORTMELDUNG => Some(Meldungsart::Sofortmeldung),
            ART_RUECKMELDUNG => Some(Meldungsart::Rueckmeldung),
            ART_VOLLZUGSMELDUNG => Some(Meldungsart::Vollzugsmeldung),
            ART_ANFRAGE => Some(Meldungsart::Anfrage),
            ART_SONSTIGE => Some(Meldungsart::Sonstige),
            _ => None,
        }
    }
}

impl TryFrom<String> for Meldungsart {
    type Error = String;

    fn try_from(s: String) -> Result<Self, Self::Error> {
        Meldungsart::parse(&s).ok_or_else(|| format!("Ungültige Meldungsart: {s}"))
    }
}

/// Triage-Status (linearer Workflow). Bewusst KEIN kommunikation_status:
/// dessen zwei unabhängige Achsen (Quittung / Vollzug-3-Zustände) bilden einen
/// linearen 4-Zustands-Fluss nicht ab — „gesichtet" hat dort keinen Slot.
pub const STATUS_NEU: &str = "neu";
pub const STATUS_GESICHTET: &str = "gesichtet";
pub const STATUS_IN_BEARBEITUNG: &str = "in_bearbeitung";
pub const STATUS_ERLEDIGT: &str = "erledigt";

pub fn prioritaet_gueltig(p: &str) -> bool {
    matches!(p, PRIO_SOFORT | PRIO_DRINGEND | PRIO_NORMAL)
}

pub fn meldungsart_gueltig(a: &str) -> bool {
    matches!(
        a,
        ART_LAGEMELDUNG
            | ART_SOFORTMELDUNG
            | ART_RUECKMELDUNG
            | ART_VOLLZUGSMELDUNG
            | ART_ANFRAGE
            | ART_SONSTIGE
    )
}

pub fn status_gueltig(s: &str) -> bool {
    matches!(
        s,
        STATUS_NEU | STATUS_GESICHTET | STATUS_IN_BEARBEITUNG | STATUS_ERLEDIGT
    )
}

/// Richtungskennzeichnung intern/extern (LFH-87, TEXT in der DB, im Code validiert).
pub const RICHTUNG_INTERN: &str = "intern";
pub const RICHTUNG_EXTERN: &str = "extern";

pub fn richtung_gueltig(r: &str) -> bool {
    matches!(r, RICHTUNG_INTERN | RICHTUNG_EXTERN)
}

/// Anzeige einer Meldung inkl. abgeleiteter Felder (Bearbeitername per JOIN,
/// `lage_meldung_id` als Herkunfts-Rückverweis, `ist_offen` für Posteingang-Filter).
#[derive(Debug, Clone, Serialize, sqlx::FromRow, ToSchema)]
pub struct MeldungAnzeige {
    pub id: i64,
    pub einsatz_id: i64,
    pub lfd_nr: i64,
    pub absender: String,
    pub empfaenger: Option<String>,
    pub meldeweg: MeldeWeg,
    pub inhalt: String,
    #[sqlx(try_from = "String")]
    pub meldungsart: Meldungsart,
    #[sqlx(try_from = "String")]
    pub prioritaet: Prioritaet,
    /// Richtung intern/extern (LFH-87).
    #[sqlx(try_from = "String")]
    pub richtung: Richtung,
    #[sqlx(try_from = "String")]
    pub status: MeldungStatus,
    pub bearbeiter_id: Option<i64>,
    pub bearbeiter_name: Option<String>,
    pub lagerelevant: bool,
    pub ereigniszeit: String,
    pub eingang_at: String,
    pub etb_meldung_id: Option<i64>,
    pub auftrag_id: Option<i64>,
    pub erfasst_von_id: i64,
    pub erstellt_at: String,
    /// Abgeleitet: id des erzeugten Lageobjekts (LFH-95), falls übergeben.
    pub lage_meldung_id: Option<i64>,
    /// Abgeleitet: status != 'erledigt' (Posteingang = offene Meldungen).
    pub ist_offen: bool,
    /// Erledigt-Zeitpunkt (UTC), first-write-wins beim Übergang nach 'erledigt' (LFH-113);
    /// NULL solange nie erledigt. Bleibt erhalten, falls der Status später zurückgesetzt wird.
    pub erledigt_at: Option<String>,
    /// Sofortmeldung & Eskalation (LFH-85/97): aktive Bestätigungspflicht.
    pub bestaetigung_pflicht: bool,
    /// Absolute Bestätigungsfrist (UTC), NULL wenn keine Pflicht.
    pub bestaetigung_frist_at: Option<String>,
    /// Frist überschritten + unbestätigt (vom Erinnerungs-Tick gesetzt, Re-Highlight).
    pub eskaliert: bool,
    /// Abgeleitet (kommunikation_status, Quittungs-Achse): Bestätigt-um.
    pub bestaetigt_at: Option<String>,
    /// Abgeleitet: Bestätigt-von (Benutzer-id).
    pub bestaetigt_von_id: Option<i64>,
    /// Abgeleitet: Bestätigt-von (Anzeigename, JOIN benutzer).
    pub bestaetigt_von_name: Option<String>,
    /// Abgeleitet: quittiert_at IS NOT NULL.
    pub ist_bestaetigt: bool,
    /// Abgeleitet: pflichtig, unbestätigt und Frist <= jetzt.
    pub ist_ueberfaellig: bool,
}

/// Lageobjekt aus lagerelevanter Meldung (LFH-95). Herkunfts-Felder (meldung_*)
/// per JOIN — am Lageobjekt bleibt die Quell-Meldung nachvollziehbar.
#[derive(Debug, Clone, Serialize, sqlx::FromRow, ToSchema)]
pub struct LageMeldungAnzeige {
    pub id: i64,
    pub einsatz_id: i64,
    pub meldung_id: i64,
    pub text: String,
    pub lat: Option<f64>,
    pub lon: Option<f64>,
    pub erstellt_von_id: i64,
    pub erstellt_at: String,
    pub meldung_lfd_nr: i64,
    pub meldung_absender: String,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn prioritaet_validierung() {
        assert!(prioritaet_gueltig(PRIO_SOFORT));
        assert!(!prioritaet_gueltig("blubb"));
    }

    #[test]
    fn meldungsart_validierung() {
        assert!(meldungsart_gueltig(ART_VOLLZUGSMELDUNG));
        assert!(!meldungsart_gueltig("brieftaube"));
    }

    #[test]
    fn status_validierung() {
        assert!(status_gueltig(STATUS_GESICHTET));
        assert!(!status_gueltig("archiviert"));
    }

    #[test]
    fn meldeweg_kommt_aus_kommunikation() {
        assert_eq!(MeldeWeg::Funk.as_str(), "funk");
    }
}
