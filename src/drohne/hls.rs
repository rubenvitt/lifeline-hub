//! Adapterart „hls_adresse“ (LLH-2110): das Livebild aus einem Medienserver des Kunden
//! (etwa MediaMTX, in das jede Drohnen-App per RTMP sendet), nur über eine HLS-Adresse, ohne
//! Telemetrie. Flüchtig wie „suchlage“: nichts davon kommt in die Datenbank.

use std::sync::Arc;

use age::secrecy::ExposeSecret;
use axum::body::Bytes;
use futures::future::BoxFuture;

use super::store::{Stand, StandUebernahme, Store};
use super::suchlage::Upstream;
use super::vertrag::{key_for, DrohnenLage, DrohnenVideo};
use crate::adapter::art::{
    AdapterArt, Fehlschlag, Feld, FeldTyp, OhneUebernahme, Platz, Uebernahme,
};
use crate::adapter::ziel::AbrufKontext;
use crate::adapter::zustand::AdapterFehler;
use crate::http_begrenzt::DECKEL_PLAYLIST;

const PLAETZE: &[Platz] = &[Platz {
    name: "passwort",
    bezeichnung: "Passwort",
    pflicht: false,
}];

const FELDER: &[Feld] = &[
    Feld {
        name: "playlist_url",
        bezeichnung: "Adresse der Playlist",
        typ: FeldTyp::Url,
        pflicht: true,
        max: 512,
    },
    Feld {
        name: "benutzer",
        bezeichnung: "Benutzer",
        typ: FeldTyp::Text,
        pflicht: false,
        max: 128,
    },
];

/// Die feste, undurchsichtige Videokennung eines Adapters: die Adresse erreicht den Browser nie.
pub fn video_key(adapter_id: &str) -> String {
    key_for(adapter_id, "hls")
}

/// Ordnet den Abruf der Playlist ein: gültig ist ein Video, 404 heißt „kein Stream“ (der
/// Medienserver baut den Pfad ab, wenn nichts sendet) und ist kein Fehlschlag, alles andere
/// bleibt der Fehlschlag des Rahmens. Eine Playlist, die nicht umzuschreiben ist, ist
/// `antwort_ungueltig`.
pub fn einordnen(
    adapter_id: &str,
    erg: Result<Bytes, Fehlschlag>,
    playlist_url: &reqwest::Url,
    lan_erlaubt: bool,
) -> Result<Vec<DrohnenVideo>, Fehlschlag> {
    match erg {
        Ok(bytes) => {
            super::video::rewrite_playlist(&bytes, playlist_url, lan_erlaubt, true)
                .map_err(|_| Fehlschlag::new(AdapterFehler::AntwortUngueltig))?;
            Ok(vec![DrohnenVideo {
                key: video_key(adapter_id),
            }])
        }
        Err(f) if f.status == Some(404) => Ok(Vec::new()),
        Err(f) => Err(f),
    }
}

/// Dateiname, unter dem das Videofenster die Playlist abruft (`…/hls/index.m3u8`, LLH-2107).
pub const EINSTIEG: &str = "index.m3u8";

/// Die Adresse beim Medienserver für eine Datei des Proxys: der Einstieg ist die eingetragene
/// Playlist selbst, jede andere Datei liegt in ihrem Verzeichnis. Die Query der Playlist (etwa
/// ein Token) geht an jede Datei mit, weil sie meist für alle gilt.
pub fn upstream_url(playlist_url: &reqwest::Url, file: &str) -> Result<reqwest::Url, ()> {
    if file == EINSTIEG {
        return Ok(playlist_url.clone());
    }
    let mut url = playlist_url.join(file).map_err(|_| ())?;
    url.set_query(playlist_url.query());
    Ok(url)
}

/// Basic-Auth an das Ziel, nur wenn Benutzer und Passwort beide gesetzt sind.
pub fn apply_auth(
    anfrage: reqwest::RequestBuilder,
    benutzer: Option<&str>,
    passwort: Option<&age::secrecy::SecretString>,
) -> reqwest::RequestBuilder {
    match (benutzer, passwort) {
        (Some(b), Some(p)) => anfrage.basic_auth(b, Some(p.expose_secret())),
        _ => anfrage,
    }
}

/// Die Art „hls_adresse“. Der Store ist der Speicher, in den sie schreibt.
pub struct HlsAdresseArt {
    store: Arc<Store>,
}

impl HlsAdresseArt {
    pub fn new(store: Arc<Store>) -> Self {
        HlsAdresseArt { store }
    }
}

impl AdapterArt for HlsAdresseArt {
    fn code(&self) -> &'static str {
        super::HLS_ADRESSE
    }
    fn bezeichnung(&self) -> &'static str {
        "Drohnenbild (HLS-Adresse)"
    }
    fn plaetze(&self) -> &'static [Platz] {
        PLAETZE
    }
    fn felder(&self) -> &'static [Feld] {
        FELDER
    }
    fn intervall_min_s(&self) -> i64 {
        5
    }
    fn intervall_vorschlag_s(&self) -> i64 {
        5
    }
    fn fluechtig(&self) -> bool {
        true
    }
    fn http_im_lan(&self) -> bool {
        true
    }

    fn abrufen<'a>(
        &'a self,
        kontext: &'a AbrufKontext<'a>,
    ) -> BoxFuture<'a, Result<Box<dyn Uebernahme>, Fehlschlag>> {
        Box::pin(async move {
            let probe = kontext.is_probe;
            if !probe && !self.store.is_zugeschaltet(kontext.adapter_id) {
                return Ok(Box::new(OhneUebernahme(0)) as Box<dyn Uebernahme>);
            }
            let roh = kontext
                .einstellung_text("playlist_url")
                .ok_or(Fehlschlag::new(AdapterFehler::ZielUngueltig))?;
            let playlist_url = reqwest::Url::parse(roh)
                .map_err(|_| Fehlschlag::new(AdapterFehler::ZielUngueltig))?;
            let anfrage = apply_auth(
                kontext.get(roh)?,
                kontext.einstellung_text("benutzer"),
                kontext.geheimnis("passwort"),
            );
            let erg = match kontext.send(anfrage).await {
                Ok(antwort) => kontext.read_bytes(antwort, DECKEL_PLAYLIST).await,
                Err(f) => Err(f),
            };
            let videos = einordnen(
                kontext.adapter_id,
                erg,
                &playlist_url,
                kontext.lan_erlaubt(),
            )?;
            if probe {
                return Ok(Box::new(OhneUebernahme(videos.len() as i64)) as Box<dyn Uebernahme>);
            }
            let jetzt_ms = chrono::Utc::now().timestamp_millis();
            let upstream = Upstream {
                videos: videos
                    .iter()
                    .map(|v| (v.key.clone(), String::new()))
                    .collect(),
                fotos: Default::default(),
            };
            let anzahl = videos.len() as i64;
            let stand = Stand {
                lage: DrohnenLage {
                    stand_ms: jetzt_ms,
                    quelle_stand_ms: jetzt_ms,
                    mission_name: None,
                    fluggeraete: Vec::new(),
                    karte: None,
                    videos,
                    fotos: Vec::new(),
                    verworfen: 0,
                },
                map_etag: None,
                photos_latest_ms: None,
                upstream,
            };
            let vorher = self.store.get(kontext.adapter_id);
            let geaendert = super::art::ist_geaendert(vorher.as_ref(), &stand);
            Ok(Box::new(StandUebernahme {
                store: self.store.clone(),
                stand,
                geaendert,
                anzahl,
            }) as Box<dyn Uebernahme>)
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::adapter::art::{AdapterArt, Fehlschlag, FeldTyp, Verzeichnis};
    use crate::adapter::ziel::AbrufKontext;
    use crate::adapter::zustand::AdapterFehler;
    use crate::drohne::Store;
    use axum::body::Bytes;
    use serde_json::Map;
    use std::collections::HashMap;
    use std::sync::Arc;

    const URL: &str = "http://10.0.0.5:8888/drohne/index.m3u8";

    fn url() -> reqwest::Url {
        reqwest::Url::parse(URL).unwrap()
    }

    #[test]
    fn einordnen_200() {
        let p = Bytes::from_static(b"#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1\nvideo1_stream.m3u8\n");
        let v = einordnen("a1", Ok(p), &url(), true).unwrap();
        assert_eq!(v.len(), 1);
        assert_eq!(v[0].key, video_key("a1"));
        assert_ne!(video_key("a1"), video_key("a2"));
    }

    #[test]
    fn einordnen_404() {
        let f = Fehlschlag {
            art: AdapterFehler::Status,
            status: Some(404),
        };
        assert_eq!(einordnen("a1", Err(f), &url(), true).unwrap(), vec![]);
    }

    #[test]
    fn einordnen_500() {
        let f = Fehlschlag {
            art: AdapterFehler::Status,
            status: Some(500),
        };
        assert_eq!(einordnen("a1", Err(f), &url(), true).unwrap_err(), f);
    }

    #[test]
    fn einordnen_ungueltige_playlist() {
        let p = Bytes::from_static(b"#EXTM3U\nhttp://fremd.example/seg.mp4\n");
        assert_eq!(
            einordnen("a1", Ok(p), &url(), true).unwrap_err().art,
            AdapterFehler::AntwortUngueltig
        );
    }

    #[test]
    fn upstream_url_einstieg_ist_die_playlist_samt_query() {
        let p = reqwest::Url::parse("http://10.0.0.5:8888/d/stream.m3u8?jwt=abc").unwrap();
        assert_eq!(
            upstream_url(&p, EINSTIEG).unwrap().as_str(),
            "http://10.0.0.5:8888/d/stream.m3u8?jwt=abc"
        );
        assert_eq!(
            upstream_url(&p, "video1_stream.m3u8").unwrap().as_str(),
            "http://10.0.0.5:8888/d/video1_stream.m3u8?jwt=abc"
        );
        assert_eq!(
            upstream_url(&p, "seg1.mp4").unwrap().as_str(),
            "http://10.0.0.5:8888/d/seg1.mp4?jwt=abc"
        );
        let ohne = reqwest::Url::parse(URL).unwrap();
        assert_eq!(
            upstream_url(&ohne, "seg1.mp4").unwrap().as_str(),
            "http://10.0.0.5:8888/drohne/seg1.mp4"
        );
    }

    #[test]
    fn basic_auth_nur_mit_beiden_werten() {
        let c = reqwest::Client::new();
        let pw = age::secrecy::SecretString::from("geheim".to_string());
        let kopf = |r: reqwest::RequestBuilder| {
            r.build()
                .unwrap()
                .headers()
                .get(reqwest::header::AUTHORIZATION)
                .map(|v| v.to_str().unwrap().to_string())
        };
        assert_eq!(
            kopf(apply_auth(c.get(URL), Some("drohne"), Some(&pw))).as_deref(),
            Some("Basic ZHJvaG5lOmdlaGVpbQ==")
        );
        assert_eq!(kopf(apply_auth(c.get(URL), Some("drohne"), None)), None);
        assert_eq!(kopf(apply_auth(c.get(URL), None, Some(&pw))), None);
    }

    #[test]
    fn kenndaten() {
        let art = HlsAdresseArt::new(Arc::new(Store::new()));
        assert_eq!(art.code(), "hls_adresse");
        assert_eq!(art.bezeichnung(), "Drohnenbild (HLS-Adresse)");
        assert!(art.fluechtig());
        assert!(art.http_im_lan());
        assert_eq!((art.intervall_min_s(), art.intervall_vorschlag_s()), (5, 5));
        let f = art.felder();
        assert_eq!(
            (
                f[0].name,
                f[0].bezeichnung,
                f[0].typ,
                f[0].pflicht,
                f[0].max
            ),
            (
                "playlist_url",
                "Adresse der Playlist",
                FeldTyp::Url,
                true,
                512
            )
        );
        assert_eq!(
            (
                f[1].name,
                f[1].bezeichnung,
                f[1].typ,
                f[1].pflicht,
                f[1].max
            ),
            ("benutzer", "Benutzer", FeldTyp::Text, false, 128)
        );
        let p = art.plaetze();
        assert_eq!(
            (p[0].name, p[0].bezeichnung, p[0].pflicht),
            ("passwort", "Passwort", false)
        );
    }

    #[tokio::test]
    async fn nicht_zugeschaltet_ruft_nicht_ab() {
        let art = HlsAdresseArt::new(Arc::new(Store::new()));
        let leer = Map::new();
        let geheimnisse = HashMap::new();
        let k = AbrufKontext::new("a", 1, &leer, &geheimnisse, false, false);
        let u = art.abrufen(&k).await.expect("kein Fehlschlag");
        assert_eq!(u.anzahl(), 0);
    }

    #[test]
    fn verzeichnis_enthaelt_hls_adresse() {
        let v = Verzeichnis::produktiv(Arc::new(Store::new()));
        assert!(v.find("hls_adresse").is_some());
    }

    #[test]
    fn drohnenarten() {
        assert!(crate::drohne::is_drohnen_art("hls_adresse"));
        assert!(crate::drohne::is_drohnen_art("suchlage"));
        assert!(!crate::drohne::is_drohnen_art("test"));
    }
}
