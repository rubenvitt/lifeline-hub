pub mod repo;

use crate::error::AppError;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

/// Status-Konstanten.
pub const STATUS_ENTWURF: &str = "entwurf";
pub const STATUS_FREIGEGEBEN: &str = "freigegeben";

/// Befehls-Vorlage (Schema-Anker für die OpenAPI-Union, LFH-120; TS: `BefehlVorlageKey`).
/// Wire == `vorlage`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum BefehlVorlage {
    BefehlLad,
    BefehlLadef,
    BefehlSchnee,
    BefehlEaZmw,
}

/// Befehls-Status (Schema-Anker für die OpenAPI-Union, LFH-120). Wire == `status`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum BefehlStatus {
    Entwurf,
    Freigegeben,
}

/// Ein Abschnitt der Vorlagen-Definition (fest im Code).
pub struct AbschnittDef {
    pub schluessel: &'static str,
    pub label: &'static str,
}

/// Eine Befehlsvorlage: Schlüssel, Anzeigelabel und geordnete Abschnitte.
pub struct VorlageDef {
    pub schluessel: &'static str,
    pub label: &'static str,
    pub abschnitte: &'static [AbschnittDef],
}

/// Vorlagen-Registry (Spec „Befehlsschemata"). MUSS synchron zu
/// frontend/src/befehle/vorlagen.ts gehalten werden (Schlüssel + Reihenfolge).
pub const VORLAGEN: &[VorlageDef] = &[
    VorlageDef {
        schluessel: "befehl_lad",
        label: "Befehl LAD (vereinfacht)",
        abschnitte: &[
            AbschnittDef { schluessel: "lage", label: "Lage" },
            AbschnittDef { schluessel: "auftrag", label: "Auftrag" },
            AbschnittDef { schluessel: "durchfuehrung", label: "Durchführung" },
        ],
    },
    VorlageDef {
        schluessel: "befehl_ladef",
        label: "Befehl LADEF (erweitert, SKK)",
        abschnitte: &[
            AbschnittDef { schluessel: "lage", label: "Lage" },
            AbschnittDef { schluessel: "auftrag", label: "Auftrag" },
            AbschnittDef { schluessel: "durchfuehrung", label: "Durchführung" },
            AbschnittDef { schluessel: "einsatzunterstuetzung", label: "Einsatzunterstützung" },
            AbschnittDef { schluessel: "fuehrung_kommunikation", label: "Führung und Kommunikation" },
        ],
    },
    VorlageDef {
        schluessel: "befehl_schnee",
        label: "Befehl SCHNEE",
        abschnitte: &[
            AbschnittDef { schluessel: "schadenlage", label: "Schadenlage" },
            AbschnittDef { schluessel: "nachbarn", label: "Nachbarn" },
            AbschnittDef { schluessel: "entschluss", label: "Entschluss / Absicht" },
            AbschnittDef { schluessel: "einzelauftrag", label: "Einzelauftrag" },
            AbschnittDef { schluessel: "eigener_standort", label: "Eigener Standort" },
        ],
    },
    VorlageDef {
        schluessel: "befehl_ea_zmw",
        label: "Einzelauftrag (EA/ZMW)",
        abschnitte: &[
            AbschnittDef { schluessel: "einheit", label: "Einheit" },
            AbschnittDef { schluessel: "auftrag_ziel", label: "Auftrag / Ziel" },
            AbschnittDef { schluessel: "mittel", label: "Mittel" },
            AbschnittDef { schluessel: "weg", label: "Weg" },
        ],
    },
];

/// Liefert die Vorlagendefinition zu einem Schlüssel, `None` bei Unbekanntem.
pub fn vorlage(schluessel: &str) -> Option<&'static VorlageDef> {
    VORLAGEN.iter().find(|v| v.schluessel == schluessel)
}

/// Ein gefüllter Abschnitt (so persistiert als JSON-Array-Element).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
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

/// Deterministisches Markdown-Rendering des Befehls (Snapshot-Inhalt für das ETB).
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
/// *gesamte* Befehl nicht leer sein.
pub fn validiere_freigabe(v: &VorlageDef, abschnitte: &[Abschnitt]) -> Result<(), AppError> {
    for def in v.abschnitte {
        if !abschnitte.iter().any(|a| a.schluessel == def.schluessel) {
            return Err(AppError::UnprocessableEntity(format!(
                "Abschnitt «{}» fehlt im Befehl",
                def.label
            )));
        }
    }
    if abschnitte.iter().all(|a| a.text.trim().is_empty()) {
        return Err(AppError::UnprocessableEntity(
            "Der Befehl ist leer und kann nicht freigegeben werden".into(),
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn vorlagen_haben_erwartete_abschnittszahl() {
        assert_eq!(vorlage("befehl_lad").unwrap().abschnitte.len(), 3);
        assert_eq!(vorlage("befehl_ladef").unwrap().abschnitte.len(), 5);
        assert_eq!(vorlage("befehl_schnee").unwrap().abschnitte.len(), 5);
        assert_eq!(vorlage("befehl_ea_zmw").unwrap().abschnitte.len(), 4);
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
        let v = vorlage("befehl_lad").unwrap();
        let leer = leere_abschnitte(v);
        assert_eq!(leer.len(), 3);
        assert_eq!(leer[0].schluessel, "lage");
        assert_eq!(leer[2].schluessel, "durchfuehrung");
        assert!(leer.iter().all(|a| a.text.is_empty()));
    }

    #[test]
    fn render_ist_deterministisch_und_in_reihenfolge() {
        let v = vorlage("befehl_lad").unwrap();
        let abschnitte = vec![Abschnitt { schluessel: "lage".into(), text: "Hochwasser.".into() }];
        let a = render_snapshot(v, "Befehl 1", "2026-06-02 10:00:00", &abschnitte);
        let b = render_snapshot(v, "Befehl 1", "2026-06-02 10:00:00", &abschnitte);
        assert_eq!(a, b);
        assert!(a.contains("# Befehl 1"));
        assert!(a.contains("## Lage"));
        assert!(a.contains("Hochwasser."));
        // Reihenfolge: Lage vor Auftrag vor Durchführung.
        assert!(a.find("## Lage").unwrap() < a.find("## Auftrag").unwrap());
    }

    #[test]
    fn validierung_verlangt_alle_abschnitts_schluessel() {
        let v = vorlage("befehl_lad").unwrap();
        assert!(validiere_freigabe(v, &[]).is_err());
        let teil = vec![Abschnitt { schluessel: "lage".into(), text: "X".into() }];
        assert!(validiere_freigabe(v, &teil).is_err(), "fehlende Abschnitte → Fehler");
        let voll = v.abschnitte.iter()
            .map(|d| Abschnitt { schluessel: d.schluessel.into(), text: "x".into() })
            .collect::<Vec<_>>();
        assert!(validiere_freigabe(v, &voll).is_ok());
    }
}
