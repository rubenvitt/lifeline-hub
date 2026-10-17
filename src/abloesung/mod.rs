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
//! das Non-Goal „Vorwarnzeit fest 30 min“ aus LFH-635 auf).
//!
//! **Kopplung an die Kräfte-Zeitachse** (LLH-1128, [`kopplung`]): ein Eintreffen beginnt die
//! Schicht einer Einheit ohne laufende (auch ohne geerbte), sofern Abschnitt oder Einsatz eine
//! Vorgabe haben; eine Entlassung beendet sie (`beendet`, Grund `entlassung`), ihre Streichung
//! öffnet sie wieder. Das Auflösen beendet sie mit Grund `aufloesung`.
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
use serde::Serialize;
use utoipa::ToSchema;

pub mod kopplung;
pub mod repo;

pub use crate::schichtmodell::VORWARNUNG_VORGABE_MINUTEN;

/// Obergrenze eines Rhythmus: 7 Tage in Minuten (DB-CHECK in `0114_abloesung.sql`).
pub const RHYTHMUS_MAX_MINUTEN: i64 = 10_080;

/// Höchstzahl der Ablöser je Schicht (LLH-1118 Punkt 3, LLH-1132), gezählt vor dem Entdoppeln
/// (`src/AGENTS.md`, „Eingabegrenzen“). Spiegel: `frontend/src/api/eingabegrenzen.ts`.
pub const ABLOESER_MAX: usize = 8;

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
    pub angelegt_at: String,
}

/// Ein Ablöser einer Schicht (Eintrag in `einsatz_abloesung_abloeser`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, ToSchema)]
pub struct AbloesungAbloeser {
    pub einheit_id: i64,
    pub einheit_name: String,
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
        assert_eq!(AbloesungStatus::parse("offen"), None);
    }
}
