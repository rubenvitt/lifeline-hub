use crate::error::AppError;
use serde::Serialize;
use sqlx::SqlitePool;
use utoipa::ToSchema;

/// LFH-120: Schema-Anker für die `art`-Union. Wire = DB-CHECK
/// `art IN ('detail','export')` (migrations/0021_person_zugriff_audit.sql).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum ZugriffArt {
    Detail,
    Export,
}

/// Ein Audit-Eintrag mit aufgelöstem Benutzernamen (für die Audit-Einsicht).
#[derive(Debug, Clone, Serialize, sqlx::FromRow, ToSchema)]
pub struct ZugriffAnzeige {
    pub id: i64,
    pub person_id: Option<i64>,
    pub benutzer_id: i64,
    pub benutzer_name: String,
    #[schema(value_type = ZugriffArt)]
    pub art: String,
    pub zugriff_at: String,
}

/// Schreibt einen append-only Audit-Eintrag. `person_id = None` beim Export der
/// gesamten Liste. `art` ist 'detail' oder 'export'.
pub async fn anlegen(
    pool: &SqlitePool,
    einsatz_id: i64,
    person_id: Option<i64>,
    benutzer_id: i64,
    art: &str,
) -> Result<(), AppError> {
    sqlx::query(
        "INSERT INTO person_zugriff_audit (einsatz_id, person_id, benutzer_id, art) \
         VALUES (?, ?, ?, ?)",
    )
    .bind(einsatz_id)
    .bind(person_id)
    .bind(benutzer_id)
    .bind(art)
    .execute(pool)
    .await?;
    Ok(())
}

/// Audit-Einträge einer Person (neueste zuerst), mit Benutzername.
pub async fn liste_je_person(
    pool: &SqlitePool,
    einsatz_id: i64,
    person_id: i64,
) -> Result<Vec<ZugriffAnzeige>, AppError> {
    Ok(sqlx::query_as::<_, ZugriffAnzeige>(
        "SELECT a.id, a.person_id, a.benutzer_id, b.anzeigename AS benutzer_name, \
                a.art, a.zugriff_at \
         FROM person_zugriff_audit a JOIN benutzer b ON b.id = a.benutzer_id \
         WHERE a.einsatz_id = ? AND a.person_id = ? \
         ORDER BY a.zugriff_at DESC, a.id DESC",
    )
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
            .execute(pool)
            .await
            .unwrap();
        let benutzer_id: i64 = sqlx::query_scalar(
            "INSERT INTO benutzer (org_id, anzeigename, benutzername, passwort_hash, system_rolle, org_rolle, aktiv) \
             VALUES (1, 'A', 'a', 'h', 'keiner', 'keine', 1) RETURNING id")
            .fetch_one(pool).await.unwrap();
        let einsatz_id: i64 = sqlx::query_scalar(
            "INSERT INTO einsatz (org_id, bezeichnung, status, begonnen_at) \
             VALUES (1, 'Lage', 'aktiv', '2026-05-27') RETURNING id",
        )
        .fetch_one(pool)
        .await
        .unwrap();
        let person_id: i64 = sqlx::query_scalar(
            "INSERT INTO einsatz_person (einsatz_id, registrier_nr, erfasst_von, geaendert_von) \
             VALUES (?, 1, ?, ?) RETURNING id",
        )
        .bind(einsatz_id)
        .bind(benutzer_id)
        .bind(benutzer_id)
        .fetch_one(pool)
        .await
        .unwrap();
        (benutzer_id, einsatz_id, person_id)
    }

    #[tokio::test]
    async fn anlegen_und_liste_je_person() {
        let pool = test_pool().await;
        let (b, e, p) = setup(&pool).await;
        anlegen(&pool, e, Some(p), b, "detail").await.unwrap();
        anlegen(&pool, e, Some(p), b, "detail").await.unwrap();
        let eintraege = liste_je_person(&pool, e, p).await.unwrap();
        assert_eq!(eintraege.len(), 2);
        assert_eq!(eintraege[0].art, "detail");
        assert_eq!(eintraege[0].benutzer_name, "A");
    }

    #[tokio::test]
    async fn export_eintrag_ohne_person() {
        let pool = test_pool().await;
        let (b, e, _p) = setup(&pool).await;
        anlegen(&pool, e, None, b, "export").await.unwrap();
        let count: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM person_zugriff_audit WHERE einsatz_id = ? AND art = 'export'",
        )
        .bind(e)
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(count, 1);
    }
}
