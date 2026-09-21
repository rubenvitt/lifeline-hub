//! Persistenter Cache (SQLite-Tabelle `fachebenen_cache`) mit TTL für Fachebenen-Antworten.
//! Schlüssel: `quelle` bzw. `quelle:<raster-bbox>`. Überlebt Backend-Neustarts.
//!
//! Cache-Fehler (DB-Lese-/Schreibfehler) sind NICHT fatal: Lesen → behandelt als Miss,
//! Schreiben → geloggt UND gemeldet. Eine erfolgreiche externe Abfrage darf nie an einem
//! Cache-Schreibfehler scheitern — wohl aber muss ein Aufrufer, dessen einziges Ergebnis
//! der Eintrag IST, erfahren, dass er nicht steht (siehe `setze`).

use crate::karte::typen::FachebeneAntwort;
use serde::de::DeserializeOwned;
use serde::Serialize;
use sqlx::SqlitePool;

/// Maximalalter, ab dem Einträge beim Schreiben weggeräumt werden (Prune-on-Write).
/// Bewusst über der längsten TTL (KRITIS 24 h) → begrenzt die Tabelle dauerhaft,
/// ohne gültiges Stale-Serving zu verlieren.
const MAX_ALTER_SEKUNDEN: i64 = 2 * 24 * 3600;

/// Vom Prune ausgenommen: der ODL-Grundpegel (LFH-598). Er wird nur geschrieben, wenn die
/// BfS-Zeitreihe brauchbar antwortet; jeder andere Schreibvorgang (der `odl`-Eintrag alle
/// zehn Minuten) löste sonst das Prune aus. Nach zwei Tagen gestörter Zeitreihe wäre er
/// weg — samt Sperrklinken-Gedächtnis —, obwohl die Spec verlangt, ihn weiterzuverwenden.
/// Ein Eintrag, ~100 KB; er wächst nicht.
const DAUERHAFT: &str = crate::karte::odl_grundpegel::CACHE_SCHLUESSEL;

fn deserialisiere(json: &str) -> Option<FachebeneAntwort> {
    match serde_json::from_str(json) {
        Ok(a) => Some(a),
        Err(e) => {
            tracing::warn!("Fachebenen-Cache: JSON nicht lesbar: {e}");
            None
        }
    }
}

/// Liefert den Cache-Eintrag samt Alter in Sekunden (für Stale-while-revalidate), sonst None.
pub async fn eintrag(pool: &SqlitePool, schluessel: &str) -> Option<(FachebeneAntwort, i64)> {
    let row: Option<(String, i64)> = sqlx::query_as(
        "SELECT antwort_json, unixepoch() - gespeichert_at \
         FROM fachebenen_cache WHERE schluessel = ?",
    )
    .bind(schluessel)
    .fetch_optional(pool)
    .await
    .unwrap_or_else(|e| {
        tracing::warn!("Fachebenen-Cache: Lesefehler (eintrag): {e}");
        None
    });
    row.and_then(|(j, alter)| deserialisiere(&j).map(|a| (a, alter)))
}

/// Frischen Eintrag (jünger als `ttl_sekunden`) liefern, sonst None.
pub async fn frisch(
    pool: &SqlitePool,
    schluessel: &str,
    ttl_sekunden: i64,
) -> Option<FachebeneAntwort> {
    let json: Option<String> = sqlx::query_scalar(
        "SELECT antwort_json FROM fachebenen_cache \
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
    json.and_then(|j| deserialisiere(&j))
}

/// Letzten (auch abgelaufenen) Eintrag liefern — für Stale-Serving bei Quell-Ausfall.
pub async fn stale(pool: &SqlitePool, schluessel: &str) -> Option<FachebeneAntwort> {
    let json: Option<String> =
        sqlx::query_scalar("SELECT antwort_json FROM fachebenen_cache WHERE schluessel = ?")
            .bind(schluessel)
            .fetch_optional(pool)
            .await
            .unwrap_or_else(|e| {
                tracing::warn!("Fachebenen-Cache: Lesefehler (stale): {e}");
                None
            });
    json.and_then(|j| deserialisiere(&j))
}

/// Eintrag speichern (Upsert) und dabei überalterte Einträge wegräumen.
///
/// Liefert `true`, wenn der Eintrag danach TATSÄCHLICH steht. Die meisten Ebenen dürfen das
/// ignorieren: sie reichen ihre frische Antwort im selben Request ans Frontend weiter, ein
/// misslungener Schreibvorgang kostet dort nur einen erneuten Abruf beim nächsten Poll.
/// Für die Autobahn-Ebene ist es dagegen tragend — ihr Fächer hängt an keinem Request, sein
/// EINZIGES Ergebnis ist dieser Eintrag (siehe `quellen::erneuere_autobahn`).
///
/// Bewusst **ohne** `#[must_use]`: fünf der sechs Aufrufer ignorieren den Wert zu Recht, und
/// ein Gate, das an fünf Stellen mit `let _ =` stummgeschaltet wird, sichert nichts zu.
///
/// Ein gescheitertes Prune zählt NICHT als Fehlschlag — der Eintrag steht dann bereits.
pub async fn setze(pool: &SqlitePool, schluessel: &str, antwort: &FachebeneAntwort) -> bool {
    setze_wert(pool, schluessel, antwort).await
}

/// Wie [`setze`], aber für jeden serialisierbaren Wert — die Tabelle hält ohnehin JSON-Text.
/// Genutzt für Einträge, die kein Fachebenen-Umschlag sind (LFH-598: `odl:grundpegel`).
/// Prune-on-Write gilt für sie genauso.
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
    // Prune-on-Write: überalterte Einträge entfernen (begrenzt die Tabelle dauerhaft).
    // Ausgenommen sind die DAUERHAFTEN Schlüssel (s. dort).
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
    use crate::karte::typen::{FachebeneAntwort, FachebeneStatus};
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
        // Ohne Tabelle scheitert das INSERT — der Stellvertreter für „SQLite busy /
        // Platte voll / read-only". Der Rückgabewert ist die einzige Spur, an der ein
        // Aufrufer das bemerken kann; nur geloggt sah ein misslungener Schreibvorgang für
        // ihn wie ein geglückter aus. `erneuere_autobahn` hängt genau daran: dort ist der
        // Eintrag das EINZIGE Ergebnis des Laufs, und ein stillschweigend verworfener
        // Schreibvorgang liesse den Aufwärm-Takt alle 20 s einen neuen Fächer anstossen.
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
