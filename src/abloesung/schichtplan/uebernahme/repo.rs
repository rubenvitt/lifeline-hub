//! Bestand laden, Vorschau und Übernahme eines [`PlanPaket`]s (LLH-1556, design.md D4–D8).
//!
//! Drei Schritte, die Vorschau und Übernehmen teilen:
//!
//! 1. [`bestand_tx`] liest, was der Einsatz und seine Organisation schon haben.
//! 2. [`planen`] gleicht das Paket rein mit dem Bestand ab ([`super::abgleich`]) und rechnet je
//!    Block, ob er neu, ergänzt oder unverändert ist. Fehler sperren das Übernehmen.
//! 3. [`schreiben_tx`] schreibt eine fehlerfreie Planung, ohne zu committen.
//!
//! [`vorschau`] und [`uebernehmen`] laufen alle drei Schritte; das Übernehmen in EINER
//! Transaktion, sodass Vorschau und Schreiben denselben Stand sehen. LLH-1561 (Vorplanung) legt
//! den Einsatz an und ruft die drei Schritte in derselben Transaktion.

use std::collections::{BTreeMap, HashMap, HashSet};

use sqlx::{SqliteConnection, SqlitePool};

use super::abgleich::{
    self, norm, BestandAbschnitt, BestandEinheit, BestandHelfer, BestandStamm, BestandUhs,
};
use super::{
    BlockZustand, Entscheidungen, ImportAuswahl, ImportMeldung, ImportVorschau, ImportZaehlung,
    MeldungStufe, PaketPerson, PaketPostenArt, PersonAngabe, PersonEntscheidung, PersonZiel,
    PlanPaket, PostenEntscheidung, PostenZiel, QualiAngabe, Treffer, TrefferGrund, VorschauBlock,
    VorschauPerson, VorschauPosten, WahlEintrag,
};
use crate::abloesung::schichtplan::repo as plan_repo;
use crate::abloesung::schichtplan::{
    PlanPerson, Posten, SchichtplanGrenzwerte, PLAN_BLOECKE_MAX, PLAN_HELFER_MAX, PLAN_PERSONEN_MAX,
};
use crate::error::{AppError, ZeilenArt, ZeilenGrund};
use crate::personal::quali_soll::{self, QualiSollEingabe};
use crate::uhs::UhsTyp;
use crate::write_retry;
use crate::zeitdarstellung::Zeitstil;

/// Was der Benutzer außer Ablösung und Personal darf: neue Posten anlegen.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Rechte {
    pub einheiten: bool,
    pub uhs: bool,
}

// ---------------------------------------------------------------------------------------------
// Bestand
// ---------------------------------------------------------------------------------------------

/// Eine aktive Einheiten-Vorlage der Organisation.
#[derive(Debug, Clone, PartialEq, Eq, sqlx::FromRow)]
pub struct BestandVorlage {
    pub id: i64,
    pub name: String,
    pub typ_id: i64,
    pub soll_fuehrer: Option<i64>,
    pub soll_unterfuehrer: Option<i64>,
    pub soll_mannschaft: Option<i64>,
    pub quali_soll: Option<String>,
    pub tz_fachaufgabe: Option<String>,
    pub tz_organisation: Option<String>,
}

/// Ein Block des Einsatzes mit seinen Personen.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BestandBlock {
    pub id: i64,
    pub posten: Posten,
    pub von: String,
    pub bis: String,
    pub soll_anzahl: Option<i64>,
    pub quali_soll: Option<String>,
    pub personen: Vec<PlanPerson>,
}

/// Alles, womit ein Paket abgeglichen wird.
#[derive(Debug, Clone)]
pub struct Bestand {
    pub stil: Zeitstil,
    pub grenzwerte: SchichtplanGrenzwerte,
    /// Aktive Einheiten.
    pub einheiten: Vec<BestandEinheit>,
    /// UHS, die nicht aufgelöst oder storniert sind.
    pub uhs: Vec<BestandUhs>,
    /// Bezeichnungen ALLER UHS, normalisiert: eine Bezeichnung ist im Einsatz eindeutig, auch
    /// gegen aufgelöste.
    pub uhs_namen: HashSet<String>,
    pub abschnitte: Vec<BestandAbschnitt>,
    pub vorlagen: Vec<BestandVorlage>,
    /// Stamm-Personal im Dienst.
    pub stamm: Vec<BestandStamm>,
    pub helfer: Vec<BestandHelfer>,
    /// Aktive Qualifikationen der Organisation (Kennung, Bezeichnung).
    pub qualifikationen: Vec<(i64, String)>,
    pub bloecke: Vec<BestandBlock>,
}

/// id, name, telefon, kennung, herkunft eines Plan-Helfers.
type HelferRoh = (i64, String, Option<String>, Option<String>, Option<String>);
/// planschicht_id, personal_id, einsatz_personal_id, helfer_id.
type PersonRoh = (i64, Option<i64>, Option<i64>, Option<i64>);

/// Liest den Bestand des Einsatzes auf der offenen Verbindung.
pub async fn bestand_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    org_id: i64,
) -> Result<Bestand, AppError> {
    let stil = crate::zeitdarstellung::zeitstil_laden(&mut *conn, einsatz_id).await?;
    let grenzwerte = plan_repo::grenzwerte(&mut *conn, einsatz_id).await?;

    let einheiten: Vec<(i64, String, Option<String>, Option<i64>)> = sqlx::query_as(
        "SELECT id, name, funkrufname, abschnitt_id FROM einsatz_einheit \
         WHERE einsatz_id = ? AND aufgeloest_at IS NULL ORDER BY sortier, name COLLATE NOCASE, id",
    )
    .bind(einsatz_id)
    .fetch_all(&mut *conn)
    .await?;
    let alle_uhs: Vec<(i64, String, Option<i64>, bool)> = sqlx::query_as(
        "SELECT id, bezeichnung, abschnitt_id, \
                (status <> 'aufgeloest' AND storniert_at IS NULL) AS aktiv \
         FROM uhs WHERE einsatz_id = ? ORDER BY bezeichnung COLLATE NOCASE, id",
    )
    .bind(einsatz_id)
    .fetch_all(&mut *conn)
    .await?;
    let abschnitte: Vec<(i64, String, Option<String>)> = sqlx::query_as(
        "SELECT id, name, kurzbezeichnung FROM einsatzabschnitt WHERE einsatz_id = ? \
         ORDER BY sortier, name COLLATE NOCASE, id",
    )
    .bind(einsatz_id)
    .fetch_all(&mut *conn)
    .await?;
    let vorlagen: Vec<BestandVorlage> = sqlx::query_as(
        "SELECT id, name, typ_id, soll_fuehrer, soll_unterfuehrer, soll_mannschaft, quali_soll, \
                tz_fachaufgabe, tz_organisation \
         FROM einheit_vorlage WHERE org_id = ? AND aktiv = 1 \
         ORDER BY sortier, name COLLATE NOCASE, id",
    )
    .bind(org_id)
    .fetch_all(&mut *conn)
    .await?;
    let stamm: Vec<(i64, String, Option<String>, Option<String>)> = sqlx::query_as(
        "SELECT id, name, personalnummer, telefon FROM personal \
         WHERE org_id = ? AND dienststatus = 'in_dienst' ORDER BY name COLLATE NOCASE, id",
    )
    .bind(org_id)
    .fetch_all(&mut *conn)
    .await?;
    let helfer: Vec<HelferRoh> = sqlx::query_as(
        "SELECT id, name, telefon, kennung, herkunft FROM einsatz_plan_helfer \
             WHERE einsatz_id = ? ORDER BY name COLLATE NOCASE, id",
    )
    .bind(einsatz_id)
    .fetch_all(&mut *conn)
    .await?;
    let qualifikationen: Vec<(i64, String)> = sqlx::query_as(
        "SELECT id, label FROM qualifikation WHERE org_id = ? AND aktiv = 1 \
         ORDER BY sortier, label COLLATE NOCASE, id",
    )
    .bind(org_id)
    .fetch_all(&mut *conn)
    .await?;

    type BlockRoh = (
        i64,
        String,
        Option<i64>,
        Option<i64>,
        String,
        String,
        Option<i64>,
        Option<String>,
    );
    let bloecke_roh: Vec<BlockRoh> = sqlx::query_as(
        "SELECT id, posten_art, einheit_id, uhs_id, von, bis, soll_anzahl, quali_soll \
         FROM einsatz_planschicht WHERE einsatz_id = ? ORDER BY von, id",
    )
    .bind(einsatz_id)
    .fetch_all(&mut *conn)
    .await?;
    let personen_roh: Vec<PersonRoh> = sqlx::query_as(
        "SELECT pp.planschicht_id, pp.personal_id, pp.einsatz_personal_id, pp.helfer_id \
         FROM einsatz_planschicht_person pp \
         JOIN einsatz_planschicht p ON p.id = pp.planschicht_id \
         WHERE p.einsatz_id = ? ORDER BY pp.rowid",
    )
    .bind(einsatz_id)
    .fetch_all(&mut *conn)
    .await?;
    let mut personen_je_block: HashMap<i64, Vec<PlanPerson>> = HashMap::new();
    for (bid, stamm_id, adhoc_id, helfer_id) in personen_roh {
        if let Some(p) = PlanPerson::aus_spalten(stamm_id, adhoc_id, helfer_id) {
            personen_je_block.entry(bid).or_default().push(p);
        }
    }
    let bloecke = bloecke_roh
        .into_iter()
        .filter_map(|(id, art, einheit_id, uhs_id, von, bis, soll, quali)| {
            Some(BestandBlock {
                id,
                posten: Posten::aus_spalten(&art, einheit_id, uhs_id)?,
                von,
                bis,
                soll_anzahl: soll,
                quali_soll: quali,
                personen: personen_je_block.remove(&id).unwrap_or_default(),
            })
        })
        .collect();

    Ok(Bestand {
        stil,
        grenzwerte,
        einheiten: einheiten
            .into_iter()
            .map(|(id, name, funkrufname, abschnitt_id)| BestandEinheit {
                id,
                name,
                funkrufname,
                abschnitt_id,
            })
            .collect(),
        uhs_namen: alle_uhs.iter().map(|u| norm(&u.1)).collect(),
        uhs: alle_uhs
            .into_iter()
            .filter(|u| u.3)
            .map(|(id, bezeichnung, abschnitt_id, _)| BestandUhs {
                id,
                bezeichnung,
                abschnitt_id,
            })
            .collect(),
        abschnitte: abschnitte
            .into_iter()
            .map(|(id, name, kurzbezeichnung)| BestandAbschnitt {
                id,
                name,
                kurzbezeichnung,
            })
            .collect(),
        vorlagen,
        stamm: stamm
            .into_iter()
            .map(|(id, name, personalnummer, telefon)| BestandStamm {
                id,
                name,
                personalnummer,
                telefon,
            })
            .collect(),
        helfer: helfer
            .into_iter()
            .map(|(id, name, telefon, kennung, herkunft)| BestandHelfer {
                id,
                name,
                telefon,
                kennung,
                herkunft,
            })
            .collect(),
        qualifikationen,
        bloecke,
    })
}

// ---------------------------------------------------------------------------------------------
// Planung (rein)
// ---------------------------------------------------------------------------------------------

/// Wohin ein Posten des Pakets geht.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
enum Ziel {
    Bestehend(Posten),
    /// Index in [`Planung::neue_einheiten`].
    NeueEinheit(usize),
    /// Index in [`Planung::neue_uhs`].
    NeueUhs(usize),
    /// Nicht übernehmbar; die Meldung steht am Posten.
    Fehler,
}

/// Wer eine Person des Pakets ist.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
enum Wer {
    Stamm(i64),
    Helfer(i64),
    /// Index in [`Planung::neue_helfer`].
    NeuerHelfer(usize),
    Fehler,
}

/// Eine Einheit, die das Übernehmen anlegt.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NeueEinheit {
    pub name: String,
    pub abschnitt_id: Option<i64>,
    pub vorlage: Option<BestandVorlage>,
    pub sortier: Option<i64>,
}

/// Eine UHS, die das Übernehmen anlegt.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NeueUhs {
    pub bezeichnung: String,
    pub abschnitt_id: Option<i64>,
    pub typ: UhsTyp,
}

/// Ein Helfer, den das Übernehmen anlegt.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NeuerHelfer {
    pub name: String,
    pub telefon: Option<String>,
    pub organisation: Option<String>,
    pub qualifikationen: Vec<i64>,
    pub kennung: Option<String>,
    pub herkunft: Option<String>,
}

/// Ein Block nach dem Abgleich.
#[derive(Debug, Clone)]
struct GeplanterBlock {
    ziel: Ziel,
    /// Schlüssel des Postens im Paket (für die Vorschau).
    posten: String,
    von: String,
    bis: String,
    zustand: BlockZustand,
    block_id: Option<i64>,
    /// Soll aus dem Paket; fehlt = Vorgabe des Postens.
    soll_anzahl: Option<i64>,
    quali_soll: Option<String>,
    notiz: Option<String>,
    /// Alle Personen laut Paket, entdoppelt.
    personen: Vec<Wer>,
    /// Davon nicht schon im Block.
    neue: Vec<Wer>,
    zeile: Option<u32>,
}

/// Ergebnis von [`planen`]: Vorschau und, ohne Fehler, was [`schreiben_tx`] schreibt.
#[derive(Debug, Clone)]
pub struct Planung {
    pub vorschau: ImportVorschau,
    neue_einheiten: Vec<NeueEinheit>,
    neue_uhs: Vec<NeueUhs>,
    neue_helfer: Vec<NeuerHelfer>,
    bloecke: Vec<GeplanterBlock>,
    /// Grenzwerte, die das Übernehmen setzt (je Wert nur ohne eigenen des Einsatzes).
    grenzwerte: Option<(Option<i64>, Option<i64>)>,
    /// Ein neuer Posten verlangt ein Modul, das der Benutzer nicht hat (403 beim Übernehmen).
    pub fehlende_rechte: bool,
}

impl Planung {
    pub fn uebernehmbar(&self) -> bool {
        self.vorschau.uebernehmbar
    }
}

fn erste(zeilen: &[u32]) -> Option<u32> {
    zeilen.first().copied()
}

/// Die gespeicherte Form eines Qualifikationssolls als sortierte Paare, zum Vergleichen.
fn quali_paare(json: Option<&str>) -> Vec<(i64, i64)> {
    #[derive(serde::Deserialize)]
    struct Eintrag {
        q: i64,
        n: i64,
    }
    let mut paare: Vec<(i64, i64)> = json
        .and_then(|j| serde_json::from_str::<Vec<Eintrag>>(j).ok())
        .unwrap_or_default()
        .into_iter()
        .map(|e| (e.q, e.n))
        .collect();
    paare.sort_unstable();
    paare
}

/// Löst Qualifikationen des Pakets in Kennungen der Organisation auf; unbekannte melden einen
/// Hinweis (einmal je Bezeichnung) und fallen weg.
struct Qualis<'a> {
    katalog: &'a [(i64, String)],
    gemeldet: HashSet<String>,
}

impl<'a> Qualis<'a> {
    fn neu(katalog: &'a [(i64, String)]) -> Self {
        Self {
            katalog,
            gemeldet: HashSet::new(),
        }
    }

    fn id(
        &mut self,
        angabe: &QualiAngabe,
        zeile: Option<u32>,
        meldungen: &mut Vec<ImportMeldung>,
    ) -> Option<i64> {
        let gefunden = match angabe {
            QualiAngabe::Id(id) => self.katalog.iter().find(|(k, _)| k == id).map(|q| q.0),
            QualiAngabe::Bezeichnung(b) => {
                let n = norm(b);
                self.katalog.iter().find(|(_, l)| norm(l) == n).map(|q| q.0)
            }
        };
        if gefunden.is_none() {
            let text = match angabe {
                QualiAngabe::Id(id) => format!("#{id}"),
                QualiAngabe::Bezeichnung(b) => b.trim().to_string(),
            };
            if self.gemeldet.insert(norm(&text)) {
                meldungen.push(ImportMeldung::hinweis(
                    zeile,
                    format!("Qualifikation «{text}» unbekannt, ausgelassen"),
                ));
            }
        }
        gefunden
    }
}

fn einheit_bezeichnung(b: &Bestand, id: i64) -> Option<&str> {
    b.einheiten
        .iter()
        .find(|e| e.id == id)
        .map(|e| e.name.as_str())
}

fn uhs_bezeichnung(b: &Bestand, id: i64) -> Option<&str> {
    b.uhs
        .iter()
        .find(|u| u.id == id)
        .map(|u| u.bezeichnung.as_str())
}

fn stamm_name(b: &Bestand, id: i64) -> Option<&str> {
    b.stamm.iter().find(|s| s.id == id).map(|s| s.name.as_str())
}

fn helfer_name(b: &Bestand, id: i64) -> Option<&str> {
    b.helfer
        .iter()
        .find(|h| h.id == id)
        .map(|h| h.name.as_str())
}

/// Gleicht `paket` mit dem Bestand ab, rein. `meldungen` sind die des Lesens (Datei); die
/// Planung fügt ihre hinzu. Eine Entscheidung zu einem unbekannten Schlüssel ist 400.
pub fn planen(
    bestand: &Bestand,
    paket: &PlanPaket,
    meldungen: Vec<ImportMeldung>,
    entscheidungen: &Entscheidungen,
    rechte: Rechte,
) -> Result<Planung, AppError> {
    let mut meldungen = meldungen;
    for s in entscheidungen.posten.keys() {
        if !paket.posten.iter().any(|p| &p.schluessel == s) {
            return Err(AppError::Validation(format!("Unbekannter Posten '{s}'")));
        }
    }
    for s in entscheidungen.personen.keys() {
        if !paket.personen.iter().any(|p| p.schluessel() == s) {
            return Err(AppError::Validation(format!("Unbekannte Person '{s}'")));
        }
    }
    let mut qualis = Qualis::neu(&bestand.qualifikationen);
    let mut fehlende_rechte = false;

    // --- Posten (D4) ---
    let mut neue_einheiten: Vec<NeueEinheit> = Vec::new();
    let mut neue_uhs: Vec<NeueUhs> = Vec::new();
    let mut posten_ziel: HashMap<&str, Ziel> = HashMap::new();
    let mut vorschau_posten: Vec<VorschauPosten> = Vec::new();
    for p in &paket.posten {
        let zeile = erste(&p.zeilen);
        let abschnitt_id = match p.abschnitt.as_deref().filter(|a| !a.trim().is_empty()) {
            Some(a) => {
                let gefunden = abgleich::finde_abschnitt(&bestand.abschnitte, a);
                if gefunden.is_none() {
                    meldungen.push(ImportMeldung::hinweis(
                        zeile,
                        format!("Abschnitt «{}» nicht gefunden", a.trim()),
                    ));
                }
                gefunden
            }
            None => None,
        };
        let vorschlag = abgleich::posten_vorschlag(
            p.art,
            &p.name,
            abschnitt_id,
            p.einheit_vorlage_id,
            &bestand.einheiten,
            &bestand.uhs,
        );
        let (mut ziel_anzeige, mut treffer, kandidaten) =
            (vorschlag.ziel, vorschlag.treffer, vorschlag.kandidaten);
        if p.art != PaketPostenArt::Pause {
            if let Some(e) = entscheidungen.posten.get(&p.schluessel) {
                treffer = Treffer::Sicher;
                ziel_anzeige = match *e {
                    PostenEntscheidung::Einheit { einheit_id } => PostenZiel::Einheit {
                        einheit_id,
                        bezeichnung: einheit_bezeichnung(bestand, einheit_id)
                            .unwrap_or_default()
                            .to_string(),
                    },
                    PostenEntscheidung::Uhs { uhs_id } => PostenZiel::Uhs {
                        uhs_id,
                        bezeichnung: uhs_bezeichnung(bestand, uhs_id)
                            .unwrap_or_default()
                            .to_string(),
                    },
                    PostenEntscheidung::Neu { einheit_vorlage_id } => {
                        treffer = Treffer::Neu;
                        PostenZiel::Neu { einheit_vorlage_id }
                    }
                };
            } else if treffer == Treffer::Unsicher {
                meldungen.push(ImportMeldung::hinweis(
                    zeile,
                    format!("Posten «{}»: mehrere Treffer", p.name),
                ));
            }
        }
        let ziel = match &ziel_anzeige {
            PostenZiel::Pause => Ziel::Bestehend(Posten::Pause),
            PostenZiel::Einheit { einheit_id, .. } => {
                if einheit_bezeichnung(bestand, *einheit_id).is_some() {
                    Ziel::Bestehend(Posten::Einheit(*einheit_id))
                } else {
                    meldungen.push(ImportMeldung::fehler(
                        zeile,
                        format!("Posten «{}»: Einheit nicht wählbar", p.name),
                    ));
                    Ziel::Fehler
                }
            }
            PostenZiel::Uhs { uhs_id, .. } => {
                if uhs_bezeichnung(bestand, *uhs_id).is_some() {
                    Ziel::Bestehend(Posten::Uhs(*uhs_id))
                } else {
                    meldungen.push(ImportMeldung::fehler(
                        zeile,
                        format!("Posten «{}»: UHS nicht wählbar", p.name),
                    ));
                    Ziel::Fehler
                }
            }
            PostenZiel::Neu { einheit_vorlage_id } => neuer_posten(
                bestand,
                p,
                abschnitt_id,
                *einheit_vorlage_id,
                zeile,
                &mut neue_einheiten,
                &mut neue_uhs,
                &mut meldungen,
            ),
        };
        // Wie beim Schreiben von Hand (LLH-1552): ein Block an einer Einheit verlangt das Modul
        // Einheiten, an einer UHS das Modul Unfallhilfsstellen, ob der Posten neu ist oder nicht.
        let ziel = match ziel {
            Ziel::Bestehend(Posten::Einheit(_)) | Ziel::NeueEinheit(_) if !rechte.einheiten => {
                fehlende_rechte = true;
                meldungen.push(ImportMeldung::fehler(
                    zeile,
                    format!("Posten «{}»: keine Freigabe für Einheiten", p.name),
                ));
                Ziel::Fehler
            }
            Ziel::Bestehend(Posten::Uhs(_)) | Ziel::NeueUhs(_) if !rechte.uhs => {
                fehlende_rechte = true;
                meldungen.push(ImportMeldung::fehler(
                    zeile,
                    format!("Posten «{}»: keine Freigabe für Unfallhilfsstellen", p.name),
                ));
                Ziel::Fehler
            }
            z => z,
        };
        if let Some(fid) = p.fahrzeug_id {
            if matches!(
                ziel,
                Ziel::NeueEinheit(_) | Ziel::Bestehend(Posten::Einheit(_))
            ) {
                meldungen.push(ImportMeldung::hinweis(
                    zeile,
                    format!("Posten «{}»: Fahrzeug #{fid} nicht disponiert", p.name),
                ));
            }
        }
        posten_ziel.insert(p.schluessel.as_str(), ziel);
        vorschau_posten.push(VorschauPosten {
            schluessel: p.schluessel.clone(),
            art: p.art,
            name: p.name.clone(),
            abschnitt: p.abschnitt.clone(),
            abschnitt_id,
            ziel: ziel_anzeige,
            treffer,
            kandidaten,
            zeilen: p.zeilen.clone(),
            bloecke: 0,
        });
    }

    // --- Personen (D5) ---
    let mut neue_helfer: Vec<NeuerHelfer> = Vec::new();
    let mut person_wer: HashMap<&str, Wer> = HashMap::new();
    let mut vorschau_personen: Vec<VorschauPerson> = Vec::new();
    for person in &paket.personen {
        let (wer, vp) = match person {
            PaketPerson::Stamm {
                schluessel,
                personal_id,
            } => {
                let name = stamm_name(bestand, *personal_id);
                let wer = if name.is_some() {
                    Wer::Stamm(*personal_id)
                } else {
                    meldungen.push(ImportMeldung::fehler(
                        None,
                        format!("Person #{personal_id} nicht im Dienst"),
                    ));
                    Wer::Fehler
                };
                let name = name.unwrap_or_default().to_string();
                (
                    wer,
                    VorschauPerson {
                        schluessel: schluessel.clone(),
                        name: name.clone(),
                        telefon: None,
                        kennung: None,
                        herkunft: None,
                        ziel: PersonZiel::Stamm {
                            personal_id: *personal_id,
                            name,
                        },
                        treffer: Treffer::Sicher,
                        grund: Some(TrefferGrund::Bezug),
                        kandidaten: Vec::new(),
                        zeilen: Vec::new(),
                        bloecke: 0,
                    },
                )
            }
            PaketPerson::Angabe(a) => person_planen(
                bestand,
                a,
                entscheidungen.personen.get(&a.schluessel).copied(),
                &mut qualis,
                &mut neue_helfer,
                &mut meldungen,
            ),
        };
        person_wer.insert(person.schluessel(), wer);
        vorschau_personen.push(vp);
    }

    // --- Blöcke (D6) ---
    // Gleiche Blöcke der Datei (gleiches Ziel, Beginn, Ende) fallen zusammen.
    let mut gruppen: Vec<GeplanterBlock> = Vec::new();
    let mut index: HashMap<(Ziel, String, String), usize> = HashMap::new();
    let mut bloecke_je_posten: HashMap<&str, i64> = HashMap::new();
    let mut bloecke_je_person: HashMap<&str, i64> = HashMap::new();
    for b in &paket.bloecke {
        let ziel = posten_ziel
            .get(b.posten.as_str())
            .copied()
            .unwrap_or(Ziel::Fehler);
        *bloecke_je_posten.entry(b.posten.as_str()).or_default() += 1;
        let mut personen: Vec<Wer> = Vec::new();
        for s in &b.personen {
            *bloecke_je_person.entry(s.as_str()).or_default() += 1;
            match person_wer.get(s.as_str()).copied() {
                Some(Wer::Fehler) | None => {}
                Some(w) => {
                    if !personen.contains(&w) {
                        personen.push(w);
                    }
                }
            }
        }
        let quali_soll = match &b.quali_soll {
            None => None,
            Some(liste) => {
                let mut eintraege: Vec<QualiSollEingabe> = Vec::new();
                for q in liste {
                    if let Some(id) = qualis.id(&q.qualifikation, b.zeile, &mut meldungen) {
                        match eintraege.iter_mut().find(|e| e.qualifikation_id == id) {
                            Some(e) => e.anzahl += q.anzahl,
                            None => eintraege.push(QualiSollEingabe {
                                qualifikation_id: id,
                                anzahl: q.anzahl,
                            }),
                        }
                    }
                }
                match quali_soll::form(&eintraege) {
                    Ok(f) => f,
                    Err(e) => {
                        meldungen.push(ImportMeldung::fehler(b.zeile, e.to_string()));
                        None
                    }
                }
            }
        };
        let schluessel = (ziel, b.von.clone(), b.bis.clone());
        match (ziel, index.get(&schluessel)) {
            (Ziel::Fehler, _) | (_, None) => {
                if ziel != Ziel::Fehler {
                    index.insert(schluessel, gruppen.len());
                }
                gruppen.push(GeplanterBlock {
                    ziel,
                    posten: b.posten.clone(),
                    von: b.von.clone(),
                    bis: b.bis.clone(),
                    zustand: if ziel == Ziel::Fehler {
                        BlockZustand::Fehler
                    } else {
                        BlockZustand::Neu
                    },
                    block_id: None,
                    soll_anzahl: b.soll_anzahl,
                    quali_soll,
                    notiz: b.notiz.clone(),
                    personen,
                    neue: Vec::new(),
                    zeile: b.zeile,
                });
            }
            (_, Some(&i)) => {
                let g = &mut gruppen[i];
                for w in personen {
                    if !g.personen.contains(&w) {
                        g.personen.push(w);
                    }
                }
            }
        }
    }

    // Abgleich mit dem Bestand und Überschneidungen.
    for i in 0..gruppen.len() {
        if gruppen[i].zustand == BlockZustand::Fehler {
            continue;
        }
        let g = gruppen[i].clone();
        let mut fehler: Option<String> = None;
        if let Ziel::Bestehend(posten) = g.ziel {
            let gleich = bestand
                .bloecke
                .iter()
                .find(|x| x.posten == posten && x.von == g.von && x.bis == g.bis);
            if let Some(x) = gleich {
                let neue: Vec<Wer> = g
                    .personen
                    .iter()
                    .copied()
                    .filter(|w| match w {
                        Wer::Stamm(id) => !x.personen.contains(&PlanPerson::Stamm(*id)),
                        Wer::Helfer(id) => !x.personen.contains(&PlanPerson::Helfer(*id)),
                        _ => true,
                    })
                    .collect();
                if x.personen.len() + neue.len() > PLAN_PERSONEN_MAX {
                    fehler = Some(format!("Höchstens {PLAN_PERSONEN_MAX} Personen je Schicht"));
                }
                let soll_weicht_ab = g.soll_anzahl.is_some_and(|n| Some(n) != x.soll_anzahl)
                    || (g.quali_soll.is_some()
                        && quali_paare(g.quali_soll.as_deref())
                            != quali_paare(x.quali_soll.as_deref()));
                if soll_weicht_ab && posten != Posten::Pause {
                    meldungen.push(ImportMeldung::hinweis(
                        g.zeile,
                        "Soll weicht ab, bleibt".to_string(),
                    ));
                }
                let z = &mut gruppen[i];
                z.block_id = Some(x.id);
                z.zustand = if neue.is_empty() {
                    BlockZustand::Unveraendert
                } else {
                    BlockZustand::Ergaenzt
                };
                z.neue = neue;
            } else if posten != Posten::Pause {
                if let Some(x) = bestand
                    .bloecke
                    .iter()
                    .find(|x| x.posten == posten && x.von < g.bis && x.bis > g.von)
                {
                    fehler = Some(format!(
                        "Überschneidet sich mit {}",
                        zeitraum(&bestand.stil, &x.von, &x.bis)
                    ));
                }
            }
        }
        if fehler.is_none() && gruppen[i].zustand == BlockZustand::Neu {
            gruppen[i].neue = g.personen.clone();
            if g.personen.len() > PLAN_PERSONEN_MAX {
                fehler = Some(format!("Höchstens {PLAN_PERSONEN_MAX} Personen je Schicht"));
            }
        }
        // Überschneidung innerhalb der Datei, gegen frühere Blöcke desselben Ziels.
        if fehler.is_none() && g.ziel != Ziel::Bestehend(Posten::Pause) {
            if let Some(andere) = gruppen[..i].iter().find(|o| {
                o.ziel == g.ziel
                    && o.zustand != BlockZustand::Fehler
                    && o.von < g.bis
                    && o.bis > g.von
            }) {
                fehler = Some(match andere.zeile {
                    Some(z) => format!("Überschneidet sich mit Zeile {z}"),
                    None => format!(
                        "Überschneidet sich mit {}",
                        zeitraum(&bestand.stil, &andere.von, &andere.bis)
                    ),
                });
            }
        }
        if let Some(text) = fehler {
            meldungen.push(ImportMeldung::fehler(g.zeile, text));
            gruppen[i].zustand = BlockZustand::Fehler;
        }
    }

    // --- Grenzen ---
    let bloecke_neu = gruppen
        .iter()
        .filter(|g| g.zustand == BlockZustand::Neu)
        .count() as i64;
    if bestand.bloecke.len() as i64 + bloecke_neu > PLAN_BLOECKE_MAX {
        meldungen.push(ImportMeldung::fehler(
            None,
            format!("Höchstens {PLAN_BLOECKE_MAX} Schichten je Einsatz"),
        ));
    }
    // Ein neuer Helfer, Posten zählt nur, wenn ein Block ihn braucht.
    let wirksam =
        |g: &&GeplanterBlock| matches!(g.zustand, BlockZustand::Neu | BlockZustand::Ergaenzt);
    let gebraucht_helfer: HashSet<usize> = gruppen
        .iter()
        .filter(wirksam)
        .flat_map(|g| g.neue.iter())
        .filter_map(|w| match w {
            Wer::NeuerHelfer(i) => Some(*i),
            _ => None,
        })
        .collect();
    if bestand.helfer.len() as i64 + gebraucht_helfer.len() as i64 > PLAN_HELFER_MAX {
        meldungen.push(ImportMeldung::fehler(
            None,
            format!("Höchstens {PLAN_HELFER_MAX} Helfer je Einsatz"),
        ));
    }
    let gebraucht_einheiten: HashSet<usize> = gruppen
        .iter()
        .filter(wirksam)
        .filter_map(|g| match g.ziel {
            Ziel::NeueEinheit(i) => Some(i),
            _ => None,
        })
        .collect();
    let gebraucht_uhs: HashSet<usize> = gruppen
        .iter()
        .filter(wirksam)
        .filter_map(|g| match g.ziel {
            Ziel::NeueUhs(i) => Some(i),
            _ => None,
        })
        .collect();

    // --- Grenzwerte aus der Vorplanung: nur, wo der Einsatz keine eigenen hat ---
    let grenzwerte = paket.grenzwerte.and_then(|g| {
        let max = g
            .max_dienst_min
            .filter(|_| !bestand.grenzwerte.max_dienst_eigen);
        let ruhe = g
            .min_ruhe_min
            .filter(|_| !bestand.grenzwerte.min_ruhe_eigen);
        (max.is_some() || ruhe.is_some()).then_some((max, ruhe))
    });

    // --- Zählung und Vorschau ---
    let mut zaehlung = ImportZaehlung {
        einheiten_neu: gebraucht_einheiten.len() as i64,
        uhs_neu: gebraucht_uhs.len() as i64,
        bloecke_neu,
        bloecke_ergaenzt: gruppen
            .iter()
            .filter(|g| g.zustand == BlockZustand::Ergaenzt)
            .count() as i64,
        bloecke_unveraendert: gruppen
            .iter()
            .filter(|g| g.zustand == BlockZustand::Unveraendert)
            .count() as i64,
        helfer_neu: gebraucht_helfer.len() as i64,
        einteilungen_neu: gruppen
            .iter()
            .filter(wirksam)
            .map(|g| g.neue.len() as i64)
            .sum(),
        grenzwerte_neu: grenzwerte
            .map_or(0, |(a, b)| i64::from(a.is_some()) + i64::from(b.is_some())),
        aenderungen: 0,
    };
    zaehlung.summe();

    for vp in &mut vorschau_posten {
        vp.bloecke = bloecke_je_posten
            .get(vp.schluessel.as_str())
            .copied()
            .unwrap_or(0);
    }
    for vp in &mut vorschau_personen {
        vp.bloecke = bloecke_je_person
            .get(vp.schluessel.as_str())
            .copied()
            .unwrap_or(0);
    }
    let vorschau_bloecke = gruppen
        .iter()
        .map(|g| VorschauBlock {
            posten: g.posten.clone(),
            von: g.von.clone(),
            bis: g.bis.clone(),
            zustand: g.zustand,
            block_id: g.block_id,
            personen: g.personen.len() as i64,
            neue_personen: if wirksam(&g) { g.neue.len() as i64 } else { 0 },
            zeile: g.zeile,
        })
        .collect();

    meldungen.sort_by_key(|m| {
        (
            m.stufe != MeldungStufe::Fehler,
            m.zeile.is_some(),
            m.zeile.unwrap_or(0),
        )
    });
    let uebernehmbar = !meldungen.iter().any(|m| m.stufe == MeldungStufe::Fehler);
    let auswahl = ImportAuswahl {
        einheiten: bestand
            .einheiten
            .iter()
            .map(|e| WahlEintrag {
                id: e.id,
                bezeichnung: e.name.clone(),
                abschnitt_id: e.abschnitt_id,
            })
            .collect(),
        uhs: bestand
            .uhs
            .iter()
            .map(|u| WahlEintrag {
                id: u.id,
                bezeichnung: u.bezeichnung.clone(),
                abschnitt_id: u.abschnitt_id,
            })
            .collect(),
        vorlagen: bestand
            .vorlagen
            .iter()
            .map(|v| WahlEintrag {
                id: v.id,
                bezeichnung: v.name.clone(),
                abschnitt_id: None,
            })
            .collect(),
        abschnitte: bestand
            .abschnitte
            .iter()
            .map(|a| WahlEintrag {
                id: a.id,
                bezeichnung: a.name.clone(),
                abschnitt_id: None,
            })
            .collect(),
    };

    Ok(Planung {
        vorschau: ImportVorschau {
            posten: vorschau_posten,
            personen: vorschau_personen,
            bloecke: vorschau_bloecke,
            meldungen,
            zaehlung,
            auswahl,
            uebernehmbar,
        },
        neue_einheiten,
        neue_uhs,
        neue_helfer,
        bloecke: gruppen,
        grenzwerte,
        fehlende_rechte,
    })
}

fn zeitraum(stil: &Zeitstil, von: &str, bis: &str) -> String {
    plan_repo::zeitraum_text(stil, von, bis)
}

/// Ein neuer Posten: Vorlage, eindeutige Bezeichnung. Gleiche neue Posten (Name und Abschnitt)
/// fallen zusammen. Die Rechte prüft der Aufrufer.
#[allow(clippy::too_many_arguments)]
fn neuer_posten(
    bestand: &Bestand,
    p: &super::PaketPosten,
    abschnitt_id: Option<i64>,
    vorlage_id: Option<i64>,
    zeile: Option<u32>,
    neue_einheiten: &mut Vec<NeueEinheit>,
    neue_uhs: &mut Vec<NeueUhs>,
    meldungen: &mut Vec<ImportMeldung>,
) -> Ziel {
    let name = p.name.trim().to_string();
    if name.is_empty() {
        meldungen.push(ImportMeldung::fehler(zeile, "Posten ohne Namen"));
        return Ziel::Fehler;
    }
    match p.art {
        PaketPostenArt::Pause => Ziel::Bestehend(Posten::Pause),
        PaketPostenArt::Einheit | PaketPostenArt::Fahrzeug => {
            if name.chars().count() > crate::einheit::NAME_MAX {
                meldungen.push(ImportMeldung::fehler(
                    zeile,
                    format!(
                        "Name einer Einheit höchstens {} Zeichen",
                        crate::einheit::NAME_MAX
                    ),
                ));
                return Ziel::Fehler;
            }
            let vorlage = match vorlage_id {
                None => None,
                Some(id) => match bestand.vorlagen.iter().find(|v| v.id == id) {
                    Some(v) => Some(v.clone()),
                    None => {
                        meldungen.push(ImportMeldung::fehler(
                            zeile,
                            format!("Posten «{name}»: Vorlage nicht wählbar"),
                        ));
                        return Ziel::Fehler;
                    }
                },
            };
            let n = norm(&name);
            if let Some(i) = neue_einheiten
                .iter()
                .position(|e| norm(&e.name) == n && e.abschnitt_id == abschnitt_id)
            {
                return Ziel::NeueEinheit(i);
            }
            neue_einheiten.push(NeueEinheit {
                name,
                abschnitt_id,
                vorlage,
                sortier: p.sortier,
            });
            Ziel::NeueEinheit(neue_einheiten.len() - 1)
        }
        PaketPostenArt::Uhs => {
            if vorlage_id.is_some() {
                meldungen.push(ImportMeldung::fehler(
                    zeile,
                    format!("Posten «{name}»: Vorlage nur für Einheiten"),
                ));
                return Ziel::Fehler;
            }
            let n = norm(&name);
            if let Some(i) = neue_uhs.iter().position(|u| norm(&u.bezeichnung) == n) {
                return Ziel::NeueUhs(i);
            }
            if bestand.uhs_namen.contains(&n) {
                meldungen.push(ImportMeldung::fehler(
                    zeile,
                    format!("UHS «{name}» besteht schon und ist aufgelöst"),
                ));
                return Ziel::Fehler;
            }
            neue_uhs.push(NeueUhs {
                bezeichnung: name,
                abschnitt_id,
                typ: p.uhs_typ.unwrap_or(UhsTyp::Sonstige),
            });
            Ziel::NeueUhs(neue_uhs.len() - 1)
        }
    }
}

/// Eine Person mit Angaben: Vorschlag, Wahl, neuer Helfer.
fn person_planen(
    bestand: &Bestand,
    a: &PersonAngabe,
    entscheidung: Option<PersonEntscheidung>,
    qualis: &mut Qualis<'_>,
    neue_helfer: &mut Vec<NeuerHelfer>,
    meldungen: &mut Vec<ImportMeldung>,
) -> (Wer, VorschauPerson) {
    let zeile = erste(&a.zeilen);
    let name = a.anzeigename();
    let vorschlag = abgleich::person_vorschlag(a, &bestand.stamm, &bestand.helfer);
    let (mut ziel, mut treffer, mut grund) = (vorschlag.ziel, vorschlag.treffer, vorschlag.grund);
    match entscheidung {
        Some(PersonEntscheidung::Stamm { personal_id }) => {
            ziel = PersonZiel::Stamm {
                personal_id,
                name: stamm_name(bestand, personal_id)
                    .unwrap_or_default()
                    .to_string(),
            };
            (treffer, grund) = (Treffer::Sicher, Some(TrefferGrund::Wahl));
        }
        Some(PersonEntscheidung::Helfer { helfer_id }) => {
            ziel = PersonZiel::Helfer {
                helfer_id,
                name: helfer_name(bestand, helfer_id)
                    .unwrap_or_default()
                    .to_string(),
            };
            (treffer, grund) = (Treffer::Sicher, Some(TrefferGrund::Wahl));
        }
        Some(PersonEntscheidung::Neu) => {
            ziel = PersonZiel::Neu;
            (treffer, grund) = (Treffer::Neu, Some(TrefferGrund::Wahl));
        }
        None => {
            if treffer == Treffer::Unsicher {
                meldungen.push(ImportMeldung::hinweis(
                    zeile,
                    format!("Zuordnung unsicher: «{name}»"),
                ));
            }
        }
    }
    let wer = match &ziel {
        PersonZiel::Stamm { personal_id, .. } => {
            if stamm_name(bestand, *personal_id).is_some() {
                Wer::Stamm(*personal_id)
            } else {
                meldungen.push(ImportMeldung::fehler(
                    zeile,
                    format!("«{name}»: Person nicht wählbar"),
                ));
                Wer::Fehler
            }
        }
        PersonZiel::Helfer { helfer_id, .. } => {
            if helfer_name(bestand, *helfer_id).is_some() {
                Wer::Helfer(*helfer_id)
            } else {
                meldungen.push(ImportMeldung::fehler(
                    zeile,
                    format!("«{name}»: Helfer nicht wählbar"),
                ));
                Wer::Fehler
            }
        }
        PersonZiel::Neu => {
            let kennung = a
                .kennung
                .as_deref()
                .map(str::trim)
                .filter(|k| !k.is_empty())
                .map(str::to_string);
            let herkunft = a
                .herkunft
                .as_deref()
                .map(str::trim)
                .filter(|h| !h.is_empty() && kennung.is_some())
                .map(str::to_string);
            let vergeben = kennung.as_deref().and_then(|k| {
                bestand.helfer.iter().find(|h| {
                    h.kennung.as_deref().map(str::trim) == Some(k)
                        && abgleich::herkunft_norm(h.herkunft.as_deref())
                            == abgleich::herkunft_norm(herkunft.as_deref())
                })
            });
            if let Some(h) = vergeben {
                meldungen.push(ImportMeldung::fehler(
                    zeile,
                    format!("«{name}»: Kennung gehört schon zu «{}»", h.name),
                ));
                Wer::Fehler
            } else {
                let mut ids: Vec<i64> = Vec::new();
                for q in &a.qualifikationen {
                    if let Some(id) = qualis.id(q, zeile, meldungen) {
                        if !ids.contains(&id) {
                            ids.push(id);
                        }
                    }
                }
                neue_helfer.push(NeuerHelfer {
                    name: name.clone(),
                    telefon: a.telefon.clone(),
                    organisation: a.organisation.clone(),
                    qualifikationen: ids,
                    kennung,
                    herkunft,
                });
                Wer::NeuerHelfer(neue_helfer.len() - 1)
            }
        }
    };
    (
        wer,
        VorschauPerson {
            schluessel: a.schluessel.clone(),
            name,
            telefon: a.telefon.clone(),
            kennung: a.kennung.clone(),
            herkunft: a.herkunft.clone(),
            ziel,
            treffer,
            grund,
            kandidaten: vorschlag.kandidaten,
            zeilen: a.zeilen.clone(),
            bloecke: 0,
        },
    )
}

// ---------------------------------------------------------------------------------------------
// Schreiben
// ---------------------------------------------------------------------------------------------

/// Was das Übernehmen geschrieben hat (für Live-Ereignisse und ETB-Kurzruf).
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Geschrieben {
    pub zaehlung: ImportZaehlung,
    pub einheit_ids: Vec<i64>,
    pub uhs_ids: Vec<i64>,
    pub etb_ids: Vec<i64>,
}

/// Die Fehler einer Planung als 422 mit Zeilen (`art = dateizeile`, `id` = Zeile, 0 ohne).
fn fehler_als_zeilen(planung: &Planung) -> AppError {
    let zeilen: Vec<ZeilenGrund> = planung
        .vorschau
        .meldungen
        .iter()
        .filter(|m| m.stufe == MeldungStufe::Fehler)
        .map(|m| ZeilenGrund {
            art: ZeilenArt::Dateizeile,
            id: i64::from(m.zeile.unwrap_or(0)),
            grund: m.text.clone(),
        })
        .collect();
    AppError::Zeilen {
        meldung: "Der Schichtplan hat Fehler; nichts übernommen".into(),
        zeilen,
    }
}

/// Schreibt eine fehlerfreie Planung auf der offenen Verbindung (öffnet und committet nichts).
/// Mit Fehlern 422 (Zeilen), mit fehlenden Rechten 403. Ohne Änderung schreibt es nichts, auch
/// kein ETB.
pub async fn schreiben_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    org_id: i64,
    benutzer_id: i64,
    planung: &Planung,
    etb_startwert: i64,
    jetzt: &str,
) -> Result<Geschrieben, AppError> {
    if planung.fehlende_rechte {
        return Err(AppError::Forbidden);
    }
    if !planung.uebernehmbar() {
        return Err(fehler_als_zeilen(planung));
    }
    let zaehlung = planung.vorschau.zaehlung;
    let mut ergebnis = Geschrieben {
        zaehlung,
        ..Default::default()
    };
    if zaehlung.aenderungen == 0 {
        return Ok(ergebnis);
    }
    let wirksam =
        |g: &GeplanterBlock| matches!(g.zustand, BlockZustand::Neu | BlockZustand::Ergaenzt);

    // Neue Einheiten und UHS, nur die gebrauchten.
    let mut einheit_id: HashMap<usize, i64> = HashMap::new();
    let mut uhs_id: HashMap<usize, i64> = HashMap::new();
    for g in planung.bloecke.iter().filter(|g| wirksam(g)) {
        match g.ziel {
            Ziel::NeueEinheit(i) if !einheit_id.contains_key(&i) => {
                let e = &planung.neue_einheiten[i];
                let sortier = match e.sortier {
                    Some(s) => s,
                    None => {
                        sqlx::query_scalar::<_, i64>(
                            "SELECT COALESCE(MAX(sortier), 0) + 1 FROM einsatz_einheit \
                             WHERE einsatz_id = ? AND aufgeloest_at IS NULL",
                        )
                        .bind(einsatz_id)
                        .fetch_one(&mut *conn)
                        .await?
                    }
                };
                let v = e.vorlage.as_ref();
                let daten = crate::einheit::repo::EinheitDaten {
                    name: &e.name,
                    abschnitt_id: e.abschnitt_id,
                    ueber_einheit_id: None,
                    typ_id: v.map(|v| v.typ_id),
                    soll_fuehrer: v.and_then(|v| v.soll_fuehrer),
                    soll_unterfuehrer: v.and_then(|v| v.soll_unterfuehrer),
                    soll_mannschaft: v.and_then(|v| v.soll_mannschaft),
                    quali_soll: v.and_then(|v| v.quali_soll.as_deref()),
                    bemerkung: None,
                    funkrufname: None,
                    sortier,
                    tz_fachaufgabe: v.and_then(|v| v.tz_fachaufgabe.as_deref()),
                    tz_organisation: v.and_then(|v| v.tz_organisation.as_deref()),
                };
                let id = crate::einheit::repo::anlegen_tx(
                    &mut *conn,
                    einsatz_id,
                    org_id,
                    &daten,
                    benutzer_id,
                )
                .await?;
                ergebnis.etb_ids.push(
                    crate::etb::system_audit_tx(
                        &mut *conn,
                        einsatz_id,
                        benutzer_id,
                        etb_startwert,
                        &crate::einheit::etb_text_gebildet(&e.name),
                    )
                    .await?,
                );
                einheit_id.insert(i, id);
                ergebnis.einheit_ids.push(id);
            }
            Ziel::NeueUhs(i) if !uhs_id.contains_key(&i) => {
                let u = &planung.neue_uhs[i];
                let anzeige = crate::uhs::repo::anlegen_tx(
                    &mut *conn,
                    einsatz_id,
                    benutzer_id,
                    &crate::uhs::repo::NeueDaten {
                        typ: u.typ.as_str(),
                        bezeichnung: &u.bezeichnung,
                        abschnitt_id: u.abschnitt_id,
                        standort: None,
                        notiz: None,
                        lat: None,
                        lon: None,
                    },
                )
                .await?;
                uhs_id.insert(i, anzeige.id);
                ergebnis.uhs_ids.push(anzeige.id);
            }
            _ => {}
        }
    }

    // Neue Helfer, nur die gebrauchten.
    let mut helfer_id: HashMap<usize, i64> = HashMap::new();
    for g in planung.bloecke.iter().filter(|g| wirksam(g)) {
        for w in &g.neue {
            if let Wer::NeuerHelfer(i) = *w {
                if helfer_id.contains_key(&i) {
                    continue;
                }
                let h = &planung.neue_helfer[i];
                let id: i64 = sqlx::query_scalar(
                    "INSERT INTO einsatz_plan_helfer (einsatz_id, name, telefon, organisation, \
                        qualifikationen, kennung, herkunft, angelegt_von) \
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING id",
                )
                .bind(einsatz_id)
                .bind(&h.name)
                .bind(&h.telefon)
                .bind(&h.organisation)
                .bind(plan_repo::quals_json(&h.qualifikationen))
                .bind(&h.kennung)
                .bind(&h.herkunft)
                .bind(benutzer_id)
                .fetch_one(&mut *conn)
                .await?;
                helfer_id.insert(i, id);
            }
        }
    }
    let plan_person = |w: &Wer| -> Option<PlanPerson> {
        match *w {
            Wer::Stamm(id) => Some(PlanPerson::Stamm(id)),
            Wer::Helfer(id) => Some(PlanPerson::Helfer(id)),
            Wer::NeuerHelfer(i) => helfer_id.get(&i).map(|id| PlanPerson::Helfer(*id)),
            Wer::Fehler => None,
        }
    };

    // Blöcke.
    let bestand_personen: BTreeMap<i64, Vec<PlanPerson>> = {
        let ids: Vec<i64> = planung
            .bloecke
            .iter()
            .filter(|g| g.zustand == BlockZustand::Ergaenzt)
            .filter_map(|g| g.block_id)
            .collect();
        let mut m = BTreeMap::new();
        for bid in ids {
            let zeilen: Vec<(Option<i64>, Option<i64>, Option<i64>)> = sqlx::query_as(
                "SELECT personal_id, einsatz_personal_id, helfer_id \
                 FROM einsatz_planschicht_person WHERE planschicht_id = ? ORDER BY rowid",
            )
            .bind(bid)
            .fetch_all(&mut *conn)
            .await?;
            m.insert(
                bid,
                zeilen
                    .into_iter()
                    .filter_map(|(s, a, h)| PlanPerson::aus_spalten(s, a, h))
                    .collect(),
            );
        }
        m
    };
    for g in &planung.bloecke {
        let neue: Vec<PlanPerson> = g.neue.iter().filter_map(plan_person).collect();
        match g.zustand {
            BlockZustand::Neu => {
                let posten = match g.ziel {
                    Ziel::Bestehend(p) => p,
                    Ziel::NeueEinheit(i) => Posten::Einheit(einheit_id[&i]),
                    Ziel::NeueUhs(i) => Posten::Uhs(uhs_id[&i]),
                    Ziel::Fehler => continue,
                };
                let (vorgabe_anzahl, vorgabe_quali) =
                    plan_repo::soll_vorgabe_tx(&mut *conn, posten).await?;
                let (soll, quali) = if posten == Posten::Pause {
                    (None, None)
                } else {
                    (
                        g.soll_anzahl.or(vorgabe_anzahl),
                        g.quali_soll.clone().or(vorgabe_quali),
                    )
                };
                let bid = plan_repo::insert_block_tx(
                    &mut *conn,
                    einsatz_id,
                    benutzer_id,
                    posten,
                    &g.von,
                    &g.bis,
                    soll,
                    quali.as_deref(),
                    g.notiz.as_deref(),
                )
                .await?;
                plan_repo::schreibe_personen_tx(&mut *conn, bid, &neue).await?;
            }
            BlockZustand::Ergaenzt => {
                let Some(bid) = g.block_id else { continue };
                let mut alle = bestand_personen.get(&bid).cloned().unwrap_or_default();
                for p in neue {
                    if !alle.contains(&p) {
                        alle.push(p);
                    }
                }
                plan_repo::schreibe_personen_tx(&mut *conn, bid, &alle).await?;
                sqlx::query(
                    "UPDATE einsatz_planschicht SET version = version + 1, geaendert_at = ?, \
                        geaendert_von = ? WHERE id = ?",
                )
                .bind(jetzt)
                .bind(benutzer_id)
                .bind(bid)
                .execute(&mut *conn)
                .await?;
            }
            BlockZustand::Unveraendert | BlockZustand::Fehler => {}
        }
    }

    // Grenzwerte, nur ohne eigene Werte des Einsatzes.
    if let Some((max, ruhe)) = planung.grenzwerte {
        sqlx::query(
            "INSERT INTO einsatz_einstellungen (einsatz_id, schichtplan_max_dienst_min, \
                schichtplan_min_ruhe_min, geaendert_at, geaendert_von) VALUES (?1, ?2, ?3, ?4, ?5) \
             ON CONFLICT(einsatz_id) DO UPDATE SET \
                schichtplan_max_dienst_min = COALESCE(?2, schichtplan_max_dienst_min), \
                schichtplan_min_ruhe_min = COALESCE(?3, schichtplan_min_ruhe_min), \
                geaendert_at = ?4, geaendert_von = ?5",
        )
        .bind(einsatz_id)
        .bind(max)
        .bind(ruhe)
        .bind(jetzt)
        .bind(benutzer_id)
        .execute(&mut *conn)
        .await?;
    }

    ergebnis.etb_ids.push(
        crate::etb::system_audit_tx(
            &mut *conn,
            einsatz_id,
            benutzer_id,
            etb_startwert,
            &etb_text(&zaehlung),
        )
        .await?,
    );
    Ok(ergebnis)
}

/// „Schichtplan eingelesen: 24 Schichten neu, 3 ergänzt, 12 Helfer neu, 3 Einheiten neu.“
pub fn etb_text(z: &ImportZaehlung) -> String {
    let mut teile: Vec<String> = Vec::new();
    let mehrzahl =
        |n: i64, eins: &str, viele: &str| format!("{n} {}", if n == 1 { eins } else { viele });
    if z.bloecke_neu > 0 {
        teile.push(format!(
            "{} neu",
            mehrzahl(z.bloecke_neu, "Schicht", "Schichten")
        ));
    }
    if z.bloecke_ergaenzt > 0 {
        teile.push(format!(
            "{} ergänzt",
            mehrzahl(z.bloecke_ergaenzt, "Schicht", "Schichten")
        ));
    }
    if z.helfer_neu > 0 {
        teile.push(format!("{} Helfer neu", z.helfer_neu));
    }
    if z.einheiten_neu > 0 {
        teile.push(format!(
            "{} neu",
            mehrzahl(z.einheiten_neu, "Einheit", "Einheiten")
        ));
    }
    if z.uhs_neu > 0 {
        teile.push(format!("{} UHS neu", z.uhs_neu));
    }
    if z.grenzwerte_neu > 0 {
        teile.push("Grenzwerte gesetzt".into());
    }
    if teile.is_empty() {
        teile.push(format!(
            "{} eingeteilt",
            mehrzahl(z.einteilungen_neu, "Person", "Personen")
        ));
    }
    format!("Schichtplan eingelesen: {}.", teile.join(", "))
}

// ---------------------------------------------------------------------------------------------
// Vorschau und Übernehmen über den Pool
// ---------------------------------------------------------------------------------------------

/// Die Vorschau: liest, gleicht ab, schreibt nichts.
pub async fn vorschau(
    pool: &SqlitePool,
    einsatz_id: i64,
    org_id: i64,
    paket: &PlanPaket,
    meldungen: Vec<ImportMeldung>,
    entscheidungen: &Entscheidungen,
    rechte: Rechte,
) -> Result<ImportVorschau, AppError> {
    let mut conn = pool.acquire().await?;
    let bestand = bestand_tx(&mut conn, einsatz_id, org_id).await?;
    Ok(planen(&bestand, paket, meldungen, entscheidungen, rechte)?.vorschau)
}

/// Übernimmt in EINER Transaktion: Abgleich und Schreiben sehen denselben Stand.
#[allow(clippy::too_many_arguments)]
pub async fn uebernehmen(
    pool: &SqlitePool,
    einsatz_id: i64,
    org_id: i64,
    benutzer_id: i64,
    paket: &PlanPaket,
    meldungen: &[ImportMeldung],
    entscheidungen: &Entscheidungen,
    rechte: Rechte,
    jetzt: &str,
) -> Result<Geschrieben, AppError> {
    let startwert = crate::einsatz::einstellungen::etb_startwert(pool, einsatz_id).await?;
    write_retry!(pool, |conn| {
        let bestand = bestand_tx(conn, einsatz_id, org_id).await?;
        let planung = planen(&bestand, paket, meldungen.to_vec(), entscheidungen, rechte)?;
        schreiben_tx(
            conn,
            einsatz_id,
            org_id,
            benutzer_id,
            &planung,
            startwert,
            jetzt,
        )
        .await
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::abloesung::schichtplan::uebernahme::{
        PaketBlock, PaketPosten, PaketQualiSoll, PersonAngabe,
    };

    fn bestand() -> Bestand {
        Bestand {
            stil: Zeitstil {
                zone: chrono_tz::Europe::Berlin,
                darstellung: crate::einsatz::einstellungen::Zeitdarstellung::DatumUhrzeit,
            },
            grenzwerte: SchichtplanGrenzwerte::aus(None, None),
            einheiten: vec![BestandEinheit {
                id: 10,
                name: "Streife 1".into(),
                funkrufname: None,
                abschnitt_id: Some(3),
            }],
            uhs: vec![],
            uhs_namen: HashSet::from(["alte uhs".to_string()]),
            abschnitte: vec![BestandAbschnitt {
                id: 3,
                name: "Festmeile".into(),
                kurzbezeichnung: Some("EA 3".into()),
            }],
            vorlagen: vec![],
            stamm: vec![BestandStamm {
                id: 1,
                name: "Ida Platzhalter".into(),
                personalnummer: Some("DEMO-S-002".into()),
                telefon: None,
            }],
            helfer: vec![],
            qualifikationen: vec![(7, "Sanitäter".into())],
            bloecke: vec![BestandBlock {
                id: 100,
                posten: Posten::Einheit(10),
                von: "2026-07-04T08:00:00Z".into(),
                bis: "2026-07-04T12:00:00Z".into(),
                soll_anzahl: Some(2),
                quali_soll: None,
                personen: vec![PlanPerson::Stamm(1)],
            }],
        }
    }

    fn posten(s: &str, art: PaketPostenArt, name: &str, zeile: u32) -> PaketPosten {
        PaketPosten {
            schluessel: s.into(),
            art,
            name: name.into(),
            abschnitt: None,
            einheit_vorlage_id: None,
            fahrzeug_id: None,
            uhs_typ: None,
            sortier: None,
            zeilen: vec![zeile],
        }
    }

    fn block(p: &str, von: &str, bis: &str, personen: &[&str], zeile: u32) -> PaketBlock {
        PaketBlock {
            posten: p.into(),
            von: von.into(),
            bis: bis.into(),
            soll_anzahl: None,
            quali_soll: None,
            notiz: None,
            personen: personen.iter().map(|s| s.to_string()).collect(),
            zeile: Some(zeile),
        }
    }

    fn person(s: &str, nachname: &str, vorname: &str, kennung: Option<&str>) -> PaketPerson {
        PaketPerson::Angabe(PersonAngabe {
            schluessel: s.into(),
            nachname: nachname.into(),
            vorname: Some(vorname.into()),
            kennung: kennung.map(Into::into),
            herkunft: kennung.map(|_| "Helferplanung".into()),
            zeilen: vec![2],
            ..Default::default()
        })
    }

    const ALLE: Rechte = Rechte {
        einheiten: true,
        uhs: true,
    };

    #[test]
    fn bestehender_block_wird_ergaenzt_neuer_angelegt() {
        let paket = PlanPaket {
            posten: vec![posten("p1", PaketPostenArt::Einheit, "streife  1", 2)],
            bloecke: vec![
                block(
                    "p1",
                    "2026-07-04T08:00:00Z",
                    "2026-07-04T12:00:00Z",
                    &["m1", "m2"],
                    2,
                ),
                block(
                    "p1",
                    "2026-07-04T12:00:00Z",
                    "2026-07-04T16:00:00Z",
                    &["m2"],
                    4,
                ),
            ],
            personen: vec![
                person("m1", "Platzhalter", "Ida", Some("DEMO-S-002")),
                person("m2", "Neu", "Nora", Some("4711")),
            ],
            ..Default::default()
        };
        let p = planen(&bestand(), &paket, vec![], &Entscheidungen::default(), ALLE).unwrap();
        let v = &p.vorschau;
        assert!(v.uebernehmbar, "{:?}", v.meldungen);
        assert_eq!(v.bloecke[0].zustand, BlockZustand::Ergaenzt);
        assert_eq!(v.bloecke[0].neue_personen, 1);
        assert_eq!(v.bloecke[1].zustand, BlockZustand::Neu);
        assert_eq!(v.zaehlung.helfer_neu, 1);
        assert_eq!(v.zaehlung.einteilungen_neu, 2);
        assert_eq!(v.zaehlung.aenderungen, 1 + 1 + 1 + 2);
    }

    #[test]
    fn ueberschneidung_mit_bestand_und_in_der_datei_sind_fehler() {
        let paket = PlanPaket {
            posten: vec![posten("p1", PaketPostenArt::Einheit, "Streife 1", 2)],
            bloecke: vec![
                block("p1", "2026-07-04T10:00:00Z", "2026-07-04T14:00:00Z", &[], 2),
                block("p1", "2026-07-04T14:00:00Z", "2026-07-04T18:00:00Z", &[], 3),
                block("p1", "2026-07-04T16:00:00Z", "2026-07-04T20:00:00Z", &[], 4),
            ],
            ..Default::default()
        };
        let v = planen(&bestand(), &paket, vec![], &Entscheidungen::default(), ALLE)
            .unwrap()
            .vorschau;
        assert!(!v.uebernehmbar);
        let zustaende: Vec<_> = v.bloecke.iter().map(|b| b.zustand).collect();
        assert_eq!(
            zustaende,
            [
                BlockZustand::Fehler,
                BlockZustand::Neu,
                BlockZustand::Fehler
            ]
        );
        assert!(v.meldungen[1].text.contains("Zeile 3"), "{:?}", v.meldungen);
    }

    #[test]
    fn neue_posten_brauchen_die_freigabe_und_aufgeloeste_uhs_sperrt() {
        let paket = PlanPaket {
            posten: vec![
                posten("p1", PaketPostenArt::Einheit, "Streife 9", 2),
                posten("p2", PaketPostenArt::Uhs, "Alte UHS", 3),
            ],
            bloecke: vec![
                block("p1", "2026-07-04T08:00:00Z", "2026-07-04T12:00:00Z", &[], 2),
                block("p2", "2026-07-04T08:00:00Z", "2026-07-04T12:00:00Z", &[], 3),
            ],
            ..Default::default()
        };
        let ohne = Rechte {
            einheiten: false,
            uhs: true,
        };
        let p = planen(&bestand(), &paket, vec![], &Entscheidungen::default(), ohne).unwrap();
        assert!(p.fehlende_rechte);
        assert_eq!(p.vorschau.meldungen.len(), 2, "{:?}", p.vorschau.meldungen);
        let p = planen(&bestand(), &paket, vec![], &Entscheidungen::default(), ALLE).unwrap();
        assert!(!p.fehlende_rechte);
        assert_eq!(p.vorschau.zaehlung.einheiten_neu, 1);
        assert!(p.vorschau.meldungen[0].text.contains("aufgelöst"));
    }

    #[test]
    fn entscheidung_waehlt_und_unbekannter_schluessel_ist_400() {
        let paket = PlanPaket {
            posten: vec![posten("p1", PaketPostenArt::Einheit, "Streife 9", 2)],
            bloecke: vec![block(
                "p1",
                "2026-07-04T13:00:00Z",
                "2026-07-04T15:00:00Z",
                &["m1"],
                2,
            )],
            personen: vec![person("m1", "Platzhalter", "Ida", None)],
            ..Default::default()
        };
        let mut e = Entscheidungen::default();
        e.posten
            .insert("p1".into(), PostenEntscheidung::Einheit { einheit_id: 10 });
        e.personen.insert("m1".into(), PersonEntscheidung::Neu);
        let v = planen(&bestand(), &paket, vec![], &e, ALLE)
            .unwrap()
            .vorschau;
        assert!(v.uebernehmbar, "{:?}", v.meldungen);
        assert_eq!(v.zaehlung.einheiten_neu, 0);
        assert_eq!(v.zaehlung.helfer_neu, 1);
        assert_eq!(v.personen[0].grund, Some(TrefferGrund::Wahl));

        e.personen.insert("m9".into(), PersonEntscheidung::Neu);
        assert_eq!(
            planen(&bestand(), &paket, vec![], &e, ALLE)
                .unwrap_err()
                .status(),
            axum::http::StatusCode::BAD_REQUEST
        );
    }

    #[test]
    fn soll_weicht_ab_ist_ein_hinweis_und_unbekannte_qualifikation_faellt_weg() {
        let mut b = block("p1", "2026-07-04T08:00:00Z", "2026-07-04T12:00:00Z", &[], 2);
        b.soll_anzahl = Some(3);
        let mut neu = block("p1", "2026-07-04T12:00:00Z", "2026-07-04T16:00:00Z", &[], 3);
        neu.quali_soll = Some(vec![
            PaketQualiSoll {
                qualifikation: QualiAngabe::Bezeichnung("sanitäter".into()),
                anzahl: 1,
            },
            PaketQualiSoll {
                qualifikation: QualiAngabe::Bezeichnung("Taucher".into()),
                anzahl: 1,
            },
        ]);
        let paket = PlanPaket {
            posten: vec![posten("p1", PaketPostenArt::Einheit, "Streife 1", 2)],
            bloecke: vec![b, neu],
            ..Default::default()
        };
        let p = planen(&bestand(), &paket, vec![], &Entscheidungen::default(), ALLE).unwrap();
        assert!(p.vorschau.uebernehmbar);
        let texte: Vec<&str> = p
            .vorschau
            .meldungen
            .iter()
            .map(|m| m.text.as_str())
            .collect();
        assert_eq!(
            texte,
            [
                "Soll weicht ab, bleibt",
                "Qualifikation «Taucher» unbekannt, ausgelassen"
            ]
        );
        assert_eq!(p.vorschau.bloecke[0].zustand, BlockZustand::Unveraendert);
        assert_eq!(
            p.bloecke[1].quali_soll.as_deref(),
            Some(r#"[{"n":1,"q":7}]"#)
        );
    }

    #[test]
    fn etb_text_nennt_nur_was_sich_aendert() {
        let mut z = ImportZaehlung {
            bloecke_neu: 24,
            helfer_neu: 12,
            einheiten_neu: 1,
            ..Default::default()
        };
        z.summe();
        assert_eq!(
            etb_text(&z),
            "Schichtplan eingelesen: 24 Schichten neu, 12 Helfer neu, 1 Einheit neu."
        );
    }
}
