//! Der Weg zum Threema Gateway für den Threema-Kanal (LLH-2096, Design-Doc
//! `docs/superpowers/specs/2026-11-28-gq6qs7tg-ausgang-threema-design.md`, Abschnitte 3 und 4).
//!
//! Vier Aufrufe gegen `https://msgapi.threema.ch`, alle mit `from` (Gateway-ID) und `secret`:
//! `GET /credits` (Guthaben), `GET /pubkeys/{id}` (öffentlicher Schlüssel als Hex),
//! `POST /upload_blob` (verschlüsselte Anlage, Multipart-Feld `blob`, liefert die Blob-ID) und
//! `POST /send_e2e` (Formular `from,to,secret,nonce,box`, liefert die Nachrichten-ID). Bei `GET`
//! und beim Upload steht das Secret in der Query (Vorgabe der API); deshalb nennt kein Fehler und
//! kein Log eine URL. Fester Host über den Zielschutz des Adapter-Rahmens, ohne Weiterleitung.
//! Abgeglichen am Quelltext des Pakets `threema-gateway` 0.17 (die Doku-Seite war aus der
//! Sitzung nicht erreichbar); eine Handprobe mit echter Gateway-ID steht aus.

pub mod krypto;

use std::sync::{Arc, OnceLock};
use std::time::Duration;

use age::secrecy::{ExposeSecret, SecretString};

use self::krypto::{
    oeffentlicher_schluessel, parse_oeffentlich_hex, PrivaterSchluessel, Verschluesselt,
};
use super::zustand::AdapterFehler;
use crate::ausgehend::{client_builder, Zweck};
use crate::public_api::webhook::ziel::{fehler_art, WebhookResolver};
use crate::public_api::webhook::WebhookFehler;

/// Basis der API.
pub const API: &str = "https://msgapi.threema.ch";

/// Gesamtzeit einer Abfrage (`credits`, `pubkeys`).
const ABFRAGE_ZEITLIMIT: Duration = Duration::from_secs(20);
/// Gesamtzeit eines `send_e2e`.
const SENDEN_ZEITLIMIT: Duration = Duration::from_secs(30);
/// Gesamtzeit eines Uploads (eine PNG bis 20 MiB über eine schmale Leitung).
const UPLOAD_ZEITLIMIT: Duration = Duration::from_secs(120);
/// Deckel für jede Antwort (Text, klein).
const ANTWORT_MAX: usize = 64 * 1024;
/// Grenze des Multipart-Bodys beim Upload; kommt in keinem Chiffrat als Folge vor, das zählt
/// nicht: die Grenze steht nur am Rand des einen Teils.
const GRENZE: &str = "lifeline-hub-threema-blob-7f3a9c1e";

/// Fehler eines Aufrufs. `Ungewiss`: die Verbindung brach ab, nachdem `send_e2e` hinaus war; ob
/// Threema die Nachricht angenommen hat, ist offen (nie selbst wiederholen).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ThreemaFehler {
    /// Antwort mit Status außerhalb von 2xx.
    Status(u16),
    /// Keine Verbindung zustande gekommen (vor dem Senden), oder ein Upload brach ab.
    Verbindung,
    Dns,
    Tls,
    /// Der Zielschutz hat die Adresse abgelehnt.
    ZielIntern,
    Ungewiss,
    /// 2xx, aber die Antwort war nicht lesbar.
    Antwort,
    /// Der private Schlüssel der Anbindung gehört nicht zur Gateway-ID.
    SchluesselPassenNicht,
}

impl ThreemaFehler {
    /// Der HTTP-Status, falls es einen gab.
    pub fn status(&self) -> Option<u16> {
        match self {
            ThreemaFehler::Status(s) => Some(*s),
            _ => None,
        }
    }

    /// Einordnung für den Zustand der Anbindung.
    pub fn adapter_fehler(&self) -> AdapterFehler {
        match self {
            ThreemaFehler::Status(s) => {
                super::ziel::fehler_aus_status(*s).unwrap_or(AdapterFehler::Status)
            }
            ThreemaFehler::Verbindung | ThreemaFehler::Ungewiss => AdapterFehler::Verbindung,
            ThreemaFehler::Dns => AdapterFehler::Dns,
            ThreemaFehler::Tls => AdapterFehler::Tls,
            ThreemaFehler::ZielIntern => AdapterFehler::ZielIntern,
            ThreemaFehler::Antwort => AdapterFehler::AntwortUngueltig,
            ThreemaFehler::SchluesselPassenNicht => AdapterFehler::SchluesselPassenNicht,
        }
    }
}

/// Zugang aus der Anbindung. Lebt nur für einen Aufruf.
pub struct ThreemaZugang<'a> {
    pub gateway_id: &'a str,
    pub secret: &'a SecretString,
    pub privat: &'a PrivaterSchluessel,
}

/// Wohin die Aufrufe gehen: Basis-URL und je Aufrufart ein Client. Produktiv [`Ziel::produktiv`];
/// Tests setzen einen lokalen Server und einen schlichten Client ein.
#[derive(Clone)]
pub struct Ziel {
    pub basis: String,
    pub abfrage: reqwest::Client,
    pub senden: reqwest::Client,
    pub upload: reqwest::Client,
}

impl Ziel {
    /// Der feste Host über den Zielschutz, ohne Weiterleitung; Clients je `lan_erlaubt` einmal.
    pub fn produktiv(lan_erlaubt: bool) -> Ziel {
        static C: [OnceLock<[reqwest::Client; 3]>; 2] = [OnceLock::new(), OnceLock::new()];
        let [abfrage, senden, upload] = C[usize::from(lan_erlaubt)]
            .get_or_init(|| {
                [ABFRAGE_ZEITLIMIT, SENDEN_ZEITLIMIT, UPLOAD_ZEITLIMIT]
                    .map(|zeit| build_client(lan_erlaubt, zeit))
            })
            .clone();
        Ziel {
            basis: API.to_string(),
            abfrage,
            senden,
            upload,
        }
    }

    /// Alle Aufrufe über einen Client (Tests).
    pub fn mit_client(basis: impl Into<String>, client: reqwest::Client) -> Ziel {
        Ziel {
            basis: basis.into(),
            abfrage: client.clone(),
            senden: client.clone(),
            upload: client,
        }
    }
}

fn build_client(lan_erlaubt: bool, zeitlimit: Duration) -> reqwest::Client {
    client_builder(Zweck::Adapter)
        .no_proxy()
        .redirect(reqwest::redirect::Policy::none())
        .https_only(true)
        .connect_timeout(super::ziel::VERBINDUNG_ZEITLIMIT)
        .timeout(zeitlimit)
        .dns_resolver(Arc::new(WebhookResolver { lan_erlaubt }))
        .build()
        .expect("Threema-Client baubar")
}

/// Ordnet einen Fehler von reqwest ein, ohne seine URL weiterzutragen.
fn von_reqwest(e: &reqwest::Error, senden: bool) -> ThreemaFehler {
    netzfehler(fehler_art(e), e.is_connect(), senden)
}

/// Bei `send_e2e` zählt nur ein Fehler beim Verbindungsaufbau als wiederholbar; alles danach ist
/// `Ungewiss`, auch ein TLS-Fehler (etwa ein Abbruch ohne `close_notify`), bevor die Art des
/// Fehlers zählt: sonst ginge dieselbe Nachricht ein zweites Mal hinaus.
fn netzfehler(art: WebhookFehler, beim_aufbau: bool, senden: bool) -> ThreemaFehler {
    if senden && !beim_aufbau {
        return ThreemaFehler::Ungewiss;
    }
    match art {
        WebhookFehler::ZielIntern => ThreemaFehler::ZielIntern,
        WebhookFehler::Tls => ThreemaFehler::Tls,
        WebhookFehler::Dns => ThreemaFehler::Dns,
        _ => ThreemaFehler::Verbindung,
    }
}

/// Schickt eine Anfrage und liefert die Antwort bei 2xx als Text (gedeckelt).
async fn text_von(anfrage: reqwest::RequestBuilder, senden: bool) -> Result<String, ThreemaFehler> {
    let antwort = anfrage.send().await.map_err(|e| von_reqwest(&e, senden))?;
    let status = antwort.status().as_u16();
    if !(200..300).contains(&status) {
        return Err(ThreemaFehler::Status(status));
    }
    let nicht_lesbar = if senden {
        ThreemaFehler::Ungewiss
    } else {
        ThreemaFehler::Antwort
    };
    crate::http_begrenzt::lies_text_begrenzt(antwort, ANTWORT_MAX)
        .await
        .map(|t| t.trim().to_string())
        .map_err(|_| nicht_lesbar)
}

/// Paare `application/x-www-form-urlencoded` kodiert (Query und Formular).
fn kodiert(paare: &[(&str, &str)]) -> String {
    let mut s = form_urlencoded::Serializer::new(String::new());
    for (k, v) in paare {
        s.append_pair(k, v);
    }
    s.finish()
}

/// `from` und `secret` als Query.
fn anmeldung(z: &ThreemaZugang<'_>) -> String {
    kodiert(&[("from", z.gateway_id), ("secret", z.secret.expose_secret())])
}

/// Eine ID in Großbuchstaben, nur aus `A–Z`, `0–9` und `*`, wie sie im Pfad steht.
fn id_segment(id: &str) -> String {
    id.chars()
        .map(|c| c.to_ascii_uppercase())
        .filter(|c| c.is_ascii_uppercase() || c.is_ascii_digit() || *c == '*')
        .collect()
}

/// Das Guthaben der Gateway-ID.
pub async fn credits(z: &Ziel, zugang: &ThreemaZugang<'_>) -> Result<i64, ThreemaFehler> {
    let anfrage = z
        .abfrage
        .get(format!("{}/credits?{}", z.basis, anmeldung(zugang)));
    text_von(anfrage, false)
        .await?
        .parse()
        .map_err(|_| ThreemaFehler::Antwort)
}

/// Der öffentliche Schlüssel einer Threema-ID.
pub async fn pubkey(
    z: &Ziel,
    zugang: &ThreemaZugang<'_>,
    id: &str,
) -> Result<[u8; 32], ThreemaFehler> {
    let anfrage = z.abfrage.get(format!(
        "{}/pubkeys/{}?{}",
        z.basis,
        id_segment(id),
        anmeldung(zugang)
    ));
    parse_oeffentlich_hex(&text_von(anfrage, false).await?).ok_or(ThreemaFehler::Antwort)
}

/// Der Multipart-Body mit genau einem Feld `blob`.
fn multipart_body(chiffrat: &[u8]) -> Vec<u8> {
    let kopf = format!(
        "--{GRENZE}\r\nContent-Disposition: form-data; name=\"blob\"; filename=\"blob\"\r\n\
         Content-Type: application/octet-stream\r\n\r\n"
    );
    let fuss = format!("\r\n--{GRENZE}--\r\n");
    let mut body = Vec::with_capacity(kopf.len() + chiffrat.len() + fuss.len());
    body.extend_from_slice(kopf.as_bytes());
    body.extend_from_slice(chiffrat);
    body.extend_from_slice(fuss.as_bytes());
    body
}

/// Lädt einen verschlüsselten Blob hoch und liefert seine ID. Jeder Abbruch ist `Verbindung`:
/// ein Blob ohne Nachricht erreicht niemanden.
pub async fn upload_blob(
    z: &Ziel,
    zugang: &ThreemaZugang<'_>,
    chiffrat: &[u8],
) -> Result<String, ThreemaFehler> {
    let anfrage = z
        .upload
        .post(format!("{}/upload_blob?{}", z.basis, anmeldung(zugang)))
        .header(
            reqwest::header::CONTENT_TYPE,
            format!("multipart/form-data; boundary={GRENZE}"),
        )
        .body(multipart_body(chiffrat));
    let id = text_von(anfrage, false).await?;
    if id.is_empty() || id.len() > 64 || !id.chars().all(|c| c.is_ascii_hexdigit()) {
        return Err(ThreemaFehler::Antwort);
    }
    Ok(id)
}

/// Sendet eine verschlüsselte Nachricht an `an` und liefert die Nachrichten-ID.
/// Empfangsbestätigungen sind abbestellt: der Hub empfängt keine (LLH-2159).
pub async fn send_e2e(
    z: &Ziel,
    zugang: &ThreemaZugang<'_>,
    an: &str,
    v: &Verschluesselt,
) -> Result<String, ThreemaFehler> {
    let an = id_segment(an);
    let nonce = krypto::hex_encode(&v.nonce);
    let box_ = krypto::hex_encode(&v.box_);
    let formular = [
        ("from", zugang.gateway_id),
        ("to", an.as_str()),
        ("secret", zugang.secret.expose_secret()),
        ("nonce", nonce.as_str()),
        ("box", box_.as_str()),
        ("noDeliveryReceipts", "1"),
    ];
    let anfrage = z
        .senden
        .post(format!("{}/send_e2e", z.basis))
        .header(
            reqwest::header::CONTENT_TYPE,
            "application/x-www-form-urlencoded",
        )
        .body(kodiert(&formular));
    let id = text_von(anfrage, true).await?;
    if id.is_empty() || id.len() > 64 {
        // Angenommen ist sie, aber unter welcher ID, bleibt offen.
        return Err(ThreemaFehler::Ungewiss);
    }
    Ok(id)
}

/// Prüft Zugang und Schlüssel: das Guthaben lesen, dann muss der öffentliche Schlüssel, den
/// Threema für die eigene ID kennt, zum privaten Schlüssel der Anbindung passen. Liefert das
/// Guthaben.
pub async fn pruefe(z: &Ziel, zugang: &ThreemaZugang<'_>) -> Result<i64, ThreemaFehler> {
    let guthaben = credits(z, zugang).await?;
    let bekannt = pubkey(z, zugang, zugang.gateway_id).await?;
    if bekannt != oeffentlicher_schluessel(zugang.privat) {
        return Err(ThreemaFehler::SchluesselPassenNicht);
    }
    Ok(guthaben)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::http_begrenzt::fixture::bediene;
    use axum::extract::{Path, Query, RawForm};
    use axum::http::{HeaderMap, StatusCode};
    use axum::routing::{get, post};
    use axum::Router;
    use std::collections::HashMap;
    use std::sync::Mutex;

    const SECRET: &str = "geheim-1234";

    fn zugang_mit<'a>(
        secret: &'a SecretString,
        privat: &'a PrivaterSchluessel,
    ) -> ThreemaZugang<'a> {
        ThreemaZugang {
            gateway_id: "*TESTGW1",
            secret,
            privat,
        }
    }

    async fn ziel(app: Router) -> Ziel {
        Ziel::mit_client(bediene(app).await, reqwest::Client::new())
    }

    fn privat() -> PrivaterSchluessel {
        PrivaterSchluessel::from_bytes([5; 32])
    }

    #[test]
    fn jeder_abbruch_nach_dem_absenden_ist_ungewiss_auch_tls() {
        // Ein TLS-Abbruch nach dem Absenden (etwa ohne close_notify) darf nie wiederholt werden.
        for art in [
            WebhookFehler::Tls,
            WebhookFehler::Dns,
            WebhookFehler::Verbindung,
        ] {
            assert_eq!(
                netzfehler(art, false, true),
                ThreemaFehler::Ungewiss,
                "{art:?}"
            );
        }
        // Beim Verbindungsaufbau bleibt es der Fehler selbst, wiederholbar.
        assert_eq!(
            netzfehler(WebhookFehler::Tls, true, true),
            ThreemaFehler::Tls
        );
        assert_eq!(
            netzfehler(WebhookFehler::Verbindung, true, true),
            ThreemaFehler::Verbindung
        );
        assert_eq!(
            netzfehler(WebhookFehler::ZielIntern, true, true),
            ThreemaFehler::ZielIntern
        );
        // Abfragen und Upload senden keine Nachricht: nie ungewiss.
        assert_eq!(
            netzfehler(WebhookFehler::Tls, false, false),
            ThreemaFehler::Tls
        );
        assert_eq!(
            netzfehler(WebhookFehler::Verbindung, false, false),
            ThreemaFehler::Verbindung
        );
    }

    #[tokio::test]
    async fn credits_liest_die_zahl() {
        let app = Router::new().route(
            "/credits",
            get(|Query(q): Query<HashMap<String, String>>| async move {
                assert_eq!(q["from"], "*TESTGW1");
                assert_eq!(q["secret"], SECRET);
                "1234\n"
            }),
        );
        let z = ziel(app).await;
        let (s, p) = (SecretString::from(SECRET), privat());
        assert_eq!(credits(&z, &zugang_mit(&s, &p)).await, Ok(1234));
    }

    #[tokio::test]
    async fn pubkey_liest_hex() {
        let app = Router::new().route(
            "/pubkeys/{id}",
            get(|Path(id): Path<String>| async move {
                assert_eq!(id, "ECHOECHO");
                "ab".repeat(32)
            }),
        );
        let z = ziel(app).await;
        let (s, p) = (SecretString::from(SECRET), privat());
        assert_eq!(
            pubkey(&z, &zugang_mit(&s, &p), "ECHOECHO").await,
            Ok([0xab; 32])
        );
    }

    #[tokio::test]
    async fn upload_schickt_ein_multipart_feld_blob() {
        let gesehen = Arc::new(Mutex::new(None));
        let g = gesehen.clone();
        let app = Router::new().route(
            "/upload_blob",
            post(move |kopf: HeaderMap, body: axum::body::Bytes| {
                let g = g.clone();
                async move {
                    *g.lock().unwrap() = Some((
                        kopf[reqwest::header::CONTENT_TYPE]
                            .to_str()
                            .unwrap()
                            .to_string(),
                        body.to_vec(),
                    ));
                    "0123456789abcdef0123456789abcdef"
                }
            }),
        );
        let z = ziel(app).await;
        let (s, p) = (SecretString::from(SECRET), privat());
        let id = upload_blob(&z, &zugang_mit(&s, &p), b"\x00\x01chiffrat").await;
        assert_eq!(id.as_deref(), Ok("0123456789abcdef0123456789abcdef"));
        let (typ, body) = gesehen.lock().unwrap().clone().unwrap();
        assert!(typ.starts_with("multipart/form-data; boundary="), "{typ}");
        let text = String::from_utf8_lossy(&body);
        assert!(text.contains("name=\"blob\""), "{text}");
        assert!(body.windows(10).any(|w| w == b"\x00\x01chiffrat"));
    }

    #[tokio::test]
    async fn send_e2e_schickt_formular_ohne_klartext() {
        let gesehen = Arc::new(Mutex::new(None));
        let g = gesehen.clone();
        let app = Router::new().route(
            "/send_e2e",
            post(move |RawForm(f): RawForm| {
                let g = g.clone();
                async move {
                    *g.lock().unwrap() = Some(f.to_vec());
                    "0a1b2c3d4e5f6071"
                }
            }),
        );
        let z = ziel(app).await;
        let (s, p) = (SecretString::from(SECRET), privat());
        let v = Verschluesselt {
            nonce: [1; 24],
            box_: vec![2; 40],
        };
        let id = send_e2e(&z, &zugang_mit(&s, &p), "echoecho", &v).await;
        assert_eq!(id.as_deref(), Ok("0a1b2c3d4e5f6071"));
        let roh = gesehen.lock().unwrap().clone().unwrap();
        let f: HashMap<String, String> = form_urlencoded::parse(&roh).into_owned().collect();
        assert_eq!(f["from"], "*TESTGW1");
        assert_eq!(f["to"], "ECHOECHO");
        assert_eq!(f["secret"], SECRET);
        assert_eq!(f["nonce"], "01".repeat(24));
        assert_eq!(f["box"], "02".repeat(40));
        assert_eq!(f["noDeliveryReceipts"], "1");
    }

    #[tokio::test]
    async fn statuscodes_bleiben_status() {
        for code in [400u16, 401, 402, 404, 413, 429, 500] {
            let app = Router::new()
                .route(
                    "/credits",
                    get(move || async move { StatusCode::from_u16(code).unwrap() }),
                )
                .route(
                    "/send_e2e",
                    post(move || async move { StatusCode::from_u16(code).unwrap() }),
                );
            let z = ziel(app).await;
            let (s, p) = (SecretString::from(SECRET), privat());
            let zu = zugang_mit(&s, &p);
            assert_eq!(credits(&z, &zu).await, Err(ThreemaFehler::Status(code)));
            let v = Verschluesselt {
                nonce: [0; 24],
                box_: vec![0; 1],
            };
            assert_eq!(
                send_e2e(&z, &zu, "ECHOECHO", &v).await,
                Err(ThreemaFehler::Status(code))
            );
        }
    }

    /// Ein Server, der die Anfrage liest und die Verbindung ohne Antwort schließt.
    async fn schliesst_nach_dem_lesen() -> String {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        tokio::spawn(async move {
            loop {
                let Ok((mut sock, _)) = listener.accept().await else {
                    return;
                };
                use tokio::io::AsyncReadExt;
                let mut puffer = [0u8; 4096];
                let _ = sock.read(&mut puffer).await;
                drop(sock);
            }
        });
        format!("http://{addr}")
    }

    #[tokio::test]
    async fn abbruch_nach_dem_absenden_ist_ungewiss() {
        let z = Ziel::mit_client(schliesst_nach_dem_lesen().await, reqwest::Client::new());
        let (s, p) = (SecretString::from(SECRET), privat());
        let zu = zugang_mit(&s, &p);
        let v = Verschluesselt {
            nonce: [0; 24],
            box_: vec![0; 1],
        };
        assert_eq!(
            send_e2e(&z, &zu, "ECHOECHO", &v).await,
            Err(ThreemaFehler::Ungewiss)
        );
        // Ein abgebrochener Upload oder eine Abfrage ist nur eine fehlende Verbindung.
        assert_eq!(
            upload_blob(&z, &zu, b"x").await,
            Err(ThreemaFehler::Verbindung)
        );
        assert_eq!(credits(&z, &zu).await, Err(ThreemaFehler::Verbindung));
    }

    #[tokio::test]
    async fn ohne_verbindung_ist_send_nicht_ungewiss() {
        // Port 9 auf 127.0.0.1: niemand hört, die Verbindung kommt nicht zustande.
        let z = Ziel::mit_client("http://127.0.0.1:9", reqwest::Client::new());
        let (s, p) = (SecretString::from(SECRET), privat());
        let v = Verschluesselt {
            nonce: [0; 24],
            box_: vec![0; 1],
        };
        assert_eq!(
            send_e2e(&z, &zugang_mit(&s, &p), "ECHOECHO", &v).await,
            Err(ThreemaFehler::Verbindung)
        );
    }

    #[tokio::test]
    async fn kein_fehler_traegt_das_secret() {
        let z = Ziel::mit_client(schliesst_nach_dem_lesen().await, reqwest::Client::new());
        let (s, p) = (SecretString::from(SECRET), privat());
        let e = credits(&z, &zugang_mit(&s, &p)).await.unwrap_err();
        assert!(!format!("{e:?}").contains(SECRET));
    }

    fn gateway_mit_schluessel(schluessel: [u8; 32]) -> Router {
        Router::new()
            .route("/credits", get(|| async { "77" }))
            .route(
                "/pubkeys/{id}",
                get(move || async move { krypto::hex_encode(&schluessel) }),
            )
    }

    #[tokio::test]
    async fn pruefe_liefert_guthaben() {
        let p = privat();
        let z = ziel(gateway_mit_schluessel(oeffentlicher_schluessel(&p))).await;
        let s = SecretString::from(SECRET);
        assert_eq!(pruefe(&z, &zugang_mit(&s, &p)).await, Ok(77));
    }

    #[tokio::test]
    async fn pruefe_erkennt_fremden_schluessel() {
        let p = privat();
        let z = ziel(gateway_mit_schluessel([0xee; 32])).await;
        let s = SecretString::from(SECRET);
        assert_eq!(
            pruefe(&z, &zugang_mit(&s, &p)).await,
            Err(ThreemaFehler::SchluesselPassenNicht)
        );
    }
}
