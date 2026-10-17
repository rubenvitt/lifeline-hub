//! Schichtmodelle (LLH-1122, Entscheidung LLH-1118 Punkte 2 und 5): wie lange eine Schicht
//! läuft, bevor die Einheit abgelöst werden muss.
//!
//! Ein Modell hat einen Typ: `rhythmus` (feste Dauer ab Beginn) oder `wechselzeiten` (feste
//! Uhrzeiten wie 06:00/18:00 mit Mindestdauer). Dazu je Modell die Vorwarnung (Vorgabe 30 min)
//! und der Planungsvorlauf (Vorgabe 2 h, genutzt ab LLH-1131).
//!
//! - **Stammdatum der Organisation** (`schichtmodell`, [`repo`]): höchstens eines ist die
//!   „Vorgabe der Organisation“.
//! - **Kopie am Einsatz** (`einsatz_schichtmodell`): die Einsatzanlage kopiert die Vorgabe der
//!   Organisation ([`repo::copy_org_vorgabe_tx`]). Spätere Stammdatenänderungen verschieben
//!   keine laufende Fälligkeit; ohne Org-Vorgabe hat der Einsatz keine (keine erfundene Zahl).
//!
//! Die Fälligkeit rechnet [`Regel::faelligkeit`] rein und deterministisch; gespeichert wird sie
//! an der Schicht (`einsatz_abloesung.faellig_at`).
//!
//! Spec: `openspec/specs/kraefte-abloesung/spec.md`, „Schichtmodelle der Organisation“ und
//! „Vorgabe des Einsatzes“.

use chrono::{DateTime, Duration, LocalResult, NaiveDate, NaiveTime, TimeZone, Utc};
use chrono_tz::Tz;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use crate::error::AppError;
use crate::uhrzeit::Uhrzeit;
use crate::wire_enum::wire_enum;

pub mod repo;

/// Bezeichnung eines Modells nach dem Trimmen. Sie steht unverändert im ETB („Schichtmodell
/// «12-h-Schicht» gesetzt“) und liegt weit unter `etb::INHALT_MAX`.
pub const BEZEICHNUNG_MAX: usize = 100;

/// Höchstens so viele Wechselzeiten je Modell (eine je Stunde), gezählt vor dem Entdoppeln.
pub const WECHSELZEITEN_MAX: usize = 24;

/// Obergrenze der Mindestdauer bei Wechselzeiten: ein Tag. Mehr hieße, ganze Wechsel
/// auszulassen; das ist ein Rhythmus. So bleibt die gerechnete Dauer unter zwei Tagen und damit
/// im Wertebereich von `einsatz_abloesung.rhythmus_minuten`.
pub const MINDESTDAUER_MAX_MINUTEN: i64 = 1_440;

/// Obergrenze von Vorwarnung und Planungsvorlauf: ein Tag (DB-CHECK in `0212_schichtmodell.sql`).
pub const VORLAUF_MAX_MINUTEN: i64 = 1_440;

/// Vorwarnung, wenn das Modell nichts anderes sagt, und für Schichten eines Einsatzes ohne
/// Einsatzvorgabe.
pub const VORWARNUNG_VORGABE_MINUTEN: i64 = 30;

/// Planungsvorlauf, wenn das Modell nichts anderes sagt.
pub const PLANUNGSVORLAUF_VORGABE_MINUTEN: i64 = 120;

wire_enum! {
    /// Typ eines Schichtmodells. Wire == `as_str()`.
    #[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]
    pub enum SchichtmodellTyp {
        /// Feste Dauer ab Beginn der Schicht.
        Rhythmus => "rhythmus",
        /// Feste Wechselzeiten: fällig ist der erste Wechsel nach Beginn + Mindestdauer.
        Wechselzeiten => "wechselzeiten",
    }
    try_from = |s| format!("Ungültiger Schichtmodell-Typ: {s}");
}

/// Die Regel, nach der eine Schicht fällig wird.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Regel {
    /// Beginn + `minuten`.
    Rhythmus { minuten: i64 },
    /// Erster Wechsel nach Beginn + Mindestdauer. `zeiten` sortiert und ohne Doppel.
    Wechselzeiten {
        zeiten: Vec<Uhrzeit>,
        mindestdauer_minuten: i64,
    },
}

impl Regel {
    pub fn typ(&self) -> SchichtmodellTyp {
        match self {
            Regel::Rhythmus { .. } => SchichtmodellTyp::Rhythmus,
            Regel::Wechselzeiten { .. } => SchichtmodellTyp::Wechselzeiten,
        }
    }

    /// Fälligkeit einer Schicht mit Beginn `beginn_at` (kanonische UTC-Zeit) und die Dauer bis
    /// dahin in Minuten. Wechselzeiten gelten als Wanduhrzeit in `zone`. `None` bei unparsbarem
    /// Beginn oder einem Ergebnis außerhalb des darstellbaren Bereichs.
    pub fn faelligkeit(&self, beginn_at: &str, zone: Tz) -> Option<(String, i64)> {
        match self {
            Regel::Rhythmus { minuten } => {
                crate::zeit::plus_minuten(beginn_at, *minuten).map(|f| (f, *minuten))
            }
            Regel::Wechselzeiten {
                zeiten,
                mindestdauer_minuten,
            } => {
                let beginn = crate::zeit::parse_utc(beginn_at)?;
                let faellig =
                    faelligkeit_wechselzeiten(beginn, zeiten, *mindestdauer_minuten, zone)?;
                // Aufgerundet: ein Beginn mit Sekunden kurz vor dem Wechsel ist keine Schicht
                // von 0 min (`rhythmus_minuten > 0`).
                let dauer = ((faellig - beginn).num_seconds() + 59) / 60;
                Some((crate::zeit::formatiere_utc(faellig), dauer))
            }
        }
    }

    /// Lesbar für ETB und Meldungen: „Rhythmus 12 h“, „Wechsel 06:00/18:00, Mindestdauer 4 h“.
    pub fn text(&self) -> String {
        match self {
            Regel::Rhythmus { minuten } => {
                format!("Rhythmus {}", crate::abloesung::rhythmus_text(*minuten))
            }
            Regel::Wechselzeiten {
                zeiten,
                mindestdauer_minuten,
            } => {
                let liste = zeiten
                    .iter()
                    .map(Uhrzeit::to_string)
                    .collect::<Vec<_>>()
                    .join("/");
                match mindestdauer_minuten {
                    0 => format!("Wechsel {liste}"),
                    m => format!(
                        "Wechsel {liste}, Mindestdauer {}",
                        crate::abloesung::rhythmus_text(*m)
                    ),
                }
            }
        }
    }
}

/// Erster Wechsel ab `beginn + mindestdauer` (einschließlich) und echt nach `beginn`, als
/// Zeitpunkt in UTC. Die Wechselzeiten sind Wanduhrzeiten in `zone`; über die Zeitumstellung
/// zählt die echte Dauer, nicht die Uhr. Eine Uhrzeit, die es am Umstellungstag nicht gibt
/// (02:30 Ende März), gilt eine Stunde später; eine doppelte (02:30 Ende Oktober) beim ersten
/// Mal. `None` ohne Wechselzeiten oder außerhalb des darstellbaren Bereichs.
///
/// Rein und deterministisch; Grenzfälle in den Tests unten (Spec `kraefte-abloesung`,
/// „Fälligkeit nach Wechselzeiten“).
pub fn faelligkeit_wechselzeiten(
    beginn: DateTime<Utc>,
    zeiten: &[Uhrzeit],
    mindestdauer_minuten: i64,
    zone: Tz,
) -> Option<DateTime<Utc>> {
    let schwelle = beginn.checked_add_signed(Duration::try_minutes(mindestdauer_minuten)?)?;
    let start: NaiveDate = schwelle.with_timezone(&zone).date_naive().pred_opt()?;
    // Drei Kalendertage ab dem Vortag der Schwelle fassen jeden Fall: die Mindestdauer ist
    // höchstens ein Tag, und jeder Tag hat jede Wechselzeit (bis auf eine Lücke von 1 h).
    (0..4)
        .filter_map(|tage| start.checked_add_signed(Duration::days(tage)))
        .flat_map(|tag| zeiten.iter().filter_map(move |z| wall_clock(tag, *z, zone)))
        .filter(|t| *t >= schwelle && *t > beginn)
        .min()
}

/// Wanduhrzeit `uhrzeit` am Kalendertag `tag` in `zone` als UTC-Zeitpunkt (Regeln oben).
fn wall_clock(tag: NaiveDate, uhrzeit: Uhrzeit, zone: Tz) -> Option<DateTime<Utc>> {
    let zeit =
        NaiveTime::from_hms_opt(u32::from(uhrzeit.stunde()), u32::from(uhrzeit.minute()), 0)?;
    let lokal = tag.and_time(zeit);
    match zone.from_local_datetime(&lokal) {
        LocalResult::Single(t) => Some(t.with_timezone(&Utc)),
        LocalResult::Ambiguous(frueh, _) => Some(frueh.with_timezone(&Utc)),
        LocalResult::None => zone
            .from_local_datetime(&(lokal + Duration::hours(1)))
            .earliest()
            .map(|t| t.with_timezone(&Utc)),
    }
}

/// Geprüfte Werte eines Schichtmodells, als Stammdatum oder als Kopie am Einsatz.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Werte {
    /// Getrimmt, nicht leer, höchstens [`BEZEICHNUNG_MAX`].
    pub bezeichnung: String,
    pub regel: Regel,
    pub vorwarnung_minuten: i64,
    pub planungsvorlauf_minuten: i64,
}

/// Body der Werte eines Modells (Stammdaten anlegen und ändern, Einsatzvorgabe setzen).
/// Vorwarnung und Planungsvorlauf fehlen = Vorgabe.
#[derive(Debug, Clone, Deserialize)]
pub struct WerteBody {
    pub bezeichnung: String,
    /// `rhythmus` | `wechselzeiten`.
    pub typ: String,
    #[serde(default)]
    pub rhythmus_minuten: Option<i64>,
    /// Uhrzeiten `HH:MM` oder `HHMM`.
    #[serde(default)]
    pub wechselzeiten: Option<Vec<String>>,
    #[serde(default)]
    pub mindestdauer_minuten: Option<i64>,
    #[serde(default)]
    pub vorwarnung_minuten: Option<i64>,
    #[serde(default)]
    pub planungsvorlauf_minuten: Option<i64>,
}

fn check_range(feld: &str, wert: i64, min: i64, max: i64) -> Result<i64, AppError> {
    if wert < min || wert > max {
        return Err(AppError::Validation(format!(
            "{feld} muss zwischen {min} und {max} liegen, war {wert}"
        )));
    }
    Ok(wert)
}

impl WerteBody {
    /// Prüft den Body (`src/AGENTS.md`, Statuscode-Konvention): erst jedes Feld für sich (400:
    /// leere Bezeichnung, unbekannter Typ, Zahl außerhalb, unlesbare Uhrzeit, zu viele
    /// Wechselzeiten, fehlender Pflichtwert des Typs), dann der Zusammenhang (422: ein Feld des
    /// anderen Typs). Wechselzeiten werden sortiert und entdoppelt.
    pub fn check(&self) -> Result<Werte, AppError> {
        let bezeichnung =
            crate::routes::support::pflicht_max(&self.bezeichnung, "bezeichnung", BEZEICHNUNG_MAX)?;
        let typ = SchichtmodellTyp::parse(self.typ.trim()).ok_or_else(|| {
            AppError::Validation(format!(
                "Unbekannter Typ '{}' (erlaubt: rhythmus, wechselzeiten)",
                self.typ
            ))
        })?;
        let rhythmus = self
            .rhythmus_minuten
            .map(|r| {
                check_range(
                    "rhythmus_minuten",
                    r,
                    1,
                    crate::abloesung::RHYTHMUS_MAX_MINUTEN,
                )
            })
            .transpose()?;
        let zeiten = match &self.wechselzeiten {
            None => None,
            Some(liste) => {
                if liste.len() > WECHSELZEITEN_MAX {
                    return Err(AppError::Validation(format!(
                        "Höchstens {WECHSELZEITEN_MAX} Wechselzeiten, waren {}",
                        liste.len()
                    )));
                }
                let mut zeiten = liste
                    .iter()
                    .map(|s| Uhrzeit::parse("wechselzeiten", s))
                    .collect::<Result<Vec<_>, _>>()?;
                zeiten.sort();
                zeiten.dedup();
                Some(zeiten)
            }
        };
        let mindestdauer = self
            .mindestdauer_minuten
            .map(|m| check_range("mindestdauer_minuten", m, 0, MINDESTDAUER_MAX_MINUTEN))
            .transpose()?;
        let vorwarnung = check_range(
            "vorwarnung_minuten",
            self.vorwarnung_minuten
                .unwrap_or(VORWARNUNG_VORGABE_MINUTEN),
            1,
            VORLAUF_MAX_MINUTEN,
        )?;
        let planungsvorlauf = check_range(
            "planungsvorlauf_minuten",
            self.planungsvorlauf_minuten
                .unwrap_or(PLANUNGSVORLAUF_VORGABE_MINUTEN),
            1,
            VORLAUF_MAX_MINUTEN,
        )?;
        let regel = match typ {
            SchichtmodellTyp::Rhythmus => {
                let minuten = rhythmus.ok_or_else(|| {
                    AppError::Validation("rhythmus_minuten fehlt (Typ rhythmus)".into())
                })?;
                if zeiten.is_some() || mindestdauer.is_some() {
                    return Err(AppError::UnprocessableEntity(
                        "Ein Rhythmus-Modell hat keine Wechselzeiten und keine Mindestdauer".into(),
                    ));
                }
                Regel::Rhythmus { minuten }
            }
            SchichtmodellTyp::Wechselzeiten => {
                let zeiten = zeiten.filter(|z| !z.is_empty()).ok_or_else(|| {
                    AppError::Validation("wechselzeiten fehlt (Typ wechselzeiten)".into())
                })?;
                let mindestdauer_minuten = mindestdauer.ok_or_else(|| {
                    AppError::Validation("mindestdauer_minuten fehlt (Typ wechselzeiten)".into())
                })?;
                if rhythmus.is_some() {
                    return Err(AppError::UnprocessableEntity(
                        "Ein Modell mit Wechselzeiten hat keinen Rhythmus".into(),
                    ));
                }
                Regel::Wechselzeiten {
                    zeiten,
                    mindestdauer_minuten,
                }
            }
        };
        Ok(Werte {
            bezeichnung,
            regel,
            vorwarnung_minuten: vorwarnung,
            planungsvorlauf_minuten: planungsvorlauf,
        })
    }
}

/// Spalten eines Modells in Datenbankform: (typ, rhythmus, wechselzeiten als JSON, mindestdauer).
pub(crate) fn columns(regel: &Regel) -> (&'static str, Option<i64>, Option<String>, Option<i64>) {
    match regel {
        Regel::Rhythmus { minuten } => (regel.typ().as_str(), Some(*minuten), None, None),
        Regel::Wechselzeiten {
            zeiten,
            mindestdauer_minuten,
        } => (
            regel.typ().as_str(),
            None,
            Some(
                serde_json::Value::from(zeiten.iter().map(Uhrzeit::to_string).collect::<Vec<_>>())
                    .to_string(),
            ),
            Some(*mindestdauer_minuten),
        ),
    }
}

/// Eine Zeile der Werte, wie `schichtmodell` und `einsatz_schichtmodell` sie tragen.
#[derive(Debug, Clone, sqlx::FromRow)]
pub(crate) struct WerteZeile {
    pub bezeichnung: String,
    pub typ: String,
    pub rhythmus_minuten: Option<i64>,
    pub wechselzeiten: Option<String>,
    pub mindestdauer_minuten: Option<i64>,
    pub vorwarnung_minuten: i64,
    pub planungsvorlauf_minuten: i64,
}

impl WerteZeile {
    /// Die CHECKs der Tabellen lassen nur Vollständiges zu; was trotzdem nicht passt, ist ein
    /// Datenfehler (500), keine Eingabe.
    pub fn werte(self) -> Result<Werte, AppError> {
        let kaputt = |was: &str| AppError::Internal(format!("Schichtmodell: {was}"));
        let regel = match (
            SchichtmodellTyp::parse(&self.typ),
            self.rhythmus_minuten,
            self.wechselzeiten,
            self.mindestdauer_minuten,
        ) {
            (Some(SchichtmodellTyp::Rhythmus), Some(minuten), _, _) => Regel::Rhythmus { minuten },
            (Some(SchichtmodellTyp::Wechselzeiten), _, Some(json), Some(mindestdauer_minuten)) => {
                let texte: Vec<String> =
                    serde_json::from_str(&json).map_err(|_| kaputt("Wechselzeiten unlesbar"))?;
                let zeiten = texte
                    .iter()
                    .map(|s| Uhrzeit::parse("wechselzeiten", s))
                    .collect::<Result<Vec<_>, _>>()
                    .map_err(|_| kaputt("Wechselzeit unlesbar"))?;
                Regel::Wechselzeiten {
                    zeiten,
                    mindestdauer_minuten,
                }
            }
            _ => return Err(kaputt("Typ und Werte passen nicht")),
        };
        Ok(Werte {
            bezeichnung: self.bezeichnung,
            regel,
            vorwarnung_minuten: self.vorwarnung_minuten,
            planungsvorlauf_minuten: self.planungsvorlauf_minuten,
        })
    }
}

/// Felder der Regel für die Antworten.
struct RegelFields {
    typ: SchichtmodellTyp,
    rhythmus_minuten: Option<i64>,
    wechselzeiten: Option<Vec<String>>,
    mindestdauer_minuten: Option<i64>,
}

fn regel_fields(regel: &Regel) -> RegelFields {
    match regel {
        Regel::Rhythmus { minuten } => RegelFields {
            typ: SchichtmodellTyp::Rhythmus,
            rhythmus_minuten: Some(*minuten),
            wechselzeiten: None,
            mindestdauer_minuten: None,
        },
        Regel::Wechselzeiten {
            zeiten,
            mindestdauer_minuten,
        } => RegelFields {
            typ: SchichtmodellTyp::Wechselzeiten,
            rhythmus_minuten: None,
            wechselzeiten: Some(zeiten.iter().map(Uhrzeit::to_string).collect()),
            mindestdauer_minuten: Some(*mindestdauer_minuten),
        },
    }
}

/// Ein Schichtmodell der Organisation.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, ToSchema)]
pub struct Schichtmodell {
    pub id: i64,
    pub bezeichnung: String,
    pub typ: SchichtmodellTyp,
    /// Nur bei Typ `rhythmus`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rhythmus_minuten: Option<i64>,
    /// Nur bei Typ `wechselzeiten`: Wanduhrzeiten `HH:MM`, sortiert.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub wechselzeiten: Option<Vec<String>>,
    /// Nur bei Typ `wechselzeiten`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mindestdauer_minuten: Option<i64>,
    pub vorwarnung_minuten: i64,
    pub planungsvorlauf_minuten: i64,
    /// Die Vorgabe der Organisation; neue Einsätze kopieren sie.
    pub ist_vorgabe: bool,
    /// Vom Demo-Import angelegt (Marke in `demo_herkunft`, live gelesen).
    pub ist_demo: bool,
}

impl Schichtmodell {
    pub(crate) fn from_werte(id: i64, werte: Werte, ist_vorgabe: bool, ist_demo: bool) -> Self {
        let f = regel_fields(&werte.regel);
        Schichtmodell {
            id,
            bezeichnung: werte.bezeichnung,
            typ: f.typ,
            rhythmus_minuten: f.rhythmus_minuten,
            wechselzeiten: f.wechselzeiten,
            mindestdauer_minuten: f.mindestdauer_minuten,
            vorwarnung_minuten: werte.vorwarnung_minuten,
            planungsvorlauf_minuten: werte.planungsvorlauf_minuten,
            ist_vorgabe,
            ist_demo,
        }
    }
}

/// Die Kopie eines Schichtmodells am Einsatz.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, ToSchema)]
pub struct EinsatzSchichtmodell {
    pub bezeichnung: String,
    pub typ: SchichtmodellTyp,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rhythmus_minuten: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub wechselzeiten: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mindestdauer_minuten: Option<i64>,
    pub vorwarnung_minuten: i64,
    pub planungsvorlauf_minuten: i64,
    pub geaendert_at: String,
}

impl EinsatzSchichtmodell {
    pub(crate) fn from_werte(werte: Werte, geaendert_at: String) -> Self {
        let f = regel_fields(&werte.regel);
        EinsatzSchichtmodell {
            bezeichnung: werte.bezeichnung,
            typ: f.typ,
            rhythmus_minuten: f.rhythmus_minuten,
            wechselzeiten: f.wechselzeiten,
            mindestdauer_minuten: f.mindestdauer_minuten,
            vorwarnung_minuten: werte.vorwarnung_minuten,
            planungsvorlauf_minuten: werte.planungsvorlauf_minuten,
            geaendert_at,
        }
    }
}

#[cfg(test)]
mod tests;
