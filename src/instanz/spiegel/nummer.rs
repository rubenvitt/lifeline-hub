//! Einsatznummer beim Übergang vom Spiegel zum eigenen Einsatz (Spec `einsatznummer`, „Freie
//! Nummer, wenn ein Spiegel zum eigenen Einsatz wird“; LLH-1647, LLH-1703).
//!
//! ELW und Hub vergeben Einsatznummern unabhängig; ein Spiegel ist von ihrer Eindeutigkeit
//! ausgenommen (`idx_einsatz_nummer… WHERE spiegel = 0`). Sobald die Zeile in `einsatz_spiegel`
//! fällt, gilt die Eindeutigkeit wieder. Jeder Weg, der sie entfernt, ruft deshalb vorher
//! [`ensure_freie_nummer`].

use crate::error::AppError;
use sqlx::SqliteConnection;

/// Vergibt eine eigene Nummer, wenn die des Spiegels in seiner Org schon ein eigener Einsatz oder
/// das Löschprotokoll trägt. Liefert (alt, neu) bei einer Umnummerierung. Läuft unter dem Merker.
pub(super) async fn ensure_freie_nummer(
    conn: &mut SqliteConnection,
    id: i64,
) -> Result<Option<(String, String)>, AppError> {
    let (org_id, nummer, jahr, lfd): (i64, String, Option<i64>, Option<i64>) = sqlx::query_as(
        "SELECT org_id, einsatznummer_intern, nummer_jahr, nummer_lfd FROM einsatz WHERE id = ?",
    )
    .bind(id)
    .fetch_one(&mut *conn)
    .await?;
    let belegt: bool = sqlx::query_scalar(
        "SELECT EXISTS (SELECT 1 FROM einsatz WHERE org_id = ?1 AND spiegel = 0 AND id <> ?2 \
                        AND (einsatznummer_intern = ?3 \
                             OR (nummer_jahr = ?4 AND nummer_lfd = ?5))) \
             OR EXISTS (SELECT 1 FROM aufbewahrung_loeschprotokoll WHERE org_id = ?1 \
                        AND (einsatznummer_intern = ?3 \
                             OR (nummer_jahr = ?4 AND nummer_lfd = ?5)))",
    )
    .bind(org_id)
    .bind(id)
    .bind(&nummer)
    .bind(jahr)
    .bind(lfd)
    .fetch_one(&mut *conn)
    .await?;
    if !belegt {
        return Ok(None);
    }
    let (praefix, zeitzone): (Option<String>, Option<String>) = sqlx::query_as(
        "SELECT einsatz_nummer_praefix, zeitzone FROM org_einstellungen WHERE org_id = ?",
    )
    .bind(org_id)
    .fetch_optional(&mut *conn)
    .await?
    .unwrap_or((None, None));
    let jahr = match jahr {
        Some(j) => j,
        None => i64::from(crate::einsatz::nummer::jahr_in_zone(
            chrono::Utc::now(),
            zeitzone.as_deref(),
        )),
    };
    // Wie bei der Anlage: über allen Einsätzen (auch Spiegeln) und dem Löschprotokoll.
    let max_lfd: Option<i64> = sqlx::query_scalar(
        "SELECT MAX(lfd) FROM ( \
             SELECT nummer_lfd AS lfd FROM einsatz WHERE org_id = ?1 AND nummer_jahr = ?2 \
             UNION ALL \
             SELECT nummer_lfd FROM aufbewahrung_loeschprotokoll \
             WHERE org_id = ?1 AND nummer_jahr = ?2)",
    )
    .bind(org_id)
    .bind(jahr)
    .fetch_one(&mut *conn)
    .await?;
    let mut neu_lfd = max_lfd.unwrap_or(0) + 1;
    let neu = loop {
        let kandidat = crate::einsatz::nummer::formatiere(
            praefix.as_deref(),
            i32::try_from(jahr).unwrap_or(0),
            neu_lfd,
        );
        let vergeben: bool = sqlx::query_scalar(
            "SELECT EXISTS (SELECT 1 FROM einsatz WHERE org_id = ?1 AND einsatznummer_intern = ?2) \
                 OR EXISTS (SELECT 1 FROM aufbewahrung_loeschprotokoll \
                            WHERE org_id = ?1 AND einsatznummer_intern = ?2)",
        )
        .bind(org_id)
        .bind(&kandidat)
        .fetch_one(&mut *conn)
        .await?;
        if !vergeben {
            break kandidat;
        }
        neu_lfd += 1;
    };
    sqlx::query(
        "UPDATE einsatz SET einsatznummer_intern = ?, nummer_jahr = ?, nummer_lfd = ? WHERE id = ?",
    )
    .bind(&neu)
    .bind(jahr)
    .bind(neu_lfd)
    .bind(id)
    .execute(&mut *conn)
    .await?;
    Ok(Some((nummer, neu)))
}
