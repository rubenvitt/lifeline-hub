//! Lädt alle verorteten Marker EINES Einsatzes (lat/lon NOT NULL) als Bezugspunkt-
//! Kandidaten für die Peilung. UNION-ALL über die sieben Marker-Tragenden Tabellen;
//! je Quelle ein stabiles `typ`-Tag und eine menschenlesbare `label`-Spalte.

use crate::error::AppError;
use crate::geocoding::peilung::Marker;
use sqlx::SqlitePool;

/// Alle verorteten Marker des Einsatzes (Einsatzort, UHS, Schaden, Einheit, Fahrzeug,
/// Personal/Führung, Lagemeldung). Stornierte UHS/Schäden werden ausgeblendet.
pub async fn lade_marker(pool: &SqlitePool, einsatz_id: i64) -> Result<Vec<Marker>, AppError> {
    let marker = sqlx::query_as::<_, Marker>(
        "SELECT 'einsatzort' AS typ, id, COALESCE(NULLIF(einsatzort, ''), bezeichnung) AS label, \
                einsatzort_lat AS lat, einsatzort_lon AS lon \
           FROM einsatz \
          WHERE id = ?1 AND einsatzort_lat IS NOT NULL AND einsatzort_lon IS NOT NULL \
         UNION ALL \
         SELECT 'uhs', id, bezeichnung, lat, lon FROM uhs \
          WHERE einsatz_id = ?1 AND lat IS NOT NULL AND lon IS NOT NULL AND storniert_at IS NULL \
         UNION ALL \
         SELECT 'schaden', id, 'S-' || registrier_nr, lat, lon FROM einsatz_schaden \
          WHERE einsatz_id = ?1 AND lat IS NOT NULL AND lon IS NOT NULL AND storniert_at IS NULL \
         UNION ALL \
         SELECT 'einheit', id, name, lat, lon FROM einsatz_einheit \
          WHERE einsatz_id = ?1 AND lat IS NOT NULL AND lon IS NOT NULL \
         UNION ALL \
         SELECT 'fahrzeug', id, snap_funkrufname, lat, lon FROM einsatz_fahrzeug \
          WHERE einsatz_id = ?1 AND lat IS NOT NULL AND lon IS NOT NULL \
         UNION ALL \
         SELECT 'personal', id, snap_name, lat, lon FROM einsatz_personal \
          WHERE einsatz_id = ?1 AND lat IS NOT NULL AND lon IS NOT NULL \
         UNION ALL \
         SELECT 'lagemeldung', id, 'Lagemeldung', lat, lon FROM lage_meldung \
          WHERE einsatz_id = ?1 AND lat IS NOT NULL AND lon IS NOT NULL",
    )
    .bind(einsatz_id)
    .fetch_all(pool)
    .await?;
    Ok(marker)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Minimal-Fixture: Org + Benutzer + Einsatz; liefert (benutzer_id, einsatz_id).
    async fn fixture(pool: &sqlx::SqlitePool) -> (i64, i64) {
        sqlx::query("INSERT OR IGNORE INTO organisation (id, name) VALUES (1, 'Orga')")
            .execute(pool)
            .await
            .unwrap();
        let bid: i64 = sqlx::query_scalar(
            "INSERT INTO benutzer (org_id, anzeigename, benutzername, passwort_hash) \
             VALUES (1, 'a', 'a', 'h') RETURNING id",
        )
        .fetch_one(pool)
        .await
        .unwrap();
        let eid: i64 = sqlx::query_scalar(
            "INSERT INTO einsatz (org_id, bezeichnung, einsatzort, einsatzort_lat, einsatzort_lon) \
             VALUES (1, 'Lage', 'Rathaus', 51.0, 10.0) RETURNING id",
        ).fetch_one(pool).await.unwrap();
        (bid, eid)
    }

    #[tokio::test]
    async fn laedt_einsatzort_und_uhs_ignoriert_unverortete() {
        let pool = crate::db::test_pool().await;
        let (bid, eid) = fixture(&pool).await;
        // Eine verortete UHS und eine UNverortete (lat/lon NULL → muss fehlen).
        // Hinweis: 'pa' ist kein gültiger UHS-Typ; CHECK erlaubt nur
        // 'patientenablage'|'behandlungsplatz'|'verletztensammelstelle'|'bereitstellungsraum'|'sonstige'.
        sqlx::query(
            "INSERT INTO uhs (einsatz_id, typ, bezeichnung, status, erfasst_von, geaendert_von, lat, lon) \
             VALUES (?, 'patientenablage', 'PA 1', 'geplant', ?, ?, 51.2, 10.2)",
        ).bind(eid).bind(bid).bind(bid).execute(&pool).await.unwrap();
        sqlx::query(
            "INSERT INTO uhs (einsatz_id, typ, bezeichnung, status, erfasst_von, geaendert_von) \
             VALUES (?, 'patientenablage', 'PA ohne Geo', 'geplant', ?, ?)",
        )
        .bind(eid)
        .bind(bid)
        .bind(bid)
        .execute(&pool)
        .await
        .unwrap();

        let marker = lade_marker(&pool, eid).await.unwrap();
        // Einsatzort + 1 verortete UHS = 2; die unverortete UHS fehlt.
        assert_eq!(marker.len(), 2);
        let einsatzort = marker.iter().find(|m| m.typ == "einsatzort").unwrap();
        assert_eq!(einsatzort.label, "Rathaus");
        assert_eq!(einsatzort.id, eid);
        let uhs = marker.iter().find(|m| m.typ == "uhs").unwrap();
        assert_eq!(uhs.label, "PA 1");
        assert_eq!((uhs.lat, uhs.lon), (51.2, 10.2));
    }

    #[tokio::test]
    async fn fremder_einsatz_liefert_nichts() {
        let pool = crate::db::test_pool().await;
        let (_bid, eid) = fixture(&pool).await;
        let marker = lade_marker(&pool, eid + 999).await.unwrap();
        assert!(marker.is_empty());
    }
}
