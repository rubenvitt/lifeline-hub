use super::Qualifikation;
use crate::error::AppError;
use sqlx::SqlitePool;

/// Funktion einer Person als kommaseparierter Text ihrer **aktiven** Qualifikationen, nach
/// `sortier`, dann `id`; `None` ohne aktive Qualifikation. **Einzige Quelle der
/// `snap_funktion`-Komposition**; die Live-Anzeige in `disposition_repo` nutzt die identische
/// Subquery (Test `funktion_komposition_identisch`). Executor-generisch für
/// `disposition_repo::disponiere_stamm_tx`.
pub async fn funktion_text(
    executor: impl sqlx::Executor<'_, Database = sqlx::Sqlite>,
    personal_id: i64,
) -> Result<Option<String>, AppError> {
    sqlx::query_scalar::<_, Option<String>>(
        "SELECT GROUP_CONCAT(label, ', ') FROM ( \
            SELECT q.label FROM personal_qualifikation pq \
            JOIN qualifikation q ON q.id = pq.qualifikation_id \
            WHERE pq.personal_id = ? AND q.aktiv = 1 \
            ORDER BY q.sortier, q.id \
         )",
    )
    .bind(personal_id)
    .fetch_one(executor)
    .await
    .map_err(Into::into)
}

fn label_conflict<T>(e: sqlx::Error) -> Result<T, AppError> {
    if let sqlx::Error::Database(db) = &e {
        if db.is_unique_violation() {
            return Err(AppError::Conflict(
                "Qualifikation ist bereits vorhanden".into(),
            ));
        }
    }
    Err(e.into())
}

/// Lädt eine Qualifikation der Org (ignoriert `aktiv`); `NotFound` bei fremder id.
pub async fn laden(pool: &SqlitePool, org_id: i64, id: i64) -> Result<Qualifikation, AppError> {
    sqlx::query_as::<_, Qualifikation>(
        "SELECT id, label, sortier FROM qualifikation WHERE id = ? AND org_id = ?",
    )
    .bind(id)
    .bind(org_id)
    .fetch_optional(pool)
    .await?
    .ok_or(AppError::NotFound)
}

/// Nur aktive Qualifikationen der Org, sortiert nach `sortier`, dann `id`.
pub async fn liste(pool: &SqlitePool, org_id: i64) -> Result<Vec<Qualifikation>, AppError> {
    sqlx::query_as::<_, Qualifikation>(
        "SELECT id, label, sortier FROM qualifikation WHERE org_id = ? AND aktiv = 1 ORDER BY sortier, id",
    )
    .bind(org_id).fetch_all(pool).await.map_err(Into::into)
}

/// Legt eine Qualifikation an. Dublette `label` je Org → `Conflict`.
pub async fn anlegen(
    pool: &SqlitePool,
    org_id: i64,
    label: &str,
    sortier: i64,
) -> Result<Qualifikation, AppError> {
    let ergebnis = sqlx::query_scalar::<_, i64>(
        "INSERT INTO qualifikation (org_id, label, sortier) VALUES (?, ?, ?) RETURNING id",
    )
    .bind(org_id)
    .bind(label)
    .bind(sortier)
    .fetch_one(pool)
    .await;
    let id = match ergebnis {
        Ok(id) => id,
        Err(e) => return label_conflict(e),
    };
    laden(pool, org_id, id).await
}

/// Teil-Patch von label/sortier: `None` lässt die Spalte unverändert. Ohne nullable Spalte gibt
/// es keinen Tri-State; ein nicht gesendetes `sortier` fällt nicht mehr auf 0.
#[derive(Debug, Default)]
pub struct QualifikationPatch<'a> {
    pub label: Option<&'a str>,
    pub sortier: Option<i64>,
}

/// Teil-Patch von label/sortier (org-scoped); `NotFound`/`Conflict` wie beim Stamm.
/// Nummerierte Parameter, abgesichert von `patche_setzt_jede_spalte_an_ihren_platz`.
pub async fn patche(
    pool: &SqlitePool,
    org_id: i64,
    id: i64,
    patch: QualifikationPatch<'_>,
) -> Result<Qualifikation, AppError> {
    let ergebnis = sqlx::query(
        "UPDATE qualifikation SET \
            label = CASE WHEN ?1 IS NULL THEN label ELSE ?2 END, \
            sortier = CASE WHEN ?3 IS NULL THEN sortier ELSE ?4 END \
         WHERE id = ?5 AND org_id = ?6",
    )
    .bind(patch.label.map(|_| 1_i64))
    .bind(patch.label)
    .bind(patch.sortier.map(|_| 1_i64))
    .bind(patch.sortier)
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

/// Deaktiviert eine Qualifikation (Soft-Delete `aktiv = 0`); bestehende Zuordnungen
/// bleiben gültig. `NotFound` bei fremder/unbekannter id.
pub async fn deaktivieren(pool: &SqlitePool, org_id: i64, id: i64) -> Result<(), AppError> {
    let resultat = sqlx::query("UPDATE qualifikation SET aktiv = 0 WHERE id = ? AND org_id = ?")
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

    async fn org(pool: &SqlitePool, id: i64) {
        sqlx::query("INSERT OR IGNORE INTO organisation (id, name) VALUES (?, 'Orga')")
            .bind(id)
            .execute(pool)
            .await
            .unwrap();
    }

    #[tokio::test]
    async fn anlegen_liste_nur_aktiv_nach_sortier() {
        let pool = crate::db::test_pool().await;
        org(&pool, 1).await;
        anlegen(&pool, 1, "Gruppenführer", 60).await.unwrap();
        anlegen(&pool, 1, "Sanitäter", 10).await.unwrap();
        let l = liste(&pool, 1).await.unwrap();
        assert_eq!(
            l.iter().map(|q| q.label.as_str()).collect::<Vec<_>>(),
            vec!["Sanitäter", "Gruppenführer"]
        );
    }

    #[tokio::test]
    async fn dublette_label_ist_conflict() {
        let pool = crate::db::test_pool().await;
        org(&pool, 1).await;
        anlegen(&pool, 1, "Sanitäter", 10).await.unwrap();
        assert!(matches!(
            anlegen(&pool, 1, "Sanitäter", 20).await.unwrap_err(),
            AppError::Conflict(_)
        ));
    }

    #[tokio::test]
    async fn deaktivieren_versteckt_aus_liste_bleibt_referenzierbar() {
        let pool = crate::db::test_pool().await;
        org(&pool, 1).await;
        let q = anlegen(&pool, 1, "Notarzt", 40).await.unwrap();
        deaktivieren(&pool, 1, q.id).await.unwrap();
        assert!(liste(&pool, 1).await.unwrap().is_empty());
        assert_eq!(laden(&pool, 1, q.id).await.unwrap().id, q.id);
    }

    #[tokio::test]
    async fn laden_fremde_org_ist_notfound() {
        let pool = crate::db::test_pool().await;
        org(&pool, 1).await;
        org(&pool, 2).await;
        let q = anlegen(&pool, 1, "Sanitäter", 10).await.unwrap();
        assert!(matches!(
            laden(&pool, 2, q.id).await.unwrap_err(),
            AppError::NotFound
        ));
    }

    /// Bind-Reihenfolge: beide Spalten in EINEM Patch auf distinkte Werte setzen und einzeln
    /// prüfen.
    #[tokio::test]
    async fn patche_setzt_jede_spalte_an_ihren_platz() {
        let pool = crate::db::test_pool().await;
        org(&pool, 1).await;
        let q = anlegen(&pool, 1, "Sanitäter", 10).await.unwrap();
        let neu = patche(
            &pool,
            1,
            q.id,
            QualifikationPatch {
                label: Some("Rettungssanitäter"),
                sortier: Some(42),
            },
        )
        .await
        .unwrap();
        assert_eq!(neu.label, "Rettungssanitäter");
        assert_eq!(neu.sortier, 42);
    }

    /// Ein Patch fasst NUR die gesendeten Spalten an (ein Body ohne `sortier` setzte sonst 0).
    #[tokio::test]
    async fn patche_laesst_nicht_gesendete_spalten_stehen() {
        let pool = crate::db::test_pool().await;
        org(&pool, 1).await;
        let q = anlegen(&pool, 1, "Sanitäter", 10).await.unwrap();
        let neu = patche(
            &pool,
            1,
            q.id,
            QualifikationPatch {
                label: Some("Rettungssanitäter"),
                ..Default::default()
            },
        )
        .await
        .unwrap();
        assert_eq!(neu.label, "Rettungssanitäter");
        assert_eq!(neu.sortier, 10, "unberührt");

        // Leerer Patch → alles bleibt, insbesondere kein NotFound.
        let unveraendert = patche(&pool, 1, q.id, QualifikationPatch::default())
            .await
            .unwrap();
        assert_eq!(unveraendert.label, "Rettungssanitäter");
        assert_eq!(unveraendert.sortier, 10);
    }

    #[tokio::test]
    async fn patche_fremde_org_ist_notfound() {
        let pool = crate::db::test_pool().await;
        org(&pool, 1).await;
        org(&pool, 2).await;
        let q = anlegen(&pool, 1, "Sanitäter", 10).await.unwrap();
        assert!(matches!(
            patche(
                &pool,
                2,
                q.id,
                QualifikationPatch {
                    label: Some("fremd"),
                    ..Default::default()
                }
            )
            .await
            .unwrap_err(),
            AppError::NotFound
        ));
    }

    #[tokio::test]
    async fn patche_auf_bestehendes_label_ist_conflict() {
        let pool = crate::db::test_pool().await;
        org(&pool, 1).await;
        anlegen(&pool, 1, "Sanitäter", 10).await.unwrap();
        let zweite = anlegen(&pool, 1, "Notarzt", 20).await.unwrap();
        assert!(matches!(
            patche(
                &pool,
                1,
                zweite.id,
                QualifikationPatch {
                    label: Some("Sanitäter"),
                    ..Default::default()
                }
            )
            .await
            .unwrap_err(),
            AppError::Conflict(_)
        ));
    }

    #[tokio::test]
    async fn funktion_text_nur_aktive_nach_sortier() {
        let pool = crate::db::test_pool().await;
        org(&pool, 1).await;
        let san = anlegen(&pool, 1, "Sanitäter", 10).await.unwrap();
        let gf = anlegen(&pool, 1, "Gruppenführer", 60).await.unwrap();
        let inaktiv = anlegen(&pool, 1, "Veraltet", 5).await.unwrap();
        let pid: i64 =
            sqlx::query_scalar("INSERT INTO personal (org_id, name) VALUES (1, 'T') RETURNING id")
                .fetch_one(&pool)
                .await
                .unwrap();
        for q in [san.id, gf.id, inaktiv.id] {
            sqlx::query(
                "INSERT INTO personal_qualifikation (personal_id, qualifikation_id) VALUES (?, ?)",
            )
            .bind(pid)
            .bind(q)
            .execute(&pool)
            .await
            .unwrap();
        }
        deaktivieren(&pool, 1, inaktiv.id).await.unwrap();
        // Reihenfolge nach sortier; deaktivierte raus.
        assert_eq!(
            funktion_text(&pool, pid).await.unwrap().as_deref(),
            Some("Sanitäter, Gruppenführer")
        );
    }

    #[tokio::test]
    async fn funktion_text_ohne_qualifikationen_ist_none() {
        let pool = crate::db::test_pool().await;
        org(&pool, 1).await;
        let pid: i64 =
            sqlx::query_scalar("INSERT INTO personal (org_id, name) VALUES (1, 'T') RETURNING id")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(funktion_text(&pool, pid).await.unwrap(), None);
    }
}
