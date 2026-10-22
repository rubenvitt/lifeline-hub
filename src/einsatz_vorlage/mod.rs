//! Stammdaten-Katalog „Einsatz-Vorlagen“ je Organisation (LLH-1375, Spec
//! `openspec/specs/einsatz-vorlagen`). Eine Vorlage ist ein Modulsatz mit optionaler Einsatzart:
//! beim Anlegen eines Einsatzes schreibt sie für jedes ausgeblendete Modul einen eigenen
//! Einsatzwert `sichtbar = 0` (`einsatz::repo::anlegen_tx`). Sie blendet nur aus, nie ein.
//!
//! Gespeichert werden die **ausgeblendeten** Module (`einsatz_vorlage_modul_aus`), nicht die
//! sichtbaren: ein neu hinzukommendes Modul ist so in jeder Vorlage sichtbar, wie ohne Vorlage
//! auch. Spaltet eine spätere Migration ein Modul auf (wie 0224 Evakuierung aus Betreuung),
//! übernimmt sie die Ausblendungen auch in `einsatz_vorlage_modul_aus`.

pub mod repo;

use crate::einsatz::modul::{ist_ausblendbar, ist_gueltiger_modul_key, MODUL_KEYS};
use crate::einsatz::Einsatzart;
use crate::error::AppError;
use serde::Serialize;
use utoipa::ToSchema;

/// Höchstlänge der Bezeichnung nach dem Trimmen (`src/AGENTS.md`, „Eingabegrenzen“).
pub const BEZEICHNUNG_MAX: usize = 100;

/// Eine Einsatz-Vorlage der Organisation. `ausgeblendet` sind die Modulschlüssel, die ein mit ihr
/// angelegter Einsatz als eigenen Wert ausblendet, in der Reihenfolge von `MODUL_KEYS`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, ToSchema)]
pub struct EinsatzVorlage {
    pub id: i64,
    pub bezeichnung: String,
    /// Einsatzart, die der Anlegedialog vorbelegt; fehlt, wenn die Vorlage keine vorgibt.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub einsatzart: Option<Einsatzart>,
    pub ausgeblendet: Vec<String>,
    pub sortier: i64,
}

/// Module, die jede mitgelieferte Vorlage zeigt (design.md D4, „Kern“).
pub const KERN_MODULE: [&str; 11] = [
    "ueberblick",
    "einsatzdaten",
    "einsatz-einstellungen",
    "etb",
    "auftraege",
    "kraefteuebersicht",
    "einheiten",
    "fahrzeuge",
    "lagekarte",
    "meldungen",
    "erinnerungen",
];

/// Eine Vorlage der Startliste: sichtbar sind [`KERN_MODULE`] und `zusaetzlich`, ausgeblendet
/// jedes andere ausblendbare Modul ([`StartVorlage::ausgeblendet`]).
#[derive(Debug, Clone, Copy)]
pub struct StartVorlage {
    pub bezeichnung: &'static str,
    pub einsatzart: Einsatzart,
    pub sortier: i64,
    pub zusaetzlich: &'static [&'static str],
}

impl StartVorlage {
    /// Sichtbare Module: Kern und Zusätze.
    pub fn sichtbar(&self) -> Vec<&'static str> {
        KERN_MODULE
            .iter()
            .chain(self.zusaetzlich.iter())
            .copied()
            .collect()
    }

    /// Ausgeblendete Module in der Reihenfolge von `MODUL_KEYS`: jedes ausblendbare Modul, das
    /// nicht sichtbar ist.
    pub fn ausgeblendet(&self) -> Vec<&'static str> {
        let sichtbar = self.sichtbar();
        MODUL_KEYS
            .iter()
            .copied()
            .filter(|k| ist_ausblendbar(k) && !sichtbar.contains(k))
            .collect()
    }
}

/// Mitgelieferte Vorlagen je Organisation (design.md D4). Neue Organisationen bekommen sie in
/// `bootstrap_admin`, bestehende per `migrations/0236_einsatz_vorlage.sql` — beide synchron
/// halten (Netz: `db::tests::migration_0234_seedet_die_startliste`).
pub const EINSATZ_VORLAGE_STARTLISTE: [StartVorlage; 6] = [
    StartVorlage {
        bezeichnung: "Kleinlage",
        einsatzart: Einsatzart::Realeinsatz,
        sortier: 10,
        zusaetzlich: &["personal", "dokumente", "gefahrenzonen"],
    },
    StartVorlage {
        bezeichnung: "Sanitätsdienst",
        einsatzart: Einsatzart::Sanitaetsdienst,
        sortier: 20,
        zusaetzlich: &[
            "personal",
            "dokumente",
            "chat",
            "einsatzabschnitte",
            "personen",
            "unfallhilfsstellen",
            "material",
            "verpflegung",
            "abloesung",
            "nachforderungen",
            "lage-dashboard",
        ],
    },
    StartVorlage {
        bezeichnung: "MANV",
        einsatzart: Einsatzart::Realeinsatz,
        sortier: 30,
        zusaetzlich: &[
            "personal",
            "dokumente",
            "gefahrenzonen",
            "chat",
            "einsatzabschnitte",
            "personen",
            "unfallhilfsstellen",
            "material",
            "abloesung",
            "nachforderungen",
            "lage-dashboard",
            "bereitstellungsraeume",
            "lageberichte",
            "lagemeldungen",
            "lagebesprechung",
            "fernmeldewesen",
        ],
    },
    StartVorlage {
        bezeichnung: "Personensuche",
        einsatzart: Einsatzart::Realeinsatz,
        sortier: 40,
        zusaetzlich: &[
            "personal",
            "dokumente",
            "chat",
            "einsatzabschnitte",
            "personen",
            "verpflegung",
            "abloesung",
            "nachforderungen",
            "lage-dashboard",
            "bereitstellungsraeume",
            "lagemeldungen",
            "lagebesprechung",
            "fernmeldewesen",
            "wetter-pegel",
        ],
    },
    StartVorlage {
        bezeichnung: "Evakuierung und Betreuung",
        einsatzart: Einsatzart::Realeinsatz,
        sortier: 50,
        zusaetzlich: &[
            "personal",
            "dokumente",
            "gefahrenzonen",
            "chat",
            "einsatzabschnitte",
            "personen",
            "material",
            "verpflegung",
            "abloesung",
            "nachforderungen",
            "lage-dashboard",
            "bereitstellungsraeume",
            "lageberichte",
            "lagemeldungen",
            "lagebesprechung",
            "fernmeldewesen",
            "evakuierung",
            "betreuung",
            "tiere",
        ],
    },
    StartVorlage {
        bezeichnung: "Unwetter",
        einsatzart: Einsatzart::Realeinsatz,
        sortier: 60,
        zusaetzlich: &[
            "personal",
            "dokumente",
            "gefahrenzonen",
            "chat",
            "einsatzabschnitte",
            "material",
            "verpflegung",
            "abloesung",
            "nachforderungen",
            "lage-dashboard",
            "bereitstellungsraeume",
            "lageberichte",
            "lagemeldungen",
            "lagebesprechung",
            "fernmeldewesen",
            "wetter-pegel",
            "schaeden",
        ],
    },
];

/// Ausgeblendete Module von außen: entdoppelt, jeder Schlüssel bekannt (sonst 400) und
/// ausblendbar (sonst 400), geordnet wie `MODUL_KEYS`. Geprüft wird ohne Datenbank, die Menge ist
/// danach höchstens so groß wie die Registry.
pub fn normalize_ausgeblendet(keys: &[String]) -> Result<Vec<&'static str>, AppError> {
    for key in keys {
        if !ist_gueltiger_modul_key(key) {
            return Err(AppError::Validation(format!(
                "Unbekannter Modulschlüssel '{key}'"
            )));
        }
        if !ist_ausblendbar(key) {
            return Err(AppError::Validation(format!(
                "Das Modul '{key}' lässt sich nicht ausblenden"
            )));
        }
    }
    Ok(MODUL_KEYS
        .iter()
        .copied()
        .filter(|k| keys.iter().any(|g| g == k))
        .collect())
}

#[cfg(test)]
mod tests;
