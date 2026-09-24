//! Deckung eines Verpflegungszeitfensters (LFH-634, design.md D2) — **die eine Rechenstelle**
//! für ausgegebene Menge und Fehlmenge. Rein, ohne Uhr und ohne DB: die Einstufung „hat
//! begonnen?“ gehört nicht hierher, sondern ins Frontend (`verpflegung/deckung.ts`).

use super::{AusgabeAnzeige, Bedarf, Portionen};

/// Ausgegebene Menge und Fehlmenge eines Zeitfensters.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Deckung {
    /// Summe der nicht zurückgenommenen Ausgaben, gesamt und je Kostform.
    pub ausgegeben: Portionen,
    /// Je `max(0, bedarf − ausgegeben)`, gesamt und je Kostform. Nie negativ: eine Überdeckung
    /// ist Fehlmenge 0, und eine Überdeckung in einer Kostform deckt keine andere.
    pub fehlmenge: Portionen,
}

/// Rechnet die Deckung aus dem Bedarf und den Ausgaben des Zeitfensters. Zurückgenommene
/// Ausgaben (`zurueckgenommen_at` gesetzt) zählen nicht.
pub fn rechne(bedarf: &Bedarf, ausgaben: &[AusgabeAnzeige]) -> Deckung {
    let ausgegeben = ausgaben
        .iter()
        .filter(|a| a.zurueckgenommen_at.is_none())
        .fold(Portionen::default(), |summe, a| Portionen {
            gesamt: summe.gesamt + a.menge,
            sonderkost: summe.sonderkost.plus(&a.sonderkost),
        });
    let fehlmenge = Portionen {
        gesamt: (bedarf.gesamt - ausgegeben.gesamt).max(0),
        sonderkost: bedarf.sonderkost.fehlmenge(&ausgegeben.sonderkost),
    };
    Deckung {
        ausgegeben,
        fehlmenge,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::verpflegung::Sonderkost;

    /// Eine Sonderkost nur mit `vegan`.
    fn vegan(n: i64) -> Sonderkost {
        Sonderkost {
            vegan: n,
            ..Sonderkost::default()
        }
    }

    fn bedarf(kraefte: i64, betreute: i64, sonderkost: Sonderkost) -> Bedarf {
        Bedarf {
            kraefte,
            betreute,
            weitere: 0,
            gesamt: kraefte + betreute,
            sonderkost,
        }
    }

    fn ausgabe(id: i64, menge: i64, sonderkost: Sonderkost, zurueck: bool) -> AusgabeAnzeige {
        AusgabeAnzeige {
            id,
            zeitfenster_id: 1,
            zeitpunkt_at: "2026-09-24 10:00:00".into(),
            menge,
            ort: None,
            bemerkung: None,
            sonderkost,
            nachforderung_id: None,
            zurueckgenommen_at: zurueck.then(|| "2026-09-24 10:05:00".into()),
            erfasst_at: "2026-09-24 10:00:00".into(),
        }
    }

    /// Spec „Unterdeckung im laufenden Zeitfenster“: Bedarf 250, ausgegeben 230 → Fehlmenge 20.
    #[test]
    fn fehlmenge_ist_bedarf_minus_ausgegeben() {
        let d = rechne(
            &bedarf(180, 70, Sonderkost::default()),
            &[
                ausgabe(1, 120, Sonderkost::default(), false),
                ausgabe(2, 110, Sonderkost::default(), false),
            ],
        );
        assert_eq!(d.ausgegeben.gesamt, 230);
        assert_eq!(d.fehlmenge.gesamt, 20);
        assert_eq!(d.fehlmenge.sonderkost, Sonderkost::default());
    }

    /// Spec „Fehlmenge vor Beginn“: ohne Ausgabe steht die volle Fehlmenge da.
    #[test]
    fn ohne_ausgabe_ist_die_volle_fehlmenge_offen() {
        let d = rechne(&bedarf(180, 70, vegan(3)), &[]);
        assert_eq!(d.ausgegeben, Portionen::default());
        assert_eq!(d.fehlmenge.gesamt, 250);
        assert_eq!(d.fehlmenge.sonderkost, vegan(3));
    }

    /// Spec „Überdeckung“: Fehlmenge nie negativ.
    #[test]
    fn ueberdeckung_ist_fehlmenge_null() {
        let d = rechne(
            &bedarf(180, 70, vegan(3)),
            &[ausgabe(1, 300, vegan(5), false)],
        );
        assert_eq!(d.ausgegeben.gesamt, 300);
        assert_eq!(d.ausgegeben.sonderkost, vegan(5));
        assert_eq!(d.fehlmenge, Portionen::default());
    }

    /// Spec „Sonderkost fehlt trotz Gesamtdeckung“: 250 von 250 ausgegeben, davon 0 vegan bei
    /// 3 vegan Bedarf → Fehlmenge gesamt 0, vegan 3.
    #[test]
    fn fehlmenge_je_kostform_trotz_gesamtdeckung() {
        let d = rechne(
            &bedarf(180, 70, vegan(3)),
            &[ausgabe(1, 250, Sonderkost::default(), false)],
        );
        assert_eq!(d.fehlmenge.gesamt, 0);
        assert_eq!(d.fehlmenge.sonderkost, vegan(3));
    }

    /// Überdeckung in einer Kostform deckt keine andere.
    #[test]
    fn ueberdeckung_einer_kostform_deckt_keine_andere() {
        let b = bedarf(
            10,
            0,
            Sonderkost {
                vegan: 2,
                vegetarisch: 2,
                ..Sonderkost::default()
            },
        );
        let d = rechne(
            &b,
            &[ausgabe(
                1,
                10,
                Sonderkost {
                    vegetarisch: 4,
                    ..Sonderkost::default()
                },
                false,
            )],
        );
        assert_eq!(d.fehlmenge.sonderkost, vegan(2));
    }

    /// Spec „Rücknahme“: eine zurückgenommene Ausgabe zählt nicht mehr.
    #[test]
    fn zurueckgenommene_ausgaben_zaehlen_nicht() {
        let d = rechne(
            &bedarf(180, 70, vegan(3)),
            &[
                ausgabe(1, 120, vegan(3), true),
                ausgabe(2, 100, Sonderkost::default(), false),
            ],
        );
        assert_eq!(d.ausgegeben.gesamt, 100);
        assert_eq!(d.ausgegeben.sonderkost, Sonderkost::default());
        assert_eq!(d.fehlmenge.gesamt, 150);
        assert_eq!(d.fehlmenge.sonderkost, vegan(3));
    }
}
