//! Schichtplan eines Einsatzes (LLH-1552, Konzept LLH-1523; Change
//! `x9t2i7k9-planschichten-einsatz`, Spec `kraefte-schichtplan`).
//!
//! Ein Plan besteht aus **Blöcken** an einem Posten: einer Einheit des Einsatzes, einer UHS oder
//! der Zeile „Pause“. Ein Block hat Beginn, Ende, ein Soll (Kopie der Vorgabe des Postens beim
//! Anlegen) und die eingeteilten Personen: Stamm-Personal der Organisation, Ad-hoc-Kräfte des
//! Einsatzes oder **Helfer des Plans**. Wer nur im Plan steht, ist nicht im Einsatz.
//!
//! **Der Plan ist Soll.** Er setzt keine Zuordnung und keinen Status. Er gibt einer laufenden
//! Schicht die Fälligkeit ([`kopplung`], LLH-1555); das Raster zeichnet LLH-1554.
//!
//! **Prüfbefunde** ([`pruefung`]) rechnet der Server beim Lesen, rein und an einer Stelle. Sie
//! blockieren nie. Der Dienst-Befund liest nur Planblöcke. Das Ist der Kräfte-Zeitachse stuft
//! dieselbe Regel gegen dieselben [`SchichtplanGrenzwerte`] im Client ein (LLH-730, Spec
//! `kraefte-zeitachse`, „Einstufung gegen die Grenzwerte des Einsatzes“); gelesen werden sie dafür
//! über `routes::zeitachse::{einheiten,personal}_grenzwerte`, ohne das Modul Ablösung.
//!
//! **Schichten erzeugen** ([`zerlegung`]) füllt einen Zeitraum an einem Posten aus einer Länge
//! oder dem Schichtmodell des Einsatzes; alles oder nichts.

use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use crate::personal::quali_soll::QualiSoll;
use crate::personal::qualifikation_deckung::OffeneAnforderung;
use crate::wire_enum::wire_enum;

pub mod ausgabe;
pub mod kopplung;
pub mod pruefung;
pub mod repo;
pub mod uebernahme;
pub mod vollzug;
pub mod zerlegung;

/// Personen je Block, gezählt vor dem Entdoppeln (wie `abloesung::BESATZUNG_MAX`). Spiegel:
/// `SCHICHTPLAN_PERSONEN_MAX` in `frontend/src/api/eingabegrenzen.ts`.
pub const PLAN_PERSONEN_MAX: usize = 50;

/// Blöcke je Einsatz (422 darüber). Ein Abend mit 40 Posten in 2-h-Schichten über drei Tage
/// bleibt weit darunter; die Grenze hält das Lesen mit Prüfung klein.
pub const PLAN_BLOECKE_MAX: i64 = 2_000;

/// Helfer des Plans je Einsatz (422 darüber).
pub const PLAN_HELFER_MAX: i64 = 500;

/// Blöcke je „Schichten erzeugen“ (400 darüber). Spiegel: `SCHICHTPLAN_ERZEUGEN_MAX`.
pub const ERZEUGEN_MAX: usize = 100;

/// Notiz eines Blocks. Spiegel: `SCHICHTPLAN_NOTIZ_MAX`.
pub const NOTIZ_MAX: usize = 500;

/// Name und Organisation eines Helfers, wie die Ad-hoc-Kräfte. Spiegel:
/// `SCHICHTPLAN_HELFER_TEXT_MAX`.
pub const HELFER_TEXT_MAX: usize = 200;

/// Telefon eines Helfers. Spiegel: `SCHICHTPLAN_HELFER_TELEFON_MAX`.
pub const HELFER_TELEFON_MAX: usize = 50;

/// Qualifikationen eines Helfers, gezählt vor dem Entdoppeln. Spiegel:
/// `SCHICHTPLAN_HELFER_QUALIFIKATIONEN_MAX`.
pub const HELFER_QUALIFIKATIONEN_MAX: usize = 20;

/// Raster der Zeiten in Minuten (wie die Suite).
pub const RASTER_MINUTEN: i64 = 5;

/// Kürzester Block in Minuten (wie die Suite).
pub const BLOCK_MIN_MINUTEN: i64 = 10;

/// Längster Block in Minuten: ein Tag.
pub const BLOCK_MAX_MINUTEN: i64 = 1_440;

/// Ab Blockbeginn plus so vielen Minuten meldet der Plan „weicht vom Ist ab“.
pub const ABWEICHUNG_NACH_MINUTEN: i64 = 10;

/// Höchstdauer im Dienst ohne eigenen Wert des Einsatzes (wie die Suite: 12 h).
pub const MAX_DIENST_VORGABE_MINUTEN: i64 = 720;

/// Mindestruhe ohne eigenen Wert des Einsatzes (wie die Suite: 8 h).
pub const MIN_RUHE_VORGABE_MINUTEN: i64 = 480;

/// Erlaubte Höchstdauer im Dienst (DB-CHECK in `0277_einsatz_schichtplan.sql`).
pub const MAX_DIENST_BEREICH: std::ops::RangeInclusive<i64> = 60..=1_440;

/// Erlaubte Mindestruhe; 0 heißt, jede Lücke trennt die Dienststrecke.
pub const MIN_RUHE_BEREICH: std::ops::RangeInclusive<i64> = 0..=1_440;

/// Größte Soll-Anzahl eines Blocks (DB-CHECK, wie `uhs::SOLL_ANZAHL_MAX`).
pub const SOLL_ANZAHL_MAX: i64 = 200;

wire_enum! {
    /// Art eines Postens im Plan (`einsatz_planschicht.posten_art`). Wire == `as_str()`.
    #[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, ToSchema)]
    pub enum PostenArt {
        /// Eine Einheit des Einsatzes.
        Einheit => "einheit",
        /// Eine Unfallhilfsstelle.
        Uhs => "uhs",
        /// Die Zeile „Pause“: nimmt viele Personen zu verschiedenen Zeiten auf, ohne Soll.
        Pause => "pause",
    }
    try_from = |s| format!("Ungültige Art eines Postens: {s}");
}

/// Ein Posten: Art und die zur Art passende Kennung.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Posten {
    Einheit(i64),
    Uhs(i64),
    Pause,
}

impl Posten {
    pub fn art(self) -> PostenArt {
        match self {
            Posten::Einheit(_) => PostenArt::Einheit,
            Posten::Uhs(_) => PostenArt::Uhs,
            Posten::Pause => PostenArt::Pause,
        }
    }

    pub fn einheit_id(self) -> Option<i64> {
        match self {
            Posten::Einheit(id) => Some(id),
            _ => None,
        }
    }

    pub fn uhs_id(self) -> Option<i64> {
        match self {
            Posten::Uhs(id) => Some(id),
            _ => None,
        }
    }

    /// Aus den gespeicherten Spalten; `None` bei einer Zeile, die der CHECK nicht zulässt.
    pub fn aus_spalten(art: &str, einheit_id: Option<i64>, uhs_id: Option<i64>) -> Option<Self> {
        match (PostenArt::parse(art)?, einheit_id, uhs_id) {
            (PostenArt::Einheit, Some(id), None) => Some(Posten::Einheit(id)),
            (PostenArt::Uhs, None, Some(id)) => Some(Posten::Uhs(id)),
            (PostenArt::Pause, None, None) => Some(Posten::Pause),
            _ => None,
        }
    }
}

/// Ein Posten im Request: `{"art":"einheit","einheit_id":5}`, `{"art":"uhs","uhs_id":3}` oder
/// `{"art":"pause"}`. Eine unbekannte Art oder eine fehlende Kennung ist 400.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(tag = "art", rename_all = "lowercase", deny_unknown_fields)]
pub enum PostenEingabe {
    Einheit { einheit_id: i64 },
    Uhs { uhs_id: i64 },
    Pause,
}

impl From<PostenEingabe> for Posten {
    fn from(p: PostenEingabe) -> Self {
        match p {
            PostenEingabe::Einheit { einheit_id } => Posten::Einheit(einheit_id),
            PostenEingabe::Uhs { uhs_id } => Posten::Uhs(uhs_id),
            PostenEingabe::Pause => Posten::Pause,
        }
    }
}

wire_enum! {
    /// Woher eine Person im Plan kommt. Wire == `as_str()`.
    #[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, ToSchema)]
    pub enum PlanPersonArt {
        /// Stamm-Personal der Organisation, disponiert oder nicht (`personal_id`).
        Stamm => "stamm",
        /// Eine Ad-hoc-Kraft des Einsatzes ohne Stammdatenbezug (`einsatz_personal_id`).
        Einsatz => "einsatz",
        /// Ein Helfer des Plans (`helfer_id`), nicht im Einsatz.
        Helfer => "helfer",
    }
    try_from = |s| format!("Ungültige Art einer Person im Plan: {s}");
}

/// Eine Person im Plan, nach ihrer Herkunft.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub enum PlanPerson {
    Stamm(i64),
    Einsatz(i64),
    Helfer(i64),
}

impl PlanPerson {
    pub fn art(self) -> PlanPersonArt {
        match self {
            PlanPerson::Stamm(_) => PlanPersonArt::Stamm,
            PlanPerson::Einsatz(_) => PlanPersonArt::Einsatz,
            PlanPerson::Helfer(_) => PlanPersonArt::Helfer,
        }
    }

    pub fn id(self) -> i64 {
        match self {
            PlanPerson::Stamm(id) | PlanPerson::Einsatz(id) | PlanPerson::Helfer(id) => id,
        }
    }

    /// Aus den gespeicherten Spalten (genau eine gesetzt, DB-CHECK).
    pub fn aus_spalten(
        personal_id: Option<i64>,
        einsatz_personal_id: Option<i64>,
        helfer_id: Option<i64>,
    ) -> Option<Self> {
        match (personal_id, einsatz_personal_id, helfer_id) {
            (Some(id), None, None) => Some(PlanPerson::Stamm(id)),
            (None, Some(id), None) => Some(PlanPerson::Einsatz(id)),
            (None, None, Some(id)) => Some(PlanPerson::Helfer(id)),
            _ => None,
        }
    }
}

/// Eine Person im Request: `{"art":"stamm","personal_id":…}`,
/// `{"art":"einsatz","einsatz_personal_id":…}` (nur Ad-hoc) oder `{"art":"helfer","helfer_id":…}`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(tag = "art", rename_all = "lowercase", deny_unknown_fields)]
pub enum PlanPersonEingabe {
    Stamm { personal_id: i64 },
    Einsatz { einsatz_personal_id: i64 },
    Helfer { helfer_id: i64 },
}

impl From<PlanPersonEingabe> for PlanPerson {
    fn from(p: PlanPersonEingabe) -> Self {
        match p {
            PlanPersonEingabe::Stamm { personal_id } => PlanPerson::Stamm(personal_id),
            PlanPersonEingabe::Einsatz {
                einsatz_personal_id,
            } => PlanPerson::Einsatz(einsatz_personal_id),
            PlanPersonEingabe::Helfer { helfer_id } => PlanPerson::Helfer(helfer_id),
        }
    }
}

wire_enum! {
    /// Art eines Prüfbefunds (Spec `kraefte-schichtplan`, „Prüfbefunde“). Befunde blockieren nie.
    /// Wire == `as_str()`.
    #[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, ToSchema)]
    pub enum PlanBefundArt {
        /// Die Person steht in einem anderen Block mit überschneidender Zeit.
        Doppelt => "doppelt",
        /// Geforderte Qualifikationen, die die freien Plätze nicht mehr aufnehmen.
        Quali => "quali",
        /// Eine Dienststrecke ist länger als der Höchstwert des Einsatzes.
        Dienst => "dienst",
        /// Person außer Dienst oder entlassen, oder der Posten ist aufgelöst.
        Verfuegbar => "verfuegbar",
        /// Ab Blockbeginn plus 10 min ist die Person nicht am Posten.
        Abweichung => "abweichung",
    }
    try_from = |s| format!("Ungültige Art eines Prüfbefunds: {s}");
}

/// Ein Prüfbefund an einem Block oder an einer Person in einem Block.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, ToSchema)]
pub struct PlanBefund {
    #[schema(value_type = PlanBefundArt)]
    pub art: PlanBefundArt,
    /// Bei `doppelt`: der andere Block.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub anderer_block_id: Option<i64>,
    /// Bei `dienst`: Länge der Dienststrecke in Minuten.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub dauer_minuten: Option<i64>,
    /// Bei `quali`: die geforderte Qualifikation.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub qualifikation_id: Option<i64>,
    /// Bei `quali`: wie viele dieser Qualifikation fehlen.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fehlen: Option<i64>,
}

impl PlanBefund {
    pub fn nur(art: PlanBefundArt) -> Self {
        Self {
            art,
            anderer_block_id: None,
            dauer_minuten: None,
            qualifikation_id: None,
            fehlen: None,
        }
    }
}

/// Der Posten eines Blocks in der Antwort, mit Bezeichnung.
#[derive(Debug, Clone, PartialEq, Serialize, ToSchema)]
pub struct PlanPostenAnzeige {
    #[schema(value_type = PostenArt)]
    pub art: PostenArt,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub einheit_id: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub uhs_id: Option<i64>,
    /// Name der Einheit bzw. Bezeichnung der UHS; bei der Pause fehlt sie.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bezeichnung: Option<String>,
    /// Einheit aufgelöst bzw. UHS aufgelöst oder storniert.
    pub aufgeloest: bool,
}

/// Eine Person in einem Block.
#[derive(Debug, Clone, PartialEq, Serialize, ToSchema)]
pub struct PlanPersonAnzeige {
    #[schema(value_type = PlanPersonArt)]
    pub art: PlanPersonArt,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub personal_id: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub einsatz_personal_id: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub helfer_id: Option<i64>,
    pub name: String,
    /// Kennungen der Qualifikationen (Katalog der Organisation); eine Ad-hoc-Kraft hat keine.
    pub qualifikationen: Vec<i64>,
    /// Ob die Person gerade im Einsatz ist (disponiert und nicht entlassen).
    pub im_einsatz: bool,
    pub befunde: Vec<PlanBefund>,
}

/// Ein Block des Plans.
#[derive(Debug, Clone, PartialEq, Serialize, ToSchema)]
pub struct PlanBlockAnzeige {
    pub id: i64,
    /// CAS-Zähler: PATCH und DELETE senden ihn mit (409 bei einem anderen Stand).
    pub version: i64,
    pub posten: PlanPostenAnzeige,
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
    /// Ohne Freigabe des Moduls Personal `null`: dann nur die Anzahl, keine Namen.
    pub personen: Option<Vec<PlanPersonAnzeige>>,
    /// Plätze, die nach dem Soll noch frei sind.
    pub offene_plaetze: i64,
    /// Geforderte Qualifikationen, die die eingeteilten Personen nicht decken.
    pub offene_anforderungen: Vec<OffeneAnforderung>,
    /// Befunde des Blocks selbst (`quali`, `verfuegbar` des Postens).
    pub befunde: Vec<PlanBefund>,
}

/// Ein Helfer des Plans.
#[derive(Debug, Clone, PartialEq, Serialize, ToSchema)]
pub struct PlanHelferAnzeige {
    pub id: i64,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub telefon: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub organisation: Option<String>,
    pub qualifikationen: Vec<i64>,
    /// Kennung aus einer Schichtplan-Datei oder der Vorplanung, eine externe Kennung (LLH-1556);
    /// nur lesend.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub kennung: Option<String>,
    /// Herkunft der Kennung: freier Name der Quelle.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub herkunft: Option<String>,
}

/// Grenzwerte des Dienst-Befunds.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]
pub struct SchichtplanGrenzwerte {
    /// Wirksamer Höchstwert im Dienst in Minuten.
    pub max_dienst_minuten: i64,
    /// Wirksame Mindestruhe in Minuten.
    pub min_ruhe_minuten: i64,
    /// Ob der Einsatz den Höchstwert selbst setzt (sonst die Vorgabe 12 h).
    pub max_dienst_eigen: bool,
    /// Ob der Einsatz die Mindestruhe selbst setzt (sonst die Vorgabe 8 h).
    pub min_ruhe_eigen: bool,
}

impl SchichtplanGrenzwerte {
    pub fn aus(max_dienst: Option<i64>, min_ruhe: Option<i64>) -> Self {
        Self {
            max_dienst_minuten: max_dienst.unwrap_or(MAX_DIENST_VORGABE_MINUTEN),
            min_ruhe_minuten: min_ruhe.unwrap_or(MIN_RUHE_VORGABE_MINUTEN),
            max_dienst_eigen: max_dienst.is_some(),
            min_ruhe_eigen: min_ruhe.is_some(),
        }
    }
}

/// Der ganze Plan eines Einsatzes mit Befunden.
#[derive(Debug, Clone, PartialEq, Serialize, ToSchema)]
pub struct SchichtplanAnzeige {
    pub grenzwerte: SchichtplanGrenzwerte,
    /// Nach Posten (Art, Kennung) und Beginn.
    pub bloecke: Vec<PlanBlockAnzeige>,
    /// Ohne Freigabe des Moduls Personal `null`.
    pub helfer: Option<Vec<PlanHelferAnzeige>>,
    /// Nächster Zeitpunkt, an dem sich ein uhrabhängiger Befund ändert; der Client fragt dann neu.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub naechste_pruefung_at: Option<String>,
}
