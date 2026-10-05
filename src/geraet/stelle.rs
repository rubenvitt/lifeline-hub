//! Stellenbindung der UHS-Ansichten (LFH-892, Spec `funktionsansichten`, „Stellenbindung“).
//!
//! Ein UHS-Tablet oder -Laptop sieht und schreibt nur in der UHS seiner Kopplung. Die
//! Routenschranke in `CurrentUser` lässt die UHS- und Personenrouten zu; welche UHS und welche
//! Person dahinter liegt, prüft der Handler über diese Helfer. Für eine Person und den
//! Lagemonitor sind sie wirkungslos: `stelle` ist dann `None`.
//!
//! Lesen über eine fremde UHS oder Person ist 404 (das Gerät erfährt nicht, dass es sie gibt),
//! Schreiben in eine fremde UHS bei einer sichtbaren Person 403.

use super::GeraetKontext;
use crate::error::AppError;
use sqlx::SqlitePool;
use std::collections::HashSet;

/// Die UHS der Kopplung, wenn die Sitzung ein stellengebundenes Gerät ist.
pub fn stelle(geraet: Option<&GeraetKontext>) -> Option<i64> {
    geraet
        .filter(|g| g.ansicht.ist_stellengebunden())
        .and_then(|g| g.uhs_id)
}

/// Lesen oder Bearbeiten an einer UHS: eine fremde ist für das Gerät nicht vorhanden (404).
pub fn fordere_uhs(geraet: Option<&GeraetKontext>, uhs_id: i64) -> Result<(), AppError> {
    match stelle(geraet) {
        Some(eigene) if eigene != uhs_id => Err(AppError::NotFound),
        _ => Ok(()),
    }
}

/// Eine Person in eine UHS buchen oder aus ihr nehmen: nur die eigene (403).
pub fn fordere_ziel_uhs(
    geraet: Option<&GeraetKontext>,
    uhs_id: Option<i64>,
) -> Result<(), AppError> {
    match stelle(geraet) {
        Some(eigene) if uhs_id != Some(eigene) => Err(AppError::Forbidden),
        _ => Ok(()),
    }
}

/// Personen mit mindestens einer Belegung in der UHS, auch nach ihrem Austritt.
pub async fn personen_der_uhs(pool: &SqlitePool, uhs_id: i64) -> Result<HashSet<i64>, AppError> {
    let ids: Vec<i64> =
        sqlx::query_scalar("SELECT DISTINCT person_id FROM person_uhs_belegung WHERE uhs_id = ?")
            .bind(uhs_id)
            .fetch_all(pool)
            .await?;
    Ok(ids.into_iter().collect())
}

/// Eine Person ist für das Gerät sichtbar, wenn sie je in der eigenen UHS belegt war; sonst 404.
pub async fn fordere_person(
    pool: &SqlitePool,
    geraet: Option<&GeraetKontext>,
    person_id: i64,
) -> Result<(), AppError> {
    let Some(eigene) = stelle(geraet) else {
        return Ok(());
    };
    let gefunden: Option<i64> = sqlx::query_scalar(
        "SELECT 1 FROM person_uhs_belegung WHERE uhs_id = ? AND person_id = ? LIMIT 1",
    )
    .bind(eigene)
    .bind(person_id)
    .fetch_optional(pool)
    .await?;
    gefunden.map(|_| ()).ok_or(AppError::NotFound)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::geraet::Funktionsansicht;

    fn geraet(ansicht: Funktionsansicht, uhs_id: Option<i64>) -> GeraetKontext {
        GeraetKontext {
            kopplung_id: 1,
            einsatz_id: 1,
            ansicht,
            uhs_id,
            bezeichnung: "Tablet 1".into(),
            laeuft_ab_at: "2026-10-05 12:00:00".into(),
        }
    }

    #[test]
    fn person_und_lagemonitor_sind_nicht_gebunden() {
        assert_eq!(stelle(None), None);
        let monitor = geraet(Funktionsansicht::Lagemonitor, None);
        assert_eq!(stelle(Some(&monitor)), None);
        assert!(fordere_uhs(Some(&monitor), 9).is_ok());
        assert!(fordere_ziel_uhs(None, Some(9)).is_ok());
    }

    #[test]
    fn fremde_uhs_ist_404_beim_lesen_und_403_beim_buchen() {
        let tablet = geraet(Funktionsansicht::UhsTablet, Some(2));
        assert!(fordere_uhs(Some(&tablet), 2).is_ok());
        assert!(matches!(
            fordere_uhs(Some(&tablet), 3),
            Err(AppError::NotFound)
        ));
        assert!(fordere_ziel_uhs(Some(&tablet), Some(2)).is_ok());
        assert!(matches!(
            fordere_ziel_uhs(Some(&tablet), Some(3)),
            Err(AppError::Forbidden)
        ));
        assert!(matches!(
            fordere_ziel_uhs(Some(&tablet), None),
            Err(AppError::Forbidden)
        ));
    }
}
