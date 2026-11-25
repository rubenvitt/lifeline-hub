//! Speicher der Fremdebenen. Metadaten in `karte_fremdebene`, das normierte GeoJSON in
//! `karte_fremdebene_daten` (Migration 0373): die Liste liest nie den Inhalt, nur
//! [`laden_daten`] berührt ihn. Gelöscht wird der Inhalt per CASCADE mit der Ebene.
//!
//! Der Inhalt liegt als BLOB (UTF-8-Text): so kommt er am Spiegel wie ein Anhang auf Abruf
//! (`instanz::spiegel::anhang`, Kategorie `anhaenge`), statt als Zeile über `paket::ZEILE_MAX`
//! liegen zu bleiben.

use super::einlesen::Normiert;
use super::{url_host, FremdebeneAnzeige, FremdebeneFehler, FremdebeneQuelle};
use crate::error::AppError;
use sha2::{Digest, Sha256};
use sqlx::SqlitePool;

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

/// Prüfsumme des Inhalts; auch das `ETag` der Daten-Route.
pub fn sha256(geojson: &str) -> String {
    hex(&Sha256::digest(geojson.as_bytes()))
}

#[derive(sqlx::FromRow)]
struct Zeile {
    id: i64,
    name: String,
    quelle: FremdebeneQuelle,
    url: Option<String>,
    farbe: String,
    objekte: i64,
    verworfen: i64,
    abgerufen_at: Option<String>,
    versucht_at: Option<String>,
    fehler: Option<FremdebeneFehler>,
    erstellt_at: String,
}

impl From<Zeile> for FremdebeneAnzeige {
    fn from(z: Zeile) -> Self {
        FremdebeneAnzeige {
            id: z.id,
            url_host: z.url.as_deref().and_then(url_host),
            name: z.name,
            source: z.quelle,
            url: z.url,
            color: z.farbe,
            feature_count: z.objekte,
            dropped_count: z.verworfen,
            fetched_at: z.abgerufen_at,
            attempted_at: z.versucht_at,
            error: z.fehler,
            created_at: z.erstellt_at,
        }
    }
}

const ANZEIGE_SELECT: &str = "\
    SELECT e.id, e.name, e.quelle, e.url, e.farbe, \
           COALESCE(d.objekte, 0) AS objekte, COALESCE(d.verworfen, 0) AS verworfen, \
           e.abgerufen_at, e.versucht_at, e.fehler, e.erstellt_at \
    FROM karte_fremdebene e LEFT JOIN karte_fremdebene_daten d ON d.ebene_id = e.id";

/// Alle Fremdebenen eines Einsatzes in der Reihenfolge des Anlegens.
pub async fn liste(pool: &SqlitePool, einsatz_id: i64) -> Result<Vec<FremdebeneAnzeige>, AppError> {
    let zeilen: Vec<Zeile> = sqlx::query_as(sqlx::AssertSqlSafe(format!(
        "{ANZEIGE_SELECT} WHERE e.einsatz_id = ? ORDER BY e.id"
    )))
    .bind(einsatz_id)
    .fetch_all(pool)
    .await?;
    Ok(zeilen.into_iter().map(Into::into).collect())
}

/// Eine Fremdebene; `NotFound`, wenn sie nicht (zu diesem Einsatz) existiert.
pub async fn laden(
    pool: &SqlitePool,
    einsatz_id: i64,
    id: i64,
) -> Result<FremdebeneAnzeige, AppError> {
    let zeile: Option<Zeile> = sqlx::query_as(sqlx::AssertSqlSafe(format!(
        "{ANZEIGE_SELECT} WHERE e.id = ? AND e.einsatz_id = ?"
    )))
    .bind(id)
    .bind(einsatz_id)
    .fetch_optional(pool)
    .await?;
    zeile.map(Into::into).ok_or(AppError::NotFound)
}

/// Legt eine Ebene mit ihrem Inhalt an, in einer Transaktion: eine Ebene ohne Inhalt gibt es
/// nicht. `url` gehört genau zur Quelle `url` (CHECK der Tabelle).
#[allow(clippy::too_many_arguments)]
pub async fn anlegen(
    pool: &SqlitePool,
    einsatz_id: i64,
    angelegt_von: i64,
    name: &str,
    quelle: FremdebeneQuelle,
    url: Option<&str>,
    farbe: &str,
    normiert: &Normiert,
) -> Result<FremdebeneAnzeige, AppError> {
    let sha = sha256(&normiert.geojson);
    let jetzt = crate::zeit::jetzt();
    let id = crate::write_retry!(pool, |conn| {
        let id: i64 = sqlx::query_scalar(
            "INSERT INTO karte_fremdebene \
                (einsatz_id, name, quelle, url, farbe, angelegt_von, erstellt_at, geaendert_at) \
             VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING id",
        )
        .bind(einsatz_id)
        .bind(name)
        .bind(quelle.as_str())
        .bind(url)
        .bind(farbe)
        .bind(angelegt_von)
        .bind(&jetzt)
        .bind(&jetzt)
        .fetch_one(&mut *conn)
        .await?;
        sqlx::query(
            "INSERT INTO karte_fremdebene_daten (ebene_id, geojson, sha256, objekte, verworfen) \
             VALUES (?, ?, ?, ?, ?)",
        )
        .bind(id)
        .bind(normiert.geojson.as_bytes())
        .bind(&sha)
        .bind(normiert.objekte)
        .bind(normiert.verworfen)
        .execute(&mut *conn)
        .await?;
        Ok(id)
    })?;
    laden(pool, einsatz_id, id).await
}

/// Das normierte GeoJSON und seine Prüfsumme; `None`, wenn die Ebene nicht (zu diesem Einsatz)
/// existiert. Am Spiegel kommt der Inhalt auf Abruf (409, solange er fehlt).
pub async fn laden_daten(
    pool: &SqlitePool,
    einsatz_id: i64,
    id: i64,
) -> Result<Option<(String, String)>, AppError> {
    let da: Option<i64> =
        sqlx::query_scalar("SELECT id FROM karte_fremdebene WHERE id = ? AND einsatz_id = ?")
            .bind(id)
            .bind(einsatz_id)
            .fetch_optional(pool)
            .await?;
    if da.is_none() {
        return Ok(None);
    }
    crate::instanz::spiegel::anhang::pruefe_vorhanden(
        pool,
        "karte_fremdebene_daten",
        &id.to_string(),
    )
    .await?;
    let zeile: Option<(Vec<u8>, String)> = sqlx::query_as(
        "SELECT d.geojson, d.sha256 FROM karte_fremdebene_daten d \
         JOIN karte_fremdebene e ON e.id = d.ebene_id WHERE e.id = ? AND e.einsatz_id = ?",
    )
    .bind(id)
    .bind(einsatz_id)
    .fetch_optional(pool)
    .await?;
    zeile
        .map(|(geojson, sha)| {
            String::from_utf8(geojson)
                .map(|g| (g, sha))
                .map_err(|_| AppError::Internal("Fremdebene ohne UTF-8-Inhalt".into()))
        })
        .transpose()
}

/// Ersetzt den Inhalt einer Ebene (neuer Abruf). `true`, wenn er sich geändert hat (dann ein
/// Live-Ereignis); gleicher Inhalt schreibt nichts. `NotFound` ohne Ebene.
pub async fn ersetze_daten(
    pool: &SqlitePool,
    einsatz_id: i64,
    id: i64,
    normiert: &Normiert,
) -> Result<bool, AppError> {
    let sha = sha256(&normiert.geojson);
    crate::write_retry!(pool, |conn| {
        let bisher: Option<Option<String>> = sqlx::query_scalar(
            "SELECT d.sha256 FROM karte_fremdebene e \
             LEFT JOIN karte_fremdebene_daten d ON d.ebene_id = e.id \
             WHERE e.id = ? AND e.einsatz_id = ?",
        )
        .bind(id)
        .bind(einsatz_id)
        .fetch_optional(&mut *conn)
        .await?;
        let Some(bisher) = bisher else {
            return Err(AppError::NotFound);
        };
        if bisher.as_deref() == Some(sha.as_str()) {
            return Ok(false);
        }
        sqlx::query(
            "INSERT INTO karte_fremdebene_daten (ebene_id, geojson, sha256, objekte, verworfen) \
             VALUES (?, ?, ?, ?, ?) \
             ON CONFLICT (ebene_id) DO UPDATE SET geojson = excluded.geojson, \
                sha256 = excluded.sha256, objekte = excluded.objekte, \
                verworfen = excluded.verworfen",
        )
        .bind(id)
        .bind(normiert.geojson.as_bytes())
        .bind(&sha)
        .bind(normiert.objekte)
        .bind(normiert.verworfen)
        .execute(&mut *conn)
        .await?;
        sqlx::query("UPDATE karte_fremdebene SET geaendert_at = ? WHERE id = ?")
            .bind(crate::zeit::jetzt())
            .bind(id)
            .execute(&mut *conn)
            .await?;
        Ok(true)
    })
}

/// Ausgang eines Abrufs der URL-Ebene, für [`setze_abruf`].
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AbrufStand<'a> {
    /// 200 oder 304: `abgerufen_at` rückt vor, der Fehler fällt weg; die Validatoren der
    /// Antwort ersetzen die bisherigen (bei 304 gibt der Aufrufer die bisherigen weiter).
    Erfolg {
        etag: Option<&'a str>,
        last_modified: Option<&'a str>,
    },
    /// Gescheitert: nur der Code, der letzte Stand bleibt.
    Fehler(FremdebeneFehler),
}

/// Hält einen Abrufversuch fest (`versucht_at` immer).
pub async fn setze_abruf(
    pool: &SqlitePool,
    einsatz_id: i64,
    id: i64,
    stand: AbrufStand<'_>,
) -> Result<(), AppError> {
    let jetzt = crate::zeit::jetzt();
    let ergebnis =
        match stand {
            AbrufStand::Erfolg {
                etag,
                last_modified,
            } => sqlx::query(
                "UPDATE karte_fremdebene SET versucht_at = ?, abgerufen_at = ?, fehler = NULL, \
                quelle_etag = ?, quelle_last_modified = ? \
             WHERE id = ? AND einsatz_id = ?",
            )
            .bind(&jetzt)
            .bind(&jetzt)
            .bind(etag)
            .bind(last_modified)
            .bind(id)
            .bind(einsatz_id)
            .execute(pool)
            .await?,
            AbrufStand::Fehler(fehler) => {
                sqlx::query(
                    "UPDATE karte_fremdebene SET versucht_at = ?, fehler = ? \
             WHERE id = ? AND einsatz_id = ?",
                )
                .bind(&jetzt)
                .bind(fehler.as_str())
                .bind(id)
                .bind(einsatz_id)
                .execute(pool)
                .await?
            }
        };
    if ergebnis.rows_affected() == 0 {
        return Err(AppError::NotFound);
    }
    Ok(())
}

/// Änderbare Angaben einer Ebene; `None` heißt unverändert.
#[derive(Debug, Default, Clone)]
pub struct FremdebenePatch {
    pub name: Option<String>,
    pub farbe: Option<String>,
}

pub async fn aktualisiere(
    pool: &SqlitePool,
    einsatz_id: i64,
    id: i64,
    patch: FremdebenePatch,
) -> Result<FremdebeneAnzeige, AppError> {
    let ergebnis = sqlx::query(
        "UPDATE karte_fremdebene SET \
            name  = COALESCE(?, name), \
            farbe = COALESCE(?, farbe), \
            geaendert_at = ? \
         WHERE id = ? AND einsatz_id = ?",
    )
    .bind(patch.name)
    .bind(patch.farbe)
    .bind(crate::zeit::jetzt())
    .bind(id)
    .bind(einsatz_id)
    .execute(pool)
    .await?;
    if ergebnis.rows_affected() == 0 {
        return Err(AppError::NotFound);
    }
    laden(pool, einsatz_id, id).await
}

/// Entfernt eine Ebene samt Inhalt (CASCADE).
pub async fn loeschen(pool: &SqlitePool, einsatz_id: i64, id: i64) -> Result<(), AppError> {
    let ergebnis = sqlx::query("DELETE FROM karte_fremdebene WHERE id = ? AND einsatz_id = ?")
        .bind(id)
        .bind(einsatz_id)
        .execute(pool)
        .await?;
    if ergebnis.rows_affected() == 0 {
        return Err(AppError::NotFound);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::karte_fremdebene::einlesen::read_datei;

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

    fn punkte(n: usize) -> Normiert {
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

    #[tokio::test]
    async fn anlegen_liste_daten_aendern_loeschen() {
        let pool = crate::db::test_pool().await;
        let (e, b) = einsatz(&pool).await;
        let (fremd, _) = einsatz(&pool).await;
        let n = punkte(2);
        let ebene = anlegen(
            &pool,
            e,
            b,
            "Hydranten",
            FremdebeneQuelle::Datei,
            None,
            "fremd-1",
            &n,
        )
        .await
        .unwrap();
        assert_eq!(
            (
                ebene.name.as_str(),
                ebene.source,
                ebene.feature_count,
                ebene.dropped_count
            ),
            ("Hydranten", FremdebeneQuelle::Datei, 2, 0)
        );
        assert_eq!((ebene.url.clone(), ebene.url_host.clone()), (None, None));
        assert_eq!(liste(&pool, e).await.unwrap(), vec![ebene.clone()]);
        assert!(liste(&pool, fremd).await.unwrap().is_empty());

        let (geojson, sha) = laden_daten(&pool, e, ebene.id).await.unwrap().unwrap();
        assert_eq!(geojson, n.geojson);
        assert_eq!(sha, sha256(&n.geojson));
        assert_eq!(laden_daten(&pool, fremd, ebene.id).await.unwrap(), None);

        let neu = aktualisiere(
            &pool,
            e,
            ebene.id,
            FremdebenePatch {
                name: Some("Hydranten Süd".into()),
                farbe: None,
            },
        )
        .await
        .unwrap();
        assert_eq!(
            (neu.name.as_str(), neu.color.as_str()),
            ("Hydranten Süd", "fremd-1")
        );
        assert!(matches!(
            aktualisiere(&pool, fremd, ebene.id, FremdebenePatch::default()).await,
            Err(AppError::NotFound)
        ));

        assert!(matches!(
            loeschen(&pool, fremd, ebene.id).await,
            Err(AppError::NotFound)
        ));
        loeschen(&pool, e, ebene.id).await.unwrap();
        assert!(liste(&pool, e).await.unwrap().is_empty());
        let rest: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM karte_fremdebene_daten")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(rest, 0, "Inhalt fällt per CASCADE");
    }

    #[tokio::test]
    async fn url_ebene_haelt_abruf_und_ersetzt_nur_neuen_inhalt() {
        let pool = crate::db::test_pool().await;
        let (e, b) = einsatz(&pool).await;
        let url = "https://geo.example.org/lage.geojson?token=geheim";
        let ebene = anlegen(
            &pool,
            e,
            b,
            "Lage",
            FremdebeneQuelle::Url,
            Some(url),
            "fremd-2",
            &punkte(1),
        )
        .await
        .unwrap();
        assert_eq!(ebene.url.as_deref(), Some(url));
        assert_eq!(ebene.url_host.as_deref(), Some("geo.example.org"));
        assert_eq!(ebene.clone().fuer_leser().url, None);

        assert!(!ersetze_daten(&pool, e, ebene.id, &punkte(1)).await.unwrap());
        assert!(ersetze_daten(&pool, e, ebene.id, &punkte(3)).await.unwrap());
        assert_eq!(laden(&pool, e, ebene.id).await.unwrap().feature_count, 3);

        setze_abruf(
            &pool,
            e,
            ebene.id,
            AbrufStand::Erfolg {
                etag: Some("\"v1\""),
                last_modified: None,
            },
        )
        .await
        .unwrap();
        let ok = laden(&pool, e, ebene.id).await.unwrap();
        assert!(ok.fetched_at.is_some() && ok.attempted_at.is_some());
        assert_eq!(ok.error, None);

        setze_abruf(
            &pool,
            e,
            ebene.id,
            AbrufStand::Fehler(FremdebeneFehler::Status),
        )
        .await
        .unwrap();
        let fehl = laden(&pool, e, ebene.id).await.unwrap();
        assert_eq!(fehl.error, Some(FremdebeneFehler::Status));
        assert_eq!(fehl.fetched_at, ok.fetched_at, "letzter Stand bleibt");
        assert_eq!(fehl.feature_count, 3);
        let etag: Option<String> =
            sqlx::query_scalar("SELECT quelle_etag FROM karte_fremdebene WHERE id = ?")
                .bind(ebene.id)
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(etag.as_deref(), Some("\"v1\""));
    }

    #[tokio::test]
    async fn url_gehoert_genau_zur_quelle_url() {
        let pool = crate::db::test_pool().await;
        let (e, b) = einsatz(&pool).await;
        let n = punkte(1);
        assert!(
            anlegen(&pool, e, b, "x", FremdebeneQuelle::Url, None, "fremd-1", &n)
                .await
                .is_err()
        );
        assert!(anlegen(
            &pool,
            e,
            b,
            "x",
            FremdebeneQuelle::Datei,
            Some("https://a.b"),
            "fremd-1",
            &n
        )
        .await
        .is_err());
    }
}
