//! Stammdaten-Katalog „Externe Stellen“ je Organisation (LFH-1194): Leitstellen, Behörden,
//! Polizei und Hilfsorganisationen, mit denen ein Einsatz zu tun hat. Vorschlagsquelle für die
//! meldende Stelle und den Adressaten einer Nachforderung; beide speichern nur Text (Speicherform
//! A). Herleitung: `openspec/changes/lfh-1194-externe-stellen-katalog/design.md`.

pub mod repo;

use crate::wire_enum::wire_enum;
use serde::Serialize;
use utoipa::ToSchema;

/// Höchstlänge der Bezeichnung nach dem Trimmen (`src/AGENTS.md`, „Eingabegrenzen“). Gleich
/// [`crate::einsatz::MELDENDE_STELLE_MAX`]: jede Bezeichnung passt in die meldende Stelle.
pub const BEZEICHNUNG_MAX: usize = 200;

/// Höchstlänge von Rufnummer und Funkrufname nach dem Trimmen.
pub const KURZ_MAX: usize = 100;

wire_enum! {
    /// Art einer externen Stelle (Schema-Anker für die OpenAPI-Union, LFH-120). Bewusst nicht
    /// die `Stellenart` des Kommunikationsplans: die beschreibt die Rolle im Plan und kennt weder
    /// Polizei noch Hilfsorganisation (design.md D2).
    ///
    /// Die Reihenfolge der Varianten ist die Anzeigereihenfolge der Gruppen.
    #[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]
    pub enum ExterneStelleArt {
        Leitstelle => "leitstelle",
        Polizei => "polizei",
        Behoerde => "behoerde",
        Hilfsorganisation => "hilfsorganisation",
        Sonstige => "sonstige",
    }
    try_from = |s| format!("Ungültige Art einer externen Stelle: {s}");
}

/// Eine externe Stelle des Katalogs.
#[derive(Debug, Clone, Serialize, sqlx::FromRow, ToSchema)]
pub struct ExterneStelle {
    pub id: i64,
    pub bezeichnung: String,
    #[sqlx(try_from = "String")]
    pub art: ExterneStelleArt,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rufnummer: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub funkrufname: Option<String>,
    pub aktiv: bool,
    /// Die zuständige Leitstelle der Organisation; höchstens eine, nur aktiv und Art
    /// `leitstelle`.
    pub zustaendig: bool,
}

#[cfg(test)]
mod tests;
