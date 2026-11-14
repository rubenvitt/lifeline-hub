//! Persistenz der Ablösung (LFH-635).
//!
//! **Alles, was eine Ablösung verändert, läuft in EINER `write_retry!`-Transaktion**: Schicht,
//! Auto-Fristen des Erinnerungs-Schedulers, Folgeschicht und ETB-Eintrag. Ein 422 mitten im
//! Ablauf lässt deshalb nichts zurück (Spec: „Vollzug mit Folgeschicht", Atomarität).
//!
//! Die Fristen hängen polymorph an der Schicht (`bezug_typ` `abloesung` /
//! `abloesung_vorwarnung` / `abloesung_planung`, `bezug_id` = Schicht-ID) — ohne FK, wie alle
//! Auto-Fristen.

use sqlx::{SqliteConnection, SqlitePool};

use std::collections::{HashMap, HashSet};

use super::hinweis::{self, Wirkung};
use super::schichtplan::kopplung;
use super::{
    einstufung, faelligkeit, planung_warnungen, rhythmus_text, untereinheiten, vererbung,
    vorwarnzeit, AbloesungAbloeser, AbloesungAnzeige, AbloesungArt, AbloesungBesatzung,
    AbloesungBesatzungPlan, AbloesungEinsatzVorgabeAnzeige, AbloesungErbe, AbloesungFolge,
    AbloesungPlanFolgeblock, AbloesungPlanVorlage, AbloesungPlanungEntfallen, AbloesungStatus,
    AbloesungVerbleib, AbloesungVollzugAnzeige, AbloesungVorgabeAnzeige, BeendetGrund,
    BeginnQuelle, BesatzungRolle, BesatzungZiel, PlanVorlageKommen, PlanVorlagePerson,
    PlanungEntfallenGrund, PlanungsStand, RhythmusQuelle, ABLOESER_MAX,
    PLANUNGSVORLAUF_VORGABE_MINUTEN, VORWARNUNG_VORGABE_MINUTEN,
};
use crate::benachrichtigung::BenachrichtigungBezugTyp;
use crate::einsatz::einstellungen::etb_startwert;
use crate::erinnerung::repo as erinnerung_repo;
use crate::error::AppError;
use crate::etb::repo::EintragDaten;
use crate::etb::{TYP_BERICHTIGUNG, TYP_ENTSCHEIDUNG, TYP_MELDUNG};
use crate::kommunikation::{
    OBJEKT_ABLOESUNG, OBJEKT_ABLOESUNG_PLANUNG, OBJEKT_ABLOESUNG_VORWARNUNG,
};
use crate::schichtmodell::repo as schichtmodell_repo;
use crate::schichtmodell::{Regel, Werte};
use crate::write_retry;
use crate::zeitachse::repo::Beruehrt;
use crate::zeitdarstellung::{Zeitdarstellung, Zeitstil};

/// Was Vollzug oder Rücknahme außerhalb der Ablösung geändert haben; die Route meldet danach
/// `einheit` und `personal` (LLH-1189).
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct VollzugWirkung {
    /// Je Einheit mit geschriebenem bzw. gestrichenem Ereignis `abloesung` (die abgelöste und
    /// ihre erbenden Untereinheiten, LLH-1132) die per Fan-out berührten Personen.
    pub zeitachse: Vec<(i64, Beruehrt)>,
    /// Einheiten, deren Abschnitt die Übergabe oder ihre Rücknahme geändert hat, beim
    /// Besatzungswechsel die, deren Personal er geändert hat (LLH-1150).
    pub einheiten: Vec<i64>,
    /// Personen, deren Einheit oder Zeitachse der Besatzungswechsel oder seine Rücknahme geändert
    /// hat (LLH-1150).
    pub personen: Vec<i64>,
    /// Bereitstellungsräume, deren Belegung Vollzug oder Rücknahme geändert haben (LLH-1308).
    pub raeume: Vec<i64>,
    /// Einheiten, deren Abschnitt die Übergabe oder ihre Rücknahme geändert hat: die Zeilen ihrer
    /// versorgten Personen tragen ihn per Join (LLH-1682).
    pub abschnitt_gewechselt: Vec<i64>,
    /// ETB-Einträge und Hinweise der Kopplung an die Zeitachse (LLH-1128/LLH-1131), etwa eine
    /// entfallene Planung der entlassenen Einheit; nach dem Commit über `publish_kopplung`.
    pub kopplung: Wirkung,
}

/// Eingabe „Schicht beginnen" — von der Route validiert (Zeit normalisiert, Rhythmus im
/// Wertebereich).
#[derive(Debug, Clone)]
pub struct BeginnEingabe {
    pub einheit_id: i64,
    /// `None` = das Eintreffen der offenen Einsatzperiode der Einheit (Kräfte-Zeitachse,
    /// LFH-552), ohne ein solches der Zeitpunkt der Anlage.
    pub beginn_at: Option<String>,
    /// `None` = Vorgabe übernehmen: die des Abschnitts, sonst die des Einsatzes.
    pub rhythmus_minuten: Option<i64>,
}

/// Eingabe „Schicht ändern" — jedes Feld tri-state: fehlt = unverändert.
#[derive(Debug, Clone, Default)]
pub struct AenderungEingabe {
    pub beginn_at: Option<String>,
    /// `Some(None)` = zurück zur Vorgabe: der des Abschnitts, sonst der des Einsatzes.
    pub rhythmus_minuten: Option<Option<i64>>,
    /// Die geplanten Ablöser in ihrer Reihenfolge, von der Route begrenzt und entdoppelt;
    /// `Some(vec![])` = Planung aufheben.
    pub abloeser: Option<Vec<i64>>,
    /// Der geplante Besatzungswechsel (LLH-1319), von der Route begrenzt und nach Person
    /// entdoppelt; `Some(vec![])` = Planung aufheben. Nach der Änderung plant die Schicht
    /// entweder Ablöser oder einen Besatzungswechsel (sonst 422).
    pub besatzung_plan: Option<Vec<BesatzungZiel>>,
}

/// Eingabe „Vollzug" (LLH-1132) — von der Route validiert (Zeit normalisiert, Liste begrenzt
/// und entdoppelt).
#[derive(Debug, Clone, Default)]
pub struct VollzugEingabe {
    pub vollzogen_at: String,
    /// Die Ablöser in ihrer Reihenfolge; leer = ohne ablösende Einheit.
    pub abloeser: Vec<i64>,
    /// Den Abschnitt der abgelösten Einheit an die Ablöser übergeben, die den Knoten bilden.
    pub abschnitt_uebergeben: bool,
    /// Dem Benutzer fehlt die Freigabe des Moduls Einheiten (LLH-1512). Eine Übergabe, die
    /// etwas übergäbe (Abschnitt da, mindestens ein Knoten-Ablöser), wird dann mit 403
    /// abgewiesen, bevor etwas geschrieben bleibt; eine ohne Wirkung wird wie sonst übergangen.
    pub ohne_freigabe_einheiten: bool,
    /// Ganze Einheit oder Besatzungswechsel (LLH-1150); beim Besatzungswechsel sind `abloeser`
    /// leer und `abschnitt_uebergeben` aus (die Route prüft das).
    pub art: AbloesungArt,
    /// Beim Besatzungswechsel die neue Besatzung mit ihrem Ziel (LLH-1319), begrenzt und nach
    /// Person entdoppelt; sonst leer.
    pub besatzung: Vec<BesatzungZiel>,
    /// Beim Besatzungswechsel Personen aus dem Schichtplan, die dabei erst in den Einsatz kommen
    /// (LLH-1555, design.md D5); sonst leer.
    pub uebernahme: Vec<PlanUebernahme>,
    /// Beim Besatzungswechsel, wer aus der bisherigen Besatzung bleibt (`einsatz_personal.id`,
    /// LLH-1555); sonst leer.
    pub bleiben: Vec<i64>,
    /// Der Folgeblock, in den der Besatzungswechsel laut Plan wechselt (LLH-1555): muss der der
    /// Schicht sein (422), die Folgeschicht ankert darin.
    pub plan_block_id: Option<i64>,
    /// Was danach mit der abgelösten Einheit geschieht (LLH-1308); beim Besatzungswechsel
    /// immer `ruhe` (die Route prüft das).
    pub verbleib: AbloesungVerbleib,
    /// Der Raum genau beim Verbleib `bereitstellungsraum` (die Route prüft das).
    pub verbleib_br_id: Option<i64>,
}

/// Woher eine Person aus dem Schichtplan kommt, die beim Vollzug in den Einsatz übernommen wird
/// (LLH-1555).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum UebernahmeQuelle {
    /// Stamm-Personal der Organisation (`personal.id`).
    Stamm(i64),
    /// Helfer des Plans (`einsatz_plan_helfer.id`).
    Helfer(i64),
}

/// Eine Person aus dem Schichtplan mit ihrem Ziel wie [`BesatzungZiel`].
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PlanUebernahme {
    pub quelle: UebernahmeQuelle,
    pub einheit_id: Option<i64>,
    pub fahrzeug_id: Option<i64>,
}

mod beginn;
mod fristen;
mod hilfen;
mod lesen;
mod planung;
mod ruecknahme;
mod vollzug;
mod vorgabe;

pub use beginn::*;
pub(crate) use fristen::*;
use hilfen::*;
pub use lesen::*;
pub use planung::*;
pub use ruecknahme::*;
pub use vollzug::*;
pub use vorgabe::*;

/// Text der 422 für eine Schicht, die nicht mehr läuft.
fn nicht_laufend(status: AbloesungStatus, was: &str) -> String {
    match status {
        AbloesungStatus::Beendet => format!("Eine beendete Schicht {was}"),
        _ => format!("Eine abgelöste Schicht {was}"),
    }
}

#[cfg(test)]
mod tests;
