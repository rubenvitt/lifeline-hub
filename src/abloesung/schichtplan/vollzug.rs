//! Wechsel aus dem Schichtplan an einer UHS und in der Zeile „Pause“ (LLH-1555 Welle 2, Change
//! `qo0amhd5-wechsel-aus-schichtplan`, design.md D6/D7, Spec `kraefte-schichtplan` „Wechsel an der
//! UHS“ und „Pause aus dem Plan“).
//!
//! - **UHS** (`uhs`): Kommende bekommen die UHS (`einsatz_personal.uhs_id`), Gehende verlieren
//!   sie, Bleibende bleiben. Die Einheit einer Kraft bleibt unberührt (0167). Personen aus dem Plan
//!   kommen dabei in den Einsatz wie beim Vollzug einer Schicht ([`uebernehme_tx`]). Zeitachse
//!   (Quelle `abloesung`) nur für Kräfte ohne Einheit: Kommende `eintreffen`, Gehende `abloesung`;
//!   wer zu einer Einheit gehört, folgt deren Periode.
//! - **Pause beginnt** (`pause_beginn`): die Kräfte des Blocks, die im Einsatz sind, bekommen den
//!   Status, den der Katalog als Pause kennzeichnet, über denselben Weg wie ein Statuswechsel von
//!   Hand; der Status davor ist gemerkt. Wer nicht im Einsatz ist, wird übersprungen und genannt.
//! - **Pause endet** (`pause_ende`): wer dann noch den Pausenstatus trägt, bekommt den gemerkten
//!   Status zurück.
//!
//! Je Block und Art höchstens ein Wechsel, der nicht zurückgenommen ist (409). Ein ETB-Eintrag je
//! Wechsel. Die Rücknahme legt nur zurück, was noch den Stand des Wechsels trägt, und streicht die
//! Zeitachsen-Ereignisse des Wechsels; wer erst mit ihm in den Einsatz kam, bleibt im Einsatz.

use serde::Serialize;
use sqlx::{SqliteConnection, SqlitePool};
use utoipa::ToSchema;

use super::{PlanPerson, PlanPersonArt, PostenArt};
use crate::abloesung::repo::{
    besatzung_ereignis_tx, personen_text, uebernehme_tx, UebernahmeQuelle,
};
use crate::einsatz::einstellungen::etb_startwert;
use crate::error::AppError;
use crate::personal::disposition_repo::{self, DispositionPatch};
use crate::personal::status_repo;
use crate::wire_enum::wire_enum;
use crate::write_retry;
use crate::zeitachse::ZeitachseArt;
use crate::zeitdarstellung::zeitstil_laden;

/// Grund der gestrichenen Zeitachsen-Ereignisse bei der Rücknahme eines Wechsels.
pub const GRUND_WECHSEL_ZURUECK: &str = "Wechsel aus dem Schichtplan zurückgenommen";

wire_enum! {
    /// Art eines Wechsels aus dem Plan (`einsatz_plan_wechsel.art`). Wire == `as_str()`.
    #[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, ToSchema)]
    pub enum WechselArt {
        /// An einem UHS-Block: Kräfte kommen an die UHS und gehen.
        Uhs => "uhs",
        /// Beginn eines Pausenblocks: Pausenstatus.
        PauseBeginn => "pause_beginn",
        /// Ende eines Pausenblocks: der gemerkte Status zurück.
        PauseEnde => "pause_ende",
    }
    try_from = |s| format!("Ungültige Art eines Wechsels: {s}");
}

/// Was ein Wechsel vollzieht, Felder schon geprüft (Handler).
#[derive(Debug, Clone)]
pub enum WechselEingabe {
    Uhs {
        vollzogen_at: String,
        /// Personen aus dem Plan, die an die UHS kommen; entdoppelt.
        kommen: Vec<PlanPerson>,
        /// Kräfte des Einsatzes, die von der UHS gehen; entdoppelt.
        gehen: Vec<i64>,
    },
    PauseBeginn,
    PauseEnde,
}

impl WechselEingabe {
    pub fn art(&self) -> WechselArt {
        match self {
            WechselEingabe::Uhs { .. } => WechselArt::Uhs,
            WechselEingabe::PauseBeginn => WechselArt::PauseBeginn,
            WechselEingabe::PauseEnde => WechselArt::PauseEnde,
        }
    }
}

/// Ein vollzogener Wechsel.
#[derive(Debug, Clone, PartialEq, Serialize, ToSchema)]
pub struct PlanWechselAnzeige {
    pub id: i64,
    #[schema(value_type = WechselArt)]
    pub art: WechselArt,
    /// `null`, wenn der Block inzwischen gelöscht ist.
    #[schema(required)]
    pub planschicht_id: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub uhs_id: Option<i64>,
    /// Zeitpunkt laut Plan (Beginn, beim Pausenende das Ende des Blocks).
    pub zeitpunkt: String,
    pub vollzogen_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub zurueckgenommen_at: Option<String>,
}

/// Eine Person der Vorlage: aus dem Block (mit ihrer Herkunft im Plan) oder eine Kraft an der UHS.
#[derive(Debug, Clone, PartialEq, Serialize, ToSchema)]
pub struct WechselVorlagePerson {
    /// Herkunft im Plan; `null` bei einer Kraft, die nur an der UHS steht.
    #[schema(value_type = Option<PlanPersonArt>, required)]
    pub art: Option<PlanPersonArt>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub personal_id: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub helfer_id: Option<i64>,
    /// Die Kraft des Einsatzes; `null` = nicht im Einsatz (kommt erst mit dem Wechsel).
    #[schema(required)]
    pub einsatz_personal_id: Option<i64>,
    pub name: String,
    /// Eine andere UHS, an der die Kraft gerade steht (sie wechselt).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub andere_uhs: Option<String>,
    /// Ihr Status jetzt (Pause).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub status: Option<String>,
    /// Beim Pausenende: der gemerkte Status, den sie zurückbekommt.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub status_zurueck: Option<String>,
}

/// Der nächste Wechsel eines Blocks zum Vorbelegen des Dialogs.
#[derive(Debug, Clone, PartialEq, Serialize, ToSchema)]
pub struct WechselVorlage {
    pub block_id: i64,
    /// Die Art des nächsten Wechsels; `null`, wenn alle Wechsel des Blocks vollzogen sind.
    #[schema(value_type = Option<WechselArt>, required)]
    pub art: Option<WechselArt>,
    /// Zeitpunkt laut Plan des nächsten Wechsels.
    pub zeitpunkt: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub uhs_id: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub uhs: Option<String>,
    /// UHS: Personen des Blocks, die nicht an dieser UHS stehen. Pause: wer den Status wechselt.
    pub kommen: Vec<WechselVorlagePerson>,
    /// UHS: Kräfte an dieser UHS, die nicht im Block stehen.
    pub gehen: Vec<WechselVorlagePerson>,
    /// UHS: Kräfte an dieser UHS, die im Block stehen.
    pub bleiben: Vec<WechselVorlagePerson>,
    /// Pause: Personen des Blocks, die nicht im Einsatz sind (beim Ende: die nicht mehr in Pause
    /// sind).
    pub uebersprungen: Vec<WechselVorlagePerson>,
    /// Pause: das Label des gekennzeichneten Status.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pause_status: Option<String>,
    /// Warum der Wechsel gerade nicht geht (kein Pausenstatus, die Pause hat nicht begonnen, die
    /// UHS ist aufgelöst).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub gesperrt: Option<String>,
    /// Die vollzogenen Wechsel des Blocks, die nicht zurückgenommen sind.
    pub wechsel: Vec<PlanWechselAnzeige>,
}

/// Was ein Wechsel oder seine Rücknahme berührt hat (Live nach dem Commit).
#[derive(Debug, Default)]
pub struct WechselWirkung {
    pub etb_id: i64,
    pub uhs: Vec<i64>,
    pub personen: Vec<i64>,
}

const NOCH_OFFEN: &str = "Der Wechsel zu diesem Block ist schon vollzogen";
const KEIN_PAUSENSTATUS: &str = "Kein Personalstatus ist als Pause gekennzeichnet";
const PAUSE_NICHT_BEGONNEN: &str = "Die Pause hat nicht begonnen";

/// Ein Block, wie der Wechsel ihn braucht.
struct BlockDaten {
    art: PostenArt,
    uhs_id: Option<i64>,
    von: String,
    bis: String,
}

async fn block_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    bid: i64,
) -> Result<BlockDaten, AppError> {
    let (art, uhs_id, von, bis): (String, Option<i64>, String, String) = sqlx::query_as(
        "SELECT posten_art, uhs_id, von, bis FROM einsatz_planschicht \
         WHERE id = ? AND einsatz_id = ?",
    )
    .bind(bid)
    .bind(einsatz_id)
    .fetch_optional(&mut *conn)
    .await?
    .ok_or(AppError::NotFound)?;
    Ok(BlockDaten {
        art: PostenArt::parse(&art)
            .ok_or_else(|| AppError::Internal(format!("Planschicht {bid}: Posten {art}")))?,
        uhs_id,
        von,
        bis,
    })
}

/// Die UHS eines Blocks mit ihrer Bezeichnung; storniert oder aufgelöst → `Err` mit Grund (409
/// beim Schreiben, Sperre in der Vorlage).
async fn uhs_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    uhs_id: i64,
) -> Result<(String, Option<&'static str>), AppError> {
    let (bezeichnung, status, storniert): (String, String, bool) = sqlx::query_as(
        "SELECT bezeichnung, status, storniert_at IS NOT NULL FROM uhs \
         WHERE id = ? AND einsatz_id = ?",
    )
    .bind(uhs_id)
    .bind(einsatz_id)
    .fetch_optional(&mut *conn)
    .await?
    .ok_or(AppError::NotFound)?;
    let grund = if storniert {
        Some("Stornierte UHS kann nicht geändert werden")
    } else if status == "aufgeloest" {
        Some("Aufgelöste UHS kann nicht geändert werden")
    } else {
        None
    };
    Ok((bezeichnung, grund))
}

/// Eine Person des Blocks mit ihrer Kraft, wenn sie im Einsatz ist.
struct BlockPerson {
    person: PlanPerson,
    name: String,
    kraft: Option<i64>,
    uhs_id: Option<i64>,
    uhs: Option<String>,
    status_id: Option<i64>,
    status: Option<String>,
}

async fn block_personen_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    bid: i64,
) -> Result<Vec<BlockPerson>, AppError> {
    type Zeile = (
        Option<i64>,
        Option<i64>,
        Option<i64>,
        Option<String>,
        Option<i64>,
        Option<i64>,
        Option<String>,
        Option<i64>,
        Option<String>,
    );
    // Die Kraft: Stamm über `personal_id` (je Einsatz höchstens eine Zeile), ein Helfer über die
    // Kraft, als die er übernommen wurde, eine Ad-hoc-Kraft sie selbst; nur, wenn sie aktiv ist.
    let zeilen: Vec<Zeile> = sqlx::query_as(
        "SELECT pp.personal_id, pp.einsatz_personal_id, pp.helfer_id, \
                COALESCE(pe.name, h.name, ea.snap_name), \
                ep.id, ep.uhs_id, u.bezeichnung, ep.status_id, ps.label \
         FROM einsatz_planschicht_person pp \
         LEFT JOIN personal pe ON pe.id = pp.personal_id \
         LEFT JOIN einsatz_plan_helfer h ON h.id = pp.helfer_id \
         LEFT JOIN einsatz_personal ea ON ea.id = pp.einsatz_personal_id \
         LEFT JOIN einsatz_personal ep ON ep.einsatz_id = ?2 AND ep.beendet_at IS NULL \
              AND ep.id = CASE \
                  WHEN pp.personal_id IS NOT NULL THEN (SELECT x.id FROM einsatz_personal x \
                       WHERE x.einsatz_id = ?2 AND x.personal_id = pp.personal_id \
                         AND x.beendet_at IS NULL) \
                  WHEN pp.helfer_id IS NOT NULL THEN h.einsatz_personal_id \
                  ELSE pp.einsatz_personal_id END \
         LEFT JOIN uhs u ON u.id = ep.uhs_id \
         LEFT JOIN personal_status ps ON ps.id = ep.status_id \
         WHERE pp.planschicht_id = ?1 ORDER BY pp.rowid",
    )
    .bind(bid)
    .bind(einsatz_id)
    .fetch_all(&mut *conn)
    .await?;
    Ok(zeilen
        .into_iter()
        .filter_map(
            |(stamm, adhoc, helfer, name, kraft, uhs_id, uhs, status_id, status)| {
                Some(BlockPerson {
                    person: PlanPerson::aus_spalten(stamm, adhoc, helfer)?,
                    name: name.unwrap_or_default(),
                    kraft,
                    uhs_id,
                    uhs,
                    status_id,
                    status,
                })
            },
        )
        .collect())
}

fn vorlage_person(p: &BlockPerson) -> WechselVorlagePerson {
    WechselVorlagePerson {
        art: Some(p.person.art()),
        personal_id: matches!(p.person, PlanPerson::Stamm(_)).then(|| p.person.id()),
        helfer_id: matches!(p.person, PlanPerson::Helfer(_)).then(|| p.person.id()),
        einsatz_personal_id: p.kraft,
        name: p.name.clone(),
        andere_uhs: None,
        status: p.status.clone(),
        status_zurueck: None,
    }
}

fn kraft_person(id: i64, name: String) -> WechselVorlagePerson {
    WechselVorlagePerson {
        art: None,
        personal_id: None,
        helfer_id: None,
        einsatz_personal_id: Some(id),
        name,
        andere_uhs: None,
        status: None,
        status_zurueck: None,
    }
}

type WechselZeile = (
    i64,
    String,
    Option<i64>,
    Option<i64>,
    String,
    String,
    Option<String>,
);

fn anzeige(
    (id, art, planschicht_id, uhs_id, zeitpunkt, vollzogen_at, zurueck): WechselZeile,
) -> Result<PlanWechselAnzeige, AppError> {
    Ok(PlanWechselAnzeige {
        id,
        art: WechselArt::parse(&art)
            .ok_or_else(|| AppError::Internal(format!("Wechsel {id}: Art {art}")))?,
        planschicht_id,
        uhs_id,
        zeitpunkt,
        vollzogen_at,
        zurueckgenommen_at: zurueck,
    })
}

const WECHSEL_SPALTEN: &str =
    "id, art, planschicht_id, uhs_id, zeitpunkt, vollzogen_at, zurueckgenommen_at";

async fn offene_wechsel_tx(
    conn: &mut SqliteConnection,
    bid: i64,
) -> Result<Vec<PlanWechselAnzeige>, AppError> {
    let zeilen: Vec<WechselZeile> = sqlx::query_as(sqlx::AssertSqlSafe(format!(
        "SELECT {WECHSEL_SPALTEN} FROM einsatz_plan_wechsel \
         WHERE planschicht_id = ? AND zurueckgenommen_at IS NULL ORDER BY id"
    )))
    .bind(bid)
    .fetch_all(&mut *conn)
    .await?;
    zeilen.into_iter().map(anzeige).collect()
}

async fn wechsel_laden_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    wid: i64,
) -> Result<PlanWechselAnzeige, AppError> {
    let zeile: WechselZeile = sqlx::query_as(sqlx::AssertSqlSafe(format!(
        "SELECT {WECHSEL_SPALTEN} FROM einsatz_plan_wechsel WHERE id = ? AND einsatz_id = ?"
    )))
    .bind(wid)
    .bind(einsatz_id)
    .fetch_optional(&mut *conn)
    .await?
    .ok_or(AppError::NotFound)?;
    anzeige(zeile)
}

async fn org_tx(conn: &mut SqliteConnection, einsatz_id: i64) -> Result<i64, AppError> {
    Ok(
        sqlx::query_scalar("SELECT org_id FROM einsatz WHERE id = ?")
            .bind(einsatz_id)
            .fetch_one(&mut *conn)
            .await?,
    )
}

/// Die Kräfte, deren Status ein Wechsel gesetzt hat: (Kraft, Name, Status davor, danach).
async fn status_personen_tx(
    conn: &mut SqliteConnection,
    wid: i64,
) -> Result<Vec<(i64, String, Option<i64>, Option<i64>)>, AppError> {
    Ok(sqlx::query_as(
        "SELECT w.einsatz_personal_id, ep.snap_name, w.status_vorher_id, w.status_nachher_id \
         FROM einsatz_plan_wechsel_person w \
         JOIN einsatz_personal ep ON ep.id = w.einsatz_personal_id \
         WHERE w.wechsel_id = ? ORDER BY w.rowid",
    )
    .bind(wid)
    .fetch_all(&mut *conn)
    .await?)
}

/// Der Status und Lebensstand einer Kraft jetzt: (Status, aktiv).
async fn kraft_status_tx(
    conn: &mut SqliteConnection,
    ep: i64,
) -> Result<(Option<i64>, bool), AppError> {
    Ok(
        sqlx::query_as("SELECT status_id, beendet_at IS NULL FROM einsatz_personal WHERE id = ?")
            .bind(ep)
            .fetch_one(&mut *conn)
            .await?,
    )
}

async fn status_label_tx(
    conn: &mut SqliteConnection,
    status_id: Option<i64>,
) -> Result<String, AppError> {
    let label: Option<String> = match status_id {
        Some(id) => {
            sqlx::query_scalar("SELECT label FROM personal_status WHERE id = ?")
                .bind(id)
                .fetch_optional(&mut *conn)
                .await?
        }
        None => None,
    };
    Ok(label.unwrap_or_else(|| "—".into()))
}

/// Hat der Block eine begonnene, noch nicht beendete Pause? Dann darf er weder gehen noch die
/// Zeile „Pause“ verlassen, sonst bliebe die Pause ohne Ende und ohne Rücknahme.
pub(crate) async fn pause_offen_tx(
    conn: &mut SqliteConnection,
    bid: i64,
) -> Result<bool, AppError> {
    Ok(sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM einsatz_plan_wechsel WHERE planschicht_id = ?1 \
             AND art = 'pause_beginn' AND zurueckgenommen_at IS NULL) \
         AND NOT EXISTS(SELECT 1 FROM einsatz_plan_wechsel WHERE planschicht_id = ?1 \
             AND art = 'pause_ende' AND zurueckgenommen_at IS NULL)",
    )
    .bind(bid)
    .fetch_one(&mut *conn)
    .await?)
}

/// Sperrgrund für Löschen und Verschieben aus der Zeile „Pause“.
pub(crate) const PAUSE_OFFEN: &str = "Erst die Pause beenden oder ihren Beginn zurücknehmen";

/// Rücknahme eines Pausenwechsels, dessen Block gelöscht ist oder die Zeile „Pause“ verlassen hat.
pub(crate) const PAUSENBLOCK_FEHLT: &str = "Der Pausenblock besteht nicht mehr";

/// Die vollzogenen Wechsel einer Art zum Block, die nicht zurückgenommen sind.
fn offen_von(wechsel: &[PlanWechselAnzeige], art: WechselArt) -> Option<&PlanWechselAnzeige> {
    wechsel.iter().find(|w| w.art == art)
}

/// GET-Vorlage des nächsten Wechsels eines Blocks. Ein Einheiten-Block ist 422 (er wechselt über
/// die Ablösung).
pub async fn vorlage(
    pool: &SqlitePool,
    einsatz_id: i64,
    bid: i64,
) -> Result<WechselVorlage, AppError> {
    let mut conn = pool.acquire().await?;
    let conn = &mut *conn;
    let block = block_tx(conn, einsatz_id, bid).await?;
    let wechsel = offene_wechsel_tx(conn, bid).await?;
    let personen = block_personen_tx(conn, einsatz_id, bid).await?;
    let mut v = WechselVorlage {
        block_id: bid,
        art: None,
        zeitpunkt: block.von.clone(),
        uhs_id: block.uhs_id,
        uhs: None,
        kommen: Vec::new(),
        gehen: Vec::new(),
        bleiben: Vec::new(),
        uebersprungen: Vec::new(),
        pause_status: None,
        gesperrt: None,
        wechsel: Vec::new(),
    };
    match block.art {
        PostenArt::Einheit => {
            return Err(AppError::UnprocessableEntity(
                "Ein Block an einer Einheit wechselt über die Ablösung".into(),
            ))
        }
        PostenArt::Uhs => {
            let uhs_id = block
                .uhs_id
                .ok_or_else(|| AppError::Internal(format!("UHS-Block {bid} ohne UHS")))?;
            let (bezeichnung, grund) = uhs_tx(conn, einsatz_id, uhs_id).await?;
            v.uhs = Some(bezeichnung);
            v.gesperrt = grund.map(str::to_string);
            if offen_von(&wechsel, WechselArt::Uhs).is_none() {
                v.art = Some(WechselArt::Uhs);
            }
            let im_block: Vec<i64> = personen.iter().filter_map(|p| p.kraft).collect();
            for p in &personen {
                let mut vp = vorlage_person(p);
                vp.status = None;
                if p.kraft.is_some() && p.uhs_id == Some(uhs_id) {
                    v.bleiben.push(vp);
                } else {
                    vp.andere_uhs = p.uhs.clone().filter(|_| p.uhs_id.is_some());
                    v.kommen.push(vp);
                }
            }
            let an_der_uhs: Vec<(i64, String)> = sqlx::query_as(
                "SELECT id, snap_name FROM einsatz_personal \
                 WHERE einsatz_id = ? AND uhs_id = ? AND beendet_at IS NULL ORDER BY id",
            )
            .bind(einsatz_id)
            .bind(uhs_id)
            .fetch_all(&mut *conn)
            .await?;
            v.gehen = an_der_uhs
                .into_iter()
                .filter(|(id, _)| !im_block.contains(id))
                .map(|(id, name)| kraft_person(id, name))
                .collect();
        }
        PostenArt::Pause => {
            let org_id = org_tx(conn, einsatz_id).await?;
            let pause = status_repo::pause_status_tx(conn, org_id).await?;
            v.pause_status = pause.as_ref().map(|(_, l)| l.clone());
            match offen_von(&wechsel, WechselArt::PauseBeginn).cloned() {
                None => {
                    v.art = Some(WechselArt::PauseBeginn);
                    if pause.is_none() {
                        v.gesperrt = Some(KEIN_PAUSENSTATUS.into());
                    }
                    let pause_id = pause.map(|(id, _)| id);
                    for p in &personen {
                        if p.kraft.is_none() {
                            v.uebersprungen.push(vorlage_person(p));
                        } else if p.status_id.is_none() || p.status_id != pause_id {
                            v.kommen.push(vorlage_person(p));
                        }
                    }
                }
                Some(beginn) => {
                    v.zeitpunkt = block.bis.clone();
                    if offen_von(&wechsel, WechselArt::PauseEnde).is_none() {
                        v.art = Some(WechselArt::PauseEnde);
                    }
                    for (ep, name, vorher, nachher) in status_personen_tx(conn, beginn.id).await? {
                        let (jetzt, aktiv) = kraft_status_tx(conn, ep).await?;
                        let mut vp = kraft_person(ep, name);
                        vp.status = Some(status_label_tx(conn, jetzt).await?);
                        if aktiv && jetzt == nachher {
                            vp.status_zurueck = Some(status_label_tx(conn, vorher).await?);
                            v.kommen.push(vp);
                        } else {
                            v.uebersprungen.push(vp);
                        }
                    }
                }
            }
        }
    }
    v.wechsel = wechsel;
    Ok(v)
}

/// Die Art des Postens eines vollzogenen Wechsels (für die Modulprüfung der Rücknahme).
pub async fn art_von(pool: &SqlitePool, einsatz_id: i64, wid: i64) -> Result<WechselArt, AppError> {
    let mut conn = pool.acquire().await?;
    Ok(wechsel_laden_tx(&mut conn, einsatz_id, wid).await?.art)
}

/// Setzt den Status einer Kraft über denselben Weg wie ein Statuswechsel von Hand (Zeitachse der
/// Marke des Status, LFH-552); der ETB-Eintrag kommt vom Wechsel.
/// Ohne Status (`None`, nur beim Zurückgeben eines leeren Stands) ohne Zeitachse.
async fn status_setzen_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    benutzer_id: i64,
    ep: i64,
    status_id: Option<i64>,
    jetzt: &str,
) -> Result<(), AppError> {
    let Some(status_id) = status_id else {
        disposition_repo::require_aktiv_tx(conn, einsatz_id, ep).await?;
        sqlx::query("UPDATE einsatz_personal SET status_id = NULL WHERE id = ? AND einsatz_id = ?")
            .bind(ep)
            .bind(einsatz_id)
            .execute(&mut *conn)
            .await?;
        return Ok(());
    };
    disposition_repo::update_tx(
        conn,
        einsatz_id,
        ep,
        DispositionPatch {
            status_id: Some(status_id),
            ..Default::default()
        },
    )
    .await?;
    crate::zeitachse::repo::aus_personalstatus_tx(
        conn,
        einsatz_id,
        benutzer_id,
        ep,
        status_id,
        jetzt,
    )
    .await?;
    Ok(())
}

#[allow(clippy::too_many_arguments)]
async fn wechsel_einfuegen_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    bid: i64,
    art: WechselArt,
    uhs_id: Option<i64>,
    zeitpunkt: &str,
    vollzogen_at: &str,
    benutzer_id: i64,
) -> Result<i64, AppError> {
    let ergebnis = sqlx::query_scalar::<_, i64>(
        "INSERT INTO einsatz_plan_wechsel \
            (einsatz_id, planschicht_id, art, uhs_id, zeitpunkt, vollzogen_at, vollzogen_von) \
         VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id",
    )
    .bind(einsatz_id)
    .bind(bid)
    .bind(art.as_str())
    .bind(uhs_id)
    .bind(zeitpunkt)
    .bind(vollzogen_at)
    .bind(benutzer_id)
    .fetch_one(&mut *conn)
    .await;
    match ergebnis {
        Ok(id) => Ok(id),
        Err(sqlx::Error::Database(db)) if db.is_unique_violation() => {
            Err(AppError::Conflict(NOCH_OFFEN.into()))
        }
        Err(e) => Err(e.into()),
    }
}

#[allow(clippy::too_many_arguments)]
async fn person_einfuegen_tx(
    conn: &mut SqliteConnection,
    wid: i64,
    ep: i64,
    rolle: &str,
    uhs_vorher: Option<i64>,
    status: (Option<i64>, Option<i64>),
    zeitachse_id: Option<i64>,
    uebernommen: bool,
) -> Result<(), AppError> {
    sqlx::query(
        "INSERT INTO einsatz_plan_wechsel_person (wechsel_id, einsatz_personal_id, rolle, \
            uhs_vorher_id, status_vorher_id, status_nachher_id, zeitachse_id, uebernommen) \
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(wid)
    .bind(ep)
    .bind(rolle)
    .bind(uhs_vorher)
    .bind(status.0)
    .bind(status.1)
    .bind(zeitachse_id)
    .bind(uebernommen)
    .execute(&mut *conn)
    .await?;
    Ok(())
}

async fn etb_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    benutzer_id: i64,
    wid: i64,
    text: &str,
) -> Result<i64, AppError> {
    let startwert = etb_startwert(&mut *conn, einsatz_id).await?;
    let etb_id =
        crate::etb::system_audit_tx(conn, einsatz_id, benutzer_id, startwert, text).await?;
    sqlx::query("UPDATE einsatz_plan_wechsel SET etb_id = COALESCE(etb_id, ?) WHERE id = ?")
        .bind(etb_id)
        .bind(wid)
        .execute(&mut *conn)
        .await?;
    Ok(etb_id)
}

/// Vollzieht den nächsten Wechsel eines Blocks. Der Posten des Blocks muss zur Art passen (422).
pub async fn vollziehen(
    pool: &SqlitePool,
    einsatz_id: i64,
    bid: i64,
    benutzer_id: i64,
    eingabe: &WechselEingabe,
    jetzt: &str,
) -> Result<(PlanWechselAnzeige, WechselWirkung), AppError> {
    write_retry!(pool, |conn| {
        let block = block_tx(conn, einsatz_id, bid).await?;
        let passt = matches!(
            (block.art, eingabe.art()),
            (PostenArt::Uhs, WechselArt::Uhs)
                | (
                    PostenArt::Pause,
                    WechselArt::PauseBeginn | WechselArt::PauseEnde
                )
        );
        if !passt {
            return Err(AppError::UnprocessableEntity(match block.art {
                PostenArt::Einheit => {
                    "Ein Block an einer Einheit wechselt über die Ablösung".into()
                }
                PostenArt::Uhs => "An einem UHS-Block gilt nur der Wechsel an der UHS".into(),
                PostenArt::Pause => "An einem Pausenblock beginnt oder endet die Pause".into(),
            }));
        }
        let wechsel = offene_wechsel_tx(conn, bid).await?;
        if offen_von(&wechsel, eingabe.art()).is_some() {
            return Err(AppError::Conflict(NOCH_OFFEN.into()));
        }
        let wirkung = match eingabe {
            WechselEingabe::Uhs {
                vollzogen_at,
                kommen,
                gehen,
            } => {
                uhs_tx_vollziehen(
                    conn,
                    einsatz_id,
                    bid,
                    benutzer_id,
                    &block,
                    vollzogen_at,
                    kommen,
                    gehen,
                )
                .await?
            }
            WechselEingabe::PauseBeginn => {
                pause_beginn_tx(conn, einsatz_id, bid, benutzer_id, &block, jetzt).await?
            }
            WechselEingabe::PauseEnde => {
                let beginn = offen_von(&wechsel, WechselArt::PauseBeginn)
                    .ok_or_else(|| AppError::UnprocessableEntity(PAUSE_NICHT_BEGONNEN.into()))?;
                pause_ende_tx(conn, einsatz_id, bid, benutzer_id, &block, beginn.id, jetzt).await?
            }
        };
        let (wid, wirkung) = wirkung;
        Ok((wechsel_laden_tx(conn, einsatz_id, wid).await?, wirkung))
    })
}

#[allow(clippy::too_many_arguments)]
async fn uhs_tx_vollziehen(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    bid: i64,
    benutzer_id: i64,
    block: &BlockDaten,
    vollzogen_at: &str,
    kommen: &[PlanPerson],
    gehen: &[i64],
) -> Result<(i64, WechselWirkung), AppError> {
    let uhs_id = block
        .uhs_id
        .ok_or_else(|| AppError::Internal(format!("UHS-Block {bid} ohne UHS")))?;
    let (uhs, grund) = uhs_tx(conn, einsatz_id, uhs_id).await?;
    if let Some(grund) = grund {
        return Err(AppError::Conflict(grund.into()));
    }
    // Kommen darf nur, wer jetzt im Block steht (der Dialog kann veraltet sein).
    let im_block = block_personen_tx(conn, einsatz_id, bid).await?;
    if kommen
        .iter()
        .any(|p| !im_block.iter().any(|b| b.person == *p))
    {
        return Err(AppError::UnprocessableEntity(
            "Eine kommende Person steht nicht im Block".into(),
        ));
    }
    let org_id = org_tx(conn, einsatz_id).await?;
    let mut wirkung = WechselWirkung {
        uhs: vec![uhs_id],
        ..WechselWirkung::default()
    };

    // Die Gehenden stehen an dieser UHS (422 sonst).
    let mut gehende: Vec<(i64, String, Option<i64>)> = Vec::new();
    for ep in gehen {
        let zeile: Option<(String, Option<i64>, Option<i64>, bool)> = sqlx::query_as(
            "SELECT snap_name, uhs_id, einheit_id, beendet_at IS NULL FROM einsatz_personal \
             WHERE id = ? AND einsatz_id = ?",
        )
        .bind(ep)
        .bind(einsatz_id)
        .fetch_optional(&mut *conn)
        .await?;
        let (name, an, einheit, aktiv) = zeile.ok_or(AppError::NotFound)?;
        if !aktiv || an != Some(uhs_id) {
            return Err(AppError::UnprocessableEntity(format!(
                "«{name}» steht nicht an UHS «{uhs}»"
            )));
        }
        gehende.push((*ep, name, einheit));
    }

    // Die Kommenden: erst in den Einsatz, dann an die UHS.
    // (Einsatzkraft, Name, UHS vorher, Einheit, neu übernommen)
    type Kommend = (i64, String, Option<i64>, Option<i64>, bool);
    let mut kommende: Vec<Kommend> = Vec::new();
    for p in kommen {
        let (ep, neu) = match *p {
            PlanPerson::Stamm(pid) => {
                uebernehme_tx(
                    conn,
                    einsatz_id,
                    org_id,
                    benutzer_id,
                    UebernahmeQuelle::Stamm(pid),
                )
                .await?
            }
            PlanPerson::Helfer(hid) => {
                uebernehme_tx(
                    conn,
                    einsatz_id,
                    org_id,
                    benutzer_id,
                    UebernahmeQuelle::Helfer(hid),
                )
                .await?
            }
            PlanPerson::Einsatz(ep) => {
                disposition_repo::require_aktiv_tx(conn, einsatz_id, ep).await?;
                (ep, false)
            }
        };
        let (name, vorher, einheit): (String, Option<i64>, Option<i64>) = sqlx::query_as(
            "SELECT snap_name, uhs_id, einheit_id FROM einsatz_personal WHERE id = ?",
        )
        .bind(ep)
        .fetch_one(&mut *conn)
        .await?;
        if gehende.iter().any(|(g, _, _)| *g == ep) {
            return Err(AppError::UnprocessableEntity(format!(
                "«{name}» kann nicht zugleich kommen und gehen"
            )));
        }
        if vorher == Some(uhs_id) || kommende.iter().any(|(k, ..)| *k == ep) {
            continue;
        }
        kommende.push((ep, name, vorher, einheit, neu));
    }

    let wid = wechsel_einfuegen_tx(
        conn,
        einsatz_id,
        bid,
        WechselArt::Uhs,
        Some(uhs_id),
        &block.von,
        vollzogen_at,
        benutzer_id,
    )
    .await?;
    for (ep, _, einheit) in &gehende {
        crate::uhs::kraefte::setze_uhs_tx(conn, einsatz_id, *ep, None).await?;
        let z = match einheit {
            Some(_) => None,
            None => {
                besatzung_ereignis_tx(
                    conn,
                    einsatz_id,
                    benutzer_id,
                    *ep,
                    ZeitachseArt::Abloesung,
                    vollzogen_at,
                )
                .await?
            }
        };
        person_einfuegen_tx(conn, wid, *ep, "alt", Some(uhs_id), (None, None), z, false).await?;
        wirkung.personen.push(*ep);
    }
    for (ep, _, vorher, einheit, neu) in &kommende {
        crate::uhs::kraefte::setze_uhs_tx(conn, einsatz_id, *ep, Some(uhs_id)).await?;
        let z = match einheit {
            Some(_) => None,
            None => {
                besatzung_ereignis_tx(
                    conn,
                    einsatz_id,
                    benutzer_id,
                    *ep,
                    ZeitachseArt::Eintreffen,
                    vollzogen_at,
                )
                .await?
            }
        };
        person_einfuegen_tx(conn, wid, *ep, "neu", *vorher, (None, None), z, *neu).await?;
        wirkung.personen.push(*ep);
        wirkung.uhs.extend(*vorher);
    }

    let kommende_ids: Vec<i64> = kommende.iter().map(|(ep, ..)| *ep).collect();
    let bleibende: Vec<String> = sqlx::query_scalar(
        "SELECT snap_name FROM einsatz_personal \
         WHERE einsatz_id = ? AND uhs_id = ? AND beendet_at IS NULL \
           AND id NOT IN (SELECT value FROM json_each(?)) ORDER BY id",
    )
    .bind(einsatz_id)
    .bind(uhs_id)
    .bind(serde_json::to_string(&kommende_ids).unwrap_or_else(|_| "[]".into()))
    .fetch_all(&mut *conn)
    .await?;
    let text = etb_text_uhs(
        &uhs,
        gehende.iter().map(|(_, n, _)| n.as_str()),
        kommende.iter().map(|(_, n, ..)| n.as_str()),
        bleibende.iter().map(String::as_str),
        kommende
            .iter()
            .filter(|(.., neu)| *neu)
            .map(|(_, n, ..)| n.as_str()),
    );
    wirkung.etb_id = etb_tx(conn, einsatz_id, benutzer_id, wid, &text).await?;
    Ok((wid, wirkung))
}

/// „Wechsel UHS «Markt»: Geht «Anna». Kommt «Ben», «Cora». Bleibt «Dana».“ — leere Teile fehlen;
/// wer erst mit dem Wechsel in den Einsatz kam, steht am Ende.
pub fn etb_text_uhs<'a>(
    uhs: &str,
    gehen: impl Iterator<Item = &'a str>,
    kommen: impl Iterator<Item = &'a str>,
    bleiben: impl Iterator<Item = &'a str>,
    uebernommen: impl Iterator<Item = &'a str>,
) -> String {
    let mut teile: Vec<String> = Vec::new();
    for (wort, namen) in [
        ("Geht", gehen.collect::<Vec<_>>()),
        ("Kommt", kommen.collect()),
        ("Bleibt", bleiben.collect()),
        (
            "Aus dem Schichtplan in den Einsatz übernommen:",
            uebernommen.collect(),
        ),
    ] {
        if !namen.is_empty() {
            teile.push(format!("{wort} {}.", personen_text(namen.into_iter())));
        }
    }
    if teile.is_empty() {
        teile.push("Niemand an der UHS.".into());
    }
    format!("Wechsel UHS «{uhs}»: {}", teile.join(" "))
}

async fn pause_beginn_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    bid: i64,
    benutzer_id: i64,
    block: &BlockDaten,
    jetzt: &str,
) -> Result<(i64, WechselWirkung), AppError> {
    let org_id = org_tx(conn, einsatz_id).await?;
    let (pause_id, pause) = status_repo::pause_status_tx(conn, org_id)
        .await?
        .ok_or_else(|| AppError::UnprocessableEntity(KEIN_PAUSENSTATUS.into()))?;
    let personen = block_personen_tx(conn, einsatz_id, bid).await?;
    let wid = wechsel_einfuegen_tx(
        conn,
        einsatz_id,
        bid,
        WechselArt::PauseBeginn,
        None,
        &block.von,
        jetzt,
        benutzer_id,
    )
    .await?;
    let mut wirkung = WechselWirkung::default();
    let mut gesetzt: Vec<&str> = Vec::new();
    let mut nicht_da: Vec<&str> = Vec::new();
    for p in &personen {
        let Some(ep) = p.kraft else {
            nicht_da.push(&p.name);
            continue;
        };
        if p.status_id == Some(pause_id) || wirkung.personen.contains(&ep) {
            continue;
        }
        status_setzen_tx(conn, einsatz_id, benutzer_id, ep, Some(pause_id), jetzt).await?;
        person_einfuegen_tx(
            conn,
            wid,
            ep,
            "neu",
            None,
            (p.status_id, Some(pause_id)),
            None,
            false,
        )
        .await?;
        wirkung.personen.push(ep);
        gesetzt.push(&p.name);
    }
    let stil = zeitstil_laden(&mut *conn, einsatz_id).await?;
    let mut text = format!(
        "Pause laut Plan ab {}: {} auf «{pause}».",
        stil.zeitpunkt_text(&block.von),
        personen_text(gesetzt.into_iter())
    );
    if !nicht_da.is_empty() {
        text.push_str(&format!(
            " Nicht im Einsatz: {}.",
            personen_text(nicht_da.into_iter())
        ));
    }
    wirkung.etb_id = etb_tx(conn, einsatz_id, benutzer_id, wid, &text).await?;
    Ok((wid, wirkung))
}

#[allow(clippy::too_many_arguments)]
async fn pause_ende_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    bid: i64,
    benutzer_id: i64,
    block: &BlockDaten,
    beginn: i64,
    jetzt: &str,
) -> Result<(i64, WechselWirkung), AppError> {
    let wid = wechsel_einfuegen_tx(
        conn,
        einsatz_id,
        bid,
        WechselArt::PauseEnde,
        None,
        &block.bis,
        jetzt,
        benutzer_id,
    )
    .await?;
    let mut wirkung = WechselWirkung::default();
    let mut zurueck: Vec<String> = Vec::new();
    for (ep, name, vorher, nachher) in status_personen_tx(conn, beginn).await? {
        let (status, aktiv) = kraft_status_tx(conn, ep).await?;
        if !aktiv || status != nachher {
            continue;
        }
        status_setzen_tx(conn, einsatz_id, benutzer_id, ep, vorher, jetzt).await?;
        person_einfuegen_tx(conn, wid, ep, "neu", None, (status, vorher), None, false).await?;
        wirkung.personen.push(ep);
        let label = status_label_tx(conn, vorher).await?;
        zurueck.push(format!("«{name}» wieder «{label}»"));
    }
    let stil = zeitstil_laden(&mut *conn, einsatz_id).await?;
    let text = format!(
        "Pause laut Plan bis {} beendet: {}.",
        stil.zeitpunkt_text(&block.bis),
        if zurueck.is_empty() {
            "keine".to_string()
        } else {
            zurueck.join(", ")
        }
    );
    wirkung.etb_id = etb_tx(conn, einsatz_id, benutzer_id, wid, &text).await?;
    Ok((wid, wirkung))
}

/// Nimmt einen Wechsel zurück (409, wenn er schon zurückgenommen ist; den Beginn einer Pause erst
/// nach ihrem Ende).
pub async fn zuruecknehmen(
    pool: &SqlitePool,
    einsatz_id: i64,
    wid: i64,
    benutzer_id: i64,
    jetzt: &str,
) -> Result<(PlanWechselAnzeige, WechselWirkung), AppError> {
    write_retry!(pool, |conn| {
        let w = wechsel_laden_tx(conn, einsatz_id, wid).await?;
        if w.zurueckgenommen_at.is_some() {
            return Err(AppError::Conflict(
                "Der Wechsel ist schon zurückgenommen".into(),
            ));
        }
        if matches!(w.art, WechselArt::PauseBeginn | WechselArt::PauseEnde) {
            // Ohne den Pausenblock gäbe es kein Ende mehr, das die Rücknahme wieder aufhebt.
            let posten: Option<String> = match w.planschicht_id {
                Some(bid) => {
                    sqlx::query_scalar("SELECT posten_art FROM einsatz_planschicht WHERE id = ?")
                        .bind(bid)
                        .fetch_optional(&mut *conn)
                        .await?
                }
                None => None,
            };
            if posten.as_deref().and_then(PostenArt::parse) != Some(PostenArt::Pause) {
                return Err(AppError::Conflict(PAUSENBLOCK_FEHLT.into()));
            }
        }
        if w.art == WechselArt::PauseBeginn {
            let ende: Option<i64> = sqlx::query_scalar(
                "SELECT id FROM einsatz_plan_wechsel WHERE planschicht_id = ? \
                   AND art = 'pause_ende' AND zurueckgenommen_at IS NULL",
            )
            .bind(w.planschicht_id)
            .fetch_optional(&mut *conn)
            .await?;
            if ende.is_some() {
                return Err(AppError::Conflict(
                    "Erst das Ende der Pause zurücknehmen".into(),
                ));
            }
        }
        sqlx::query(
            "UPDATE einsatz_plan_wechsel SET zurueckgenommen_at = ?, zurueckgenommen_von = ? \
             WHERE id = ?",
        )
        .bind(jetzt)
        .bind(benutzer_id)
        .bind(wid)
        .execute(&mut *conn)
        .await?;
        let stil = zeitstil_laden(&mut *conn, einsatz_id).await?;
        let wann = stil.zeitpunkt_text(&w.zeitpunkt);
        let mut wirkung = WechselWirkung::default();
        let text = match w.art {
            WechselArt::Uhs => {
                let uhs_id = w
                    .uhs_id
                    .ok_or_else(|| AppError::Conflict("Die UHS besteht nicht mehr".into()))?;
                let (uhs, grund) = uhs_tx(conn, einsatz_id, uhs_id).await?;
                if let Some(grund) = grund {
                    return Err(AppError::Conflict(grund.into()));
                }
                let uebernommen =
                    uhs_zuruecknehmen_tx(conn, einsatz_id, wid, uhs_id, benutzer_id, &mut wirkung)
                        .await?;
                let mut text = format!("Wechsel UHS «{uhs}» ({wann}) zurückgenommen.");
                if !uebernommen.is_empty() {
                    text.push_str(&format!(
                        " Im Einsatz bleiben, ohne UHS: {}.",
                        personen_text(uebernommen.iter().map(String::as_str))
                    ));
                }
                text
            }
            WechselArt::PauseBeginn | WechselArt::PauseEnde => {
                let mut namen: Vec<String> = Vec::new();
                for (ep, name, vorher, nachher) in status_personen_tx(conn, wid).await? {
                    let (status, aktiv) = kraft_status_tx(conn, ep).await?;
                    if !aktiv || status != nachher {
                        continue;
                    }
                    status_setzen_tx(conn, einsatz_id, benutzer_id, ep, vorher, jetzt).await?;
                    wirkung.personen.push(ep);
                    let label = status_label_tx(conn, vorher).await?;
                    namen.push(format!("«{name}» wieder «{label}»"));
                }
                let was = if w.art == WechselArt::PauseBeginn {
                    format!("Beginn der Pause laut Plan ({wann})")
                } else {
                    format!("Ende der Pause laut Plan ({wann})")
                };
                if namen.is_empty() {
                    format!("{was} zurückgenommen.")
                } else {
                    format!("{was} zurückgenommen: {}.", namen.join(", "))
                }
            }
        };
        wirkung.etb_id = {
            let startwert = etb_startwert(&mut *conn, einsatz_id).await?;
            crate::etb::system_audit_tx(conn, einsatz_id, benutzer_id, startwert, &text).await?
        };
        Ok((wechsel_laden_tx(conn, einsatz_id, wid).await?, wirkung))
    })
}

/// Legt die UHS-Zuordnung zurück, soweit sie noch den Stand des Wechsels trägt, und streicht die
/// Ereignisse des Wechsels. Liefert, wer mit ihm erst in den Einsatz kam.
async fn uhs_zuruecknehmen_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    wid: i64,
    uhs_id: i64,
    benutzer_id: i64,
    wirkung: &mut WechselWirkung,
) -> Result<Vec<String>, AppError> {
    use crate::zeitachse::repo::{streiche_tx, Kraft};
    // Das Eintreffen eines Kommenden nur, solange er noch hier steht: ist er weitergewechselt,
    // trägt der spätere Wechsel seine Periode (er legt kein zweites Eintreffen an).
    let ereignisse: Vec<(i64, i64, String)> = sqlx::query_as(
        "SELECT w.einsatz_personal_id, z.id, p.snap_name FROM einsatz_plan_wechsel_person w \
         JOIN einsatz_kraft_zeitachse z ON z.id = w.zeitachse_id AND z.gestrichen_at IS NULL \
         JOIN einsatz_personal p ON p.id = w.einsatz_personal_id \
         WHERE w.wechsel_id = ?1 AND (w.rolle <> 'neu' OR p.uhs_id = ?2) ORDER BY w.rowid",
    )
    .bind(wid)
    .bind(uhs_id)
    .fetch_all(&mut *conn)
    .await?;
    for (person, ereignis, name) in ereignisse {
        streiche_tx(
            conn,
            einsatz_id,
            benutzer_id,
            Kraft::Person(person),
            ereignis,
            GRUND_WECHSEL_ZURUECK,
            true,
        )
        .await
        .map_err(|e| match e {
            AppError::UnprocessableEntity(m) => AppError::UnprocessableEntity(format!(
                "Die Zeitachse von «{name}» verlöre ihre Ordnung: {m}"
            )),
            e => e,
        })?;
    }
    // Die Kommenden zurück, solange sie noch an dieser UHS stehen: an die UHS davor, solange die
    // offen ist, sonst an keine.
    let neu: Vec<(i64, Option<i64>)> = sqlx::query_as(
        "UPDATE einsatz_personal SET uhs_id = \
            (SELECT u.id FROM einsatz_plan_wechsel_person w \
             JOIN uhs u ON u.id = w.uhs_vorher_id AND u.storniert_at IS NULL \
                       AND u.status <> 'aufgeloest' \
             WHERE w.wechsel_id = ?1 AND w.einsatz_personal_id = einsatz_personal.id) \
         WHERE uhs_id = ?2 AND beendet_at IS NULL \
           AND id IN (SELECT einsatz_personal_id FROM einsatz_plan_wechsel_person \
                      WHERE wechsel_id = ?1 AND rolle = 'neu') \
         RETURNING id, uhs_id",
    )
    .bind(wid)
    .bind(uhs_id)
    .fetch_all(&mut *conn)
    .await?;
    // Die Gehenden zurück, solange sie an keiner UHS stehen und noch im Einsatz sind.
    let alt: Vec<i64> = sqlx::query_scalar(
        "UPDATE einsatz_personal SET uhs_id = ?2 \
         WHERE uhs_id IS NULL AND beendet_at IS NULL \
           AND id IN (SELECT einsatz_personal_id FROM einsatz_plan_wechsel_person \
                      WHERE wechsel_id = ?1 AND rolle = 'alt') \
         RETURNING id",
    )
    .bind(wid)
    .bind(uhs_id)
    .fetch_all(&mut *conn)
    .await?;
    wirkung.uhs.push(uhs_id);
    for (ep, vorher) in &neu {
        wirkung.personen.push(*ep);
        wirkung.uhs.extend(*vorher);
    }
    wirkung.personen.extend(alt);
    Ok(sqlx::query_scalar(
        "SELECT p.snap_name FROM einsatz_plan_wechsel_person w \
         JOIN einsatz_personal p ON p.id = w.einsatz_personal_id \
         WHERE w.wechsel_id = ? AND w.rolle = 'neu' AND w.uebernommen = 1 ORDER BY w.rowid",
    )
    .bind(wid)
    .fetch_all(&mut *conn)
    .await?)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn etb_uhs_nennt_nur_was_geschieht() {
        assert_eq!(
            etb_text_uhs(
                "Markt",
                ["Anna"].into_iter(),
                ["Ben"].into_iter(),
                ["Dana"].into_iter(),
                std::iter::empty(),
            ),
            "Wechsel UHS «Markt»: Geht «Anna». Kommt «Ben». Bleibt «Dana»."
        );
        assert_eq!(
            etb_text_uhs(
                "Markt",
                std::iter::empty(),
                ["Ben", "Cora"].into_iter(),
                std::iter::empty(),
                ["Cora"].into_iter(),
            ),
            "Wechsel UHS «Markt»: Kommt «Ben», «Cora». \
             Aus dem Schichtplan in den Einsatz übernommen: «Cora»."
        );
        assert_eq!(
            etb_text_uhs(
                "Markt",
                std::iter::empty(),
                std::iter::empty(),
                std::iter::empty(),
                std::iter::empty(),
            ),
            "Wechsel UHS «Markt»: Niemand an der UHS."
        );
    }
}
