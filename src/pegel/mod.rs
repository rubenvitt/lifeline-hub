//! Maßgebliche Pegel eines Einsatzes (LFH-606): festgelegte PEGELONLINE-Stationen samt
//! aktuellem Wasserstand und Trend als Kennzahl für Dashboard und Überblick.
//!
//! - `repo`: die Festlegung (Tabelle `einsatz_pegel`, Reihenfolge = Leitpegel zuerst).
//! - `abruf`: die Zeitreihe je Station über PEGELONLINE, gecacht in `karte::cache`.
//! - `trend`: reine Trendrechnung (lineare Regression über 60 min).
//! - `vorhersage`: die Vorhersage-Reihe `WV` einer Station als Vorschlag für die Prognose
//!   (LFH-628) — nur ein Vorschlag, die Prognose selbst wird von Hand gepflegt.
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
pub mod vorhersage;

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

/// Erwarteter Höchststand an einem festgelegten Pegel (LFH-628), von Hand gepflegt.
///
/// Ein verstrichener Zeitpunkt bleibt stehen, bis jemand die Prognose löscht oder erneuert:
/// ob sie „abgelaufen" ist, entscheidet das Frontend gegen seine Uhr — dieselbe Arbeitsteilung
/// wie beim veralteten Messwert.
#[derive(Debug, Clone, PartialEq, Serialize, ToSchema)]
pub struct PegelPrognose {
    /// Erwarteter Höchststand in cm (dieselbe Einheit wie die Messung).
    pub hoechststand_cm: f64,
    /// Zeitpunkt des erwarteten Höchststands, UTC im Wire-Format `YYYY-MM-DD HH:MM:SS`.
    pub zeitpunkt: String,
    /// Wann die Prognose zuletzt gesetzt wurde (UTC, Wire-Format).
    pub gesetzt_at: String,
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
    /// Erwarteter Höchststand (LFH-628); fehlt, wenn keiner gepflegt ist.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub prognose: Option<PegelPrognose>,
}

/// Vorschlag aus der PEGELONLINE-Vorhersage-Reihe `WV` (LFH-628): der höchste Wert der
/// Reihe mit seinem Zeitpunkt. Nur ein Teil der Stationen führt die Reihe (gemessen
/// 22.09.2026: 43).
#[derive(Debug, Clone, PartialEq, Serialize, ToSchema)]
pub struct PegelVorhersage {
    /// Höchster Wert der Reihe in cm.
    pub hoechststand_cm: f64,
    /// Zeitpunkt dieses Werts, RFC 3339 mit Versatz, wie die Quelle ihn liefert.
    pub zeitpunkt: String,
    /// Wann die Vorhersage gerechnet wurde (`initialized` der Quelle), RFC 3339.
    pub erstellt: String,
    /// `true`, wenn der Höchstwert aus dem Abschätzungs-Teil der Reihe stammt (`type:
    /// "estimate"`) statt aus der Vorhersage — die Quelle unterscheidet beides ausdrücklich.
    pub abschaetzung: bool,
}

/// Antwort auf die Vorhersage-Abfrage. `vorhersage` fehlt, wenn die Station keine Reihe `WV`
/// führt — das ist kein Fehler, sondern der Normalfall für die meisten Stationen.
#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct PegelVorhersageAntwort {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub vorhersage: Option<PegelVorhersage>,
}
