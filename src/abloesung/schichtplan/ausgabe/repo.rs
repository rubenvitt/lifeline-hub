//! Lädt den [`AusgabePlan`] eines Einsatzes bzw. einer Planung (design.md D1, D5). Die Rechte
//! prüfen die Routen; hier wird nur gelesen.

use std::collections::HashMap;

use sqlx::{SqliteConnection, SqlitePool};

use super::plan::{
    aus_einsatz, aus_planung, AusgabeKopf, AusgabePlan, EinsatzGliederung, QualiNamen, Quelle,
};
use crate::abloesung::schichtplan::repo as plan_repo;
use crate::einsatz::Einsatz;
use crate::error::AppError;
use crate::zeit;

/// Was der Benutzer außer Ablösung und Personal sieht: ohne Modul Einheiten bzw.
/// Unfallhilfsstellen stehen deren Posten ohne Abschnitt, wie im Raster.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Sicht {
    pub einheiten: bool,
    pub uhs: bool,
}

async fn quali_namen(conn: &mut SqliteConnection, org_id: i64) -> Result<QualiNamen, AppError> {
    let zeilen: Vec<(i64, String)> =
        sqlx::query_as("SELECT id, label FROM qualifikation WHERE org_id = ?")
            .bind(org_id)
            .fetch_all(&mut *conn)
            .await?;
    Ok(zeilen.into_iter().collect())
}

/// Der wirksame Abschnitt jeder Einheit: ihr eigener, sonst der der nächsten übergeordneten
/// (wie `abschnittDerEinheit` im Frontend). Ein Kreis bricht ab.
fn wirksame_abschnitte(einheiten: &[(i64, Option<i64>, Option<i64>)]) -> Vec<(i64, Option<i64>)> {
    let je_id: HashMap<i64, (Option<i64>, Option<i64>)> =
        einheiten.iter().map(|(id, a, u)| (*id, (*a, *u))).collect();
    einheiten
        .iter()
        .map(|(id, _, _)| {
            let mut aktuell = Some(*id);
            for _ in 0..=einheiten.len() {
                let Some((abschnitt, ueber)) = aktuell.and_then(|i| je_id.get(&i)) else {
                    break;
                };
                if abschnitt.is_some() {
                    return (*id, *abschnitt);
                }
                aktuell = *ueber;
            }
            (*id, None)
        })
        .collect()
}

async fn gliederung(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    sicht: Sicht,
) -> Result<EinsatzGliederung, AppError> {
    let abschnitte: Vec<(i64, String)> = sqlx::query_as(
        "SELECT id, name FROM einsatzabschnitt WHERE einsatz_id = ? \
         ORDER BY sortier, name COLLATE NOCASE, id",
    )
    .bind(einsatz_id)
    .fetch_all(&mut *conn)
    .await?;
    // Auch aufgelöste Einheiten und UHS: ihre Blöcke stehen noch im Plan.
    let einheiten: Vec<(i64, Option<i64>, Option<i64>)> = sqlx::query_as(
        "SELECT id, abschnitt_id, ueber_einheit_id FROM einsatz_einheit WHERE einsatz_id = ? \
         ORDER BY sortier, name COLLATE NOCASE, id",
    )
    .bind(einsatz_id)
    .fetch_all(&mut *conn)
    .await?;
    let uhs: Vec<(i64, Option<i64>)> = sqlx::query_as(
        "SELECT id, abschnitt_id FROM uhs WHERE einsatz_id = ? \
         ORDER BY bezeichnung COLLATE NOCASE, id",
    )
    .bind(einsatz_id)
    .fetch_all(&mut *conn)
    .await?;
    let mut einheiten = wirksame_abschnitte(&einheiten);
    let mut uhs = uhs;
    if !sicht.einheiten {
        einheiten.iter_mut().for_each(|e| e.1 = None);
    }
    if !sicht.uhs {
        uhs.iter_mut().for_each(|u| u.1 = None);
    }
    Ok(EinsatzGliederung {
        abschnitte,
        einheiten,
        uhs,
    })
}

/// Der Plan eines Einsatzes mit Personen (die Route verlangt das Modul Personal).
pub async fn einsatz(
    pool: &SqlitePool,
    einsatz: &Einsatz,
    sicht: Sicht,
    jetzt: &str,
) -> Result<AusgabePlan, AppError> {
    let plan = plan_repo::laden(pool, einsatz.id, einsatz.org_id, true, jetzt).await?;
    let mut conn = pool.acquire().await?;
    let stil = crate::zeitdarstellung::zeitstil_laden(&mut *conn, einsatz.id).await?;
    let gliederung = gliederung(&mut conn, einsatz.id, sicht).await?;
    let quali = quali_namen(&mut conn, einsatz.org_id).await?;
    let kopf = AusgabeKopf {
        quelle: Quelle::Einsatz,
        titel: einsatz.bezeichnung.clone(),
        ort: einsatz.einsatzort.clone(),
        zone: stil.zone,
        zeitraum: None,
        stand: zeit::parse_utc(jetzt)
            .ok_or_else(|| AppError::Internal(format!("Ungültige Zeit {jetzt}")))?,
    };
    Ok(aus_einsatz(kopf, &plan, &gliederung, &quali))
}

/// Eine Planung der Organisation (fremd oder unbekannt 404).
pub async fn planung(
    pool: &SqlitePool,
    org_id: i64,
    planung_id: i64,
    jetzt: &str,
) -> Result<AusgabePlan, AppError> {
    let anzeige = crate::planung::repo::laden(pool, org_id, planung_id).await?;
    let mut conn = pool.acquire().await?;
    let stil = crate::planung::repo::zeitstil_org(&mut conn, org_id).await?;
    let quali = quali_namen(&mut conn, org_id).await?;
    let k = &anzeige.kopf;
    let zeitraum = zeit::parse_utc(&k.von).zip(zeit::parse_utc(&k.bis));
    let kopf = AusgabeKopf {
        quelle: Quelle::Planung,
        titel: k.bezeichnung.clone(),
        ort: k.ort.clone(),
        zone: stil.zone,
        zeitraum,
        stand: zeit::parse_utc(jetzt)
            .ok_or_else(|| AppError::Internal(format!("Ungültige Zeit {jetzt}")))?,
    };
    Ok(aus_planung(kopf, &anzeige, &quali))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn abschnitt_wird_geerbt_und_ein_kreis_bricht_ab() {
        let e = [
            (1, Some(10), None),
            (2, None, Some(1)),
            (3, None, Some(2)),
            (4, None, Some(5)),
            (5, None, Some(4)),
        ];
        assert_eq!(
            wirksame_abschnitte(&e),
            vec![
                (1, Some(10)),
                (2, Some(10)),
                (3, Some(10)),
                (4, None),
                (5, None)
            ]
        );
    }
}
