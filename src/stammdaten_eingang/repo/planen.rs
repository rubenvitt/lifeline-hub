//! Rein: Paket + Bestand + Entscheidungen → Vorschau und Schreibplan.

use std::collections::{HashMap, HashSet};

use super::{
    ArtZaehlung, Entscheidungen, FeldAenderungArt, FeldAenderungDto, Kandidat, QualiWahl,
    QualiZeile, StammdatenVorschau, StammdatenZeile, Zaehlung, ZeilenErgebnis, ZeilenWahl,
    ENTSCHEIDUNGEN_MAX,
};
use crate::abloesung::schichtplan::uebernahme::MeldungStufe;
use crate::einlesen::namen::{herkunft_norm, norm};
use crate::error::{AppError, ZeilenArt, ZeilenGrund};
use crate::stammdaten_eingang::abgleich::{
    dubletten_in_datei, erkennungswert_norm, fahrzeug_aenderungen, fahrzeug_zuordnen,
    personal_aenderungen, personal_zuordnen, qualifikation_zuordnen, AenderungsArt, Bestand,
    BestandIndex, FeldAenderung, Kennungen, TrefferGrund, Zuordnung,
};
use crate::stammdaten_eingang::{
    DateiMeldung, FahrzeugAngabe, Herkunftsangabe, PersonalAngabe, StammdatenArt, StammdatenPaket,
};

const DUBLETTE: &str = "Kennung und Herkunft stehen in der Datei mehrfach";

/// Wohin eine Fahrzeug- oder Personalzeile schreibt.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum Ziel {
    Neu,
    Bestand(i64),
}

/// Eine Fahrzeugzeile, die schreibt.
#[derive(Debug, Clone)]
pub(super) struct FahrzeugSchreiben {
    pub angabe: FahrzeugAngabe,
    pub ziel: Ziel,
    /// Spalte → Wert; nur die übernommenen Änderungen.
    pub setzen: Vec<(&'static str, String)>,
    /// `(herkunft_norm, kennung)`, wenn sie neu gemerkt wird.
    pub kennung: Option<(String, String)>,
}

/// Eine Personalzeile, die schreibt.
#[derive(Debug, Clone)]
pub(super) struct PersonalSchreiben {
    pub angabe: PersonalAngabe,
    pub ziel: Ziel,
    pub setzen: Vec<(&'static str, String)>,
    pub kennung: Option<(String, String)>,
    /// Indizes in [`Planung::qualifikationen`], die die Person bekommt (bei einer gefundenen nur
    /// die hinzukommenden).
    pub qualifikationen: Vec<usize>,
}

/// Wie eine Qualifikation der Datei aufgelöst ist.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum QualiZiel {
    Aus,
    Offen,
    Fehler,
    Neu,
    Id(i64),
}

#[derive(Debug, Clone)]
pub(super) struct QualiSchreiben {
    pub herkunft: String,
    pub label: String,
    pub ziel: QualiZiel,
    /// Kennungen, die für das Ziel neu gemerkt werden (nur mit Herkunft).
    pub kennungen: Vec<String>,
}

/// Ergebnis von [`planen`]: die Vorschau und was das Übernehmen schreiben würde.
#[derive(Debug, Clone)]
pub struct Planung {
    pub vorschau: StammdatenVorschau,
    pub(super) fahrzeuge: Vec<FahrzeugSchreiben>,
    pub(super) personal: Vec<PersonalSchreiben>,
    pub(super) qualifikationen: Vec<QualiSchreiben>,
    /// Was das Übernehmen sperrt, als Zeilen für den 422.
    pub(super) sperren: Vec<ZeilenGrund>,
}

/// Wie eine Zeile nach der Wahl behandelt wird.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Absicht {
    Aus,
    Offen,
    Fehler,
    Neu,
    Ziel {
        id: i64,
        grund: Option<TrefferGrund>,
        datei_uebernehmen: bool,
    },
}

/// Zwischenstand einer Fahrzeug- oder Personalzeile.
struct Zeile {
    vorschau: StammdatenZeile,
    absicht: Absicht,
    herkunft: String,
    kennung: Option<String>,
    setzen: Vec<(&'static str, String)>,
    weicht_ab_uebernommen: bool,
    kennung_schreiben: Option<(String, String)>,
}

fn nicht_leer(s: &Option<String>) -> Option<&str> {
    s.as_deref().map(str::trim).filter(|s| !s.is_empty())
}

fn wirksame_herkunft(q: &Herkunftsangabe, default: &str) -> String {
    match nicht_leer(&q.herkunft) {
        Some(h) => herkunft_norm(Some(h)),
        None => default.to_string(),
    }
}

fn traegt(k: &Kennungen, herkunft: &str, kennung_norm: &str) -> bool {
    k.iter()
        .any(|(h, x)| h == herkunft && norm(x) == kennung_norm)
}

fn hat_herkunft(k: &Kennungen, herkunft: &str) -> bool {
    k.iter().any(|(h, _)| h == herkunft)
}

/// Spalte des Vertrags zu einer Spalte der Datenbank.
fn feld_wire(feld: &str) -> &str {
    match feld {
        "fms_issi" => "issi",
        "fahrzeugtyp" => "typ",
        f => f,
    }
}

fn art_text(art: StammdatenArt) -> &'static str {
    match art {
        StammdatenArt::Fahrzeug => "Fahrzeug",
        StammdatenArt::Personal => "Personal",
        StammdatenArt::Qualifikation => "Qualifikation",
    }
}

fn passt_nicht(art: StammdatenArt, zeile: u32) -> AppError {
    AppError::Validation(format!(
        "{} Zeile {zeile}: Die Wahl passt nicht zu dieser Zeile",
        art_text(art)
    ))
}

/// Ergebnis, Absicht, Kandidaten-Ids, Grund, Hinweise.
type Angewendet = (
    ZeilenErgebnis,
    Absicht,
    Vec<i64>,
    Option<TrefferGrund>,
    Vec<String>,
);

/// Wendet die Wahl auf das Abgleichsergebnis an. Eine Wahl, die zur Zeile nicht passt, ist
/// `Validation`.
fn wahl_anwenden(
    art: StammdatenArt,
    zeile: u32,
    z: Zuordnung,
    wahl: Option<ZeilenWahl>,
) -> Result<Angewendet, AppError> {
    use ZeilenWahl as W;
    Ok(match z {
        Zuordnung::Fehler(t) => {
            let a = if wahl == Some(W::Auslassen) {
                Absicht::Aus
            } else {
                Absicht::Fehler
            };
            (ZeilenErgebnis::Fehler, a, vec![], None, vec![t])
        }
        Zuordnung::Neu => {
            let a = match wahl {
                None | Some(W::Neu) => Absicht::Neu,
                Some(W::Auslassen) => Absicht::Aus,
                Some(W::Kandidat { .. } | W::DateiUebernehmen) => {
                    return Err(passt_nicht(art, zeile))
                }
            };
            (ZeilenErgebnis::Neu, a, vec![], None, vec![])
        }
        Zuordnung::Gefunden { id, grund } => {
            let ziel = |datei_uebernehmen| Absicht::Ziel {
                id,
                grund: Some(grund),
                datei_uebernehmen,
            };
            let a = match wahl {
                None => ziel(false),
                Some(W::DateiUebernehmen) => ziel(true),
                Some(W::Kandidat { id: k }) if k == id => ziel(false),
                Some(W::Kandidat { .. }) => return Err(passt_nicht(art, zeile)),
                Some(W::Neu) => Absicht::Neu,
                Some(W::Auslassen) => Absicht::Aus,
            };
            (ZeilenErgebnis::Gefunden, a, vec![id], Some(grund), vec![])
        }
        Zuordnung::Mehrdeutig {
            kandidaten,
            hinweis,
        } => {
            let a = match wahl {
                None => Absicht::Offen,
                Some(W::Kandidat { id }) if kandidaten.contains(&id) => Absicht::Ziel {
                    id,
                    grund: None,
                    datei_uebernehmen: false,
                },
                Some(W::Kandidat { .. } | W::DateiUebernehmen) => {
                    return Err(passt_nicht(art, zeile))
                }
                Some(W::Neu) => Absicht::Neu,
                Some(W::Auslassen) => Absicht::Aus,
            };
            let mut h = Vec::new();
            h.extend(hinweis);
            if a == Absicht::Offen {
                h.push("Mehrere Datensätze kommen in Frage: bitte wählen".to_string());
            }
            (ZeilenErgebnis::Mehrdeutig, a, kandidaten, None, h)
        }
        Zuordnung::AusserDienst { id } => (
            ZeilenErgebnis::AusserDienst,
            Absicht::Aus,
            vec![id],
            None,
            vec!["Der Datensatz ist außer Dienst gestellt; die Zeile wird nicht übernommen".into()],
        ),
    })
}

fn wirksame_wahl(absicht: Absicht, explizit: Option<ZeilenWahl>) -> Option<ZeilenWahl> {
    explizit.or(match absicht {
        Absicht::Neu => Some(ZeilenWahl::Neu),
        _ => None,
    })
}

/// Übernommene Änderungen, DTOs und Hinweise einer gefundenen Zeile.
fn aenderungen_anwenden(
    aenderungen: Vec<FeldAenderung>,
    grund: Option<TrefferGrund>,
    datei_uebernehmen: bool,
    zeile: &mut Zeile,
) {
    for a in aenderungen {
        let uebernommen = match a.art {
            AenderungsArt::Fuellt => true,
            AenderungsArt::WeichtAb => {
                datei_uebernehmen && (!a.erkennungsfeld || grund == Some(TrefferGrund::Kennung))
            }
        };
        if a.art == AenderungsArt::WeichtAb && a.erkennungsfeld && datei_uebernehmen && !uebernommen
        {
            zeile.vorschau.hinweise.push(format!(
                "„{}“ weicht ab; ein Erkennungsmerkmal ändert sich nur bei einem Treffer über die Kennung",
                feld_wire(a.feld)
            ));
        }
        if uebernommen {
            zeile.setzen.push((a.feld, a.neu.clone()));
            if a.art == AenderungsArt::WeichtAb {
                zeile.weicht_ab_uebernommen = true;
            }
        }
        zeile.vorschau.aenderungen.push(FeldAenderungDto {
            feld: feld_wire(a.feld).to_string(),
            alt: a.alt,
            neu: a.neu,
            art: match a.art {
                AenderungsArt::Fuellt => FeldAenderungArt::Fuellt,
                AenderungsArt::WeichtAb => FeldAenderungArt::WeichtAb,
            },
            erkennungsfeld: a.erkennungsfeld,
            uebernommen,
        });
    }
}

/// Ob die Kennung der Zeile gemerkt wird. `ziel` = die Kennungen des Ziels (bei einer
/// gefundenen Zeile).
fn kennung_merken(zeile: &mut Zeile, ix: &BestandIndex, ziel: Option<&Kennungen>, was: &str) {
    if !matches!(zeile.absicht, Absicht::Neu | Absicht::Ziel { .. }) {
        return;
    }
    let (Some(k), false) = (zeile.kennung.clone(), zeile.herkunft.is_empty()) else {
        return;
    };
    let kn = norm(&k);
    if ziel.is_some_and(|z| traegt(z, &zeile.herkunft, &kn)) {
        return;
    }
    let art = zeile.vorschau.art;
    if ix.kennung_getragen(art, &zeile.herkunft, &kn)
        || ix.kennung_belegt(art, &zeile.herkunft, &kn)
    {
        zeile.vorschau.hinweise.push(format!(
            "Die Kennung gehört schon einem anderen {was}; sie wird nicht gemerkt"
        ));
        return;
    }
    if ziel.is_some_and(|z| hat_herkunft(z, &zeile.herkunft)) {
        zeile.vorschau.hinweise.push(format!(
            "Das {was} trägt für diese Herkunft schon eine andere Kennung; sie bleibt"
        ));
        return;
    }
    zeile.kennung_schreiben = Some((zeile.herkunft.clone(), k));
}

fn zeile_fehler(z: &mut Zeile, text: String) {
    z.absicht = Absicht::Fehler;
    z.vorschau.ergebnis = ZeilenErgebnis::Fehler;
    z.vorschau.hinweise.insert(0, text);
    z.setzen.clear();
    z.kennung_schreiben = None;
}

/// Zwei Zeilen, die denselben Datensatz treffen, sind beide Fehler.
fn gleiche_ziele(zeilen: &mut [Zeile], was: &str) {
    let mut zaehler: HashMap<i64, usize> = HashMap::new();
    for z in zeilen.iter() {
        if let Absicht::Ziel { id, .. } = z.absicht {
            *zaehler.entry(id).or_default() += 1;
        }
    }
    for z in zeilen.iter_mut() {
        if let Absicht::Ziel { id, .. } = z.absicht {
            if zaehler[&id] > 1 {
                zeile_fehler(
                    z,
                    format!("Mehrere Zeilen der Datei treffen dasselbe {was}"),
                );
            }
        }
    }
}

/// Eindeutigkeit eines Werts unter den Datensätzen im Dienst (Funkrufname, Personalnummer),
/// gegen den Bestand und die Datei selbst. `geplant[i]` = neuer Wert der Zeile `i` (normalisiert,
/// mit Anzeige), `bestand` = normalisierter Wert → Ids der Datensätze im Dienst.
fn kollisionen(
    zeilen: &mut [Zeile],
    geplant: Vec<Option<(String, String)>>,
    bestand: &HashMap<String, Vec<i64>>,
    feld: &str,
) {
    let mut zaehler: HashMap<&str, usize> = HashMap::new();
    for (n, _) in geplant.iter().flatten() {
        *zaehler.entry(n.as_str()).or_default() += 1;
    }
    for (z, g) in zeilen.iter_mut().zip(geplant.iter()) {
        let Some((n, anzeige)) = g else { continue };
        let selbst = match z.absicht {
            Absicht::Ziel { id, .. } => Some(id),
            _ => None,
        };
        let im_bestand = bestand
            .get(n)
            .is_some_and(|ids| ids.iter().any(|id| Some(*id) != selbst));
        if im_bestand || zaehler[n.as_str()] > 1 {
            zeile_fehler(z, format!("{feld} „{anzeige}“ ist schon vergeben"));
        }
    }
}

/// Neuer Wert einer eindeutigen Spalte, wenn die Zeile ihn schreibt.
fn geplanter_wert(
    z: &Zeile,
    spalte: &str,
    neu_wert: Option<&str>,
    n: fn(&str) -> String,
) -> Option<(String, String)> {
    let wert = match z.absicht {
        Absicht::Neu => neu_wert.map(str::to_string),
        Absicht::Ziel { .. } => z
            .setzen
            .iter()
            .find(|(s, _)| *s == spalte)
            .map(|(_, w)| w.clone()),
        _ => None,
    }?;
    let k = n(&wert);
    (!k.is_empty()).then_some((k, wert))
}

fn neue_zeile(
    art: StammdatenArt,
    nr: u32,
    anzeige: String,
    quelle: &Herkunftsangabe,
    herkunft: String,
) -> Zeile {
    Zeile {
        vorschau: StammdatenZeile {
            art,
            zeile: nr,
            anzeige,
            ergebnis: ZeilenErgebnis::Neu,
            grund: None,
            kandidaten: vec![],
            aenderungen: vec![],
            hinweise: vec![],
            wahl: None,
        },
        absicht: Absicht::Neu,
        herkunft,
        kennung: nicht_leer(&quelle.kennung).map(str::to_string),
        setzen: vec![],
        weicht_ab_uebernommen: false,
        kennung_schreiben: None,
    }
}

fn ohne_kennung_hinweis(z: &mut Zeile) {
    if z.kennung.is_none() {
        z.vorschau
            .hinweise
            .push("Ohne Kennung wird die Zeile nicht gemerkt".to_string());
    } else if z.herkunft.is_empty() {
        z.vorschau
            .hinweise
            .push("Die Kennung braucht eine Herkunft".to_string());
    }
}

/// Zählt eine Zeile und setzt `unveraendert` bei einer gefundenen ohne Wirkung.
fn zaehlen(z: &mut Zeile, zusatz: bool, zaehlung: &mut ArtZaehlung) {
    match z.absicht {
        Absicht::Aus => zaehlung.ausgelassen += 1,
        Absicht::Offen => zaehlung.offen += 1,
        Absicht::Fehler => zaehlung.fehler += 1,
        Absicht::Neu => zaehlung.neu += 1,
        Absicht::Ziel { .. } => {
            if z.weicht_ab_uebernommen {
                zaehlung.geaendert += 1;
            } else if !z.setzen.is_empty() || z.kennung_schreiben.is_some() || zusatz {
                zaehlung.ergaenzt += 1;
            } else {
                zaehlung.unveraendert += 1;
                if z.vorschau.ergebnis == ZeilenErgebnis::Gefunden {
                    z.vorschau.ergebnis = ZeilenErgebnis::Unveraendert;
                }
            }
        }
    }
}

fn sperrt(z: &Zeile) -> Option<ZeilenGrund> {
    let grund = match z.absicht {
        Absicht::Fehler => z
            .vorschau
            .hinweise
            .first()
            .cloned()
            .unwrap_or_else(|| "Fehler".into()),
        Absicht::Offen => "Entscheidung fehlt".to_string(),
        _ => return None,
    };
    Some(ZeilenGrund {
        art: ZeilenArt::Dateizeile,
        id: i64::from(z.vorschau.zeile),
        grund: format!("{}: {grund}", art_text(z.vorschau.art)),
    })
}

/// Eine Qualifikation der Datei, je `(herkunft, norm(text))`.
struct QualiEintrag {
    herkunft: String,
    text: String,
    zeilen: Vec<u32>,
    /// Kennungen, unter denen sie gemerkt wird: aus dem Blatt die Kennung, sonst der
    /// normalisierte Text.
    aliase: Vec<String>,
    fehler: Option<String>,
}

#[derive(Default)]
struct QualiSammlung {
    eintraege: Vec<QualiEintrag>,
    nach_text: HashMap<(String, String), usize>,
    nach_kennung: HashMap<(String, String), usize>,
}

impl QualiSammlung {
    fn eintrag(&mut self, herkunft: &str, text: &str) -> usize {
        let key = (herkunft.to_string(), norm(text));
        if let Some(i) = self.nach_text.get(&key) {
            return *i;
        }
        self.eintraege.push(QualiEintrag {
            herkunft: herkunft.to_string(),
            text: text.trim().to_string(),
            zeilen: vec![],
            aliase: vec![],
            fehler: None,
        });
        let i = self.eintraege.len() - 1;
        self.nach_text.insert(key, i);
        i
    }

    fn alias(&mut self, i: usize, alias: &str) {
        let e = &mut self.eintraege[i];
        if !e.aliase.iter().any(|a| norm(a) == norm(alias)) {
            e.aliase.push(alias.to_string());
        }
    }

    /// Ein Text aus der Liste einer Personalzeile.
    fn aus_personal(&mut self, herkunft: &str, text: &str) -> usize {
        if let Some(i) = self.nach_kennung.get(&(herkunft.to_string(), norm(text))) {
            return *i;
        }
        let i = self.eintrag(herkunft, text);
        self.alias(i, &norm(text));
        i
    }
}

fn kandidat_quali(ix: &BestandIndex, id: i64) -> Kandidat {
    let q = ix.qualifikation(id);
    Kandidat {
        id,
        anzeige: match q {
            Some(q) if !q.aktiv => format!("{} (inaktiv)", q.label),
            Some(q) => q.label.clone(),
            None => String::new(),
        },
    }
}

/// Rein: gleicht ab, wendet die Entscheidungen an, prüft Kollisionen. Schreibt nichts.
#[allow(clippy::too_many_arguments)]
pub fn planen(
    b: &Bestand,
    paket: &StammdatenPaket,
    meldungen: &[DateiMeldung],
    nicht_uebernommen: &[String],
    herkunft_default: Option<&str>,
    herkunft_vorschlag: Option<String>,
    e: &Entscheidungen,
) -> Result<Planung, AppError> {
    if e.zeilen.len() > ENTSCHEIDUNGEN_MAX || e.qualifikationen.len() > ENTSCHEIDUNGEN_MAX {
        return Err(AppError::Validation(format!(
            "Höchstens {ENTSCHEIDUNGEN_MAX} Entscheidungen je Liste"
        )));
    }
    let ix = BestandIndex::new(b);
    // Org-Prüfung jedes Ziels einer Entscheidung, bevor irgendetwas abgeglichen wird.
    for z in &e.zeilen {
        if let ZeilenWahl::Kandidat { id } = z.wahl {
            let eigen = match z.art {
                StammdatenArt::Fahrzeug => ix.fahrzeug(id).is_some(),
                StammdatenArt::Personal => ix.personal(id).is_some(),
                StammdatenArt::Qualifikation => false,
            };
            if !eigen {
                return Err(AppError::Validation(format!(
                    "{} Zeile {}: Der gewählte Datensatz gehört nicht zur eigenen Organisation",
                    art_text(z.art),
                    z.zeile
                )));
            }
        }
    }
    for q in &e.qualifikationen {
        if let QualiWahl::Zuordnen { qualifikation_id } = q.wahl {
            if ix.qualifikation(qualifikation_id).is_none() {
                return Err(AppError::Validation(format!(
                    "Qualifikation „{}“: Die gewählte Qualifikation gehört nicht zur eigenen Organisation",
                    q.text.trim()
                )));
            }
        }
    }
    let zeilen_wahl: HashMap<(StammdatenArt, u32), ZeilenWahl> = e
        .zeilen
        .iter()
        .map(|z| ((z.art, z.zeile), z.wahl))
        .collect();
    let quali_wahl: HashMap<String, QualiWahl> = e
        .qualifikationen
        .iter()
        .map(|q| (norm(&q.text), q.wahl))
        .collect();

    let default_h = herkunft_norm(herkunft_default);
    let dubletten: HashSet<(StammdatenArt, u32)> =
        dubletten_in_datei(paket, &default_h).into_iter().collect();
    let ohne_herkunft = |q: &Herkunftsangabe| {
        nicht_leer(&q.kennung).is_some() && wirksame_herkunft(q, &default_h).is_empty()
    };
    let herkunft_noetig = paket.fahrzeuge.iter().any(|a| ohne_herkunft(&a.quelle))
        || paket.personal.iter().any(|a| ohne_herkunft(&a.quelle))
        || paket
            .qualifikationen
            .iter()
            .any(|a| ohne_herkunft(&a.quelle));

    // --- Fahrzeuge ---------------------------------------------------------------------------
    let mut fz: Vec<Zeile> = Vec::with_capacity(paket.fahrzeuge.len());
    for a in &paket.fahrzeuge {
        let art = StammdatenArt::Fahrzeug;
        let h = wirksame_herkunft(&a.quelle, &default_h);
        let mut z = neue_zeile(art, a.zeile, a.funkrufname.clone(), &a.quelle, h.clone());
        let zuordnung = if dubletten.contains(&(art, a.zeile)) {
            Zuordnung::Fehler(DUBLETTE.into())
        } else {
            fahrzeug_zuordnen(&ix, &h, a)
        };
        let explizit = zeilen_wahl.get(&(art, a.zeile)).copied();
        let (ergebnis, absicht, kandidaten, grund, hinweise) =
            wahl_anwenden(art, a.zeile, zuordnung, explizit)?;
        z.vorschau.ergebnis = ergebnis;
        z.vorschau.grund = grund;
        z.vorschau.hinweise = hinweise;
        z.vorschau.kandidaten = kandidaten
            .iter()
            .map(|id| Kandidat {
                id: *id,
                anzeige: ix
                    .fahrzeug(*id)
                    .map(|f| f.funkrufname.clone())
                    .unwrap_or_default(),
            })
            .collect();
        z.absicht = absicht;
        z.vorschau.wahl = wirksame_wahl(absicht, explizit);
        ohne_kennung_hinweis(&mut z);
        let ziel = match absicht {
            Absicht::Ziel {
                id,
                grund,
                datei_uebernehmen,
            } => {
                let r = ix
                    .fahrzeug(id)
                    .ok_or_else(|| AppError::Internal("Fahrzeug fehlt im Bestand".into()))?;
                aenderungen_anwenden(fahrzeug_aenderungen(r, a), grund, datei_uebernehmen, &mut z);
                Some(&r.kennungen)
            }
            _ => None,
        };
        kennung_merken(&mut z, &ix, ziel, "Fahrzeug");
        fz.push(z);
    }
    gleiche_ziele(&mut fz, "Fahrzeug");
    let geplant = fz
        .iter()
        .zip(&paket.fahrzeuge)
        .map(|(z, a)| geplanter_wert(z, "funkrufname", Some(&a.funkrufname), norm))
        .collect();
    let mut im_dienst: HashMap<String, Vec<i64>> = HashMap::new();
    for f in b.fahrzeuge.iter().filter(|f| f.in_dienst) {
        im_dienst
            .entry(norm(&f.funkrufname))
            .or_default()
            .push(f.id);
    }
    kollisionen(&mut fz, geplant, &im_dienst, "Der Funkrufname");

    // --- Personal ----------------------------------------------------------------------------
    let mut ps: Vec<Zeile> = Vec::with_capacity(paket.personal.len());
    for a in &paket.personal {
        let art = StammdatenArt::Personal;
        let h = wirksame_herkunft(&a.quelle, &default_h);
        let mut z = neue_zeile(art, a.zeile, a.name.clone(), &a.quelle, h.clone());
        let zuordnung = if dubletten.contains(&(art, a.zeile)) {
            Zuordnung::Fehler(DUBLETTE.into())
        } else {
            personal_zuordnen(&ix, &h, a)
        };
        let explizit = zeilen_wahl.get(&(art, a.zeile)).copied();
        let (ergebnis, absicht, kandidaten, grund, hinweise) =
            wahl_anwenden(art, a.zeile, zuordnung, explizit)?;
        z.vorschau.ergebnis = ergebnis;
        z.vorschau.grund = grund;
        z.vorschau.hinweise = hinweise;
        z.vorschau.kandidaten = kandidaten
            .iter()
            .map(|id| Kandidat {
                id: *id,
                anzeige: ix
                    .personal(*id)
                    .map(|p| match &p.personalnummer {
                        Some(pn) => format!("{} ({pn})", p.name),
                        None => p.name.clone(),
                    })
                    .unwrap_or_default(),
            })
            .collect();
        z.absicht = absicht;
        z.vorschau.wahl = wirksame_wahl(absicht, explizit);
        ohne_kennung_hinweis(&mut z);
        let ziel = match absicht {
            Absicht::Ziel {
                id,
                grund,
                datei_uebernehmen,
            } => {
                let r = ix
                    .personal(id)
                    .ok_or_else(|| AppError::Internal("Person fehlt im Bestand".into()))?;
                aenderungen_anwenden(personal_aenderungen(r, a), grund, datei_uebernehmen, &mut z);
                Some(&r.kennungen)
            }
            _ => None,
        };
        kennung_merken(&mut z, &ix, ziel, "Personal");
        ps.push(z);
    }
    gleiche_ziele(&mut ps, "Personal");
    let geplant = ps
        .iter()
        .zip(&paket.personal)
        .map(|(z, a)| {
            geplanter_wert(
                z,
                "personalnummer",
                nicht_leer(&a.personalnummer),
                erkennungswert_norm,
            )
        })
        .collect();
    let mut im_dienst: HashMap<String, Vec<i64>> = HashMap::new();
    for p in b.personal.iter().filter(|p| p.in_dienst) {
        if let Some(n) = p
            .personalnummer
            .as_deref()
            .map(erkennungswert_norm)
            .filter(|n| !n.is_empty())
        {
            im_dienst.entry(n).or_default().push(p.id);
        }
    }
    kollisionen(&mut ps, geplant, &im_dienst, "Die Personalnummer");

    // --- Qualifikationen ---------------------------------------------------------------------
    let mut qs = QualiSammlung::default();
    for a in &paket.qualifikationen {
        let h = wirksame_herkunft(&a.quelle, &default_h);
        let i = qs.eintrag(&h, &a.bezeichnung);
        qs.eintraege[i].zeilen.push(a.zeile);
        match nicht_leer(&a.quelle.kennung) {
            Some(k) => {
                qs.alias(i, k);
                qs.nach_kennung.insert((h.clone(), norm(k)), i);
            }
            None => qs.alias(i, &norm(&a.bezeichnung)),
        }
        if dubletten.contains(&(StammdatenArt::Qualifikation, a.zeile)) {
            qs.eintraege[i].fehler = Some(DUBLETTE.into());
        }
    }
    // Je Personalzeile, die schreibt: die Einträge ihrer Qualifikationen.
    let p_qualis: Vec<Vec<usize>> = ps
        .iter()
        .zip(&paket.personal)
        .map(|(z, a)| {
            if matches!(z.absicht, Absicht::Neu | Absicht::Ziel { .. }) {
                let mut v: Vec<usize> = Vec::new();
                for t in &a.qualifikationen {
                    let i = qs.aus_personal(&z.herkunft, t);
                    if !v.contains(&i) {
                        v.push(i);
                    }
                }
                v
            } else {
                vec![]
            }
        })
        .collect();

    let (q_vorschau, q_schreiben, q_zaehlung, mut sperren) =
        qualifikationen_aufloesen(&ix, &qs.eintraege, &quali_wahl)?;

    // --- Qualifikationen am Personal, Zählung ------------------------------------------------
    let mut zaehlung = Zaehlung {
        qualifikationen: q_zaehlung,
        ..Zaehlung::default()
    };
    let mut zeilen: Vec<StammdatenZeile> = Vec::with_capacity(fz.len() + ps.len());
    let mut fahrzeuge = Vec::new();
    for (mut z, a) in fz.into_iter().zip(&paket.fahrzeuge) {
        zaehlen(&mut z, false, &mut zaehlung.fahrzeuge);
        sperren.extend(sperrt(&z));
        if let Some(ziel) = ziel_von(z.absicht) {
            fahrzeuge.push(FahrzeugSchreiben {
                angabe: a.clone(),
                ziel,
                setzen: std::mem::take(&mut z.setzen),
                kennung: z.kennung_schreiben.take(),
            });
        }
        zeilen.push(z.vorschau);
    }
    let mut personal = Vec::new();
    for ((mut z, a), eintraege) in ps.into_iter().zip(&paket.personal).zip(p_qualis) {
        let bisher: &[i64] = match z.absicht {
            Absicht::Ziel { id, .. } => ix
                .personal(id)
                .map(|p| p.qualifikation_ids.as_slice())
                .unwrap_or(&[]),
            _ => &[],
        };
        let mut bekommt: Vec<usize> = Vec::new();
        let mut ids: Vec<i64> = Vec::new();
        for i in eintraege {
            let s = &q_schreiben[i];
            let neu = match s.ziel {
                QualiZiel::Neu => Some(s.label.clone()),
                QualiZiel::Id(q) if !bisher.contains(&q) && !ids.contains(&q) => {
                    ids.push(q);
                    Some(
                        ix.qualifikation(q)
                            .map(|x| x.label.clone())
                            .unwrap_or_default(),
                    )
                }
                _ => None,
            };
            if let Some(label) = neu {
                bekommt.push(i);
                if matches!(z.absicht, Absicht::Ziel { .. }) {
                    z.vorschau.aenderungen.push(FeldAenderungDto {
                        feld: "qualifikationen".into(),
                        alt: None,
                        neu: label,
                        art: FeldAenderungArt::Fuellt,
                        erkennungsfeld: false,
                        uebernommen: true,
                    });
                }
            }
        }
        zaehlen(&mut z, !bekommt.is_empty(), &mut zaehlung.personal);
        sperren.extend(sperrt(&z));
        if let Some(ziel) = ziel_von(z.absicht) {
            personal.push(PersonalSchreiben {
                angabe: a.clone(),
                ziel,
                setzen: std::mem::take(&mut z.setzen),
                kennung: z.kennung_schreiben.take(),
                qualifikationen: bekommt,
            });
        }
        zeilen.push(z.vorschau);
    }

    for m in meldungen.iter().filter(|m| m.stufe == MeldungStufe::Fehler) {
        sperren.push(ZeilenGrund {
            art: ZeilenArt::Dateizeile,
            id: i64::from(m.zeile.unwrap_or(0)),
            grund: match m.art {
                Some(a) => format!("{}: {}", art_text(a), m.text),
                None => m.text.clone(),
            },
        });
    }
    let uebernehmbar = !herkunft_noetig && sperren.is_empty();
    Ok(Planung {
        vorschau: StammdatenVorschau {
            zaehlung,
            zeilen,
            qualifikationen: q_vorschau,
            meldungen: meldungen.to_vec(),
            nicht_uebernommen: nicht_uebernommen.to_vec(),
            herkunft_noetig,
            herkunft_vorschlag,
            uebernehmbar,
        },
        fahrzeuge,
        personal,
        qualifikationen: q_schreiben,
        sperren,
    })
}

fn ziel_von(a: Absicht) -> Option<Ziel> {
    match a {
        Absicht::Neu => Some(Ziel::Neu),
        Absicht::Ziel { id, .. } => Some(Ziel::Bestand(id)),
        _ => None,
    }
}

type QualiPlan = (
    Vec<QualiZeile>,
    Vec<QualiSchreiben>,
    ArtZaehlung,
    Vec<ZeilenGrund>,
);

/// Löst die Qualifikationen der Datei auf: zuerst über eine gemerkte Kennung (jede ihrer
/// Kennungen), dann über die Bezeichnung; wendet die Wahl an und zählt.
fn qualifikationen_aufloesen(
    ix: &BestandIndex,
    eintraege: &[QualiEintrag],
    quali_wahl: &HashMap<String, QualiWahl>,
) -> Result<QualiPlan, AppError> {
    let mut q_vorschau: Vec<QualiZeile> = Vec::with_capacity(eintraege.len());
    let mut q_schreiben: Vec<QualiSchreiben> = Vec::with_capacity(eintraege.len());
    let mut q_zaehlung = ArtZaehlung::default();
    let mut sperren: Vec<ZeilenGrund> = Vec::new();
    for e in eintraege {
        let h = &e.herkunft;
        let aliase_norm: Vec<String> = e.aliase.iter().map(|a| norm(a)).collect();
        let ueber_kennung = ix.qualifikationen_mit_kennung(h, aliase_norm.iter());
        let zuordnung = if let Some(f) = &e.fehler {
            Zuordnung::Fehler(f.clone())
        } else {
            match ueber_kennung.as_slice() {
                [] => qualifikation_zuordnen(ix, h, &e.text),
                [id] => Zuordnung::Gefunden {
                    id: *id,
                    grund: TrefferGrund::Kennung,
                },
                _ => Zuordnung::Mehrdeutig {
                    kandidaten: ueber_kennung.clone(),
                    hinweis: None,
                },
            }
        };
        let explizit = quali_wahl.get(&norm(&e.text)).copied();
        let gibt_es = || {
            AppError::Validation(format!(
                "Qualifikation „{}“: Eine gleichlautende gibt es schon; bitte zuordnen",
                e.text
            ))
        };
        let mut hinweise: Vec<String> = Vec::new();
        let (mut ergebnis, ziel, kandidaten, grund) = match zuordnung {
            Zuordnung::Fehler(t) => {
                hinweise.push(t);
                let z = if explizit == Some(QualiWahl::Auslassen) {
                    QualiZiel::Aus
                } else {
                    QualiZiel::Fehler
                };
                (ZeilenErgebnis::Fehler, z, vec![], None)
            }
            Zuordnung::Neu => {
                let z = match explizit {
                    None | Some(QualiWahl::Neu) => QualiZiel::Neu,
                    Some(QualiWahl::Zuordnen { qualifikation_id }) => {
                        QualiZiel::Id(qualifikation_id)
                    }
                    Some(QualiWahl::Auslassen) => QualiZiel::Aus,
                };
                (ZeilenErgebnis::Neu, z, vec![], None)
            }
            Zuordnung::Gefunden { id, grund } => {
                let z = match explizit {
                    None => QualiZiel::Id(id),
                    Some(QualiWahl::Zuordnen { qualifikation_id }) => {
                        QualiZiel::Id(qualifikation_id)
                    }
                    Some(QualiWahl::Auslassen) => QualiZiel::Aus,
                    Some(QualiWahl::Neu) => return Err(gibt_es()),
                };
                (ZeilenErgebnis::Gefunden, z, vec![id], Some(grund))
            }
            Zuordnung::Mehrdeutig { kandidaten, .. } => {
                let z = match explizit {
                    None => QualiZiel::Offen,
                    Some(QualiWahl::Zuordnen { qualifikation_id }) => {
                        QualiZiel::Id(qualifikation_id)
                    }
                    Some(QualiWahl::Auslassen) => QualiZiel::Aus,
                    Some(QualiWahl::Neu) => return Err(gibt_es()),
                };
                if z == QualiZiel::Offen {
                    hinweise.push("Mehrere Qualifikationen kommen in Frage: bitte zuordnen".into());
                }
                (ZeilenErgebnis::Mehrdeutig, z, kandidaten, None)
            }
            // Qualifikationen kennen keinen Dienststatus.
            Zuordnung::AusserDienst { id } => {
                (ZeilenErgebnis::Gefunden, QualiZiel::Id(id), vec![id], None)
            }
        };
        if let QualiZiel::Id(q) = ziel {
            if ix.qualifikation(q).is_some_and(|x| !x.aktiv) {
                hinweise.push(
                    "Die Qualifikation ist inaktiv; sie wird verknüpft und bleibt inaktiv".into(),
                );
            }
        }
        let mut kennungen: Vec<String> = Vec::new();
        if matches!(ziel, QualiZiel::Id(_) | QualiZiel::Neu) {
            if h.is_empty() {
                if matches!(explizit, Some(QualiWahl::Zuordnen { .. })) {
                    hinweise.push("Ohne Herkunft wird die Zuordnung nicht gemerkt".into());
                }
            } else {
                for (a, an) in e.aliase.iter().zip(&aliase_norm) {
                    let ziel_traegt = match ziel {
                        QualiZiel::Id(q) => ix
                            .qualifikation(q)
                            .is_some_and(|x| traegt(&x.kennungen, h, an)),
                        _ => false,
                    };
                    if ziel_traegt {
                        continue;
                    }
                    let art = StammdatenArt::Qualifikation;
                    if ix.kennung_getragen(art, h, an) || ix.kennung_belegt(art, h, an) {
                        hinweise.push(format!(
                            "„{a}“ ist schon einer anderen Qualifikation zugeordnet; das bleibt"
                        ));
                        continue;
                    }
                    kennungen.push(a.clone());
                }
            }
        }
        let wahl = explizit.or(match ziel {
            QualiZiel::Neu => Some(QualiWahl::Neu),
            _ => None,
        });
        match ziel {
            QualiZiel::Aus => q_zaehlung.ausgelassen += 1,
            QualiZiel::Offen => q_zaehlung.offen += 1,
            QualiZiel::Fehler => q_zaehlung.fehler += 1,
            QualiZiel::Neu => q_zaehlung.neu += 1,
            QualiZiel::Id(q) => {
                let umgehaengt = kandidaten.first() != Some(&q) || kandidaten.len() != 1;
                if kennungen.is_empty() && !umgehaengt {
                    q_zaehlung.unveraendert += 1;
                    if ergebnis == ZeilenErgebnis::Gefunden {
                        ergebnis = ZeilenErgebnis::Unveraendert;
                    }
                } else {
                    q_zaehlung.ergaenzt += 1;
                }
            }
        }
        if matches!(ziel, QualiZiel::Offen | QualiZiel::Fehler) {
            sperren.push(ZeilenGrund {
                art: ZeilenArt::Dateizeile,
                id: i64::from(e.zeilen.first().copied().unwrap_or(0)),
                grund: format!(
                    "Qualifikation „{}“: {}",
                    e.text,
                    hinweise.first().cloned().unwrap_or_default()
                ),
            });
        }
        q_vorschau.push(QualiZeile {
            text: e.text.clone(),
            zeilen: e.zeilen.clone(),
            ergebnis,
            grund,
            kandidaten: kandidaten
                .iter()
                .map(|id| kandidat_quali(ix, *id))
                .collect(),
            hinweise,
            wahl,
        });
        q_schreiben.push(QualiSchreiben {
            herkunft: h.clone(),
            label: e.text.clone(),
            ziel,
            kennungen,
        });
    }
    Ok((q_vorschau, q_schreiben, q_zaehlung, sperren))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::stammdaten_eingang::abgleich::{BestandFahrzeug, BestandPersonal};
    use crate::stammdaten_eingang::{FahrzeugAngabe, PersonalAngabe};

    /// F4: Der Abgleich ist nicht quadratisch. 2.000 Zeilen gegen 2.000 Datensätze je Art,
    /// jede Stufe belegt (Kennung, OPTA, Funkrufname, Personalnummer, Name, Kollisionen): mit
    /// Indizes Millisekunden, quadratisch mit `norm()` je Vergleich Sekunden.
    #[test]
    fn grosser_bestand_schnell() {
        const N: usize = 2_000;
        let h = "fv".to_string();
        let mut b = Bestand::default();
        for i in 0..N {
            let id = i as i64 + 1;
            b.fahrzeuge.push(BestandFahrzeug {
                id,
                funkrufname: format!("Florian {i}"),
                kennzeichen: None,
                opta: Some(format!("OPTA {i}")),
                fms_issi: None,
                fahrzeugtyp: None,
                standort: None,
                in_dienst: true,
                kennungen: if i % 2 == 0 {
                    vec![(h.clone(), format!("fz-{i}"))]
                } else {
                    vec![]
                },
            });
            b.personal.push(BestandPersonal {
                id,
                name: format!("Person{i}, Anna"),
                personalnummer: (i % 3 == 0).then(|| format!("PN {i}")),
                telefon: None,
                traegerorganisation: None,
                in_dienst: true,
                qualifikation_ids: vec![],
                kennungen: if i % 2 == 0 {
                    vec![(h.clone(), format!("p-{i}"))]
                } else {
                    vec![]
                },
            });
        }
        let mut paket = StammdatenPaket::default();
        for i in 0..N {
            paket.fahrzeuge.push(FahrzeugAngabe {
                zeile: i as u32 + 2,
                quelle: Herkunftsangabe {
                    kennung: Some(format!("fz-{i}")),
                    herkunft: None,
                },
                funkrufname: format!("Florian {i}"),
                kennzeichen: None,
                opta: (i % 4 == 1).then(|| format!("opta{i}")),
                issi: None,
                typ: None,
                standort: Some("Wache".into()),
            });
            paket.personal.push(PersonalAngabe {
                zeile: i as u32 + 2,
                quelle: Herkunftsangabe {
                    kennung: Some(format!("p-{i}")),
                    herkunft: None,
                },
                name: format!("Anna Person{i}"),
                personalnummer: (i % 3 == 0).then(|| format!("pn{i}")),
                telefon: None,
                traegerorganisation: None,
                qualifikationen: vec![format!("Quali {}", i % 50)],
            });
        }
        let start = std::time::Instant::now();
        let p = planen(
            &b,
            &paket,
            &[],
            &[],
            Some("FV"),
            None,
            &Entscheidungen::default(),
        )
        .unwrap();
        let dauer = start.elapsed();
        assert!(p.vorschau.uebernehmbar, "{:?}", p.sperren.first());
        assert_eq!(
            p.vorschau.zaehlung.fahrzeuge.ergaenzt as usize, N,
            "{:?}",
            p.vorschau.zaehlung
        );
        assert_eq!(p.vorschau.zaehlung.personal.ergaenzt as usize, N);
        assert_eq!(p.vorschau.zaehlung.qualifikationen.neu, 50);
        assert!(
            dauer < std::time::Duration::from_secs(2),
            "Abgleich dauerte {dauer:?}"
        );
    }
}
