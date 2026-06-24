use super::PersonalStatus;
use crate::error::AppError;
use sqlx::SqlitePool;

const SPALTEN: &str = "id, label, kategorie, farbe, sortier";

/// Editierbare Katalog-Felder. `kategorie` ist bereits gegen das Enum validiert.
#[derive(Debug)]
pub struct StatusDaten<'a> {
    pub label: &'a str,
    pub kategorie: &'a str,
    pub farbe: Option<&'a str>,
    pub sortier: i64,
}

fn label_conflict<T>(e: sqlx::Error) -> Result<T, AppError> {
    if let sqlx::Error::Database(db) = &e {
        if db.is_unique_violation() {
            return Err(AppError::Conflict("Status-Label ist bereits vorhanden".into()));
        }
    }
    Err(e.into())
}

/// Lädt einen Status der Org (ignoriert `aktiv`); `NotFound` bei fremder id.
pub async fn laden(pool: &SqlitePool, org_id: i64, id: i64) -> Result<PersonalStatus, AppError> {
    sqlx::query_as::<_, PersonalStatus>(sqlx::AssertSqlSafe(format!(
        "SELECT {SPALTEN} FROM personal_status WHERE id = ? AND org_id = ?"
    )))
    .bind(id)
    .bind(org_id)
    .fetch_optional(pool)
    .await?
    .ok_or(AppError::NotFound)
}

/// Nur aktive Status der Org, sortiert nach `sortier`, dann `id`.
pub async fn liste(pool: &SqlitePool, org_id: i64) -> Result<Vec<PersonalStatus>, AppError> {
    sqlx::query_as::<_, PersonalStatus>(sqlx::AssertSqlSafe(format!(
        "SELECT {SPALTEN} FROM personal_status WHERE org_id = ? AND aktiv = 1 ORDER BY sortier, id"
    )))
    .bind(org_id)
    .fetch_all(pool)
    .await
    .map_err(Into::into)
}

/// Legt einen Status an. Dublette `label` je Org → `Conflict`.
pub async fn anlegen(
    pool: &SqlitePool,
    org_id: i64,
    daten: StatusDaten<'_>,
) -> Result<PersonalStatus, AppError> {
    let ergebnis = sqlx::query_scalar::<_, i64>(
        "INSERT INTO personal_status (org_id, label, kategorie, farbe, sortier) \
         VALUES (?, ?, ?, ?, ?) RETURNING id",
    )
    .bind(org_id)
    .bind(daten.label)
    .bind(daten.kategorie)
    .bind(daten.farbe)
    .bind(daten.sortier)
    .fetch_one(pool)
    .await;

    let id = match ergebnis {
        Ok(id) => id,
        Err(e) => return label_conflict(e),
    };
    laden(pool, org_id, id).await
}

/// Vollersatz der editierbaren Felder (org-scoped). `NotFound`/`Conflict` analog Stamm.
pub async fn aktualisiere(
    pool: &SqlitePool,
    org_id: i64,
    id: i64,
    daten: StatusDaten<'_>,
) -> Result<PersonalStatus, AppError> {
    let ergebnis = sqlx::query(
        "UPDATE personal_status SET label = ?, kategorie = ?, farbe = ?, sortier = ? \
         WHERE id = ? AND org_id = ?",
    )
    .bind(daten.label)
    .bind(daten.kategorie)
    .bind(daten.farbe)
    .bind(daten.sortier)
    .bind(id)
    .bind(org_id)
    .execute(pool)
    .await;

    let resultat = match ergebnis {
        Ok(r) => r,
        Err(e) => return label_conflict(e),
    };
    if resultat.rows_affected() == 0 {
        return Err(AppError::NotFound);
    }
    laden(pool, org_id, id).await
}

/// Deaktiviert einen Status (Soft-Delete `aktiv = 0`); referenzierte Dispositionen
/// bleiben gültig. `NotFound` bei fremder/unbekannter id.
pub async fn deaktivieren(pool: &SqlitePool, org_id: i64, id: i64) -> Result<(), AppError> {
    let resultat =
        sqlx::query("UPDATE personal_status SET aktiv = 0 WHERE id = ? AND org_id = ?")
            .bind(id)
            .bind(org_id)
            .execute(pool)
            .await?;
    if resultat.rows_affected() == 0 {
        return Err(AppError::NotFound);
    }
    Ok(())
}

/// `id` des ersten aktiven Status einer Kategorie (deterministisch nach `sortier`,
/// dann `id`); `None`, wenn die Org keinen solchen aktiven Status hat.
pub async fn erster_der_kategorie(
    pool: &SqlitePool,
    org_id: i64,
    kategorie: &str,
) -> Result<Option<i64>, AppError> {
    sqlx::query_scalar::<_, i64>(
        "SELECT id FROM personal_status \
         WHERE org_id = ? AND aktiv = 1 AND kategorie = ? ORDER BY sortier, id LIMIT 1",
    )
    .bind(org_id)
    .bind(kategorie)
    .fetch_optional(pool)
    .await
    .map_err(Into::into)
}

/// Ob ein aktiver Status mit dieser id zur Org gehört (PATCH-Disposition-Validierung).
pub async fn ist_in_org(
    pool: &SqlitePool,
    org_id: i64,
    status_id: i64,
) -> Result<bool, AppError> {
    let treffer: Option<i64> = sqlx::query_scalar(
        "SELECT 1 FROM personal_status WHERE id = ? AND org_id = ? AND aktiv = 1",
    )
    .bind(status_id)
    .bind(org_id)
    .fetch_optional(pool)
    .await?;
    Ok(treffer.is_some())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::katalog::{KATEGORIE_GEBUNDEN, KATEGORIE_VERFUEGBAR};

    async fn org(pool: &SqlitePool, id: i64) {
        sqlx::query("INSERT OR IGNORE INTO organisation (id, name) VALUES (?, 'Orga')")
            .bind(id)
            .execute(pool)
            .await
            .unwrap();
    }

    fn daten<'a>(label: &'a str, kategorie: &'a str, sortier: i64) -> StatusDaten<'a> {
        StatusDaten { label, kategorie, farbe: None, sortier }
    }

    #[tokio::test]
    async fn anlegen_liste_sortiert_nur_aktiv() {
        let pool = crate::db::test_pool().await;
        org(&pool, 1).await;
        anlegen(&pool, 1, daten("alarmiert", KATEGORIE_GEBUNDEN, 20)).await.unwrap();
        anlegen(&pool, 1, daten("verfügbar", KATEGORIE_VERFUEGBAR, 10)).await.unwrap();
        let l = liste(&pool, 1).await.unwrap();
        assert_eq!(l[0].label, "verfügbar");
        assert_eq!(l[1].label, "alarmiert");
    }

    #[tokio::test]
    async fn dublette_label_ist_conflict() {
        let pool = crate::db::test_pool().await;
        org(&pool, 1).await;
        anlegen(&pool, 1, daten("alarmiert", KATEGORIE_GEBUNDEN, 20)).await.unwrap();
        assert!(matches!(
            anlegen(&pool, 1, daten("alarmiert", KATEGORIE_VERFUEGBAR, 5)).await.unwrap_err(),
            AppError::Conflict(_)
        ));
    }

    #[tokio::test]
    async fn deaktivieren_versteckt_bleibt_referenzierbar() {
        let pool = crate::db::test_pool().await;
        org(&pool, 1).await;
        let s = anlegen(&pool, 1, daten("alt", KATEGORIE_VERFUEGBAR, 10)).await.unwrap();
        deaktivieren(&pool, 1, s.id).await.unwrap();
        assert!(liste(&pool, 1).await.unwrap().is_empty());
        assert_eq!(laden(&pool, 1, s.id).await.unwrap().id, s.id);
    }

    #[tokio::test]
    async fn erster_der_kategorie_deterministisch_und_ohne_deaktivierte() {
        let pool = crate::db::test_pool().await;
        org(&pool, 1).await;
        let frueh = anlegen(&pool, 1, daten("alarmiert", KATEGORIE_GEBUNDEN, 20)).await.unwrap();
        let anfahrt = anlegen(&pool, 1, daten("anfahrt", KATEGORIE_GEBUNDEN, 30)).await.unwrap();
        assert_eq!(
            erster_der_kategorie(&pool, 1, KATEGORIE_GEBUNDEN).await.unwrap(),
            Some(frueh.id)
        );
        assert_eq!(erster_der_kategorie(&pool, 1, KATEGORIE_VERFUEGBAR).await.unwrap(), None);

        // erster deaktiviert → Fallback auf nächsten nach sortier.
        deaktivieren(&pool, 1, frueh.id).await.unwrap();
        assert_eq!(
            erster_der_kategorie(&pool, 1, KATEGORIE_GEBUNDEN).await.unwrap(),
            Some(anfahrt.id)
        );
    }

    #[tokio::test]
    async fn ist_in_org_prueft_zugehoerigkeit() {
        let pool = crate::db::test_pool().await;
        org(&pool, 1).await;
        org(&pool, 2).await;
        let s = anlegen(&pool, 1, daten("alarmiert", KATEGORIE_GEBUNDEN, 20)).await.unwrap();
        assert!(ist_in_org(&pool, 1, s.id).await.unwrap());
        assert!(!ist_in_org(&pool, 2, s.id).await.unwrap());
    }

    #[tokio::test]
    async fn laden_fremde_org_ist_notfound() {
        let pool = crate::db::test_pool().await;
        org(&pool, 1).await;
        org(&pool, 2).await;
        let s = anlegen(&pool, 1, daten("alarmiert", KATEGORIE_GEBUNDEN, 20)).await.unwrap();
        assert!(matches!(laden(&pool, 2, s.id).await.unwrap_err(), AppError::NotFound));
    }
}
