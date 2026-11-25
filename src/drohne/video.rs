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
    /// Die Antwort des Ziels lässt sich nicht sicher ausliefern (Foto nicht bereinigbar).
    Unbereinigbar,
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

/// Verzeichnis eines URL-Pfads (alles bis zum letzten `/`).
fn verzeichnis(pfad: &str) -> &str {
    pfad.rsplit_once('/').map_or("", |(d, _)| d)
}

/// Löst eine URI der Playlist gegen deren Adresse auf und gibt den bloßen Dateinamen zurück. Sie
/// muss nach dem Zielschutz der Adapter (`adapter::ziel::check_adapter_url`) gelten und auf eine
/// Datei im selben Verzeichnis desselben Ziels (Schema, Host, Port) zeigen, deren Name ein
/// sicheres Segment mit einer Endung ist, die der Proxy ausliefert ([`ttl_for`]).
fn rewrite_uri(
    uri: &str,
    playlist_url: &reqwest::Url,
    lan_erlaubt: bool,
    http_im_lan: bool,
) -> Result<String, VideoFehler> {
    if uri.is_empty() || uri.contains('\\') || uri.chars().any(char::is_control) {
        return Err(VideoFehler::Upstream);
    }
    let ziel = playlist_url.join(uri).map_err(|_| VideoFehler::Upstream)?;
    crate::adapter::ziel::check_adapter_url(ziel.as_str(), lan_erlaubt, http_im_lan)
        .map_err(|_| VideoFehler::Upstream)?;
    let name = ziel.path().rsplit('/').next().unwrap_or("");
    let gleiches_ziel = ziel.scheme() == playlist_url.scheme()
        && ziel.host_str() == playlist_url.host_str()
        && ziel.port_or_known_default() == playlist_url.port_or_known_default()
        && verzeichnis(ziel.path()) == verzeichnis(playlist_url.path());
    if !gleiches_ziel
        || !crate::drohne::is_safe_segment(name)
        || name.contains("..")
        || ttl_for(name).is_none()
    {
        return Err(VideoFehler::Upstream);
    }
    Ok(name.to_string())
}

/// Schreibt die `URI=`-Werte einer Tag-Zeile um (`#EXT-X-MAP`, `#EXT-X-MEDIA`, `#EXT-X-PART`,
/// `#EXT-X-PRELOAD-HINT`, `#EXT-X-KEY` …), in Anführungszeichen oder ohne.
fn rewrite_tag(
    zeile: &str,
    playlist_url: &reqwest::Url,
    lan_erlaubt: bool,
    http_im_lan: bool,
) -> Result<String, VideoFehler> {
    let mut aus = String::with_capacity(zeile.len());
    let mut rest = zeile;
    while let Some(i) = rest.find("URI=") {
        aus.push_str(&rest[..i + 4]);
        rest = &rest[i + 4..];
        let (wert, nach, quote) = match rest.strip_prefix('"') {
            Some(r) => {
                let ende = r.find('"').ok_or(VideoFehler::Upstream)?;
                (&r[..ende], &r[ende + 1..], true)
            }
            None => {
                let ende = rest.find(',').unwrap_or(rest.len());
                (&rest[..ende], &rest[ende..], false)
            }
        };
        let name = rewrite_uri(wert, playlist_url, lan_erlaubt, http_im_lan)?;
        if quote {
            aus.push('"');
            aus.push_str(&name);
            aus.push('"');
        } else {
            aus.push_str(&name);
        }
        rest = nach;
    }
    aus.push_str(rest);
    Ok(aus)
}

/// Prüft eine Playlist und schreibt jede URI-Zeile und jedes `URI=` auf den bloßen Dateinamen um
/// ([`rewrite_uri`]): der Spieler löst sie gegen die Proxy-Adresse auf, nichts geht am Proxy
/// vorbei. Eine einzige URI, die nicht passt, macht die ganze Playlist ungültig. Gilt für jede
/// Drohnenart; `playlist_url` ist die Adresse, unter der die Playlist abgerufen wurde.
pub fn rewrite_playlist(
    bytes: &[u8],
    playlist_url: &reqwest::Url,
    lan_erlaubt: bool,
    http_im_lan: bool,
) -> Result<Bytes, VideoFehler> {
    let text = std::str::from_utf8(bytes).map_err(|_| VideoFehler::Upstream)?;
    let mut aus = String::with_capacity(text.len());
    for zeile in text.lines() {
        let zeile = zeile.trim();
        if zeile.is_empty() {
            // Leerzeilen bleiben.
        } else if !zeile.starts_with('#') {
            aus.push_str(&rewrite_uri(zeile, playlist_url, lan_erlaubt, http_im_lan)?);
        } else {
            aus.push_str(&rewrite_tag(zeile, playlist_url, lan_erlaubt, http_im_lan)?);
        }
        aus.push('\n');
    }
    Ok(Bytes::from(aus))
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

    const SUCHLAGE: &str = "https://s.example/api/lagemonitor/v1/video/SN/hls/index.m3u8";
    const MEDIAMTX: &str = "http://10.0.0.5:8888/drohne/index.m3u8";

    fn suchlage(p: &str) -> Result<String, VideoFehler> {
        let basis = reqwest::Url::parse(SUCHLAGE).unwrap();
        rewrite_playlist(p.as_bytes(), &basis, false, false)
            .map(|b| String::from_utf8(b.to_vec()).unwrap())
    }

    fn mediamtx(basis: &str, p: &str) -> Result<String, VideoFehler> {
        let basis = reqwest::Url::parse(basis).unwrap();
        rewrite_playlist(p.as_bytes(), &basis, true, true)
            .map(|b| String::from_utf8(b.to_vec()).unwrap())
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
            assert!(suchlage(p).is_err(), "{p}");
        }
    }

    #[test]
    fn playlist_mit_punktpunkt_wird_abgelehnt() {
        for p in [
            "#EXTM3U\n../seg.mp4\n",
            "#EXTM3U\nstream/../../seg.mp4\n",
            "#EXTM3U\n#EXT-X-MAP:URI=\"../init.mp4\"\n",
        ] {
            assert!(suchlage(p).is_err(), "{p}");
        }
    }

    #[test]
    fn playlist_mit_relativen_uris_bleibt_gleich() {
        let p = "#EXTM3U\n#EXT-X-VERSION:9\n#EXT-X-MAP:URI=\"init.mp4\"\n#EXTINF:1.0,\nseg1.mp4\n#EXT-X-STREAM-INF:BANDWIDTH=1\nvideo.m3u8\n";
        assert_eq!(suchlage(p).unwrap(), p);
    }

    #[test]
    fn mediamtx_multivariant() {
        let p =
            "#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1,CODECS=\"avc1.64001f\"\nvideo1_stream.m3u8\n";
        let aus = mediamtx(MEDIAMTX, p).unwrap();
        assert!(aus.lines().any(|z| z == "video1_stream.m3u8"), "{aus}");
    }

    #[test]
    fn absolute_uri_im_selben_verzeichnis_wird_dateiname() {
        let p = "#EXTM3U\n#EXT-X-MAP:URI=\"http://10.0.0.5:8888/drohne/init.mp4\"\n#EXTINF:1.0,\nhttp://10.0.0.5:8888/drohne/seg1.mp4\n";
        let aus = mediamtx(MEDIAMTX, p).unwrap();
        assert!(aus.contains("#EXT-X-MAP:URI=\"init.mp4\""), "{aus}");
        assert!(aus.lines().any(|z| z == "seg1.mp4"), "{aus}");
        assert!(!aus.contains("10.0.0.5"), "{aus}");
    }

    #[test]
    fn query_faellt_weg() {
        let aus = mediamtx(
            "http://10.0.0.5:8888/drohne/index.m3u8?token=x",
            "#EXTM3U\n#EXTINF:1.0,\nseg1.mp4?x=1\n",
        )
        .unwrap();
        assert!(aus.lines().any(|z| z == "seg1.mp4"), "{aus}");
        assert!(!aus.contains('?'), "{aus}");
    }

    #[test]
    fn mediamtx_abgelehnt() {
        for p in [
            "#EXTM3U\nhttp://10.0.0.6:8888/drohne/seg.mp4\n",
            "#EXTM3U\nhttp://10.0.0.5:9999/drohne/seg.mp4\n",
            "#EXTM3U\nhttps://10.0.0.5:8888/drohne/seg.mp4\n",
            "#EXTM3U\nsub/seg.mp4\n",
            "#EXTM3U\n../seg.mp4\n",
            "#EXTM3U\nseg.exe\n",
            "#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI=\"key.bin\"\n",
            "#EXTM3U\n#EXT-X-MAP:URI=\"data:text/plain,x\"\n",
        ] {
            assert_eq!(mediamtx(MEDIAMTX, p), Err(VideoFehler::Upstream), "{p}");
        }
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
