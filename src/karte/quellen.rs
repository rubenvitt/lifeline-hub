//! Fetch-Logik je Quelle mit Stale-while-revalidate (SWR):
//! frischer Cache → sofort; veralteter Cache → sofort den alten Stand ausliefern und im
//! Hintergrund erneuern (nicht blockierend); gar kein Cache → einmalig blockierend holen.
//! Ausnahme Energie (LFH-81): dort wird auch der kalte Abruf von der Anfrage gelöst und nur
//! bis zu einer Wartefrist abgewartet (`liefere_geloest`).

use crate::error::AppError;
use crate::karte::cache;
use crate::karte::luftqualitaet::{luftqualitaet_fenster, normalisiere_luftqualitaet};
use crate::karte::normalisierung::{
    energie_attribution, energie_beitraege, fuehre_energie_zusammen, kombiniere_nina,
    normalisiere_autobahn, normalisiere_energie_mastr, normalisiere_energie_osm,
    normalisiere_hochwasser, normalisiere_odl, normalisiere_pegelonline, ENERGIE_MASTR_ATTRIB,
    ENERGIE_OSM_ATTRIB, ENERGIE_OSM_RAND_RADIEN,
};
use crate::karte::odl_grundpegel::{self, GrundpegelKarte};
use crate::karte::typen::{leere_collection, Bbox, FachebeneAntwort};
use crate::karte::FachebenenState;
use futures::stream::{self, StreamExt};
use serde_json::Value;
use sqlx::SqlitePool;
use std::collections::HashSet;
use std::future::Future;
use std::sync::{Arc, Mutex, OnceLock};
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

// ---------------------------------------------------------------------------- ODL

const ODL_ATTRIB: &str = "Bundesamt für Strahlenschutz (BfS), dl-de/by-2-0";
/// Die Quelle hat STUNDENtakt (`duration: "1h"`). 300 s wie bei DWD holte ~890 KB, ohne
/// frischer zu werden; eine Stunde ließe einen neuen Stundenwert in einer radiologischen
/// Lage bis zu einer Stunde liegen. 600 s begrenzt das auf zehn Minuten.
const ODL_TTL: Duration = Duration::from_secs(600);
/// Der auf der BfS-Schnittstellenseite dokumentierte Layer (ODL-Info → Datenschnittstelle).
/// Die Nachbar-Layer `odl_brutto_1h`/`odlinfo_sitelist` sind dort nicht beschrieben und
/// liefen im Test über 120 s — die 8-s-Schranke des gemeinsamen Clients fängt einen
/// hängenden GeoServer ab, ohne dass hier ein eigener Timeout stehen muss.
const ODL_URL: &str = "https://www.imis.bfs.de/ogc/opendata/ows?service=WFS&version=1.1.0&request=GetFeature&typeName=opendata:odlinfo_odl_1h_latest&outputFormat=application/json";

/// Liefert die Sonden und bewertet sie bei Auslieferung gegen den Standort-Grundpegel
/// (LFH-598). Der Grundpegel wird hier nur ANGESTOSSEN, nie abgewartet — auch im kalten
/// Fall nicht: bis er da ist, gelten die absoluten Bänder aus `normalisiere_odl`.
pub async fn fetch_odl(s: &FachebenenState, pool: &SqlitePool) -> FachebeneAntwort {
    let (client, pool2) = (s.client.clone(), pool.clone());
    let mut a = liefere_mit_swr(
        pool,
        &s.inflight,
        "odl",
        ODL_TTL,
        || FachebeneAntwort::offline("odl", ODL_ATTRIB),
        move || erneuere_odl(client, pool2),
    )
    .await;
    let grundpegel =
        cache::eintrag_wert::<GrundpegelKarte>(pool, odl_grundpegel::CACHE_SCHLUESSEL).await;
    stosse_grundpegel_an(s, pool, grundpegel.as_ref().map(|(_, alter)| *alter));
    let karte = grundpegel.map(|(k, _)| k).unwrap_or_default();
    odl_grundpegel::bewerte(&mut a.features, &karte);
    a
}

/// Der Grundpegel ändert sich über Tage, nicht über Stunden; ein Abruf kostet ~8,6 MB.
const ODL_GRUNDPEGEL_TTL: Duration = Duration::from_secs(24 * 3600);
/// Gemessen ~10 s bei guter Leitung für ~8,6 MB, bei ~1 Mbit/s rund 70 s. Die 8 s des
/// gemeinsamen Clients reichen nicht; da der Lauf niemanden blockiert, kostet die lange
/// Schranke nur einen gebundenen Hintergrund-Task.
const ODL_GRUNDPEGEL_TIMEOUT: Duration = Duration::from_secs(90);
/// Nach einem Fehlschlag eine Stunde Ruhe — sonst fragte jeder 10-min-Poll erneut 8,6 MB
/// bei einem GeoServer an, der gerade nicht kann.
const ODL_GRUNDPEGEL_ABKUEHLUNG: Duration = Duration::from_secs(3600);
static ODL_GRUNDPEGEL_FEHLSCHLAG: Mutex<Option<std::time::Instant>> = Mutex::new(None);
/// Zeitreihe ALLER Sonden, sieben Tage, Stundenwerte (gemessen 21.09.2026: 263 687 Werte).
/// Der Filter wählt die Stichprobe; `propertyName` spart Volumen (`name` kommt trotzdem mit).
const ODL_ZEITREIHE_URL: &str = "https://www.imis.bfs.de/ogc/opendata/ows?service=WFS&version=1.1.0&request=GetFeature&typeName=opendata:odlinfo_timeseries_odl_1h&outputFormat=application/json&propertyName=id,end_measure,value,unit&CQL_FILTER=";

/// Muss der Grundpegel neu geholt werden? Rein: fehlt er oder ist er älter als die TTL,
/// und läuft keine Abkühlung nach einem Fehlschlag — dieselben Bausteine wie bei der
/// Autobahn-Ebene.
pub(crate) fn grundpegel_anstossen(
    eintrag_alter: Option<i64>,
    seit_fehlschlag: Option<Duration>,
) -> bool {
    autobahn_weg(eintrag_alter, ODL_GRUNDPEGEL_TTL) != AutobahnWeg::Frisch
        && autobahn_darf_starten(seit_fehlschlag, ODL_GRUNDPEGEL_ABKUEHLUNG)
}

fn stosse_grundpegel_an(s: &FachebenenState, pool: &SqlitePool, eintrag_alter: Option<i64>) {
    let seit_fehlschlag = ODL_GRUNDPEGEL_FEHLSCHLAG
        .lock()
        .unwrap()
        .map(|t| t.elapsed());
    if !grundpegel_anstossen(eintrag_alter, seit_fehlschlag) {
        return;
    }
    let key = odl_grundpegel::CACHE_SCHLUESSEL;
    if !s.inflight.lock().unwrap().insert(key.to_string()) {
        return; // läuft schon
    }
    let (client, pool, inflight) = (s.client.clone(), pool.clone(), s.inflight.clone());
    tokio::spawn(async move {
        let ok = erneuere_grundpegel(client, pool).await;
        // Erst den Ausgang vermerken, dann freigeben (Begründung bei `fetch_autobahn`).
        *ODL_GRUNDPEGEL_FEHLSCHLAG.lock().unwrap() = if ok {
            None
        } else {
            Some(std::time::Instant::now())
        };
        inflight.lock().unwrap().remove(key);
    });
}

async fn erneuere_grundpegel(client: reqwest::Client, pool: SqlitePool) -> bool {
    let jetzt = chrono::Utc::now();
    let filter = odl_grundpegel::cql_filter(&odl_grundpegel::zeitpunkte(jetzt));
    let url = format!(
        "{ODL_ZEITREIHE_URL}{}",
        percent_encoding::utf8_percent_encode(&filter, percent_encoding::NON_ALPHANUMERIC)
    );
    let roh = match client
        .get(&url)
        .timeout(ODL_GRUNDPEGEL_TIMEOUT)
        .send()
        .await
    {
        Ok(r) if r.status().is_success() => match r.json::<Value>().await {
            Ok(v) => v,
            Err(e) => {
                tracing::warn!("BfS-ODL-Zeitreihe nicht lesbar: {e}");
                return false;
            }
        },
        Ok(r) => {
            tracing::warn!("BfS-ODL-Zeitreihe: HTTP {}", r.status());
            return false;
        }
        Err(e) => {
            tracing::warn!("BfS-ODL-Zeitreihe-Fetch fehlgeschlagen: {e}");
            return false;
        }
    };
    let alt = cache::eintrag_wert::<GrundpegelKarte>(&pool, odl_grundpegel::CACHE_SCHLUESSEL)
        .await
        .map(|(k, _)| k)
        .unwrap_or_default();
    let Some(karte) = odl_grundpegel::neue_karte(&roh, &alt, jetzt) else {
        tracing::warn!(
            "BfS-ODL-Zeitreihe unbrauchbar (Formatbruch, leer oder weniger als die Hälfte der \
             {} bekannten Sonden) — alter Grundpegel bleibt",
            alt.len()
        );
        return false;
    };
    tracing::info!("ODL-Grundpegel für {} Sonden berechnet", karte.len());
    cache::setze_wert(&pool, odl_grundpegel::CACHE_SCHLUESSEL, &karte).await
}

async fn erneuere_odl(client: reqwest::Client, pool: SqlitePool) -> Option<FachebeneAntwort> {
    let roh = match hole_json(&client, ODL_URL).await {
        Ok(roh) => roh,
        Err(e) => {
            tracing::warn!("BfS-ODL-Fetch fehlgeschlagen: {e}");
            return None;
        }
    };
    let Some(a) = odl_antwort(&roh) else {
        tracing::warn!("BfS-ODL-Antwort ohne `features`-Liste — Formatbruch, alter Stand bleibt");
        return None;
    };
    cache::setze(&pool, "odl", &a).await;
    Some(a)
}

/// Rohe BfS-Antwort → speicherbare Antwort, oder `None` bei Formatbruch. Rein und damit
/// ohne Netz prüfbar, und zwar an der Stelle, an der die Entscheidung wirkt (Muster
/// [`autobahn_antwort`]): wer `None` bekommt, schreibt nichts in den Cache.
///
/// Ohne `features`-LISTE ist die Antwort unbrauchbar, nicht leer. Ein GeoServer meldet
/// Fehler gern mit HTTP 200 und einem Report-Objekt; als `leer` gespeichert zeigte die
/// Ebene zehn Minuten lang „keine Sonden", wo sie „offline" zeigen muss.
pub(crate) fn odl_antwort(roh: &Value) -> Option<FachebeneAntwort> {
    roh.get("features").filter(|f| f.is_array())?;
    Some(FachebeneAntwort::ok(
        "odl",
        ODL_ATTRIB,
        None,
        normalisiere_odl(roh),
    ))
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

// KRITIS selbst kommt seit LFH-83 aus dem bundesweiten OSM-Extrakt (`karte::kritis::bestand`),
// nicht mehr aus einem Live-Overpass-Abruf je Anfrage — `fetch_kritis`/`erneuere_kritis` samt
// ihrer KRITIS-eigenen Overpass-Query sind deshalb entfallen. `hole_overpass` bleibt: Energie
// (LFH-81) braucht denselben Mehrfach-Endpunkt-Abruf für `power=plant`.
/// Overpass antwortet langsamer als das globale Client-Timeout (8 s) — interne `[timeout:25]`.
const OVERPASS_TIMEOUT: Duration = Duration::from_secs(30);
/// Hauptinstanz ist oft überlastet (TimedOut) → Mirror als Fallback.
const OVERPASS_URLS: [&str; 2] = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
];

/// Overpass-Abruf über [`OVERPASS_URLS`], der Reihe nach (eigenes, längeres Timeout).
/// Einzelfehler nur debug, erst wenn ALLE scheitern eine warn-Meldung (weniger Log-Rauschen).
async fn hole_overpass(client: &reqwest::Client, query: &str, ebene: &str) -> Option<Value> {
    for url in OVERPASS_URLS {
        let resp = client
            .post(url)
            .timeout(OVERPASS_TIMEOUT)
            .header("Content-Type", "text/plain")
            .body(query.to_string())
            .send()
            .await;
        match resp {
            Ok(r) if r.status().is_success() => match r.json::<serde_json::Value>().await {
                Ok(roh) => return Some(roh),
                Err(e) => tracing::debug!("Overpass-JSON-Parse ({url}) fehlgeschlagen: {e}"),
            },
            Ok(r) => tracing::debug!("Overpass ({url}) HTTP {}", r.status()),
            Err(e) => tracing::debug!("Overpass-Fetch ({url}) fehlgeschlagen: {e}"),
        }
    }
    tracing::warn!("Overpass nicht erreichbar (alle Endpunkte) — {ebene} aus Cache/leer");
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
    // Bis zur ersten Fundstelle mit ZIFFERN-Argument laufen, nicht bloß bis zur ersten
    // Fundstelle: dieselbe Marke trägt auch die Funktionsdefinition (`addLagePegel(ki)`).
    html.match_indices(LHP_KI_MARKE).find_map(|(i, _)| {
        let rest = &html[i + LHP_KI_MARKE.len()..];
        let token = &rest[..rest.find(')')?];
        (!token.is_empty() && token.bytes().all(|b| b.is_ascii_digit())).then(|| token.to_string())
    })
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

/// Trägt dieser Teilabruf überhaupt eine Dienst-Liste? HTTP 200 mit gültigem JSON heisst
/// NICHT, dass Daten drinstehen: ein `{}` oder ein Fehlerumschlag des Portals parst
/// anstandslos. Ohne diese Prüfung zählte so eine Antwort als beantwortet, der
/// Normalisierer überspränge sie still — und 333 davon ergäben eine „vollständige" Antwort
/// mit null Features.
fn autobahn_nutzlast(eintrag: &(String, String, Value)) -> bool {
    let (_, dienst, antwort) = eintrag;
    antwort.get(dienst).is_some_and(Value::is_array)
}

/// Ergebnis eines Fächer-Laufs → speicherbare Antwort, oder `None`, wenn der Lauf zu
/// löchrig war. Rein und damit ohne Netz prüfbar — und zwar **an der Stelle, an der die
/// Entscheidung wirkt**: wer hier `None` bekommt, schreibt nichts in den Cache und lässt den
/// bisherigen Stand stehen. Eine Schwelle, die nur als eigene Prädikatsfunktion getestet
/// wird, kann an der Aufrufstelle entfallen, ohne dass ein Test rot wird.
///
/// Gezählt wird, was eine **Dienst-Liste trägt**, nicht was ein HTTP 200 erwidert hat —
/// sonst hinge die Schwelle an der Zustellung statt am Inhalt.
///
/// Die Schwelle ist die **Hälfte**, und das ist eine Abwägung, keine Messung: ein bis zwei
/// Ausfälle je Lauf sind normal (Drosselung) und dürfen den Lauf nicht verwerfen — sonst
/// veraltete die Ebene dauerhaft. Fällt dagegen mehr als die Hälfte aus, ist ein
/// gespeicherter Teilstand schlechter als der bisherige: er sieht vollständig aus, ist es
/// aber nicht, und niemand sieht ihm das an.
pub(crate) fn autobahn_antwort(
    gesamt: usize,
    roh: &[(String, String, Value)],
) -> Option<FachebeneAntwort> {
    let brauchbar = roh.iter().filter(|e| autobahn_nutzlast(e)).count();
    if brauchbar == 0 || brauchbar * 2 <= gesamt {
        return None;
    }
    Some(FachebeneAntwort::ok(
        "autobahn",
        AUTOBAHN_ATTRIB,
        None,
        normalisiere_autobahn(roh),
    ))
}

/// Nach einem GESCHEITERTEN Lauf wird nicht sofort neu versucht. Ohne diese Sperre trommelt
/// eine anhaltende Störung die Quelle: die Ebene meldet `offline`, das Frontend pollt
/// deshalb im Aufwärmtakt (20 s), und jeder Poll stiesse einen neuen Fächer mit 333 Abrufen
/// an — gegen einen Anbieter, der ohnehin gerade nicht kann. Fünf Minuten sind kurz genug,
/// dass eine Erholung zeitnah ankommt, und lang genug, dass aus dem Takt kein Dauerfeuer wird.
const AUTOBAHN_ABKUEHLUNG: Duration = Duration::from_secs(300);

/// Zeitpunkt des letzten GESCHEITERTEN Laufs; `None` heisst „kein Fehlschlag offen".
/// `std::sync::Mutex`, nie über ein `await` gehalten (wie `inflight`).
static AUTOBAHN_FEHLSCHLAG: Mutex<Option<std::time::Instant>> = Mutex::new(None);

/// Darf ein neuer Fächer starten? Rein und ohne Uhr prüfbar (die Zeitspanne kommt von aussen).
pub(crate) fn autobahn_darf_starten(
    seit_fehlschlag: Option<Duration>,
    abkuehlung: Duration,
) -> bool {
    match seit_fehlschlag {
        None => true,
        Some(vergangen) => vergangen >= abkuehlung,
    }
}

/// Entscheidung je Cache-Zustand — rein und ohne Netz prüfbar. Die Fälle sind dieselben wie
/// in [`liefere_mit_swr`], **mit einer Ausnahme, die der ganze Grund für diese Funktion ist**:
/// der KALTE Fall wartet nicht.
#[derive(Debug, PartialEq, Eq)]
pub(crate) enum AutobahnWeg {
    /// Frischer Cache → unverändert ausliefern, nichts anstoßen.
    Frisch,
    /// Veraltet → alten Stand ausliefern, im Hintergrund erneuern.
    AltUndErneuern,
    /// Gar nichts da → sofort `offline` antworten, im Hintergrund erstmalig füllen.
    LeerUndErneuern,
}

pub(crate) fn autobahn_weg(eintrag_alter: Option<i64>, ttl: Duration) -> AutobahnWeg {
    match eintrag_alter {
        Some(alter) if alter < ttl.as_secs() as i64 => AutobahnWeg::Frisch,
        Some(_) => AutobahnWeg::AltUndErneuern,
        None => AutobahnWeg::LeerUndErneuern,
    }
}

/// Die Autobahn-Ebene benutzt [`liefere_mit_swr`] **nicht**, und das ist der Kern ihrer
/// Besonderheit: dessen kalter Zweig wartet auf `erneuere()`, und genau das geht hier nicht.
///
/// Gemessen: ein voller Fächer dauert ~25 s. Dagegen stehen ZWEI Schranken, die beide vor ihm
/// feuern würden — `apiGet` im Frontend bricht nach 15 s ab (`api/client.ts`), und
/// [`crate::zulassung::REQUEST_BUDGET`] kappt den Handler nach 60 s mit einem 503. Die
/// Schranke in `zulassung.rs` trägt sogar die Begründung, die Routen mit ausgehendem Aufruf
/// hätten „deutlich kürzere" eigene Timeouts und feuerten „immer zuerst" — ein blockierender
/// 25-s-Fächer bricht genau diese Zusage. Das erste Einschalten der Ebene liefe damit
/// zuverlässig in einen Netzfehler statt in Daten.
///
/// Deshalb hängt der teure Lauf an KEINEM Request: er läuft als eigene Aufgabe, und die
/// Anfrage ist sofort beantwortet. Der Preis ist eine Aufwärmphase, in der die Ebene
/// `offline` meldet, obwohl sie gerade erst lädt; das Frontend pollt währenddessen kurz
/// getaktet (`FACHEBENEN.autobahn.aufwaermPollMs`) und hat den ersten Stand nach ~30 s.
pub async fn fetch_autobahn(s: &FachebenenState, pool: &SqlitePool) -> FachebeneAntwort {
    let eintrag = cache::eintrag(pool, "autobahn").await;
    let weg = autobahn_weg(eintrag.as_ref().map(|(_, alter)| *alter), AUTOBAHN_TTL);
    if weg == AutobahnWeg::Frisch {
        return eintrag.expect("Frisch entsteht nur aus einem Eintrag").0;
    }
    // Zwei Riegel vor dem Lauf. ERSTENS die Abkühlung nach einem Fehlschlag — ohne sie
    // stiesse jeder Aufwärm-Poll einen neuen Fächer an, solange die Quelle gestört ist.
    let seit_fehlschlag = AUTOBAHN_FEHLSCHLAG.lock().unwrap().map(|t| t.elapsed());
    let darf = autobahn_darf_starten(seit_fehlschlag, AUTOBAHN_ABKUEHLUNG);
    // ZWEITENS nur EIN Lauf gleichzeitig (wie der stale-Zweig von `liefere_mit_swr`). Der
    // Schlüssel wird erst freigegeben, wenn die Aufgabe durch ist — ein Poll währenddessen
    // stösst nichts Zweites an, was bei 333 Abrufen je Lauf der ganze Punkt ist.
    if darf && s.inflight.lock().unwrap().insert("autobahn".to_string()) {
        let (client, pool2, inflight) = (s.client.clone(), pool.clone(), s.inflight.clone());
        tokio::spawn(async move {
            let ergebnis = erneuere_autobahn(client, pool2).await;
            // Erst den Ausgang vermerken, dann freigeben: andersherum könnte ein Poll
            // dazwischen den Schlüssel greifen und lospreschen, bevor die Sperre steht.
            *AUTOBAHN_FEHLSCHLAG.lock().unwrap() = match ergebnis {
                Some(_) => None,
                None => Some(std::time::Instant::now()),
            };
            inflight.lock().unwrap().remove("autobahn");
        });
    } else if !darf {
        tracing::debug!("Autobahn: Abkühlung nach Fehlschlag läuft — kein neuer Fächer");
    }
    match eintrag {
        Some((a, _)) => a, // veralteter Stand ist besser als keiner
        None => FachebeneAntwort::offline("autobahn", AUTOBAHN_ATTRIB),
    }
}

/// Einzelspur für den Fächer. `liefere_mit_swr` entkoppelt nur die HINTERGRUND-Erneuerung
/// (veralteter Cache) über `inflight`; sein **kalter** Zweig wartet direkt auf `erneuere()`
/// und kennt keinen Riegel. Bei einer Ebene mit EINEM Abruf ist das belanglos — hier
/// startete jeder Bediener, der die Ebene bei leerem Cache einschaltet, seine eigenen 333
/// Abrufe. Schon zwei gleichzeitig ergäben die 16er-Nebenläufigkeit, bei der die Quelle
/// gemessen drosselt; eine Anfangswelle vervielfachte das weiter.
///
/// Bewusst hier statt im geteilten `liefere_mit_swr`: dessen kalter Zweig trägt fünf weitere
/// Ebenen, für die der Riegel nichts verbessert und deren Verhalten sich ändern würde.
static AUTOBAHN_EINZELSPUR: OnceLock<tokio::sync::Mutex<()>> = OnceLock::new();

async fn erneuere_autobahn(client: reqwest::Client, pool: SqlitePool) -> Option<FachebeneAntwort> {
    // Wer wartet, fetcht danach NICHT blind nach: der Vorgänger hat den Cache in aller Regel
    // gerade gefüllt. Der Wartende bekommt damit DATEN statt `offline` — das ist der
    // Unterschied zu einem Riegel, der den Zweiten einfach abweist.
    let _spur = AUTOBAHN_EINZELSPUR
        .get_or_init(|| tokio::sync::Mutex::new(()))
        .lock()
        .await;
    if let Some((a, alter)) = cache::eintrag(&pool, "autobahn").await {
        if alter < AUTOBAHN_TTL.as_secs() as i64 {
            tracing::debug!("Autobahn: Lauf übersprungen, Vorgänger hat frisch gefüllt");
            return Some(a);
        }
    }
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
    // Ein zu löchriger Lauf wird VERWORFEN statt gespeichert. Ohne diesen Riegel schriebe ein
    // Totalausfall der Dienste (Streckenliste antwortet, alle 333 Teilabrufe nicht) eine
    // Antwort mit null Features in den Cache und überschriebe damit den gesunden Stand — die
    // Ebene meldete zehn Minuten lang „keine Daten", statt den alten Stand weiterzureichen.
    // Genau diese Zusicherung ist der Zweck des SWR-Caches; `None` lässt ihn stehen.
    let Some(a) = autobahn_antwort(gesamt, &roh) else {
        tracing::warn!(
            "Autobahn: nur {} von {gesamt} Teilabrufen beantwortet — Lauf verworfen, \
             bisheriger Cache-Stand bleibt",
            roh.len()
        );
        return None;
    };
    // Ein misslungener Schreibvorgang ist hier ein FEHLSCHLAG, nicht eine Randnotiz: dieser
    // Lauf hängt an keinem Request, sein einziges Ergebnis IST der Cache-Eintrag. Meldete
    // `setze` den Fehler nur ins Log und der Lauf trotzdem Erfolg, fiele die Abkühlung, der
    // Cache bliebe leer — und der nächste Aufwärm-Poll 20 s später stiesse den nächsten
    // Fächer mit 333 Abrufen an, dauerhaft. Das ist derselbe Schaden wie beim Quell-Ausfall,
    // nur durch die Tür, die die Abkühlung nicht abdeckt (SQLite busy, Platte voll,
    // read-only). Die fünf anderen Ebenen dürfen den Wert weiter ignorieren: sie reichen
    // ihre Antwort im selben Request weiter, für sie ist der Cache eine Beschleunigung.
    if !cache::setze(&pool, "autobahn", &a).await {
        tracing::warn!("Autobahn: Lauf nicht speicherbar — gilt als Fehlschlag, Abkühlung greift");
        return None;
    }
    Some(a)
}

// ------------------------------------------------------------------ LUFTQUALITÄT (UBA)

/// Pflicht-Attribution. Die Lizenzlage ist nur sekundär belegt (siehe Lizenz-Vorbehalt in
/// `docs/fachebenen-quellen.md`); die Quellennennung wird deshalb immer mitgeführt.
const LUFTQUALITAET_ATTRIB: &str = "Umweltbundesamt";
/// Die Quelle liefert stündliche Werte zu einem unregelmäßigen Importzeitpunkt mit ~2 h
/// Verzug. Eine Stunde TTL (die „Analogie zu KRITIS") legte eine weitere Stunde darauf.
const LUFTQUALITAET_TTL: Duration = Duration::from_secs(900);
/// Finaler Host: `https://www.umweltbundesamt.de/api/air_data/v2` antwortet gemessen mit 301
/// hierher (Bindestrich statt Unterstrich). Kein Verlass auf die Weiterleitung.
const LUFTQUALITAET_BASIS: &str = "https://luftdaten.umweltbundesamt.de/api/air-data/v2";

/// Die beiden Abruf-URLs eines Laufs (Stationsliste, Index im Acht-Stunden-Fenster).
/// `index=id` steht explizit — das Echo der Quelle meldet trotzdem mal `code` (gemessen),
/// weshalb der Normalisierer zusätzlich über den Stationscode auflöst.
pub(crate) fn luftqualitaet_urls(jetzt: chrono::DateTime<chrono::Utc>) -> (String, String) {
    let fenster = luftqualitaet_fenster(jetzt)
        .iter()
        .map(|(k, v)| format!("{k}={v}"))
        .collect::<Vec<_>>()
        .join("&");
    (
        format!("{LUFTQUALITAET_BASIS}/stations/json?lang=de&index=id"),
        format!("{LUFTQUALITAET_BASIS}/airquality/json?{fenster}&lang=de&index=id"),
    )
}

/// Umschlag aus den beiden Abrufen eines Laufs. `None` = Lauf gescheitert: einer der Abrufe
/// schlug fehl oder die Antwort ist strukturell unbrauchbar. Beides darf NICHT als `leer`
/// in den Cache, sonst überdeckte es 15 Minuten lang den letzten guten Stand.
pub(crate) fn luftqualitaet_antwort(
    stationen: Result<Value, String>,
    index: Result<Value, String>,
) -> Option<FachebeneAntwort> {
    let (stationen, index) = match (stationen, index) {
        (Ok(s), Ok(i)) => (s, i),
        (Err(e), _) | (_, Err(e)) => {
            tracing::warn!("Luftqualität-Fetch fehlgeschlagen: {e}");
            return None;
        }
    };
    let Some((fc, stand)) = normalisiere_luftqualitaet(&stationen, &index) else {
        tracing::warn!("Luftqualität: Antwort der Quelle strukturell unbrauchbar");
        return None;
    };
    Some(FachebeneAntwort::ok(
        "luftqualitaet",
        LUFTQUALITAET_ATTRIB,
        stand,
        fc,
    ))
}

pub async fn fetch_luftqualitaet(s: &FachebenenState, pool: &SqlitePool) -> FachebeneAntwort {
    let (client, pool2) = (s.client.clone(), pool.clone());
    liefere_mit_swr(
        pool,
        &s.inflight,
        "luftqualitaet",
        LUFTQUALITAET_TTL,
        || FachebeneAntwort::offline("luftqualitaet", LUFTQUALITAET_ATTRIB),
        move || erneuere_luftqualitaet(client, pool2),
    )
    .await
}

/// Zwei Abrufe je Lauf (Stationsliste ~560 KB, Index ~210 KB), nebenläufig — gemessen beide
/// unter einer Sekunde, der Lauf darf also blockierend am ersten Request hängen.
async fn erneuere_luftqualitaet(
    client: reqwest::Client,
    pool: SqlitePool,
) -> Option<FachebeneAntwort> {
    let (url_stationen, url_index) = luftqualitaet_urls(chrono::Utc::now());
    let (stationen, index) = futures::join!(
        hole_json(&client, &url_stationen),
        hole_json(&client, &url_index)
    );
    let a = luftqualitaet_antwort(stationen, index)?;
    cache::setze(&pool, "luftqualitaet", &a).await;
    Some(a)
}

// ------------------------------------------------------------------ ENERGIE (LFH-81)
//
// Hybride Fachebene aus zwei unabhängig gecachten Teilen, die erst bei der Anfrage
// zusammengeführt werden (design.md, Entscheidung 1):
//
// | Teil            | Schlüssel                    | TTL  | kalter Pfad                                    |
// |-----------------|------------------------------|------|------------------------------------------------|
// | OSM power=plant | `energie:osm:<bbox gerundet>` | 24 h | gelöst, 30 s je Endpunkt, Abfrage auf bbox + 6 km |
// | MaStR-Abzug     | `energie:mastr` (bundesweit)  | 24 h | gelöst, 30 s je Seite, 5-min-Sperre            |
//
// „Gelöst" heißt: der Abruf läuft als eigene Task, die Anfrage wartet auf beide Teile
// zusammen höchstens `ENERGIE_WARTE` (10 s) und antwortet dann mit dem, was da ist. Grund
// (Review-Befund zu LFH-81): das Frontend bricht nach 15 s ab, ein blockierendes Warten auf
// den langsameren Teil ließ die GANZE Ebene offline wirken, obwohl der andere da war — und
// verwarf axum den Handler-Future beim Abbruch, starb der MaStR-Abruf mit ihm, ohne je die
// Sperre zu setzen. Die Task schreibt Cache bzw. Sperre auch nach der Antwort zu Ende.

/// Beide Teile ändern sich kaum → einen Tag cachen, veraltet im Hintergrund erneuern.
const ENERGIE_TTL: Duration = Duration::from_secs(24 * 3600);
const ENERGIE_OSM_PRAEFIX: &str = "energie:osm";
const ENERGIE_MASTR_KEY: &str = "energie:mastr";
/// So lange wartet eine Anfrage höchstens auf kalte Teile (beide zusammen, nicht je Teil).
const ENERGIE_WARTE: Duration = Duration::from_secs(10);
/// Gemessen (21.09.2026): ~7 s und 5,2 MB für den ganzen Abzug — das globale
/// Client-Timeout (8 s) reichte dafür nicht verlässlich.
const ENERGIE_MASTR_TIMEOUT: Duration = Duration::from_secs(30);
const ENERGIE_MASTR_BASIS: &str = "https://www.marktstammdatenregister.de/MaStR/Einheit/EinheitJson/GetErweiterteOeffentlicheEinheitStromerzeugung";
/// Upstream-Filter, fertig URL-kodiert. Klartext:
/// `Nettonennleistung der Einheit~gt~10000~and~Koordinate: Breitengrad (WGS84)~gt~-90~and~Betriebs-Status~eq~'35,37'`
/// — über 10 MW (kW-Angabe; `gt` ist undokumentiert, arbeitet aber live numerisch), mit
/// Koordinate (`NULL` erfüllt keinen Bereichsvergleich) und im Status „In Betrieb" (35) oder
/// „Vorübergehend stillgelegt" (37). Die Feldnamen sind Anzeigenamen des Portals und können
/// sich still ändern; deshalb gilt eine unerwartete Antwortform als Fehlschlag.
const ENERGIE_MASTR_FILTER: &str = "Nettonennleistung%20der%20Einheit~gt~10000~and~Koordinate%3A%20Breitengrad%20%28WGS84%29~gt~-90~and~Betriebs-Status~eq~%2735%2C37%27";
const ENERGIE_MASTR_SEITE: u64 = 2000;
/// Obergrenze der Seitenschleife. Heute reicht eine Seite (1267 Einheiten); die Grenze hält
/// eine kaputte `Total`-Angabe davon ab, das Portal mit Seitenabrufen zu überziehen.
const ENERGIE_MASTR_MAX_SEITEN: u64 = 10;

/// Nach einem gescheiterten MaStR-Abruf ruht der Upstream fünf Minuten. Seit der kalte
/// Pfad gelöst ist, hält ein gestörter MaStR die Anfrage höchstens `ENERGIE_WARTE` auf; die
/// Sperre sorgt dafür, dass es nicht bei JEDEM Verschieben der Karte so ist und dass nicht
/// jede Anfrage einen neuen Abzug gegen ein Portal startet, das gerade nicht antwortet. Mit
/// ihr bekommt die Anfrage sofort den OSM-Anteil. Gesetzt wird sie nur von einem echten
/// Fehlschlag in der gelösten Task — eine gerissene Wartefrist ist keiner.
const ENERGIE_MASTR_ABKUEHLUNG: Duration = Duration::from_secs(300);
static ENERGIE_MASTR_FEHLSCHLAG: Mutex<Option<std::time::Instant>> = Mutex::new(None);
/// Einzelspur für den 5-MB-Abruf. Die `inflight`-Marke in `liefere_geloest` hält parallele
/// Anfragen schon davon ab, einen zweiten Abruf zu starten; die Spur ist die Rückfallebene
/// dahinter (eine Marke gilt nur für EINE `inflight`-Menge). Wer gewartet hat, bekommt den
/// frischen Stand des Vorgängers aus dem Cache.
static ENERGIE_MASTR_EINZELSPUR: OnceLock<tokio::sync::Mutex<()>> = OnceLock::new();

/// Die beiden prozessweiten Riegel des MaStR-Abrufs als Naht: Produktion reicht die
/// Statics durch ([`MastrRiegel::prozess`]), ein Test seine eigenen. Ohne die Naht schrieben
/// parallel laufende Tests dieselbe Fehlschlag-Uhr — ein Test, der die Sperre setzt, hielte
/// einen zweiten, der gerade abrufen will, still an.
#[derive(Clone, Copy)]
struct MastrRiegel {
    fehlschlag: &'static Mutex<Option<std::time::Instant>>,
    spur: &'static tokio::sync::Mutex<()>,
}

impl MastrRiegel {
    fn prozess() -> Self {
        MastrRiegel {
            fehlschlag: &ENERGIE_MASTR_FEHLSCHLAG,
            spur: ENERGIE_MASTR_EINZELSPUR.get_or_init(|| tokio::sync::Mutex::new(())),
        }
    }
}

/// Zuordnungsradius OSM-Anlage ↔ MaStR-Einheit (design.md, Entscheidung 4), **gemessen**
/// am 21.09.2026 (Aufgabe 2.4): 18 zufällige MaStR-Einheiten (je 6 Wasser, Speicher, Solar,
/// Seed 81) gegen OSM `power=plant` im Umkreis von 5 km, 17 auswertbar. Echte Paare
/// (gleichnamig bzw. Einheitenpunkt in der OSM-Fläche) lagen bei Wasser 29–289 m, Speicher
/// 20–113 m (Pumpspeicher Happurg eingerechnet), Solar 27–729 m — Höchstwert 729 m
/// (Solarpark Halberstadt, flächig). Der kleinste Abstand zu einer gleichartigen Anlage, die
/// NICHT dieselbe war, betrug 2,4 km (Elsterheide), der nächste 4,2 km. 2 km deckt also jedes
/// gemessene Paar mit fast dreifacher Reserve und bleibt unter dem nächsten Fehlpaar; ein
/// größerer Radius holte genau diese Fehlpaare herein.
pub(crate) const ENERGIE_RADIUS_M: f64 = 2000.0;

pub(crate) fn mastr_url(seite: u64) -> String {
    format!(
        "{ENERGIE_MASTR_BASIS}?filter={ENERGIE_MASTR_FILTER}&pageSize={ENERGIE_MASTR_SEITE}&page={seite}"
    )
}

/// Seitenzahl aus `Total`. 0 ist ein Fehlschlag (keine Großanlage in Deutschland ist keine
/// glaubwürdige Antwort), zu viele Seiten ebenso.
pub(crate) fn mastr_seiten(total: u64) -> Result<u64, String> {
    if total == 0 {
        return Err("MaStR meldet Total 0".into());
    }
    let seiten = total.div_ceil(ENERGIE_MASTR_SEITE);
    if seiten > ENERGIE_MASTR_MAX_SEITEN {
        return Err(format!(
            "MaStR meldet Total {total} — mehr als {ENERGIE_MASTR_MAX_SEITEN} Seiten"
        ));
    }
    Ok(seiten)
}

/// Darf ein neuer MaStR-Abruf starten? Rein und ohne Uhr prüfbar.
pub(crate) fn mastr_darf_starten(seit_fehlschlag: Option<Duration>, abkuehlung: Duration) -> bool {
    match seit_fehlschlag {
        None => true,
        Some(vergangen) => vergangen >= abkuehlung,
    }
}

/// Nur `power=plant`: `power=generator` sind Einzelaggregate, `power=substation` steht schon
/// in der KRITIS-Ebene und würde doppelt eingezeichnet.
fn energie_overpass_query(bbox_op: &str) -> String {
    format!("[out:json][timeout:25];nwr[power=plant]({bbox_op});out center tags;")
}

/// Overpass-Abfrage für einen Ausschnitt: auf den um [`ENERGIE_OSM_RAND_RADIEN`]
/// Zuordnungsradien erweiterten Rand, damit die Zusammenführung an der Kante jede Anlage
/// sieht, die eine Einheit im Ausschnitt an sich ziehen kann (siehe
/// [`fuehre_energie_zusammen`]). Der Cache-Schlüssel bleibt am ORIGINAL-Raster.
fn energie_osm_abfrage(bbox: &Bbox) -> String {
    let rand = bbox.erweitert_um_m(ENERGIE_OSM_RAND_RADIEN * ENERGIE_RADIUS_M);
    energie_overpass_query(&rand.overpass())
}

/// Größte Spanne eines Energie-Ausschnitts in Grad, je Achse. Bis LFH-83 stand diese Grenze
/// in [`Bbox::parse`] und galt für KRITIS mit; seit KRITIS aus dem Extrakt-Bestand kommt, hat
/// `parse` keine Größengrenze mehr. Die Energie-Ebene fragt Overpass aber weiter live je
/// Ausschnitt — ohne eigene Grenze löste eine Deutschland-bbox eine bundesweite
/// Overpass-Abfrage aus.
///
/// 3° statt der früheren 1°: die Ebene fragt ab Zoom 10, und dort ist ein Grad rund 1456 px
/// breit. Ein 1920-px-Schirm zeigt damit schon ~1,3°, ein 4K-Schirm ~2,6° — mit 1° antwortete
/// das Backend dort 400, und die Ebene stand leer auf „offline". `power=plant` ist dünn
/// besetzt, drei Grad sind für Overpass eine kleine Abfrage; ganz Deutschland (~10°) bleibt
/// abgelehnt. Das Frontend bremst mit derselben Zahl vorher (`ENERGIE_MAX_SPANNE_GRAD` in
/// `pages/lagekarte/fachebenen.ts`).
const ENERGIE_MAX_SPANNE_GRAD: f64 = 3.0;

/// Ist der Ausschnitt klein genug für eine Overpass-Abfrage? Rein, damit die Grenze ohne
/// Route prüfbar ist. Geprüft wird der ANGEFRAGTE Ausschnitt, vor dem Rand aus
/// [`energie_osm_abfrage`] — der darf über die Grenze hinauswachsen.
pub(crate) fn pruefe_energie_bbox(bbox: &Bbox) -> Result<(), String> {
    if bbox.ost - bbox.west > ENERGIE_MAX_SPANNE_GRAD
        || bbox.nord - bbox.sued > ENERGIE_MAX_SPANNE_GRAD
    {
        return Err("bbox zu groß — weiter hineinzoomen".to_string());
    }
    Ok(())
}

pub async fn fetch_energie(
    s: &FachebenenState,
    pool: &SqlitePool,
    bbox_roh: &str,
) -> Result<FachebeneAntwort, AppError> {
    let bbox = Bbox::parse(bbox_roh).map_err(AppError::Validation)?;
    pruefe_energie_bbox(&bbox).map_err(AppError::Validation)?;
    let (c1, p1, c2, p2) = (
        s.client.clone(),
        pool.clone(),
        s.client.clone(),
        pool.clone(),
    );
    let key = bbox.cache_key_mit(ENERGIE_OSM_PRAEFIX);
    Ok(energie_kern(
        pool,
        &s.inflight,
        bbox,
        ENERGIE_WARTE,
        move || erneuere_energie_osm(c1, p1, bbox, key),
        move || {
            erneuere_energie_mastr(p2, MastrRiegel::prozess(), move || async move {
                hole_mastr(&c2).await
            })
        },
    )
    .await)
}

/// Kern von [`fetch_energie`] mit austauschbaren Abrufen und Wartefrist — so sind
/// Teilausfall, langsame und scheiternde Teile ohne Netz und ohne Uhr prüfbar.
///
/// `warte` gilt für die ganze Anfrage: beide Teile warten nebenläufig bis zu DEMSELBEN
/// Zeitpunkt, jeder für sich. Ein gemeinsames `timeout` um beide verlöre bei Ablauf auch den
/// Teil, der längst da ist — genau das, was die Frist verhindern soll.
async fn energie_kern<F1, F2>(
    pool: &SqlitePool,
    inflight: &Arc<Mutex<HashSet<String>>>,
    bbox: Bbox,
    warte: Duration,
    erneuere_osm: impl FnOnce() -> F1,
    erneuere_mastr: impl FnOnce() -> F2,
) -> FachebeneAntwort
where
    F1: Future<Output = Option<FachebeneAntwort>> + Send + 'static,
    F2: Future<Output = Option<FachebeneAntwort>> + Send + 'static,
{
    let osm_key = bbox.cache_key_mit(ENERGIE_OSM_PRAEFIX);
    let bis = tokio::time::Instant::now() + warte;
    let (osm, mastr) = tokio::join!(
        liefere_geloest(pool, inflight, &osm_key, ENERGIE_TTL, bis, erneuere_osm),
        liefere_geloest(
            pool,
            inflight,
            ENERGIE_MASTR_KEY,
            ENERGIE_TTL,
            bis,
            erneuere_mastr
        ),
    );
    let offline = || FachebeneAntwort::offline("energie", "");
    baue_energie_antwort(
        &osm.unwrap_or_else(offline),
        &mastr.unwrap_or_else(offline),
        &bbox,
    )
}

/// SWR mit **gelöstem** kalten Pfad — die Energie-Variante von [`liefere_mit_swr`], deren
/// kalter Zweig bewusst unverändert blockiert (die übrigen Ebenen hängen daran).
///
/// Frisch und veraltet wie dort. Kalt wird der Abruf per `tokio::spawn` von der Anfrage
/// gelöst und nur bis `bis` abgewartet. Reißt er die Frist, trägt der Teil zu DIESER Antwort
/// nichts bei (`None`) — der Abruf läuft aber weiter und schreibt Cache bzw. MaStR-Sperre
/// zu Ende, auch wenn axum den Handler-Future verwirft, weil der Client abgebrochen hat.
/// Holt schon eine andere Anfrage denselben Schlüssel, wartet diese hier nicht und trägt
/// nichts bei: ein zweiter Abruf wäre doppelte Last, ein Nachpollen des Cache holte die
/// Uhr zurück in die Antwort; die nächste Anfrage trifft den Cache.
async fn liefere_geloest<Fut>(
    pool: &SqlitePool,
    inflight: &Arc<Mutex<HashSet<String>>>,
    key: &str,
    ttl: Duration,
    bis: tokio::time::Instant,
    erneuere: impl FnOnce() -> Fut,
) -> Option<FachebeneAntwort>
where
    Fut: Future<Output = Option<FachebeneAntwort>> + Send + 'static,
{
    match cache::eintrag(pool, key).await {
        Some((a, alter)) if alter < ttl.as_secs() as i64 => Some(a),
        Some((a, _)) => {
            loese_ab(inflight, key, erneuere); // veraltet: Stand sofort, Refresh im Hintergrund
            Some(a)
        }
        None => {
            let abruf = loese_ab(inflight, key, erneuere)?;
            // Fällt der `JoinHandle` hier weg (Frist, Abbruch), läuft die Task trotzdem weiter.
            tokio::time::timeout_at(bis, abruf).await.ok()?.ok()?
        }
    }
}

/// Startet `erneuere` als eigene Task, sofern niemand den Schlüssel schon holt. Die
/// `inflight`-Marke fällt über [`InflightFreigabe`] auch dann, wenn der Abruf panikt — sonst
/// bliebe der Schlüssel bis zum Neustart gesperrt.
fn loese_ab<Fut>(
    inflight: &Arc<Mutex<HashSet<String>>>,
    key: &str,
    erneuere: impl FnOnce() -> Fut,
) -> Option<tokio::task::JoinHandle<Option<FachebeneAntwort>>>
where
    Fut: Future<Output = Option<FachebeneAntwort>> + Send + 'static,
{
    if !inflight.lock().unwrap().insert(key.to_string()) {
        return None;
    }
    let freigabe = InflightFreigabe {
        inflight: inflight.clone(),
        key: key.to_string(),
    };
    let abruf = erneuere();
    Some(tokio::spawn(async move {
        let _freigabe = freigabe;
        abruf.await
    }))
}

struct InflightFreigabe {
    inflight: Arc<Mutex<HashSet<String>>>,
    key: String,
}

impl Drop for InflightFreigabe {
    fn drop(&mut self) {
        // Nie mit Panik im Drop: ein vergifteter Mutex hält die Menge trotzdem.
        let mut menge = self.inflight.lock().unwrap_or_else(|e| e.into_inner());
        menge.remove(&self.key);
    }
}

/// Setzt die Antwort aus den beiden Teilen zusammen.
pub(crate) fn baue_energie_antwort(
    osm: &FachebeneAntwort,
    mastr: &FachebeneAntwort,
    bbox: &Bbox,
) -> FachebeneAntwort {
    use crate::karte::typen::FachebeneStatus;
    let osm_da = osm.status != FachebeneStatus::Offline;
    let mastr_da = mastr.status != FachebeneStatus::Offline;
    // `offline` genau dann, wenn KEIN Teil einen Stand hat (weder frisch noch aus dem Cache).
    if !osm_da && !mastr_da {
        return FachebeneAntwort::offline("energie", "");
    }
    let features = |a: &FachebeneAntwort| {
        a.features
            .get("features")
            .and_then(|f| f.as_array())
            .cloned()
            .unwrap_or_default()
    };
    let punkte = fuehre_energie_zusammen(&features(osm), &features(mastr), bbox, ENERGIE_RADIUS_M);
    let (osm_traegt_bei, mastr_traegt_bei) = energie_beitraege(&punkte);
    // `stand` ist der Zeitpunkt des MaStR-Abzugs — aus dessen eigenem Eintrag, damit ein
    // veralteter Stand seinen echten Zeitpunkt behält.
    let stand = if mastr_da { mastr.stand.clone() } else { None };
    FachebeneAntwort::ok(
        "energie",
        &energie_attribution(osm_traegt_bei, mastr_traegt_bei),
        stand,
        serde_json::json!({ "type": "FeatureCollection", "features": punkte }),
    )
}

async fn erneuere_energie_osm(
    client: reqwest::Client,
    pool: SqlitePool,
    bbox: Bbox,
    key: String,
) -> Option<FachebeneAntwort> {
    let roh = hole_overpass(&client, &energie_osm_abfrage(&bbox), "Energie").await?;
    let a = FachebeneAntwort::ok(
        "energie",
        ENERGIE_OSM_ATTRIB,
        None,
        normalisiere_energie_osm(&roh),
    );
    cache::setze(&pool, &key, &a).await;
    Some(a)
}

/// Holt den ganzen Abzug, Seite für Seite, bis `Total` erreicht ist.
async fn hole_mastr(client: &reqwest::Client) -> Result<Vec<Value>, String> {
    let mut alle = Vec::new();
    let mut seiten = 1;
    let mut seite = 1;
    loop {
        let resp = client
            .get(mastr_url(seite))
            .timeout(ENERGIE_MASTR_TIMEOUT)
            .send()
            .await
            .map_err(|e| e.to_string())?;
        if !resp.status().is_success() {
            return Err(format!("HTTP {}", resp.status()));
        }
        let roh: Value = resp.json().await.map_err(|e| e.to_string())?;
        if seite == 1 {
            let total = roh
                .get("Total")
                .and_then(|t| t.as_u64())
                .ok_or("MaStR-Antwort ohne Total")?;
            seiten = mastr_seiten(total)?;
        }
        let roh_anzahl = roh.get("Data").and_then(|d| d.as_array()).map(Vec::len);
        let punkte = normalisiere_energie_mastr(&roh)?;
        if roh_anzahl == Some(0) {
            // Eine leere Seite vor dem gemeldeten Ende hieße still abgeschnitten.
            return Err(format!("MaStR-Seite {seite} von {seiten} ist leer"));
        }
        alle.extend(punkte);
        if seite >= seiten {
            return Ok(alle);
        }
        seite += 1;
    }
}

async fn erneuere_energie_mastr<H, F>(
    pool: SqlitePool,
    riegel: MastrRiegel,
    hole: H,
) -> Option<FachebeneAntwort>
where
    H: FnOnce() -> F,
    F: Future<Output = Result<Vec<Value>, String>>,
{
    let _spur = riegel.spur.lock().await;
    // Wer gewartet hat, nimmt den frischen Stand des Vorgängers, statt nachzuholen.
    if let Some(a) = cache::frisch(&pool, ENERGIE_MASTR_KEY, ENERGIE_TTL.as_secs() as i64).await {
        return Some(a);
    }
    let seit_fehlschlag = riegel.fehlschlag.lock().unwrap().map(|t| t.elapsed());
    if !mastr_darf_starten(seit_fehlschlag, ENERGIE_MASTR_ABKUEHLUNG) {
        tracing::debug!("MaStR: Abkühlung nach Fehlschlag läuft — kein neuer Abruf");
        return None;
    }
    let ergebnis = hole().await.and_then(|punkte| {
        // Keine einzige Großanlage in Deutschland ist keine glaubwürdige Antwort.
        (!punkte.is_empty())
            .then_some(punkte)
            .ok_or_else(|| "MaStR-Abzug ohne georeferenzierte Einheit".to_string())
    });
    match ergebnis {
        Ok(punkte) => {
            *riegel.fehlschlag.lock().unwrap() = None;
            let stand = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true);
            let a = FachebeneAntwort::ok(
                "energie",
                ENERGIE_MASTR_ATTRIB,
                Some(stand),
                serde_json::json!({ "type": "FeatureCollection", "features": punkte }),
            );
            cache::setze(&pool, ENERGIE_MASTR_KEY, &a).await;
            Some(a)
        }
        Err(e) => {
            *riegel.fehlschlag.lock().unwrap() = Some(std::time::Instant::now());
            tracing::warn!(
                "MaStR-Abruf fehlgeschlagen ({e}) — Energie ohne MaStR-Anteil, Sperre 5 min"
            );
            None
        }
    }
}

#[cfg(test)]
mod energie_tests {
    use super::*;
    use crate::karte::typen::FachebeneStatus;
    use serde_json::json;

    const BBOX: &str = "6.9,51.45,7.3,51.65";
    /// Wartefrist im Test: kurz, damit kein Test an der Uhr hängt, aber mit Luft für einen
    /// Cache-Zugriff und eine sofort fertige Task, wenn die Suite parallel unter Last läuft.
    const FRIST: Duration = Duration::from_millis(300);
    /// Äußere Schranke, damit ein Rückfall auf blockierendes Warten rot wird statt zu hängen.
    const HALT: Duration = Duration::from_secs(1);

    /// Die Größengrenze ist seit LFH-83 energie-eigen (`Bbox::parse` nimmt jede Größe).
    #[test]
    fn energie_bbox_grenze_drei_grad() {
        let ok = |b: &str| pruefe_energie_bbox(&Bbox::parse(b).unwrap());
        assert!(ok(BBOX).is_ok());
        // Genau 3° je Achse ist noch erlaubt (nicht > 3) — das deckt einen Zoom-10-Ausschnitt
        // auch auf einem breiten Schirm (1920 px ≈ 1,3°, 4K ≈ 2,6°).
        assert!(ok("6.0,50.0,9.0,53.0").is_ok());
        assert!(ok("6.0,50.0,7.6,51.0").is_ok());
        // Ganz Deutschland, und je eine Achse knapp drüber.
        for b in [
            "5.0,47.0,15.0,55.0",
            "6.0,50.0,9.1,50.9",
            "6.0,50.0,6.9,53.1",
        ] {
            let fehler = ok(b).unwrap_err();
            assert!(fehler.contains("bbox zu groß"), "{b}: {fehler}");
        }
    }

    fn inflight() -> Arc<Mutex<HashSet<String>>> {
        Arc::new(Mutex::new(HashSet::new()))
    }

    fn punkt(lon: f64, lat: f64, art: &str, mw: f64, herkunft: &str) -> Value {
        json!({ "type": "Feature",
            "geometry": { "type": "Point", "coordinates": [lon, lat] },
            "properties": { "titel": format!("{herkunft}-{lon}"), "anlagenart": art,
                "leistung_mw": mw, "betreiber": null, "betriebsstatus": null,
                "herkunft": herkunft, "mastr_nummer": null, "mastr_id": null,
                "mastr_einheiten": null } })
    }

    fn osm_teil() -> FachebeneAntwort {
        FachebeneAntwort::ok(
            "energie",
            ENERGIE_OSM_ATTRIB,
            None,
            json!({ "type": "FeatureCollection",
                "features": [ punkt(7.0079, 51.6002, "kohle", 690.0, "osm") ] }),
        )
    }

    fn mastr_teil() -> FachebeneAntwort {
        FachebeneAntwort::ok(
            "energie",
            ENERGIE_MASTR_ATTRIB,
            Some("2026-09-21T10:00:00Z".into()),
            json!({ "type": "FeatureCollection", "features": [
                punkt(7.19, 51.55, "speicher", 15.0, "mastr"),
                punkt(12.0, 48.0, "wasser", 18.5, "mastr"), // weit ausserhalb
            ] }),
        )
    }

    fn titel(a: &FachebeneAntwort) -> Vec<String> {
        a.features["features"]
            .as_array()
            .unwrap()
            .iter()
            .map(|f| f["properties"]["titel"].as_str().unwrap().to_string())
            .collect()
    }

    // ---- 2.1 reine Teile des MaStR-Abrufs

    #[test]
    fn mastr_url_ist_das_literal() {
        assert_eq!(
            mastr_url(1),
            "https://www.marktstammdatenregister.de/MaStR/Einheit/EinheitJson/GetErweiterteOeffentlicheEinheitStromerzeugung?filter=Nettonennleistung%20der%20Einheit~gt~10000~and~Koordinate%3A%20Breitengrad%20%28WGS84%29~gt~-90~and~Betriebs-Status~eq~%2735%2C37%27&pageSize=2000&page=1"
        );
        assert!(mastr_url(2).ends_with("&pageSize=2000&page=2"));
    }

    /// Stilles Abschneiden bei 2000 Einheiten würde niemand bemerken — deshalb die Schleife.
    #[test]
    fn seitenzahl_folgt_total() {
        assert_eq!(mastr_seiten(1267), Ok(1));
        assert_eq!(mastr_seiten(2000), Ok(1));
        assert_eq!(mastr_seiten(2001), Ok(2));
        assert_eq!(mastr_seiten(20_000), Ok(10));
        assert!(mastr_seiten(0).is_err());
        assert!(mastr_seiten(20_001).is_err());
    }

    #[test]
    fn nach_mastr_fehlschlag_fuenf_minuten_sperre() {
        let ab = ENERGIE_MASTR_ABKUEHLUNG;
        assert_eq!(ab, Duration::from_secs(300));
        assert!(mastr_darf_starten(None, ab));
        assert!(!mastr_darf_starten(Some(Duration::from_secs(0)), ab));
        assert!(!mastr_darf_starten(Some(Duration::from_secs(299)), ab));
        assert!(mastr_darf_starten(Some(ab), ab));
        assert!(mastr_darf_starten(Some(Duration::from_secs(301)), ab));
    }

    #[test]
    fn overpass_query_fragt_nur_power_plant() {
        let b = Bbox::parse(BBOX).unwrap();
        assert_eq!(
            energie_overpass_query(&b.overpass()),
            "[out:json][timeout:25];nwr[power=plant](51.45,6.9,51.65,7.3);out center tags;"
        );
    }

    /// Overpass wird auf den Ausschnitt plus drei Zuordnungsradien (6 km) gefragt — sonst
    /// fehlt der Zusammenführung an der Kante die OSM-Anlage (Review-Befund 2). Geprüft an
    /// den Zahlen der Abfrage, nicht über `erweitert_um_m`: das prüfte sich selbst.
    #[test]
    fn osm_abfrage_nimmt_den_erweiterten_ausschnitt() {
        let q = energie_osm_abfrage(&Bbox::parse(BBOX).unwrap());
        assert!(
            q.starts_with("[out:json][timeout:25];nwr[power=plant]("),
            "{q}"
        );
        let innen = &q[q.find('(').unwrap() + 1..q.find(')').unwrap()];
        let z: Vec<f64> = innen.split(',').map(|t| t.parse().unwrap()).collect();
        // sued,west,nord,ost; 6 km sind 0,054° Breite und bei ~51,7° N 0,087° Länge.
        let soll = [51.45 - 0.054, 6.9 - 0.087, 51.65 + 0.054, 7.3 + 0.087];
        for (ist, soll) in z.iter().zip(soll) {
            assert!((ist - soll).abs() < 0.002, "{z:?} gegen {soll}");
        }
    }

    /// Eigene Riegel je Test — die prozessweiten Statics teilten sich alle parallel
    /// laufenden Tests (siehe [`MastrRiegel`]).
    fn riegel() -> MastrRiegel {
        MastrRiegel {
            fehlschlag: Box::leak(Box::new(Mutex::new(None))),
            spur: Box::leak(Box::new(tokio::sync::Mutex::new(()))),
        }
    }

    /// Ein Abruf, der mitzählt und nie etwas liefert.
    fn zaehlender_abruf(
        zaehler: &Arc<std::sync::atomic::AtomicUsize>,
    ) -> impl FnOnce() -> std::future::Ready<Result<Vec<Value>, String>> {
        let z = zaehler.clone();
        move || {
            z.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
            std::future::ready(Err("dieser Test erwartet keinen Abruf".into()))
        }
    }

    /// Wartet höchstens eine Sekunde (100 × 10 ms) darauf, dass `bedingung` gilt.
    async fn binnen_einer_sekunde<F, Fut>(bedingung: F) -> bool
    where
        F: Fn() -> Fut,
        Fut: Future<Output = bool>,
    {
        for _ in 0..100 {
            if bedingung().await {
                return true;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
        false
    }

    /// Die zweite Hälfte der Einzelspur: wer gewartet hat, bekommt den frischen Stand des
    /// Vorgängers aus dem Cache, ohne selbst abzurufen. Hermetisch: der Abruf ist eine
    /// zählende Closure statt eines HTTP-Clients — ohne die Frisch-Prüfung zählt sie und
    /// der Test wird rot, ohne dass ein Byte ins Netz geht.
    #[tokio::test]
    async fn wartender_bekommt_frischen_mastr_stand_ohne_abruf() {
        let pool = crate::db::test_pool().await;
        cache::setze(&pool, ENERGIE_MASTR_KEY, &mastr_teil()).await;
        let abrufe = Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let a = erneuere_energie_mastr(pool, riegel(), zaehlender_abruf(&abrufe)).await;
        assert_eq!(abrufe.load(std::sync::atomic::Ordering::SeqCst), 0);
        let a = a.expect("frischer Stand wird durchgereicht");
        assert_eq!(a.stand.as_deref(), Some("2026-09-21T10:00:00Z"));
    }

    /// Während der Sperre wird nicht abgerufen.
    #[tokio::test]
    async fn gesperrter_mastr_ruft_nicht_ab() {
        let pool = crate::db::test_pool().await;
        let r = riegel();
        *r.fehlschlag.lock().unwrap() = Some(std::time::Instant::now());
        let abrufe = Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let a = erneuere_energie_mastr(pool, r, zaehlender_abruf(&abrufe)).await;
        assert!(a.is_none());
        assert_eq!(abrufe.load(std::sync::atomic::Ordering::SeqCst), 0);
    }

    // ---- Wartefrist und gelöster Abruf (Review-Befund 1)

    #[test]
    fn wartefrist_ist_zehn_sekunden() {
        // Unter dem 15-s-Abbruch von `apiGet` im Frontend, mit Luft für die Zusammenführung.
        assert_eq!(ENERGIE_WARTE, Duration::from_secs(10));
    }

    /// Spec „Nur OSM erreichbar": ein langsamer MaStR darf die Antwort nicht über die Frist
    /// hinaus aufhalten — sonst bricht das Frontend nach 15 s ab und die GANZE Ebene wirkt
    /// offline, obwohl der OSM-Teil längst da ist. Der gelöste Abruf läuft weiter und legt
    /// seinen Stand in den Cache.
    #[tokio::test]
    async fn langsamer_mastr_haelt_die_antwort_nicht_auf() {
        let pool = crate::db::test_pool().await;
        let bbox = Bbox::parse(BBOX).unwrap();
        let (tor, offen) = tokio::sync::oneshot::channel::<()>();
        let p2 = pool.clone();
        let a = tokio::time::timeout(
            HALT,
            energie_kern(
                &pool,
                &inflight(),
                bbox,
                FRIST,
                || async { Some(osm_teil()) },
                move || async move {
                    let _ = offen.await;
                    cache::setze(&p2, ENERGIE_MASTR_KEY, &mastr_teil()).await;
                    Some(mastr_teil())
                },
            ),
        )
        .await
        .expect("Antwort nach der Wartefrist, nicht erst nach MaStR");
        assert_eq!(a.status, FachebeneStatus::Ok);
        assert_eq!(a.attribution, "© OpenStreetMap-Beitragende (ODbL)");
        assert_eq!(a.stand, None);
        assert_eq!(titel(&a), vec!["osm-7.0079".to_string()]);
        let _ = tor.send(());
        assert!(
            binnen_einer_sekunde(|| async {
                cache::frisch(&pool, ENERGIE_MASTR_KEY, 60).await.is_some()
            })
            .await,
            "der gelöste MaStR-Abruf hat seinen Stand nicht in den Cache gelegt"
        );
    }

    /// Die Sperre setzt nur ein ECHTER Fehlschlag — und zwar auch dann, wenn er erst nach
    /// der Antwort eintritt. Das Reißen der Wartefrist setzt sie nicht.
    #[tokio::test]
    async fn im_hintergrund_scheiternder_mastr_setzt_die_sperre() {
        let pool = crate::db::test_pool().await;
        let bbox = Bbox::parse(BBOX).unwrap();
        let r = riegel();
        let (tor, offen) = tokio::sync::oneshot::channel::<()>();
        let p2 = pool.clone();
        let a = tokio::time::timeout(
            HALT,
            energie_kern(
                &pool,
                &inflight(),
                bbox,
                FRIST,
                || async { Some(osm_teil()) },
                move || {
                    erneuere_energie_mastr(p2, r, move || async move {
                        let _ = offen.await;
                        Err("Upstream gestört".to_string())
                    })
                },
            ),
        )
        .await
        .expect("Antwort nach der Wartefrist");
        assert_eq!(a.attribution, "© OpenStreetMap-Beitragende (ODbL)");
        assert!(
            r.fehlschlag.lock().unwrap().is_none(),
            "die gerissene Frist ist kein Fehlschlag"
        );
        let _ = tor.send(());
        assert!(
            binnen_einer_sekunde(|| async { r.fehlschlag.lock().unwrap().is_some() }).await,
            "der Fehlschlag im gelösten Abruf hat die Sperre nicht gesetzt"
        );
    }

    /// axum verwirft den Handler-Future, wenn der Client abbricht. Der Abruf darf daran
    /// nicht hängen: er schreibt seinen Stand trotzdem zu Ende.
    #[tokio::test]
    async fn abgebrochene_anfrage_laesst_den_abruf_zu_ende_laufen() {
        let pool = crate::db::test_pool().await;
        let bbox = Bbox::parse(BBOX).unwrap();
        let (tor, offen) = tokio::sync::oneshot::channel::<()>();
        let p2 = pool.clone();
        let abbruch = tokio::time::timeout(
            Duration::from_millis(50),
            energie_kern(
                &pool,
                &inflight(),
                bbox,
                HALT,
                || async { None },
                move || async move {
                    let _ = offen.await;
                    cache::setze(&p2, ENERGIE_MASTR_KEY, &mastr_teil()).await;
                    Some(mastr_teil())
                },
            ),
        )
        .await;
        assert!(abbruch.is_err(), "die Anfrage sollte abgebrochen sein");
        let _ = tor.send(());
        assert!(
            binnen_einer_sekunde(|| async {
                cache::frisch(&pool, ENERGIE_MASTR_KEY, 60).await.is_some()
            })
            .await,
            "der Abruf starb mit der abgebrochenen Anfrage"
        );
    }

    /// Zwei gleichzeitige Anfragen bei kaltem Cache starten EINEN Abruf, nicht zwei.
    #[tokio::test]
    async fn parallele_kalte_anfragen_starten_einen_abruf() {
        let pool = crate::db::test_pool().await;
        let bbox = Bbox::parse(BBOX).unwrap();
        let infl = inflight();
        let abrufe = Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let tor = Arc::new(tokio::sync::Semaphore::new(0));
        let abruf = || {
            let (z, t) = (abrufe.clone(), tor.clone());
            move || {
                z.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
                async move {
                    let _ = t.acquire().await;
                    None
                }
            }
        };
        let (a, b) = tokio::time::timeout(HALT, async {
            tokio::join!(
                energie_kern(&pool, &infl, bbox, FRIST, || async { None }, abruf()),
                energie_kern(&pool, &infl, bbox, FRIST, || async { None }, abruf()),
            )
        })
        .await
        .expect("beide Antworten nach der Wartefrist");
        tor.add_permits(2);
        assert_eq!(abrufe.load(std::sync::atomic::Ordering::SeqCst), 1);
        assert_eq!(a.status, FachebeneStatus::Offline);
        assert_eq!(b.status, FachebeneStatus::Offline);
    }

    // ---- 2.2 fetch_energie: Teilausfall und Totalausfall

    #[tokio::test]
    async fn beide_teile_aus_dem_cache() {
        let pool = crate::db::test_pool().await;
        let bbox = Bbox::parse(BBOX).unwrap();
        // Handgeschriebene Schlüssel: ein Vergleich gegen `cache_key_mit` prüfte sich selbst.
        cache::setze(&pool, "energie:osm:6.90,51.45,7.30,51.65", &osm_teil()).await;
        cache::setze(&pool, "energie:mastr", &mastr_teil()).await;
        let a = energie_kern(
            &pool,
            &inflight(),
            bbox,
            FRIST,
            || async { None },
            || async { None },
        )
        .await;
        assert_eq!(a.quelle, "energie");
        assert_eq!(a.status, FachebeneStatus::Ok);
        assert_eq!(
            a.attribution,
            "© OpenStreetMap-Beitragende (ODbL) · Marktstammdatenregister, Bundesnetzagentur – dl-de/by-2-0"
        );
        assert_eq!(a.stand.as_deref(), Some("2026-09-21T10:00:00Z"));
        let t = titel(&a);
        assert_eq!(t.len(), 2, "{t:?}"); // die Einheit bei 12°/48° liegt ausserhalb
        assert!(t.contains(&"osm-7.0079".to_string()));
        assert!(t.contains(&"mastr-7.19".to_string()));
    }

    #[tokio::test]
    async fn nur_osm_erreichbar() {
        let pool = crate::db::test_pool().await;
        let bbox = Bbox::parse(BBOX).unwrap();
        cache::setze(&pool, "energie:osm:6.90,51.45,7.30,51.65", &osm_teil()).await;
        let a = energie_kern(
            &pool,
            &inflight(),
            bbox,
            FRIST,
            || async { None },
            || async { None },
        )
        .await;
        assert_ne!(a.status, FachebeneStatus::Offline);
        assert_eq!(a.attribution, "© OpenStreetMap-Beitragende (ODbL)");
        assert_eq!(a.stand, None);
        assert_eq!(titel(&a), vec!["osm-7.0079".to_string()]);
    }

    #[tokio::test]
    async fn nur_mastr_erreichbar() {
        let pool = crate::db::test_pool().await;
        let bbox = Bbox::parse(BBOX).unwrap();
        cache::setze(&pool, "energie:mastr", &mastr_teil()).await;
        let a = energie_kern(
            &pool,
            &inflight(),
            bbox,
            FRIST,
            || async { None },
            || async { None },
        )
        .await;
        assert_eq!(a.status, FachebeneStatus::Ok);
        assert_eq!(
            a.attribution,
            "Marktstammdatenregister, Bundesnetzagentur – dl-de/by-2-0"
        );
        assert_eq!(a.stand.as_deref(), Some("2026-09-21T10:00:00Z"));
    }

    #[tokio::test]
    async fn keine_quelle_erreichbar_ist_offline() {
        let pool = crate::db::test_pool().await;
        let bbox = Bbox::parse(BBOX).unwrap();
        let a = energie_kern(
            &pool,
            &inflight(),
            bbox,
            FRIST,
            || async { None },
            || async { None },
        )
        .await;
        assert_eq!(a.status, FachebeneStatus::Offline);
        assert_eq!(a.quelle, "energie");
        assert!(a.features["features"].as_array().unwrap().is_empty());
        assert_eq!(a.stand, None);
    }

    /// Kalte Pfade werden live geholt (und nicht etwa übersprungen).
    #[tokio::test]
    async fn kalte_teile_werden_geholt() {
        let pool = crate::db::test_pool().await;
        let bbox = Bbox::parse(BBOX).unwrap();
        let a = energie_kern(
            &pool,
            &inflight(),
            bbox,
            FRIST,
            || async { Some(osm_teil()) },
            || async { Some(mastr_teil()) },
        )
        .await;
        assert_eq!(titel(&a).len(), 2);
    }

    /// Ein Teil, der geantwortet hat, aber im Ausschnitt nichts beiträgt, wird nicht genannt
    /// (Spec: MUST NOT eine Quelle nennen, die nichts beiträgt) — die Ebene ist dann `leer`,
    /// nicht `offline`.
    #[tokio::test]
    async fn geantwortet_aber_nichts_im_ausschnitt() {
        let pool = crate::db::test_pool().await;
        let bbox = Bbox::parse(BBOX).unwrap();
        let leer = FachebeneAntwort::ok("energie", ENERGIE_OSM_ATTRIB, None, leere_collection());
        cache::setze(&pool, "energie:osm:6.90,51.45,7.30,51.65", &leer).await;
        let nur_fern = FachebeneAntwort::ok(
            "energie",
            ENERGIE_MASTR_ATTRIB,
            Some("2026-09-21T10:00:00Z".into()),
            json!({ "type": "FeatureCollection",
                "features": [ punkt(12.0, 48.0, "wasser", 18.5, "mastr") ] }),
        );
        cache::setze(&pool, "energie:mastr", &nur_fern).await;
        let a = energie_kern(
            &pool,
            &inflight(),
            bbox,
            FRIST,
            || async { None },
            || async { None },
        )
        .await;
        assert_eq!(a.status, FachebeneStatus::Leer);
        assert_eq!(a.attribution, "");
        // `stand` ist der Zeitpunkt des MaStR-Abzugs, nicht „einer beitragenden Quelle" — er
        // bleibt also stehen, auch wenn MaStR im Ausschnitt nichts beiträgt.
        assert_eq!(a.stand.as_deref(), Some("2026-09-21T10:00:00Z"));
    }

    /// Pinnt den GEMESSENEN Radius dort, wo er verbraucht wird: die `fuehre_*`-Tests reichen
    /// ihren Radius als Literal herein und sähen eine Änderung an `ENERGIE_RADIUS_M` nicht.
    /// ~500 m (bei 51,6° N sind 0,0072° Länge rund 500 m) wird zusammengeführt, ~3 km nicht.
    #[test]
    fn gemessener_radius_fuehrt_500_m_zusammen_und_3_km_nicht() {
        let bbox = Bbox::parse(BBOX).unwrap();
        let mit_einheit_bei = |lon: f64| {
            FachebeneAntwort::ok(
                "energie",
                ENERGIE_MASTR_ATTRIB,
                Some("2026-09-21T10:00:00Z".into()),
                json!({ "type": "FeatureCollection",
                    "features": [ punkt(lon, 51.6002, "kohle", 700.0, "mastr") ] }),
            )
        };
        let nah = baue_energie_antwort(&osm_teil(), &mit_einheit_bei(7.0151), &bbox);
        let f = nah.features["features"].as_array().unwrap();
        assert_eq!(f.len(), 1);
        assert_eq!(f[0]["properties"]["herkunft"], "osm+mastr");
        let fern = baue_energie_antwort(&osm_teil(), &mit_einheit_bei(7.0513), &bbox);
        assert_eq!(fern.features["features"].as_array().unwrap().len(), 2);
    }
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

    /// Ein Eintrag, wie ihn der Fächer liefert.
    fn treffer(strasse: &str) -> (String, String, Value) {
        (
            strasse.to_string(),
            "closure".to_string(),
            json!({ "closure": [
                { "title": "X", "coordinate": { "lat": 51.0, "long": 7.0 } }
            ]}),
        )
    }

    /// Der übliche Lauf (1–2 Ausfälle von 333) muss durchgehen — sonst veraltete die Ebene
    /// dauerhaft, weil sie sich nie wieder speichern dürfte.
    #[test]
    fn normaler_lauf_mit_wenigen_ausfaellen_wird_gespeichert() {
        let roh: Vec<_> = (0..331).map(|i| treffer(&format!("A{i}"))).collect();
        let a = autobahn_antwort(333, &roh).expect("331 von 333 ist brauchbar");
        assert_eq!(a.quelle, "autobahn");
        assert_eq!(a.status, crate::karte::typen::FachebeneStatus::Ok);
        assert_eq!(a.attribution, "Autobahn GmbH des Bundes");
    }

    /// Ein Eintrag, der zugestellt wurde, aber KEINE Dienst-Liste trägt: HTTP 200 mit
    /// gültigem JSON, wie es ein Portal in Wartung erwidert.
    fn leere_nutzlast(strasse: &str) -> (String, String, Value) {
        (strasse.to_string(), "closure".to_string(), json!({}))
    }

    /// Der zweite Weg in denselben Schaden: die Abrufe GELINGEN alle, tragen aber keine
    /// Liste. Zählte die Schwelle die Zustellung statt den Inhalt, ginge ein Lauf mit 333
    /// leeren Nutzlasten als vollständig durch und überschriebe den gesunden Cache mit null
    /// Features — genau das Bild, gegen das die Schwelle existiert.
    #[test]
    fn zugestellte_aber_leere_nutzlasten_zaehlen_nicht_als_antwort() {
        let roh: Vec<_> = (0..333).map(|i| leere_nutzlast(&format!("A{i}"))).collect();
        assert!(autobahn_antwort(333, &roh).is_none());

        // Und die Gegenprobe: dieselbe Menge mit echten Listen geht durch. Ohne sie wäre der
        // Test auch von einer Schwelle erfüllt, die grundsätzlich alles ablehnt.
        let echt: Vec<_> = (0..333).map(|i| treffer(&format!("A{i}"))).collect();
        assert!(autobahn_antwort(333, &echt).is_some());
    }

    /// Eine LEERE Dienst-Liste (`{"closure": []}`) ist eine gültige Antwort — „auf dieser
    /// Strecke ist gerade nichts" — und muss mitzählen. Sonst verwürfe ein ruhiger Tag den
    /// ganzen Lauf.
    #[test]
    fn leere_aber_vorhandene_dienstliste_zaehlt_mit() {
        let ruhig: Vec<(String, String, Value)> = (0..333)
            .map(|i| {
                (
                    format!("A{i}"),
                    "closure".to_string(),
                    json!({ "closure": [] }),
                )
            })
            .collect();
        assert!(autobahn_antwort(333, &ruhig).is_some());
    }

    /// Die tragende Aussage, und zwar als NEGATIVE: aus einem Totalausfall entsteht gar keine
    /// Antwort. Gäbe es hier eine, überschriebe sie den gesunden Cache-Stand mit null
    /// Features, und die Ebene meldete zehn Minuten lang „keine Daten".
    #[test]
    fn totalausfall_und_zu_loechriger_lauf_liefern_keine_antwort() {
        assert!(autobahn_antwort(333, &[]).is_none());
        let haelfte: Vec<_> = (0..5).map(|i| treffer(&format!("A{i}"))).collect();
        assert!(
            autobahn_antwort(10, &haelfte).is_none(),
            "genau die Hälfte reicht nicht — die Schwelle ist ein echtes „mehr als\""
        );
        let knapp_drueber: Vec<_> = (0..6).map(|i| treffer(&format!("A{i}"))).collect();
        assert!(autobahn_antwort(10, &knapp_drueber).is_some());
    }

    /// Die drei Cache-Zustände. Die tragende Aussage ist die dritte: ein KALTER Cache führt
    /// zu `LeerUndErneuern`, also zu einer sofortigen Antwort plus Hintergrundlauf — und
    /// NICHT zu Warten. Ein wartender kalter Pfad liefe in die 15-s-Schranke von `apiGet`
    /// und in das 60-s-`REQUEST_BUDGET` der Zulassung; das erste Einschalten der Ebene
    /// endete zuverlässig im Netzfehler statt in Daten.
    #[test]
    fn kalter_cache_wartet_nicht() {
        let ttl = Duration::from_secs(600);
        assert_eq!(autobahn_weg(None, ttl), AutobahnWeg::LeerUndErneuern);
        assert_eq!(autobahn_weg(Some(599), ttl), AutobahnWeg::Frisch);
        assert_eq!(autobahn_weg(Some(601), ttl), AutobahnWeg::AltUndErneuern);
        // Genau auf der TTL gilt als veraltet — dieselbe Grenze wie in `liefere_mit_swr`
        // (`alter < ttl`), damit beide Ebenen-Sorten dasselbe Alter als frisch ansehen.
        assert_eq!(autobahn_weg(Some(600), ttl), AutobahnWeg::AltUndErneuern);
    }

    /// Ohne Abkühlung trommelt eine anhaltende Störung die Quelle: die Ebene meldet
    /// `offline`, das Frontend pollt deshalb im 20-s-Aufwärmtakt, und jeder Poll stiesse
    /// einen neuen Fächer mit 333 Abrufen an — gegen einen Anbieter, der gerade nicht kann.
    #[test]
    fn nach_fehlschlag_wird_nicht_sofort_neu_gestartet() {
        let ab = Duration::from_secs(300);
        // Kein Fehlschlag offen → freie Fahrt.
        assert!(autobahn_darf_starten(None, ab));
        // Frischer Fehlschlag → gesperrt.
        assert!(!autobahn_darf_starten(Some(Duration::from_secs(0)), ab));
        assert!(!autobahn_darf_starten(Some(Duration::from_secs(299)), ab));
        // Abgelaufen → wieder erlaubt; auf der Grenze schon, sonst bliebe die Ebene bei
        // exakt gleichem Takt für immer gesperrt.
        assert!(autobahn_darf_starten(Some(ab), ab));
        assert!(autobahn_darf_starten(Some(Duration::from_secs(301)), ab));
    }

    /// Die zweite Hälfte der Einzelspur: wer auf den Vorgänger gewartet hat, bekommt dessen
    /// frischen Stand — und fetcht NICHT blind hinterher. Belegt über einen Client, der
    /// nirgendwo hinkommt (Port 1, ECONNREFUSED): kommt trotzdem eine Antwort zurück, kann
    /// sie nur aus dem Cache stammen. Ohne die Nachschau liefe der Wartende in die
    /// Streckenliste, scheiterte und lieferte `None` — also 333 Abrufe umsonst und
    /// `offline` für den Bediener.
    ///
    /// Die erste Hälfte (der Riegel selbst) ist bewusst NICHT getestet: zwei echte Fächer
    /// gegeneinander laufen zu lassen hiesse, 666 Abrufe gegen eine fremde Behörden-API zu
    /// schicken, und ein Test mit Netz wäre ohnehin eine Wackelstelle statt einer Aussage.
    #[tokio::test]
    async fn wartender_bekommt_den_frischen_stand_ohne_eigenen_abruf() {
        let pool = crate::db::test_pool().await;
        let vorgaenger = FachebeneAntwort::ok(
            "autobahn",
            AUTOBAHN_ATTRIB,
            None,
            json!({ "type": "FeatureCollection", "features": [
                { "type": "Feature",
                  "geometry": { "type": "Point", "coordinates": [7.0, 51.0] },
                  "properties": { "titel": "A1 | X", "kategorie": "sperrung" } }
            ]}),
        );
        cache::setze(&pool, "autobahn", &vorgaenger).await;

        let nirgendwo = reqwest::Client::builder()
            .timeout(Duration::from_millis(200))
            .build()
            .unwrap();
        let a = erneuere_autobahn(nirgendwo, pool)
            .await
            .expect("frischer Cache-Stand wird durchgereicht, ohne die Quelle anzufassen");
        assert_eq!(a.features["features"][0]["properties"]["titel"], "A1 | X");
    }

    /// Randfall ohne eigene Bedeutung im Betrieb (eine leere Streckenliste bricht schon in
    /// `erneuere_autobahn` ab), aber ohne ihn trüge `roh.is_empty()` die Aussage allein.
    #[test]
    fn leerer_gesamtlauf_liefert_keine_antwort() {
        assert!(autobahn_antwort(0, &[]).is_none());
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
    fn ueberspringt_eine_fundstelle_mit_nicht_numerischem_argument() {
        // Die Funktion wird in `lage-index.js` DEFINIERT (`function addLagePegel(ki)`) und
        // im Seitenrumpf mit dem Token AUFGERUFEN. Zöge jemand das Skript inline, stünde die
        // Definition vor dem Aufruf — bei Abbruch an der ersten Fundstelle ginge die Ebene
        // offline, obwohl der Token zwei Zeilen tiefer steht.
        let html = "function addLagePegel(ki) { /* … */ }\naddLagePegel(884284296001)";
        assert_eq!(extrahiere_ki(html), Some("884284296001".to_string()));
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

#[cfg(test)]
mod luftqualitaet_tests {
    use super::*;
    use crate::karte::typen::FachebeneStatus;
    use serde_json::json;

    fn stationen() -> Value {
        json!({
            "indices": ["station id", "station code", "station name", "station city",
                        "station longitude", "station latitude"],
            "data": { "21": ["21", "DEBB021", "Potsdam-Zentrum", "Potsdam", "13.0647", "52.3985"] }
        })
    }

    fn index() -> Value {
        json!({ "data": { "21": {
            "2026-09-21 08:00:00": ["2026-09-21 09:00:00", 1, 0, [5, 30, 1, "1.5"]]
        } } })
    }

    #[test]
    fn beide_abrufe_ergeben_ok_mit_stand_und_attribution() {
        let a = luftqualitaet_antwort(Ok(stationen()), Ok(index())).expect("Lauf geglückt");
        assert_eq!(a.quelle, "luftqualitaet");
        assert_eq!(a.status, FachebeneStatus::Ok);
        assert!(a.attribution.contains("Umweltbundesamt"));
        assert!(a.stand.is_some(), "stand = jüngster Messzeitpunkt");
        assert_eq!(a.features["features"].as_array().unwrap().len(), 1);
    }

    /// Scheitert einer der beiden Abrufe, ist der ganze Lauf gescheitert — sonst stünde eine
    /// halbe Antwort als `leer` 15 Minuten im Cache und überdeckte den letzten guten Stand.
    #[test]
    fn ein_gescheiterter_abruf_laesst_den_lauf_scheitern() {
        assert!(luftqualitaet_antwort(Err("HTTP 502".into()), Ok(index())).is_none());
        assert!(luftqualitaet_antwort(Ok(stationen()), Err("Timeout".into())).is_none());
    }

    #[test]
    fn unbrauchbare_antwort_laesst_den_lauf_scheitern() {
        assert!(luftqualitaet_antwort(Ok(json!({})), Ok(index())).is_none());
    }

    #[test]
    fn erreichbar_ohne_werte_ist_leer() {
        let a = luftqualitaet_antwort(Ok(stationen()), Ok(json!({ "data": {} }))).unwrap();
        assert_eq!(a.status, FachebeneStatus::Leer);
    }

    /// Die Attribution steht auch im Offline-Umschlag (Spec „Attribution auch offline").
    #[test]
    fn offline_umschlag_traegt_die_attribution() {
        let a = FachebeneAntwort::offline("luftqualitaet", LUFTQUALITAET_ATTRIB);
        assert_eq!(a.status, FachebeneStatus::Offline);
        assert!(a.attribution.contains("Umweltbundesamt"));
    }

    /// Finaler Host fest verdrahtet (design D2): der im Ticket genannte Host antwortet mit
    /// 301 hierher. Ein Verlass auf die Weiterleitung bräche still, sobald der alte Pfad
    /// abgeschaltet wird.
    #[test]
    fn abruf_urls_zielen_auf_den_finalen_host_und_setzen_index_id() {
        let jetzt =
            chrono::TimeZone::with_ymd_and_hms(&chrono::Utc, 2026, 9, 21, 9, 39, 0).unwrap();
        let (st, ix) = luftqualitaet_urls(jetzt);
        for u in [&st, &ix] {
            assert!(
                u.starts_with("https://luftdaten.umweltbundesamt.de/api/air-data/v2/"),
                "{u}"
            );
            assert!(u.contains("index=id"), "{u}");
        }
        assert!(st.contains("/stations/json?"));
        assert!(ix.contains("/airquality/json?"));
        assert!(
            ix.contains("date_from=2026-09-21") && ix.contains("time_from=4"),
            "{ix}"
        );
        assert!(ix.contains("time_to=11"), "{ix}");
    }
}

#[cfg(test)]
mod odl_antwort_tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn brauchbare_antwort_wird_gespeichert() {
        let roh = json!({ "type": "FeatureCollection", "features": [{
            "type": "Feature",
            "geometry": { "type": "Point", "coordinates": [8.0, 50.0] },
            "properties": { "id": "X", "name": "x", "value": 0.1 }
        }]});
        let a = odl_antwort(&roh).expect("brauchbar");
        assert_eq!(a.quelle, "odl");
        assert_eq!(a.status, crate::karte::typen::FachebeneStatus::Ok);
        assert_eq!(a.attribution, ODL_ATTRIB);
    }

    #[test]
    fn grundpegel_wird_nur_bei_fehlen_oder_alter_und_ohne_abkuehlung_angestossen() {
        let tag = 24 * 3600;
        assert!(grundpegel_anstossen(None, None), "kalt → anstossen");
        assert!(
            grundpegel_anstossen(Some(tag), None),
            "24 h alt → anstossen"
        );
        assert!(
            !grundpegel_anstossen(Some(tag - 1), None),
            "frisch → nichts"
        );
        let kurz = Some(Duration::from_secs(60));
        assert!(!grundpegel_anstossen(None, kurz), "Abkühlung läuft");
        assert!(grundpegel_anstossen(None, Some(Duration::from_secs(3600))));
    }

    #[test]
    fn formatbruch_ist_ein_fehlschlag_und_kein_leerer_stand() {
        // Ein GeoServer antwortet auf Fehler mit HTTP 200 und einem OGC-Report bzw. einem
        // Objekt ohne `features`. Als „leer" gespeichert sähe das für zehn Minuten aus wie
        // „keine Sonden" — die Ebene muss stattdessen `offline` zeigen (Spec: „Ausfall der
        // Quelle bricht die Karte nicht"), und ein alter Stand bleibt stehen.
        for roh in [
            json!({ "exceptions": [] }),
            json!([]),
            json!({ "features": "x" }),
        ] {
            assert!(odl_antwort(&roh).is_none(), "{roh}");
        }
    }
}
