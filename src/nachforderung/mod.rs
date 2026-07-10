//! Nachforderung von Kräften/Mitteln (LFH-87): strukturierte Anforderung an externe
//! Stellen mit verfolgbarem, linearem Bedarfs-Status (Abzweig „abgelehnt"). Eigenes Modul
//! nach dem Auftrags-Template (LFH-52); ETB-Kopplung Pattern B. Bewusst KEIN
//! `kommunikation_status` — der lineare Bedarfsfluss passt nicht auf dessen zwei Achsen
//! (vgl. Meldungs-Triage).
pub mod repo;

use crate::kommunikation::{AdressatKategorie, Prioritaet};
use serde::Serialize;
use utoipa::ToSchema;

/// Priorität (TEXT in der DB, im Code validiert).
pub const PRIO_SOFORT: &str = "sofort";
pub const PRIO_DRINGEND: &str = "dringend";
pub const PRIO_NORMAL: &str = "normal";

/// Adressat-Kategorie (externe Stelle).
pub const ADRESSAT_LEITSTELLE: &str = "leitstelle";
pub const ADRESSAT_NACHBAR_EA: &str = "nachbar_ea";
pub const ADRESSAT_UEBERGEORDNET: &str = "uebergeordnet";
pub const ADRESSAT_ANDERE_BOS: &str = "andere_bos";

/// Bedarfs-Status (linear + Abzweig).
pub const STATUS_ANGEFORDERT: &str = "angefordert";
pub const STATUS_ZUGESAGT: &str = "zugesagt";
pub const STATUS_UNTERWEGS: &str = "unterwegs";
pub const STATUS_EINGETROFFEN: &str = "eingetroffen";
pub const STATUS_ABGELEHNT: &str = "abgelehnt";

/// Bedarfs-Status einer Nachforderung (Schema-Anker für die OpenAPI-Union, LFH-120).
/// Wire == `status`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum NachforderungStatus {
    Angefordert,
    Zugesagt,
    Unterwegs,
    Eingetroffen,
    Abgelehnt,
}

impl NachforderungStatus {
    /// DB-/API-Stringrepräsentation.
    pub fn as_str(&self) -> &'static str {
        match self {
            NachforderungStatus::Angefordert => STATUS_ANGEFORDERT,
            NachforderungStatus::Zugesagt => STATUS_ZUGESAGT,
            NachforderungStatus::Unterwegs => STATUS_UNTERWEGS,
            NachforderungStatus::Eingetroffen => STATUS_EINGETROFFEN,
            NachforderungStatus::Abgelehnt => STATUS_ABGELEHNT,
        }
    }

    /// Parst einen gespeicherten/übergebenen Bedarfs-Status; `None` bei ungültigem Wert.
    pub fn parse(s: &str) -> Option<NachforderungStatus> {
        match s {
            STATUS_ANGEFORDERT => Some(NachforderungStatus::Angefordert),
            STATUS_ZUGESAGT => Some(NachforderungStatus::Zugesagt),
            STATUS_UNTERWEGS => Some(NachforderungStatus::Unterwegs),
            STATUS_EINGETROFFEN => Some(NachforderungStatus::Eingetroffen),
            STATUS_ABGELEHNT => Some(NachforderungStatus::Abgelehnt),
            _ => None,
        }
    }
}

impl TryFrom<String> for NachforderungStatus {
    type Error = String;

    fn try_from(s: String) -> Result<Self, Self::Error> {
        NachforderungStatus::parse(&s).ok_or_else(|| format!("Ungültiger NachforderungStatus: {s}"))
    }
}

pub fn prioritaet_gueltig(p: &str) -> bool {
    matches!(p, PRIO_SOFORT | PRIO_DRINGEND | PRIO_NORMAL)
}

pub fn adressat_kategorie_gueltig(a: &str) -> bool {
    matches!(a, ADRESSAT_LEITSTELLE | ADRESSAT_NACHBAR_EA | ADRESSAT_UEBERGEORDNET | ADRESSAT_ANDERE_BOS)
}

pub fn status_gueltig(s: &str) -> bool {
    matches!(s, STATUS_ANGEFORDERT | STATUS_ZUGESAGT | STATUS_UNTERWEGS | STATUS_EINGETROFFEN | STATUS_ABGELEHNT)
}

/// Erlaubter Status-Übergang: linear vorwärts (angefordert→zugesagt→unterwegs→eingetroffen)
/// und Abzweig „abgelehnt" aus jedem nicht-terminalen Zustand. `eingetroffen`/`abgelehnt`
/// sind terminal (kein weiterer Übergang).
pub fn uebergang_erlaubt(von: &str, nach: &str) -> bool {
    match von {
        STATUS_ANGEFORDERT => matches!(nach, STATUS_ZUGESAGT | STATUS_ABGELEHNT),
        STATUS_ZUGESAGT => matches!(nach, STATUS_UNTERWEGS | STATUS_ABGELEHNT),
        STATUS_UNTERWEGS => matches!(nach, STATUS_EINGETROFFEN | STATUS_ABGELEHNT),
        _ => false,
    }
}

/// Anzeige einer Nachforderung inkl. Ersteller-Name (JOIN) und abgeleitetem `ist_offen`
/// (noch nicht eingetroffen/abgelehnt). Reihenfolge der Felder = SELECT-Projektion.
#[derive(Debug, Clone, Serialize, sqlx::FromRow, ToSchema)]
pub struct NachforderungAnzeige {
    pub id: i64,
    pub einsatz_id: i64,
    pub art: String,
    pub bezeichnung: String,
    pub anzahl: Option<i64>,
    pub adressat_kategorie: AdressatKategorie,
    pub adressat_bezeichnung: Option<String>,
    pub begruendung: Option<String>,
    #[sqlx(try_from = "String")]
    pub prioritaet: Prioritaet,
    #[sqlx(try_from = "String")]
    pub status: NachforderungStatus,
    pub zugesagt_at: Option<String>,
    pub unterwegs_at: Option<String>,
    pub eingetroffen_at: Option<String>,
    pub abgelehnt_at: Option<String>,
    pub abgelehnt_grund: Option<String>,
    pub angefordert_at: String,
    pub etb_nachforderung_id: Option<i64>,
    pub erstellt_von_id: i64,
    pub erstellt_at: String,
    /// Abgeleitet: Ersteller-Anzeigename (LEFT JOIN benutzer).
    pub erstellt_von_name: Option<String>,
    /// Abgeleitet: status NOT IN ('eingetroffen','abgelehnt').
    pub ist_offen: bool,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn prioritaet_und_adressat_validierung() {
        assert!(prioritaet_gueltig(PRIO_SOFORT));
        assert!(!prioritaet_gueltig("ultra"));
        assert!(adressat_kategorie_gueltig(ADRESSAT_LEITSTELLE));
        assert!(!adressat_kategorie_gueltig("nachbar"));
    }

    #[test]
    fn status_validierung() {
        assert!(status_gueltig(STATUS_UNTERWEGS));
        assert!(!status_gueltig("storniert"));
    }

    #[test]
    fn uebergaenge_linear_und_abzweig() {
        assert!(uebergang_erlaubt(STATUS_ANGEFORDERT, STATUS_ZUGESAGT));
        assert!(uebergang_erlaubt(STATUS_ZUGESAGT, STATUS_UNTERWEGS));
        assert!(uebergang_erlaubt(STATUS_UNTERWEGS, STATUS_EINGETROFFEN));
        assert!(uebergang_erlaubt(STATUS_ANGEFORDERT, STATUS_ABGELEHNT));
        assert!(uebergang_erlaubt(STATUS_UNTERWEGS, STATUS_ABGELEHNT));
        // Verboten: Sprünge, Rückschritte, aus terminalen Zuständen.
        assert!(!uebergang_erlaubt(STATUS_ANGEFORDERT, STATUS_UNTERWEGS));
        assert!(!uebergang_erlaubt(STATUS_ZUGESAGT, STATUS_ANGEFORDERT));
        assert!(!uebergang_erlaubt(STATUS_EINGETROFFEN, STATUS_ABGELEHNT));
        assert!(!uebergang_erlaubt(STATUS_ABGELEHNT, STATUS_ZUGESAGT));
    }
}
