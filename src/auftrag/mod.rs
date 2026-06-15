//! Aufträge/Befehle (LFH-52): Top-down-Strang des Führungsvorgangs
//! (Befehlsgebung → Vollzug → Kontrolle). Quittung liegt pro Empfänger
//! (`auftrag_empfaenger`), Vollzug pro Auftrag über den geteilten
//! Kommunikations-Unterbau (`kommunikation_status`, LFH-84).
pub mod repo;

use serde::Serialize;

/// Priorität eines Auftrags (TEXT in der DB, im Code validiert).
pub const PRIO_SOFORT: &str = "sofort";
pub const PRIO_DRINGEND: &str = "dringend";
pub const PRIO_NORMAL: &str = "normal";

/// Empfänger-Diskriminator (Spiegel des DB-CHECK auf auftrag_empfaenger).
pub const EMPF_ABSCHNITT: &str = "abschnitt";
pub const EMPF_EINHEIT: &str = "einheit";
pub const EMPF_FUNKTION: &str = "funktion";
pub const EMPF_PERSON: &str = "person";
pub const EMPF_FAHRZEUG: &str = "fahrzeug";

/// Effektiver Bearbeitungsstatus (abgeleitet, fürs Frontend).
pub const BEARB_OFFEN: &str = "offen";
pub const BEARB_IN_ARBEIT: &str = "in_arbeit";
pub const BEARB_VOLLZOGEN: &str = "vollzogen";
pub const BEARB_ABGENOMMEN: &str = "abgenommen";

/// Richtungskennzeichnung intern/extern (LFH-87, TEXT in der DB, im Code validiert).
pub const RICHTUNG_INTERN: &str = "intern";
pub const RICHTUNG_EXTERN: &str = "extern";

pub fn prioritaet_gueltig(p: &str) -> bool {
    matches!(p, PRIO_SOFORT | PRIO_DRINGEND | PRIO_NORMAL)
}

pub fn richtung_gueltig(r: &str) -> bool {
    matches!(r, RICHTUNG_INTERN | RICHTUNG_EXTERN)
}

pub fn empfaenger_typ_gueltig(t: &str) -> bool {
    matches!(t, EMPF_ABSCHNITT | EMPF_EINHEIT | EMPF_FUNKTION | EMPF_PERSON | EMPF_FAHRZEUG)
}

/// Anzeige eines Auftrags inkl. abgeleiteter Felder und der Vollzugs-Achse aus
/// dem geteilten `kommunikation_status` (per LEFT JOIN). Quittungs-Aggregate
/// (`empfaenger_anzahl`, `quittiert_anzahl`) stammen aus `auftrag_empfaenger`.
#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
pub struct AuftragAnzeige {
    pub id: i64,
    pub einsatz_id: i64,
    pub auftrag_text: String,
    pub absicht: Option<String>,
    pub lage: Option<String>,
    pub ort: Option<String>,
    pub zeit: Option<String>,
    pub mittel: Option<String>,
    pub verbindung: Option<String>,
    pub sicherheit: Option<String>,
    pub prioritaet: String,
    /// Richtung intern/extern (LFH-87).
    pub richtung: String,
    pub frist_at: Option<String>,
    pub erteilt_at: String,
    pub in_arbeit_at: Option<String>,
    pub vollzugsmeldung: Option<String>,
    pub abgenommen_at: Option<String>,
    pub abgenommen_von_id: Option<i64>,
    pub etb_anordnung_id: Option<i64>,
    pub erstellt_von_id: i64,
    pub erstellt_at: String,
    // Vollzugs-Achse aus kommunikation_status (Default 'offen').
    pub vollzug_status: String,
    pub vollzogen_at: Option<String>,
    pub vollzogen_von_id: Option<i64>,
    // Quittungs-Aggregat aus auftrag_empfaenger.
    pub empfaenger_anzahl: i64,
    pub quittiert_anzahl: i64,
    // Abgeleitet: Frist überschritten UND noch nicht alle Empfänger quittiert.
    pub ist_ueberfaellig: bool,
    // Abgeleitet: 'abgenommen' wenn abgenommen_at gesetzt, sonst vollzug_status.
    pub bearbeitungsstatus: String,
}

/// Anzeige einer Empfänger-Zeile inkl. Quittung (Achse 1, pro Empfänger).
#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
pub struct AuftragEmpfaengerAnzeige {
    pub id: i64,
    pub auftrag_id: i64,
    pub empfaenger_typ: String,
    pub abschnitt_id: Option<i64>,
    pub einheit_id: Option<i64>,
    pub person_id: Option<i64>,
    pub fahrzeug_id: Option<i64>,
    pub funktion_text: Option<String>,
    pub snap_anzeige: String,
    pub quittiert_at: Option<String>,
    pub quittiert_von_id: Option<i64>,
}

/// Auftrag + seine Empfänger (Detail-/Anlege-/Mutations-Antwort).
#[derive(Debug, Clone, Serialize)]
pub struct AuftragDetail {
    #[serde(flatten)]
    pub auftrag: AuftragAnzeige,
    pub empfaenger: Vec<AuftragEmpfaengerAnzeige>,
}
