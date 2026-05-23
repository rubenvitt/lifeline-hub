use super::{
    Einsatz, EinsatzAnzeige, EinsatzRolle, MitgliedAnzeige, EINSATZ_ROLLE_LEITUNG,
    STATUS_ABGESCHLOSSEN,
};
use crate::error::AppError;
use sqlx::SqlitePool;

/// Legt einen Einsatz an und macht den Ersteller in derselben Transaktion zur Einsatzleitung.
pub async fn anlegen(
    pool: &SqlitePool,
    bezeichnung: &str,
    stichwort: Option<&str>,
    ersteller_id: i64,
) -> Result<Einsatz, AppError> {
    // Single-Org in T1: alle Einsätze gehören zur (einzigen) Organisation.
    let org_id: i64 = sqlx::query_scalar("SELECT id FROM organisation ORDER BY id LIMIT 1")
        .fetch_optional(pool)
        .await?
        .ok_or_else(|| AppError::Internal("Keine Organisation vorhanden".into()))?;

    let mut tx = pool.begin().await?;
    let einsatz_id: i64 = sqlx::query_scalar(
        "INSERT INTO einsatz (org_id, bezeichnung, stichwort) VALUES (?, ?, ?) RETURNING id",
    )
    .bind(org_id)
    .bind(bezeichnung)
    .bind(stichwort)
    .fetch_one(&mut *tx)
    .await?;

    sqlx::query(
        "INSERT INTO einsatz_mitgliedschaft (einsatz_id, benutzer_id, einsatz_rolle) \
         VALUES (?, ?, ?)",
    )
    .bind(einsatz_id)
    .bind(ersteller_id)
    .bind(EINSATZ_ROLLE_LEITUNG)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;

    laden(pool, einsatz_id).await
}

/// Lädt einen Einsatz; `AppError::NotFound`, wenn er nicht existiert.
pub async fn laden(pool: &SqlitePool, einsatz_id: i64) -> Result<Einsatz, AppError> {
    sqlx::query_as::<_, Einsatz>(
        "SELECT id, org_id, bezeichnung, stichwort, status, begonnen_at, \
                abgeschlossen_at, abgeschlossen_von \
         FROM einsatz WHERE id = ?",
    )
    .bind(einsatz_id)
    .fetch_optional(pool)
    .await?
    .ok_or(AppError::NotFound)
}

/// Liefert die Einsatz-Rolle eines Benutzers in einem Einsatz (`None` = kein Mitglied).
pub async fn rolle_von(
    pool: &SqlitePool,
    einsatz_id: i64,
    benutzer_id: i64,
) -> Result<Option<EinsatzRolle>, AppError> {
    let rolle: Option<String> = sqlx::query_scalar(
        "SELECT einsatz_rolle FROM einsatz_mitgliedschaft \
         WHERE einsatz_id = ? AND benutzer_id = ?",
    )
    .bind(einsatz_id)
    .bind(benutzer_id)
    .fetch_optional(pool)
    .await?;
    Ok(rolle.and_then(|s| EinsatzRolle::parse(&s)))
}

/// Alle Einsätze, annotiert mit der Rolle des angegebenen Benutzers (`meine_rolle`).
pub async fn liste_fuer(
    pool: &SqlitePool,
    benutzer_id: i64,
) -> Result<Vec<EinsatzAnzeige>, AppError> {
    #[derive(sqlx::FromRow)]
    struct Row {
        id: i64,
        bezeichnung: String,
        stichwort: Option<String>,
        status: String,
        begonnen_at: String,
        abgeschlossen_at: Option<String>,
        abgeschlossen_von: Option<i64>,
        meine_rolle: Option<String>,
    }

    let rows = sqlx::query_as::<_, Row>(
        "SELECT e.id, e.bezeichnung, e.stichwort, e.status, e.begonnen_at, \
                e.abgeschlossen_at, e.abgeschlossen_von, m.einsatz_rolle AS meine_rolle \
         FROM einsatz e \
         LEFT JOIN einsatz_mitgliedschaft m \
                ON m.einsatz_id = e.id AND m.benutzer_id = ? \
         ORDER BY e.begonnen_at DESC, e.id DESC",
    )
    .bind(benutzer_id)
    .fetch_all(pool)
    .await?;

    Ok(rows
        .into_iter()
        .map(|r| EinsatzAnzeige {
            id: r.id,
            bezeichnung: r.bezeichnung,
            stichwort: r.stichwort,
            status: r.status,
            begonnen_at: r.begonnen_at,
            abgeschlossen_at: r.abgeschlossen_at,
            abgeschlossen_von: r.abgeschlossen_von,
            meine_rolle: r.meine_rolle,
        })
        .collect())
}

/// Schließt einen Einsatz ab (nur wenn aktuell `aktiv`) und lädt ihn neu.
/// Das `status = 'aktiv'`-Prädikat im WHERE schützt gegen Races; die fachliche
/// 409-Prüfung erfolgt zusätzlich im Handler.
pub async fn abschliessen(
    pool: &SqlitePool,
    einsatz_id: i64,
    von_benutzer_id: i64,
) -> Result<Einsatz, AppError> {
    sqlx::query(
        "UPDATE einsatz \
         SET status = ?, abgeschlossen_at = datetime('now'), abgeschlossen_von = ? \
         WHERE id = ? AND status = 'aktiv'",
    )
    .bind(STATUS_ABGESCHLOSSEN)
    .bind(von_benutzer_id)
    .bind(einsatz_id)
    .execute(pool)
    .await?;
    laden(pool, einsatz_id).await
}

/// Alle Mitglieder eines Einsatzes (mit Benutzer-Klartext), sortiert nach Zuweisung.
pub async fn mitglieder(
    pool: &SqlitePool,
    einsatz_id: i64,
) -> Result<Vec<MitgliedAnzeige>, AppError> {
    sqlx::query_as::<_, MitgliedAnzeige>(
        "SELECT m.benutzer_id, b.anzeigename, b.benutzername, m.einsatz_rolle, m.zugewiesen_at \
         FROM einsatz_mitgliedschaft m \
         JOIN benutzer b ON b.id = m.benutzer_id \
         WHERE m.einsatz_id = ? \
         ORDER BY m.zugewiesen_at, m.benutzer_id",
    )
    .bind(einsatz_id)
    .fetch_all(pool)
    .await
    .map_err(Into::into)
}

/// Setzt (oder aktualisiert) die Einsatz-Rolle eines Benutzers in einem Einsatz.
pub async fn setze_rolle(
    pool: &SqlitePool,
    einsatz_id: i64,
    benutzer_id: i64,
    rolle: EinsatzRolle,
) -> Result<(), AppError> {
    sqlx::query(
        "INSERT INTO einsatz_mitgliedschaft (einsatz_id, benutzer_id, einsatz_rolle) \
         VALUES (?, ?, ?) \
         ON CONFLICT(einsatz_id, benutzer_id) DO UPDATE SET einsatz_rolle = excluded.einsatz_rolle",
    )
    .bind(einsatz_id)
    .bind(benutzer_id)
    .bind(rolle.as_str())
    .execute(pool)
    .await?;
    Ok(())
}

/// Entfernt eine Mitgliedschaft (idempotent).
pub async fn entferne(
    pool: &SqlitePool,
    einsatz_id: i64,
    benutzer_id: i64,
) -> Result<(), AppError> {
    sqlx::query("DELETE FROM einsatz_mitgliedschaft WHERE einsatz_id = ? AND benutzer_id = ?")
        .bind(einsatz_id)
        .bind(benutzer_id)
        .execute(pool)
        .await?;
    Ok(())
}

/// Anzahl der Einsatzleitungen in einem Einsatz (für den „letzte Leitung"-Schutz).
pub async fn zaehle_einsatzleitung(
    pool: &SqlitePool,
    einsatz_id: i64,
) -> Result<i64, AppError> {
    sqlx::query_scalar(
        "SELECT COUNT(*) FROM einsatz_mitgliedschaft \
         WHERE einsatz_id = ? AND einsatz_rolle = ?",
    )
    .bind(einsatz_id)
    .bind(EINSATZ_ROLLE_LEITUNG)
    .fetch_one(pool)
    .await
    .map_err(Into::into)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::einsatz::STATUS_ABGESCHLOSSEN;

    /// Legt Org (id=1) + einen Benutzer an und liefert dessen id.
    async fn benutzer_anlegen(pool: &SqlitePool, name: &str) -> i64 {
        sqlx::query("INSERT OR IGNORE INTO organisation (id, name) VALUES (1, 'Orga')")
            .execute(pool)
            .await
            .unwrap();
        sqlx::query(
            "INSERT INTO benutzer (org_id, anzeigename, benutzername, passwort_hash) \
             VALUES (1, ?, ?, 'h')",
        )
        .bind(name)
        .bind(name)
        .execute(pool)
        .await
        .unwrap();
        sqlx::query_scalar::<_, i64>("SELECT id FROM benutzer WHERE benutzername = ?")
            .bind(name)
            .fetch_one(pool)
            .await
            .unwrap()
    }

    #[tokio::test]
    async fn anlegen_macht_ersteller_zur_einsatzleitung() {
        let pool = crate::db::test_pool().await;
        let leit = benutzer_anlegen(&pool, "leit").await;

        let einsatz = anlegen(&pool, "Hochwasser", Some("Deichbruch"), leit)
            .await
            .unwrap();
        assert_eq!(einsatz.bezeichnung, "Hochwasser");
        assert_eq!(einsatz.stichwort.as_deref(), Some("Deichbruch"));
        assert!(einsatz.ist_aktiv());

        let rolle = rolle_von(&pool, einsatz.id, leit).await.unwrap();
        assert_eq!(rolle, Some(EinsatzRolle::Einsatzleitung));
    }

    #[tokio::test]
    async fn rolle_von_fuer_nicht_mitglied_ist_none() {
        let pool = crate::db::test_pool().await;
        let leit = benutzer_anlegen(&pool, "leit").await;
        let fremd = benutzer_anlegen(&pool, "fremd").await;
        let einsatz = anlegen(&pool, "Lage", None, leit).await.unwrap();

        assert_eq!(rolle_von(&pool, einsatz.id, fremd).await.unwrap(), None);
    }

    #[tokio::test]
    async fn abschliessen_setzt_status_und_von() {
        let pool = crate::db::test_pool().await;
        let leit = benutzer_anlegen(&pool, "leit").await;
        let einsatz = anlegen(&pool, "Lage", None, leit).await.unwrap();

        let abgeschlossen = abschliessen(&pool, einsatz.id, leit).await.unwrap();
        assert_eq!(abgeschlossen.status, STATUS_ABGESCHLOSSEN);
        assert!(abgeschlossen.abgeschlossen_at.is_some());
        assert_eq!(abgeschlossen.abgeschlossen_von, Some(leit));
        assert!(!abgeschlossen.ist_aktiv());
    }

    #[tokio::test]
    async fn setze_rolle_legt_an_und_aktualisiert() {
        let pool = crate::db::test_pool().await;
        let leit = benutzer_anlegen(&pool, "leit").await;
        let erika = benutzer_anlegen(&pool, "erika").await;
        let einsatz = anlegen(&pool, "Lage", None, leit).await.unwrap();

        setze_rolle(&pool, einsatz.id, erika, EinsatzRolle::Beobachter)
            .await
            .unwrap();
        assert_eq!(
            rolle_von(&pool, einsatz.id, erika).await.unwrap(),
            Some(EinsatzRolle::Beobachter)
        );

        // Upsert: dieselbe (einsatz, benutzer)-Kombination aktualisiert die Rolle.
        setze_rolle(&pool, einsatz.id, erika, EinsatzRolle::Fuehrungspersonal)
            .await
            .unwrap();
        assert_eq!(
            rolle_von(&pool, einsatz.id, erika).await.unwrap(),
            Some(EinsatzRolle::Fuehrungspersonal)
        );
    }

    #[tokio::test]
    async fn entferne_loescht_mitgliedschaft() {
        let pool = crate::db::test_pool().await;
        let leit = benutzer_anlegen(&pool, "leit").await;
        let erika = benutzer_anlegen(&pool, "erika").await;
        let einsatz = anlegen(&pool, "Lage", None, leit).await.unwrap();
        setze_rolle(&pool, einsatz.id, erika, EinsatzRolle::Beobachter)
            .await
            .unwrap();

        entferne(&pool, einsatz.id, erika).await.unwrap();
        assert_eq!(rolle_von(&pool, einsatz.id, erika).await.unwrap(), None);
    }

    #[tokio::test]
    async fn zaehle_einsatzleitung_zaehlt_nur_leitungen() {
        let pool = crate::db::test_pool().await;
        let leit = benutzer_anlegen(&pool, "leit").await;
        let erika = benutzer_anlegen(&pool, "erika").await;
        let einsatz = anlegen(&pool, "Lage", None, leit).await.unwrap();
        setze_rolle(&pool, einsatz.id, erika, EinsatzRolle::Beobachter)
            .await
            .unwrap();

        assert_eq!(zaehle_einsatzleitung(&pool, einsatz.id).await.unwrap(), 1);

        setze_rolle(&pool, einsatz.id, erika, EinsatzRolle::Einsatzleitung)
            .await
            .unwrap();
        assert_eq!(zaehle_einsatzleitung(&pool, einsatz.id).await.unwrap(), 2);
    }

    #[tokio::test]
    async fn liste_fuer_annotiert_meine_rolle() {
        let pool = crate::db::test_pool().await;
        let leit = benutzer_anlegen(&pool, "leit").await;
        let fremd = benutzer_anlegen(&pool, "fremd").await;
        let einsatz = anlegen(&pool, "Lage", None, leit).await.unwrap();

        // Ersteller sieht sich als Einsatzleitung.
        let fuer_leit = liste_fuer(&pool, leit).await.unwrap();
        assert_eq!(fuer_leit.len(), 1);
        assert_eq!(fuer_leit[0].id, einsatz.id);
        assert_eq!(fuer_leit[0].meine_rolle.as_deref(), Some(EINSATZ_ROLLE_LEITUNG));

        // Nicht-Mitglied sieht den Einsatz, aber ohne Rolle.
        let fuer_fremd = liste_fuer(&pool, fremd).await.unwrap();
        assert_eq!(fuer_fremd.len(), 1);
        assert_eq!(fuer_fremd[0].meine_rolle, None);
    }
}
