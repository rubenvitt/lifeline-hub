//! KRITIS-Bestand in der Nachschlage-Cache-DB (LFH-83): Austausch nach einem Import und
//! Abfrage je Karten-Ausschnitt.
//!
//! **Warum nicht `fachebenen_cache`:** dessen Prune-on-Write räumt alles älter als zwei Tage
//! weg — ein Wochenbestand wäre nach dem dritten Tag verschwunden. Und ein JSON-Blob je
//! bbox lässt sich nicht nach Ausschnitt abfragen. **Warum nicht die operative DB:** der
//! Bestand ist aus dem Extrakt jederzeit neu zu erzeugen, gehört also weder in Sicherungen
//! noch unter die Writer-Disziplin des Einsatzbetriebs.
//!
//! Der Austausch ist atomar: geschrieben wird in `kritis_objekt_neu`, erst ein vollständiger
//! Lauf tauscht in EINER Transaktion. Die Route sieht deshalb nie einen halben Bestand, und
//! ein abgebrochener Lauf hinterlässt nur eine Staging-Tabelle, die der nächste verwirft.

use super::extrakt::KritisObjekt;
use super::KRITIS_ATTRIB;
use crate::karte::typen::{Bbox, FachebeneAntwort};
use serde_json::{json, Value};
use sqlx::SqlitePool;

/// Obergrenze der Features je Antwort (Spec „Viele Objekte werden serverseitig verdichtet").
pub const MAX_FEATURES: i64 = 5_000;

/// Rasterweiten in Grad, aufsteigend. Gewählt wird die kleinste, bei der höchstens
/// [`MAX_FEATURES`] Zellen auf den Ausschnitt fallen. Fest und am Nullmeridian/Äquator
/// verankert — zwei Ausschnitte mit derselben Weite teilen sich also dieselben Zellen.
/// Die obersten Stufen fangen auch einen Weltausschnitt (360° / 5° × 180° / 5° = 2 592).
const RASTER_LEITER: [f64; 11] = [0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1.0, 2.0, 5.0, 10.0, 20.0];

/// Versatz, mit dem `CAST(… AS INTEGER)` (schneidet zur Null hin ab) zum Abrunden wird: jede
/// Zellennummer ist damit positiv. Bei der kleinsten Weite 0,01° reicht der Bereich bis
/// −180 / 0,01 = −18 000; 100 000 lässt reichlich Luft. Rust rechnet dieselbe Formel
/// (IEEE-754 wie SQLite), damit Zellgrenzen auf beiden Seiten identisch fallen.
const ZELL_VERSATZ: f64 = 100_000.0;

fn zelle(koordinate: f64, weite: f64) -> i64 {
    (koordinate / weite + ZELL_VERSATZ) as i64
}

/// Metadaten des zuletzt übernommenen Imports (eine Zeile).
#[derive(Debug, Clone, PartialEq)]
pub struct ImportMeta {
    /// Datenstand des Extrakts (RFC 3339) — geht als `stand` in jede Antwort.
    pub stand: String,
    pub quelle_url: String,
    /// `Last-Modified`/`ETag` des Extrakts, gegen die der nächste Lauf per HEAD vergleicht.
    pub last_modified: Option<String>,
    pub etag: Option<String>,
    /// Unix-Sekunden des letzten erfolgreichen Laufs — auch eines ohne neuen Extrakt.
    pub importiert_at: i64,
    pub anzahl: i64,
}

/// Metadaten des aktuellen Bestands; `None`, solange nie ein Import gelungen ist.
pub async fn meta(pool: &SqlitePool) -> Option<ImportMeta> {
    let row: Option<(String, String, Option<String>, Option<String>, i64, i64)> = sqlx::query_as(
        "SELECT stand, quelle_url, last_modified, etag, importiert_at, anzahl \
         FROM kritis_import WHERE id = 1",
    )
    .fetch_optional(pool)
    .await
    .unwrap_or_else(|e| {
        tracing::warn!("KRITIS-Bestand: Metadaten nicht lesbar: {e}");
        None
    });
    row.map(
        |(stand, quelle_url, last_modified, etag, importiert_at, anzahl)| ImportMeta {
            stand,
            quelle_url,
            last_modified,
            etag,
            importiert_at,
            anzahl,
        },
    )
}

/// Ersetzt den Bestand durch `objekte` und schreibt `meta` — alles oder nichts.
pub async fn ersetze_bestand(
    pool: &SqlitePool,
    objekte: &[KritisObjekt],
    meta: &ImportMeta,
) -> Result<(), sqlx::Error> {
    // Eine Staging-Tabelle aus einem abgebrochenen Lauf ist unvollständig — nie weiterbauen.
    // (Dasselbe gilt für `kritis_zelle_neu`, die unten vor ihrer Befüllung verworfen wird.)
    sqlx::query("DROP TABLE IF EXISTS kritis_objekt_neu")
        .execute(pool)
        .await?;
    sqlx::query(
        "CREATE TABLE kritis_objekt_neu (\
             osm_typ         TEXT    NOT NULL, \
             osm_id          INTEGER NOT NULL, \
             lon             REAL    NOT NULL, \
             lat             REAL    NOT NULL, \
             kategorie       TEXT    NOT NULL, \
             properties_json TEXT    NOT NULL, \
             PRIMARY KEY (osm_typ, osm_id))",
    )
    .execute(pool)
    .await?;

    // Befüllen in EINER Transaktion: einige hunderttausend Einzel-Inserts sind in SQLite
    // nur mit gemeinsamem Commit schnell (sonst ein fsync je Zeile).
    let mut tx = pool.begin().await?;
    for o in objekte {
        sqlx::query(
            "INSERT OR REPLACE INTO kritis_objekt_neu \
             (osm_typ, osm_id, lon, lat, kategorie, properties_json) VALUES (?, ?, ?, ?, ?, ?)",
        )
        .bind(o.osm_typ)
        .bind(o.osm_id)
        .bind(o.lon)
        .bind(o.lat)
        .bind(&o.kategorie)
        .bind(o.properties.to_string())
        .execute(&mut *tx)
        .await?;
    }
    tx.commit().await?;

    // Sammelpunkte je Stufe der Rasterleiter vorberechnen (LFH-83, Aufgabe 3.2): zur
    // Abfragezeit gerechnet kostete die Deutschland-Ansicht über 400 000 Objekte gemessen
    // 384 ms im Release-Build. Die Zellformel ist dieselbe wie in `zelle()`.
    sqlx::query("DROP TABLE IF EXISTS kritis_zelle_neu")
        .execute(pool)
        .await?;
    sqlx::query(
        "CREATE TABLE kritis_zelle_neu (\
             weite  REAL    NOT NULL, \
             x      INTEGER NOT NULL, \
             y      INTEGER NOT NULL, \
             anzahl INTEGER NOT NULL, \
             lon    REAL    NOT NULL, \
             lat    REAL    NOT NULL, \
             PRIMARY KEY (weite, x, y))",
    )
    .execute(pool)
    .await?;
    let mut tx = pool.begin().await?;
    for w in RASTER_LEITER {
        sqlx::query(
            "INSERT INTO kritis_zelle_neu (weite, x, y, anzahl, lon, lat) \
             SELECT ?1, CAST(lon / ?1 + 100000.0 AS INTEGER) AS x, \
                    CAST(lat / ?1 + 100000.0 AS INTEGER) AS y, COUNT(*), AVG(lon), AVG(lat) \
             FROM kritis_objekt_neu GROUP BY x, y",
        )
        .bind(w)
        .execute(&mut *tx)
        .await?;
    }
    tx.commit().await?;

    let mut tx = pool.begin().await?;
    sqlx::query("DROP TABLE IF EXISTS kritis_objekt")
        .execute(&mut *tx)
        .await?;
    sqlx::query("ALTER TABLE kritis_objekt_neu RENAME TO kritis_objekt")
        .execute(&mut *tx)
        .await?;
    sqlx::query("CREATE INDEX kritis_objekt_lon_lat ON kritis_objekt (lon, lat)")
        .execute(&mut *tx)
        .await?;
    sqlx::query("DROP TABLE IF EXISTS kritis_zelle")
        .execute(&mut *tx)
        .await?;
    sqlx::query("ALTER TABLE kritis_zelle_neu RENAME TO kritis_zelle")
        .execute(&mut *tx)
        .await?;
    sqlx::query(
        "INSERT OR REPLACE INTO kritis_import \
         (id, stand, quelle_url, last_modified, etag, importiert_at, anzahl) \
         VALUES (1, ?, ?, ?, ?, ?, ?)",
    )
    .bind(&meta.stand)
    .bind(&meta.quelle_url)
    .bind(&meta.last_modified)
    .bind(&meta.etag)
    .bind(meta.importiert_at)
    .bind(objekte.len() as i64)
    .execute(&mut *tx)
    .await?;
    tx.commit().await
}

/// Ein Lauf ohne neuen Extrakt: nur den Zeitpunkt fortschreiben, damit die Fälligkeit neu
/// beginnt. Der Bestand und sein `stand` bleiben unberührt.
pub async fn bestaetige_unveraendert(
    pool: &SqlitePool,
    importiert_at: i64,
) -> Result<(), sqlx::Error> {
    sqlx::query("UPDATE kritis_import SET importiert_at = ? WHERE id = 1")
        .bind(importiert_at)
        .execute(pool)
        .await
        .map(|_| ())
}

/// Kleinste Rasterweite, bei der höchstens [`MAX_FEATURES`] Zellen den Ausschnitt berühren.
fn rasterweite(b: &Bbox) -> f64 {
    for w in RASTER_LEITER {
        let spalten = zelle(b.ost, w) - zelle(b.west, w) + 1;
        let zeilen = zelle(b.nord, w) - zelle(b.sued, w) + 1;
        if spalten * zeilen <= MAX_FEATURES {
            return w;
        }
    }
    RASTER_LEITER[RASTER_LEITER.len() - 1]
}

/// Antwort der Route für einen Ausschnitt. DB-Fehler enden als `offline`, nie als 5xx.
pub async fn abfrage(pool: &SqlitePool, b: &Bbox) -> FachebeneAntwort {
    match abfrage_roh(pool, b).await {
        Ok(Some(a)) => a,
        Ok(None) => FachebeneAntwort::offline("kritis", KRITIS_ATTRIB),
        Err(e) => {
            tracing::warn!("KRITIS-Bestand: Abfrage fehlgeschlagen: {e}");
            FachebeneAntwort::offline("kritis", KRITIS_ATTRIB)
        }
    }
}

async fn abfrage_roh(pool: &SqlitePool, b: &Bbox) -> Result<Option<FachebeneAntwort>, sqlx::Error> {
    let Some(meta) = meta(pool).await else {
        return Ok(None);
    };
    // Gedeckelt gezählt: für die Entscheidung genügt „mehr als die Grenze", und ein volles
    // COUNT über ganz Deutschland liefe durch alle Indexeinträge der Längengrad-Spanne.
    let anzahl: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM (SELECT 1 FROM kritis_objekt \
         WHERE lon BETWEEN ? AND ? AND lat BETWEEN ? AND ? LIMIT 5001)",
    )
    .bind(b.west)
    .bind(b.ost)
    .bind(b.sued)
    .bind(b.nord)
    .fetch_one(pool)
    .await?;

    let features: Vec<Value> = if anzahl <= MAX_FEATURES {
        let rows: Vec<(f64, f64, String)> = sqlx::query_as(
            "SELECT lon, lat, properties_json FROM kritis_objekt \
             WHERE lon BETWEEN ? AND ? AND lat BETWEEN ? AND ? ORDER BY lon, lat",
        )
        .bind(b.west)
        .bind(b.ost)
        .bind(b.sued)
        .bind(b.nord)
        .fetch_all(pool)
        .await?;
        rows.into_iter()
            .map(|(lon, lat, p)| {
                let properties: Value = serde_json::from_str(&p).unwrap_or_else(|_| json!({}));
                json!({
                    "type": "Feature",
                    "geometry": { "type": "Point", "coordinates": [lon, lat] },
                    "properties": properties
                })
            })
            .collect()
    } else {
        sammelpunkte(pool, b).await?
    };

    Ok(Some(FachebeneAntwort::ok(
        "kritis",
        KRITIS_ATTRIB,
        Some(meta.stand),
        json!({ "type": "FeatureCollection", "features": features }),
    )))
}

/// Je berührter Rasterzelle ein Punkt (Mittel der Koordinaten) mit `anzahl`, aus den beim
/// Import vorberechneten Zellen (`kritis_zelle`, Schlüssel = exakter Leiterwert). Die Zelle
/// zählt immer ganz — sonst lieferten zwei überlappende Ausschnitte für dieselbe Zelle zwei
/// verschiedene Zahlen, und ein Bündel änderte beim Pannen seine Größe.
async fn sammelpunkte(pool: &SqlitePool, b: &Bbox) -> Result<Vec<Value>, sqlx::Error> {
    let w = rasterweite(b);
    let rows: Vec<(i64, f64, f64)> = sqlx::query_as(
        "SELECT anzahl, lon, lat FROM kritis_zelle \
         WHERE weite = ? AND x BETWEEN ? AND ? AND y BETWEEN ? AND ? ORDER BY x, y",
    )
    .bind(w)
    .bind(zelle(b.west, w))
    .bind(zelle(b.ost, w))
    .bind(zelle(b.sued, w))
    .bind(zelle(b.nord, w))
    .fetch_all(pool)
    .await?;
    Ok(rows
        .into_iter()
        .map(|(n, lon, lat)| {
            json!({
                "type": "Feature",
                "geometry": { "type": "Point", "coordinates": [lon, lat] },
                "properties": { "sammelpunkt": true, "anzahl": n }
            })
        })
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::karte::typen::FachebeneStatus;

    async fn pool() -> (tempfile::TempDir, SqlitePool) {
        let dir = tempfile::tempdir().unwrap();
        let p = crate::cache_db::cache_pool(dir.path()).await.unwrap();
        (dir, p)
    }

    fn objekt(id: i64, lon: f64, lat: f64) -> KritisObjekt {
        KritisObjekt {
            osm_typ: "node",
            osm_id: id,
            lon,
            lat,
            kategorie: "schule".into(),
            properties: json!({ "titel": format!("Schule {id}"), "kategorie": "schule" }),
        }
    }

    fn meta_mit(stand: &str) -> ImportMeta {
        ImportMeta {
            stand: stand.into(),
            quelle_url: "https://example.org/de.osm.pbf".into(),
            last_modified: Some("Mon, 21 Sep 2026 20:00:00 GMT".into()),
            etag: Some("\"abc\"".into()),
            importiert_at: 1_790_000_000,
            anzahl: 0,
        }
    }

    fn bbox(west: f64, sued: f64, ost: f64, nord: f64) -> Bbox {
        Bbox {
            west,
            sued,
            ost,
            nord,
        }
    }

    fn features(a: &FachebeneAntwort) -> &Vec<Value> {
        a.features["features"].as_array().unwrap()
    }

    /// 6 000 Objekte auf einem 0,001°-Gitter um Köln (75 × 80) — über der Grenze von 5 000.
    fn gitter() -> Vec<KritisObjekt> {
        (0..6_000)
            .map(|i| {
                objekt(
                    i,
                    6.9 + (i % 75) as f64 * 0.001,
                    50.9 + (i / 75) as f64 * 0.001,
                )
            })
            .collect()
    }

    #[tokio::test]
    async fn ohne_bestand_offline() {
        let (_d, p) = pool().await;
        let a = abfrage(&p, &bbox(6.0, 50.0, 7.0, 51.0)).await;
        assert_eq!(a.status, FachebeneStatus::Offline);
        assert!(features(&a).is_empty());
    }

    #[tokio::test]
    async fn tausch_zeigt_nur_den_neuen_bestand_und_traegt_meta() {
        let (_d, p) = pool().await;
        ersetze_bestand(
            &p,
            &[objekt(1, 6.95, 50.94)],
            &meta_mit("2026-09-01T00:00:00Z"),
        )
        .await
        .unwrap();
        ersetze_bestand(
            &p,
            &[objekt(2, 6.96, 50.95), objekt(3, 6.97, 50.96)],
            &meta_mit("2026-09-08T00:00:00Z"),
        )
        .await
        .unwrap();
        let a = abfrage(&p, &bbox(6.0, 50.0, 7.0, 51.0)).await;
        let titel: Vec<&str> = features(&a)
            .iter()
            .map(|f| f["properties"]["titel"].as_str().unwrap())
            .collect();
        assert_eq!(titel, vec!["Schule 2", "Schule 3"]);
        assert_eq!(a.status, FachebeneStatus::Ok);
        assert_eq!(a.stand.as_deref(), Some("2026-09-08T00:00:00Z"));
        assert_eq!(a.attribution, KRITIS_ATTRIB);
        let m = meta(&p).await.unwrap();
        assert_eq!(m.anzahl, 2, "anzahl zählt die geschriebenen Objekte");
        assert_eq!(m.etag.as_deref(), Some("\"abc\""));
    }

    /// Ein abgebrochener Lauf hinterlässt eine halbe Staging-Tabelle; der nächste darf darauf
    /// nicht aufbauen, und der Live-Bestand bleibt bis zum Tausch unberührt.
    #[tokio::test]
    async fn liegengebliebene_staging_tabelle_wird_verworfen() {
        let (_d, p) = pool().await;
        ersetze_bestand(&p, &[objekt(1, 6.95, 50.94)], &meta_mit("alt"))
            .await
            .unwrap();
        sqlx::query(
            "CREATE TABLE kritis_objekt_neu (osm_typ TEXT, osm_id INTEGER, lon REAL, lat REAL, \
             kategorie TEXT, properties_json TEXT, PRIMARY KEY (osm_typ, osm_id))",
        )
        .execute(&p)
        .await
        .unwrap();
        sqlx::query("INSERT INTO kritis_objekt_neu VALUES ('node', 99, 6.9, 50.9, 'x', '{}')")
            .execute(&p)
            .await
            .unwrap();
        // Bis zum nächsten Tausch sieht die Route den alten Bestand, nicht die Staging-Reste.
        let a = abfrage(&p, &bbox(6.0, 50.0, 7.0, 51.0)).await;
        assert_eq!(features(&a).len(), 1);

        ersetze_bestand(&p, &[objekt(2, 6.96, 50.95)], &meta_mit("neu"))
            .await
            .unwrap();
        let a = abfrage(&p, &bbox(6.0, 50.0, 7.0, 51.0)).await;
        assert_eq!(features(&a).len(), 1);
        assert_eq!(features(&a)[0]["properties"]["titel"], "Schule 2");
        let staging: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM sqlite_master WHERE name = 'kritis_objekt_neu'",
        )
        .fetch_one(&p)
        .await
        .unwrap();
        assert_eq!(staging, 0);
    }

    #[tokio::test]
    async fn unveraendert_schreibt_nur_den_zeitpunkt_fort() {
        let (_d, p) = pool().await;
        ersetze_bestand(&p, &[objekt(1, 6.95, 50.94)], &meta_mit("stand"))
            .await
            .unwrap();
        bestaetige_unveraendert(&p, 1_800_000_000).await.unwrap();
        let m = meta(&p).await.unwrap();
        assert_eq!(m.importiert_at, 1_800_000_000);
        assert_eq!(m.stand, "stand");
        assert_eq!(m.anzahl, 1);
    }

    #[tokio::test]
    async fn ausschnitt_ohne_objekte_ist_leer() {
        let (_d, p) = pool().await;
        ersetze_bestand(&p, &[objekt(1, 6.95, 50.94)], &meta_mit("s"))
            .await
            .unwrap();
        let a = abfrage(&p, &bbox(-3.0, 40.0, -2.0, 41.0)).await;
        assert_eq!(a.status, FachebeneStatus::Leer);
    }

    #[tokio::test]
    async fn bis_zur_grenze_nur_einzelobjekte() {
        let (_d, p) = pool().await;
        let objekte: Vec<_> = gitter().into_iter().take(MAX_FEATURES as usize).collect();
        ersetze_bestand(&p, &objekte, &meta_mit("s")).await.unwrap();
        let a = abfrage(&p, &bbox(6.0, 50.0, 8.0, 52.0)).await;
        assert_eq!(features(&a).len(), MAX_FEATURES as usize);
        assert!(features(&a)
            .iter()
            .all(|f| f["properties"].get("sammelpunkt").is_none()));
    }

    #[tokio::test]
    async fn ueber_der_grenze_sammelpunkte_mit_voller_summe() {
        let (_d, p) = pool().await;
        ersetze_bestand(&p, &gitter(), &meta_mit("s"))
            .await
            .unwrap();
        let a = abfrage(&p, &bbox(5.8, 47.2, 15.1, 55.1)).await; // ganz DE
        let f = features(&a);
        assert!(!f.is_empty() && f.len() <= MAX_FEATURES as usize);
        assert!(f.iter().all(|f| f["properties"]["sammelpunkt"] == true));
        let summe: i64 = f
            .iter()
            .map(|f| f["properties"]["anzahl"].as_i64().unwrap())
            .sum();
        assert_eq!(summe, 6_000);
        assert_eq!(a.status, FachebeneStatus::Ok);
    }

    /// Zwei überlappende Ausschnitte gleicher Rasterweite liefern für gemeinsame Zellen
    /// identische Sammelpunkte — auch für eine Zelle, die einer der beiden nur anschneidet.
    #[tokio::test]
    async fn ueberlappende_ausschnitte_teilen_sammelpunkte() {
        let (_d, p) = pool().await;
        // 12 000 Objekte (120 × 100 auf 0,001°) — auch der kleinere Ausschnitt b liegt mit
        // ~8 500 Objekten über der Grenze, beide werden also verdichtet.
        let gross: Vec<_> = (0..12_000)
            .map(|i| {
                objekt(
                    i,
                    6.9 + (i % 120) as f64 * 0.001,
                    50.9 + (i / 120) as f64 * 0.001,
                )
            })
            .collect();
        ersetze_bestand(&p, &gross, &meta_mit("s")).await.unwrap();
        let a = bbox(6.0, 50.0, 8.0, 52.0);
        let b = bbox(6.93, 50.905, 8.93, 52.905);
        assert_eq!(rasterweite(&a), rasterweite(&b));
        let fa = abfrage(&p, &a).await;
        let fb = abfrage(&p, &b).await;
        let gemeinsam: Vec<&Value> = features(&fa)
            .iter()
            .filter(|f| features(&fb).contains(f))
            .collect();
        assert!(!gemeinsam.is_empty(), "gemeinsame Zellen erwartet");
        assert!(features(&fb)
            .iter()
            .all(|f| f["properties"]["sammelpunkt"] == true));
        // Jede Zelle von b liegt im Gitter-Bereich auch in a → b ist Teilmenge von a.
        for f in features(&fb) {
            assert!(features(&fa).contains(f), "Sammelpunkt weicht ab: {f}");
        }
    }

    #[test]
    fn rasterweite_waechst_mit_dem_ausschnitt() {
        assert_eq!(rasterweite(&bbox(6.9, 50.9, 7.0, 51.0)), 0.01);
        let de = rasterweite(&bbox(5.8, 47.2, 15.1, 55.1));
        assert!(de > 0.1 && de <= 0.5, "DE-Weite {de}");
        assert!(rasterweite(&bbox(-180.0, -90.0, 180.0, 90.0)) <= 20.0);
    }

    /// LFH-265-Anker: die reale Form (Einzelobjekt UND Sammelpunkt) passt auf das Schema.
    #[tokio::test]
    async fn ausgabe_passt_auf_den_geojson_anker() {
        let (_d, p) = pool().await;
        ersetze_bestand(&p, &gitter(), &meta_mit("s"))
            .await
            .unwrap();
        for b in [bbox(6.9, 50.9, 6.91, 50.91), bbox(5.8, 47.2, 15.1, 55.1)] {
            let a = abfrage(&p, &b).await;
            serde_json::from_value::<crate::karte::typen::GeoJsonFeatureCollection>(
                a.features.clone(),
            )
            .expect("Anker beschreibt die reale KRITIS-Form");
        }
    }
    /// Messung (LFH-83, Aufgabe 3.2) — nicht Teil der Suite, weil sie Sekunden kostet und
    /// Zeiten keine Zusicherung sind. Aufruf:
    /// `cargo test --lib --release kritis::bestand::tests::messung_de -- --ignored --nocapture`
    #[tokio::test]
    #[ignore]
    async fn messung_de_ansicht() {
        let (_d, p) = pool().await;
        // 400 000 Objekte, pseudozufällig über DE (LCG, reproduzierbar).
        let mut z: u64 = 42;
        let mut zufall = || {
            z = z.wrapping_mul(6_364_136_223_846_793_005).wrapping_add(1);
            (z >> 11) as f64 / (1u64 << 53) as f64
        };
        let objekte: Vec<_> = (0..400_000)
            .map(|i| objekt(i, 5.9 + zufall() * 9.1, 47.3 + zufall() * 7.7))
            .collect();
        let t = std::time::Instant::now();
        ersetze_bestand(&p, &objekte, &meta_mit("s")).await.unwrap();
        println!("Tausch 400 000: {:?}", t.elapsed());
        for (name, b) in [
            ("DE", bbox(5.8, 47.2, 15.1, 55.1)),
            ("Land (NRW)", bbox(5.8, 50.3, 9.5, 52.6)),
            ("Region", bbox(6.5, 50.6, 7.5, 51.2)),
            ("Stadt", bbox(6.85, 50.88, 7.05, 50.98)),
        ] {
            let t = std::time::Instant::now();
            let a = abfrage(&p, &b).await;
            println!(
                "{name}: {:?}, {} Features, Weite {}",
                t.elapsed(),
                features(&a).len(),
                rasterweite(&b)
            );
        }
    }
}
