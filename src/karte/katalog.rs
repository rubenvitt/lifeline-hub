//! Hybrid-Offline-Katalog (LFH-199): einkompilierter Default ∪ optionales, best-effort geholtes
//! Remote-Manifest (gepinnte Mirror-URL). Bei jedem Fehler bleibt es beim Default bzw. dem
//! letzten Cache-Stand.
//!
//! Der Cache ist prozessweit (ein Katalog je App), kein AppState-Feld.
use crate::config::{
    default_offline_katalog, eintrag_ist_lieferbar, merge_offline_katalog, OfflineKatalogEintrag,
};
use std::sync::{Arc, LazyLock, RwLock};
use std::time::{Duration, Instant};

/// Öffentliche Basis des Vorgabe-Katalogs: der Bucket, in den der `karten-service` des Projekts
/// Karten und Manifest veröffentlicht (LLH-1546). Eine eigene Installation ohne
/// `--offline-katalog-manifest-url` lädt ihre Offline-Karten von hier.
pub const KARTEN_BASIS_URL: &str = "https://karten.rubeen.dev";

/// Gepinnte Manifest-URL unter [`KARTEN_BASIS_URL`]. Scheitert der Abruf (offline, Mirror weg),
/// bleibt es beim einkompilierten Katalog bzw. dem letzten Cache-Stand.
pub const OFFLINE_KATALOG_MANIFEST_URL: &str =
    "https://karten.rubeen.dev/offline-katalog-manifest.json";

/// TTL des Manifest-Caches; auch ein fehlgeschlagener Fetch pausiert so lange (kein Hämmern auf
/// einen toten Mirror).
const CACHE_TTL: Duration = Duration::from_secs(300);

/// Obergrenze für das Manifest (ein kuratierter Katalog hat wenige KB).
const MAX_MANIFEST_BYTES: u64 = 1024 * 1024;

/// Zuletzt erfolgreich geholtes Remote-Manifest (in-memory). `None` = noch nichts geholt.
pub type KatalogCache = Arc<RwLock<Option<Vec<OfflineKatalogEintrag>>>>;

/// Prozessweiter Manifest-Cache.
static KATALOG_CACHE: LazyLock<KatalogCache> = LazyLock::new(Default::default);

/// Zeitpunkt des letzten Fetch-Versuchs (Erfolg oder Fehler); steuert das TTL-Gate.
static LETZTER_FETCH: LazyLock<RwLock<Option<Instant>>> = LazyLock::new(|| RwLock::new(None));

/// Merge des einkompilierten Katalogs mit einem gegebenen Cache, ohne Netz und ohne den
/// prozessweiten Zustand.
pub fn merge_mit_cache(cache: &KatalogCache) -> Vec<OfflineKatalogEintrag> {
    let remote = cache.read().unwrap().clone();
    merge_offline_katalog(default_offline_katalog(), remote)
}

/// Einkompiliert ∪ prozessweiter Cache (ohne Netz), für den Update-Check in `offline_liste`.
pub fn katalog_aus_cache() -> Vec<OfflineKatalogEintrag> {
    merge_mit_cache(&KATALOG_CACHE)
}

/// Effektiver Katalog: TTL-gebändigter best-effort Manifest-Fetch, dann Merge. Jeder Fehler
/// wird verschluckt. `client` muss kurz getimeboxt sein, sonst blockiert ein langsamer Mirror
/// den Handler.
pub async fn effektiver_katalog(client: &reqwest::Client) -> Vec<OfflineKatalogEintrag> {
    effektiver_katalog_intern(client, false).await
}

/// Wie `effektiver_katalog`, aber mit erzwungenem Fetch: nach einem Region-Bau muss der frisch
/// publizierte Eintrag sofort sichtbar sein.
pub async fn effektiver_katalog_frisch(client: &reqwest::Client) -> Vec<OfflineKatalogEintrag> {
    effektiver_katalog_intern(client, true).await
}

async fn effektiver_katalog_intern(
    client: &reqwest::Client,
    frisch: bool,
) -> Vec<OfflineKatalogEintrag> {
    if frisch || fetch_faellig() {
        if let Some(remote) = hole_manifest(client).await {
            *KATALOG_CACHE.write().unwrap() = Some(remote);
        }
        // Auch bei Fehlschlag den Zeitstempel setzen, damit ein toter Mirror nicht je Request
        // gepingt
        // wird.
        *LETZTER_FETCH.write().unwrap() = Some(Instant::now());
    }
    // Nur LIEFERBARE Einträge (Pin + echte URL); einkompilierte Platzhalter erscheinen nicht als
    // ladbar. Der Update-Check filtert ebenso (`finde_update_eintrag`), damit „Aktualisieren“ nie
    // auf einen ungebauten Platzhalter läuft.
    nur_lieferbare(katalog_aus_cache())
}

/// Filtert auf lieferbare Einträge (Pin + echte URL).
fn nur_lieferbare(katalog: Vec<OfflineKatalogEintrag>) -> Vec<OfflineKatalogEintrag> {
    katalog.into_iter().filter(eintrag_ist_lieferbar).collect()
}

/// Ist ein (erneuter) Fetch fällig? Ja, wenn noch nie geholt oder der letzte Versuch älter als TTL.
fn fetch_faellig() -> bool {
    match *LETZTER_FETCH.read().unwrap() {
        None => true,
        Some(t) => t.elapsed() >= CACHE_TTL,
    }
}

/// Effektive Manifest-URL: der Override `--offline-katalog-manifest-url` /
/// `LIFELINE_OFFLINE_KATALOG_MANIFEST_URL`, falls gesetzt und nicht leer, sonst der
/// einkompilierte Pin. Gelesen aus der beim Start gesetzten [`crate::karte::KarteConfig`] —
/// der Override verbiegt eine vertraute Quelle und gehört sichtbar in `--help` und ins Log.
fn manifest_url() -> String {
    resolve_manifest_url(
        crate::karte::karte_config()
            .offline_katalog_manifest_url
            .clone(),
    )
}

/// Auswahl-Logik, env-frei testbar: ein nicht leerer Override gewinnt.
fn resolve_manifest_url(override_env: Option<String>) -> String {
    match override_env {
        Some(u) if !u.trim().is_empty() => u,
        _ => OFFLINE_KATALOG_MANIFEST_URL.to_string(),
    }
}

async fn hole_manifest(client: &reqwest::Client) -> Option<Vec<OfflineKatalogEintrag>> {
    hole_manifest_von(client, &manifest_url()).await
}

/// Holt und parst ein Manifest. Der Größen-Guard greift zweimal: vorab über `Content-Length`
/// und beim Lesen, damit auch eine Antwort ohne Längenangabe (chunked) nie mehr als
/// `MAX_MANIFEST_BYTES` in den Speicher bringt (LLH-1546: seit der echten Vorgabe-URL ruft
/// jede Installation ohne Override das Manifest ab).
async fn hole_manifest_von(
    client: &reqwest::Client,
    url: &str,
) -> Option<Vec<OfflineKatalogEintrag>> {
    let mut resp = client.get(url).send().await.ok()?;
    if !resp.status().is_success() {
        return None;
    }
    if resp
        .content_length()
        .is_some_and(|n| n > MAX_MANIFEST_BYTES)
    {
        return None;
    }
    let mut body = Vec::new();
    while let Some(stueck) = resp.chunk().await.ok()? {
        if (body.len() + stueck.len()) as u64 > MAX_MANIFEST_BYTES {
            return None;
        }
        body.extend_from_slice(&stueck);
    }
    serde_json::from_slice(&body).ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    // Tests nutzen lokale Caches statt des prozessweiten, damit sie isoliert bleiben.
    #[test]
    fn merge_ohne_cache_ist_compiled_in() {
        let cache: KatalogCache = Default::default();
        assert_eq!(
            merge_mit_cache(&cache).len(),
            default_offline_katalog().len()
        );
    }

    #[test]
    fn nur_lieferbare_filtert_ungebaute_platzhalter() {
        // Einkompilierte Einträge sind Platzhalter ohne Pin und werden gefiltert.
        assert!(nur_lieferbare(default_offline_katalog()).is_empty());
        // Ein gebauter/gepinnter Eintrag (echte URL + sha256) bleibt.
        let gebaut = OfflineKatalogEintrag {
            name: "Nordrhein-Westfalen".into(),
            url: "https://cdn.example/maps/nrw.mbtiles".into(),
            region: "DE-NW".into(),
            groesse: 500_000_000,
            lizenz: "© OSM (ODbL)".into(),
            kachel_schema: "shortbread".into(),
            quelle: "Eigen-Service".into(),
            sha256: Some("a".repeat(64)),
            gruppe: Some("Bundesländer".into()),
            adressindex: None,
        };
        let mut mix = default_offline_katalog();
        mix.push(gebaut);
        let out = nur_lieferbare(mix);
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].name, "Nordrhein-Westfalen");
    }

    #[test]
    fn manifest_url_override_gewinnt_wenn_gesetzt() {
        assert_eq!(
            resolve_manifest_url(Some(
                "https://cdn.example/maps/offline-katalog-manifest.json".into()
            )),
            "https://cdn.example/maps/offline-katalog-manifest.json"
        );
    }

    /// Lokaler Server, der `stuecke` × `laenge` Bytes ohne `Content-Length` (chunked) liefert.
    async fn streamender_server(stuecke: usize, laenge: usize, inhalt: u8) -> String {
        use axum::{body::Body, routing::get, Router};
        let app = Router::new().route(
            "/m.json",
            get(move || async move {
                let s = futures::stream::iter(
                    (0..stuecke).map(move |_| Ok::<_, std::io::Error>(vec![inhalt; laenge])),
                );
                Body::from_stream(s)
            }),
        );
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        tokio::spawn(async move {
            axum::serve(listener, app).await.unwrap();
        });
        format!("http://127.0.0.1:{}/m.json", addr.port())
    }

    #[tokio::test]
    async fn manifest_ohne_laengenangabe_ueber_der_grenze_wird_verworfen() {
        // 2 MiB Leerzeichen, chunked: vorab greift kein Content-Length, der Lese-Guard muss.
        let url = streamender_server(32, 64 * 1024, b' ').await;
        let client = reqwest::Client::new();
        assert!(hole_manifest_von(&client, &url).await.is_none());
    }

    #[tokio::test]
    async fn manifest_ohne_laengenangabe_unter_der_grenze_wird_gelesen() {
        // `[]` gefolgt von Leerraum, chunked, deutlich unter 1 MiB → leere Liste.
        let url = {
            use axum::{body::Body, routing::get, Router};
            let app = Router::new().route(
                "/m.json",
                get(|| async {
                    let teile = vec![b"[".to_vec(), vec![b' '; 4096], b"]".to_vec()];
                    Body::from_stream(futures::stream::iter(
                        teile.into_iter().map(Ok::<_, std::io::Error>),
                    ))
                }),
            );
            let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
            let addr = listener.local_addr().unwrap();
            tokio::spawn(async move {
                axum::serve(listener, app).await.unwrap();
            });
            format!("http://127.0.0.1:{}/m.json", addr.port())
        };
        let client = reqwest::Client::new();
        assert_eq!(
            hole_manifest_von(&client, &url).await.map(|v| v.len()),
            Some(0)
        );
    }

    #[test]
    fn vorgabe_manifest_liegt_unter_der_karten_basis() {
        // LLH-1546: kein Platzhalter mehr als Vorgabe; Manifest und Platzhalter-Einträge zeigen
        // auf denselben Bucket, und beide sind https.
        assert!(KARTEN_BASIS_URL.starts_with("https://"));
        assert!(!KARTEN_BASIS_URL.ends_with('/'));
        assert_eq!(
            OFFLINE_KATALOG_MANIFEST_URL,
            format!("{KARTEN_BASIS_URL}/offline-katalog-manifest.json")
        );
        assert!(!OFFLINE_KATALOG_MANIFEST_URL.contains("TODO"));
        assert!(reqwest::Url::parse(OFFLINE_KATALOG_MANIFEST_URL).is_ok());
    }

    #[test]
    fn manifest_url_faellt_auf_const_zurueck() {
        assert_eq!(resolve_manifest_url(None), OFFLINE_KATALOG_MANIFEST_URL);
        // leerer/whitespace-Override zählt nicht als gesetzt → const-Default.
        assert_eq!(
            resolve_manifest_url(Some("   ".into())),
            OFFLINE_KATALOG_MANIFEST_URL
        );
    }

    #[test]
    fn merge_mit_cache_merged_remote() {
        let cache: KatalogCache = Default::default();
        *cache.write().unwrap() = Some(vec![OfflineKatalogEintrag {
            name: "DACH (DE/AT/CH)".into(),
            url: "https://mirror.example/dach.mbtiles".into(),
            region: "DACH".into(),
            groesse: 5_000_000_000,
            lizenz: "© OSM (ODbL)".into(),
            kachel_schema: "shortbread".into(),
            quelle: "mirror".into(),
            sha256: Some("c".repeat(64)),
            gruppe: Some("DACH".into()),
            adressindex: None,
        }]);
        let out = merge_mit_cache(&cache);
        let dach = out.iter().find(|e| e.name == "DACH (DE/AT/CH)").unwrap();
        assert_eq!(
            dach.url, "https://mirror.example/dach.mbtiles",
            "Cache-Remote gemerged"
        );
    }
}
