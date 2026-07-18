//! Fahrzeug-Besatzung (LFH-9): exklusive Zuordnung einer Personal-Dispozeile zu einem
//! disponierten Fahrzeug über die FK-Spalte `einsatz_personal.fahrzeug_id`. Modelliert
//! exakt nach dem K&M‑3-Mitgliedschaftsmuster (`einheit::mitglied_repo`), aber
//! **unabhängig** von `einheit_id`: die Besatzung eines Fahrzeugs ist nicht die
//! Einheiten-Mitgliedschaft.

use crate::error::AppError;
use sqlx::{SqliteConnection, SqlitePool};

/// Prüft (auf offener Connection/Transaktion), ob ein Fahrzeug zum Einsatz gehört.
/// `NotFound` sonst.
async fn pruefe_fahrzeug_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    ef_id: i64,
) -> Result<(), AppError> {
    let t: Option<i64> =
        sqlx::query_scalar("SELECT 1 FROM einsatz_fahrzeug WHERE id = ? AND einsatz_id = ?")
            .bind(ef_id)
            .bind(einsatz_id)
            .fetch_optional(&mut *conn)
            .await?;
    t.map(|_| ()).ok_or(AppError::NotFound)
}

/// Ordnet eine Personal-Dispozeile einem Fahrzeug als Besatzung zu, auf einer offenen
/// Connection/Transaktion (F06/LFH-244 Tier-A; exklusiv: eine bereits andernorts
/// zugeordnete Kraft wechselt). `NotFound`, falls Dispozeile oder Fahrzeug nicht zum
/// Einsatz gehören. Liefert den Personen-Namen (für den ETB-Text).
pub async fn ordne_besatzung_zu_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    ef_id: i64,
    ep_id: i64,
) -> Result<String, AppError> {
    pruefe_fahrzeug_tx(&mut *conn, einsatz_id, ef_id).await?;
    let name: Option<String> = sqlx::query_scalar(
        "SELECT snap_name FROM einsatz_personal WHERE id = ? AND einsatz_id = ?",
    )
    .bind(ep_id)
    .bind(einsatz_id)
    .fetch_optional(&mut *conn)
    .await?;
    let name = name.ok_or(AppError::NotFound)?;
    sqlx::query("UPDATE einsatz_personal SET fahrzeug_id = ? WHERE id = ? AND einsatz_id = ?")
        .bind(ef_id)
        .bind(ep_id)
        .bind(einsatz_id)
        .execute(&mut *conn)
        .await?;
    Ok(name)
}

/// Pool-Wrapper: ordnet Besatzung in eigener Transaktion zu.
pub async fn ordne_besatzung_zu(
    pool: &SqlitePool,
    einsatz_id: i64,
    ef_id: i64,
    ep_id: i64,
) -> Result<String, AppError> {
    let mut conn = pool.acquire().await?;
    ordne_besatzung_zu_tx(&mut conn, einsatz_id, ef_id, ep_id).await
}

/// Gibt eine Personal-Dispozeile aus ihrem Fahrzeug frei (`fahrzeug_id = NULL`), auf einer
/// offenen Connection/Transaktion (F06/LFH-244 Tier-A). `NotFound`, falls die Kraft nicht
/// gerade diesem Fahrzeug zugeordnet ist (die WHERE-Klausel verifiziert die Ist-Zuordnung).
/// Liefert den Personen-Namen.
pub async fn gib_besatzung_frei_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    ef_id: i64,
    ep_id: i64,
) -> Result<String, AppError> {
    let name: Option<String> = sqlx::query_scalar(
        "SELECT snap_name FROM einsatz_personal WHERE id = ? AND einsatz_id = ? AND fahrzeug_id = ?",
    ).bind(ep_id).bind(einsatz_id).bind(ef_id).fetch_optional(&mut *conn).await?;
    let name = name.ok_or(AppError::NotFound)?;
    // `einsatz_id` defensiv im UPDATE wiederholen (Symmetrie zu `ordne_besatzung_zu`),
    // obwohl der SELECT-Guard die Zugehörigkeit bereits verifiziert hat.
    sqlx::query("UPDATE einsatz_personal SET fahrzeug_id = NULL WHERE id = ? AND einsatz_id = ?")
        .bind(ep_id)
        .bind(einsatz_id)
        .execute(&mut *conn)
        .await?;
    Ok(name)
}

/// Pool-Wrapper: gibt Besatzung in eigener Transaktion frei.
pub async fn gib_besatzung_frei(
    pool: &SqlitePool,
    einsatz_id: i64,
    ef_id: i64,
    ep_id: i64,
) -> Result<String, AppError> {
    let mut conn = pool.acquire().await?;
    gib_besatzung_frei_tx(&mut conn, einsatz_id, ef_id, ep_id).await
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Org(1) + Einsatz + zwei disponierte Fahrzeuge; liefert (einsatz, fz_a, fz_b).
    async fn setup(pool: &SqlitePool) -> (i64, i64, i64) {
        sqlx::query("INSERT INTO organisation (id, name) VALUES (1, 'Orga')")
            .execute(pool)
            .await
            .unwrap();
        let einsatz: i64 = sqlx::query_scalar(
            "INSERT INTO einsatz (org_id, bezeichnung) VALUES (1, 'Lage') RETURNING id",
        )
        .fetch_one(pool)
        .await
        .unwrap();
        let a: i64 = sqlx::query_scalar("INSERT INTO einsatz_fahrzeug (einsatz_id, snap_funkrufname) VALUES (?, 'Florian 1') RETURNING id")
            .bind(einsatz).fetch_one(pool).await.unwrap();
        let b: i64 = sqlx::query_scalar("INSERT INTO einsatz_fahrzeug (einsatz_id, snap_funkrufname) VALUES (?, 'Florian 2') RETURNING id")
            .bind(einsatz).fetch_one(pool).await.unwrap();
        (einsatz, a, b)
    }

    /// Disponiert eine Ad-hoc-Person; liefert ep_id.
    async fn person(pool: &SqlitePool, einsatz: i64, name: &str) -> i64 {
        sqlx::query_scalar(
            "INSERT INTO einsatz_personal (einsatz_id, snap_name) VALUES (?, ?) RETURNING id",
        )
        .bind(einsatz)
        .bind(name)
        .fetch_one(pool)
        .await
        .unwrap()
    }

    async fn fahrzeug_von(pool: &SqlitePool, ep: i64) -> Option<i64> {
        sqlx::query_scalar("SELECT fahrzeug_id FROM einsatz_personal WHERE id = ?")
            .bind(ep)
            .fetch_one(pool)
            .await
            .unwrap()
    }

    #[tokio::test]
    async fn zuordnen_wechseln_freigeben() {
        let pool = crate::db::test_pool().await;
        let (einsatz, a, b) = setup(&pool).await;
        let ep = person(&pool, einsatz, "Anna").await;

        assert_eq!(
            ordne_besatzung_zu(&pool, einsatz, a, ep).await.unwrap(),
            "Anna"
        );
        assert_eq!(fahrzeug_von(&pool, ep).await, Some(a));

        // Wechsel zu B (exklusiv): A verliert sie.
        ordne_besatzung_zu(&pool, einsatz, b, ep).await.unwrap();
        assert_eq!(fahrzeug_von(&pool, ep).await, Some(b));

        // Freigeben.
        assert_eq!(
            gib_besatzung_frei(&pool, einsatz, b, ep).await.unwrap(),
            "Anna"
        );
        assert_eq!(fahrzeug_von(&pool, ep).await, None);
    }

    #[tokio::test]
    async fn freigeben_falschen_fahrzeugs_ist_notfound() {
        let pool = crate::db::test_pool().await;
        let (einsatz, a, b) = setup(&pool).await;
        let ep = person(&pool, einsatz, "Anna").await;
        ordne_besatzung_zu(&pool, einsatz, a, ep).await.unwrap();
        // Freigeben aus B (gehört aber zu A) → NotFound, Zuordnung bleibt bestehen.
        assert!(matches!(
            gib_besatzung_frei(&pool, einsatz, b, ep).await.unwrap_err(),
            AppError::NotFound
        ));
        assert_eq!(fahrzeug_von(&pool, ep).await, Some(a));
    }

    #[tokio::test]
    async fn zuordnen_fremde_dispozeile_ist_notfound() {
        let pool = crate::db::test_pool().await;
        let (einsatz, a, _b) = setup(&pool).await;
        let fremd: i64 = sqlx::query_scalar(
            "INSERT INTO einsatz (org_id, bezeichnung) VALUES (1, 'Fremd') RETURNING id",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        let fremder_ep = person(&pool, fremd, "Fremd").await;
        assert!(matches!(
            ordne_besatzung_zu(&pool, einsatz, a, fremder_ep)
                .await
                .unwrap_err(),
            AppError::NotFound
        ));
    }

    #[tokio::test]
    async fn zuordnen_fremdes_fahrzeug_ist_notfound() {
        let pool = crate::db::test_pool().await;
        let (einsatz, _a, _b) = setup(&pool).await;
        let fremd: i64 = sqlx::query_scalar(
            "INSERT INTO einsatz (org_id, bezeichnung) VALUES (1, 'Fremd') RETURNING id",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        let fremdes_fz: i64 = sqlx::query_scalar("INSERT INTO einsatz_fahrzeug (einsatz_id, snap_funkrufname) VALUES (?, 'Fremd 1') RETURNING id")
            .bind(fremd).fetch_one(&pool).await.unwrap();
        let ep = person(&pool, einsatz, "Anna").await;
        // Fahrzeug gehört zu anderem Einsatz → NotFound (Org-/Einsatz-Isolation).
        assert!(matches!(
            ordne_besatzung_zu(&pool, einsatz, fremdes_fz, ep)
                .await
                .unwrap_err(),
            AppError::NotFound
        ));
    }
}
