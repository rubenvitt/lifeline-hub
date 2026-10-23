//! Erwartete Kräfte eines Bereitstellungsraums aus Nachforderungen (LLH-1387, design.md D1/D2,
//! Spec `nachforderung-einheit`): eine schmale Projektion für den Dialog „Eintreffen buchen“, auch
//! am gekoppelten Gerät des Raums. Sie trägt von den Freitexten einer Nachforderung nur Art und
//! Rufnamen der Zusage; Details, Begründung, Adressat, Ziel als Ort, Gründe und Ersteller bleiben
//! der Nachforderungsliste der Führung.

use super::{NachforderungStatus, STATUS_UNTERWEGS, STATUS_ZUGESAGT};
use crate::bereitstellungsraum::eintreffen::normalize;
use crate::error::AppError;
use serde::Serialize;
use sqlx::SqlitePool;
use utoipa::ToSchema;

/// Eine Nachforderung mit Ziel = Raum, deren Kräfte noch erwartet werden.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, ToSchema)]
pub struct ErwarteteKraft {
    pub nachforderung_id: i64,
    /// Art der Nachforderung („RTW“, „SEG“).
    pub art: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub anzahl: Option<i64>,
    /// `zugesagt` oder `unterwegs`.
    pub status: NachforderungStatus,
    /// Rufnamen der Zusage, die noch keine verknüpfte Einheit gleichen Namens oder Funkrufnamens
    /// tragen, in Eingabefolge.
    pub rufnamen: Vec<String>,
    /// Noch erwartete Anzahl: die Anzahl abzüglich der verknüpften Einheiten; fehlt ohne Anzahl.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub offen: Option<i64>,
    /// Voraussichtliches Eintreffen laut Zusage (UTC ohne Zone); fehlt ohne Angabe.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub eintreffen_erwartet_at: Option<String>,
}

/// Die erwarteten Kräfte des Raums `br_id`: Nachforderungen des Einsatzes mit diesem Ziel in
/// `zugesagt` oder `unterwegs`, deren Anzahl die verknüpften Einheiten noch nicht erreichen;
/// geordnet nach erwartetem Eintreffen (ohne Angabe zuletzt), dann Kennung. Den Raum (404) und
/// die Rechte prüft die Route.
pub async fn fuer_raum(
    pool: &SqlitePool,
    einsatz_id: i64,
    br_id: i64,
) -> Result<Vec<ErwarteteKraft>, AppError> {
    let zeilen: Vec<(i64, String, Option<i64>, String, String, Option<String>)> = sqlx::query_as(
        "SELECT n.id, n.art, n.anzahl, n.status, COALESCE(n.zusage_rufnamen, '[]'), \
                    n.eintreffen_erwartet_at \
             FROM nachforderung n \
             WHERE n.einsatz_id = ? AND n.ziel_br_id = ? AND n.status IN (?, ?) \
             ORDER BY n.eintreffen_erwartet_at IS NULL, n.eintreffen_erwartet_at, n.id",
    )
    .bind(einsatz_id)
    .bind(br_id)
    .bind(STATUS_ZUGESAGT)
    .bind(STATUS_UNTERWEGS)
    .fetch_all(pool)
    .await?;
    let mut ergebnis = Vec::with_capacity(zeilen.len());
    for (id, art, anzahl, status, rufnamen, eta) in zeilen {
        let verknuepft: Vec<(String, Option<String>)> = sqlx::query_as(
            "SELECT name, funkrufname FROM einsatz_einheit \
             WHERE einsatz_id = ? AND nachforderung_id = ?",
        )
        .bind(einsatz_id)
        .bind(id)
        .fetch_all(pool)
        .await?;
        let zahl = i64::try_from(verknuepft.len()).unwrap_or(i64::MAX);
        let offen = anzahl.map(|a| (a - zahl).max(0));
        if offen == Some(0) {
            continue;
        }
        let rufnamen: Vec<String> = serde_json::from_str(&rufnamen)
            .map_err(|e| AppError::Internal(format!("Rufnamen unlesbar: {e}")))?;
        let rufnamen = offene_rufnamen(rufnamen, &verknuepft);
        let status = NachforderungStatus::try_from(status).map_err(AppError::Internal)?;
        ergebnis.push(ErwarteteKraft {
            nachforderung_id: id,
            art,
            anzahl,
            status,
            rufnamen,
            offen,
            eintreffen_erwartet_at: eta,
        });
    }
    Ok(ergebnis)
}

/// Rufnamen ohne verknüpfte Einheit gleichen Namens oder Funkrufnamens (nach [`normalize`]).
fn offene_rufnamen(rufnamen: Vec<String>, verknuepft: &[(String, Option<String>)]) -> Vec<String> {
    rufnamen
        .into_iter()
        .filter(|r| {
            let schluessel = normalize(r);
            !verknuepft.iter().any(|(name, funk)| {
                normalize(name) == schluessel
                    || funk.as_deref().is_some_and(|f| normalize(f) == schluessel)
            })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn verknuepfte_rufnamen_fallen_weg() {
        let offen = offene_rufnamen(
            vec!["83-1".into(), "Florian 2".into(), "83-3".into()],
            &[
                (" 83-1 ".into(), None),
                ("LF".into(), Some("florian  2".into())),
            ],
        );
        assert_eq!(offen, vec!["83-3".to_string()]);
    }
}
