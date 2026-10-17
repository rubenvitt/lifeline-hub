//! Sicht eines an eine Verpflegungsstelle gebundenen Geräts (LLH-1048, LLH-1024 F7).
//!
//! Die Bindung ist wahlweise (`geraet::stelle::sicht_wahlweise`): ohne Stelle sieht das Gerät
//! alles wie bisher. Mit Stelle schneidet die Route die eine Lesung des Moduls
//! (`repo::liste`, `repo::zeitfenster_laden`) hier zu, NACHDEM die Deckung gerechnet ist:
//!
//! - **Zeitfenster:** nur die der eigenen Stelle zugeordneten und die einsatzweiten (ohne
//!   Zuordnung). Ein Zeitfenster nur fremder Stellen gibt es für das Gerät nicht (Ausgabe dorthin
//!   404, `repo::check_zeitfenster_an_stelle_tx`).
//! - **Soll und Ist bleiben am Zeitfenster:** `bedarf`, `ausgegeben` und `fehlmenge` sind die
//!   Werte des ganzen Zeitfensters (LLH-1024 F2: das Soll gilt für alle seine Stellen); eine
//!   Fehlmenge je Stelle gibt es nicht.
//! - **Nur die eigene Stelle im Einzelnen:** `ausgaben`, `je_stelle` und `stelle_ids` tragen
//!   nur die eigene Stelle, `stellen` nur sie. Was anderswo an Einheiten ausgegeben wurde, steht
//!   als Summe je Einheit in `verpflegt_anderswo` (ohne Stelle, Zeitpunkt, Freitext).
//! - Die Empfängerliste bleibt einsatzweit: an jede Einheit kann jede Stelle ausgeben.

use std::collections::BTreeMap;

use super::{VerpflegtAnderswo, VerpflegungAnzeige, ZeitfensterAnzeige};

/// Ob das Zeitfenster an der Stelle gilt: ihr zugeordnet oder einsatzweit (ohne Zuordnung).
pub fn gilt_an(z: &ZeitfensterAnzeige, stelle_id: i64) -> bool {
    z.stelle_ids.is_empty() || z.stelle_ids.contains(&stelle_id)
}

/// Schneidet ein Zeitfenster auf die Sicht der Stelle zu (Modulkommentar).
pub fn zeitfenster(mut z: ZeitfensterAnzeige, stelle_id: i64) -> ZeitfensterAnzeige {
    let mut anderswo: BTreeMap<i64, i64> = BTreeMap::new();
    for a in &z.ausgaben {
        if a.zurueckgenommen_at.is_some() || a.verpflegungsstelle_id == Some(stelle_id) {
            continue;
        }
        if let Some(einheit_id) = a.einheit_id {
            *anderswo.entry(einheit_id).or_default() += a.menge;
        }
    }
    z.verpflegt_anderswo = anderswo
        .into_iter()
        .map(|(einheit_id, menge)| VerpflegtAnderswo { einheit_id, menge })
        .collect();
    z.ausgaben
        .retain(|a| a.verpflegungsstelle_id == Some(stelle_id));
    z.je_stelle.retain(|s| s.stelle_id == Some(stelle_id));
    z.stelle_ids.retain(|id| *id == stelle_id);
    z
}

/// Schneidet die ganze Lesung auf die Sicht der Stelle zu (Modulkommentar).
pub fn verpflegung(mut v: VerpflegungAnzeige, stelle_id: i64) -> VerpflegungAnzeige {
    v.zeitfenster = v
        .zeitfenster
        .into_iter()
        .filter(|z| gilt_an(z, stelle_id))
        .map(|z| zeitfenster(z, stelle_id))
        .collect();
    v.stellen.retain(|s| s.id == stelle_id);
    v
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::verpflegung::{
        AusgabeAnzeige, Bedarf, Portionen, Sonderkost, StelleIst, VerpflegungEmpfaenger,
    };

    fn ausgabe(
        id: i64,
        menge: i64,
        stelle: Option<i64>,
        einheit: Option<i64>,
        zurueck: bool,
    ) -> AusgabeAnzeige {
        AusgabeAnzeige {
            id,
            zeitfenster_id: 1,
            zeitpunkt_at: "2026-10-16 12:00:00".into(),
            menge,
            ort: None,
            bemerkung: None,
            sonderkost: Sonderkost::default(),
            nachforderung_id: None,
            verpflegungsstelle_id: stelle,
            einheit_id: einheit,
            abschnitt_id: None,
            zurueckgenommen_at: zurueck.then(|| "2026-10-16 12:05:00".into()),
            erfasst_at: "2026-10-16 12:00:00".into(),
        }
    }

    fn portionen(gesamt: i64) -> Portionen {
        Portionen {
            gesamt,
            sonderkost: Sonderkost::default(),
        }
    }

    fn fenster(id: i64, stelle_ids: Vec<i64>, ausgaben: Vec<AusgabeAnzeige>) -> ZeitfensterAnzeige {
        ZeitfensterAnzeige {
            id,
            einsatz_id: 1,
            bezeichnung: format!("Z{id}"),
            von_at: "2026-10-16 12:00:00".into(),
            bis_at: "2026-10-16 13:00:00".into(),
            verpflegungsart: None,
            bedarf: Bedarf {
                kraefte: 100,
                betreute: 0,
                weitere: 0,
                gesamt: 100,
                sonderkost: Sonderkost::default(),
            },
            ausgegeben: portionen(70),
            fehlmenge: portionen(30),
            je_stelle: vec![
                StelleIst {
                    stelle_id: Some(1),
                    ausgegeben: portionen(40),
                },
                StelleIst {
                    stelle_id: Some(2),
                    ausgegeben: portionen(20),
                },
                StelleIst {
                    stelle_id: None,
                    ausgegeben: portionen(10),
                },
            ],
            stelle_ids,
            verpflegt_anderswo: Vec::new(),
            ausgaben,
            angelegt_at: "2026-10-16 10:00:00".into(),
            geaendert_at: None,
        }
    }

    #[test]
    fn eigene_stelle_im_einzelnen_anderswo_als_summe_je_einheit() {
        let z = fenster(
            1,
            vec![1, 2],
            vec![
                ausgabe(1, 40, Some(1), Some(7), false),
                ausgabe(2, 15, Some(2), Some(7), false),
                ausgabe(3, 5, Some(2), Some(8), false),
                ausgabe(4, 10, None, Some(7), false),
                // zurückgenommen zählt nicht, ohne Empfänger fehlt in der Summe
                ausgabe(5, 99, Some(2), Some(7), true),
                ausgabe(6, 3, Some(2), None, false),
            ],
        );
        let z = zeitfenster(z, 1);
        assert_eq!(
            z.verpflegt_anderswo,
            vec![
                VerpflegtAnderswo {
                    einheit_id: 7,
                    menge: 25
                },
                VerpflegtAnderswo {
                    einheit_id: 8,
                    menge: 5
                },
            ]
        );
        assert_eq!(z.ausgaben.iter().map(|a| a.id).collect::<Vec<_>>(), vec![1]);
        assert_eq!(z.stelle_ids, vec![1]);
        assert_eq!(z.je_stelle.len(), 1);
        assert_eq!(z.je_stelle[0].stelle_id, Some(1));
        // Soll und Ist bleiben am Zeitfenster.
        assert_eq!(z.ausgegeben.gesamt, 70);
        assert_eq!(z.fehlmenge.gesamt, 30);
    }

    #[test]
    fn nur_eigene_und_einsatzweite_zeitfenster_und_nur_die_eigene_stelle() {
        let stelle = |id: i64| crate::verpflegung::stelle::VerpflegungsstelleAnzeige {
            id,
            bezeichnung: format!("S{id}"),
            art: crate::verpflegung::stelle::VerpflegungsstelleArt::Feldkueche,
            standort: None,
            lat: None,
            lon: None,
            abschnitt_id: None,
            status: crate::verpflegung::stelle::VerpflegungsstelleStatus::Aktiv,
            aufgeloest_at: None,
            angelegt_at: "2026-10-16 10:00:00".into(),
            geraet_gekoppelt: false,
        };
        let v = VerpflegungAnzeige {
            zeitfenster: vec![
                fenster(1, vec![1], Vec::new()),
                fenster(2, vec![2], Vec::new()),
                fenster(3, Vec::new(), Vec::new()),
                fenster(4, vec![2, 1], Vec::new()),
            ],
            stellen: vec![stelle(1), stelle(2)],
            empfaenger: VerpflegungEmpfaenger::default(),
        };
        let v = verpflegung(v, 1);
        assert_eq!(
            v.zeitfenster.iter().map(|z| z.id).collect::<Vec<_>>(),
            vec![1, 3, 4]
        );
        assert_eq!(v.stellen.iter().map(|s| s.id).collect::<Vec<_>>(), vec![1]);
        assert!(v.zeitfenster[1].stelle_ids.is_empty(), "einsatzweit bleibt");
    }
}
