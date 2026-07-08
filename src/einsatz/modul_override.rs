//! Einsatz-Modul-Override (LFH-132) — je (Einsatz, Modul) eine Zeile.
//!
//! Leaf-Tabelle `einsatz_modul_override`; Validierung der Keys/Rollen in Rust
//! (`super::modul`). Die Overrides werden strikt über die `einsatz_id` geladen —
//! NIE über die Benutzer-Org abgeleitet (Org-Isolation, vgl. Memory
//! cross-org-lesezugriff-luecke).

use crate::error::AppError;
use serde::Serialize;
use sqlx::SqlitePool;
use std::collections::HashMap;
use utoipa::ToSchema;

/// Override-Zeile wie in der DB abgelegt. `sichtbar` aus INTEGER (0/1) dekodiert;
/// `benoetigte_rolle` ist `None` (= frei) oder ein gültiger Rollen-String.
#[derive(Debug, Clone, Serialize, sqlx::FromRow, ToSchema)]
pub struct EinsatzModulOverride {
    pub einsatz_id: i64,
    pub modul_key: String,
    pub sichtbar: bool,
    pub benoetigte_rolle: Option<String>,
    pub geaendert_at: Option<String>,
    pub geaendert_von: Option<i64>,
}

/// Lädt alle Overrides eines Einsatzes als Map `modul_key → Override`. Existiert
/// keine Zeile, ist die Map leer (= alle Module sichtbar, keine Rollen-Schranke).
/// Strikt per `einsatz_id` (Org-Isolation).
pub async fn laden_alle(
    pool: &SqlitePool,
    einsatz_id: i64,
) -> Result<HashMap<String, EinsatzModulOverride>, AppError> {
    let zeilen = sqlx::query_as::<_, EinsatzModulOverride>(
        "SELECT einsatz_id, modul_key, sichtbar, benoetigte_rolle, geaendert_at, geaendert_von \
         FROM einsatz_modul_override WHERE einsatz_id = ?",
    )
    .bind(einsatz_id)
    .fetch_all(pool)
    .await?;
    Ok(zeilen
        .into_iter()
        .map(|o| (o.modul_key.clone(), o))
        .collect())
}

/// UPSERT eines Overrides auf (einsatz_id, modul_key); setzt die Audit-Felder.
/// Key-/Rollen-Gültigkeit prüft der Aufrufer (Handler) vor dem Aufruf.
pub async fn setzen(
    pool: &SqlitePool,
    einsatz_id: i64,
    modul_key: &str,
    sichtbar: bool,
    benoetigte_rolle: Option<&str>,
    erfasser_id: i64,
) -> Result<EinsatzModulOverride, AppError> {
    sqlx::query(
        "INSERT INTO einsatz_modul_override \
            (einsatz_id, modul_key, sichtbar, benoetigte_rolle, geaendert_at, geaendert_von) \
         VALUES (?, ?, ?, ?, datetime('now'), ?) \
         ON CONFLICT(einsatz_id, modul_key) DO UPDATE SET \
             sichtbar = excluded.sichtbar, \
             benoetigte_rolle = excluded.benoetigte_rolle, \
             geaendert_at = excluded.geaendert_at, \
             geaendert_von = excluded.geaendert_von",
    )
    .bind(einsatz_id)
    .bind(modul_key)
    .bind(sichtbar)
    .bind(benoetigte_rolle)
    .bind(erfasser_id)
    .execute(pool)
    .await?;

    let zeile = sqlx::query_as::<_, EinsatzModulOverride>(
        "SELECT einsatz_id, modul_key, sichtbar, benoetigte_rolle, geaendert_at, geaendert_von \
         FROM einsatz_modul_override WHERE einsatz_id = ? AND modul_key = ?",
    )
    .bind(einsatz_id)
    .bind(modul_key)
    .fetch_one(pool)
    .await?;
    Ok(zeile)
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::SqlitePool;

    /// Legt Org(1) + Benutzer + Einsatz an; liefert (einsatz_id, benutzer_id).
    async fn fixture(pool: &SqlitePool) -> (i64, i64) {
        sqlx::query("INSERT OR IGNORE INTO organisation (id, name) VALUES (1, 'Orga')")
            .execute(pool)
            .await
            .unwrap();
        let bid = sqlx::query_scalar::<_, i64>(
            "INSERT INTO benutzer (org_id, anzeigename, benutzername, passwort_hash) \
             VALUES (1, 'leit', 'leit', 'h') RETURNING id",
        )
        .fetch_one(pool)
        .await
        .unwrap();
        let eid = sqlx::query_scalar::<_, i64>(
            "INSERT INTO einsatz (org_id, bezeichnung) VALUES (1, 'Lage') RETURNING id",
        )
        .fetch_one(pool)
        .await
        .unwrap();
        (eid, bid)
    }

    #[tokio::test]
    async fn laden_alle_ohne_zeilen_ist_leer() {
        let pool = crate::db::test_pool().await;
        let (eid, _bid) = fixture(&pool).await;
        let map = laden_alle(&pool, eid).await.unwrap();
        assert!(map.is_empty());
    }

    #[tokio::test]
    async fn setzen_upsert_und_laden_alle_map() {
        let pool = crate::db::test_pool().await;
        let (eid, bid) = fixture(&pool).await;

        let o = setzen(&pool, eid, "chat", false, None, bid).await.unwrap();
        assert_eq!(o.modul_key, "chat");
        assert!(!o.sichtbar);
        assert_eq!(o.benoetigte_rolle, None);
        assert!(o.geaendert_at.is_some());
        assert_eq!(o.geaendert_von, Some(bid));

        // Zweites Modul mit Rollen-Schranke.
        setzen(&pool, eid, "etb", true, Some("fuehrungskraft"), bid)
            .await
            .unwrap();

        let map = laden_alle(&pool, eid).await.unwrap();
        assert_eq!(map.len(), 2);
        assert!(!map["chat"].sichtbar);
        assert_eq!(map["etb"].benoetigte_rolle.as_deref(), Some("fuehrungskraft"));

        // Upsert: gleiches (einsatz, modul) überschreibt dieselbe Zeile.
        setzen(&pool, eid, "chat", true, Some("admin"), bid)
            .await
            .unwrap();
        let map2 = laden_alle(&pool, eid).await.unwrap();
        assert_eq!(map2.len(), 2, "Upsert darf keine zweite Zeile anlegen");
        assert!(map2["chat"].sichtbar);
        assert_eq!(map2["chat"].benoetigte_rolle.as_deref(), Some("admin"));
    }

    #[tokio::test]
    async fn laden_alle_ist_pro_einsatz_isoliert() {
        let pool = crate::db::test_pool().await;
        let (eid_a, bid) = fixture(&pool).await;
        let eid_b = sqlx::query_scalar::<_, i64>(
            "INSERT INTO einsatz (org_id, bezeichnung) VALUES (1, 'Lage B') RETURNING id",
        )
        .fetch_one(&pool)
        .await
        .unwrap();

        setzen(&pool, eid_a, "chat", false, None, bid).await.unwrap();

        // Einsatz B hat keine Overrides — strikt pro einsatz_id geladen.
        assert!(laden_alle(&pool, eid_b).await.unwrap().is_empty());
        assert_eq!(laden_alle(&pool, eid_a).await.unwrap().len(), 1);
    }
}
