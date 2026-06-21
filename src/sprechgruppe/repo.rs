use super::Sprechgruppe;
use crate::error::AppError;
use sqlx::SqlitePool;

/// Spaltenliste für `SELECT` in der Reihenfolge von `Sprechgruppe` (FromRow).
const SPALTEN: &str = "id, org_id, einsatz_id, bezeichnung, betriebsart, hinweis, aktiv, sortier, angelegt_at";

/// Editierbare Katalog-Felder einer Sprechgruppe.
#[derive(Debug)]
pub struct KatalogDaten<'a> {
    pub bezeichnung: &'a str,
    pub betriebsart: &'a str,
    pub hinweis: Option<&'a str>,
    pub sortier: i64,
}

/// Übersetzt einen Unique-Verstoß auf dem Katalog-Index in `Conflict`.
fn sprechgruppe_conflict<T>(e: sqlx::Error) -> Result<T, AppError> {
    if let sqlx::Error::Database(db) = &e {
        if db.is_unique_violation() {
            return Err(AppError::Conflict(
                "Sprechgruppe mit dieser Bezeichnung und Betriebsart ist in dieser Organisation bereits aktiv".into(),
            ));
        }
    }
    Err(e.into())
}

/// Lädt eine Sprechgruppe der eigenen Org; `NotFound`, falls unbekannt oder fremde Org.
pub async fn laden(pool: &SqlitePool, org_id: i64, id: i64) -> Result<Sprechgruppe, AppError> {
    sqlx::query_as::<_, Sprechgruppe>(&format!(
        "SELECT {SPALTEN} FROM sprechgruppe WHERE id = ? AND org_id = ?"
    ))
    .bind(id)
    .bind(org_id)
    .fetch_optional(pool)
    .await?
    .ok_or(AppError::NotFound)
}

/// Alle Katalog-Sprechgruppen der Org (`einsatz_id IS NULL`), sortiert nach
/// `betriebsart, sortier, bezeichnung`. `nur_aktive` filtert auf `aktiv = 1`.
pub async fn liste_katalog(
    pool: &SqlitePool,
    org_id: i64,
    nur_aktive: bool,
) -> Result<Vec<Sprechgruppe>, AppError> {
    let sql = if nur_aktive {
        format!(
            "SELECT {SPALTEN} FROM sprechgruppe \
             WHERE org_id = ? AND einsatz_id IS NULL AND aktiv = 1 \
             ORDER BY betriebsart, sortier, bezeichnung"
        )
    } else {
        format!(
            "SELECT {SPALTEN} FROM sprechgruppe \
             WHERE org_id = ? AND einsatz_id IS NULL \
             ORDER BY betriebsart, sortier, bezeichnung"
        )
    };
    sqlx::query_as::<_, Sprechgruppe>(&sql)
        .bind(org_id)
        .fetch_all(pool)
        .await
        .map_err(Into::into)
}

/// Legt eine Katalog-Sprechgruppe an (`einsatz_id` bleibt NULL).
/// Dublette (org_id, betriebsart, bezeichnung) unter aktiven → `Conflict`.
pub async fn anlegen_katalog(
    pool: &SqlitePool,
    org_id: i64,
    daten: KatalogDaten<'_>,
) -> Result<Sprechgruppe, AppError> {
    let ergebnis = sqlx::query_scalar::<_, i64>(
        "INSERT INTO sprechgruppe (org_id, bezeichnung, betriebsart, hinweis, sortier) \
         VALUES (?, ?, ?, ?, ?) RETURNING id",
    )
    .bind(org_id)
    .bind(daten.bezeichnung)
    .bind(daten.betriebsart)
    .bind(daten.hinweis)
    .bind(daten.sortier)
    .fetch_one(pool)
    .await;

    let id = match ergebnis {
        Ok(id) => id,
        Err(e) => return sprechgruppe_conflict(e),
    };
    laden(pool, org_id, id).await
}

/// Vollersatz der editierbaren Felder einer Katalog-Sprechgruppe (org-scoped,
/// `einsatz_id IS NULL`). `NotFound` bei fremder Org oder einsatz-lokaler Sprechgruppe,
/// `Conflict` bei Bezeichnung-/Betriebsart-Dublette.
pub async fn aktualisiere_katalog(
    pool: &SqlitePool,
    org_id: i64,
    id: i64,
    daten: KatalogDaten<'_>,
) -> Result<Sprechgruppe, AppError> {
    let ergebnis = sqlx::query(
        "UPDATE sprechgruppe \
         SET bezeichnung = ?, betriebsart = ?, hinweis = ?, sortier = ? \
         WHERE id = ? AND org_id = ? AND einsatz_id IS NULL",
    )
    .bind(daten.bezeichnung)
    .bind(daten.betriebsart)
    .bind(daten.hinweis)
    .bind(daten.sortier)
    .bind(id)
    .bind(org_id)
    .execute(pool)
    .await;

    let resultat = match ergebnis {
        Ok(r) => r,
        Err(e) => return sprechgruppe_conflict(e),
    };
    if resultat.rows_affected() == 0 {
        return Err(AppError::NotFound);
    }
    laden(pool, org_id, id).await
}

/// Deaktiviert eine Katalog-Sprechgruppe (Soft-Delete `aktiv = 0`).
/// Nur für Katalog-Einträge (`einsatz_id IS NULL`); rows_affected == 0 → `NotFound`.
pub async fn deaktiviere(pool: &SqlitePool, org_id: i64, id: i64) -> Result<(), AppError> {
    let resultat = sqlx::query(
        "UPDATE sprechgruppe SET aktiv = 0 WHERE id = ? AND org_id = ? AND einsatz_id IS NULL",
    )
    .bind(id)
    .bind(org_id)
    .execute(pool)
    .await?;

    if resultat.rows_affected() == 0 {
        return Err(AppError::NotFound);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::SqlitePool;
    async fn org(pool: &SqlitePool, id: i64) {
        sqlx::query("INSERT OR IGNORE INTO organisation (id, name) VALUES (?, 'Orga')")
            .bind(id).execute(pool).await.unwrap();
    }
    fn daten<'a>(bez: &'a str, ba: &'a str) -> KatalogDaten<'a> {
        KatalogDaten { bezeichnung: bez, betriebsart: ba, hinweis: None, sortier: 0 }
    }
    #[tokio::test]
    async fn anlegen_listen_und_laden() {
        let pool = crate::db::test_pool().await; org(&pool, 1).await;
        let sg = anlegen_katalog(&pool, 1, daten("412_F_DRK", "TMO")).await.unwrap();
        assert_eq!(sg.einsatz_id, None);
        assert_eq!(liste_katalog(&pool, 1, true).await.unwrap().len(), 1);
        assert_eq!(laden(&pool, 1, sg.id).await.unwrap().bezeichnung, "412_F_DRK");
    }
    #[tokio::test]
    async fn dublette_im_katalog_ist_conflict() {
        let pool = crate::db::test_pool().await; org(&pool, 1).await;
        anlegen_katalog(&pool, 1, daten("412_F_DRK", "TMO")).await.unwrap();
        assert!(matches!(anlegen_katalog(&pool, 1, daten("412_F_DRK", "TMO")).await.unwrap_err(), AppError::Conflict(_)));
        // gleiche Bezeichnung, andere Betriebsart → erlaubt
        assert!(anlegen_katalog(&pool, 1, daten("412_F_DRK", "DMO")).await.is_ok());
    }
    #[tokio::test]
    async fn katalog_je_org_isoliert() {
        let pool = crate::db::test_pool().await; org(&pool, 1).await; org(&pool, 2).await;
        let sg = anlegen_katalog(&pool, 1, daten("412_F_DRK", "TMO")).await.unwrap();
        assert!(matches!(laden(&pool, 2, sg.id).await.unwrap_err(), AppError::NotFound));
        assert!(liste_katalog(&pool, 2, true).await.unwrap().is_empty());
    }
    #[tokio::test]
    async fn deaktivieren_versteckt_aus_nur_aktive() {
        let pool = crate::db::test_pool().await; org(&pool, 1).await;
        let sg = anlegen_katalog(&pool, 1, daten("412_F_DRK", "TMO")).await.unwrap();
        deaktiviere(&pool, 1, sg.id).await.unwrap();
        assert!(liste_katalog(&pool, 1, true).await.unwrap().is_empty());
        assert_eq!(liste_katalog(&pool, 1, false).await.unwrap().len(), 1);
        // Nach Deaktivierung ist die gleiche Bezeichnung neu anlegbar (Partial-Index nur aktiv).
        assert!(anlegen_katalog(&pool, 1, daten("412_F_DRK", "TMO")).await.is_ok());
    }
}
