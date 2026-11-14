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
use sqlx::sqlite::SqliteRow;
use sqlx::{Row, SqliteConnection, SqlitePool};

use super::{
    kennzahlen, PlanungAnzeige, PlanungBlockAnzeige, PlanungKennzahlen, PlanungKopf,
    PlanungListeneintrag, PlanungPostenAnzeige, PlanungPostenArt, PlanungUebernahme,
    AUFBEWAHRUNG_TAGE, KENNZAHLEN_TAGE, PLANUNGEN_MAX, POSTEN_MAX, ZEITRAUM_MAX_TAGE,
};
use crate::abloesung::schichtplan::plan_repo::{
    self, json_ids, utc, BlockKern, HelferEingabe, HelferPatch, PersonDaten, Planart, PostenQuery,
    PostenVorgabe,
};
use crate::abloesung::schichtplan::pruefung::PersonStand;
use crate::abloesung::schichtplan::zerlegung::{self, Teilung};
use crate::abloesung::schichtplan::{
    PlanHelferAnzeige, PlanPerson, Posten, SchichtplanGrenzwerte, SOLL_ANZAHL_MAX,
};
use crate::einsatz::Einsatzart;
use crate::error::AppError;
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

impl BlockEingabe {
    fn kern(&self) -> plan_repo::BlockEingabe<Option<i64>> {
        plan_repo::BlockEingabe {
            posten: self.posten_id,
            von: self.von.clone(),
            bis: self.bis.clone(),
            soll_anzahl: self.soll_anzahl,
            quali_soll: self.quali_soll.clone(),
            personen: self.personen.clone(),
            notiz: self.notiz.clone(),
        }
    }
}

/// Änderung eines Blocks. `posten: Some(None)` verschiebt in die Pause.
pub type BlockPatch = plan_repo::BlockPatch<Option<i64>>;

/// Eine Planung als [`Planart`] des Kerns (`abloesung::schichtplan::plan_repo`): Posten sind die
/// Posten der Planung (`None` = Pause), Personen nur Stamm-Personal und Helfer, Servertexte in der
/// Zone der Organisation, jeder Schreibweg prüft zuerst den Schreibschutz.
pub(crate) struct Vorplanung {
    pub org_id: i64,
    pub planung_id: i64,
}

impl Planart for Vorplanung {
    type Posten = Option<i64>;
    type BlockZeile = BlockZeile;
    type DeleteRecht = ();

    const SCHICHT: &'static str = "planung_schicht";
    const PERSON: &'static str = "planung_schicht_person";
    const PERSON_FK: &'static str = "schicht_id";
    const HELFER: &'static str = "planung_helfer";
    const SCOPE: &'static str = "planung_id";
    const POSTEN_SPALTEN: &'static [&'static str] = &["posten_id"];
    const SELECT_BLOECKE: &'static str = SELECT_BLOECKE;
    // Helfer der Vorplanung tragen (noch) keine externe Kennung.
    const HELFER_SPALTEN: &'static str =
        "id, name, telefon, organisation, qualifikationen, NULL AS kennung, NULL AS herkunft";
    const JE: &'static str = "Planung";
    const ZU_DIESEM: &'static str = "dieser Planung";
    const MIT_ARTIKEL: &'static str = "Eine Planung";
    const MIT_ADHOC: bool = false;
    const MIT_IST: bool = false;

    fn id(&self) -> i64 {
        self.planung_id
    }

    fn is_pause(posten: Option<i64>) -> bool {
        posten.is_none()
    }

    fn posten_from_row(row: &SqliteRow) -> Result<Option<i64>, AppError> {
        Ok(row.try_get("posten_id")?)
    }

    fn bind_posten(query: PostenQuery<'_>, posten: Option<i64>) -> PostenQuery<'_> {
        query.bind(posten)
    }

    fn block_kern(z: &BlockZeile) -> Result<BlockKern<'_>, AppError> {
        Ok(BlockKern {
            id: z.id,
            posten: posten_schluessel(z.posten_id),
            von: &z.von,
            bis: &z.bis,
            soll_anzahl: z.soll_anzahl,
            quali_soll: z.quali_soll.as_ref(),
        })
    }

    async fn before_write_tx(&self, conn: &mut SqliteConnection) -> Result<i64, AppError> {
        schreibbar_tx(conn, self.org_id, self.planung_id).await?;
        Ok(self.org_id)
    }

    async fn check_posten_tx(
        &self,
        conn: &mut SqliteConnection,
        posten: Option<i64>,
    ) -> Result<PostenVorgabe, AppError> {
        posten_tx(conn, self.planung_id, posten).await
    }

    async fn zone_tx(&self, conn: &mut SqliteConnection) -> Result<Zeitstil, AppError> {
        zeitstil_org(conn, self.org_id).await
    }

    async fn check_delete_tx(
        &self,
        _conn: &mut SqliteConnection,
        _bid: i64,
        _recht: (),
    ) -> Result<(), AppError> {
        Ok(())
    }

    async fn load_personen_tx(
        &self,
        conn: &mut SqliteConnection,
    ) -> Result<BTreeMap<PlanPerson, PersonDaten>, AppError> {
        personen_daten(conn, self.org_id, self.planung_id).await
    }
}

/// Zeitraum einer Planung (400): Ende nach Beginn, höchstens [`ZEITRAUM_MAX_TAGE`] Tage.
pub fn pruefe_zeitraum(von: &str, bis: &str) -> Result<(), AppError> {
    let (a, b) = (utc(von)?, utc(bis)?);
    if b <= a {
        return Err(AppError::Validation(
            "Das Ende muss nach dem Beginn liegen".into(),
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

/// Der Schlüssel eines Postens in der Prüfung (Modulkopf).
fn posten_schluessel(posten_id: Option<i64>) -> Posten {
    match posten_id {
        Some(id) => Posten::Einheit(id),
        None => Posten::Pause,
    }
}

/// Zone und Darstellung der Organisation für Servertexte.
pub(crate) async fn zeitstil_org(
    conn: &mut SqliteConnection,
    org_id: i64,
) -> Result<Zeitstil, AppError> {
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

// ---------------------------------------------------------------------------------------------
// Lesen
// ---------------------------------------------------------------------------------------------

#[derive(sqlx::FromRow)]
pub(crate) struct KopfZeile {
    id: i64,
    version: i64,
    /// Zählt jede Änderung der Planung (LLH-1610), anders als `version` nicht nur den Kopf.
    stand: i64,
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
    uebernommen_at: Option<String>,
    uebernahme_einsatz: Option<i64>,
    uebernahme_einsatznummer: Option<String>,
    uebernahme_kennzahlen: Option<String>,
}

const SELECT_KOPF: &str =
    "SELECT id, version, stand, bezeichnung, einsatzart, ort, ort_lat, ort_lon, \
     von, bis, max_dienst_min, min_ruhe_min, angelegt_at, uebernommen_at, uebernahme_einsatz, \
     uebernahme_einsatznummer, uebernahme_kennzahlen FROM planung WHERE id = ? AND org_id = ?";

/// Die Übernahme aus den Spalten von 0304; fehlt, solange die Planung nicht übernommen ist.
fn build_uebernahme(
    at: Option<String>,
    einsatz: Option<i64>,
    einsatznummer: Option<String>,
) -> Option<PlanungUebernahme> {
    Some(PlanungUebernahme {
        at: at?,
        einsatz_id: einsatz?,
        einsatznummer,
    })
}

/// Die bei der Übernahme gespeicherten Kennzahlen (0304).
fn parse_kennzahlen(json: Option<&str>) -> Result<Option<PlanungKennzahlen>, AppError> {
    json.map(|j| {
        serde_json::from_str(j)
            .map_err(|e| AppError::Internal(format!("Kennzahlen der Übernahme: {e}")))
    })
    .transpose()
}

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
            uebernahme: build_uebernahme(
                self.uebernommen_at,
                self.uebernahme_einsatz,
                self.uebernahme_einsatznummer,
            ),
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

/// Der Kopf einer Planung, die noch geschrieben werden darf: eine übernommene ist
/// schreibgeschützt (409, Spec `vorplanung`, „Übernahme in einen Einsatz“). Fremd oder
/// unbekannt 404.
async fn check_schreibbar_tx(
    conn: &mut SqliteConnection,
    org_id: i64,
    id: i64,
) -> Result<KopfZeile, AppError> {
    let k = kopf_tx(conn, org_id, id).await?;
    if k.uebernommen_at.is_some() {
        return Err(AppError::Conflict(
            "Die Planung ist in einen Einsatz übernommen und schreibgeschützt".into(),
        ));
    }
    Ok(k)
}

/// [`check_schreibbar_tx`] für einen Schreibweg: erhöht den Stand der Planung (LLH-1610), an dem
/// die Übernahme erkennt, dass sich seit ihrer Vorschau etwas geändert hat. Jeder Schreibweg
/// außer dem Löschen geht hier durch, in seiner Transaktion; scheitert er danach, rollt die
/// Transaktion den Stand mit zurück.
pub(crate) async fn schreibbar_tx(
    conn: &mut SqliteConnection,
    org_id: i64,
    id: i64,
) -> Result<KopfZeile, AppError> {
    let k = check_schreibbar_tx(conn, org_id, id).await?;
    sqlx::query("UPDATE planung SET stand = stand + 1 WHERE id = ?")
        .bind(id)
        .execute(&mut *conn)
        .await?;
    Ok(k)
}

/// Der Stand einer Planung, die noch übernommen werden darf (`super::uebernahme`): fremd oder
/// unbekannt 404, übernommen 409. Erhöht nichts.
pub(crate) async fn stand_tx(
    conn: &mut SqliteConnection,
    org_id: i64,
    id: i64,
) -> Result<i64, AppError> {
    Ok(check_schreibbar_tx(conn, org_id, id).await?.stand)
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
pub(crate) struct BlockZeile {
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

/// Name, Qualifikationen und Verfügbarkeit jeder Person der Planung.
async fn personen_daten(
    conn: &mut SqliteConnection,
    org_id: i64,
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
    for h in plan_repo::load_helfer_tx(conn, &Vorplanung { org_id, planung_id }).await? {
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

/// Die Blöcke einer Planung mit Personen und Befunden (Kern `plan_repo::load_tx`); ein Posten,
/// dessen Vorlage oder Fahrzeug nicht mehr verfügbar ist, gilt als aufgelöst.
async fn load_bloecke_tx(
    conn: &mut SqliteConnection,
    org_id: i64,
    id: i64,
    grenzwerte: SchichtplanGrenzwerte,
    nicht_verfuegbar: &HashMap<i64, bool>,
    jetzt: DateTime<Utc>,
) -> Result<plan_repo::Geladen<BlockZeile>, AppError> {
    plan_repo::load_tx(
        conn,
        &Vorplanung {
            org_id,
            planung_id: id,
        },
        org_id,
        grenzwerte,
        jetzt,
        |z: &BlockZeile| {
            z.posten_id
                .is_some_and(|p| nicht_verfuegbar.get(&p).copied().unwrap_or(false))
        },
    )
    .await
}

/// Die ganze Planung mit Befunden und Kennzahlen. Fremd oder unbekannt → 404.
pub async fn laden(
    pool: &SqlitePool,
    org_id: i64,
    id: i64,
    jetzt: DateTime<Utc>,
) -> Result<PlanungAnzeige, AppError> {
    let mut conn = pool.acquire().await?;
    laden_mit(&mut conn, org_id, id, jetzt).await
}

async fn laden_mit(
    conn: &mut SqliteConnection,
    org_id: i64,
    id: i64,
    jetzt: DateTime<Utc>,
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
    let g = load_bloecke_tx(
        conn,
        org_id,
        id,
        kopf.grenzwerte(),
        &nicht_verfuegbar,
        jetzt,
    )
    .await?;
    // Nach der Übernahme gelten die Kennzahlen von damals (Spec `vorplanung`).
    let kennzahlen = match parse_kennzahlen(kopf.uebernahme_kennzahlen.as_deref())? {
        Some(k) => k,
        None => kennzahlen(&g.bloecke, &g.ergebnis),
    };
    let helfer = plan_repo::load_helfer_tx(
        conn,
        &Vorplanung {
            org_id,
            planung_id: id,
        },
    )
    .await?;
    let programmpunkte = super::programm::liste_tx(conn, id).await?;

    let mut ergebnis_je_block = g.ergebnis.bloecke;
    let personen = g.personen;
    let bloecke = g
        .zeilen
        .into_iter()
        .zip(g.bloecke)
        .map(|(z, b)| {
            let mut e = ergebnis_je_block.remove(&b.id).unwrap_or_default();
            let liste = plan_repo::personen_anzeige(&b, &personen, &mut e);
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
        programmpunkte,
        kennzahlen,
    })
}

/// Kennzahlen einer Planung aus derselben Prüfung wie [`laden`].
pub(crate) async fn kennzahlen_von(
    conn: &mut SqliteConnection,
    org_id: i64,
    id: i64,
    grenzwerte: SchichtplanGrenzwerte,
    jetzt: DateTime<Utc>,
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
    let g = load_bloecke_tx(conn, org_id, id, grenzwerte, &nicht_verfuegbar, jetzt).await?;
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
    #[derive(sqlx::FromRow)]
    struct Zeile {
        id: i64,
        bezeichnung: String,
        einsatzart: String,
        ort: Option<String>,
        von: String,
        bis: String,
        max_dienst_min: Option<i64>,
        min_ruhe_min: Option<i64>,
        posten: i64,
        bloecke: i64,
        uebernommen_at: Option<String>,
        uebernahme_einsatz: Option<i64>,
        uebernahme_einsatznummer: Option<String>,
        uebernahme_kennzahlen: Option<String>,
    }
    let zeilen: Vec<Zeile> = sqlx::query_as(
        "SELECT p.id, p.bezeichnung, p.einsatzart, p.ort, p.von, p.bis, p.max_dienst_min, \
                p.min_ruhe_min, \
                (SELECT COUNT(*) FROM planung_posten pp WHERE pp.planung_id = p.id) AS posten, \
                (SELECT COUNT(*) FROM planung_schicht s WHERE s.planung_id = p.id) AS bloecke, \
                p.uebernommen_at, p.uebernahme_einsatz, p.uebernahme_einsatznummer, \
                p.uebernahme_kennzahlen \
         FROM planung p WHERE p.org_id = ? \
         ORDER BY p.bis < ?, p.von, p.id",
    )
    .bind(org_id)
    .bind(zeit::formatiere_utc(jetzt))
    .fetch_all(&mut *conn)
    .await?;
    let grenze = zeit::formatiere_utc(jetzt - Duration::days(KENNZAHLEN_TAGE));
    let mut aus = Vec::with_capacity(zeilen.len());
    for z in zeilen {
        let Zeile {
            id,
            bezeichnung,
            einsatzart: art,
            ort,
            von,
            bis,
            posten,
            bloecke,
            ..
        } = z;
        // Eine übernommene Planung zeigt die Kennzahlen von damals, auch nach sieben Tagen.
        let kennzahlen = match parse_kennzahlen(z.uebernahme_kennzahlen.as_deref())? {
            Some(k) => Some(k),
            None if bis >= grenze => Some(
                kennzahlen_von(
                    &mut conn,
                    org_id,
                    id,
                    SchichtplanGrenzwerte::aus(z.max_dienst_min, z.min_ruhe_min),
                    jetzt,
                )
                .await?,
            ),
            None => None,
        };
        let uebernahme = build_uebernahme(
            z.uebernommen_at,
            z.uebernahme_einsatz,
            z.uebernahme_einsatznummer,
        );
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
            uebernahme,
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
        let k = schreibbar_tx(conn, org_id, id).await?;
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
    // Die Demo-Markierung zeigt ohne FK auf die Planung (0212, 0296).
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
    schreibbar_tx(conn, org_id, planung_id).await?;
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
        schreibbar_tx(conn, org_id, planung_id).await?;
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
        schreibbar_tx(conn, org_id, planung_id).await?;
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
        schreibbar_tx(conn, org_id, planung_id).await?;
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
) -> Result<PostenVorgabe, AppError> {
    let Some(pid) = posten_id else {
        return Ok(PostenVorgabe::default());
    };
    let zeile: Option<(Option<i64>, Option<String>, String, Option<i64>)> = sqlx::query_as(
        "SELECT soll_anzahl, quali_soll, bezeichnung, schichtlaenge_min FROM planung_posten \
         WHERE id = ? AND planung_id = ?",
    )
    .bind(pid)
    .bind(planung_id)
    .fetch_optional(&mut *conn)
    .await?;
    let (soll_anzahl, quali_soll, bezeichnung, schichtlaenge) = zeile.ok_or_else(|| {
        AppError::UnprocessableEntity("Der Posten gehört nicht zu dieser Planung".into())
    })?;
    Ok(PostenVorgabe {
        soll_anzahl,
        quali_soll,
        bezeichnung: Some(bezeichnung),
        schichtlaenge,
    })
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
    plan_repo::create_block_tx(
        conn,
        &Vorplanung { org_id, planung_id },
        benutzer_id,
        &e.kern(),
    )
    .await
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
        plan_repo::update_block_tx(
            conn,
            &Vorplanung { org_id, planung_id },
            bid,
            benutzer_id,
            p,
            jetzt,
        )
        .await?;
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
        plan_repo::delete_block_tx(conn, &Vorplanung { org_id, planung_id }, bid, version, ())
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
        let plan = Vorplanung { org_id, planung_id };
        plan.before_write_tx(conn).await?;
        let vorgabe = plan.check_posten_tx(conn, posten_id).await?;
        let laenge = laenge_minuten.or(vorgabe.schichtlaenge).ok_or_else(|| {
            AppError::UnprocessableEntity(
                "Der Posten hat keine Schichtlänge; bitte eine Länge angeben".into(),
            )
        })?;
        let teile = zerlegung::zerlege(von_t, bis_t, &Teilung::Laenge(laenge))?;
        plan_repo::create_bloecke_tx(conn, &plan, benutzer_id, posten_id, &vorgabe, &teile).await
    })
}

// ---------------------------------------------------------------------------------------------
// Helfer
// ---------------------------------------------------------------------------------------------

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
    plan_repo::create_helfer_tx(conn, &Vorplanung { org_id, planung_id }, benutzer_id, e).await
}

pub async fn helfer_aendern(
    pool: &SqlitePool,
    org_id: i64,
    planung_id: i64,
    hid: i64,
    p: &HelferPatch,
) -> Result<PlanHelferAnzeige, AppError> {
    write_retry!(pool, |conn| {
        plan_repo::update_helfer_tx(conn, &Vorplanung { org_id, planung_id }, hid, p).await
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
        plan_repo::delete_helfer_tx(conn, &Vorplanung { org_id, planung_id }, hid).await?;
        Ok(())
    })
}
