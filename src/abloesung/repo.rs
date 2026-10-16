//! Persistenz der Ablösung (LFH-635).
//!
//! **Alles, was eine Ablösung verändert, läuft in EINER `write_retry!`-Transaktion**: Schicht,
//! Auto-Fristen des Erinnerungs-Schedulers, Folgeschicht und ETB-Eintrag. Ein 422 mitten im
//! Ablauf lässt deshalb nichts zurück (Spec: „Vollzug mit Folgeschicht", Atomarität).
//!
//! Die Fristen hängen polymorph an der Schicht (`bezug_typ` `abloesung` /
//! `abloesung_vorwarnung`, `bezug_id` = Schicht-ID) — ohne FK, wie alle Auto-Fristen.

use chrono_tz::Tz;
use sqlx::{SqliteConnection, SqlitePool};

use super::{
    einstufung, faelligkeit, rhythmus_text, vorwarnzeit, AbloesungAnzeige,
    AbloesungEinsatzVorgabeAnzeige, AbloesungStatus, AbloesungVollzugAnzeige,
    AbloesungVorgabeAnzeige, RhythmusQuelle, VORWARNUNG_VORGABE_MINUTEN,
};
use crate::einsatz::einstellungen::etb_startwert;
use crate::erinnerung::repo as erinnerung_repo;
use crate::error::AppError;
use crate::etb::repo::EintragDaten;
use crate::etb::{TYP_BERICHTIGUNG, TYP_ENTSCHEIDUNG, TYP_MELDUNG};
use crate::kommunikation::{OBJEKT_ABLOESUNG, OBJEKT_ABLOESUNG_VORWARNUNG};
use crate::schichtmodell::repo as schichtmodell_repo;
use crate::schichtmodell::{Regel, Werte};
use crate::write_retry;
use crate::zeitachse::repo::Beruehrt;

/// Was Vollzug oder Rücknahme an der Zeitachse geändert haben: die abgelöste Einheit samt den
/// per Fan-out berührten Personen, `None` ohne Änderung. Die Route meldet danach `einheit` und
/// `personal` (LLH-1189).
pub type Zeitachsenwirkung = Option<(i64, Beruehrt)>;

/// Eingabe „Schicht beginnen" — von der Route validiert (Zeit normalisiert, Rhythmus im
/// Wertebereich).
#[derive(Debug, Clone)]
pub struct BeginnEingabe {
    pub einheit_id: i64,
    /// `None` = das Eintreffen der offenen Einsatzperiode der Einheit (Kräfte-Zeitachse,
    /// LFH-552), ohne ein solches der Zeitpunkt der Anlage.
    pub beginn_at: Option<String>,
    /// `None` = Vorgabe übernehmen: die des Abschnitts, sonst die des Einsatzes.
    pub rhythmus_minuten: Option<i64>,
}

/// Eingabe „Schicht ändern" — jedes Feld tri-state: fehlt = unverändert.
#[derive(Debug, Clone, Default)]
pub struct AenderungEingabe {
    pub beginn_at: Option<String>,
    /// `Some(None)` = zurück zur Vorgabe: der des Abschnitts, sonst der des Einsatzes.
    pub rhythmus_minuten: Option<Option<i64>>,
    /// `Some(None)` = Planung aufheben.
    pub abloesende_einheit_id: Option<Option<i64>>,
}

/// Eine Zeile, wie sie die Anzeige-Projektion liefert.
#[derive(sqlx::FromRow)]
struct Zeile {
    id: i64,
    einsatz_id: i64,
    einheit_id: i64,
    einheit_name: String,
    abschnitt_id: Option<i64>,
    abschnitt_name: Option<String>,
    beginn_at: String,
    rhythmus_minuten: i64,
    #[sqlx(try_from = "String")]
    rhythmus_quelle: RhythmusQuelle,
    faellig_at: String,
    vorwarnung_minuten: i64,
    abloesende_einheit_id: Option<i64>,
    abloesende_einheit_name: Option<String>,
    #[sqlx(try_from = "String")]
    status: AbloesungStatus,
    vollzogen_at: Option<String>,
    vollzogen_von_id: Option<i64>,
    vorgaenger_id: Option<i64>,
    folgeschicht_id: Option<i64>,
    folgeschicht_laufend: Option<i64>,
    einheit_laeuft_anderswo: i64,
    angelegt_at: String,
}

impl Zeile {
    fn anzeige(self, jetzt: &str) -> AbloesungAnzeige {
        let einstufung = match self.status {
            AbloesungStatus::Laufend => {
                Some(einstufung(&self.faellig_at, jetzt, self.vorwarnung_minuten))
            }
            AbloesungStatus::Abgeloest => None,
        };
        let folge_unberuehrt = match self.folgeschicht_id {
            None => true,
            Some(_) => self.folgeschicht_laufend == Some(1),
        };
        let ruecknehmbar = self.status == AbloesungStatus::Abgeloest
            && folge_unberuehrt
            && self.einheit_laeuft_anderswo == 0;
        AbloesungAnzeige {
            id: self.id,
            einsatz_id: self.einsatz_id,
            einheit_id: self.einheit_id,
            einheit_name: self.einheit_name,
            abschnitt_id: self.abschnitt_id,
            abschnitt_name: self.abschnitt_name,
            beginn_at: self.beginn_at,
            rhythmus_minuten: self.rhythmus_minuten,
            rhythmus_quelle: self.rhythmus_quelle,
            faellig_at: self.faellig_at,
            vorwarnung_minuten: self.vorwarnung_minuten,
            abloesende_einheit_id: self.abloesende_einheit_id,
            abloesende_einheit_name: self.abloesende_einheit_name,
            status: self.status,
            einstufung,
            vollzogen_at: self.vollzogen_at,
            vollzogen_von_id: self.vollzogen_von_id,
            vorgaenger_id: self.vorgaenger_id,
            folgeschicht_id: self.folgeschicht_id,
            ruecknehmbar,
            angelegt_at: self.angelegt_at,
        }
    }
}

/// Anzeige-Projektion. Die Folgeschicht ist die jüngste Schicht mit `vorgaenger_id` = diese:
/// EIN Zugriff je Zeile (`MAX(id)` über `idx_abloesung_vorgaenger`, Migration 0153), dann der
/// Join über den Primärschlüssel. Ohne den Index war jede der früheren zwei Unterabfragen ein
/// Scan über die Ablösungen aller Einsätze (LFH-933); `liste_plan_ohne_scan` hält das fest.
/// Die Vorwarnung kommt aus der Kopie des Schichtmodells am Einsatz (LLH-1122), ohne sie 30 min
/// ([`VORWARNUNG_VORGABE_MINUTEN`], im SQL als Literal; `vorwarnung_vorgabe_im_sql` hält beide
/// gleich).
const ANZEIGE_SELECT: &str = "SELECT a.id, a.einsatz_id, a.einheit_id, e.name AS einheit_name, \
            a.abschnitt_id, s.name AS abschnitt_name, a.beginn_at, a.rhythmus_minuten, \
            a.rhythmus_quelle, a.faellig_at, \
            COALESCE(m.vorwarnung_minuten, 30) AS vorwarnung_minuten, a.abloesende_einheit_id, \
            ae.name AS abloesende_einheit_name, a.status, a.vollzogen_at, a.vollzogen_von_id, \
            a.vorgaenger_id, \
            f.id AS folgeschicht_id, \
            f.status = 'laufend' AS folgeschicht_laufend, \
            EXISTS (SELECT 1 FROM einsatz_abloesung o WHERE o.einheit_id = a.einheit_id \
               AND o.status = 'laufend' AND o.id <> a.id) AS einheit_laeuft_anderswo, \
            a.angelegt_at \
     FROM einsatz_abloesung a \
     JOIN einsatz_einheit e ON e.id = a.einheit_id \
     LEFT JOIN einsatzabschnitt s ON s.id = a.abschnitt_id \
     LEFT JOIN einsatz_einheit ae ON ae.id = a.abloesende_einheit_id \
     LEFT JOIN einsatz_schichtmodell m ON m.einsatz_id = a.einsatz_id \
     LEFT JOIN einsatz_abloesung f ON f.id = \
               (SELECT MAX(fv.id) FROM einsatz_abloesung fv WHERE fv.vorgaenger_id = a.id)";

/// Laufende nach Fälligkeit (die dringendste zuerst), abgelöste nach Vollzug absteigend.
pub async fn liste(
    pool: &SqlitePool,
    einsatz_id: i64,
    status: Option<AbloesungStatus>,
    jetzt: &str,
) -> Result<Vec<AbloesungAnzeige>, AppError> {
    let zeilen = sqlx::query_as::<_, Zeile>(sqlx::AssertSqlSafe(liste_sql(status)))
        .bind(einsatz_id)
        .fetch_all(pool)
        .await?;
    Ok(zeilen.into_iter().map(|z| z.anzeige(jetzt)).collect())
}

/// SQL der Liste je Statusfilter; ein Platzhalter (`einsatz_id`).
fn liste_sql(status: Option<AbloesungStatus>) -> String {
    match status {
        Some(AbloesungStatus::Laufend) => format!(
            "{ANZEIGE_SELECT} WHERE a.einsatz_id = ? AND a.status = 'laufend' \
             ORDER BY a.faellig_at, a.id"
        ),
        Some(AbloesungStatus::Abgeloest) => format!(
            "{ANZEIGE_SELECT} WHERE a.einsatz_id = ? AND a.status = 'abgeloest' \
             ORDER BY a.vollzogen_at DESC, a.id DESC"
        ),
        None => format!(
            "{ANZEIGE_SELECT} WHERE a.einsatz_id = ? \
             ORDER BY a.status = 'abgeloest', a.faellig_at, a.id"
        ),
    }
}

/// Lädt eine Schicht. `NotFound`, wenn sie nicht zum Einsatz gehört.
pub async fn laden(
    pool: &SqlitePool,
    einsatz_id: i64,
    id: i64,
    jetzt: &str,
) -> Result<AbloesungAnzeige, AppError> {
    sqlx::query_as::<_, Zeile>(sqlx::AssertSqlSafe(format!(
        "{ANZEIGE_SELECT} WHERE a.einsatz_id = ? AND a.id = ?"
    )))
    .bind(einsatz_id)
    .bind(id)
    .fetch_optional(pool)
    .await?
    .map(|z| z.anzeige(jetzt))
    .ok_or(AppError::NotFound)
}

/// Rhythmus-Vorgaben aller Abschnitte eines Einsatzes, in Abschnitts-Reihenfolge.
pub async fn vorgaben(
    pool: &SqlitePool,
    einsatz_id: i64,
) -> Result<Vec<AbloesungVorgabeAnzeige>, AppError> {
    let zeilen: Vec<(i64, String, Option<i64>, i64)> = sqlx::query_as(
        "SELECT s.id, s.name, s.abloesung_rhythmus_minuten, \
                (SELECT COUNT(*) FROM einsatz_abloesung a \
                 WHERE a.abschnitt_id = s.id AND a.status = 'laufend') \
         FROM einsatzabschnitt s WHERE s.einsatz_id = ? ORDER BY s.sortier, s.id",
    )
    .bind(einsatz_id)
    .fetch_all(pool)
    .await?;
    Ok(zeilen
        .into_iter()
        .map(
            |(abschnitt_id, abschnitt_name, rhythmus_minuten, laufende_schichten)| {
                AbloesungVorgabeAnzeige {
                    abschnitt_id,
                    abschnitt_name,
                    rhythmus_minuten,
                    laufende_schichten,
                }
            },
        )
        .collect())
}

// ── Hilfen innerhalb der Transaktion ────────────────────────────────────────────────────────

/// Name und Abschnitt einer aktiven Einheit des Einsatzes. `NotFound`, wenn sie nicht
/// dazugehört, `Conflict`, wenn sie aufgelöst ist: eine aufgelöste Einheit bekommt keine
/// Schicht und löst niemanden ab (LLH-1079, Spec `kraefte-entlassung`).
async fn einheit_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    einheit_id: i64,
) -> Result<(String, Option<i64>), AppError> {
    crate::einheit::repo::require_aktiv_tx(conn, einsatz_id, einheit_id).await?;
    sqlx::query_as("SELECT name, abschnitt_id FROM einsatz_einheit WHERE id = ? AND einsatz_id = ?")
        .bind(einheit_id)
        .bind(einsatz_id)
        .fetch_optional(&mut *conn)
        .await?
        .ok_or(AppError::NotFound)
}

/// Name und Vorgabe eines Abschnitts.
async fn abschnitt_tx(
    conn: &mut SqliteConnection,
    abschnitt_id: i64,
) -> Result<Option<(String, Option<i64>)>, AppError> {
    Ok(
        sqlx::query_as(
            "SELECT name, abloesung_rhythmus_minuten FROM einsatzabschnitt WHERE id = ?",
        )
        .bind(abschnitt_id)
        .fetch_optional(&mut *conn)
        .await?,
    )
}

async fn has_laufende_tx(conn: &mut SqliteConnection, einheit_id: i64) -> Result<bool, AppError> {
    let r: Option<i64> = sqlx::query_scalar(
        "SELECT 1 FROM einsatz_abloesung WHERE einheit_id = ? AND status = 'laufend'",
    )
    .bind(einheit_id)
    .fetch_optional(&mut *conn)
    .await?;
    Ok(r.is_some())
}

/// Rohdaten einer Schicht für die Schreibpfade.
#[derive(sqlx::FromRow)]
struct Roh {
    einheit_id: i64,
    abschnitt_id: Option<i64>,
    beginn_at: String,
    rhythmus_minuten: i64,
    #[sqlx(try_from = "String")]
    rhythmus_quelle: RhythmusQuelle,
    faellig_at: String,
    abloesende_einheit_id: Option<i64>,
    #[sqlx(try_from = "String")]
    status: AbloesungStatus,
    vollzogen_at: Option<String>,
    etb_vollzug_id: Option<i64>,
}

async fn roh_tx(conn: &mut SqliteConnection, einsatz_id: i64, id: i64) -> Result<Roh, AppError> {
    sqlx::query_as(
        "SELECT einheit_id, abschnitt_id, beginn_at, rhythmus_minuten, rhythmus_quelle, \
                faellig_at, abloesende_einheit_id, status, vollzogen_at, etb_vollzug_id \
         FROM einsatz_abloesung WHERE id = ? AND einsatz_id = ?",
    )
    .bind(id)
    .bind(einsatz_id)
    .fetch_optional(&mut *conn)
    .await?
    .ok_or(AppError::NotFound)
}

fn faellig_oder_400(beginn_at: &str, rhythmus: i64) -> Result<String, AppError> {
    faelligkeit(beginn_at, rhythmus)
        .ok_or_else(|| AppError::Validation(format!("Ungültiger Zeitpunkt '{beginn_at}'")))
}

/// Was eine Schicht vom Einsatz liest (LLH-1122): die Kopie des Schichtmodells und die
/// wirksame Zone (Einsatz → Org → Europe/Berlin), in der Wechselzeiten gelten.
pub(crate) struct EinsatzVorgabe {
    pub werte: Option<Werte>,
    pub zone: Tz,
}

impl EinsatzVorgabe {
    /// Vorwarnzeit aller Schichten des Einsatzes.
    pub fn vorwarnung(&self) -> i64 {
        self.werte
            .as_ref()
            .map_or(VORWARNUNG_VORGABE_MINUTEN, |w| w.vorwarnung_minuten)
    }
}

/// Die wirksame Zone eines Einsatzes: seine Einstellung, sonst die der Organisation, sonst
/// Europe/Berlin (`einsatz::nummer::zone_oder_vorgabe`, auch für einen unbekannten Namen).
async fn zone_tx(conn: &mut SqliteConnection, einsatz_id: i64) -> Result<Tz, AppError> {
    let name: Option<Option<String>> = sqlx::query_scalar(
        "SELECT COALESCE(NULLIF(TRIM(ee.zeitzone), ''), NULLIF(TRIM(oe.zeitzone), '')) \
         FROM einsatz e \
         LEFT JOIN einsatz_einstellungen ee ON ee.einsatz_id = e.id \
         LEFT JOIN org_einstellungen oe ON oe.org_id = e.org_id WHERE e.id = ?",
    )
    .bind(einsatz_id)
    .fetch_optional(&mut *conn)
    .await?;
    Ok(crate::einsatz::nummer::zone_oder_vorgabe(
        name.flatten().as_deref(),
    ))
}

pub(crate) async fn load_einsatz_vorgabe_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
) -> Result<EinsatzVorgabe, AppError> {
    Ok(EinsatzVorgabe {
        werte: schichtmodell_repo::load_einsatz_tx(conn, einsatz_id)
            .await?
            .map(|(w, _)| w),
        zone: zone_tx(conn, einsatz_id).await?,
    })
}

/// Fälligkeit und Rhythmus einer Schicht. Folgt sie der Vorgabe des Einsatzes und gibt es eine,
/// rechnet deren Regel (bei Wechselzeiten wird der Rhythmus die Dauer bis zum Wechsel); sonst
/// Beginn + Rhythmus. Eine entfernte Einsatzvorgabe lässt den zuletzt gültigen Rhythmus stehen.
fn compute_faellig(
    beginn_at: &str,
    rhythmus: i64,
    quelle: RhythmusQuelle,
    vorgabe: &EinsatzVorgabe,
) -> Result<(String, i64), AppError> {
    match (quelle, &vorgabe.werte) {
        (RhythmusQuelle::Einsatz, Some(w)) => w
            .regel
            .faelligkeit(beginn_at, vorgabe.zone)
            .ok_or_else(|| AppError::Validation(format!("Ungültiger Zeitpunkt '{beginn_at}'"))),
        _ => Ok((faellig_oder_400(beginn_at, rhythmus)?, rhythmus)),
    }
}

/// Wie der Rhythmus einer Schicht im ETB heißt: bei Wechselzeiten aus der Einsatzvorgabe deren
/// Regel („Wechsel 06:00/18:00, Mindestdauer 4 h“), sonst die Dauer („6 h“).
fn rhythmus_label(rhythmus: i64, quelle: RhythmusQuelle, vorgabe: &EinsatzVorgabe) -> String {
    match (quelle, &vorgabe.werte) {
        (RhythmusQuelle::Einsatz, Some(w)) if matches!(w.regel, Regel::Wechselzeiten { .. }) => {
            w.regel.text()
        }
        _ => rhythmus_text(rhythmus),
    }
}

/// Setzt die beiden Auto-Fristen einer laufenden Schicht auf ihre Fälligkeit; die Vorwarnung
/// liegt `vorwarnung_minuten` davor (Schichtmodell des Einsatzes). Liegt die Vorwarnzeit schon
/// hinter `jetzt`, wird eine offene Vorwarnung geschlossen statt verschoben — eine Vorwarnung in
/// der Vergangenheit ist keine mehr.
#[allow(clippy::too_many_arguments)]
async fn set_fristen_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    benutzer_id: i64,
    id: i64,
    einheit_name: &str,
    faellig_at: &str,
    vorwarnung_minuten: i64,
    jetzt: &str,
) -> Result<(), AppError> {
    erinnerung_repo::setze_auto_frist_tx(
        conn,
        einsatz_id,
        benutzer_id,
        OBJEKT_ABLOESUNG,
        id,
        &format!("Ablösung fällig: {einheit_name}"),
        faellig_at,
    )
    .await?;
    set_vorwarn_frist_tx(
        conn,
        einsatz_id,
        benutzer_id,
        id,
        einheit_name,
        faellig_at,
        vorwarnung_minuten,
        jetzt,
    )
    .await
}

/// Setzt nur die Vorwarn-Frist einer laufenden Schicht (Regeln wie [`set_fristen_tx`]). Für eine
/// reine Änderung der Vorwarnzeit: die Fälligkeitsfrist bleibt unberührt, sonst leerte
/// `setze_auto_frist_tx` ihr `zuletzt_ausgeloest_at`, und eine überfällige Schicht meldete
/// „fällig“ ein zweites Mal (Spec „Einmaliges Auslösen“, Review PR #833).
#[allow(clippy::too_many_arguments)]
async fn set_vorwarn_frist_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    benutzer_id: i64,
    id: i64,
    einheit_name: &str,
    faellig_at: &str,
    vorwarnung_minuten: i64,
    jetzt: &str,
) -> Result<(), AppError> {
    match vorwarnzeit(faellig_at, vorwarnung_minuten) {
        Some(v) if v.as_str() > jetzt => {
            erinnerung_repo::setze_auto_frist_tx(
                conn,
                einsatz_id,
                benutzer_id,
                OBJEKT_ABLOESUNG_VORWARNUNG,
                id,
                &format!(
                    "Ablösung in {}: {einheit_name}",
                    rhythmus_text(vorwarnung_minuten)
                ),
                &v,
            )
            .await?;
        }
        _ => {
            erinnerung_repo::schliesse_offene_auto_tx(conn, OBJEKT_ABLOESUNG_VORWARNUNG, id, jetzt)
                .await?;
        }
    }
    Ok(())
}

async fn close_fristen_tx(
    conn: &mut SqliteConnection,
    id: i64,
    jetzt: &str,
) -> Result<(), AppError> {
    erinnerung_repo::schliesse_offene_auto_tx(conn, OBJEKT_ABLOESUNG, id, jetzt).await?;
    erinnerung_repo::schliesse_offene_auto_tx(conn, OBJEKT_ABLOESUNG_VORWARNUNG, id, jetzt).await
}

async fn delete_fristen_tx(conn: &mut SqliteConnection, id: i64) -> Result<(), AppError> {
    erinnerung_repo::loesche_auto_tx(conn, OBJEKT_ABLOESUNG, id).await?;
    erinnerung_repo::loesche_auto_tx(conn, OBJEKT_ABLOESUNG_VORWARNUNG, id).await
}

/// Auflösen einer Einheit (LLH-1079, Spec `kraefte-abloesung` „Auflösen behält abgelöste
/// Schichten“): ihre laufende Schicht geht samt Fristen (Planung, kein Vollzug), abgelöste
/// bleiben mit ihrem Vollzug. Verweist eine Schicht einer anderen Einheit auf sie als ablösende,
/// wird der Verweis geleert. Liefert, ob sich die Ablösung geändert hat.
pub async fn release_einheit_tx(
    conn: &mut SqliteConnection,
    einheit_id: i64,
) -> Result<bool, AppError> {
    let laufend: Vec<i64> = sqlx::query_scalar(
        "SELECT id FROM einsatz_abloesung WHERE einheit_id = ? AND status = 'laufend'",
    )
    .bind(einheit_id)
    .fetch_all(&mut *conn)
    .await?;
    for id in &laufend {
        delete_fristen_tx(conn, *id).await?;
        sqlx::query("DELETE FROM einsatz_abloesung WHERE id = ?")
            .bind(id)
            .execute(&mut *conn)
            .await?;
    }
    let geleert = sqlx::query(
        "UPDATE einsatz_abloesung SET abloesende_einheit_id = NULL WHERE abloesende_einheit_id = ?",
    )
    .bind(einheit_id)
    .execute(&mut *conn)
    .await?
    .rows_affected();
    Ok(!laufend.is_empty() || geleert > 0)
}

/// Legt eine laufende Schicht an und setzt ihre Fristen. Rhythmus und Fälligkeit rechnet
/// [`compute_faellig`] aus der Quelle. Liefert die neue ID und den Rhythmus.
#[allow(clippy::too_many_arguments)]
async fn create_schicht_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    benutzer_id: i64,
    einheit_id: i64,
    einheit_name: &str,
    abschnitt_id: Option<i64>,
    beginn_at: &str,
    rhythmus: i64,
    quelle: RhythmusQuelle,
    vorgabe: &EinsatzVorgabe,
    vorgaenger_id: Option<i64>,
    jetzt: &str,
) -> Result<(i64, i64), AppError> {
    if has_laufende_tx(conn, einheit_id).await? {
        return Err(AppError::UnprocessableEntity(format!(
            "Einheit «{einheit_name}» hat bereits eine laufende Schicht"
        )));
    }
    let (faellig_at, rhythmus) = compute_faellig(beginn_at, rhythmus, quelle, vorgabe)?;
    let id: i64 = sqlx::query_scalar(
        "INSERT INTO einsatz_abloesung \
            (einsatz_id, einheit_id, abschnitt_id, beginn_at, rhythmus_minuten, rhythmus_quelle, \
             faellig_at, vorgaenger_id, angelegt_von_id) \
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id",
    )
    .bind(einsatz_id)
    .bind(einheit_id)
    .bind(abschnitt_id)
    .bind(beginn_at)
    .bind(rhythmus)
    .bind(quelle.as_str())
    .bind(&faellig_at)
    .bind(vorgaenger_id)
    .bind(benutzer_id)
    .fetch_one(&mut *conn)
    .await?;
    set_fristen_tx(
        conn,
        einsatz_id,
        benutzer_id,
        id,
        einheit_name,
        &faellig_at,
        vorgabe.vorwarnung(),
        jetzt,
    )
    .await?;
    Ok((id, rhythmus))
}

// ── Schreibpfade ────────────────────────────────────────────────────────────────────────────

/// Schicht beginnen. Rangfolge (LLH-1122): eigener Rhythmus → Vorgabe des Abschnitts der
/// Einheit → Vorgabe des Einsatzes; fehlt alles, ist das ein fehlender Pflichtwert → 400
/// (Spec: „Ungültiger Rhythmus").
pub async fn beginnen(
    pool: &SqlitePool,
    einsatz_id: i64,
    benutzer_id: i64,
    eingabe: &BeginnEingabe,
    jetzt: &str,
) -> Result<(AbloesungAnzeige, i64), AppError> {
    let startwert = etb_startwert(pool, einsatz_id).await?;
    let (id, etb_id) = write_retry!(pool, |conn| {
        let (name, abschnitt_id) = einheit_tx(conn, einsatz_id, eingabe.einheit_id).await?;
        let abschnitt = match abschnitt_id {
            Some(a) => abschnitt_tx(conn, a).await?,
            None => None,
        };
        let vorgabe = load_einsatz_vorgabe_tx(conn, einsatz_id).await?;
        let (rhythmus, quelle) =
            match (eingabe.rhythmus_minuten, &abschnitt, &vorgabe.werte) {
                (Some(r), _, _) => (r, RhythmusQuelle::Einheit),
                (None, Some((_, Some(v))), _) => (*v, RhythmusQuelle::Abschnitt),
                // Der Rhythmus folgt aus der Regel der Einsatzvorgabe (`compute_faellig`).
                (None, _, Some(_)) => (0, RhythmusQuelle::Einsatz),
                (None, _, None) => return Err(AppError::Validation(
                    "rhythmus_minuten fehlt, und weder der Abschnitt der Einheit noch der Einsatz \
                     hat eine Vorgabe"
                        .into(),
                )),
            };
        let beginn_at = match &eingabe.beginn_at {
            Some(b) => b.clone(),
            None => crate::zeitachse::repo::offenes_eintreffen_tx(conn, eingabe.einheit_id)
                .await?
                .unwrap_or_else(|| jetzt.to_string()),
        };
        let (id, rhythmus) = create_schicht_tx(
            conn,
            einsatz_id,
            benutzer_id,
            eingabe.einheit_id,
            &name,
            abschnitt_id,
            &beginn_at,
            rhythmus,
            quelle,
            &vorgabe,
            None,
            jetzt,
        )
        .await?;
        let herkunft = match (quelle, &abschnitt, &vorgabe.werte) {
            (RhythmusQuelle::Abschnitt, Some((a, _)), _) => format!(" (Vorgabe Abschnitt «{a}»)"),
            (RhythmusQuelle::Einsatz, _, Some(w)) => {
                format!(" (Vorgabe Einsatz «{}»)", w.bezeichnung)
            }
            _ => String::new(),
        };
        let etb_id = crate::etb::system_audit_tx(
            conn,
            einsatz_id,
            benutzer_id,
            startwert,
            &format!(
                "Ablösung: Schicht von «{name}» begonnen, Rhythmus {}{herkunft}",
                rhythmus_label(rhythmus, quelle, &vorgabe)
            ),
        )
        .await?;
        Ok((id, etb_id))
    })?;
    Ok((laden(pool, einsatz_id, id, jetzt).await?, etb_id))
}

/// Schicht ändern (Beginn, Rhythmus, geplante ablösende Einheit). Liefert den ETB-Eintrag nur,
/// wenn sich etwas geändert hat.
pub async fn aendern(
    pool: &SqlitePool,
    einsatz_id: i64,
    id: i64,
    benutzer_id: i64,
    eingabe: &AenderungEingabe,
    jetzt: &str,
) -> Result<(AbloesungAnzeige, Option<i64>), AppError> {
    let startwert = etb_startwert(pool, einsatz_id).await?;
    let etb_id = write_retry!(pool, |conn| {
        let roh = roh_tx(conn, einsatz_id, id).await?;
        if roh.status != AbloesungStatus::Laufend {
            return Err(AppError::UnprocessableEntity(
                "Eine abgelöste Schicht lässt sich nicht ändern".into(),
            ));
        }
        let (name, _) = einheit_tx(conn, einsatz_id, roh.einheit_id).await?;
        let vorgabe = load_einsatz_vorgabe_tx(conn, einsatz_id).await?;
        let mut teile: Vec<String> = Vec::new();

        // Rhythmus. Zurück zur Vorgabe heißt: die des Abschnitts, sonst die des Einsatzes.
        let (rhythmus, quelle) = match eingabe.rhythmus_minuten {
            None => (roh.rhythmus_minuten, roh.rhythmus_quelle),
            Some(Some(r)) => (r, RhythmusQuelle::Einheit),
            Some(None) => {
                let abschnitt = match roh.abschnitt_id {
                    Some(a) => abschnitt_tx(conn, a).await?.and_then(|(_, v)| v),
                    None => None,
                };
                match (abschnitt, &vorgabe.werte) {
                    (Some(v), _) => (v, RhythmusQuelle::Abschnitt),
                    (None, Some(_)) => (roh.rhythmus_minuten, RhythmusQuelle::Einsatz),
                    (None, None) => {
                        return Err(AppError::UnprocessableEntity(
                            "Weder der Abschnitt der Schicht noch der Einsatz hat eine \
                             Rhythmus-Vorgabe"
                                .into(),
                        ))
                    }
                }
            }
        };

        // Beginn
        let beginn_at = eingabe.beginn_at.clone().unwrap_or(roh.beginn_at.clone());
        // Ohne neuen Beginn und ohne Rhythmusangabe bleibt die gespeicherte Fälligkeit: nach einer
        // entfernten Wechselzeiten-Vorgabe ergäbe Beginn + aufgerundeter Rhythmus sonst eine um
        // Sekunden verschobene Fälligkeit samt neu gesetzter Fristen (Review PR #833).
        let (faellig_at, rhythmus) =
            if eingabe.rhythmus_minuten.is_none() && beginn_at == roh.beginn_at {
                (roh.faellig_at.clone(), roh.rhythmus_minuten)
            } else {
                compute_faellig(&beginn_at, rhythmus, quelle, &vorgabe)?
            };
        // Bei der Einsatzvorgabe folgt der Rhythmus der Regel; ändert ihn nur der Beginn
        // (Wechselzeiten), ist das keine Rhythmusänderung.
        let rhythmus_geaendert = quelle != roh.rhythmus_quelle
            || (quelle != RhythmusQuelle::Einsatz && rhythmus != roh.rhythmus_minuten);
        if rhythmus_geaendert {
            let wie = match quelle {
                RhythmusQuelle::Abschnitt => " (Vorgabe des Abschnitts)",
                RhythmusQuelle::Einsatz => " (Vorgabe des Einsatzes)",
                RhythmusQuelle::Einheit => "",
            };
            teile.push(format!(
                "Rhythmus {} → {}{wie}",
                rhythmus_text(roh.rhythmus_minuten),
                rhythmus_label(rhythmus, quelle, &vorgabe)
            ));
        }
        if beginn_at != roh.beginn_at {
            teile.push("Einsatzbeginn geändert".into());
        }

        // Ablösende Einheit
        let abloesende = match eingabe.abloesende_einheit_id {
            None => roh.abloesende_einheit_id,
            Some(v) => v,
        };
        if abloesende != roh.abloesende_einheit_id {
            match abloesende {
                Some(a) if a == roh.einheit_id => {
                    return Err(AppError::UnprocessableEntity(
                        "Eine Einheit kann sich nicht selbst ablösen".into(),
                    ))
                }
                Some(a) => {
                    let (a_name, _) = einheit_tx(conn, einsatz_id, a).await?;
                    teile.push(format!("ablösende Einheit «{a_name}» geplant"));
                }
                None => teile.push("Planung der ablösenden Einheit aufgehoben".into()),
            }
        }

        if teile.is_empty() {
            return Ok(None);
        }
        sqlx::query(
            "UPDATE einsatz_abloesung SET beginn_at = ?, rhythmus_minuten = ?, \
                rhythmus_quelle = ?, faellig_at = ?, abloesende_einheit_id = ? WHERE id = ?",
        )
        .bind(&beginn_at)
        .bind(rhythmus)
        .bind(quelle.as_str())
        .bind(&faellig_at)
        .bind(abloesende)
        .bind(id)
        .execute(&mut *conn)
        .await?;
        if faellig_at != roh.faellig_at {
            set_fristen_tx(
                conn,
                einsatz_id,
                benutzer_id,
                id,
                &name,
                &faellig_at,
                vorgabe.vorwarnung(),
                jetzt,
            )
            .await?;
        }
        let etb_id = crate::etb::system_audit_tx(
            conn,
            einsatz_id,
            benutzer_id,
            startwert,
            &format!("Ablösung «{name}»: {}", teile.join(", ")),
        )
        .await?;
        Ok(Some(etb_id))
    })?;
    Ok((laden(pool, einsatz_id, id, jetzt).await?, etb_id))
}

/// Setzt oder entfernt die Rhythmus-Vorgabe eines Abschnitts und zieht die laufenden
/// Schichten nach, die ihr folgen. `NotFound`, wenn der Abschnitt nicht zum Einsatz gehört.
/// Liefert den Entscheidungseintrag nur, wenn sich der Wert geändert hat.
pub async fn vorgabe_setzen(
    pool: &SqlitePool,
    einsatz_id: i64,
    abschnitt_id: i64,
    benutzer_id: i64,
    rhythmus_minuten: Option<i64>,
    jetzt: &str,
) -> Result<Option<i64>, AppError> {
    let startwert = etb_startwert(pool, einsatz_id).await?;
    write_retry!(pool, |conn| {
        let (abschnitt_name, vorher): (String, Option<i64>) = sqlx::query_as(
            "SELECT name, abloesung_rhythmus_minuten FROM einsatzabschnitt \
             WHERE id = ? AND einsatz_id = ?",
        )
        .bind(abschnitt_id)
        .bind(einsatz_id)
        .fetch_optional(&mut *conn)
        .await?
        .ok_or(AppError::NotFound)?;
        if vorher == rhythmus_minuten {
            return Ok(None);
        }
        sqlx::query("UPDATE einsatzabschnitt SET abloesung_rhythmus_minuten = ? WHERE id = ?")
            .bind(rhythmus_minuten)
            .bind(abschnitt_id)
            .execute(&mut *conn)
            .await?;

        // Weitergabe: nur bei einem neuen Wert. Eine entfernte Vorgabe lässt den zuletzt
        // gültigen Rhythmus stehen (Spec: „Vorgabe entfernen").
        if let Some(neu) = rhythmus_minuten {
            let vorwarnung = load_einsatz_vorgabe_tx(conn, einsatz_id)
                .await?
                .vorwarnung();
            let folgende: Vec<(i64, String, i64)> = sqlx::query_as(
                "SELECT a.id, a.beginn_at, a.einheit_id FROM einsatz_abloesung a \
                 WHERE a.einsatz_id = ? AND a.abschnitt_id = ? AND a.status = 'laufend' \
                   AND a.rhythmus_quelle = 'abschnitt'",
            )
            .bind(einsatz_id)
            .bind(abschnitt_id)
            .fetch_all(&mut *conn)
            .await?;
            for (id, beginn_at, einheit_id) in folgende {
                let faellig_at = faellig_oder_400(&beginn_at, neu)?;
                sqlx::query(
                    "UPDATE einsatz_abloesung SET rhythmus_minuten = ?, faellig_at = ? WHERE id = ?",
                )
                .bind(neu)
                .bind(&faellig_at)
                .bind(id)
                .execute(&mut *conn)
                .await?;
                let (name, _) = einheit_tx(conn, einsatz_id, einheit_id).await?;
                set_fristen_tx(
                    conn,
                    einsatz_id,
                    benutzer_id,
                    id,
                    &name,
                    &faellig_at,
                    vorwarnung,
                    jetzt,
                )
                .await?;
            }
        }

        let inhalt = match (rhythmus_minuten, vorher) {
            (Some(n), Some(v)) => format!(
                "Ablösung Abschnitt «{abschnitt_name}»: Rhythmus auf {} gesetzt (vorher {}).",
                rhythmus_text(n),
                rhythmus_text(v)
            ),
            (Some(n), None) => format!(
                "Ablösung Abschnitt «{abschnitt_name}»: Rhythmus auf {} gesetzt.",
                rhythmus_text(n)
            ),
            (None, Some(v)) => format!(
                "Ablösung Abschnitt «{abschnitt_name}»: Rhythmus-Vorgabe aufgehoben (vorher {}).",
                rhythmus_text(v)
            ),
            (None, None) => unreachable!("gleiche Werte sind oben ausgestiegen"),
        };
        let etb_id = crate::etb::repo::anlegen_tx(
            conn,
            einsatz_id,
            benutzer_id,
            startwert,
            EintragDaten {
                typ: TYP_ENTSCHEIDUNG,
                inhalt: &inhalt,
                von: None,
                an: None,
                meldeweg: None,
                veranlassung: None,
                ereigniszeit: None,
                erfasst_lokal_at: None,
                berichtigt_eintrag_id: None,
            },
        )
        .await?;
        Ok(Some(etb_id))
    })
}

/// Vorgabe des Einsatzes (LLH-1122) samt wirksamer Vorwarnung und der Zahl der laufenden
/// Schichten, die ihr folgen.
pub async fn load_einsatz_vorgabe(
    pool: &SqlitePool,
    einsatz_id: i64,
) -> Result<AbloesungEinsatzVorgabeAnzeige, AppError> {
    let schichtmodell = schichtmodell_repo::load_einsatz(pool, einsatz_id).await?;
    let laufende_schichten: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM einsatz_abloesung \
         WHERE einsatz_id = ? AND status = 'laufend' AND rhythmus_quelle = 'einsatz'",
    )
    .bind(einsatz_id)
    .fetch_one(pool)
    .await?;
    Ok(AbloesungEinsatzVorgabeAnzeige {
        vorwarnung_minuten: schichtmodell
            .as_ref()
            .map_or(VORWARNUNG_VORGABE_MINUTEN, |m| m.vorwarnung_minuten),
        schichtmodell,
        laufende_schichten,
    })
}

/// Was die Einsatzvorgabe werden soll.
#[derive(Debug, Clone)]
pub enum EinsatzVorgabeInput {
    /// Kopie eines Schichtmodells der Organisation des Einsatzes (fremd oder unbekannt: 404).
    FromStammdaten(i64),
    /// Eigene Werte, von der Route geprüft.
    Werte(Werte),
    /// Keine Vorgabe mehr.
    Remove,
}

/// Setzt oder entfernt die Vorgabe des Einsatzes und zieht die laufenden Schichten nach: wer der
/// Einsatzvorgabe folgt, bekommt Rhythmus und Fälligkeit aus der neuen Regel; ändert sich die
/// Vorwarnung, wandern die Vorwarn-Fristen aller laufenden Schichten mit. Fristen über
/// `setze_auto_frist_tx` (wie bei der Abschnittsvorgabe). Eine entfernte Vorgabe lässt den
/// zuletzt gültigen Rhythmus stehen; die Vorwarnung fällt auf 30 min zurück. Liefert den
/// Entscheidungseintrag nur, wenn sich etwas geändert hat. Die Stammdaten bleiben unberührt.
pub async fn set_einsatz_vorgabe(
    pool: &SqlitePool,
    einsatz_id: i64,
    benutzer_id: i64,
    eingabe: &EinsatzVorgabeInput,
    jetzt: &str,
) -> Result<Option<i64>, AppError> {
    let startwert = etb_startwert(pool, einsatz_id).await?;
    write_retry!(pool, |conn| {
        let neu = match eingabe {
            EinsatzVorgabeInput::FromStammdaten(id) => {
                let org_id: i64 = sqlx::query_scalar("SELECT org_id FROM einsatz WHERE id = ?")
                    .bind(einsatz_id)
                    .fetch_one(&mut *conn)
                    .await?;
                Some(schichtmodell_repo::load_werte_tx(conn, org_id, *id).await?)
            }
            EinsatzVorgabeInput::Werte(w) => Some(w.clone()),
            EinsatzVorgabeInput::Remove => None,
        };
        let vorher = load_einsatz_vorgabe_tx(conn, einsatz_id).await?;
        if vorher.werte == neu {
            return Ok(None);
        }
        schichtmodell_repo::set_einsatz_tx(conn, einsatz_id, neu.as_ref(), benutzer_id).await?;
        let vorgabe = EinsatzVorgabe {
            werte: neu.clone(),
            zone: vorher.zone,
        };
        let vorwarnung_geaendert = vorgabe.vorwarnung() != vorher.vorwarnung();

        #[derive(sqlx::FromRow)]
        struct Laufend {
            id: i64,
            einheit_id: i64,
            beginn_at: String,
            rhythmus_minuten: i64,
            #[sqlx(try_from = "String")]
            rhythmus_quelle: RhythmusQuelle,
            faellig_at: String,
        }
        let laufende: Vec<Laufend> = sqlx::query_as(
            "SELECT id, einheit_id, beginn_at, rhythmus_minuten, rhythmus_quelle, faellig_at \
             FROM einsatz_abloesung WHERE einsatz_id = ? AND status = 'laufend' ORDER BY id",
        )
        .bind(einsatz_id)
        .fetch_all(&mut *conn)
        .await?;
        for s in laufende {
            // Neu gerechnet wird nur, wer der neuen Vorgabe folgt. Eine entfernte Vorgabe lässt
            // die gespeicherte Fälligkeit sekundengenau stehen (Review PR #833).
            let (faellig_at, rhythmus) = match (s.rhythmus_quelle, &vorgabe.werte) {
                (RhythmusQuelle::Einsatz, Some(_)) => compute_faellig(
                    &s.beginn_at,
                    s.rhythmus_minuten,
                    s.rhythmus_quelle,
                    &vorgabe,
                )?,
                _ => (s.faellig_at.clone(), s.rhythmus_minuten),
            };
            let faellig_geaendert = faellig_at != s.faellig_at;
            if faellig_geaendert || rhythmus != s.rhythmus_minuten {
                sqlx::query(
                    "UPDATE einsatz_abloesung SET rhythmus_minuten = ?, faellig_at = ? \
                     WHERE id = ?",
                )
                .bind(rhythmus)
                .bind(&faellig_at)
                .bind(s.id)
                .execute(&mut *conn)
                .await?;
            }
            if faellig_geaendert {
                let (name, _) = einheit_tx(conn, einsatz_id, s.einheit_id).await?;
                set_fristen_tx(
                    conn,
                    einsatz_id,
                    benutzer_id,
                    s.id,
                    &name,
                    &faellig_at,
                    vorgabe.vorwarnung(),
                    jetzt,
                )
                .await?;
            } else if vorwarnung_geaendert {
                let (name, _) = einheit_tx(conn, einsatz_id, s.einheit_id).await?;
                set_vorwarn_frist_tx(
                    conn,
                    einsatz_id,
                    benutzer_id,
                    s.id,
                    &name,
                    &faellig_at,
                    vorgabe.vorwarnung(),
                    jetzt,
                )
                .await?;
            }
        }

        let beschreibung = |w: &Werte| format!("«{}», {}", w.bezeichnung, modell_text(w));
        let inhalt = match (&neu, &vorher.werte) {
            (Some(n), Some(v)) => format!(
                "Ablösung Einsatz: Schichtmodell {} gesetzt (vorher {}).",
                beschreibung(n),
                beschreibung(v)
            ),
            (Some(n), None) => format!(
                "Ablösung Einsatz: Schichtmodell {} gesetzt.",
                beschreibung(n)
            ),
            (None, Some(v)) => format!(
                "Ablösung Einsatz: Vorgabe aufgehoben (vorher {}).",
                beschreibung(v)
            ),
            (None, None) => unreachable!("gleiche Werte sind oben ausgestiegen"),
        };
        let etb_id = crate::etb::repo::anlegen_tx(
            conn,
            einsatz_id,
            benutzer_id,
            startwert,
            EintragDaten {
                typ: TYP_ENTSCHEIDUNG,
                inhalt: &inhalt,
                von: None,
                an: None,
                meldeweg: None,
                veranlassung: None,
                ereigniszeit: None,
                erfasst_lokal_at: None,
                berichtigt_eintrag_id: None,
            },
        )
        .await?;
        Ok(Some(etb_id))
    })
}

/// Ein Schichtmodell im ETB: Regel und Vorwarnung („Rhythmus 12 h, Vorwarnung 30 min“).
fn modell_text(w: &Werte) -> String {
    format!(
        "{}, Vorwarnung {}",
        w.regel.text(),
        rhythmus_text(w.vorwarnung_minuten)
    )
}

/// Vollzieht eine laufende Schicht. Mit ablösender Einheit entsteht deren Folgeschicht
/// (Beginn = Vollzug, Rhythmus und Einsatzstelle der abgelösten Schicht; folgt sie der Vorgabe
/// des Einsatzes, rechnet deren Regel neu, etwa bis zum nächsten Wechsel).
pub async fn vollziehen(
    pool: &SqlitePool,
    einsatz_id: i64,
    id: i64,
    benutzer_id: i64,
    vollzogen_at: &str,
    abloesende_einheit_id: Option<i64>,
    jetzt: &str,
) -> Result<(AbloesungVollzugAnzeige, i64, Zeitachsenwirkung), AppError> {
    let startwert = etb_startwert(pool, einsatz_id).await?;
    let (folge_id, etb_id, zeitachse) = write_retry!(pool, |conn| {
        let roh = roh_tx(conn, einsatz_id, id).await?;
        if roh.status != AbloesungStatus::Laufend {
            return Err(AppError::UnprocessableEntity(
                "Die Schicht ist bereits abgelöst".into(),
            ));
        }
        if vollzogen_at < roh.beginn_at.as_str() {
            return Err(AppError::UnprocessableEntity(
                "Der Vollzug liegt vor dem Beginn der Schicht".into(),
            ));
        }
        let (name, _) = einheit_tx(conn, einsatz_id, roh.einheit_id).await?;
        let abloeser = match abloesende_einheit_id {
            Some(a) if a == roh.einheit_id => {
                return Err(AppError::UnprocessableEntity(
                    "Eine Einheit kann sich nicht selbst ablösen".into(),
                ))
            }
            Some(a) => Some((a, einheit_tx(conn, einsatz_id, a).await?.0)),
            None => None,
        };

        sqlx::query(
            "UPDATE einsatz_abloesung SET status = 'abgeloest', vollzogen_at = ?, \
                vollzogen_von_id = ?, abloesende_einheit_id = ? WHERE id = ?",
        )
        .bind(vollzogen_at)
        .bind(benutzer_id)
        .bind(abloesende_einheit_id)
        .bind(id)
        .execute(&mut *conn)
        .await?;
        close_fristen_tx(conn, id, jetzt).await?;
        // LFH-552: der Vollzug beendet die Einsatzperiode der abgelösten Einheit (samt Fan-out);
        // ohne offene Periode bleibt die Zeitachse unberührt.
        let zeitachse = crate::zeitachse::repo::abloesung_vollzogen_tx(
            conn,
            einsatz_id,
            benutzer_id,
            roh.einheit_id,
            vollzogen_at,
        )
        .await?;

        let folge_id = match &abloeser {
            Some((a, a_name)) => {
                let vorgabe = load_einsatz_vorgabe_tx(conn, einsatz_id).await?;
                Some(
                    create_schicht_tx(
                        conn,
                        einsatz_id,
                        benutzer_id,
                        *a,
                        a_name,
                        roh.abschnitt_id,
                        vollzogen_at,
                        roh.rhythmus_minuten,
                        roh.rhythmus_quelle,
                        &vorgabe,
                        Some(id),
                        jetzt,
                    )
                    .await?
                    .0,
                )
            }
            None => None,
        };

        let inhalt = match &abloeser {
            Some((_, a_name)) => format!("Ablösung vollzogen: «{name}» durch «{a_name}»."),
            None => format!("Ablösung vollzogen: «{name}» (ohne ablösende Einheit)."),
        };
        let etb_id = crate::etb::repo::anlegen_tx(
            conn,
            einsatz_id,
            benutzer_id,
            startwert,
            EintragDaten {
                typ: TYP_MELDUNG,
                inhalt: &inhalt,
                von: None,
                an: None,
                meldeweg: None,
                veranlassung: None,
                ereigniszeit: Some(vollzogen_at),
                erfasst_lokal_at: None,
                berichtigt_eintrag_id: None,
            },
        )
        .await?;
        sqlx::query("UPDATE einsatz_abloesung SET etb_vollzug_id = ? WHERE id = ?")
            .bind(etb_id)
            .bind(id)
            .execute(&mut *conn)
            .await?;
        Ok((folge_id, etb_id, zeitachse))
    })?;
    let abgeloest = laden(pool, einsatz_id, id, jetzt).await?;
    let folgeschicht = match folge_id {
        Some(f) => Some(laden(pool, einsatz_id, f, jetzt).await?),
        None => None,
    };
    Ok((
        AbloesungVollzugAnzeige {
            abgeloest,
            folgeschicht,
        },
        etb_id,
        zeitachse,
    ))
}

/// Nimmt einen Vollzug zurück, solange die Folgeschicht unberührt (laufend) ist.
pub async fn zuruecknehmen(
    pool: &SqlitePool,
    einsatz_id: i64,
    id: i64,
    benutzer_id: i64,
    jetzt: &str,
) -> Result<(AbloesungAnzeige, i64, Zeitachsenwirkung), AppError> {
    let startwert = etb_startwert(pool, einsatz_id).await?;
    let (etb_id, zeitachse) = write_retry!(pool, |conn| {
        let roh = roh_tx(conn, einsatz_id, id).await?;
        if roh.status != AbloesungStatus::Abgeloest {
            return Err(AppError::UnprocessableEntity(
                "Die Schicht ist nicht abgelöst — es gibt keinen Vollzug zurückzunehmen".into(),
            ));
        }
        let folge: Option<(i64, String)> = sqlx::query_as(
            "SELECT id, status FROM einsatz_abloesung WHERE vorgaenger_id = ? \
             ORDER BY id DESC LIMIT 1",
        )
        .bind(id)
        .fetch_optional(&mut *conn)
        .await?;
        if let Some((folge_id, status)) = &folge {
            if status.as_str() != AbloesungStatus::Laufend.as_str() {
                return Err(AppError::UnprocessableEntity(
                    "Die Folgeschicht ist bereits selbst abgelöst — der Vollzug lässt sich nicht mehr zurücknehmen"
                        .into(),
                ));
            }
            delete_fristen_tx(conn, *folge_id).await?;
            sqlx::query("DELETE FROM einsatz_abloesung WHERE id = ?")
                .bind(folge_id)
                .execute(&mut *conn)
                .await?;
        }
        let (name, _) = einheit_tx(conn, einsatz_id, roh.einheit_id).await?;
        if has_laufende_tx(conn, roh.einheit_id).await? {
            return Err(AppError::UnprocessableEntity(format!(
                "Einheit «{name}» hat inzwischen eine neue laufende Schicht"
            )));
        }
        // LFH-552: das Ablösungsereignis der Zeitachse streichen, die Periode ist wieder offen.
        let zeitachse = match &roh.vollzogen_at {
            Some(vollzogen_at) => {
                crate::zeitachse::repo::abloesung_zurueckgenommen_tx(
                    conn,
                    einsatz_id,
                    benutzer_id,
                    roh.einheit_id,
                    vollzogen_at,
                )
                .await?
            }
            None => None,
        };
        sqlx::query(
            "UPDATE einsatz_abloesung SET status = 'laufend', vollzogen_at = NULL, \
                vollzogen_von_id = NULL, etb_vollzug_id = NULL WHERE id = ?",
        )
        .bind(id)
        .execute(&mut *conn)
        .await?;
        erinnerung_repo::oeffne_letzte_auto_tx(conn, OBJEKT_ABLOESUNG, id).await?;
        // Die Vorwarnung nur wieder öffnen, solange sie noch vor uns liegt.
        let vorwarnung = load_einsatz_vorgabe_tx(conn, einsatz_id)
            .await?
            .vorwarnung();
        if vorwarnzeit(&roh.faellig_at, vorwarnung).is_some_and(|v| v.as_str() > jetzt) {
            erinnerung_repo::oeffne_letzte_auto_tx(conn, OBJEKT_ABLOESUNG_VORWARNUNG, id).await?;
        }

        let etb_id = crate::etb::repo::anlegen_tx(
            conn,
            einsatz_id,
            benutzer_id,
            startwert,
            EintragDaten {
                typ: TYP_BERICHTIGUNG,
                inhalt: &format!("Vollzug der Ablösung «{name}» zurückgenommen."),
                von: None,
                an: None,
                meldeweg: None,
                veranlassung: None,
                ereigniszeit: None,
                erfasst_lokal_at: None,
                berichtigt_eintrag_id: roh.etb_vollzug_id,
            },
        )
        .await?;
        Ok((etb_id, zeitachse))
    })?;
    Ok((laden(pool, einsatz_id, id, jetzt).await?, etb_id, zeitachse))
}

#[cfg(test)]
mod tests;
