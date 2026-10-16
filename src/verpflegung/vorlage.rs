//! Verpflegungsplan der Organisation (LLH-1058, design.md D1, D2): eine flache Liste von
//! Mahlzeiten je Organisation mit Bezeichnung, Beginn und Ende als Wanduhrzeit ohne Datum
//! ([`Uhrzeit`]) und optional der Verpflegungsart. Aus dem Plan legt die Verpflegung eines
//! Einsatzes für einen Tag einzelne Zeitfenster an (`repo::zeitfenster_aus_vorlage_tx`); ein
//! angelegtes Zeitfenster kennt seine Vorlage nicht, und der Plan legt nichts von selbst an.
//!
//! Regeln (Spec `openspec/specs/kraefte-verpflegung/spec.md`, „Verpflegungsplan der
//! Organisation“):
//! - Ende vor Beginn heißt: die Mahlzeit endet am Folgetag (`folgetag`). Ende gleich Beginn ist
//!   422, beim Ändern im Effektivzustand aus Bestand und Änderung.
//! - Die Bezeichnung ist unter den aktiven Mahlzeiten einer Organisation eindeutig, ohne
//!   Unterschied von Groß- und Kleinschreibung (409). Verglichen wird in Rust mit
//!   `to_lowercase`, weil SQLites `lower()` nur ASCII faltet; der partielle Index aus der
//!   Migration ist das Netz und kommt ebenfalls als 409 heraus.
//! - Kein Löschen: `aktiv` schaltet in beide Richtungen. Reaktivieren prüft den Namen erneut.
//! - Fremde Organisation: 404, wie nicht vorhanden.
//! - Kein Bedarf im Plan: der wird je Tag erfasst (`super`, „Der Bedarf wird erfasst“).
//!
//! Feldfehler (400: leere oder zu lange Bezeichnung, unlesbare Uhrzeit, unbekannte Art) prüft die
//! Route vor dem Repo. Lesen darf jedes Mitglied der Organisation, schreiben nur der Admin
//! (`routes::verpflegung_vorlage`); `stammdaten` meldet die Middleware.

use serde::Serialize;
use sqlx::{SqliteConnection, SqlitePool};
use utoipa::ToSchema;

use super::Verpflegungsart;
use crate::error::AppError;
use crate::uhrzeit::Uhrzeit;
use crate::write_retry;

/// Bezeichnung einer Mahlzeit nach dem Trimmen (design.md D13), gespiegelt als
/// `VERPFLEGUNG_VORLAGE_BEZEICHNUNG_MAX`. So lang wie die eines Zeitfensters, das daraus entsteht.
pub const BEZEICHNUNG_MAX: usize = 200;

/// Eine Mahlzeit des Verpflegungsplans.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, ToSchema)]
pub struct VerpflegungVorlage {
    pub id: i64,
    pub bezeichnung: String,
    /// Wanduhrzeit `HH:MM` ohne Datum und ohne Zone.
    pub beginn: String,
    /// Wanduhrzeit `HH:MM`; liegt sie vor `beginn`, endet die Mahlzeit am Folgetag.
    pub ende: String,
    /// `ende` liegt vor `beginn`: die Mahlzeit endet am Folgetag („+1 Tag“).
    pub folgetag: bool,
    /// Warm, kalt oder Getränke; fehlt = ohne Angabe.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub verpflegungsart: Option<Verpflegungsart>,
    pub aktiv: bool,
}

/// Eingabe „Mahlzeit anlegen“; die Route hat die Felder gelesen und geprüft (400).
#[derive(Debug, Clone)]
pub struct NewVorlage {
    /// Getrimmt, nicht leer, höchstens [`BEZEICHNUNG_MAX`].
    pub bezeichnung: String,
    pub beginn: Uhrzeit,
    pub ende: Uhrzeit,
    pub verpflegungsart: Option<Verpflegungsart>,
}

/// Teiländerung einer Mahlzeit: jedes fehlende Feld bleibt unverändert.
#[derive(Debug, Clone, Default)]
pub struct VorlagePatch {
    /// Getrimmt, nicht leer, höchstens [`BEZEICHNUNG_MAX`].
    pub bezeichnung: Option<String>,
    pub beginn: Option<Uhrzeit>,
    pub ende: Option<Uhrzeit>,
    /// Tri-State: fehlt = unverändert, `Some(None)` = leeren.
    pub verpflegungsart: Option<Option<Verpflegungsart>>,
    pub aktiv: Option<bool>,
}

#[derive(sqlx::FromRow)]
struct VorlageZeile {
    id: i64,
    bezeichnung: String,
    beginn: String,
    ende: String,
    verpflegungsart: Option<String>,
    aktiv: bool,
}

impl VorlageZeile {
    fn anzeige(self) -> VerpflegungVorlage {
        VerpflegungVorlage {
            id: self.id,
            folgetag: self.ende < self.beginn,
            bezeichnung: self.bezeichnung,
            beginn: self.beginn,
            ende: self.ende,
            // Der CHECK lässt nur bekannte Wörter zu.
            verpflegungsart: self
                .verpflegungsart
                .as_deref()
                .and_then(Verpflegungsart::parse),
            aktiv: self.aktiv,
        }
    }
}

const NAME_VERGEBEN: &str = "Eine aktive Mahlzeit mit dieser Bezeichnung gibt es schon";

/// Ein Verstoß gegen den partiellen Namensindex ist derselbe 409 wie die Rust-Prüfung (Muster
/// `einheit_vorlage::repo`): zwei gleichzeitige Anlagen kommen sonst als 409 und 500 heraus.
fn map_name_conflict<T>(e: AppError) -> Result<T, AppError> {
    if let AppError::Database(sqlx::Error::Database(db)) = &e {
        if db.is_unique_violation() && db.message().contains("verpflegung_vorlage.bezeichnung") {
            return Err(AppError::Conflict(NAME_VERGEBEN.into()));
        }
    }
    Err(e)
}

/// 422: Ende gleich Beginn ist kein Zeitraum (Ende davor ist der Folgetag).
fn check_zeitraum(beginn: Uhrzeit, ende: Uhrzeit) -> Result<(), AppError> {
    if beginn == ende {
        return Err(AppError::UnprocessableEntity(format!(
            "Ende und Beginn sind gleich ({beginn}); eine Mahlzeit braucht einen Zeitraum"
        )));
    }
    Ok(())
}

/// 409, wenn eine andere aktive Mahlzeit der Org dieselbe Bezeichnung trägt, getrimmt und ohne
/// Groß- und Kleinschreibung (`to_lowercase` faltet auch Umlaute, „FRÜHSTÜCK“).
async fn check_name_frei_tx(
    conn: &mut SqliteConnection,
    org_id: i64,
    bezeichnung: &str,
    ausser_id: Option<i64>,
) -> Result<(), AppError> {
    let namen: Vec<String> = sqlx::query_scalar(
        "SELECT bezeichnung FROM verpflegung_vorlage \
         WHERE org_id = ? AND aktiv = 1 AND id IS NOT ?",
    )
    .bind(org_id)
    .bind(ausser_id)
    .fetch_all(&mut *conn)
    .await?;
    let gesucht = bezeichnung.trim().to_lowercase();
    if namen.iter().any(|n| n.trim().to_lowercase() == gesucht) {
        return Err(AppError::Conflict(NAME_VERGEBEN.into()));
    }
    Ok(())
}

async fn load_tx(
    conn: &mut SqliteConnection,
    org_id: i64,
    id: i64,
) -> Result<VerpflegungVorlage, AppError> {
    sqlx::query_as::<_, VorlageZeile>(
        "SELECT id, bezeichnung, beginn, ende, verpflegungsart, aktiv FROM verpflegung_vorlage \
         WHERE org_id = ? AND id = ?",
    )
    .bind(org_id)
    .bind(id)
    .fetch_optional(&mut *conn)
    .await?
    .map(VorlageZeile::anzeige)
    .ok_or(AppError::NotFound)
}

/// Der Plan der Organisation nach Beginn, dann Bezeichnung; mit `nur_aktive` ohne die
/// deaktivierten Mahlzeiten.
pub async fn list(
    pool: &SqlitePool,
    org_id: i64,
    nur_aktive: bool,
) -> Result<Vec<VerpflegungVorlage>, AppError> {
    Ok(sqlx::query_as::<_, VorlageZeile>(
        "SELECT id, bezeichnung, beginn, ende, verpflegungsart, aktiv FROM verpflegung_vorlage \
         WHERE org_id = ? AND (aktiv = 1 OR ? = 0) ORDER BY beginn, bezeichnung, id",
    )
    .bind(org_id)
    .bind(nur_aktive)
    .fetch_all(pool)
    .await?
    .into_iter()
    .map(VorlageZeile::anzeige)
    .collect())
}

/// Legt eine aktive Mahlzeit an. 422 bei Ende gleich Beginn, 409 bei gleichem aktiven Namen.
pub async fn create(
    pool: &SqlitePool,
    org_id: i64,
    neu: &NewVorlage,
) -> Result<VerpflegungVorlage, AppError> {
    check_zeitraum(neu.beginn, neu.ende)?;
    write_retry!(pool, |conn| {
        check_name_frei_tx(conn, org_id, &neu.bezeichnung, None).await?;
        let id: i64 = sqlx::query_scalar(
            "INSERT INTO verpflegung_vorlage (org_id, bezeichnung, beginn, ende, verpflegungsart) \
             VALUES (?, ?, ?, ?, ?) RETURNING id",
        )
        .bind(org_id)
        .bind(&neu.bezeichnung)
        .bind(neu.beginn.to_string())
        .bind(neu.ende.to_string())
        .bind(neu.verpflegungsart.map(|a| a.as_str()))
        .fetch_one(&mut *conn)
        .await
        .map_err(AppError::from)
        .or_else(map_name_conflict)?;
        load_tx(conn, org_id, id).await
    })
}

/// Ändert eine Mahlzeit der Organisation (Teiländerung), geprüft im Effektivzustand: 404 bei
/// fremder oder unbekannter, 422 bei Ende gleich Beginn, 409, wenn die Mahlzeit danach aktiv ist
/// und eine andere aktive denselben Namen trägt (auch beim Reaktivieren).
pub async fn update(
    pool: &SqlitePool,
    org_id: i64,
    id: i64,
    patch: &VorlagePatch,
) -> Result<VerpflegungVorlage, AppError> {
    write_retry!(pool, |conn| {
        let vorher = load_tx(conn, org_id, id).await?;
        let bezeichnung = patch
            .bezeichnung
            .clone()
            .unwrap_or_else(|| vorher.bezeichnung.clone());
        let beginn = match patch.beginn {
            Some(u) => u,
            None => Uhrzeit::parse("beginn", &vorher.beginn)?,
        };
        let ende = match patch.ende {
            Some(u) => u,
            None => Uhrzeit::parse("ende", &vorher.ende)?,
        };
        let art = patch.verpflegungsart.unwrap_or(vorher.verpflegungsart);
        let aktiv = patch.aktiv.unwrap_or(vorher.aktiv);
        check_zeitraum(beginn, ende)?;
        if aktiv {
            check_name_frei_tx(conn, org_id, &bezeichnung, Some(id)).await?;
        }
        sqlx::query(
            "UPDATE verpflegung_vorlage SET bezeichnung = ?, beginn = ?, ende = ?, \
                verpflegungsart = ?, aktiv = ? \
             WHERE id = ? AND org_id = ?",
        )
        .bind(&bezeichnung)
        .bind(beginn.to_string())
        .bind(ende.to_string())
        .bind(art.map(|a| a.as_str()))
        .bind(aktiv)
        .bind(id)
        .bind(org_id)
        .execute(&mut *conn)
        .await
        .map_err(AppError::from)
        .or_else(map_name_conflict)?;
        load_tx(conn, org_id, id).await
    })
}

#[cfg(test)]
mod tests;
