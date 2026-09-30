//! Persistenter Cache (`fachebenen_cache`) mit TTL für Fachebenen-Antworten. Schlüssel:
//! `quelle` bzw. `quelle:<raster-bbox>`.
//!
//! Cache-Fehler sind nicht fatal: Lesen → Miss, Schreiben → geloggt UND gemeldet. Eine
//! erfolgreiche externe Abfrage scheitert nie am Cache; ein Aufrufer, dessen einziges Ergebnis
//! der Eintrag ist, erfährt aber, dass er nicht steht (s. `setze`).

use crate::karte::typen::{zeitpunkt_utc, FachebeneAntwort, FachebeneStatus};
use serde::de::DeserializeOwned;
use serde::Serialize;
use sqlx::SqlitePool;

/// Maximalalter für Prune-on-Write; über der längsten TTL, damit Stale-Serving erhalten bleibt.
/// KRITIS liegt in einer eigenen Tabelle (`karte::kritis::bestand`).
const MAX_ALTER_SEKUNDEN: i64 = 2 * 24 * 3600;

/// Vom Prune ausgenommen: der ODL-Grundpegel. Er wird nur bei brauchbarer BfS-Zeitreihe
/// geschrieben; nach zwei Tagen gestörter Zeitreihe wäre er sonst samt
/// Sperrklinken-Gedächtnis weg, obwohl er weiterverwendet werden soll. Ein Eintrag, ~100 KB.
const DAUERHAFT: &str = crate::karte::odl_grundpegel::CACHE_SCHLUESSEL;

/// Liest einen Umschlag. Fehlt `abgerufen` (Eintrag von vor LFH-591), gilt der Speicherzeitpunkt:
/// geschrieben wird unmittelbar nach dem Abruf. Ein vorhandener Wert bleibt.
fn deserialisiere(json: &str, gespeichert_at: i64) -> Option<FachebeneAntwort> {
    match serde_json::from_str::<FachebeneAntwort>(json) {
        Ok(mut a) => {
            if a.abgerufen.is_none() && a.status != FachebeneStatus::Offline {
                a.abgerufen =
                    chrono::DateTime::from_timestamp(gespeichert_at, 0).map(zeitpunkt_utc);
            }
            Some(a)
        }
        Err(e) => {
            tracing::warn!("Fachebenen-Cache: JSON nicht lesbar: {e}");
            None
        }
    }
}

/// Liefert den Cache-Eintrag samt Alter in Sekunden (für Stale-while-revalidate), sonst None.
pub async fn eintrag(pool: &SqlitePool, schluessel: &str) -> Option<(FachebeneAntwort, i64)> {
    let row: Option<(String, i64, i64)> = sqlx::query_as(
        "SELECT antwort_json, unixepoch() - gespeichert_at, gespeichert_at \
         FROM fachebenen_cache WHERE schluessel = ?",
    )
    .bind(schluessel)
    .fetch_optional(pool)
    .await
    .unwrap_or_else(|e| {
        tracing::warn!("Fachebenen-Cache: Lesefehler (eintrag): {e}");
        None
    });
    row.and_then(|(j, alter, gespeichert)| deserialisiere(&j, gespeichert).map(|a| (a, alter)))
}

/// Frischen Eintrag (jünger als `ttl_sekunden`) liefern, sonst None.
pub async fn frisch(
    pool: &SqlitePool,
    schluessel: &str,
    ttl_sekunden: i64,
) -> Option<FachebeneAntwort> {
    let row: Option<(String, i64)> = sqlx::query_as(
        "SELECT antwort_json, gespeichert_at FROM fachebenen_cache \
         WHERE schluessel = ? AND unixepoch() - gespeichert_at < ?",
    )
    .bind(schluessel)
    .bind(ttl_sekunden)
    .fetch_optional(pool)
    .await
    .unwrap_or_else(|e| {
        tracing::warn!("Fachebenen-Cache: Lesefehler (frisch): {e}");
        None
    });
    row.and_then(|(j, gespeichert)| deserialisiere(&j, gespeichert))
}

/// Letzten (auch abgelaufenen) Eintrag liefern — für Stale-Serving bei Quell-Ausfall.
pub async fn stale(pool: &SqlitePool, schluessel: &str) -> Option<FachebeneAntwort> {
    let row: Option<(String, i64)> = sqlx::query_as(
        "SELECT antwort_json, gespeichert_at FROM fachebenen_cache WHERE schluessel = ?",
    )
    .bind(schluessel)
    .fetch_optional(pool)
    .await
    .unwrap_or_else(|e| {
        tracing::warn!("Fachebenen-Cache: Lesefehler (stale): {e}");
        None
    });
    row.and_then(|(j, gespeichert)| deserialisiere(&j, gespeichert))
}

/// Eintrag speichern (Upsert) und überalterte Einträge wegräumen.
///
/// Liefert `true`, wenn der Eintrag danach tatsächlich steht. Die meisten Ebenen dürfen das
/// ignorieren, weil sie ihre Antwort im selben Request weiterreichen. Für die Autobahn-Ebene ist
/// es tragend: ihr einziges Ergebnis ist dieser Eintrag (s. `quellen::erneuere_autobahn`). Ohne
/// `#[must_use]`, weil die übrigen Aufrufer den Wert zu Recht ignorieren.
///
/// Ein gescheitertes Prune zählt nicht als Fehlschlag.
pub async fn setze(pool: &SqlitePool, schluessel: &str, antwort: &FachebeneAntwort) -> bool {
    setze_wert(pool, schluessel, antwort).await
}

/// Wie [`setze`], aber für jeden serialisierbaren Wert (z. B. `odl:grundpegel`). Prune-on-Write
/// gilt genauso.
pub async fn setze_wert<T: Serialize + ?Sized>(
    pool: &SqlitePool,
    schluessel: &str,
    wert: &T,
) -> bool {
    let json = match serde_json::to_string(wert) {
        Ok(j) => j,
        Err(e) => {
            tracing::warn!("Fachebenen-Cache: Serialisierung fehlgeschlagen: {e}");
            return false;
        }
    };
    if let Err(e) = sqlx::query(
        "INSERT INTO fachebenen_cache (schluessel, gespeichert_at, antwort_json) \
         VALUES (?, unixepoch(), ?) \
         ON CONFLICT(schluessel) DO UPDATE SET \
         gespeichert_at = excluded.gespeichert_at, antwort_json = excluded.antwort_json",
    )
    .bind(schluessel)
    .bind(&json)
    .execute(pool)
    .await
    {
        tracing::warn!("Fachebenen-Cache: Schreibfehler: {e}");
        return false;
    }
    // Prune-on-Write, ausgenommen die dauerhaften Schlüssel.
    if let Err(e) = sqlx::query(
        "DELETE FROM fachebenen_cache WHERE unixepoch() - gespeichert_at > ? \
         AND schluessel <> ?",
    )
    .bind(MAX_ALTER_SEKUNDEN)
    .bind(DAUERHAFT)
    .execute(pool)
    .await
    {
        tracing::warn!("Fachebenen-Cache: Prune fehlgeschlagen: {e}");
    }
    true
}

/// Wie [`eintrag`], aber für jeden deserialisierbaren Wert. Ein Eintrag, der sich nicht als
/// `T` lesen lässt, gilt als Miss — dieselbe Regel wie beim Umschlag.
pub async fn eintrag_wert<T: DeserializeOwned>(
    pool: &SqlitePool,
    schluessel: &str,
) -> Option<(T, i64)> {
    let row: Option<(String, i64)> = sqlx::query_as(
        "SELECT antwort_json, unixepoch() - gespeichert_at \
         FROM fachebenen_cache WHERE schluessel = ?",
    )
    .bind(schluessel)
    .fetch_optional(pool)
    .await
    .unwrap_or_else(|e| {
        tracing::warn!("Fachebenen-Cache: Lesefehler (eintrag_wert): {e}");
        None
    });
    let (json, alter) = row?;
    match serde_json::from_str(&json) {
        Ok(w) => Some((w, alter)),
        Err(e) => {
            tracing::warn!("Fachebenen-Cache: JSON nicht lesbar ({schluessel}): {e}");
            None
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn antwort() -> FachebeneAntwort {
        let fc = json!({ "type": "FeatureCollection", "features": [{ "type": "Feature" }] });
        FachebeneAntwort::ok("dwd", "Datenbasis: DWD", Some("2026-06-10".into()), fc)
    }

    #[tokio::test]
    async fn setze_dann_frisch_roundtrip() {
        let pool = crate::db::test_pool().await;
        setze(&pool, "dwd", &antwort()).await;
        let geladen = frisch(&pool, "dwd", 60).await.expect("frischer Eintrag");
        // vollständiger serialize→DB→deserialize Round-Trip
        assert_eq!(geladen.quelle, "dwd");
        assert_eq!(geladen.status, FachebeneStatus::Ok);
        assert_eq!(geladen.attribution, "Datenbasis: DWD");
        assert_eq!(geladen.stand.as_deref(), Some("2026-06-10"));
        assert_eq!(geladen.features["features"].as_array().unwrap().len(), 1);
    }

    #[tokio::test]
    async fn offline_status_roundtrip() {
        // rename_all="lowercase" muss in beide Richtungen funktionieren.
        let pool = crate::db::test_pool().await;
        setze(&pool, "nina", &FachebeneAntwort::offline("nina", "BBK")).await;
        let geladen = stale(&pool, "nina").await.expect("Eintrag");
        assert_eq!(geladen.status, FachebeneStatus::Offline);
    }

    #[tokio::test]
    async fn ttl_null_nicht_frisch_aber_stale() {
        let pool = crate::db::test_pool().await;
        setze(&pool, "dwd", &antwort()).await;
        assert!(frisch(&pool, "dwd", 0).await.is_none());
        assert!(stale(&pool, "dwd").await.is_some());
    }

    /// Legt einen Eintrag ohne `abgerufen` an, wie er vor LFH-591 geschrieben wurde, gespeichert
    /// vor `alter` Sekunden. Liefert den Speicherzeitpunkt.
    async fn alter_eintrag_ohne_abruf(pool: &SqlitePool, schluessel: &str, alter: i64) -> i64 {
        let json = r#"{"quelle":"dwd","status":"ok","attribution":"X","stand":null,
            "features":{"type":"FeatureCollection","features":[{"type":"Feature"}]}}"#;
        sqlx::query(
            "INSERT INTO fachebenen_cache (schluessel, gespeichert_at, antwort_json) \
             VALUES (?, unixepoch() - ?, ?)",
        )
        .bind(schluessel)
        .bind(alter)
        .bind(json)
        .execute(pool)
        .await
        .unwrap();
        sqlx::query_scalar("SELECT gespeichert_at FROM fachebenen_cache WHERE schluessel = ?")
            .bind(schluessel)
            .fetch_one(pool)
            .await
            .unwrap()
    }

    fn als_zeitpunkt(unix: i64) -> String {
        zeitpunkt_utc(chrono::DateTime::from_timestamp(unix, 0).unwrap())
    }

    /// LFH-591: ein Eintrag ohne Feld gilt als zum Speicherzeitpunkt abgerufen — auf allen drei
    /// Lesewegen, nicht als „jetzt".
    #[tokio::test]
    async fn fehlender_abrufzeitpunkt_kommt_aus_dem_speicherzeitpunkt() {
        let pool = crate::db::test_pool().await;
        let gespeichert = alter_eintrag_ohne_abruf(&pool, "dwd", 30 * 3600).await;
        let erwartet = Some(als_zeitpunkt(gespeichert));
        let (a, alter) = eintrag(&pool, "dwd").await.expect("eintrag");
        assert!(alter >= 30 * 3600);
        assert_eq!(a.abgerufen, erwartet);
        assert_eq!(stale(&pool, "dwd").await.unwrap().abgerufen, erwartet);
        assert_eq!(
            frisch(&pool, "dwd", 31 * 3600).await.unwrap().abgerufen,
            erwartet
        );
    }

    /// Ein gespeicherter Abrufzeitpunkt bleibt, wie er ist.
    #[tokio::test]
    async fn vorhandener_abrufzeitpunkt_bleibt() {
        let pool = crate::db::test_pool().await;
        let mut a = antwort();
        a.abgerufen = Some("2026-09-28T08:15:00Z".into());
        setze(&pool, "dwd", &a).await;
        let (gelesen, _) = eintrag(&pool, "dwd").await.unwrap();
        assert_eq!(gelesen.abgerufen.as_deref(), Some("2026-09-28T08:15:00Z"));
    }

    /// Ein gespeichertes `offline` bekommt keinen Abrufzeitpunkt angedichtet.
    #[tokio::test]
    async fn offline_eintrag_bleibt_ohne_abrufzeitpunkt() {
        let pool = crate::db::test_pool().await;
        setze(&pool, "nina", &FachebeneAntwort::offline("nina", "BBK")).await;
        assert_eq!(stale(&pool, "nina").await.unwrap().abgerufen, None);
    }

    #[tokio::test]
    async fn unbekannter_schluessel_ist_none() {
        let pool = crate::db::test_pool().await;
        assert!(frisch(&pool, "x", 60).await.is_none());
        assert!(stale(&pool, "x").await.is_none());
    }

    #[tokio::test]
    async fn geglueckter_schreibvorgang_wird_gemeldet() {
        let pool = crate::db::test_pool().await;
        assert!(setze(&pool, "dwd", &antwort()).await);
    }

    #[tokio::test]
    async fn schreibfehler_wird_gemeldet_statt_nur_geloggt() {
        // Ohne Tabelle scheitert das INSERT — Stellvertreter für SQLite busy/Platte voll/read-only.
        // Der Rückgabewert ist die einzige Spur für den Aufrufer (`erneuere_autobahn` hängt daran).
        let pool = crate::db::test_pool().await;
        sqlx::query("DROP TABLE fachebenen_cache")
            .execute(&pool)
            .await
            .unwrap();
        assert!(!setze(&pool, "dwd", &antwort()).await);
    }

    #[tokio::test]
    async fn upsert_aktualisiert_statt_duplizieren() {
        let pool = crate::db::test_pool().await;
        setze(&pool, "dwd", &FachebeneAntwort::offline("dwd", "a")).await;
        setze(&pool, "dwd", &antwort()).await;
        let n: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM fachebenen_cache WHERE schluessel='dwd'")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(n, 1);
        assert_eq!(
            frisch(&pool, "dwd", 60).await.unwrap().status,
            FachebeneStatus::Ok
        );
    }

    #[tokio::test]
    async fn freier_wert_roundtrip_und_kaputtes_json_ist_miss() {
        use std::collections::BTreeMap;
        let pool = crate::db::test_pool().await;
        let wert = BTreeMap::from([("DEZ0001".to_string(), 0.088_f64)]);
        assert!(setze_wert(&pool, "odl:grundpegel", &wert).await);
        let (gelesen, alter) = eintrag_wert::<BTreeMap<String, f64>>(&pool, "odl:grundpegel")
            .await
            .expect("Eintrag");
        assert_eq!(gelesen, wert);
        assert!((0..5).contains(&alter));
        // Falscher Typ → Miss statt Panik.
        assert!(eintrag_wert::<Vec<String>>(&pool, "odl:grundpegel")
            .await
            .is_none());
        assert!(eintrag_wert::<BTreeMap<String, f64>>(&pool, "fehlt")
            .await
            .is_none());
    }

    #[tokio::test]
    async fn prune_verschont_den_odl_grundpegel() {
        let pool = crate::db::test_pool().await;
        setze_wert(&pool, "odl:grundpegel", &serde_json::json!({})).await;
        setze(&pool, "dwd", &antwort()).await;
        sqlx::query("UPDATE fachebenen_cache SET gespeichert_at = unixepoch() - 30 * 86400")
            .execute(&pool)
            .await
            .unwrap();
        // Irgendein Schreibvorgang löst das Prune aus.
        setze(&pool, "nina", &antwort()).await;
        assert!(stale(&pool, "dwd").await.is_none(), "Prune läuft");
        assert!(
            eintrag_wert::<serde_json::Value>(&pool, "odl:grundpegel")
                .await
                .is_some(),
            "der Grundpegel überlebt"
        );
    }
}
