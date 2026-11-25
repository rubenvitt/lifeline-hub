//! Fremdebenen der Lagekarte (LLH-2099/LLH-2100): fremde Geodaten aus einer Datei oder einer
//! URL als eigene Ebene eines Einsatzes. Entwurf:
//! `docs/superpowers/specs/2026-11-24-qe5jrctd-fremdebenen-design.md`.
//!
//! Metadaten in `karte_fremdebene`, das normierte GeoJSON in `karte_fremdebene_daten`
//! (Migration 0373, Teilung wie `karte_hintergrundbild_daten`, LFH-936): die Liste liest nie den
//! Inhalt. Eingelesen wird in [`einlesen`]; gespeichert wird nur das Ergebnis, nie die Datei.

pub mod abruf;
pub mod einlesen;
pub mod repo;

use serde::Serialize;
use utoipa::ToSchema;

/// Höchstlänge des Namens einer Ebene (Zeichen, nach dem Trimmen). Spiegel:
/// `frontend/src/api/eingabegrenzen.ts`.
pub const NAME_MAX: usize = 120;
/// Höchstgröße einer hochgeladenen Datei in Bytes (10 MiB).
pub const DATEI_MAX: usize = 10 * 1024 * 1024;
/// Höchstgröße der entpackten KML einer KMZ in Bytes (20 MiB), beim Lesen gedeckelt.
pub const KMZ_ENTPACKT_MAX: usize = 20 * 1024 * 1024;
/// Höchstzahl der Objekte einer Datei, auch der verworfenen.
pub const OBJEKTE_MAX: usize = 5_000;
/// Höchstzahl der Stützpunkte einer Datei über alle Objekte.
pub const STUETZPUNKTE_MAX: usize = 200_000;
/// Höchstzahl der Stützpunkte einer Linie oder eines Rings.
pub const STUETZPUNKTE_JE_LINIE_MAX: usize = 5_000;
/// Höchstgröße des normierten GeoJSON in Bytes (8 MiB).
pub const GEOJSON_MAX: usize = 8 * 1024 * 1024;
/// Höchstlänge des Namens eines Objekts (Zeichen); länger wird gekürzt.
pub const OBJEKT_NAME_MAX: usize = 200;
/// Höchstlänge der Beschreibung eines Objekts als Text (Zeichen); länger wird gekürzt.
pub const BESCHREIBUNG_MAX: usize = 1_000;
/// Nachkommastellen der gespeicherten Koordinaten (etwa 0,1 m).
pub const NACHKOMMASTELLEN: i32 = 6;
/// Palettenschlüssel einer Ebene; die Töne stehen im Client. Nie eine taktische Farbe.
pub const FARBEN: [&str; 6] = [
    "fremd-1", "fremd-2", "fremd-3", "fremd-4", "fremd-5", "fremd-6",
];

/// Prüft einen Palettenschlüssel aus einer Anfrage; ein fremder Wert ist 400.
pub fn check_farbe(farbe: &str) -> Result<&'static str, crate::error::AppError> {
    FARBEN
        .iter()
        .find(|f| **f == farbe)
        .copied()
        .ok_or_else(|| {
            crate::error::AppError::Validation(format!(
                "Unbekannte Farbe: {farbe} (erlaubt: {})",
                FARBEN.join(", ")
            ))
        })
}

/// Die Farbe einer neuen Ebene: der erste Schlüssel, den keine Ebene des Einsatzes trägt; sind
/// alle belegt, reihum nach der Zahl der Ebenen.
pub fn naechste_farbe<'a>(belegt: impl IntoIterator<Item = &'a str> + Clone) -> &'static str {
    FARBEN
        .iter()
        .find(|f| !belegt.clone().into_iter().any(|b| b == **f))
        .copied()
        .unwrap_or_else(|| FARBEN[belegt.into_iter().count() % FARBEN.len()])
}

crate::wire_enum::wire_enum! {
    /// Woher eine Fremdebene kommt.
    #[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]
    pub enum FremdebeneQuelle {
        /// Hochgeladene Datei; der Inhalt ändert sich nur durch ein neues Hochladen.
        Datei => "datei",
        /// Öffentliche https-Adresse, beim Lesen bedingt nachgeholt.
        Url => "url",
    }
    sqlx = |s| format!("Ungültige Fremdebenen-Quelle: {s}");
}

crate::wire_enum::wire_enum! {
    /// Warum eine Datei oder ein Abruf abgelehnt ist (`grund` im 400 bzw. 413, an der URL-Ebene
    /// in `karte_fremdebene.fehler`). Nie der Text des Ziels: nur der Code.
    #[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]
    pub enum FremdebeneFehler {
        Unlesbar => "unlesbar",
        Dtd => "dtd",
        ZuGross => "zu_gross",
        ZuVieleObjekte => "zu_viele_objekte",
        Leer => "leer",
        Koordinaten => "koordinaten",
        Virus => "virus",
        NichtErreichbar => "nicht_erreichbar",
        Weiterleitung => "weiterleitung",
        Abgelehnt => "abgelehnt",
        Status => "status",
        ZielIntern => "ziel_intern",
        Zeitlimit => "zeitlimit",
    }
    sqlx = |s| format!("Ungültiger Fremdebenen-Fehler: {s}");
}

impl FremdebeneFehler {
    /// Die Meldung zum Code. Die Einlese-Codes stehen wörtlich im Entwurf (Abschnitt „Fehler“);
    /// der Client führt dieselben Texte (`FREMDEBENE_FEHLERTEXT`).
    pub const fn meldung(&self) -> &'static str {
        match self {
            Self::Unlesbar => "Die Datei ist kein GeoJSON, KML oder KMZ.",
            Self::Dtd => {
                "Die Datei enthält eine DTD und wird aus Sicherheitsgründen nicht gelesen."
            }
            Self::ZuGross => "Die Datei ist zu groß (höchstens 10 MB).",
            Self::ZuVieleObjekte => "Die Datei enthält zu viele Objekte (höchstens 5000).",
            Self::Leer => "Die Datei enthält keine lesbaren Orte.",
            Self::Koordinaten => {
                "Die Koordinaten liegen außerhalb der Erde. Ist die Datei in WGS84?"
            }
            Self::Virus => "Die Datei wurde vom Virenscanner abgelehnt.",
            Self::NichtErreichbar => "Die Adresse ist nicht erreichbar.",
            Self::Weiterleitung => {
                "Die Adresse leitet weiter; Weiterleitungen werden nicht verfolgt."
            }
            Self::Abgelehnt => "Die Adresse wird nicht abgerufen (nur https).",
            Self::Status => "Die Adresse hat mit einem Fehler geantwortet.",
            Self::ZielIntern => "Die Adresse liegt in einem internen Netz.",
            Self::Zeitlimit => "Die Adresse hat nicht rechtzeitig geantwortet.",
        }
    }
}

/// Eine Fremdebene, wie die Liste sie zeigt (ohne Inhalt). Wire-Felder englisch.
#[derive(Debug, Clone, PartialEq, Serialize, ToSchema)]
pub struct FremdebeneAnzeige {
    pub id: i64,
    pub name: String,
    pub source: FremdebeneQuelle,
    /// Volle Adresse der URL-Ebene; nur für Schreibende (Entwurf, „URL mit Geheimnis im Query“),
    /// sonst fehlt sie ([`FremdebeneAnzeige::fuer_leser`]).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    /// Nur der Host der URL-Ebene, für alle Lesenden.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub url_host: Option<String>,
    /// Palettenschlüssel (`fremd-1` … `fremd-6`).
    pub color: String,
    pub feature_count: i64,
    /// Zahl der Objekte ohne lesbare Geometrie.
    pub dropped_count: i64,
    /// Letzter erfolgreicher Abruf (auch 304), nur URL-Ebene.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fetched_at: Option<String>,
    /// Letzter Abrufversuch, nur URL-Ebene.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub attempted_at: Option<String>,
    /// Fehler des letzten Abrufs; der letzte Stand bleibt sichtbar.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<FremdebeneFehler>,
    pub created_at: String,
}

impl FremdebeneAnzeige {
    /// Die Sicht eines Lesenden ohne Schreibrecht: ohne volle Adresse, nur mit dem Host.
    pub fn fuer_leser(mut self) -> Self {
        self.url = None;
        self
    }
}

/// Host einer Adresse für [`FremdebeneAnzeige::url_host`]; `None`, wenn sie sich nicht lesen lässt.
pub fn url_host(url: &str) -> Option<String> {
    reqwest::Url::parse(url)
        .ok()?
        .host_str()
        .map(str::to_string)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn leser_sieht_nur_den_host() {
        assert_eq!(
            url_host("https://geo.example.org/pfad?token=geheim").as_deref(),
            Some("geo.example.org")
        );
        assert_eq!(url_host("[geschwärzt]"), None);
    }

    #[test]
    fn farbe_erster_freier_schluessel_sonst_reihum() {
        assert_eq!(naechste_farbe([]), "fremd-1");
        assert_eq!(naechste_farbe(["fremd-1", "fremd-3"]), "fremd-2");
        let alle = FARBEN.to_vec();
        assert_eq!(naechste_farbe(alle.clone()), "fremd-1");
        let mut sieben = alle;
        sieben.push("fremd-1");
        assert_eq!(naechste_farbe(sieben), "fremd-2");
        assert!(check_farbe("fremd-6").is_ok());
        assert!(check_farbe("rot").is_err());
    }
}
