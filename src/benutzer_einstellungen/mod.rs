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

use crate::benachrichtigung::{BenachrichtigungArt, BenachrichtigungStufe};
use crate::error::AppError;
use serde::Serialize;
use std::collections::BTreeMap;
use utoipa::ToSchema;

/// Zuletzt ausgeführte Befehls-IDs der Kommandopalette; Wert ist ein JSON-Array als Text.
pub const SCHLUESSEL_ZULETZT_BEFEHLE: &str = "zuletzt_befehle";

/// Standard-Rufname für Von und An im ETB (LFH-894); Wert ist ein JSON-Objekt
/// `{"von": "…", "an": "…"}` als Text, beide Seiten in EINEM Schlüssel, damit ein Schreiben sie
/// gemeinsam ändert. Gelesen und geprüft wird er nur im Client (`etb/standardRufname.ts`).
pub const SCHLUESSEL_ETB_STANDARD_RUFNAME: &str = "etb_standard_rufname";

/// Abgeschaltete Benachrichtigungsarten (LLH-1207, design.md D6); Wert ist ein JSON-Array von
/// Wire-Werten aus `benachrichtigung::BenachrichtigungArt`, etwa `["gefahr"]`. Der Server liest
/// ihn bei jeder Empfängerauflösung (`benachrichtigung::aufloesung`) und prüft ihn beim Schreiben
/// ([`pruefe_wert`]): nur Hinweis-Arten, Alarm-Arten sind nicht abschaltbar.
pub const SCHLUESSEL_BENACHRICHTIGUNGEN_AUS: &str = "benachrichtigungen_aus";

/// Der gesamte gültige Schlüsselraum. Eine neue Präferenz wird hier eingetragen —
/// die Tabelle bleibt unangetastet.
pub const BEKANNTE_SCHLUESSEL: &[&str] = &[
    SCHLUESSEL_ZULETZT_BEFEHLE,
    SCHLUESSEL_ETB_STANDARD_RUFNAME,
    SCHLUESSEL_BENACHRICHTIGUNGEN_AUS,
];

/// Obergrenze für einen Wert in **Zeichen** (nicht Bytes, sonst hinge sie an der Kodierung).
/// Eine Schranke gegen Missbrauch mit viel Luft: auch 40 Palette-IDs samt JSON-Rahmen bleiben
/// deutlich darunter.
pub const WERT_MAX_LAENGE: usize = 2000;

/// Ist der Schlüssel Teil des gültigen Raums?
pub fn ist_gueltiger_schluessel(schluessel: &str) -> bool {
    BEKANNTE_SCHLUESSEL.contains(&schluessel)
}

/// Prüft den Wert eines Schlüssels, den der Server selbst liest, und liefert ihn in der
/// gespeicherten Form; die übrigen Werte bleiben opak. Für [`SCHLUESSEL_BENACHRICHTIGUNGEN_AUS`]:
/// kein JSON-Array von Texten oder eine unbekannte Art → 400 (das Feld für sich), eine Alarm-Art
/// → 422 (sie ist nicht abschaltbar, Spec „Kategorien je Nutzer abschaltbar“). Gespeichert wird
/// die Liste entdoppelt in Katalogreihenfolge.
pub fn pruefe_wert(schluessel: &str, wert: &str) -> Result<String, AppError> {
    if schluessel != SCHLUESSEL_BENACHRICHTIGUNGEN_AUS {
        return Ok(wert.to_string());
    }
    let roh: Vec<String> = serde_json::from_str(wert).map_err(|_| {
        AppError::Validation(format!(
            "{SCHLUESSEL_BENACHRICHTIGUNGEN_AUS} muss eine Liste von Benachrichtigungsarten sein"
        ))
    })?;
    let mut arten = Vec::with_capacity(roh.len());
    for a in &roh {
        let art = BenachrichtigungArt::parse(a).ok_or_else(|| {
            AppError::Validation(format!("Unbekannte Benachrichtigungsart '{a}'"))
        })?;
        arten.push(art);
    }
    if let Some(alarm) = arten
        .iter()
        .find(|a| a.stufe() == BenachrichtigungStufe::Alarm)
    {
        return Err(AppError::UnprocessableEntity(format!(
            "Die Benachrichtigungsart '{}' ist ein Alarm und lässt sich nicht abschalten",
            alarm.as_str()
        )));
    }
    arten.sort();
    arten.dedup();
    let wire: Vec<&str> = arten.iter().map(|a| a.as_str()).collect();
    Ok(serde_json::to_string(&wire).expect("Liste serialisierbar"))
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
        assert!(ist_gueltiger_schluessel(SCHLUESSEL_ETB_STANDARD_RUFNAME));
        assert_eq!(SCHLUESSEL_ETB_STANDARD_RUFNAME, "etb_standard_rufname");
        assert!(!ist_gueltiger_schluessel("theme"));
        assert!(!ist_gueltiger_schluessel(""));
        // Kein Präfix-Match: ein Schlüssel gilt ganz oder gar nicht.
        assert!(!ist_gueltiger_schluessel("zuletzt_befehle_v2"));
    }

    #[test]
    fn benachrichtigungen_aus_nimmt_hinweis_arten_und_normalisiert() {
        assert!(ist_gueltiger_schluessel(SCHLUESSEL_BENACHRICHTIGUNGEN_AUS));
        assert_eq!(
            pruefe_wert(
                SCHLUESSEL_BENACHRICHTIGUNGEN_AUS,
                r#"["gefahr","befehl","gefahr"]"#
            )
            .unwrap(),
            r#"["befehl","gefahr"]"#,
            "entdoppelt, in Katalogreihenfolge"
        );
        assert_eq!(
            pruefe_wert(SCHLUESSEL_BENACHRICHTIGUNGEN_AUS, "[]").unwrap(),
            "[]"
        );
    }

    #[test]
    fn benachrichtigungen_aus_lehnt_alarm_mit_422_und_unbekanntes_mit_400_ab() {
        for alarm in [
            "sofortmeldung",
            "sofortmeldung_eskaliert",
            "auftrag_ueberfaellig",
            "abloesung_faellig",
        ] {
            assert!(
                matches!(
                    pruefe_wert(
                        SCHLUESSEL_BENACHRICHTIGUNGEN_AUS,
                        &format!(r#"["{alarm}"]"#)
                    ),
                    Err(AppError::UnprocessableEntity(_))
                ),
                "{alarm}"
            );
        }
        for kaputt in [r#"["erfunden"]"#, r#""gefahr""#, "[1]", "nein"] {
            assert!(
                matches!(
                    pruefe_wert(SCHLUESSEL_BENACHRICHTIGUNGEN_AUS, kaputt),
                    Err(AppError::Validation(_))
                ),
                "{kaputt}"
            );
        }
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
