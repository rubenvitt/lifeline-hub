//! Gemeinsamer Kommunikations-Unterbau (LFH-84): geteilte Zustellungs- und
//! Status-Mechanik (Quittung vs. Vollzug — sauber getrennt) für die
//! Kommunikations-Module (Chat, Erinnerung, künftig Aufträge/Meldungen).
pub mod repo;

use serde::Serialize;
use utoipa::ToSchema;

/// Vokabular-Re-Export: Single Source of Truth bleibt das ETB-Modul. Module
/// referenzieren `kommunikation::{EtbTyp, MeldeWeg}` statt eigene Vokabulare zu
/// definieren. (Funkrufname lebt fachlich an `einheit`/`fahrzeug` und wird dort
/// referenziert — kein Enum zum Re-Export.)
pub use crate::etb::{EtbTyp, MeldeWeg};

/// Objekttyp für die polymorphe Referenz `(objekt_typ, objekt_id)`.
pub const OBJEKT_CHAT_NACHRICHT: &str = "chat_nachricht";
pub const OBJEKT_ERINNERUNG: &str = "erinnerung";
pub const OBJEKT_AUFTRAG: &str = "auftrag";
pub const OBJEKT_MELDUNG: &str = "meldung";

/// Vollzug-Achse (Achse 2): Bearbeitungszustand eines Objekts.
pub const VOLLZUG_OFFEN: &str = "offen";
pub const VOLLZUG_IN_ARBEIT: &str = "in_arbeit";
pub const VOLLZUG_VOLLZOGEN: &str = "vollzogen";

/// Geteilte Priorität für Auftrag/Meldung/Nachforderung (Schema-Anker für die OpenAPI-Union,
/// LFH-120; TS: `AuftragPrioritaet`/`MeldungPrioritaet`/`NachforderungPrioritaet`). Wire == `prioritaet`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum Prioritaet {
    Sofort,
    Dringend,
    Normal,
}

impl Prioritaet {
    /// DB-/API-Stringrepräsentation.
    pub fn as_str(&self) -> &'static str {
        match self {
            Prioritaet::Sofort => "sofort",
            Prioritaet::Dringend => "dringend",
            Prioritaet::Normal => "normal",
        }
    }

    /// Parst einen gespeicherten/übergebenen Prioritätswert; `None` bei ungültigem Wert.
    pub fn parse(s: &str) -> Option<Prioritaet> {
        match s {
            "sofort" => Some(Prioritaet::Sofort),
            "dringend" => Some(Prioritaet::Dringend),
            "normal" => Some(Prioritaet::Normal),
            _ => None,
        }
    }
}

impl TryFrom<String> for Prioritaet {
    type Error = String;

    fn try_from(s: String) -> Result<Self, Self::Error> {
        Prioritaet::parse(&s).ok_or_else(|| format!("Ungültige Prioritaet: {s}"))
    }
}

/// Geteilte Richtung für Auftrag/Meldung (Schema-Anker für die OpenAPI-Union, LFH-120).
/// Wire == `richtung`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum Richtung {
    Intern,
    Extern,
}

impl Richtung {
    /// DB-/API-Stringrepräsentation.
    pub fn as_str(&self) -> &'static str {
        match self {
            Richtung::Intern => "intern",
            Richtung::Extern => "extern",
        }
    }

    /// Parst einen gespeicherten/übergebenen Richtungswert; `None` bei ungültigem Wert.
    pub fn parse(s: &str) -> Option<Richtung> {
        match s {
            "intern" => Some(Richtung::Intern),
            "extern" => Some(Richtung::Extern),
            _ => None,
        }
    }
}

impl TryFrom<String> for Richtung {
    type Error = String;

    fn try_from(s: String) -> Result<Self, Self::Error> {
        Richtung::parse(&s).ok_or_else(|| format!("Ungültige Richtung: {s}"))
    }
}

/// Geteilte externe Adressat-Kategorie für Nachforderung (`adressat_kategorie`) und Auftrag
/// (`extern_kategorie`) (Schema-Anker für die OpenAPI-Union, LFH-120).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum AdressatKategorie {
    Leitstelle,
    NachbarEa,
    Uebergeordnet,
    AndereBos,
}

impl AdressatKategorie {
    /// DB-/API-Stringrepräsentation.
    pub fn as_str(&self) -> &'static str {
        match self {
            AdressatKategorie::Leitstelle => "leitstelle",
            AdressatKategorie::NachbarEa => "nachbar_ea",
            AdressatKategorie::Uebergeordnet => "uebergeordnet",
            AdressatKategorie::AndereBos => "andere_bos",
        }
    }

    /// Parst einen gespeicherten/übergebenen Kategoriewert; `None` bei ungültigem Wert.
    pub fn parse(s: &str) -> Option<AdressatKategorie> {
        match s {
            "leitstelle" => Some(AdressatKategorie::Leitstelle),
            "nachbar_ea" => Some(AdressatKategorie::NachbarEa),
            "uebergeordnet" => Some(AdressatKategorie::Uebergeordnet),
            "andere_bos" => Some(AdressatKategorie::AndereBos),
            _ => None,
        }
    }
}

// Nullable Spalte in `AuftragEmpfaengerAnzeige.extern_kategorie`, non-null in
// `NachforderungAnzeige.adressat_kategorie` — einheitlicher Decode-Mechanismus über
// beide Verwendungen (Type/Decode direkt auf dem Enum, statt gemischt mit
// `#[sqlx(try_from = …)]`, vgl. `TierStatus` in `src/tier/mod.rs`). sqlx' Blanket-Impl
// für `Option<T>` bildet NULL → `None` transparent ab.
impl<DB: sqlx::Database> sqlx::Type<DB> for AdressatKategorie
where
    str: sqlx::Type<DB>,
{
    fn type_info() -> DB::TypeInfo {
        <str as sqlx::Type<DB>>::type_info()
    }
}

impl<'r, DB: sqlx::Database> sqlx::Decode<'r, DB> for AdressatKategorie
where
    &'r str: sqlx::Decode<'r, DB>,
{
    fn decode(value: <DB as sqlx::Database>::ValueRef<'r>) -> Result<Self, sqlx::error::BoxDynError> {
        let s = <&str as sqlx::Decode<DB>>::decode(value)?;
        AdressatKategorie::parse(s).ok_or_else(|| format!("Ungültige AdressatKategorie: {s}").into())
    }
}

/// Geteilter Status eines Objekts: beide Achsen getrennt. `quittiert_at` ist die
/// Quittungs-Achse, `vollzug_status`/`vollzogen_at` die Vollzugs-Achse — beide
/// unabhängig setzbar.
#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
pub struct KommunikationStatus {
    pub objekt_typ: String,
    pub objekt_id: i64,
    pub quittiert_at: Option<String>,
    pub quittiert_von_id: Option<i64>,
    pub vollzug_status: String,
    pub vollzogen_at: Option<String>,
    pub vollzogen_von_id: Option<i64>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn vollzug_konstanten_sind_eindeutig() {
        assert_ne!(VOLLZUG_OFFEN, VOLLZUG_VOLLZOGEN);
        assert_ne!(VOLLZUG_OFFEN, VOLLZUG_IN_ARBEIT);
    }

    #[test]
    fn vokabular_wird_aus_etb_referenziert() {
        assert_eq!(EtbTyp::Meldung.as_str(), crate::etb::EtbTyp::Meldung.as_str());
        assert_eq!(MeldeWeg::Funk.as_str(), "funk");
    }

    #[test]
    fn objekt_typen_sind_eindeutig() {
        assert_ne!(OBJEKT_CHAT_NACHRICHT, OBJEKT_ERINNERUNG);
        assert_ne!(OBJEKT_AUFTRAG, OBJEKT_ERINNERUNG);
        assert_ne!(OBJEKT_AUFTRAG, OBJEKT_CHAT_NACHRICHT);
        assert_ne!(OBJEKT_MELDUNG, OBJEKT_AUFTRAG);
        assert_ne!(OBJEKT_MELDUNG, OBJEKT_CHAT_NACHRICHT);
        assert_ne!(OBJEKT_MELDUNG, OBJEKT_ERINNERUNG);
    }
}
