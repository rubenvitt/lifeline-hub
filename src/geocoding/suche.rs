//! Vorwärtssuche (Adresse → Koordinate) für die Ortssuche der Lagekarte (LFH-638,
//! `openspec/changes/lfh-638-lagekarte-ort-suche/design.md`, D6).
//!
//! Gleicher Geocoder wie das Reverse-Geocoding (Nominatim-kompatibles `/search`), gleicher Client
//! und **derselbe** Token-Bucket: das Limit des Dienstes (≤ 1 Anfrage/s) gilt für die Anwendung,
//! nicht je Endpunkt. Ein Geocoder-Fehler ist hier kein Fehler, sondern ein [`SuchErgebnis`].
//!
//! Cache im Prozess, nicht in der Cache-DB: Vorwärtssuchen sind selten und handgetrieben, ein
//! persistenter Cache brächte Schema-Pflege ohne Nutzen über einen Neustart hinaus.
//!
//! DATENSCHUTZ: an den Geocoder gehen nur der Suchtext und, wenn der Einsatzort verortet ist, ein
//! grober Ausschnitt ([`Ausschnitt::um`]). Der Suchtext kann personenbezogen sein (Adresse einer
//! betroffenen Person) und steht deshalb in keiner Log-Zeile.

use super::TokenBucket;
use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, Instant};

/// Höchstens so viele Treffer fragt die Suche an.
const TREFFER_MAX: usize = 5;
/// So lange wartet eine Suche höchstens auf ein Token, bevor sie „ausgelastet“ meldet. Eine Suche
/// ist eine bewusste Handlung; ein sofortiges „ausgelastet“ wäre nach einer Ort-Vorschau die Regel.
pub const TOKEN_WARTEN_MAX: Duration = Duration::from_secs(1);
/// Abstand der Versuche, solange auf ein Token gewartet wird.
const TOKEN_TAKT: Duration = Duration::from_millis(100);
/// Halbe Kantenlänge des bevorzugten Ausschnitts in Grad (~25 km).
const AUSSCHNITT_GRAD: f64 = 0.25;
/// Cache: Lebensdauer und Größe.
const CACHE_TTL: Duration = Duration::from_secs(24 * 3600);
const CACHE_MAX: usize = 500;

/// Ein Treffer der Vorwärtssuche.
#[derive(Debug, Clone, PartialEq)]
pub struct OrtTreffer {
    pub lat: f64,
    pub lon: f64,
    pub name: String,
}

/// Ausgang einer Suche. `Ok` mit leerer Liste heißt „nichts gefunden“.
#[derive(Debug, Clone, PartialEq)]
pub enum SuchErgebnis {
    Ok(Vec<OrtTreffer>),
    /// Kein Token innerhalb der Wartezeit.
    Ausgelastet,
    /// Netz, Timeout, HTTP-Fehler oder unlesbare Antwort.
    NichtErreichbar,
}

/// Bevorzugter Ausschnitt (Nominatim `viewbox`, mit `bounded=0`: bevorzugen, nicht ausschließen).
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Ausschnitt {
    pub west: f64,
    pub sued: f64,
    pub ost: f64,
    pub nord: f64,
}

impl Ausschnitt {
    /// Ausschnitt um einen Punkt, ±0,25° je Richtung.
    pub fn um(lat: f64, lon: f64) -> Self {
        Self {
            west: lon - AUSSCHNITT_GRAD,
            sued: lat - AUSSCHNITT_GRAD,
            ost: lon + AUSSCHNITT_GRAD,
            nord: lat + AUSSCHNITT_GRAD,
        }
    }

    /// `viewbox=<x1>,<y1>,<x2>,<y2>` (Länge, Breite), auf drei Stellen gerundet: grob genug, dass
    /// der Ausschnitt den Einsatzort nicht genauer verrät als nötig, und stabil als Cache-Schlüssel.
    fn als_parameter(&self) -> String {
        format!(
            "{:.3},{:.3},{:.3},{:.3}",
            self.west, self.nord, self.ost, self.sued
        )
    }
}

/// Prozess-Cache der Vorwärtssuche. Nur `Ok`-Ergebnisse werden gemerkt.
#[derive(Default)]
pub struct SuchCache {
    eintraege: HashMap<String, (Instant, Vec<OrtTreffer>)>,
}

impl SuchCache {
    fn lese(&mut self, schluessel: &str) -> Option<Vec<OrtTreffer>> {
        match self.eintraege.get(schluessel) {
            Some((zeit, treffer)) if zeit.elapsed() < CACHE_TTL => Some(treffer.clone()),
            Some(_) => {
                self.eintraege.remove(schluessel);
                None
            }
            None => None,
        }
    }

    fn schreibe(&mut self, schluessel: String, treffer: Vec<OrtTreffer>) {
        if self.eintraege.len() >= CACHE_MAX && !self.eintraege.contains_key(&schluessel) {
            if let Some(aeltester) = self
                .eintraege
                .iter()
                .min_by_key(|(_, (zeit, _))| *zeit)
                .map(|(k, _)| k.clone())
            {
                self.eintraege.remove(&aeltester);
            }
        }
        self.eintraege.insert(schluessel, (Instant::now(), treffer));
    }
}

/// Schlüssel aus Geocoder, normalisiertem Begriff (klein, Leerraum zusammengezogen) und Ausschnitt.
fn cache_schluessel(base_url: &str, q: &str, ausschnitt: Option<Ausschnitt>) -> String {
    let begriff = q
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_lowercase();
    let box_teil = ausschnitt.map(|a| a.als_parameter()).unwrap_or_default();
    format!(
        "{}\u{1f}{begriff}\u{1f}{box_teil}",
        base_url.trim_end_matches('/')
    )
}

/// Nimmt ein Token; wartet dafür höchstens `warten_max`. Der Guard hält nie über ein `await`.
async fn token_nehmen(bucket: &Mutex<TokenBucket>, warten_max: Duration) -> bool {
    let ende = Instant::now() + warten_max;
    loop {
        let genommen = {
            let mut g = bucket.lock().unwrap_or_else(|e| e.into_inner());
            g.try_take()
        };
        if genommen {
            return true;
        }
        let jetzt = Instant::now();
        if jetzt >= ende {
            return false;
        }
        tokio::time::sleep(TOKEN_TAKT.min(ende - jetzt)).await;
    }
}

/// Liest eine Nominatim-`jsonv2`-Liste. `lat`/`lon` kommen dort als Zeichenketten; ein Eintrag
/// ohne lesbare Koordinate oder Namen fällt weg, eine Antwort, die keine Liste ist, gilt als Fehler.
fn lies_treffer(v: &serde_json::Value) -> Option<Vec<OrtTreffer>> {
    let liste = v.as_array()?;
    let zahl = |w: Option<&serde_json::Value>| -> Option<f64> {
        match w? {
            serde_json::Value::String(s) => s.parse().ok(),
            serde_json::Value::Number(n) => n.as_f64(),
            _ => None,
        }
    };
    Some(
        liste
            .iter()
            .filter_map(|e| {
                let lat = zahl(e.get("lat"))?;
                let lon = zahl(e.get("lon"))?;
                let name = e.get("display_name")?.as_str()?.trim();
                let im_bereich = (-90.0..=90.0).contains(&lat) && (-180.0..=180.0).contains(&lon);
                (im_bereich && !name.is_empty()).then(|| OrtTreffer {
                    lat,
                    lon,
                    name: name.to_string(),
                })
            })
            .take(TREFFER_MAX)
            .collect(),
    )
}

/// Vorwärtssuche (injizierbar, für Tests). Reihenfolge: Cache → Token (mit Warten) → HTTP.
pub async fn suche_mit(
    client: &reqwest::Client,
    bucket: &Mutex<TokenBucket>,
    cache: &Mutex<SuchCache>,
    base_url: &str,
    q: &str,
    ausschnitt: Option<Ausschnitt>,
    warten_max: Duration,
) -> SuchErgebnis {
    let schluessel = cache_schluessel(base_url, q, ausschnitt);
    if let Some(treffer) = cache
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .lese(&schluessel)
    {
        return SuchErgebnis::Ok(treffer);
    }
    if !token_nehmen(bucket, warten_max).await {
        return SuchErgebnis::Ausgelastet;
    }

    let limit = TREFFER_MAX.to_string();
    let viewbox = ausschnitt.map(|a| a.als_parameter());
    let mut params: Vec<(&str, &str)> = vec![
        ("q", q),
        ("format", "jsonv2"),
        ("limit", &limit),
        ("accept-language", "de"),
    ];
    if let Some(vb) = viewbox.as_deref() {
        params.push(("viewbox", vb));
        params.push(("bounded", "0"));
    }
    let url = match reqwest::Url::parse_with_params(
        &format!("{}/search", base_url.trim_end_matches('/')),
        &params,
    ) {
        Ok(u) => u,
        Err(e) => {
            tracing::debug!("Geocoder-URL unbrauchbar: {e}");
            return SuchErgebnis::NichtErreichbar;
        }
    };

    // Fehler werden ohne URL geloggt: sie trüge den Suchtext.
    let treffer = match client.get(url).send().await {
        Ok(r) if r.status().is_success() => match r.json::<serde_json::Value>().await {
            Ok(v) => lies_treffer(&v),
            Err(_) => {
                tracing::debug!("Geocoder-Suche: Antwort kein JSON");
                None
            }
        },
        Ok(r) => {
            tracing::debug!("Geocoder-Suche HTTP {}", r.status());
            None
        }
        Err(e) => {
            tracing::debug!(
                "Geocoder-Suche: Abruf fehlgeschlagen (timeout={}, connect={})",
                e.is_timeout(),
                e.is_connect()
            );
            None
        }
    };
    match treffer {
        Some(t) => {
            cache
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .schreibe(schluessel, t.clone());
            SuchErgebnis::Ok(t)
        }
        None => SuchErgebnis::NichtErreichbar,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;

    /// Stub für `/search`: zählt Aufrufe und merkt sich die rohen Query-Strings.
    async fn such_stub(
        antwort: serde_json::Value,
    ) -> (String, Arc<Mutex<Vec<String>>>, tokio::task::JoinHandle<()>) {
        let aufrufe: Arc<Mutex<Vec<String>>> = Arc::new(Mutex::new(Vec::new()));
        let mitschnitt = aufrufe.clone();
        let app = axum::Router::new().route(
            "/search",
            axum::routing::get(move |uri: axum::http::Uri| {
                let a = antwort.clone();
                let m = mitschnitt.clone();
                async move {
                    m.lock()
                        .unwrap()
                        .push(uri.query().unwrap_or_default().to_string());
                    axum::Json(a)
                }
            }),
        );
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let handle = tokio::spawn(async move {
            axum::serve(listener, app).await.ok();
        });
        (format!("http://{addr}"), aufrufe, handle)
    }

    fn geschlossener_port() -> String {
        let l = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let port = l.local_addr().unwrap().port();
        drop(l);
        format!("http://127.0.0.1:{port}")
    }

    fn client() -> reqwest::Client {
        reqwest::Client::builder()
            .timeout(Duration::from_millis(1500))
            .build()
            .unwrap()
    }

    fn bucket_voll() -> Mutex<TokenBucket> {
        Mutex::new(TokenBucket::neu(1.0, 1.0))
    }

    /// Leer und ohne Nachfüllung: es kommt nie wieder ein Token.
    fn bucket_leer() -> Mutex<TokenBucket> {
        let mut b = TokenBucket::neu(0.0, 1.0);
        b.try_take();
        Mutex::new(b)
    }

    fn treffer_json() -> serde_json::Value {
        serde_json::json!([
            { "lat": "51.1604", "lon": "10.4514", "display_name": "Hauptstraße 12, Musterstadt" },
            { "lat": "48.1", "lon": "11.5", "display_name": "Hauptstraße 12, Anderswo" }
        ])
    }

    #[tokio::test]
    async fn erfolg_liest_treffer() {
        let (base, _aufrufe, _h) = such_stub(treffer_json()).await;
        let cache = Mutex::new(SuchCache::default());
        let e = suche_mit(
            &client(),
            &bucket_voll(),
            &cache,
            &base,
            "Hauptstraße 12",
            None,
            Duration::ZERO,
        )
        .await;
        assert_eq!(
            e,
            SuchErgebnis::Ok(vec![
                OrtTreffer {
                    lat: 51.1604,
                    lon: 10.4514,
                    name: "Hauptstraße 12, Musterstadt".into()
                },
                OrtTreffer {
                    lat: 48.1,
                    lon: 11.5,
                    name: "Hauptstraße 12, Anderswo".into()
                },
            ])
        );
    }

    #[tokio::test]
    async fn leere_liste_ist_ok_ohne_treffer() {
        let (base, _a, _h) = such_stub(serde_json::json!([])).await;
        let cache = Mutex::new(SuchCache::default());
        let e = suche_mit(
            &client(),
            &bucket_voll(),
            &cache,
            &base,
            "xyzzy",
            None,
            Duration::ZERO,
        )
        .await;
        assert_eq!(e, SuchErgebnis::Ok(vec![]));
    }

    #[tokio::test]
    async fn unbrauchbare_eintraege_fallen_weg() {
        let (base, _a, _h) = such_stub(serde_json::json!([
            { "lat": "x", "lon": "10.0", "display_name": "Kaputt" },
            { "lat": "95.0", "lon": "10.0", "display_name": "Außerhalb" },
            { "lat": "51.0", "lon": "10.0", "display_name": "  " },
            { "lat": "51.0", "lon": "10.0", "display_name": "Gut" }
        ]))
        .await;
        let cache = Mutex::new(SuchCache::default());
        let e = suche_mit(
            &client(),
            &bucket_voll(),
            &cache,
            &base,
            "Gut",
            None,
            Duration::ZERO,
        )
        .await;
        assert_eq!(
            e,
            SuchErgebnis::Ok(vec![OrtTreffer {
                lat: 51.0,
                lon: 10.0,
                name: "Gut".into()
            }])
        );
    }

    #[tokio::test]
    async fn offline_ist_nicht_erreichbar() {
        let cache = Mutex::new(SuchCache::default());
        let e = suche_mit(
            &client(),
            &bucket_voll(),
            &cache,
            &geschlossener_port(),
            "Hauptstraße",
            None,
            Duration::ZERO,
        )
        .await;
        assert_eq!(e, SuchErgebnis::NichtErreichbar);
    }

    #[tokio::test]
    async fn antwort_ohne_liste_ist_nicht_erreichbar() {
        let (base, _a, _h) = such_stub(serde_json::json!({ "error": "x" })).await;
        let cache = Mutex::new(SuchCache::default());
        let e = suche_mit(
            &client(),
            &bucket_voll(),
            &cache,
            &base,
            "Hauptstraße",
            None,
            Duration::ZERO,
        )
        .await;
        assert_eq!(e, SuchErgebnis::NichtErreichbar);
    }

    #[tokio::test]
    async fn leerer_bucket_ist_ausgelastet_ohne_http() {
        let (base, aufrufe, _h) = such_stub(treffer_json()).await;
        let cache = Mutex::new(SuchCache::default());
        let e = suche_mit(
            &client(),
            &bucket_leer(),
            &cache,
            &base,
            "Hauptstraße",
            None,
            Duration::from_millis(150),
        )
        .await;
        assert_eq!(e, SuchErgebnis::Ausgelastet);
        assert!(aufrufe.lock().unwrap().is_empty());
    }

    #[tokio::test]
    async fn wartet_auf_das_naechste_token() {
        let (base, _a, _h) = such_stub(treffer_json()).await;
        // Leer, aber 20 Tokens/s: nach ~50 ms ist eins da.
        let mut b = TokenBucket::neu(20.0, 1.0);
        b.try_take();
        let cache = Mutex::new(SuchCache::default());
        let e = suche_mit(
            &client(),
            &Mutex::new(b),
            &cache,
            &base,
            "Hauptstraße",
            None,
            TOKEN_WARTEN_MAX,
        )
        .await;
        assert!(matches!(e, SuchErgebnis::Ok(ref t) if t.len() == 2));
    }

    #[tokio::test]
    async fn ausschnitt_und_parameter_kommen_an() {
        let (base, aufrufe, _h) = such_stub(treffer_json()).await;
        let cache = Mutex::new(SuchCache::default());
        suche_mit(
            &client(),
            &bucket_voll(),
            &cache,
            &base,
            "Hauptstraße 12",
            Some(Ausschnitt::um(51.0, 10.0)),
            Duration::ZERO,
        )
        .await;
        let q = aufrufe.lock().unwrap()[0].clone();
        assert!(q.contains("q=Hauptstra%C3%9Fe+12"), "{q}");
        assert!(q.contains("format=jsonv2"), "{q}");
        assert!(q.contains("limit=5"), "{q}");
        assert!(q.contains("accept-language=de"), "{q}");
        assert!(
            q.contains("viewbox=9.750%2C51.250%2C10.250%2C50.750"),
            "{q}"
        );
        assert!(q.contains("bounded=0"), "{q}");
    }

    #[tokio::test]
    async fn ohne_ausschnitt_keine_viewbox() {
        let (base, aufrufe, _h) = such_stub(treffer_json()).await;
        let cache = Mutex::new(SuchCache::default());
        suche_mit(
            &client(),
            &bucket_voll(),
            &cache,
            &base,
            "Hauptstraße",
            None,
            Duration::ZERO,
        )
        .await;
        let q = aufrufe.lock().unwrap()[0].clone();
        assert!(!q.contains("viewbox"), "{q}");
        assert!(!q.contains("bounded"), "{q}");
    }

    #[tokio::test]
    async fn zweite_gleiche_suche_kommt_aus_dem_cache() {
        let (base, aufrufe, _h) = such_stub(treffer_json()).await;
        let cache = Mutex::new(SuchCache::default());
        let bucket = bucket_voll();
        let erste = suche_mit(
            &client(),
            &bucket,
            &cache,
            &base,
            "Hauptstraße  12",
            None,
            Duration::ZERO,
        )
        .await;
        // Bucket jetzt leer: ein Cache-Fehlgriff liefe auf „ausgelastet“.
        let zweite = suche_mit(
            &client(),
            &bucket,
            &cache,
            &base,
            " hauptstraße 12 ",
            None,
            Duration::ZERO,
        )
        .await;
        assert_eq!(erste, zweite);
        assert_eq!(aufrufe.lock().unwrap().len(), 1);
    }

    #[tokio::test]
    async fn fehler_wird_nicht_gecacht() {
        let cache = Mutex::new(SuchCache::default());
        let tot = geschlossener_port();
        let e = suche_mit(
            &client(),
            &bucket_voll(),
            &cache,
            &tot,
            "Hauptstraße",
            None,
            Duration::ZERO,
        )
        .await;
        assert_eq!(e, SuchErgebnis::NichtErreichbar);
        assert!(cache.lock().unwrap().eintraege.is_empty());
    }

    #[test]
    fn cache_verdraengt_den_aeltesten() {
        let mut c = SuchCache::default();
        for i in 0..CACHE_MAX {
            c.schreibe(format!("k{i}"), vec![]);
        }
        c.schreibe("neu".into(), vec![]);
        assert_eq!(c.eintraege.len(), CACHE_MAX);
        assert!(c.eintraege.contains_key("neu"));
        assert!(!c.eintraege.contains_key("k0"));
    }

    #[test]
    fn abgelaufener_eintrag_ist_ein_fehlgriff() {
        let mut c = SuchCache::default();
        c.eintraege.insert(
            "alt".into(),
            (Instant::now() - CACHE_TTL - Duration::from_secs(1), vec![]),
        );
        assert!(c.lese("alt").is_none());
        assert!(c.eintraege.is_empty());
    }
}
