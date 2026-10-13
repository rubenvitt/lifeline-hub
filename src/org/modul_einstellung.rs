//! Org-weite Modul-Vorgaben — je (org, modul_key) eine Zeile in `org_modul_einstellung`: die
//! Rollen-Vorgabe und (LLH-1179) die Sichtbarkeits-Vorgabe. Keys und Rollen validiert die Route.
//! `benoetigte_rolle=None` setzt NULL, die Zeile bleibt. Strikt per `org_id` (Org-Isolation).

use crate::error::AppError;
use serde::Serialize;
use sqlx::SqlitePool;
use std::collections::HashMap;
use utoipa::ToSchema;

/// Die Vorgabe der Organisation für ein Modul, wie gespeichert.
///
/// `sichtbar`: `None` = sichtbar (keine Vorgabe), `Some(false)` = für alle Einsätze ohne eigenen
/// Wert ausgeblendet. Geschrieben wird nie `Some(true)` (design.md D1 der Change
/// `archive/2026-10-13-ivtkmf43-org-modul-sichtbarkeit`); gelesen wird es trotzdem richtig.
#[derive(Debug, Clone, Default, PartialEq, Eq, sqlx::FromRow)]
pub struct OrgModulVorgabe {
    pub benoetigte_rolle: Option<String>,
    pub sichtbar: Option<bool>,
}

/// Eine Vorgabe, wie `GET /api/org-modul-einstellungen` sie je Modul liefert (LLH-1179).
/// `sichtbar` ist aufgelöst: `false` nur, wenn die Organisation das Modul ausblendet.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, ToSchema)]
pub struct OrgModulEinstellung {
    /// 'admin' | 'fuehrungskraft' | 'einsatzfuehrung' | null (= frei).
    pub benoetigte_rolle: Option<String>,
    pub sichtbar: bool,
}

impl From<OrgModulVorgabe> for OrgModulEinstellung {
    fn from(v: OrgModulVorgabe) -> Self {
        Self {
            benoetigte_rolle: v.benoetigte_rolle,
            sichtbar: v.sichtbar.unwrap_or(true),
        }
    }
}

/// Lädt alle Vorgaben einer Org als Map `modul_key → Vorgabe`.
/// Existiert keine Zeile, ist die Map leer (= alle Module sichtbar und frei zugänglich).
/// Strikt per `org_id` (Org-Isolation).
pub async fn laden_alle(
    pool: &SqlitePool,
    org_id: i64,
) -> Result<HashMap<String, OrgModulVorgabe>, AppError> {
    let zeilen = sqlx::query_as::<_, (String, Option<String>, Option<bool>)>(
        "SELECT modul_key, benoetigte_rolle, sichtbar \
         FROM org_modul_einstellung WHERE org_id = ?",
    )
    .bind(org_id)
    .fetch_all(pool)
    .await?;
    Ok(zeilen
        .into_iter()
        .map(|(key, benoetigte_rolle, sichtbar)| {
            (
                key,
                OrgModulVorgabe {
                    benoetigte_rolle,
                    sichtbar,
                },
            )
        })
        .collect())
}

/// UPSERT einer Vorgabe auf (org_id, modul_key). `benoetigte_rolle = None` setzt NULL (frei), die
/// Zeile bleibt.
///
/// `sichtbar`: `None` lässt die gespeicherte Sichtbarkeit unverändert (ein Aufrufer, der nur die
/// Rolle setzt, hebt keine Ausblendung auf); `Some(false)` blendet aus (`0`); `Some(true)` nimmt
/// die Ausblendung zurück (`NULL`, denn „sichtbar“ ist dasselbe wie keine Vorgabe). Key, Rolle und
/// Ausblendbarkeit prüft die Route.
pub async fn setzen(
    pool: &SqlitePool,
    org_id: i64,
    modul_key: &str,
    benoetigte_rolle: Option<&str>,
    sichtbar: Option<bool>,
    erfasser_id: i64,
) -> Result<(), AppError> {
    let gespeichert: Option<i64> = (sichtbar == Some(false)).then_some(0);
    sqlx::query(
        "INSERT INTO org_modul_einstellung \
            (org_id, modul_key, benoetigte_rolle, sichtbar, geaendert_at, geaendert_von) \
         VALUES (?1, ?2, ?3, ?4, datetime('now'), ?6) \
         ON CONFLICT(org_id, modul_key) DO UPDATE SET \
             benoetigte_rolle = excluded.benoetigte_rolle, \
             sichtbar = CASE WHEN ?5 THEN excluded.sichtbar \
                             ELSE org_modul_einstellung.sichtbar END, \
             geaendert_at = excluded.geaendert_at, \
             geaendert_von = excluded.geaendert_von",
    )
    .bind(org_id)
    .bind(modul_key)
    .bind(benoetigte_rolle)
    .bind(gespeichert)
    .bind(sichtbar.is_some())
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

        setzen(&pool, 1, "etb", Some("fuehrungskraft"), None, bid)
            .await
            .unwrap();

        let map = laden_alle(&pool, 1).await.unwrap();
        assert_eq!(
            map.get("etb").and_then(|v| v.benoetigte_rolle.as_deref()),
            Some("fuehrungskraft")
        );
        assert_eq!(
            map["etb"].sichtbar, None,
            "ohne Angabe bleibt das Modul sichtbar"
        );
    }

    #[tokio::test]
    async fn setzen_none_setzt_null_zeile_bleibt() {
        let pool = crate::db::test_pool().await;
        let bid = fixture(&pool).await;

        setzen(&pool, 1, "etb", Some("fuehrungskraft"), None, bid)
            .await
            .unwrap();
        setzen(&pool, 1, "etb", None, None, bid).await.unwrap();

        let map = laden_alle(&pool, 1).await.unwrap();
        // Zeile bleibt, Rolle ist None (NULL).
        assert!(map.contains_key("etb"));
        assert_eq!(map["etb"].benoetigte_rolle, None);

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

        setzen(&pool, 1, "etb", Some("admin"), None, bid)
            .await
            .unwrap();

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
        setzen(&pool, 1, "chat", Some("admin"), None, bid)
            .await
            .unwrap();

        // Org 2 hat keine Einträge.
        assert!(laden_alle(&pool, 2).await.unwrap().is_empty());
        // Org 1 hat genau einen Eintrag.
        assert_eq!(laden_alle(&pool, 1).await.unwrap().len(), 1);
    }

    /// LLH-1179: Ausblenden schreibt `0`, Einblenden `NULL` (nie `1`), und ein Aufruf ohne
    /// Sichtbarkeit lässt eine Ausblendung beim Rollenwechsel stehen.
    #[tokio::test]
    async fn sichtbarkeit_ausblenden_einblenden_und_unveraendert() {
        let pool = crate::db::test_pool().await;
        let bid = fixture(&pool).await;
        async fn roh(pool: &SqlitePool) -> Option<i64> {
            sqlx::query_scalar(
                "SELECT sichtbar FROM org_modul_einstellung WHERE org_id = 1 AND modul_key = 'stab'",
            )
            .fetch_one(pool)
            .await
            .unwrap()
        }

        setzen(&pool, 1, "stab", None, Some(false), bid)
            .await
            .unwrap();
        assert_eq!(roh(&pool).await, Some(0));
        assert_eq!(
            laden_alle(&pool, 1).await.unwrap()["stab"].sichtbar,
            Some(false)
        );

        // Nur die Rolle: die Ausblendung bleibt.
        setzen(&pool, 1, "stab", Some("admin"), None, bid)
            .await
            .unwrap();
        let v = &laden_alle(&pool, 1).await.unwrap()["stab"];
        assert_eq!(v.sichtbar, Some(false));
        assert_eq!(v.benoetigte_rolle.as_deref(), Some("admin"));

        // Wieder einblenden: NULL, nicht 1.
        setzen(&pool, 1, "stab", Some("admin"), Some(true), bid)
            .await
            .unwrap();
        assert_eq!(roh(&pool).await, None);
        assert_eq!(laden_alle(&pool, 1).await.unwrap()["stab"].sichtbar, None);
    }

    /// Eine neue Zeile mit `Some(true)` schreibt ebenfalls `NULL`.
    #[tokio::test]
    async fn neue_zeile_sichtbar_ist_null() {
        let pool = crate::db::test_pool().await;
        let bid = fixture(&pool).await;
        setzen(&pool, 1, "chat", None, Some(true), bid)
            .await
            .unwrap();
        let roh: Option<i64> = sqlx::query_scalar(
            "SELECT sichtbar FROM org_modul_einstellung WHERE org_id = 1 AND modul_key = 'chat'",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(roh, None);
    }
}
