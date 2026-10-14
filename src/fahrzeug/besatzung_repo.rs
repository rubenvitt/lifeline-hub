//! Fahrzeug-Besatzung (LFH-9): exklusive Zuordnung einer Personal-Dispozeile zu einem
//! disponierten Fahrzeug über die FK-Spalte `einsatz_personal.fahrzeug_id`. Modelliert
//! exakt nach dem K&M‑3-Mitgliedschaftsmuster (`einheit::mitglied_repo`), aber
//! **unabhängig** von `einheit_id`: die Besatzung eines Fahrzeugs ist nicht die
//! Einheiten-Mitgliedschaft.

use crate::error::AppError;
use sqlx::SqliteConnection;

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
    // Ein entlassenes oder storniertes Fahrzeug bekommt keine Besatzung (409, LLH-1079).
    super::disposition_repo::require_aktiv_tx(&mut *conn, einsatz_id, ef_id).await?;
    let name: Option<String> = sqlx::query_scalar(
        "SELECT snap_name FROM einsatz_personal WHERE id = ? AND einsatz_id = ?",
    )
    .bind(ep_id)
    .bind(einsatz_id)
    .fetch_optional(&mut *conn)
    .await?;
    let name = name.ok_or(AppError::NotFound)?;
    // Eine entlassene oder stornierte Kraft fährt nicht mit (409, LLH-1079).
    crate::personal::disposition_repo::require_nicht_beendet(&mut *conn, einsatz_id, ep_id).await?;
    sqlx::query("UPDATE einsatz_personal SET fahrzeug_id = ? WHERE id = ? AND einsatz_id = ?")
        .bind(ef_id)
        .bind(ep_id)
        .bind(einsatz_id)
        .execute(&mut *conn)
        .await?;
    Ok(name)
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

/// Meldung des 422, wenn beim Übernehmen nicht jede Person zugeordnet werden kann (LLH-1073 D12).
pub const MELDUNG_PERSONEN: &str = "Nicht alle Personen lassen sich zuordnen";

/// Eine Person der Menge beim Übernehmen der Besatzung: `ep_id`, Name für den ETB-Text und das
/// Fahrzeug, auf dem sie vorher saß (für das Ereignis an das verlassene Fahrzeug).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PersonDerMenge {
    pub ep_id: i64,
    pub name: String,
    pub vorher: Option<i64>,
}

/// Vorprüfung der Personen beim Übernehmen der Besatzung (LLH-1073, design.md D12) in **einer**
/// Abfrage über `json_each`: unbekannt oder aus einem anderen Einsatz, beendet (`entlassen`,
/// `storniert`). Lehnt mit [`AppError::Zeilen`] (422, `art = personal`, `einsatz_personal.id`)
/// ab, sonst die Personen in der Reihenfolge der Eingabe. `ep_ids` ist entdoppelt.
pub async fn check_besatzung_menge_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    ep_ids: &[i64],
) -> Result<Vec<PersonDerMenge>, AppError> {
    let zeilen: Vec<(
        i64,
        Option<i64>,
        Option<String>,
        Option<String>,
        Option<i64>,
    )> = sqlx::query_as(
        "SELECT j.value, ep.id, ep.snap_name, ep.beendet_als, ep.fahrzeug_id \
             FROM json_each(?1) j \
             LEFT JOIN einsatz_personal ep ON ep.id = j.value AND ep.einsatz_id = ?2 \
             ORDER BY j.key",
    )
    .bind(crate::kraefte_disposition::ids_json(ep_ids))
    .bind(einsatz_id)
    .fetch_all(&mut *conn)
    .await?;
    let mut personen = Vec::with_capacity(zeilen.len());
    let mut abgelehnt = Vec::new();
    for (id, ep, name, beendet_als, vorher) in zeilen {
        let grund = match (ep, beendet_als) {
            (None, _) => Some(crate::kraefte_disposition::GRUND_UNBEKANNT.to_string()),
            (Some(_), Some(als)) => Some(als),
            (Some(_), None) => None,
        };
        match grund {
            Some(grund) => abgelehnt.push(crate::error::ZeilenGrund {
                art: crate::error::ZeilenArt::Personal,
                id,
                grund,
            }),
            None => personen.push(PersonDerMenge {
                ep_id: id,
                name: name.unwrap_or_default(),
                vorher,
            }),
        }
    }
    if abgelehnt.is_empty() {
        Ok(personen)
    } else {
        Err(AppError::Zeilen {
            meldung: MELDUNG_PERSONEN.into(),
            zeilen: abgelehnt,
        })
    }
}

/// Ordnet die (vorgeprüften) Personen einem Fahrzeug als Besatzung zu, in **einer** Anweisung
/// (LLH-1073 D12). Additiv und exklusiv wie [`ordne_besatzung_zu_tx`]: wer woanders sitzt,
/// wechselt.
pub async fn zuordnen_besatzung_menge_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    ef_id: i64,
    ep_ids: &[i64],
) -> Result<(), AppError> {
    sqlx::query(
        "UPDATE einsatz_personal SET fahrzeug_id = ?1 \
         WHERE einsatz_id = ?2 AND beendet_at IS NULL \
           AND id IN (SELECT value FROM json_each(?3))",
    )
    .bind(ef_id)
    .bind(einsatz_id)
    .bind(crate::kraefte_disposition::ids_json(ep_ids))
    .execute(&mut *conn)
    .await?;
    Ok(())
}

/// Die Besatzung eines Fahrzeugs (`einsatz_personal.id`). Wer das Fahrzeug entfernt, fragt
/// vorher; die Freigabe ändert die Zeilen der Personalliste, das Ereignis `personal` muss der
/// Aufrufer melden (LLH-1182).
pub async fn load_besatzung_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    ef_id: i64,
) -> Result<Vec<i64>, AppError> {
    let ids = sqlx::query_scalar(
        "SELECT id FROM einsatz_personal \
         WHERE einsatz_id = ? AND fahrzeug_id = ? AND beendet_at IS NULL ORDER BY id",
    )
    .bind(einsatz_id)
    .bind(ef_id)
    .fetch_all(&mut *conn)
    .await?;
    Ok(ids)
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::SqlitePool;

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
            ordne_besatzung_zu_tx(&mut *pool.acquire().await.unwrap(), einsatz, a, ep)
                .await
                .unwrap(),
            "Anna"
        );
        assert_eq!(fahrzeug_von(&pool, ep).await, Some(a));

        // Wechsel zu B (exklusiv): A verliert sie.
        ordne_besatzung_zu_tx(&mut *pool.acquire().await.unwrap(), einsatz, b, ep)
            .await
            .unwrap();
        assert_eq!(fahrzeug_von(&pool, ep).await, Some(b));

        // Freigeben.
        assert_eq!(
            gib_besatzung_frei_tx(&mut *pool.acquire().await.unwrap(), einsatz, b, ep)
                .await
                .unwrap(),
            "Anna"
        );
        assert_eq!(fahrzeug_von(&pool, ep).await, None);
    }

    #[tokio::test]
    async fn freigeben_falschen_fahrzeugs_ist_notfound() {
        let pool = crate::db::test_pool().await;
        let (einsatz, a, b) = setup(&pool).await;
        let ep = person(&pool, einsatz, "Anna").await;
        ordne_besatzung_zu_tx(&mut *pool.acquire().await.unwrap(), einsatz, a, ep)
            .await
            .unwrap();
        // Freigeben aus B (gehört aber zu A) → NotFound, Zuordnung bleibt bestehen.
        assert!(matches!(
            gib_besatzung_frei_tx(&mut *pool.acquire().await.unwrap(), einsatz, b, ep)
                .await
                .unwrap_err(),
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
            ordne_besatzung_zu_tx(&mut *pool.acquire().await.unwrap(), einsatz, a, fremder_ep)
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
            ordne_besatzung_zu_tx(&mut *pool.acquire().await.unwrap(), einsatz, fremdes_fz, ep)
                .await
                .unwrap_err(),
            AppError::NotFound
        ));
    }
}
