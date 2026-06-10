use super::{ChatKanalAnzeige, ChatNachrichtAnzeige, DEFAULT_KANAL_NAME};
use crate::error::AppError;
use sqlx::{QueryBuilder, Sqlite, SqliteConnection, SqlitePool};

/// Lädt alle Kanäle eines Einsatzes und stellt sicher, dass mindestens der
/// Default-Kanal existiert (lazy-Anlage mit `default_ersteller_id` als Ersteller).
/// Das deckt Bestands-Einsätze ohne Backfill ab. Das `INSERT … WHERE NOT EXISTS`
/// verhindert ein Duplikat, falls bereits ein Kanal existiert.
pub async fn liste_kanaele(
    pool: &SqlitePool,
    einsatz_id: i64,
    default_ersteller_id: i64,
) -> Result<Vec<ChatKanalAnzeige>, AppError> {
    sqlx::query(
        "INSERT INTO chat_kanal (einsatz_id, name, erstellt_von_id) \
         SELECT ?, ?, ? \
         WHERE NOT EXISTS (SELECT 1 FROM chat_kanal WHERE einsatz_id = ?)",
    )
    .bind(einsatz_id)
    .bind(DEFAULT_KANAL_NAME)
    .bind(default_ersteller_id)
    .bind(einsatz_id)
    .execute(pool)
    .await?;

    sqlx::query_as::<_, ChatKanalAnzeige>(
        "SELECT id, einsatz_id, name, beschreibung, erstellt_von_id, erstellt_at, archiviert_at \
         FROM chat_kanal WHERE einsatz_id = ? ORDER BY erstellt_at, id",
    )
    .bind(einsatz_id)
    .fetch_all(pool)
    .await
    .map_err(Into::into)
}

/// Legt einen neuen Kanal an und liefert ihn als Anzeige.
pub async fn kanal_anlegen(
    pool: &SqlitePool,
    einsatz_id: i64,
    ersteller_id: i64,
    name: &str,
    beschreibung: Option<&str>,
) -> Result<ChatKanalAnzeige, AppError> {
    let id: i64 = sqlx::query_scalar(
        "INSERT INTO chat_kanal (einsatz_id, name, beschreibung, erstellt_von_id) \
         VALUES (?, ?, ?, ?) RETURNING id",
    )
    .bind(einsatz_id)
    .bind(name)
    .bind(beschreibung)
    .bind(ersteller_id)
    .fetch_one(pool)
    .await?;

    sqlx::query_as::<_, ChatKanalAnzeige>(
        "SELECT id, einsatz_id, name, beschreibung, erstellt_von_id, erstellt_at, archiviert_at \
         FROM chat_kanal WHERE id = ?",
    )
    .bind(id)
    .fetch_one(pool)
    .await
    .map_err(Into::into)
}

/// Prüft, ob ein Kanal zum angegebenen Einsatz gehört (Schutz gegen Cross-Einsatz-Zugriff).
pub async fn gehoert_kanal_zu_einsatz(
    pool: &SqlitePool,
    kanal_id: i64,
    einsatz_id: i64,
) -> Result<bool, AppError> {
    let treffer: Option<i64> =
        sqlx::query_scalar("SELECT 1 FROM chat_kanal WHERE id = ? AND einsatz_id = ?")
            .bind(kanal_id)
            .bind(einsatz_id)
            .fetch_optional(pool)
            .await?;
    Ok(treffer.is_some())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Legt Org (id=1), einen Benutzer und einen Einsatz an; liefert (benutzer_id, einsatz_id).
    async fn setup(pool: &SqlitePool) -> (i64, i64) {
        sqlx::query("INSERT OR IGNORE INTO organisation (id, name) VALUES (1, 'Orga')")
            .execute(pool).await.unwrap();
        let benutzer_id: i64 = sqlx::query_scalar(
            "INSERT INTO benutzer (org_id, anzeigename, benutzername, passwort_hash) \
             VALUES (1, 'Leitung', 'leit', 'h') RETURNING id",
        ).fetch_one(pool).await.unwrap();
        let einsatz_id: i64 = sqlx::query_scalar(
            "INSERT INTO einsatz (org_id, bezeichnung) VALUES (1, 'Lage') RETURNING id",
        ).fetch_one(pool).await.unwrap();
        (benutzer_id, einsatz_id)
    }

    #[tokio::test]
    async fn liste_kanaele_legt_default_an() {
        let pool = crate::db::test_pool().await;
        let (benutzer, einsatz) = setup(&pool).await;

        let kanaele = liste_kanaele(&pool, einsatz, benutzer).await.unwrap();
        assert_eq!(kanaele.len(), 1);
        assert_eq!(kanaele[0].name, DEFAULT_KANAL_NAME);

        // Idempotent: ein zweiter Aufruf legt keinen weiteren Default an.
        let nochmal = liste_kanaele(&pool, einsatz, benutzer).await.unwrap();
        assert_eq!(nochmal.len(), 1);
    }

    #[tokio::test]
    async fn kanal_anlegen_erscheint_in_liste() {
        let pool = crate::db::test_pool().await;
        let (benutzer, einsatz) = setup(&pool).await;
        liste_kanaele(&pool, einsatz, benutzer).await.unwrap(); // Default sicherstellen

        let kanal = kanal_anlegen(&pool, einsatz, benutzer, "S2/S3", Some("Lagebild")).await.unwrap();
        assert_eq!(kanal.name, "S2/S3");
        assert_eq!(kanal.beschreibung.as_deref(), Some("Lagebild"));

        let kanaele = liste_kanaele(&pool, einsatz, benutzer).await.unwrap();
        assert_eq!(kanaele.len(), 2);
    }

    #[tokio::test]
    async fn gehoert_kanal_zu_einsatz_prueft_zugehoerigkeit() {
        let pool = crate::db::test_pool().await;
        let (benutzer, einsatz) = setup(&pool).await;
        let kanal = kanal_anlegen(&pool, einsatz, benutzer, "K", None).await.unwrap();

        assert!(gehoert_kanal_zu_einsatz(&pool, kanal.id, einsatz).await.unwrap());
        assert!(!gehoert_kanal_zu_einsatz(&pool, kanal.id, 999).await.unwrap());
        assert!(!gehoert_kanal_zu_einsatz(&pool, 12345, einsatz).await.unwrap());
    }
}
