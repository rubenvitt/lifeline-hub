//! Wetter am Einsatzort (LFH-633): die gültigen DWD-Warnungen der Warnzelle (Gemeinde), in
//! der der Einsatzort liegt, und eine Vorhersage der nächsten 24 Stunden.
//!
//! - `quelle`: reine Auswertung der Bright-Sky-Antworten (`/alerts`, `/weather`) und der
//!   Filter, der bei jeder Antwort abgelaufene Warnungen entfernt.
//! - `abruf`: Abruf mit Cache (stale-while-revalidate) nach dem Muster von `pegel::abruf`.
//!
//! **Quelle:** Bright Sky (`api.brightsky.dev`), eine freie JSON-API auf DWD-Open-Data. Sie
//! ordnet den Punkt selbst der Gemeinde-Warnzelle zu und nennt deren Namen — eigener
//! Geometrie-Code entfällt (design.md D1). Es gelten die Nutzungsbedingungen des DWD, der
//! Quellenvermerk „Datenbasis: Deutscher Wetterdienst“ steht im Frontend.
//!
//! **Zwei Teile, je ein eigener Zustand** (design.md D2): fällt ein Teil aus, bleibt der
//! andere stehen, und die Antwort ist trotzdem 200. „veraltet“ entscheidet das Frontend gegen
//! `abgerufen_at` und seine Uhr; die Obergrenze, ab der ein Stand gar nicht mehr gilt, prüft
//! das Backend, weil nur es das Cache-Alter kennt — dieselbe Arbeitsteilung wie beim Pegel.
//!
//! Spec: `openspec/changes/lfh-633-fachmodul-wetter-pegel/`

use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

pub mod abruf;
pub mod quelle;

/// Amtliche Warnstufe des DWD, abgebildet aus `severity` der Quelle. Wire == `as_str()`.
///
/// Die Reihenfolge der Varianten ist die Schwere (`Ord`): die Liste wird danach absteigend
/// sortiert.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum WetterWarnstufe {
    /// `minor` — „Wetterwarnung“.
    Gering,
    /// `moderate` — „Markantes Wetter“.
    Maessig,
    /// `severe` — „Unwetterwarnung“.
    Schwer,
    /// `extreme` — „Extremes Unwetter“.
    Extrem,
}

impl WetterWarnstufe {
    pub fn as_str(&self) -> &'static str {
        match self {
            WetterWarnstufe::Gering => "gering",
            WetterWarnstufe::Maessig => "maessig",
            WetterWarnstufe::Schwer => "schwer",
            WetterWarnstufe::Extrem => "extrem",
        }
    }
}

/// Zustand eines Teils der Wetter-Antwort. Wire == `as_str()`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum WetterTeilZustand {
    /// Ein verwertbarer Stand liegt vor (`daten` ist gesetzt, `abgerufen_at` ebenfalls).
    Ok,
    /// Der Einsatz hat keine Koordinate des Einsatzorts; es gab keinen Abruf.
    KeinOrt,
    /// Kein verwertbarer Stand: kein Cache und der Abruf scheiterte, oder der Cache ist älter
    /// als die Obergrenze (Warnungen 6 h, Vorhersage 12 h). Die Seite zeigt „Stand unbekannt“.
    Ausfall,
}

impl WetterTeilZustand {
    pub fn as_str(&self) -> &'static str {
        match self {
            WetterTeilZustand::Ok => "ok",
            WetterTeilZustand::KeinOrt => "kein_ort",
            WetterTeilZustand::Ausfall => "ausfall",
        }
    }
}

/// Die Warnzelle (Gemeinde), in der der Einsatzort liegt — `location` der Quelle.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ToSchema)]
pub struct WetterOrt {
    /// Name der Warnzelle, z. B. „Stadt Bremerhaven“.
    pub name: String,
    /// Kreis bzw. kreisfreie Stadt (`district`).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub kreis: Option<String>,
    /// Bundesland (`state`).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub land: Option<String>,
}

/// Eine amtliche Wetterwarnung des DWD. Zeitpunkte RFC 3339 in UTC (`…Z`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ToSchema)]
pub struct WetterWarnung {
    pub stufe: WetterWarnstufe,
    /// Ereignis, z. B. „STURMBÖEN“ (`event_de`; so schreibt der DWD es).
    pub ereignis: String,
    /// Überschrift, z. B. „Amtliche WARNUNG vor STURMBÖEN“ (`headline_de`).
    pub ueberschrift: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub beschreibung: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub handlungsempfehlung: Option<String>,
    /// Beginn (`onset`). „gilt jetzt“ gegen „angekündigt“ trennt das Frontend daran.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub beginn: Option<String>,
    /// Ende (`expires`). Fehlt, wenn die Quelle keins nennt; eine Warnung mit verstrichenem
    /// Ende erscheint nie.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ende: Option<String>,
    /// Ausgabe der Warnung (`effective`).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ausgegeben: Option<String>,
}

/// Vorhersagewerte einer Stunde (MOSMIX). Jeder Wert, den die Quelle nicht liefert, fehlt —
/// er wird nie zu 0.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ToSchema)]
pub struct WetterStunde {
    /// Beginn der Stunde, RFC 3339 in UTC (`…Z`).
    pub zeitpunkt: String,
    /// Lufttemperatur in °C.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub temperatur_c: Option<f64>,
    /// Niederschlag der Stunde in mm.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub niederschlag_mm: Option<f64>,
    /// Niederschlagswahrscheinlichkeit in %.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub niederschlag_wahrscheinlichkeit: Option<f64>,
    /// Mittlerer Wind in km/h.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub wind_kmh: Option<f64>,
    /// Böen in km/h.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub boeen_kmh: Option<f64>,
    /// Windrichtung in Grad (0 = Nord, im Uhrzeigersinn), woher der Wind weht.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub windrichtung_grad: Option<f64>,
}

/// Vorhersage für den Einsatzort: die Station, aus deren Vorhersage die Werte stammen, und
/// die Stunden ab der laufenden Stunde, aufsteigend.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ToSchema)]
pub struct WetterVorhersage {
    /// Stationsname, wie die Quelle ihn führt (MOSMIX: Großbuchstaben, z. B. „BREMEN“).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub station: Option<String>,
    /// Entfernung der Station zum (gerundeten) Einsatzort in Metern.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub entfernung_m: Option<f64>,
    pub stunden: Vec<WetterStunde>,
}

/// Teil „Warnungen“ der Wetter-Antwort.
#[derive(Debug, Clone, PartialEq, Serialize, ToSchema)]
pub struct WetterWarnungen {
    pub zustand: WetterTeilZustand,
    /// Zeitpunkt des letzten erfolgreichen Abrufs, RFC 3339 in UTC. Nur bei `ok`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub abgerufen_at: Option<String>,
    /// Gültige Warnungen, Stufe absteigend, dann Beginn aufsteigend. Nur bei `ok` — dort
    /// auch leer, wenn keine gilt.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub daten: Option<Vec<WetterWarnung>>,
}

/// Teil „Vorhersage“ der Wetter-Antwort.
#[derive(Debug, Clone, PartialEq, Serialize, ToSchema)]
pub struct WetterVorhersageTeil {
    pub zustand: WetterTeilZustand,
    /// Zeitpunkt des letzten erfolgreichen Abrufs, RFC 3339 in UTC. Nur bei `ok`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub abgerufen_at: Option<String>,
    /// Nur bei `ok`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub daten: Option<WetterVorhersage>,
}

/// Antwort von `GET /api/einsaetze/{id}/wetter`.
#[derive(Debug, Clone, PartialEq, Serialize, ToSchema)]
pub struct WetterAnzeige {
    /// Warnzelle des Einsatzorts. Fehlt ohne Einsatzort und solange kein Warnstand vorliegt.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ort: Option<WetterOrt>,
    pub warnungen: WetterWarnungen,
    pub vorhersage: WetterVorhersageTeil,
}
