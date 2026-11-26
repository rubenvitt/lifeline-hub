//! Stammdaten-Katalog „Externe Stellen“ je Organisation (LFH-1194): Leitstellen, Behörden,
//! Polizei und Hilfsorganisationen, mit denen ein Einsatz zu tun hat. Vorschlagsquelle für die
//! meldende Stelle und den Adressaten einer Nachforderung; beide speichern nur Text (Speicherform
//! A). Herleitung: `openspec/changes/archive/2026-10-11-lfh-1194-externe-stellen-katalog/design.md`.

pub mod kanal;
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

wire_enum! {
    /// Kanal, über den eine externe Stelle erreichbar ist (LLH-2093). Alle vier stehen im CHECK der
    /// Tabelle `org_externe_stelle_kanal`, damit die Nachzüge keinen Tabellenumbau brauchen;
    /// angenommen werden heute E-Mail und Fax (siehe [`KanalArt::is_freigeschaltet`]).
    #[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]
    pub enum KanalArt {
        Email => "email",
        Fax => "fax",
        Matrix => "matrix",
        Threema => "threema",
    }
    try_from = |s| format!("Ungültiger Kanal: {s}");
}

impl KanalArt {
    /// Ob API und Oberfläche den Kanal annehmen: E-Mail und Fax (LLH-2095).
    pub fn is_freigeschaltet(self) -> bool {
        matches!(self, KanalArt::Email | KanalArt::Fax)
    }

    /// Code der Adapter-Art, über die der Ausgangskorb diesen Kanal zustellt.
    pub fn adapter_art(self) -> Option<&'static str> {
        match self {
            KanalArt::Email => Some(crate::adapter::smtp_art::CODE),
            KanalArt::Fax => Some(crate::adapter::sipgate_fax_art::CODE),
            KanalArt::Matrix | KanalArt::Threema => None,
        }
    }
}

/// Eine Kanaladresse einer externen Stelle. Wire englisch, Rust-Feld = Wire-Feld.
#[derive(Debug, Clone, Serialize, sqlx::FromRow, ToSchema)]
pub struct ExterneStelleKanal {
    pub id: i64,
    pub externe_stelle_id: i64,
    #[sqlx(rename = "kanal", try_from = "String")]
    pub channel: KanalArt,
    #[sqlx(rename = "adresse")]
    pub address: String,
    #[sqlx(rename = "bezeichnung")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
}

/// Eine Kanaladresse samt ihrer Stelle, für die Auswahl im Senden-Dialog.
#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct KanalMitStelle {
    pub channel: ExterneStelleKanal,
    pub agency_id: i64,
    pub agency_name: String,
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
