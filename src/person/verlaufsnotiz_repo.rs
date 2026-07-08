use crate::error::AppError;
use serde::Serialize;
use sqlx::SqlitePool;
use utoipa::ToSchema;

/// Eine medizinische Verlaufsnotiz (1:1 zu `person_verlaufsnotiz`).
#[derive(Debug, Clone, Serialize, sqlx::FromRow, ToSchema)]
pub struct NotizAnzeige {
    pub id: i64,
    pub einsatz_id: i64,
    pub person_id: i64,
    pub text: String,
    pub erfasst_at: String,
    pub erfasst_von: i64,
}

const SELECT_NOTIZ: &str = "\
    SELECT id, einsatz_id, person_id, text, erfasst_at, erfasst_von \
    FROM person_verlaufsnotiz";

/// Legt eine append-only Befundnotiz an. `text` ist bereits getrimmt (Handler).
pub async fn anlegen(
    pool: &SqlitePool,
    einsatz_id: i64,
    person_id: i64,
    text: &str,
    erfasst_von: i64,
) -> Result<NotizAnzeige, AppError> {
    let id: i64 = sqlx::query_scalar(
        "INSERT INTO person_verlaufsnotiz (einsatz_id, person_id, text, erfasst_von) \
         VALUES (?, ?, ?, ?) RETURNING id",
    )
    .bind(einsatz_id)
    .bind(person_id)
    .bind(text)
    .bind(erfasst_von)
    .fetch_one(pool)
    .await?;
    sqlx::query_as::<_, NotizAnzeige>(sqlx::AssertSqlSafe(format!("{SELECT_NOTIZ} WHERE id = ?")))
        .bind(id)
        .fetch_one(pool)
        .await
        .map_err(Into::into)
}

/// Notizen einer Person (neueste zuerst).
pub async fn liste_je_person(
    pool: &SqlitePool,
    einsatz_id: i64,
    person_id: i64,
) -> Result<Vec<NotizAnzeige>, AppError> {
    Ok(sqlx::query_as::<_, NotizAnzeige>(sqlx::AssertSqlSafe(format!(
        "{SELECT_NOTIZ} WHERE einsatz_id = ? AND person_id = ? \
         ORDER BY erfasst_at DESC, id DESC"
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

    #[tokio::test]
    async fn anlegen_ist_append_only_und_liste_neueste_zuerst() {
        let pool = test_pool().await;
        let (b, e, p) = setup(&pool).await;
        anlegen(&pool, e, p, "Platzwunde Stirn", b).await.unwrap();
        anlegen(&pool, e, p, "stabil, ansprechbar", b).await.unwrap();
        let notizen = liste_je_person(&pool, e, p).await.unwrap();
        assert_eq!(notizen.len(), 2);
        assert_eq!(notizen[0].text, "stabil, ansprechbar", "neueste zuerst");
    }
}
