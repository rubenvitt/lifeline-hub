//! Benutzer-Präferenzen (LFH-391 · Etappe D) — ein Schlüssel/Wert-Fach je Benutzer.
//!
//! Erster Konsument ist das Gedächtnis der Kommandopalette: sie merkt sich die zuletzt
//! ausgeführten Befehls-**IDs** (keine Beschriftungen, keine Ziele — aufgelöst wird gegen
//! die gerade gebaute Befehlsliste). Der Speicher weiß davon nichts; für ihn ist der Wert
//! ein opaker Text.
//!
//! **Warum ein offener Schlüsselraum, aber eine geschlossene Whitelist.** Eine Spalte je
//! Präferenz hätte die nächste Präferenz wieder zu einer Migration gemacht — der
//! Schlüsselraum ist deshalb Daten, keine Struktur. Frei *schreibbar* ist er trotzdem
//! nicht: ohne Whitelist wäre das Fach ein unbegrenzter, vom Client bestimmter
//! Schreibspeicher (jeder Aufrufer könnte beliebig viele Zeilen je Benutzer anlegen), und
//! ein Tippfehler (`zuletzt_befehl`) schriebe still in einen Schlüssel, den niemand liest.
//! Mit der Whitelist ist die Zeilenzahl je Benutzer durch ihre Länge gedeckelt — eine
//! zusätzliche Mengenbegrenzung wäre doppelt gemoppelt. Eine neue Präferenz kostet
//! [`BEKANNTE_SCHLUESSEL`] eine Zeile und keine Migration.
//!
//! Bewusst NICHT gebaut: ein Löschweg (`DELETE`) und ein Typsystem über den Werten. Wer
//! seine Liste leeren will, schreibt `[]`; ein leerer Wert ist abgelehnter Unfug, kein
//! Löschbefehl (LFH-267: vorhandenes, aber leeres Pflichtfeld → 400).

pub mod repo;

use serde::Serialize;
use std::collections::BTreeMap;
use utoipa::ToSchema;

/// Zuletzt ausgeführte Befehls-IDs der Kommandopalette; Wert ist ein JSON-Array als Text.
pub const SCHLUESSEL_ZULETZT_BEFEHLE: &str = "zuletzt_befehle";

/// Der gesamte gültige Schlüsselraum. Eine neue Präferenz wird hier eingetragen —
/// die Tabelle bleibt unangetastet.
pub const BEKANNTE_SCHLUESSEL: &[&str] = &[SCHLUESSEL_ZULETZT_BEFEHLE];

/// Obergrenze für einen Wert, in **Zeichen** (nicht Bytes — sonst hinge die Grenze an der
/// Kodierung und ein Umlaut zählte doppelt).
///
/// Hergeleitet vom einzigen Konsumenten: die Palette merkt sich eine Handvoll IDs der Form
/// `datensatz:person:12345`; selbst 40 solcher Einträge samt JSON-Rahmen bleiben deutlich
/// darunter. Die Zahl ist eine Schranke gegen Missbrauch, kein Feldbudget.
pub const WERT_MAX_LAENGE: usize = 2000;

/// Ist der Schlüssel Teil des gültigen Raums?
pub fn ist_gueltiger_schluessel(schluessel: &str) -> bool {
    BEKANNTE_SCHLUESSEL.contains(&schluessel)
}

/// Alle Präferenzen eines Benutzers. `eintraege` ist sparse — nur gesetzte Schlüssel
/// stehen darin, eine leere Map heißt „nichts gespeichert".
//
// Die Doc-Kommentare dieses Typs landen über utoipa in `openapi.json` und von dort in
// `types.generated.ts`; die Begründungen bleiben deshalb bewusst als `//`-Kommentare hier
// und wandern nicht in den Frontend-Vertrag.
//
// `BTreeMap` statt `HashMap`: die Schlüsselreihenfolge auf dem Draht ist damit stabil —
// eine wechselnde erzeugte sonst Cache-Rauschen und unlesbare Test-Diffs.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, ToSchema)]
pub struct BenutzerEinstellungenAnzeige {
    /// Schlüssel → opaker Wert.
    pub eintraege: BTreeMap<String, String>,
    /// Zeitpunkt der jüngsten Änderung; fehlt, solange nichts gespeichert ist.
    //
    // `skip_serializing_if` ist hier keine Kosmetik (Norm aus CLAUDE.md/LFH-265): der Key
    // FEHLT bei `None`, statt als `null` zu erscheinen — nur so kann der Client „noch nie
    // geschrieben" von „geschrieben, Wert unbekannt" trennen.
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

    /// Die tragende Hälfte der Norm: `None` verschwindet, `Some` erscheint. Ein Test nur
    /// auf `Some` bliebe grün, wenn `skip_serializing_if` fehlte.
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
