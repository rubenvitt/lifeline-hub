//! Fetch-Logik je Quelle mit Stale-while-revalidate (SWR):
//! frischer Cache → sofort; veralteter Cache → sofort den alten Stand ausliefern und im
//! Hintergrund erneuern (nicht blockierend); gar kein Cache → einmalig blockierend holen.

use crate::error::AppError;
use crate::karte::cache;
use crate::karte::normalisierung::{
    kombiniere_nina, normalisiere_autobahn, normalisiere_overpass, normalisiere_pegelonline,
};
use crate::karte::typen::{leere_collection, Bbox, FachebeneAntwort};
use crate::karte::FachebenenState;
use futures::stream::{self, StreamExt};
use serde_json::Value;
use sqlx::SqlitePool;
use std::collections::HashSet;
use std::future::Future;
use std::sync::{Arc, Mutex};
use std::time::Duration;

/// SWR-Kern: entscheidet anhand des Cache-Eintrags, ob sofort (frisch), sofort+Hintergrund-
/// Refresh (veraltet) oder blockierend (kalt) ausgeliefert wird. `erneuere` liefert ein
/// 'static-Future (für `tokio::spawn`), das die Quelle holt, in den Cache schreibt und das
/// Ergebnis zurückgibt (None bei Fehlschlag). `inflight` entkoppelt doppelte Refreshes.
async fn liefere_mit_swr<Fut>(
    pool: &SqlitePool,
    inflight: &Arc<Mutex<HashSet<String>>>,
    key: &str,
    ttl: Duration,
    offline: impl FnOnce() -> FachebeneAntwort,
    erneuere: impl FnOnce() -> Fut,
) -> FachebeneAntwort
where
    Fut: Future<Output = Option<FachebeneAntwort>> + Send + 'static,
{
    match cache::eintrag(pool, key).await {
        Some((a, alter)) if alter < ttl.as_secs() as i64 => a, // frisch
        Some((a, _)) => {
            // veraltet → alten Stand sofort ausliefern, im Hintergrund erneuern.
            // Nur EIN Refresh pro Schlüssel gleichzeitig (verhindert Thundering Herd).
            let claimed = inflight.lock().unwrap().insert(key.to_string());
            if claimed {
                let inflight = inflight.clone();
                let key = key.to_string();
                let fut = erneuere();
                tokio::spawn(async move {
                    fut.await;
                    inflight.lock().unwrap().remove(&key);
                });
            }
            a
        }
        None => erneuere().await.unwrap_or_else(offline), // kalt → blockierend
    }
}

/// Holt eine externe URL und parst sie als GeoJSON-Value (FeatureCollection durchgereicht).
async fn hole_geojson(client: &reqwest::Client, url: &str) -> Result<serde_json::Value, String> {
    let resp = client.get(url).send().await.map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!("HTTP {}", resp.status()));
    }
    let v: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;
    if v.get("type").and_then(|t| t.as_str()) == Some("FeatureCollection") {
        Ok(v)
    } else {
        Ok(leere_collection())
    }
}

/// Holt eine URL und parst sie als beliebigen JSON-Value (nicht zwingend GeoJSON).
pub(crate) async fn hole_json(
    client: &reqwest::Client,
    url: &str,
) -> Result<serde_json::Value, String> {
    let resp = client.get(url).send().await.map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!("HTTP {}", resp.status()));
    }
    resp.json().await.map_err(|e| e.to_string())
}

// ---------------------------------------------------------------------------- DWD

const DWD_ATTRIB: &str = "Datenbasis: Deutscher Wetterdienst";
const DWD_TTL: Duration = Duration::from_secs(300);
const DWD_URL: &str = "https://maps.dwd.de/geoserver/dwd/ows?service=WFS&version=2.0.0&request=GetFeature&typeName=dwd:Warnungen_Gemeinden_vereinigt&outputFormat=application/json&srsName=EPSG:4326";

pub async fn fetch_dwd(s: &FachebenenState, pool: &SqlitePool) -> FachebeneAntwort {
    let (client, pool2) = (s.client.clone(), pool.clone());
    liefere_mit_swr(
        pool,
        &s.inflight,
        "dwd",
        DWD_TTL,
        || FachebeneAntwort::offline("dwd", DWD_ATTRIB),
        move || erneuere_dwd(client, pool2),
    )
    .await
}

async fn erneuere_dwd(client: reqwest::Client, pool: SqlitePool) -> Option<FachebeneAntwort> {
    match hole_geojson(&client, DWD_URL).await {
        Ok(fc) => {
            let a = FachebeneAntwort::ok("dwd", DWD_ATTRIB, None, fc);
            cache::setze(&pool, "dwd", &a).await;
            Some(a)
        }
        Err(e) => {
            tracing::warn!("DWD-Fetch fehlgeschlagen: {e}");
            None
        }
    }
}

// -------------------------------------------------------------------- PEGELONLINE

const PEGEL_ATTRIB: &str = "PEGELONLINE / WSV";
const PEGEL_TTL: Duration = Duration::from_secs(300);
const PEGEL_URL: &str = "https://www.pegelonline.wsv.de/webservices/rest-api/v2/stations.json?includeTimeseries=true&includeCurrentMeasurement=true";

pub async fn fetch_pegelonline(s: &FachebenenState, pool: &SqlitePool) -> FachebeneAntwort {
    let (client, pool2) = (s.client.clone(), pool.clone());
    liefere_mit_swr(
        pool,
        &s.inflight,
        "pegelonline",
        PEGEL_TTL,
        || FachebeneAntwort::offline("pegelonline", PEGEL_ATTRIB),
        move || erneuere_pegelonline(client, pool2),
    )
    .await
}

async fn erneuere_pegelonline(
    client: reqwest::Client,
    pool: SqlitePool,
) -> Option<FachebeneAntwort> {
    match hole_json(&client, PEGEL_URL).await {
        Ok(roh) => {
            let a = FachebeneAntwort::ok(
                "pegelonline",
                PEGEL_ATTRIB,
                None,
                normalisiere_pegelonline(&roh),
            );
            cache::setze(&pool, "pegelonline", &a).await;
            Some(a)
        }
        Err(e) => {
            tracing::warn!("PEGELONLINE-Fetch fehlgeschlagen: {e}");
            None
        }
    }
}

// --------------------------------------------------------------------------- NINA

const NINA_ATTRIB: &str =
    "Quelle: Bundesamt für Bevölkerungsschutz und Katastrophenhilfe (BBK) / MoWaS";
const NINA_TTL: Duration = Duration::from_secs(90);
const NINA_MAPDATA: &str = "https://warnung.bund.de/api31/mowas/mapData.json";
fn nina_geojson_url(id: &str) -> String {
    format!("https://warnung.bund.de/api31/warnings/{id}.geojson")
}

pub async fn fetch_nina(s: &FachebenenState, pool: &SqlitePool) -> FachebeneAntwort {
    let (client, pool2) = (s.client.clone(), pool.clone());
    liefere_mit_swr(
        pool,
        &s.inflight,
        "nina",
        NINA_TTL,
        || FachebeneAntwort::offline("nina", NINA_ATTRIB),
        move || erneuere_nina(client, pool2),
    )
    .await
}

async fn erneuere_nina(client: reqwest::Client, pool: SqlitePool) -> Option<FachebeneAntwort> {
    let map_data = match hole_json(&client, NINA_MAPDATA).await {
        Ok(v) => v,
        Err(e) => {
            tracing::warn!("NINA-mapData-Fetch fehlgeschlagen: {e}");
            return None;
        }
    };
    let ids: Vec<String> = map_data
        .as_array()
        .map(|a| {
            a.iter()
                .filter_map(|w| w.get("id").and_then(|i| i.as_str()).map(String::from))
                .collect()
        })
        .unwrap_or_default();
    // Geometrien parallel laden (N+1, auf 8 gleichzeitig begrenzt); Einzelfehler tolerieren.
    let geometrien: Vec<(String, serde_json::Value)> = stream::iter(ids)
        .map(|id| {
            let client = client.clone();
            let url = nina_geojson_url(&id);
            async move {
                match hole_json(&client, &url).await {
                    Ok(v) => Some((id, v)),
                    Err(e) => {
                        tracing::warn!("NINA-Geometrie-Fetch für {id} fehlgeschlagen: {e}");
                        None
                    }
                }
            }
        })
        .buffer_unordered(8)
        .collect::<Vec<_>>()
        .await
        .into_iter()
        .flatten()
        .collect();
    let a = FachebeneAntwort::ok(
        "nina",
        NINA_ATTRIB,
        None,
        kombiniere_nina(&map_data, &geometrien),
    );
    cache::setze(&pool, "nina", &a).await;
    Some(a)
}

// ------------------------------------------------------------------------- KRITIS

const KRITIS_ATTRIB: &str = "© OpenStreetMap-Beitragende (ODbL)";
/// KRITIS-Objekte (Krankenhäuser, Schulen, Umspannwerke …) sind quasi statisch →
/// lange cachen (1 Tag). Entlastet Overpass deutlich.
const KRITIS_TTL: Duration = Duration::from_secs(24 * 3600);
/// Overpass braucht länger als das globale Client-Timeout (8 s) — interne `[timeout:25]`.
const KRITIS_TIMEOUT: Duration = Duration::from_secs(30);
/// Hauptinstanz ist oft überlastet (TimedOut) → Mirror als Fallback.
const OVERPASS_URLS: [&str; 2] = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
];

fn overpass_query(bbox_op: &str) -> String {
    format!(
        "[out:json][timeout:25];(\
nwr[amenity=hospital]({b});nwr[amenity=clinic]({b});nwr[amenity=nursing_home]({b});\
nwr[\"social_facility\"]({b});nwr[amenity=school]({b});nwr[amenity=kindergarten]({b});\
nwr[man_made=water_works]({b});nwr[man_made=water_tower]({b});nwr[power=substation]({b});\
nwr[amenity=fire_station]({b});nwr[amenity=police]({b}););out center tags;",
        b = bbox_op
    )
}

pub async fn fetch_kritis(
    s: &FachebenenState,
    pool: &SqlitePool,
    bbox_roh: &str,
) -> Result<FachebeneAntwort, AppError> {
    let bbox = Bbox::parse(bbox_roh).map_err(AppError::Validation)?;
    let key = bbox.cache_key();
    let (client, pool2, key2) = (s.client.clone(), pool.clone(), key.clone());
    let a = liefere_mit_swr(
        pool,
        &s.inflight,
        &key,
        KRITIS_TTL,
        || FachebeneAntwort::offline("kritis", KRITIS_ATTRIB),
        move || erneuere_kritis(client, pool2, bbox, key2),
    )
    .await;
    Ok(a)
}

async fn erneuere_kritis(
    client: reqwest::Client,
    pool: SqlitePool,
    bbox: Bbox,
    key: String,
) -> Option<FachebeneAntwort> {
    let query = overpass_query(&bbox.overpass());
    // Endpunkte der Reihe nach versuchen (eigenes, längeres Timeout). Einzelfehler nur debug,
    // erst wenn ALLE scheitern eine warn-Meldung (weniger Log-Rauschen).
    for url in OVERPASS_URLS {
        let resp = client
            .post(url)
            .timeout(KRITIS_TIMEOUT)
            .header("Content-Type", "text/plain")
            .body(query.clone())
            .send()
            .await;
        match resp {
            Ok(r) if r.status().is_success() => match r.json::<serde_json::Value>().await {
                Ok(roh) => {
                    let a = FachebeneAntwort::ok(
                        "kritis",
                        KRITIS_ATTRIB,
                        None,
                        normalisiere_overpass(&roh),
                    );
                    cache::setze(&pool, &key, &a).await;
                    return Some(a);
                }
                Err(e) => tracing::debug!("Overpass-JSON-Parse ({url}) fehlgeschlagen: {e}"),
            },
            Ok(r) => tracing::debug!("Overpass ({url}) HTTP {}", r.status()),
            Err(e) => tracing::debug!("Overpass-Fetch ({url}) fehlgeschlagen: {e}"),
        }
    }
    tracing::warn!("Overpass nicht erreichbar (alle Endpunkte) — KRITIS aus Cache/leer");
    None
}

// ----------------------------------------------------------------------- AUTOBAHN

const AUTOBAHN_ATTRIB: &str = "Autobahn GmbH des Bundes";
/// 10 min. Baustellen und Sperrungen sind mehrstündige bis mehrtägige Ereignisse; was sich
/// bewegt, ist ihr `future`-Übergang. Kürzer zu takten holt keine frischeren Daten, kostet
/// aber je Runde 334 Abrufe gegen eine fremde Behörden-API.
const AUTOBAHN_TTL: Duration = Duration::from_secs(600);
const AUTOBAHN_BASIS: &str = "https://verkehr.autobahn.de/o/autobahn/";
/// Die drei für Anfahrt und Lageaufklärung belegten Dienste (LFH-80). `warning`,
/// `parking_lorry`, `electric_charging_station` sind bewusst NICHT dabei: sie tragen zum
/// Ticket-Zweck nichts bei und kosteten je 111 weitere Abrufe pro Runde.
const AUTOBAHN_DIENSTE: [&str; 3] = ["webcam", "roadworks", "closure"];
/// Gemessen (20.09.2026): bei 8 gleichzeitigen Abrufen scheitern 1–2 der 334, bei 16 bereits
/// 30 — die Quelle drosselt. Mehr Parallelität macht den Lauf also nicht schneller, sondern
/// löchriger.
const AUTOBAHN_PARALLEL: usize = 8;
/// Gesamtdeckel über den Fächer. Das Client-Timeout (8 s) gilt je Abruf; ohne diesen Deckel
/// stünde der kalte, BLOCKIERENDE Pfad im schlechtesten Fall bei 334/8 × 8 s ≈ 5,5 min.
/// Gemessener Normallauf: ~25 s.
const AUTOBAHN_BUDGET: Duration = Duration::from_secs(60);

/// `{"roads":["A1","A2",…]}` → saubere Liste. Drei Dinge passieren hier, alle gemessen:
/// getrimmt (die Liste führt am 20.09.2026 `"A60 "` mit Leerzeichen — der Abruf darauf
/// liefert 0 Einträge, während `"A60"` 18 hat), entdoppelt (ebendeshalb), und **auf
/// alphanumerisch gefiltert**: der Wert kommt aus einer fremden Quelle und landet in einem
/// URL-PFAD — ein `../` darin zeigte auf einen anderen Endpunkt desselben Hosts.
pub(crate) fn autobahn_strassen(roh: &Value) -> Vec<String> {
    let mut namen: Vec<String> = roh
        .get("roads")
        .and_then(|r| r.as_array())
        .map(|a| {
            a.iter()
                .filter_map(|v| v.as_str())
                .map(str::trim)
                .filter(|n| !n.is_empty() && n.chars().all(|c| c.is_ascii_alphanumeric()))
                .map(String::from)
                .collect()
        })
        .unwrap_or_default();
    namen.sort();
    namen.dedup();
    namen
}

pub async fn fetch_autobahn(s: &FachebenenState, pool: &SqlitePool) -> FachebeneAntwort {
    let (client, pool2) = (s.client.clone(), pool.clone());
    liefere_mit_swr(
        pool,
        &s.inflight,
        "autobahn",
        AUTOBAHN_TTL,
        || FachebeneAntwort::offline("autobahn", AUTOBAHN_ATTRIB),
        move || erneuere_autobahn(client, pool2),
    )
    .await
}

async fn erneuere_autobahn(client: reqwest::Client, pool: SqlitePool) -> Option<FachebeneAntwort> {
    let liste = match hole_json(&client, AUTOBAHN_BASIS).await {
        Ok(v) => v,
        Err(e) => {
            tracing::warn!("Autobahn-Streckenliste nicht abrufbar: {e}");
            return None;
        }
    };
    let strassen = autobahn_strassen(&liste);
    if strassen.is_empty() {
        tracing::warn!("Autobahn-Streckenliste leer oder unlesbar");
        return None;
    }
    // Aussortiertes sichtbar machen: heute ist das genau die Dublette `"A60 "`. Führte die
    // Quelle eines Tages Namen mit Leer- oder Sonderzeichen ein, fielen sie durch den
    // Pfad-Filter — das soll im Log stehen und nicht still passieren.
    let roh_anzahl = liste
        .get("roads")
        .and_then(|r| r.as_array())
        .map(|a| a.len())
        .unwrap_or(0);
    if roh_anzahl > strassen.len() {
        tracing::debug!(
            "Autobahn: {} von {roh_anzahl} Streckennamen aussortiert (Dublette oder nicht \
             alphanumerisch)",
            roh_anzahl - strassen.len()
        );
    }
    let jobs: Vec<(String, String)> = strassen
        .iter()
        .flat_map(|s| {
            AUTOBAHN_DIENSTE
                .iter()
                .map(move |d| (s.clone(), d.to_string()))
        })
        .collect();
    let gesamt = jobs.len();
    // Einzelne Abrufe dürfen scheitern (Drosselung, leerer Body) — die übrigen Strecken
    // bleiben. Dieselbe Toleranz wie bei den NINA-Einzelgeometrien.
    let faecher = stream::iter(jobs)
        .map(|(strasse, dienst)| {
            let client = client.clone();
            let url = format!("{AUTOBAHN_BASIS}{strasse}/services/{dienst}");
            async move {
                match hole_json(&client, &url).await {
                    Ok(v) => Some((strasse, dienst, v)),
                    Err(e) => {
                        tracing::debug!("Autobahn {strasse}/{dienst} fehlgeschlagen: {e}");
                        None
                    }
                }
            }
        })
        .buffer_unordered(AUTOBAHN_PARALLEL)
        .collect::<Vec<_>>();
    let roh: Vec<(String, String, Value)> =
        match tokio::time::timeout(AUTOBAHN_BUDGET, faecher).await {
            Ok(v) => v.into_iter().flatten().collect(),
            Err(_) => {
                tracing::warn!("Autobahn-Abruf über {AUTOBAHN_BUDGET:?} hinaus — Cache/leer");
                return None;
            }
        };
    // Ein bis zwei Ausfälle je Lauf sind der gemessene Normalfall (Drosselung) und dürfen
    // das Log nicht alle 10 min mit einer Warnung fluten — sonst gewöhnt man sich sie ab und
    // übersieht den Tag, an dem die Quelle wirklich wegbricht. Erst ab einem Zehntel laut.
    let fehlend = gesamt - roh.len();
    if fehlend * 10 > gesamt {
        tracing::warn!("Autobahn: {fehlend} von {gesamt} Teilabrufen ohne Antwort");
    } else if fehlend > 0 {
        tracing::debug!("Autobahn: {fehlend} von {gesamt} Teilabrufen ohne Antwort");
    }
    let a = FachebeneAntwort::ok(
        "autobahn",
        AUTOBAHN_ATTRIB,
        None,
        normalisiere_autobahn(&roh),
    );
    cache::setze(&pool, "autobahn", &a).await;
    Some(a)
}

#[cfg(test)]
mod autobahn_strassen_tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn trimmt_entdoppelt_und_sortiert() {
        // "A60 " mit Leerzeichen steht so in der echten Liste (gemessen) und ist dieselbe
        // Strecke wie "A60" — ohne Trim+Dedup liefe ein Abruf ins Leere.
        let l = autobahn_strassen(&json!({ "roads": ["A3", "A60 ", "A60", "A1"] }));
        assert_eq!(l, vec!["A1", "A3", "A60"]);
    }

    #[test]
    fn verwirft_pfad_trennende_und_leere_namen() {
        // Der Name landet in einem URL-Pfad; alles außer [A-Za-z0-9] fliegt raus.
        let l =
            autobahn_strassen(&json!({ "roads": ["A1", "../details/webcam", "", "A/2", "A 3"] }));
        assert_eq!(l, vec!["A1"]);
    }

    #[test]
    fn fehlender_oder_kaputter_schluessel_liefert_leer() {
        assert!(autobahn_strassen(&json!({})).is_empty());
        assert!(autobahn_strassen(&json!({ "roads": "A1" })).is_empty());
    }
}

#[cfg(test)]
mod swr_tests {
    use super::*;
    use serde_json::json;
    use std::sync::atomic::{AtomicUsize, Ordering};

    fn antwort(quelle: &str) -> FachebeneAntwort {
        let fc = json!({ "type": "FeatureCollection", "features": [{ "type": "Feature" }] });
        FachebeneAntwort::ok(quelle, "x", None, fc)
    }

    fn inflight() -> Arc<Mutex<HashSet<String>>> {
        Arc::new(Mutex::new(HashSet::new()))
    }

    #[tokio::test]
    async fn frisch_liefert_cache_ohne_refresh() {
        let pool = crate::db::test_pool().await;
        cache::setze(&pool, "k", &antwort("cache")).await;
        let calls = Arc::new(AtomicUsize::new(0));
        let c = calls.clone();
        let a = liefere_mit_swr(
            &pool,
            &inflight(),
            "k",
            Duration::from_secs(60),
            || FachebeneAntwort::offline("k", "o"),
            move || {
                c.fetch_add(1, Ordering::SeqCst);
                async { Some(antwort("neu")) }
            },
        )
        .await;
        assert_eq!(a.quelle, "cache"); // aus dem Cache
        assert_eq!(calls.load(Ordering::SeqCst), 0); // KEIN Refresh ausgelöst
    }

    #[tokio::test]
    async fn kalt_holt_blockierend() {
        let pool = crate::db::test_pool().await;
        let calls = Arc::new(AtomicUsize::new(0));
        let c = calls.clone();
        let a = liefere_mit_swr(
            &pool,
            &inflight(),
            "k",
            Duration::from_secs(60),
            || FachebeneAntwort::offline("k", "o"),
            move || {
                c.fetch_add(1, Ordering::SeqCst);
                async { Some(antwort("neu")) }
            },
        )
        .await;
        assert_eq!(a.quelle, "neu"); // live geholt
        assert_eq!(calls.load(Ordering::SeqCst), 1);
    }

    #[tokio::test]
    async fn kalt_und_fehlschlag_liefert_offline() {
        let pool = crate::db::test_pool().await;
        let a = liefere_mit_swr(
            &pool,
            &inflight(),
            "k",
            Duration::from_secs(60),
            || FachebeneAntwort::offline("k", "o"),
            move || async { None }, // Quelle nicht erreichbar
        )
        .await;
        assert_eq!(a.status, crate::karte::typen::FachebeneStatus::Offline);
    }

    #[tokio::test]
    async fn veraltet_liefert_alten_stand_und_stoesst_refresh_an() {
        let pool = crate::db::test_pool().await;
        cache::setze(&pool, "k", &antwort("alt")).await;
        let calls = Arc::new(AtomicUsize::new(0));
        let c = calls.clone();
        let a = liefere_mit_swr(
            &pool,
            &inflight(),
            "k",
            Duration::from_secs(0), // alles gilt sofort als veraltet
            || FachebeneAntwort::offline("k", "o"),
            move || {
                c.fetch_add(1, Ordering::SeqCst);
                async { Some(antwort("neu")) }
            },
        )
        .await;
        assert_eq!(a.quelle, "alt"); // sofort der alte Stand
        assert_eq!(calls.load(Ordering::SeqCst), 1); // Refresh wurde angestoßen
    }
}
