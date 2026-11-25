//! Abgleich einer Stammdatenzeile mit dem Bestand (LLH-1633): rein, ohne Datenbank.
//! Stufen in fester Reihenfolge; mehr als ein Treffer auf einer Stufe ist mehrdeutig und stoppt.

use std::collections::HashMap;

use serde::Serialize;
use utoipa::ToSchema;

use super::{FahrzeugAngabe, Herkunftsangabe, PersonalAngabe, StammdatenArt, StammdatenPaket};
use crate::einlesen::namen::{herkunft_norm, name_passt, namensformen, norm, telefon_norm};
use crate::wire_enum::wire_enum;

/// Kennungen eines Datensatzes: `(herkunft_norm, kennung)`.
pub type Kennungen = Vec<(String, String)>;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BestandFahrzeug {
    pub id: i64,
    pub funkrufname: String,
    pub kennzeichen: Option<String>,
    pub opta: Option<String>,
    pub fms_issi: Option<String>,
    pub fahrzeugtyp: Option<String>,
    pub standort: Option<String>,
    pub in_dienst: bool,
    pub kennungen: Kennungen,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BestandPersonal {
    pub id: i64,
    pub name: String,
    pub personalnummer: Option<String>,
    pub telefon: Option<String>,
    pub traegerorganisation: Option<String>,
    pub in_dienst: bool,
    pub qualifikation_ids: Vec<i64>,
    pub kennungen: Kennungen,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BestandQualifikation {
    pub id: i64,
    pub label: String,
    pub aktiv: bool,
    pub kennungen: Kennungen,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Bestand {
    pub fahrzeuge: Vec<BestandFahrzeug>,
    pub personal: Vec<BestandPersonal>,
    pub qualifikationen: Vec<BestandQualifikation>,
    /// Jede `(Art, herkunft, kennung)` der Org in `stammdaten_kennung`, auch eine, deren Ziel
    /// nicht zur Org gehört: sie trifft nie, belegt aber den Unique-Schlüssel.
    pub belegte_kennungen: Vec<(StammdatenArt, String, String)>,
}

wire_enum! {
    /// Über welche Stufe eine Zeile einen Datensatz getroffen hat.
    #[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]
    #[schema(as = StammdatenTrefferGrund)]
    pub enum TrefferGrund {
        Kennung => "kennung",
        Opta => "opta",
        Issi => "issi",
        Funkrufname => "funkrufname",
        Personalnummer => "personalnummer",
        Name => "name",
        Bezeichnung => "bezeichnung",
    }
    try_from = |s| format!("Ungültiger Treffergrund: {s}");
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Zuordnung {
    Neu,
    Gefunden {
        id: i64,
        grund: TrefferGrund,
    },
    Mehrdeutig {
        kandidaten: Vec<i64>,
        hinweis: Option<String>,
    },
    AusserDienst {
        id: i64,
    },
    Fehler(String),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AenderungsArt {
    /// Das Feld ist im Bestand leer, die Datei füllt es.
    Fuellt,
    /// Das Feld ist gefüllt, die Datei nennt einen anderen Wert.
    WeichtAb,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FeldAenderung {
    pub feld: &'static str,
    pub alt: Option<String>,
    pub neu: String,
    pub art: AenderungsArt,
    pub erkennungsfeld: bool,
}

/// Leerzeichen raus, klein: für OPTA, ISSI, Personalnummer.
pub fn erkennungswert_norm(s: &str) -> String {
    s.split_whitespace().collect::<String>().to_lowercase()
}

/// `(Nachname, Vorname)`: mit Komma „Nachname, Vorname“, sonst das letzte Wort als Nachname.
pub fn name_teilen(name: &str) -> (String, Option<String>) {
    let name = name.trim();
    if let Some((nach, vor)) = name.split_once(',') {
        let vor = vor.trim();
        return (
            nach.trim().to_string(),
            (!vor.is_empty()).then(|| vor.to_string()),
        );
    }
    match name.rsplit_once(char::is_whitespace) {
        Some((vor, nach)) => {
            let vor = vor.trim();
            (
                nach.trim().to_string(),
                (!vor.is_empty()).then(|| vor.to_string()),
            )
        }
        None => (name.to_string(), None),
    }
}

fn nicht_leer(s: &Option<String>) -> Option<&str> {
    s.as_deref().map(str::trim).filter(|s| !s.is_empty())
}

fn kennung_der(q: &Herkunftsangabe) -> Option<String> {
    nicht_leer(&q.kennung).map(norm)
}

fn traegt(kennungen: &Kennungen, herkunft: &str, kennung: &str) -> bool {
    kennungen
        .iter()
        .any(|(h, k)| h == herkunft && norm(k) == kennung)
}

/// Ziel trägt für dieselbe Herkunft schon eine andere Kennung?
fn andere_kennung(kennungen: &Kennungen, herkunft: &str, kennung: &str) -> bool {
    kennungen
        .iter()
        .any(|(h, k)| h == herkunft && norm(k) != kennung)
}

/// Ergebnis einer Stufe aus den Treffer-Ids; `None` = kein Treffer, weiter zur nächsten Stufe.
fn stufe(
    treffer: Vec<(i64, &Kennungen)>,
    grund: TrefferGrund,
    herkunft: &str,
    kennung: Option<&str>,
) -> Option<Zuordnung> {
    match treffer.as_slice() {
        [] => None,
        [(id, k)] => {
            if let Some(kn) = kennung {
                if andere_kennung(k, herkunft, kn) {
                    return Some(Zuordnung::Mehrdeutig {
                        kandidaten: vec![*id],
                        hinweis: Some(
                            "Der Datensatz trägt für diese Herkunft schon eine andere Kennung."
                                .to_string(),
                        ),
                    });
                }
            }
            Some(Zuordnung::Gefunden { id: *id, grund })
        }
        _ => Some(Zuordnung::Mehrdeutig {
            kandidaten: treffer.iter().map(|(i, _)| *i).collect(),
            hinweis: None,
        }),
    }
}

fn kennungsstufe(treffer: Vec<(i64, bool)>) -> Option<Zuordnung> {
    match treffer.as_slice() {
        [] => None,
        [(id, true)] => Some(Zuordnung::Gefunden {
            id: *id,
            grund: TrefferGrund::Kennung,
        }),
        [(id, false)] => Some(Zuordnung::AusserDienst { id: *id }),
        _ => Some(Zuordnung::Mehrdeutig {
            kandidaten: treffer.iter().map(|(i, _)| *i).collect(),
            hinweis: None,
        }),
    }
}

/// `herkunft`: wirksame, schon normalisierte Herkunft der Zeile.
pub fn fahrzeug_zuordnen(b: &Bestand, herkunft: &str, a: &FahrzeugAngabe) -> Zuordnung {
    let kennung = kennung_der(&a.quelle);
    if let Some(kn) = &kennung {
        let t = b
            .fahrzeuge
            .iter()
            .filter(|f| traegt(&f.kennungen, herkunft, kn))
            .map(|f| (f.id, f.in_dienst))
            .collect();
        if let Some(z) = kennungsstufe(t) {
            return z;
        }
    }
    let kn = kennung.as_deref();
    let aktiv = || b.fahrzeuge.iter().filter(|f| f.in_dienst);
    let nach = |wert: Option<&str>, f: fn(&BestandFahrzeug) -> Option<&str>, g| {
        let w = erkennungswert_norm(wert?);
        if w.is_empty() {
            return None;
        }
        let t = aktiv()
            .filter(|x| f(x).is_some_and(|v| erkennungswert_norm(v) == w))
            .map(|x| (x.id, &x.kennungen))
            .collect();
        stufe(t, g, herkunft, kn)
    };
    if let Some(z) = nach(
        nicht_leer(&a.opta),
        |f| f.opta.as_deref(),
        TrefferGrund::Opta,
    ) {
        return z;
    }
    if let Some(z) = nach(
        nicht_leer(&a.issi),
        |f| f.fms_issi.as_deref(),
        TrefferGrund::Issi,
    ) {
        return z;
    }
    let fk = norm(&a.funkrufname);
    if !fk.is_empty() {
        let t = aktiv()
            .filter(|f| norm(&f.funkrufname) == fk)
            .map(|f| (f.id, &f.kennungen))
            .collect();
        if let Some(z) = stufe(t, TrefferGrund::Funkrufname, herkunft, kn) {
            return z;
        }
    }
    Zuordnung::Neu
}

pub fn personal_zuordnen(b: &Bestand, herkunft: &str, a: &PersonalAngabe) -> Zuordnung {
    let kennung = kennung_der(&a.quelle);
    if let Some(kn) = &kennung {
        let t = b
            .personal
            .iter()
            .filter(|p| traegt(&p.kennungen, herkunft, kn))
            .map(|p| (p.id, p.in_dienst))
            .collect();
        if let Some(z) = kennungsstufe(t) {
            return z;
        }
    }
    let kn = kennung.as_deref();
    let aktiv = || b.personal.iter().filter(|p| p.in_dienst);
    if let Some(pn) = nicht_leer(&a.personalnummer).map(erkennungswert_norm) {
        let t = aktiv()
            .filter(|p| {
                p.personalnummer
                    .as_deref()
                    .is_some_and(|v| erkennungswert_norm(v) == pn)
            })
            .map(|p| (p.id, &p.kennungen))
            .collect();
        if let Some(z) = stufe(t, TrefferGrund::Personalnummer, herkunft, kn) {
            return z;
        }
    }
    if !a.name.trim().is_empty() {
        let (nach, vor) = name_teilen(&a.name);
        let formen = namensformen(&nach, vor.as_deref());
        let t = aktiv()
            .filter(|p| name_passt(&p.name, &formen))
            .map(|p| (p.id, &p.kennungen))
            .collect();
        if let Some(z) = stufe(t, TrefferGrund::Name, herkunft, kn) {
            return z;
        }
    }
    Zuordnung::Neu
}

/// Kennung = normalisierter Text, dann normalisierte Bezeichnung; aktive und inaktive.
pub fn qualifikation_zuordnen(b: &Bestand, herkunft: &str, text: &str) -> Zuordnung {
    let n = norm(text);
    if n.is_empty() {
        return Zuordnung::Fehler("Bezeichnung fehlt".to_string());
    }
    let mehr = |ids: Vec<i64>, grund| match ids.as_slice() {
        [] => None,
        [id] => Some(Zuordnung::Gefunden { id: *id, grund }),
        _ => Some(Zuordnung::Mehrdeutig {
            kandidaten: ids,
            hinweis: None,
        }),
    };
    let t = b
        .qualifikationen
        .iter()
        .filter(|q| traegt(&q.kennungen, herkunft, &n))
        .map(|q| q.id)
        .collect();
    if let Some(z) = mehr(t, TrefferGrund::Kennung) {
        return z;
    }
    let t = b
        .qualifikationen
        .iter()
        .filter(|q| norm(&q.label) == n)
        .map(|q| q.id)
        .collect();
    mehr(t, TrefferGrund::Bezeichnung).unwrap_or(Zuordnung::Neu)
}

fn aenderung(
    feld: &'static str,
    alt: Option<&str>,
    neu: &Option<String>,
    gleich: impl Fn(&str, &str) -> bool,
    erkennungsfeld: bool,
) -> Option<FeldAenderung> {
    let neu = nicht_leer(neu)?;
    let alt_t = alt.map(str::trim).filter(|s| !s.is_empty());
    let art = match alt_t {
        None => AenderungsArt::Fuellt,
        Some(a) if gleich(a, neu) => return None,
        Some(_) => AenderungsArt::WeichtAb,
    };
    Some(FeldAenderung {
        feld,
        alt: alt_t.map(str::to_string),
        neu: neu.to_string(),
        art,
        erkennungsfeld,
    })
}

fn gleich_getrimmt(a: &str, b: &str) -> bool {
    a.trim() == b.trim()
}

pub fn fahrzeug_aenderungen(bestand: &BestandFahrzeug, a: &FahrzeugAngabe) -> Vec<FeldAenderung> {
    let fk = Some(a.funkrufname.clone());
    [
        aenderung(
            "funkrufname",
            Some(&bestand.funkrufname),
            &fk,
            |x, y| norm(x) == norm(y),
            true,
        ),
        aenderung(
            "kennzeichen",
            bestand.kennzeichen.as_deref(),
            &a.kennzeichen,
            gleich_getrimmt,
            false,
        ),
        aenderung(
            "opta",
            bestand.opta.as_deref(),
            &a.opta,
            |x, y| erkennungswert_norm(x) == erkennungswert_norm(y),
            true,
        ),
        aenderung(
            "fms_issi",
            bestand.fms_issi.as_deref(),
            &a.issi,
            |x, y| erkennungswert_norm(x) == erkennungswert_norm(y),
            true,
        ),
        aenderung(
            "fahrzeugtyp",
            bestand.fahrzeugtyp.as_deref(),
            &a.typ,
            gleich_getrimmt,
            false,
        ),
        aenderung(
            "standort",
            bestand.standort.as_deref(),
            &a.standort,
            gleich_getrimmt,
            false,
        ),
    ]
    .into_iter()
    .flatten()
    .collect()
}

pub fn personal_aenderungen(bestand: &BestandPersonal, a: &PersonalAngabe) -> Vec<FeldAenderung> {
    let name = Some(a.name.clone());
    [
        aenderung(
            "name",
            Some(&bestand.name),
            &name,
            |x, y| {
                let (n, v) = name_teilen(y);
                name_passt(x, &namensformen(&n, v.as_deref()))
            },
            true,
        ),
        aenderung(
            "personalnummer",
            bestand.personalnummer.as_deref(),
            &a.personalnummer,
            |x, y| erkennungswert_norm(x) == erkennungswert_norm(y),
            true,
        ),
        aenderung(
            "telefon",
            bestand.telefon.as_deref(),
            &a.telefon,
            |x, y| telefon_norm(x) == telefon_norm(y),
            false,
        ),
        aenderung(
            "traegerorganisation",
            bestand.traegerorganisation.as_deref(),
            &a.traegerorganisation,
            gleich_getrimmt,
            false,
        ),
    ]
    .into_iter()
    .flatten()
    .collect()
}

/// Zeilen, deren Herkunft+Kennung in der Datei mehrfach vorkommt (alle beteiligten Zeilen).
pub fn dubletten_in_datei(
    p: &StammdatenPaket,
    herkunft_default: &str,
) -> Vec<(StammdatenArt, u32)> {
    fn sammle(
        art: StammdatenArt,
        zeilen: impl Iterator<Item = (u32, Herkunftsangabe)>,
        default: &str,
        aus: &mut Vec<(StammdatenArt, u32)>,
    ) {
        let alle: Vec<(u32, Option<(String, String)>)> = zeilen
            .map(|(z, q)| {
                let k = kennung_der(&q).map(|k| {
                    let h = match nicht_leer(&q.herkunft) {
                        Some(h) => herkunft_norm(Some(h)),
                        None => default.to_string(),
                    };
                    (h, k)
                });
                (z, k)
            })
            .collect();
        let mut zaehler: HashMap<&(String, String), usize> = HashMap::new();
        for (_, k) in &alle {
            if let Some(k) = k {
                *zaehler.entry(k).or_default() += 1;
            }
        }
        for (z, k) in &alle {
            if k.as_ref().is_some_and(|k| zaehler[k] > 1) {
                aus.push((art, *z));
            }
        }
    }
    let mut aus = Vec::new();
    sammle(
        StammdatenArt::Fahrzeug,
        p.fahrzeuge.iter().map(|a| (a.zeile, a.quelle.clone())),
        herkunft_default,
        &mut aus,
    );
    sammle(
        StammdatenArt::Personal,
        p.personal.iter().map(|a| (a.zeile, a.quelle.clone())),
        herkunft_default,
        &mut aus,
    );
    sammle(
        StammdatenArt::Qualifikation,
        p.qualifikationen
            .iter()
            .map(|a| (a.zeile, a.quelle.clone())),
        herkunft_default,
        &mut aus,
    );
    aus
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::stammdaten_eingang::QualifikationAngabe;

    fn kz(h: &str, k: &str) -> Kennungen {
        vec![(h.to_string(), k.to_string())]
    }

    fn bf(id: i64, fk: &str) -> BestandFahrzeug {
        BestandFahrzeug {
            id,
            funkrufname: fk.into(),
            kennzeichen: None,
            opta: None,
            fms_issi: None,
            fahrzeugtyp: None,
            standort: None,
            in_dienst: true,
            kennungen: vec![],
        }
    }

    fn bp(id: i64, name: &str) -> BestandPersonal {
        BestandPersonal {
            id,
            name: name.into(),
            personalnummer: None,
            telefon: None,
            traegerorganisation: None,
            in_dienst: true,
            qualifikation_ids: vec![],
            kennungen: vec![],
        }
    }

    fn bq(id: i64, label: &str, aktiv: bool) -> BestandQualifikation {
        BestandQualifikation {
            id,
            label: label.into(),
            aktiv,
            kennungen: vec![],
        }
    }

    fn fa(fk: &str) -> FahrzeugAngabe {
        FahrzeugAngabe {
            zeile: 2,
            quelle: Herkunftsangabe::default(),
            funkrufname: fk.into(),
            kennzeichen: None,
            opta: None,
            issi: None,
            typ: None,
            standort: None,
        }
    }

    fn pa(name: &str) -> PersonalAngabe {
        PersonalAngabe {
            zeile: 2,
            quelle: Herkunftsangabe::default(),
            name: name.into(),
            personalnummer: None,
            telefon: None,
            traegerorganisation: None,
            qualifikationen: vec![],
        }
    }

    fn quelle(k: &str, h: Option<&str>) -> Herkunftsangabe {
        Herkunftsangabe {
            kennung: Some(k.into()),
            herkunft: h.map(Into::into),
        }
    }

    fn bestand(fz: Vec<BestandFahrzeug>) -> Bestand {
        Bestand {
            fahrzeuge: fz,
            ..Default::default()
        }
    }

    #[test]
    fn fz_kennung_vor_opta() {
        let mut a = bf(1, "Florian 1");
        a.kennungen = kz("fv", "K1");
        let mut b = bf(2, "Florian 2");
        b.opta = Some("OPTA 5".into());
        let mut x = fa("Egal");
        x.quelle = quelle("k1", Some("FV"));
        x.opta = Some("opta5".into());
        let z = fahrzeug_zuordnen(&bestand(vec![a, b]), "fv", &x);
        assert_eq!(
            z,
            Zuordnung::Gefunden {
                id: 1,
                grund: TrefferGrund::Kennung
            }
        );
    }

    #[test]
    fn fz_opta() {
        let mut b = bf(2, "Florian 2");
        b.opta = Some("OPTA 5".into());
        let mut x = fa("Anders");
        x.opta = Some("opta5".into());
        assert_eq!(
            fahrzeug_zuordnen(&bestand(vec![b]), "", &x),
            Zuordnung::Gefunden {
                id: 2,
                grund: TrefferGrund::Opta
            }
        );
    }

    #[test]
    fn fz_issi() {
        let mut b = bf(3, "F3");
        b.fms_issi = Some("12 34".into());
        let mut x = fa("Anders");
        x.issi = Some("1234".into());
        assert_eq!(
            fahrzeug_zuordnen(&bestand(vec![b]), "", &x),
            Zuordnung::Gefunden {
                id: 3,
                grund: TrefferGrund::Issi
            }
        );
    }

    #[test]
    fn fz_funkrufname() {
        let b = bf(4, "Florian  Nord 1");
        assert_eq!(
            fahrzeug_zuordnen(&bestand(vec![b]), "", &fa("florian nord 1")),
            Zuordnung::Gefunden {
                id: 4,
                grund: TrefferGrund::Funkrufname
            }
        );
        assert_eq!(
            fahrzeug_zuordnen(&bestand(vec![]), "", &fa("x")),
            Zuordnung::Neu
        );
    }

    #[test]
    fn fz_opta_zwei_treffer_mehrdeutig_keine_tiefere_stufe() {
        let mut a = bf(1, "Florian 1");
        a.opta = Some("A1".into());
        let mut b = bf(2, "Florian 2");
        b.opta = Some("a 1".into());
        let mut x = fa("Florian 1");
        x.opta = Some("A1".into());
        assert_eq!(
            fahrzeug_zuordnen(&bestand(vec![a, b]), "", &x),
            Zuordnung::Mehrdeutig {
                kandidaten: vec![1, 2],
                hinweis: None
            }
        );
    }

    #[test]
    fn fz_kennung_trifft_ausser_dienst() {
        let mut a = bf(1, "Florian 1");
        a.kennungen = kz("fv", "k1");
        a.in_dienst = false;
        let mut x = fa("Florian 1");
        x.quelle = quelle("k1", Some("fv"));
        assert_eq!(
            fahrzeug_zuordnen(&bestand(vec![a]), "fv", &x),
            Zuordnung::AusserDienst { id: 1 }
        );
    }

    #[test]
    fn fz_ziel_traegt_andere_kennung_derselben_herkunft_mehrdeutig() {
        let mut a = bf(1, "Florian 1");
        a.kennungen = kz("fv", "alt");
        let mut x = fa("Florian 1");
        x.quelle = quelle("neu", Some("fv"));
        match fahrzeug_zuordnen(&bestand(vec![a]), "fv", &x) {
            Zuordnung::Mehrdeutig {
                kandidaten,
                hinweis,
            } => {
                assert_eq!(kandidaten, vec![1]);
                assert!(hinweis.is_some());
            }
            z => panic!("{z:?}"),
        }
    }

    #[test]
    fn p_personalnummer() {
        let mut p = bp(1, "Meier, Anna");
        p.personalnummer = Some("PN 7".into());
        let mut x = pa("Ganz Anders");
        x.personalnummer = Some("pn7".into());
        let b = Bestand {
            personal: vec![p],
            ..Default::default()
        };
        assert_eq!(
            personal_zuordnen(&b, "", &x),
            Zuordnung::Gefunden {
                id: 1,
                grund: TrefferGrund::Personalnummer
            }
        );
    }

    #[test]
    fn p_name_komma() {
        let b = Bestand {
            personal: vec![bp(1, "Anna Meier")],
            ..Default::default()
        };
        assert_eq!(
            personal_zuordnen(&b, "", &pa("Meier, Anna")),
            Zuordnung::Gefunden {
                id: 1,
                grund: TrefferGrund::Name
            }
        );
    }

    #[test]
    fn p_name_ohne_komma() {
        let b = Bestand {
            personal: vec![bp(1, "Meier, Anna")],
            ..Default::default()
        };
        assert_eq!(
            personal_zuordnen(&b, "", &pa("Anna Maria Meier")),
            Zuordnung::Neu
        );
        assert_eq!(
            personal_zuordnen(&b, "", &pa("Anna Meier")),
            Zuordnung::Gefunden {
                id: 1,
                grund: TrefferGrund::Name
            }
        );
        assert_eq!(
            name_teilen("Anna Maria Meier"),
            ("Meier".into(), Some("Anna Maria".into()))
        );
        assert_eq!(name_teilen("Meier"), ("Meier".into(), None));
        assert_eq!(
            name_teilen("Meier, Anna"),
            ("Meier".into(), Some("Anna".into()))
        );
    }

    #[test]
    fn q_bezeichnung_normalisiert() {
        let b = Bestand {
            qualifikationen: vec![bq(5, "Rettungs  Sanitäter", true)],
            ..Default::default()
        };
        assert_eq!(
            qualifikation_zuordnen(&b, "", " rettungs sanitäter "),
            Zuordnung::Gefunden {
                id: 5,
                grund: TrefferGrund::Bezeichnung
            }
        );
        let mut q = bq(6, "Anderes", true);
        q.kennungen = kz("zl", "RS");
        let b = Bestand {
            qualifikationen: vec![q],
            ..Default::default()
        };
        assert_eq!(
            qualifikation_zuordnen(&b, "zl", "rs"),
            Zuordnung::Gefunden {
                id: 6,
                grund: TrefferGrund::Kennung
            }
        );
    }

    #[test]
    fn q_inaktiv_gefunden() {
        let b = Bestand {
            qualifikationen: vec![bq(5, "Taucher", false)],
            ..Default::default()
        };
        assert_eq!(
            qualifikation_zuordnen(&b, "", "Taucher"),
            Zuordnung::Gefunden {
                id: 5,
                grund: TrefferGrund::Bezeichnung
            }
        );
    }

    #[test]
    fn q_zwei_labels_normalisiert_gleich_mehrdeutig() {
        let b = Bestand {
            qualifikationen: vec![bq(1, "Taucher", true), bq(2, "taucher ", false)],
            ..Default::default()
        };
        assert_eq!(
            qualifikation_zuordnen(&b, "", "TAUCHER"),
            Zuordnung::Mehrdeutig {
                kandidaten: vec![1, 2],
                hinweis: None
            }
        );
    }

    #[test]
    fn aenderungen_fuellt_und_weicht_ab() {
        let mut b = bf(1, "Florian 1");
        b.standort = Some("Wache A".into());
        b.fms_issi = Some("1234".into());
        let mut x = fa("Florian 1");
        x.opta = Some("OPTA 1".into());
        x.standort = Some("Wache B".into());
        x.issi = Some("12 34".into());
        let a = fahrzeug_aenderungen(&b, &x);
        assert_eq!(a.len(), 2);
        assert_eq!(a[0].feld, "opta");
        assert_eq!(a[0].art, AenderungsArt::Fuellt);
        assert!(a[0].erkennungsfeld);
        assert_eq!(a[1].feld, "standort");
        assert_eq!(a[1].art, AenderungsArt::WeichtAb);
        assert_eq!(a[1].alt.as_deref(), Some("Wache A"));
        assert!(!a[1].erkennungsfeld);
        // Funkrufname weicht ab: Erkennungsfeld.
        let a = fahrzeug_aenderungen(&b, &fa("Florian 9"));
        assert_eq!(a.len(), 1);
        assert_eq!(a[0].feld, "funkrufname");
        assert!(a[0].erkennungsfeld);
        // Personal
        let mut p = bp(1, "Meier, Anna");
        p.telefon = Some("0170 1".into());
        let mut y = pa("Anna Meier");
        y.telefon = Some("01701".into());
        y.traegerorganisation = Some("DRK".into());
        let a = personal_aenderungen(&p, &y);
        assert_eq!(a.len(), 1);
        assert_eq!(a[0].feld, "traegerorganisation");
    }

    #[test]
    fn dubletten_beide_zeilen() {
        let mut a = fa("A");
        a.zeile = 2;
        a.quelle = quelle("K1", Some("FV"));
        let mut b = fa("B");
        b.zeile = 3;
        b.quelle = quelle("k1", None);
        let mut c = fa("C");
        c.zeile = 4;
        c.quelle = quelle("k2", None);
        let p = StammdatenPaket {
            fahrzeuge: vec![a, b, c],
            ..Default::default()
        };
        assert_eq!(
            dubletten_in_datei(&p, "fv"),
            vec![(StammdatenArt::Fahrzeug, 2), (StammdatenArt::Fahrzeug, 3)]
        );
        let _ = QualifikationAngabe {
            zeile: 1,
            quelle: Herkunftsangabe::default(),
            bezeichnung: String::new(),
        };
    }

    #[test]
    fn herkunft_aus_zeile_vor_default() {
        let mut a = fa("A");
        a.zeile = 2;
        a.quelle = quelle("k1", Some("Andere"));
        let mut b = fa("B");
        b.zeile = 3;
        b.quelle = quelle("k1", None);
        let p = StammdatenPaket {
            fahrzeuge: vec![a, b],
            ..Default::default()
        };
        assert!(dubletten_in_datei(&p, "fv").is_empty());
        let mut fz = bf(1, "X");
        fz.kennungen = kz("andere", "k1");
        let mut x = fa("Y");
        x.quelle = quelle("k1", Some("Andere"));
        let h = herkunft_norm(x.quelle.herkunft.as_deref());
        assert_eq!(
            fahrzeug_zuordnen(&bestand(vec![fz]), &h, &x),
            Zuordnung::Gefunden {
                id: 1,
                grund: TrefferGrund::Kennung
            }
        );
    }
}
