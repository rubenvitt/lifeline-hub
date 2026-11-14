//! Datenbank des Schichtplans (LLH-1552, design.md D2–D7). Blöcke, Personen und Helfer schreibt
//! der Plan-Kern ([`super::plan_repo`]) mit [`Einsatzplan`]; hier stehen dessen Abweichungen,
//! das Laden samt Wechselpunkten, „Schichten erzeugen“ und die Grenzwerte. Schreibwege laufen je
//! in EINER Transaktion (`write_retry!`). Die Befunde rechnet [`super::pruefung`] beim Lesen.

use sqlx::sqlite::SqliteRow;
use sqlx::{Row, SqliteConnection, SqlitePool};

use super::plan_repo::{self, utc, BlockKern, Planart, PostenQuery, PostenVorgabe};
use super::pruefung::Block;
use super::wechselpunkte;
use super::zerlegung::{self, Teilung};
use super::{
    PlanBlockAnzeige, PlanPerson, PlanPostenAnzeige, Posten, SchichtplanAnzeige,
    SchichtplanGrenzwerte, SOLL_ANZAHL_MAX,
};
use crate::abloesung::repo::{load_einsatz_vorgabe_tx, nachziehen_plan_tx};
use crate::error::AppError;
use crate::personal::quali_soll::QualiSoll;
use crate::write_retry;
use crate::zeit;
use crate::zeitdarstellung::Zeitstil;

/// Der Schichtplan eines Einsatzes als [`Planart`] des Kerns (`plan_repo`): Posten sind Einheit,
/// UHS oder Pause des Einsatzes, Personen auch Ad-hoc-Kräfte, Servertexte in der Zone des
/// Einsatzes. Nach jedem Schreibweg an Blöcken zieht die Schicht der Einheit nach (LLH-1555).
pub(crate) struct Einsatzplan {
    pub einsatz_id: i64,
}

impl Planart for Einsatzplan {
    type Posten = Posten;
    type BlockZeile = BlockZeile;

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
    // Ad-hoc-Kräfte zählen nur, solange sie nicht entlassen sind; ein übernommener Helfer
    // (LLH-1555) ist als seine Kraft im Einsatz.
    const PERSONEN: &'static [(fn(i64) -> PlanPerson, &'static str)] = &[
        (
            PlanPerson::Stamm,
            "SELECT pe.id, pe.name, \
                    (SELECT json_group_array(pq.qualifikation_id) FROM personal_qualifikation pq \
                      WHERE pq.personal_id = pe.id), \
                    pe.dienststatus <> 'ausser_dienst', ep.id IS NOT NULL, ep.einheit_id, \
                    ep.uhs_id, COALESCE(ps.pause, 0) = 1 \
             FROM personal pe \
             LEFT JOIN einsatz_personal ep \
               ON ep.personal_id = pe.id AND ep.einsatz_id = ?1 AND ep.beendet_at IS NULL \
             LEFT JOIN personal_status ps ON ps.id = ep.status_id \
             WHERE pe.id IN (SELECT pp.personal_id FROM einsatz_planschicht_person pp \
                             JOIN einsatz_planschicht p ON p.id = pp.planschicht_id \
                             WHERE p.einsatz_id = ?1 AND pp.personal_id IS NOT NULL)",
        ),
        (
            PlanPerson::Einsatz,
            "SELECT ep.id, ep.snap_name, NULL, ep.beendet_at IS NULL, ep.beendet_at IS NULL, \
                    CASE WHEN ep.beendet_at IS NULL THEN ep.einheit_id END, \
                    CASE WHEN ep.beendet_at IS NULL THEN ep.uhs_id END, \
                    ep.beendet_at IS NULL AND COALESCE(ps.pause, 0) = 1 \
             FROM einsatz_personal ep \
             LEFT JOIN personal_status ps ON ps.id = ep.status_id \
             WHERE ep.id IN (SELECT pp.einsatz_personal_id FROM einsatz_planschicht_person pp \
                             JOIN einsatz_planschicht p ON p.id = pp.planschicht_id \
                             WHERE p.einsatz_id = ?1 AND pp.einsatz_personal_id IS NOT NULL)",
        ),
        (
            PlanPerson::Helfer,
            "SELECT h.id, h.name, h.qualifikationen, 1, ep.id IS NOT NULL, ep.einheit_id, \
                    ep.uhs_id, COALESCE(ps.pause, 0) = 1 \
             FROM einsatz_plan_helfer h \
             LEFT JOIN einsatz_personal ep \
               ON ep.id = h.einsatz_personal_id AND ep.beendet_at IS NULL \
             LEFT JOIN personal_status ps ON ps.id = ep.status_id \
             WHERE h.einsatz_id = ?1",
        ),
    ];
    // Nur bestehende Einheiten: beim Auflösen rückt die Unterstellung hoch, eine aufgelöste
    // Einheit trägt also niemanden mehr.
    const UEBER_EINHEIT: Option<&'static str> = Some(
        "SELECT id, ueber_einheit_id FROM einsatz_einheit \
         WHERE einsatz_id = ? AND aufgeloest_at IS NULL",
    );
    const MIT_ADHOC: bool = true;

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
            aufgeloest: z.aufgeloest,
        })
    }

    async fn before_write_tx(&self, conn: &mut SqliteConnection) -> Result<i64, AppError> {
        Ok(
            sqlx::query_scalar("SELECT org_id FROM einsatz WHERE id = ?")
                .bind(self.einsatz_id)
                .fetch_one(&mut *conn)
                .await?,
        )
    }

    /// Die Einheiten, deren laufende Schicht dem Block folgen kann: die seines Postens.
    async fn after_write_tx(
        &self,
        conn: &mut SqliteConnection,
        posten: &[Posten],
        benutzer_id: i64,
        jetzt: &str,
    ) -> Result<(), AppError> {
        let einheiten: Vec<i64> = posten.iter().filter_map(|p| p.einheit_id()).collect();
        nachziehen_plan_tx(conn, self.einsatz_id, &einheiten, benutzer_id, jetzt).await
    }

    /// Einheit oder UHS des Einsatzes, nicht aufgelöst (422 sonst); liefert die Bezeichnung und
    /// die Soll-Vorgabe ([`soll_vorgabe_tx`]).
    async fn check_posten_tx(
        &self,
        conn: &mut SqliteConnection,
        posten: Posten,
    ) -> Result<PostenVorgabe, AppError> {
        let fehler = |text: &str| Err(AppError::UnprocessableEntity(text.into()));
        let bezeichnung = match posten {
            Posten::Pause => None,
            Posten::Einheit(id) => {
                let zeile: Option<(String, Option<String>)> = sqlx::query_as(
                    "SELECT name, aufgeloest_at FROM einsatz_einheit WHERE id = ? AND einsatz_id = ?",
                )
                .bind(id)
                .bind(self.einsatz_id)
                .fetch_optional(&mut *conn)
                .await?;
                match zeile {
                    None => return fehler("Die Einheit gehört nicht zu diesem Einsatz"),
                    Some((_, Some(_))) => return fehler("Die Einheit ist aufgelöst"),
                    Some((name, None)) => Some(name),
                }
            }
            Posten::Uhs(id) => {
                let zeile: Option<(String, String, Option<String>)> = sqlx::query_as(
                    "SELECT bezeichnung, status, storniert_at FROM uhs WHERE id = ? AND einsatz_id = ?",
                )
                .bind(id)
                .bind(self.einsatz_id)
                .fetch_optional(&mut *conn)
                .await?;
                match zeile {
                    None => return fehler("Die UHS gehört nicht zu diesem Einsatz"),
                    Some((_, status, storniert))
                        if status == "aufgeloest" || storniert.is_some() =>
                    {
                        return fehler("Die UHS ist aufgelöst")
                    }
                    Some((name, _, _)) => Some(name),
                }
            }
        };
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

    /// Ohne Personal nur einen leeren Block (403, geprüft im Stand von `version`); keine Pause,
    /// in der noch jemand pausiert (409).
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
    let conn = &mut *conn;
    let plan = Einsatzplan { einsatz_id };
    let grenzwerte = grenzwerte(&mut *conn, einsatz_id).await?;
    let jetzt = utc(jetzt)?;
    let g = plan_repo::load_tx(conn, &plan, org_id, grenzwerte, jetzt).await?;
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
        plan.after_write_tx(conn, &[posten], benutzer_id, jetzt)
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
