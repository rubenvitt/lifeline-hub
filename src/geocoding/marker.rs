//! Lädt alle verorteten Marker EINES Einsatzes (lat/lon NOT NULL) als Bezugspunkt-
//! Kandidaten für die Peilung. UNION-ALL über die sieben Marker-Tragenden Tabellen;
//! je Quelle ein stabiles `typ`-Tag und eine menschenlesbare `label`-Spalte.

use crate::error::AppError;
use crate::geocoding::peilung::Marker;
use sqlx::SqlitePool;

/// Alle verorteten Marker des Einsatzes (Einsatzort, UHS, Schaden, Einheit, Fahrzeug,
/// Personal/Führung, Lagemeldung). Stornierte UHS/Schäden werden ausgeblendet. Eine Lagemeldung
/// heißt nach der Nummer ihrer Meldung („Lagemeldung #3“, LLH-1039), damit der Ortsbezug sagt,
/// welche.
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
          WHERE einsatz_id = ?1 AND lat IS NOT NULL AND lon IS NOT NULL AND aufgeloest_at IS NULL \
         UNION ALL \
         SELECT 'fahrzeug', id, snap_funkrufname, lat, lon FROM einsatz_fahrzeug \
          WHERE einsatz_id = ?1 AND lat IS NOT NULL AND lon IS NOT NULL AND beendet_at IS NULL \
         UNION ALL \
         SELECT 'personal', id, snap_name, lat, lon FROM einsatz_personal \
          WHERE einsatz_id = ?1 AND lat IS NOT NULL AND lon IS NOT NULL AND beendet_at IS NULL \
         UNION ALL \
         SELECT 'lagemeldung', lm.id, 'Lagemeldung #' || m.lfd_nr, lm.lat, lm.lon \
           FROM lage_meldung lm JOIN meldung m ON m.id = lm.meldung_id \
          WHERE lm.einsatz_id = ?1 AND lm.lat IS NOT NULL AND lm.lon IS NOT NULL",
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
    async fn entlassene_kraft_und_aufgeloeste_einheit_sind_kein_bezugspunkt() {
        let pool = crate::db::test_pool().await;
        let (bid, eid) = fixture(&pool).await;
        for (name, ende) in [("Aktiv", None), ("Weg", Some("2026-10-13 10:00:00"))] {
            sqlx::query(
                "INSERT INTO einsatz_einheit (einsatz_id, name, lat, lon, aufgeloest_at) \
                 VALUES (?, ?, 51.1, 10.1, ?)",
            )
            .bind(eid)
            .bind(name)
            .bind(ende)
            .execute(&pool)
            .await
            .unwrap();
            sqlx::query(
                "INSERT INTO einsatz_personal (einsatz_id, snap_name, disponiert_von, \
                                               lat, lon, beendet_at, beendet_als) \
                 VALUES (?, ?, ?, 51.3, 10.3, ?, ?)",
            )
            .bind(eid)
            .bind(name)
            .bind(bid)
            .bind(ende)
            .bind(ende.map(|_| "entlassen"))
            .execute(&pool)
            .await
            .unwrap();
        }
        let mut namen: Vec<_> = lade_marker(&pool, eid)
            .await
            .unwrap()
            .into_iter()
            .filter(|m| m.typ == "einheit" || m.typ == "personal")
            .map(|m| (m.typ, m.label))
            .collect();
        namen.sort();
        assert_eq!(
            namen,
            [
                ("einheit".to_string(), "Aktiv".to_string()),
                ("personal".to_string(), "Aktiv".to_string())
            ]
        );
    }

    #[tokio::test]
    async fn lagemeldung_traegt_die_nummer_ihrer_meldung() {
        let pool = crate::db::test_pool().await;
        let (bid, eid) = fixture(&pool).await;
        // Zwei Meldungen; nur die mit lfd_nr 7 wird verortet übergeben, die andere unverortet.
        let mut lage_ids = Vec::new();
        for (nr, geo) in [(3_i64, None), (7, Some((51.4, 10.4)))] {
            let mid: i64 = sqlx::query_scalar(
                "INSERT INTO meldung (einsatz_id, lfd_nr, absender, meldeweg, inhalt, \
                                      ereigniszeit, eingang_at, erfasst_von_id) \
                 VALUES (?, ?, 'Florian Nord 1', 'funk', 'X', '2026-06-12 09:00:00', \
                         '2026-06-12 09:00:00', ?) RETURNING id",
            )
            .bind(eid)
            .bind(nr)
            .bind(bid)
            .fetch_one(&pool)
            .await
            .unwrap();
            let lid = crate::meldung::repo::als_lagerelevant(&pool, eid, mid, bid, "X", geo)
                .await
                .unwrap()
                .lage_id;
            lage_ids.push(lid);
        }
        let lage: Vec<_> = lade_marker(&pool, eid)
            .await
            .unwrap()
            .into_iter()
            .filter(|m| m.typ == "lagemeldung")
            .map(|m| (m.id, m.label))
            .collect();
        // Etikett mit der Nummer der MELDUNG, die id bleibt die der Lagemeldung.
        assert_eq!(lage, [(lage_ids[1], "Lagemeldung #7".to_string())]);
    }

    #[tokio::test]
    async fn fremder_einsatz_liefert_nichts() {
        let pool = crate::db::test_pool().await;
        let (_bid, eid) = fixture(&pool).await;
        let marker = lade_marker(&pool, eid + 999).await.unwrap();
        assert!(marker.is_empty());
    }
}
