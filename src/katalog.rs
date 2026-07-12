//! Geteilte Katalog-Grundlagen für Status-Kataloge (Fahrzeug, Personal, später Material).
//! Die feste Semantik-Kategorie trägt die App-Logik (Verfügbarkeit); der Dienststatus
//! steuert den Soft-Delete eines Stamm-Datensatzes.

use serde::Serialize;
use utoipa::ToSchema;

/// Dienststatus im Stamm: aktiv vs. außer Dienst (Soft-Delete).
pub const DIENSTSTATUS_IN_DIENST: &str = "in_dienst";
pub const DIENSTSTATUS_AUSSER_DIENST: &str = "ausser_dienst";

/// Semantik-Kategorie eines Status-Katalog-Eintrags (feste App-Logik).
pub const KATEGORIE_VERFUEGBAR: &str = "verfuegbar";
pub const KATEGORIE_GEBUNDEN: &str = "gebunden";
pub const KATEGORIE_NICHT_VERFUEGBAR: &str = "nicht_verfuegbar";

/// Ob `s` eine gültige Status-Kategorie ist (Eingabe-Validierung).
pub fn ist_gueltige_kategorie(s: &str) -> bool {
    matches!(
        s,
        KATEGORIE_VERFUEGBAR | KATEGORIE_GEBUNDEN | KATEGORIE_NICHT_VERFUEGBAR
    )
}

/// Betriebsart einer TETRA-Sprechgruppe.
pub const BETRIEBSART_TMO: &str = "TMO";
pub const BETRIEBSART_DMO: &str = "DMO";

/// Gültige Betriebsart einer Sprechgruppe (TETRA: TMO = Netz, DMO = Direkt).
pub fn ist_gueltige_betriebsart(s: &str) -> bool {
    matches!(s, BETRIEBSART_TMO | BETRIEBSART_DMO)
}

/// Betriebsart einer TETRA-Sprechgruppe (Schema-Anker für die OpenAPI-Union, LFH-120).
/// Wire == `betriebsart` (per-Variante, Großbuchstaben — `rename_all` trifft nicht).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]
pub enum Betriebsart {
    #[serde(rename = "TMO")]
    Tmo,
    #[serde(rename = "DMO")]
    Dmo,
}

impl Betriebsart {
    /// DB-/API-Stringrepräsentation. **Muss exakt `BETRIEBSART_TMO`/`BETRIEBSART_DMO`
    /// (Großbuchstaben) entsprechen** — Wire ist per-Variante `rename`, kein `snake_case`.
    pub fn as_str(&self) -> &'static str {
        match self {
            Betriebsart::Tmo => BETRIEBSART_TMO,
            Betriebsart::Dmo => BETRIEBSART_DMO,
        }
    }

    /// Parst einen Betriebsart-String; `None` bei ungültigem Wert.
    pub fn parse(s: &str) -> Option<Betriebsart> {
        match s {
            BETRIEBSART_TMO => Some(Betriebsart::Tmo),
            BETRIEBSART_DMO => Some(Betriebsart::Dmo),
            _ => None,
        }
    }
}

// Non-null, manuell gemappt (Sprechgruppe::anzeige) — TryFrom<String> für
// `#[sqlx(try_from = "String")]` auf dem internen FromRow-Struct (analog `LageZoneTyp`
// in `src/lage_zone/repo.rs`).
impl TryFrom<String> for Betriebsart {
    type Error = String;
    fn try_from(s: String) -> Result<Self, Self::Error> {
        Betriebsart::parse(&s).ok_or_else(|| format!("Ungültige Betriebsart: {s}"))
    }
}

/// Status-Kategorie eines Katalog-Eintrags (Schema-Anker für die OpenAPI-Union, LFH-120).
/// Wire == `status_kategorie`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum StatusKategorie {
    Verfuegbar,
    Gebunden,
    NichtVerfuegbar,
}

impl StatusKategorie {
    /// DB-/API-Stringrepräsentation. **Muss exakt den `KATEGORIE_*`-Consts entsprechen.**
    pub fn as_str(&self) -> &'static str {
        match self {
            StatusKategorie::Verfuegbar => KATEGORIE_VERFUEGBAR,
            StatusKategorie::Gebunden => KATEGORIE_GEBUNDEN,
            StatusKategorie::NichtVerfuegbar => KATEGORIE_NICHT_VERFUEGBAR,
        }
    }

    /// Parst einen Kategorie-String; `None` bei ungültigem Wert.
    pub fn parse(s: &str) -> Option<StatusKategorie> {
        match s {
            KATEGORIE_VERFUEGBAR => Some(StatusKategorie::Verfuegbar),
            KATEGORIE_GEBUNDEN => Some(StatusKategorie::Gebunden),
            KATEGORIE_NICHT_VERFUEGBAR => Some(StatusKategorie::NichtVerfuegbar),
            _ => None,
        }
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

/// Dienststatus im Stamm (Schema-Anker für die OpenAPI-Union, LFH-120). Wire == `dienststatus`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum Dienststatus {
    InDienst,
    AusserDienst,
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
