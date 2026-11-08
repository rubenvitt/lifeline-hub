//! Übernahme eines Schichtplans in den Einsatz (LLH-1556, Change
//! `kwyb1rwb-schichtplan-datei-einlesen`, Spec `kraefte-schichtplan`, „Schichtplan einlesen“).
//!
//! **Ein Kern, zwei Quellen.** Eine Schichtplan-Datei ([`datei`]) und später die Vorplanung der
//! Organisation (LLH-1561) liefern dasselbe [`PlanPaket`]: Posten, Blöcke und Personen, noch
//! ohne Bezug zum Einsatz. [`repo::vorschau`] gleicht das Paket mit dem Einsatz ab
//! ([`abgleich`]) und schreibt nichts; [`repo::uebernehmen`] schreibt es in EINER Transaktion,
//! alles oder nichts.
//!
//! **Wiederholbar** (design.md D6): Ein Block mit gleichem Posten, Beginn und Ende bleibt und
//! nimmt nur fehlende Personen auf. Nichts wird gelöscht oder überschrieben; dieselbe Datei ein
//! zweites Mal ändert nichts.
//!
//! **Nur Soll.** Das Einlesen alarmiert niemanden, disponiert nichts und setzt keinen Status.
//! Neue Personen werden Helfer des Plans mit Kennung und Herkunft, kein Stamm-Personal
//! (design.md D5, Freigabe Ruben 08.11.2026).

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use crate::uhs::UhsTyp;
use crate::wire_enum::wire_enum;

pub mod abgleich;
pub mod datei;
pub mod repo;

/// Größte Datei in Bytes (400 darüber). Spiegel: `SCHICHTPLAN_DATEI_MAX_BYTES` in
/// `frontend/src/api/eingabegrenzen.ts`.
pub const DATEI_MAX_BYTES: usize = 2 * 1024 * 1024;

/// Größte Zahl an Zeilen einer Datei ohne Kopfzeile (400 darüber).
pub const ZEILEN_MAX: usize = 5_000;

/// Entpackte Größe aller Teile einer XLSX (400 darüber): schützt vor einer Zip-Bombe.
pub const XLSX_ENTPACKT_MAX_BYTES: u64 = 64 * 1024 * 1024;

/// Externe Kennung einer Person.
pub const KENNUNG_MAX: usize = 100;

/// Herkunft einer Kennung: freier Name der Quelle.
pub const HERKUNFT_MAX: usize = 100;

/// Name eines Postens oder Abschnitts in der Datei.
pub const POSTEN_TEXT_MAX: usize = 200;

/// Entscheidungen je Art in einer Anfrage (400 darüber).
pub const ENTSCHEIDUNGEN_MAX: usize = ZEILEN_MAX;

wire_enum! {
    /// Art eines Postens im Paket. `fahrzeug` sucht wie `einheit` eine Einheit, auch über ihren
    /// Funkrufnamen. Wire == `as_str()`.
    #[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, ToSchema)]
    pub enum PaketPostenArt {
        Einheit => "einheit",
        Fahrzeug => "fahrzeug",
        Uhs => "uhs",
        Pause => "pause",
    }
    try_from = |s| format!("Ungültige Art eines Postens: {s}");
}

/// Ein Posten des Pakets, noch ohne Bezug zum Einsatz.
#[derive(Debug, Clone, PartialEq)]
pub struct PaketPosten {
    /// Eindeutig im Paket; Blöcke verweisen darauf.
    pub schluessel: String,
    pub art: PaketPostenArt,
    /// Name der Einheit bzw. Bezeichnung der UHS; bei der Pause leer.
    pub name: String,
    /// Name oder Kurzbezeichnung eines Einsatzabschnitts.
    pub abschnitt: Option<String>,
    /// Vorlage für einen neuen Posten (LLH-1561); aus der Datei nie.
    pub einheit_vorlage_id: Option<i64>,
    /// Stamm-Fahrzeug des Postens (LLH-1561). Wird nicht disponiert, nur verglichen.
    pub fahrzeug_id: Option<i64>,
    /// Typ einer neuen UHS; ohne `sonstige`.
    pub uhs_typ: Option<UhsTyp>,
    /// Reihenfolge einer neuen Einheit; ohne hinter den vorhandenen.
    pub sortier: Option<i64>,
    /// Zeilen der Datei, die den Posten nennen (für die Vorschau).
    pub zeilen: Vec<u32>,
}

/// Eine Qualifikation im Paket: aus dem Katalog der Organisation (LLH-1561) oder als
/// Bezeichnung aus der Datei.
#[derive(Debug, Clone, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub enum QualiAngabe {
    Id(i64),
    Bezeichnung(String),
}

/// Ein Eintrag des Qualifikationssolls im Paket.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PaketQualiSoll {
    pub qualifikation: QualiAngabe,
    pub anzahl: i64,
}

/// Ein Block des Pakets.
#[derive(Debug, Clone, PartialEq)]
pub struct PaketBlock {
    /// Schlüssel des Postens.
    pub posten: String,
    /// Kanonisches UTC-Format (`src/zeit.rs`), Raster und Länge schon geprüft.
    pub von: String,
    pub bis: String,
    /// Fehlt = Vorgabe des Postens.
    pub soll_anzahl: Option<i64>,
    /// Fehlt = Vorgabe des Postens.
    pub quali_soll: Option<Vec<PaketQualiSoll>>,
    pub notiz: Option<String>,
    /// Schlüssel der Personen.
    pub personen: Vec<String>,
    /// Erste Zeile der Datei, die den Block nennt.
    pub zeile: Option<u32>,
}

/// Angaben zu einer Person, die der Abgleich sucht oder neu anlegt.
#[derive(Debug, Clone, PartialEq, Default)]
pub struct PersonAngabe {
    pub schluessel: String,
    pub nachname: String,
    pub vorname: Option<String>,
    pub telefon: Option<String>,
    pub organisation: Option<String>,
    pub qualifikationen: Vec<QualiAngabe>,
    pub kennung: Option<String>,
    pub herkunft: Option<String>,
    pub zeilen: Vec<u32>,
}

impl PersonAngabe {
    /// „Vorname Nachname“, wie ein neuer Helfer heißt.
    pub fn anzeigename(&self) -> String {
        match self.vorname.as_deref().filter(|v| !v.is_empty()) {
            Some(v) => format!("{v} {}", self.nachname),
            None => self.nachname.clone(),
        }
    }
}

/// Eine Person des Pakets.
#[derive(Debug, Clone, PartialEq)]
pub enum PaketPerson {
    /// Fester Bezug auf Stamm-Personal (LLH-1561); der Abgleich fasst ihn nicht an.
    Stamm {
        schluessel: String,
        personal_id: i64,
    },
    /// Angaben, die der Abgleich zuordnet.
    Angabe(PersonAngabe),
}

impl PaketPerson {
    pub fn schluessel(&self) -> &str {
        match self {
            PaketPerson::Stamm { schluessel, .. } => schluessel,
            PaketPerson::Angabe(a) => &a.schluessel,
        }
    }
}

/// Grenzwerte des Dienst-Befunds aus der Vorplanung (LLH-1561); gesetzt nur, solange der
/// Einsatz keine eigenen hat.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct PaketGrenzwerte {
    pub max_dienst_min: Option<i64>,
    pub min_ruhe_min: Option<i64>,
}

/// Ein Plan, noch ohne Bezug zum Einsatz.
#[derive(Debug, Clone, PartialEq, Default)]
pub struct PlanPaket {
    pub grenzwerte: Option<PaketGrenzwerte>,
    pub posten: Vec<PaketPosten>,
    pub bloecke: Vec<PaketBlock>,
    pub personen: Vec<PaketPerson>,
}

// ---------------------------------------------------------------------------------------------
// Meldungen
// ---------------------------------------------------------------------------------------------

wire_enum! {
    /// Stufe einer Meldung der Vorschau. Ein Fehler sperrt das Übernehmen. Wire == `as_str()`.
    #[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, ToSchema)]
    pub enum MeldungStufe {
        Fehler => "fehler",
        Hinweis => "hinweis",
    }
    try_from = |s| format!("Ungültige Stufe einer Meldung: {s}");
}

/// Ein Fehler oder Hinweis, mit der Zeile der Datei, wenn es eine gibt.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, ToSchema)]
pub struct ImportMeldung {
    #[schema(value_type = MeldungStufe)]
    pub stufe: MeldungStufe,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub zeile: Option<u32>,
    pub text: String,
}

impl ImportMeldung {
    pub fn fehler(zeile: Option<u32>, text: impl Into<String>) -> Self {
        Self {
            stufe: MeldungStufe::Fehler,
            zeile,
            text: text.into(),
        }
    }

    pub fn hinweis(zeile: Option<u32>, text: impl Into<String>) -> Self {
        Self {
            stufe: MeldungStufe::Hinweis,
            zeile,
            text: text.into(),
        }
    }
}

// ---------------------------------------------------------------------------------------------
// Entscheidungen (Request)
// ---------------------------------------------------------------------------------------------

/// Wohin ein Posten des Pakets geht.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(tag = "art", rename_all = "lowercase", deny_unknown_fields)]
pub enum PostenEntscheidung {
    /// Eine aktive Einheit des Einsatzes.
    Einheit { einheit_id: i64 },
    /// Eine UHS des Einsatzes, nicht aufgelöst.
    Uhs { uhs_id: i64 },
    /// Neu anlegen; eine Einheit wahlweise aus einer Einheiten-Vorlage (Typ, Soll, Zeichen).
    Neu {
        #[serde(default)]
        einheit_vorlage_id: Option<i64>,
    },
}

/// Wer eine Person des Pakets ist.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(tag = "art", rename_all = "lowercase", deny_unknown_fields)]
pub enum PersonEntscheidung {
    Stamm { personal_id: i64 },
    Helfer { helfer_id: i64 },
    Neu,
}

/// Die Wahl in der Vorschau, je Schlüssel. Fehlt ein Schlüssel, gilt der Vorschlag.
#[derive(Debug, Clone, Default, PartialEq, Eq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Entscheidungen {
    #[serde(default)]
    pub posten: BTreeMap<String, PostenEntscheidung>,
    #[serde(default)]
    pub personen: BTreeMap<String, PersonEntscheidung>,
}

// ---------------------------------------------------------------------------------------------
// Vorschau und Ergebnis (Response)
// ---------------------------------------------------------------------------------------------

wire_enum! {
    /// Wie sicher ein Vorschlag ist. Wire == `as_str()`.
    #[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, ToSchema)]
    pub enum Treffer {
        /// Eindeutig getroffen (Name im Abschnitt, Kennung, Name und Telefon).
        Sicher => "sicher",
        /// Vorschlag, der bestätigt werden sollte (nur der Name, mehrere Kandidaten).
        Unsicher => "unsicher",
        /// Nichts gefunden: wird neu angelegt.
        Neu => "neu",
    }
    try_from = |s| format!("Ungültiger Treffer: {s}");
}

wire_enum! {
    /// Woran eine Person erkannt wurde. Wire == `as_str()`.
    #[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, ToSchema)]
    pub enum TrefferGrund {
        /// Kennung und Herkunft gleich einem Helfer des Plans.
        Kennung => "kennung",
        /// Kennung gleich der Personalnummer, Name passt.
        KennungName => "kennung_name",
        /// Kennung gleich der Personalnummer, Name passt nicht.
        KennungOhneName => "kennung_ohne_name",
        /// Name und Telefon.
        NameTelefon => "name_telefon",
        /// Nur der Name.
        Name => "name",
        /// Fester Bezug aus dem Paket.
        Bezug => "bezug",
        /// Von Hand gewählt.
        Wahl => "wahl",
    }
    try_from = |s| format!("Ungültiger Grund: {s}");
}

/// Ziel eines Postens in der Vorschau. Im Schema eingebettet (`#[schema(inline)]`): ein Enum mit
/// Daten passt nicht in den Wire-Kontrakt (`tests/enum_wire_kontrakt.rs`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, ToSchema)]
#[serde(tag = "art", rename_all = "lowercase")]
pub enum PostenZiel {
    Einheit {
        einheit_id: i64,
        bezeichnung: String,
    },
    Uhs {
        uhs_id: i64,
        bezeichnung: String,
    },
    Neu {
        #[serde(skip_serializing_if = "Option::is_none")]
        einheit_vorlage_id: Option<i64>,
    },
    Pause,
}

/// Ein Posten in der Vorschau.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, ToSchema)]
pub struct VorschauPosten {
    pub schluessel: String,
    #[schema(value_type = PaketPostenArt)]
    pub art: PaketPostenArt,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub abschnitt: Option<String>,
    /// Der gefundene Abschnitt; bei einem neuen Posten liegt er dort.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub abschnitt_id: Option<i64>,
    #[schema(inline)]
    pub ziel: PostenZiel,
    #[schema(value_type = Treffer)]
    pub treffer: Treffer,
    /// Weitere gleich gute Kandidaten (Einheiten bzw. UHS), wenn der Treffer unsicher ist.
    #[schema(inline)]
    pub kandidaten: Vec<PostenZiel>,
    pub zeilen: Vec<u32>,
    pub bloecke: i64,
}

/// Ziel einer Person in der Vorschau, eingebettet wie [`PostenZiel`].
#[derive(Debug, Clone, PartialEq, Eq, Serialize, ToSchema)]
#[serde(tag = "art", rename_all = "lowercase")]
pub enum PersonZiel {
    Stamm { personal_id: i64, name: String },
    Helfer { helfer_id: i64, name: String },
    Neu,
}

/// Eine Person in der Vorschau.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, ToSchema)]
pub struct VorschauPerson {
    pub schluessel: String,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub telefon: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub kennung: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub herkunft: Option<String>,
    #[schema(inline)]
    pub ziel: PersonZiel,
    #[schema(value_type = Treffer)]
    pub treffer: Treffer,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[schema(value_type = Option<TrefferGrund>)]
    pub grund: Option<TrefferGrund>,
    /// Gefundene Kandidaten, aus denen gewählt werden kann (ohne „neu“).
    #[schema(inline)]
    pub kandidaten: Vec<PersonZiel>,
    pub zeilen: Vec<u32>,
    /// In wie vielen Blöcken sie steht.
    pub bloecke: i64,
}

wire_enum! {
    /// Was mit einem Block geschieht. Wire == `as_str()`.
    #[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, ToSchema)]
    pub enum BlockZustand {
        /// Wird angelegt.
        Neu => "neu",
        /// Besteht; Personen kommen dazu.
        Ergaenzt => "ergaenzt",
        /// Besteht mit allen Personen.
        Unveraendert => "unveraendert",
        /// Kann nicht übernommen werden (Meldung an der Zeile).
        Fehler => "fehler",
    }
    try_from = |s| format!("Ungültiger Zustand eines Blocks: {s}");
}

/// Ein Block in der Vorschau.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, ToSchema)]
pub struct VorschauBlock {
    /// Schlüssel des Postens.
    pub posten: String,
    pub von: String,
    pub bis: String,
    #[schema(value_type = BlockZustand)]
    pub zustand: BlockZustand,
    /// Der bestehende Block, wenn er schon da ist.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub block_id: Option<i64>,
    /// Personen des Blocks laut Paket.
    pub personen: i64,
    /// Davon neu im Block.
    pub neue_personen: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub zeile: Option<u32>,
}

/// Zählung der Änderungen. Alles 0 außer `*_unveraendert` heißt: nichts zu tun.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, ToSchema)]
pub struct ImportZaehlung {
    pub einheiten_neu: i64,
    pub uhs_neu: i64,
    pub bloecke_neu: i64,
    pub bloecke_ergaenzt: i64,
    pub bloecke_unveraendert: i64,
    pub helfer_neu: i64,
    /// Personen, die neu in einen Block kommen (über alle Blöcke).
    pub einteilungen_neu: i64,
    /// Grenzwerte des Dienst-Befunds, die die Vorplanung setzt (LLH-1561); aus einer Datei 0.
    pub grenzwerte_neu: i64,
    /// Summe aller Änderungen; 0 = das Übernehmen schreibt nichts.
    pub aenderungen: i64,
}

impl ImportZaehlung {
    pub fn summe(&mut self) {
        self.aenderungen = self.einheiten_neu
            + self.uhs_neu
            + self.bloecke_neu
            + self.bloecke_ergaenzt
            + self.helfer_neu
            + self.einteilungen_neu
            + self.grenzwerte_neu;
    }
}

/// Eine wählbare Einheit, UHS oder Vorlage.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, ToSchema)]
pub struct WahlEintrag {
    pub id: i64,
    pub bezeichnung: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub abschnitt_id: Option<i64>,
}

/// Was zur Wahl steht: aktive Einheiten, UHS und Einheiten-Vorlagen.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, ToSchema)]
pub struct ImportAuswahl {
    pub einheiten: Vec<WahlEintrag>,
    pub uhs: Vec<WahlEintrag>,
    pub vorlagen: Vec<WahlEintrag>,
    pub abschnitte: Vec<WahlEintrag>,
}

/// Antwort der Vorschau: nichts ist geschrieben.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, ToSchema)]
pub struct ImportVorschau {
    pub posten: Vec<VorschauPosten>,
    pub personen: Vec<VorschauPerson>,
    pub bloecke: Vec<VorschauBlock>,
    /// Fehler zuerst, dann Hinweise, je nach Zeile.
    pub meldungen: Vec<ImportMeldung>,
    pub zaehlung: ImportZaehlung,
    pub auswahl: ImportAuswahl,
    /// Ob „Übernehmen“ geht: kein Fehler.
    pub uebernehmbar: bool,
}

/// Antwort des Übernehmens.
#[derive(Debug, Clone, PartialEq, Serialize, ToSchema)]
pub struct ImportErgebnis {
    pub zaehlung: ImportZaehlung,
    pub plan: super::SchichtplanAnzeige,
}
