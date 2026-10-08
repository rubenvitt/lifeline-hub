//! Namentliche Bestätigung am Gerät (LFH-1046, Spec `geraete-kopplung`).
//!
//! Ein UHS-Gerät kann bei Sichtung und Verbleib eine Person aus dem Personal des Einsatzes als
//! Bestätigende angeben. Die Angabe ist ein Datenfeld am Schritt, keine Anmeldung: sie legt keine
//! Sitzung an, ändert die Gerätesitzung nicht und gewährt nichts über die Ansicht hinaus.
//! Eine Person bestätigt durch ihre eigene Anmeldung; schickt sie das Feld, ist das 422.

use crate::error::AppError;
use crate::geraet::GeraetKontext;
use serde::Serialize;
use sqlx::SqlitePool;
use utoipa::ToSchema;

/// Die aufgelöste Bestätigung: Kennung der Dispositionszeile und Namensschnappschuss.
#[derive(Debug, Clone)]
pub struct Bestaetigung {
    pub personal_id: i64,
    pub name: String,
}

/// Ein Eintrag der Auswahlliste „Bestätigt von“.
#[derive(Debug, Clone, Serialize, sqlx::FromRow, ToSchema)]
pub struct Bestaetiger {
    /// Kennung in `einsatz_personal`.
    pub id: i64,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub funktion: Option<String>,
}

/// Prüft eine angegebene Bestätigung und löst den Namen auf. Ohne Angabe `None`. Eine Angabe
/// ohne Gerätesitzung oder mit einer Kennung außerhalb des Einsatzes ist 422 (Zusammenhang,
/// `src/AGENTS.md`, Statuscode-Konvention).
pub async fn aufloesen(
    pool: &SqlitePool,
    geraet: Option<&GeraetKontext>,
    einsatz_id: i64,
    personal_id: Option<i64>,
) -> Result<Option<Bestaetigung>, AppError> {
    let Some(personal_id) = personal_id else {
        return Ok(None);
    };
    if geraet.is_none() {
        return Err(AppError::UnprocessableEntity(
            "Eine Bestätigung gibt es nur an einem gekoppelten Gerät".into(),
        ));
    }
    let name: Option<String> = sqlx::query_scalar(
        "SELECT snap_name FROM einsatz_personal WHERE id = ? AND einsatz_id = ?",
    )
    .bind(personal_id)
    .bind(einsatz_id)
    .fetch_optional(pool)
    .await?;
    let name = name.ok_or_else(|| {
        AppError::UnprocessableEntity("Die bestätigende Person gehört nicht zum Einsatz".into())
    })?;
    Ok(Some(Bestaetigung { personal_id, name }))
}

/// Das Personal des Einsatzes für die Auswahl, nach Name sortiert.
pub async fn auswahl(pool: &SqlitePool, einsatz_id: i64) -> Result<Vec<Bestaetiger>, AppError> {
    Ok(sqlx::query_as::<_, Bestaetiger>(
        "SELECT id, snap_name AS name, snap_funktion AS funktion FROM einsatz_personal \
         WHERE einsatz_id = ? ORDER BY snap_name COLLATE NOCASE, id",
    )
    .bind(einsatz_id)
    .fetch_all(pool)
    .await?)
}
