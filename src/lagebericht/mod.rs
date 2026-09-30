pub mod repo;

use crate::vorlagendokument::{self as kern, Abschnittsart, Dokumentart};
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

pub use crate::vorlagendokument::{render_snapshot, AbschnittDef, VorlageDef};

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

/// Vorlagen-Registry (Spec „Berichtsvorlagen"). MUSS synchron zu
/// frontend/src/lageberichte/vorlagen.ts gehalten werden (Schlüssel + Reihenfolge).
pub const VORLAGEN: &[VorlageDef] = &[
    VorlageDef {
        schluessel: "lagebericht",
        label: "Lagevortrag zur Information",
        abschnitte: &[
            AbschnittDef {
                schluessel: "auftrag",
                label: "Auftrag",
            },
            AbschnittDef {
                schluessel: "gefahren_schadenlage",
                label: "Gefahren-/Schadenlage",
            },
            AbschnittDef {
                schluessel: "eigene_lage",
                label: "Eigene Lage",
            },
            AbschnittDef {
                schluessel: "lageentwicklung",
                label: "Lageentwicklung",
            },
            AbschnittDef {
                schluessel: "fuehrungsprobleme",
                label: "Besondere (Führungs-)Probleme",
            },
            AbschnittDef {
                schluessel: "antraege_vorschlaege",
                label: "Anträge und Vorschläge",
            },
            // LFH-554: Punkt III des Lagevortrags (DRK RLP), vor der Zusammenfassung. Ein
            // älterer Entwurf ohne den Schlüssel bleibt gültig (Teilbestand), leer fehlt der
            // Abschnitt im Snapshot. „Aus S5 übernehmen“ setzt die Medienlage im Client ein.
            AbschnittDef {
                schluessel: "medienlage",
                label: "Medienlage",
            },
            AbschnittDef {
                schluessel: "zusammenfassung",
                label: "Zusammenfassung",
            },
        ],
    },
    VorlageDef {
        schluessel: "lagebeurteilung",
        label: "Lagevortrag zur Entscheidung",
        abschnitte: &[
            AbschnittDef {
                schluessel: "auftrag",
                label: "Auftrag",
            },
            AbschnittDef {
                schluessel: "anlass",
                label: "Anlass des Lagevortrags",
            },
            AbschnittDef {
                schluessel: "beurteilung_schadenlage",
                label: "Beurteilung der Schadenlage",
            },
            AbschnittDef {
                schluessel: "beurteilung_eigene_lage",
                label: "Beurteilung der eigenen Lage",
            },
            AbschnittDef {
                schluessel: "gemeinsame_elemente",
                label: "Gemeinsame Elemente aller Möglichkeiten",
            },
            AbschnittDef {
                schluessel: "entschlussvorschlaege",
                label: "Entschlussvorschläge",
            },
            AbschnittDef {
                schluessel: "abwaegen",
                label: "Abwägen der Möglichkeiten",
            },
            AbschnittDef {
                schluessel: "vorschlag_beste",
                label: "Vorschlag der besten Möglichkeit",
            },
        ],
    },
    VorlageDef {
        schluessel: "freitext",
        label: "Freier Bericht",
        abschnitte: &[AbschnittDef {
            schluessel: "text",
            label: "Bericht",
        }],
    },
];

/// Marker der Dokumentart Lagebericht (gemeinsamer Kern: [`crate::vorlagendokument`]).
pub struct Lagebericht;

impl Dokumentart for Lagebericht {
    type Abschnitt = Abschnitt;
    type Anzeige = repo::LageberichtAnzeige;
    const TABELLE: &'static str = "lagebericht";
    const ETB_TYP: &'static str = crate::etb::TYP_LAGE;
    const ETB_VERWEIS: &'static str = "lagebericht_id";
    const VORLAGEN: &'static [VorlageDef] = VORLAGEN;
    const NOMEN: &'static str = "Bericht";
    const NOMEN_PLURAL: &'static str = "Berichte";
    const NOMEN_MIT_ARTIKEL: &'static str = "Der Bericht";
    const IM_NOMEN: &'static str = "im Bericht";
}

/// Liefert die Vorlagendefinition zu einem Schlüssel, `None` bei Unbekanntem.
pub fn vorlage(schluessel: &str) -> Option<&'static VorlageDef> {
    kern::vorlage::<Lagebericht>(schluessel)
}

/// Ein gefüllter Abschnitt (so persistiert als JSON-Array-Element).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[schema(as = LageberichtAbschnitt)]
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
        assert_eq!(vorlage("lagebericht").unwrap().abschnitte.len(), 8);
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
        let v = vorlage("freitext").unwrap();
        let leer = kern::leere_abschnitte::<Abschnitt>(v);
        assert_eq!(leer.len(), 1);
        assert_eq!(leer[0].schluessel, "text");
        assert_eq!(leer[0].text, "");
    }

    #[test]
    fn render_ist_deterministisch_und_in_reihenfolge() {
        let v = vorlage("freitext").unwrap();
        let abschnitte = vec![Abschnitt {
            schluessel: "text".into(),
            text: "Hochwasser steigt.".into(),
        }];
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
        assert!(kern::validiere_freigabe::<Lagebericht>(v, &leer).is_err());
        let leer_text = vec![Abschnitt {
            schluessel: "text".into(),
            text: "  ".into(),
        }];
        assert!(kern::validiere_freigabe::<Lagebericht>(v, &leer_text).is_err());
        let ok = vec![Abschnitt {
            schluessel: "text".into(),
            text: "Inhalt".into(),
        }];
        assert!(kern::validiere_freigabe::<Lagebericht>(v, &ok).is_ok());
    }
}
