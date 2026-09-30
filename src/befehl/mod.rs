pub mod repo;

use crate::vorlagendokument::{self as kern, Abschnittsart, Dokumentart};
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

pub use crate::vorlagendokument::{render_snapshot, AbschnittDef, VorlageDef};

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

/// Vorlagen-Registry (Spec „Befehlsschemata"). MUSS synchron zu
/// frontend/src/befehle/vorlagen.ts gehalten werden (Schlüssel + Reihenfolge).
pub const VORLAGEN: &[VorlageDef] = &[
    VorlageDef {
        schluessel: "befehl_lad",
        label: "Befehl LAD (vereinfacht)",
        abschnitte: &[
            AbschnittDef {
                schluessel: "lage",
                label: "Lage",
            },
            AbschnittDef {
                schluessel: "auftrag",
                label: "Auftrag",
            },
            AbschnittDef {
                schluessel: "durchfuehrung",
                label: "Durchführung",
            },
        ],
    },
    VorlageDef {
        schluessel: "befehl_ladef",
        label: "Befehl LADEF (erweitert, SKK)",
        abschnitte: &[
            AbschnittDef {
                schluessel: "lage",
                label: "Lage",
            },
            AbschnittDef {
                schluessel: "auftrag",
                label: "Auftrag",
            },
            AbschnittDef {
                schluessel: "durchfuehrung",
                label: "Durchführung",
            },
            AbschnittDef {
                schluessel: "einsatzunterstuetzung",
                label: "Einsatzunterstützung",
            },
            AbschnittDef {
                schluessel: "fuehrung_kommunikation",
                label: "Führung und Kommunikation",
            },
        ],
    },
    VorlageDef {
        schluessel: "befehl_schnee",
        label: "Befehl SCHNEE",
        abschnitte: &[
            AbschnittDef {
                schluessel: "schadenlage",
                label: "Schadenlage",
            },
            AbschnittDef {
                schluessel: "nachbarn",
                label: "Nachbarn",
            },
            AbschnittDef {
                schluessel: "entschluss",
                label: "Entschluss / Absicht",
            },
            AbschnittDef {
                schluessel: "einzelauftrag",
                label: "Einzelauftrag",
            },
            AbschnittDef {
                schluessel: "eigener_standort",
                label: "Eigener Standort",
            },
        ],
    },
    VorlageDef {
        schluessel: "befehl_ea_zmw",
        label: "Einzelauftrag (EA/ZMW)",
        abschnitte: &[
            AbschnittDef {
                schluessel: "einheit",
                label: "Einheit",
            },
            AbschnittDef {
                schluessel: "auftrag_ziel",
                label: "Auftrag / Ziel",
            },
            AbschnittDef {
                schluessel: "mittel",
                label: "Mittel",
            },
            AbschnittDef {
                schluessel: "weg",
                label: "Weg",
            },
        ],
    },
];

/// Marker der Dokumentart Befehl (gemeinsamer Kern: [`crate::vorlagendokument`]).
pub struct Befehl;

impl Dokumentart for Befehl {
    type Abschnitt = Abschnitt;
    type Anzeige = repo::BefehlAnzeige;
    const TABELLE: &'static str = "befehl";
    const ETB_TYP: &'static str = crate::etb::TYP_ANORDNUNG;
    const ETB_VERWEIS: &'static str = "befehl_id";
    const VORLAGEN: &'static [VorlageDef] = VORLAGEN;
    const NOMEN: &'static str = "Befehl";
    const NOMEN_PLURAL: &'static str = "Befehle";
    const NOMEN_MIT_ARTIKEL: &'static str = "Der Befehl";
    const IM_NOMEN: &'static str = "im Befehl";
}

/// Liefert die Vorlagendefinition zu einem Schlüssel, `None` bei Unbekanntem.
pub fn vorlage(schluessel: &str) -> Option<&'static VorlageDef> {
    kern::vorlage::<Befehl>(schluessel)
}

/// Ein gefüllter Abschnitt (so persistiert als JSON-Array-Element).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[schema(as = BefehlAbschnitt)]
pub struct Abschnitt {
    pub schluessel: String,
    pub text: String,
}

impl Abschnittsart for Abschnitt {
    fn neu(schluessel: String, text: String) -> Self {
        Self { schluessel, text }
    }
    fn schluessel(&self) -> &str {
        &self.schluessel
    }
    fn text(&self) -> &str {
        &self.text
    }
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
            assert_eq!(
                keys.len(),
                vorher,
                "Doppelter Abschnitts-Schlüssel in {}",
                v.schluessel
            );
        }
    }

    #[test]
    fn leere_abschnitte_folgt_vorlagen_reihenfolge() {
        let v = vorlage("befehl_lad").unwrap();
        let leer = kern::leere_abschnitte::<Abschnitt>(v);
        assert_eq!(leer.len(), 3);
        assert_eq!(leer[0].schluessel, "lage");
        assert_eq!(leer[2].schluessel, "durchfuehrung");
        assert!(leer.iter().all(|a| a.text.is_empty()));
    }

    #[test]
    fn render_ist_deterministisch_und_in_reihenfolge() {
        let v = vorlage("befehl_lad").unwrap();
        let abschnitte = vec![Abschnitt {
            schluessel: "lage".into(),
            text: "Hochwasser.".into(),
        }];
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
        assert!(kern::validiere_freigabe::<Befehl>(v, &[]).is_err());
        let teil = vec![Abschnitt {
            schluessel: "lage".into(),
            text: "X".into(),
        }];
        assert!(
            kern::validiere_freigabe::<Befehl>(v, &teil).is_err(),
            "fehlende Abschnitte → Fehler"
        );
        let voll = v
            .abschnitte
            .iter()
            .map(|d| Abschnitt {
                schluessel: d.schluessel.into(),
                text: "x".into(),
            })
            .collect::<Vec<_>>();
        assert!(kern::validiere_freigabe::<Befehl>(v, &voll).is_ok());
    }
}
