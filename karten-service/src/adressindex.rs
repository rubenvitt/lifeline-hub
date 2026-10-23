//! Offline-Adressindex einer Region (LLH-1119): liest die Adressen aus dem OSM-Extrakt, aus dem
//! auch die Karte gebaut wird, und schreibt sie als SQLite-Datei mit FTS5-Suche und R*-Baum.
//! Format und Normalisierung stehen in `karten_katalog::adressindex` (geteilt mit der Suche im Hub).
//!
//! Was hineinkommt:
//! - **Adressen:** Nodes und Ways mit `addr:housenumber` und `addr:street` oder `addr:place`. Punkt
//!   eines Ways ist die Mitte der Bounding-Box seiner Nodes (wie der KRITIS-Import des Hubs).
//!   Relations bleiben draußen (bei Adressen selten, und ihre Auflösung kostete einen Durchlauf).
//! - **Straßen:** aus den Adressen abgeleitet, je Straße, PLZ und Ort ein Eintrag an der Adresse
//!   nächst dem Schwerpunkt. Eine Straße ganz ohne Hausnummer fehlt: ihr Ort stünde nur über
//!   Verwaltungsgrenzen fest, und die löst der Bau nicht auf.
//! - **Orte:** `place=city|town|village|hamlet` (als Ort) und `place=suburb` (als Ortsteil) mit Namen.
//!
//! Zwei Durchläufe über das PBF: (1) Adress-Nodes, Orte und die Node-Referenzen der Adress-Ways,
//! (2) die Koordinaten dieser Nodes. Synchron und CPU-lastig, der Aufrufer nimmt `spawn_blocking`.

use karten_katalog::adressindex::{suchtext, ADRESSINDEX_FORMAT, ADRESSINDEX_SCHEMA};
use osmpbf::{Element, ElementReader};
use sqlx::sqlite::{SqliteConnectOptions, SqliteJournalMode, SqliteSynchronous};
use sqlx::{ConnectOptions, Connection};
use std::collections::{BTreeMap, HashMap, HashSet};
use std::path::Path;

/// Art einer Zeile, wie sie in `adressen.art` steht.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum Art {
    Adresse,
    Strasse,
    Ort,
}

impl Art {
    fn als_str(self) -> &'static str {
        match self {
            Art::Adresse => "adresse",
            Art::Strasse => "strasse",
            Art::Ort => "ort",
        }
    }
}

/// Eine Zeile des Index.
#[derive(Debug, Clone, PartialEq)]
pub struct Eintrag {
    pub art: Art,
    pub strasse: Option<String>,
    pub hausnummer: Option<String>,
    pub plz: Option<String>,
    pub ort: Option<String>,
    pub ortsteil: Option<String>,
    pub lat: f64,
    pub lon: f64,
}

/// Adressteile eines OSM-Objekts.
#[derive(Debug, Clone, Default)]
struct Teile {
    strasse: Option<String>,
    hausnummer: Option<String>,
    plz: Option<String>,
    ort: Option<String>,
    ortsteil: Option<String>,
}

/// Ort-Typen, die als Ort bzw. Ortsteil in den Index kommen.
const ORT_TYPEN: &[&str] = &["city", "town", "village", "hamlet"];
const ORTSTEIL_TYPEN: &[&str] = &["suburb"];

fn wert(v: &str) -> Option<String> {
    let v = v.trim();
    (!v.is_empty()).then(|| v.to_string())
}

/// Adressteile aus den Tags, `None` ohne Hausnummer oder ohne Straße und `addr:place`.
fn adresse_aus<'a>(tags: impl Iterator<Item = (&'a str, &'a str)>) -> Option<Teile> {
    let mut t = Teile::default();
    let mut place = None;
    let mut hamlet = None;
    for (k, v) in tags {
        match k {
            "addr:street" => t.strasse = wert(v),
            "addr:place" => place = wert(v),
            "addr:housenumber" => t.hausnummer = wert(v),
            "addr:postcode" => t.plz = wert(v),
            "addr:city" => t.ort = wert(v),
            "addr:suburb" => t.ortsteil = wert(v),
            "addr:hamlet" => hamlet = wert(v),
            _ => {}
        }
    }
    t.hausnummer.as_ref()?;
    if t.strasse.is_none() {
        t.strasse = place;
    }
    t.strasse.as_ref()?;
    if t.ortsteil.is_none() {
        t.ortsteil = hamlet;
    }
    Some(t)
}

/// Ort oder Ortsteil aus den Tags eines Nodes.
fn ort_aus<'a>(
    tags: impl Iterator<Item = (&'a str, &'a str)>,
    lat: f64,
    lon: f64,
) -> Option<Eintrag> {
    let (mut typ, mut name) = (None, None);
    for (k, v) in tags {
        match k {
            "place" => typ = Some(v),
            "name" => name = wert(v),
            _ => {}
        }
    }
    let (typ, name) = (typ?, name?);
    let (lat, lon) = (grad7(lat), grad7(lon));
    let (ort, ortsteil) = if ORT_TYPEN.contains(&typ) {
        (Some(name), None)
    } else if ORTSTEIL_TYPEN.contains(&typ) {
        (None, Some(name))
    } else {
        return None;
    };
    Some(Eintrag {
        art: Art::Ort,
        strasse: None,
        hausnummer: None,
        plz: None,
        ort,
        ortsteil,
        lat,
        lon,
    })
}

/// Auf 1e-7 Grad gerundet, die Genauigkeit des PBF (osmpbf liefert sonst etwa 52.620000000000005).
fn grad7(x: f64) -> f64 {
    (x * 1e7).round() / 1e7
}

fn adress_eintrag(t: Teile, lat: f64, lon: f64) -> Eintrag {
    let (lat, lon) = (grad7(lat), grad7(lon));
    Eintrag {
        art: Art::Adresse,
        strasse: t.strasse,
        hausnummer: t.hausnummer,
        plz: t.plz,
        ort: t.ort,
        ortsteil: t.ortsteil,
        lat,
        lon,
    }
}

/// Ein Adress-Way, dessen Punkt erst nach Durchlauf 2 feststeht.
struct OffenerWay {
    teile: Teile,
    nodes: Vec<i64>,
}

#[derive(Default)]
struct Durchlauf1 {
    fertig: Vec<Eintrag>,
    offen: Vec<OffenerWay>,
}

impl Durchlauf1 {
    fn vereine(mut self, mut b: Durchlauf1) -> Durchlauf1 {
        self.fertig.append(&mut b.fertig);
        self.offen.append(&mut b.offen);
        self
    }

    fn node<'a>(
        &mut self,
        tags: impl Iterator<Item = (&'a str, &'a str)> + Clone,
        lat: f64,
        lon: f64,
    ) {
        if let Some(t) = adresse_aus(tags.clone()) {
            self.fertig.push(adress_eintrag(t, lat, lon));
        } else if let Some(o) = ort_aus(tags, lat, lon) {
            self.fertig.push(o);
        }
    }
}

/// Koordinate in 1e-7 Grad: so genau wie das PBF und halb so groß wie zwei `f64` (die Node-Tabelle
/// der Adress-Ways ist der größte Speicherposten des Baus).
type Festpunkt = (i32, i32);

fn festpunkt(lat: f64, lon: f64) -> Festpunkt {
    ((lat * 1e7).round() as i32, (lon * 1e7).round() as i32)
}

/// Liest alle Einträge aus `pbf`, sortiert (stabile Ids im Index).
pub fn lies_eintraege(pbf: &Path) -> Result<Vec<Eintrag>, osmpbf::Error> {
    let d1 = ElementReader::from_path(pbf)?.par_map_reduce(
        |el| {
            let mut d = Durchlauf1::default();
            match el {
                Element::Node(n) => d.node(n.tags(), n.lat(), n.lon()),
                Element::DenseNode(n) => d.node(n.tags(), n.lat(), n.lon()),
                Element::Way(w) => {
                    if let Some(teile) = adresse_aus(w.tags()) {
                        d.offen.push(OffenerWay {
                            teile,
                            nodes: w.refs().collect(),
                        });
                    }
                }
                Element::Relation(_) => {}
            }
            d
        },
        Durchlauf1::default,
        Durchlauf1::vereine,
    )?;
    let Durchlauf1 { mut fertig, offen } = d1;

    let gesucht: HashSet<i64> = offen.iter().flat_map(|w| w.nodes.iter().copied()).collect();
    let koordinaten: HashMap<i64, Festpunkt> = if gesucht.is_empty() {
        HashMap::new()
    } else {
        ElementReader::from_path(pbf)?.par_map_reduce(
            |el| {
                let (id, lat, lon) = match el {
                    Element::Node(n) => (n.id(), n.lat(), n.lon()),
                    Element::DenseNode(n) => (n.id(), n.lat(), n.lon()),
                    _ => return HashMap::new(),
                };
                if gesucht.contains(&id) {
                    HashMap::from([(id, festpunkt(lat, lon))])
                } else {
                    HashMap::new()
                }
            },
            HashMap::new,
            |mut a, b| {
                a.extend(b);
                a
            },
        )?
    };

    for w in offen {
        let mut bbox: Option<(i32, i32, i32, i32)> = None;
        for id in &w.nodes {
            if let Some(&(lat, lon)) = koordinaten.get(id) {
                bbox = Some(match bbox {
                    None => (lat, lon, lat, lon),
                    Some((s, west, n, o)) => (s.min(lat), west.min(lon), n.max(lat), o.max(lon)),
                });
            }
        }
        // Ohne auflösbare Koordinate kein Punkt — lieber weglassen als bei 0/0 finden.
        if let Some((s, west, n, o)) = bbox {
            let lat = (f64::from(s) + f64::from(n)) / 2.0 / 1e7;
            let lon = (f64::from(west) + f64::from(o)) / 2.0 / 1e7;
            fertig.push(adress_eintrag(w.teile, lat, lon));
        }
    }

    let strassen = leite_strassen_ab(&fertig);
    fertig.extend(strassen);
    fertig.sort_by(|a, b| {
        (
            a.art,
            &a.ort,
            &a.strasse,
            &a.hausnummer,
            &a.ortsteil,
            &a.plz,
        )
            .cmp(&(
                b.art,
                &b.ort,
                &b.strasse,
                &b.hausnummer,
                &b.ortsteil,
                &b.plz,
            ))
            .then(a.lat.total_cmp(&b.lat))
            .then(a.lon.total_cmp(&b.lon))
    });
    Ok(fertig)
}

/// Je Straße, PLZ und Ort ein Eintrag an der Adresse nächst dem Schwerpunkt der Adressen.
fn leite_strassen_ab(eintraege: &[Eintrag]) -> Vec<Eintrag> {
    type Schluessel<'a> = (&'a str, Option<&'a str>, Option<&'a str>);
    let mut gruppen: BTreeMap<Schluessel<'_>, Vec<&Eintrag>> = BTreeMap::new();
    for e in eintraege.iter().filter(|e| e.art == Art::Adresse) {
        if let Some(s) = e.strasse.as_deref() {
            gruppen
                .entry((s, e.plz.as_deref(), e.ort.as_deref()))
                .or_default()
                .push(e);
        }
    }
    gruppen
        .into_iter()
        .filter_map(|((strasse, plz, ort), adressen)| {
            let n = adressen.len() as f64;
            let lat = adressen.iter().map(|a| a.lat).sum::<f64>() / n;
            let lon = adressen.iter().map(|a| a.lon).sum::<f64>() / n;
            let mitte = adressen.iter().min_by(|a, b| {
                let da = (a.lat - lat).powi(2) + (a.lon - lon).powi(2);
                let db = (b.lat - lat).powi(2) + (b.lon - lon).powi(2);
                da.total_cmp(&db)
            })?;
            Some(Eintrag {
                art: Art::Strasse,
                strasse: Some(strasse.to_string()),
                hausnummer: None,
                plz: plz.map(str::to_string),
                ort: ort.map(str::to_string),
                ortsteil: mitte.ortsteil.clone(),
                lat: mitte.lat,
                lon: mitte.lon,
            })
        })
        .collect()
}

/// Schreibt `eintraege` als neuen Index nach `ziel` (eine vorhandene Datei wird ersetzt).
pub async fn schreibe_index(
    eintraege: &[Eintrag],
    ziel: &Path,
    quelle: &str,
) -> anyhow::Result<()> {
    match tokio::fs::remove_file(ziel).await {
        Ok(()) => {}
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
        Err(e) => return Err(e.into()),
    }
    // Ohne Journal und ohne fsync je Commit: die Datei entsteht in einem Zug und wird erst nach dem
    // Bau hochgeladen; ein Abbruch lässt nur einen Rest, den der nächste Bau ersetzt.
    let mut conn = SqliteConnectOptions::new()
        .filename(ziel)
        .create_if_missing(true)
        .journal_mode(SqliteJournalMode::Off)
        .synchronous(SqliteSynchronous::Off)
        .connect()
        .await?;
    sqlx::raw_sql(ADRESSINDEX_SCHEMA).execute(&mut conn).await?;

    let mut tx = conn.begin().await?;
    for (i, e) in eintraege.iter().enumerate() {
        let id = i as i64 + 1;
        sqlx::query(
            "INSERT INTO adressen (id, art, strasse, hausnummer, plz, ort, ortsteil, lat, lon) \
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(id)
        .bind(e.art.als_str())
        .bind(&e.strasse)
        .bind(&e.hausnummer)
        .bind(&e.plz)
        .bind(&e.ort)
        .bind(&e.ortsteil)
        .bind(e.lat)
        .bind(e.lon)
        .execute(&mut *tx)
        .await?;
        let text = suchtext(&[
            e.strasse.as_deref(),
            e.hausnummer.as_deref(),
            e.plz.as_deref(),
            e.ort.as_deref(),
            e.ortsteil.as_deref(),
        ]);
        sqlx::query("INSERT INTO adressen_fts (rowid, suchtext) VALUES (?, ?)")
            .bind(id)
            .bind(text)
            .execute(&mut *tx)
            .await?;
        if e.art == Art::Adresse {
            sqlx::query(
                "INSERT INTO adressen_rtree (id, min_lat, max_lat, min_lon, max_lon) \
                 VALUES (?, ?, ?, ?, ?)",
            )
            .bind(id)
            .bind(e.lat)
            .bind(e.lat)
            .bind(e.lon)
            .bind(e.lon)
            .execute(&mut *tx)
            .await?;
        }
    }
    let adressen = eintraege.iter().filter(|e| e.art == Art::Adresse).count();
    for (name, value) in [
        ("format", ADRESSINDEX_FORMAT.to_string()),
        ("quelle", quelle.to_string()),
        ("anzahl_adressen", adressen.to_string()),
        ("lizenz", "© OpenStreetMap contributors (ODbL)".to_string()),
    ] {
        sqlx::query("INSERT INTO meta (name, value) VALUES (?, ?)")
            .bind(name)
            .bind(value)
            .execute(&mut *tx)
            .await?;
    }
    tx.commit().await?;
    sqlx::query("INSERT INTO adressen_fts (adressen_fts) VALUES ('optimize')")
        .execute(&mut conn)
        .await?;
    sqlx::query("VACUUM").execute(&mut conn).await?;
    conn.close().await?;
    Ok(())
}

/// Baut den Index aus `pbf` nach `ziel`. Liefert die Zahl der Adressen.
pub async fn baue_adressindex(pbf: &Path, ziel: &Path) -> anyhow::Result<usize> {
    let quelle = pbf
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("osm.pbf")
        .to_string();
    let p = pbf.to_path_buf();
    let eintraege = tokio::task::spawn_blocking(move || lies_eintraege(&p)).await??;
    schreibe_index(&eintraege, ziel, &quelle).await?;
    Ok(eintraege.iter().filter(|e| e.art == Art::Adresse).count())
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::Row;

    fn fixture_pbf() -> std::path::PathBuf {
        Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../tests/fixtures/adressindex/testgebiet.osm.pbf")
    }

    fn nahe(a: f64, b: f64) -> bool {
        (a - b).abs() < 1e-6
    }

    fn adressen(e: &[Eintrag]) -> Vec<(String, String, String)> {
        e.iter()
            .filter(|e| e.art == Art::Adresse)
            .map(|e| {
                (
                    e.strasse.clone().unwrap_or_default(),
                    e.hausnummer.clone().unwrap_or_default(),
                    e.ort.clone().unwrap_or_default(),
                )
            })
            .collect()
    }

    #[test]
    fn liest_adress_nodes_und_ways_ohne_relation_und_unvollstaendige() {
        let e = lies_eintraege(&fixture_pbf()).unwrap();
        let mut a = adressen(&e);
        a.sort();
        let erwartet: Vec<(String, String, String)> = [
            ("Bahnhofstraße", "1", "Musterstadt"),
            ("Hauptstraße", "12", "Musterstadt"),
            ("Hauptstraße", "12", "Nachbardorf"),
            ("Hauptstraße", "13", "Musterstadt"),
            ("Hauptstraße", "14", "Musterstadt"),
            ("Siedlung Waldfrieden", "3", "Musterstadt"),
        ]
        .iter()
        .map(|(s, n, o)| (s.to_string(), n.to_string(), o.to_string()))
        .collect();
        assert_eq!(a, erwartet);
    }

    #[test]
    fn way_punkt_ist_bbox_mitte() {
        let e = lies_eintraege(&fixture_pbf()).unwrap();
        let w = e
            .iter()
            .find(|e| e.hausnummer.as_deref() == Some("13"))
            .unwrap();
        assert!(
            nahe(w.lat, 52.6204) && nahe(w.lon, 13.7803),
            "{} {}",
            w.lat,
            w.lon
        );
        assert_eq!(w.plz.as_deref(), Some("12345"));
    }

    #[test]
    fn ortsteil_aus_addr_suburb() {
        let e = lies_eintraege(&fixture_pbf()).unwrap();
        let b = e
            .iter()
            .find(|e| e.strasse.as_deref() == Some("Bahnhofstraße") && e.art == Art::Adresse)
            .unwrap();
        assert_eq!(b.ortsteil.as_deref(), Some("Altstadt"));
    }

    #[test]
    fn strassen_je_ort_an_der_adresse_naechst_dem_schwerpunkt() {
        let e = lies_eintraege(&fixture_pbf()).unwrap();
        let s: Vec<_> = e.iter().filter(|e| e.art == Art::Strasse).collect();
        let namen: Vec<(&str, &str)> = s
            .iter()
            .map(|e| (e.strasse.as_deref().unwrap(), e.ort.as_deref().unwrap()))
            .collect();
        assert_eq!(
            namen,
            [
                ("Bahnhofstraße", "Musterstadt"),
                ("Hauptstraße", "Musterstadt"),
                ("Siedlung Waldfrieden", "Musterstadt"),
                ("Hauptstraße", "Nachbardorf"),
            ]
        );
        // Hauptstraße in Musterstadt: Nr. 12, 13, 14; der Schwerpunkt liegt Nr. 13 am nächsten.
        let haupt = s
            .iter()
            .find(|e| {
                e.strasse.as_deref() == Some("Hauptstraße")
                    && e.ort.as_deref() == Some("Musterstadt")
            })
            .unwrap();
        assert!(
            nahe(haupt.lat, 52.6204) && nahe(haupt.lon, 13.7803),
            "{} {}",
            haupt.lat,
            haupt.lon
        );
        assert_eq!(haupt.hausnummer, None);
    }

    #[test]
    fn orte_nur_mit_namen_und_bekanntem_typ() {
        let e = lies_eintraege(&fixture_pbf()).unwrap();
        let orte: Vec<&str> = e
            .iter()
            .filter(|e| e.art == Art::Ort)
            .map(|e| e.ort.as_deref().or(e.ortsteil.as_deref()).unwrap())
            .collect();
        assert_eq!(orte, ["Musterstadt", "Nachbardorf"]);
    }

    #[test]
    fn fehlende_datei_ist_fehler() {
        assert!(lies_eintraege(Path::new("/gibt/es/nicht.osm.pbf")).is_err());
    }

    #[tokio::test]
    async fn index_findet_per_fts_und_rtree() {
        let dir = tempfile::tempdir().unwrap();
        let ziel = dir.path().join("testgebiet.adressen.sqlite");
        let n = baue_adressindex(&fixture_pbf(), &ziel).await.unwrap();
        assert_eq!(n, 6);
        let mut c = SqliteConnectOptions::new()
            .filename(&ziel)
            .read_only(true)
            .connect()
            .await
            .unwrap();
        let format: String = sqlx::query_scalar("SELECT value FROM meta WHERE name = 'format'")
            .fetch_one(&mut c)
            .await
            .unwrap();
        assert_eq!(format, ADRESSINDEX_FORMAT);
        // „Hauptstrasse“ (ss) und Präfix „musterst“ finden die Hausnummer 12 in Musterstadt; die
        // Nummer genau, als Präfix fände „12“ jede Adresse mit PLZ 12345.
        let rows = sqlx::query(
            "SELECT a.strasse, a.hausnummer, a.ort FROM adressen_fts f \
             JOIN adressen a ON a.id = f.rowid \
             WHERE adressen_fts MATCH ? AND a.art = 'adresse'",
        )
        .bind("\"hauptstrasse\"* AND \"12\" AND \"musterst\"*")
        .fetch_all(&mut c)
        .await
        .unwrap();
        let treffer: Vec<(String, String, String)> = rows
            .iter()
            .map(|r| (r.get(0), r.get(1), r.get(2)))
            .collect();
        assert_eq!(
            treffer,
            [("Hauptstraße".into(), "12".into(), "Musterstadt".into())]
        );
        // R*-Baum: nur Adressen.
        let im_baum: i64 = sqlx::query_scalar("SELECT count(*) FROM adressen_rtree")
            .fetch_one(&mut c)
            .await
            .unwrap();
        assert_eq!(im_baum, 6);
    }

    async fn zeilen(pfad: &Path) -> Vec<String> {
        let mut c = SqliteConnectOptions::new()
            .filename(pfad)
            .read_only(true)
            .connect()
            .await
            .unwrap();
        let mut z: Vec<String> = sqlx::query(
            "SELECT id, art, strasse, hausnummer, plz, ort, ortsteil, lat, lon FROM adressen ORDER BY id",
        )
        .fetch_all(&mut c)
        .await
        .unwrap()
        .iter()
        .map(|r| {
            format!(
                "{}|{}|{:?}|{:?}|{:?}|{:?}|{:?}|{:.7}|{:.7}",
                r.get::<i64, _>(0),
                r.get::<String, _>(1),
                r.get::<Option<String>, _>(2),
                r.get::<Option<String>, _>(3),
                r.get::<Option<String>, _>(4),
                r.get::<Option<String>, _>(5),
                r.get::<Option<String>, _>(6),
                r.get::<f64, _>(7),
                r.get::<f64, _>(8),
            )
        })
        .collect();
        let meta: Vec<String> = sqlx::query("SELECT name || '=' || value FROM meta ORDER BY name")
            .fetch_all(&mut c)
            .await
            .unwrap()
            .iter()
            .map(|r| r.get(0))
            .collect();
        z.extend(meta);
        z
    }

    /// Der eingecheckte Fixture-Index (Hub-Tests, e2e) ist genau das, was der Bau aus dem
    /// Fixture-Extrakt macht. Neu erzeugen: `karten-service adressindex --pbf
    /// tests/fixtures/adressindex/testgebiet.osm.pbf --out tests/fixtures/adressindex/testgebiet.adressen.sqlite`.
    #[tokio::test]
    async fn eingecheckter_fixture_index_ist_aktuell() {
        let dir = tempfile::tempdir().unwrap();
        let ziel = dir.path().join("testgebiet.adressen.sqlite");
        baue_adressindex(&fixture_pbf(), &ziel).await.unwrap();
        let eingecheckt = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../tests/fixtures/adressindex/testgebiet.adressen.sqlite");
        assert_eq!(zeilen(&eingecheckt).await, zeilen(&ziel).await);
    }

    #[tokio::test]
    async fn vorhandene_datei_wird_ersetzt() {
        let dir = tempfile::tempdir().unwrap();
        let ziel = dir.path().join("x.adressen.sqlite");
        std::fs::write(&ziel, b"kein sqlite").unwrap();
        baue_adressindex(&fixture_pbf(), &ziel).await.unwrap();
        let mut c = SqliteConnectOptions::new()
            .filename(&ziel)
            .read_only(true)
            .connect()
            .await
            .unwrap();
        let n: i64 = sqlx::query_scalar("SELECT count(*) FROM adressen")
            .fetch_one(&mut c)
            .await
            .unwrap();
        // 6 Adressen + 4 Straßen + 2 Orte.
        assert_eq!(n, 12);
    }
}
