//! Kräfte einer UHS (LFH-1045, Spec `uhs-staerke`, design.md D1–D6).
//!
//! Eine Einsatzkraft (`einsatz_personal`) steht über `uhs_id` an höchstens einer UHS, unabhängig
//! von Einheit und Fahrzeug. Die Stärke der UHS zählt `repo::SELECT_ALLE` aus diesen Zeilen;
//! hier liegen die Zuordnung, das Lösen und die schlanke Anzeige einer Kraft.

use crate::error::AppError;
use crate::personal::{disposition_repo, EinsatzPersonalAnzeige};
use serde::Serialize;
use sqlx::{SqliteConnection, SqlitePool};
use std::collections::HashMap;
use utoipa::ToSchema;

/// Eine Kraft an (oder für) einer UHS: nur was die UHS braucht, ohne Status, Bemerkung und
/// Trägerorganisation. So sieht auch der UHS-Laptop nicht mehr als Name, Funktion, Position und
/// Einheit (design.md D4).
#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct UhsKraft {
    /// `einsatz_personal.id`.
    pub id: i64,
    pub name: String,
    /// Qualifikationen als flacher Text, wie in der Personalliste.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub funktion: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[schema(value_type = Option<crate::staerke::StaerkePosition>)]
    pub staerke_position: Option<String>,
    /// Einheit der Kraft (Kennung und Name); fehlen ohne Einheit.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub einheit_id: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub einheit: Option<String>,
    pub ist_adhoc: bool,
}

async fn einheit_namen(
    pool: &SqlitePool,
    einsatz_id: i64,
) -> Result<HashMap<i64, String>, AppError> {
    let zeilen: Vec<(i64, String)> =
        sqlx::query_as("SELECT id, name FROM einsatz_einheit WHERE einsatz_id = ?")
            .bind(einsatz_id)
            .fetch_all(pool)
            .await?;
    Ok(zeilen.into_iter().collect())
}

fn zu_kraft(a: EinsatzPersonalAnzeige, einheiten: &HashMap<i64, String>) -> UhsKraft {
    UhsKraft {
        id: a.id,
        einheit_id: a.einheit_id,
        einheit: a.einheit_id.and_then(|e| einheiten.get(&e).cloned()),
        name: a.name,
        funktion: a.funktion,
        staerke_position: a.staerke_position,
        ist_adhoc: a.ist_adhoc,
    }
}

/// Kräfte einer UHS (`Some`) oder Einsatzkräfte ohne UHS (`None`), nach Namen sortiert.
pub async fn liste(
    pool: &SqlitePool,
    einsatz_id: i64,
    uhs_id: Option<i64>,
    einsatz_aktiv: bool,
) -> Result<Vec<UhsKraft>, AppError> {
    let personal = disposition_repo::liste_je_uhs(pool, einsatz_id, uhs_id, einsatz_aktiv).await?;
    let einheiten = einheit_namen(pool, einsatz_id).await?;
    Ok(personal
        .into_iter()
        .map(|a| zu_kraft(a, &einheiten))
        .collect())
}

/// Eine Kraft als Anzeige (nach dem Commit, für die Antwort).
pub async fn laden(
    pool: &SqlitePool,
    einsatz_id: i64,
    ep_id: i64,
    einsatz_aktiv: bool,
) -> Result<UhsKraft, AppError> {
    let a = disposition_repo::laden_anzeige(pool, einsatz_id, ep_id, einsatz_aktiv).await?;
    let einheiten = einheit_namen(pool, einsatz_id).await?;
    Ok(zu_kraft(a, &einheiten))
}

/// Die UHS einer Kraft des Einsatzes (`None` = an keiner); `NotFound`, falls die Kraft nicht
/// zum Einsatz gehört.
pub async fn uhs_der_kraft_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    ep_id: i64,
) -> Result<Option<i64>, AppError> {
    let zeile: Option<Option<i64>> =
        sqlx::query_scalar("SELECT uhs_id FROM einsatz_personal WHERE id = ? AND einsatz_id = ?")
            .bind(ep_id)
            .bind(einsatz_id)
            .fetch_optional(&mut *conn)
            .await?;
    zeile.ok_or(AppError::NotFound)
}

/// Setzt oder löscht die UHS einer Kraft; `NotFound`, falls die Kraft nicht zum Einsatz gehört.
pub async fn setze_uhs_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    ep_id: i64,
    uhs_id: Option<i64>,
) -> Result<(), AppError> {
    let r = sqlx::query("UPDATE einsatz_personal SET uhs_id = ? WHERE id = ? AND einsatz_id = ?")
        .bind(uhs_id)
        .bind(ep_id)
        .bind(einsatz_id)
        .execute(&mut *conn)
        .await?;
    if r.rows_affected() == 0 {
        return Err(AppError::NotFound);
    }
    Ok(())
}

/// Ordnet alle Kräfte einer Einheit, die an keiner UHS stehen, der UHS zu (design.md F3).
/// Liefert die Anzahl; Kräfte an einer anderen UHS bleiben dort.
pub async fn einheit_zuordnen_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    einheit_id: i64,
    uhs_id: i64,
) -> Result<u64, AppError> {
    let r = sqlx::query(
        "UPDATE einsatz_personal SET uhs_id = ? \
         WHERE einsatz_id = ? AND einheit_id = ? AND uhs_id IS NULL",
    )
    .bind(uhs_id)
    .bind(einsatz_id)
    .bind(einheit_id)
    .execute(&mut *conn)
    .await?;
    Ok(r.rows_affected())
}

/// Löst alle Kräfte einer UHS (Auflösen, Stornieren; design.md D6). Liefert die Anzahl.
pub async fn alle_loesen_tx(conn: &mut SqliteConnection, uhs_id: i64) -> Result<u64, AppError> {
    let r = sqlx::query("UPDATE einsatz_personal SET uhs_id = NULL WHERE uhs_id = ?")
        .bind(uhs_id)
        .execute(&mut *conn)
        .await?;
    Ok(r.rows_affected())
}

/// ETB: eine Kraft kommt an die UHS.
pub fn etb_text_zugeordnet(kraft: &str, uhs: &str) -> String {
    format!("«{kraft}» an UHS «{uhs}» eingesetzt")
}

/// ETB: eine Ad-hoc-Kraft wird an der UHS erfasst.
pub fn etb_text_adhoc(kraft: &str, uhs: &str) -> String {
    format!("Person «{kraft}» disponiert und an UHS «{uhs}» eingesetzt")
}

/// ETB: eine Kraft verlässt die UHS (bleibt im Einsatz).
pub fn etb_text_geloest(kraft: &str, uhs: &str) -> String {
    format!("«{kraft}» von UHS «{uhs}» abgezogen")
}

/// ETB: eine Einheit kommt an die UHS.
pub fn etb_text_einheit(einheit: &str, anzahl: u64, uhs: &str) -> String {
    let kraefte = if anzahl == 1 { "Kraft" } else { "Kräften" };
    format!("Einheit «{einheit}» mit {anzahl} {kraefte} an UHS «{uhs}» eingesetzt")
}

/// ETB: Auflösen oder Stornieren der UHS löst ihre Kräfte.
pub fn etb_text_alle_geloest(anzahl: u64, uhs: &str) -> String {
    let kraefte = if anzahl == 1 { "Kraft" } else { "Kräfte" };
    format!("{anzahl} {kraefte} von UHS «{uhs}» abgezogen")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn etb_texte() {
        assert_eq!(
            etb_text_zugeordnet("Anna (Notärztin)", "Nord"),
            "«Anna (Notärztin)» an UHS «Nord» eingesetzt"
        );
        assert_eq!(
            etb_text_geloest("Anna", "Nord"),
            "«Anna» von UHS «Nord» abgezogen"
        );
        assert_eq!(
            etb_text_einheit("SEG 1", 1, "Nord"),
            "Einheit «SEG 1» mit 1 Kraft an UHS «Nord» eingesetzt"
        );
        assert_eq!(
            etb_text_alle_geloest(3, "Nord"),
            "3 Kräfte von UHS «Nord» abgezogen"
        );
    }
}
