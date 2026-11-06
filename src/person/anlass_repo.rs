//! Anlass der Hilfeleistung an einer Person als Verlauf mit aktuellem Stand (LLH-1566, Konzept
//! LLH-1562 Abschnitt 5.1; Muster `transport_repo`).
//!
//! `person_anlass` ist anhängend. Jede Zeile ist ein voller Stand, ein leerer Anlass hebt ihn
//! auf. Der Cache an `einsatz_person` folgt dem Stand mit der jüngsten Erfassungszeit, nicht der
//! Einfügung. Der Anlass ist ein Gesundheitsdatum (Kategorie Behandlung, LLH-1109): er steht nie
//! im ETB, das Live-Ereignis nennt nur Einsatz und Person.

use crate::error::AppError;
use crate::wire_enum::wire_enum;
use serde::Serialize;
use sqlx::{SqliteConnection, SqlitePool};
use utoipa::ToSchema;

wire_enum! {
    /// Anlass der Hilfeleistung, fester Katalog (Ruben 05.11.2026: kein fester Statistikbogen).
    /// String = CHECK in `migrations/0277_person_anlass.sql`. Kategorie Behandlung, nie im ETB.
    #[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]
    pub enum PersonAnlass {
        Verletzung => "verletzung",
        Internistisch => "internistisch",
        Neurologisch => "neurologisch",
        Intoxikation => "intoxikation",
        HitzeKaelte => "hitze_kaelte",
        Allergie => "allergie",
        Psychisch => "psychisch",
        Sonstiges => "sonstiges",
    }
}

/// Ein Anlass-Stand (1:1 zu `person_anlass`). Ohne `anlass` heißt er „aufgehoben“.
#[derive(Debug, Clone, Serialize, sqlx::FromRow, ToSchema)]
pub struct AnlassAnzeige {
    pub id: i64,
    pub einsatz_id: i64,
    pub person_id: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[schema(value_type = Option<PersonAnlass>)]
    pub anlass: Option<String>,
    /// Erfassungszeit; ohne Netz vorgemerkt die Zeit am Gerät, gekappt.
    pub zeitpunkt_at: String,
    /// Wann der Stand beim Server ankam.
    pub erfasst_at: String,
    pub erfasst_von: i64,
}

const SELECT_ANLASS: &str = "\
    SELECT id, einsatz_id, person_id, anlass, zeitpunkt_at, erfasst_at, erfasst_von \
    FROM person_anlass";

/// „Aktuell“ (Spec `personen-verlauf`): der Stand mit der jüngsten Erfassungszeit, bei
/// Gleichstand der später gespeicherte. Die einzige Stelle, die das für den Anlass festlegt.
macro_rules! anlassfolge {
    () => {
        "ORDER BY zeitpunkt_at DESC, id DESC"
    };
}

/// Ein neuer Stand; der Katalogwert ist geprüft, die Erfassungszeit gekappt.
#[derive(Debug)]
pub struct NeuerAnlass<'a> {
    pub anlass: Option<PersonAnlass>,
    /// Erfassungszeit, bereits über `support::erfassungszeitpunkt` gekappt.
    pub zeitpunkt_at: &'a str,
    /// Idempotenzschlüssel der Offline-Queue.
    pub client_id: Option<&'a str>,
}

/// Erfasst einen Stand anhängend und bestimmt den Cache neu aus dem jüngsten Stand, auf der
/// offenen Verbindung des Aufrufers (Anlage einer Person und Route bündeln es in EINER
/// `write_retry!`-Transaktion).
pub async fn erfassen_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    person_id: i64,
    neu: &NeuerAnlass<'_>,
    erfasst_von: i64,
) -> Result<AnlassAnzeige, AppError> {
    let id: i64 = sqlx::query_scalar(
        "INSERT INTO person_anlass (einsatz_id, person_id, anlass, zeitpunkt_at, erfasst_at, \
            erfasst_von, client_id) \
         VALUES (?, ?, ?, ?, strftime('%Y-%m-%d %H:%M:%S','now'), ?, ?) RETURNING id",
    )
    .bind(einsatz_id)
    .bind(person_id)
    .bind(neu.anlass.map(|a| a.as_str()))
    .bind(neu.zeitpunkt_at)
    .bind(erfasst_von)
    .bind(neu.client_id)
    .fetch_one(&mut *conn)
    .await?;
    let juengste: i64 = sqlx::query_scalar(concat!(
        "SELECT id FROM person_anlass WHERE einsatz_id = ? AND person_id = ? ",
        anlassfolge!(),
        " LIMIT 1"
    ))
    .bind(einsatz_id)
    .bind(person_id)
    .fetch_one(&mut *conn)
    .await?;
    sqlx::query(
        "UPDATE einsatz_person SET \
            anlass = (SELECT anlass FROM person_anlass WHERE id = ?1), \
            anlass_at = (SELECT CASE WHEN anlass IS NULL THEN NULL ELSE zeitpunkt_at END \
                         FROM person_anlass WHERE id = ?1) \
         WHERE id = ?2 AND einsatz_id = ?3",
    )
    .bind(juengste)
    .bind(person_id)
    .bind(einsatz_id)
    .execute(&mut *conn)
    .await?;
    laden_tx(conn, einsatz_id, id).await
}

/// Der schon gespeicherte Stand zu einer `client_id` im Einsatz (Replay der Offline-Queue).
pub async fn nach_client_id(
    executor: impl sqlx::Executor<'_, Database = sqlx::Sqlite>,
    einsatz_id: i64,
    client_id: &str,
) -> Result<Option<AnlassAnzeige>, AppError> {
    Ok(
        sqlx::query_as::<_, AnlassAnzeige>(sqlx::AssertSqlSafe(format!(
            "{SELECT_ANLASS} WHERE einsatz_id = ? AND client_id = ?"
        )))
        .bind(einsatz_id)
        .bind(client_id)
        .fetch_optional(executor)
        .await?,
    )
}

/// Lädt einen Stand auf einer offenen Verbindung; `NotFound`, falls nicht zum Einsatz.
pub async fn laden_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    id: i64,
) -> Result<AnlassAnzeige, AppError> {
    sqlx::query_as::<_, AnlassAnzeige>(sqlx::AssertSqlSafe(format!(
        "{SELECT_ANLASS} WHERE id = ? AND einsatz_id = ?"
    )))
    .bind(id)
    .bind(einsatz_id)
    .fetch_optional(&mut *conn)
    .await?
    .ok_or(AppError::NotFound)
}

/// Anlass-Verlauf einer Person, der aktuelle Stand zuerst.
pub async fn liste_je_person(
    pool: &SqlitePool,
    einsatz_id: i64,
    person_id: i64,
) -> Result<Vec<AnlassAnzeige>, AppError> {
    Ok(
        sqlx::query_as::<_, AnlassAnzeige>(sqlx::AssertSqlSafe(format!(
            "{SELECT_ANLASS} WHERE einsatz_id = ? AND person_id = ? {}",
            anlassfolge!()
        )))
        .bind(einsatz_id)
        .bind(person_id)
        .fetch_all(pool)
        .await?,
    )
}
