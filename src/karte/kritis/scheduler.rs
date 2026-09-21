//! Periodische Erneuerung des KRITIS-Bestands aus dem OSM-Extrakt (LFH-83).
//!
//! Muster wie `backup::scheduler`: ein dünner Tokio-Task ruft [`tick_einmal`], die Logik ist
//! ohne laufenden Scheduler testbar. Anders als die Sicherung ist der Import **Default-an**
//! (Schalter `--kritis-extrakt`), weil die Ebene sonst leer bliebe.
//!
//! Ablauf je Tick: fällig? → `HEAD` auf den Extrakt → unverändert (gleiches `ETag` bzw.
//! `Last-Modified`)? dann nur den Zeitpunkt fortschreiben → sonst herunterladen, einlesen
//! (`spawn_blocking`), Bestand atomar tauschen. Die heruntergeladene Datei wird in jedem Fall
//! gelöscht; ein gescheiterter Lauf lässt den bisherigen Bestand unberührt, und der nächste
//! Tick versucht es erneut, weil `importiert_at` nicht fortgeschrieben wurde.

use super::bestand::{self, ImportMeta};
use super::extrakt;
use crate::karte::download::{self, Fortschritt};
use reqwest::header::{ETAG, LAST_MODIFIED};
use reqwest::Url;
use sqlx::SqlitePool;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

/// Wartezeit nach dem Serverstart bis zur ersten Prüfung — Start und erste Anfragen sollen
/// nicht mit einem Multi-GB-Download und dem CPU-lastigen Einlesen konkurrieren.
const START_VERZOEGERUNG: Duration = Duration::from_secs(60);

/// Takt der Fälligkeitsprüfung. Die Fälligkeit selbst hängt am gespeicherten
/// `importiert_at`, überlebt also Neustarts; der Tick trägt keinen eigenen Zustand.
const PRUEF_TAKT: Duration = Duration::from_secs(3600);

/// Obergrenze der Extrakt-Größe. Der Deutschland-Extrakt liegt bei rund 4–5 GB; die Grenze
/// fängt eine falsch konfigurierte URL (Planet-Datei, ~80 GB) ab, bevor die Platte vollläuft.
const MAX_EXTRAKT_BYTES: u64 = 20 * 1024 * 1024 * 1024;

/// Mindestabstand nach einem Lauf, der beim Herunterladen oder danach gescheitert ist (Review
/// LFH-83). Ohne ihn wäre der nächste stündliche Tick sofort wieder fällig und lüde dieselben
/// 4–5 GB erneut — bei einem dauerhaften Fehler (Platte voll, unlesbares Format) bis zu 24-mal
/// am Tag gegen Geofabrik. Bewusst eine Zeitsperre und kein Vergleich mit den Headern des
/// gescheiterten Versuchs: Geofabrik leitet auf wechselnde Spiegel um, deren `ETag`s sich
/// unterscheiden — ein Header-Vergleich griffe dann nie. Ein gescheitertes `HEAD` (kein Netz)
/// kostet nichts und sperrt nicht: ohne Internet soll der erste Import nicht Stunden warten.
pub const FEHLER_ABSTAND: Duration = Duration::from_secs(6 * 3600);

/// Threads des Einlesens (siehe `lade_und_lies`).
const IMPORT_THREADS: usize = 4;

/// Konfiguration aus `--kritis-extrakt*`.
#[derive(Debug, Clone)]
pub struct KritisExtraktConfig {
    pub aktiv: bool,
    pub url: String,
    pub intervall: Duration,
}

/// Was ein Tick getan hat — für Log und Tests.
#[derive(Debug, PartialEq)]
pub enum TickErgebnis {
    /// Der Bestand ist jünger als das Intervall.
    NichtFaellig,
    /// Der Extrakt ist seit dem letzten Import nicht neu erschienen; nichts heruntergeladen.
    Unveraendert,
    /// Neuer Bestand übernommen.
    Importiert { anzahl: usize },
    /// Fällig, aber der letzte Download-Versuch ist jünger als [`FEHLER_ABSTAND`].
    Zurueckgestellt,
}

/// Ist ein Lauf fällig? Ohne Bestand immer, sonst nach Ablauf des Intervalls.
pub fn ist_faellig(meta: Option<&ImportMeta>, jetzt: i64, intervall: Duration) -> bool {
    match meta {
        None => true,
        Some(m) => jetzt - m.importiert_at >= intervall.as_secs() as i64,
    }
}

/// Darf nach einem gescheiterten Download-Versuch (Unix-Sekunden) wieder geladen werden?
pub fn darf_laden(letzter_fehlversuch: Option<i64>, jetzt: i64) -> bool {
    letzter_fehlversuch.is_none_or(|t| jetzt - t >= FEHLER_ABSTAND.as_secs() as i64)
}

/// Gilt der Extrakt hinter diesen Headern als derselbe wie beim letzten Import? Das `ETag`
/// entscheidet, wenn beide Seiten eines haben; sonst `Last-Modified`. Ohne beides lässt sich
/// „unverändert" nicht belegen — dann wird geladen.
fn unveraendert(
    meta: &ImportMeta,
    url: &str,
    etag: Option<&str>,
    last_modified: Option<&str>,
) -> bool {
    if meta.quelle_url != url {
        return false;
    }
    match (meta.etag.as_deref(), etag) {
        (Some(a), Some(b)) => a == b,
        _ => matches!(
            (meta.last_modified.as_deref(), last_modified),
            (Some(a), Some(b)) if a == b
        ),
    }
}

/// `Last-Modified` (HTTP-Datum) als RFC 3339 — das ist der Datenstand, den Geofabrik setzt.
/// Fehlt er oder ist er unlesbar, gilt der Importzeitpunkt.
fn stand_aus(last_modified: Option<&str>, jetzt: i64) -> String {
    last_modified
        .and_then(|lm| chrono::DateTime::parse_from_rfc2822(lm).ok())
        .map(|d| d.with_timezone(&chrono::Utc).to_rfc3339())
        .or_else(|| chrono::DateTime::from_timestamp(jetzt, 0).map(|d| d.to_rfc3339()))
        .unwrap_or_default()
}

fn header(resp: &reqwest::Response, name: reqwest::header::HeaderName) -> Option<String> {
    resp.headers()
        .get(name)
        .and_then(|v| v.to_str().ok())
        .map(String::from)
}

/// Ein Lauf. `url` ist bereits geprüft (https bzw. Dev-Loopback, siehe [`starte`]).
/// `fehlversuch` hält der Aufrufer über die Ticks: ein Lauf, der ab dem Download scheitert,
/// setzt ihn, ein gelungener Import löscht ihn (siehe [`FEHLER_ABSTAND`]).
pub async fn tick_einmal(
    pool: &SqlitePool,
    verzeichnis: &Path,
    client: &reqwest::Client,
    url: &Url,
    intervall: Duration,
    jetzt: i64,
    fehlversuch: &mut Option<i64>,
) -> Result<TickErgebnis, String> {
    let meta = bestand::meta(pool).await;
    if !ist_faellig(meta.as_ref(), jetzt, intervall) {
        return Ok(TickErgebnis::NichtFaellig);
    }

    let kopf = client
        .head(url.clone())
        .send()
        .await
        .map_err(|e| format!("HEAD {url}: {e}"))?;
    if !kopf.status().is_success() {
        return Err(format!("HEAD {url}: HTTP {}", kopf.status()));
    }
    let etag = header(&kopf, ETAG);
    let last_modified = header(&kopf, LAST_MODIFIED);
    if let Some(m) = &meta {
        if unveraendert(m, url.as_str(), etag.as_deref(), last_modified.as_deref()) {
            bestand::bestaetige_unveraendert(pool, jetzt)
                .await
                .map_err(|e| format!("Zeitpunkt nicht fortschreibbar: {e}"))?;
            return Ok(TickErgebnis::Unveraendert);
        }
    }
    if !darf_laden(*fehlversuch, jetzt) {
        return Ok(TickErgebnis::Zurueckgestellt);
    }
    // Ab hier kostet ein Fehlschlag einen Multi-GB-Download: bis zum Erfolg gilt der Versuch
    // als gescheitert.
    *fehlversuch = Some(jetzt);

    tokio::fs::create_dir_all(verzeichnis)
        .await
        .map_err(|e| format!("{} nicht anlegbar: {e}", verzeichnis.display()))?;
    let datei = verzeichnis.join("extrakt.osm.pbf.part");
    let ergebnis = lade_und_lies(client, url, &datei).await;
    // Die Datei ist 4–5 GB groß — sie bleibt nie liegen, auch nicht nach einem Fehler.
    let _ = tokio::fs::remove_file(&datei).await;
    let objekte = ergebnis?;

    // Ein Extrakt ohne ein einziges Objekt ist kein leeres Deutschland, sondern eine falsche
    // Datei (Fehlkonfiguration, Wartungsseite). Er ersetzt den Bestand nicht.
    if objekte.is_empty() {
        return Err("Extrakt enthält keine KRITIS-Objekte — Bestand bleibt".into());
    }
    let neu = ImportMeta {
        stand: stand_aus(last_modified.as_deref(), jetzt),
        quelle_url: url.to_string(),
        last_modified,
        etag,
        importiert_at: jetzt,
        anzahl: objekte.len() as i64,
    };
    bestand::ersetze_bestand(pool, &objekte, &neu)
        .await
        .map_err(|e| format!("Bestand nicht tauschbar: {e}"))?;
    *fehlversuch = None;
    Ok(TickErgebnis::Importiert {
        anzahl: objekte.len(),
    })
}

async fn lade_und_lies(
    client: &reqwest::Client,
    url: &Url,
    datei: &Path,
) -> Result<Vec<extrakt::KritisObjekt>, String> {
    download::lade_datei(
        client,
        url.clone(),
        datei,
        &Fortschritt::default(),
        None,
        MAX_EXTRAKT_BYTES,
    )
    .await
    .map_err(|e| format!("Download {url}: {e}"))?;
    let pfad = datei.to_path_buf();
    tokio::task::spawn_blocking(move || {
        // Eigener Pool statt des globalen: gemessen am DE-Extrakt (Aufgabe 6.2) nahm der
        // globale Pool alle 16 Kerne und 3,6 GB Spitze; mit 4 Threads sind es ~0,6 GB bei
        // rund drei Minuten. Ein wöchentlicher Hintergrundlauf soll den Einsatzbetrieb
        // nicht ausbremsen.
        let pool = rayon::ThreadPoolBuilder::new()
            .num_threads(IMPORT_THREADS)
            .thread_name(|i| format!("kritis-import-{i}"))
            .build()
            .map_err(|e| format!("Import-Threads nicht startbar: {e}"))?;
        pool.install(|| extrakt::lies_extrakt(&pfad))
            .map_err(|e| format!("Extrakt nicht lesbar: {e}"))
    })
    .await
    .map_err(|e| format!("Einlesen abgebrochen: {e}"))?
}

/// Verhindert einen zweiten Scheduler im selben Prozess — zwei Läufe gleichzeitig luden
/// denselben Extrakt doppelt und schrieben in dieselbe Staging-Tabelle.
static GESTARTET: AtomicBool = AtomicBool::new(false);

/// Startet den Hintergrund-Job. Abgeschaltet oder mit unbrauchbarer URL wird kein Task
/// gespawnt; beides steht im Log.
pub fn starte(karten_dir: PathBuf, config: KritisExtraktConfig) {
    if !config.aktiv {
        tracing::info!("KRITIS-Extrakt-Import abgeschaltet (--kritis-extrakt false)");
        return;
    }
    let url = match download::validiere_download_url(&config.url) {
        Ok(u) => u,
        Err(e) => {
            tracing::error!(
                url = %config.url,
                "KRITIS-Extrakt-Import NICHT gestartet — URL unbrauchbar: {e}"
            );
            return;
        }
    };
    if GESTARTET.swap(true, Ordering::SeqCst) {
        return;
    }
    tracing::info!(
        url = %url,
        intervall_stunden = config.intervall.as_secs() / 3600,
        "KRITIS-Extrakt-Import aktiv"
    );
    tokio::spawn(async move {
        tokio::time::sleep(START_VERZOEGERUNG).await;
        let client = download::download_client();
        let verzeichnis = karten_dir.join("kritis");
        let mut ticker = tokio::time::interval(PRUEF_TAKT);
        let mut fehlversuch: Option<i64> = None;
        loop {
            ticker.tick().await;
            let pool = match crate::cache_db::cache_pool(&karten_dir).await {
                Ok(p) => p,
                Err(e) => {
                    tracing::error!("KRITIS-Import: Cache-DB nicht verfügbar: {e}");
                    continue;
                }
            };
            let jetzt = chrono::Utc::now().timestamp();
            match tick_einmal(
                &pool,
                &verzeichnis,
                &client,
                &url,
                config.intervall,
                jetzt,
                &mut fehlversuch,
            )
            .await
            {
                Ok(TickErgebnis::NichtFaellig) | Ok(TickErgebnis::Zurueckgestellt) => {}
                Ok(TickErgebnis::Unveraendert) => {
                    tracing::info!("KRITIS-Extrakt unverändert — Bestand bleibt")
                }
                Ok(TickErgebnis::Importiert { anzahl }) => {
                    tracing::info!(anzahl, "KRITIS-Bestand aus dem Extrakt erneuert")
                }
                Err(e) => tracing::warn!(
                    "KRITIS-Import fehlgeschlagen, nächster Versuch in einer Stunde: {e}"
                ),
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::AtomicUsize;
    use std::sync::Arc;

    const INTERVALL: Duration = Duration::from_secs(7 * 24 * 3600);
    const LM: &str = "Sun, 20 Sep 2026 20:21:44 GMT";

    fn fixture_bytes() -> Vec<u8> {
        std::fs::read(
            Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/kritis/mini.osm.pbf"),
        )
        .unwrap()
    }

    /// Loopback-Server für den Extrakt; zählt GETs (HEAD bedient axum über dieselbe Route).
    async fn server(body: Vec<u8>, etag: &'static str) -> (Url, Arc<AtomicUsize>) {
        use axum::{http::Method, response::IntoResponse, routing::get, Router};
        let gets = Arc::new(AtomicUsize::new(0));
        let zaehler = gets.clone();
        let app = Router::new().route(
            "/de.osm.pbf",
            get(move |m: Method| {
                if m == Method::GET {
                    zaehler.fetch_add(1, Ordering::SeqCst);
                }
                let b = body.clone();
                async move { ([("etag", etag), ("last-modified", LM)], b).into_response() }
            }),
        );
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        tokio::spawn(async move {
            axum::serve(listener, app).await.unwrap();
        });
        (
            Url::parse(&format!("http://127.0.0.1:{}/de.osm.pbf", addr.port())).unwrap(),
            gets,
        )
    }

    async fn pool() -> (tempfile::TempDir, SqlitePool) {
        let dir = tempfile::tempdir().unwrap();
        let p = crate::cache_db::cache_pool(dir.path()).await.unwrap();
        (dir, p)
    }

    fn leer(verzeichnis: &Path) -> bool {
        std::fs::read_dir(verzeichnis)
            .map(|mut d| d.next().is_none())
            .unwrap_or(true)
    }

    #[test]
    fn faelligkeit() {
        assert!(ist_faellig(None, 0, INTERVALL));
        let m = ImportMeta {
            stand: String::new(),
            quelle_url: String::new(),
            last_modified: None,
            etag: None,
            importiert_at: 1_000,
            anzahl: 1,
        };
        assert!(!ist_faellig(
            Some(&m),
            1_000 + INTERVALL.as_secs() as i64 - 1,
            INTERVALL
        ));
        assert!(ist_faellig(
            Some(&m),
            1_000 + INTERVALL.as_secs() as i64,
            INTERVALL
        ));
    }

    #[test]
    fn stand_ist_last_modified_in_rfc3339() {
        assert_eq!(stand_aus(Some(LM), 0), "2026-09-20T20:21:44+00:00");
        assert_eq!(stand_aus(None, 0), "1970-01-01T00:00:00+00:00");
    }

    #[tokio::test]
    async fn importiert_und_raeumt_die_datei_weg() {
        let (d, p) = pool().await;
        let (url, gets) = server(fixture_bytes(), "\"v1\"").await;
        let verz = d.path().join("kritis");
        let e = tick_einmal(
            &p,
            &verz,
            &download::download_client(),
            &url,
            INTERVALL,
            5_000,
            &mut None,
        )
        .await
        .unwrap();
        assert_eq!(e, TickErgebnis::Importiert { anzahl: 3 });
        assert_eq!(gets.load(Ordering::SeqCst), 1);
        assert!(leer(&verz), "Extrakt-Datei muss weg sein");
        let m = bestand::meta(&p).await.unwrap();
        assert_eq!(m.stand, "2026-09-20T20:21:44+00:00");
        assert_eq!(m.etag.as_deref(), Some("\"v1\""));
        assert_eq!(m.importiert_at, 5_000);
    }

    #[tokio::test]
    async fn nicht_faellig_tut_nichts() {
        let (d, p) = pool().await;
        let (url, gets) = server(fixture_bytes(), "\"v1\"").await;
        let verz = d.path().join("kritis");
        let c = download::download_client();
        tick_einmal(&p, &verz, &c, &url, INTERVALL, 5_000, &mut None)
            .await
            .unwrap();
        let e = tick_einmal(&p, &verz, &c, &url, INTERVALL, 5_001, &mut None)
            .await
            .unwrap();
        assert_eq!(e, TickErgebnis::NichtFaellig);
        assert_eq!(gets.load(Ordering::SeqCst), 1);
    }

    /// Spec „Unveränderter Extrakt": fällig, aber gleiches ETag → kein GET, nur Zeitpunkt.
    #[tokio::test]
    async fn unveraenderter_extrakt_wird_nicht_geladen() {
        let (d, p) = pool().await;
        let (url, gets) = server(fixture_bytes(), "\"v1\"").await;
        let verz = d.path().join("kritis");
        let c = download::download_client();
        tick_einmal(&p, &verz, &c, &url, INTERVALL, 5_000, &mut None)
            .await
            .unwrap();
        let spaeter = 5_000 + INTERVALL.as_secs() as i64;
        let e = tick_einmal(&p, &verz, &c, &url, INTERVALL, spaeter, &mut None)
            .await
            .unwrap();
        assert_eq!(e, TickErgebnis::Unveraendert);
        assert_eq!(gets.load(Ordering::SeqCst), 1, "kein zweiter Download");
        let m = bestand::meta(&p).await.unwrap();
        assert_eq!(m.importiert_at, spaeter);
        assert_eq!(m.anzahl, 3);
    }

    /// Spec „Abgebrochener Lauf": eine kaputte Datei lässt den alten Bestand stehen, räumt
    /// sich weg und schreibt die Fälligkeit NICHT fort (der nächste Tick versucht es erneut).
    #[tokio::test]
    async fn kaputter_extrakt_laesst_den_bestand_stehen() {
        let (d, p) = pool().await;
        let verz = d.path().join("kritis");
        let c = download::download_client();
        let (gut, _) = server(fixture_bytes(), "\"v1\"").await;
        tick_einmal(&p, &verz, &c, &gut, INTERVALL, 5_000, &mut None)
            .await
            .unwrap();

        let (kaputt, _) = server(b"kein pbf".to_vec(), "\"v2\"").await;
        let spaeter = 5_000 + INTERVALL.as_secs() as i64;
        let mut fehlversuch = None;
        let e = tick_einmal(&p, &verz, &c, &kaputt, INTERVALL, spaeter, &mut fehlversuch).await;
        assert!(e.is_err(), "{e:?}");
        assert_eq!(
            fehlversuch,
            Some(spaeter),
            "gescheiterter Download merkt sich den Zeitpunkt"
        );
        assert!(leer(&verz), "Datei auch nach Fehler weg");
        let m = bestand::meta(&p).await.unwrap();
        assert_eq!(m.anzahl, 3);
        assert_eq!(m.importiert_at, 5_000, "Fälligkeit bleibt bestehen");
        assert!(ist_faellig(Some(&m), spaeter, INTERVALL));
    }

    #[tokio::test]
    async fn nicht_erreichbar_ist_fehler_ohne_bestand() {
        let (d, p) = pool().await;
        // Port 1 auf Loopback: sofort ECONNREFUSED.
        let mut fehlversuch = None;
        let url = Url::parse("http://127.0.0.1:1/de.osm.pbf").unwrap();
        let e = tick_einmal(
            &p,
            &d.path().join("kritis"),
            &download::download_client(),
            &url,
            INTERVALL,
            0,
            &mut fehlversuch,
        )
        .await;
        assert!(e.is_err());
        assert!(bestand::meta(&p).await.is_none());
        // Ein gescheitertes HEAD hat nichts geladen — es sperrt den nächsten Versuch nicht.
        assert_eq!(fehlversuch, None);
    }

    #[test]
    fn fehlerabstand() {
        assert!(darf_laden(None, 0));
        let sperre = FEHLER_ABSTAND.as_secs() as i64;
        assert!(!darf_laden(Some(1_000), 1_000 + sperre - 1));
        assert!(darf_laden(Some(1_000), 1_000 + sperre));
    }

    /// Review LFH-83: ein dauerhaft scheiternder Lauf lud jede Stunde 4–5 GB neu. Nach einem
    /// Fehlschlag ab dem Download gibt es innerhalb von FEHLER_ABSTAND keinen zweiten GET —
    /// auch wenn der Spiegel ein anderes ETag meldet; danach wird es erneut versucht.
    #[tokio::test]
    async fn nach_fehlschlag_kein_neuer_download_vor_ablauf_der_sperre() {
        let (d, p) = pool().await;
        let verz = d.path().join("kritis");
        let c = download::download_client();
        let (kaputt, gets) = server(b"kein pbf".to_vec(), "\"v2\"").await;
        let mut fehlversuch = None;
        assert!(
            tick_einmal(&p, &verz, &c, &kaputt, INTERVALL, 0, &mut fehlversuch)
                .await
                .is_err()
        );
        assert_eq!(gets.load(Ordering::SeqCst), 1);

        let e = tick_einmal(&p, &verz, &c, &kaputt, INTERVALL, 3_600, &mut fehlversuch)
            .await
            .unwrap();
        assert_eq!(e, TickErgebnis::Zurueckgestellt);
        assert_eq!(
            gets.load(Ordering::SeqCst),
            1,
            "kein zweiter Download in der Sperre"
        );

        let (gut, gut_gets) = server(fixture_bytes(), "\"v3\"").await;
        let spaeter = FEHLER_ABSTAND.as_secs() as i64;
        let e = tick_einmal(&p, &verz, &c, &gut, INTERVALL, spaeter, &mut fehlversuch)
            .await
            .unwrap();
        assert_eq!(e, TickErgebnis::Importiert { anzahl: 3 });
        assert_eq!(gut_gets.load(Ordering::SeqCst), 1);
        assert_eq!(fehlversuch, None, "Erfolg hebt die Sperre auf");
    }

    #[test]
    fn unveraendert_vergleicht_etag_vor_last_modified() {
        let m = ImportMeta {
            stand: String::new(),
            quelle_url: "u".into(),
            last_modified: Some(LM.into()),
            etag: Some("a".into()),
            importiert_at: 0,
            anzahl: 1,
        };
        assert!(unveraendert(&m, "u", Some("a"), Some("anders")));
        assert!(!unveraendert(&m, "u", Some("b"), Some(LM)));
        assert!(unveraendert(&m, "u", None, Some(LM)));
        assert!(!unveraendert(&m, "u", None, None));
        assert!(!unveraendert(&m, "andere-url", Some("a"), Some(LM)));
    }
}
