//! Spiegel und Anträge (LLH-1492, Change `polrv1lt-spiegel-antraege`, Specs `einsatz-spiegel` und
//! `spiegel-antraege`): Eine gekoppelte Instanz, die einen Einsatz nicht führt, hält ihn als
//! Lesekopie in denselben Tabellen wie ihre eigenen Einsätze. Nachgeholt wird über den Stand im
//! Änderungslog je Einsatz; geschrieben wird am Spiegel nur als Antrag an den Führer.
//!
//! - [`art`]: welche Tabellen gespiegelt werden, ihre Kategorie und die Trigger (D1, D3, D10).
//!
//! Änderungslog und Schreibschutz sitzen in Triggern, damit kein Schreibweg sie umgeht.

pub mod abbildung;
pub mod abgleich;
pub mod art;
pub mod liefern;
pub mod paket;
pub mod schema;
pub mod takt;
pub mod uebernehmen;

use crate::wire_enum::wire_enum;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

/// Schließt Stellvertreter fremder Konten aus (design.md D5, Nachtrag 10.11.2026): sie sind keine
/// Personen dieser Instanz, erscheinen in keiner Verwaltung und werden nie Mitglied. Erwartet den
/// Alias `b` für `benutzer`.
pub const OHNE_STELLVERTRETER: &str =
    "NOT EXISTS (SELECT 1 FROM spiegel_konto sk WHERE sk.benutzer_id = b.id)";

/// Nachricht, mit der die Schutz-Trigger abbrechen; `AppError` macht daraus 409 (D10).
pub const SCHUTZ_NACHRICHT: &str = "einsatz_ist_spiegel";

wire_enum! {
    /// Kategorie einer gespiegelten Zeile (Spec `einsatz-spiegel`, „Kategorie je Zeile“). Auf der
    /// Leitung steht sie an jeder Zeile, damit sparsamere Freigabestufen später ohne Protokollbruch
    /// kommen können (Entscheidung 14).
    #[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize, ToSchema)]
    pub enum SpiegelKategorie {
        Fuehrung => "fuehrung",
        Etb => "etb",
        Lage => "lage",
        Kraefte => "kraefte",
        Personen => "personen",
        Betreuung => "betreuung",
        Kommunikation => "kommunikation",
        Anhaenge => "anhaenge",
    }
}

wire_enum! {
    /// Freigabestufe eines Einsatzes (D2): welche Kategorien gespiegelt werden. Gebaut ist nur
    /// `alles`; eine spiegelnde Seite übernimmt einen Einsatz mit unbekannter Stufe nicht weiter.
    #[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, ToSchema)]
    pub enum Freigabestufe {
        Alles => "alles",
    }
}

#[cfg(test)]
mod tests;
