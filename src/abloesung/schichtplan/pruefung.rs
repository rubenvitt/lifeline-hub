//! Prüfbefunde des Schichtplans (LLH-1552, design.md D5; Spec `kraefte-schichtplan`,
//! „Prüfbefunde“). Rein, ohne Datenbank: das Repo lädt Blöcke und den Stand der Personen, diese
//! Datei rechnet. Befunde werden nicht gespeichert und blockieren nie.
//!
//! - `doppelt`: eine Person in zwei Blöcken mit überschneidender Zeit, auch mit einer Pause.
//! - `quali`: mit [`offene_anforderungen`] (LLH-1553). Erst wenn die freien Plätze die fehlenden
//!   Qualifikationen nicht mehr aufnehmen; vorher gehört das zur Lücke, wie in der Suite.
//! - `dienst`: Blöcke ohne Pause je Person nach Zeit; eine Lücke unter der Mindestruhe trennt die
//!   Strecke nicht (eine Pause liegt darin und trennt auch nicht). Strecke länger als der
//!   Höchstwert → Befund an jedem ihrer Blöcke.
//! - `verfuegbar`: Stamm-Person außer Dienst, Ad-hoc-Kraft entlassen, Posten aufgelöst.
//! - `abweichung`: ab Blockbeginn + [`ABWEICHUNG_NACH_MINUTEN`] bis Blockende ist die Person nicht
//!   am Posten (Einheit samt Untereinheiten, UHS, Status „Pause“). Helfer und nicht disponierte
//!   Stamm-Personen sind nie am Posten.
//!
//! Der Dienst-Befund liest nur Planblöcke. Das Ist stuft der Client mit derselben Trennregel ein
//! (LLH-730, `frontend/src/kraefte/zeitachse.ts`, `stufeEin`).

use std::collections::{BTreeMap, HashMap, HashSet};

use chrono::{DateTime, Duration, Utc};

use super::{
    PlanBefund, PlanBefundArt, PlanPerson, Posten, SchichtplanGrenzwerte, ABWEICHUNG_NACH_MINUTEN,
};
use crate::personal::qualifikation_deckung::{
    offene_anforderungen, Anforderung, Einschluesse, OffeneAnforderung,
};

/// Ein Block, wie die Prüfung ihn braucht.
#[derive(Debug, Clone, PartialEq)]
pub struct Block {
    pub id: i64,
    pub posten: Posten,
    pub von: DateTime<Utc>,
    pub bis: DateTime<Utc>,
    pub soll_anzahl: Option<i64>,
    pub quali_soll: Vec<Anforderung>,
    pub personen: Vec<PlanPerson>,
    /// Einheit aufgelöst bzw. UHS aufgelöst oder storniert.
    pub posten_aufgeloest: bool,
}

/// Wo eine Person gerade steht (Ist).
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Ist {
    /// Disponiert und nicht entlassen.
    pub im_einsatz: bool,
    pub einheit_id: Option<i64>,
    pub uhs_id: Option<i64>,
    /// Personalstatus „Pause“.
    pub pause: bool,
}

/// Was die Prüfung über eine Person wissen muss.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PersonStand {
    pub qualifikationen: Vec<i64>,
    /// `false`: Stamm-Person außer Dienst oder Ad-hoc-Kraft entlassen.
    pub verfuegbar: bool,
    pub ist: Ist,
}

impl Default for PersonStand {
    fn default() -> Self {
        Self {
            qualifikationen: Vec::new(),
            verfuegbar: true,
            ist: Ist::default(),
        }
    }
}

/// Alles außer den Blöcken.
pub struct Grundlage<'a> {
    pub katalog: &'a Einschluesse,
    pub personen: &'a HashMap<PlanPerson, PersonStand>,
    /// Einheit → übergeordnete Einheit (Verteilung LLH-1319: eine Untereinheit zählt mit).
    pub ueber_einheit: &'a HashMap<i64, Option<i64>>,
    pub grenzwerte: SchichtplanGrenzwerte,
    pub jetzt: DateTime<Utc>,
    /// Ob es ein Ist gibt, gegen das der Plan läuft. Eine Vorplanung ohne Einsatz (LLH-1561,
    /// design.md D4) prüft ohne: dann entfallen `abweichung` und `naechste_pruefung`, und die
    /// Art des Postens zählt nur für die Pause.
    pub mit_ist: bool,
}

/// Ergebnis für einen Block.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct BlockErgebnis {
    pub offene_plaetze: i64,
    pub offene_anforderungen: Vec<OffeneAnforderung>,
    /// Befunde des Blocks selbst (`quali`, `verfuegbar` des Postens).
    pub befunde: Vec<PlanBefund>,
    /// Befunde je eingeteilter Person.
    pub personen: BTreeMap<PlanPerson, Vec<PlanBefund>>,
}

/// Ergebnis für den ganzen Plan.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Ergebnis {
    pub bloecke: HashMap<i64, BlockErgebnis>,
    /// Nächster Zeitpunkt nach `jetzt`, an dem sich `abweichung` ändern kann.
    pub naechste_pruefung: Option<DateTime<Utc>>,
}

fn ueberschneiden(a: &Block, b: &Block) -> bool {
    a.von < b.bis && b.von < a.bis
}

/// Rechnet alle Befunde des Plans.
pub fn pruefe(bloecke: &[Block], g: &Grundlage<'_>) -> Ergebnis {
    let leer = PersonStand::default();
    let stand = |p: &PlanPerson| g.personen.get(p).unwrap_or(&leer);
    let mut ergebnis = Ergebnis::default();
    let mut person_befunde: HashMap<(i64, PlanPerson), Vec<PlanBefund>> = HashMap::new();
    let mut befund = |block: i64, person: PlanPerson, b: PlanBefund| {
        person_befunde.entry((block, person)).or_default().push(b);
    };

    // Je Person ihre Blöcke.
    let mut je_person: BTreeMap<PlanPerson, Vec<&Block>> = BTreeMap::new();
    for block in bloecke {
        for p in &block.personen {
            je_person.entry(*p).or_default().push(block);
        }
    }

    for (person, liste) in &je_person {
        // doppelt
        for (i, a) in liste.iter().enumerate() {
            for b in liste.iter().skip(i + 1) {
                if a.id != b.id && ueberschneiden(a, b) {
                    befund(
                        a.id,
                        *person,
                        PlanBefund {
                            anderer_block_id: Some(b.id),
                            ..PlanBefund::nur(PlanBefundArt::Doppelt)
                        },
                    );
                    befund(
                        b.id,
                        *person,
                        PlanBefund {
                            anderer_block_id: Some(a.id),
                            ..PlanBefund::nur(PlanBefundArt::Doppelt)
                        },
                    );
                }
            }
        }
        // dienst
        for (strecke, dauer) in dienststrecken(liste, g.grenzwerte) {
            if dauer > g.grenzwerte.max_dienst_minuten {
                for id in strecke {
                    befund(
                        id,
                        *person,
                        PlanBefund {
                            dauer_minuten: Some(dauer),
                            ..PlanBefund::nur(PlanBefundArt::Dienst)
                        },
                    );
                }
            }
        }
    }

    let schwelle = Duration::minutes(ABWEICHUNG_NACH_MINUTEN);
    for block in bloecke {
        let mut e = BlockErgebnis::default();
        // Soll, Lücke, Qualifikation. Ohne Soll-Anzahl gilt die Summe des Qualifikationssolls.
        if block.posten != Posten::Pause {
            let gefordert: i64 = block.quali_soll.iter().map(|a| a.anzahl).sum();
            let soll = block.soll_anzahl.unwrap_or(0).max(gefordert);
            let anzahl = block.personen.len() as i64;
            e.offene_plaetze = (soll - anzahl).max(0);
            let quals: Vec<Vec<i64>> = block
                .personen
                .iter()
                .map(|p| stand(p).qualifikationen.clone())
                .collect();
            e.offene_anforderungen = offene_anforderungen(g.katalog, &block.quali_soll, &quals);
            let fehlen: i64 = e.offene_anforderungen.iter().map(|o| o.fehlen).sum();
            if fehlen > e.offene_plaetze {
                e.befunde
                    .extend(e.offene_anforderungen.iter().map(|o| PlanBefund {
                        qualifikation_id: Some(o.qualifikation_id),
                        fehlen: Some(o.fehlen),
                        ..PlanBefund::nur(PlanBefundArt::Quali)
                    }));
            }
        }
        if block.posten_aufgeloest {
            e.befunde.push(PlanBefund::nur(PlanBefundArt::Verfuegbar));
        }

        // Plan gegen Ist: nur im Fenster [von + 10 min, bis).
        let ab = block.von + schwelle;
        let im_fenster = g.mit_ist && ab <= g.jetzt && g.jetzt < block.bis;
        for t in [ab, block.bis] {
            if g.mit_ist && t > g.jetzt && ab < block.bis {
                ergebnis.naechste_pruefung = Some(match ergebnis.naechste_pruefung {
                    Some(n) => n.min(t),
                    None => t,
                });
            }
        }

        for p in &block.personen {
            let s = stand(p);
            let mut liste = person_befunde.remove(&(block.id, *p)).unwrap_or_default();
            if !s.verfuegbar {
                liste.push(PlanBefund::nur(PlanBefundArt::Verfuegbar));
            }
            if im_fenster && !am_posten(block.posten, &s.ist, g.ueber_einheit) {
                liste.push(PlanBefund::nur(PlanBefundArt::Abweichung));
            }
            liste.sort_by_key(|b| (b.art, b.anderer_block_id));
            e.personen.insert(*p, liste);
        }
        ergebnis.bloecke.insert(block.id, e);
    }
    ergebnis
}

/// Dienststrecken einer Person: je Strecke die Blöcke und die Länge in Minuten. Pausen zählen
/// nicht; eine Lücke trennt, wenn sie echt größer als null und mindestens die Mindestruhe ist.
/// Gegenstück für das Ist: `frontend/src/kraefte/zeitachse.ts`, `stufeEin` (LLH-730); wer die
/// Regel ändert, ändert beide.
fn dienststrecken(liste: &[&Block], grenzwerte: SchichtplanGrenzwerte) -> Vec<(Vec<i64>, i64)> {
    let mut dienst: Vec<&&Block> = liste.iter().filter(|b| b.posten != Posten::Pause).collect();
    dienst.sort_by_key(|b| (b.von, b.bis, b.id));
    let ruhe = Duration::minutes(grenzwerte.min_ruhe_minuten);
    let mut strecken: Vec<(Vec<i64>, DateTime<Utc>, DateTime<Utc>)> = Vec::new();
    for b in dienst {
        match strecken.last_mut() {
            Some((ids, _, ende)) => {
                let luecke = b.von - *ende;
                if luecke > Duration::zero() && luecke >= ruhe {
                    strecken.push((vec![b.id], b.von, b.bis));
                } else {
                    ids.push(b.id);
                    *ende = (*ende).max(b.bis);
                }
            }
            None => strecken.push((vec![b.id], b.von, b.bis)),
        }
    }
    strecken
        .into_iter()
        .map(|(ids, start, ende)| (ids, (ende - start).num_minutes()))
        .collect()
}

/// Ob eine Person laut Ist am Posten steht.
fn am_posten(posten: Posten, ist: &Ist, ueber_einheit: &HashMap<i64, Option<i64>>) -> bool {
    if !ist.im_einsatz {
        return false;
    }
    match posten {
        Posten::Pause => ist.pause,
        Posten::Uhs(uhs) => ist.uhs_id == Some(uhs),
        Posten::Einheit(einheit) => {
            // Die Einheit selbst oder eine Untereinheit (Vorfahrenkette, gegen Kreise geschützt).
            let mut gesehen = HashSet::new();
            let mut aktuell = ist.einheit_id;
            while let Some(id) = aktuell {
                if id == einheit {
                    return true;
                }
                if !gesehen.insert(id) {
                    break;
                }
                aktuell = ueber_einheit.get(&id).copied().flatten();
            }
            false
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn t(s: &str) -> DateTime<Utc> {
        crate::zeit::parse_utc(&format!("2026-11-07 {s}:00")).unwrap()
    }

    fn morgen(s: &str) -> DateTime<Utc> {
        crate::zeit::parse_utc(&format!("2026-11-08 {s}:00")).unwrap()
    }

    fn block(id: i64, posten: Posten, von: DateTime<Utc>, bis: DateTime<Utc>) -> Block {
        Block {
            id,
            posten,
            von,
            bis,
            soll_anzahl: None,
            quali_soll: Vec::new(),
            personen: Vec::new(),
            posten_aufgeloest: false,
        }
    }

    struct Welt {
        katalog: Einschluesse,
        personen: HashMap<PlanPerson, PersonStand>,
        ueber: HashMap<i64, Option<i64>>,
        grenzwerte: SchichtplanGrenzwerte,
        jetzt: DateTime<Utc>,
        mit_ist: bool,
    }

    impl Welt {
        fn neu() -> Self {
            Self {
                // 3 Notfallsanitäter → 2 Rettungssanitäter → 1 Sanitäter
                katalog: HashMap::from([(1, None), (2, Some(1)), (3, Some(2))]),
                personen: HashMap::new(),
                ueber: HashMap::new(),
                grenzwerte: SchichtplanGrenzwerte::aus(None, None),
                jetzt: t("00:00"),
                mit_ist: true,
            }
        }

        fn pruefe(&self, bloecke: &[Block]) -> Ergebnis {
            pruefe(
                bloecke,
                &Grundlage {
                    katalog: &self.katalog,
                    personen: &self.personen,
                    ueber_einheit: &self.ueber,
                    grenzwerte: self.grenzwerte,
                    jetzt: self.jetzt,
                    mit_ist: self.mit_ist,
                },
            )
        }
    }

    fn arten(liste: &[PlanBefund]) -> Vec<PlanBefundArt> {
        liste.iter().map(|b| b.art).collect()
    }

    const ANNA: PlanPerson = PlanPerson::Stamm(1);
    const BEN: PlanPerson = PlanPerson::Stamm(2);

    /// Szenario „Doppelt“: Streife 2 14:00–16:00 und UHS 15:00–19:00.
    #[test]
    fn doppelt_an_beiden_bloecken() {
        let w = Welt::neu();
        let mut a = block(10, Posten::Einheit(2), t("14:00"), t("16:00"));
        let mut b = block(11, Posten::Uhs(1), t("15:00"), t("19:00"));
        a.personen = vec![ANNA];
        b.personen = vec![ANNA];
        let e = w.pruefe(&[a, b]);
        assert_eq!(e.bloecke[&10].personen[&ANNA][0].anderer_block_id, Some(11));
        assert_eq!(e.bloecke[&11].personen[&ANNA][0].anderer_block_id, Some(10));
        assert_eq!(
            arten(&e.bloecke[&10].personen[&ANNA]),
            [PlanBefundArt::Doppelt]
        );
    }

    /// Anschluss ist keine Überschneidung; eine Pause zählt mit.
    #[test]
    fn anschluss_nicht_doppelt_pause_schon() {
        let w = Welt::neu();
        let mut a = block(1, Posten::Einheit(2), t("14:00"), t("16:00"));
        let mut b = block(2, Posten::Einheit(3), t("16:00"), t("18:00"));
        let mut p = block(3, Posten::Pause, t("17:00"), t("17:30"));
        a.personen = vec![ANNA];
        b.personen = vec![ANNA];
        p.personen = vec![ANNA];
        let e = w.pruefe(&[a, b, p]);
        assert!(e.bloecke[&1].personen[&ANNA].is_empty());
        assert_eq!(
            arten(&e.bloecke[&2].personen[&ANNA]),
            [PlanBefundArt::Doppelt]
        );
        assert_eq!(
            arten(&e.bloecke[&3].personen[&ANNA]),
            [PlanBefundArt::Doppelt]
        );
    }

    /// Szenarien „Lücke statt Befund“ und „Qualifikation fehlt“.
    #[test]
    fn quali_erst_wenn_die_plaetze_nicht_reichen() {
        let mut w = Welt::neu();
        for p in [ANNA, BEN] {
            w.personen.insert(
                p,
                PersonStand {
                    qualifikationen: vec![1],
                    ..PersonStand::default()
                },
            );
        }
        let rs = vec![Anforderung {
            qualifikation_id: 2,
            anzahl: 1,
        }];
        let mut drei = block(1, Posten::Einheit(1), t("14:00"), t("16:00"));
        drei.soll_anzahl = Some(3);
        drei.quali_soll = rs.clone();
        drei.personen = vec![ANNA, BEN];
        let mut zwei = drei.clone();
        zwei.id = 2;
        zwei.posten = Posten::Einheit(2);
        zwei.soll_anzahl = Some(2);
        let e = w.pruefe(&[drei, zwei]);
        let luecke = &e.bloecke[&1];
        assert_eq!(luecke.offene_plaetze, 1);
        assert_eq!(
            luecke.offene_anforderungen,
            vec![OffeneAnforderung {
                qualifikation_id: 2,
                fehlen: 1
            }]
        );
        assert!(luecke.befunde.is_empty(), "noch Lücke, kein Befund");
        let voll = &e.bloecke[&2];
        assert_eq!(voll.offene_plaetze, 0);
        assert_eq!(
            voll.befunde,
            vec![PlanBefund {
                qualifikation_id: Some(2),
                fehlen: Some(1),
                ..PlanBefund::nur(PlanBefundArt::Quali)
            }]
        );
    }

    /// Ein Notfallsanitäter deckt den Rettungssanitäter (Einschluss, LLH-1553); ohne Soll-Anzahl
    /// gilt die Summe des Qualifikationssolls.
    #[test]
    fn einschluss_deckt_und_soll_aus_qualifikationen() {
        let mut w = Welt::neu();
        w.personen.insert(
            ANNA,
            PersonStand {
                qualifikationen: vec![3],
                ..PersonStand::default()
            },
        );
        let mut b = block(1, Posten::Uhs(4), t("14:00"), t("16:00"));
        b.quali_soll = vec![
            Anforderung {
                qualifikation_id: 2,
                anzahl: 1,
            },
            Anforderung {
                qualifikation_id: 1,
                anzahl: 1,
            },
        ];
        b.personen = vec![ANNA];
        let e = w.pruefe(&[b]);
        assert_eq!(e.bloecke[&1].offene_plaetze, 1);
        assert_eq!(
            e.bloecke[&1].offene_anforderungen,
            vec![OffeneAnforderung {
                qualifikation_id: 1,
                fehlen: 1
            }]
        );
        assert!(e.bloecke[&1].befunde.is_empty());
    }

    /// Szenarien „Zu lange ohne Ruhe“ und „Genug Ruhe“ mit 12 h / 8 h.
    #[test]
    fn dienst_nach_strecke() {
        let w = Welt::neu();
        let mut a = block(1, Posten::Einheit(1), t("08:00"), t("14:00"));
        let mut b = block(2, Posten::Einheit(1), t("16:00"), t("22:00"));
        a.personen = vec![ANNA];
        b.personen = vec![ANNA];
        let e = w.pruefe(&[a, b]);
        for id in [1, 2] {
            assert_eq!(
                e.bloecke[&id].personen[&ANNA],
                vec![PlanBefund {
                    dauer_minuten: Some(14 * 60),
                    ..PlanBefund::nur(PlanBefundArt::Dienst)
                }]
            );
        }

        let mut c = block(3, Posten::Einheit(1), t("06:00"), t("12:00"));
        let mut d = block(4, Posten::Einheit(1), t("20:00"), morgen("02:00"));
        c.personen = vec![BEN];
        d.personen = vec![BEN];
        let e = w.pruefe(&[c, d]);
        assert!(e.bloecke[&3].personen[&BEN].is_empty());
        assert!(e.bloecke[&4].personen[&BEN].is_empty());
    }

    /// Eine Pause dazwischen trennt nicht; Ruhe 0 trennt jede echte Lücke, nie einen Anschluss.
    #[test]
    fn pause_trennt_nicht_ruhe_null_trennt_jede_luecke() {
        let mut w = Welt::neu();
        let mut a = block(1, Posten::Einheit(1), t("06:00"), t("12:00"));
        let mut p = block(2, Posten::Pause, t("12:00"), t("13:00"));
        let mut b = block(3, Posten::Einheit(1), t("13:00"), t("19:00"));
        a.personen = vec![ANNA];
        p.personen = vec![ANNA];
        b.personen = vec![ANNA];
        let e = w.pruefe(&[a.clone(), p.clone(), b.clone()]);
        assert_eq!(
            arten(&e.bloecke[&3].personen[&ANNA]),
            [PlanBefundArt::Dienst]
        );
        assert!(
            e.bloecke[&2].personen[&ANNA].is_empty(),
            "die Pause selbst nicht"
        );

        w.grenzwerte = SchichtplanGrenzwerte::aus(Some(720), Some(0));
        let e = w.pruefe(&[a.clone(), p, b]);
        assert!(e.bloecke[&3].personen[&ANNA].is_empty(), "1 h Lücke trennt");
        let mut anschluss = block(4, Posten::Einheit(2), t("12:00"), t("19:00"));
        anschluss.personen = vec![ANNA];
        let e = w.pruefe(&[a, anschluss]);
        assert_eq!(
            arten(&e.bloecke[&4].personen[&ANNA]),
            [PlanBefundArt::Dienst]
        );
    }

    #[test]
    fn verfuegbar_an_person_und_posten() {
        let mut w = Welt::neu();
        w.personen.insert(
            ANNA,
            PersonStand {
                verfuegbar: false,
                ..PersonStand::default()
            },
        );
        let mut b = block(1, Posten::Uhs(1), t("14:00"), t("16:00"));
        b.personen = vec![ANNA];
        b.posten_aufgeloest = true;
        let e = w.pruefe(&[b]);
        assert_eq!(arten(&e.bloecke[&1].befunde), [PlanBefundArt::Verfuegbar]);
        assert_eq!(
            arten(&e.bloecke[&1].personen[&ANNA]),
            [PlanBefundArt::Verfuegbar]
        );
    }

    /// Szenario „Plan gegen Ist“: um 14:05 noch nicht, um 14:15 schon; am Ende nicht mehr.
    #[test]
    fn abweichung_im_fenster() {
        let mut w = Welt::neu();
        w.personen.insert(
            BEN,
            PersonStand {
                ist: Ist {
                    im_einsatz: true,
                    einheit_id: Some(7),
                    ..Ist::default()
                },
                ..PersonStand::default()
            },
        );
        let mut b = block(1, Posten::Einheit(2), t("14:00"), t("16:00"));
        b.personen = vec![BEN];
        w.jetzt = t("14:05");
        let e = w.pruefe(&[b.clone()]);
        assert!(e.bloecke[&1].personen[&BEN].is_empty());
        assert_eq!(e.naechste_pruefung, Some(t("14:10")));
        w.jetzt = t("14:15");
        let e = w.pruefe(&[b.clone()]);
        assert_eq!(
            arten(&e.bloecke[&1].personen[&BEN]),
            [PlanBefundArt::Abweichung]
        );
        assert_eq!(e.naechste_pruefung, Some(t("16:00")));
        w.jetzt = t("16:00");
        let e = w.pruefe(&[b]);
        assert!(e.bloecke[&1].personen[&BEN].is_empty());
        assert_eq!(e.naechste_pruefung, None);
    }

    /// Eine Untereinheit zählt zum Posten; UHS und Pause nach Ist; Helfer nie.
    #[test]
    fn am_posten_mit_untereinheit_uhs_pause() {
        let mut w = Welt::neu();
        w.ueber = HashMap::from([(7, Some(2)), (2, None)]);
        w.jetzt = t("15:00");
        let im = |einheit_id, uhs_id, pause| PersonStand {
            ist: Ist {
                im_einsatz: true,
                einheit_id,
                uhs_id,
                pause,
            },
            ..PersonStand::default()
        };
        w.personen.insert(ANNA, im(Some(7), None, false));
        w.personen.insert(BEN, im(None, Some(4), false));
        let carla = PlanPerson::Einsatz(9);
        w.personen.insert(carla, im(None, None, true));
        let helfer = PlanPerson::Helfer(1);
        let mut e = block(1, Posten::Einheit(2), t("14:00"), t("16:00"));
        let mut u = block(2, Posten::Uhs(4), t("14:00"), t("16:00"));
        let mut p = block(3, Posten::Pause, t("14:00"), t("16:00"));
        e.personen = vec![ANNA, helfer];
        u.personen = vec![BEN];
        p.personen = vec![carla];
        let r = w.pruefe(&[e, u, p]);
        assert!(r.bloecke[&1].personen[&ANNA].is_empty());
        assert_eq!(
            arten(&r.bloecke[&1].personen[&helfer]),
            [PlanBefundArt::Abweichung]
        );
        assert!(r.bloecke[&2].personen[&BEN].is_empty());
        assert!(r.bloecke[&3].personen[&carla].is_empty());
    }

    /// Eine Vorplanung ohne Einsatz (LLH-1561) prüft ohne Ist: keine Abweichung, keine nächste
    /// Prüfung, die übrigen Befunde bleiben.
    #[test]
    fn ohne_ist_keine_abweichung_aber_doppelt() {
        let mut w = Welt::neu();
        w.mit_ist = false;
        w.jetzt = t("15:00");
        let mut a = block(1, Posten::Einheit(2), t("14:00"), t("16:00"));
        let mut b = block(2, Posten::Einheit(3), t("15:00"), t("17:00"));
        a.personen = vec![BEN];
        b.personen = vec![BEN];
        let e = w.pruefe(&[a, b]);
        assert_eq!(
            arten(&e.bloecke[&1].personen[&BEN]),
            [PlanBefundArt::Doppelt]
        );
        assert_eq!(e.naechste_pruefung, None);
    }
}
