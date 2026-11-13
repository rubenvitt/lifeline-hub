//! Gemeinsames der Freigaben, die die Einsatzleitung an dieser Instanz erteilt und die nicht
//! gespiegelt werden: das Lagebild für Externe (`routes::lagebild_extern`, LLH-1496) und die
//! Freigabe eines Einsatzes für einen Maschinenzugang (`routes::einsatz_anbindungen`, LLH-1638).
//!
//! Beide gelten an jeder Instanz, die den Einsatz hat, geführt oder als Spiegel. Am Spiegel
//! sperrt der Schutz-Trigger das ETB; der Eintrag geht dann als Antrag an den Führer.

use crate::einsatz::kontext::EinsatzLesezugriff;
use crate::error::AppError;
use crate::etb::EtbTyp;
use sqlx::SqliteConnection;

/// Darf die Einsatzleitung hier freigeben? Aktiver Einsatz, und diese Instanz führt ihn oder hält
/// ihn als Spiegel. Wer einen Einsatz nicht führt, hält ihn als Spiegel, der ETB-Eintrag geht
/// dann als Antrag an den Führer (LLH-1641, ADR-0040).
pub(crate) fn fordere_freigabe_moeglich(ctx: &EinsatzLesezugriff) -> Result<(), AppError> {
    ctx.fordere_einsatzleitung()?;
    if !ctx.einsatz.ist_aktiv() {
        return Err(AppError::Conflict(
            "Einsatz ist abgeschlossen und schreibgeschützt".into(),
        ));
    }
    Ok(())
}

/// Prüfung in der Transaktion: der Status des Einsatzes (`fordere_aktiv_in_tx` beim Führer). Am
/// Spiegel führt immer die andere Instanz, der Eintrag geht dort als Antrag.
pub(crate) async fn im_tx_aktiv(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    spiegel: bool,
) -> Result<(), AppError> {
    if !spiegel {
        return crate::einsatz::repo::fordere_aktiv_in_tx(conn, einsatz_id).await;
    }
    let status: Option<String> = sqlx::query_scalar("SELECT status FROM einsatz WHERE id = ?")
        .bind(einsatz_id)
        .fetch_optional(&mut *conn)
        .await?;
    if status.as_deref() != Some("aktiv") {
        return Err(AppError::Conflict(
            "Einsatz ist abgeschlossen und schreibgeschützt".into(),
        ));
    }
    Ok(())
}

/// Von und An des Antrags am Spiegel: beim Führer ist es eine Entscheidung der Person an den
/// Empfänger der Freigabe.
#[derive(Clone, Copy)]
pub(crate) struct SpiegelEintrag<'a> {
    pub von: &'a str,
    pub an: &'a str,
}

/// Schreibt den ETB-Eintrag einer Freigabe: beim Führer als Systemeintrag, am Spiegel als Antrag
/// an den Führer. Liefert die id eines direkt geschriebenen Eintrags.
pub(crate) async fn etb_vermerken(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    spiegel: Option<SpiegelEintrag<'_>>,
    von: i64,
    text: &str,
) -> Result<Option<i64>, AppError> {
    if let Some(s) = spiegel {
        crate::instanz::spiegel::antrag::etb_beantragen_tx(
            conn,
            einsatz_id,
            von,
            EtbTyp::Entscheidung,
            text,
            s.von,
            s.an,
        )
        .await?;
        return Ok(None);
    }
    let startwert = crate::einsatz::einstellungen::etb_startwert(&mut *conn, einsatz_id).await?;
    Ok(Some(
        crate::etb::system_audit_tx(conn, einsatz_id, von, startwert, text).await?,
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    async fn einsatz(pool: &sqlx::SqlitePool, status: &str) -> i64 {
        sqlx::query("INSERT OR IGNORE INTO organisation (id, name) VALUES (1, 'Orga')")
            .execute(pool)
            .await
            .unwrap();
        sqlx::query_scalar(
            "INSERT INTO einsatz (org_id, bezeichnung, status) VALUES (1, 'Lage', ?) RETURNING id",
        )
        .bind(status)
        .fetch_one(pool)
        .await
        .unwrap()
    }

    /// Die Prüfung in der Transaktion: Der Extractor sah den Einsatz noch aktiv, der Abschluss
    /// kam dazwischen. Dann darf keine Freigabe entstehen, geführt wie am Spiegel.
    #[tokio::test]
    async fn abgeschlossener_einsatz_ist_in_der_transaktion_409() {
        let pool = crate::db::test_pool().await;
        let aktiv = einsatz(&pool, "aktiv").await;
        let zu = einsatz(&pool, "abgeschlossen").await;
        let mut c = pool.acquire().await.unwrap();
        for spiegel in [false, true] {
            assert!(im_tx_aktiv(&mut c, aktiv, spiegel).await.is_ok());
            assert!(
                matches!(
                    im_tx_aktiv(&mut c, zu, spiegel).await,
                    Err(AppError::Conflict(_))
                ),
                "spiegel = {spiegel}"
            );
        }
        // Ein Einsatz, den es nicht (mehr) gibt, ist am Spiegel ebenfalls kein aktiver.
        assert!(matches!(
            im_tx_aktiv(&mut c, 9999, true).await,
            Err(AppError::Conflict(_))
        ));
    }
}
