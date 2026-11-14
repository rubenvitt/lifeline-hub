//! Datenbank des Schichtplans (LLH-1552, design.md D2–D7). Schreibwege laufen je in EINER
//! Transaktion (`write_retry!`): Posten, Überschneidung, Personen und Grenzen werden darin
//! geprüft, wo auch geschrieben wird. Die Befunde rechnet [`super::pruefung`] beim Lesen.
use std::collections::{BTreeMap, HashMap};

use sqlx::sqlite::SqliteRow;
use sqlx::{Row, SqliteConnection, SqlitePool};

use super::plan_repo::{
    self, json_ids, utc, BlockKern, PersonDaten, Planart, PostenQuery, PostenVorgabe,
};
use super::pruefung::{Block, Ist, PersonStand};
use super::wechselpunkte;
use super::zerlegung::{self, Teilung};
use super::{
    PlanBlockAnzeige, PlanHelferAnzeige, PlanPerson, PlanPostenAnzeige, Posten, SchichtplanAnzeige,
    SchichtplanGrenzwerte, SOLL_ANZAHL_MAX,
};
use crate::abloesung::repo::{load_einsatz_vorgabe_tx, nachziehen_plan_tx};
use crate::error::AppError;
use crate::personal::quali_soll::QualiSoll;
use crate::write_retry;
use crate::zeit;
use crate::zeitdarstellung::Zeitstil;

/// Ein neuer Block, Felder schon geprüft (Handler). Zeiten im kanonischen Format.
pub type BlockEingabe = plan_repo::BlockEingabe<Posten>;

/// Änderung eines Blocks, Felder schon geprüft. Fehlt = unverändert.
pub type BlockPatch = plan_repo::BlockPatch<Posten>;

pub(super) use super::plan_repo::{quals_json, zeitraum_text};
pub use super::plan_repo::{HelferEingabe, HelferPatch};

/// Der Schichtplan eines Einsatzes als [`Planart`] des Kerns (`plan_repo`): Posten sind Einheit,
/// UHS oder Pause des Einsatzes, Personen auch Ad-hoc-Kräfte, Servertexte in der Zone des
/// Einsatzes.
pub(crate) struct Einsatzplan {
    pub einsatz_id: i64,
}

impl Planart for Einsatzplan {
    type Posten = Posten;
    type BlockZeile = BlockZeile;
    /// Ob der Aufrufer Personal darf: sonst nur einen leeren Block (403).
    type DeleteRecht = bool;

    const SCHICHT: &'static str = "einsatz_planschicht";
    const PERSON: &'static str = "einsatz_planschicht_person";
    const PERSON_FK: &'static str = "planschicht_id";
    const HELFER: &'static str = "einsatz_plan_helfer";
    const SCOPE: &'static str = "einsatz_id";
    const POSTEN_SPALTEN: &'static [&'static str] = &["posten_art", "einheit_id", "uhs_id"];
    const SELECT_BLOECKE: &'static str = SELECT_BLOECKE;
    const HELFER_SPALTEN: &'static str =
        "id, name, telefon, organisation, qualifikationen, kennung, herkunft";
    const JE: &'static str = "Einsatz";
    const ZU_DIESEM: &'static str = "diesem Einsatz";
    const MIT_ARTIKEL: &'static str = "Ein Einsatz";
    const MIT_ADHOC: bool = true;
    const MIT_IST: bool = true;

    fn id(&self) -> i64 {
        self.einsatz_id
    }

    fn is_pause(posten: Posten) -> bool {
        posten == Posten::Pause
    }

    fn posten_from_row(row: &SqliteRow) -> Result<Posten, AppError> {
        let art: String = row.try_get("posten_art")?;
        Posten::aus_spalten(&art, row.try_get("einheit_id")?, row.try_get("uhs_id")?)
            .ok_or(AppError::NotFound)
    }

    fn bind_posten(query: PostenQuery<'_>, posten: Posten) -> PostenQuery<'_> {
        query
            .bind(posten.art().as_str())
            .bind(posten.einheit_id())
            .bind(posten.uhs_id())
    }

    fn block_kern(z: &BlockZeile) -> Result<BlockKern<'_>, AppError> {
        Ok(BlockKern {
            id: z.id,
            posten: Posten::aus_spalten(&z.posten_art, z.einheit_id, z.uhs_id)
                .ok_or_else(|| AppError::Internal(format!("Planschicht {} ohne Posten", z.id)))?,
            von: &z.von,
            bis: &z.bis,
            soll_anzahl: z.soll_anzahl,
            quali_soll: z.quali_soll.as_ref(),
        })
    }

    async fn before_write_tx(&self, conn: &mut SqliteConnection) -> Result<i64, AppError> {
        org_von(conn, self.einsatz_id).await
    }

    async fn check_posten_tx(
        &self,
        conn: &mut SqliteConnection,
        posten: Posten,
    ) -> Result<PostenVorgabe, AppError> {
        let bezeichnung = pruefe_posten_tx(conn, self.einsatz_id, posten).await?;
        let (soll_anzahl, quali_soll) = soll_vorgabe_tx(conn, posten).await?;
        Ok(PostenVorgabe {
            soll_anzahl,
            quali_soll,
            bezeichnung,
            schichtlaenge: None,
        })
    }

    async fn zone_tx(&self, conn: &mut SqliteConnection) -> Result<Zeitstil, AppError> {
        crate::zeitdarstellung::zeitstil_laden(&mut *conn, self.einsatz_id).await
    }

    /// Aus der Pause heraus nur, solange niemand mehr in ihr pausiert (409).
    async fn check_update_tx(
        &self,
        conn: &mut SqliteConnection,
        bid: i64,
        alt: Posten,
        neu: Posten,
    ) -> Result<(), AppError> {
        if alt == Posten::Pause
            && neu != Posten::Pause
            && super::vollzug::pause_offen_tx(conn, bid).await?
        {
            return Err(AppError::Conflict(super::vollzug::PAUSE_OFFEN.into()));
        }
        Ok(())
    }

    /// Ohne Personal nur einen leeren Block (403); keine Pause, in der noch jemand pausiert
    /// (409).
    async fn check_delete_tx(
        &self,
        conn: &mut SqliteConnection,
        bid: i64,
        darf_personen: bool,
    ) -> Result<(), AppError> {
        if !darf_personen {
            let belegt: bool = sqlx::query_scalar(
                "SELECT EXISTS(SELECT 1 FROM einsatz_planschicht_person WHERE planschicht_id = ?)",
            )
            .bind(bid)
            .fetch_one(&mut *conn)
            .await?;
            if belegt {
                return Err(AppError::Forbidden);
            }
        }
        if super::vollzug::pause_offen_tx(conn, bid).await? {
            return Err(AppError::Conflict(super::vollzug::PAUSE_OFFEN.into()));
        }
        Ok(())
    }

    async fn load_personen_tx(
        &self,
        conn: &mut SqliteConnection,
    ) -> Result<BTreeMap<PlanPerson, PersonDaten>, AppError> {
        personen_daten(conn, self.einsatz_id).await
    }

    /// Nur bestehende Einheiten: beim Auflösen rückt die Unterstellung hoch, eine aufgelöste
    /// Einheit trägt also niemanden mehr.
    async fn load_ueber_einheit_tx(
        &self,
        conn: &mut SqliteConnection,
    ) -> Result<HashMap<i64, Option<i64>>, AppError> {
        Ok(sqlx::query_as(
            "SELECT id, ueber_einheit_id FROM einsatz_einheit \
             WHERE einsatz_id = ? AND aufgeloest_at IS NULL",
        )
        .bind(self.einsatz_id)
        .fetch_all(&mut *conn)
        .await?
        .into_iter()
        .collect())
    }

    async fn helfer_posten_tx(
        &self,
        conn: &mut SqliteConnection,
        hid: i64,
    ) -> Result<Vec<Posten>, AppError> {
        let einheiten: Vec<i64> = sqlx::query_scalar(
            "SELECT DISTINCT b.einheit_id FROM einsatz_planschicht_person p \
             JOIN einsatz_planschicht b ON b.id = p.planschicht_id \
             WHERE p.helfer_id = ? AND b.einsatz_id = ? AND b.einheit_id IS NOT NULL",
        )
        .bind(hid)
        .bind(self.einsatz_id)
        .fetch_all(&mut *conn)
        .await?;
        Ok(einheiten.into_iter().map(Posten::Einheit).collect())
    }
}

// ---------------------------------------------------------------------------------------------
// Lesen
// ---------------------------------------------------------------------------------------------

#[derive(sqlx::FromRow)]
pub(crate) struct BlockZeile {
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
    let plan = Einsatzplan { einsatz_id };
    let grenzwerte = grenzwerte(&mut *conn, einsatz_id).await?;
    let jetzt = utc(jetzt)?;
    let g = plan_repo::load_tx(conn, &plan, org_id, grenzwerte, jetzt, |z| z.aufgeloest).await?;
    let helfer = plan_repo::load_helfer_tx(conn, &plan).await?;
    let wechsel = wechselpunkte_laden(&mut *conn, einsatz_id, &g.bloecke, jetzt).await?;

    let mut ergebnis_je_block = g.ergebnis.bloecke;
    let anzeige = g
        .zeilen
        .into_iter()
        .zip(g.bloecke)
        .map(|(z, b)| {
            let mut e = ergebnis_je_block.remove(&b.id).unwrap_or_default();
            let personen =
                mit_personen.then(|| plan_repo::personen_anzeige(&b, &g.personen, &mut e));
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
                personen,
                offene_plaetze: e.offene_plaetze,
                offene_anforderungen: e.offene_anforderungen,
                befunde: e.befunde,
            }
        })
        .collect();

    Ok(SchichtplanAnzeige {
        grenzwerte,
        bloecke: anzeige,
        helfer: mit_personen.then_some(helfer),
        wechsel,
        naechste_pruefung_at: g.ergebnis.naechste_pruefung.map(zeit::formatiere_utc),
    })
}

/// Die Wechsel-Leiste (LLH-1555 Welle 3): lädt, was Ablösung und Wechsel aus dem Plan schon
/// wissen, und rechnet die Wechselpunkte rein (`wechselpunkte::wechselpunkte`).
async fn wechselpunkte_laden(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    bloecke: &[Block],
    jetzt: chrono::DateTime<chrono::Utc>,
) -> Result<Vec<wechselpunkte::PlanWechselpunkt>, AppError> {
    let mut stand = wechselpunkte::Stand::default();
    let faellig: Vec<(i64, String, i64)> = sqlx::query_as(
        "SELECT einheit_id, faellig_at, id FROM einsatz_abloesung \
         WHERE einsatz_id = ? AND status = 'laufend' AND faellig_laut_plan = 1",
    )
    .bind(einsatz_id)
    .fetch_all(&mut *conn)
    .await?;
    for (einheit, faellig_at, id) in faellig {
        if let Some(t) = zeit::parse_utc(&faellig_at) {
            stand.faellig.insert((einheit, t), id);
        }
    }
    let abgeschlossen: Vec<(i64, String)> = sqlx::query_as(
        "SELECT einheit_id, faellig_at FROM einsatz_abloesung \
         WHERE einsatz_id = ? AND status <> 'laufend' AND faellig_laut_plan = 1",
    )
    .bind(einsatz_id)
    .fetch_all(&mut *conn)
    .await?;
    stand.abgeschlossen = abgeschlossen
        .into_iter()
        .filter_map(|(e, f)| zeit::parse_utc(&f).map(|t| (e, t)))
        .collect();
    stand.gewechselt_in = sqlx::query_scalar(
        "SELECT plan_block_id FROM einsatz_abloesung \
         WHERE einsatz_id = ? AND plan_block_id IS NOT NULL",
    )
    .bind(einsatz_id)
    .fetch_all(&mut *conn)
    .await?
    .into_iter()
    .collect();
    let vollzogen: Vec<(i64, String)> = sqlx::query_as(
        "SELECT planschicht_id, art FROM einsatz_plan_wechsel \
         WHERE einsatz_id = ? AND planschicht_id IS NOT NULL AND zurueckgenommen_at IS NULL",
    )
    .bind(einsatz_id)
    .fetch_all(&mut *conn)
    .await?;
    for (block, art) in vollzogen {
        if let Some(art) = super::vollzug::WechselArt::parse(&art) {
            stand.vollzogen.insert((block, art));
        }
    }
    let grenzen: Vec<wechselpunkte::BlockGrenzen> = bloecke
        .iter()
        .map(|b| wechselpunkte::BlockGrenzen {
            id: b.id,
            posten: b.posten,
            von: b.von,
            bis: b.bis,
        })
        .collect();
    Ok(wechselpunkte::wechselpunkte(&grenzen, &stand, jetzt))
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
        bool,
    );
    let stamm: Vec<StammZeile> = sqlx::query_as(
        "SELECT pe.id, pe.name, pe.dienststatus, \
                (SELECT json_group_array(pq.qualifikation_id) FROM personal_qualifikation pq \
                  WHERE pq.personal_id = pe.id), \
                ep.id, ep.einheit_id, ep.uhs_id, COALESCE(ps.pause, 0) = 1 \
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
                        pause: status,
                    },
                },
            },
        );
    }

    type EinsatzZeile = (i64, String, bool, Option<i64>, Option<i64>, bool);
    let einsatz: Vec<EinsatzZeile> = sqlx::query_as(
        "SELECT ep.id, ep.snap_name, ep.beendet_at IS NULL, ep.einheit_id, ep.uhs_id, \
                COALESCE(ps.pause, 0) = 1 \
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
                        pause: aktiv && status,
                    },
                },
            },
        );
    }

    // Ein übernommener Helfer (LLH-1555) ist als seine Kraft im Einsatz.
    type HelferZeile = (
        i64,
        String,
        Option<String>,
        Option<i64>,
        Option<i64>,
        Option<i64>,
        bool,
    );
    let helfer: Vec<HelferZeile> = sqlx::query_as(
        "SELECT h.id, h.name, h.qualifikationen, ep.id, ep.einheit_id, ep.uhs_id, \
                COALESCE(ps.pause, 0) = 1 \
         FROM einsatz_plan_helfer h \
         LEFT JOIN einsatz_personal ep ON ep.id = h.einsatz_personal_id AND ep.beendet_at IS NULL \
         LEFT JOIN personal_status ps ON ps.id = ep.status_id \
         WHERE h.einsatz_id = ?",
    )
    .bind(einsatz_id)
    .fetch_all(&mut *conn)
    .await?;
    for (id, name, quals, ep, einheit_id, uhs_id, status) in helfer {
        aus.insert(
            PlanPerson::Helfer(id),
            PersonDaten {
                name,
                stand: PersonStand {
                    qualifikationen: json_ids(quals.as_deref()),
                    ist: Ist {
                        im_einsatz: ep.is_some(),
                        einheit_id,
                        uhs_id,
                        pause: status,
                    },
                    ..PersonStand::default()
                },
            },
        );
    }
    Ok(aus)
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
pub(super) async fn pruefe_posten_tx(
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

/// Ersetzt die Personen eines Blocks (Kern: `plan_repo::write_personen_tx`).
pub(super) async fn schreibe_personen_tx(
    conn: &mut SqliteConnection,
    bid: i64,
    personen: &[PlanPerson],
) -> Result<(), AppError> {
    plan_repo::write_personen_tx::<Einsatzplan>(conn, bid, personen).await
}

/// Soll-Vorgabe eines Postens (design.md D4): Einheit = Summe des wirksamen Solls F/UF/M und
/// das wirksame Qualifikationssoll (eigen → Typ), UHS = ihre Soll-Anzahl und ihr
/// Qualifikationssoll, Pause = keins. Eine Summe von 0 ist kein Soll, über 200 wird 200.
pub(super) async fn soll_vorgabe_tx(
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

pub(super) async fn org_von(conn: &mut SqliteConnection, einsatz_id: i64) -> Result<i64, AppError> {
    Ok(
        sqlx::query_scalar("SELECT org_id FROM einsatz WHERE id = ?")
            .bind(einsatz_id)
            .fetch_one(&mut *conn)
            .await?,
    )
}

/// Schreibt einen Block ohne Prüfung (Kern: `plan_repo::insert_block_tx`).
#[allow(clippy::too_many_arguments)]
pub(super) async fn insert_block_tx(
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
    plan_repo::insert_block_tx(
        conn,
        &Einsatzplan { einsatz_id },
        benutzer_id,
        posten,
        von,
        bis,
        soll_anzahl,
        quali_soll,
        notiz,
    )
    .await
}

// ---------------------------------------------------------------------------------------------
// Blöcke schreiben
// ---------------------------------------------------------------------------------------------

/// Die Einheiten, deren laufende Schicht dem Block folgen kann (LLH-1555): die seines Postens.
fn einheiten_von(posten: &[Posten]) -> Vec<i64> {
    posten.iter().filter_map(|p| p.einheit_id()).collect()
}

/// Legt einen Block an. Kein ETB (design.md D7); die Schicht der Einheit zieht nach (LLH-1555).
/// Liefert die Kennung.
pub async fn block_anlegen(
    pool: &SqlitePool,
    einsatz_id: i64,
    benutzer_id: i64,
    eingabe: &BlockEingabe,
    jetzt: &str,
) -> Result<i64, AppError> {
    write_retry!(pool, |conn| {
        let bid =
            plan_repo::create_block_tx(conn, &Einsatzplan { einsatz_id }, benutzer_id, eingabe)
                .await?;
        nachziehen_plan_tx(
            conn,
            einsatz_id,
            &einheiten_von(&[eingabe.posten]),
            benutzer_id,
            jetzt,
        )
        .await?;
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
        let posten = plan_repo::update_block_tx(
            conn,
            &Einsatzplan { einsatz_id },
            bid,
            benutzer_id,
            patch,
            jetzt,
        )
        .await?;
        // Beide Zeilen: die, aus der der Block geht, und die, in die er kommt (LLH-1555).
        nachziehen_plan_tx(
            conn,
            einsatz_id,
            &einheiten_von(&posten),
            benutzer_id,
            jetzt,
        )
        .await?;
        Ok(())
    })
}

/// Löscht einen Block mit CAS über `version` (409). Ohne `darf_personen` (Freigabe Personal)
/// nur einen leeren Block (403 sonst), geprüft im selben Stand. Kein ETB; die Schicht der
/// Einheit zieht nach (LLH-1555).
pub async fn block_loeschen(
    pool: &SqlitePool,
    einsatz_id: i64,
    bid: i64,
    benutzer_id: i64,
    version: i64,
    darf_personen: bool,
    jetzt: &str,
) -> Result<(), AppError> {
    write_retry!(pool, |conn| {
        let posten = plan_repo::delete_block_tx(
            conn,
            &Einsatzplan { einsatz_id },
            bid,
            version,
            darf_personen,
        )
        .await?;
        nachziehen_plan_tx(
            conn,
            einsatz_id,
            &einheiten_von(&[posten]),
            benutzer_id,
            jetzt,
        )
        .await?;
        Ok(())
    })
}

/// Füllt `[von, bis)` an einem Posten mit Blöcken (design.md D6): alles oder nichts, ein
/// ETB-Systemsatz. Liefert die neuen Kennungen und den ETB-Eintrag.
#[allow(clippy::too_many_arguments)]
pub async fn erzeugen(
    pool: &SqlitePool,
    einsatz_id: i64,
    benutzer_id: i64,
    posten: Posten,
    von: &str,
    bis: &str,
    laenge_minuten: Option<i64>,
    jetzt: &str,
) -> Result<(Vec<i64>, i64), AppError> {
    let startwert = crate::einsatz::einstellungen::etb_startwert(pool, einsatz_id).await?;
    let (von_t, bis_t) = (utc(von)?, utc(bis)?);
    write_retry!(pool, |conn| {
        let plan = Einsatzplan { einsatz_id };
        plan.before_write_tx(conn).await?;
        let vorgabe = plan.check_posten_tx(conn, posten).await?;
        let einsatz_vorgabe = load_einsatz_vorgabe_tx(conn, einsatz_id).await?;
        let teilung = match (laenge_minuten, &einsatz_vorgabe.werte) {
            (Some(m), _) => Teilung::Laenge(m),
            (None, Some(w)) => Teilung::Modell {
                regel: w.regel.clone(),
                zone: einsatz_vorgabe.stil.zone,
            },
            (None, None) => {
                return Err(AppError::UnprocessableEntity(
                    "Der Einsatz hat kein Schichtmodell; bitte eine Länge angeben".into(),
                ))
            }
        };
        let teile = zerlegung::zerlege(von_t, bis_t, &teilung)?;
        let ids = plan_repo::create_bloecke_tx(conn, &plan, benutzer_id, posten, &vorgabe, &teile)
            .await?;
        let ort = match (posten, vorgabe.bezeichnung) {
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
            einsatz_vorgabe.stil.zeitraum(von_t, bis_t)
        );
        let etb_id =
            crate::etb::system_audit_tx(conn, einsatz_id, benutzer_id, startwert, &inhalt).await?;
        nachziehen_plan_tx(
            conn,
            einsatz_id,
            &einheiten_von(&[posten]),
            benutzer_id,
            jetzt,
        )
        .await?;
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

pub async fn helfer_anlegen(
    pool: &SqlitePool,
    einsatz_id: i64,
    benutzer_id: i64,
    eingabe: &HelferEingabe,
) -> Result<PlanHelferAnzeige, AppError> {
    write_retry!(pool, |conn| {
        plan_repo::create_helfer_tx(conn, &Einsatzplan { einsatz_id }, benutzer_id, eingabe).await
    })
}

pub async fn helfer_aendern(
    pool: &SqlitePool,
    einsatz_id: i64,
    hid: i64,
    patch: &HelferPatch,
) -> Result<PlanHelferAnzeige, AppError> {
    write_retry!(pool, |conn| {
        plan_repo::update_helfer_tx(conn, &Einsatzplan { einsatz_id }, hid, patch).await
    })
}

/// Löscht einen Helfer und nimmt ihn aus allen Blöcken (CASCADE). Die Schichten der Einheiten,
/// in deren Blöcken er stand, ziehen nach (ein Folgeblock kann dadurch leer werden, LLH-1555).
pub async fn helfer_loeschen(
    pool: &SqlitePool,
    einsatz_id: i64,
    hid: i64,
    benutzer_id: i64,
    jetzt: &str,
) -> Result<(), AppError> {
    write_retry!(pool, |conn| {
        let posten = plan_repo::delete_helfer_tx(conn, &Einsatzplan { einsatz_id }, hid).await?;
        nachziehen_plan_tx(
            conn,
            einsatz_id,
            &einheiten_von(&posten),
            benutzer_id,
            jetzt,
        )
        .await?;
        Ok(())
    })
}
