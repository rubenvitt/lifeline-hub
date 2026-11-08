//! Der fachneutrale Ausgabeplan und seine zwei Adapter (design.md D1): [`aus_einsatz`] aus dem
//! Plan eines Einsatzes, [`aus_planung`] aus einer Vorplanung. Rein; die Daten lädt
//! [`super::repo`].

use std::collections::{BTreeMap, HashMap};

use chrono::{DateTime, Duration, Timelike, Utc};
use chrono_tz::Tz;

use crate::abloesung::schichtplan::uebernahme::abgleich::{
    EigenerBezug, EIGENE_HERKUNFT, VORPLANUNG_HERKUNFT,
};
use crate::abloesung::schichtplan::{
    PlanBefund, PlanBefundArt, PlanHelferAnzeige, PlanPersonAnzeige, PlanPersonArt, PostenArt,
    SchichtplanAnzeige,
};
use crate::personal::quali_soll::QualiSoll;
use crate::planung::{PlanungAnzeige, PlanungPostenArt};
use crate::zeit;

/// Woher der Plan kommt; nennt die Übersicht.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Quelle {
    Einsatz,
    Planung,
}

/// Kopf: Einsatz bzw. Planung.
#[derive(Debug, Clone, PartialEq)]
pub struct AusgabeKopf {
    pub quelle: Quelle,
    pub titel: String,
    pub ort: Option<String>,
    /// Zone des Einsatzes bzw. der Organisation: alle Zeittexte stehen darin.
    pub zone: Tz,
    /// Zeitraum der Planung; beim Einsatz `None` (dann von der ersten bis zur letzten Schicht).
    pub zeitraum: Option<(DateTime<Utc>, DateTime<Utc>)>,
    pub stand: DateTime<Utc>,
}

/// Art eines Postens. `Fahrzeug` gibt es in der Ausgabe nicht: ein Posten heißt immer wie die
/// Einheit, die der Leser über ihren Namen findet.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AusgabePostenArt {
    Einheit,
    Uhs,
    Pause,
}

impl AusgabePostenArt {
    /// Das Wort der Spalte „Posten-Art“, wie der Leser es kennt.
    pub fn wort(self) -> &'static str {
        match self {
            AusgabePostenArt::Einheit => "Einheit",
            AusgabePostenArt::Uhs => "UHS",
            AusgabePostenArt::Pause => "Pause",
        }
    }
}

/// Ein Posten in der Reihenfolge der Gliederung (Einsatz) bzw. der Planung; die Pause zuletzt.
#[derive(Debug, Clone, PartialEq)]
pub struct AusgabePosten {
    pub schluessel: String,
    pub art: AusgabePostenArt,
    /// Bei der Pause „Pause“.
    pub name: String,
    pub abschnitt: Option<String>,
    /// Einheit aufgelöst bzw. UHS aufgelöst oder storniert.
    pub aufgeloest: bool,
}

/// Ein Eintrag des Qualifikationssolls mit Bezeichnung.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AusgabeQuali {
    pub label: String,
    pub anzahl: i64,
}

/// Ein Prüfbefund als Zeile des Blatts „Befunde“.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AusgabeBefund {
    pub art: PlanBefundArt,
    /// Schlüssel der Person; ein Befund des Blocks hat keine.
    pub person: Option<String>,
    pub text: String,
}

/// Eine Schicht (ein Block des Plans).
#[derive(Debug, Clone, PartialEq)]
pub struct AusgabeSchicht {
    pub id: i64,
    pub posten: String,
    pub von: DateTime<Utc>,
    pub bis: DateTime<Utc>,
    pub soll_anzahl: Option<i64>,
    pub quali_soll: Vec<AusgabeQuali>,
    /// Offene Plätze, wie der Server sie rechnet.
    pub offen: i64,
    /// Schlüssel der Eingeteilten.
    pub personen: Vec<String>,
    pub befunde: Vec<AusgabeBefund>,
}

impl AusgabeSchicht {
    /// Das Soll wie in der Prüfung: die Soll-Anzahl, mindestens die Summe des
    /// Qualifikationssolls; die Pause hat keins.
    fn soll(&self) -> i64 {
        let gefordert: i64 = self.quali_soll.iter().map(|q| q.anzahl).sum();
        self.soll_anzahl.unwrap_or(0).max(gefordert)
    }

    pub fn minuten(&self) -> i64 {
        (self.bis - self.von).num_minutes()
    }
}

/// Woher eine Person kommt.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AusgabePersonArt {
    /// Stamm-Personal der Organisation.
    Stamm,
    /// Eine Ad-hoc-Kraft des Einsatzes.
    Einsatzkraft,
    /// Ein Helfer des Plans eines Einsatzes.
    Helfer,
    /// Ein Helfer einer Vorplanung.
    Planungshelfer,
}

/// Eine eingeteilte Person.
#[derive(Debug, Clone, PartialEq)]
pub struct AusgabePerson {
    pub schluessel: String,
    pub art: AusgabePersonArt,
    pub id: i64,
    pub name: String,
    /// Nur bei Helfern.
    pub organisation: Option<String>,
    /// Nur bei Helfern: für Stamm-Personal liefert der Plan keins.
    pub telefon: Option<String>,
    /// Bezeichnungen; nur bei Helfern.
    pub qualifikationen: Vec<String>,
    /// Eigene externe Kennung eines Helfers (aus einer Datei) mit ihrer Herkunft.
    pub kennung: Option<String>,
    pub herkunft: Option<String>,
}

impl AusgabePerson {
    pub fn ist_helfer(&self) -> bool {
        matches!(
            self.art,
            AusgabePersonArt::Helfer | AusgabePersonArt::Planungshelfer
        )
    }

    /// Kennung und Herkunft im Austausch (design.md D6): die eigene externe Kennung eines
    /// Helfers, sonst ein eigener Bezug. Helfer einer Planung tragen ihre Kennung mit Herkunft
    /// „vorplanung“, wie die Übernahme einer Planung (LLH-1587) sie anlegt.
    pub fn bezug(&self) -> (String, String) {
        if let Some(k) = self
            .kennung
            .as_deref()
            .map(str::trim)
            .filter(|k| !k.is_empty())
        {
            return (k.to_string(), self.herkunft.clone().unwrap_or_default());
        }
        let eigen = |b: EigenerBezug| (b.kennung(), EIGENE_HERKUNFT.to_string());
        match self.art {
            AusgabePersonArt::Stamm => eigen(EigenerBezug::Personal(self.id)),
            AusgabePersonArt::Einsatzkraft => eigen(EigenerBezug::Einsatzkraft(self.id)),
            AusgabePersonArt::Helfer => eigen(EigenerBezug::Helfer(self.id)),
            AusgabePersonArt::Planungshelfer => {
                (self.id.to_string(), VORPLANUNG_HERKUNFT.to_string())
            }
        }
    }

    /// Name mit Organisation bei Helfern: „Jonas Fiktiv (DRK Nachbarstadt)“.
    pub fn mit_organisation(&self) -> String {
        match self
            .organisation
            .as_deref()
            .filter(|o| !o.trim().is_empty())
        {
            Some(o) if self.ist_helfer() => format!("{} ({o})", self.name),
            _ => self.name.clone(),
        }
    }
}

/// Der ganze Plan zum Ausgeben.
#[derive(Debug, Clone, PartialEq)]
pub struct AusgabePlan {
    pub kopf: AusgabeKopf,
    pub posten: Vec<AusgabePosten>,
    /// Nach Posten (in der Reihenfolge von `posten`) und Beginn.
    pub schichten: Vec<AusgabeSchicht>,
    /// Nach Name.
    pub personen: Vec<AusgabePerson>,
}

/// Schlüssel zum Sortieren nach deutschem Namen: klein, Umlaute wie ihr Grundlaut.
pub fn namensfolge(name: &str) -> String {
    let mut s = String::with_capacity(name.len());
    for c in name.trim().chars().flat_map(char::to_lowercase) {
        match c {
            'ä' => s.push('a'),
            'ö' => s.push('o'),
            'ü' => s.push('u'),
            'ß' => s.push_str("ss"),
            c => s.push(c),
        }
    }
    s
}

impl AusgabePlan {
    pub fn posten_von(&self, schluessel: &str) -> Option<&AusgabePosten> {
        self.posten.iter().find(|p| p.schluessel == schluessel)
    }

    pub fn person_von(&self, schluessel: &str) -> Option<&AusgabePerson> {
        self.personen.iter().find(|p| p.schluessel == schluessel)
    }

    /// Die Eingeteilten einer Schicht in Namensfolge.
    pub fn eingeteilt(&self, s: &AusgabeSchicht) -> Vec<&AusgabePerson> {
        let mut v: Vec<&AusgabePerson> = s
            .personen
            .iter()
            .filter_map(|k| self.person_von(k))
            .collect();
        v.sort_by_cached_key(|p| (namensfolge(&p.name), p.schluessel.clone()));
        v
    }

    fn ist_pause(&self, s: &AusgabeSchicht) -> bool {
        self.posten_von(&s.posten)
            .is_none_or(|p| p.art == AusgabePostenArt::Pause)
    }

    /// Besetzung über alle Schichten an Posten: (besetzte Plätze, Plätze nach Soll, offen).
    pub fn besetzung(&self) -> (i64, i64, i64) {
        let (mut ist, mut soll, mut offen) = (0, 0, 0);
        for s in self.schichten.iter().filter(|s| !self.ist_pause(s)) {
            let n = s.soll();
            soll += n;
            ist += (s.personen.len() as i64).min(n);
            offen += s.offen;
        }
        (ist, soll, offen)
    }

    /// Zeitraum der Planung, sonst von der ersten bis zur letzten Schicht.
    pub fn zeitraum(&self) -> Option<(DateTime<Utc>, DateTime<Utc>)> {
        self.kopf.zeitraum.or_else(|| {
            let von = self.schichten.iter().map(|s| s.von).min()?;
            let bis = self.schichten.iter().map(|s| s.bis).max()?;
            Some((von, bis))
        })
    }

    /// Alle Befunde, in der Folge der Schichten.
    pub fn befunde(&self) -> impl Iterator<Item = (&AusgabeSchicht, &AusgabeBefund)> {
        self.schichten
            .iter()
            .flat_map(|s| s.befunde.iter().map(move |b| (s, b)))
    }
}

// ---------------------------------------------------------------------------------------------
// Zeittexte
// ---------------------------------------------------------------------------------------------

/// „15.08.2026“ in der Zone.
pub fn tag(t: DateTime<Utc>, zone: Tz) -> String {
    t.with_timezone(&zone).format("%d.%m.%Y").to_string()
}

/// „14:00“ in der Zone.
pub fn uhr(t: DateTime<Utc>, zone: Tz) -> String {
    t.with_timezone(&zone).format("%H:%M").to_string()
}

/// Das Ende zum Beginn: am selben Tag „16:00“, um Mitternacht des Folgetags „24:00“, sonst mit
/// Datum „16.08.2026 02:00“.
pub fn bis_text(von: DateTime<Utc>, bis: DateTime<Utc>, zone: Tz) -> String {
    let (a, b) = (von.with_timezone(&zone), bis.with_timezone(&zone));
    if a.date_naive() == b.date_naive() {
        return uhr(bis, zone);
    }
    let mitternacht = b.hour() == 0 && b.minute() == 0;
    if mitternacht && a.date_naive() + Duration::days(1) == b.date_naive() {
        return "24:00".into();
    }
    b.format("%d.%m.%Y %H:%M").to_string()
}

/// „15.08.2026 14:00–16:00“.
pub fn zeitraum_text(von: DateTime<Utc>, bis: DateTime<Utc>, zone: Tz) -> String {
    format!(
        "{} {}–{}",
        tag(von, zone),
        uhr(von, zone),
        bis_text(von, bis, zone)
    )
}

/// „15.08.2026 14:00“.
pub fn zeitpunkt_text(t: DateTime<Utc>, zone: Tz) -> String {
    t.with_timezone(&zone).format("%d.%m.%Y %H:%M").to_string()
}

/// Wie `formatDauer` im Frontend: „45 min“, „8 h“, „7:30 h“.
pub fn dauer_text(minuten: i64) -> String {
    if minuten < 60 {
        return format!("{minuten} min");
    }
    let (h, m) = (minuten / 60, minuten % 60);
    if m == 0 {
        format!("{h} h")
    } else {
        format!("{h}:{m:02} h")
    }
}

/// Das Wort eines Befunds wie in der Ansicht (`schichtplanZeilen.ts`, `BEFUND_WORT`).
pub fn befund_wort(art: PlanBefundArt) -> &'static str {
    match art {
        PlanBefundArt::Doppelt => "doppelt verplant",
        PlanBefundArt::Quali => "Qualifikation fehlt",
        PlanBefundArt::Dienst => "zu lange im Dienst",
        PlanBefundArt::Verfuegbar => "nicht verfügbar",
        PlanBefundArt::Abweichung => "nicht am Posten",
    }
}

// ---------------------------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------------------------

/// Bezeichnungen der Qualifikationen der Organisation (auch inaktive).
pub type QualiNamen = HashMap<i64, String>;

fn quali_soll(q: Option<&QualiSoll>) -> Vec<AusgabeQuali> {
    q.map(|q| {
        q.0.iter()
            .map(|e| AusgabeQuali {
                label: e.label.clone(),
                anzahl: e.anzahl,
            })
            .collect()
    })
    .unwrap_or_default()
}

fn zeit_von(wire: &str) -> Option<DateTime<Utc>> {
    zeit::parse_utc(wire)
}

/// Der Text eines Befunds für das Blatt „Befunde“. `andere` nennt zu einem anderen Block
/// Posten und Zeitraum.
fn befund_text(
    b: &PlanBefund,
    quali: &QualiNamen,
    andere: &dyn Fn(i64) -> Option<String>,
    am_block: bool,
) -> String {
    match b.art {
        PlanBefundArt::Quali => format!(
            "{} × {} fehlt",
            b.fehlen.unwrap_or(1),
            b.qualifikation_id
                .and_then(|id| quali.get(&id).cloned())
                .unwrap_or_else(|| "Qualifikation".into())
        ),
        PlanBefundArt::Dienst => {
            format!("{} im Dienst", dauer_text(b.dauer_minuten.unwrap_or(0)))
        }
        PlanBefundArt::Doppelt => match b.anderer_block_id.and_then(andere) {
            Some(o) => format!("auch in {o}"),
            None => befund_wort(b.art).into(),
        },
        PlanBefundArt::Verfuegbar if am_block => "Posten aufgelöst".into(),
        PlanBefundArt::Verfuegbar => "außer Dienst oder entlassen".into(),
        PlanBefundArt::Abweichung => "ab Beginn nicht am Posten".into(),
    }
}

fn helfer_person(
    schluessel: String,
    art: AusgabePersonArt,
    h: &PlanHelferAnzeige,
    quali: &QualiNamen,
) -> AusgabePerson {
    AusgabePerson {
        schluessel,
        art,
        id: h.id,
        name: h.name.clone(),
        organisation: h.organisation.clone(),
        telefon: h.telefon.clone(),
        qualifikationen: h
            .qualifikationen
            .iter()
            .filter_map(|id| quali.get(id).cloned())
            .collect(),
        kennung: h.kennung.clone(),
        herkunft: h.herkunft.clone(),
    }
}

fn ohne_helferdaten(
    schluessel: String,
    art: AusgabePersonArt,
    p: &PlanPersonAnzeige,
) -> AusgabePerson {
    AusgabePerson {
        schluessel,
        art,
        id: p
            .personal_id
            .or(p.einsatz_personal_id)
            .or(p.helfer_id)
            .unwrap_or_default(),
        name: p.name.clone(),
        organisation: None,
        telefon: None,
        qualifikationen: Vec::new(),
        kennung: None,
        herkunft: None,
    }
}

/// Personen und Befunde aus den Blöcken; gemeinsam für Einsatz und Planung.
struct Sammler<'a> {
    quali: &'a QualiNamen,
    personen: BTreeMap<String, AusgabePerson>,
}

impl<'a> Sammler<'a> {
    fn sortiert(self) -> Vec<AusgabePerson> {
        let mut v: Vec<AusgabePerson> = self.personen.into_values().collect();
        v.sort_by_cached_key(|p| (namensfolge(&p.name), p.schluessel.clone()));
        v
    }
}

/// Wie der Raster des Einsatzes ordnet (`schichtplanZeilen.ts`, `baueZeilen`): nach Abschnitt in
/// der Gliederung, darin Einheiten vor UHS, danach „ohne Abschnitt“, zuletzt die Pause.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct EinsatzGliederung {
    /// Abschnitte in der Reihenfolge der Gliederung.
    pub abschnitte: Vec<(i64, String)>,
    /// Einheiten in ihrer Reihenfolge, mit dem wirksamen (auch geerbten) Abschnitt.
    pub einheiten: Vec<(i64, Option<i64>)>,
    /// UHS in ihrer Reihenfolge, mit Abschnitt.
    pub uhs: Vec<(i64, Option<i64>)>,
}

/// Rang eines Postens im Einsatz: Abschnitt, Art, Folge in der Gliederung, Name.
type PostenRang = (usize, u8, usize, String);

/// Der Plan eines Einsatzes. Ohne Personen (`personen: null`, ohne Modul Personal) bleiben
/// die Schichten ohne Namen.
pub fn aus_einsatz(
    kopf: AusgabeKopf,
    plan: &SchichtplanAnzeige,
    gliederung: &EinsatzGliederung,
    quali: &QualiNamen,
) -> AusgabePlan {
    let zone = kopf.zone;
    let abschnitt_rang: HashMap<i64, usize> = gliederung
        .abschnitte
        .iter()
        .enumerate()
        .map(|(i, (id, _))| (*id, i))
        .collect();
    let abschnitt_name: HashMap<i64, &str> = gliederung
        .abschnitte
        .iter()
        .map(|(id, n)| (*id, n.as_str()))
        .collect();
    let einheit: HashMap<i64, (usize, Option<i64>)> = gliederung
        .einheiten
        .iter()
        .enumerate()
        .map(|(i, (id, a))| (*id, (i, *a)))
        .collect();
    let uhs: HashMap<i64, (usize, Option<i64>)> = gliederung
        .uhs
        .iter()
        .enumerate()
        .map(|(i, (id, a))| (*id, (i, *a)))
        .collect();
    let ohne = gliederung.abschnitte.len();

    // Posten aus den Blöcken, mit Rang (Abschnitt, Art, Folge, Name).
    let mut posten: BTreeMap<String, (PostenRang, AusgabePosten)> = BTreeMap::new();
    for b in &plan.bloecke {
        let p = &b.posten;
        let (schluessel, art, folge) = match p.art {
            PostenArt::Einheit => {
                let id = p.einheit_id.unwrap_or_default();
                (
                    format!("einheit:{id}"),
                    AusgabePostenArt::Einheit,
                    einheit.get(&id).copied(),
                )
            }
            PostenArt::Uhs => {
                let id = p.uhs_id.unwrap_or_default();
                (
                    format!("uhs:{id}"),
                    AusgabePostenArt::Uhs,
                    uhs.get(&id).copied(),
                )
            }
            PostenArt::Pause => ("pause".to_string(), AusgabePostenArt::Pause, None),
        };
        if posten.contains_key(&schluessel) {
            continue;
        }
        let abschnitt_id = folge
            .and_then(|(_, a)| a)
            .filter(|a| abschnitt_rang.contains_key(a));
        let name = match art {
            AusgabePostenArt::Pause => "Pause".to_string(),
            AusgabePostenArt::Einheit => p.bezeichnung.clone().unwrap_or_else(|| "Einheit".into()),
            AusgabePostenArt::Uhs => p.bezeichnung.clone().unwrap_or_else(|| "UHS".into()),
        };
        let rang = match art {
            AusgabePostenArt::Pause => (ohne + 1, 0, 0, String::new()),
            _ => (
                abschnitt_id.map_or(ohne, |a| abschnitt_rang[&a]),
                u8::from(art == AusgabePostenArt::Uhs),
                folge.map_or(usize::MAX, |(i, _)| i),
                namensfolge(&name),
            ),
        };
        posten.insert(
            schluessel.clone(),
            (
                rang,
                AusgabePosten {
                    schluessel,
                    art,
                    name,
                    abschnitt: abschnitt_id.map(|a| abschnitt_name[&a].to_string()),
                    aufgeloest: p.aufgeloest,
                },
            ),
        );
    }
    let mut posten: Vec<((usize, u8, usize, String), AusgabePosten)> =
        posten.into_values().collect();
    posten.sort_by(|a, b| {
        a.0.cmp(&b.0)
            .then_with(|| a.1.schluessel.cmp(&b.1.schluessel))
    });
    let posten: Vec<AusgabePosten> = posten.into_iter().map(|(_, p)| p).collect();
    let rang: HashMap<&str, usize> = posten
        .iter()
        .enumerate()
        .map(|(i, p)| (p.schluessel.as_str(), i))
        .collect();

    let helfer: HashMap<i64, &PlanHelferAnzeige> =
        plan.helfer.iter().flatten().map(|h| (h.id, h)).collect();
    let schluessel_von = |b: &crate::abloesung::schichtplan::PlanBlockAnzeige| match b.posten.art {
        PostenArt::Einheit => format!("einheit:{}", b.posten.einheit_id.unwrap_or_default()),
        PostenArt::Uhs => format!("uhs:{}", b.posten.uhs_id.unwrap_or_default()),
        PostenArt::Pause => "pause".to_string(),
    };
    let block_text: HashMap<i64, String> = plan
        .bloecke
        .iter()
        .filter_map(|b| {
            let (von, bis) = (zeit_von(&b.von)?, zeit_von(&b.bis)?);
            let name = posten
                .iter()
                .find(|p| p.schluessel == schluessel_von(b))
                .map(|p| p.name.clone())
                .unwrap_or_default();
            Some((b.id, format!("{name} {}", zeitraum_text(von, bis, zone))))
        })
        .collect();
    let andere = |id: i64| block_text.get(&id).cloned();

    let mut sammler = Sammler {
        quali,
        personen: BTreeMap::new(),
    };
    let mut schichten: Vec<AusgabeSchicht> = Vec::new();
    for b in &plan.bloecke {
        let (Some(von), Some(bis)) = (zeit_von(&b.von), zeit_von(&b.bis)) else {
            continue;
        };
        let mut befunde: Vec<AusgabeBefund> = b
            .befunde
            .iter()
            .map(|f| AusgabeBefund {
                art: f.art,
                person: None,
                text: befund_text(f, sammler.quali, &andere, true),
            })
            .collect();
        let mut personen: Vec<String> = Vec::new();
        for p in b.personen.iter().flatten() {
            let (schluessel, art) = match p.art {
                PlanPersonArt::Stamm => (
                    format!("stamm:{}", p.personal_id.unwrap_or_default()),
                    AusgabePersonArt::Stamm,
                ),
                PlanPersonArt::Einsatz => (
                    format!("einsatz:{}", p.einsatz_personal_id.unwrap_or_default()),
                    AusgabePersonArt::Einsatzkraft,
                ),
                PlanPersonArt::Helfer => (
                    format!("helfer:{}", p.helfer_id.unwrap_or_default()),
                    AusgabePersonArt::Helfer,
                ),
            };
            if !sammler.personen.contains_key(&schluessel) {
                let person = match p.helfer_id.and_then(|id| helfer.get(&id)) {
                    Some(h) => helfer_person(schluessel.clone(), art, h, sammler.quali),
                    None => ohne_helferdaten(schluessel.clone(), art, p),
                };
                sammler.personen.insert(schluessel.clone(), person);
            }
            for f in &p.befunde {
                befunde.push(AusgabeBefund {
                    art: f.art,
                    person: Some(schluessel.clone()),
                    text: befund_text(f, sammler.quali, &andere, false),
                });
            }
            if !personen.contains(&schluessel) {
                personen.push(schluessel);
            }
        }
        schichten.push(AusgabeSchicht {
            id: b.id,
            posten: schluessel_von(b),
            von,
            bis,
            soll_anzahl: b.soll_anzahl,
            quali_soll: quali_soll(b.quali_soll.as_ref()),
            offen: b.offene_plaetze,
            personen,
            befunde,
        });
    }
    schichten.sort_by_key(|s| (rang.get(s.posten.as_str()).copied(), s.von, s.bis, s.id));
    AusgabePlan {
        kopf,
        posten,
        schichten,
        personen: sammler.sortiert(),
    }
}

/// Eine Vorplanung: Posten in ihrer Reihenfolge (`sortier`), die Pause zuletzt; Personen sind
/// Stamm-Personal und Helfer der Planung.
pub fn aus_planung(kopf: AusgabeKopf, planung: &PlanungAnzeige, quali: &QualiNamen) -> AusgabePlan {
    let zone = kopf.zone;
    let schluessel_von = |posten_id: Option<i64>| match posten_id {
        Some(id) => format!("posten:{id}"),
        None => "pause".to_string(),
    };
    let mut posten: Vec<AusgabePosten> = planung
        .posten
        .iter()
        .filter(|p| planung.bloecke.iter().any(|b| b.posten_id == Some(p.id)))
        .map(|p| AusgabePosten {
            schluessel: schluessel_von(Some(p.id)),
            art: match p.art {
                PlanungPostenArt::Einheit => AusgabePostenArt::Einheit,
                PlanungPostenArt::Uhs => AusgabePostenArt::Uhs,
            },
            name: p.bezeichnung.clone(),
            abschnitt: p.abschnitt.clone().filter(|a| !a.trim().is_empty()),
            aufgeloest: false,
        })
        .collect();
    if planung.bloecke.iter().any(|b| b.posten_id.is_none()) {
        posten.push(AusgabePosten {
            schluessel: "pause".into(),
            art: AusgabePostenArt::Pause,
            name: "Pause".into(),
            abschnitt: None,
            aufgeloest: false,
        });
    }
    let rang: HashMap<String, usize> = posten
        .iter()
        .enumerate()
        .map(|(i, p)| (p.schluessel.clone(), i))
        .collect();
    let block_text: HashMap<i64, String> = planung
        .bloecke
        .iter()
        .filter_map(|b| {
            let (von, bis) = (zeit_von(&b.von)?, zeit_von(&b.bis)?);
            let s = schluessel_von(b.posten_id);
            let name = posten
                .iter()
                .find(|p| p.schluessel == s)
                .map(|p| p.name.clone())
                .unwrap_or_default();
            Some((b.id, format!("{name} {}", zeitraum_text(von, bis, zone))))
        })
        .collect();
    let andere = |id: i64| block_text.get(&id).cloned();
    let helfer: HashMap<i64, &PlanHelferAnzeige> =
        planung.helfer.iter().map(|h| (h.id, h)).collect();

    let mut sammler = Sammler {
        quali,
        personen: BTreeMap::new(),
    };
    let mut schichten: Vec<AusgabeSchicht> = Vec::new();
    for b in &planung.bloecke {
        let (Some(von), Some(bis)) = (zeit_von(&b.von), zeit_von(&b.bis)) else {
            continue;
        };
        let mut befunde: Vec<AusgabeBefund> = b
            .befunde
            .iter()
            .map(|f| AusgabeBefund {
                art: f.art,
                person: None,
                text: befund_text(f, sammler.quali, &andere, true),
            })
            .collect();
        let mut personen: Vec<String> = Vec::new();
        for p in &b.personen {
            let (schluessel, art) = match p.art {
                PlanPersonArt::Helfer => (
                    format!("helfer:{}", p.helfer_id.unwrap_or_default()),
                    AusgabePersonArt::Planungshelfer,
                ),
                // Ad-hoc-Kräfte gibt es ohne Einsatz nicht; alles andere ist Stamm.
                _ => (
                    format!("stamm:{}", p.personal_id.unwrap_or_default()),
                    AusgabePersonArt::Stamm,
                ),
            };
            if !sammler.personen.contains_key(&schluessel) {
                let person = match p.helfer_id.and_then(|id| helfer.get(&id)) {
                    Some(h) => helfer_person(schluessel.clone(), art, h, sammler.quali),
                    None => ohne_helferdaten(schluessel.clone(), art, p),
                };
                sammler.personen.insert(schluessel.clone(), person);
            }
            for f in &p.befunde {
                befunde.push(AusgabeBefund {
                    art: f.art,
                    person: Some(schluessel.clone()),
                    text: befund_text(f, sammler.quali, &andere, false),
                });
            }
            if !personen.contains(&schluessel) {
                personen.push(schluessel);
            }
        }
        schichten.push(AusgabeSchicht {
            id: b.id,
            posten: schluessel_von(b.posten_id),
            von,
            bis,
            soll_anzahl: b.soll_anzahl,
            quali_soll: quali_soll(b.quali_soll.as_ref()),
            offen: b.offene_plaetze,
            personen,
            befunde,
        });
    }
    schichten.sort_by_key(|s| (rang.get(&s.posten).copied(), s.von, s.bis, s.id));
    AusgabePlan {
        kopf,
        posten,
        schichten,
        personen: sammler.sortiert(),
    }
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use crate::abloesung::schichtplan::{
        PlanBlockAnzeige, PlanPostenAnzeige, SchichtplanGrenzwerte,
    };
    use crate::personal::quali_soll::QualiSollEintrag;

    pub(crate) const BERLIN: Tz = chrono_tz::Europe::Berlin;

    pub(crate) fn t(s: &str) -> DateTime<Utc> {
        zeit::parse_utc(s).unwrap()
    }

    pub(crate) fn kopf() -> AusgabeKopf {
        AusgabeKopf {
            quelle: Quelle::Einsatz,
            titel: "Stadtfest".into(),
            ort: Some("Marktplatz".into()),
            zone: BERLIN,
            zeitraum: None,
            stand: t("2026-08-15 08:00:00"),
        }
    }

    fn person(art: PlanPersonArt, id: i64, name: &str) -> PlanPersonAnzeige {
        PlanPersonAnzeige {
            art,
            personal_id: (art == PlanPersonArt::Stamm).then_some(id),
            einsatz_personal_id: (art == PlanPersonArt::Einsatz).then_some(id),
            helfer_id: (art == PlanPersonArt::Helfer).then_some(id),
            name: name.into(),
            qualifikationen: vec![],
            im_einsatz: false,
            befunde: vec![],
        }
    }

    fn block(
        id: i64,
        art: PostenArt,
        posten_id: Option<i64>,
        name: Option<&str>,
        von: &str,
        bis: &str,
        personen: Vec<PlanPersonAnzeige>,
    ) -> PlanBlockAnzeige {
        PlanBlockAnzeige {
            id,
            version: 1,
            posten: PlanPostenAnzeige {
                art,
                einheit_id: posten_id.filter(|_| art == PostenArt::Einheit),
                uhs_id: posten_id.filter(|_| art == PostenArt::Uhs),
                bezeichnung: name.map(Into::into),
                aufgeloest: false,
            },
            von: von.into(),
            bis: bis.into(),
            soll_anzahl: None,
            quali_soll: None,
            notiz: None,
            personen_anzahl: personen.len() as i64,
            personen: Some(personen),
            offene_plaetze: 0,
            offene_anforderungen: vec![],
            befunde: vec![],
        }
    }

    /// Ein kleiner Einsatz: Streife 1 (Abschnitt Bühne), UHS Markt (ohne Abschnitt), Pause.
    pub(crate) fn einsatz_plan() -> AusgabePlan {
        let mut b1 = block(
            1,
            PostenArt::Einheit,
            Some(10),
            Some("Streife 1"),
            "2026-08-15 12:00:00",
            "2026-08-15 14:00:00",
            vec![
                person(PlanPersonArt::Stamm, 7, "Sophie Vorlage"),
                person(PlanPersonArt::Helfer, 40, "Jonas Fiktiv"),
            ],
        );
        b1.soll_anzahl = Some(3);
        b1.quali_soll = Some(QualiSoll(vec![QualiSollEintrag {
            qualifikation_id: 5,
            label: "Sanitäter".into(),
            anzahl: 1,
        }]));
        b1.offene_plaetze = 1;
        if let Some(p) = b1.personen.as_mut() {
            p[0].befunde.push(PlanBefund {
                anderer_block_id: Some(3),
                ..PlanBefund::nur(PlanBefundArt::Doppelt)
            });
        }
        let b2 = block(
            2,
            PostenArt::Uhs,
            Some(20),
            Some("UHS Markt"),
            "2026-08-15 22:00:00",
            "2026-08-16 02:00:00",
            vec![person(PlanPersonArt::Einsatz, 30, "Ali Adhoc")],
        );
        let b3 = block(
            3,
            PostenArt::Pause,
            None,
            None,
            "2026-08-15 13:00:00",
            "2026-08-15 13:30:00",
            vec![person(PlanPersonArt::Stamm, 7, "Sophie Vorlage")],
        );
        let b4 = block(
            4,
            PostenArt::Einheit,
            Some(10),
            Some("Streife 1"),
            "2026-08-15 10:00:00",
            "2026-08-15 12:00:00",
            vec![],
        );
        let plan = SchichtplanAnzeige {
            grenzwerte: SchichtplanGrenzwerte::aus(None, None),
            bloecke: vec![b2, b3, b1, b4],
            helfer: Some(vec![PlanHelferAnzeige {
                id: 40,
                name: "Jonas Fiktiv".into(),
                telefon: Some("0170 1".into()),
                organisation: Some("DRK Nachbarstadt".into()),
                qualifikationen: vec![5],
                kennung: Some("10231".into()),
                herkunft: Some("Helferplanung".into()),
            }]),
            naechste_pruefung_at: None,
        };
        let gliederung = EinsatzGliederung {
            abschnitte: vec![(1, "Bühne".into())],
            einheiten: vec![(10, Some(1))],
            uhs: vec![(20, None)],
        };
        let quali = QualiNamen::from([(5, "Sanitäter".to_string())]);
        aus_einsatz(kopf(), &plan, &gliederung, &quali)
    }

    #[test]
    fn einsatz_ordnet_nach_gliederung_und_beginn() {
        let p = einsatz_plan();
        let posten: Vec<(&str, Option<&str>)> = p
            .posten
            .iter()
            .map(|x| (x.name.as_str(), x.abschnitt.as_deref()))
            .collect();
        assert_eq!(
            posten,
            vec![
                ("Streife 1", Some("Bühne")),
                ("UHS Markt", None),
                ("Pause", None)
            ]
        );
        let ids: Vec<i64> = p.schichten.iter().map(|s| s.id).collect();
        assert_eq!(ids, vec![4, 1, 2, 3]);
        let namen: Vec<&str> = p.personen.iter().map(|x| x.name.as_str()).collect();
        assert_eq!(namen, vec!["Ali Adhoc", "Jonas Fiktiv", "Sophie Vorlage"]);
    }

    #[test]
    fn bezuege_je_art_und_helfer_mit_eigener_kennung() {
        let p = einsatz_plan();
        let bezug = |s: &str| p.person_von(s).unwrap().bezug();
        assert_eq!(
            bezug("stamm:7"),
            ("personal-7".into(), EIGENE_HERKUNFT.into())
        );
        assert_eq!(
            bezug("einsatz:30"),
            ("einsatzkraft-30".into(), EIGENE_HERKUNFT.into())
        );
        assert_eq!(bezug("helfer:40"), ("10231".into(), "Helferplanung".into()));
        let jonas = p.person_von("helfer:40").unwrap();
        assert_eq!(jonas.qualifikationen, vec!["Sanitäter".to_string()]);
        assert_eq!(jonas.mit_organisation(), "Jonas Fiktiv (DRK Nachbarstadt)");
        let mut ohne = jonas.clone();
        ohne.kennung = None;
        assert_eq!(ohne.bezug().0, "helfer-40");
        ohne.art = AusgabePersonArt::Planungshelfer;
        assert_eq!(ohne.bezug(), ("40".into(), VORPLANUNG_HERKUNFT.into()));
    }

    #[test]
    fn befunde_mit_text_und_besetzung_ohne_pause() {
        let p = einsatz_plan();
        let befunde: Vec<(&str, &str)> = p
            .befunde()
            .map(|(_, b)| (b.person.as_deref().unwrap_or(""), b.text.as_str()))
            .collect();
        assert_eq!(
            befunde,
            vec![("stamm:7", "auch in Pause 15.08.2026 15:00–15:30")]
        );
        // Soll 3 an Block 1 (zwei eingeteilt), Block 4 und die UHS ohne Soll; Pause zählt nicht.
        assert_eq!(p.besetzung(), (2, 3, 1));
        assert_eq!(
            p.zeitraum(),
            Some((t("2026-08-15 10:00:00"), t("2026-08-16 02:00:00")))
        );
    }

    #[test]
    fn zeittexte_in_der_zone() {
        let (a, b) = (t("2026-08-15 22:00:00"), t("2026-08-16 02:00:00"));
        assert_eq!(tag(a, BERLIN), "16.08.2026");
        assert_eq!(uhr(a, BERLIN), "00:00");
        assert_eq!(bis_text(a, b, BERLIN), "04:00");
        assert_eq!(
            bis_text(t("2026-08-15 20:00:00"), a, BERLIN),
            "24:00",
            "Mitternacht des Folgetags"
        );
        assert_eq!(
            bis_text(t("2026-08-15 20:00:00"), t("2026-08-15 23:00:00"), BERLIN),
            "16.08.2026 01:00"
        );
        assert_eq!(dauer_text(45), "45 min");
        assert_eq!(dauer_text(480), "8 h");
        assert_eq!(dauer_text(810), "13:30 h");
        assert_eq!(namensfolge(" Öztürk"), "ozturk");
    }
}
