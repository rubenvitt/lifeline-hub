//! Client der Matrix-Anbindung (LLH-2094, Design-Doc
//! `docs/superpowers/specs/2026-11-25-ntaizave-ausgang-matrix-design.md`, Abschnitte 3–5).
//!
//! Je Anbindung hält der Prozess höchstens einen `matrix_sdk::Client` ([`Clients`]), hinter einer
//! `tokio::sync::Mutex`: Prüflauf und Ausgangskorb teilen ihn, nie öffnen zwei Clients denselben
//! Schlüsselspeicher. Der Speicher liegt in `<basis>/<adapter_id>/` (verschlüsseltes SQLite von
//! `matrix-sdk-sqlite`, Passphrase aus dem Platz `speicher_passphrase`). Eine Merkdatei
//! [`GERAET_DATEI`] darin nennt Nutzer und Gerät, für die er angelegt wurde: gehört das Token zu
//! einem anderen Gerät, wird der Speicher nicht geöffnet (`SchluesselPassenNicht`).
//!
//! Netz: matrix-sdk bekommt unseren `reqwest::Client` aus [`ziel::client_builder_mit_zielschutz`]
//! (filternder Resolver, keine Weiterleitung, nur `https`); die Homeserver-URL besteht vorher
//! `check_url`. Kein `.well-known`, keine Wiederholung im SDK (das macht der Ausgangskorb).

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, OnceLock};
use std::time::{Duration, SystemTime};

use age::secrecy::{ExposeSecret, SecretString};
use futures::future::BoxFuture;
use matrix_sdk::authentication::matrix::MatrixSession;
use matrix_sdk::authentication::SessionTokens;
use matrix_sdk::config::{RequestConfig, SyncSettings};
use matrix_sdk::encryption::CryptoStoreError;
use matrix_sdk::ruma::api::client::filter::{Filter, FilterDefinition, RoomFilter};
use matrix_sdk::ruma::api::client::sync::sync_events::v3::Filter as SyncFilter;
use matrix_sdk::ruma::api::error::{ErrorKind, RetryAfter};
use matrix_sdk::ruma::{OwnedDeviceId, OwnedUserId};
use matrix_sdk::{HttpError, SessionMeta};
use reqwest::Url;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use super::ziel;
use super::zustand::AdapterFehler;
use crate::public_api::webhook::ziel::{check_url, fehler_art};
use crate::public_api::webhook::WebhookFehler;

/// Name der Merkdatei im Speicherverzeichnis: für welchen Nutzer und welches Gerät es angelegt ist.
pub const GERAET_DATEI: &str = "geraet.json";

/// Zeitlimit einer einzelnen Anfrage des SDK (Spec Abschnitt 5).
pub const ANFRAGE_ZEITLIMIT: Duration = Duration::from_secs(30);

/// Gesamtzeitlimit des HTTP-Clients; das gilt für Uploads, die eigene Anfrage-Limits setzen.
pub const UPLOAD_ZEITLIMIT: Duration = Duration::from_secs(120);

/// Deckel für die Antwort von `whoami` (ein kleines JSON-Objekt).
const WHOAMI_DECKEL: usize = 16 * 1024;

/// Das Ziel einer Matrix-Anbindung, aus Einstellungen und Geheimnissen. `Debug` nennt keine
/// Geheimnisse.
pub struct MatrixZiel {
    pub homeserver: Url,
    pub access_token: SecretString,
    pub passphrase: SecretString,
    pub lan_erlaubt: bool,
    pub adapter_id: String,
}

impl std::fmt::Debug for MatrixZiel {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("MatrixZiel")
            .field("homeserver", &self.homeserver.as_str())
            .field("lan_erlaubt", &self.lan_erlaubt)
            .field("adapter_id", &self.adapter_id)
            .finish_non_exhaustive()
    }
}

/// Warum ein Zugriff auf den Homeserver scheiterte. Nur Codes, nie Text des Servers.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MatrixFehler {
    /// Token ungültig oder abgelaufen (401, `M_UNKNOWN_TOKEN`).
    Token,
    /// Keine Verbindung, abgebrochen, TLS, oder der Homeserver hatte einen Fehler (5xx).
    Netz,
    /// Keine Antwort im Zeitlimit.
    Zeit,
    /// Name nicht auflösbar.
    Dns,
    /// Das Ziel liegt in einem gesperrten Netz (Zielschutz).
    ZielIntern,
    /// Zu viele Anfragen (429), mit der Wartezeit des Servers, falls er eine nannte.
    RateLimit(Option<Duration>),
    /// Verboten (403, `M_FORBIDDEN`).
    Verboten,
    /// Nicht gefunden (404).
    NichtGefunden,
    /// Zu groß (413, `M_TOO_LARGE`).
    ZuGross,
    /// Verschlüsseln oder Schlüsselspeicher gescheitert.
    Verschluesselung,
    /// Der Schlüsselspeicher gehört zu einem anderen Gerät als dem des Tokens.
    SchluesselPassenNicht,
    /// Die Antwort ließ sich nicht einordnen.
    Antwort,
}

impl MatrixFehler {
    /// Status des Homeservers, wenn der Fehler einen bedeutet.
    pub fn status(&self) -> Option<u16> {
        match self {
            MatrixFehler::Token => Some(401),
            MatrixFehler::Verboten => Some(403),
            MatrixFehler::NichtGefunden => Some(404),
            MatrixFehler::ZuGross => Some(413),
            MatrixFehler::RateLimit(_) => Some(429),
            _ => None,
        }
    }
}

impl From<MatrixFehler> for AdapterFehler {
    fn from(f: MatrixFehler) -> Self {
        match f {
            // 401 und 403 sind beim Prüfen „Zugang abgelehnt“, wie `ziel::fehler_aus_status`.
            MatrixFehler::Token | MatrixFehler::Verboten => AdapterFehler::Abgelehnt,
            MatrixFehler::SchluesselPassenNicht => AdapterFehler::SchluesselPassenNicht,
            MatrixFehler::Netz => AdapterFehler::Verbindung,
            MatrixFehler::Zeit => AdapterFehler::Zeitueberschreitung,
            MatrixFehler::Dns => AdapterFehler::Dns,
            MatrixFehler::ZielIntern => AdapterFehler::ZielIntern,
            MatrixFehler::RateLimit(_)
            | MatrixFehler::NichtGefunden
            | MatrixFehler::ZuGross
            | MatrixFehler::Verschluesselung
            | MatrixFehler::Antwort => AdapterFehler::AntwortUngueltig,
        }
    }
}

/// Was die letzte erfolgreiche Prüfung fand. Liegt nur im Speicher ([`Clients::befund`]); der
/// Versand (Upload-Grenze) und die Verwaltung (Gerät) lesen es dort.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Pruefbefund {
    pub user_id: String,
    pub device_id: String,
    /// Das Gerät ist per Cross-Signing signiert und der Bot hält die Schlüssel dafür.
    pub cross_signing: bool,
    /// Größte erlaubte Datei des Homeservers (`m.upload.size`), falls er sie nennt.
    pub upload_max: Option<u64>,
}

/// Nutzer und Gerät des Tokens (`whoami`), wie in der Merkdatei.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
struct Geraet {
    user_id: String,
    device_id: String,
}

struct Offen {
    client: matrix_sdk::Client,
    /// Fingerabdruck von Homeserver, Token, Passphrase und LAN-Ausnahme: ändert sich einer, wird
    /// der Client neu gebaut.
    stand: [u8; 32],
    geraet: Geraet,
}

#[derive(Default)]
struct Eintrag {
    offen: Option<Offen>,
    befund: Option<Pruefbefund>,
}

/// Die Matrix-Clients des Prozesses, je Anbindung höchstens einer (`AppState.adapter.matrix`).
pub struct Clients {
    basis: PathBuf,
    zielschutz: bool,
    http: [OnceLock<reqwest::Client>; 2],
    eintraege: std::sync::Mutex<HashMap<String, Arc<tokio::sync::Mutex<Eintrag>>>>,
}

impl std::fmt::Debug for Clients {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Clients")
            .field("basis", &self.basis)
            .field("zielschutz", &self.zielschutz)
            .finish_non_exhaustive()
    }
}

/// Ohne Pfad (Tests, die keinen Matrix-Client bauen): ein Verzeichnis unter dem Temp-Verzeichnis
/// des Prozesses. Produktiv setzt `main` `<DB-Verzeichnis>/matrix` (`config::default_matrix_dir`).
impl Default for Clients {
    fn default() -> Self {
        Clients::new(
            std::env::temp_dir().join(format!("lifeline-hub-matrix-{}", std::process::id())),
        )
    }
}

impl Clients {
    /// `basis`: `<DB-Verzeichnis>/matrix`; je Anbindung ein Unterverzeichnis.
    pub fn new(basis: PathBuf) -> Self {
        Clients {
            basis,
            zielschutz: true,
            http: Default::default(),
            eintraege: Default::default(),
        }
    }

    /// Nur für Tests gegen einen nachgebauten Homeserver auf `http://127.0.0.1`: ohne Zielschutz
    /// (weder `check_url` noch filternder Resolver noch nur `https`). Kein Produktivpfad.
    pub fn ohne_zielschutz_fuer_tests(basis: PathBuf) -> Self {
        Clients {
            zielschutz: false,
            ..Clients::new(basis)
        }
    }

    /// Das Speicherverzeichnis einer Anbindung; `None` für eine Kennung, die kein Verzeichnisname
    /// sein darf (Kennungen sind UUIDs).
    pub fn verzeichnis(&self, adapter_id: &str) -> Option<PathBuf> {
        let gueltig = !adapter_id.is_empty()
            && adapter_id.len() <= 64
            && adapter_id
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_');
        gueltig.then(|| self.basis.join(adapter_id))
    }

    fn eintrag(&self, adapter_id: &str) -> Arc<tokio::sync::Mutex<Eintrag>> {
        self.eintraege
            .lock()
            .expect("Clients nicht vergiftet")
            .entry(adapter_id.to_string())
            .or_default()
            .clone()
    }

    fn http(&self, lan_erlaubt: bool) -> reqwest::Client {
        self.http[usize::from(lan_erlaubt)]
            .get_or_init(|| {
                let bauplan = if self.zielschutz {
                    ziel::client_builder_mit_zielschutz(lan_erlaubt)
                } else {
                    ziel::client_builder_ohne_zielschutz_fuer_tests()
                };
                bauplan
                    .timeout(UPLOAD_ZEITLIMIT)
                    .build()
                    .expect("Matrix-Client baubar")
            })
            .clone()
    }

    /// Führt `f` mit dem Client der Anbindung aus; baut ihn bei Bedarf (Token prüfen, Speicher
    /// öffnen, Sitzung herstellen). Zugriffe auf dieselbe Anbindung laufen nacheinander.
    pub async fn mit_client<T>(
        &self,
        ziel: &MatrixZiel,
        f: impl for<'c> FnOnce(&'c matrix_sdk::Client) -> BoxFuture<'c, T>,
    ) -> Result<T, MatrixFehler> {
        let eintrag = self.eintrag(&ziel.adapter_id);
        let mut e = eintrag.lock().await;
        let client = self.oeffne(&mut e, ziel, None).await?;
        Ok(f(&client).await)
    }

    /// Verwirft den Client der Anbindung und löscht ihr Speicherverzeichnis (neues Token, neuer
    /// Homeserver, Anbindung gelöscht). Wartet, bis ein laufender Zugriff fertig ist.
    pub async fn verwerfen(&self, adapter_id: &str) {
        let eintrag = self.eintrag(adapter_id);
        let mut e = eintrag.lock().await;
        e.offen = None;
        e.befund = None;
        if let Some(dir) = self.verzeichnis(adapter_id) {
            match tokio::fs::remove_dir_all(&dir).await {
                Ok(()) => {}
                Err(err) if err.kind() == std::io::ErrorKind::NotFound => {}
                Err(err) => {
                    tracing::warn!(
                        adapter = adapter_id,
                        "Matrix-Speicher nicht gelöscht: {err}"
                    )
                }
            }
        }
    }

    /// Der Befund der letzten erfolgreichen Prüfung seit dem Start des Prozesses.
    pub async fn befund(&self, adapter_id: &str) -> Option<Pruefbefund> {
        self.eintrag(adapter_id).lock().await.befund.clone()
    }

    /// Der Client des Eintrags; ein neuer, wenn keiner offen ist oder sich das Ziel änderte.
    async fn oeffne(
        &self,
        e: &mut Eintrag,
        ziel: &MatrixZiel,
        geraet: Option<Geraet>,
    ) -> Result<matrix_sdk::Client, MatrixFehler> {
        let stand = stand(ziel);
        if let Some(o) = &e.offen {
            if o.stand == stand {
                return Ok(o.client.clone());
            }
        }
        e.offen = None;
        e.befund = None;
        let geraet = match geraet {
            Some(g) => g,
            None => self.whoami(ziel).await?,
        };
        let client = self.baue(ziel, &geraet).await?;
        e.offen = Some(Offen {
            client: client.clone(),
            stand,
            geraet,
        });
        Ok(client)
    }

    /// Die Homeserver-URL nach dem Zielschutz.
    fn homeserver(&self, ziel: &MatrixZiel) -> Result<Url, MatrixFehler> {
        if !self.zielschutz {
            return Ok(ziel.homeserver.clone());
        }
        // Nach `check_einstellungen` bleibt nur ein internes Ziel; jede andere Ablehnung
        // (Schema, Form) ist hier ebenso ein Ziel, an das nichts geht.
        check_url(ziel.homeserver.as_str(), ziel.lan_erlaubt).map_err(|_| MatrixFehler::ZielIntern)
    }

    /// `GET /account/whoami` mit dem Token, über unseren Client: Nutzer und Gerät des Tokens.
    async fn whoami(&self, ziel: &MatrixZiel) -> Result<Geraet, MatrixFehler> {
        #[derive(Deserialize)]
        struct Antwort {
            user_id: String,
            device_id: Option<String>,
        }
        let homeserver = self.homeserver(ziel)?;
        let url = format!(
            "{}/_matrix/client/v3/account/whoami",
            homeserver.as_str().trim_end_matches('/')
        );
        let antwort = self
            .http(ziel.lan_erlaubt)
            .get(url)
            .bearer_auth(ziel.access_token.expose_secret())
            .timeout(ANFRAGE_ZEITLIMIT)
            .send()
            .await
            .map_err(|e| netzfehler(&e))?;
        let status = antwort.status().as_u16();
        if !(200..300).contains(&status) {
            let retry = if status == 429 {
                retry_after(antwort).await
            } else {
                None
            };
            return Err(status_fehler(status, retry));
        }
        let a: Antwort = crate::http_begrenzt::lies_json_begrenzt(antwort, WHOAMI_DECKEL)
            .await
            .map_err(|_| MatrixFehler::Antwort)?;
        // Ein Token ohne Gerät (etwa eines Appservice) taugt nicht für Verschlüsselung.
        let device_id = a.device_id.ok_or(MatrixFehler::Antwort)?;
        OwnedUserId::try_from(a.user_id.as_str()).map_err(|_| MatrixFehler::Antwort)?;
        if device_id.is_empty() || device_id.len() > 255 {
            return Err(MatrixFehler::Antwort);
        }
        Ok(Geraet {
            user_id: a.user_id,
            device_id,
        })
    }

    /// Öffnet den Speicher für `geraet` und stellt die Sitzung her.
    async fn baue(
        &self,
        ziel: &MatrixZiel,
        geraet: &Geraet,
    ) -> Result<matrix_sdk::Client, MatrixFehler> {
        let homeserver = self.homeserver(ziel)?;
        let dir = self
            .verzeichnis(&ziel.adapter_id)
            .ok_or(MatrixFehler::Antwort)?;
        sichere_geraet(&dir, geraet).await?;
        let client = matrix_sdk::Client::builder()
            .homeserver_url(homeserver.as_str())
            .http_client(self.http(ziel.lan_erlaubt))
            .request_config(
                RequestConfig::new()
                    .timeout(ANFRAGE_ZEITLIMIT)
                    .disable_retry(),
            )
            .sqlite_store(&dir, Some(ziel.passphrase.expose_secret()))
            .build()
            .await
            .map_err(|e| {
                // Der Text nennt keine Geheimnisse (Pfad, Art des Fehlers).
                tracing::warn!(adapter = %ziel.adapter_id, "Matrix-Speicher nicht geöffnet: {e}");
                MatrixFehler::Verschluesselung
            })?;
        let user_id =
            OwnedUserId::try_from(geraet.user_id.as_str()).map_err(|_| MatrixFehler::Antwort)?;
        let device_id = OwnedDeviceId::from(geraet.device_id.as_str());
        client
            .matrix_auth()
            .restore_session(
                MatrixSession {
                    meta: SessionMeta { user_id, device_id },
                    tokens: SessionTokens {
                        access_token: ziel.access_token.expose_secret().to_string(),
                        refresh_token: None,
                    },
                },
                matrix_sdk::store::RoomLoadSettings::default(),
            )
            .await
            .map_err(|e| sdk_fehler(&e))?;
        Ok(client)
    }
}

/// Prüft die Anbindung: Token (`whoami`), Speicher passend zum Gerät öffnen, ausstehende
/// Schlüssel hochladen und Schlüsselanfragen abarbeiten (ein `sync_once` ohne Räume),
/// Cross-Signing anlegen, falls es fehlt (scheitert das, nur `cross_signing: false`), und die
/// Upload-Grenze lesen. Der Befund bleibt am Eintrag ([`Clients::befund`]).
pub async fn pruefe(clients: &Clients, ziel: &MatrixZiel) -> Result<Pruefbefund, MatrixFehler> {
    let eintrag = clients.eintrag(&ziel.adapter_id);
    let mut e = eintrag.lock().await;
    let geraet = clients.whoami(ziel).await?;
    // Ein offener Client für ein anderes Gerät desselben Ziels (Token beim Server neu vergeben):
    // nicht weiter benutzen; der Speicher gehört dem alten Gerät.
    if e.offen
        .as_ref()
        .is_some_and(|o| o.stand == stand(ziel) && o.geraet != geraet)
    {
        e.offen = None;
        e.befund = None;
        return Err(MatrixFehler::SchluesselPassenNicht);
    }
    let client = clients.oeffne(&mut e, ziel, Some(geraet.clone())).await?;

    let filter = SyncFilter::FilterDefinition(ohne_raeume());
    client
        .sync_once(
            SyncSettings::default()
                .filter(filter)
                .timeout(Duration::ZERO),
        )
        .await
        .map_err(|e| sdk_fehler(&e))?;

    let verschluesselung = client.encryption();
    let cross_signing = match verschluesselung
        .bootstrap_cross_signing_if_needed(None)
        .await
    {
        Ok(()) => verschluesselung
            .cross_signing_status()
            .await
            .is_some_and(|s| s.is_complete()),
        Err(err) => {
            tracing::info!(adapter = %ziel.adapter_id, "Matrix: kein Cross-Signing: {err}");
            false
        }
    };
    let upload_max = client
        .load_or_fetch_max_upload_size()
        .await
        .ok()
        .map(u64::from);
    let befund = Pruefbefund {
        user_id: geraet.user_id,
        device_id: geraet.device_id,
        cross_signing,
        upload_max,
    };
    e.befund = Some(befund.clone());
    Ok(befund)
}

/// Ein Filter, der keine Räume, Präsenz und Kontodaten lädt: der Sync bringt nur to-device und
/// Schlüsselstände.
fn ohne_raeume() -> FilterDefinition {
    let mut raeume = RoomFilter::empty();
    raeume.rooms = Some(Vec::new());
    let mut filter = FilterDefinition::empty();
    filter.room = raeume;
    let mut nichts = Filter::empty();
    nichts.types = Some(Vec::new());
    filter.presence = nichts.clone();
    filter.account_data = nichts;
    filter
}

fn stand(ziel: &MatrixZiel) -> [u8; 32] {
    let mut h = Sha256::new();
    h.update(ziel.homeserver.as_str().as_bytes());
    h.update([0]);
    h.update(ziel.access_token.expose_secret().as_bytes());
    h.update([0]);
    h.update(ziel.passphrase.expose_secret().as_bytes());
    h.update([u8::from(ziel.lan_erlaubt)]);
    h.finalize().into()
}

/// Prüft die Merkdatei des Verzeichnisses gegen `geraet`; legt Verzeichnis und Merkdatei an,
/// wenn es noch keins gibt. Ein Verzeichnis mit Inhalt, aber ohne Merkdatei gehört niemandem
/// Bekanntem und wird nicht geöffnet.
async fn sichere_geraet(dir: &Path, geraet: &Geraet) -> Result<(), MatrixFehler> {
    let io = |err: std::io::Error| {
        tracing::warn!("Matrix-Speicherverzeichnis: {err}");
        MatrixFehler::Verschluesselung
    };
    let merk = dir.join(GERAET_DATEI);
    match tokio::fs::read(&merk).await {
        Ok(roh) => {
            return match serde_json::from_slice::<Geraet>(&roh) {
                Ok(g) if g == *geraet => Ok(()),
                _ => Err(MatrixFehler::SchluesselPassenNicht),
            }
        }
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => {}
        Err(err) => return Err(io(err)),
    }
    match tokio::fs::read_dir(dir).await {
        Ok(mut eintraege) => {
            if eintraege.next_entry().await.map_err(io)?.is_some() {
                return Err(MatrixFehler::SchluesselPassenNicht);
            }
        }
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => {
            tokio::fs::create_dir_all(dir).await.map_err(io)?;
        }
        Err(err) => return Err(io(err)),
    }
    let neu = dir.join(format!("{GERAET_DATEI}.neu"));
    let json = serde_json::to_vec(geraet).map_err(|_| MatrixFehler::Antwort)?;
    tokio::fs::write(&neu, json).await.map_err(io)?;
    tokio::fs::rename(&neu, &merk).await.map_err(io)?;
    Ok(())
}

fn netzfehler(e: &reqwest::Error) -> MatrixFehler {
    match fehler_art(e) {
        WebhookFehler::Zeitueberschreitung => MatrixFehler::Zeit,
        WebhookFehler::Dns => MatrixFehler::Dns,
        WebhookFehler::ZielIntern => MatrixFehler::ZielIntern,
        _ => MatrixFehler::Netz,
    }
}

fn status_fehler(status: u16, retry: Option<Duration>) -> MatrixFehler {
    match status {
        401 => MatrixFehler::Token,
        403 => MatrixFehler::Verboten,
        404 => MatrixFehler::NichtGefunden,
        413 => MatrixFehler::ZuGross,
        429 => MatrixFehler::RateLimit(retry),
        500..=599 => MatrixFehler::Netz,
        _ => MatrixFehler::Antwort,
    }
}

/// Die Wartezeit einer 429-Antwort: `retry_after_ms` im Rumpf, sonst `Retry-After` in Sekunden.
async fn retry_after(antwort: reqwest::Response) -> Option<Duration> {
    let kopf = antwort
        .headers()
        .get(reqwest::header::RETRY_AFTER)
        .and_then(|w| w.to_str().ok())
        .and_then(|s| s.trim().parse::<u64>().ok())
        .map(Duration::from_secs);
    #[derive(Deserialize)]
    struct Rumpf {
        retry_after_ms: Option<u64>,
    }
    let rumpf = crate::http_begrenzt::lies_json_begrenzt::<Rumpf>(antwort, WHOAMI_DECKEL)
        .await
        .ok()
        .and_then(|r| r.retry_after_ms)
        .map(Duration::from_millis);
    rumpf.or(kopf)
}

fn retry_von(r: &RetryAfter) -> Option<Duration> {
    match r {
        RetryAfter::Delay(d) => Some(*d),
        RetryAfter::DateTime(t) => t.duration_since(SystemTime::now()).ok(),
    }
}

/// Ordnet einen HTTP-Fehler des SDK ein.
pub fn http_fehler(e: &HttpError) -> MatrixFehler {
    match e {
        HttpError::Reqwest(r) => netzfehler(r),
        HttpError::Cached(inner) => http_fehler(inner),
        _ => {
            if let Some(api) = e.as_client_api_error() {
                match api.error_kind() {
                    Some(ErrorKind::UnknownToken(_)) => MatrixFehler::Token,
                    Some(ErrorKind::LimitExceeded(d)) => {
                        MatrixFehler::RateLimit(d.retry_after.as_ref().and_then(retry_von))
                    }
                    _ => status_fehler(api.status_code.as_u16(), None),
                }
            } else {
                MatrixFehler::Antwort
            }
        }
    }
}

/// Ordnet einen Fehler des SDK ein; Schlüsselspeicher eines anderen Kontos oder Geräts ist
/// `SchluesselPassenNicht`, andere Fehler der Verschlüsselung `Verschluesselung`.
pub fn sdk_fehler(e: &matrix_sdk::Error) -> MatrixFehler {
    use matrix_sdk::Error;
    match e {
        Error::Http(h) => http_fehler(h),
        Error::CryptoStoreError(c) if matches!(**c, CryptoStoreError::MismatchedAccount { .. }) => {
            MatrixFehler::SchluesselPassenNicht
        }
        Error::CryptoStoreError(_)
        | Error::OlmError(_)
        | Error::MegolmError(_)
        | Error::BadCryptoStoreState
        | Error::NoOlmMachine => MatrixFehler::Verschluesselung,
        _ => MatrixFehler::Antwort,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn status_wird_eingeordnet() {
        assert_eq!(status_fehler(401, None), MatrixFehler::Token);
        assert_eq!(status_fehler(403, None), MatrixFehler::Verboten);
        assert_eq!(
            status_fehler(429, Some(Duration::from_secs(3))),
            MatrixFehler::RateLimit(Some(Duration::from_secs(3)))
        );
        assert_eq!(status_fehler(502, None), MatrixFehler::Netz);
        assert_eq!(status_fehler(302, None), MatrixFehler::Antwort);
    }

    #[test]
    fn fehler_werden_zu_adapterfehlern() {
        assert_eq!(
            AdapterFehler::from(MatrixFehler::Token),
            AdapterFehler::Abgelehnt
        );
        assert_eq!(
            AdapterFehler::from(MatrixFehler::SchluesselPassenNicht),
            AdapterFehler::SchluesselPassenNicht
        );
        assert_eq!(
            AdapterFehler::from(MatrixFehler::ZielIntern),
            AdapterFehler::ZielIntern
        );
        assert_eq!(
            AdapterFehler::from(MatrixFehler::Verschluesselung),
            AdapterFehler::AntwortUngueltig
        );
    }

    #[test]
    fn verzeichnis_nur_fuer_gueltige_kennungen() {
        let c = Clients::new(PathBuf::from("/var/lib/lifeline/matrix"));
        assert_eq!(
            c.verzeichnis("4f6c-aa_1"),
            Some(PathBuf::from("/var/lib/lifeline/matrix/4f6c-aa_1"))
        );
        assert_eq!(c.verzeichnis("../x"), None);
        assert_eq!(c.verzeichnis(""), None);
        assert_eq!(c.verzeichnis("a/b"), None);
    }

    #[tokio::test]
    async fn zielschutz_greift_vor_jeder_anfrage() {
        let c = Clients::new(std::env::temp_dir().join("lifeline-matrix-zielschutz"));
        let ziel = MatrixZiel {
            homeserver: "https://127.0.0.1:1/".parse().unwrap(),
            access_token: SecretString::from("t".to_string()),
            passphrase: SecretString::from("p".to_string()),
            lan_erlaubt: true,
            adapter_id: "a".into(),
        };
        assert_eq!(pruefe(&c, &ziel).await, Err(MatrixFehler::ZielIntern));
        let ziel = MatrixZiel {
            homeserver: "https://10.0.0.1/".parse().unwrap(),
            lan_erlaubt: false,
            ..ziel
        };
        assert_eq!(pruefe(&c, &ziel).await, Err(MatrixFehler::ZielIntern));
    }

    #[test]
    fn debug_nennt_kein_geheimnis() {
        let ziel = MatrixZiel {
            homeserver: "https://matrix.example.org".parse().unwrap(),
            access_token: SecretString::from("geheimes-token".to_string()),
            passphrase: SecretString::from("geheime-passphrase".to_string()),
            lan_erlaubt: false,
            adapter_id: "a".into(),
        };
        let text = format!("{ziel:?}");
        assert!(!text.contains("geheim"), "{text}");
    }
}
