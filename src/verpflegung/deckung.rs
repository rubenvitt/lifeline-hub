//! Deckung eines Verpflegungszeitfensters (LFH-634, design.md D2) — **die eine Rechenstelle**
//! für ausgegebene Menge und Fehlmenge, seit LLH-1040 (design.md D6) auch für das Ist je
//! Verpflegungsstelle. Rein, ohne Uhr und ohne DB: die Einstufung „hat begonnen?“ gehört nicht
//! hierher, sondern ins Frontend (`verpflegung/deckung.ts`). Der Client rechnet je Stelle nichts
//! nach.

use super::{AusgabeAnzeige, Bedarf, Portionen, StelleIst};

/// Ausgegebene Menge und Fehlmenge eines Zeitfensters.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Deckung {
    /// Summe der nicht zurückgenommenen Ausgaben, gesamt und je Kostform.
    pub ausgegeben: Portionen,
    /// Je `max(0, bedarf − ausgegeben)`, gesamt und je Kostform. Nie negativ: eine Überdeckung
    /// ist Fehlmenge 0, und eine Überdeckung in einer Kostform deckt keine andere.
    pub fehlmenge: Portionen,
    /// Ausgegeben je Stelle (LLH-1040 D6): jede zugeordnete Stelle in der Reihenfolge von
    /// `zugeordnet` (auch mit 0), danach jede weitere Stelle mit gültigen Ausgaben nach Kennung,
    /// zuletzt „ohne Stelle“ (`stelle_id: None`), wenn es gültige Ausgaben ohne Stelle gibt.
    /// **Leer**, wenn das Zeitfenster keine Zuordnung und keine gültige Ausgabe an einer Stelle
    /// hat — so bleibt der Bestand in der Anzeige unverändert. Ist sie nicht leer, ist ihre Summe
    /// `ausgegeben`, gesamt und je Kostform. Kein Soll und keine Fehlmenge je Stelle.
    pub je_stelle: Vec<StelleIst>,
}

fn plus(summe: Portionen, a: &AusgabeAnzeige) -> Portionen {
    Portionen {
        gesamt: summe.gesamt + a.menge,
        sonderkost: summe.sonderkost.plus(&a.sonderkost),
    }
}

/// Rechnet die Deckung aus dem Bedarf, den Ausgaben und den zugeordneten Stellen des
/// Zeitfensters. Zurückgenommene Ausgaben (`zurueckgenommen_at` gesetzt) zählen nicht, auch
/// nicht je Stelle.
pub fn rechne(bedarf: &Bedarf, ausgaben: &[AusgabeAnzeige], zugeordnet: &[i64]) -> Deckung {
    let gueltig: Vec<&AusgabeAnzeige> = ausgaben
        .iter()
        .filter(|a| a.zurueckgenommen_at.is_none())
        .collect();
    let ausgegeben = gueltig.iter().fold(Portionen::default(), |s, a| plus(s, a));
    let fehlmenge = Portionen {
        gesamt: (bedarf.gesamt - ausgegeben.gesamt).max(0),
        sonderkost: bedarf.sonderkost.fehlmenge(&ausgegeben.sonderkost),
    };
    Deckung {
        ausgegeben,
        fehlmenge,
        je_stelle: je_stelle(&gueltig, zugeordnet),
    }
}

/// Das Ist je Stelle aus den gültigen Ausgaben (s. [`Deckung::je_stelle`]).
fn je_stelle(gueltig: &[&AusgabeAnzeige], zugeordnet: &[i64]) -> Vec<StelleIst> {
    let an_stelle = |sid: Option<i64>| {
        gueltig
            .iter()
            .filter(|a| a.verpflegungsstelle_id == sid)
            .fold(Portionen::default(), |s, a| plus(s, a))
    };
    let mut weitere: Vec<i64> = gueltig
        .iter()
        .filter_map(|a| a.verpflegungsstelle_id)
        .filter(|sid| !zugeordnet.contains(sid))
        .collect();
    weitere.sort_unstable();
    weitere.dedup();
    if zugeordnet.is_empty() && weitere.is_empty() {
        return Vec::new();
    }
    let mut liste: Vec<StelleIst> = zugeordnet
        .iter()
        .chain(weitere.iter())
        .map(|&sid| StelleIst {
            stelle_id: Some(sid),
            ausgegeben: an_stelle(Some(sid)),
        })
        .collect();
    if gueltig.iter().any(|a| a.verpflegungsstelle_id.is_none()) {
        liste.push(StelleIst {
            stelle_id: None,
            ausgegeben: an_stelle(None),
        });
    }
    liste
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
        an(None, id, menge, sonderkost, zurueck)
    }

    /// Eine Ausgabe an der Stelle `stelle` (`None` = ohne Stelle).
    fn an(
        stelle: Option<i64>,
        id: i64,
        menge: i64,
        sonderkost: Sonderkost,
        zurueck: bool,
    ) -> AusgabeAnzeige {
        AusgabeAnzeige {
            id,
            zeitfenster_id: 1,
            zeitpunkt_at: "2026-09-24 10:00:00".into(),
            menge,
            ort: None,
            bemerkung: None,
            sonderkost,
            nachforderung_id: None,
            verpflegungsstelle_id: stelle,
            einheit_id: None,
            abschnitt_id: None,
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
            &[],
        );
        assert_eq!(d.ausgegeben.gesamt, 230);
        assert_eq!(d.fehlmenge.gesamt, 20);
        assert_eq!(d.fehlmenge.sonderkost, Sonderkost::default());
    }

    /// Spec „Fehlmenge vor Beginn“: ohne Ausgabe steht die volle Fehlmenge da.
    #[test]
    fn ohne_ausgabe_ist_die_volle_fehlmenge_offen() {
        let d = rechne(&bedarf(180, 70, vegan(3)), &[], &[]);
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
            &[],
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
            &[],
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
            &[],
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
            &[],
        );
        assert_eq!(d.ausgegeben.gesamt, 100);
        assert_eq!(d.ausgegeben.sonderkost, Sonderkost::default());
        assert_eq!(d.fehlmenge.gesamt, 150);
        assert_eq!(d.fehlmenge.sonderkost, vegan(3));
    }

    // ── Ist je Stelle (LLH-1040, design.md D6) ──────────────────────────────────────────────

    const FELDKUECHE: i64 = 11;
    const TURNHALLE: i64 = 12;
    const DEICH: i64 = 13;

    fn ist(stelle: Option<i64>, gesamt: i64) -> StelleIst {
        StelleIst {
            stelle_id: stelle,
            ausgegeben: Portionen {
                gesamt,
                sonderkost: Sonderkost::default(),
            },
        }
    }

    /// AK des Tickets ohne Soll je Stelle (D11): Bedarf 200, 100 an der Feldküche und 80 an
    /// der Turnhalle → je Stelle 100 und 80, Fehlmenge gesamt 20.
    #[test]
    fn ist_je_stelle_ohne_soll() {
        let d = rechne(
            &bedarf(200, 0, Sonderkost::default()),
            &[
                an(Some(FELDKUECHE), 1, 100, Sonderkost::default(), false),
                an(Some(TURNHALLE), 2, 80, Sonderkost::default(), false),
            ],
            &[FELDKUECHE, TURNHALLE],
        );
        assert_eq!(
            d.je_stelle,
            vec![ist(Some(FELDKUECHE), 100), ist(Some(TURNHALLE), 80)]
        );
        assert_eq!(d.ausgegeben.gesamt, 180);
        assert_eq!(d.fehlmenge.gesamt, 20);
    }

    /// Spec „Zeitfenster ohne Zuordnung“: Bestand ohne Stelle → Aufstellung leer.
    #[test]
    fn zeitfenster_ohne_zuordnung() {
        let d = rechne(
            &bedarf(200, 0, Sonderkost::default()),
            &[
                ausgabe(1, 100, Sonderkost::default(), false),
                ausgabe(2, 30, Sonderkost::default(), false),
            ],
            &[],
        );
        assert!(d.je_stelle.is_empty(), "{:?}", d.je_stelle);
        assert_eq!(d.ausgegeben.gesamt, 130);
    }

    /// Spec „Ausgaben ohne Stelle“: der Eintrag „ohne Stelle“ steht zuletzt.
    #[test]
    fn ohne_stelle_zuletzt() {
        let d = rechne(
            &bedarf(200, 0, Sonderkost::default()),
            &[
                ausgabe(1, 30, Sonderkost::default(), false),
                an(Some(FELDKUECHE), 2, 100, Sonderkost::default(), false),
            ],
            &[FELDKUECHE],
        );
        assert_eq!(d.je_stelle, vec![ist(Some(FELDKUECHE), 100), ist(None, 30)]);
    }

    /// Eine Stelle mit Ausgabe, der das Zeitfenster nicht zugeordnet ist, steht nach den
    /// zugeordneten, nach Kennung — auch ganz ohne Zuordnung.
    #[test]
    fn nicht_zugeordnete_stelle_mit_ausgabe() {
        let d = rechne(
            &bedarf(200, 0, Sonderkost::default()),
            &[
                an(Some(DEICH), 1, 20, Sonderkost::default(), false),
                an(Some(TURNHALLE), 2, 10, Sonderkost::default(), false),
                an(Some(FELDKUECHE), 3, 50, Sonderkost::default(), false),
                an(Some(DEICH), 4, 5, Sonderkost::default(), false),
            ],
            &[FELDKUECHE],
        );
        assert_eq!(
            d.je_stelle,
            vec![
                ist(Some(FELDKUECHE), 50),
                ist(Some(TURNHALLE), 10),
                ist(Some(DEICH), 25)
            ]
        );
        let ohne_zuordnung = rechne(
            &bedarf(200, 0, Sonderkost::default()),
            &[an(Some(DEICH), 1, 20, Sonderkost::default(), false)],
            &[],
        );
        assert_eq!(ohne_zuordnung.je_stelle, vec![ist(Some(DEICH), 20)]);
    }

    /// Jede zugeordnete Stelle steht da, auch mit 0, in der Reihenfolge der Zuordnung.
    #[test]
    fn zugeordnete_stelle_mit_null() {
        let d = rechne(
            &bedarf(200, 0, Sonderkost::default()),
            &[],
            &[TURNHALLE, FELDKUECHE],
        );
        assert_eq!(
            d.je_stelle,
            vec![ist(Some(TURNHALLE), 0), ist(Some(FELDKUECHE), 0)]
        );
    }

    /// Zurückgenommene Ausgaben zählen je Stelle nicht und machen eine Stelle nicht sichtbar;
    /// eine nur zurückgenommene Ausgabe ohne Stelle bringt kein „ohne Stelle“.
    #[test]
    fn zurueckgenommene_zaehlen_nicht_je_stelle() {
        let d = rechne(
            &bedarf(200, 0, Sonderkost::default()),
            &[
                an(Some(FELDKUECHE), 1, 100, Sonderkost::default(), true),
                an(Some(FELDKUECHE), 2, 40, Sonderkost::default(), false),
                an(Some(DEICH), 3, 20, Sonderkost::default(), true),
                ausgabe(4, 30, Sonderkost::default(), true),
            ],
            &[FELDKUECHE],
        );
        assert_eq!(d.je_stelle, vec![ist(Some(FELDKUECHE), 40)]);
        let nur_zurueck = rechne(
            &bedarf(200, 0, Sonderkost::default()),
            &[an(Some(DEICH), 1, 20, Sonderkost::default(), true)],
            &[],
        );
        assert!(nur_zurueck.je_stelle.is_empty());
    }

    /// Invariante: die Summe der Aufstellung ist `ausgegeben`, gesamt und je Kostform.
    #[test]
    fn summe_je_stelle_ist_ausgegeben() {
        let d = rechne(
            &bedarf(200, 0, vegan(10)),
            &[
                an(Some(FELDKUECHE), 1, 100, vegan(4), false),
                an(
                    Some(TURNHALLE),
                    2,
                    80,
                    Sonderkost {
                        vegetarisch: 3,
                        ..Sonderkost::default()
                    },
                    false,
                ),
                an(Some(DEICH), 3, 20, vegan(1), false),
                ausgabe(4, 30, vegan(2), false),
                an(Some(FELDKUECHE), 5, 50, vegan(50), true),
            ],
            &[FELDKUECHE, TURNHALLE],
        );
        assert_eq!(d.je_stelle.len(), 4);
        let summe = d
            .je_stelle
            .iter()
            .fold(Portionen::default(), |s, i| Portionen {
                gesamt: s.gesamt + i.ausgegeben.gesamt,
                sonderkost: s.sonderkost.plus(&i.ausgegeben.sonderkost),
            });
        assert_eq!(summe, d.ausgegeben);
        assert_eq!(d.je_stelle[0].ausgegeben.sonderkost, vegan(4));
    }
}
