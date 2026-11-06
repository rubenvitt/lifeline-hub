//! Datenbank des Schichtplans (LLH-1552, design.md D2–D7). Schreibwege laufen je in EINER
//! Transaktion (`write_retry!`): Posten, Überschneidung, Personen und Grenzen werden darin
//! geprüft, wo auch geschrieben wird. Die Befunde rechnet [`super::pruefung`] beim Lesen.

use std::collections::{BTreeMap, HashMap};

use sqlx::{SqliteConnection, SqlitePool};

use super::pruefung::{self, Block, Grundlage, Ist, PersonStand};
use super::zerlegung::{self, Teilung};
use super::{
    PlanBlockAnzeige, PlanHelferAnzeige, PlanPerson, PlanPersonAnzeige, PlanPostenAnzeige, Posten,
    SchichtplanAnzeige, SchichtplanGrenzwerte, PLAN_BLOECKE_MAX, PLAN_HELFER_MAX, SOLL_ANZAHL_MAX,
};
use crate::abloesung::repo::load_einsatz_vorgabe_tx;
use crate::error::{AppError, ZeilenArt, ZeilenGrund};
use crate::personal::quali_soll::QualiSoll;
use crate::write_retry;
use crate::zeit;
use crate::zeitdarstellung::Zeitstil;

/// Label des Personalstatus, der für die Zeile „Pause“ als „am Posten“ gilt (Startliste
/// `personal::STATUS_STARTLISTE`, Migration 0012).
const PAUSE_STATUS_LABEL: &str = "Pause";

/// Ein neuer Block, Felder schon geprüft (Handler). Zeiten im kanonischen Format.
#[derive(Debug, Clone)]
pub struct BlockEingabe {
    pub posten: Posten,
    pub von: String,
    pub bis: String,
    /// Fehlt = Vorgabe des Postens; `Some(None)` = kein Soll.
    pub soll_anzahl: Option<Option<i64>>,
    /// Gespeicherte Form (`personal::quali_soll::form`); fehlt = Vorgabe des Postens.
    pub quali_soll: Option<Option<String>>,
    pub personen: Vec<PlanPerson>,
    pub notiz: Option<String>,
}

/// Änderung eines Blocks, Felder schon geprüft. Fehlt = unverändert.
#[derive(Debug, Clone, Default)]
pub struct BlockPatch {
    pub version: i64,
    pub posten: Option<Posten>,
    pub von: Option<String>,
    pub bis: Option<String>,
    pub soll_anzahl: Option<Option<i64>>,
    pub quali_soll: Option<Option<String>>,
    /// Die ganze Liste.
    pub personen: Option<Vec<PlanPerson>>,
    pub notiz: Option<Option<String>>,
}

/// Ein Helfer, Felder schon geprüft und getrimmt.
#[derive(Debug, Clone)]
pub struct HelferEingabe {
    pub name: String,
    pub telefon: Option<String>,
    pub organisation: Option<String>,
    pub qualifikationen: Vec<i64>,
}

/// Änderung eines Helfers. Fehlt = unverändert, `Some(None)` = leeren.
#[derive(Debug, Clone, Default)]
pub struct HelferPatch {
    pub name: Option<String>,
    pub telefon: Option<Option<String>>,
    pub organisation: Option<Option<String>>,
    pub qualifikationen: Option<Vec<i64>>,
}

fn ungueltige_zeit(wert: &str) -> AppError {
    AppError::Validation(format!("Ungültiger Zeitpunkt '{wert}'"))
}

fn utc(wert: &str) -> Result<chrono::DateTime<chrono::Utc>, AppError> {
    zeit::parse_utc(wert).ok_or_else(|| ungueltige_zeit(wert))
}

// ---------------------------------------------------------------------------------------------
// Lesen
// ---------------------------------------------------------------------------------------------

#[derive(sqlx::FromRow)]
struct BlockZeile {
    id: i64,
    version: i64,
    posten_art: String,
    einheit_id: Option<i64>,
    uhs_id: Option<i64>,
    von: String,
    bis: String,
    soll_anzahl: Option<i64>,
    quali_soll: Option<QualiSoll>,
    notiz: Option<String>,
    bezeichnung: Option<String>,
    aufgeloest: bool,
}

const SELECT_BLOECKE: &str = concat!(
    "SELECT p.id, p.version, p.posten_art, p.einheit_id, p.uhs_id, p.von, p.bis, p.soll_anzahl, ",
    crate::personal::quali_soll::quali_soll_sql!("p.quali_soll"),
    " AS quali_soll, p.notiz, COALESCE(e.name, u.bezeichnung) AS bezeichnung, \
       (e.aufgeloest_at IS NOT NULL OR u.status = 'aufgeloest' OR u.storniert_at IS NOT NULL) \
         AS aufgeloest \
     FROM einsatz_planschicht p \
     LEFT JOIN einsatz_einheit e ON e.id = p.einheit_id \
     LEFT JOIN uhs u ON u.id = p.uhs_id \
     WHERE p.einsatz_id = ? \
     ORDER BY CASE p.posten_art WHEN 'einheit' THEN 0 WHEN 'uhs' THEN 1 ELSE 2 END, \
              COALESCE(e.sortier, 0), COALESCE(e.name, u.bezeichnung, ''), \
              COALESCE(p.einheit_id, p.uhs_id, 0), p.von, p.id"
);

/// Die Grenzwerte des Einsatzes (ohne Zeile die Vorgaben).
pub async fn grenzwerte(
    executor: impl sqlx::Executor<'_, Database = sqlx::Sqlite>,
    einsatz_id: i64,
) -> Result<SchichtplanGrenzwerte, AppError> {
    let zeile: Option<(Option<i64>, Option<i64>)> = sqlx::query_as(
        "SELECT schichtplan_max_dienst_min, schichtplan_min_ruhe_min \
         FROM einsatz_einstellungen WHERE einsatz_id = ?",
    )
    .bind(einsatz_id)
    .fetch_optional(executor)
    .await?;
    let (max, ruhe) = zeile.unwrap_or_default();
    Ok(SchichtplanGrenzwerte::aus(max, ruhe))
}

fn json_ids(json: Option<&str>) -> Vec<i64> {
    json.and_then(|j| serde_json::from_str::<Vec<i64>>(j).ok())
        .unwrap_or_default()
}

/// Name und Stand einer Person im Plan.
struct PersonDaten {
    name: String,
    stand: PersonStand,
}

/// Der ganze Plan mit Befunden. `mit_personen = false` (ohne Freigabe des Moduls Personal):
/// keine Namen, keine Helferliste, keine Befunde an Personen.
pub async fn laden(
    pool: &SqlitePool,
    einsatz_id: i64,
    org_id: i64,
    mit_personen: bool,
    jetzt: &str,
) -> Result<SchichtplanAnzeige, AppError> {
    let mut conn = pool.acquire().await?;
    laden_mit(&mut conn, einsatz_id, org_id, mit_personen, jetzt).await
}

async fn laden_mit(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    org_id: i64,
    mit_personen: bool,
    jetzt: &str,
) -> Result<SchichtplanAnzeige, AppError> {
    let grenzwerte = grenzwerte(&mut *conn, einsatz_id).await?;
    let zeilen: Vec<BlockZeile> = sqlx::query_as(SELECT_BLOECKE)
        .bind(einsatz_id)
        .fetch_all(&mut *conn)
        .await?;
    let zuordnung: Vec<(i64, Option<i64>, Option<i64>, Option<i64>)> = sqlx::query_as(
        "SELECT pp.planschicht_id, pp.personal_id, pp.einsatz_personal_id, pp.helfer_id \
         FROM einsatz_planschicht_person pp \
         JOIN einsatz_planschicht p ON p.id = pp.planschicht_id \
         WHERE p.einsatz_id = ? ORDER BY pp.rowid",
    )
    .bind(einsatz_id)
    .fetch_all(&mut *conn)
    .await?;
    let mut personen_je_block: HashMap<i64, Vec<PlanPerson>> = HashMap::new();
    for (bid, stamm, ep, helfer) in zuordnung {
        if let Some(p) = PlanPerson::aus_spalten(stamm, ep, helfer) {
            personen_je_block.entry(bid).or_default().push(p);
        }
    }

    let personen = personen_daten(conn, einsatz_id).await?;
    let helfer: Vec<(i64, String, Option<String>, Option<String>, Option<String>)> =
        sqlx::query_as(
            "SELECT id, name, telefon, organisation, qualifikationen FROM einsatz_plan_helfer \
             WHERE einsatz_id = ? ORDER BY name COLLATE NOCASE, id",
        )
        .bind(einsatz_id)
        .fetch_all(&mut *conn)
        .await?;
    // Nur bestehende Einheiten: beim Auflösen rückt die Unterstellung hoch, eine aufgelöste
    // Einheit trägt also niemanden mehr.
    let ueber: HashMap<i64, Option<i64>> = sqlx::query_as(
        "SELECT id, ueber_einheit_id FROM einsatz_einheit \
         WHERE einsatz_id = ? AND aufgeloest_at IS NULL",
    )
    .bind(einsatz_id)
    .fetch_all(&mut *conn)
    .await?
    .into_iter()
    .collect();
    let katalog = crate::personal::qualifikation_repo::einschluesse(&mut *conn, org_id).await?;

    let mut bloecke = Vec::with_capacity(zeilen.len());
    for z in &zeilen {
        let posten = Posten::aus_spalten(&z.posten_art, z.einheit_id, z.uhs_id)
            .ok_or_else(|| AppError::Internal(format!("Planschicht {} ohne Posten", z.id)))?;
        bloecke.push(Block {
            id: z.id,
            posten,
            von: utc(&z.von)?,
            bis: utc(&z.bis)?,
            soll_anzahl: z.soll_anzahl,
            quali_soll: z
                .quali_soll
                .as_ref()
                .map(QualiSoll::anforderungen)
                .unwrap_or_default(),
            personen: personen_je_block.remove(&z.id).unwrap_or_default(),
            posten_aufgeloest: z.aufgeloest,
        });
    }
    let staende: HashMap<PlanPerson, PersonStand> = personen
        .iter()
        .map(|(p, d)| (*p, d.stand.clone()))
        .collect();
    let jetzt = utc(jetzt)?;
    let ergebnis = pruefung::pruefe(
        &bloecke,
        &Grundlage {
            katalog: &katalog,
            personen: &staende,
            ueber_einheit: &ueber,
            grenzwerte,
            jetzt,
        },
    );

    let mut ergebnis_je_block = ergebnis.bloecke;
    let anzeige = zeilen
        .into_iter()
        .zip(bloecke)
        .map(|(z, b)| {
            let mut e = ergebnis_je_block.remove(&b.id).unwrap_or_default();
            let personen_anzeige = mit_personen.then(|| {
                b.personen
                    .iter()
                    .map(|p| {
                        let daten = personen.get(p);
                        PlanPersonAnzeige {
                            art: p.art(),
                            personal_id: matches!(p, PlanPerson::Stamm(_)).then(|| p.id()),
                            einsatz_personal_id: matches!(p, PlanPerson::Einsatz(_))
                                .then(|| p.id()),
                            helfer_id: matches!(p, PlanPerson::Helfer(_)).then(|| p.id()),
                            name: daten.map(|d| d.name.clone()).unwrap_or_default(),
                            qualifikationen: daten
                                .map(|d| d.stand.qualifikationen.clone())
                                .unwrap_or_default(),
                            im_einsatz: daten.is_some_and(|d| d.stand.ist.im_einsatz),
                            befunde: e.personen.remove(p).unwrap_or_default(),
                        }
                    })
                    .collect()
            });
            PlanBlockAnzeige {
                id: z.id,
                version: z.version,
                posten: PlanPostenAnzeige {
                    art: b.posten.art(),
                    einheit_id: b.posten.einheit_id(),
                    uhs_id: b.posten.uhs_id(),
                    bezeichnung: z.bezeichnung,
                    aufgeloest: z.aufgeloest,
                },
                von: z.von,
                bis: z.bis,
                soll_anzahl: z.soll_anzahl,
                quali_soll: z.quali_soll,
                notiz: z.notiz,
                personen_anzahl: b.personen.len() as i64,
                personen: personen_anzeige,
                offene_plaetze: e.offene_plaetze,
                offene_anforderungen: e.offene_anforderungen,
                befunde: e.befunde,
            }
        })
        .collect();

    Ok(SchichtplanAnzeige {
        grenzwerte,
        bloecke: anzeige,
        helfer: mit_personen.then(|| {
            helfer
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
                .collect()
        }),
        naechste_pruefung_at: ergebnis.naechste_pruefung.map(zeit::formatiere_utc),
    })
}

/// Name, Qualifikationen und Ist jeder Person, die im Plan steht.
async fn personen_daten(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
) -> Result<BTreeMap<PlanPerson, PersonDaten>, AppError> {
    let mut aus = BTreeMap::new();
    type StammZeile = (
        i64,
        String,
        String,
        Option<String>,
        Option<i64>,
        Option<i64>,
        Option<i64>,
        Option<String>,
    );
    let stamm: Vec<StammZeile> = sqlx::query_as(
        "SELECT pe.id, pe.name, pe.dienststatus, \
                (SELECT json_group_array(pq.qualifikation_id) FROM personal_qualifikation pq \
                  WHERE pq.personal_id = pe.id), \
                ep.id, ep.einheit_id, ep.uhs_id, ps.label \
         FROM personal pe \
         LEFT JOIN einsatz_personal ep \
           ON ep.personal_id = pe.id AND ep.einsatz_id = ?1 AND ep.beendet_at IS NULL \
         LEFT JOIN personal_status ps ON ps.id = ep.status_id \
         WHERE pe.id IN (SELECT pp.personal_id FROM einsatz_planschicht_person pp \
                         JOIN einsatz_planschicht p ON p.id = pp.planschicht_id \
                         WHERE p.einsatz_id = ?1 AND pp.personal_id IS NOT NULL)",
    )
    .bind(einsatz_id)
    .fetch_all(&mut *conn)
    .await?;
    for (id, name, dienststatus, quals, ep, einheit_id, uhs_id, status) in stamm {
        aus.insert(
            PlanPerson::Stamm(id),
            PersonDaten {
                name,
                stand: PersonStand {
                    qualifikationen: json_ids(quals.as_deref()),
                    verfuegbar: dienststatus != "ausser_dienst",
                    ist: Ist {
                        im_einsatz: ep.is_some(),
                        einheit_id,
                        uhs_id,
                        pause: ist_pause(status.as_deref()),
                    },
                },
            },
        );
    }

    type EinsatzZeile = (i64, String, bool, Option<i64>, Option<i64>, Option<String>);
    let einsatz: Vec<EinsatzZeile> = sqlx::query_as(
        "SELECT ep.id, ep.snap_name, ep.beendet_at IS NULL, ep.einheit_id, ep.uhs_id, ps.label \
         FROM einsatz_personal ep \
         LEFT JOIN personal_status ps ON ps.id = ep.status_id \
         WHERE ep.id IN (SELECT pp.einsatz_personal_id FROM einsatz_planschicht_person pp \
                         JOIN einsatz_planschicht p ON p.id = pp.planschicht_id \
                         WHERE p.einsatz_id = ?1 AND pp.einsatz_personal_id IS NOT NULL)",
    )
    .bind(einsatz_id)
    .fetch_all(&mut *conn)
    .await?;
    for (id, name, aktiv, einheit_id, uhs_id, status) in einsatz {
        aus.insert(
            PlanPerson::Einsatz(id),
            PersonDaten {
                name,
                stand: PersonStand {
                    qualifikationen: Vec::new(),
                    verfuegbar: aktiv,
                    ist: Ist {
                        im_einsatz: aktiv,
                        einheit_id: einheit_id.filter(|_| aktiv),
                        uhs_id: uhs_id.filter(|_| aktiv),
                        pause: aktiv && ist_pause(status.as_deref()),
                    },
                },
            },
        );
    }

    let helfer: Vec<(i64, String, Option<String>)> = sqlx::query_as(
        "SELECT id, name, qualifikationen FROM einsatz_plan_helfer WHERE einsatz_id = ?",
    )
    .bind(einsatz_id)
    .fetch_all(&mut *conn)
    .await?;
    for (id, name, quals) in helfer {
        aus.insert(
            PlanPerson::Helfer(id),
            PersonDaten {
                name,
                stand: PersonStand {
                    qualifikationen: json_ids(quals.as_deref()),
                    ..PersonStand::default()
                },
            },
        );
    }
    Ok(aus)
}

fn ist_pause(label: Option<&str>) -> bool {
    label.is_some_and(|l| l.trim().eq_ignore_ascii_case(PAUSE_STATUS_LABEL))
}

/// Der Posten eines Blocks (für die Modulprüfung im Handler). Fremd oder unbekannt → 404.
pub async fn posten_von(pool: &SqlitePool, einsatz_id: i64, bid: i64) -> Result<Posten, AppError> {
    let zeile: (String, Option<i64>, Option<i64>) = sqlx::query_as(
        "SELECT posten_art, einheit_id, uhs_id FROM einsatz_planschicht \
         WHERE id = ? AND einsatz_id = ?",
    )
    .bind(bid)
    .bind(einsatz_id)
    .fetch_optional(pool)
    .await?
    .ok_or(AppError::NotFound)?;
    Posten::aus_spalten(&zeile.0, zeile.1, zeile.2).ok_or(AppError::NotFound)
}

// ---------------------------------------------------------------------------------------------
// Prüfungen in der Transaktion
// ---------------------------------------------------------------------------------------------

/// Der Posten gehört zum Einsatz und besteht (422 sonst). Liefert seine Bezeichnung.
async fn pruefe_posten_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    posten: Posten,
) -> Result<Option<String>, AppError> {
    match posten {
        Posten::Pause => Ok(None),
        Posten::Einheit(id) => {
            let zeile: Option<(String, Option<String>)> = sqlx::query_as(
                "SELECT name, aufgeloest_at FROM einsatz_einheit WHERE id = ? AND einsatz_id = ?",
            )
            .bind(id)
            .bind(einsatz_id)
            .fetch_optional(&mut *conn)
            .await?;
            match zeile {
                None => Err(AppError::UnprocessableEntity(
                    "Die Einheit gehört nicht zu diesem Einsatz".into(),
                )),
                Some((_, Some(_))) => Err(AppError::UnprocessableEntity(
                    "Die Einheit ist aufgelöst".into(),
                )),
                Some((name, None)) => Ok(Some(name)),
            }
        }
        Posten::Uhs(id) => {
            let zeile: Option<(String, String, Option<String>)> = sqlx::query_as(
                "SELECT bezeichnung, status, storniert_at FROM uhs WHERE id = ? AND einsatz_id = ?",
            )
            .bind(id)
            .bind(einsatz_id)
            .fetch_optional(&mut *conn)
            .await?;
            match zeile {
                None => Err(AppError::UnprocessableEntity(
                    "Die UHS gehört nicht zu diesem Einsatz".into(),
                )),
                Some((_, status, storniert)) if status == "aufgeloest" || storniert.is_some() => {
                    Err(AppError::UnprocessableEntity(
                        "Die UHS ist aufgelöst".into(),
                    ))
                }
                Some((name, _, _)) => Ok(Some(name)),
            }
        }
    }
}

/// Ein Block am Posten, der sich mit `[von, bis)` überschneidet (außer `ausser`); die Pause darf
/// überlappen.
async fn ueberschneidung_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    posten: Posten,
    von: &str,
    bis: &str,
    ausser: Option<i64>,
) -> Result<Option<(i64, String, String)>, AppError> {
    if posten == Posten::Pause {
        return Ok(None);
    }
    Ok(sqlx::query_as(
        "SELECT id, von, bis FROM einsatz_planschicht \
         WHERE einsatz_id = ? AND posten_art = ? AND einheit_id IS ? AND uhs_id IS ? \
           AND von < ? AND bis > ? AND id IS NOT ? \
         ORDER BY von LIMIT 1",
    )
    .bind(einsatz_id)
    .bind(posten.art().as_str())
    .bind(posten.einheit_id())
    .bind(posten.uhs_id())
    .bind(bis)
    .bind(von)
    .bind(ausser)
    .fetch_optional(&mut *conn)
    .await?)
}

fn zeitraum_text(stil: &Zeitstil, von: &str, bis: &str) -> String {
    match (zeit::parse_utc(von), zeit::parse_utc(bis)) {
        (Some(a), Some(b)) => stil.zeitraum(a, b),
        _ => format!("{von}–{bis}"),
    }
}

async fn pruefe_frei_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    posten: Posten,
    von: &str,
    bis: &str,
    ausser: Option<i64>,
) -> Result<(), AppError> {
    if let Some((_, a, b)) = ueberschneidung_tx(conn, einsatz_id, posten, von, bis, ausser).await? {
        let stil = crate::zeitdarstellung::zeitstil_laden(&mut *conn, einsatz_id).await?;
        return Err(AppError::UnprocessableEntity(format!(
            "Die Schicht überschneidet sich mit {}",
            zeitraum_text(&stil, &a, &b)
        )));
    }
    Ok(())
}

fn ids_json(personen: &[PlanPerson], art: fn(PlanPerson) -> Option<i64>) -> String {
    let ids: Vec<i64> = personen.iter().filter_map(|p| art(*p)).collect();
    serde_json::to_string(&ids).unwrap_or_else(|_| "[]".into())
}

fn stamm(p: PlanPerson) -> Option<i64> {
    matches!(p, PlanPerson::Stamm(_)).then(|| p.id())
}
fn adhoc(p: PlanPerson) -> Option<i64> {
    matches!(p, PlanPerson::Einsatz(_)).then(|| p.id())
}
fn helfer(p: PlanPerson) -> Option<i64> {
    matches!(p, PlanPerson::Helfer(_)).then(|| p.id())
}

/// Jede Person gehört zur Organisation bzw. zum Einsatz (422 sonst); eine Abfrage je Art über
/// `json_each` (`src/AGENTS.md`, „Eingabegrenzen“).
async fn pruefe_personen_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    org_id: i64,
    personen: &[PlanPerson],
) -> Result<(), AppError> {
    if personen.is_empty() {
        return Ok(());
    }
    let fremd_stamm: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM json_each(?1) j \
         LEFT JOIN personal p ON p.id = j.value AND p.org_id = ?2 WHERE p.id IS NULL",
    )
    .bind(ids_json(personen, stamm))
    .bind(org_id)
    .fetch_one(&mut *conn)
    .await?;
    if fremd_stamm > 0 {
        return Err(AppError::UnprocessableEntity(
            "Eine Person gehört nicht zur Organisation".into(),
        ));
    }
    let fremd_adhoc: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM json_each(?1) j \
         LEFT JOIN einsatz_personal ep \
           ON ep.id = j.value AND ep.einsatz_id = ?2 AND ep.personal_id IS NULL \
         WHERE ep.id IS NULL",
    )
    .bind(ids_json(personen, adhoc))
    .bind(einsatz_id)
    .fetch_one(&mut *conn)
    .await?;
    if fremd_adhoc > 0 {
        return Err(AppError::UnprocessableEntity(
            "Über einsatz_personal_id nur Ad-hoc-Kräfte dieses Einsatzes; Stamm-Personal über \
             personal_id"
                .into(),
        ));
    }
    let fremd_helfer: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM json_each(?1) j \
         LEFT JOIN einsatz_plan_helfer h ON h.id = j.value AND h.einsatz_id = ?2 \
         WHERE h.id IS NULL",
    )
    .bind(ids_json(personen, helfer))
    .bind(einsatz_id)
    .fetch_one(&mut *conn)
    .await?;
    if fremd_helfer > 0 {
        return Err(AppError::UnprocessableEntity(
            "Ein Helfer gehört nicht zu diesem Einsatz".into(),
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
    sqlx::query("DELETE FROM einsatz_planschicht_person WHERE planschicht_id = ?")
        .bind(bid)
        .execute(&mut *conn)
        .await?;
    for (spalte, art) in [
        ("personal_id", stamm as fn(PlanPerson) -> Option<i64>),
        ("einsatz_personal_id", adhoc),
        ("helfer_id", helfer),
    ] {
        let sql = match spalte {
            "personal_id" => {
                "INSERT INTO einsatz_planschicht_person (planschicht_id, personal_id) \
                 SELECT ?1, j.value FROM json_each(?2) j ORDER BY j.key"
            }
            "einsatz_personal_id" => {
                "INSERT INTO einsatz_planschicht_person (planschicht_id, einsatz_personal_id) \
                 SELECT ?1, j.value FROM json_each(?2) j ORDER BY j.key"
            }
            _ => {
                "INSERT INTO einsatz_planschicht_person (planschicht_id, helfer_id) \
                 SELECT ?1, j.value FROM json_each(?2) j ORDER BY j.key"
            }
        };
        sqlx::query(sql)
            .bind(bid)
            .bind(ids_json(personen, art))
            .execute(&mut *conn)
            .await?;
    }
    Ok(())
}

/// Soll-Vorgabe eines Postens (design.md D4): Einheit = Summe des wirksamen Solls F/UF/M und
/// das wirksame Qualifikationssoll (eigen → Typ), UHS = ihre Soll-Anzahl und ihr
/// Qualifikationssoll, Pause = keins. Eine Summe von 0 ist kein Soll, über 200 wird 200.
async fn soll_vorgabe_tx(
    conn: &mut SqliteConnection,
    posten: Posten,
) -> Result<(Option<i64>, Option<String>), AppError> {
    let (anzahl, quali): (Option<i64>, Option<String>) = match posten {
        Posten::Pause => return Ok((None, None)),
        Posten::Einheit(id) => {
            sqlx::query_as(
                "SELECT CASE \
               WHEN e.soll_fuehrer IS NOT NULL AND e.soll_unterfuehrer IS NOT NULL \
                    AND e.soll_mannschaft IS NOT NULL \
                 THEN e.soll_fuehrer + e.soll_unterfuehrer + e.soll_mannschaft \
               WHEN e.soll_fuehrer IS NULL AND e.soll_unterfuehrer IS NULL \
                    AND e.soll_mannschaft IS NULL AND t.soll_fuehrer IS NOT NULL \
                    AND t.soll_unterfuehrer IS NOT NULL AND t.soll_mannschaft IS NOT NULL \
                 THEN t.soll_fuehrer + t.soll_unterfuehrer + t.soll_mannschaft \
               END, \
               COALESCE(e.quali_soll, t.quali_soll) \
             FROM einsatz_einheit e LEFT JOIN einheit_typ t ON t.id = e.typ_id WHERE e.id = ?",
            )
            .bind(id)
            .fetch_one(&mut *conn)
            .await?
        }
        Posten::Uhs(id) => {
            sqlx::query_as("SELECT soll_anzahl, quali_soll FROM uhs WHERE id = ?")
                .bind(id)
                .fetch_one(&mut *conn)
                .await?
        }
    };
    let anzahl = anzahl.filter(|n| *n > 0).map(|n| n.min(SOLL_ANZAHL_MAX));
    Ok((anzahl, quali))
}

async fn org_von(conn: &mut SqliteConnection, einsatz_id: i64) -> Result<i64, AppError> {
    Ok(
        sqlx::query_scalar("SELECT org_id FROM einsatz WHERE id = ?")
            .bind(einsatz_id)
            .fetch_one(&mut *conn)
            .await?,
    )
}

async fn pruefe_anzahl_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    neu: usize,
) -> Result<(), AppError> {
    let bisher: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM einsatz_planschicht WHERE einsatz_id = ?")
            .bind(einsatz_id)
            .fetch_one(&mut *conn)
            .await?;
    if bisher + neu as i64 > PLAN_BLOECKE_MAX {
        return Err(AppError::UnprocessableEntity(format!(
            "Höchstens {PLAN_BLOECKE_MAX} Schichten je Einsatz"
        )));
    }
    Ok(())
}

#[allow(clippy::too_many_arguments)]
async fn insert_block_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    benutzer_id: i64,
    posten: Posten,
    von: &str,
    bis: &str,
    soll_anzahl: Option<i64>,
    quali_soll: Option<&str>,
    notiz: Option<&str>,
) -> Result<i64, AppError> {
    Ok(sqlx::query_scalar(
        "INSERT INTO einsatz_planschicht (einsatz_id, posten_art, einheit_id, uhs_id, von, bis, \
            soll_anzahl, quali_soll, notiz, angelegt_von) \
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id",
    )
    .bind(einsatz_id)
    .bind(posten.art().as_str())
    .bind(posten.einheit_id())
    .bind(posten.uhs_id())
    .bind(von)
    .bind(bis)
    .bind(soll_anzahl)
    .bind(quali_soll)
    .bind(notiz)
    .bind(benutzer_id)
    .fetch_one(&mut *conn)
    .await?)
}

fn pause_ohne_soll(posten: Posten, soll: Option<i64>, quali: Option<&str>) -> Result<(), AppError> {
    if posten == Posten::Pause && (soll.is_some() || quali.is_some()) {
        return Err(AppError::UnprocessableEntity(
            "Die Pause hat kein Soll".into(),
        ));
    }
    Ok(())
}

// ---------------------------------------------------------------------------------------------
// Blöcke schreiben
// ---------------------------------------------------------------------------------------------

/// Legt einen Block an. Kein ETB (design.md D7). Liefert die Kennung.
pub async fn block_anlegen(
    pool: &SqlitePool,
    einsatz_id: i64,
    benutzer_id: i64,
    eingabe: &BlockEingabe,
) -> Result<i64, AppError> {
    write_retry!(pool, |conn| {
        let org_id = org_von(conn, einsatz_id).await?;
        pruefe_posten_tx(conn, einsatz_id, eingabe.posten).await?;
        pruefe_anzahl_tx(conn, einsatz_id, 1).await?;
        let (vorgabe_anzahl, vorgabe_quali) = soll_vorgabe_tx(conn, eingabe.posten).await?;
        let soll_anzahl = eingabe.soll_anzahl.unwrap_or(vorgabe_anzahl);
        let quali_soll = eingabe.quali_soll.clone().unwrap_or(vorgabe_quali);
        pause_ohne_soll(eingabe.posten, soll_anzahl, quali_soll.as_deref())?;
        crate::personal::quali_soll::pruefe_org(&mut *conn, org_id, quali_soll.as_deref()).await?;
        pruefe_personen_tx(conn, einsatz_id, org_id, &eingabe.personen).await?;
        pruefe_frei_tx(
            conn,
            einsatz_id,
            eingabe.posten,
            &eingabe.von,
            &eingabe.bis,
            None,
        )
        .await?;
        let bid = insert_block_tx(
            conn,
            einsatz_id,
            benutzer_id,
            eingabe.posten,
            &eingabe.von,
            &eingabe.bis,
            soll_anzahl,
            quali_soll.as_deref(),
            eingabe.notiz.as_deref(),
        )
        .await?;
        schreibe_personen_tx(conn, bid, &eingabe.personen).await?;
        Ok(bid)
    })
}

/// Ändert einen Block mit CAS über `version` (409). Verschieben in die Pause löscht das Soll;
/// ein Soll an der Pause ist 422. Kein ETB.
pub async fn block_aendern(
    pool: &SqlitePool,
    einsatz_id: i64,
    bid: i64,
    benutzer_id: i64,
    patch: &BlockPatch,
    jetzt: &str,
) -> Result<(), AppError> {
    write_retry!(pool, |conn| {
        type Stand = (
            i64,
            String,
            Option<i64>,
            Option<i64>,
            String,
            String,
            Option<i64>,
            Option<String>,
            Option<String>,
        );
        let stand: Stand = sqlx::query_as(
            "SELECT version, posten_art, einheit_id, uhs_id, von, bis, soll_anzahl, quali_soll, \
                    notiz \
             FROM einsatz_planschicht WHERE id = ? AND einsatz_id = ?",
        )
        .bind(bid)
        .bind(einsatz_id)
        .fetch_optional(&mut *conn)
        .await?
        .ok_or(AppError::NotFound)?;
        let (version, art, einheit_id, uhs_id, von_alt, bis_alt, soll_alt, quali_alt, notiz_alt) =
            stand;
        if version != patch.version {
            return Err(AppError::Conflict(
                "Die Schicht wurde zwischenzeitlich geändert".into(),
            ));
        }
        let org_id = org_von(conn, einsatz_id).await?;
        let posten_alt = Posten::aus_spalten(&art, einheit_id, uhs_id).ok_or(AppError::NotFound)?;
        let posten = patch.posten.unwrap_or(posten_alt);
        if posten != posten_alt {
            pruefe_posten_tx(conn, einsatz_id, posten).await?;
        }
        let von = patch.von.clone().unwrap_or(von_alt);
        let bis = patch.bis.clone().unwrap_or(bis_alt);
        zerlegung::pruefe_zeitraum(utc(&von)?, utc(&bis)?).map_err(|e| match e {
            AppError::Validation(m) => AppError::UnprocessableEntity(m),
            andere => andere,
        })?;
        let (mut soll_anzahl, mut quali_soll) = (soll_alt, quali_alt);
        if posten == Posten::Pause && posten_alt != Posten::Pause {
            (soll_anzahl, quali_soll) = (None, None);
        }
        if let Some(neu) = patch.soll_anzahl {
            soll_anzahl = neu;
        }
        if let Some(neu) = &patch.quali_soll {
            quali_soll = neu.clone();
        }
        pause_ohne_soll(posten, soll_anzahl, quali_soll.as_deref())?;
        if patch.quali_soll.is_some() {
            crate::personal::quali_soll::pruefe_org(&mut *conn, org_id, quali_soll.as_deref())
                .await?;
        }
        if let Some(personen) = &patch.personen {
            pruefe_personen_tx(conn, einsatz_id, org_id, personen).await?;
        }
        pruefe_frei_tx(conn, einsatz_id, posten, &von, &bis, Some(bid)).await?;
        let notiz = match &patch.notiz {
            Some(n) => n.clone(),
            None => notiz_alt,
        };
        sqlx::query(
            "UPDATE einsatz_planschicht SET posten_art = ?, einheit_id = ?, uhs_id = ?, von = ?, \
                bis = ?, soll_anzahl = ?, quali_soll = ?, notiz = ?, version = version + 1, \
                geaendert_at = ?, geaendert_von = ? \
             WHERE id = ? AND version = ?",
        )
        .bind(posten.art().as_str())
        .bind(posten.einheit_id())
        .bind(posten.uhs_id())
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
        if let Some(personen) = &patch.personen {
            schreibe_personen_tx(conn, bid, personen).await?;
        }
        Ok(())
    })
}

/// Löscht einen Block mit CAS über `version` (409). Kein ETB.
pub async fn block_loeschen(
    pool: &SqlitePool,
    einsatz_id: i64,
    bid: i64,
    version: i64,
) -> Result<(), AppError> {
    write_retry!(pool, |conn| {
        let stand: Option<i64> = sqlx::query_scalar(
            "SELECT version FROM einsatz_planschicht WHERE id = ? AND einsatz_id = ?",
        )
        .bind(bid)
        .bind(einsatz_id)
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
        sqlx::query("DELETE FROM einsatz_planschicht WHERE id = ?")
            .bind(bid)
            .execute(&mut *conn)
            .await?;
        Ok(())
    })
}

/// Füllt `[von, bis)` an einem Posten mit Blöcken (design.md D6): alles oder nichts, ein
/// ETB-Systemsatz. Liefert die neuen Kennungen und den ETB-Eintrag.
pub async fn erzeugen(
    pool: &SqlitePool,
    einsatz_id: i64,
    benutzer_id: i64,
    posten: Posten,
    von: &str,
    bis: &str,
    laenge_minuten: Option<i64>,
) -> Result<(Vec<i64>, i64), AppError> {
    let startwert = crate::einsatz::einstellungen::etb_startwert(pool, einsatz_id).await?;
    let (von_t, bis_t) = (utc(von)?, utc(bis)?);
    write_retry!(pool, |conn| {
        let bezeichnung = pruefe_posten_tx(conn, einsatz_id, posten).await?;
        let vorgabe = load_einsatz_vorgabe_tx(conn, einsatz_id).await?;
        let teilung = match (laenge_minuten, &vorgabe.werte) {
            (Some(m), _) => Teilung::Laenge(m),
            (None, Some(w)) => Teilung::Modell {
                regel: w.regel.clone(),
                zone: vorgabe.stil.zone,
            },
            (None, None) => {
                return Err(AppError::UnprocessableEntity(
                    "Der Einsatz hat kein Schichtmodell; bitte eine Länge angeben".into(),
                ))
            }
        };
        let teile = zerlegung::zerlege(von_t, bis_t, &teilung)?;
        pruefe_anzahl_tx(conn, einsatz_id, teile.len()).await?;

        let mut konflikte = Vec::new();
        for (a, b) in &teile {
            let (a, b) = (zeit::formatiere_utc(*a), zeit::formatiere_utc(*b));
            if let Some((id, x, y)) =
                ueberschneidung_tx(conn, einsatz_id, posten, &a, &b, None).await?
            {
                if !konflikte.iter().any(|k: &ZeilenGrund| k.id == id) {
                    konflikte.push(ZeilenGrund {
                        art: ZeilenArt::Planschicht,
                        id,
                        grund: format!(
                            "überschneidet sich mit {}",
                            zeitraum_text(&vorgabe.stil, &x, &y)
                        ),
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

        let (anzahl, quali) = soll_vorgabe_tx(conn, posten).await?;
        let mut ids = Vec::with_capacity(teile.len());
        for (a, b) in &teile {
            ids.push(
                insert_block_tx(
                    conn,
                    einsatz_id,
                    benutzer_id,
                    posten,
                    &zeit::formatiere_utc(*a),
                    &zeit::formatiere_utc(*b),
                    anzahl,
                    quali.as_deref(),
                    None,
                )
                .await?,
            );
        }
        let ort = match (posten, bezeichnung) {
            (Posten::Einheit(_), Some(name)) => format!("«{name}»"),
            (Posten::Uhs(_), Some(name)) => format!("UHS «{name}»"),
            _ => "Pause".into(),
        };
        let inhalt = format!(
            "Schichtplan {ort}: {} {} {} geplant.",
            ids.len(),
            if ids.len() == 1 {
                "Schicht"
            } else {
                "Schichten"
            },
            vorgabe.stil.zeitraum(von_t, bis_t)
        );
        let etb_id =
            crate::etb::system_audit_tx(conn, einsatz_id, benutzer_id, startwert, &inhalt).await?;
        Ok((ids, etb_id))
    })
}

// ---------------------------------------------------------------------------------------------
// Grenzwerte
// ---------------------------------------------------------------------------------------------

/// Setzt die Grenzwerte (Tri-State je Wert, `None` = unverändert, `Some(None)` = Vorgabe). Ein
/// ETB-Systemsatz, wenn sich etwas ändert; sonst `None`.
pub async fn grenzwerte_setzen(
    pool: &SqlitePool,
    einsatz_id: i64,
    benutzer_id: i64,
    max_dienst: Option<Option<i64>>,
    min_ruhe: Option<Option<i64>>,
    jetzt: &str,
) -> Result<Option<i64>, AppError> {
    let startwert = crate::einsatz::einstellungen::etb_startwert(pool, einsatz_id).await?;
    write_retry!(pool, |conn| {
        let vorher = grenzwerte(&mut *conn, einsatz_id).await?;
        let alt = (
            vorher.max_dienst_eigen.then_some(vorher.max_dienst_minuten),
            vorher.min_ruhe_eigen.then_some(vorher.min_ruhe_minuten),
        );
        let neu = (max_dienst.unwrap_or(alt.0), min_ruhe.unwrap_or(alt.1));
        if neu == alt {
            return Ok(None);
        }
        sqlx::query(
            "INSERT INTO einsatz_einstellungen (einsatz_id, schichtplan_max_dienst_min, \
                schichtplan_min_ruhe_min, geaendert_at, geaendert_von) VALUES (?1, ?2, ?3, ?4, ?5) \
             ON CONFLICT(einsatz_id) DO UPDATE SET schichtplan_max_dienst_min = ?2, \
                schichtplan_min_ruhe_min = ?3, geaendert_at = ?4, geaendert_von = ?5",
        )
        .bind(einsatz_id)
        .bind(neu.0)
        .bind(neu.1)
        .bind(jetzt)
        .bind(benutzer_id)
        .execute(&mut *conn)
        .await?;
        let g = SchichtplanGrenzwerte::aus(neu.0, neu.1);
        let inhalt = format!(
            "Schichtplan: höchstens {} im Dienst{}, mindestens {} Ruhe{}.",
            crate::abloesung::rhythmus_text(g.max_dienst_minuten),
            if g.max_dienst_eigen { "" } else { " (Vorgabe)" },
            crate::abloesung::rhythmus_text(g.min_ruhe_minuten),
            if g.min_ruhe_eigen { "" } else { " (Vorgabe)" },
        );
        let etb_id =
            crate::etb::system_audit_tx(conn, einsatz_id, benutzer_id, startwert, &inhalt).await?;
        Ok(Some(etb_id))
    })
}

// ---------------------------------------------------------------------------------------------
// Helfer
// ---------------------------------------------------------------------------------------------

/// Jede Qualifikation gehört zur Organisation (422 sonst).
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

fn quals_json(ids: &[i64]) -> Option<String> {
    (!ids.is_empty()).then(|| serde_json::to_string(ids).unwrap_or_else(|_| "[]".into()))
}

async fn helfer_laden_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    hid: i64,
) -> Result<PlanHelferAnzeige, AppError> {
    let (id, name, telefon, organisation, quals): (
        i64,
        String,
        Option<String>,
        Option<String>,
        Option<String>,
    ) = sqlx::query_as(
        "SELECT id, name, telefon, organisation, qualifikationen FROM einsatz_plan_helfer \
         WHERE id = ? AND einsatz_id = ?",
    )
    .bind(hid)
    .bind(einsatz_id)
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
    einsatz_id: i64,
    benutzer_id: i64,
    eingabe: &HelferEingabe,
) -> Result<PlanHelferAnzeige, AppError> {
    write_retry!(pool, |conn| {
        let org_id = org_von(conn, einsatz_id).await?;
        pruefe_qualifikationen_tx(conn, org_id, &eingabe.qualifikationen).await?;
        let bisher: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM einsatz_plan_helfer WHERE einsatz_id = ?")
                .bind(einsatz_id)
                .fetch_one(&mut *conn)
                .await?;
        if bisher >= PLAN_HELFER_MAX {
            return Err(AppError::UnprocessableEntity(format!(
                "Höchstens {PLAN_HELFER_MAX} Helfer je Einsatz"
            )));
        }
        let hid: i64 = sqlx::query_scalar(
            "INSERT INTO einsatz_plan_helfer (einsatz_id, name, telefon, organisation, \
                qualifikationen, angelegt_von) VALUES (?, ?, ?, ?, ?, ?) RETURNING id",
        )
        .bind(einsatz_id)
        .bind(&eingabe.name)
        .bind(&eingabe.telefon)
        .bind(&eingabe.organisation)
        .bind(quals_json(&eingabe.qualifikationen))
        .bind(benutzer_id)
        .fetch_one(&mut *conn)
        .await?;
        helfer_laden_tx(conn, einsatz_id, hid).await
    })
}

pub async fn helfer_aendern(
    pool: &SqlitePool,
    einsatz_id: i64,
    hid: i64,
    patch: &HelferPatch,
) -> Result<PlanHelferAnzeige, AppError> {
    write_retry!(pool, |conn| {
        let mut h = helfer_laden_tx(conn, einsatz_id, hid).await?;
        if let Some(ids) = &patch.qualifikationen {
            let org_id = org_von(conn, einsatz_id).await?;
            pruefe_qualifikationen_tx(conn, org_id, ids).await?;
            h.qualifikationen = ids.clone();
        }
        if let Some(name) = &patch.name {
            h.name = name.clone();
        }
        if let Some(t) = &patch.telefon {
            h.telefon = t.clone();
        }
        if let Some(o) = &patch.organisation {
            h.organisation = o.clone();
        }
        sqlx::query(
            "UPDATE einsatz_plan_helfer SET name = ?, telefon = ?, organisation = ?, \
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
pub async fn helfer_loeschen(pool: &SqlitePool, einsatz_id: i64, hid: i64) -> Result<(), AppError> {
    let geloescht = sqlx::query("DELETE FROM einsatz_plan_helfer WHERE id = ? AND einsatz_id = ?")
        .bind(hid)
        .bind(einsatz_id)
        .execute(pool)
        .await?
        .rows_affected();
    if geloescht == 0 {
        return Err(AppError::NotFound);
    }
    Ok(())
}
