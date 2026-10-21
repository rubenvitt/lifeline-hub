use crate::error::AppError;
use serde::Serialize;
use sqlx::SqlitePool;
use utoipa::ToSchema;

/// Org-weiter Einsatzstichwort-Vorschlag für die Combobox.
#[derive(Debug, Clone, Serialize, sqlx::FromRow, ToSchema)]
pub struct StichwortVorschlag {
    pub id: i64,
    pub text: String,
    /// Gekoppelte Einsatz-Vorlage derselben Organisation (LLH-1375): wählt der Anlegedialog
    /// dieses Stichwort, stellt sich die Vorlage ein, solange niemand sie von Hand gewählt hat.
    /// Fehlt ohne Kopplung.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub vorlage_id: Option<i64>,
}

/// Alle Vorschläge einer Organisation, sortiert nach `sortier`, dann `text`.
pub async fn liste(pool: &SqlitePool, org_id: i64) -> Result<Vec<StichwortVorschlag>, AppError> {
    sqlx::query_as::<_, StichwortVorschlag>(
        "SELECT id, text, vorlage_id FROM einsatz_stichwort_vorschlag \
         WHERE org_id = ? ORDER BY sortier, text",
    )
    .bind(org_id)
    .fetch_all(pool)
    .await
    .map_err(Into::into)
}

/// Legt einen Vorschlag an. Duplikat (org_id, text) → `Conflict`.
pub async fn anlegen(
    pool: &SqlitePool,
    org_id: i64,
    text: &str,
) -> Result<StichwortVorschlag, AppError> {
    let ergebnis = sqlx::query_scalar::<_, i64>(
        "INSERT INTO einsatz_stichwort_vorschlag (org_id, text) VALUES (?, ?) RETURNING id",
    )
    .bind(org_id)
    .bind(text)
    .fetch_one(pool)
    .await;

    let id = match ergebnis {
        Ok(id) => id,
        Err(sqlx::Error::Database(db_err)) if db_err.is_unique_violation() => {
            return Err(AppError::Conflict("Stichwort ist bereits vorhanden".into()));
        }
        Err(e) => return Err(e.into()),
    };

    Ok(StichwortVorschlag {
        id,
        text: text.to_string(),
        vorlage_id: None,
    })
}

/// Koppelt einen Vorschlag der Organisation an eine Einsatz-Vorlage oder löst die Kopplung
/// (`None`). Fremder oder unbekannter Vorschlag → `NotFound`; eine Vorlage, die nicht zur
/// Organisation gehört, ist ein Feldfehler (400).
pub async fn set_vorlage(
    pool: &SqlitePool,
    org_id: i64,
    id: i64,
    vorlage_id: Option<i64>,
) -> Result<StichwortVorschlag, AppError> {
    crate::write_retry!(pool, |conn| {
        if let Some(vid) = vorlage_id {
            let eigen: bool = sqlx::query_scalar(
                "SELECT EXISTS(SELECT 1 FROM einsatz_vorlage WHERE id = ? AND org_id = ?)",
            )
            .bind(vid)
            .bind(org_id)
            .fetch_one(&mut *conn)
            .await?;
            if !eigen {
                return Err(AppError::Validation("Unbekannte Einsatz-Vorlage".into()));
            }
        }
        sqlx::query_as::<_, StichwortVorschlag>(
            "UPDATE einsatz_stichwort_vorschlag SET vorlage_id = ? \
             WHERE id = ? AND org_id = ? RETURNING id, text, vorlage_id",
        )
        .bind(vorlage_id)
        .bind(id)
        .bind(org_id)
        .fetch_optional(&mut *conn)
        .await?
        .ok_or(AppError::NotFound)
    })
}

/// Löscht einen Vorschlag der Organisation (idempotent).
pub async fn loeschen(pool: &SqlitePool, org_id: i64, id: i64) -> Result<(), AppError> {
    sqlx::query("DELETE FROM einsatz_stichwort_vorschlag WHERE id = ? AND org_id = ?")
        .bind(id)
        .bind(org_id)
        .execute(pool)
        .await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    async fn org_anlegen(pool: &SqlitePool, id: i64) {
        sqlx::query("INSERT INTO organisation (id, name) VALUES (?, 'Orga')")
            .bind(id)
            .execute(pool)
            .await
            .unwrap();
    }

    #[tokio::test]
    async fn anlegen_und_liste_sortiert() {
        let pool = crate::db::test_pool().await;
        org_anlegen(&pool, 1).await;

        anlegen(&pool, 1, "MANV").await.unwrap();
        anlegen(&pool, 1, "H1").await.unwrap();

        let liste = liste(&pool, 1).await.unwrap();
        // Gleicher sortier (Default 0) → alphabetisch nach text.
        assert_eq!(liste.len(), 2);
        assert_eq!(liste[0].text, "H1");
        assert_eq!(liste[1].text, "MANV");
    }

    #[tokio::test]
    async fn anlegen_duplikat_ist_conflict() {
        let pool = crate::db::test_pool().await;
        org_anlegen(&pool, 1).await;
        anlegen(&pool, 1, "H1").await.unwrap();

        let err = anlegen(&pool, 1, "H1").await.unwrap_err();
        assert!(matches!(err, AppError::Conflict(_)));
    }

    #[tokio::test]
    async fn loeschen_entfernt_nur_eigene_org() {
        let pool = crate::db::test_pool().await;
        org_anlegen(&pool, 1).await;
        org_anlegen(&pool, 2).await;
        let v = anlegen(&pool, 1, "H1").await.unwrap();

        // Löschversuch aus fremder Org tut nichts.
        loeschen(&pool, 2, v.id).await.unwrap();
        assert_eq!(liste(&pool, 1).await.unwrap().len(), 1);

        // Aus eigener Org löschen.
        loeschen(&pool, 1, v.id).await.unwrap();
        assert!(liste(&pool, 1).await.unwrap().is_empty());
    }
}
