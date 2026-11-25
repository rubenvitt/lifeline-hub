//! Abgleich einer Stammdatenzeile mit dem Bestand (LLH-1633): rein, ohne Datenbank.
//! Stufen in fester Reihenfolge; mehr als ein Treffer auf einer Stufe ist mehrdeutig und stoppt.

use std::collections::{HashMap, HashSet};

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

/// Schlüssel `(herkunft_norm, norm(kennung))` → Positionen im Bestand.
type KennungsIndex = HashMap<(String, String), Vec<usize>>;
/// Normalisierter Wert → Positionen im Bestand.
type WertIndex = HashMap<String, Vec<usize>>;

/// Der [`Bestand`] zum Nachschlagen, einmal gebaut: jede Stufe des Abgleichs ist ein Zugriff
/// auf eine Tabelle statt eines Durchlaufs mit `norm()` je Vergleich (bei 5.000 Zeilen gegen
/// 5.000 Datensätze sonst Sekunden unter `BEGIN IMMEDIATE`). Die Positionen stehen in der
/// Reihenfolge des Bestands, also wie vorher beim Durchlauf.
pub struct BestandIndex<'a> {
    pub bestand: &'a Bestand,
    fz_id: HashMap<i64, usize>,
    p_id: HashMap<i64, usize>,
    q_id: HashMap<i64, usize>,
    fz_kennung: KennungsIndex,
    p_kennung: KennungsIndex,
    q_kennung: KennungsIndex,
    /// Nur Fahrzeuge bzw. Personal im Dienst.
    fz_opta: WertIndex,
    fz_issi: WertIndex,
    fz_funkrufname: WertIndex,
    p_personalnummer: WertIndex,
    p_name: WertIndex,
    q_label: WertIndex,
    /// `(Art, herkunft, norm(kennung))` aus [`Bestand::belegte_kennungen`].
    belegt: HashSet<(StammdatenArt, String, String)>,
}

fn rein(index: &mut WertIndex, wert: String, pos: usize) {
    if !wert.is_empty() {
        index.entry(wert).or_default().push(pos);
    }
}

fn kennungen_rein(index: &mut KennungsIndex, kennungen: &Kennungen, pos: usize) {
    for (h, k) in kennungen {
        let liste = index.entry((h.clone(), norm(k))).or_default();
        // Zwei Schreibweisen derselben Kennung an einem Datensatz zählen einmal.
        if liste.last() != Some(&pos) {
            liste.push(pos);
        }
    }
}

/// Positionen mehrerer Schlüssel, vereinigt, in der Reihenfolge des Bestands.
fn vereinigt<'k>(index: &WertIndex, schluessel: impl Iterator<Item = &'k String>) -> Vec<usize> {
    let mut v: Vec<usize> = schluessel
        .filter_map(|k| index.get(k))
        .flatten()
        .copied()
        .collect();
    v.sort_unstable();
    v.dedup();
    v
}

impl<'a> BestandIndex<'a> {
    pub fn new(b: &'a Bestand) -> Self {
        let mut ix = BestandIndex {
            bestand: b,
            fz_id: HashMap::new(),
            p_id: HashMap::new(),
            q_id: HashMap::new(),
            fz_kennung: HashMap::new(),
            p_kennung: HashMap::new(),
            q_kennung: HashMap::new(),
            fz_opta: HashMap::new(),
            fz_issi: HashMap::new(),
            fz_funkrufname: HashMap::new(),
            p_personalnummer: HashMap::new(),
            p_name: HashMap::new(),
            q_label: HashMap::new(),
            belegt: b
                .belegte_kennungen
                .iter()
                .map(|(a, h, k)| (*a, h.clone(), norm(k)))
                .collect(),
        };
        for (i, f) in b.fahrzeuge.iter().enumerate() {
            ix.fz_id.insert(f.id, i);
            kennungen_rein(&mut ix.fz_kennung, &f.kennungen, i);
            if f.in_dienst {
                if let Some(o) = f.opta.as_deref() {
                    rein(&mut ix.fz_opta, erkennungswert_norm(o), i);
                }
                if let Some(s) = f.fms_issi.as_deref() {
                    rein(&mut ix.fz_issi, erkennungswert_norm(s), i);
                }
                rein(&mut ix.fz_funkrufname, norm(&f.funkrufname), i);
            }
        }
        for (i, p) in b.personal.iter().enumerate() {
            ix.p_id.insert(p.id, i);
            kennungen_rein(&mut ix.p_kennung, &p.kennungen, i);
            if p.in_dienst {
                if let Some(pn) = p.personalnummer.as_deref() {
                    rein(&mut ix.p_personalnummer, erkennungswert_norm(pn), i);
                }
                rein(&mut ix.p_name, norm(&p.name), i);
            }
        }
        for (i, q) in b.qualifikationen.iter().enumerate() {
            ix.q_id.insert(q.id, i);
            kennungen_rein(&mut ix.q_kennung, &q.kennungen, i);
            rein(&mut ix.q_label, norm(&q.label), i);
        }
        ix
    }

    pub fn fahrzeug(&self, id: i64) -> Option<&'a BestandFahrzeug> {
        self.fz_id.get(&id).map(|i| &self.bestand.fahrzeuge[*i])
    }

    pub fn personal(&self, id: i64) -> Option<&'a BestandPersonal> {
        self.p_id.get(&id).map(|i| &self.bestand.personal[*i])
    }

    pub fn qualifikation(&self, id: i64) -> Option<&'a BestandQualifikation> {
        self.q_id
            .get(&id)
            .map(|i| &self.bestand.qualifikationen[*i])
    }

    fn kennungs_index(&self, art: StammdatenArt) -> &KennungsIndex {
        match art {
            StammdatenArt::Fahrzeug => &self.fz_kennung,
            StammdatenArt::Personal => &self.p_kennung,
            StammdatenArt::Qualifikation => &self.q_kennung,
        }
    }

    /// Positionen der Datensätze einer Art, die `(herkunft, kennung_norm)` tragen.
    fn mit_kennung(&self, art: StammdatenArt, herkunft: &str, kennung_norm: &str) -> &[usize] {
        self.kennungs_index(art)
            .get(&(herkunft.to_string(), kennung_norm.to_string()))
            .map(Vec::as_slice)
            .unwrap_or(&[])
    }

    /// Ids der Qualifikationen, die eine der Kennungen (normalisiert) für `herkunft` tragen.
    pub fn qualifikationen_mit_kennung<'k>(
        &self,
        herkunft: &str,
        kennungen_norm: impl Iterator<Item = &'k String>,
    ) -> Vec<i64> {
        let mut v: Vec<usize> = kennungen_norm
            .flat_map(|k| self.mit_kennung(StammdatenArt::Qualifikation, herkunft, k))
            .copied()
            .collect();
        v.sort_unstable();
        v.dedup();
        v.into_iter()
            .map(|i| self.bestand.qualifikationen[i].id)
            .collect()
    }

    /// Trägt ein Datensatz der Art `(herkunft, kennung_norm)`?
    pub fn kennung_getragen(&self, art: StammdatenArt, herkunft: &str, kennung_norm: &str) -> bool {
        !self.mit_kennung(art, herkunft, kennung_norm).is_empty()
    }

    /// Belegt eine Zeile der Org in `stammdaten_kennung` den Schlüssel, auch ohne gültiges Ziel?
    pub fn kennung_belegt(&self, art: StammdatenArt, herkunft: &str, kennung_norm: &str) -> bool {
        self.belegt
            .contains(&(art, herkunft.to_string(), kennung_norm.to_string()))
    }
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
pub fn fahrzeug_zuordnen(ix: &BestandIndex, herkunft: &str, a: &FahrzeugAngabe) -> Zuordnung {
    let fz = &ix.bestand.fahrzeuge;
    let kennung = kennung_der(&a.quelle);
    if let Some(kn) = &kennung {
        let t = ix
            .mit_kennung(StammdatenArt::Fahrzeug, herkunft, kn)
            .iter()
            .map(|i| (fz[*i].id, fz[*i].in_dienst))
            .collect();
        if let Some(z) = kennungsstufe(t) {
            return z;
        }
    }
    let kn = kennung.as_deref();
    let treffer = |pos: &[usize]| -> Vec<(i64, &Kennungen)> {
        pos.iter().map(|i| (fz[*i].id, &fz[*i].kennungen)).collect()
    };
    let nach = |wert: Option<&str>, index: &WertIndex, g| {
        let w = erkennungswert_norm(wert?);
        let pos = index.get(&w)?;
        stufe(treffer(pos), g, herkunft, kn)
    };
    if let Some(z) = nach(nicht_leer(&a.opta), &ix.fz_opta, TrefferGrund::Opta) {
        return z;
    }
    if let Some(z) = nach(nicht_leer(&a.issi), &ix.fz_issi, TrefferGrund::Issi) {
        return z;
    }
    if let Some(pos) = ix.fz_funkrufname.get(&norm(&a.funkrufname)) {
        if let Some(z) = stufe(treffer(pos), TrefferGrund::Funkrufname, herkunft, kn) {
            return z;
        }
    }
    Zuordnung::Neu
}

pub fn personal_zuordnen(ix: &BestandIndex, herkunft: &str, a: &PersonalAngabe) -> Zuordnung {
    let ps = &ix.bestand.personal;
    let kennung = kennung_der(&a.quelle);
    if let Some(kn) = &kennung {
        let t = ix
            .mit_kennung(StammdatenArt::Personal, herkunft, kn)
            .iter()
            .map(|i| (ps[*i].id, ps[*i].in_dienst))
            .collect();
        if let Some(z) = kennungsstufe(t) {
            return z;
        }
    }
    let kn = kennung.as_deref();
    let treffer = |pos: &[usize]| -> Vec<(i64, &Kennungen)> {
        pos.iter().map(|i| (ps[*i].id, &ps[*i].kennungen)).collect()
    };
    if let Some(pn) = nicht_leer(&a.personalnummer).map(erkennungswert_norm) {
        if let Some(pos) = ix.p_personalnummer.get(&pn) {
            if let Some(z) = stufe(treffer(pos), TrefferGrund::Personalnummer, herkunft, kn) {
                return z;
            }
        }
    }
    if !a.name.trim().is_empty() {
        let (nach, vor) = name_teilen(&a.name);
        let formen = namensformen(&nach, vor.as_deref());
        let pos = vereinigt(&ix.p_name, formen.iter());
        if let Some(z) = stufe(treffer(&pos), TrefferGrund::Name, herkunft, kn) {
            return z;
        }
    }
    Zuordnung::Neu
}

/// Kennung = normalisierter Text, dann normalisierte Bezeichnung; aktive und inaktive.
pub fn qualifikation_zuordnen(ix: &BestandIndex, herkunft: &str, text: &str) -> Zuordnung {
    let n = norm(text);
    if n.is_empty() {
        return Zuordnung::Fehler("Bezeichnung fehlt".to_string());
    }
    let qs = &ix.bestand.qualifikationen;
    let mehr = |pos: &[usize], grund| match pos {
        [] => None,
        [i] => Some(Zuordnung::Gefunden {
            id: qs[*i].id,
            grund,
        }),
        _ => Some(Zuordnung::Mehrdeutig {
            kandidaten: pos.iter().map(|i| qs[*i].id).collect(),
            hinweis: None,
        }),
    };
    if let Some(z) = mehr(
        ix.mit_kennung(StammdatenArt::Qualifikation, herkunft, &n),
        TrefferGrund::Kennung,
    ) {
        return z;
    }
    let pos = ix.q_label.get(&n).map(Vec::as_slice).unwrap_or(&[]);
    mehr(pos, TrefferGrund::Bezeichnung).unwrap_or(Zuordnung::Neu)
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

    // Die Tests geben einen Bestand; der Abgleich arbeitet auf dessen Index.
    fn fahrzeug_zuordnen(b: &Bestand, h: &str, a: &FahrzeugAngabe) -> Zuordnung {
        super::fahrzeug_zuordnen(&BestandIndex::new(b), h, a)
    }

    fn personal_zuordnen(b: &Bestand, h: &str, a: &PersonalAngabe) -> Zuordnung {
        super::personal_zuordnen(&BestandIndex::new(b), h, a)
    }

    fn qualifikation_zuordnen(b: &Bestand, h: &str, text: &str) -> Zuordnung {
        super::qualifikation_zuordnen(&BestandIndex::new(b), h, text)
    }

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
