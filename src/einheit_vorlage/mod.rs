//! Stammdaten-Katalog „Einheiten-Vorlagen“ je Organisation (LLH-1042): stehende Einheiten wie
//! Löschzug, SEG oder Sanitätszug mit Untereinheiten, Stamm-Fahrzeugen und optionaler
//! Stammbesetzung. Die Vorlage ist ein Vorschlag; gebildet und disponiert wird erst im Einsatz
//! (LLH-1049, über [`repo::load_tree_tx`]).
//!
//! Regeln (Spec `openspec/specs/einheit-vorlagen`):
//! - Untereinheiten über `ueber_vorlage_id`, beliebig tief, ohne Zyklen (422; Requirement
//!   „Untereinheiten“).
//! - Ein Fahrzeug, eine Person steht im selben Vorlagen-Baum höchstens einmal (422); über Bäume
//!   hinweg erlaubt, die Antwort nennt die anderen aktiven Vorlagen unter `auch_in`.
//! - Neu zuordnen nur, was in Dienst steht (422); ein später außer Dienst gestelltes bleibt und
//!   meldet seinen `dienststatus`.
//! - Fahrzeuge und Stammbesetzung werden je als ganze Liste ersetzt (diese drei: Requirement
//!   „Fahrzeuge und Stammbesetzung der Vorlage“).

pub mod repo;

use crate::staerke::{Staerke, StaerkePosition};
use serde::Serialize;
use utoipa::ToSchema;

/// Höchstlänge des Namens nach dem Trimmen (`src/AGENTS.md`, „Eingabegrenzen“). Der Name
/// gelangt beim Bilden (LLH-1049) in den ETB-Text „Einheit «…» gebildet“ und bleibt damit weit
/// unter `etb::PARTEI_MAX`.
pub const NAME_MAX: usize = 200;

/// Höchstlänge des Funkrufnamens nach dem Trimmen.
pub const FUNKRUFNAME_MAX: usize = 100;

/// Höchstlänge der Bemerkung nach dem Trimmen.
pub const BEMERKUNG_MAX: usize = 2_000;

/// Höchstlänge eines Schlüssels des taktischen Zeichens (Fachaufgabe, Organisation). Die Werte
/// kommen aus einer Auswahl; die Grenze hält nur Unsinn ab.
pub const TZ_MAX: usize = 100;

/// Höchstzahl Fahrzeuge je Vorlage im Request (nach dem Entdoppeln), sonst 400.
pub const FAHRZEUGE_JE_VORLAGE_MAX: usize = 50;

/// Höchstzahl Personen der Stammbesetzung je Vorlage im Request (nach dem Entdoppeln), sonst 400.
pub const PERSONAL_JE_VORLAGE_MAX: usize = 200;

/// Eine Einheiten-Vorlage mit ihren Fahrzeugen und ihrer Stammbesetzung. Die Liste trägt alles;
/// die Detailseite braucht keinen Einzel-GET (Spec `einheit-vorlagen`, „Pflege in der
/// Verwaltung“).
#[derive(Debug, Clone, PartialEq, Serialize, ToSchema)]
pub struct EinheitVorlage {
    pub id: i64,
    pub name: String,
    pub typ_id: i64,
    pub typ_label: String,
    /// Übergeordnete Vorlage; fehlt bei einer Wurzel.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ueber_vorlage_id: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub funkrufname: Option<String>,
    /// Fachaufgabe des taktischen Zeichens (Schlüssel wie `einsatz_einheit.tz_fachaufgabe`).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tz_fachaufgabe: Option<String>,
    /// Organisation des taktischen Zeichens.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tz_organisation: Option<String>,
    /// Wirksames Soll: das eigene, sonst das des Einheitstyps; fehlt, wenn keins gilt.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub soll: Option<Staerke>,
    /// Ob [`Self::soll`] das eigene Soll der Vorlage ist (sonst das des Typs).
    pub soll_eigen: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bemerkung: Option<String>,
    pub sortier: i64,
    pub aktiv: bool,
    /// Trägt die Zeile eine Demo-Marke (Spec `demo-daten`)? Live aus `demo_herkunft`.
    pub ist_demo: bool,
    pub fahrzeuge: Vec<EinheitVorlageFahrzeug>,
    pub personal: Vec<EinheitVorlagePersonal>,
}

/// Ein Stamm-Fahrzeug einer Vorlage.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, ToSchema)]
pub struct EinheitVorlageFahrzeug {
    pub fahrzeug_id: i64,
    pub funkrufname: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fahrzeugtyp: Option<String>,
    /// Dienststatus im Stamm; ein später außer Dienst gestelltes Fahrzeug bleibt in der Vorlage.
    #[schema(value_type = crate::katalog::Dienststatus)]
    pub dienststatus: String,
    pub ist_demo: bool,
    /// Andere aktive Vorlagen, in denen das Fahrzeug ebenfalls steht (abgeleitet beim Lesen).
    pub auch_in: Vec<i64>,
}

/// Eine Person der Stammbesetzung.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, ToSchema)]
pub struct EinheitVorlagePersonal {
    pub personal_id: i64,
    pub name: String,
    /// Position in der Vorlage; fehlt, wenn die Stamm-Vorgabe der Person gilt.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub staerke_position: Option<StaerkePosition>,
    /// Fahrzeug der Vorlage, auf dem die Person sitzt; fehlt ohne Bindung.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fahrzeug_id: Option<i64>,
    #[schema(value_type = crate::katalog::Dienststatus)]
    pub dienststatus: String,
    pub ist_demo: bool,
    /// Andere aktive Vorlagen, in denen die Person ebenfalls steht.
    pub auch_in: Vec<i64>,
}

/// Fahrzeug-Liste von außen: entdoppelt in der Reihenfolge des ersten Vorkommens, höchstens
/// [`FAHRZEUGE_JE_VORLAGE_MAX`] (sonst 400). Die Reihenfolge ist die Anzeigereihenfolge.
pub fn normalize_fahrzeug_ids(ids: Vec<i64>) -> Result<Vec<i64>, crate::error::AppError> {
    let mut gesehen = std::collections::HashSet::new();
    let ids: Vec<i64> = ids.into_iter().filter(|id| gesehen.insert(*id)).collect();
    if ids.len() > FAHRZEUGE_JE_VORLAGE_MAX {
        return Err(crate::error::AppError::Validation(format!(
            "Höchstens {FAHRZEUGE_JE_VORLAGE_MAX} Fahrzeuge je Vorlage"
        )));
    }
    Ok(ids)
}

/// Eine Person der Stammbesetzung im Request, schon geparst.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PersonalEntry {
    pub personal_id: i64,
    pub fahrzeug_id: Option<i64>,
    pub staerke_position: Option<StaerkePosition>,
}

/// Stammbesetzung von außen: je Person der erste Eintrag, höchstens
/// [`PERSONAL_JE_VORLAGE_MAX`] (sonst 400).
pub fn normalize_personal(
    entries: Vec<PersonalEntry>,
) -> Result<Vec<PersonalEntry>, crate::error::AppError> {
    let mut gesehen = std::collections::HashSet::new();
    let entries: Vec<PersonalEntry> = entries
        .into_iter()
        .filter(|e| gesehen.insert(e.personal_id))
        .collect();
    if entries.len() > PERSONAL_JE_VORLAGE_MAX {
        return Err(crate::error::AppError::Validation(format!(
            "Höchstens {PERSONAL_JE_VORLAGE_MAX} Personen je Vorlage"
        )));
    }
    Ok(entries)
}

#[cfg(test)]
mod tests;
