//! Ablösung von Einheiten im Einsatz (LFH-635).
//!
//! **Eine Zeile = eine Schicht einer Einheit**: Einsatzbeginn + Rhythmus → Fälligkeit,
//! geplante ablösende Einheit, Vollzug. Je Einheit läuft höchstens eine Schicht. Rangfolge des
//! Rhythmus (LLH-1122): eigener Wert der Einheit (`rhythmus_quelle = einheit`) → Vorgabe des
//! Abschnitts (`abschnitt`) → Vorgabe des Einsatzes (`einsatz`, ein Schichtmodell mit Rhythmus
//! oder Wechselzeiten, [`crate::schichtmodell`]).
//!
//! **Die Einstufung wird beim Lesen berechnet**, nicht gespeichert: sie hängt an der Uhr, und
//! ein verpasster Scheduler-Tick darf sie nicht verfälschen. Der Erinnerungs-Scheduler liefert
//! nur den einmaligen Hinweis (Vorwarnung und Fälligkeit). Die Vorwarnzeit kommt aus dem
//! Schichtmodell des Einsatzes, ohne eines gilt [`VORWARNUNG_VORGABE_MINUTEN`] (LLH-1122 hebt
//! das Non-Goal „Vorwarnzeit fest 30 min“ aus LFH-635 auf). Eine dritte Frist ist der
//! **Planungshinweis** (LLH-1131): `planungsvorlauf_minuten` vor der Fälligkeit (ohne
//! Schichtmodell [`PLANUNGSVORLAUF_VORGABE_MINUTEN`]), nur solange keine ablösende Einheit
//! geplant ist. Er ist eine Benachrichtigung, keine vierte Einstufung.
//!
//! **Hinweise zur ablösenden Einheit** (LLH-1131, [`hinweis`]): Alarmierung, Eintreffen,
//! Eintreffen am Bereitstellungsraum und Abruf einer geplanten ablösenden Einheit sowie eine
//! entfallene Planung erreichen die Leser des Moduls. Beim Planen warnt die Schicht
//! ([`AbloesungPlanungWarnung`]), lehnt aber nicht ab.
//!
//! **Kopplung an die Kräfte-Zeitachse** (LLH-1128, [`kopplung`]): ein Eintreffen beginnt die
//! Schicht einer Einheit ohne laufende (auch ohne geerbte), sofern Abschnitt oder Einsatz eine
//! Vorgabe haben; eine Entlassung beendet sie (`beendet`, Grund `entlassung`), ihre Streichung
//! öffnet sie wieder. Das Auflösen beendet sie mit Grund `aufloesung`.
//!
//! **Besatzungswechsel** (LLH-1150, Entscheidung LLH-1118 Punkt 4): Art [`AbloesungArt`] an der
//! Schicht. Die Einheit und ihr Fahrzeug bleiben, die Folgeschicht hängt an derselben Einheit; die
//! Personalzuordnung der Einheit und ihrer erbenden Untereinheiten geht, die gewählte neue
//! Besatzung kommt (`einsatz_abloesung_besatzung`). Die Kräfte-Zeitachse bekommt nur
//! Personen-Ereignisse, keine Grenzwerte und keine Ruhezeitrechnung (Abgrenzung zu LFH-860).
//! Seit LLH-1319 lässt sich der Wechsel vorab planen (`einsatz_abloesung_besatzung_plan`, eine
//! Planung je Schicht: Ablöser oder Besatzungswechsel), die neue Besatzung wird beim Vollzug auf
//! die Einheit, ihre erbenden Untereinheiten und deren Fahrzeuge verteilt ([`BesatzungZiel`]),
//! und die Folgeschicht nennt sie (`nach_besatzungswechsel`). Die Rücknahme eines Vollzugs stellt
//! die Planung von vor dem Vollzug wieder her.
//!
//! **Knoten-Modell** (LLH-1118 Punkt 1): eine Untereinheit ohne eigene laufende Schicht erbt die
//! ihres nächsten Vorfahren mit laufender Schicht (über `ueber_einheit_id`). Ermittelt wird das
//! beim Lesen ([`vererbung`]), nie als Kopie gespeichert.
//!
//! Spec: `openspec/specs/kraefte-abloesung/spec.md`; Herleitung
//! `openspec/changes/archive/2026-09-29-lfh-635-fachmodul-abloesung/`

use std::collections::{HashMap, HashSet};

use crate::wire_enum::wire_enum;
use crate::zeit;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

pub mod hinweis;
pub mod kopplung;
pub mod repo;

pub use crate::schichtmodell::{PLANUNGSVORLAUF_VORGABE_MINUTEN, VORWARNUNG_VORGABE_MINUTEN};

/// Obergrenze eines Rhythmus: 7 Tage in Minuten (DB-CHECK in `0114_abloesung.sql`).
pub const RHYTHMUS_MAX_MINUTEN: i64 = 10_080;

/// Höchstzahl der Ablöser je Schicht (LLH-1118 Punkt 3, LLH-1132), gezählt vor dem Entdoppeln
/// (`src/AGENTS.md`, „Eingabegrenzen“). Spiegel: `frontend/src/api/eingabegrenzen.ts`.
pub const ABLOESER_MAX: usize = 8;

/// Höchstzahl der Personen einer neuen Besatzung (LLH-1150), gezählt vor dem Entdoppeln wie die
/// Sammel-Disposition (`kraefte_disposition::SAMMEL_MAX`). Spiegel:
/// `frontend/src/api/eingabegrenzen.ts`.
pub const BESATZUNG_MAX: usize = 50;

wire_enum! {
    /// Wie eine Schicht vollzogen wurde (`einsatz_abloesung.art`, LLH-1150). Eine laufende Schicht
    /// trägt die Vorgabe `einheit`. Wire == `as_str()`.
    #[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]
    pub enum AbloesungArt {
        /// Die ganze Einheit wird abgelöst: ablösende Einheiten bekommen die Folgeschichten.
        Einheit => "einheit",
        /// Besatzungswechsel: Einheit und Fahrzeug bleiben, die Folgeschicht hängt an derselben
        /// Einheit, nur das Personal wechselt.
        Besatzung => "besatzung",
    }
    try_from = |s| format!("Ungültige Art der Ablösung: {s}");
}

impl Default for AbloesungArt {
    fn default() -> Self {
        Self::Einheit
    }
}

wire_enum! {
    /// Was nach dem Vollzug mit der abgelösten Einheit geschieht (`einsatz_abloesung.verbleib`,
    /// LLH-1308). Eine laufende Schicht und jeder Besatzungswechsel tragen `ruhe`. Wire ==
    /// `as_str()`.
    #[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]
    pub enum AbloesungVerbleib {
        /// In Ruhe: die Periode der Zeitachse endet mit der Ablösung.
        Ruhe => "ruhe",
        /// Wie Ruhe, dazu der Eintritt in einen Bereitstellungsraum.
        Bereitstellungsraum => "bereitstellungsraum",
        /// Aus dem Einsatz entlassen: die Periode endet mit der Entlassung statt der Ablösung.
        Entlassen => "entlassen",
    }
    try_from = |s| format!("Ungültiger Verbleib der abgelösten Einheit: {s}");
}

impl Default for AbloesungVerbleib {
    fn default() -> Self {
        Self::Ruhe
    }
}

wire_enum! {
    /// Wie eine Schicht begann (`einsatz_abloesung.beginn_quelle`, LLH-1312). Geschrieben beim
    /// Anlegen; ein geänderter Beginn macht aus `eintreffen` ein `hand`, eine Folgeschicht bleibt
    /// `vollzug`. Wire == `as_str()`.
    #[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]
    pub enum BeginnQuelle {
        /// Von Hand begonnen („Schicht beginnen“), auch mit dem Eintreffen als Zeitpunkt.
        Hand => "hand",
        /// Mit dem Eintreffen der Einheit begonnen (Autostart, [`kopplung`]).
        Eintreffen => "eintreffen",
        /// Vom Vollzug des Vorgängers als Folgeschicht angelegt.
        Vollzug => "vollzug",
    }
    try_from = |s| format!("Ungültige Herkunft des Beginns: {s}");
}

wire_enum! {
    /// Rolle einer Person beim Besatzungswechsel (`einsatz_abloesung_besatzung.rolle`). Wire ==
    /// `as_str()`.
    #[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]
    pub enum BesatzungRolle {
        /// Gehörte zur Einheit oder einer erbenden Untereinheit und ist gegangen.
        Alt => "alt",
        /// Ist mit dem Wechsel zur Einheit gekommen.
        Neu => "neu",
    }
    try_from = |s| format!("Ungültige Rolle in der Besatzung: {s}");
}

wire_enum! {
    /// Status einer Schicht. Wire == `as_str()`.
    #[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]
    pub enum AbloesungStatus {
        /// Die Einheit ist im Einsatz, die Ablösung steht aus.
        Laufend => "laufend",
        /// Die Ablösung ist vollzogen.
        Abgeloest => "abgeloest",
        /// Ohne Ablösung zu Ende: die Einheit ist entlassen oder aufgelöst (LLH-1128). Keine
        /// Folgeschicht; der Grund steht in [`BeendetGrund`].
        Beendet => "beendet",
    }
    try_from = |s| format!("Ungültiger Ablösungsstatus: {s}");
}

wire_enum! {
    /// Warum eine Schicht ohne Ablösung endete (`einsatz_abloesung.beendet_grund`, TEXT ohne
    /// CHECK: den Wert setzt nur dieser Code). Wire == `as_str()`.
    #[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]
    pub enum BeendetGrund {
        /// Die Zeitachse hat die Entlassung der Einheit geschrieben; ihre Streichung öffnet
        /// die Schicht wieder.
        Entlassung => "entlassung",
        /// Die Einheit wurde aufgelöst (LLH-1079); die Schicht bleibt als Spur stehen.
        Aufloesung => "aufloesung",
    }
    try_from = |s| format!("Ungültiger Grund für das Ende einer Schicht: {s}");
}

wire_enum! {
    /// Herkunft des Rhythmus einer Schicht. Wire == `as_str()`.
    #[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]
    pub enum RhythmusQuelle {
        /// Folgt der Vorgabe des Abschnitts und wandert mit, wenn sie sich ändert.
        Abschnitt => "abschnitt",
        /// Eigener Wert der Schicht; eine Änderung der Abschnittsvorgabe lässt ihn stehen.
        Einheit => "einheit",
        /// Folgt der Vorgabe des Einsatzes (Schichtmodell) und wandert mit, wenn sie sich
        /// ändert (LLH-1122).
        Einsatz => "einsatz",
    }
    try_from = |s| format!("Ungültige Rhythmusquelle: {s}");
}

wire_enum! {
    /// Einstufung einer laufenden Schicht gegen die aktuelle Zeit. Höchstens drei Stufen
    /// (EEMUA 191/ISA-18.2: ≤ 3 Eskalationsstufen). Wire == `as_str()`.
    #[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]
    pub enum Einstufung {
        Planmaessig => "planmaessig",
        /// Fälligkeit höchstens die Vorwarnzeit entfernt.
        Vorwarnung => "vorwarnung",
        /// Fälligkeit erreicht oder überschritten.
        Ueberfaellig => "ueberfaellig",
    }
}

wire_enum! {
    /// Was beim Planen einer ablösenden Einheit auffällt (LLH-1131): eine Warnung, kein Fehler.
    /// Wire == `as_str()`.
    #[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]
    pub enum AbloesungWarnungArt {
        /// Die Einheit ist schon für eine andere laufende Schicht geplant.
        SchonGeplant => "schon_geplant",
        /// Die Einheit steht selbst im Einsatz: sie hat eine eigene laufende Schicht oder läuft in
        /// der ihres Verbands mit (Knoten-Modell).
        ImEinsatz => "im_einsatz",
    }
    try_from = |s| format!("Ungültige Art einer Planungswarnung: {s}");
}

/// Eine Warnung zur geplanten ablösenden Einheit einer laufenden Schicht (LLH-1131). Gilt für
/// die Einzelplanung und für die Ablöser-Liste (LLH-1118 Punkt 3).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, ToSchema)]
pub struct AbloesungPlanungWarnung {
    pub art: AbloesungWarnungArt,
    /// Die geplante ablösende Einheit.
    pub einheit_id: i64,
    pub einheit_name: String,
    /// `schon_geplant`: die andere Schicht, für die sie geplant ist.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub abloesung_id: Option<i64>,
    /// `schon_geplant`: die Einheit dieser anderen Schicht.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub abloesung_einheit_name: Option<String>,
    /// `im_einsatz`: Beginn der laufenden Schicht, in der sie steht (eigene oder die ihres
    /// Verbands).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub seit_at: Option<String>,
}

wire_enum! {
    /// Warum die Planung einer ablösenden Einheit entfiel (LLH-1131, Vermerk an der Schicht ab
    /// LLH-1309: `einsatz_abloesung.planung_entfallen_grund`, CHECK in Migration 0259).
    /// Wire == `as_str()`.
    #[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]
    pub enum PlanungEntfallenGrund {
        /// Die geplante Einheit wurde aufgelöst.
        Aufloesung => "aufloesung",
        /// Die geplante Einheit wurde entlassen (Zeitachse, keine Periode mehr offen).
        Entlassung => "entlassung",
    }
    try_from = |s| format!("Ungültiger Grund einer entfallenen Planung: {s}");
}

impl PlanungEntfallenGrund {
    /// „aufgelöst“ bzw. „entlassen“, für ETB und Karte.
    pub fn partizip(self) -> &'static str {
        match self {
            PlanungEntfallenGrund::Aufloesung => "aufgelöst",
            PlanungEntfallenGrund::Entlassung => "entlassen",
        }
    }
}

/// Die zuletzt entfallene Planung einer laufenden Schicht ohne Ablöser (LLH-1309, Spec
/// `kraefte-abloesung` „Planung entfällt“): die Karte zeigt „Planung entfallen · 2. Rettungsstaffel
/// aufgelöst“.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, ToSchema)]
pub struct AbloesungPlanungEntfallen {
    /// Wann die Planung entfiel (UTC ohne Zone).
    pub at: String,
    pub grund: PlanungEntfallenGrund,
    /// Name der Einheit zum Zeitpunkt, wie im ETB.
    pub einheit_name: String,
}

/// Eine laufende Schicht, wie die Planungswarnungen sie lesen.
#[derive(Debug, Clone)]
pub struct PlanungsStand {
    pub id: i64,
    pub einheit_id: i64,
    pub einheit_name: String,
    pub beginn_at: String,
    /// Geplante ablösende Einheiten: die Einzelplanung und die Einträge der Ablöser-Liste.
    pub abloeser: Vec<i64>,
}

/// Planungswarnungen je laufender Schicht (rein): eine geplante Einheit, die auch eine andere
/// laufende Schicht plant (`schon_geplant`, je andere Schicht), oder die selbst in einer
/// laufenden Schicht steht, eigener oder geerbter (`im_einsatz`; `erbt` aus [`vererbung`]).
/// Schichten ohne Warnung fehlen. `namen` liefert die Namen der geplanten Einheiten.
pub fn planung_warnungen(
    schichten: &[PlanungsStand],
    erbt: &HashMap<i64, i64>,
    namen: &HashMap<i64, String>,
) -> HashMap<i64, Vec<AbloesungPlanungWarnung>> {
    let mut aus: HashMap<i64, Vec<AbloesungPlanungWarnung>> = HashMap::new();
    let schicht_von = |einheit: i64| schichten.iter().find(|s| s.einheit_id == einheit);
    for s in schichten {
        let mut gesehen = HashSet::new();
        for &p in &s.abloeser {
            if !gesehen.insert(p) {
                continue;
            }
            let name = namen.get(&p).cloned().unwrap_or_default();
            let warnung = |art, abloesung: Option<&PlanungsStand>, seit_at: Option<String>| {
                AbloesungPlanungWarnung {
                    art,
                    einheit_id: p,
                    einheit_name: name.clone(),
                    abloesung_id: abloesung.map(|a| a.id),
                    abloesung_einheit_name: abloesung.map(|a| a.einheit_name.clone()),
                    seit_at,
                }
            };
            let mut liste = Vec::new();
            for andere in schichten
                .iter()
                .filter(|o| o.id != s.id && o.abloeser.contains(&p))
            {
                liste.push(warnung(
                    AbloesungWarnungArt::SchonGeplant,
                    Some(andere),
                    None,
                ));
            }
            let traeger = schicht_von(p).or_else(|| erbt.get(&p).and_then(|&t| schicht_von(t)));
            if let Some(t) = traeger {
                liste.push(warnung(
                    AbloesungWarnungArt::ImEinsatz,
                    None,
                    Some(t.beginn_at.clone()),
                ));
            }
            if !liste.is_empty() {
                aus.entry(s.id).or_default().append(&mut liste);
            }
        }
    }
    aus
}

/// Fälligkeit = Beginn + Rhythmus. `None` bei unparsbarem Beginn.
pub fn faelligkeit(beginn_at: &str, rhythmus_minuten: i64) -> Option<String> {
    zeit::plus_minuten(beginn_at, rhythmus_minuten)
}

/// Zeitpunkt der Vorwarnung = Fälligkeit − `vorwarnung_minuten`.
pub fn vorwarnzeit(faellig_at: &str, vorwarnung_minuten: i64) -> Option<String> {
    zeit::plus_minuten(faellig_at, -vorwarnung_minuten)
}

/// Einstufung einer laufenden Schicht (rein, deterministisch testbar). Eine unparsbare
/// Fälligkeit gilt defensiv als überfällig: sie soll auffallen, nicht verschwinden.
pub fn einstufung(faellig_at: &str, jetzt: &str, vorwarnung_minuten: i64) -> Einstufung {
    match (zeit::parse(faellig_at), zeit::parse(jetzt)) {
        (Some(f), Some(j)) => {
            if f <= j {
                Einstufung::Ueberfaellig
            } else if f - j <= chrono::Duration::minutes(vorwarnung_minuten) {
                Einstufung::Vorwarnung
            } else {
                Einstufung::Planmaessig
            }
        }
        _ => Einstufung::Ueberfaellig,
    }
}

/// Rhythmus als Text für ETB-Einträge: „6 h", „6 h 30 min", „45 min".
pub fn rhythmus_text(minuten: i64) -> String {
    let (h, m) = (minuten / 60, minuten % 60);
    match (h, m) {
        (0, m) => format!("{m} min"),
        (h, 0) => format!("{h} h"),
        (h, m) => format!("{h} h {m} min"),
    }
}

/// Öffentliche Darstellung einer Schicht.
#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct AbloesungAnzeige {
    pub id: i64,
    pub einsatz_id: i64,
    pub einheit_id: i64,
    pub einheit_name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub abschnitt_id: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub abschnitt_name: Option<String>,
    pub beginn_at: String,
    /// Wie die Schicht begann (LLH-1312): von Hand, mit dem Eintreffen oder als Folgeschicht.
    pub beginn_quelle: BeginnQuelle,
    pub rhythmus_minuten: i64,
    pub rhythmus_quelle: RhythmusQuelle,
    pub faellig_at: String,
    /// Vorwarnzeit vor der Fälligkeit in Minuten: aus dem Schichtmodell des Einsatzes, ohne
    /// eines [`VORWARNUNG_VORGABE_MINUTEN`]. Die Einstufung rechnet damit.
    pub vorwarnung_minuten: i64,
    /// Der erste Eintrag von [`Self::abloeser`] (Spiegel für bestehende Leser).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub abloesende_einheit_id: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub abloesende_einheit_name: Option<String>,
    /// Die Ablöser der Schicht in der Reihenfolge der Planung (LLH-1132, höchstens
    /// [`ABLOESER_MAX`]): bei einer laufenden die geplanten, bei einer abgelösten die beim
    /// Vollzug genannten.
    pub abloeser: Vec<AbloesungAbloeser>,
    pub status: AbloesungStatus,
    /// Nur bei laufenden Schichten; berechnet gegen die Zeit der Abfrage.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub einstufung: Option<Einstufung>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub vollzogen_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub vollzogen_von_id: Option<i64>,
    /// Die abgelöste Schicht, aus deren Vollzug diese hervorging.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub vorgaenger_id: Option<i64>,
    /// Die jüngste Folgeschicht, die beim Vollzug dieser Schicht entstand oder übernommen wurde.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub folgeschicht_id: Option<i64>,
    /// Alle Folgeschichten dieses Vollzugs, je Ablöser höchstens eine (LLH-1132), nach ID.
    pub folgeschichten: Vec<AbloesungFolge>,
    /// Diese Schicht lief schon vor dem Vollzug ihres Vorgängers (ungeplanter Ablöser, etwa mit
    /// dem Eintreffen begonnen) und wurde von ihm als Folgeschicht übernommen. Die Rücknahme
    /// löst sie wieder vom Vorgänger, statt sie zu entfernen.
    pub uebernommen_bei_vollzug: bool,
    /// Der Vollzug hat den Abschnitt der abgelösten Einheit an die Ablöser übergeben; die
    /// Rücknahme gibt ihn zurück.
    pub abschnitt_uebergeben: bool,
    /// Name des übergebenen Abschnitts (nur mit `abschnitt_uebergeben`).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub uebergebener_abschnitt_name: Option<String>,
    /// Wie die Schicht vollzogen wurde (LLH-1150); eine laufende trägt `einheit`.
    pub art: AbloesungArt,
    /// Beim Besatzungswechsel: wer ging (`alt`) und wer kam (`neu`), je in der Reihenfolge des
    /// Vollzugs. Leer bei jeder anderen Schicht.
    pub besatzung: Vec<AbloesungBesatzung>,
    /// Der geplante Besatzungswechsel einer laufenden Schicht (LLH-1319), in der Reihenfolge der
    /// Planung; leer ohne einen und bei abgelösten und beendeten Schichten. Eine Schicht plant
    /// entweder Ablöser oder einen Besatzungswechsel.
    pub besatzung_plan: Vec<AbloesungBesatzungPlan>,
    /// Ist der Vorgänger dieser Schicht als Besatzungswechsel vollzogen, die neue Besatzung dieses
    /// Wechsels (Rolle `neu`, LLH-1319); sonst leer.
    pub nach_besatzungswechsel: Vec<AbloesungBesatzung>,
    /// Was nach dem Vollzug mit der abgelösten Einheit geschah (LLH-1308); eine laufende trägt
    /// `ruhe`.
    pub verbleib: AbloesungVerbleib,
    /// Bezeichnung des Raums beim Verbleib `bereitstellungsraum`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub verbleib_br_bezeichnung: Option<String>,
    /// Der Vollzug lässt sich zurücknehmen: abgelöst, und jede Folgeschicht ist noch unberührt
    /// (laufend).
    pub ruecknehmbar: bool,
    /// Nur bei `beendet`: wann, durch wen und warum die Schicht ohne Ablösung endete.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub beendet_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub beendet_von_id: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub beendet_grund: Option<BeendetGrund>,
    /// Untereinheiten, die diese laufende Schicht erben (Knoten-Modell, LLH-1118): ohne eigene
    /// laufende Schicht unter dieser Einheit, bis zur nächsten mit eigener. Leer bei
    /// abgelösten und beendeten Schichten.
    pub erbende_einheiten: Vec<AbloesungErbe>,
    /// Warnungen zur geplanten ablösenden Einheit (LLH-1131): schon für eine andere Schicht
    /// geplant oder selbst im Einsatz. Beim Lesen ermittelt; leer ohne Planung, ohne Auffälliges
    /// und bei abgelösten und beendeten Schichten. Die Planung gelingt trotzdem.
    pub planung_warnungen: Vec<AbloesungPlanungWarnung>,
    /// Die zuletzt entfallene Planung (LLH-1309): nur an einer laufenden Schicht ohne Ablöser;
    /// jede Änderung der Ablöser-Liste räumt den Vermerk.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub planung_entfallen: Option<AbloesungPlanungEntfallen>,
    pub angelegt_at: String,
}

/// Ein Ablöser einer Schicht (Eintrag in `einsatz_abloesung_abloeser`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, ToSchema)]
pub struct AbloesungAbloeser {
    pub einheit_id: i64,
    pub einheit_name: String,
}

/// Eine Person der alten oder neuen Besatzung (Eintrag in `einsatz_abloesung_besatzung`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, ToSchema)]
pub struct AbloesungBesatzung {
    /// `einsatz_personal.id`
    pub personal_id: i64,
    pub name: String,
    pub rolle: BesatzungRolle,
}

/// Ziel einer Person der neuen Besatzung (LLH-1319), beim Planen und beim Vollzug: die Einheit
/// (die der Schicht oder eine Untereinheit, die ihre Schicht erbt; fehlt = die der Schicht) und
/// ein Fahrzeug dieser Einheiten (fehlt = beim Vollzug bleibt ihr Fahrzeug, wie es ist).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
pub struct BesatzungZiel {
    /// `einsatz_personal.id`
    pub personal_id: i64,
    #[serde(default)]
    pub einheit_id: Option<i64>,
    /// `einsatz_fahrzeug.id`
    #[serde(default)]
    pub fahrzeug_id: Option<i64>,
}

/// Eine Person des geplanten Besatzungswechsels (Eintrag in `einsatz_abloesung_besatzung_plan`,
/// LLH-1319) mit ihrem Ziel.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, ToSchema)]
pub struct AbloesungBesatzungPlan {
    /// `einsatz_personal.id`
    pub personal_id: i64,
    pub name: String,
    /// Ziel-Einheit; fehlt = die Einheit der Schicht.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub einheit_id: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub einheit_name: Option<String>,
    /// Ziel-Fahrzeug (`einsatz_fahrzeug.id`); fehlt = keins.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fahrzeug_id: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub funkrufname: Option<String>,
}

/// Eine Folgeschicht aus dem Vollzug einer Schicht.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, ToSchema)]
pub struct AbloesungFolge {
    pub id: i64,
    pub einheit_id: i64,
    pub einheit_name: String,
    pub status: AbloesungStatus,
    /// Übernommen statt neu angelegt (ungeplanter Ablöser mit eigener laufender Schicht).
    pub uebernommen: bool,
}

/// Eine Untereinheit, die die Schicht eines Vorfahren erbt.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, ToSchema)]
pub struct AbloesungErbe {
    pub einheit_id: i64,
    pub einheit_name: String,
}

/// Knoten-Vererbung (LLH-1118 Punkt 1), rein: je Einheit ohne eigene laufende Schicht der
/// nächste Vorfahr mit einer (`erbende → Träger`). `ueber` ordnet jeder Einheit ihre
/// übergeordnete zu, `mit_schicht` sind die Einheiten mit eigener laufender Schicht. Eine
/// Einheit, deren Kette ohne Träger endet, fehlt. Iterativ mit Besucht-Menge (Muster
/// `einheit::repo::kumuliere`), damit ein korrupter Zyklus terminiert.
pub fn vererbung(
    ueber: &HashMap<i64, Option<i64>>,
    mit_schicht: &HashSet<i64>,
) -> HashMap<i64, i64> {
    let mut erbt = HashMap::new();
    for &einheit in ueber.keys() {
        if mit_schicht.contains(&einheit) {
            continue;
        }
        let mut besucht = HashSet::from([einheit]);
        let mut knoten = ueber.get(&einheit).copied().flatten();
        while let Some(k) = knoten {
            if !besucht.insert(k) {
                break;
            }
            if mit_schicht.contains(&k) {
                erbt.insert(einheit, k);
                break;
            }
            knoten = ueber.get(&k).copied().flatten();
        }
    }
    erbt
}

/// Rhythmus-Vorgabe eines Einsatzabschnitts.
#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct AbloesungVorgabeAnzeige {
    pub abschnitt_id: i64,
    pub abschnitt_name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rhythmus_minuten: Option<i64>,
    /// Laufende Schichten mit Einsatzstelle in diesem Abschnitt.
    pub laufende_schichten: i64,
}

/// Vorgabe des Einsatzes (LLH-1122): die Kopie eines Schichtmodells, die beim Anlegen aus der
/// Vorgabe der Organisation kam oder in den Einsatz-Einstellungen gesetzt wurde.
#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct AbloesungEinsatzVorgabeAnzeige {
    /// Fehlt = der Einsatz hat keine Vorgabe.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub schichtmodell: Option<crate::schichtmodell::EinsatzSchichtmodell>,
    /// Wirksame Vorwarnzeit aller Schichten des Einsatzes.
    pub vorwarnung_minuten: i64,
    /// Laufende Schichten, die der Vorgabe des Einsatzes folgen.
    pub laufende_schichten: i64,
}

/// Antwort auf einen Vollzug: die abgelöste Schicht und — mit Ablösern — ihre Folgeschichten.
#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct AbloesungVollzugAnzeige {
    pub abgeloest: AbloesungAnzeige,
    /// Die erste Folgeschicht (Spiegel für bestehende Leser).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub folgeschicht: Option<AbloesungAnzeige>,
    /// Je Ablöser, der den Knoten bildet, eine Folgeschicht, in der Reihenfolge der Liste.
    pub folgeschichten: Vec<AbloesungAnzeige>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn faelligkeit_ist_beginn_plus_rhythmus() {
        assert_eq!(
            faelligkeit("2026-09-22 09:30:00", 360).as_deref(),
            Some("2026-09-22 15:30:00")
        );
        assert_eq!(
            faelligkeit("2026-09-22 22:00:00", 180).as_deref(),
            Some("2026-09-23 01:00:00"),
            "über Mitternacht"
        );
        assert_eq!(faelligkeit("kaputt", 60), None);
    }

    #[test]
    fn vorwarnzeit_liegt_die_vorwarnung_davor() {
        assert_eq!(
            vorwarnzeit("2026-09-22 15:30:00", 30).as_deref(),
            Some("2026-09-22 15:00:00")
        );
        assert_eq!(
            vorwarnzeit("2026-09-22 15:30:00", 45).as_deref(),
            Some("2026-09-22 14:45:00")
        );
    }

    /// Die Vorwarnung aus dem Schichtmodell verschiebt die Grenze der Stufe (LLH-1122).
    #[test]
    fn einstufung_mit_eigener_vorwarnung() {
        let f = "2026-09-22 15:30:00";
        assert_eq!(
            einstufung(f, "2026-09-22 14:45:00", 45),
            Einstufung::Vorwarnung
        );
        assert_eq!(
            einstufung(f, "2026-09-22 14:44:59", 45),
            Einstufung::Planmaessig
        );
        assert_eq!(
            einstufung(f, "2026-09-22 14:45:00", 30),
            Einstufung::Planmaessig
        );
    }

    /// Grenzfälle, die das Frontend (`abloesung/einstufung.ts`) identisch prüft.
    #[test]
    fn einstufung_grenzfaelle() {
        let f = "2026-09-22 15:30:00";
        assert_eq!(
            einstufung(f, "2026-09-22 15:30:00", 30),
            Einstufung::Ueberfaellig,
            "genau fällig"
        );
        assert_eq!(
            einstufung(f, "2026-09-22 15:31:00", 30),
            Einstufung::Ueberfaellig
        );
        assert_eq!(
            einstufung(f, "2026-09-22 15:29:59", 30),
            Einstufung::Vorwarnung
        );
        assert_eq!(
            einstufung(f, "2026-09-22 15:00:00", 30),
            Einstufung::Vorwarnung,
            "genau 30 min"
        );
        assert_eq!(
            einstufung(f, "2026-09-22 14:59:59", 30),
            Einstufung::Planmaessig,
            "30 min + 1 s"
        );
        assert_eq!(einstufung("kaputt", f, 30), Einstufung::Ueberfaellig);
    }

    #[test]
    fn rhythmus_text_liest_sich() {
        assert_eq!(rhythmus_text(360), "6 h");
        assert_eq!(rhythmus_text(390), "6 h 30 min");
        assert_eq!(rhythmus_text(45), "45 min");
    }

    /// Knoten-Modell: der nächste Vorfahr mit Schicht trägt, eine eigene Schicht übersteuert
    /// für den ganzen Teilbaum darunter, ohne Träger erbt niemand, ein Zyklus terminiert.
    #[test]
    fn vererbung_folgt_dem_naechsten_vorfahren() {
        // 1 ─ 2 ─ 3 ─ 4,  2 ─ 5,  6 (Wurzel ohne Schicht) ─ 7,  8 ⇄ 9 (Zyklus)
        let ueber: HashMap<i64, Option<i64>> = [
            (1, None),
            (2, Some(1)),
            (3, Some(2)),
            (4, Some(3)),
            (5, Some(2)),
            (6, None),
            (7, Some(6)),
            (8, Some(9)),
            (9, Some(8)),
        ]
        .into_iter()
        .collect();
        let erbt = vererbung(&ueber, &HashSet::from([1, 3]));
        assert_eq!(erbt.get(&2), Some(&1));
        assert_eq!(erbt.get(&5), Some(&1), "über die Untereinheit ohne Schicht");
        assert_eq!(
            erbt.get(&4),
            Some(&3),
            "die eigene Schicht von 3 übersteuert"
        );
        assert_eq!(erbt.get(&3), None, "wer eine eigene hat, erbt nicht");
        assert_eq!(erbt.get(&1), None);
        assert_eq!(erbt.get(&7), None, "ohne Träger keine Schicht");
        assert_eq!(erbt.get(&8), None, "Zyklus ohne Träger terminiert");
        assert_eq!(erbt.len(), 3);
    }

    /// LLH-1131: eine geplante Einheit, die auch eine andere Schicht plant, warnt „schon
    /// geplant“ an beiden; eine mit eigener oder geerbter laufender Schicht „im Einsatz seit“
    /// deren Beginn. Ohne Auffälliges keine Warnung, eine doppelt genannte zählt einmal.
    #[test]
    fn planung_warnungen_schon_geplant_und_im_einsatz() {
        let s = |id, einheit_id, name: &str, beginn: &str, abloeser: Vec<i64>| PlanungsStand {
            id,
            einheit_id,
            einheit_name: name.into(),
            beginn_at: beginn.into(),
            abloeser,
        };
        // Schicht 1 (Einheit 10) und 2 (Einheit 20) planen beide 30; Schicht 3 (Einheit 40) plant
        // 20, die selbst läuft; Schicht 4 (Einheit 50) plant 61, die die Schicht ihres Verbands
        // 40 erbt; Schicht 5 (Einheit 70) plant 80 zweimal, unauffällig.
        let schichten = vec![
            s(1, 10, "Florian 1", "2026-10-17 06:00:00", vec![30]),
            s(2, 20, "Florian 2", "2026-10-17 07:00:00", vec![30]),
            s(3, 40, "Zug 4", "2026-10-17 08:00:00", vec![20]),
            s(4, 50, "Florian 5", "2026-10-17 09:00:00", vec![61]),
            s(5, 70, "Florian 7", "2026-10-17 09:30:00", vec![80, 80]),
        ];
        let erbt = HashMap::from([(61, 40)]);
        let namen: HashMap<i64, String> = [
            (20, "Florian 2"),
            (30, "Florian 3"),
            (61, "Gruppe 6"),
            (80, "Florian 8"),
        ]
        .into_iter()
        .map(|(k, v)| (k, v.to_string()))
        .collect();
        let w = planung_warnungen(&schichten, &erbt, &namen);
        let an = |id: i64| w.get(&id).cloned().unwrap_or_default();

        assert_eq!(
            an(1),
            vec![AbloesungPlanungWarnung {
                art: AbloesungWarnungArt::SchonGeplant,
                einheit_id: 30,
                einheit_name: "Florian 3".into(),
                abloesung_id: Some(2),
                abloesung_einheit_name: Some("Florian 2".into()),
                seit_at: None,
            }]
        );
        assert_eq!(an(2)[0].abloesung_id, Some(1), "an beiden Schichten");
        assert_eq!(
            an(3),
            vec![AbloesungPlanungWarnung {
                art: AbloesungWarnungArt::ImEinsatz,
                einheit_id: 20,
                einheit_name: "Florian 2".into(),
                abloesung_id: None,
                abloesung_einheit_name: None,
                seit_at: Some("2026-10-17 07:00:00".into()),
            }]
        );
        assert_eq!(
            an(4)[0].seit_at.as_deref(),
            Some("2026-10-17 08:00:00"),
            "geerbt: Beginn der Schicht des Verbands"
        );
        assert!(
            an(5).is_empty(),
            "unauffällig, doppelt genannt zählt einmal"
        );
        assert_eq!(w.len(), 4);
    }

    #[test]
    fn enums_parse_rund() {
        for s in AbloesungStatus::ALLE {
            assert_eq!(AbloesungStatus::parse(s.as_str()), Some(s));
        }
        for g in BeendetGrund::ALLE {
            assert_eq!(BeendetGrund::parse(g.as_str()), Some(g));
        }
        for q in RhythmusQuelle::ALLE {
            assert_eq!(RhythmusQuelle::parse(q.as_str()), Some(q));
        }
        for a in AbloesungArt::ALLE {
            assert_eq!(AbloesungArt::parse(a.as_str()), Some(a));
        }
        for v in AbloesungVerbleib::ALLE {
            assert_eq!(AbloesungVerbleib::parse(v.as_str()), Some(v));
        }
        for r in BesatzungRolle::ALLE {
            assert_eq!(BesatzungRolle::parse(r.as_str()), Some(r));
        }
        assert_eq!(AbloesungStatus::parse("offen"), None);
    }
}
