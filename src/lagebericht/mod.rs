pub mod repo;

use crate::error::AppError;
use crate::vorlagendokument::{self as kern, Abschnittsart, Dokumentart};
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use crate::benachrichtigung::{BenachrichtigungArt, BenachrichtigungBezugTyp};
use crate::vorlagendokument::anlage::AnlagenTabelle;
use crate::vorlagendokument::benachrichtigung::FreigabeHinweis;
use crate::vorlagendokument::verteiler::VerteilerTabelle;
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
    type Kopf = repo::LageberichtKopf;
    const TABELLE: &'static str = "lagebericht";
    const ETB_TYP: &'static str = crate::etb::TYP_LAGE;
    const ETB_VERWEIS: &'static str = "lagebericht_id";
    const VORLAGEN: &'static [VorlageDef] = VORLAGEN;
    const NOMEN: &'static str = "Bericht";
    const NOMEN_PLURAL: &'static str = "Berichte";
    const NOMEN_MIT_ARTIKEL: &'static str = "Der Bericht";
    const IM_NOMEN: &'static str = "im Bericht";
    const ANLAGEN: Option<&'static AnlagenTabelle> = Some(&AnlagenTabelle {
        tabelle: "lagebericht_anlage",
        dokument_spalte: "lagebericht_id",
    });
    const VERTEILER: Option<&'static VerteilerTabelle> = Some(&VerteilerTabelle {
        tabelle: "lagebericht_verteiler",
        dokument_spalte: "lagebericht_id",
    });
    /// „Neuer Lagebericht“ an die Funktionen im Verteiler (LLH-1213); Modul Lageberichte.
    const BENACHRICHTIGUNG: Option<FreigabeHinweis> = Some(FreigabeHinweis {
        art: BenachrichtigungArt::Lagebericht,
        bezug_typ: BenachrichtigungBezugTyp::Lagebericht,
    });
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
    /// Stand der Übernahme (LLH-1357, Spec `lagevortrag-uebernahme`): wann der Text zuletzt aus
    /// einer Quelle übernommen wurde, UTC ohne Zonenkennung. Setzt der Client mit der Übernahme;
    /// das Fortschreiben trägt ihn mit dem Text in die neue Fassung. Fehlt bei Text von Hand,
    /// an einem leeren Abschnitt und in Abschnitten von vor LLH-1357 (das Feld steht im JSON von
    /// `lagebericht.abschnitte`, keine Spalte).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub uebernommen_at: Option<String>,
}

impl Abschnittsart for Abschnitt {
    fn neu(schluessel: String, text: String) -> Self {
        Self {
            schluessel,
            text,
            uebernommen_at: None,
        }
    }
    fn schluessel(&self) -> &str {
        &self.schluessel
    }
    fn text(&self) -> &str {
        &self.text
    }
    /// Stand ins Wire-Format (unlesbar → 400); ein leerer Abschnitt trägt keinen.
    fn normalisiere(&mut self) -> Result<(), AppError> {
        self.uebernommen_at = match self.uebernommen_at.take() {
            Some(_) if self.text.trim().is_empty() => None,
            Some(z) => Some(crate::etb::normalisiere_zeit(&z)?),
            None => None,
        };
        Ok(())
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
        let abschnitte = vec![Abschnitt::neu("text".into(), "Hochwasser steigt.".into())];
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
        let leer_text = vec![Abschnitt::neu("text".into(), "  ".into())];
        assert!(kern::validiere_freigabe::<Lagebericht>(v, &leer_text).is_err());
        let ok = vec![Abschnitt::neu("text".into(), "Inhalt".into())];
        assert!(kern::validiere_freigabe::<Lagebericht>(v, &ok).is_ok());
    }

    fn mit_stand(text: &str, stand: &str) -> Abschnitt {
        Abschnitt {
            uebernommen_at: Some(stand.into()),
            ..Abschnitt::neu("eigene_lage".into(), text.into())
        }
    }

    #[test]
    fn stand_der_uebernahme_wird_utc_ohne_zone() {
        let mut a = mit_stand("Stand: 211030okt26", "2026-10-21T12:30:00+02:00");
        a.normalisiere().unwrap();
        assert_eq!(a.uebernommen_at.as_deref(), Some("2026-10-21 10:30:00"));
    }

    #[test]
    fn leerer_abschnitt_traegt_keinen_stand_der_uebernahme() {
        let mut a = mit_stand(" \n ", "2026-10-21 10:30:00");
        a.normalisiere().unwrap();
        assert_eq!(a.uebernommen_at, None);
    }

    #[test]
    fn unlesbarer_stand_der_uebernahme_ist_ein_validierungsfehler() {
        let mut a = mit_stand("x", "gestern");
        assert!(matches!(a.normalisiere(), Err(AppError::Validation(_))));
    }

    #[test]
    fn abschnitt_ohne_stand_bleibt_im_json_wie_vor_llh_1357() {
        let a = Abschnitt::neu("text".into(), "x".into());
        assert_eq!(
            serde_json::to_string(&a).unwrap(),
            r#"{"schluessel":"text","text":"x"}"#
        );
        let alt: Abschnitt = serde_json::from_str(r#"{"schluessel":"text","text":"x"}"#).unwrap();
        assert_eq!(alt, a);
    }

    #[test]
    fn startinhalt_traegt_den_stand_der_uebernahme_ins_skelett() {
        let v = vorlage("lagebericht").unwrap();
        let start = vec![mit_stand("Stand: 211030okt26", "2026-10-21 10:30:00")];
        let skelett = kern::gefuellte_abschnitte::<Abschnitt>(v, &start);
        assert_eq!(skelett.len(), 8);
        let eigene = skelett
            .iter()
            .find(|a| a.schluessel == "eigene_lage")
            .unwrap();
        assert_eq!(eigene, &start[0]);
        assert!(skelett
            .iter()
            .filter(|a| a.schluessel != "eigene_lage")
            .all(|a| a.uebernommen_at.is_none() && a.text.is_empty()));
    }
}
