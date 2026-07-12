//! Org-weite Modul-Rollen-Defaults (admin-einstellungen) — je (org, modul_key) eine Zeile.
//!
//! Leaf-Tabelle `org_modul_einstellung`; Validierung der Keys/Rollen in der Route
//! (Task 5). Das Repo nimmt gültige Werte an. `benoetigte_rolle=None` → NULL setzen,
//! Zeile bleibt (Konsistenz, kein Delete). Strikt per `org_id` (Org-Isolation, vgl.
//! Memory cross-org-lesezugriff-luecke).

use crate::error::AppError;
use sqlx::SqlitePool;
use std::collections::HashMap;

/// Lädt alle Rollen-Defaults einer Org als Map `modul_key → benoetigte_rolle`.
/// Existiert keine Zeile, ist die Map leer (= alle Module frei zugänglich).
/// Strikt per `org_id` (Org-Isolation).
pub async fn laden_alle(
    pool: &SqlitePool,
    org_id: i64,
) -> Result<HashMap<String, Option<String>>, AppError> {
    let zeilen = sqlx::query_as::<_, (String, Option<String>)>(
        "SELECT modul_key, benoetigte_rolle \
         FROM org_modul_einstellung WHERE org_id = ?",
    )
    .bind(org_id)
    .fetch_all(pool)
    .await?;
    Ok(zeilen.into_iter().collect())
}

/// UPSERT eines Rollen-Defaults auf (org_id, modul_key).
/// `benoetigte_rolle=None` → NULL setzen (Zeile bleibt).
/// Key-/Rollen-Gültigkeit prüft der Aufrufer (Route/Task 5) vor dem Aufruf.
pub async fn setzen(
    pool: &SqlitePool,
    org_id: i64,
    modul_key: &str,
    benoetigte_rolle: Option<&str>,
    erfasser_id: i64,
) -> Result<(), AppError> {
    sqlx::query(
        "INSERT INTO org_modul_einstellung \
            (org_id, modul_key, benoetigte_rolle, geaendert_at, geaendert_von) \
         VALUES (?, ?, ?, datetime('now'), ?) \
         ON CONFLICT(org_id, modul_key) DO UPDATE SET \
             benoetigte_rolle = excluded.benoetigte_rolle, \
             geaendert_at = excluded.geaendert_at, \
             geaendert_von = excluded.geaendert_von",
    )
    .bind(org_id)
    .bind(modul_key)
    .bind(benoetigte_rolle)
    .bind(erfasser_id)
    .execute(pool)
    .await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::SqlitePool;

    /// Legt Org(1) + Benutzer an; liefert benutzer_id.
    async fn fixture(pool: &SqlitePool) -> i64 {
        sqlx::query("INSERT OR IGNORE INTO organisation (id, name) VALUES (1, 'Orga')")
            .execute(pool)
            .await
            .unwrap();
        sqlx::query_scalar::<_, i64>(
            "INSERT INTO benutzer (org_id, anzeigename, benutzername, passwort_hash) \
             VALUES (1, 'admin', 'admin', 'h') RETURNING id",
        )
        .fetch_one(pool)
        .await
        .unwrap()
    }

    #[tokio::test]
    async fn laden_alle_leer_ist_leere_map() {
        let pool = crate::db::test_pool().await;
        let _bid = fixture(&pool).await;

        let map = laden_alle(&pool, 1).await.unwrap();
        assert!(map.is_empty());
    }

    #[tokio::test]
    async fn setzen_dann_laden_enthaelt_eintrag() {
        let pool = crate::db::test_pool().await;
        let bid = fixture(&pool).await;

        setzen(&pool, 1, "etb", Some("fuehrungskraft"), bid)
            .await
            .unwrap();

        let map = laden_alle(&pool, 1).await.unwrap();
        assert_eq!(
            map.get("etb").and_then(|r| r.as_deref()),
            Some("fuehrungskraft")
        );
    }

    #[tokio::test]
    async fn setzen_none_setzt_null_zeile_bleibt() {
        let pool = crate::db::test_pool().await;
        let bid = fixture(&pool).await;

        setzen(&pool, 1, "etb", Some("fuehrungskraft"), bid)
            .await
            .unwrap();
        setzen(&pool, 1, "etb", None, bid).await.unwrap();

        let map = laden_alle(&pool, 1).await.unwrap();
        // Zeile bleibt, Rolle ist None (NULL).
        assert!(map.contains_key("etb"));
        assert_eq!(map["etb"], None);

        let anzahl: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM org_modul_einstellung WHERE org_id = 1")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(anzahl, 1, "UPSERT darf keine zweite Zeile anlegen");
    }

    #[tokio::test]
    async fn setzen_schreibt_geaendert_von() {
        let pool = crate::db::test_pool().await;
        let bid = fixture(&pool).await;

        setzen(&pool, 1, "etb", Some("admin"), bid).await.unwrap();

        let geaendert_von: Option<i64> =
            sqlx::query_scalar("SELECT geaendert_von FROM org_modul_einstellung WHERE org_id = 1 AND modul_key = 'etb'")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(
            geaendert_von,
            Some(bid),
            "geaendert_von muss die erfasser_id enthalten"
        );
    }

    #[tokio::test]
    async fn org_isolation_fremde_org_beeinflusst_map_nicht() {
        let pool = crate::db::test_pool().await;
        let bid = fixture(&pool).await;

        // Zweite Org anlegen (FK enforced im Test-Pool).
        sqlx::query("INSERT OR IGNORE INTO organisation (id, name) VALUES (2, 'Andere')")
            .execute(&pool)
            .await
            .unwrap();

        // Eintrag für Org 1 anlegen.
        setzen(&pool, 1, "chat", Some("admin"), bid).await.unwrap();

        // Org 2 hat keine Einträge.
        assert!(laden_alle(&pool, 2).await.unwrap().is_empty());
        // Org 1 hat genau einen Eintrag.
        assert_eq!(laden_alle(&pool, 1).await.unwrap().len(), 1);
    }
}
