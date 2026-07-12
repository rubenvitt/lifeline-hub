use super::{Material, DIENSTSTATUS_AUSSER_DIENST, DIENSTSTATUS_IN_DIENST};
use crate::error::AppError;
use sqlx::SqlitePool;

/// Spaltenliste für `SELECT` in der Reihenfolge von `Material` (FromRow).
const SPALTEN: &str = "id, org_id, bezeichnung, kategorie, bestandsnummer, \
     traegerorganisation, standort, bemerkung, dienststatus, angelegt_at";

/// Editierbare Stammfelder. Optional-Strings sind bereits getrimmt; leer → `None`.
#[derive(Debug)]
pub struct MaterialDaten<'a> {
    pub bezeichnung: &'a str,
    pub kategorie: Option<&'a str>,
    pub bestandsnummer: Option<&'a str>,
    pub traegerorganisation: Option<&'a str>,
    pub standort: Option<&'a str>,
    pub bemerkung: Option<&'a str>,
}

/// Übersetzt einen Unique-Verstoß auf dem Bestandsnummer-Index in `Conflict`.
fn bestandsnummer_conflict<T>(e: sqlx::Error) -> Result<T, AppError> {
    if let sqlx::Error::Database(db) = &e {
        if db.is_unique_violation() {
            return Err(AppError::Conflict(
                "Bestandsnummer ist in dieser Organisation bereits vergeben".into(),
            ));
        }
    }
    Err(e.into())
}

/// Lädt ein Material der eigenen Org; `NotFound`, falls unbekannt oder fremde Org.
pub async fn laden(pool: &SqlitePool, org_id: i64, id: i64) -> Result<Material, AppError> {
    sqlx::query_as::<_, Material>(sqlx::AssertSqlSafe(format!(
        "SELECT {SPALTEN} FROM material WHERE id = ? AND org_id = ?"
    )))
    .bind(id)
    .bind(org_id)
    .fetch_optional(pool)
    .await?
    .ok_or(AppError::NotFound)
}

/// Alle Material-Stücke der Org, sortiert nach Bezeichnung.
/// `nur_im_dienst` filtert auf `dienststatus = 'in_dienst'` (Dispositions-Auswahl).
pub async fn liste(
    pool: &SqlitePool,
    org_id: i64,
    nur_im_dienst: bool,
) -> Result<Vec<Material>, AppError> {
    let sql = if nur_im_dienst {
        format!("SELECT {SPALTEN} FROM material WHERE org_id = ? AND dienststatus = 'in_dienst' ORDER BY bezeichnung")
    } else {
        format!("SELECT {SPALTEN} FROM material WHERE org_id = ? ORDER BY bezeichnung")
    };
    sqlx::query_as::<_, Material>(sqlx::AssertSqlSafe(&*sql))
        .bind(org_id)
        .fetch_all(pool)
        .await
        .map_err(Into::into)
}

/// Abgeleitete Kategorie-Vorschläge (DISTINCT, org-weit, nicht-leer, sortiert) für die
/// AutoComplete. Kein eigener Katalog/keine eigene Tabelle.
pub async fn kategorien(pool: &SqlitePool, org_id: i64) -> Result<Vec<String>, AppError> {
    sqlx::query_scalar::<_, String>(
        "SELECT DISTINCT kategorie FROM material \
         WHERE org_id = ? AND kategorie IS NOT NULL AND kategorie <> '' \
         ORDER BY kategorie",
    )
    .bind(org_id)
    .fetch_all(pool)
    .await
    .map_err(Into::into)
}

/// Legt ein Material an. Dublette Bestandsnummer (unter aktiven) → `Conflict`.
pub async fn anlegen(
    pool: &SqlitePool,
    org_id: i64,
    daten: MaterialDaten<'_>,
) -> Result<Material, AppError> {
    let ergebnis = sqlx::query_scalar::<_, i64>(
        "INSERT INTO material \
            (org_id, bezeichnung, kategorie, bestandsnummer, traegerorganisation, standort, bemerkung) \
         VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id",
    )
    .bind(org_id)
    .bind(daten.bezeichnung)
    .bind(daten.kategorie)
    .bind(daten.bestandsnummer)
    .bind(daten.traegerorganisation)
    .bind(daten.standort)
    .bind(daten.bemerkung)
    .fetch_one(pool)
    .await;

    let id = match ergebnis {
        Ok(id) => id,
        Err(e) => return bestandsnummer_conflict(e),
    };
    laden(pool, org_id, id).await
}

/// Vollersatz der editierbaren Felder (org-scoped). `NotFound` bei fremder Org,
/// `Conflict` bei Bestandsnummer-Dublette.
pub async fn aktualisiere(
    pool: &SqlitePool,
    org_id: i64,
    id: i64,
    daten: MaterialDaten<'_>,
) -> Result<Material, AppError> {
    let ergebnis = sqlx::query(
        "UPDATE material SET \
            bezeichnung = ?, kategorie = ?, bestandsnummer = ?, \
            traegerorganisation = ?, standort = ?, bemerkung = ? \
         WHERE id = ? AND org_id = ?",
    )
    .bind(daten.bezeichnung)
    .bind(daten.kategorie)
    .bind(daten.bestandsnummer)
    .bind(daten.traegerorganisation)
    .bind(daten.standort)
    .bind(daten.bemerkung)
    .bind(id)
    .bind(org_id)
    .execute(pool)
    .await;

    let resultat = match ergebnis {
        Ok(r) => r,
        Err(e) => return bestandsnummer_conflict(e),
    };
    if resultat.rows_affected() == 0 {
        return Err(AppError::NotFound);
    }
    laden(pool, org_id, id).await
}

/// Setzt den Dienststatus (Soft-Delete bzw. Reaktivierung). `NotFound` bei fremder
/// Org; `Conflict`, wenn beim Reaktivieren die Bestandsnummer inzwischen aktiv vergeben ist.
pub async fn setze_dienststatus(
    pool: &SqlitePool,
    org_id: i64,
    id: i64,
    in_dienst: bool,
) -> Result<Material, AppError> {
    let neuer = if in_dienst {
        DIENSTSTATUS_IN_DIENST
    } else {
        DIENSTSTATUS_AUSSER_DIENST
    };
    let ergebnis = sqlx::query("UPDATE material SET dienststatus = ? WHERE id = ? AND org_id = ?")
        .bind(neuer)
        .bind(id)
        .bind(org_id)
        .execute(pool)
        .await;

    let resultat = match ergebnis {
        Ok(r) => r,
        Err(e) => return bestandsnummer_conflict(e),
    };
    if resultat.rows_affected() == 0 {
        return Err(AppError::NotFound);
    }
    laden(pool, org_id, id).await
}

#[cfg(test)]
mod tests {
    use super::*;

    async fn org(pool: &SqlitePool, id: i64) {
        sqlx::query("INSERT OR IGNORE INTO organisation (id, name) VALUES (?, 'Orga')")
            .bind(id)
            .execute(pool)
            .await
            .unwrap();
    }

    fn daten(bezeichnung: &str) -> MaterialDaten<'_> {
        MaterialDaten {
            bezeichnung,
            kategorie: Some("Betreuung"),
            bestandsnummer: None,
            traegerorganisation: None,
            standort: None,
            bemerkung: None,
        }
    }

    #[tokio::test]
    async fn anlegen_und_laden() {
        let pool = crate::db::test_pool().await;
        org(&pool, 1).await;
        let m = anlegen(&pool, 1, daten("Wolldecke")).await.unwrap();
        assert_eq!(m.bezeichnung, "Wolldecke");
        assert_eq!(m.dienststatus, "in_dienst");
        assert_eq!(laden(&pool, 1, m.id).await.unwrap().id, m.id);
    }

    #[tokio::test]
    async fn bezeichnung_nicht_eindeutig() {
        let pool = crate::db::test_pool().await;
        org(&pool, 1).await;
        anlegen(&pool, 1, daten("Wolldecke")).await.unwrap();
        assert!(
            anlegen(&pool, 1, daten("Wolldecke")).await.is_ok(),
            "zwei 'Wolldecke' erlaubt"
        );
    }

    #[tokio::test]
    async fn bestandsnummer_dublette_ist_conflict() {
        let pool = crate::db::test_pool().await;
        org(&pool, 1).await;
        let mut d = daten("Stromerzeuger");
        d.bestandsnummer = Some("INV-1");
        anlegen(&pool, 1, d).await.unwrap();
        let mut d2 = daten("Stromerzeuger 2");
        d2.bestandsnummer = Some("INV-1");
        assert!(matches!(
            anlegen(&pool, 1, d2).await.unwrap_err(),
            AppError::Conflict(_)
        ));
    }

    #[tokio::test]
    async fn bestandsnummer_null_beliebig_oft() {
        let pool = crate::db::test_pool().await;
        org(&pool, 1).await;
        anlegen(&pool, 1, daten("A")).await.unwrap();
        anlegen(&pool, 1, daten("B")).await.unwrap();
        assert_eq!(liste(&pool, 1, false).await.unwrap().len(), 2);
    }

    #[tokio::test]
    async fn bestandsnummer_je_org_unabhaengig() {
        let pool = crate::db::test_pool().await;
        org(&pool, 1).await;
        org(&pool, 2).await;
        let mut a = daten("Gerät");
        a.bestandsnummer = Some("INV-1");
        anlegen(&pool, 1, a).await.unwrap();
        let mut b = daten("Gerät");
        b.bestandsnummer = Some("INV-1");
        assert!(anlegen(&pool, 2, b).await.is_ok());
    }

    #[tokio::test]
    async fn soft_delete_versteckt_aus_nur_im_dienst_gibt_bestandsnummer_frei() {
        let pool = crate::db::test_pool().await;
        org(&pool, 1).await;
        let mut d = daten("Stromerzeuger");
        d.bestandsnummer = Some("INV-1");
        let m = anlegen(&pool, 1, d).await.unwrap();

        setze_dienststatus(&pool, 1, m.id, false).await.unwrap();
        assert!(
            liste(&pool, 1, true).await.unwrap().is_empty(),
            "nicht in nur_im_dienst"
        );
        assert_eq!(
            liste(&pool, 1, false).await.unwrap().len(),
            1,
            "aber referenzierbar"
        );
        let mut neu = daten("Stromerzeuger neu");
        neu.bestandsnummer = Some("INV-1");
        assert!(anlegen(&pool, 1, neu).await.is_ok());
    }

    #[tokio::test]
    async fn kategorien_distinct_sortiert() {
        let pool = crate::db::test_pool().await;
        org(&pool, 1).await;
        for (b, k) in [
            ("Decke", "Betreuung"),
            ("Sandsack", "Hochwasser"),
            ("Wolldecke", "Betreuung"),
        ] {
            let mut d = daten(b);
            d.kategorie = Some(k);
            anlegen(&pool, 1, d).await.unwrap();
        }
        assert_eq!(
            kategorien(&pool, 1).await.unwrap(),
            vec!["Betreuung".to_string(), "Hochwasser".to_string()]
        );
    }

    #[tokio::test]
    async fn laden_fremde_org_ist_notfound() {
        let pool = crate::db::test_pool().await;
        org(&pool, 1).await;
        org(&pool, 2).await;
        let m = anlegen(&pool, 1, daten("Wolldecke")).await.unwrap();
        assert!(matches!(
            laden(&pool, 2, m.id).await.unwrap_err(),
            AppError::NotFound
        ));
    }

    #[tokio::test]
    async fn aktualisiere_ersetzt_felder() {
        let pool = crate::db::test_pool().await;
        org(&pool, 1).await;
        let m = anlegen(&pool, 1, daten("Wolldecke")).await.unwrap();
        let mut neu = daten("Wolldecke gross");
        neu.kategorie = Some("Sanitaet");
        neu.standort = Some("Lagerhalle 2");
        let g = aktualisiere(&pool, 1, m.id, neu).await.unwrap();
        assert_eq!(g.bezeichnung, "Wolldecke gross");
        assert_eq!(g.kategorie.as_deref(), Some("Sanitaet"));
        assert_eq!(g.standort.as_deref(), Some("Lagerhalle 2"));
    }

    #[tokio::test]
    async fn aktualisiere_fremde_org_ist_notfound() {
        let pool = crate::db::test_pool().await;
        org(&pool, 1).await;
        org(&pool, 2).await;
        let m = anlegen(&pool, 1, daten("Wolldecke")).await.unwrap();
        assert!(matches!(
            aktualisiere(&pool, 2, m.id, daten("X")).await.unwrap_err(),
            AppError::NotFound
        ));
    }

    #[tokio::test]
    async fn reaktivieren_auf_vergebene_bestandsnummer_ist_conflict() {
        let pool = crate::db::test_pool().await;
        org(&pool, 1).await;
        let mut d = daten("Stromerzeuger");
        d.bestandsnummer = Some("INV-1");
        let alt = anlegen(&pool, 1, d).await.unwrap();
        setze_dienststatus(&pool, 1, alt.id, false).await.unwrap();
        // Nummer inzwischen neu vergeben.
        let mut neu = daten("Stromerzeuger neu");
        neu.bestandsnummer = Some("INV-1");
        anlegen(&pool, 1, neu).await.unwrap();
        // Reaktivieren des alten kollidiert -> Conflict.
        assert!(matches!(
            setze_dienststatus(&pool, 1, alt.id, true)
                .await
                .unwrap_err(),
            AppError::Conflict(_)
        ));
    }
}
