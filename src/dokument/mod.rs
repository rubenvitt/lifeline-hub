//! Dokumentenablage eines Einsatzes (LFH-632): hochgeladene Dateien mit Kategorie, Titel
//! und optionalem Bezug. Die Bytes liegen in `anhang` (Scan, ETag, Backup, Schwärzung);
//! `einsatz_dokument` ist der zweite Linker darauf — siehe `anhang::repo::LinkerStand`.
//!
//! Nur hochgeladene Dateien, keine Verweise auf Lageberichte/Befehle (Entscheidung E3).

use crate::wire_enum::wire_enum;
use serde::Serialize;
use utoipa::ToSchema;

pub mod repo;

/// Höchstlänge des Titels (Zeichen, nach `trim`).
pub const TITEL_MAX: usize = 200;

wire_enum! {
    /// Kategorie eines abgelegten Dokuments. Wire == `as_str()`; `ALLE` ist zugleich die
    /// Anzeigereihenfolge (Vertrag, nicht Dekoration).
    #[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]
    pub enum DokumentKategorie {
        LagekartePlan => "lagekarte_plan",
        Befehl => "befehl",
        Formular => "formular",
        Foto => "foto",
        Sonstiges => "sonstiges",
    }
}

impl DokumentKategorie {
    /// Anzeige-Label (ETB-Text). Das FE hält sein eigenes Label (`dokumente/kategorien.ts`).
    pub fn label(&self) -> &'static str {
        match self {
            DokumentKategorie::LagekartePlan => "Lagekarte/Plan",
            DokumentKategorie::Befehl => "Befehl",
            DokumentKategorie::Formular => "Formular",
            DokumentKategorie::Foto => "Foto",
            DokumentKategorie::Sonstiges => "Sonstiges",
        }
    }
}

/// Öffentliche Darstellung eines Dokuments (ohne Bytes).
#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct DokumentAnzeige {
    pub id: i64,
    pub einsatz_id: i64,
    pub kategorie: DokumentKategorie,
    pub titel: String,
    pub dateiname: String,
    pub mime: String,
    pub groesse: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bezug_abschnitt_id: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bezug_abschnitt_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bezug_einheit_id: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bezug_einheit_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bezug_etb_eintrag_id: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bezug_etb_lfd_nr: Option<i64>,
    pub etb_eintrag_id: i64,
    pub abgelegt_von_id: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub abgelegt_von_name: Option<String>,
    pub abgelegt_at: String,
}

/// Der optionale Bezug, validiert (höchstens eines, Enum geprüft).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Bezug {
    Abschnitt(i64),
    Einheit(i64),
    EtbEintrag(i64),
}
