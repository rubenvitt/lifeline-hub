//! Hintergrundläufe lassen Spiegel aus (LLH-1492, Change `polrv1lt-spiegel-antraege`,
//! design.md D10).
//!
//! An einem Spiegel bricht jeder Schreibversuch am Schutz-Trigger ab (`einsatz_ist_spiegel`).
//! Ein Lauf, der ihn nicht ausließe, endete bei jedem Takt im Fehler, und eine Sammelanweisung,
//! die eine Zeile eines Spiegels trifft, scheiterte ganz und hielte damit auch die Arbeit an den
//! eigenen Einsätzen auf. Deshalb filtert jeder Lauf seine Kandidaten über `einsatz_spiegel`.

/// SQL-Bedingung „der Einsatz `spalte` ist kein Spiegel“, zum Anhängen an ein `WHERE`.
///
/// `spalte` ist ein Spaltenausdruck des Aufrufers (etwa `e.id` oder `benachrichtigung.einsatz_id`)
/// aus einem Literal, nie ein Nutzereingang. Eine Zeile ohne Einsatz (`NULL`) gilt als kein
/// Spiegel. Der Alias `sp` ist vergeben.
pub fn nicht_gespiegelt(spalte: &str) -> String {
    format!("NOT EXISTS (SELECT 1 FROM einsatz_spiegel sp WHERE sp.einsatz_id = {spalte})")
}

/// Markiert einen Einsatz in Tests als Spiegel, wie eine Übergabe es täte: unter dem Merker
/// `spiegel_uebernahme`, denn der Eintrag in `einsatz_spiegel` setzt die Spalte `einsatz.spiegel`
/// durch den Schutz-Trigger des Einsatzes hindurch. Die Daten des Einsatzes legt der Test vorher
/// an; danach ist jeder Schreibversuch an ihnen geschützt.
#[cfg(test)]
pub(crate) async fn als_spiegel_markieren(pool: &sqlx::SqlitePool, einsatz_id: i64) {
    let mut tx = pool.begin().await.unwrap();
    sqlx::query("INSERT INTO spiegel_uebernahme (id) VALUES (1)")
        .execute(&mut *tx)
        .await
        .unwrap();
    sqlx::query("INSERT INTO einsatz_spiegel (einsatz_id, fremde_kennung) VALUES (?1, 'x/' || ?1)")
        .bind(einsatz_id)
        .execute(&mut *tx)
        .await
        .unwrap();
    sqlx::query("DELETE FROM spiegel_uebernahme")
        .execute(&mut *tx)
        .await
        .unwrap();
    tx.commit().await.unwrap();
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn bedingung_laesst_nur_spiegel_aus() {
        let pool = crate::db::test_pool().await;
        sqlx::query("INSERT OR IGNORE INTO organisation (id, name) VALUES (1, 'Orga')")
            .execute(&pool)
            .await
            .unwrap();
        let mut ids = Vec::new();
        for bezeichnung in ["Eigen", "Spiegel"] {
            let id: i64 = sqlx::query_scalar(
                "INSERT INTO einsatz (org_id, bezeichnung) VALUES (1, ?) RETURNING id",
            )
            .bind(bezeichnung)
            .fetch_one(&pool)
            .await
            .unwrap();
            ids.push(id);
        }
        als_spiegel_markieren(&pool, ids[1]).await;
        let eigen: Vec<i64> = sqlx::query_scalar(sqlx::AssertSqlSafe(format!(
            "SELECT id FROM einsatz e WHERE {} ORDER BY id",
            nicht_gespiegelt("e.id")
        )))
        .fetch_all(&pool)
        .await
        .unwrap();
        assert_eq!(eigen, vec![ids[0]]);
    }
}
