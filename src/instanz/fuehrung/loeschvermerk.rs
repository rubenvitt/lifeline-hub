//! Löschvermerk je Einsatzkennung (LLH-1699, Change `h7shm5au-loeschsignal-spiegellose-akten`,
//! design.md D4; `migrations/0343_fuehrung_loeschvermerk.sql`).
//!
//! Der Vermerk hält fest, dass der Einsatz einer Kennung zu Ende ist: Über diese Instanz ist er
//! nicht mehr zu haben. Er entsteht in der Transaktion, die den Anlass festschreibt:
//!
//! - ein Einsatz mit Kennung wird endgültig gelöscht (`einsatz::skelett_loeschung`) oder nach der
//!   Verwahrung abgeräumt (`einsatz::abraeumen`), oder der Führer meldet einen Spiegel gelöscht
//!   (`spiegel::lebensende::geloescht_uebernehmen`): je über [`vermerken_einsatz`];
//! - eine Akte ohne Spiegel wird auf ein Löschsignal hin oder beim Widerruf gelöscht
//!   (`fuehrung::repo::delete_ohne_spiegel` über [`vermerken`]).
//!
//! Kein Vermerk entsteht, wenn die meldende Seite einen Spiegel nach der Nachbereitung abräumt:
//! Der Einsatz lebt beim Führer weiter.
//!
//! Mit ihm belegt eine Instanz das Lebensende `geloescht` für eine Akte, die das Gegenüber ohne
//! Spiegel hält, auch für Kennungen mit fremdem Präfix ([`belegte`]). Ohne Vermerk meldet sie
//! nichts: eine aus einer Sicherung zurückgekehrte Instanz löscht beim Gegenüber keine Akte.

use crate::error::AppError;
use sqlx::SqliteConnection;

/// Hält das Ende der Kennung fest. Ein vorhandener Vermerk bekommt den neuen Zeitpunkt.
pub async fn vermerken(
    conn: &mut SqliteConnection,
    kennung: &str,
    org_id: i64,
) -> Result<(), AppError> {
    sqlx::query(
        "INSERT INTO fuehrung_loeschvermerk (kennung, org_id, vermerkt_at) VALUES (?, ?, ?) \
         ON CONFLICT (kennung) DO UPDATE SET org_id = excluded.org_id, \
            vermerkt_at = excluded.vermerkt_at",
    )
    .bind(kennung)
    .bind(org_id)
    .bind(crate::zeit::jetzt())
    .execute(&mut *conn)
    .await?;
    Ok(())
}

/// Hält das Ende des Einsatzes fest, bevor seine Zeile gelöscht wird. Ohne Kennung (nie
/// geliefert, keine Akte, Demo-Einsatz) entsteht kein Vermerk: Kein Gegenüber kennt ihn.
pub async fn vermerken_einsatz(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
) -> Result<(), AppError> {
    let kopf: Option<(Option<String>, i64)> =
        sqlx::query_as("SELECT kennung, org_id FROM einsatz WHERE id = ?")
            .bind(einsatz_id)
            .fetch_optional(&mut *conn)
            .await?;
    if let Some((Some(kennung), org_id)) = kopf {
        vermerken(conn, &kennung, org_id).await?;
    }
    Ok(())
}

/// Die genannten Kennungen, deren Ende ein Vermerk belegt: Seine Org ist dieser Kopplung aktiv
/// zugeordnet, und hier steht weder ein Einsatz noch eine Akte mit der Kennung (eine neu
/// gelieferte Akte macht ihren alten Vermerk wirkungslos). Eine Abfrage für die ganze Liste
/// (`src/AGENTS.md`, Listen von außen).
pub async fn belegte(
    conn: &mut SqliteConnection,
    kopplung_id: i64,
    kennungen: &[String],
) -> Result<Vec<String>, AppError> {
    if kennungen.is_empty() {
        return Ok(Vec::new());
    }
    let liste = serde_json::to_string(kennungen)
        .map_err(|e| AppError::Internal(format!("Kennungen nicht serialisierbar: {e}")))?;
    Ok(sqlx::query_scalar(
        "SELECT DISTINCT j.value FROM json_each(?1) j \
         WHERE EXISTS (SELECT 1 FROM fuehrung_loeschvermerk v \
                       JOIN instanz_kopplung_org o ON o.org_id = v.org_id \
                       WHERE v.kennung = j.value AND o.kopplung_id = ?2 \
                         AND o.widerrufen_at IS NULL) \
           AND NOT EXISTS (SELECT 1 FROM einsatz e WHERE e.kennung = j.value) \
           AND NOT EXISTS (SELECT 1 FROM einsatz_fuehrung f WHERE f.kennung = j.value) \
         ORDER BY j.key",
    )
    .bind(liste)
    .bind(kopplung_id)
    .fetch_all(&mut *conn)
    .await?)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::instanz::fuehrung::repo::tests::{einsatz, gekoppelt};

    async fn belegt(pool: &sqlx::SqlitePool, kennungen: &[&str]) -> Vec<String> {
        let mut conn = pool.acquire().await.unwrap();
        let k: Vec<String> = kennungen.iter().map(|k| (*k).to_string()).collect();
        belegte(&mut conn, 1, &k).await.unwrap()
    }

    async fn vermerk(pool: &sqlx::SqlitePool, kennung: &str, org_id: i64) {
        let mut conn = pool.acquire().await.unwrap();
        vermerken(&mut conn, kennung, org_id).await.unwrap();
    }

    #[tokio::test]
    async fn ein_vermerk_belegt_nur_seine_kennung() {
        let pool = crate::db::test_pool().await;
        gekoppelt(&pool).await;
        vermerk(&pool, "elw1/5-ab", 1).await;
        assert_eq!(
            belegt(&pool, &["fremd/1-xy", "elw1/5-ab", "elw1/5-ab"]).await,
            vec!["elw1/5-ab".to_string()],
            "unbekannte Kennung übergangen, doppelte einmal"
        );
        assert!(belegt(&pool, &[]).await.is_empty());
    }

    #[tokio::test]
    async fn ein_vermerk_einer_nicht_zugeordneten_org_belegt_nichts() {
        let pool = crate::db::test_pool().await;
        gekoppelt(&pool).await;
        sqlx::query("INSERT INTO organisation (id, name) VALUES (2, 'Andere')")
            .execute(&pool)
            .await
            .unwrap();
        vermerk(&pool, "elw1/5-ab", 2).await;
        assert!(belegt(&pool, &["elw1/5-ab"]).await.is_empty());
        // Auch eine widerrufene Zuordnung zählt nicht.
        vermerk(&pool, "elw1/6-cd", 1).await;
        assert_eq!(belegt(&pool, &["elw1/6-cd"]).await.len(), 1);
        sqlx::query("UPDATE instanz_kopplung_org SET widerrufen_at = '2026-11-01 00:00:00'")
            .execute(&pool)
            .await
            .unwrap();
        assert!(belegt(&pool, &["elw1/6-cd"]).await.is_empty());
    }

    #[tokio::test]
    async fn solange_einsatz_oder_akte_hier_stehen_belegt_der_vermerk_nichts() {
        let pool = crate::db::test_pool().await;
        gekoppelt(&pool).await;
        vermerk(&pool, "elw1/5-ab", 1).await;
        vermerk(&pool, "elw1/6-cd", 1).await;
        let e = einsatz(&pool, "Lage").await;
        sqlx::query("UPDATE einsatz SET kennung = 'elw1/5-ab' WHERE id = ?")
            .bind(e)
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query(
            "INSERT INTO einsatz_fuehrung (kennung, org_id, bezeichnung, status, epoche_zaehler, \
             epoche_instanz, fuehrer_kennung, fuehrer_name, art, stand, geaendert_at) \
             VALUES ('elw1/6-cd', 1, 'Akte', 'abgeschlossen', 1, 'elw1', 'elw1', 'ELW 1', \
             'angelegt', 1, '2026-11-01 00:00:00')",
        )
        .execute(&pool)
        .await
        .unwrap();
        assert!(belegt(&pool, &["elw1/5-ab", "elw1/6-cd"]).await.is_empty());
        sqlx::query("DELETE FROM einsatz_fuehrung")
            .execute(&pool)
            .await
            .unwrap();
        assert_eq!(
            belegt(&pool, &["elw1/5-ab", "elw1/6-cd"]).await,
            vec!["elw1/6-cd".to_string()]
        );
    }

    #[tokio::test]
    async fn der_vermerk_eines_einsatzes_traegt_seine_kennung_und_org() {
        let pool = crate::db::test_pool().await;
        gekoppelt(&pool).await;
        let mit = einsatz(&pool, "Mit Kennung").await;
        let ohne = einsatz(&pool, "Ohne Kennung").await;
        sqlx::query("UPDATE einsatz SET kennung = 'ich/7-ef' WHERE id = ?")
            .bind(mit)
            .execute(&pool)
            .await
            .unwrap();
        let mut conn = pool.acquire().await.unwrap();
        vermerken_einsatz(&mut conn, mit).await.unwrap();
        vermerken_einsatz(&mut conn, ohne).await.unwrap();
        vermerken_einsatz(&mut conn, 9999).await.unwrap();
        let vermerke: Vec<(String, i64)> =
            sqlx::query_as("SELECT kennung, org_id FROM fuehrung_loeschvermerk")
                .fetch_all(&mut *conn)
                .await
                .unwrap();
        assert_eq!(vermerke, vec![("ich/7-ef".to_string(), 1)]);
    }
}
