//! Hybrid-Offline-Katalog (LFH-199): compiled-in Default ∪ optionales, best-effort geholtes
//! Remote-Manifest (gepinnte Mirror-URL). Der Fetch ist best-effort und darf den Katalog nie
//! brechen — bei jedem Fehler bleibt es beim compiled-in Default (bzw. dem letzten Cache-Stand).
//!
//! Der Cache ist prozessweit (ein Katalog pro App, kein Request-/Einsatz-Bezug) — analog zum
//! prozessweiten Reader-Cache in `mbtiles`. Bewusst KEIN AppState-Feld (spart das Durchreichen
//! durch alle Handler/Test-Konstruktionen).
use crate::config::{default_offline_katalog, merge_offline_katalog, OfflineKatalogEintrag};
use std::sync::{Arc, LazyLock, RwLock};
use std::time::{Duration, Instant};

/// Gepinnte Manifest-URL am Eigen-Mirror (LFH-183). Platzhalter bis zum ersten Release —
/// bis dahin schlägt der Fetch sauber fehl → compiled-in Fallback.
pub const OFFLINE_KATALOG_MANIFEST_URL: &str =
    "https://TODO-karten-build-release/offline-katalog-manifest.json";

/// TTL des Manifest-Caches: der Katalog ändert selten, also nicht bei jedem Request neu fetchen
/// (auch ein fehlgeschlagener Fetch pausiert für diese Dauer → kein Hämmern eines toten Mirrors).
const CACHE_TTL: Duration = Duration::from_secs(300);

/// Obergrenze für das Manifest (ein kuratierter ~5–20-Einträge-Katalog ist wenige KB groß) —
/// verhindert, dass ein unerwartet riesiger Body den Handler-Speicher belastet.
const MAX_MANIFEST_BYTES: u64 = 1024 * 1024;

/// Zuletzt erfolgreich geholtes Remote-Manifest (in-memory). `None` = noch nichts geholt.
pub type KatalogCache = Arc<RwLock<Option<Vec<OfflineKatalogEintrag>>>>;

/// Prozessweiter Manifest-Cache.
static KATALOG_CACHE: LazyLock<KatalogCache> = LazyLock::new(Default::default);

/// Zeitpunkt des letzten Fetch-Versuchs (Erfolg ODER Fehler) — steuert das TTL-Gate.
static LETZTER_FETCH: LazyLock<RwLock<Option<Instant>>> = LazyLock::new(|| RwLock::new(None));

/// Synchroner Merge des compiled-in Katalogs mit einem gegebenen Cache (ohne Netz) — testbar mit
/// einem lokalen Cache, ohne den prozessweiten Zustand anzufassen.
pub fn merge_mit_cache(cache: &KatalogCache) -> Vec<OfflineKatalogEintrag> {
    let remote = cache.read().unwrap().clone();
    merge_offline_katalog(default_offline_katalog(), remote)
}

/// compiled-in ∪ prozessweiter Cache (ohne Netz) — für `offline_liste`s Update-Check.
pub fn katalog_aus_cache() -> Vec<OfflineKatalogEintrag> {
    merge_mit_cache(&KATALOG_CACHE)
}

/// Effektiver Katalog: TTL-gebändigter best-effort Manifest-Fetch (aktualisiert den prozessweiten
/// Cache bei Erfolg), dann Merge. Jeder Fehler (offline, Statusfehler, Parse) wird verschluckt →
/// Cache/compiled-in bleibt. Für den `offline_katalog`-Handler. `client` muss ein kurz getimeboxter
/// Client sein (kleiner JSON-Abruf, kein GB-Download) — sonst kann ein langsamer Mirror den Handler
/// blockieren.
pub async fn effektiver_katalog(client: &reqwest::Client) -> Vec<OfflineKatalogEintrag> {
    if fetch_faellig() {
        if let Some(remote) = hole_manifest(client).await {
            *KATALOG_CACHE.write().unwrap() = Some(remote);
        }
        // Auch bei Fehlschlag den Zeitstempel setzen → toten Mirror nicht bei jedem Request pingen.
        *LETZTER_FETCH.write().unwrap() = Some(Instant::now());
    }
    katalog_aus_cache()
}

/// Ist ein (erneuter) Fetch fällig? Ja, wenn noch nie geholt oder der letzte Versuch älter als TTL.
fn fetch_faellig() -> bool {
    match *LETZTER_FETCH.read().unwrap() {
        None => true,
        Some(t) => t.elapsed() >= CACHE_TTL,
    }
}

async fn hole_manifest(client: &reqwest::Client) -> Option<Vec<OfflineKatalogEintrag>> {
    let resp = client.get(OFFLINE_KATALOG_MANIFEST_URL).send().await.ok()?;
    if !resp.status().is_success() {
        return None;
    }
    // Größen-Guard: ein plausibler Katalog ist winzig; ein riesiger Body wäre ein Fehler/Angriff.
    if resp.content_length().is_some_and(|n| n > MAX_MANIFEST_BYTES) {
        return None;
    }
    resp.json::<Vec<OfflineKatalogEintrag>>().await.ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    // Tests nutzen LOKALE Caches (nicht den prozessweiten static), damit sie isoliert bleiben.
    #[test]
    fn merge_ohne_cache_ist_compiled_in() {
        let cache: KatalogCache = Default::default();
        assert_eq!(merge_mit_cache(&cache).len(), default_offline_katalog().len());
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
        }]);
        let out = merge_mit_cache(&cache);
        let dach = out.iter().find(|e| e.name == "DACH (DE/AT/CH)").unwrap();
        assert_eq!(dach.url, "https://mirror.example/dach.mbtiles", "Cache-Remote gemerged");
    }
}
