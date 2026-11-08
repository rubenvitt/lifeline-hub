//! Datenbank der Vorplanung (design.md D3–D8). Schreibwege laufen je in EINER Transaktion
//! (`write_retry!`): Planung, Posten, Überschneidung, Personen und Grenzen werden darin geprüft,
//! wo auch geschrieben wird. Die Befunde rechnet `abloesung::schichtplan::pruefung` beim Lesen,
//! ohne Ist.
//!
//! Für die Prüfung wird ein Posten der Planung auf den neutralen Schlüssel
//! `Posten::Einheit(posten_id)` abgebildet und die Pause auf `Posten::Pause`: ohne Ist zählt die
//! Art des Postens nur für die Pause (`Grundlage.mit_ist`).

use std::collections::{BTreeMap, HashMap};

use chrono::{DateTime, Duration, Utc};
use sqlx::{SqliteConnection, SqlitePool};

use super::{
    kennzahlen, PlanungAnzeige, PlanungBlockAnzeige, PlanungKennzahlen, PlanungKopf,
    PlanungListeneintrag, PlanungPostenAnzeige, PlanungPostenArt, AUFBEWAHRUNG_TAGE,
    KENNZAHLEN_TAGE, PLANUNGEN_MAX, POSTEN_MAX, ZEITRAUM_MAX_TAGE,
};
use crate::abloesung::schichtplan::pruefung::{self, Block, Ergebnis, Grundlage, PersonStand};
use crate::abloesung::schichtplan::repo::{HelferEingabe, HelferPatch};
use crate::abloesung::schichtplan::zerlegung::{self, Teilung};
use crate::abloesung::schichtplan::{
    PlanHelferAnzeige, PlanPerson, PlanPersonAnzeige, Posten, SchichtplanGrenzwerte,
    PLAN_BLOECKE_MAX, PLAN_HELFER_MAX, SOLL_ANZAHL_MAX,
};
use crate::einsatz::Einsatzart;
use crate::error::{AppError, ZeilenArt, ZeilenGrund};
use crate::personal::quali_soll::QualiSoll;
use crate::uhs::UhsTyp;
use crate::write_retry;
use crate::zeit;
use crate::zeitdarstellung::{wirksame_darstellung, wirksame_zone, Zeitstil};

// ---------------------------------------------------------------------------------------------
// Eingaben (Felder schon geprüft, Handler)
// ---------------------------------------------------------------------------------------------

/// Eine neue Planung. Zeiten im kanonischen Format.
#[derive(Debug, Clone)]
pub struct KopfEingabe {
    pub bezeichnung: String,
    pub einsatzart: Einsatzart,
    pub ort: Option<String>,
    pub koordinate: Option<(f64, f64)>,
    pub von: String,
    pub bis: String,
    pub max_dienst: Option<i64>,
    pub min_ruhe: Option<i64>,
}

/// Änderung des Kopfs. Fehlt = unverändert, `Some(None)` = leeren bzw. Vorgabe.
#[derive(Debug, Clone, Default)]
pub struct KopfPatch {
    pub version: i64,
    pub bezeichnung: Option<String>,
    pub einsatzart: Option<Einsatzart>,
    pub ort: Option<Option<String>>,
    pub koordinate: Option<Option<(f64, f64)>>,
    pub von: Option<String>,
    pub bis: Option<String>,
    pub max_dienst: Option<Option<i64>>,
    pub min_ruhe: Option<Option<i64>>,
}

/// Woraus ein Posten bei der Übernahme wird.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Herkunft {
    /// Eine freie Einheit.
    Frei,
    /// Eine Einheit aus einer Einheitenvorlage der Organisation.
    Vorlage(i64),
    /// Eine Einheit aus einem Stamm-Fahrzeug der Organisation.
    Fahrzeug(i64),
    /// Eine UHS dieses Typs.
    Uhs(UhsTyp),
}

impl Herkunft {
    fn art(self) -> PlanungPostenArt {
        match self {
            Herkunft::Uhs(_) => PlanungPostenArt::Uhs,
            _ => PlanungPostenArt::Einheit,
        }
    }
}

/// Ein neuer Posten.
#[derive(Debug, Clone)]
pub struct PostenEingabe {
    pub bezeichnung: String,
    pub abschnitt: Option<String>,
    pub herkunft: Herkunft,
    pub schichtlaenge: Option<i64>,
    /// Fehlt = Soll der Vorlage bzw. des Fahrzeugs; `Some(None)` = kein Soll.
    pub soll_anzahl: Option<Option<i64>>,
    /// Gespeicherte Form; fehlt = Qualifikationssoll der Vorlage.
    pub quali_soll: Option<Option<String>>,
}

/// Änderung eines Postens. Die Herkunft bleibt.
#[derive(Debug, Clone, Default)]
pub struct PostenPatch {
    pub bezeichnung: Option<String>,
    pub abschnitt: Option<Option<String>>,
    pub schichtlaenge: Option<Option<i64>>,
    pub soll_anzahl: Option<Option<i64>>,
    pub quali_soll: Option<Option<String>>,
}

/// Ein neuer Block. `posten_id = None` ist die Pause.
#[derive(Debug, Clone)]
pub struct BlockEingabe {
    pub posten_id: Option<i64>,
    pub von: String,
    pub bis: String,
    /// Fehlt = Vorgabe des Postens; `Some(None)` = kein Soll.
    pub soll_anzahl: Option<Option<i64>>,
    pub quali_soll: Option<Option<String>>,
    pub personen: Vec<PlanPerson>,
    pub notiz: Option<String>,
}

/// Änderung eines Blocks. `posten: Some(None)` verschiebt in die Pause.
#[derive(Debug, Clone, Default)]
pub struct BlockPatch {
    pub version: i64,
    pub posten: Option<Option<i64>>,
    pub von: Option<String>,
    pub bis: Option<String>,
    pub soll_anzahl: Option<Option<i64>>,
    pub quali_soll: Option<Option<String>>,
    pub personen: Option<Vec<PlanPerson>>,
    pub notiz: Option<Option<String>>,
}

fn utc(wert: &str) -> Result<DateTime<Utc>, AppError> {
    zeit::parse_utc(wert)
        .ok_or_else(|| AppError::Validation(format!("Ungültiger Zeitpunkt '{wert}'")))
}

/// Zeitraum einer Planung (400): Ende nach Beginn, höchstens [`ZEITRAUM_MAX_TAGE`] Tage.
pub fn pruefe_zeitraum(von: &str, bis: &str) -> Result<(), AppError> {
    let (a, b) = (utc(von)?, utc(bis)?);
    if b <= a {
        return Err(AppError::Validation(
            "Das Ende liegt nach dem Beginn".into(),
        ));
    }
    if b - a > Duration::days(ZEITRAUM_MAX_TAGE) {
        return Err(AppError::Validation(format!(
            "Eine Planung umfasst höchstens {ZEITRAUM_MAX_TAGE} Tage"
        )));
    }
    Ok(())
}

fn als_422(e: AppError) -> AppError {
    match e {
        AppError::Validation(m) => AppError::UnprocessableEntity(m),
        andere => andere,
    }
}

/// Wann eine Planung mit diesem Ende gelöscht wird.
pub fn loeschung_at(bis: &str) -> String {
    zeit::parse_utc(bis)
        .map(|b| zeit::formatiere_utc(b + Duration::days(AUFBEWAHRUNG_TAGE)))
        .unwrap_or_else(|| bis.to_string())
}

fn json_ids(json: Option<&str>) -> Vec<i64> {
    json.and_then(|j| serde_json::from_str::<Vec<i64>>(j).ok())
        .unwrap_or_default()
}

fn quals_json(ids: &[i64]) -> Option<String> {
    (!ids.is_empty()).then(|| serde_json::to_string(ids).unwrap_or_else(|_| "[]".into()))
}

/// Der Schlüssel eines Postens in der Prüfung (Modulkopf).
fn posten_schluessel(posten_id: Option<i64>) -> Posten {
    match posten_id {
        Some(id) => Posten::Einheit(id),
        None => Posten::Pause,
    }
}

/// Zone und Darstellung der Organisation für Servertexte.
async fn zeitstil_org(conn: &mut SqliteConnection, org_id: i64) -> Result<Zeitstil, AppError> {
    let zeile: Option<(Option<String>, Option<String>)> =
        sqlx::query_as("SELECT zeitzone, zeitdarstellung FROM org_einstellungen WHERE org_id = ?")
            .bind(org_id)
            .fetch_optional(&mut *conn)
            .await?;
    let (zone, darstellung) = zeile.unwrap_or_default();
    Ok(Zeitstil::new(
        wirksame_zone(None, zone.as_deref()),
        wirksame_darstellung(None, darstellung.as_deref()),
    ))
}

fn zeitraum_text(stil: &Zeitstil, von: &str, bis: &str) -> String {
    match (zeit::parse_utc(von), zeit::parse_utc(bis)) {
        (Some(a), Some(b)) => stil.zeitraum(a, b),
        _ => format!("{von}–{bis}"),
    }
}

// ---------------------------------------------------------------------------------------------
// Lesen
// ---------------------------------------------------------------------------------------------

#[derive(sqlx::FromRow)]
struct KopfZeile {
    id: i64,
    version: i64,
    bezeichnung: String,
    einsatzart: String,
    ort: Option<String>,
    ort_lat: Option<f64>,
    ort_lon: Option<f64>,
    von: String,
    bis: String,
    max_dienst_min: Option<i64>,
    min_ruhe_min: Option<i64>,
    angelegt_at: String,
}

const SELECT_KOPF: &str = "SELECT id, version, bezeichnung, einsatzart, ort, ort_lat, ort_lon, \
     von, bis, max_dienst_min, min_ruhe_min, angelegt_at FROM planung WHERE id = ? AND org_id = ?";

impl KopfZeile {
    fn grenzwerte(&self) -> SchichtplanGrenzwerte {
        SchichtplanGrenzwerte::aus(self.max_dienst_min, self.min_ruhe_min)
    }

    fn anzeige(self) -> Result<PlanungKopf, AppError> {
        let grenzwerte = self.grenzwerte();
        Ok(PlanungKopf {
            id: self.id,
            version: self.version,
            einsatzart: Einsatzart::parse(&self.einsatzart).ok_or_else(|| {
                AppError::Internal(format!("Planung {} ohne Einsatzart", self.id))
            })?,
            bezeichnung: self.bezeichnung,
            ort: self.ort,
            ort_lat: self.ort_lat,
            ort_lon: self.ort_lon,
            loeschung_at: loeschung_at(&self.bis),
            von: self.von,
            bis: self.bis,
            grenzwerte,
            angelegt_at: self.angelegt_at,
        })
    }
}

async fn kopf_tx(conn: &mut SqliteConnection, org_id: i64, id: i64) -> Result<KopfZeile, AppError> {
    sqlx::query_as(SELECT_KOPF)
        .bind(id)
        .bind(org_id)
        .fetch_optional(&mut *conn)
        .await?
        .ok_or(AppError::NotFound)
}

#[derive(sqlx::FromRow)]
struct PostenZeile {
    id: i64,
    bezeichnung: String,
    abschnitt: Option<String>,
    art: String,
    einheit_vorlage_id: Option<i64>,
    einheit_vorlage_name: Option<String>,
    fahrzeug_id: Option<i64>,
    fahrzeug_funkrufname: Option<String>,
    uhs_typ: Option<String>,
    sortier: i64,
    schichtlaenge_min: Option<i64>,
    soll_anzahl: Option<i64>,
    quali_soll: Option<QualiSoll>,
    nicht_verfuegbar: bool,
}

const SELECT_POSTEN: &str = concat!(
    "SELECT p.id, p.bezeichnung, p.abschnitt, p.art, p.einheit_vorlage_id, \
            v.name AS einheit_vorlage_name, p.fahrzeug_id, f.funkrufname AS fahrzeug_funkrufname, \
            p.uhs_typ, p.sortier, p.schichtlaenge_min, p.soll_anzahl, ",
    crate::personal::quali_soll::quali_soll_sql!("p.quali_soll"),
    " AS quali_soll, \
       (COALESCE(v.aktiv = 0, 0) OR COALESCE(f.dienststatus = 'ausser_dienst', 0)) \
         AS nicht_verfuegbar \
     FROM planung_posten p \
     LEFT JOIN einheit_vorlage v ON v.id = p.einheit_vorlage_id \
     LEFT JOIN fahrzeug f ON f.id = p.fahrzeug_id \
     WHERE p.planung_id = ? ORDER BY p.sortier, p.id"
);

impl PostenZeile {
    fn anzeige(self) -> Result<PlanungPostenAnzeige, AppError> {
        Ok(PlanungPostenAnzeige {
            id: self.id,
            art: PlanungPostenArt::parse(&self.art)
                .ok_or_else(|| AppError::Internal(format!("Posten {} ohne Art", self.id)))?,
            bezeichnung: self.bezeichnung,
            abschnitt: self.abschnitt,
            einheit_vorlage_id: self.einheit_vorlage_id,
            einheit_vorlage_name: self.einheit_vorlage_name,
            fahrzeug_id: self.fahrzeug_id,
            fahrzeug_funkrufname: self.fahrzeug_funkrufname,
            uhs_typ: self.uhs_typ.as_deref().and_then(UhsTyp::parse),
            sortier: self.sortier,
            schichtlaenge_minuten: self.schichtlaenge_min,
            soll_anzahl: self.soll_anzahl,
            quali_soll: self.quali_soll,
            nicht_verfuegbar: self.nicht_verfuegbar,
        })
    }
}

#[derive(sqlx::FromRow)]
struct BlockZeile {
    id: i64,
    version: i64,
    posten_id: Option<i64>,
    von: String,
    bis: String,
    soll_anzahl: Option<i64>,
    quali_soll: Option<QualiSoll>,
    notiz: Option<String>,
}

const SELECT_BLOECKE: &str = concat!(
    "SELECT s.id, s.version, s.posten_id, s.von, s.bis, s.soll_anzahl, ",
    crate::personal::quali_soll::quali_soll_sql!("s.quali_soll"),
    " AS quali_soll, s.notiz \
     FROM planung_schicht s LEFT JOIN planung_posten p ON p.id = s.posten_id \
     WHERE s.planung_id = ? \
     ORDER BY s.posten_id IS NULL, COALESCE(p.sortier, 0), COALESCE(p.id, 0), s.von, s.id"
);

/// Name und Stand einer Person der Planung.
struct PersonDaten {
    name: String,
    stand: PersonStand,
}

/// Blöcke, Personen und das Ergebnis der Prüfung einer Planung.
struct Geprueft {
    zeilen: Vec<BlockZeile>,
    bloecke: Vec<Block>,
    ergebnis: Ergebnis,
    personen: BTreeMap<PlanPerson, PersonDaten>,
}

async fn pruefe_planung(
    conn: &mut SqliteConnection,
    org_id: i64,
    planung_id: i64,
    grenzwerte: SchichtplanGrenzwerte,
    nicht_verfuegbar: &HashMap<i64, bool>,
) -> Result<Geprueft, AppError> {
    let zeilen: Vec<BlockZeile> = sqlx::query_as(SELECT_BLOECKE)
        .bind(planung_id)
        .fetch_all(&mut *conn)
        .await?;
    let zuordnung: Vec<(i64, Option<i64>, Option<i64>)> = sqlx::query_as(
        "SELECT sp.schicht_id, sp.personal_id, sp.helfer_id FROM planung_schicht_person sp \
         JOIN planung_schicht s ON s.id = sp.schicht_id \
         WHERE s.planung_id = ? ORDER BY sp.rowid",
    )
    .bind(planung_id)
    .fetch_all(&mut *conn)
    .await?;
    let mut je_block: HashMap<i64, Vec<PlanPerson>> = HashMap::new();
    for (bid, stamm, helfer) in zuordnung {
        if let Some(p) = PlanPerson::aus_spalten(stamm, None, helfer) {
            je_block.entry(bid).or_default().push(p);
        }
    }
    let personen = personen_daten(conn, planung_id).await?;
    let katalog = crate::personal::qualifikation_repo::einschluesse(&mut *conn, org_id).await?;

    let mut bloecke = Vec::with_capacity(zeilen.len());
    for z in &zeilen {
        bloecke.push(Block {
            id: z.id,
            posten: posten_schluessel(z.posten_id),
            von: utc(&z.von)?,
            bis: utc(&z.bis)?,
            soll_anzahl: z.soll_anzahl,
            quali_soll: z
                .quali_soll
                .as_ref()
                .map(QualiSoll::anforderungen)
                .unwrap_or_default(),
            personen: je_block.remove(&z.id).unwrap_or_default(),
            posten_aufgeloest: z
                .posten_id
                .is_some_and(|p| nicht_verfuegbar.get(&p).copied().unwrap_or(false)),
        });
    }
    let staende: HashMap<PlanPerson, PersonStand> = personen
        .iter()
        .map(|(p, d)| (*p, d.stand.clone()))
        .collect();
    let ueber = HashMap::new();
    let ergebnis = pruefung::pruefe(
        &bloecke,
        &Grundlage {
            katalog: &katalog,
            personen: &staende,
            ueber_einheit: &ueber,
            grenzwerte,
            jetzt: Utc::now(),
            mit_ist: false,
        },
    );
    Ok(Geprueft {
        zeilen,
        bloecke,
        ergebnis,
        personen,
    })
}

/// Name, Qualifikationen und Verfügbarkeit jeder Person der Planung.
async fn personen_daten(
    conn: &mut SqliteConnection,
    planung_id: i64,
) -> Result<BTreeMap<PlanPerson, PersonDaten>, AppError> {
    let mut aus = BTreeMap::new();
    let stamm: Vec<(i64, String, String, Option<String>)> = sqlx::query_as(
        "SELECT pe.id, pe.name, pe.dienststatus, \
                (SELECT json_group_array(pq.qualifikation_id) FROM personal_qualifikation pq \
                  WHERE pq.personal_id = pe.id) \
         FROM personal pe \
         WHERE pe.id IN (SELECT sp.personal_id FROM planung_schicht_person sp \
                         JOIN planung_schicht s ON s.id = sp.schicht_id \
                         WHERE s.planung_id = ? AND sp.personal_id IS NOT NULL)",
    )
    .bind(planung_id)
    .fetch_all(&mut *conn)
    .await?;
    for (id, name, dienststatus, quals) in stamm {
        aus.insert(
            PlanPerson::Stamm(id),
            PersonDaten {
                name,
                stand: PersonStand {
                    qualifikationen: json_ids(quals.as_deref()),
                    verfuegbar: dienststatus != "ausser_dienst",
                    ..PersonStand::default()
                },
            },
        );
    }
    for h in helfer_liste(conn, planung_id).await? {
        aus.insert(
            PlanPerson::Helfer(h.id),
            PersonDaten {
                name: h.name,
                stand: PersonStand {
                    qualifikationen: h.qualifikationen,
                    ..PersonStand::default()
                },
            },
        );
    }
    Ok(aus)
}

async fn helfer_liste(
    conn: &mut SqliteConnection,
    planung_id: i64,
) -> Result<Vec<PlanHelferAnzeige>, AppError> {
    let zeilen: Vec<(i64, String, Option<String>, Option<String>, Option<String>)> =
        sqlx::query_as(
            "SELECT id, name, telefon, organisation, qualifikationen FROM planung_helfer \
             WHERE planung_id = ? ORDER BY name COLLATE NOCASE, id",
        )
        .bind(planung_id)
        .fetch_all(&mut *conn)
        .await?;
    Ok(zeilen
        .into_iter()
        .map(
            |(id, name, telefon, organisation, quals)| PlanHelferAnzeige {
                id,
                name,
                telefon,
                organisation,
                qualifikationen: json_ids(quals.as_deref()),
            },
        )
        .collect())
}

/// Die ganze Planung mit Befunden und Kennzahlen. Fremd oder unbekannt → 404.
pub async fn laden(pool: &SqlitePool, org_id: i64, id: i64) -> Result<PlanungAnzeige, AppError> {
    let mut conn = pool.acquire().await?;
    laden_mit(&mut conn, org_id, id).await
}

async fn laden_mit(
    conn: &mut SqliteConnection,
    org_id: i64,
    id: i64,
) -> Result<PlanungAnzeige, AppError> {
    let kopf = kopf_tx(conn, org_id, id).await?;
    let posten_zeilen: Vec<PostenZeile> = sqlx::query_as(SELECT_POSTEN)
        .bind(id)
        .fetch_all(&mut *conn)
        .await?;
    let nicht_verfuegbar: HashMap<i64, bool> = posten_zeilen
        .iter()
        .map(|p| (p.id, p.nicht_verfuegbar))
        .collect();
    let g = pruefe_planung(conn, org_id, id, kopf.grenzwerte(), &nicht_verfuegbar).await?;
    let kennzahlen = kennzahlen(&g.bloecke, &g.ergebnis);
    let helfer = helfer_liste(conn, id).await?;

    let mut ergebnis_je_block = g.ergebnis.bloecke;
    let personen = g.personen;
    let bloecke = g
        .zeilen
        .into_iter()
        .zip(g.bloecke)
        .map(|(z, b)| {
            let mut e = ergebnis_je_block.remove(&b.id).unwrap_or_default();
            let liste = b
                .personen
                .iter()
                .map(|p| {
                    let daten = personen.get(p);
                    PlanPersonAnzeige {
                        art: p.art(),
                        personal_id: matches!(p, PlanPerson::Stamm(_)).then(|| p.id()),
                        einsatz_personal_id: None,
                        helfer_id: matches!(p, PlanPerson::Helfer(_)).then(|| p.id()),
                        name: daten.map(|d| d.name.clone()).unwrap_or_default(),
                        qualifikationen: daten
                            .map(|d| d.stand.qualifikationen.clone())
                            .unwrap_or_default(),
                        im_einsatz: false,
                        befunde: e.personen.remove(p).unwrap_or_default(),
                    }
                })
                .collect();
            PlanungBlockAnzeige {
                id: z.id,
                version: z.version,
                posten_id: z.posten_id,
                von: z.von,
                bis: z.bis,
                soll_anzahl: z.soll_anzahl,
                quali_soll: z.quali_soll,
                notiz: z.notiz,
                personen_anzahl: b.personen.len() as i64,
                personen: liste,
                offene_plaetze: e.offene_plaetze,
                offene_anforderungen: e.offene_anforderungen,
                befunde: e.befunde,
            }
        })
        .collect();

    Ok(PlanungAnzeige {
        kopf: kopf.anzeige()?,
        posten: posten_zeilen
            .into_iter()
            .map(PostenZeile::anzeige)
            .collect::<Result<_, _>>()?,
        bloecke,
        helfer,
        kennzahlen,
    })
}

/// Kennzahlen einer Planung aus derselben Prüfung wie [`laden`].
async fn kennzahlen_von(
    conn: &mut SqliteConnection,
    org_id: i64,
    id: i64,
    grenzwerte: SchichtplanGrenzwerte,
) -> Result<PlanungKennzahlen, AppError> {
    let nicht_verfuegbar: HashMap<i64, bool> = sqlx::query_as(
        "SELECT p.id, (COALESCE(v.aktiv = 0, 0) OR COALESCE(f.dienststatus = 'ausser_dienst', 0)) \
         FROM planung_posten p \
         LEFT JOIN einheit_vorlage v ON v.id = p.einheit_vorlage_id \
         LEFT JOIN fahrzeug f ON f.id = p.fahrzeug_id WHERE p.planung_id = ?",
    )
    .bind(id)
    .fetch_all(&mut *conn)
    .await?
    .into_iter()
    .collect();
    let g = pruefe_planung(conn, org_id, id, grenzwerte, &nicht_verfuegbar).await?;
    Ok(kennzahlen(&g.bloecke, &g.ergebnis))
}

/// Die Planungen der Organisation: laufende und künftige zuerst, dann vergangene, je nach
/// Beginn. Kennzahlen nur, wenn das Ende höchstens [`KENNZAHLEN_TAGE`] zurückliegt.
pub async fn liste(
    pool: &SqlitePool,
    org_id: i64,
    jetzt: DateTime<Utc>,
) -> Result<Vec<PlanungListeneintrag>, AppError> {
    let mut conn = pool.acquire().await?;
    type Zeile = (
        i64,
        String,
        String,
        Option<String>,
        String,
        String,
        Option<i64>,
        Option<i64>,
        i64,
        i64,
    );
    let zeilen: Vec<Zeile> = sqlx::query_as(
        "SELECT p.id, p.bezeichnung, p.einsatzart, p.ort, p.von, p.bis, p.max_dienst_min, \
                p.min_ruhe_min, \
                (SELECT COUNT(*) FROM planung_posten pp WHERE pp.planung_id = p.id), \
                (SELECT COUNT(*) FROM planung_schicht s WHERE s.planung_id = p.id) \
         FROM planung p WHERE p.org_id = ? \
         ORDER BY p.bis < ?, p.von, p.id",
    )
    .bind(org_id)
    .bind(zeit::formatiere_utc(jetzt))
    .fetch_all(&mut *conn)
    .await?;
    let grenze = zeit::formatiere_utc(jetzt - Duration::days(KENNZAHLEN_TAGE));
    let mut aus = Vec::with_capacity(zeilen.len());
    for (id, bezeichnung, art, ort, von, bis, max, ruhe, posten, bloecke) in zeilen {
        let kennzahlen = if bis >= grenze {
            Some(
                kennzahlen_von(&mut conn, org_id, id, SchichtplanGrenzwerte::aus(max, ruhe))
                    .await?,
            )
        } else {
            None
        };
        aus.push(PlanungListeneintrag {
            id,
            einsatzart: Einsatzart::parse(&art)
                .ok_or_else(|| AppError::Internal(format!("Planung {id} ohne Einsatzart")))?,
            bezeichnung,
            ort,
            loeschung_at: loeschung_at(&bis),
            von,
            bis,
            posten_anzahl: posten,
            bloecke_anzahl: bloecke,
            kennzahlen,
        });
    }
    Ok(aus)
}

// ---------------------------------------------------------------------------------------------
// Planung schreiben
// ---------------------------------------------------------------------------------------------

async fn pruefe_bezeichnung_frei_tx(
    conn: &mut SqliteConnection,
    org_id: i64,
    bezeichnung: &str,
    ausser: Option<i64>,
) -> Result<(), AppError> {
    let belegt: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM planung \
          WHERE org_id = ? AND bezeichnung = ? COLLATE NOCASE AND id IS NOT ?)",
    )
    .bind(org_id)
    .bind(bezeichnung)
    .bind(ausser)
    .fetch_one(&mut *conn)
    .await?;
    if belegt {
        return Err(AppError::Conflict(format!(
            "Eine Planung „{bezeichnung}“ gibt es schon"
        )));
    }
    Ok(())
}

/// Legt eine Planung an. Bezeichnung doppelt 409, mehr als [`PLANUNGEN_MAX`] 422.
pub async fn anlegen(
    pool: &SqlitePool,
    org_id: i64,
    benutzer_id: i64,
    e: &KopfEingabe,
) -> Result<i64, AppError> {
    write_retry!(pool, |conn| {
        anlegen_tx(conn, org_id, benutzer_id, e).await
    })
}

/// [`anlegen`] in einer offenen Transaktion (auch für den Demo-Import).
pub async fn anlegen_tx(
    conn: &mut SqliteConnection,
    org_id: i64,
    benutzer_id: i64,
    e: &KopfEingabe,
) -> Result<i64, AppError> {
    let bisher: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM planung WHERE org_id = ?")
        .bind(org_id)
        .fetch_one(&mut *conn)
        .await?;
    if bisher >= PLANUNGEN_MAX {
        return Err(AppError::UnprocessableEntity(format!(
            "Höchstens {PLANUNGEN_MAX} Planungen je Organisation"
        )));
    }
    pruefe_bezeichnung_frei_tx(conn, org_id, &e.bezeichnung, None).await?;
    Ok(sqlx::query_scalar(
        "INSERT INTO planung (org_id, bezeichnung, einsatzart, ort, ort_lat, ort_lon, von, \
            bis, max_dienst_min, min_ruhe_min, angelegt_von) \
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id",
    )
    .bind(org_id)
    .bind(&e.bezeichnung)
    .bind(e.einsatzart.as_str())
    .bind(&e.ort)
    .bind(e.koordinate.map(|k| k.0))
    .bind(e.koordinate.map(|k| k.1))
    .bind(&e.von)
    .bind(&e.bis)
    .bind(e.max_dienst)
    .bind(e.min_ruhe)
    .bind(benutzer_id)
    .fetch_one(&mut *conn)
    .await?)
}

/// Ändert den Kopf mit CAS über `version` (409). Ein Zeitraum über die Grenze ist 422.
pub async fn aendern(
    pool: &SqlitePool,
    org_id: i64,
    id: i64,
    benutzer_id: i64,
    p: &KopfPatch,
    jetzt: &str,
) -> Result<(), AppError> {
    write_retry!(pool, |conn| {
        let k = kopf_tx(conn, org_id, id).await?;
        if k.version != p.version {
            return Err(AppError::Conflict(
                "Die Planung wurde zwischenzeitlich geändert".into(),
            ));
        }
        let bezeichnung = p.bezeichnung.clone().unwrap_or(k.bezeichnung);
        if p.bezeichnung.is_some() {
            pruefe_bezeichnung_frei_tx(conn, org_id, &bezeichnung, Some(id)).await?;
        }
        let von = p.von.clone().unwrap_or(k.von);
        let bis = p.bis.clone().unwrap_or(k.bis);
        pruefe_zeitraum(&von, &bis).map_err(als_422)?;
        let einsatzart = p
            .einsatzart
            .map(|a| a.as_str().to_string())
            .unwrap_or(k.einsatzart);
        let ort = p.ort.clone().unwrap_or(k.ort);
        let koordinate = p.koordinate.unwrap_or_else(|| k.ort_lat.zip(k.ort_lon));
        let max = p.max_dienst.unwrap_or(k.max_dienst_min);
        let ruhe = p.min_ruhe.unwrap_or(k.min_ruhe_min);
        sqlx::query(
            "UPDATE planung SET bezeichnung = ?, einsatzart = ?, ort = ?, ort_lat = ?, \
                ort_lon = ?, von = ?, bis = ?, max_dienst_min = ?, min_ruhe_min = ?, \
                version = version + 1, geaendert_at = ?, geaendert_von = ? \
             WHERE id = ? AND version = ?",
        )
        .bind(&bezeichnung)
        .bind(&einsatzart)
        .bind(&ort)
        .bind(koordinate.map(|k| k.0))
        .bind(koordinate.map(|k| k.1))
        .bind(&von)
        .bind(&bis)
        .bind(max)
        .bind(ruhe)
        .bind(jetzt)
        .bind(benutzer_id)
        .bind(id)
        .bind(k.version)
        .execute(&mut *conn)
        .await?;
        Ok(())
    })
}

async fn loeschen_tx(conn: &mut SqliteConnection, id: i64) -> Result<(), AppError> {
    sqlx::query("DELETE FROM planung WHERE id = ?")
        .bind(id)
        .execute(&mut *conn)
        .await?;
    // Die Demo-Markierung zeigt ohne FK auf die Planung (0212, 0293).
    sqlx::query("DELETE FROM demo_herkunft WHERE tabelle = 'planung' AND datensatz_id = ?")
        .bind(id)
        .execute(&mut *conn)
        .await?;
    Ok(())
}

/// Löscht eine Planung samt Posten, Blöcken und Helfern. Fremd oder unbekannt → 404.
pub async fn loeschen(pool: &SqlitePool, org_id: i64, id: i64) -> Result<(), AppError> {
    write_retry!(pool, |conn| {
        kopf_tx(conn, org_id, id).await?;
        loeschen_tx(conn, id).await
    })
}

/// Aufbewahrung (Spec `vorplanung`): löscht jede Planung, deren Ende länger als
/// [`AUFBEWAHRUNG_TAGE`] zurückliegt, je in einer eigenen Transaktion. Liefert Organisation und
/// Kennung der gelöschten. Scheitert eine einzelne Löschung, bleibt sie für den nächsten Lauf
/// stehen und die übrigen laufen weiter: die schon gelöschten fallen nie aus dem Ergebnis, damit
/// der Aufrufer sie meldet und den WAL-Rückschrieb vormerkt.
pub async fn purge_abgelaufene(
    pool: &SqlitePool,
    jetzt: DateTime<Utc>,
) -> Result<Vec<(i64, i64)>, AppError> {
    let grenze = zeit::formatiere_utc(jetzt - Duration::days(AUFBEWAHRUNG_TAGE));
    let faellig: Vec<(i64, i64)> =
        sqlx::query_as("SELECT org_id, id FROM planung WHERE bis < ? ORDER BY id")
            .bind(&grenze)
            .fetch_all(pool)
            .await?;
    let mut geloescht = Vec::with_capacity(faellig.len());
    for (org_id, id) in faellig {
        let entfernt: Result<bool, AppError> = write_retry!(pool, |conn| {
            // Im selben Stand noch fällig? Ein PATCH kann das Ende verschoben haben.
            let noch: bool =
                sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM planung WHERE id = ? AND bis < ?)")
                    .bind(id)
                    .bind(&grenze)
                    .fetch_one(&mut *conn)
                    .await?;
            if noch {
                loeschen_tx(conn, id).await?;
            }
            Ok(noch)
        });
        match entfernt {
            Ok(true) => geloescht.push((org_id, id)),
            Ok(false) => {}
            Err(e) => {
                tracing::warn!(
                    planung_id = id,
                    "Purge: Planung nicht gelöscht, nächster Lauf: {e}"
                )
            }
        }
    }
    Ok(geloescht)
}

// ---------------------------------------------------------------------------------------------
// Posten
// ---------------------------------------------------------------------------------------------

/// Soll einer Herkunft: Vorlage = wirksames Soll F/UF/M (eigen → Typ) und Qualifikationssoll,
/// Fahrzeug = Sollbesatzung, sonst keins. Die Herkunft gehört zur Organisation und besteht (422).
async fn herkunft_soll_tx(
    conn: &mut SqliteConnection,
    org_id: i64,
    herkunft: Herkunft,
) -> Result<(Option<i64>, Option<String>), AppError> {
    let (anzahl, quali) = match herkunft {
        Herkunft::Frei | Herkunft::Uhs(_) => (None, None),
        Herkunft::Vorlage(vid) => {
            let zeile: Option<(Option<i64>, Option<String>, bool)> = sqlx::query_as(
                "SELECT CASE \
                   WHEN v.soll_fuehrer IS NOT NULL \
                     THEN v.soll_fuehrer + v.soll_unterfuehrer + v.soll_mannschaft \
                   WHEN t.soll_fuehrer IS NOT NULL AND t.soll_unterfuehrer IS NOT NULL \
                        AND t.soll_mannschaft IS NOT NULL \
                     THEN t.soll_fuehrer + t.soll_unterfuehrer + t.soll_mannschaft \
                 END, COALESCE(v.quali_soll, t.quali_soll), v.aktiv = 1 \
                 FROM einheit_vorlage v LEFT JOIN einheit_typ t ON t.id = v.typ_id \
                 WHERE v.id = ? AND v.org_id = ?",
            )
            .bind(vid)
            .bind(org_id)
            .fetch_optional(&mut *conn)
            .await?;
            match zeile {
                Some((anzahl, quali, true)) => (anzahl, quali),
                _ => {
                    return Err(AppError::UnprocessableEntity(
                        "Die Einheitenvorlage gibt es in der Organisation nicht".into(),
                    ))
                }
            }
        }
        Herkunft::Fahrzeug(fid) => {
            let zeile: Option<(Option<i64>, String)> = sqlx::query_as(
                "SELECT staerke_fuehrer + staerke_unterfuehrer + staerke_mannschaft, \
                        dienststatus FROM fahrzeug WHERE id = ? AND org_id = ?",
            )
            .bind(fid)
            .bind(org_id)
            .fetch_optional(&mut *conn)
            .await?;
            match zeile {
                Some((anzahl, status)) if status != "ausser_dienst" => (anzahl, None),
                Some(_) => {
                    return Err(AppError::UnprocessableEntity(
                        "Das Fahrzeug ist außer Dienst".into(),
                    ))
                }
                None => {
                    return Err(AppError::UnprocessableEntity(
                        "Das Fahrzeug gehört nicht zur Organisation".into(),
                    ))
                }
            }
        }
    };
    Ok((
        anzahl.filter(|n| *n > 0).map(|n| n.min(SOLL_ANZAHL_MAX)),
        quali,
    ))
}

async fn pruefe_posten_bezeichnung_tx(
    conn: &mut SqliteConnection,
    planung_id: i64,
    bezeichnung: &str,
    ausser: Option<i64>,
) -> Result<(), AppError> {
    let belegt: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM planung_posten \
          WHERE planung_id = ? AND bezeichnung = ? COLLATE NOCASE AND id IS NOT ?)",
    )
    .bind(planung_id)
    .bind(bezeichnung)
    .bind(ausser)
    .fetch_one(&mut *conn)
    .await?;
    if belegt {
        return Err(AppError::Conflict(format!(
            "Einen Posten „{bezeichnung}“ gibt es in der Planung schon"
        )));
    }
    Ok(())
}

/// Legt einen Posten am Ende der Reihenfolge an. Liefert die Kennung.
pub async fn posten_anlegen(
    pool: &SqlitePool,
    org_id: i64,
    planung_id: i64,
    e: &PostenEingabe,
) -> Result<i64, AppError> {
    write_retry!(pool, |conn| {
        posten_anlegen_tx(conn, org_id, planung_id, e).await
    })
}

/// [`posten_anlegen`] in einer offenen Transaktion (auch für den Demo-Import).
pub async fn posten_anlegen_tx(
    conn: &mut SqliteConnection,
    org_id: i64,
    planung_id: i64,
    e: &PostenEingabe,
) -> Result<i64, AppError> {
    kopf_tx(conn, org_id, planung_id).await?;
    let (bisher, sortier): (i64, i64) = sqlx::query_as(
        "SELECT COUNT(*), COALESCE(MAX(sortier) + 1, 0) FROM planung_posten \
         WHERE planung_id = ?",
    )
    .bind(planung_id)
    .fetch_one(&mut *conn)
    .await?;
    if bisher >= POSTEN_MAX {
        return Err(AppError::UnprocessableEntity(format!(
            "Höchstens {POSTEN_MAX} Posten je Planung"
        )));
    }
    pruefe_posten_bezeichnung_tx(conn, planung_id, &e.bezeichnung, None).await?;
    let (vorgabe_anzahl, vorgabe_quali) = herkunft_soll_tx(conn, org_id, e.herkunft).await?;
    let soll_anzahl = e.soll_anzahl.unwrap_or(vorgabe_anzahl);
    let quali_soll = e.quali_soll.clone().unwrap_or(vorgabe_quali);
    crate::personal::quali_soll::pruefe_org(&mut *conn, org_id, quali_soll.as_deref()).await?;
    let (vorlage, fahrzeug, uhs_typ) = match e.herkunft {
        Herkunft::Frei => (None, None, None),
        Herkunft::Vorlage(v) => (Some(v), None, None),
        Herkunft::Fahrzeug(f) => (None, Some(f), None),
        Herkunft::Uhs(t) => (None, None, Some(t.as_str())),
    };
    Ok(sqlx::query_scalar(
        "INSERT INTO planung_posten (planung_id, bezeichnung, abschnitt, art, \
            einheit_vorlage_id, fahrzeug_id, uhs_typ, sortier, schichtlaenge_min, \
            soll_anzahl, quali_soll) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id",
    )
    .bind(planung_id)
    .bind(&e.bezeichnung)
    .bind(&e.abschnitt)
    .bind(e.herkunft.art().as_str())
    .bind(vorlage)
    .bind(fahrzeug)
    .bind(uhs_typ)
    .bind(sortier)
    .bind(e.schichtlaenge)
    .bind(soll_anzahl)
    .bind(&quali_soll)
    .fetch_one(&mut *conn)
    .await?)
}

/// Ändert einen Posten; bestehende Blöcke behalten ihr Soll (Kopie beim Anlegen).
pub async fn posten_aendern(
    pool: &SqlitePool,
    org_id: i64,
    planung_id: i64,
    posten_id: i64,
    p: &PostenPatch,
) -> Result<(), AppError> {
    write_retry!(pool, |conn| {
        kopf_tx(conn, org_id, planung_id).await?;
        type Stand = (
            String,
            Option<String>,
            Option<i64>,
            Option<i64>,
            Option<String>,
        );
        let stand: Stand = sqlx::query_as(
            "SELECT bezeichnung, abschnitt, schichtlaenge_min, soll_anzahl, quali_soll \
             FROM planung_posten WHERE id = ? AND planung_id = ?",
        )
        .bind(posten_id)
        .bind(planung_id)
        .fetch_optional(&mut *conn)
        .await?
        .ok_or(AppError::NotFound)?;
        let (bezeichnung_alt, abschnitt_alt, laenge_alt, soll_alt, quali_alt) = stand;
        if let Some(b) = &p.bezeichnung {
            pruefe_posten_bezeichnung_tx(conn, planung_id, b, Some(posten_id)).await?;
        }
        if let Some(q) = &p.quali_soll {
            crate::personal::quali_soll::pruefe_org(&mut *conn, org_id, q.as_deref()).await?;
        }
        sqlx::query(
            "UPDATE planung_posten SET bezeichnung = ?, abschnitt = ?, schichtlaenge_min = ?, \
                soll_anzahl = ?, quali_soll = ? WHERE id = ?",
        )
        .bind(p.bezeichnung.clone().unwrap_or(bezeichnung_alt))
        .bind(p.abschnitt.clone().unwrap_or(abschnitt_alt))
        .bind(p.schichtlaenge.unwrap_or(laenge_alt))
        .bind(p.soll_anzahl.unwrap_or(soll_alt))
        .bind(p.quali_soll.clone().unwrap_or(quali_alt))
        .bind(posten_id)
        .execute(&mut *conn)
        .await?;
        Ok(())
    })
}

/// Löscht einen Posten samt seinen Blöcken. Haben die Blöcke Personen, nur mit `mit_bloecken`
/// (422 sonst).
pub async fn posten_loeschen(
    pool: &SqlitePool,
    org_id: i64,
    planung_id: i64,
    posten_id: i64,
    mit_bloecken: bool,
) -> Result<(), AppError> {
    write_retry!(pool, |conn| {
        kopf_tx(conn, org_id, planung_id).await?;
        let da: bool = sqlx::query_scalar(
            "SELECT EXISTS(SELECT 1 FROM planung_posten WHERE id = ? AND planung_id = ?)",
        )
        .bind(posten_id)
        .bind(planung_id)
        .fetch_one(&mut *conn)
        .await?;
        if !da {
            return Err(AppError::NotFound);
        }
        if !mit_bloecken {
            let belegt: bool = sqlx::query_scalar(
                "SELECT EXISTS(SELECT 1 FROM planung_schicht_person sp \
                  JOIN planung_schicht s ON s.id = sp.schicht_id WHERE s.posten_id = ?)",
            )
            .bind(posten_id)
            .fetch_one(&mut *conn)
            .await?;
            if belegt {
                return Err(AppError::UnprocessableEntity(
                    "In den Schichten des Postens sind Personen eingeteilt".into(),
                ));
            }
        }
        sqlx::query("DELETE FROM planung_posten WHERE id = ?")
            .bind(posten_id)
            .execute(&mut *conn)
            .await?;
        Ok(())
    })
}

/// Setzt die ganze Reihenfolge der Posten. Die Liste nennt jeden Posten der Planung genau
/// einmal (422 sonst).
pub async fn reihenfolge(
    pool: &SqlitePool,
    org_id: i64,
    planung_id: i64,
    ids: &[i64],
) -> Result<(), AppError> {
    let json = serde_json::to_string(ids).unwrap_or_else(|_| "[]".into());
    write_retry!(pool, |conn| {
        kopf_tx(conn, org_id, planung_id).await?;
        let (gesamt, getroffen): (i64, i64) = sqlx::query_as(
            "SELECT (SELECT COUNT(*) FROM planung_posten WHERE planung_id = ?1), \
                    (SELECT COUNT(DISTINCT p.id) FROM json_each(?2) j \
                      JOIN planung_posten p ON p.id = j.value AND p.planung_id = ?1)",
        )
        .bind(planung_id)
        .bind(&json)
        .fetch_one(&mut *conn)
        .await?;
        if gesamt != ids.len() as i64 || getroffen != gesamt {
            return Err(AppError::UnprocessableEntity(
                "Die Reihenfolge nennt jeden Posten der Planung genau einmal".into(),
            ));
        }
        sqlx::query(
            "UPDATE planung_posten SET sortier = (SELECT j.key FROM json_each(?2) j \
               WHERE j.value = planung_posten.id) WHERE planung_id = ?1",
        )
        .bind(planung_id)
        .bind(&json)
        .execute(&mut *conn)
        .await?;
        Ok(())
    })
}

// ---------------------------------------------------------------------------------------------
// Blöcke
// ---------------------------------------------------------------------------------------------

/// Der Posten gehört zur Planung (422 sonst). Liefert seine Soll-Vorgabe, Bezeichnung und
/// Schichtlänge; die Pause hat keins davon.
async fn posten_tx(
    conn: &mut SqliteConnection,
    planung_id: i64,
    posten_id: Option<i64>,
) -> Result<(Option<i64>, Option<String>, Option<String>, Option<i64>), AppError> {
    let Some(pid) = posten_id else {
        return Ok((None, None, None, None));
    };
    let zeile: Option<(Option<i64>, Option<String>, String, Option<i64>)> = sqlx::query_as(
        "SELECT soll_anzahl, quali_soll, bezeichnung, schichtlaenge_min FROM planung_posten \
         WHERE id = ? AND planung_id = ?",
    )
    .bind(pid)
    .bind(planung_id)
    .fetch_optional(&mut *conn)
    .await?;
    let (anzahl, quali, bezeichnung, laenge) = zeile.ok_or_else(|| {
        AppError::UnprocessableEntity("Der Posten gehört nicht zu dieser Planung".into())
    })?;
    Ok((anzahl, quali, Some(bezeichnung), laenge))
}

/// Ein Block am Posten, der sich mit `[von, bis)` überschneidet (außer `ausser`); die Pause darf
/// überlappen.
async fn ueberschneidung_tx(
    conn: &mut SqliteConnection,
    planung_id: i64,
    posten_id: Option<i64>,
    von: &str,
    bis: &str,
    ausser: Option<i64>,
) -> Result<Option<(i64, String, String)>, AppError> {
    let Some(pid) = posten_id else {
        return Ok(None);
    };
    Ok(sqlx::query_as(
        "SELECT id, von, bis FROM planung_schicht \
         WHERE planung_id = ? AND posten_id = ? AND von < ? AND bis > ? AND id IS NOT ? \
         ORDER BY von LIMIT 1",
    )
    .bind(planung_id)
    .bind(pid)
    .bind(bis)
    .bind(von)
    .bind(ausser)
    .fetch_optional(&mut *conn)
    .await?)
}

#[allow(clippy::too_many_arguments)]
async fn pruefe_frei_tx(
    conn: &mut SqliteConnection,
    org_id: i64,
    planung_id: i64,
    posten_id: Option<i64>,
    von: &str,
    bis: &str,
    ausser: Option<i64>,
) -> Result<(), AppError> {
    if let Some((_, a, b)) =
        ueberschneidung_tx(conn, planung_id, posten_id, von, bis, ausser).await?
    {
        let stil = zeitstil_org(conn, org_id).await?;
        return Err(AppError::UnprocessableEntity(format!(
            "Die Schicht überschneidet sich mit {}",
            zeitraum_text(&stil, &a, &b)
        )));
    }
    Ok(())
}

fn ids_json(personen: &[PlanPerson], stamm: bool) -> String {
    let ids: Vec<i64> = personen
        .iter()
        .filter(|p| matches!(p, PlanPerson::Stamm(_)) == stamm)
        .map(|p| p.id())
        .collect();
    serde_json::to_string(&ids).unwrap_or_else(|_| "[]".into())
}

/// Jede Person gehört zur Organisation bzw. ist ein Helfer der Planung (422 sonst). Eine
/// Ad-hoc-Kraft gibt es ohne Einsatz nicht (der Handler lässt sie gar nicht zu).
async fn pruefe_personen_tx(
    conn: &mut SqliteConnection,
    org_id: i64,
    planung_id: i64,
    personen: &[PlanPerson],
) -> Result<(), AppError> {
    if personen.is_empty() {
        return Ok(());
    }
    if personen.iter().any(|p| matches!(p, PlanPerson::Einsatz(_))) {
        return Err(AppError::UnprocessableEntity(
            "Eine Planung kennt nur Stamm-Personal und Helfer".into(),
        ));
    }
    let fremd_stamm: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM json_each(?1) j \
         LEFT JOIN personal p ON p.id = j.value AND p.org_id = ?2 WHERE p.id IS NULL",
    )
    .bind(ids_json(personen, true))
    .bind(org_id)
    .fetch_one(&mut *conn)
    .await?;
    if fremd_stamm > 0 {
        return Err(AppError::UnprocessableEntity(
            "Eine Person gehört nicht zur Organisation".into(),
        ));
    }
    let fremd_helfer: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM json_each(?1) j \
         LEFT JOIN planung_helfer h ON h.id = j.value AND h.planung_id = ?2 WHERE h.id IS NULL",
    )
    .bind(ids_json(personen, false))
    .bind(planung_id)
    .fetch_one(&mut *conn)
    .await?;
    if fremd_helfer > 0 {
        return Err(AppError::UnprocessableEntity(
            "Ein Helfer gehört nicht zu dieser Planung".into(),
        ));
    }
    Ok(())
}

/// Ersetzt die Personen eines Blocks (drei Anweisungen, unabhängig von der Zahl).
async fn schreibe_personen_tx(
    conn: &mut SqliteConnection,
    bid: i64,
    personen: &[PlanPerson],
) -> Result<(), AppError> {
    sqlx::query("DELETE FROM planung_schicht_person WHERE schicht_id = ?")
        .bind(bid)
        .execute(&mut *conn)
        .await?;
    sqlx::query(
        "INSERT INTO planung_schicht_person (schicht_id, personal_id) \
         SELECT ?1, j.value FROM json_each(?2) j ORDER BY j.key",
    )
    .bind(bid)
    .bind(ids_json(personen, true))
    .execute(&mut *conn)
    .await?;
    sqlx::query(
        "INSERT INTO planung_schicht_person (schicht_id, helfer_id) \
         SELECT ?1, j.value FROM json_each(?2) j ORDER BY j.key",
    )
    .bind(bid)
    .bind(ids_json(personen, false))
    .execute(&mut *conn)
    .await?;
    Ok(())
}

async fn pruefe_anzahl_tx(
    conn: &mut SqliteConnection,
    planung_id: i64,
    neu: usize,
) -> Result<(), AppError> {
    let bisher: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM planung_schicht WHERE planung_id = ?")
            .bind(planung_id)
            .fetch_one(&mut *conn)
            .await?;
    if bisher + neu as i64 > PLAN_BLOECKE_MAX {
        return Err(AppError::UnprocessableEntity(format!(
            "Höchstens {PLAN_BLOECKE_MAX} Schichten je Planung"
        )));
    }
    Ok(())
}

#[allow(clippy::too_many_arguments)]
async fn insert_block_tx(
    conn: &mut SqliteConnection,
    planung_id: i64,
    benutzer_id: i64,
    posten_id: Option<i64>,
    von: &str,
    bis: &str,
    soll_anzahl: Option<i64>,
    quali_soll: Option<&str>,
    notiz: Option<&str>,
) -> Result<i64, AppError> {
    Ok(sqlx::query_scalar(
        "INSERT INTO planung_schicht (planung_id, posten_id, von, bis, soll_anzahl, quali_soll, \
            notiz, angelegt_von) VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING id",
    )
    .bind(planung_id)
    .bind(posten_id)
    .bind(von)
    .bind(bis)
    .bind(soll_anzahl)
    .bind(quali_soll)
    .bind(notiz)
    .bind(benutzer_id)
    .fetch_one(&mut *conn)
    .await?)
}

fn pause_ohne_soll(
    posten_id: Option<i64>,
    soll: Option<i64>,
    quali: Option<&str>,
) -> Result<(), AppError> {
    if posten_id.is_none() && (soll.is_some() || quali.is_some()) {
        return Err(AppError::UnprocessableEntity(
            "Die Pause hat kein Soll".into(),
        ));
    }
    Ok(())
}

/// Legt einen Block an. Liefert die Kennung.
pub async fn block_anlegen(
    pool: &SqlitePool,
    org_id: i64,
    planung_id: i64,
    benutzer_id: i64,
    e: &BlockEingabe,
) -> Result<i64, AppError> {
    write_retry!(pool, |conn| {
        block_anlegen_tx(conn, org_id, planung_id, benutzer_id, e).await
    })
}

/// [`block_anlegen`] in einer offenen Transaktion (auch für den Demo-Import).
pub async fn block_anlegen_tx(
    conn: &mut SqliteConnection,
    org_id: i64,
    planung_id: i64,
    benutzer_id: i64,
    e: &BlockEingabe,
) -> Result<i64, AppError> {
    kopf_tx(conn, org_id, planung_id).await?;
    let (vorgabe_anzahl, vorgabe_quali, _, _) = posten_tx(conn, planung_id, e.posten_id).await?;
    pruefe_anzahl_tx(conn, planung_id, 1).await?;
    let soll_anzahl = e.soll_anzahl.unwrap_or(vorgabe_anzahl);
    let quali_soll = e.quali_soll.clone().unwrap_or(vorgabe_quali);
    pause_ohne_soll(e.posten_id, soll_anzahl, quali_soll.as_deref())?;
    crate::personal::quali_soll::pruefe_org(&mut *conn, org_id, quali_soll.as_deref()).await?;
    pruefe_personen_tx(conn, org_id, planung_id, &e.personen).await?;
    pruefe_frei_tx(conn, org_id, planung_id, e.posten_id, &e.von, &e.bis, None).await?;
    let bid = insert_block_tx(
        conn,
        planung_id,
        benutzer_id,
        e.posten_id,
        &e.von,
        &e.bis,
        soll_anzahl,
        quali_soll.as_deref(),
        e.notiz.as_deref(),
    )
    .await?;
    schreibe_personen_tx(conn, bid, &e.personen).await?;
    Ok(bid)
}

/// Ändert einen Block mit CAS über `version` (409). Verschieben in die Pause löscht das Soll.
pub async fn block_aendern(
    pool: &SqlitePool,
    org_id: i64,
    planung_id: i64,
    bid: i64,
    benutzer_id: i64,
    p: &BlockPatch,
    jetzt: &str,
) -> Result<(), AppError> {
    write_retry!(pool, |conn| {
        kopf_tx(conn, org_id, planung_id).await?;
        type Stand = (
            i64,
            Option<i64>,
            String,
            String,
            Option<i64>,
            Option<String>,
            Option<String>,
        );
        let stand: Stand = sqlx::query_as(
            "SELECT version, posten_id, von, bis, soll_anzahl, quali_soll, notiz \
             FROM planung_schicht WHERE id = ? AND planung_id = ?",
        )
        .bind(bid)
        .bind(planung_id)
        .fetch_optional(&mut *conn)
        .await?
        .ok_or(AppError::NotFound)?;
        let (version, posten_alt, von_alt, bis_alt, soll_alt, quali_alt, notiz_alt) = stand;
        if version != p.version {
            return Err(AppError::Conflict(
                "Die Schicht wurde zwischenzeitlich geändert".into(),
            ));
        }
        let posten = p.posten.unwrap_or(posten_alt);
        if posten != posten_alt {
            posten_tx(conn, planung_id, posten).await?;
        }
        let von = p.von.clone().unwrap_or(von_alt);
        let bis = p.bis.clone().unwrap_or(bis_alt);
        zerlegung::pruefe_zeitraum(utc(&von)?, utc(&bis)?).map_err(als_422)?;
        let (mut soll_anzahl, mut quali_soll) = (soll_alt, quali_alt);
        if posten.is_none() && posten_alt.is_some() {
            (soll_anzahl, quali_soll) = (None, None);
        }
        if let Some(neu) = p.soll_anzahl {
            soll_anzahl = neu;
        }
        if let Some(neu) = &p.quali_soll {
            quali_soll = neu.clone();
        }
        pause_ohne_soll(posten, soll_anzahl, quali_soll.as_deref())?;
        if p.quali_soll.is_some() {
            crate::personal::quali_soll::pruefe_org(&mut *conn, org_id, quali_soll.as_deref())
                .await?;
        }
        if let Some(personen) = &p.personen {
            pruefe_personen_tx(conn, org_id, planung_id, personen).await?;
        }
        pruefe_frei_tx(conn, org_id, planung_id, posten, &von, &bis, Some(bid)).await?;
        let notiz = match &p.notiz {
            Some(n) => n.clone(),
            None => notiz_alt,
        };
        sqlx::query(
            "UPDATE planung_schicht SET posten_id = ?, von = ?, bis = ?, soll_anzahl = ?, \
                quali_soll = ?, notiz = ?, version = version + 1, geaendert_at = ?, \
                geaendert_von = ? WHERE id = ? AND version = ?",
        )
        .bind(posten)
        .bind(&von)
        .bind(&bis)
        .bind(soll_anzahl)
        .bind(&quali_soll)
        .bind(&notiz)
        .bind(jetzt)
        .bind(benutzer_id)
        .bind(bid)
        .bind(version)
        .execute(&mut *conn)
        .await?;
        if let Some(personen) = &p.personen {
            schreibe_personen_tx(conn, bid, personen).await?;
        }
        Ok(())
    })
}

/// Löscht einen Block mit CAS über `version` (409).
pub async fn block_loeschen(
    pool: &SqlitePool,
    org_id: i64,
    planung_id: i64,
    bid: i64,
    version: i64,
) -> Result<(), AppError> {
    write_retry!(pool, |conn| {
        kopf_tx(conn, org_id, planung_id).await?;
        let stand: Option<i64> = sqlx::query_scalar(
            "SELECT version FROM planung_schicht WHERE id = ? AND planung_id = ?",
        )
        .bind(bid)
        .bind(planung_id)
        .fetch_optional(&mut *conn)
        .await?;
        match stand {
            None => return Err(AppError::NotFound),
            Some(v) if v != version => {
                return Err(AppError::Conflict(
                    "Die Schicht wurde zwischenzeitlich geändert".into(),
                ))
            }
            Some(_) => {}
        }
        sqlx::query("DELETE FROM planung_schicht WHERE id = ?")
            .bind(bid)
            .execute(&mut *conn)
            .await?;
        Ok(())
    })
}

/// Füllt `[von, bis)` an einem Posten mit Blöcken (design.md D5): Länge aus der Angabe oder der
/// Schichtlänge des Postens (422 ohne beides), alles oder nichts. Liefert die neuen Kennungen.
#[allow(clippy::too_many_arguments)]
pub async fn erzeugen(
    pool: &SqlitePool,
    org_id: i64,
    planung_id: i64,
    benutzer_id: i64,
    posten_id: Option<i64>,
    von: &str,
    bis: &str,
    laenge_minuten: Option<i64>,
) -> Result<Vec<i64>, AppError> {
    let (von_t, bis_t) = (utc(von)?, utc(bis)?);
    write_retry!(pool, |conn| {
        kopf_tx(conn, org_id, planung_id).await?;
        let (anzahl, quali, _, schichtlaenge) = posten_tx(conn, planung_id, posten_id).await?;
        let laenge = laenge_minuten.or(schichtlaenge).ok_or_else(|| {
            AppError::UnprocessableEntity(
                "Der Posten hat keine Schichtlänge; bitte eine Länge angeben".into(),
            )
        })?;
        let teile = zerlegung::zerlege(von_t, bis_t, &Teilung::Laenge(laenge))?;
        pruefe_anzahl_tx(conn, planung_id, teile.len()).await?;

        let mut konflikte: Vec<ZeilenGrund> = Vec::new();
        let mut stil = None;
        for (a, b) in &teile {
            let (a, b) = (zeit::formatiere_utc(*a), zeit::formatiere_utc(*b));
            if let Some((id, x, y)) =
                ueberschneidung_tx(conn, planung_id, posten_id, &a, &b, None).await?
            {
                if !konflikte.iter().any(|k| k.id == id) {
                    if stil.is_none() {
                        stil = Some(zeitstil_org(conn, org_id).await?);
                    }
                    let s = stil.as_ref().unwrap_or(&Zeitstil::VORGABE);
                    konflikte.push(ZeilenGrund {
                        art: ZeilenArt::Planschicht,
                        id,
                        grund: format!("überschneidet sich mit {}", zeitraum_text(s, &x, &y)),
                    });
                }
            }
        }
        if !konflikte.is_empty() {
            return Err(AppError::Zeilen {
                meldung: "Erzeugte Schichten überschneiden sich mit bestehenden; nichts angelegt"
                    .into(),
                zeilen: konflikte,
            });
        }

        let mut ids = Vec::with_capacity(teile.len());
        for (a, b) in &teile {
            ids.push(
                insert_block_tx(
                    conn,
                    planung_id,
                    benutzer_id,
                    posten_id,
                    &zeit::formatiere_utc(*a),
                    &zeit::formatiere_utc(*b),
                    anzahl,
                    quali.as_deref(),
                    None,
                )
                .await?,
            );
        }
        Ok(ids)
    })
}

// ---------------------------------------------------------------------------------------------
// Helfer
// ---------------------------------------------------------------------------------------------

async fn pruefe_qualifikationen_tx(
    conn: &mut SqliteConnection,
    org_id: i64,
    ids: &[i64],
) -> Result<(), AppError> {
    let fremd: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM json_each(?1) j \
         LEFT JOIN qualifikation q ON q.id = j.value AND q.org_id = ?2 WHERE q.id IS NULL",
    )
    .bind(serde_json::to_string(ids).unwrap_or_else(|_| "[]".into()))
    .bind(org_id)
    .fetch_one(&mut *conn)
    .await?;
    if fremd > 0 {
        return Err(AppError::UnprocessableEntity(
            "Qualifikation gehört nicht zur Organisation".into(),
        ));
    }
    Ok(())
}

async fn helfer_laden_tx(
    conn: &mut SqliteConnection,
    planung_id: i64,
    hid: i64,
) -> Result<PlanHelferAnzeige, AppError> {
    let (id, name, telefon, organisation, quals): (
        i64,
        String,
        Option<String>,
        Option<String>,
        Option<String>,
    ) = sqlx::query_as(
        "SELECT id, name, telefon, organisation, qualifikationen FROM planung_helfer \
         WHERE id = ? AND planung_id = ?",
    )
    .bind(hid)
    .bind(planung_id)
    .fetch_optional(&mut *conn)
    .await?
    .ok_or(AppError::NotFound)?;
    Ok(PlanHelferAnzeige {
        id,
        name,
        telefon,
        organisation,
        qualifikationen: json_ids(quals.as_deref()),
    })
}

pub async fn helfer_anlegen(
    pool: &SqlitePool,
    org_id: i64,
    planung_id: i64,
    benutzer_id: i64,
    e: &HelferEingabe,
) -> Result<PlanHelferAnzeige, AppError> {
    write_retry!(pool, |conn| {
        helfer_anlegen_tx(conn, org_id, planung_id, benutzer_id, e).await
    })
}

/// [`helfer_anlegen`] in einer offenen Transaktion (auch für den Demo-Import).
pub async fn helfer_anlegen_tx(
    conn: &mut SqliteConnection,
    org_id: i64,
    planung_id: i64,
    benutzer_id: i64,
    e: &HelferEingabe,
) -> Result<PlanHelferAnzeige, AppError> {
    kopf_tx(conn, org_id, planung_id).await?;
    pruefe_qualifikationen_tx(conn, org_id, &e.qualifikationen).await?;
    let bisher: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM planung_helfer WHERE planung_id = ?")
            .bind(planung_id)
            .fetch_one(&mut *conn)
            .await?;
    if bisher >= PLAN_HELFER_MAX {
        return Err(AppError::UnprocessableEntity(format!(
            "Höchstens {PLAN_HELFER_MAX} Helfer je Planung"
        )));
    }
    let hid: i64 = sqlx::query_scalar(
        "INSERT INTO planung_helfer (planung_id, name, telefon, organisation, \
            qualifikationen, angelegt_von) VALUES (?, ?, ?, ?, ?, ?) RETURNING id",
    )
    .bind(planung_id)
    .bind(&e.name)
    .bind(&e.telefon)
    .bind(&e.organisation)
    .bind(quals_json(&e.qualifikationen))
    .bind(benutzer_id)
    .fetch_one(&mut *conn)
    .await?;
    helfer_laden_tx(conn, planung_id, hid).await
}

pub async fn helfer_aendern(
    pool: &SqlitePool,
    org_id: i64,
    planung_id: i64,
    hid: i64,
    p: &HelferPatch,
) -> Result<PlanHelferAnzeige, AppError> {
    write_retry!(pool, |conn| {
        kopf_tx(conn, org_id, planung_id).await?;
        let mut h = helfer_laden_tx(conn, planung_id, hid).await?;
        if let Some(ids) = &p.qualifikationen {
            pruefe_qualifikationen_tx(conn, org_id, ids).await?;
            h.qualifikationen = ids.clone();
        }
        if let Some(name) = &p.name {
            h.name = name.clone();
        }
        if let Some(t) = &p.telefon {
            h.telefon = t.clone();
        }
        if let Some(o) = &p.organisation {
            h.organisation = o.clone();
        }
        sqlx::query(
            "UPDATE planung_helfer SET name = ?, telefon = ?, organisation = ?, \
                qualifikationen = ? WHERE id = ?",
        )
        .bind(&h.name)
        .bind(&h.telefon)
        .bind(&h.organisation)
        .bind(quals_json(&h.qualifikationen))
        .bind(hid)
        .execute(&mut *conn)
        .await?;
        Ok(h)
    })
}

/// Löscht einen Helfer und nimmt ihn aus allen Blöcken (CASCADE).
pub async fn helfer_loeschen(
    pool: &SqlitePool,
    org_id: i64,
    planung_id: i64,
    hid: i64,
) -> Result<(), AppError> {
    write_retry!(pool, |conn| {
        kopf_tx(conn, org_id, planung_id).await?;
        let geloescht = sqlx::query("DELETE FROM planung_helfer WHERE id = ? AND planung_id = ?")
            .bind(hid)
            .bind(planung_id)
            .execute(&mut *conn)
            .await?
            .rows_affected();
        if geloescht == 0 {
            return Err(AppError::NotFound);
        }
        Ok(())
    })
}
