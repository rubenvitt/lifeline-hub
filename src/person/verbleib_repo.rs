use crate::error::AppError;
use crate::person::{VerbleibArt, VerbleibStatus};
use serde::Serialize;
use sqlx::SqlitePool;
use utoipa::ToSchema;

/// Ein Verbleib-Ereignis (1:1 zu `person_verbleib`).
#[derive(Debug, Clone, Serialize, sqlx::FromRow, ToSchema)]
pub struct VerbleibAnzeige {
    pub id: i64,
    pub einsatz_id: i64,
    pub person_id: i64,
    pub art: VerbleibArt,
    pub transportmittel: Option<String>,
    pub ziel: Option<String>,
    pub status: Option<VerbleibStatus>,
    pub notiz: Option<String>,
    pub zeitpunkt_at: String,
    pub erfasst_von: i64,
}

/// Eingabedaten beim Erfassen; Strings bereits getrimmt (Handler). `art`/`status`
/// sind bereits validiert (Handler via `VerbleibArt`).
#[derive(Debug)]
pub struct VerbleibDaten<'a> {
    pub art: &'a str,
    pub transportmittel: Option<&'a str>,
    pub ziel: Option<&'a str>,
    pub status: Option<&'a str>,
    pub notiz: Option<&'a str>,
}

const SELECT_VERBLEIB: &str = "\
    SELECT id, einsatz_id, person_id, art, transportmittel, ziel, status, notiz, \
           zeitpunkt_at, erfasst_von \
    FROM person_verbleib";

/// Erfasst ein Verbleib-Ereignis append-only und aktualisiert `aktueller_verbleib`
/// in DERSELBEN Transaktion. `kurzform` ist die vom Handler berechnete Cache-Kurzform.
pub async fn erfassen(
    pool: &SqlitePool,
    einsatz_id: i64,
    person_id: i64,
    daten: VerbleibDaten<'_>,
    kurzform: &str,
    erfasst_von: i64,
) -> Result<VerbleibAnzeige, AppError> {
    let mut tx = pool.begin().await?;
    let id: i64 = sqlx::query_scalar(
        "INSERT INTO person_verbleib \
            (einsatz_id, person_id, art, transportmittel, ziel, status, notiz, erfasst_von) \
         VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING id",
    )
    .bind(einsatz_id)
    .bind(person_id)
    .bind(daten.art)
    .bind(daten.transportmittel)
    .bind(daten.ziel)
    .bind(daten.status)
    .bind(daten.notiz)
    .bind(erfasst_von)
    .fetch_one(&mut *tx)
    .await?;
    sqlx::query(
        "UPDATE einsatz_person SET aktueller_verbleib = ? WHERE id = ? AND einsatz_id = ?",
    )
    .bind(kurzform)
    .bind(person_id)
    .bind(einsatz_id)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    laden(pool, einsatz_id, id).await
}

/// Lädt ein Verbleib-Ereignis; `NotFound`, falls nicht zum Einsatz.
pub async fn laden(pool: &SqlitePool, einsatz_id: i64, id: i64) -> Result<VerbleibAnzeige, AppError> {
    sqlx::query_as::<_, VerbleibAnzeige>(sqlx::AssertSqlSafe(format!("{SELECT_VERBLEIB} WHERE id = ? AND einsatz_id = ?")))
        .bind(id)
        .bind(einsatz_id)
        .fetch_optional(pool)
        .await?
        .ok_or(AppError::NotFound)
}

/// Verbleib-Verlauf einer Person (neueste zuerst).
pub async fn liste_je_person(
    pool: &SqlitePool,
    einsatz_id: i64,
    person_id: i64,
) -> Result<Vec<VerbleibAnzeige>, AppError> {
    Ok(sqlx::query_as::<_, VerbleibAnzeige>(sqlx::AssertSqlSafe(format!(
        "{SELECT_VERBLEIB} WHERE einsatz_id = ? AND person_id = ? \
         ORDER BY zeitpunkt_at DESC, id DESC"
    )))
    .bind(einsatz_id)
    .bind(person_id)
    .fetch_all(pool)
    .await?)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::test_pool;
    use sqlx::SqlitePool;

    async fn setup(pool: &SqlitePool) -> (i64, i64, i64) {
        sqlx::query("INSERT INTO organisation (id, name) VALUES (1, 'Test-Orga')")
            .execute(pool).await.unwrap();
        let b: i64 = sqlx::query_scalar(
            "INSERT INTO benutzer (org_id, anzeigename, benutzername, passwort_hash, system_rolle, org_rolle, aktiv) \
             VALUES (1, 'A', 'a', 'h', 'keiner', 'keine', 1) RETURNING id")
            .fetch_one(pool).await.unwrap();
        let e: i64 = sqlx::query_scalar(
            "INSERT INTO einsatz (org_id, bezeichnung, status, begonnen_at, einsatzart, angelegt_at) \
             VALUES (1, 'Lage', 'aktiv', '2026-05-27', 'realeinsatz', '2026-05-27') RETURNING id")
            .fetch_one(pool).await.unwrap();
        let p: i64 = sqlx::query_scalar(
            "INSERT INTO einsatz_person (einsatz_id, registrier_nr, erfasst_von, geaendert_von) \
             VALUES (?, 1, ?, ?) RETURNING id")
            .bind(e).bind(b).bind(b).fetch_one(pool).await.unwrap();
        (b, e, p)
    }

    fn daten<'a>(art: &'a str, ziel: Option<&'a str>) -> VerbleibDaten<'a> {
        VerbleibDaten { art, transportmittel: None, ziel, status: None, notiz: None }
    }

    #[tokio::test]
    async fn erfassen_ist_append_only_und_cache_spiegelt_juengsten() {
        let pool = test_pool().await;
        let (b, e, p) = setup(&pool).await;
        erfassen(&pool, e, p, daten("vor_ort", None), "vor Ort", b).await.unwrap();
        erfassen(&pool, e, p, daten("transport", Some("KH Mitte")), "Transport → KH Mitte", b).await.unwrap();
        let verlauf = liste_je_person(&pool, e, p).await.unwrap();
        assert_eq!(verlauf.len(), 2, "append-only");
        assert_eq!(verlauf[0].art, VerbleibArt::Transport, "neueste zuerst");
        let cache: Option<String> = sqlx::query_scalar(
            "SELECT aktueller_verbleib FROM einsatz_person WHERE id = ?")
            .bind(p).fetch_one(&pool).await.unwrap();
        assert_eq!(cache.as_deref(), Some("Transport → KH Mitte"));
    }
}
