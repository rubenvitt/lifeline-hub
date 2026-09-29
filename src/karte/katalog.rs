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

/// Gepinnte Manifest-URL am Eigen-Mirror. Bis zum ersten Release ein Platzhalter; der Fetch
/// schlägt dann sauber fehl → einkompilierter Fallback.
pub const OFFLINE_KATALOG_MANIFEST_URL: &str =
    "https://TODO-karten-build-release/offline-katalog-manifest.json";

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
    // auf eine TODO-URL läuft.
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
    let resp = client.get(manifest_url()).send().await.ok()?;
    if !resp.status().is_success() {
        return None;
    }
    // Größen-Guard: ein riesiger Body wäre ein Fehler oder Angriff.
    if resp
        .content_length()
        .is_some_and(|n| n > MAX_MANIFEST_BYTES)
    {
        return None;
    }
    resp.json::<Vec<OfflineKatalogEintrag>>().await.ok()
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
        }]);
        let out = merge_mit_cache(&cache);
        let dach = out.iter().find(|e| e.name == "DACH (DE/AT/CH)").unwrap();
        assert_eq!(
            dach.url, "https://mirror.example/dach.mbtiles",
            "Cache-Remote gemerged"
        );
    }
}
