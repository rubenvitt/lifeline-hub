pub mod repo;

use crate::error::AppError;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

/// Status-Konstanten.
pub const STATUS_ENTWURF: &str = "entwurf";
pub const STATUS_FREIGEGEBEN: &str = "freigegeben";

/// Lagebericht-Vorlage (Schema-Anker für die OpenAPI-Union, LFH-120; TS: `LageberichtVorlageKey`).
/// Wire == `vorlage`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum LageberichtVorlage {
    Lagebericht,
    Lagebeurteilung,
    Freitext,
}

/// Lagebericht-Status (Schema-Anker für die OpenAPI-Union, LFH-120). Wire == `status`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum LageberichtStatus {
    Entwurf,
    Freigegeben,
}

/// Ein Abschnitt der Vorlagen-Definition (fest im Code).
pub struct AbschnittDef {
    pub schluessel: &'static str,
    pub label: &'static str,
}

/// Eine Berichtsvorlage: Schlüssel, Anzeigelabel und geordnete Abschnitte.
pub struct VorlageDef {
    pub schluessel: &'static str,
    pub label: &'static str,
    pub abschnitte: &'static [AbschnittDef],
}

/// Vorlagen-Registry (Spec „Berichtsvorlagen"). MUSS synchron zu
/// frontend/src/lageberichte/vorlagen.ts gehalten werden (Schlüssel + Reihenfolge).
pub const VORLAGEN: &[VorlageDef] = &[
    VorlageDef {
        schluessel: "lagebericht",
        label: "Lagevortrag zur Information",
        abschnitte: &[
            AbschnittDef { schluessel: "auftrag", label: "Auftrag" },
            AbschnittDef { schluessel: "gefahren_schadenlage", label: "Gefahren-/Schadenlage" },
            AbschnittDef { schluessel: "eigene_lage", label: "Eigene Lage" },
            AbschnittDef { schluessel: "lageentwicklung", label: "Lageentwicklung" },
            AbschnittDef { schluessel: "fuehrungsprobleme", label: "Besondere (Führungs-)Probleme" },
            AbschnittDef { schluessel: "antraege_vorschlaege", label: "Anträge und Vorschläge" },
            AbschnittDef { schluessel: "zusammenfassung", label: "Zusammenfassung" },
        ],
    },
    VorlageDef {
        schluessel: "lagebeurteilung",
        label: "Lagevortrag zur Entscheidung",
        abschnitte: &[
            AbschnittDef { schluessel: "auftrag", label: "Auftrag" },
            AbschnittDef { schluessel: "anlass", label: "Anlass des Lagevortrags" },
            AbschnittDef { schluessel: "beurteilung_schadenlage", label: "Beurteilung der Schadenlage" },
            AbschnittDef { schluessel: "beurteilung_eigene_lage", label: "Beurteilung der eigenen Lage" },
            AbschnittDef { schluessel: "gemeinsame_elemente", label: "Gemeinsame Elemente aller Möglichkeiten" },
            AbschnittDef { schluessel: "entschlussvorschlaege", label: "Entschlussvorschläge" },
            AbschnittDef { schluessel: "abwaegen", label: "Abwägen der Möglichkeiten" },
            AbschnittDef { schluessel: "vorschlag_beste", label: "Vorschlag der besten Möglichkeit" },
        ],
    },
    VorlageDef {
        schluessel: "freitext",
        label: "Freier Bericht",
        abschnitte: &[AbschnittDef { schluessel: "text", label: "Bericht" }],
    },
];

/// Liefert die Vorlagendefinition zu einem Schlüssel, `None` bei Unbekanntem.
pub fn vorlage(schluessel: &str) -> Option<&'static VorlageDef> {
    VORLAGEN.iter().find(|v| v.schluessel == schluessel)
}

/// Ein gefüllter Abschnitt (so persistiert als JSON-Array-Element).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct Abschnitt {
    pub schluessel: String,
    pub text: String,
}

/// Leeres Abschnitts-Skelett gemäß Vorlage (Reihenfolge der Vorlage).
pub fn leere_abschnitte(v: &VorlageDef) -> Vec<Abschnitt> {
    v.abschnitte
        .iter()
        .map(|a| Abschnitt { schluessel: a.schluessel.to_string(), text: String::new() })
        .collect()
}

/// Deterministisches Markdown-Rendering des Berichts (Snapshot-Inhalt für das ETB).
/// Reihenfolge = Vorlage; fehlende Abschnitte werden als leer gerendert.
pub fn render_snapshot(v: &VorlageDef, titel: &str, zeitstand: &str, abschnitte: &[Abschnitt]) -> String {
    let mut out = String::new();
    out.push_str(&format!("# {titel}\n\n"));
    out.push_str(&format!("_Zeitstand: {zeitstand}_\n"));
    for def in v.abschnitte {
        let text = abschnitte
            .iter()
            .find(|a| a.schluessel == def.schluessel)
            .map(|a| a.text.trim())
            .unwrap_or("");
        out.push_str(&format!("\n## {}\n", def.label));
        if text.is_empty() {
            out.push_str("_(keine Angabe)_\n");
        } else {
            out.push_str(text);
            out.push('\n');
        }
    }
    out
}

/// Freigabe-Validierung (Spec „Offene Punkte"): Pflicht ist die Abschnitts-*Struktur*
/// (alle Vorlagen-Schlüssel vorhanden), nicht jedes einzelne Feld. Zusätzlich darf der
/// *gesamte* Bericht nicht leer sein.
pub fn validiere_freigabe(v: &VorlageDef, abschnitte: &[Abschnitt]) -> Result<(), AppError> {
    for def in v.abschnitte {
        if !abschnitte.iter().any(|a| a.schluessel == def.schluessel) {
            return Err(AppError::UnprocessableEntity(format!(
                "Abschnitt «{}» fehlt im Bericht",
                def.label
            )));
        }
    }
    if abschnitte.iter().all(|a| a.text.trim().is_empty()) {
        return Err(AppError::UnprocessableEntity(
            "Der Bericht ist leer und kann nicht freigegeben werden".into(),
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn vorlagen_haben_erwartete_abschnittszahl() {
        assert_eq!(vorlage("lagebericht").unwrap().abschnitte.len(), 7);
        assert_eq!(vorlage("lagebeurteilung").unwrap().abschnitte.len(), 8);
        assert_eq!(vorlage("freitext").unwrap().abschnitte.len(), 1);
        assert!(vorlage("unsinn").is_none());
    }

    #[test]
    fn abschnitts_schluessel_sind_eindeutig_pro_vorlage() {
        for v in VORLAGEN {
            let mut keys: Vec<&str> = v.abschnitte.iter().map(|a| a.schluessel).collect();
            keys.sort_unstable();
            let vorher = keys.len();
            keys.dedup();
            assert_eq!(keys.len(), vorher, "Doppelter Abschnitts-Schlüssel in {}", v.schluessel);
        }
    }

    #[test]
    fn leere_abschnitte_folgt_vorlagen_reihenfolge() {
        let v = vorlage("freitext").unwrap();
        let leer = leere_abschnitte(v);
        assert_eq!(leer.len(), 1);
        assert_eq!(leer[0].schluessel, "text");
        assert_eq!(leer[0].text, "");
    }

    #[test]
    fn render_ist_deterministisch_und_in_reihenfolge() {
        let v = vorlage("freitext").unwrap();
        let abschnitte = vec![Abschnitt { schluessel: "text".into(), text: "Hochwasser steigt.".into() }];
        let a = render_snapshot(v, "Lage 10:00", "2026-06-02 10:00:00", &abschnitte);
        let b = render_snapshot(v, "Lage 10:00", "2026-06-02 10:00:00", &abschnitte);
        assert_eq!(a, b);
        assert!(a.contains("# Lage 10:00"));
        assert!(a.contains("Zeitstand"));
        assert!(a.contains("2026-06-02 10:00:00"));
        assert!(a.contains("Hochwasser steigt."));
    }

    #[test]
    fn validierung_verlangt_alle_abschnitts_schluessel() {
        let v = vorlage("freitext").unwrap();
        let leer: Vec<Abschnitt> = vec![];
        assert!(validiere_freigabe(v, &leer).is_err());
        let leer_text = vec![Abschnitt { schluessel: "text".into(), text: "  ".into() }];
        assert!(validiere_freigabe(v, &leer_text).is_err());
        let ok = vec![Abschnitt { schluessel: "text".into(), text: "Inhalt".into() }];
        assert!(validiere_freigabe(v, &ok).is_ok());
    }
}
