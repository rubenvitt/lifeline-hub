//! Maßnahmen am Patienten (LLH-1324, Change `y18v58dt-pat-kern`, Spec `personen-massnahmen`,
//! design.md D1/D5).
//!
//! `person_massnahme` ist anhängend. Eine Maßnahme wird nie geändert, nur genau einmal
//! aufgehoben: das bedingte UPDATE ([`aufheben_tx`]) trifft bei einem zweiten, auch einem
//! gleichzeitigen Aufheben keine Zeile mehr (409, Muster `src/storno.rs`). Die App leitet aus
//! Maßnahmen nichts ab.

use crate::error::AppError;
use crate::geraet::bestaetigung::Bestaetigung;
use crate::wire_enum::wire_enum;
use serde::Serialize;
use sqlx::{SqliteConnection, SqlitePool};
use utoipa::ToSchema;

wire_enum! {
    /// Maßnahme aus dem festen Katalog (Spec `personen-massnahmen`). String = CHECK in
    /// `migrations/0220_person_massnahme.sql`. Katalogwert (Retain), nie im ETB oder Live-Kanal.
    #[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]
    pub enum MassnahmeArt {
        Blutstillung => "blutstillung",
        Zugang => "zugang",
        Infusion => "infusion",
        Sauerstoff => "sauerstoff",
        Atemweg => "atemweg",
        Analgesie => "analgesie",
        Immobilisation => "immobilisation",
        Waermeerhalt => "waermeerhalt",
        Dekontamination => "dekontamination",
    }
}

/// Eine Maßnahme (1:1 zu `person_massnahme`); eine aufgehobene trägt `aufgehoben_at`.
#[derive(Debug, Clone, Serialize, sqlx::FromRow, ToSchema)]
pub struct MassnahmeAnzeige {
    pub id: i64,
    pub einsatz_id: i64,
    pub person_id: i64,
    #[schema(value_type = MassnahmeArt)]
    pub art: String,
    /// Durchführung; ohne Angabe die Erfassung, ohne Netz die Zeit am Gerät, gekappt.
    pub zeitpunkt_at: String,
    /// Wann die Maßnahme beim Server ankam (Erfassungszeit im Sinne der Spec).
    pub erfasst_at: String,
    pub erfasst_von: i64,
    /// Namentliche Bestätigung am Gerät (LFH-1046).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bestaetigt_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub aufgehoben_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub aufgehoben_von_id: Option<i64>,
}

const SELECT_MASSNAHME: &str = "\
    SELECT id, einsatz_id, person_id, art, zeitpunkt_at, erfasst_at, erfasst_von, \
           bestaetigt_name, aufgehoben_at, aufgehoben_von_id \
    FROM person_massnahme";

/// Eine neue Maßnahme; Katalogwert geprüft, Durchführung gekappt.
#[derive(Debug)]
pub struct NeueMassnahme<'a> {
    pub art: MassnahmeArt,
    /// Durchführung, bereits über `support::durchfuehrungszeitpunkt` geprüft (darf vor der
    /// Registrierung liegen; der Kommentar in `0220` nennt noch `erfassungszeitpunkt`).
    pub zeitpunkt_at: &'a str,
    pub client_id: Option<&'a str>,
    /// Bereits über [`crate::geraet::bestaetigung::aufloesen`] geprüft.
    pub bestaetigung: Option<&'a Bestaetigung>,
}

/// Legt eine Maßnahme an. Kommt dieselbe `client_id` im Einsatz ein zweites Mal, liefert sie die
/// gespeicherte (unter `BEGIN IMMEDIATE` auch bei zwei gleichzeitigen Übertragungen genau eine).
pub async fn anlegen(
    pool: &SqlitePool,
    einsatz_id: i64,
    person_id: i64,
    neu: &NeueMassnahme<'_>,
    erfasst_von: i64,
) -> Result<MassnahmeAnzeige, AppError> {
    crate::write_retry!(pool, |conn| {
        if let Some(cid) = neu.client_id {
            if let Some(replay) = nach_client_id(&mut *conn, einsatz_id, cid).await? {
                return Ok(replay);
            }
        }
        let id: i64 = sqlx::query_scalar(
            "INSERT INTO person_massnahme (einsatz_id, person_id, art, zeitpunkt_at, \
                erfasst_at, erfasst_von, bestaetigt_personal_id, bestaetigt_name, client_id) \
             VALUES (?, ?, ?, ?, strftime('%Y-%m-%d %H:%M:%S','now'), ?, ?, ?, ?) RETURNING id",
        )
        .bind(einsatz_id)
        .bind(person_id)
        .bind(neu.art.as_str())
        .bind(neu.zeitpunkt_at)
        .bind(erfasst_von)
        .bind(neu.bestaetigung.map(|b| b.personal_id))
        .bind(neu.bestaetigung.map(|b| b.name.as_str()))
        .bind(neu.client_id)
        .fetch_one(&mut *conn)
        .await?;
        laden_tx(conn, einsatz_id, person_id, id).await
    })
}

/// Hebt eine Maßnahme genau einmal auf: die Bedingung `aufgehoben_at IS NULL` steht im UPDATE
/// selbst (design.md D1). Fremd oder unbekannt 404, schon aufgehoben 409.
pub async fn aufheben(
    pool: &SqlitePool,
    einsatz_id: i64,
    person_id: i64,
    id: i64,
    von: i64,
) -> Result<MassnahmeAnzeige, AppError> {
    crate::write_retry!(pool, |conn| {
        aufheben_tx(conn, einsatz_id, person_id, id, von).await
    })
}

/// [`aufheben`] auf einer offenen Verbindung.
pub async fn aufheben_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    person_id: i64,
    id: i64,
    von: i64,
) -> Result<MassnahmeAnzeige, AppError> {
    let betroffen = sqlx::query(
        "UPDATE person_massnahme SET aufgehoben_at = strftime('%Y-%m-%d %H:%M:%S','now'), \
            aufgehoben_von_id = ? \
         WHERE id = ? AND einsatz_id = ? AND person_id = ? AND aufgehoben_at IS NULL",
    )
    .bind(von)
    .bind(id)
    .bind(einsatz_id)
    .bind(person_id)
    .execute(&mut *conn)
    .await?
    .rows_affected();
    let massnahme = laden_tx(conn, einsatz_id, person_id, id).await?;
    if betroffen == 0 {
        return Err(AppError::Conflict(
            "Die Maßnahme ist schon aufgehoben".into(),
        ));
    }
    Ok(massnahme)
}

/// Die schon gespeicherte Maßnahme zu einer `client_id` im Einsatz (Replay der Offline-Queue).
pub async fn nach_client_id(
    executor: impl sqlx::Executor<'_, Database = sqlx::Sqlite>,
    einsatz_id: i64,
    client_id: &str,
) -> Result<Option<MassnahmeAnzeige>, AppError> {
    Ok(
        sqlx::query_as::<_, MassnahmeAnzeige>(sqlx::AssertSqlSafe(format!(
            "{SELECT_MASSNAHME} WHERE einsatz_id = ? AND client_id = ?"
        )))
        .bind(einsatz_id)
        .bind(client_id)
        .fetch_optional(executor)
        .await?,
    )
}

async fn laden_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    person_id: i64,
    id: i64,
) -> Result<MassnahmeAnzeige, AppError> {
    sqlx::query_as::<_, MassnahmeAnzeige>(sqlx::AssertSqlSafe(format!(
        "{SELECT_MASSNAHME} WHERE id = ? AND einsatz_id = ? AND person_id = ?"
    )))
    .bind(id)
    .bind(einsatz_id)
    .bind(person_id)
    .fetch_optional(&mut *conn)
    .await?
    .ok_or(AppError::NotFound)
}

/// Maßnahmen einer Person, die jüngste Durchführung zuerst, aufgehobene eingeschlossen.
pub async fn liste_je_person(
    pool: &SqlitePool,
    einsatz_id: i64,
    person_id: i64,
) -> Result<Vec<MassnahmeAnzeige>, AppError> {
    Ok(
        sqlx::query_as::<_, MassnahmeAnzeige>(sqlx::AssertSqlSafe(format!(
            "{SELECT_MASSNAHME} WHERE einsatz_id = ? AND person_id = ? \
             ORDER BY zeitpunkt_at DESC, id DESC"
        )))
        .bind(einsatz_id)
        .bind(person_id)
        .fetch_all(pool)
        .await?,
    )
}
