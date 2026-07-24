//! Kartenansichten (LFH-319): einsatzweit geteilte, benannte Karten-Konfiguration.
//! Eine Standardansicht je Einsatz wird lazy aus `einsatz_einstellungen` geseedet.
//! Inkrement A liefert genau die Standardansicht + „Für den Einsatz speichern"
//! (überschreiben); mehrere Ansichten/CRUD folgen in Inkrement B (LFH-320).

pub mod repo;

use crate::einsatz::einstellungen::BasemapModus;
use serde::Serialize;
use utoipa::ToSchema;

/// Karten-Theme (Schema-Anker für die OpenAPI-Union, LFH-120). Wire == `karten_theme`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum KartenTheme {
    Auto,
    Light,
    Dark,
}

impl KartenTheme {
    pub fn as_str(self) -> &'static str {
        match self {
            KartenTheme::Auto => "auto",
            KartenTheme::Light => "light",
            KartenTheme::Dark => "dark",
        }
    }
}

/// Wire-Whitelist für `karten_theme` (Validierung in Rust, kein DB-CHECK — analog
/// `einstellungen::ist_gueltiger_basemap_modus`).
pub fn ist_gueltiges_karten_theme(s: &str) -> bool {
    matches!(s, "auto" | "light" | "dark")
}

/// Eine Kartenansicht wie ans Frontend geliefert. Enum-tragende `String`-Felder
/// tragen `#[schema(value_type = Option<Enum>)]`, damit die generierte TS die Union
/// kennt; `Option<T>` mit `skip_serializing_if`, damit absent/null unterscheidbar
/// bleibt (Norm ab LFH-265). `layer_sichtbar`/`fachebenen_sichtbar` sind opake JSON.
#[derive(Debug, Serialize, ToSchema)]
pub struct KartenAnsichtAnzeige {
    pub id: i64,
    pub einsatz_id: i64,
    pub name: String,
    pub reihenfolge: i64,
    pub ist_standard: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[schema(value_type = Option<BasemapModus>)]
    pub basemap_modus: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub online_stil: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[schema(value_type = Option<KartenTheme>)]
    pub karten_theme: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub layer_sichtbar: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fachebenen_sichtbar: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub zentrum_lat: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub zentrum_lon: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub zoom: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub erstellt_von: Option<i64>,
    pub erstellt_at: String,
    pub geaendert_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub geaendert_von: Option<i64>,
}
