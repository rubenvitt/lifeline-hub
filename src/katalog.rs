//! Geteilte Katalog-Grundlagen für Status-Kataloge (Fahrzeug, Personal, später Material).
//! Die feste Semantik-Kategorie trägt die App-Logik (Verfügbarkeit); der Dienststatus
//! steuert den Soft-Delete eines Stamm-Datensatzes.

use crate::wire_enum::wire_enum;
use serde::Serialize;
use utoipa::ToSchema;

/// Dienststatus im Stamm: aktiv vs. außer Dienst (Soft-Delete).
pub const DIENSTSTATUS_IN_DIENST: &str = Dienststatus::InDienst.as_str();
pub const DIENSTSTATUS_AUSSER_DIENST: &str = Dienststatus::AusserDienst.as_str();

/// Semantik-Kategorie eines Status-Katalog-Eintrags (feste App-Logik).
pub const KATEGORIE_VERFUEGBAR: &str = StatusKategorie::Verfuegbar.as_str();
pub const KATEGORIE_GEBUNDEN: &str = StatusKategorie::Gebunden.as_str();
pub const KATEGORIE_NICHT_VERFUEGBAR: &str = StatusKategorie::NichtVerfuegbar.as_str();

/// Ob `s` eine gültige Status-Kategorie ist (Eingabe-Validierung).
pub fn ist_gueltige_kategorie(s: &str) -> bool {
    StatusKategorie::parse(s).is_some()
}

/// Betriebsart einer TETRA-Sprechgruppe.
pub const BETRIEBSART_TMO: &str = Betriebsart::Tmo.as_str();
pub const BETRIEBSART_DMO: &str = Betriebsart::Dmo.as_str();

/// Gültige Betriebsart einer Sprechgruppe (TETRA: TMO = Netz, DMO = Direkt).
pub fn ist_gueltige_betriebsart(s: &str) -> bool {
    Betriebsart::parse(s).is_some()
}

wire_enum! {
    /// Betriebsart einer TETRA-Sprechgruppe (Schema-Anker für die OpenAPI-Union, LFH-120).
    /// Wire == `betriebsart` (per-Variante, Großbuchstaben — `rename_all` trifft nicht).
    #[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]
    pub enum Betriebsart {
        Tmo => "TMO",
        Dmo => "DMO",
    }
    // Non-null, manuell gemappt (Sprechgruppe::anzeige) — TryFrom<String> für
    // `#[sqlx(try_from = "String")]` auf dem internen FromRow-Struct (analog `LageZoneTyp`
    // in `src/lage_zone/repo.rs`).
    try_from = |s| format!("Ungültige Betriebsart: {s}");
}

wire_enum! {
    /// Status-Kategorie eines Katalog-Eintrags (Schema-Anker für die OpenAPI-Union, LFH-120).
    /// Wire == `status_kategorie`.
    #[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]
    pub enum StatusKategorie {
        Verfuegbar => "verfuegbar",
        Gebunden => "gebunden",
        NichtVerfuegbar => "nicht_verfuegbar",
    }
}

// `kategorie` kommt sowohl non-null vor (PersonalStatus/FahrzeugStatus — direkt
// query_as'te DTOs) als auch nullable (EinsatzPersonalAnzeige/EinsatzFahrzeugAnzeige.
// status_kategorie, LEFT JOIN). Einheitlich `Type`/`Decode` direkt auf dem Enum, statt
// `#[sqlx(try_from = …)]` (scheitert an der Orphan-Rule auf `Option<Enum>`) — sqlx'
// Blanket-Impl für `Option<T>` bildet NULL transparent auf `None` ab (gleiches Muster wie
// `TierGeschlecht` in `src/tier/mod.rs`/`Geschlecht` in `src/person/mod.rs`).
impl<DB: sqlx::Database> sqlx::Type<DB> for StatusKategorie
where
    str: sqlx::Type<DB>,
{
    fn type_info() -> DB::TypeInfo {
        <str as sqlx::Type<DB>>::type_info()
    }
}

impl<'r, DB: sqlx::Database> sqlx::Decode<'r, DB> for StatusKategorie
where
    &'r str: sqlx::Decode<'r, DB>,
{
    fn decode(
        value: <DB as sqlx::Database>::ValueRef<'r>,
    ) -> Result<Self, sqlx::error::BoxDynError> {
        let s = <&str as sqlx::Decode<DB>>::decode(value)?;
        StatusKategorie::parse(s).ok_or_else(|| format!("Ungültige StatusKategorie: {s}").into())
    }
}

wire_enum! {
    /// Dienststatus im Stamm (Schema-Anker für die OpenAPI-Union, LFH-120). Wire == `dienststatus`.
    #[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]
    pub enum Dienststatus {
        InDienst => "in_dienst",
        AusserDienst => "ausser_dienst",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn kategorie_validierung() {
        assert!(ist_gueltige_kategorie("gebunden"));
        assert!(!ist_gueltige_kategorie("irgendwas"));
    }

    #[test]
    fn betriebsart_validierung() {
        assert!(ist_gueltige_betriebsart("TMO"));
        assert!(ist_gueltige_betriebsart("DMO"));
        assert!(!ist_gueltige_betriebsart("FOO"));
        assert!(!ist_gueltige_betriebsart("tmo"));
    }
}
