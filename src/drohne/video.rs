//! Bündelung des HLS-Livebilds der Drohne (LLH-2107): viele Zuschauer, ein Abruf je Datei.
//!
//! [`Buendel`] hält nur Antwort-Bytes: laufende Abrufe (`futures::Shared`, Muster
//! `karte::tile_cache::hole_gebuendelt`) und fertige Dateien mit kurzer Lebensdauer. Der Abruf
//! selbst ist ein Closure des Aufrufers; er baut seinen `LiveKontext` (entschlüsselte Geheimnisse)
//! selbst und gibt ihn danach frei. Nichts davon liegt im Bündel (`src/AGENTS.md`, „Adapter“).

use futures::FutureExt;
use std::collections::HashMap;
use std::future::Future;
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Duration;
use tokio::time::Instant;

use axum::body::Bytes;

/// Gesamtdeckel aller gehaltenen Dateien.
pub const GESAMT_DECKEL: usize = 64 * 1024 * 1024;

/// Schlüssel einer Datei: Adapter, Videokennung, Dateiname.
pub type Schluessel = (String, String, String);

/// Warum ein Abruf kein Ergebnis hat. Bewusst klein und `Clone`: alle Wartenden bekommen ihn.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum VideoFehler {
    /// Der Live-Abruf wurde verweigert (kein Livebild).
    Verweigert,
    /// Fehler im Server.
    Intern,
    /// Das Ziel ist gescheitert oder lieferte Ungültiges.
    Upstream,
}

fn endung(file: &str) -> Option<String> {
    file.rsplit_once('.').map(|(_, e)| e.to_ascii_lowercase())
}

/// Ob `file` eine Playlist ist (Endung ohne Groß-/Kleinschreibung). Einzige Quelle dieser
/// Entscheidung: Prüfung, Deckel und Cache-Kopf hängen daran.
pub fn is_playlist(file: &str) -> bool {
    endung(file).as_deref() == Some("m3u8")
}

/// Lebensdauer einer Datei im Bündel; `None` für eine Endung, die der Proxy nicht ausliefert.
/// Eine Playlist wechselt jede Sekunde, ein Segment ändert sich nie.
pub fn ttl_for(file: &str) -> Option<Duration> {
    match endung(file)?.as_str() {
        "m3u8" => Some(Duration::from_secs(1)),
        "mp4" | "m4s" | "ts" => Some(Duration::from_secs(30)),
        _ => None,
    }
}

/// Inhaltstyp nach Endung; der des Ziels wird nie durchgereicht.
pub fn content_type_for(file: &str) -> Option<&'static str> {
    match endung(file)?.as_str() {
        "m3u8" => Some("application/vnd.apple.mpegurl"),
        "mp4" => Some("video/mp4"),
        "m4s" => Some("video/iso.segment"),
        "ts" => Some("video/mp2t"),
        _ => None,
    }
}

/// Eine URI darf nur relativ auf eine Datei im selben Verzeichnis zeigen: kein Schema, kein
/// Netzpfad, kein absoluter Pfad, kein `..`, kein Rückwärtsstrich.
fn check_uri(uri: &str) -> Result<(), VideoFehler> {
    let pfad = uri.split(['?', '#']).next().unwrap_or("");
    let schema = pfad.find(':').is_some_and(|i| !pfad[..i].contains('/'));
    if uri.is_empty()
        || schema
        || uri.starts_with('/')
        || uri.contains('\\')
        || pfad.split('/').any(|teil| teil == "..")
        || uri.chars().any(char::is_control)
    {
        return Err(VideoFehler::Upstream);
    }
    Ok(())
}

/// Prüft eine Playlist: jede URI-Zeile und jedes `URI="…"` in einem Tag (`#EXT-X-MAP`,
/// `#EXT-X-MEDIA`, `#EXT-X-PART`, `#EXT-X-PRELOAD-HINT`) ist relativ, ohne `..`, ohne Schema.
/// Der Spieler löst sie gegen die Proxy-Adresse auf; alles andere ginge am Proxy vorbei.
pub fn check_playlist(bytes: &[u8]) -> Result<(), VideoFehler> {
    let text = std::str::from_utf8(bytes).map_err(|_| VideoFehler::Upstream)?;
    for zeile in text.lines() {
        let zeile = zeile.trim();
        if zeile.is_empty() {
            continue;
        }
        if !zeile.starts_with('#') {
            check_uri(zeile)?;
            continue;
        }
        let mut rest = zeile;
        while let Some(i) = rest.find("URI=") {
            rest = &rest[i + 4..];
            let wert = match rest.strip_prefix('"') {
                Some(r) => r.split('"').next().unwrap_or(""),
                None => rest.split(',').next().unwrap_or(""),
            };
            check_uri(wert)?;
        }
    }
    Ok(())
}

type Geteilt =
    futures::future::Shared<futures::future::BoxFuture<'static, Result<Bytes, VideoFehler>>>;

struct Eintrag {
    bytes: Bytes,
    bis: Instant,
    reihe: u64,
}

#[derive(Default)]
struct Innen {
    laufend: HashMap<Schluessel, Geteilt>,
    fertig: HashMap<Schluessel, Eintrag>,
    summe: usize,
    reihe: u64,
}

impl Innen {
    fn verwerfe(&mut self, key: &Schluessel) {
        if let Some(e) = self.fertig.remove(key) {
            self.summe -= e.bytes.len();
        }
    }

    /// Legt eine Datei ab; zuerst fliegt Abgelaufenes, dann das Älteste, bis der Deckel passt.
    fn lege_ab(&mut self, key: Schluessel, bytes: Bytes, ttl: Duration, deckel: usize) {
        self.verwerfe(&key);
        if bytes.len() > deckel {
            return;
        }
        let jetzt = Instant::now();
        let abgelaufen: Vec<Schluessel> = self
            .fertig
            .iter()
            .filter(|(_, e)| e.bis <= jetzt)
            .map(|(k, _)| k.clone())
            .collect();
        for k in abgelaufen {
            self.verwerfe(&k);
        }
        while self.summe + bytes.len() > deckel {
            let aeltester = self
                .fertig
                .iter()
                .min_by_key(|(_, e)| e.reihe)
                .map(|(k, _)| k.clone());
            match aeltester {
                Some(k) => self.verwerfe(&k),
                None => break,
            }
        }
        self.reihe += 1;
        self.summe += bytes.len();
        self.fertig.insert(
            key,
            Eintrag {
                bytes,
                bis: jetzt + ttl,
                reihe: self.reihe,
            },
        );
    }
}

/// Trägt den laufenden Abruf beim Drop aus, auch bei Panik des Abruf-Tasks.
struct Austrag(Arc<Mutex<Innen>>, Schluessel);

impl Drop for Austrag {
    fn drop(&mut self) {
        sperre(&self.0).laufend.remove(&self.1);
    }
}

fn sperre(m: &Mutex<Innen>) -> std::sync::MutexGuard<'_, Innen> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

/// Bündelt Abrufe je Datei: gleichzeitige Anfragen teilen einen Abruf, eine fertige Datei bleibt
/// für ihre Lebensdauer im Arbeitsspeicher. Der Abruf läuft als eigener Task weiter, auch wenn
/// der auslösende Client abbricht.
pub struct Buendel {
    innen: Arc<Mutex<Innen>>,
    deckel: usize,
}

impl Default for Buendel {
    fn default() -> Self {
        Self::new()
    }
}

impl Buendel {
    pub fn new() -> Self {
        Self::with_deckel(GESAMT_DECKEL)
    }

    pub fn with_deckel(deckel: usize) -> Self {
        Buendel {
            innen: Arc::default(),
            deckel,
        }
    }

    /// Liefert die Datei aus dem Bündel oder holt sie mit `fetch` (einmal, egal wie viele
    /// gleichzeitig fragen). Fehler werden nicht gehalten. `fetch` baut seinen Zugang selbst auf
    /// und gibt ihn vor der Rückkehr frei; das Bündel sieht nur Bytes.
    pub async fn get_or_fetch<F, Fut>(
        &self,
        key: Schluessel,
        ttl: Duration,
        fetch: F,
    ) -> Result<Bytes, VideoFehler>
    where
        F: FnOnce() -> Fut + Send + 'static,
        Fut: Future<Output = Result<Bytes, VideoFehler>> + Send + 'static,
    {
        let abruf = {
            // Kein `await` unter der Sperre; `tokio::spawn` startet nur.
            let mut innen = sperre(&self.innen);
            if let Some(e) = innen.fertig.get(&key) {
                if e.bis > Instant::now() {
                    return Ok(e.bytes.clone());
                }
                innen.verwerfe(&key);
            }
            match innen.laufend.get(&key) {
                Some(l) => l.clone(),
                None => {
                    let (tx, rx) = tokio::sync::oneshot::channel();
                    let (speicher, deckel, k) = (self.innen.clone(), self.deckel, key.clone());
                    tokio::spawn(async move {
                        let austrag = Austrag(speicher.clone(), k.clone());
                        let erg = fetch().await;
                        if let Ok(b) = &erg {
                            sperre(&speicher).lege_ab(k, b.clone(), ttl, deckel);
                        }
                        drop(austrag);
                        let _ = tx.send(erg);
                    });
                    let geteilt = async move { rx.await.unwrap_or(Err(VideoFehler::Intern)) }
                        .boxed()
                        .shared();
                    innen.laufend.insert(key, geteilt.clone());
                    geteilt
                }
            }
        };
        abruf.await
    }
}

/// Das Bündel des Prozesses.
pub fn buendel() -> &'static Buendel {
    static B: OnceLock<Buendel> = OnceLock::new();
    B.get_or_init(Buendel::new)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};

    fn schluessel(datei: &str) -> Schluessel {
        ("a1".into(), "k1".into(), datei.into())
    }

    #[tokio::test]
    async fn zehn_gleichzeitige_anfragen_ein_abruf() {
        let b = Arc::new(Buendel::new());
        let zaehler = Arc::new(AtomicUsize::new(0));
        let mut aufgaben = Vec::new();
        for _ in 0..10 {
            let (b, z) = (b.clone(), zaehler.clone());
            aufgaben.push(tokio::spawn(async move {
                b.get_or_fetch(
                    schluessel("seg1.mp4"),
                    Duration::from_secs(30),
                    move || async move {
                        z.fetch_add(1, Ordering::SeqCst);
                        tokio::time::sleep(Duration::from_millis(100)).await;
                        Ok(Bytes::from_static(b"daten"))
                    },
                )
                .await
            }));
        }
        for a in aufgaben {
            assert_eq!(a.await.unwrap().unwrap(), Bytes::from_static(b"daten"));
        }
        assert_eq!(zaehler.load(Ordering::SeqCst), 1);
    }

    #[tokio::test]
    async fn ttl_läuft_ab() {
        let b = Buendel::new();
        let zaehler = Arc::new(AtomicUsize::new(0));
        let hole = |z: Arc<AtomicUsize>| {
            move || async move {
                z.fetch_add(1, Ordering::SeqCst);
                Ok(Bytes::from_static(b"x"))
            }
        };
        let ttl = Duration::from_millis(80);
        b.get_or_fetch(schluessel("index.m3u8"), ttl, hole(zaehler.clone()))
            .await
            .unwrap();
        b.get_or_fetch(schluessel("index.m3u8"), ttl, hole(zaehler.clone()))
            .await
            .unwrap();
        assert_eq!(zaehler.load(Ordering::SeqCst), 1, "frisch aus dem Bündel");
        tokio::time::sleep(Duration::from_millis(120)).await;
        b.get_or_fetch(schluessel("index.m3u8"), ttl, hole(zaehler.clone()))
            .await
            .unwrap();
        assert_eq!(zaehler.load(Ordering::SeqCst), 2, "abgelaufen: neu geholt");
    }

    #[tokio::test]
    async fn fehler_wird_nicht_gehalten() {
        let b = Buendel::new();
        let r = b
            .get_or_fetch(schluessel("s.mp4"), Duration::from_secs(30), || async {
                Err(VideoFehler::Upstream)
            })
            .await;
        assert_eq!(r, Err(VideoFehler::Upstream));
        let r = b
            .get_or_fetch(schluessel("s.mp4"), Duration::from_secs(30), || async {
                Ok(Bytes::from_static(b"ok"))
            })
            .await;
        assert!(r.is_ok());
    }

    #[tokio::test]
    async fn deckel_wirft_älteste_raus() {
        let b = Buendel::with_deckel(100);
        let zaehler = Arc::new(AtomicUsize::new(0));
        let hole = |z: Arc<AtomicUsize>| {
            move || async move {
                z.fetch_add(1, Ordering::SeqCst);
                Ok(Bytes::from(vec![0u8; 40]))
            }
        };
        let ttl = Duration::from_secs(3600);
        for name in ["a.mp4", "b.mp4", "c.mp4"] {
            b.get_or_fetch(schluessel(name), ttl, hole(zaehler.clone()))
                .await
                .unwrap();
        }
        assert_eq!(zaehler.load(Ordering::SeqCst), 3);
        // c und b passen (80 <= 100), a war die älteste und ist raus.
        b.get_or_fetch(schluessel("c.mp4"), ttl, hole(zaehler.clone()))
            .await
            .unwrap();
        b.get_or_fetch(schluessel("b.mp4"), ttl, hole(zaehler.clone()))
            .await
            .unwrap();
        assert_eq!(zaehler.load(Ordering::SeqCst), 3);
        b.get_or_fetch(schluessel("a.mp4"), ttl, hole(zaehler.clone()))
            .await
            .unwrap();
        assert_eq!(zaehler.load(Ordering::SeqCst), 4, "a wurde verdrängt");
    }

    #[test]
    fn playlist_mit_absoluter_uri_wird_abgelehnt() {
        for p in [
            "#EXTM3U\nhttp://fremd.example/seg.mp4\n",
            "#EXTM3U\n//fremd.example/seg.mp4\n",
            "#EXTM3U\n/api/seg.mp4\n",
            "#EXTM3U\n#EXT-X-MAP:URI=\"https://fremd.example/init.mp4\"\n",
            "#EXTM3U\n#EXT-X-MEDIA:TYPE=AUDIO,URI=\"data:text/plain,x\"\n",
        ] {
            assert!(check_playlist(p.as_bytes()).is_err(), "{p}");
        }
    }

    #[test]
    fn playlist_mit_punktpunkt_wird_abgelehnt() {
        for p in [
            "#EXTM3U\n../seg.mp4\n",
            "#EXTM3U\nstream/../../seg.mp4\n",
            "#EXTM3U\n#EXT-X-MAP:URI=\"../init.mp4\"\n",
        ] {
            assert!(check_playlist(p.as_bytes()).is_err(), "{p}");
        }
    }

    #[test]
    fn playlist_mit_relativen_uris_wird_angenommen() {
        let p = "#EXTM3U\n#EXT-X-VERSION:9\n#EXT-X-MAP:URI=\"init.mp4\"\n#EXTINF:1.0,\nseg1.mp4\n#EXT-X-STREAM-INF:BANDWIDTH=1\nvideo.m3u8\n";
        assert!(check_playlist(p.as_bytes()).is_ok());
    }

    #[test]
    fn content_type_nach_endung() {
        assert_eq!(
            content_type_for("index.m3u8"),
            Some("application/vnd.apple.mpegurl")
        );
        assert_eq!(content_type_for("a.mp4"), Some("video/mp4"));
        assert_eq!(content_type_for("a.m4s"), Some("video/iso.segment"));
        assert_eq!(content_type_for("a.ts"), Some("video/mp2t"));
        assert_eq!(content_type_for("a.html"), None);
        assert_eq!(content_type_for("noext"), None);
    }

    #[test]
    fn ttl_nach_endung() {
        assert_eq!(ttl_for("index.m3u8"), Some(Duration::from_secs(1)));
        assert_eq!(ttl_for("index.M3U8"), Some(Duration::from_secs(1)));
        assert!(is_playlist("index.m3u8"));
        assert!(is_playlist("index.M3U8"));
        assert!(is_playlist("Sub.M3u8"));
        assert!(!is_playlist("seg1.mp4"));
        assert!(!is_playlist("m3u8"));
        assert_eq!(ttl_for("a.mp4"), Some(Duration::from_secs(30)));
        assert_eq!(ttl_for("a.m4s"), Some(Duration::from_secs(30)));
        assert_eq!(ttl_for("a.ts"), Some(Duration::from_secs(30)));
        assert_eq!(ttl_for("a.exe"), None);
    }
}
