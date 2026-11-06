use super::Qualifikation;
use crate::error::AppError;
use sqlx::{SqliteConnection, SqlitePool};

/// Funktion einer Person als kommaseparierter Text ihrer **aktiven** Qualifikationen, nach
/// `sortier`, dann `id`; `None` ohne aktive Qualifikation. **Einzige Quelle der
/// `snap_funktion`-Komposition**; die Live-Anzeige in `disposition_repo` nutzt die identische
/// Subquery (Test `funktion_komposition_identisch`). Executor-generisch für
/// `disposition_repo::disponieren_stamm_tx`.
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

const SPALTEN: &str = "id, label, sortier, schliesst_ein_id";

/// Lädt eine Qualifikation der Org (ignoriert `aktiv`); `NotFound` bei fremder id.
pub async fn laden(pool: &SqlitePool, org_id: i64, id: i64) -> Result<Qualifikation, AppError> {
    laden_tx(&mut *pool.acquire().await?, org_id, id).await
}

async fn laden_tx(
    conn: &mut SqliteConnection,
    org_id: i64,
    id: i64,
) -> Result<Qualifikation, AppError> {
    sqlx::query_as::<_, Qualifikation>(sqlx::AssertSqlSafe(format!(
        "SELECT {SPALTEN} FROM qualifikation WHERE id = ? AND org_id = ?"
    )))
    .bind(id)
    .bind(org_id)
    .fetch_optional(&mut *conn)
    .await?
    .ok_or(AppError::NotFound)
}

/// Nur aktive Qualifikationen der Org, sortiert nach `sortier`, dann `id`.
pub async fn liste(pool: &SqlitePool, org_id: i64) -> Result<Vec<Qualifikation>, AppError> {
    sqlx::query_as::<_, Qualifikation>(sqlx::AssertSqlSafe(format!(
        "SELECT {SPALTEN} FROM qualifikation WHERE org_id = ? AND aktiv = 1 ORDER BY sortier, id"
    )))
    .bind(org_id)
    .fetch_all(pool)
    .await
    .map_err(Into::into)
}

/// Einschlüsse des ganzen Katalogs der Org, auch deaktivierter Einträge (sie bleiben in Ketten
/// wirksam, LLH-1553 design.md D1): Grundlage der Deckungsregel auf dem Server.
pub async fn einschluesse(
    executor: impl sqlx::Executor<'_, Database = sqlx::Sqlite>,
    org_id: i64,
) -> Result<super::qualifikation_deckung::Einschluesse, AppError> {
    let rows: Vec<(i64, Option<i64>)> =
        sqlx::query_as("SELECT id, schliesst_ein_id FROM qualifikation WHERE org_id = ?")
            .bind(org_id)
            .fetch_all(executor)
            .await?;
    Ok(rows.into_iter().collect())
}

/// Prüft einen Einschluss (LLH-1553, Spec `qualifikationen`, „Einschluss im Katalog“): `ziel`
/// gehört zur Org, ist nicht die Qualifikation selbst und schließt sie nicht schon über die
/// Kette ein (das wäre ein Kreis). Alles 422. `selbst` fehlt beim Anlegen.
async fn pruefe_einschluss_tx(
    conn: &mut SqliteConnection,
    org_id: i64,
    selbst: Option<i64>,
    ziel: i64,
) -> Result<(), AppError> {
    if selbst == Some(ziel) {
        return Err(AppError::UnprocessableEntity(
            "Eine Qualifikation kann sich nicht selbst einschließen".into(),
        ));
    }
    let in_org: Option<i64> =
        sqlx::query_scalar("SELECT 1 FROM qualifikation WHERE id = ? AND org_id = ?")
            .bind(ziel)
            .bind(org_id)
            .fetch_optional(&mut *conn)
            .await?;
    if in_org.is_none() {
        return Err(AppError::UnprocessableEntity(
            "Eingeschlossene Qualifikation gehört nicht zur Organisation".into(),
        ));
    }
    let Some(selbst) = selbst else {
        return Ok(());
    };
    // Die Kette ab dem Ziel abwärts; erreicht sie die Qualifikation selbst, entstünde ein Kreis.
    // UNION (nicht UNION ALL) endet auch auf einem Bestand mit Kreis.
    let kreis: bool = sqlx::query_scalar(
        "WITH RECURSIVE kette(id) AS ( \
            SELECT ?1 \
            UNION \
            SELECT q.schliesst_ein_id FROM qualifikation q JOIN kette k ON q.id = k.id \
            WHERE q.schliesst_ein_id IS NOT NULL \
         ) SELECT EXISTS (SELECT 1 FROM kette WHERE id = ?2)",
    )
    .bind(ziel)
    .bind(selbst)
    .fetch_one(&mut *conn)
    .await?;
    if kreis {
        return Err(AppError::UnprocessableEntity(
            "Die Qualifikation würde sich über die Kette selbst einschließen".into(),
        ));
    }
    Ok(())
}

/// Legt eine Qualifikation an, optional mit Einschluss. Dublette `label` je Org → `Conflict`,
/// ungültiger Einschluss → 422.
pub async fn anlegen(
    pool: &SqlitePool,
    org_id: i64,
    label: &str,
    sortier: i64,
) -> Result<Qualifikation, AppError> {
    anlegen_mit(pool, org_id, label, sortier, None).await
}

/// Wie [`anlegen`], mit Einschluss.
pub async fn anlegen_mit(
    pool: &SqlitePool,
    org_id: i64,
    label: &str,
    sortier: i64,
    schliesst_ein_id: Option<i64>,
) -> Result<Qualifikation, AppError> {
    crate::write_retry!(pool, |conn| {
        if let Some(ziel) = schliesst_ein_id {
            pruefe_einschluss_tx(conn, org_id, None, ziel).await?;
        }
        let ergebnis = sqlx::query_scalar::<_, i64>(
            "INSERT INTO qualifikation (org_id, label, sortier, schliesst_ein_id) \
             VALUES (?, ?, ?, ?) RETURNING id",
        )
        .bind(org_id)
        .bind(label)
        .bind(sortier)
        .bind(schliesst_ein_id)
        .fetch_one(&mut *conn)
        .await;
        let id = match ergebnis {
            Ok(id) => id,
            Err(e) => return label_conflict(e),
        };
        laden_tx(conn, org_id, id).await
    })
}

/// Teil-Patch: `None` lässt die Spalte unverändert. `schliesst_ein_id` ist Tri-State
/// (`Some(None)` = kein Einschluss mehr). Ein nicht gesendetes `sortier` fällt nicht auf 0.
#[derive(Debug, Default)]
pub struct QualifikationPatch<'a> {
    pub label: Option<&'a str>,
    pub sortier: Option<i64>,
    pub schliesst_ein_id: Option<Option<i64>>,
}

/// Teil-Patch (org-scoped); `NotFound`/`Conflict` wie beim Stamm, ungültiger Einschluss 422.
/// Prüfung und Schreiben laufen in EINER Transaktion, damit zwei gleichzeitige Änderungen keinen
/// Kreis bilden. Nummerierte Parameter, abgesichert von
/// `patche_setzt_jede_spalte_an_ihren_platz`.
pub async fn patche(
    pool: &SqlitePool,
    org_id: i64,
    id: i64,
    patch: QualifikationPatch<'_>,
) -> Result<Qualifikation, AppError> {
    crate::write_retry!(pool, |conn| {
        // 404 vor jeder Einschluss-Prüfung.
        laden_tx(conn, org_id, id).await?;
        if let Some(Some(ziel)) = patch.schliesst_ein_id {
            pruefe_einschluss_tx(conn, org_id, Some(id), ziel).await?;
        }
        let ergebnis = sqlx::query(
            "UPDATE qualifikation SET \
                label = CASE WHEN ?1 IS NULL THEN label ELSE ?2 END, \
                sortier = CASE WHEN ?3 IS NULL THEN sortier ELSE ?4 END, \
                schliesst_ein_id = CASE WHEN ?5 IS NULL THEN schliesst_ein_id ELSE ?6 END \
             WHERE id = ?7 AND org_id = ?8",
        )
        .bind(patch.label.map(|_| 1_i64))
        .bind(patch.label)
        .bind(patch.sortier.map(|_| 1_i64))
        .bind(patch.sortier)
        .bind(patch.schliesst_ein_id.map(|_| 1_i64))
        .bind(patch.schliesst_ein_id.flatten())
        .bind(id)
        .bind(org_id)
        .execute(&mut *conn)
        .await;
        if let Err(e) = ergebnis {
            return label_conflict(e);
        }
        laden_tx(conn, org_id, id).await
    })
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
        let ziel = anlegen(&pool, 1, "Helfer", 5).await.unwrap();
        let neu = patche(
            &pool,
            1,
            q.id,
            QualifikationPatch {
                label: Some("Rettungssanitäter"),
                sortier: Some(42),
                schliesst_ein_id: Some(Some(ziel.id)),
            },
        )
        .await
        .unwrap();
        assert_eq!(neu.label, "Rettungssanitäter");
        assert_eq!(neu.sortier, 42);
        assert_eq!(neu.schliesst_ein_id, Some(ziel.id));
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

    /// Kette, Kreis, Selbstverweis, fremde Org (LLH-1553, Spec `qualifikationen`).
    #[tokio::test]
    async fn einschluss_regeln() {
        let pool = crate::db::test_pool().await;
        org(&pool, 1).await;
        org(&pool, 2).await;
        let san = anlegen(&pool, 1, "Sanitäter", 10).await.unwrap();
        let rs = anlegen_mit(&pool, 1, "Rettungssanitäter", 20, Some(san.id))
            .await
            .unwrap();
        assert_eq!(rs.schliesst_ein_id, Some(san.id));
        let ns = anlegen_mit(&pool, 1, "Notfallsanitäter", 30, Some(rs.id))
            .await
            .unwrap();
        let fremd = anlegen(&pool, 2, "Sanitäter", 10).await.unwrap();

        let setze = |id: i64, ziel: Option<i64>| {
            let pool = pool.clone();
            async move {
                patche(
                    &pool,
                    1,
                    id,
                    QualifikationPatch {
                        schliesst_ein_id: Some(ziel),
                        ..Default::default()
                    },
                )
                .await
            }
        };
        // Kreis über zwei Stufen: Sanitäter → Notfallsanitäter.
        assert!(matches!(
            setze(san.id, Some(ns.id)).await,
            Err(AppError::UnprocessableEntity(_))
        ));
        // Kreis über eine Stufe.
        assert!(matches!(
            setze(san.id, Some(rs.id)).await,
            Err(AppError::UnprocessableEntity(_))
        ));
        assert!(matches!(
            setze(san.id, Some(san.id)).await,
            Err(AppError::UnprocessableEntity(_))
        ));
        assert!(matches!(
            setze(san.id, Some(fremd.id)).await,
            Err(AppError::UnprocessableEntity(_))
        ));
        assert!(matches!(
            anlegen_mit(&pool, 1, "Neu", 1, Some(fremd.id)).await,
            Err(AppError::UnprocessableEntity(_))
        ));
        assert_eq!(
            laden(&pool, 1, san.id).await.unwrap().schliesst_ein_id,
            None
        );

        // Lösen und neu verketten.
        assert_eq!(setze(ns.id, None).await.unwrap().schliesst_ein_id, None);
        assert_eq!(
            setze(ns.id, Some(san.id)).await.unwrap().schliesst_ein_id,
            Some(san.id)
        );

        // Die Deckungsregel liest den Katalog samt Kette.
        let k = einschluesse(&pool, 1).await.unwrap();
        assert!(crate::personal::qualifikation_deckung::deckt(
            &k,
            &[rs.id],
            san.id
        ));
        assert!(!crate::personal::qualifikation_deckung::deckt(
            &k,
            &[san.id],
            rs.id
        ));
    }

    /// Eine deaktivierte Qualifikation bleibt in der Kette wirksam (design.md D1).
    #[tokio::test]
    async fn deaktivierte_bleibt_in_der_kette() {
        let pool = crate::db::test_pool().await;
        org(&pool, 1).await;
        let san = anlegen(&pool, 1, "Sanitäter", 10).await.unwrap();
        let rs = anlegen_mit(&pool, 1, "Rettungssanitäter", 20, Some(san.id))
            .await
            .unwrap();
        let ns = anlegen_mit(&pool, 1, "Notfallsanitäter", 30, Some(rs.id))
            .await
            .unwrap();
        deaktivieren(&pool, 1, rs.id).await.unwrap();
        let k = einschluesse(&pool, 1).await.unwrap();
        assert!(crate::personal::qualifikation_deckung::deckt(
            &k,
            &[ns.id],
            san.id
        ));
    }
}
