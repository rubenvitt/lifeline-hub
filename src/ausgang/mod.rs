//! Ausgangskorb (LLH-2093, Spec `docs/superpowers/specs/2026-11-24-w1ymakq6-ausgang-email-design.md`
//! Abschnitt 3): die Tabelle `ausgang`, ihr Zustandsmodell, die Wiederholungsfrist und das Repo.
//! Der Lauf ([`lauf`]) stellt zu und schreibt das Ergebnis ins ETB; die Routen stehen in
//! `src/routes/ausgang.rs`. Regeln: `src/AGENTS.md`, Ausgang an Menschen.

pub mod lauf;
pub mod nachricht;
pub mod pdf;
pub mod repo;
pub mod zustand;
pub mod zusteller;

pub use zustand::{AusgangFehler, QuelleArt, VersandZustand};

use crate::externe_stelle::{ExterneStelle, ExterneStelleKanal, KanalArt};
use serde::Serialize;
use utoipa::ToSchema;

/// Ein Versand, wie ihn die Versandliste am Dokument zeigt. Wire englisch, Rust-Feld = Wire-Feld;
/// der Text (`inhalt`) steht nicht auf dem Wire.
#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct Versand {
    pub id: String,
    pub source_kind: QuelleArt,
    pub source_id: i64,
    pub channel: KanalArt,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub agency_id: Option<i64>,
    pub agency_name: String,
    pub address: String,
    pub subject: String,
    pub state: VersandZustand,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<AusgangFehler>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub smtp_status: Option<u16>,
    pub attempts: i64,
    pub created_by_id: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub created_by_name: Option<String>,
    pub created_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub handed_over_at: Option<String>,
    /// Wann der Fax-Anbieter die Zustellung bestätigt hat (nur Fax, LLH-2095).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub delivered_at: Option<String>,
    /// Die Mail ging ohne PDF hinaus, weil das PDF zu groß oder nicht erzeugbar war.
    pub without_pdf: bool,
}

/// Eine Zeile von `ausgang` mit allem, was der Lauf braucht (intern, nie auf dem Wire).
#[derive(Debug, Clone, sqlx::FromRow)]
pub struct VersandZeile {
    pub id: String,
    pub org_id: i64,
    pub einsatz_id: i64,
    pub client_id: String,
    pub quelle_art: QuelleArt,
    pub quelle_id: i64,
    #[sqlx(try_from = "String")]
    pub kanal: KanalArt,
    pub externe_stelle_id: Option<i64>,
    pub stelle_bezeichnung: String,
    pub adresse: String,
    pub betreff: String,
    pub inhalt: String,
    pub zustand: VersandZustand,
    pub versuche: i64,
    pub naechster_versuch_at: Option<String>,
    pub erster_versuch_at: Option<String>,
    pub versuch_begonnen_at: Option<String>,
    pub fehler_art: Option<AusgangFehler>,
    pub fehler_status: Option<i64>,
    pub erstellt_von_id: i64,
    pub erstellt_at: String,
    pub uebergeben_at: Option<String>,
    pub etb_eintrag_id: Option<i64>,
    /// Session-ID des Fax-Anbieters nach der Übergabe (nur Fax).
    pub anbieter_ref: Option<String>,
    pub zugestellt_at: Option<String>,
    pub naechste_abfrage_at: Option<String>,
    pub ohne_pdf: bool,
}

/// Was beim Absenden in den Korb gelegt wird. Betreff, Text, Adresse und Name der Stelle sind
/// schon geprüft und werden als Schnappschuss gespeichert.
#[derive(Debug)]
pub struct NeuerVersand<'a> {
    pub org_id: i64,
    pub einsatz_id: i64,
    pub client_id: &'a str,
    pub quelle: QuelleArt,
    pub quelle_id: i64,
    pub kanal: &'a ExterneStelleKanal,
    pub stelle: &'a ExterneStelle,
    pub betreff: &'a str,
    pub inhalt: &'a str,
    pub erstellt_von_id: i64,
}

#[cfg(test)]
mod tests;
