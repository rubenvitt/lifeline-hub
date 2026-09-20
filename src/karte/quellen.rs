//! Fetch-Logik je Quelle mit Stale-while-revalidate (SWR):
//! frischer Cache → sofort; veralteter Cache → sofort den alten Stand ausliefern und im
//! Hintergrund erneuern (nicht blockierend); gar kein Cache → einmalig blockierend holen.

use crate::error::AppError;
use crate::karte::cache;
use crate::karte::normalisierung::{
    kombiniere_nina, normalisiere_hochwasser, normalisiere_overpass, normalisiere_pegelonline,
};
use crate::karte::typen::{leere_collection, Bbox, FachebeneAntwort};
use crate::karte::FachebenenState;
use futures::stream::{self, StreamExt};
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

/// Holt eine URL und liefert den Rumpf als Text (für Quellen, deren Antwort kein JSON ist).
async fn hole_text(client: &reqwest::Client, url: &str) -> Result<String, String> {
    let resp = client.get(url).send().await.map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!("HTTP {}", resp.status()));
    }
    resp.text().await.map_err(|e| e.to_string())
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

// ------------------------------------------------------- HOCHWASSER (LHP, LFH-77)

/// Marke, hinter der das Länderübergreifende Hochwasserportal seinen Sitzungs-Token in die
/// Startseite schreibt: `addLagePegel(884284296001)`. Die schließende Klammer gehört zur
/// Marke — `addLagePegelInteractive(` ist ein anderer Aufruf derselben Datei und bekommt
/// seine `ki` als Variable; ohne die Klammer läse man dort das Wort `ki` als Token.
const LHP_KI_MARKE: &str = "addLagePegel(";

const HOCHWASSER_ATTRIB: &str = "Länderübergreifendes Hochwasserportal (LHP) — Urheberrecht bei den zuständigen Hochwasserzentralen bzw. Pegelbetreibern der Länder";
const HOCHWASSER_TTL: Duration = Duration::from_secs(300);
const LHP_START: &str = "https://www.hochwasserzentralen.de/";
const LHP_LAGEPEGEL: &str = "https://www.hochwasserzentralen.de/webservices/get_lagepegel.php";

pub async fn fetch_hochwasser(s: &FachebenenState, pool: &SqlitePool) -> FachebeneAntwort {
    let (client, pool2) = (s.client.clone(), pool.clone());
    liefere_mit_swr(
        pool,
        &s.inflight,
        "hochwasser",
        HOCHWASSER_TTL,
        || FachebeneAntwort::offline("hochwasser", HOCHWASSER_ATTRIB),
        move || erneuere_hochwasser(client, pool2),
    )
    .await
}

/// Zweistufig wie NINA, aber aus einem anderen Grund: Stufe 1 holt nicht Daten, sondern den
/// Sitzungs-Token (`ki`) aus der Startseite, den Stufe 2 mitschicken MUSS. Beide Stufen
/// laufen nur beim Cache-Refresh (TTL 300 s), nicht je Anfrage — zwei Zugriffe pro
/// Aktualisierung auf ein Behördenportal sind das Budget, nicht zwei pro Nutzer.
async fn erneuere_hochwasser(
    client: reqwest::Client,
    pool: SqlitePool,
) -> Option<FachebeneAntwort> {
    let html = match hole_text(&client, LHP_START).await {
        Ok(t) => t,
        Err(e) => {
            tracing::warn!("LHP-Startseite nicht erreichbar: {e}");
            return None;
        }
    };
    let Some(ki) = extrahiere_ki(&html) else {
        // Kein Netzfehler, sondern ein Formatbruch: die Seite wurde umgebaut. Laut, aber
        // nicht fatal — die Ebene fällt auf „offline" zurück.
        tracing::warn!(
            "LHP-Startseite ohne `{LHP_KI_MARKE}…)`-Marke — Sitzungs-Token nicht lesbar"
        );
        return None;
    };
    let rumpf = format!("ki={ki}&pegelname=1"); // beide Werte sind ASCII-sicher (Ziffern/Literal)
    let roh = match client
        .post(LHP_LAGEPEGEL)
        .header("Content-Type", "application/x-www-form-urlencoded")
        .body(rumpf)
        .send()
        .await
    {
        Ok(r) if r.status().is_success() => match r.text().await {
            // Ein ABGELAUFENER/ungültiger Token liefert HTTP 200 mit LEEREM Rumpf (gemessen).
            // Ohne diese eigene Meldung landet der Fall als „JSON kaputt" im Log und die
            // nächste Fehlersuche beginnt wieder bei null.
            Ok(t) if t.trim().is_empty() => {
                tracing::warn!("LHP-Pegelabruf lieferte leeren Rumpf — `ki` ungültig/abgelaufen");
                return None;
            }
            Ok(t) => match serde_json::from_str::<serde_json::Value>(&t) {
                Ok(v) => v,
                Err(e) => {
                    tracing::warn!("LHP-Pegelabruf: JSON nicht lesbar: {e}");
                    return None;
                }
            },
            Err(e) => {
                tracing::warn!("LHP-Pegelabruf: Rumpf nicht lesbar: {e}");
                return None;
            }
        },
        Ok(r) => {
            tracing::warn!("LHP-Pegelabruf HTTP {}", r.status());
            return None;
        }
        Err(e) => {
            tracing::warn!("LHP-Pegelabruf fehlgeschlagen: {e}");
            return None;
        }
    };
    let a = FachebeneAntwort::ok(
        "hochwasser",
        HOCHWASSER_ATTRIB,
        None,
        normalisiere_hochwasser(&roh),
    );
    cache::setze(&pool, "hochwasser", &a).await;
    Some(a)
}

/// Zieht den `ki`-Token aus dem Quelltext der LHP-Startseite.
///
/// WARUM ÜBERHAUPT: die Webservices des Portals antworten NUR mit einem gültigen, vom
/// Server ausgegebenen `ki`. Gemessen (20.09.2026): ohne Parameter, mit erfundener Zahl
/// oder mit einem Token aus einem anderen Aufruf liefert `get_lagepegel.php`
/// **HTTP 200 mit leerem Body**; mit dem frisch aus der Startseite gelesenen Token
/// ~138 KB. Der Token ist also nicht ableitbar, er wird gelesen.
fn extrahiere_ki(html: &str) -> Option<String> {
    let start = html.find(LHP_KI_MARKE)? + LHP_KI_MARKE.len();
    let rest = &html[start..];
    let ende = rest.find(')')?;
    let token = &rest[..ende];
    if token.is_empty() || !token.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    Some(token.to_string())
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

#[cfg(test)]
mod lhp_ki_tests {
    use super::*;

    #[test]
    fn extrahiert_ki_aus_seitenquelltext() {
        let html = "<script>addLaender(456404797936)\naddLagePegel(884284296001)</script>";
        assert_eq!(extrahiere_ki(html), Some("884284296001".to_string()));
    }

    #[test]
    fn nimmt_die_erste_fundstelle() {
        let html = "addLagePegel(111111111111) addLagePegel(222222222222)";
        assert_eq!(extrahiere_ki(html), Some("111111111111".to_string()));
    }

    #[test]
    fn greift_nicht_nach_addlagepegelinteractive() {
        // `lage-basics.js` kennt BEIDE Namen; der Interactive-Aufruf bekommt seine ki
        // als Variable, nicht als Literal — ein unverankertes Muster nähme hier `ki`.
        let html = "function x(){ addLagePegelInteractive(ki, datetime); }";
        assert_eq!(extrahiere_ki(html), None);
    }

    #[test]
    fn ohne_fundstelle_ist_none() {
        assert_eq!(extrahiere_ki("<html><body>Wartung</body></html>"), None);
    }

    #[test]
    fn nicht_numerisches_argument_ist_none() {
        assert_eq!(extrahiere_ki("addLagePegel(ki)"), None);
    }
}
