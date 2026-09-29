//! Benutzer-Präferenzen (LFH-391) — ein Schlüssel/Wert-Fach je Benutzer.
//!
//! Erster Konsument ist das Gedächtnis der Kommandopalette: die zuletzt ausgeführten
//! Befehls-**IDs**, aufgelöst gegen die gerade gebaute Befehlsliste. Für den Speicher ist der
//! Wert opaker Text.
//!
//! **Offener Schlüsselraum, geschlossene Whitelist:** Schlüssel sind Daten, damit eine neue
//! Präferenz keine Migration braucht. Ohne Whitelist wäre das Fach aber ein unbegrenzter,
//! clientbestimmter Speicher, und ein Tippfehler schriebe still in einen Schlüssel, den niemand
//! liest. Die Whitelist deckelt zugleich die Zeilenzahl je Benutzer. Eine neue Präferenz kostet
//! eine Zeile in [`BEKANNTE_SCHLUESSEL`].
//!
//! Bewusst ohne Löschweg und ohne Typsystem über den Werten: wer die Liste leeren will,
//! schreibt `[]`; ein leerer Wert ist 400.

pub mod repo;

use serde::Serialize;
use std::collections::BTreeMap;
use utoipa::ToSchema;

/// Zuletzt ausgeführte Befehls-IDs der Kommandopalette; Wert ist ein JSON-Array als Text.
pub const SCHLUESSEL_ZULETZT_BEFEHLE: &str = "zuletzt_befehle";

/// Der gesamte gültige Schlüsselraum. Eine neue Präferenz wird hier eingetragen —
/// die Tabelle bleibt unangetastet.
pub const BEKANNTE_SCHLUESSEL: &[&str] = &[SCHLUESSEL_ZULETZT_BEFEHLE];

/// Obergrenze für einen Wert in **Zeichen** (nicht Bytes, sonst hinge sie an der Kodierung).
/// Eine Schranke gegen Missbrauch mit viel Luft: auch 40 Palette-IDs samt JSON-Rahmen bleiben
/// deutlich darunter.
pub const WERT_MAX_LAENGE: usize = 2000;

/// Ist der Schlüssel Teil des gültigen Raums?
pub fn ist_gueltiger_schluessel(schluessel: &str) -> bool {
    BEKANNTE_SCHLUESSEL.contains(&schluessel)
}

/// Alle Präferenzen eines Benutzers. `eintraege` ist sparse — nur gesetzte Schlüssel
/// stehen darin, eine leere Map heißt „nichts gespeichert".
//
// Die Doc-Kommentare dieses Typs landen über utoipa in `openapi.json`; Begründungen stehen
// deshalb als `//`-Kommentare.
//
// `BTreeMap` statt `HashMap`: stabile Schlüsselreihenfolge auf dem Draht, ohne Cache-Rauschen
// und wechselnde Test-Diffs.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, ToSchema)]
pub struct BenutzerEinstellungenAnzeige {
    /// Schlüssel → opaker Wert.
    pub eintraege: BTreeMap<String, String>,
    /// Zeitpunkt der jüngsten Änderung; fehlt, solange nichts gespeichert ist.
    //
    // Der Key FEHLT bei `None` statt `null` zu sein — nur so trennt der Client „noch nie
    // geschrieben“ von „geschrieben, Wert unbekannt“.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub geaendert_at: Option<String>,
}

impl BenutzerEinstellungenAnzeige {
    /// Der Zustand vor dem ersten Schreiben: leere Map, kein Zeitstempel.
    pub fn leer() -> Self {
        Self {
            eintraege: BTreeMap::new(),
            geaendert_at: None,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn whitelist_kennt_zuletzt_befehle_und_sonst_nichts_erfundenes() {
        assert!(ist_gueltiger_schluessel(SCHLUESSEL_ZULETZT_BEFEHLE));
        assert!(!ist_gueltiger_schluessel("theme"));
        assert!(!ist_gueltiger_schluessel(""));
        // Kein Präfix-Match: ein Schlüssel gilt ganz oder gar nicht.
        assert!(!ist_gueltiger_schluessel("zuletzt_befehle_v2"));
    }

    /// `None` verschwindet, `Some` erscheint. Ein Test nur auf `Some` bliebe grün, wenn
    /// `skip_serializing_if` fehlte.
    #[test]
    fn leerer_stand_serialisiert_ohne_geaendert_at() {
        let json = serde_json::to_value(BenutzerEinstellungenAnzeige::leer()).unwrap();
        let obj = json.as_object().unwrap();
        assert!(obj.contains_key("eintraege"));
        assert!(
            !obj.contains_key("geaendert_at"),
            "None muss WEGGELASSEN werden, nicht als null erscheinen — war: {json}"
        );
    }

    #[test]
    fn gesetzter_stand_serialisiert_mit_geaendert_at() {
        let stand = BenutzerEinstellungenAnzeige {
            eintraege: BTreeMap::from([("zuletzt_befehle".to_string(), "[]".to_string())]),
            geaendert_at: Some("2026-08-30 10:00:00".to_string()),
        };
        let json = serde_json::to_value(stand).unwrap();
        assert!(json.as_object().unwrap().contains_key("geaendert_at"));
        assert_eq!(json["eintraege"]["zuletzt_befehle"], "[]");
    }
}
