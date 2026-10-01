//! Wetter am Einsatzort (LFH-633): die gültigen DWD-Warnungen der Warnzelle (Gemeinde), in
//! der der Einsatzort liegt, eine Vorhersage der nächsten 24 Stunden und (LFH-864) die
//! jüngste Messung der nächsten DWD-Wetterstation.
//!
//! - `quelle`: reine Auswertung der Bright-Sky-Antworten (`/alerts`, `/weather`,
//!   `/current_weather`) und der Filter, der bei jeder Antwort abgelaufene Warnungen entfernt.
//! - `abruf`: Abruf mit Cache (stale-while-revalidate) nach dem Muster von `pegel::abruf`.
//!
//! **Quelle:** Bright Sky (`api.brightsky.dev`), eine freie JSON-API auf DWD-Open-Data. Sie
//! ordnet den Punkt selbst der Gemeinde-Warnzelle zu und nennt deren Namen — eigener
//! Geometrie-Code entfällt (design.md D1). Es gelten die Nutzungsbedingungen des DWD, der
//! Quellenvermerk „Datenbasis: Deutscher Wetterdienst“ steht im Frontend.
//!
//! **Drei Teile, je ein eigener Zustand** (design.md D2): fällt ein Teil aus, bleiben die
//! anderen stehen, und die Antwort ist trotzdem 200. „veraltet“ entscheidet das Frontend gegen
//! `abgerufen_at` und seine Uhr; die Obergrenze, ab der ein Stand gar nicht mehr gilt, prüft
//! das Backend, weil nur es das Cache-Alter kennt — dieselbe Arbeitsteilung wie beim Pegel.
//!
//! Spec: `openspec/changes/archive/2026-09-29-lfh-633-fachmodul-wetter-pegel/`, für die
//! aktuellen Bedingungen `openspec/changes/lfh-864-aktuelle-bedingungen/`.

use crate::wire_enum::wire_enum;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

pub mod abruf;
pub mod quelle;

wire_enum! {
    /// Amtliche Warnstufe des DWD, abgebildet aus `severity` der Quelle. Wire == `as_str()`.
    ///
    /// Die Reihenfolge der Varianten ist die Schwere (`Ord`): die Liste wird danach absteigend
    /// sortiert.
    #[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize, ToSchema)]
    pub enum WetterWarnstufe {
        /// `minor` — „Wetterwarnung“.
        Gering => "gering",
        /// `moderate` — „Markantes Wetter“.
        Maessig => "maessig",
        /// `severe` — „Unwetterwarnung“.
        Schwer => "schwer",
        /// `extreme` — „Extremes Unwetter“.
        Extrem => "extrem",
    }
}

wire_enum! {
    /// Zustand eines Teils der Wetter-Antwort. Wire == `as_str()`.
    #[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]
    pub enum WetterTeilZustand {
        /// Ein verwertbarer Stand liegt vor (`daten` ist gesetzt, `abgerufen_at` ebenfalls).
        Ok => "ok",
        /// Der Einsatz hat keine Koordinate des Einsatzorts; es gab keinen Abruf.
        KeinOrt => "kein_ort",
        /// Kein verwertbarer Stand: kein Cache und der Abruf scheiterte, oder der Cache ist älter
        /// als die Obergrenze (Warnungen 6 h, Vorhersage 12 h, Aktuell 3 h; bei Aktuell auch
        /// eine Messung älter als 3 h). Die Seite zeigt „Stand unbekannt“.
        Ausfall => "ausfall",
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

wire_enum! {
    /// Wetterlage der jüngsten Messung, aus `icon` von `/current_weather` (LFH-864, design.md
    /// D5). Die Quelle trennt Tag und Nacht nur bei klar und teils bewölkt; Nebel teilt
    /// `quelle` selbst nach dem Sonnenstand an der Station. Wire == `as_str()`.
    #[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
    pub enum WetterSymbol {
        /// `clear-day`
        KlarTag => "klar_tag",
        /// `clear-night`
        KlarNacht => "klar_nacht",
        /// `partly-cloudy-day`
        TeilsBewoelktTag => "teils_bewoelkt_tag",
        /// `partly-cloudy-night`
        TeilsBewoelktNacht => "teils_bewoelkt_nacht",
        /// `cloudy`
        Bewoelkt => "bewoelkt",
        /// `fog`, Sonne über dem Horizont der Station.
        NebelTag => "nebel_tag",
        /// `fog`, Sonne unter dem Horizont der Station.
        NebelNacht => "nebel_nacht",
        /// `wind`
        Wind => "wind",
        /// `rain`
        Regen => "regen",
        /// `sleet`
        Schneeregen => "schneeregen",
        /// `snow`
        Schnee => "schnee",
        /// `hail`
        Hagel => "hagel",
        /// `thunderstorm`
        Gewitter => "gewitter",
    }
}

wire_enum! {
    /// Eine gezeigte Messgröße der aktuellen Bedingungen — benennt, welche Werte die Quelle aus
    /// einer anderen Station ergänzt hat. Die Reihenfolge ist die der Anzeige und ordnet
    /// `WetterErgaenzung::groessen`. Wire == `as_str()`.
    #[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize, ToSchema)]
    pub enum WetterMessgroesse {
        Temperatur => "temperatur",
        Wind => "wind",
        Boeen => "boeen",
        Niederschlag => "niederschlag",
        Wetterlage => "wetterlage",
        Sicht => "sicht",
        Bewoelkung => "bewoelkung",
        Luftfeuchte => "luftfeuchte",
        Taupunkt => "taupunkt",
        Luftdruck => "luftdruck",
    }
}

/// Eine Wetterstation, wie die Quelle sie nennt (SYNOP).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ToSchema)]
pub struct WetterStation {
    /// Stationsname, z. B. „Bremen“ oder „Hameln-Hastenbeck“.
    pub name: String,
    /// Entfernung zum (gerundeten) Einsatzort in Metern.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub entfernung_m: Option<f64>,
}

/// Werte, die die Quelle aus einer anderen als der nächsten Station ergänzt hat
/// (`fallback_source_ids`), gruppiert je Station.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ToSchema)]
pub struct WetterErgaenzung {
    pub station: WetterStation,
    /// Die ergänzten gezeigten Größen, in der Reihenfolge von [`WetterMessgroesse`].
    pub groessen: Vec<WetterMessgroesse>,
}

/// Die jüngste Messung der nächsten DWD-Wetterstation (LFH-864). Jeder Wert, den die Quelle
/// nicht liefert, fehlt — er wird nie zu 0.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ToSchema)]
pub struct WetterAktuell {
    /// Messzeit (`timestamp`), RFC 3339 in UTC (`…Z`). Sie ist der Stand des Teils.
    pub gemessen_at: String,
    /// Die Station der Messung (`source_id`).
    pub station: WetterStation,
    /// Wetterlage aus `icon`; fehlt bei einem unbekannten Wert.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub symbol: Option<WetterSymbol>,
    /// Lufttemperatur in °C.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub temperatur_c: Option<f64>,
    /// Taupunkt in °C.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub taupunkt_c: Option<f64>,
    /// Relative Luftfeuchte in %.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub luftfeuchte_prozent: Option<f64>,
    /// Luftdruck auf Meereshöhe in hPa.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub luftdruck_hpa: Option<f64>,
    /// Sichtweite in Metern.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sicht_m: Option<f64>,
    /// Bewölkung in %.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bewoelkung_prozent: Option<f64>,
    /// Mittlerer Wind der letzten 10 Minuten in km/h (`wind_speed_10`).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub wind_kmh: Option<f64>,
    /// Windrichtung der letzten 10 Minuten in Grad (0 = Nord), woher der Wind weht.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub windrichtung_grad: Option<f64>,
    /// Stärkste Böe der letzten 60 Minuten in km/h (`wind_gust_speed_60`).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub boeen_kmh: Option<f64>,
    /// Niederschlag der letzten 60 Minuten in mm (`precipitation_60`).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub niederschlag_mm: Option<f64>,
    /// Werte aus anderen Stationen; leer, wenn alles von [`Self::station`] stammt.
    pub ergaenzt: Vec<WetterErgaenzung>,
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

/// Teil „Aktuell“ der Wetter-Antwort (LFH-864).
#[derive(Debug, Clone, PartialEq, Serialize, ToSchema)]
pub struct WetterAktuellTeil {
    pub zustand: WetterTeilZustand,
    /// Zeitpunkt des letzten erfolgreichen Abrufs, RFC 3339 in UTC. Nur bei `ok`. Den Stand
    /// trägt `daten.gemessen_at`, nicht der Abruf.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub abgerufen_at: Option<String>,
    /// Nur bei `ok`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub daten: Option<WetterAktuell>,
}

/// Antwort von `GET /api/einsaetze/{id}/wetter`.
#[derive(Debug, Clone, PartialEq, Serialize, ToSchema)]
pub struct WetterAnzeige {
    /// Warnzelle des Einsatzorts. Fehlt ohne Einsatzort und solange kein Warnstand vorliegt.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ort: Option<WetterOrt>,
    pub warnungen: WetterWarnungen,
    pub vorhersage: WetterVorhersageTeil,
    pub aktuell: WetterAktuellTeil,
}
