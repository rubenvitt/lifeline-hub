//! Vorplanung ohne Einsatz (LLH-1561/LLH-1585, Change `vu7jnr2x-vorplanung-ohne-einsatz`, Spec
//! `vorplanung`).
//!
//! Eine **Planung** ist ein Objekt der Organisation, kein Einsatz: sie steht in keiner
//! Einsatzliste, keinem Zähler und auf keinem Lagemonitor, und sie löst keine Benachrichtigung
//! aus. Sie hat **Posten** (eine spätere Einheit oder UHS, frei, aus einer Einheitenvorlage oder
//! einem Stamm-Fahrzeug), **Blöcke** an einem Posten oder an der Pause, die eingeteilten
//! **Personen** (Stamm-Personal der Organisation oder Helfer der Planung) und **Helfer**.
//!
//! Blöcke folgen denselben Regeln wie der Schichtplan im Einsatz (`abloesung::schichtplan`):
//! Raster, Dauer, keine Überschneidung je Posten außer der Pause, CAS über `version`, Soll als
//! Kopie der Vorgabe des Postens. Die **Prüfbefunde** rechnet dieselbe Prüfung
//! (`abloesung::schichtplan::pruefung`), nur ohne Ist: `abweichung` entfällt.
//!
//! Lesen und Schreiben verlangen das Recht, Einsätze anzulegen, in der eigenen Organisation
//! ([`zugriff::PlanungsZugriff`]); eine Planung einer anderen Organisation ist 404.

use serde::Serialize;
use utoipa::ToSchema;

use crate::abloesung::schichtplan::pruefung::{Block, Ergebnis};
use crate::abloesung::schichtplan::{
    PlanBefund, PlanHelferAnzeige, PlanPersonAnzeige, SchichtplanGrenzwerte,
};
use crate::einsatz::Einsatzart;
use crate::personal::quali_soll::QualiSoll;
use crate::personal::qualifikation_deckung::OffeneAnforderung;
use crate::uhs::UhsTyp;
use crate::wire_enum::wire_enum;

pub mod repo;
pub mod zugriff;

#[cfg(test)]
mod tests;

/// Bezeichnung einer Planung und eines Postens, Zeichen nach dem Trimmen. Spiegel:
/// `frontend/src/api/eingabegrenzen.ts`.
pub const BEZEICHNUNG_MAX: usize = 200;

/// Abschnitt eines Postens (Freitext). Spiegel: `eingabegrenzen.ts`.
pub const ABSCHNITT_MAX: usize = 200;

/// Ort einer Planung, wie der Einsatzort. Spiegel: `eingabegrenzen.ts`.
pub const ORT_MAX: usize = crate::einsatz::EINSATZORT_MAX;

/// Posten je Planung (422 darüber).
pub const POSTEN_MAX: i64 = 100;

/// Planungen je Organisation (422 darüber).
pub const PLANUNGEN_MAX: i64 = 200;

/// Höchstens so viele Tage zwischen Beginn und Ende einer Planung.
pub const ZEITRAUM_MAX_TAGE: i64 = 14;

/// Eine Planung wird so viele Tage nach dem Ende ihres Zeitraums gelöscht, übernommen oder nicht
/// (Spec `vorplanung`, „Aufbewahrung der Planung“).
pub const AUFBEWAHRUNG_TAGE: i64 = 90;

/// Die Liste rechnet die Kennzahlen einer Planung, deren Ende höchstens so viele Tage zurückliegt
/// (design.md D7); ältere zeigen keine.
pub const KENNZAHLEN_TAGE: i64 = 7;

wire_enum! {
    /// Art eines Postens der Planung (`planung_posten.art`). Wire == `as_str()`.
    #[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, ToSchema)]
    pub enum PlanungPostenArt {
        /// Wird bei der Übernahme eine Einheit.
        Einheit => "einheit",
        /// Wird bei der Übernahme eine Unfallhilfsstelle.
        Uhs => "uhs",
    }
    try_from = |s| format!("Ungültige Art eines Postens: {s}");
}

/// Soll, Ist, Offen und Konflikte einer Planung (design.md D7), gerechnet aus denselben Befunden
/// wie die Planung selbst.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, ToSchema)]
pub struct PlanungKennzahlen {
    /// Summe des Solls aller Blöcke an Posten (ohne Pause).
    pub soll: i64,
    /// Eingeteilte Personen in diesen Blöcken, je Block höchstens bis zum Soll.
    pub ist: i64,
    /// Summe der offenen Plätze.
    pub offen: i64,
    /// Befunde an Personen in Blöcken und an Blöcken.
    pub konflikte: i64,
}

/// Rechnet die Kennzahlen aus den geprüften Blöcken. Das Soll eines Blocks ist dasselbe wie in
/// der Prüfung: die Soll-Anzahl, mindestens die Summe des Qualifikationssolls.
pub fn kennzahlen(bloecke: &[Block], ergebnis: &Ergebnis) -> PlanungKennzahlen {
    let mut k = PlanungKennzahlen::default();
    for b in bloecke {
        let e = ergebnis.bloecke.get(&b.id);
        if let Some(e) = e {
            k.konflikte += e.befunde.len() as i64;
            k.konflikte += e.personen.values().map(|l| l.len() as i64).sum::<i64>();
        }
        if b.posten == crate::abloesung::schichtplan::Posten::Pause {
            continue;
        }
        let gefordert: i64 = b.quali_soll.iter().map(|a| a.anzahl).sum();
        let soll = b.soll_anzahl.unwrap_or(0).max(gefordert);
        let anzahl = b.personen.len() as i64;
        k.soll += soll;
        k.ist += anzahl.min(soll);
        k.offen += e.map_or((soll - anzahl).max(0), |e| e.offene_plaetze);
    }
    k
}

/// Kopf einer Planung.
#[derive(Debug, Clone, PartialEq, Serialize, ToSchema)]
pub struct PlanungKopf {
    pub id: i64,
    /// CAS-Zähler des Kopfs: PATCH sendet ihn mit (409 bei einem anderen Stand).
    pub version: i64,
    pub bezeichnung: String,
    #[schema(value_type = Einsatzart)]
    pub einsatzart: Einsatzart,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ort: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ort_lat: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ort_lon: Option<f64>,
    pub von: String,
    pub bis: String,
    pub grenzwerte: SchichtplanGrenzwerte,
    /// Wann der Aufbewahrungslauf die Planung löscht ([`AUFBEWAHRUNG_TAGE`] nach `bis`).
    pub loeschung_at: String,
    pub angelegt_at: String,
}

/// Eine Zeile der Liste der Planungen.
#[derive(Debug, Clone, PartialEq, Serialize, ToSchema)]
pub struct PlanungListeneintrag {
    pub id: i64,
    pub bezeichnung: String,
    #[schema(value_type = Einsatzart)]
    pub einsatzart: Einsatzart,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ort: Option<String>,
    pub von: String,
    pub bis: String,
    pub posten_anzahl: i64,
    pub bloecke_anzahl: i64,
    /// Fehlt, wenn das Ende länger als [`KENNZAHLEN_TAGE`] zurückliegt.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub kennzahlen: Option<PlanungKennzahlen>,
    pub loeschung_at: String,
}

/// Ein Posten der Planung.
#[derive(Debug, Clone, PartialEq, Serialize, ToSchema)]
pub struct PlanungPostenAnzeige {
    pub id: i64,
    pub bezeichnung: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub abschnitt: Option<String>,
    #[schema(value_type = PlanungPostenArt)]
    pub art: PlanungPostenArt,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub einheit_vorlage_id: Option<i64>,
    /// Name der Einheitenvorlage.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub einheit_vorlage_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fahrzeug_id: Option<i64>,
    /// Funkrufname des Stamm-Fahrzeugs.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fahrzeug_funkrufname: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[schema(value_type = Option<UhsTyp>)]
    pub uhs_typ: Option<UhsTyp>,
    pub sortier: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub schichtlaenge_minuten: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub soll_anzahl: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[schema(value_type = Option<Vec<crate::personal::quali_soll::QualiSollEintrag>>)]
    pub quali_soll: Option<QualiSoll>,
    /// Stamm-Fahrzeug außer Dienst oder Einheitenvorlage gelöscht.
    pub nicht_verfuegbar: bool,
}

/// Ein Block der Planung, in der Form von `PlanBlockAnzeige` des Einsatzes.
#[derive(Debug, Clone, PartialEq, Serialize, ToSchema)]
pub struct PlanungBlockAnzeige {
    pub id: i64,
    /// CAS-Zähler: PATCH und DELETE senden ihn mit (409 bei einem anderen Stand).
    pub version: i64,
    /// Der Posten; `null` = die Zeile „Pause“.
    #[schema(required)]
    pub posten_id: Option<i64>,
    pub von: String,
    pub bis: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub soll_anzahl: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[schema(value_type = Option<Vec<crate::personal::quali_soll::QualiSollEintrag>>)]
    pub quali_soll: Option<QualiSoll>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub notiz: Option<String>,
    pub personen_anzahl: i64,
    /// Stamm-Personal und Helfer; `im_einsatz` ist hier immer `false`.
    pub personen: Vec<PlanPersonAnzeige>,
    /// Plätze, die nach dem Soll noch frei sind.
    pub offene_plaetze: i64,
    /// Geforderte Qualifikationen, die die eingeteilten Personen nicht decken.
    pub offene_anforderungen: Vec<OffeneAnforderung>,
    /// Befunde des Blocks selbst (`quali`, `verfuegbar` des Postens).
    pub befunde: Vec<PlanBefund>,
}

/// Die ganze Planung mit Befunden und Kennzahlen.
#[derive(Debug, Clone, PartialEq, Serialize, ToSchema)]
pub struct PlanungAnzeige {
    pub kopf: PlanungKopf,
    /// Nach `sortier`.
    pub posten: Vec<PlanungPostenAnzeige>,
    /// Nach Posten (Reihenfolge, Pause zuletzt) und Beginn.
    pub bloecke: Vec<PlanungBlockAnzeige>,
    pub helfer: Vec<PlanHelferAnzeige>,
    pub kennzahlen: PlanungKennzahlen,
}
