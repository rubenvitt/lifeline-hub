//! Copernicus-Satellitenbilder als Kachelebene (LLH-2021): die Liste der Bilder im Ausschnitt
//! und die Kacheln je Bild. Die Auswahl teilt sich die Kette der Vektorebene
//! ([`copernicus::select_im_ausschnitt`]); gezeigt werden nur die Bilder der dort gewählten
//! Produkte. Das COG selbst liest `cog.rs`; hier stehen Abruf, Cache und SSRF-Grenze: Geladen
//! wird nur `EBENEN_BASIS + pfad` eines geprüften Pfads aus den Details, die Kachelroute nimmt
//! nur die Kennung. Entwurf:
//! `docs/superpowers/specs/2026-11-24-h11vkn1p-copernicus-cog-rasterbilder-design.md`.

use crate::error::AppError;
use crate::karte::cog::{self, Kopf, KopfErgebnis};
use crate::karte::copernicus::{
    self, bild_kennung, Auswahl, Gebaut, COPERNICUS_ATTRIB, COPERNICUS_TTL, COPERNICUS_WARTE,
    EBENEN_BASIS, PARALLEL,
};
use crate::karte::tile_cache::{self, TileCache};
use crate::karte::typen::{Bbox, FachebeneAntwort};
use crate::karte::{cache, proxy, quellen, FachebenenState};
use chrono::NaiveDateTime;
use futures::stream::{self, StreamExt};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sqlx::SqlitePool;
use std::collections::HashMap;
use std::future::Future;
use std::path::Path;
use std::sync::{Arc, Mutex, OnceLock, Weak};

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
    // Eigene Werte statt Referenzen in den Futures, wie bei `build_antwort`: sonst verlangt
    // `Send` im gespawnten Abruf eine Lebensdauer, die der Compiler nicht beweisen kann.
    let pfade: Vec<String> = kandidaten.iter().map(|k| k.bild.pfad.clone()).collect();
    let koepfe: Vec<Result<Kopf, String>> = stream::iter(pfade)
        .map(|pfad| async move { load_kopf(cache, hole_bereich, &pfad).await })
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
    // Der Pfad reist mit, damit eine Liste aus dem Cache verdrängte Köpfe neu anlegen kann
    // ([`sorge_fuer_koepfe`]); er ist ein öffentlicher Pfad der Quelle.
    props.insert("pfad".into(), b.pfad.clone().into());
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

/// Legt für jedes Bild der Antwort den Kopf-Eintrag an, falls er fehlt: Der Kachel-Cache verdrängt
/// nach LRU, die Liste kann aber noch bis zu `COPERNICUS_TTL` aus dem Fachebenen-Cache kommen. Ohne
/// Kopf antwortete jede neue Kachel 404. Ein vorhandener Kopf zählt dabei für den LRU. Nur Pfade,
/// die [`copernicus::check_bildpfad`] bestehen und zur Kennung passen.
pub(crate) async fn sorge_fuer_koepfe<R, RFut>(
    cache: &TileCache,
    hole_bereich: &R,
    antwort: &FachebeneAntwort,
) where
    R: Fn(String, u64, u64) -> RFut,
    RFut: Future<Output = Result<Vec<u8>, String>>,
{
    let pfade: Vec<String> = antwort.features["features"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|f| {
            let p = &f["properties"];
            let pfad = p["pfad"].as_str()?;
            (copernicus::check_bildpfad(pfad) && p["bild"].as_str() == Some(&bild_kennung(pfad)))
                .then(|| pfad.to_string())
        })
        .take(MAX_BILDER)
        .collect();
    stream::iter(pfade)
        .for_each_concurrent(PARALLEL, |pfad| async move {
            if let Err(e) = load_kopf(cache, hole_bereich, &pfad).await {
                tracing::warn!("Copernicus: {e}");
            }
        })
        .await;
}

// ===== Liste als Route =====

/// Prüft die `bbox` der Bilderliste wie die Vektorebene: Pflicht, höchstens
/// `COPERNICUS_MAX_SPANNE_GRAD` je Achse.
pub(crate) fn check_liste_bbox(roh: Option<&str>) -> Result<Bbox, AppError> {
    let roh = roh.ok_or_else(|| AppError::Validation("bbox-Parameter erforderlich".into()))?;
    let bbox = Bbox::parse(roh).map_err(AppError::Validation)?;
    copernicus::check_bbox(&bbox).map_err(AppError::Validation)?;
    Ok(bbox)
}

/// Cache-Schlüssel der Bilderliste, mit und ohne Archiv getrennt.
pub(crate) fn listen_schluessel(bbox: &Bbox, archiv: bool) -> String {
    bbox.cache_key_mit(if archiv {
        "copernicus-bilder-archiv"
    } else {
        "copernicus-bilder"
    })
}

/// `GET /api/map/overlays/copernicus/images?bbox=…[&archiv=1]`. Wie die Vektorebene: kalt wartet
/// die Anfrage höchstens `COPERNICUS_WARTE`, der Lauf füllt die Caches weiter; eine
/// unvollständige Antwort geht hinaus, wird aber nicht gespeichert. Ohne Kachel-Cache (Köpfe
/// lägen nirgends) ist die Ebene `offline`.
pub async fn fetch_copernicus_bilder(
    s: &FachebenenState,
    pool: &SqlitePool,
    karten_dir: &Path,
    bbox_roh: Option<&str>,
    archiv: bool,
) -> Result<FachebeneAntwort, AppError> {
    let bbox = check_liste_bbox(bbox_roh)?;
    let offline = || FachebeneAntwort::offline(QUELLE, COPERNICUS_ATTRIB);
    let kachel_cache = match tile_cache::cache_oeffnen(karten_dir).await {
        Ok(c) => c,
        Err(e) => {
            tracing::warn!("Copernicus-Bilder: Kachel-Cache nicht verfügbar ({e})");
            return Ok(offline());
        }
    };
    let key = listen_schluessel(&bbox, archiv);
    let kachel_cache_lesen = kachel_cache.clone();
    let (client, p, k) = (s.client.clone(), pool.clone(), key.clone());
    let antwort = quellen::liefere_geloest(
        pool,
        &s.inflight,
        &key,
        COPERNICUS_TTL,
        tokio::time::Instant::now() + COPERNICUS_WARTE,
        move || async move {
            let fetch = move |url: String| {
                let c = client.clone();
                async move { quellen::hole_json(&c, &url).await }
            };
            let jetzt = chrono::Utc::now().naive_utc();
            let gebaut = build_bilder_antwort(
                &p,
                &kachel_cache,
                fetch,
                hole_bereich_s3,
                bbox,
                archiv,
                jetzt,
                MAX_BILDER,
            )
            .await?;
            if gebaut.vollstaendig {
                cache::setze(&p, &k, &gebaut.antwort).await;
            }
            Some(gebaut.antwort)
        },
    )
    .await;
    match antwort {
        Some(a) => {
            sorge_fuer_koepfe(&kachel_cache_lesen, &hole_bereich_s3, &a).await;
            Ok(a)
        }
        None => Ok(offline()),
    }
}

// ===== Kacheln =====

/// Antwort der Kachelroute.
#[derive(Debug)]
pub enum KachelAntwort {
    /// PNG, RGBA, 256 × 256.
    Png(Vec<u8>),
    /// Nichts zu zeichnen (außerhalb, unter `min_zoom`, nicht darstellbar): 204.
    Leer,
}

/// Fehler der Kachelroute.
#[derive(Debug)]
pub enum KachelFehler {
    /// Kennung falsch geformt oder ohne Kopf-Eintrag: 404.
    Unbekannt,
    /// Keine gültige Kachel `z/x/y`: 400.
    Ungueltig,
    /// S3 nicht erreichbar oder Daten unbrauchbar, Kachel nicht im Cache: 502.
    Quelle(String),
}

fn kennung_gueltig(k: &str) -> bool {
    k.len() == 16 && k.bytes().all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f'))
}

fn kachel_schluessel(k: &str, z: i64, x: i64, y: i64) -> String {
    format!("cog:{k}/{z}/{x}/{y}")
}

/// Sperre je Kachelschlüssel: Gleichzeitige Fehltreffer derselben Kachel rendern einmal, der
/// zweite findet danach den Cache-Eintrag (wie `tile_cache`, LFH-930).
fn sperre_fuer(schluessel: &str) -> Arc<tokio::sync::Mutex<()>> {
    static SPERREN: OnceLock<Mutex<HashMap<String, Weak<tokio::sync::Mutex<()>>>>> =
        OnceLock::new();
    let mut m = SPERREN
        .get_or_init(Default::default)
        .lock()
        .unwrap_or_else(|e| e.into_inner());
    m.retain(|_, w| w.strong_count() > 0);
    if let Some(s) = m.get(schluessel).and_then(Weak::upgrade) {
        return s;
    }
    let s = Arc::new(tokio::sync::Mutex::new(()));
    m.insert(schluessel.to_string(), Arc::downgrade(&s));
    s
}

/// Liefert die Kachel `z/x/y` des Bildes `bild`: aus dem Kachel-Cache, sonst aus dem Kopf-Eintrag
/// und den Quellkacheln per `hole_bereich` gerendert und abgelegt.
pub async fn liefere_kachel<R, RFut>(
    cache: &TileCache,
    hole_bereich: &R,
    bild: &str,
    z: i64,
    x: i64,
    y: i64,
) -> Result<KachelAntwort, KachelFehler>
where
    R: Fn(String, u64, u64) -> RFut,
    RFut: Future<Output = Result<Vec<u8>, String>>,
{
    if !kennung_gueltig(bild) {
        return Err(KachelFehler::Unbekannt);
    }
    if !proxy::kachel_koordinate_gueltig(z, x, y) {
        return Err(KachelFehler::Ungueltig);
    }
    let schluessel = kachel_schluessel(bild, z, x, y);
    if let Some((png, _)) = tile_cache::lies_eintrag(cache, &schluessel).await {
        return Ok(KachelAntwort::Png(png));
    }
    let sperre = sperre_fuer(&schluessel);
    let _halt = sperre.lock().await;
    if let Some((png, _)) = tile_cache::lies_eintrag(cache, &schluessel).await {
        return Ok(KachelAntwort::Png(png));
    }
    let eintrag = lies_kopf_eintrag(cache, bild)
        .await
        .ok_or(KachelFehler::Unbekannt)?;
    let kopf = eintrag.kopf;
    // Geprüft: 0 <= z <= 24 und 0 <= x, y < 2^z.
    let (z, x, y) = (z as u8, x as u32, y as u32);
    if kopf.nicht_darstellbar.is_some() || kopf.stufen.is_empty() {
        return Ok(KachelAntwort::Leer);
    }
    if z < cog::zoom_grenzen(&kopf).0 || !cog::kachel_im_bild(&kopf, z, x, y) {
        return Ok(KachelAntwort::Leer);
    }
    let stufe = cog::waehle_stufe(&kopf, z);
    let quellen = cog::quellkacheln(&kopf, stufe, z, x, y);
    if quellen.len() > cog::MAX_QUELLKACHELN {
        return Ok(KachelAntwort::Leer);
    }
    let url = format!("{EBENEN_BASIS}{}", eintrag.pfad);
    let s = &kopf.stufen[stufe];
    let mut roh = Vec::with_capacity(quellen.len());
    for q in &quellen {
        let (Some(&off), Some(&len)) = (s.offsets.get(q.index), s.laengen.get(q.index)) else {
            return Err(KachelFehler::Quelle(
                "Kachelindex außerhalb der Tabelle".into(),
            ));
        };
        if len == 0 {
            continue; // leere Kachel im COG: bleibt durchsichtig
        }
        if len > cog::QUELLKACHEL_MAX {
            return Err(KachelFehler::Quelle("Quellkachel zu groß".into()));
        }
        let bytes = hole_bereich(url.clone(), off, len)
            .await
            .map_err(KachelFehler::Quelle)?;
        if bytes.len() as u64 != len {
            return Err(KachelFehler::Quelle("Quellkachel unvollständig".into()));
        }
        roh.push((q.index, bytes));
    }
    // Entpacken und Rendern belegen Speicher und Rechenzeit; die Proxy-Grenze gilt nur für die
    // Abrufe. Eine eigene Grenze hält gleichzeitige Läufe klein.
    let _platz = render_grenze()
        .acquire()
        .await
        .map_err(|_| KachelFehler::Quelle("Render-Grenze geschlossen".into()))?;
    let png = tokio::task::spawn_blocking(move || {
        let mut entpackt = HashMap::new();
        for (i, b) in roh {
            entpackt.insert(i, cog::entpacke(&kopf, stufe, &b)?);
        }
        cog::rendere_kachel(&kopf, z, x, y, &entpackt)
    })
    .await
    .map_err(|e| KachelFehler::Quelle(format!("Rendern abgebrochen: {e}")))?
    .map_err(|e| KachelFehler::Quelle(e.to_string()))?;
    tile_cache::schreibe_eintrag(cache, &schluessel, &png, "image/png").await;
    Ok(KachelAntwort::Png(png))
}

/// Höchstzahl gleichzeitiger Render-Läufe: je Lauf höchstens 4 entpackte Kacheln zu 1 MiB.
const RENDER_PLAETZE: usize = 4;

fn render_grenze() -> &'static tokio::sync::Semaphore {
    static GRENZE: OnceLock<tokio::sync::Semaphore> = OnceLock::new();
    GRENZE.get_or_init(|| tokio::sync::Semaphore::new(RENDER_PLAETZE))
}

/// Client für die Range-Abrufe: keine Weiterleitungen (der Host ist fest), eigene Frist.
fn s3_client() -> &'static reqwest::Client {
    static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
    CLIENT.get_or_init(|| {
        crate::ausgehend::client_builder(crate::ausgehend::Zweck::Lagekarte)
            .redirect(reqwest::redirect::Policy::none())
            .timeout(std::time::Duration::from_secs(20))
            .build()
            .expect("reqwest-Client baubar")
    })
}

/// Lädt `laenge` Bytes ab `start` von `url` (nur unter `EBENEN_BASIS`) per HTTP-Range, belegt dabei
/// einen Platz der Proxy-Grenze. Verlangt 206; ein 200 nur, wenn die ganze Datei in `laenge`
/// passt.
pub async fn hole_bereich_s3(url: String, start: u64, laenge: u64) -> Result<Vec<u8>, String> {
    let Some(ende) = laenge.checked_sub(1).and_then(|l| start.checked_add(l)) else {
        return Err(format!("unzulässiger Bereich für {url}"));
    };
    if !url.starts_with(EBENEN_BASIS) {
        return Err(format!("unzulässiger Abruf {url}"));
    }
    let _platz = proxy::abruf_platz(proxy::proxy_abruf_grenze())
        .map_err(|_| "Grenze gleichzeitiger Abrufe erreicht".to_string())?;
    let resp = s3_client()
        .get(&url)
        .header(reqwest::header::RANGE, format!("bytes={start}-{ende}"))
        .send()
        .await
        .map_err(|e| format!("Abruf {url}: {}", e.without_url()))?;
    match resp.status().as_u16() {
        206 => {}
        200 if start == 0 && resp.content_length().is_some_and(|n| n <= laenge) => {}
        s => return Err(format!("Abruf {url}: HTTP {s}")),
    }
    crate::http_begrenzt::lies_begrenzt(resp, laenge as usize)
        .await
        .map_err(|e| format!("Abruf {url}: {e}"))
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

    // ===== Kacheln (Task 6) =====

    /// Kopf des Bogen-Bildes im Cache, dazu Zielkachel der kleinsten Stufe in der Bildmitte.
    async fn bild_im_cache(cache: &TileCache, s3: &S3) -> (String, u8, u32, u32) {
        let kopf = load_kopf(cache, &s3.hole(), BOGEN_BILD).await.unwrap();
        let [w, s, o, n] = cog::bounds_wgs84(&kopf);
        let z = 10u8;
        let (lon, lat) = ((w + o) / 2.0, (s + n) / 2.0);
        let zahl = 2f64.powi(z as i32);
        let x = ((lon + 180.0) / 360.0 * zahl).floor() as u32;
        let y = ((1.0 - lat.to_radians().tan().asinh() / std::f64::consts::PI) / 2.0 * zahl).floor()
            as u32;
        (bild_kennung(BOGEN_BILD), z, x, y)
    }

    #[tokio::test]
    async fn unbekannte_oder_falsch_geformte_kennung_ist_404() {
        let (s3, cache) = (S3::default(), tile_cache::test_cache().await);
        for k in [
            "0123456789abcdef",
            "xyz",
            "0123456789abcdef0",
            "0123456789ABCDEF",
            "../../etc",
        ] {
            let r = liefere_kachel(&cache, &s3.hole(), k, 10, 0, 0).await;
            assert!(matches!(r, Err(KachelFehler::Unbekannt)), "{k}: {r:?}");
        }
        assert_eq!(s3.anzahl(), 0);
    }

    #[tokio::test]
    async fn falsche_kachel_ist_400() {
        let (s3, cache) = (S3::default(), tile_cache::test_cache().await);
        let (k, ..) = bild_im_cache(&cache, &s3).await;
        for (z, x, y) in [(25, 0, 0), (10, 1024, 0), (10, 0, -1), (-1, 0, 0)] {
            let r = liefere_kachel(&cache, &s3.hole(), &k, z, x, y).await;
            assert!(
                matches!(r, Err(KachelFehler::Ungueltig)),
                "{z}/{x}/{y}: {r:?}"
            );
        }
    }

    #[tokio::test]
    async fn ausserhalb_oder_unter_min_zoom_ist_leer() {
        let (s3, cache) = (S3::default(), tile_cache::test_cache().await);
        let (k, z, x, y) = bild_im_cache(&cache, &s3).await;
        let n = s3.anzahl();
        let r = liefere_kachel(&cache, &s3.hole(), &k, z as i64, 0, 0).await;
        assert!(matches!(r, Ok(KachelAntwort::Leer)), "{r:?}");
        let r = liefere_kachel(&cache, &s3.hole(), &k, 9, (x / 2) as i64, (y / 2) as i64).await;
        assert!(matches!(r, Ok(KachelAntwort::Leer)), "{r:?}");
        assert_eq!(s3.anzahl(), n, "kein Abruf für leere Kacheln");
    }

    #[tokio::test]
    async fn kachel_wird_gerendert_und_gecacht() {
        let (s3, cache) = (S3::default(), tile_cache::test_cache().await);
        let (k, z, x, y) = bild_im_cache(&cache, &s3).await;
        let n = s3.anzahl();
        let Ok(KachelAntwort::Png(png)) =
            liefere_kachel(&cache, &s3.hole(), &k, z as i64, x as i64, y as i64).await
        else {
            panic!("keine Kachel");
        };
        let bild = image::load_from_memory(&png).unwrap().to_rgba8();
        assert_eq!(bild.dimensions(), (256, 256));
        assert!(
            bild.pixels().any(|p| p[3] == 255),
            "Kachel ganz durchsichtig"
        );
        assert!(s3.anzahl() > n);
        let n = s3.anzahl();
        let zweit = liefere_kachel(&cache, &s3.hole(), &k, z as i64, x as i64, y as i64).await;
        assert!(matches!(zweit, Ok(KachelAntwort::Png(p)) if p == png));
        assert_eq!(s3.anzahl(), n, "zweite Anfrage aus dem Cache");
    }

    #[tokio::test]
    async fn kachel_aus_cache_ohne_kopf() {
        let (s3, cache) = (S3::default(), tile_cache::test_cache().await);
        let (k, z, x, y) = bild_im_cache(&cache, &s3).await;
        liefere_kachel(&cache, &s3.hole(), &k, z as i64, x as i64, y as i64)
            .await
            .unwrap();
        sqlx::query("DELETE FROM tile_cache WHERE schluessel = ?")
            .bind(kopf_schluessel(&k))
            .execute(&*cache)
            .await
            .unwrap();
        let r = liefere_kachel(&cache, &s3.hole(), &k, z as i64, x as i64, y as i64).await;
        assert!(matches!(r, Ok(KachelAntwort::Png(_))), "{r:?}");
    }

    #[tokio::test]
    async fn quelle_weg_ist_502() {
        let (s3, cache) = (S3::default(), tile_cache::test_cache().await);
        let (k, z, x, y) = bild_im_cache(&cache, &s3).await;
        s3.fehlt.lock().unwrap().push("AOI09".into());
        let r = liefere_kachel(&cache, &s3.hole(), &k, z as i64, x as i64, y as i64).await;
        assert!(matches!(r, Err(KachelFehler::Quelle(_))), "{r:?}");
    }

    #[tokio::test]
    async fn gleichzeitige_anfragen_rendern_einmal() {
        let (s3, cache) = (S3::default(), tile_cache::test_cache().await);
        let (k, z, x, y) = bild_im_cache(&cache, &s3).await;
        let n = s3.anzahl();
        let hole = s3.hole();
        let (a, b) = tokio::join!(
            liefere_kachel(&cache, &hole, &k, z as i64, x as i64, y as i64),
            liefere_kachel(&cache, &hole, &k, z as i64, x as i64, y as i64),
        );
        assert!(matches!(a, Ok(KachelAntwort::Png(_))) && matches!(b, Ok(KachelAntwort::Png(_))));
        let stufe = {
            let e = lies_kopf_eintrag(&cache, &k).await.unwrap();
            cog::quellkacheln(&e.kopf, cog::waehle_stufe(&e.kopf, z), z, x, y).len()
        };
        assert_eq!(
            s3.anzahl() - n,
            stufe,
            "je Quellkachel ein Abruf, nicht doppelt"
        );
    }

    #[tokio::test]
    async fn verdraengte_koepfe_legt_die_liste_wieder_an() {
        let (q, s3, cache) = (quelle(), S3::default(), tile_cache::test_cache().await);
        let antwort = baue(&q, &s3, &cache, bogen(), MAX_BILDER).await.antwort;
        let k = bild_kennung(BOGEN_BILD);
        assert_eq!(props(&antwort)[0]["pfad"], BOGEN_BILD);
        sqlx::query("DELETE FROM tile_cache WHERE schluessel = ?")
            .bind(kopf_schluessel(&k))
            .execute(&*cache)
            .await
            .unwrap();
        sorge_fuer_koepfe(&cache, &s3.hole(), &antwort).await;
        assert!(lies_kopf_eintrag(&cache, &k).await.is_some());
        // Ein Pfad, der die Prüfung nicht besteht, wird nie geladen.
        let mut boese = antwort.clone();
        boese.features["features"][0]["properties"]["pfad"] = "../../x.tif".into();
        boese.features["features"][0]["properties"]["bild"] = bild_kennung("../../x.tif").into();
        let n = s3.anzahl();
        sorge_fuer_koepfe(&cache, &s3.hole(), &boese).await;
        assert_eq!(s3.anzahl(), n);
    }

    #[test]
    fn bbox_pruefung_der_liste() {
        assert!(check_liste_bbox(None).is_err());
        assert!(check_liste_bbox(Some("1,1,5,5")).is_err());
        assert!(check_liste_bbox(Some("12.5,48.8,12.8,49.0")).is_ok());
        assert_eq!(
            listen_schluessel(&bogen(), false),
            bogen().cache_key_mit("copernicus-bilder")
        );
        assert_ne!(
            listen_schluessel(&bogen(), true),
            listen_schluessel(&bogen(), false)
        );
    }
}
