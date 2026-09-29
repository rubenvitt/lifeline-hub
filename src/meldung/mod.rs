//! Meldungen (eingehend) (LFH-54): Bottom-up-Strang des Führungsvorgangs
//! (digitaler Meldekopf). Strukturierte Erfassung (Nachrichtenvordruck),
//! linearer Triage-Status, ETB-Kopplung. Baut auf dem Kommunikations-Unterbau
//! (`MeldeWeg`-Vokabular, LFH-84) und spiegelt das Aufträge-Template (LFH-52).
pub mod repo;

use crate::wire_enum::wire_enum;
use serde::Serialize;
use utoipa::ToSchema;

/// Meldeweg-Vokabular: Single Source of Truth bleibt das ETB-Modul (über den
/// Kommunikations-Unterbau re-exportiert), keine Eigendefinition.
pub use crate::kommunikation::MeldeWeg;
use crate::kommunikation::{Prioritaet, Richtung};

/// Priorität/Dringlichkeit (TEXT in der DB, im Code validiert).
pub const PRIO_SOFORT: &str = Prioritaet::Sofort.as_str();
pub const PRIO_DRINGEND: &str = Prioritaet::Dringend.as_str();
pub const PRIO_NORMAL: &str = Prioritaet::Normal.as_str();

/// Default-Bestätigungsfrist (Minuten ab Eingang) für bestätigungspflichtige
/// Sofortmeldungen (LFH-97), wenn der Absetzer kein Override angibt.
pub const BESTAETIGUNG_FRIST_DEFAULT_MIN: i64 = 5;

/// Vorgabe der Rückmeldefrist (Minuten ab der letzten Rückmeldung einer Einheit, LFH-610),
/// wenn weder Einsatz noch Org eine setzen. 60 deckt sich mit den Beispieldaten des
/// Neuentwurfs (50 min unauffällig, 65 min überfällig) — Entscheidung des Auftraggebers.
pub const RUECKMELDUNG_FRIST_DEFAULT_MIN: i64 = 60;

/// Meldungsart (Nachrichtenvordruck-Klassifikation).
pub const ART_LAGEMELDUNG: &str = Meldungsart::Lagemeldung.as_str();
pub const ART_SOFORTMELDUNG: &str = Meldungsart::Sofortmeldung.as_str();
pub const ART_RUECKMELDUNG: &str = Meldungsart::Rueckmeldung.as_str();
pub const ART_VOLLZUGSMELDUNG: &str = Meldungsart::Vollzugsmeldung.as_str();
pub const ART_ANFRAGE: &str = Meldungsart::Anfrage.as_str();
pub const ART_SONSTIGE: &str = Meldungsart::Sonstige.as_str();

wire_enum! {
    /// Triage-Status einer Meldung (Schema-Anker für die OpenAPI-Union, LFH-120). Wire == `status`.
    #[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]
    pub enum MeldungStatus {
        Neu => "neu",
        Gesichtet => "gesichtet",
        InBearbeitung => "in_bearbeitung",
        Erledigt => "erledigt",
    }
    try_from = |s| format!("Ungültiger MeldungStatus: {s}");
}

wire_enum! {
    /// Meldungsart (Schema-Anker für die OpenAPI-Union, LFH-120). Wire == `meldungsart`.
    #[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]
    pub enum Meldungsart {
        Lagemeldung => "lagemeldung",
        Sofortmeldung => "sofortmeldung",
        Rueckmeldung => "rueckmeldung",
        Vollzugsmeldung => "vollzugsmeldung",
        Anfrage => "anfrage",
        Sonstige => "sonstige",
    }
    try_from = |s| format!("Ungültige Meldungsart: {s}");
}

/// Triage-Status (linearer Workflow). Bewusst KEIN kommunikation_status:
/// dessen zwei unabhängige Achsen (Quittung / Vollzug-3-Zustände) bilden einen
/// linearen 4-Zustands-Fluss nicht ab — „gesichtet" hat dort keinen Slot.
pub const STATUS_NEU: &str = MeldungStatus::Neu.as_str();
pub const STATUS_GESICHTET: &str = MeldungStatus::Gesichtet.as_str();
pub const STATUS_IN_BEARBEITUNG: &str = MeldungStatus::InBearbeitung.as_str();
pub const STATUS_ERLEDIGT: &str = MeldungStatus::Erledigt.as_str();

pub fn prioritaet_gueltig(p: &str) -> bool {
    Prioritaet::parse(p).is_some()
}

pub fn meldungsart_gueltig(a: &str) -> bool {
    Meldungsart::parse(a).is_some()
}

pub fn status_gueltig(s: &str) -> bool {
    MeldungStatus::parse(s).is_some()
}

/// Richtungskennzeichnung intern/extern (LFH-87, TEXT in der DB, im Code validiert).
pub const RICHTUNG_INTERN: &str = Richtung::Intern.as_str();
pub const RICHTUNG_EXTERN: &str = Richtung::Extern.as_str();

pub fn richtung_gueltig(r: &str) -> bool {
    Richtung::parse(r).is_some()
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
    /// Strukturierter Absender (LFH-610): die Einheit, von der die Meldung kam. Höchstens
    /// einer von `einheit_id`/`abschnitt_id` ist gesetzt; `absender` bleibt der Name zum
    /// Eingangszeitpunkt. NULL, wenn nicht gebunden oder die Einheit aufgelöst wurde.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub einheit_id: Option<i64>,
    /// Strukturierter Absender (LFH-610): der Einsatzabschnitt, von dem die Meldung kam.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub abschnitt_id: Option<i64>,
}

/// Letzte Rückmeldung eines Absenders (Einheit oder direkt gebundener Abschnitt, LFH-610).
/// Als Rückmeldung zählt jede an den Absender gebundene Meldung, gleich welcher
/// Meldungsart; maßgeblich ist die jüngste `ereigniszeit`.
#[derive(Debug, Clone, Serialize, sqlx::FromRow, ToSchema)]
pub struct LetzteRueckmeldung {
    /// `einsatz_einheit.id` bzw. `einsatzabschnitt.id`, je nach Liste.
    pub bezug_id: i64,
    pub meldung_id: i64,
    pub lfd_nr: i64,
    /// Zeitpunkt der Rückmeldung (UTC, SQLite-Format) — die Ereigniszeit, nicht der Eingang.
    pub ereigniszeit: String,
    pub inhalt: String,
    pub meldeweg: MeldeWeg,
    /// `ereigniszeit` + Rückmeldefrist (UTC). Ab diesem Zeitpunkt gilt der Absender als
    /// überfällig; der Vergleich mit „jetzt" liegt beim Client, damit die Anzeige ohne
    /// neues Ereignis umschlägt.
    #[sqlx(skip)]
    pub faellig_at: String,
}

/// Antwort von `GET …/meldungen/rueckmeldungen` (LFH-610). Einheiten ohne Eintrag haben
/// noch nie zurückgemeldet. Die Abschnittsliste enthält nur DIREKT an den Abschnitt
/// gebundene Meldungen; die Rückmeldung über den Teilbaum rechnet der Client aus beiden.
#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct RueckmeldungenAnzeige {
    /// Effektive Rückmeldefrist in Minuten (Einsatz ?? Org ?? 60).
    pub frist_min: i64,
    pub einheiten: Vec<LetzteRueckmeldung>,
    pub abschnitte: Vec<LetzteRueckmeldung>,
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
