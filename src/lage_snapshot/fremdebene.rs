//! Fremdebenen in gesicherten Ständen (LLH-2130). Ein Stand nennt je Ebene ihre Angaben und den
//! Hash ihres Inhalts (`daten.fremdebenen`); der Inhalt selbst liegt einmal je Einsatz und Hash in
//! `karte_fremdebene_stand` (Migration 0385), solange ein Stand darauf zeigt. Herleitung:
//! `docs/superpowers/specs/2026-11-25-m6rhqco4-fremdebenen-stand-offline-design.md`.
//!
//! Kopie, kein Verweis auf `karte_fremdebene_daten`: ein neuer Abruf oder das Löschen der Ebene
//! ändert den Stand nicht.

use crate::error::AppError;
use crate::karte_fremdebene::{url_host, FremdebeneQuelle};
use serde::Serialize;
use sqlx::{SqliteConnection, SqlitePool};

/// Eine Fremdebene, wie ein Stand sie einfriert. Nie die volle `url` (sie kann ein Geheimnis
/// tragen), nur ihr Host. Wire-Felder englisch wie `FremdebeneAnzeige`.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct FremdebeneImStand {
    pub id: i64,
    pub name: String,
    pub color: String,
    pub source: FremdebeneQuelle,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub url_host: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fetched_at: Option<String>,
    pub feature_count: i64,
    pub dropped_count: i64,
    /// Schlüssel des Inhalts in `karte_fremdebene_stand`.
    pub sha256: String,
}

#[derive(sqlx::FromRow)]
struct Zeile {
    id: i64,
    name: String,
    farbe: String,
    quelle: FremdebeneQuelle,
    url: Option<String>,
    abgerufen_at: Option<String>,
    objekte: i64,
    verworfen: i64,
    sha256: String,
}

/// Kopiert den aktuellen Inhalt jeder Ebene des Einsatzes nach `karte_fremdebene_stand` (eine
/// Zeile je Hash, `INSERT OR IGNORE`) und liefert die Angaben für `daten.fremdebenen`. Nur Ebenen
/// mit Inhalt; ein am Spiegel noch fehlender Inhalt (leerer Platzhalter) zählt nicht.
pub async fn sichern(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
) -> Result<Vec<FremdebeneImStand>, AppError> {
    let zeilen: Vec<Zeile> = sqlx::query_as(
        "SELECT e.id, e.name, e.farbe, e.quelle, e.url, e.abgerufen_at, \
                d.objekte, d.verworfen, d.sha256 \
         FROM karte_fremdebene e JOIN karte_fremdebene_daten d ON d.ebene_id = e.id \
         WHERE e.einsatz_id = ? AND length(d.geojson) > 0 ORDER BY e.id",
    )
    .bind(einsatz_id)
    .fetch_all(&mut *conn)
    .await?;
    sqlx::query(
        "INSERT OR IGNORE INTO karte_fremdebene_stand \
             (einsatz_id, sha256, geojson, objekte, verworfen) \
         SELECT e.einsatz_id, d.sha256, d.geojson, d.objekte, d.verworfen \
         FROM karte_fremdebene e JOIN karte_fremdebene_daten d ON d.ebene_id = e.id \
         WHERE e.einsatz_id = ? AND length(d.geojson) > 0",
    )
    .bind(einsatz_id)
    .execute(&mut *conn)
    .await?;
    Ok(zeilen
        .into_iter()
        .map(|z| FremdebeneImStand {
            id: z.id,
            url_host: z.url.as_deref().and_then(url_host),
            name: z.name,
            color: z.farbe,
            source: z.quelle,
            fetched_at: z.abgerufen_at,
            feature_count: z.objekte,
            dropped_count: z.verworfen,
            sha256: z.sha256,
        })
        .collect())
}

/// Löscht jeden eingefrorenen Inhalt des Einsatzes, auf den kein Stand mehr zeigt. Läuft in der
/// Transaktion, die einen Stand löscht.
pub async fn raeumen(conn: &mut SqliteConnection, einsatz_id: i64) -> Result<u64, AppError> {
    let res = sqlx::query(
        "DELETE FROM karte_fremdebene_stand WHERE einsatz_id = ?1 AND sha256 NOT IN ( \
             SELECT json_extract(f.value, '$.sha256') \
             FROM lage_snapshot s, json_each(s.daten, '$.fremdebenen') f \
             WHERE s.einsatz_id = ?1 AND json_extract(f.value, '$.sha256') IS NOT NULL)",
    )
    .bind(einsatz_id)
    .execute(&mut *conn)
    .await?;
    Ok(res.rows_affected())
}

/// Der eingefrorene Inhalt `sha256` eines Stands. `None`, wenn der Stand den Hash nicht nennt
/// (kein Lesen fremder Versionen über einen geratenen Hash), der Inhalt fehlt oder zur Entfernung
/// vorgesehen ist (Nachlauf der Schwärzung). Fehlt er am Spiegel noch, 409 „wird geholt“.
pub async fn laden(
    pool: &SqlitePool,
    einsatz_id: i64,
    snapshot_id: i64,
    sha256: &str,
) -> Result<Option<String>, AppError> {
    let vorgesehen = crate::einsatz::schwaerzung_nachlauf::zur_entfernung_vorgesehen_sql("s");
    let id: Option<i64> = sqlx::query_scalar(sqlx::AssertSqlSafe(format!(
        "SELECT s.id FROM karte_fremdebene_stand s \
         WHERE s.einsatz_id = ?1 AND s.sha256 = ?3 AND NOT {vorgesehen} \
           AND EXISTS (SELECT 1 FROM lage_snapshot l, json_each(l.daten, '$.fremdebenen') f \
                       WHERE l.id = ?2 AND l.einsatz_id = ?1 \
                         AND json_extract(f.value, '$.sha256') = ?3)"
    )))
    .bind(einsatz_id)
    .bind(snapshot_id)
    .bind(sha256)
    .fetch_optional(pool)
    .await?;
    let Some(id) = id else {
        return Ok(None);
    };
    crate::instanz::spiegel::anhang::pruefe_vorhanden(
        pool,
        "karte_fremdebene_stand",
        &id.to_string(),
    )
    .await?;
    let geojson: Option<Vec<u8>> =
        sqlx::query_scalar("SELECT geojson FROM karte_fremdebene_stand WHERE id = ?")
            .bind(id)
            .fetch_optional(pool)
            .await?;
    geojson
        .map(|g| {
            String::from_utf8(g)
                .map_err(|_| AppError::Internal("Eingefrorene Fremdebene ohne UTF-8-Inhalt".into()))
        })
        .transpose()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::karte_fremdebene::einlesen::read_datei;
    use crate::karte_fremdebene::repo as ebenen;
    use crate::lage_snapshot::repo;

    async fn einsatz(pool: &SqlitePool) -> (i64, i64) {
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
            "INSERT INTO einsatz (org_id, bezeichnung, status) VALUES (1, 'Lage', 'aktiv') \
             RETURNING id",
        )
        .fetch_one(pool)
        .await
        .unwrap();
        (e, b)
    }

    fn punkte(n: usize) -> crate::karte_fremdebene::einlesen::Normiert {
        let f = vec![r#"{"type":"Feature","geometry":{"type":"Point","coordinates":[9,52]}}"#; n];
        read_datei(
            format!(
                r#"{{"type":"FeatureCollection","features":[{}]}}"#,
                f.join(",")
            )
            .as_bytes(),
        )
        .unwrap()
    }

    async fn url_ebene(pool: &SqlitePool, e: i64, b: i64, n: usize) -> i64 {
        ebenen::anlegen(
            pool,
            e,
            b,
            "Pegel",
            FremdebeneQuelle::Url,
            Some("https://geo.example.org/pegel?token=geheim"),
            "fremd-2",
            &punkte(n),
        )
        .await
        .unwrap()
        .id
    }

    async fn stand(pool: &SqlitePool, e: i64, b: i64) -> (i64, serde_json::Value) {
        let dok = repo::erzeuge(pool, e, b, None, None).await.unwrap();
        (dok.id, dok.daten)
    }

    fn hashes(daten: &serde_json::Value) -> Vec<String> {
        daten["fremdebenen"]
            .as_array()
            .unwrap()
            .iter()
            .map(|f| f["sha256"].as_str().unwrap().to_string())
            .collect()
    }

    async fn zeilen(pool: &SqlitePool) -> i64 {
        sqlx::query_scalar("SELECT COUNT(*) FROM karte_fremdebene_stand")
            .fetch_one(pool)
            .await
            .unwrap()
    }

    #[tokio::test]
    async fn stand_friert_ebenen_mit_hash_ohne_url_ein() {
        let pool = crate::db::test_pool().await;
        let (e, b) = einsatz(&pool).await;
        let id = url_ebene(&pool, e, b, 2).await;
        // Eine URL-Ebene vor dem ersten Abruf hat keinen Inhalt und fehlt im Stand.
        sqlx::query(
            "INSERT INTO karte_fremdebene (einsatz_id, name, quelle, url, farbe, angelegt_von, \
             erstellt_at, geaendert_at) VALUES (?, 'Leer', 'url', 'https://x.example/a', \
             'fremd-3', ?, '2026-11-25 10:00:00', '2026-11-25 10:00:00')",
        )
        .bind(e)
        .bind(b)
        .execute(&pool)
        .await
        .unwrap();

        let (_, daten) = stand(&pool, e, b).await;
        let liste = daten["fremdebenen"].as_array().unwrap();
        assert_eq!(liste.len(), 1);
        assert_eq!(liste[0]["id"], id);
        assert_eq!(liste[0]["name"], "Pegel");
        assert_eq!(liste[0]["color"], "fremd-2");
        assert_eq!(liste[0]["url_host"], "geo.example.org");
        assert_eq!(liste[0]["feature_count"], 2);
        assert_eq!(liste[0]["sha256"].as_str().unwrap().len(), 64);
        assert!(
            !daten.to_string().contains("geheim"),
            "keine volle URL im Stand"
        );
        assert_eq!(zeilen(&pool).await, 1);
    }

    #[tokio::test]
    async fn zweiter_stand_ohne_aenderung_legt_keine_zeile_an() {
        let pool = crate::db::test_pool().await;
        let (e, b) = einsatz(&pool).await;
        url_ebene(&pool, e, b, 1).await;
        stand(&pool, e, b).await;
        stand(&pool, e, b).await;
        assert_eq!(zeilen(&pool).await, 1);
    }

    #[tokio::test]
    async fn alter_stand_behaelt_alten_inhalt() {
        let pool = crate::db::test_pool().await;
        let (e, b) = einsatz(&pool).await;
        let id = url_ebene(&pool, e, b, 1).await;
        let alt = punkte(1).geojson;
        let (sid, daten) = stand(&pool, e, b).await;
        let h = hashes(&daten).remove(0);

        assert!(ebenen::ersetze_daten(&pool, e, id, &punkte(3))
            .await
            .unwrap());
        assert_eq!(laden(&pool, e, sid, &h).await.unwrap(), Some(alt));
    }

    #[tokio::test]
    async fn ebene_loeschen_laesst_stand_lesbar() {
        let pool = crate::db::test_pool().await;
        let (e, b) = einsatz(&pool).await;
        let id = url_ebene(&pool, e, b, 1).await;
        let (sid, daten) = stand(&pool, e, b).await;
        let h = hashes(&daten).remove(0);

        ebenen::loeschen(&pool, e, id).await.unwrap();
        assert_eq!(
            laden(&pool, e, sid, &h).await.unwrap(),
            Some(punkte(1).geojson)
        );
    }

    #[tokio::test]
    async fn loeschen_raeumt_nur_unverwiesene() {
        let pool = crate::db::test_pool().await;
        let (e, b) = einsatz(&pool).await;
        let id = url_ebene(&pool, e, b, 1).await;
        let (a, da) = stand(&pool, e, b).await;
        ebenen::ersetze_daten(&pool, e, id, &punkte(2))
            .await
            .unwrap();
        let (sb, db) = stand(&pool, e, b).await;
        let (sc, _) = stand(&pool, e, b).await;
        let (h1, h2) = (hashes(&da).remove(0), hashes(&db).remove(0));
        assert_eq!(zeilen(&pool).await, 2);

        assert!(repo::loesche(&pool, e, a).await.unwrap());
        assert_eq!(zeilen(&pool).await, 1, "h1 hat keinen Stand mehr");
        assert!(repo::loesche(&pool, e, sb).await.unwrap());
        assert_eq!(zeilen(&pool).await, 1, "h2 trägt noch Stand C");
        assert_eq!(
            laden(&pool, e, sc, &h2).await.unwrap(),
            Some(punkte(2).geojson)
        );
        assert_ne!(h1, h2);
    }

    #[tokio::test]
    async fn laden_kennt_nur_hashes_des_stands() {
        let pool = crate::db::test_pool().await;
        let (e, b) = einsatz(&pool).await;
        let (anderer, b2) = einsatz(&pool).await;
        let id = url_ebene(&pool, e, b, 1).await;
        let (sa, _) = stand(&pool, e, b).await;
        ebenen::ersetze_daten(&pool, e, id, &punkte(2))
            .await
            .unwrap();
        let (sb, db) = stand(&pool, e, b).await;
        let h2 = hashes(&db).remove(0);
        let (s_anderer, _) = stand(&pool, anderer, b2).await;

        assert_eq!(
            laden(&pool, e, sa, &h2).await.unwrap(),
            None,
            "Hash aus Stand B"
        );
        assert_eq!(laden(&pool, anderer, s_anderer, &h2).await.unwrap(), None);
        assert!(laden(&pool, e, sb, &h2).await.unwrap().is_some());
    }
}
