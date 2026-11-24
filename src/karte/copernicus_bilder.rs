//! Copernicus-Satellitenbilder als Kachelebene (LLH-2021): die Liste der Bilder im Ausschnitt
//! und die Kacheln je Bild. Die Auswahl teilt sich die Kette der Vektorebene
//! ([`copernicus::select_im_ausschnitt`]); gezeigt werden nur die Bilder der dort gewählten
//! Produkte. Das COG selbst liest `cog.rs`; hier stehen Abruf, Cache und SSRF-Grenze: Geladen
//! wird nur `EBENEN_BASIS + pfad` eines geprüften Pfads aus den Details, die Kachelroute nimmt
//! nur die Kennung. Entwurf:
//! `docs/superpowers/specs/2026-11-24-h11vkn1p-copernicus-cog-rasterbilder-design.md`.

use crate::karte::cog::{self, Kopf, KopfErgebnis};
use crate::karte::copernicus::{
    self, bild_kennung, Auswahl, Gebaut, COPERNICUS_ATTRIB, EBENEN_BASIS, PARALLEL,
};
use crate::karte::tile_cache::{self, TileCache};
use crate::karte::typen::{Bbox, FachebeneAntwort};
use chrono::NaiveDateTime;
use futures::stream::{self, StreamExt};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sqlx::SqlitePool;
use std::future::Future;

/// Name der Quelle im Umschlag.
pub(crate) const QUELLE: &str = "copernicus_bilder";
/// Höchstzahl Bilder je Antwort.
pub(crate) const MAX_BILDER: usize = 20;

/// Was der Kachel-Cache je Bild hält: der Pfad und der gelesene Kopf.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub(crate) struct KopfEintrag {
    pub pfad: String,
    pub kopf: Kopf,
}

pub(crate) fn kopf_schluessel(kennung: &str) -> String {
    format!("cog-kopf:{kennung}")
}

/// Liest den Kopf-Eintrag eines Bildes aus dem Kachel-Cache.
pub(crate) async fn lies_kopf_eintrag(cache: &TileCache, kennung: &str) -> Option<KopfEintrag> {
    let (bytes, _) = tile_cache::lies_eintrag(cache, &kopf_schluessel(kennung)).await?;
    serde_json::from_slice(&bytes).ok()
}

/// Kopf eines Bildes: aus dem Kachel-Cache, sonst per Range-Abruf (erst
/// [`cog::KOPF_ERSTER_ABRUF`], dann so viel, wie der Leser verlangt, höchstens
/// [`cog::KOPF_RUNDEN`] Mal) und dann abgelegt. `hole_bereich(url, start, laenge)`.
pub(crate) async fn load_kopf<R, RFut>(
    cache: &TileCache,
    hole_bereich: &R,
    pfad: &str,
) -> Result<Kopf, String>
where
    R: Fn(String, u64, u64) -> RFut,
    RFut: Future<Output = Result<Vec<u8>, String>>,
{
    let kennung = bild_kennung(pfad);
    if let Some(e) = lies_kopf_eintrag(cache, &kennung).await {
        if e.pfad == pfad {
            return Ok(e.kopf);
        }
    }
    let url = format!("{EBENEN_BASIS}{pfad}");
    let mut laenge = cog::KOPF_ERSTER_ABRUF;
    for _ in 0..cog::KOPF_RUNDEN {
        let bytes = hole_bereich(url.clone(), 0, laenge).await?;
        match cog::parse_kopf(&bytes).map_err(|e| e.to_string())? {
            KopfErgebnis::Fertig(kopf) => {
                let eintrag = KopfEintrag {
                    pfad: pfad.to_string(),
                    kopf: kopf.clone(),
                };
                if let Ok(json) = serde_json::to_vec(&eintrag) {
                    tile_cache::schreibe_eintrag(
                        cache,
                        &kopf_schluessel(&kennung),
                        &json,
                        "application/json",
                    )
                    .await;
                }
                return Ok(kopf);
            }
            // Die Datei ist kürzer, als der Kopf verlangt: kaputt, nicht nachladen.
            KopfErgebnis::BrauchtBytes(n) if n <= bytes.len() as u64 => {
                return Err(format!("COG-Kopf von {pfad} unvollständig"));
            }
            KopfErgebnis::BrauchtBytes(n) => laenge = n,
        }
    }
    Err(format!(
        "COG-Kopf von {pfad} nach {} Runden nicht fertig",
        cog::KOPF_RUNDEN
    ))
}

/// Ein Bild der Liste mit seiner Herkunft.
struct Kandidat {
    details: usize,
    gebiet: usize,
    produkt: copernicus::Produkt,
    bild: copernicus::Bild,
}

/// Baut die Bilderliste für einen Ausschnitt: je Bild der gewählten Produkte ein Feature mit dem
/// Bildumriss und den Angaben für Rasterquelle und Ebenenzeile. `None` wie bei der Vektorebene
/// (Liste fehlt, keine Details): dann ist die Ebene `offline`.
#[allow(clippy::too_many_arguments)]
pub(crate) async fn build_bilder_antwort<H, Fut, R, RFut>(
    pool: &SqlitePool,
    cache: &TileCache,
    fetch: H,
    hole_bereich: R,
    bbox: Bbox,
    archiv: bool,
    jetzt: NaiveDateTime,
    max_bilder: usize,
) -> Option<Gebaut>
where
    H: Fn(String) -> Fut + Send + Sync,
    Fut: Future<Output = Result<Value, String>> + Send,
    R: Fn(String, u64, u64) -> RFut,
    RFut: Future<Output = Result<Vec<u8>, String>>,
{
    let Auswahl {
        details,
        gebiete,
        mut vollstaendig,
    } = copernicus::select_im_ausschnitt(pool, &fetch, &bbox, archiv, jetzt).await?;

    let mut kandidaten = Vec::new();
    let mut gekuerzt = false;
    for (di, gi, produkte) in &gebiete {
        for p in produkte {
            for b in &p.bilder {
                if kandidaten.len() < max_bilder {
                    kandidaten.push(Kandidat {
                        details: *di,
                        gebiet: *gi,
                        produkt: p.clone(),
                        bild: b.clone(),
                    });
                } else {
                    gekuerzt = true;
                }
            }
        }
    }

    let hole_bereich = &hole_bereich;
    let koepfe: Vec<Result<Kopf, String>> = stream::iter(&kandidaten)
        .map(|k| load_kopf(cache, hole_bereich, &k.bild.pfad))
        .buffered(PARALLEL)
        .collect()
        .await;

    let mut features = Vec::new();
    let mut stand: Option<String> = None;
    for (k, kopf) in kandidaten.iter().zip(koepfe) {
        let kopf = match kopf {
            Ok(kopf) => kopf,
            Err(e) => {
                tracing::warn!("Copernicus: {e}");
                vollstaendig = false;
                continue;
            }
        };
        let d = &details[k.details];
        let g = &d.gebiete[k.gebiet];
        features.push(bild_feature(d, g, &k.produkt, &k.bild, &kopf, gekuerzt));
        if k.bild.aufnahme > stand {
            stand = k.bild.aufnahme.clone();
        }
    }
    // Jüngste Aufnahme zuerst; die Karte legt sie zuoberst.
    features.sort_by(|a, b| {
        let zeit = |f: &Value| f["properties"]["aufnahme"].as_str().map(str::to_string);
        zeit(b).cmp(&zeit(a))
    });
    Some(Gebaut {
        antwort: FachebeneAntwort::ok(
            QUELLE,
            COPERNICUS_ATTRIB,
            stand,
            json!({ "type": "FeatureCollection", "features": features }),
        ),
        vollstaendig,
    })
}

/// Feature eines Bildes. Ohne darstellbaren Kopf steht als Umriss die Hülle des Gebiets.
fn bild_feature(
    d: &copernicus::Details,
    g: &copernicus::Gebiet,
    p: &copernicus::Produkt,
    b: &copernicus::Bild,
    kopf: &Kopf,
    gekuerzt: bool,
) -> Value {
    let darstellbar = kopf.nicht_darstellbar.is_none() && !kopf.stufen.is_empty();
    let [w, s, o, n] = if darstellbar {
        cog::bounds_wgs84(kopf)
    } else {
        [g.huelle.west, g.huelle.sued, g.huelle.ost, g.huelle.nord]
    };
    let (min_zoom, max_zoom) = if darstellbar {
        cog::zoom_grenzen(kopf)
    } else {
        (0, 0)
    };
    let mut props = serde_json::Map::new();
    props.insert("bild".into(), bild_kennung(&b.pfad).into());
    props.insert("emsr".into(), d.code.clone().into());
    props.insert("aktivierung".into(), d.name.clone().into());
    props.insert("gebiet".into(), g.name.clone().into());
    props.insert("produkt".into(), p.typ.clone().into());
    props.insert("monitoring".into(), p.monitoring.into());
    props.insert("version".into(), p.version.into());
    for (k, v) in [("sensor", &b.sensor), ("aufnahme", &b.aufnahme)] {
        if let Some(v) = v {
            props.insert(k.into(), v.clone().into());
        }
    }
    props.insert("min_zoom".into(), min_zoom.into());
    props.insert("max_zoom".into(), max_zoom.into());
    props.insert("bounds".into(), json!([w, s, o, n]));
    props.insert("darstellbar".into(), darstellbar.into());
    if let Some(grund) = &kopf.nicht_darstellbar {
        props.insert("grund".into(), grund.clone().into());
    }
    props.insert("gekuerzt".into(), gekuerzt.into());
    json!({
        "type": "Feature",
        "geometry": {
            "type": "Polygon",
            "coordinates": [[[w, s], [o, s], [o, n], [w, n], [w, s]]],
        },
        "properties": props,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::karte::copernicus::tests::{heute, Quelle};
    use crate::karte::typen::FachebeneStatus;
    use std::sync::{Arc, Mutex};

    const ANFANG: &[u8] = include_bytes!("testdaten/copernicus-cog-anfang.bin");
    const EMSR728: &str = include_str!("testdaten/copernicus-emsr728.json");
    const BOGEN_BILD: &str =
        "EMSR728/AOI09/GRA_PRODUCT/EMSR728_AOI09_GRA_PRODUCT_PLEIADES_20240610_1013_ORTHO.tif";

    fn bogen() -> Bbox {
        Bbox::parse("12.5,48.8,12.8,49.0").unwrap()
    }

    /// Stub für Range-Abrufe: liefert für jede URL einen Ausschnitt des echten Kopfes, außer für
    /// URLs mit einem Teil aus `fehlt`. Zählt die Aufrufe.
    #[derive(Clone, Default)]
    struct S3 {
        aufrufe: Arc<Mutex<Vec<String>>>,
        fehlt: Arc<Mutex<Vec<String>>>,
    }

    impl S3 {
        fn hole(&self) -> impl Fn(String, u64, u64) -> std::future::Ready<Result<Vec<u8>, String>> {
            let s = self.clone();
            move |url: String, start: u64, laenge: u64| {
                s.aufrufe.lock().unwrap().push(url.clone());
                if s.fehlt.lock().unwrap().iter().any(|f| url.contains(f)) {
                    return std::future::ready(Err("HTTP 503".into()));
                }
                let a = (start as usize).min(ANFANG.len());
                let e = (start + laenge).min(ANFANG.len() as u64) as usize;
                std::future::ready(Ok(ANFANG[a..e].to_vec()))
            }
        }
        fn anzahl(&self) -> usize {
            self.aufrufe.lock().unwrap().len()
        }
    }

    /// Quelle mit Details für alle Kandidaten: EMSR920 (fern, ohne Gebiete) ist sonst ohne
    /// Details, und jede Antwort wäre unvollständig.
    fn quelle() -> Quelle {
        let q = Quelle::default();
        q.ersetzt.lock().unwrap().insert(
            format!("{}EMSR920", copernicus::DETAIL_URL),
            json!({ "results": [{ "code": "EMSR920", "aois": [] }] }),
        );
        q
    }

    async fn baue(q: &Quelle, s3: &S3, cache: &TileCache, bbox: Bbox, max: usize) -> Gebaut {
        let pool = crate::db::test_pool().await;
        build_bilder_antwort(&pool, cache, q.fetch(), s3.hole(), bbox, true, heute(), max)
            .await
            .unwrap()
    }

    fn props(a: &FachebeneAntwort) -> Vec<serde_json::Map<String, Value>> {
        a.features["features"]
            .as_array()
            .unwrap()
            .iter()
            .map(|f| f["properties"].as_object().unwrap().clone())
            .collect()
    }

    #[tokio::test]
    async fn bilderliste_bogen() {
        let (q, s3, cache) = (quelle(), S3::default(), tile_cache::test_cache().await);
        let g = baue(&q, &s3, &cache, bogen(), MAX_BILDER).await;
        assert!(g.vollstaendig);
        let a = g.antwort;
        assert_eq!(a.quelle, QUELLE);
        assert_eq!(a.status, FachebeneStatus::Ok);
        assert_eq!(a.stand.as_deref(), Some("2024-06-10 10:13:00"));
        let p = props(&a);
        assert_eq!(p.len(), 1);
        let p = &p[0];
        assert_eq!(p["bild"], bild_kennung(BOGEN_BILD));
        assert_eq!(p["emsr"], "EMSR728");
        assert_eq!(p["gebiet"], "Bogen");
        assert_eq!(p["produkt"], "GRA");
        assert_eq!(p["sensor"], "Pleiades");
        assert_eq!(p["aufnahme"], "2024-06-10 10:13:00");
        assert_eq!(p["darstellbar"], true);
        assert_eq!(p["gekuerzt"], false);
        assert_eq!(
            (p["min_zoom"].as_u64(), p["max_zoom"].as_u64()),
            (Some(10), Some(16))
        );
        assert_eq!(p["bounds"].as_array().unwrap().len(), 4);
        let geo = &a.features["features"][0]["geometry"];
        assert_eq!(geo["type"], "Polygon");
        assert_eq!(geo["coordinates"][0][0][0], p["bounds"][0]);
        // Geholt wird nur der feste Host, und der Kopf liegt danach im Kachel-Cache.
        assert!(s3
            .aufrufe
            .lock()
            .unwrap()
            .iter()
            .all(|u| u == &format!("{EBENEN_BASIS}{BOGEN_BILD}")));
        let e = lies_kopf_eintrag(&cache, &bild_kennung(BOGEN_BILD))
            .await
            .unwrap();
        assert_eq!(e.pfad, BOGEN_BILD);
    }

    #[tokio::test]
    async fn stuttgart_hat_kein_bild_zum_gezeigten_produkt() {
        let (q, s3, cache) = (quelle(), S3::default(), tile_cache::test_cache().await);
        let stuttgart = Bbox::parse("9.10,48.70,9.40,48.90").unwrap();
        let a = baue(&q, &s3, &cache, stuttgart, MAX_BILDER).await.antwort;
        assert_eq!(a.status, FachebeneStatus::Leer);
        assert_eq!(s3.anzahl(), 0);
    }

    #[tokio::test]
    async fn bilderliste_leer_und_offline() {
        let (q, s3, cache) = (quelle(), S3::default(), tile_cache::test_cache().await);
        let nirgends = Bbox::parse("-30.0,60.0,-29.5,60.5").unwrap();
        let a = baue(&q, &s3, &cache, nirgends, MAX_BILDER).await.antwort;
        assert_eq!(a.status, FachebeneStatus::Leer);

        let q = Quelle::default();
        q.fehlt
            .lock()
            .unwrap()
            .push("public-activations-info".into());
        let pool = crate::db::test_pool().await;
        let ohne_liste = build_bilder_antwort(
            &pool,
            &cache,
            q.fetch(),
            s3.hole(),
            bogen(),
            true,
            heute(),
            20,
        )
        .await;
        assert!(ohne_liste.is_none());
    }

    #[tokio::test]
    async fn kopf_fehlt_macht_unvollstaendig() {
        let (q, s3, cache) = (quelle(), S3::default(), tile_cache::test_cache().await);
        s3.fehlt.lock().unwrap().push("AOI09".into());
        let g = baue(&q, &s3, &cache, bogen(), MAX_BILDER).await;
        assert!(!g.vollstaendig);
        assert!(props(&g.antwort).is_empty());
    }

    /// Details von EMSR728 mit einem zweiten Bild im GRA-Produkt von Bogen, ohne images-Eintrag.
    fn mit_zweitem_bild() -> Value {
        let mut v: Value = serde_json::from_str(EMSR728).unwrap();
        let aoi = v["results"][0]["aois"]
            .as_array_mut()
            .unwrap()
            .iter_mut()
            .find(|a| a["name"] == "Bogen")
            .unwrap();
        aoi["products"][0]["layers"].as_array_mut().unwrap().push(
            json!({ "name": "EMSR728/AOI09/GRA_PRODUCT/zweites_ORTHO.tif", "format": "cog" }),
        );
        v
    }

    #[tokio::test]
    async fn bildgrenze_kuerzt() {
        let (q, s3, cache) = (quelle(), S3::default(), tile_cache::test_cache().await);
        q.ersetzt.lock().unwrap().insert(
            format!("{}EMSR728", copernicus::DETAIL_URL),
            mit_zweitem_bild(),
        );
        let alle = props(&baue(&q, &s3, &cache, bogen(), MAX_BILDER).await.antwort);
        assert_eq!(alle.len(), 2);
        // Das zweite Bild hat keinen images-Eintrag: es bleibt, ohne Sensor und Aufnahme.
        assert!(alle.iter().any(|p| !p.contains_key("sensor")));
        let eins = props(&baue(&q, &s3, &cache, bogen(), 1).await.antwort);
        assert_eq!(eins.len(), 1);
        assert_eq!(eins[0]["gekuerzt"], true);
    }

    #[tokio::test]
    async fn kopf_aus_cache_ohne_abruf() {
        let (s3, cache) = (S3::default(), tile_cache::test_cache().await);
        let erst = load_kopf(&cache, &s3.hole(), BOGEN_BILD).await.unwrap();
        let n = s3.anzahl();
        assert!(n >= 1);
        let zweit = load_kopf(&cache, &s3.hole(), BOGEN_BILD).await.unwrap();
        assert_eq!(erst, zweit);
        assert_eq!(s3.anzahl(), n);
    }

    #[tokio::test]
    async fn kurzer_kopf_wird_nachgeladen_und_kaputter_abgelehnt() {
        let cache = tile_cache::test_cache().await;
        // Range liefert nur 3000 Bytes je Aufruf außer beim zweiten Mal: der Leser verlangt mehr.
        let runde = Arc::new(Mutex::new(0usize));
        let r = runde.clone();
        let hole = move |_url: String, _start: u64, laenge: u64| {
            *r.lock().unwrap() += 1;
            let e = (laenge as usize).min(if laenge == cog::KOPF_ERSTER_ABRUF {
                3000
            } else {
                ANFANG.len()
            });
            std::future::ready(Ok::<_, String>(ANFANG[..e].to_vec()))
        };
        assert!(load_kopf(&cache, &hole, "a/kurz.tif").await.is_ok());
        assert!(*runde.lock().unwrap() >= 2);
        // Eine Datei, die vor dem Kopf endet, ist kaputt und kein Endlosnachladen.
        let kurz = |_u: String, _s: u64, _l: u64| {
            std::future::ready(Ok::<_, String>(ANFANG[..3000].to_vec()))
        };
        assert!(load_kopf(&cache, &kurz, "a/kaputt.tif").await.is_err());
    }
}
