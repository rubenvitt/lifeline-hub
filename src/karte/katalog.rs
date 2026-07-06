//! Hybrid-Offline-Katalog (LFH-199): compiled-in Default ∪ optionales, best-effort geholtes
//! Remote-Manifest (gepinnte Mirror-URL). Der Fetch ist best-effort und darf den Katalog nie
//! brechen — bei jedem Fehler bleibt es beim compiled-in Default (bzw. dem letzten Cache-Stand).
//!
//! Der Cache ist prozessweit (ein Katalog pro App, kein Request-/Einsatz-Bezug) — analog zum
//! prozessweiten Reader-Cache in `mbtiles`. Bewusst KEIN AppState-Feld (spart das Durchreichen
//! durch alle Handler/Test-Konstruktionen).
use crate::config::{
    default_offline_katalog, eintrag_ist_lieferbar, merge_offline_katalog, OfflineKatalogEintrag,
};
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
    effektiver_katalog_intern(client, false).await
}

/// Wie `effektiver_katalog`, aber erzwingt einen Manifest-Fetch (umgeht das TTL-Gate). Für den
/// „Bauen & laden"-Fluss (LFH-206): direkt nach einem fertigen Region-Bau muss der frisch
/// publizierte Katalog-Eintrag sofort sichtbar sein, ohne die ~5-min-Cache-TTL abzuwarten.
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
        // Auch bei Fehlschlag den Zeitstempel setzen → toten Mirror nicht bei jedem Request pingen.
        *LETZTER_FETCH.write().unwrap() = Some(Instant::now());
    }
    // Download-Katalog: nur tatsächlich LIEFERBARE Einträge (Pin + echte URL). Ungebaute compiled-in
    // Platzhalter (TODO-URL, kein Pin) erscheinen NICHT als ladbar — gebaut wird über „Region neu
    // bauen", danach taucht die Region übers Manifest auf. Der Update-Check (`katalog_aus_cache`)
    // nutzt bewusst weiter den vollen Katalog.
    nur_lieferbare(katalog_aus_cache())
}

/// Filtert einen Katalog auf tatsächlich lieferbare Einträge (Pin + echte URL) — für den
/// Download-Katalog, damit ungebaute Platzhalter nicht als ladbar angeboten werden.
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

/// Effektive Manifest-URL: `LIFELINE_OFFLINE_KATALOG_MANIFEST_URL` (Ops-/Dev-Override) falls gesetzt
/// und nicht leer, sonst der compiled-in Pin (LFH-199-Trust). Nimmt Ops/lokalem Dev die Rebuild-
/// Reibung — Manifest-URL per Env setzen statt den const ändern + Backend neu bauen (LFH-204-Gap).
fn manifest_url() -> String {
    resolve_manifest_url(std::env::var("LIFELINE_OFFLINE_KATALOG_MANIFEST_URL").ok())
}

/// Reine Auswahl-Logik (env-frei testbar): ein nicht-leerer Override gewinnt, sonst der const-Default.
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
    fn nur_lieferbare_filtert_ungebaute_platzhalter() {
        // compiled-in sind unlieferbare TODO-Platzhalter (kein Pin) → aus dem Download-Katalog gefiltert.
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
            resolve_manifest_url(Some("https://cdn.example/maps/offline-katalog-manifest.json".into())),
            "https://cdn.example/maps/offline-katalog-manifest.json"
        );
    }

    #[test]
    fn manifest_url_faellt_auf_const_zurueck() {
        assert_eq!(resolve_manifest_url(None), OFFLINE_KATALOG_MANIFEST_URL);
        // leerer/whitespace-Override zählt nicht als gesetzt → const-Default.
        assert_eq!(resolve_manifest_url(Some("   ".into())), OFFLINE_KATALOG_MANIFEST_URL);
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
