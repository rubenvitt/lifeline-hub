//! Hybrid-Offline-Katalog (LFH-199): compiled-in Default ∪ optionales, best-effort geholtes
//! Remote-Manifest (gepinnte Mirror-URL). Der Fetch ist best-effort und darf den Katalog nie
//! brechen — bei jedem Fehler bleibt es beim compiled-in Default (bzw. dem letzten Cache-Stand).
//!
//! Der Cache ist prozessweit (ein Katalog pro App, kein Request-/Einsatz-Bezug) — analog zum
//! prozessweiten Reader-Cache in `mbtiles`. Bewusst KEIN AppState-Feld (spart das Durchreichen
//! durch alle Handler/Test-Konstruktionen).
use crate::config::{default_offline_katalog, merge_offline_katalog, OfflineKatalogEintrag};
use std::sync::{Arc, LazyLock, RwLock};

/// Gepinnte Manifest-URL am Eigen-Mirror (LFH-183). Platzhalter bis zum ersten Release —
/// bis dahin schlägt der Fetch sauber fehl → compiled-in Fallback.
pub const OFFLINE_KATALOG_MANIFEST_URL: &str =
    "https://TODO-karten-build-release/offline-katalog-manifest.json";

/// Zuletzt erfolgreich geholtes Remote-Manifest (in-memory). `None` = noch nichts geholt.
pub type KatalogCache = Arc<RwLock<Option<Vec<OfflineKatalogEintrag>>>>;

/// Prozessweiter Manifest-Cache.
static KATALOG_CACHE: LazyLock<KatalogCache> = LazyLock::new(Default::default);

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

/// Effektiver Katalog: best-effort Manifest-Fetch (aktualisiert den prozessweiten Cache bei
/// Erfolg), dann Merge. Jeder Fehler (offline, Statusfehler, Parse) wird verschluckt → Cache/
/// compiled-in bleibt. Für den `offline_katalog`-Handler.
pub async fn effektiver_katalog(client: &reqwest::Client) -> Vec<OfflineKatalogEintrag> {
    if let Some(remote) = hole_manifest(client).await {
        *KATALOG_CACHE.write().unwrap() = Some(remote);
    }
    katalog_aus_cache()
}

async fn hole_manifest(client: &reqwest::Client) -> Option<Vec<OfflineKatalogEintrag>> {
    let resp = client.get(OFFLINE_KATALOG_MANIFEST_URL).send().await.ok()?;
    if !resp.status().is_success() {
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
