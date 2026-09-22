//! Maßgebliche Pegel eines Einsatzes (LFH-606): festgelegte PEGELONLINE-Stationen samt
//! aktuellem Wasserstand und Trend als Kennzahl für Dashboard und Überblick.
//!
//! - `repo`: die Festlegung (Tabelle `einsatz_pegel`, Reihenfolge = Leitpegel zuerst).
//! - `abruf`: die Zeitreihe je Station über PEGELONLINE, gecacht in `karte::cache`.
//! - `trend`: reine Trendrechnung (lineare Regression über 60 min).
//!
//! **Kein Richtungs-Enum auf dem Draht**: die Richtung („steigend"/„fallend") formuliert das
//! Frontend aus `trend_cm_pro_h` — eine zweite Wahrheit neben der Zahl wäre eine Stelle mehr,
//! an der Schwelle und Anzeige auseinanderlaufen.
//!
//! Spec: `docs/superpowers/specs/2026-09-22-lfh-606-pegel-kennzahl-design.md`

use serde::Serialize;
use utoipa::ToSchema;

pub mod abruf;
pub mod repo;
pub mod trend;

/// Höchstzahl festgelegter Pegel je Einsatz.
pub const PEGEL_MAX: usize = 5;
/// Höchstlänge von `name` und `gewaesser` (Zeichen).
pub const NAME_MAX: usize = 200;

/// Aktueller Messwert einer Station mit Trend.
#[derive(Debug, Clone, PartialEq, Serialize, ToSchema)]
pub struct PegelMessung {
    /// Wasserstand der W-Reihe in cm (Einheit der PEGELONLINE-Reihe).
    pub wasserstand_cm: f64,
    /// Zeitpunkt der jüngsten Messung, RFC 3339 mit Zonenversatz, wie PEGELONLINE ihn
    /// liefert (z. B. `2026-09-22T09:15:00+02:00`). Er ist der ehrliche Datenstand — auch
    /// dann, wenn ein älterer Cache-Eintrag ausgeliefert wird.
    pub zeitpunkt: String,
    /// Trend in cm/h (lineare Regression über 60 min vor der jüngsten Messung, eine
    /// Nachkommastelle). Fehlt, wenn das Fenster zu dünn oder zu kurz ist.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub trend_cm_pro_h: Option<f64>,
}

/// Ein festgelegter Pegel eines Einsatzes.
#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct PegelAnzeige {
    pub id: i64,
    /// PEGELONLINE-Stations-UUID (kleingeschrieben).
    pub station_uuid: String,
    /// Stationsname zum Zeitpunkt des Festlegens (Snapshot).
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub gewaesser: Option<String>,
    /// Position in der Liste, ab 0; der erste Eintrag ist der Leitpegel.
    pub reihenfolge: i64,
    /// Fehlt, wenn weder ein Abruf gelang noch ein Cache-Eintrag vorliegt (Ausfall).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub messung: Option<PegelMessung>,
}
