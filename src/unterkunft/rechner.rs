//! Rechenkern Unterkunft und Zelte für die Rechner-API (LLH-1524, Spec `rechner-api-unterkunft`,
//! design.md D2).
//!
//! Reine Funktion [`rechne`]: geprüfte [`Eingabe`] und wirksame [`Richtwerte`] hinein, [`Ergebnis`]
//! heraus. Keine Datenbank, kein serde; die Wire-Form steht in `crate::public_api::rechner`.
//!
//! Der Kern bildet `frontend/src/betreuung/unterkunft/rechnerKern.ts` Zeile für Zeile nach. Beide
//! müssen für jeden Fall aus `tests/fixtures/unterkunft/faelle.json` dasselbe liefern; wer eine
//! Seite ändert, ändert die andere und die Fallsammlung mit (`frontend/src/betreuung/AGENTS.md`,
//! „Unterkunftsrechner“).
//!
//! Grundsatz: Bedarf wird aufgerundet, eine Kapazität aus Fläche abgerundet, gerundet wird erst am
//! Ende jeder Größe. Bei Räumen zählt jeder Raum einzeln (abgerundet, dann summiert); bei Trennung
//! nach Männern und Frauen wird je Gruppe gerechnet und summiert.

use std::collections::HashMap;

/// Höchstzahl der Räume einer Rechnung.
pub const RAEUME_MAX: usize = 200;
/// Höchstzahl der Abzüge eines Raums. Mit [`RAEUME_MAX`] so gewählt, dass die größte Anfrage in
/// üblicher Schreibweise in den Body der öffentlichen API passt (64 KiB,
/// `tests/rechner_api.rs`, `groesste_anfrage_passt_in_den_body`).
pub const ABZUEGE_MAX: usize = 5;
/// Größtes Maß eines Raums oder Abzugs in Metern; ein Maß ist größer als 0.
pub const MASS_MAX_M: f64 = 1000.0;
/// Größte Fläche einer Angabe in Quadratmetern (`MASS_MAX_M` im Quadrat).
pub const FLAECHE_MAX_M2: f64 = MASS_MAX_M * MASS_MAX_M;
/// Höchstzahl der Zelte je Typ und Gruppe.
pub const ZELTE_JE_TYP_MAX: u64 = 1000;
/// Höchstlänge der Bezeichnung eines Raums in Zeichen.
pub const BEZEICHNUNG_MAX: usize = 80;

/// Gruppe, für die gerechnet wird.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Gruppe {
    Gesamt,
    Maenner,
    Frauen,
}

/// Grundlage der Rechnung.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Weg {
    Personen,
    Raeume,
    Flaeche,
    Zelte,
}

/// Eine Angabe für alle zusammen oder je Gruppe.
#[derive(Debug, Clone, PartialEq)]
pub enum Aufteilung<T> {
    Gesamt(T),
    Getrennt { maenner: T, frauen: T },
}

impl<T> Aufteilung<T> {
    fn is_getrennt(&self) -> bool {
        matches!(self, Aufteilung::Getrennt { .. })
    }

    /// Wendet `f` auf jede Angabe an und liefert die Zahl je Gruppe.
    fn je_gruppe(&self, f: impl Fn(&T) -> f64) -> Vec<(Gruppe, f64)> {
        match self {
            Aufteilung::Gesamt(g) => vec![(Gruppe::Gesamt, f(g))],
            Aufteilung::Getrennt { maenner, frauen } => {
                vec![(Gruppe::Maenner, f(maenner)), (Gruppe::Frauen, f(frauen))]
            }
        }
    }
}

/// Abzug von der Fläche eines Raums (Bühne, Fluchtweg).
#[derive(Debug, Clone, PartialEq)]
pub struct Abzug {
    pub laenge_m: f64,
    pub breite_m: f64,
}

/// Ein Raum mit seinen Abzügen.
#[derive(Debug, Clone, PartialEq)]
pub struct Raum {
    pub bezeichnung: String,
    pub laenge_m: f64,
    pub breite_m: f64,
    pub abzuege: Vec<Abzug>,
    /// Bei Trennung die Gruppe, die den Raum belegt, sonst [`Gruppe::Gesamt`]. Die Prüfung an der
    /// Route stellt das sicher; ein Raum einer Gruppe, die nicht gerechnet wird, zählt nicht.
    pub gruppe: Gruppe,
}

/// Zeltbestand: Anzahl je Zelttyp. Ein Typ ohne Eintrag zählt 0.
pub type Zeltbestand = HashMap<String, u64>;

/// Geprüfte Eingabe. Was hier steht, liegt in den Grenzen und passt zusammen.
#[derive(Debug, Clone, PartialEq)]
pub enum Eingabe {
    Personen(Aufteilung<u64>),
    /// Fläche in Quadratmetern.
    Flaeche(Aufteilung<f64>),
    Raeume {
        getrennt: bool,
        raeume: Vec<Raum>,
    },
    Zelte(Aufteilung<Zeltbestand>),
}

impl Eingabe {
    pub fn weg(&self) -> Weg {
        match self {
            Eingabe::Personen(_) => Weg::Personen,
            Eingabe::Flaeche(_) => Weg::Flaeche,
            Eingabe::Raeume { .. } => Weg::Raeume,
            Eingabe::Zelte(_) => Weg::Zelte,
        }
    }

    pub fn is_getrennt(&self) -> bool {
        match self {
            Eingabe::Personen(a) => a.is_getrennt(),
            Eingabe::Flaeche(a) => a.is_getrennt(),
            Eingabe::Raeume { getrennt, .. } => *getrennt,
            Eingabe::Zelte(a) => a.is_getrennt(),
        }
    }
}

/// Wirksame Richtwerte, Schlüssel → Wert. Entsteht immer aus der vollständigen Basis; darüber
/// liegen die Ebenen des Aufrufers.
#[derive(Debug, Clone, PartialEq)]
pub struct Richtwerte(HashMap<&'static str, f64>);

impl Richtwerte {
    /// Die Basis ohne Ebene darüber.
    pub fn basis() -> Self {
        Richtwerte(
            super::basis()
                .iter()
                .map(|b| (b.schluessel.as_str(), b.wert))
                .collect(),
        )
    }

    /// Legt einen Wert über die Basis. Ein Schlüssel, den die Basis nicht kennt, fällt weg
    /// (`false`); Grenzen prüft der Aufrufer vorher (`super::pruefe`).
    pub fn setzen(&mut self, schluessel: &str, wert: f64) -> bool {
        match super::basiswert(schluessel) {
            Some(b) => {
                self.0.insert(b.schluessel.as_str(), wert);
                true
            }
            None => false,
        }
    }

    /// Der wirksame Wert eines Schlüssels.
    pub fn wert(&self, schluessel: &str) -> Option<f64> {
        self.0.get(schluessel).copied()
    }

    /// Wert für die Rechnung. Ein fehlender Schlüssel ist ein Programmfehler (der Kern liest einen
    /// Schlüssel, den die Basis nicht hat), nie eine stille 0.
    fn w(&self, schluessel: &str) -> f64 {
        self.wert(schluessel)
            .unwrap_or_else(|| panic!("Richtwert fehlt: {schluessel}"))
    }
}

/// Anzahl je Zelttyp.
#[derive(Debug, Clone, PartialEq)]
pub struct TypAnzahl {
    pub typ: &'static str,
    pub anzahl: u64,
}

/// Ein Raum im Ergebnis.
#[derive(Debug, Clone, PartialEq)]
pub struct RaumErgebnis {
    pub bezeichnung: String,
    pub nutzflaeche_m2: f64,
    pub plaetze: u64,
    pub gruppe: Gruppe,
}

/// Kapazität aus Räumen, Fläche oder Zelten.
#[derive(Debug, Clone, PartialEq)]
pub struct Kapazitaet {
    pub plaetze: u64,
    /// Nur beim Weg Räume.
    pub raeume: Option<Vec<RaumErgebnis>>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Schlafen {
    pub flaeche_m2: f64,
    pub zelte_je_typ: Vec<TypAnzahl>,
    pub zeltmix: Vec<TypAnzahl>,
    pub zeltmix_grundflaeche_m2: f64,
    pub zeltmix_platzbedarf_m2: u64,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Material {
    pub feldbetten: u64,
    pub decken: u64,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Sanitaer {
    pub toiletten: u64,
    pub urinale: u64,
    pub waschplaetze: u64,
    pub duschen: u64,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Gesundheit {
    pub betten: u64,
    pub flaeche_m2: f64,
    pub isolierstation: bool,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Versorgung {
    pub wasser_l_tag: u64,
    pub davon_trinkwasser_l_tag: u64,
    pub faekalien_l_tag: f64,
    pub abfall_l_tag: u64,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Verpflegung {
    pub ausgabestellen: u64,
    pub sitzplaetze: u64,
    pub garnituren: u64,
    pub aufenthaltszelte_je_typ: Vec<TypAnzahl>,
}

/// Ergebnis einer Rechnung, in der Gliederung des Felds `erwartet` der Fallsammlung.
#[derive(Debug, Clone, PartialEq)]
pub struct Ergebnis {
    pub weg: Weg,
    pub trennung: bool,
    pub personen: u64,
    pub gruppen: Vec<(Gruppe, u64)>,
    /// Beim Weg Personen `None`.
    pub kapazitaet: Option<Kapazitaet>,
    pub schlafen: Schlafen,
    pub material: Material,
    pub sanitaer: Sanitaer,
    pub gesundheit: Gesundheit,
    pub versorgung: Versorgung,
    pub verpflegung: Verpflegung,
}

/// Glättet Gleitkomma-Reste (3,0000000004) vor dem Runden. Alle Größen sind nicht negativ, damit
/// runden `f64::round` und `Math.round` des TS-Kerns gleich. Das `+ 0.0` macht aus einer
/// negativen Null die positive: eine leere `f64`-Summe ist in Rust `-0.0`, der TS-Kern summiert
/// ab `0`, und `-0.0` stünde so in der Antwort.
fn glatt(x: f64) -> f64 {
    (x * 1e6).round() / 1e6 + 0.0
}

fn auf(x: f64) -> f64 {
    glatt(x).ceil()
}

fn ab(x: f64) -> f64 {
    glatt(x).floor()
}

fn eine_stelle(x: f64) -> f64 {
    (glatt(x) * 10.0).round() / 10.0
}

fn zwei_stellen(x: f64) -> f64 {
    (glatt(x) * 100.0).round() / 100.0
}

fn ganz(x: f64) -> f64 {
    glatt(x).round()
}

/// Ganze, nicht negative Zahl der Rechnung als Stückzahl.
fn stueck(x: f64) -> u64 {
    x as u64
}

/// Ein Zelttyp mit seinen wirksamen Richtwerten.
#[derive(Debug, Clone)]
pub struct Zelt {
    pub typ: &'static str,
    pub schlafplaetze: f64,
    pub garnituren: f64,
    pub laenge_m: f64,
    pub breite_m: f64,
}

/// Die Zelttypen der Basis mit den wirksamen Werten, in der Reihenfolge der Basis.
pub fn zelte(rw: &Richtwerte) -> Vec<Zelt> {
    super::zelttypen()
        .iter()
        .map(|z| {
            let typ = z.typ.as_str();
            Zelt {
                typ,
                schlafplaetze: rw.w(&format!("zelt_{typ}_schlafplaetze")),
                garnituren: rw.w(&format!("zelt_{typ}_garnituren")),
                laenge_m: rw.w(&format!("zelt_{typ}_laenge_m")),
                breite_m: rw.w(&format!("zelt_{typ}_breite_m")),
            }
        })
        .collect()
}

/// Nutzfläche eines Raums: Länge × Breite abzüglich der Abzüge, nie negativ, zwei Stellen.
pub fn nutzflaeche(raum: &Raum) -> f64 {
    let mut f = raum.laenge_m * raum.breite_m;
    for a in &raum.abzuege {
        f -= a.laenge_m * a.breite_m;
    }
    // `f64::max` lässt bei gemischten Nullen das Vorzeichen offen.
    zwei_stellen(f).max(0.0) + 0.0
}

/// Zeltmix für `n` Personen: so wenige Zelte wie möglich, das größte zuerst, der Rest ins
/// kleinste Zelt, das ihn fasst. Ausgabe in der Reihenfolge von `typen`.
pub fn zeltmix(n: f64, typen: &[Zelt]) -> Vec<TypAnzahl> {
    if n <= 0.0 || typen.is_empty() {
        return Vec::new();
    }
    let mut absteigend: Vec<&Zelt> = typen.iter().collect();
    // Stabil wie `Array.prototype.sort`: gleich große Zelte behalten ihre Reihenfolge.
    absteigend.sort_by(|a, b| b.schlafplaetze.total_cmp(&a.schlafplaetze));
    let groesstes = absteigend[0];
    let volle = (n / groesstes.schlafplaetze).floor();
    let rest = n - volle * groesstes.schlafplaetze;
    let mut mix: HashMap<&'static str, u64> = HashMap::new();
    if volle > 0.0 {
        mix.insert(groesstes.typ, stueck(volle));
    }
    if rest > 0.0 {
        let passend = absteigend
            .iter()
            .rev()
            .find(|t| t.schlafplaetze >= rest)
            .copied()
            .unwrap_or(groesstes);
        *mix.entry(passend.typ).or_insert(0) += 1;
    }
    typen
        .iter()
        .filter_map(|t| {
            mix.get(t.typ).map(|anzahl| TypAnzahl {
                typ: t.typ,
                anzahl: *anzahl,
            })
        })
        .collect()
}

/// Personen je Gruppe aus der Grundlage, dazu beim Weg Räume die Räume einzeln.
fn gruppen_aus(
    eingabe: &Eingabe,
    rw: &Richtwerte,
    typen: &[Zelt],
) -> (Vec<(Gruppe, f64)>, Option<Vec<RaumErgebnis>>) {
    let m2 = rw.w("flaeche_je_person_m2");
    match eingabe {
        Eingabe::Personen(a) => (a.je_gruppe(|p| *p as f64), None),
        Eingabe::Flaeche(a) => (a.je_gruppe(|f| ab(f / m2)), None),
        Eingabe::Zelte(a) => {
            let bestand = |b: &Zeltbestand| {
                typen
                    .iter()
                    .map(|t| b.get(t.typ).copied().unwrap_or(0) as f64 * t.schlafplaetze)
                    .sum::<f64>()
            };
            (a.je_gruppe(bestand), None)
        }
        Eingabe::Raeume { getrennt, raeume } => {
            let mut gruppen: Vec<(Gruppe, f64)> = if *getrennt {
                vec![(Gruppe::Maenner, 0.0), (Gruppe::Frauen, 0.0)]
            } else {
                vec![(Gruppe::Gesamt, 0.0)]
            };
            let ergebnis = raeume
                .iter()
                .map(|r| {
                    let nutz = nutzflaeche(r);
                    let plaetze = ab(nutz / m2);
                    if let Some(g) = gruppen.iter_mut().find(|(g, _)| *g == r.gruppe) {
                        g.1 += plaetze;
                    }
                    RaumErgebnis {
                        bezeichnung: r.bezeichnung.clone(),
                        nutzflaeche_m2: nutz,
                        plaetze: stueck(plaetze),
                        gruppe: r.gruppe,
                    }
                })
                .collect();
            (gruppen, Some(ergebnis))
        }
    }
}

/// Rechnet eine Unterkunft durch.
pub fn rechne(eingabe: &Eingabe, rw: &Richtwerte) -> Ergebnis {
    let typen = zelte(rw);
    let (gruppen, raeume) = gruppen_aus(eingabe, rw, &typen);
    let n: f64 = gruppen.iter().map(|(_, p)| p).sum();
    let getrennt = eingabe.is_getrennt();

    // Summe über die Gruppen mit Personen; jede Gruppe für sich aufgerundet.
    let je_gruppe = |f: &dyn Fn(Gruppe, f64) -> f64| -> f64 {
        gruppen
            .iter()
            .map(|(g, p)| if *p > 0.0 { f(*g, *p) } else { 0.0 })
            .sum()
    };
    let toilette_je = |g: Gruppe| {
        rw.w(match g {
            Gruppe::Maenner => "toilette_je_personen_maenner",
            Gruppe::Frauen => "toilette_je_personen_frauen",
            Gruppe::Gesamt => "toilette_je_personen_gemischt",
        })
    };

    let zelte_je_typ = typen
        .iter()
        .map(|t| TypAnzahl {
            typ: t.typ,
            anzahl: stueck(je_gruppe(&|_, p| auf(p / t.schlafplaetze))),
        })
        .collect();
    let mut mix_summe: HashMap<&'static str, u64> = HashMap::new();
    for (_, p) in &gruppen {
        for e in zeltmix(*p, &typen) {
            *mix_summe.entry(e.typ).or_insert(0) += e.anzahl;
        }
    }
    let mix: Vec<(&Zelt, u64)> = typen
        .iter()
        .filter_map(|t| mix_summe.get(t.typ).map(|anzahl| (t, *anzahl)))
        .collect();
    let abstand = rw.w("zelt_abstand_m");
    let grund: f64 = mix
        .iter()
        .map(|(t, anzahl)| *anzahl as f64 * t.laenge_m * t.breite_m)
        .sum();
    let platz: f64 = mix
        .iter()
        .map(|(t, anzahl)| *anzahl as f64 * (t.laenge_m + abstand) * (t.breite_m + abstand))
        .sum();

    let maenner = gruppen
        .iter()
        .find(|(g, _)| *g == Gruppe::Maenner)
        .map_or(0.0, |(_, p)| *p);
    let urinale = if getrennt {
        auf(maenner / rw.w("urinal_je_maenner"))
    } else {
        auf((n * rw.w("maenneranteil_ohne_trennung_prozent")) / 100.0 / rw.w("urinal_je_maenner"))
    };

    let betten = if n > 0.0 {
        auf(n / rw.w("krankenbett_je_personen")) + rw.w("krankenbett_zuschlag")
    } else {
        0.0
    };
    let sitzplaetze = auf(n / rw.w("personen_je_sitzplatz"));
    let garnituren = auf(sitzplaetze / rw.w("plaetze_je_garnitur"));

    Ergebnis {
        weg: eingabe.weg(),
        trennung: getrennt,
        personen: stueck(n),
        gruppen: gruppen.iter().map(|(g, p)| (*g, stueck(*p))).collect(),
        kapazitaet: match eingabe {
            Eingabe::Personen(_) => None,
            _ => Some(Kapazitaet {
                plaetze: stueck(n),
                raeume,
            }),
        },
        schlafen: Schlafen {
            flaeche_m2: eine_stelle(n * rw.w("flaeche_je_person_m2")),
            zelte_je_typ,
            zeltmix: mix
                .iter()
                .map(|(t, anzahl)| TypAnzahl {
                    typ: t.typ,
                    anzahl: *anzahl,
                })
                .collect(),
            zeltmix_grundflaeche_m2: eine_stelle(grund),
            zeltmix_platzbedarf_m2: stueck(ganz(platz)),
        },
        material: Material {
            feldbetten: stueck(auf(n * rw.w("feldbett_je_person"))),
            decken: stueck(auf(n * rw.w("decken_je_person"))),
        },
        sanitaer: Sanitaer {
            toiletten: stueck(je_gruppe(&|g, p| auf(p / toilette_je(g)))),
            urinale: stueck(urinale),
            waschplaetze: stueck(je_gruppe(&|_, p| auf(p / rw.w("waschplatz_je_personen")))),
            duschen: stueck(je_gruppe(&|_, p| auf(p / rw.w("dusche_je_personen")))),
        },
        gesundheit: Gesundheit {
            betten: stueck(betten),
            flaeche_m2: eine_stelle(betten * rw.w("krankenflaeche_je_bett_m2")),
            isolierstation: n >= rw.w("isolierstation_ab_personen"),
        },
        versorgung: Versorgung {
            wasser_l_tag: stueck(ganz(n * rw.w("wasser_je_person_l"))),
            davon_trinkwasser_l_tag: stueck(ganz(n * rw.w("trinkwasser_je_person_l"))),
            faekalien_l_tag: eine_stelle(n * rw.w("faekalien_je_person_l")),
            abfall_l_tag: stueck(ganz(n * rw.w("abfall_je_person_l"))),
        },
        verpflegung: Verpflegung {
            ausgabestellen: if n == 0.0 {
                0
            } else if n >= rw.w("zweite_ausgabestelle_ab_personen") {
                2
            } else {
                1
            },
            sitzplaetze: stueck(sitzplaetze),
            garnituren: stueck(garnituren),
            aufenthaltszelte_je_typ: typen
                .iter()
                .map(|t| TypAnzahl {
                    typ: t.typ,
                    anzahl: stueck(auf(garnituren / t.garnituren)),
                })
                .collect(),
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn raum(laenge_m: f64, breite_m: f64, abzuege: &[(f64, f64)]) -> Raum {
        Raum {
            bezeichnung: String::new(),
            laenge_m,
            breite_m,
            abzuege: abzuege
                .iter()
                .map(|(l, b)| Abzug {
                    laenge_m: *l,
                    breite_m: *b,
                })
                .collect(),
            gruppe: Gruppe::Gesamt,
        }
    }

    #[test]
    fn nutzflaeche_ist_nie_negativ_und_hat_zwei_stellen() {
        assert_eq!(nutzflaeche(&raum(2.0, 2.0, &[(3.0, 3.0)])), 0.0);
        assert_eq!(nutzflaeche(&raum(15.0, 13.5, &[(4.0, 2.5)])), 192.5);
        // 0,3 × 40 ist als Gleitkommazahl 12,000000000000002.
        assert_eq!(nutzflaeche(&raum(0.3, 40.0, &[])), 12.0);
        assert_eq!(nutzflaeche(&raum(1.234, 1.0, &[])), 1.23);
    }

    #[test]
    fn zeltmix_nimmt_das_groesste_zuerst_und_den_rest_ins_kleinste_passende() {
        let typen = zelte(&Richtwerte::basis());
        let mix = |n: f64| -> Vec<(&str, u64)> {
            zeltmix(n, &typen)
                .into_iter()
                .map(|e| (e.typ, e.anzahl))
                .collect()
        };
        assert_eq!(mix(0.0), []);
        // 15 = 1 × SG 50 (14) + Rest 1 ins SG 20.
        assert_eq!(mix(15.0), [("sg20", 1), ("sg50", 1)]);
        // 50 = 3 × SG 50 (42) + Rest 8 ins SG 30 (10).
        assert_eq!(mix(50.0), [("sg30", 1), ("sg50", 3)]);
        // Rest 13 passt nur ins größte: ein viertes SG 50.
        assert_eq!(mix(55.0), [("sg50", 4)]);
    }

    #[test]
    fn fuenfzig_maenner_und_fuenfzig_frauen_mit_den_basiswerten() {
        let e = rechne(
            &Eingabe::Personen(Aufteilung::Getrennt {
                maenner: 50,
                frauen: 50,
            }),
            &Richtwerte::basis(),
        );
        assert_eq!(e.personen, 100);
        assert_eq!(e.kapazitaet, None);
        assert_eq!(e.schlafen.flaeche_m2, 400.0);
        assert_eq!(e.material.feldbetten, 100);
        assert_eq!(
            e.sanitaer,
            Sanitaer {
                toiletten: 6,
                urinale: 4,
                waschplaetze: 20,
                duschen: 6
            }
        );
        assert_eq!(e.versorgung.wasser_l_tag, 2500);
    }

    #[test]
    fn zwei_raeume_mit_abzug_ergeben_48_und_22_plaetze() {
        let e = rechne(
            &Eingabe::Raeume {
                getrennt: false,
                raeume: vec![
                    raum(15.0, 13.5, &[(4.0, 2.5)]),
                    raum(12.0, 8.0, &[(3.0, 2.0)]),
                ],
            },
            &Richtwerte::basis(),
        );
        let kapazitaet = e.kapazitaet.expect("Kapazität beim Weg Räume");
        let plaetze: Vec<u64> = kapazitaet
            .raeume
            .expect("Räume einzeln")
            .iter()
            .map(|r| r.plaetze)
            .collect();
        assert_eq!(plaetze, [48, 22]);
        assert_eq!(kapazitaet.plaetze, 70);
    }

    #[test]
    fn ein_wert_ueber_der_basis_wirkt_und_ein_unbekannter_faellt_weg() {
        let mut rw = Richtwerte::basis();
        assert!(rw.setzen("wasser_je_person_l", 15.0));
        assert!(!rw.setzen("foo", 1.0));
        assert_eq!(rw.wert("foo"), None);
        let e = rechne(&Eingabe::Personen(Aufteilung::Gesamt(100)), &rw);
        assert_eq!(e.versorgung.wasser_l_tag, 1500);
    }

    /// Gegenstück zu `frontend/src/betreuung/unterkunft/richtwerte.guard.test.ts`: jeder Schlüssel
    /// der Basis wird im Kern gelesen. Ein Richtwert, den nur eine Seite rechnet, fiele sonst erst
    /// an einem Fall auf, den die Fallsammlung nicht kennt.
    #[test]
    fn der_kern_liest_jeden_schluessel_der_basis() {
        // Nur der Kern, nicht diese Tests: ein Schlüssel in einem Test zählt nicht als gelesen.
        let quelle = include_str!("rechner.rs")
            .split("#[cfg(test)]")
            .next()
            .expect("Quelltext vor den Tests");
        let zelt_muster: Vec<String> = crate::unterkunft::zelttypen()
            .iter()
            .map(|z| format!("zelt_{}_", z.typ))
            .collect();
        for b in crate::unterkunft::basis() {
            let gelesen = match zelt_muster
                .iter()
                .find(|muster| b.schluessel.starts_with(muster.as_str()))
            {
                // Zeltschlüssel entstehen aus dem Muster `zelt_{typ}_<rest>`.
                Some(muster) => {
                    let rest = &b.schluessel[muster.len()..];
                    quelle.contains(&format!("zelt_{{typ}}_{rest}\""))
                }
                None => quelle.contains(&format!("\"{}\"", b.schluessel)),
            };
            assert!(gelesen, "Der Kern liest {} nicht", b.schluessel);
        }
    }
}
