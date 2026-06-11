use crate::error::AppError;
use crate::kommunikation::{KommunikationStatus, VOLLZUG_IN_ARBEIT, VOLLZUG_OFFEN, VOLLZUG_VOLLZOGEN};
use sqlx::SqlitePool;

/// Setzt die Quittungs-Achse (UPSERT je Objekt). Vollzug bleibt unberührt.
pub async fn quittiere(
    pool: &SqlitePool, org_id: i64, einsatz_id: i64,
    objekt_typ: &str, objekt_id: i64, von_id: i64, jetzt: &str,
) -> Result<(), AppError> {
    sqlx::query(
        "INSERT INTO kommunikation_status \
           (org_id, einsatz_id, objekt_typ, objekt_id, quittiert_at, quittiert_von_id) \
         VALUES (?, ?, ?, ?, ?, ?) \
         ON CONFLICT(objekt_typ, objekt_id) DO UPDATE SET \
           quittiert_at = excluded.quittiert_at, quittiert_von_id = excluded.quittiert_von_id",
    )
    .bind(org_id).bind(einsatz_id).bind(objekt_typ).bind(objekt_id).bind(jetzt).bind(von_id)
    .execute(pool).await?;
    Ok(())
}

/// Setzt die Vollzugs-Achse (UPSERT je Objekt). Quittung bleibt unberührt.
/// `vollzogen_at`/`_von` nur bei Zielstatus `vollzogen` gesetzt.
#[allow(clippy::too_many_arguments)]
pub async fn setze_vollzug(
    pool: &SqlitePool, org_id: i64, einsatz_id: i64,
    objekt_typ: &str, objekt_id: i64, status: &str, von_id: i64, jetzt: &str,
) -> Result<(), AppError> {
    if status != VOLLZUG_OFFEN && status != VOLLZUG_IN_ARBEIT && status != VOLLZUG_VOLLZOGEN {
        return Err(AppError::Validation("Ungültiger Vollzug-Status".into()));
    }
    let (at, von): (Option<&str>, Option<i64>) =
        if status == VOLLZUG_VOLLZOGEN { (Some(jetzt), Some(von_id)) } else { (None, None) };
    sqlx::query(
        "INSERT INTO kommunikation_status \
           (org_id, einsatz_id, objekt_typ, objekt_id, vollzug_status, vollzogen_at, vollzogen_von_id) \
         VALUES (?, ?, ?, ?, ?, ?, ?) \
         ON CONFLICT(objekt_typ, objekt_id) DO UPDATE SET \
           vollzug_status = excluded.vollzug_status, \
           vollzogen_at = excluded.vollzogen_at, vollzogen_von_id = excluded.vollzogen_von_id",
    )
    .bind(org_id).bind(einsatz_id).bind(objekt_typ).bind(objekt_id).bind(status).bind(at).bind(von)
    .execute(pool).await?;
    Ok(())
}

/// Lädt den geteilten Status eines Objekts — nach Einsatz isoliert.
/// `None`, wenn kein Status existiert oder der Einsatz nicht passt.
pub async fn lade_status(
    pool: &SqlitePool, einsatz_id: i64, objekt_typ: &str, objekt_id: i64,
) -> Result<Option<KommunikationStatus>, AppError> {
    sqlx::query_as::<_, KommunikationStatus>(
        "SELECT objekt_typ, objekt_id, quittiert_at, quittiert_von_id, \
                vollzug_status, vollzogen_at, vollzogen_von_id \
         FROM kommunikation_status \
         WHERE einsatz_id = ? AND objekt_typ = ? AND objekt_id = ?",
    )
    .bind(einsatz_id).bind(objekt_typ).bind(objekt_id)
    .fetch_optional(pool).await.map_err(Into::into)
}

/// Vermerkt Zustellung (zugestellt_at) je (Objekt, Empfänger), idempotent.
pub async fn vermerke_zustellung(
    pool: &SqlitePool, org_id: i64, einsatz_id: i64,
    objekt_typ: &str, objekt_id: i64, empfaenger_id: i64, jetzt: &str,
) -> Result<(), AppError> {
    sqlx::query(
        "INSERT INTO kommunikation_zustellung \
           (org_id, einsatz_id, objekt_typ, objekt_id, empfaenger_id, zugestellt_at) \
         VALUES (?, ?, ?, ?, ?, ?) \
         ON CONFLICT(objekt_typ, objekt_id, empfaenger_id) DO UPDATE SET \
           zugestellt_at = COALESCE(kommunikation_zustellung.zugestellt_at, excluded.zugestellt_at)",
    )
    .bind(org_id).bind(einsatz_id).bind(objekt_typ).bind(objekt_id).bind(empfaenger_id).bind(jetzt)
    .execute(pool).await?;
    Ok(())
}

/// Markiert Lesebestätigung (gelesen_at) je (Objekt, Empfänger), idempotent.
pub async fn markiere_gelesen(
    pool: &SqlitePool, org_id: i64, einsatz_id: i64,
    objekt_typ: &str, objekt_id: i64, empfaenger_id: i64, jetzt: &str,
) -> Result<(), AppError> {
    sqlx::query(
        "INSERT INTO kommunikation_zustellung \
           (org_id, einsatz_id, objekt_typ, objekt_id, empfaenger_id, gelesen_at) \
         VALUES (?, ?, ?, ?, ?, ?) \
         ON CONFLICT(objekt_typ, objekt_id, empfaenger_id) DO UPDATE SET \
           gelesen_at = COALESCE(kommunikation_zustellung.gelesen_at, excluded.gelesen_at)",
    )
    .bind(org_id).bind(einsatz_id).bind(objekt_typ).bind(objekt_id).bind(empfaenger_id).bind(jetzt)
    .execute(pool).await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::kommunikation::OBJEKT_ERINNERUNG;

    async fn setup(pool: &SqlitePool) -> (i64, i64) {
        sqlx::query("INSERT OR IGNORE INTO organisation (id, name) VALUES (1, 'Orga')")
            .execute(pool).await.unwrap();
        let b: i64 = sqlx::query_scalar(
            "INSERT INTO benutzer (org_id, anzeigename, benutzername, passwort_hash) \
             VALUES (1,'L','l','h') RETURNING id").fetch_one(pool).await.unwrap();
        let e: i64 = sqlx::query_scalar(
            "INSERT INTO einsatz (org_id, bezeichnung) VALUES (1,'Lage') RETURNING id")
            .fetch_one(pool).await.unwrap();
        (b, e)
    }

    #[tokio::test]
    async fn quittieren_setzt_quittungs_achse_ohne_vollzug() {
        let pool = crate::db::test_pool().await;
        let (b, e) = setup(&pool).await;
        quittiere(&pool, 1, e, OBJEKT_ERINNERUNG, 7, b, "2026-06-11 10:00:00").await.unwrap();
        let s = lade_status(&pool, e, OBJEKT_ERINNERUNG, 7).await.unwrap().unwrap();
        assert_eq!(s.quittiert_at.as_deref(), Some("2026-06-11 10:00:00"));
        assert_eq!(s.quittiert_von_id, Some(b));
        assert_eq!(s.vollzug_status, VOLLZUG_OFFEN);
    }

    #[tokio::test]
    async fn vollzug_setzen_ist_unabhaengig_von_quittung() {
        let pool = crate::db::test_pool().await;
        let (b, e) = setup(&pool).await;
        setze_vollzug(&pool, 1, e, OBJEKT_ERINNERUNG, 7, VOLLZUG_VOLLZOGEN, b, "2026-06-11 11:00:00").await.unwrap();
        let s = lade_status(&pool, e, OBJEKT_ERINNERUNG, 7).await.unwrap().unwrap();
        assert_eq!(s.vollzug_status, VOLLZUG_VOLLZOGEN);
        assert_eq!(s.vollzogen_at.as_deref(), Some("2026-06-11 11:00:00"));
        assert!(s.quittiert_at.is_none());
    }

    #[tokio::test]
    async fn beide_achsen_koexistieren() {
        let pool = crate::db::test_pool().await;
        let (b, e) = setup(&pool).await;
        quittiere(&pool, 1, e, OBJEKT_ERINNERUNG, 7, b, "2026-06-11 10:00:00").await.unwrap();
        setze_vollzug(&pool, 1, e, OBJEKT_ERINNERUNG, 7, VOLLZUG_VOLLZOGEN, b, "2026-06-11 11:00:00").await.unwrap();
        let s = lade_status(&pool, e, OBJEKT_ERINNERUNG, 7).await.unwrap().unwrap();
        assert!(s.quittiert_at.is_some());
        assert_eq!(s.vollzug_status, VOLLZUG_VOLLZOGEN);
    }

    #[tokio::test]
    async fn vollzug_lehnt_ungueltigen_status_ab() {
        let pool = crate::db::test_pool().await;
        let (b, e) = setup(&pool).await;
        let err = setze_vollzug(&pool, 1, e, OBJEKT_ERINNERUNG, 7, "blubb", b, "2026-06-11 11:00:00").await.unwrap_err();
        assert!(matches!(err, AppError::Validation(_)));
    }

    #[tokio::test]
    async fn lade_status_isoliert_nach_einsatz() {
        let pool = crate::db::test_pool().await;
        let (b, e) = setup(&pool).await;
        quittiere(&pool, 1, e, OBJEKT_ERINNERUNG, 7, b, "2026-06-11 10:00:00").await.unwrap();
        assert!(lade_status(&pool, 999, OBJEKT_ERINNERUNG, 7).await.unwrap().is_none());
    }

    #[tokio::test]
    async fn zustellung_gelesen_ist_idempotent_pro_empfaenger() {
        let pool = crate::db::test_pool().await;
        let (b, e) = setup(&pool).await;
        markiere_gelesen(&pool, 1, e, OBJEKT_ERINNERUNG, 7, b, "2026-06-11 10:00:00").await.unwrap();
        markiere_gelesen(&pool, 1, e, OBJEKT_ERINNERUNG, 7, b, "2026-06-11 10:05:00").await.unwrap();
        let n: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM kommunikation_zustellung WHERE objekt_id = 7 AND empfaenger_id = ?")
            .bind(b).fetch_one(&pool).await.unwrap();
        assert_eq!(n, 1);
    }

    #[tokio::test]
    async fn vermerke_zustellung_haelt_ersten_zeitstempel() {
        let pool = crate::db::test_pool().await;
        let (b, e) = setup(&pool).await;
        vermerke_zustellung(&pool, 1, e, OBJEKT_ERINNERUNG, 7, b, "2026-06-11 10:00:00").await.unwrap();
        vermerke_zustellung(&pool, 1, e, OBJEKT_ERINNERUNG, 7, b, "2026-06-11 10:09:00").await.unwrap();
        let row: (i64, Option<String>) = sqlx::query_as(
            "SELECT COUNT(*), MIN(zugestellt_at) FROM kommunikation_zustellung WHERE objekt_id = 7 AND empfaenger_id = ?")
            .bind(b).fetch_one(&pool).await.unwrap();
        assert_eq!(row.0, 1, "eine Zeile je (Objekt, Empfänger)");
        assert_eq!(row.1.as_deref(), Some("2026-06-11 10:00:00"), "erster Zeitstempel bleibt erhalten");
    }

    #[tokio::test]
    async fn vollzug_in_arbeit_haelt_vollzogen_felder_leer_und_downgrade_loescht_sie() {
        let pool = crate::db::test_pool().await;
        let (b, e) = setup(&pool).await;
        // in_arbeit: keine vollzogen-Felder
        setze_vollzug(&pool, 1, e, OBJEKT_ERINNERUNG, 7, VOLLZUG_IN_ARBEIT, b, "2026-06-11 10:00:00").await.unwrap();
        let s1 = lade_status(&pool, e, OBJEKT_ERINNERUNG, 7).await.unwrap().unwrap();
        assert_eq!(s1.vollzug_status, VOLLZUG_IN_ARBEIT);
        assert!(s1.vollzogen_at.is_none());
        assert!(s1.vollzogen_von_id.is_none());
        // vollzogen setzt sie
        setze_vollzug(&pool, 1, e, OBJEKT_ERINNERUNG, 7, VOLLZUG_VOLLZOGEN, b, "2026-06-11 11:00:00").await.unwrap();
        assert!(lade_status(&pool, e, OBJEKT_ERINNERUNG, 7).await.unwrap().unwrap().vollzogen_at.is_some());
        // Downgrade zurück auf in_arbeit löscht sie wieder
        setze_vollzug(&pool, 1, e, OBJEKT_ERINNERUNG, 7, VOLLZUG_IN_ARBEIT, b, "2026-06-11 12:00:00").await.unwrap();
        let s3 = lade_status(&pool, e, OBJEKT_ERINNERUNG, 7).await.unwrap().unwrap();
        assert!(s3.vollzogen_at.is_none(), "Downgrade löscht vollzogen_at");
        assert!(s3.vollzogen_von_id.is_none());
    }
}
