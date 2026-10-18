use crate::error::AppError;
use serde::Serialize;
use sqlx::{SqliteConnection, SqlitePool};
use utoipa::ToSchema;

/// Eine medizinische Verlaufsnotiz (1:1 zu `person_verlaufsnotiz`).
#[derive(Debug, Clone, Serialize, sqlx::FromRow, ToSchema)]
pub struct NotizAnzeige {
    pub id: i64,
    pub einsatz_id: i64,
    pub person_id: i64,
    pub text: String,
    /// Erfassungszeit; ohne Netz vorgemerkt die Zeit am Gerät (LLH-1138), gekappt.
    pub erfasst_at: String,
    pub erfasst_von: i64,
    /// Wann der Eintrag beim Server ankam (LLH-1138). Fehlt bei Einträgen von vor der
    /// Migration 0217.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub eingegangen_at: Option<String>,
}

const SELECT_NOTIZ: &str = "\
    SELECT id, einsatz_id, person_id, text, erfasst_at, erfasst_von, eingegangen_at \
    FROM person_verlaufsnotiz";

/// Eine neue Notiz; `text` bereits getrimmt (Handler).
#[derive(Debug, Default)]
pub struct NeueNotiz<'a> {
    pub text: &'a str,
    /// Erfassungszeit, bereits über `support::erfassungszeitpunkt` gekappt; `None` = jetzt.
    pub erfasst_at: Option<&'a str>,
    /// Idempotenzschlüssel der Offline-Queue (LLH-1138).
    pub client_id: Option<&'a str>,
}

/// Legt eine append-only Befundnotiz an. Kommt dieselbe `client_id` im Einsatz ein zweites Mal,
/// liefert sie die gespeicherte Notiz (unter `BEGIN IMMEDIATE` auch bei zwei gleichzeitigen
/// Übertragungen genau eine Zeile).
pub async fn anlegen(
    pool: &SqlitePool,
    einsatz_id: i64,
    person_id: i64,
    neu: &NeueNotiz<'_>,
    erfasst_von: i64,
) -> Result<NotizAnzeige, AppError> {
    crate::write_retry!(pool, |conn| {
        if let Some(cid) = neu.client_id {
            if let Some(replay) = nach_client_id(&mut *conn, einsatz_id, cid).await? {
                return Ok(replay);
            }
        }
        anlegen_tx(conn, einsatz_id, person_id, neu, erfasst_von).await
    })
}

/// [`anlegen`] ohne Replay-Prüfung in einer laufenden Transaktion.
pub async fn anlegen_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    person_id: i64,
    neu: &NeueNotiz<'_>,
    erfasst_von: i64,
) -> Result<NotizAnzeige, AppError> {
    let id: i64 = sqlx::query_scalar(
        "INSERT INTO person_verlaufsnotiz \
            (einsatz_id, person_id, text, erfasst_von, erfasst_at, eingegangen_at, client_id) \
         VALUES (?, ?, ?, ?, COALESCE(?, strftime('%Y-%m-%d %H:%M:%S','now')), \
                 strftime('%Y-%m-%d %H:%M:%S','now'), ?) RETURNING id",
    )
    .bind(einsatz_id)
    .bind(person_id)
    .bind(neu.text)
    .bind(erfasst_von)
    .bind(neu.erfasst_at)
    .bind(neu.client_id)
    .fetch_one(&mut *conn)
    .await?;
    sqlx::query_as::<_, NotizAnzeige>(sqlx::AssertSqlSafe(format!("{SELECT_NOTIZ} WHERE id = ?")))
        .bind(id)
        .fetch_one(&mut *conn)
        .await
        .map_err(Into::into)
}

/// Die schon gespeicherte Notiz zu einer `client_id` im Einsatz (Replay der Offline-Queue).
pub async fn nach_client_id(
    executor: impl sqlx::Executor<'_, Database = sqlx::Sqlite>,
    einsatz_id: i64,
    client_id: &str,
) -> Result<Option<NotizAnzeige>, AppError> {
    Ok(
        sqlx::query_as::<_, NotizAnzeige>(sqlx::AssertSqlSafe(format!(
            "{SELECT_NOTIZ} WHERE einsatz_id = ? AND client_id = ?"
        )))
        .bind(einsatz_id)
        .bind(client_id)
        .fetch_optional(executor)
        .await?,
    )
}

/// Notizen einer Person (neueste zuerst).
pub async fn liste_je_person(
    pool: &SqlitePool,
    einsatz_id: i64,
    person_id: i64,
) -> Result<Vec<NotizAnzeige>, AppError> {
    Ok(
        sqlx::query_as::<_, NotizAnzeige>(sqlx::AssertSqlSafe(format!(
            "{SELECT_NOTIZ} WHERE einsatz_id = ? AND person_id = ? \
         ORDER BY erfasst_at DESC, id DESC"
        )))
        .bind(einsatz_id)
        .bind(person_id)
        .fetch_all(pool)
        .await?,
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::test_pool;
    use sqlx::SqlitePool;

    async fn setup(pool: &SqlitePool) -> (i64, i64, i64) {
        sqlx::query("INSERT INTO organisation (id, name) VALUES (1, 'Test-Orga')")
            .execute(pool)
            .await
            .unwrap();
        let b: i64 = sqlx::query_scalar(
            "INSERT INTO benutzer (org_id, anzeigename, benutzername, passwort_hash, system_rolle, org_rolle, aktiv) \
             VALUES (1, 'A', 'a', 'h', 'keiner', 'keine', 1) RETURNING id")
            .fetch_one(pool).await.unwrap();
        let e: i64 = sqlx::query_scalar(
            "INSERT INTO einsatz (org_id, bezeichnung, status, begonnen_at, einsatzart, angelegt_at) \
             VALUES (1, 'Lage', 'aktiv', '2026-05-27', 'realeinsatz', '2026-05-27') RETURNING id")
            .fetch_one(pool).await.unwrap();
        let p: i64 = sqlx::query_scalar(
            "INSERT INTO einsatz_person (einsatz_id, registrier_nr, erfasst_von, geaendert_von) \
             VALUES (?, 1, ?, ?) RETURNING id",
        )
        .bind(e)
        .bind(b)
        .bind(b)
        .fetch_one(pool)
        .await
        .unwrap();
        (b, e, p)
    }

    #[tokio::test]
    async fn anlegen_ist_append_only_und_liste_neueste_zuerst() {
        let pool = test_pool().await;
        let (b, e, p) = setup(&pool).await;
        let notiz = |text| NeueNotiz {
            text,
            ..NeueNotiz::default()
        };
        anlegen(&pool, e, p, &notiz("Platzwunde Stirn"), b)
            .await
            .unwrap();
        anlegen(&pool, e, p, &notiz("stabil, ansprechbar"), b)
            .await
            .unwrap();
        let notizen = liste_je_person(&pool, e, p).await.unwrap();
        assert_eq!(notizen.len(), 2);
        assert_eq!(notizen[0].text, "stabil, ansprechbar", "neueste zuerst");
    }
}
