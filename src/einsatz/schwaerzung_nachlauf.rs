//! Nachlauf der Schwärzung: Datei-Inhalte einzeln löschen (LFH-905, LFH-997).
//!
//! Unter `secure_delete = ON` nullt jeder Commit die freigewordenen Seiten und hält so lange die
//! Schreibsperre. Tabellen mit großen BLOBs löscht der atomare Vorgang deshalb nicht selbst
//! (`Strategie::ZeileEinzelnLoeschen`): er macht ihre Zeilen nur unerreichbar, und
//! [`entferne_vorgesehene`] löscht sie danach je Zeile in einer eigenen Transaktion. Herleitung:
//! `openspec/changes/archive/2026-10-05-lfh-905-schwaerzung-schreibsperre-begrenzen/design.md`,
//! für die Bilder der Lagekarte `openspec/changes/archive/2026-10-05-lfh-997-kartenhintergrund-klassifizieren/design.md`.

use crate::error::AppError;
use sqlx::SqlitePool;

/// Die Tabellen, deren Zeilen der Nachlauf einzeln löscht. Die eine Quelle für den Nachlauf, den
/// Guard der Registry (`ZeileEinzelnLoeschen` nur hier) und das Warten der Skelett-Löschung.
/// Jede trägt `id` und `einsatz_id`.
pub const EINZELN_GELOESCHT: &[&str] = &["anhang", "karte_hintergrundbild"];

/// SQL-Bedingung „die Zeile `{alias}` ist zur Entfernung vorgesehen“: ihr abgeschlossener
/// Einsatz ist geschwärzt, oder dessen Kategorie `anhaenge` ist es. Die atomare Schwärzung lässt
/// solche Zeilen stehen; [`entferne_vorgesehene`] löscht sie danach einzeln, und bis dahin
/// übergehen die Lese-Funktionen der Tabellen sie. Genau ist die Bedingung, weil Uploads einen
/// aktiven Einsatz verlangen und ein abgeschlossener nicht wieder aktiv wird.
///
/// `alias` muss eine Tabelle oder ein Alias mit Spalte `einsatz_id` sein. Der Text entsteht aus
/// Compile-Zeit-Konstanten und dem Alias-Literal des Aufrufers.
pub(crate) fn zur_entfernung_vorgesehen_sql(alias: &str) -> String {
    format!(
        "EXISTS (SELECT 1 FROM einsatz e WHERE e.id = {alias}.einsatz_id AND e.status = '{}' \
           AND (e.geschwaerzt_at IS NOT NULL \
                OR EXISTS (SELECT 1 FROM einsatz_aufbewahrung_kategorie k \
                           WHERE k.einsatz_id = e.id AND k.kategorie = '{}' \
                             AND k.geschwaerzt_at IS NOT NULL)))",
        super::STATUS_ABGESCHLOSSEN,
        super::retention::Datenkategorie::Anhaenge.as_str()
    )
}

/// Löscht jede zur Entfernung vorgesehene Zeile ([`zur_entfernung_vorgesehen_sql`]) aller
/// Tabellen aus [`EINZELN_GELOESCHT`] in einer eigenen Transaktion, mit `einsatz` nur die dieses
/// Einsatzes. Liefert die Zahl gelöschter Zeilen.
///
/// Je Zeile eine Transaktion deckelt die Schreibsperre auf einen Datei-Inhalt (Upload-Grenze
/// 26 MB); dazwischen kommen andere Schreibende zum Zug, und der automatische Checkpoint schreibt
/// den WAL fortlaufend zurück. Der Wächter im `DELETE` wiederholt die Bedingung, damit nur eine
/// vorgesehene Zeile fällt.
pub async fn entferne_vorgesehene(
    pool: &SqlitePool,
    einsatz: Option<i64>,
) -> Result<u64, AppError> {
    let mut geloescht = 0;
    for tabelle in EINZELN_GELOESCHT {
        let vorgesehen = zur_entfernung_vorgesehen_sql(tabelle);
        let ids: Vec<i64> = sqlx::query_scalar(sqlx::AssertSqlSafe(format!(
            "SELECT id FROM {tabelle} WHERE {vorgesehen} AND (?1 IS NULL OR einsatz_id = ?1) \
             ORDER BY id"
        )))
        .bind(einsatz)
        .fetch_all(pool)
        .await?;
        let sql = format!("DELETE FROM {tabelle} WHERE id = ? AND {vorgesehen}");
        for id in ids {
            geloescht += crate::write_retry!(pool, |conn| {
                Ok(sqlx::query(sqlx::AssertSqlSafe(sql.clone()))
                    .bind(id)
                    .execute(&mut *conn)
                    .await?
                    .rows_affected())
            })?;
        }
    }
    Ok(geloescht)
}

/// Nachlauf einer Schwärzung für einen Einsatz: löscht seine zur Entfernung vorgesehenen
/// Datei-Inhalte einzeln. Ein Fehler wird nur geloggt, der Purge-Lauf holt nach.
pub(crate) async fn nachlaufen(pool: &SqlitePool, einsatz_id: i64) {
    if let Err(e) = entferne_vorgesehene(pool, Some(einsatz_id)).await {
        tracing::warn!(
            einsatz_id,
            "Nachlauf der Schwärzung: Datei-Inhalte nicht vollständig entfernt, der Purge-Lauf \
             holt nach: {e}"
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Eine Organisation, ein Benutzer und ein Einsatz im Status `status`; liefert die
    /// Einsatz-ID und den Benutzer.
    async fn einsatz(pool: &SqlitePool, status: &str) -> (i64, i64) {
        sqlx::query("INSERT OR IGNORE INTO organisation (id, name) VALUES (1, 'Orga')")
            .execute(pool)
            .await
            .unwrap();
        let b: i64 = sqlx::query_scalar(
            "INSERT INTO benutzer (org_id, anzeigename, benutzername, passwort_hash) \
             VALUES (1, 'B', 'b-' || abs(random()), 'h') RETURNING id",
        )
        .fetch_one(pool)
        .await
        .unwrap();
        let e: i64 = sqlx::query_scalar(
            "INSERT INTO einsatz (org_id, bezeichnung, status) VALUES (1, 'Lage', ?) RETURNING id",
        )
        .bind(status)
        .fetch_one(pool)
        .await
        .unwrap();
        (e, b)
    }

    async fn bild(pool: &SqlitePool, e: i64, b: i64) -> i64 {
        crate::karte_hintergrundbild::repo::anlegen(
            pool,
            e,
            b,
            "Luftbild.png",
            "image/png",
            b"\x89PNG\r\n\x1a\nLUFTBILD",
            "[[0,0],[1,0],[1,1],[0,1]]",
            None,
        )
        .await
        .unwrap()
        .id
    }

    async fn bilder(pool: &SqlitePool, e: i64) -> i64 {
        sqlx::query_scalar("SELECT COUNT(*) FROM karte_hintergrundbild WHERE einsatz_id = ?")
            .bind(e)
            .fetch_one(pool)
            .await
            .unwrap()
    }

    #[tokio::test]
    async fn nachlauf_loescht_bilder_geschwaerzter_einsaetze_und_laesst_andere_stehen() {
        let pool = crate::db::test_pool().await;
        let (geschwaerzt, b1) = einsatz(&pool, "aktiv").await;
        let (aktiv, b2) = einsatz(&pool, "aktiv").await;
        bild(&pool, geschwaerzt, b1).await;
        bild(&pool, geschwaerzt, b1).await;
        bild(&pool, aktiv, b2).await;
        sqlx::query(
            "UPDATE einsatz SET status = ?, geschwaerzt_at = '2026-03-01 00:00:00' WHERE id = ?",
        )
        .bind(crate::einsatz::STATUS_ABGESCHLOSSEN)
        .bind(geschwaerzt)
        .execute(&pool)
        .await
        .unwrap();

        assert_eq!(entferne_vorgesehene(&pool, None).await.unwrap(), 2);
        assert_eq!(bilder(&pool, geschwaerzt).await, 0);
        assert_eq!(
            bilder(&pool, aktiv).await,
            1,
            "Bild eines aktiven Einsatzes bleibt"
        );
        assert_eq!(
            entferne_vorgesehene(&pool, None).await.unwrap(),
            0,
            "idempotent"
        );
    }

    #[tokio::test]
    async fn nachlauf_mit_einsatz_trifft_nur_diesen() {
        let pool = crate::db::test_pool().await;
        let (a, b1) = einsatz(&pool, crate::einsatz::STATUS_ABGESCHLOSSEN).await;
        let (c, b2) = einsatz(&pool, crate::einsatz::STATUS_ABGESCHLOSSEN).await;
        // Hochladen verlangt keinen aktiven Einsatz auf Repo-Ebene; der Status zählt nur für die
        // Bedingung.
        bild(&pool, a, b1).await;
        bild(&pool, c, b2).await;
        sqlx::query("UPDATE einsatz SET geschwaerzt_at = '2026-03-01 00:00:00'")
            .execute(&pool)
            .await
            .unwrap();

        assert_eq!(entferne_vorgesehene(&pool, Some(a)).await.unwrap(), 1);
        assert_eq!(bilder(&pool, a).await, 0);
        assert_eq!(
            bilder(&pool, c).await,
            1,
            "der andere Einsatz wartet auf seinen Lauf"
        );
    }
}
