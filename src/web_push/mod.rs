//! Web Push bei geschlossenem Tab (LLH-1223, Change `hotzhx58-web-push`; Spec `web-push`).
//!
//! **Nur mit Schalter** (`--web-push`, design.md D1): Push läuft immer über den Dienst des
//! Browser-Herstellers im Internet. Ohne Schalter gibt es keinen [`WebPush`], die Routen
//! antworten 404, und [`crate::benachrichtigung::melden`] versendet nichts.
//!
//! - Schlüsselpaar je Instanz in der DB ([`repo::schluessel_laden_oder_erzeugen`], D2).
//! - Abo je Browserprofil, an die Sitzung gebunden (`ON DELETE CASCADE`, D3).
//! - Versand nach dem Live-Ereignis, nebenläufig, mit Zeitlimit; die Nutzlast ist das
//!   Live-Ereignis selbst (nur Kennungen), verschlüsselt nach RFC 8291 ([`krypto`], D4).
//! - Endpunkte nur bei bekannten Push-Diensten ([`endpunkt_pruefen`], D5), sonst wäre das Abo
//!   ein Weg, den Server POSTs ins interne Netz schicken zu lassen.

pub mod krypto;
pub mod repo;

#[cfg(test)]
mod tests;

use crate::log_drossel::Sammelzeile;
use futures::StreamExt;
use krypto::{b64_lesen, Schluessel};
use reqwest::Url;
use sqlx::SqlitePool;
use std::sync::Arc;
use std::time::Duration;

/// Höchstens so viele Versände eines `melden` laufen gleichzeitig.
const GLEICHZEITIG: usize = 8;
/// Zeitlimit eines Versands samt Verbindungsaufbau.
const ZEITLIMIT: Duration = Duration::from_secs(10);
/// So lange hält der Push-Dienst eine Nachricht für ein Gerät ohne Verbindung: die Spanne des
/// Nachreichens (Spec `benachrichtigungen`, „Verpasste Benachrichtigungen werden nachgereicht“).
const TTL_SEKUNDEN: u32 = 12 * 60 * 60;
/// Gültigkeit des VAPID-Tokens; RFC 8292 erlaubt höchstens 24 h.
const VAPID_GUELTIG_SEKUNDEN: i64 = 12 * 60 * 60;

/// Hosts der Push-Dienste, an die ein Abo zeigen darf (design.md D5). Ein Eintrag mit Punkt
/// vorn gilt für jeden Unterhost, sonst nur genau dieser Host.
pub const PUSH_DIENSTE: &[&str] = &[
    // Chrome, Edge-Chromium auf Android, Opera, Samsung Internet
    "fcm.googleapis.com",
    // Chrome nutzt teils Hosts wie `jmt17.google.com`
    ".google.com",
    // Firefox
    ".push.services.mozilla.com",
    // Safari (macOS, iOS-Web-App)
    ".push.apple.com",
    // Edge unter Windows
    ".notify.windows.com",
];

/// Prüft den Endpunkt eines Abos: `https`, Port 443, ein Host (keine IP) aus `dienste`, keine
/// Zugangsdaten in der URL. Liefert den Grund der Ablehnung.
pub fn endpunkt_pruefen(endpoint: &str, dienste: &[&str]) -> Result<Url, &'static str> {
    let url = Url::parse(endpoint).map_err(|_| "Endpunkt ist keine URL")?;
    if url.scheme() != "https" {
        return Err("Endpunkt muss https verwenden");
    }
    if url.port().is_some_and(|p| p != 443) {
        return Err("Endpunkt mit fremdem Port");
    }
    if !url.username().is_empty() || url.password().is_some() {
        return Err("Endpunkt mit Zugangsdaten");
    }
    // `domain()` ist leer bei einer IP als Host.
    let Some(host) = url.domain() else {
        return Err("Endpunkt ohne Hostnamen");
    };
    let host = host.to_ascii_lowercase();
    let bekannt = dienste.iter().any(|d| match d.strip_prefix('.') {
        Some(suffix) => host.ends_with(&format!(".{suffix}")),
        None => host == *d,
    });
    if !bekannt {
        return Err("Endpunkt gehört zu keinem bekannten Push-Dienst");
    }
    Ok(url)
}

/// Eine Benachrichtigung für einen Nutzer: an jedes seiner Abos.
#[derive(Debug, Clone)]
pub struct Sendung {
    pub benutzer_id: i64,
    /// JSON des Live-Ereignisses (nur Kennungen).
    pub nutzlast: String,
    /// Alarm: `Urgency: high`, sonst `normal`.
    pub alarm: bool,
}

/// Web Push einer Instanz mit Schalter: Schlüssel, Kontakt und HTTP-Client.
#[derive(Clone)]
pub struct WebPush {
    inner: Arc<Inner>,
}

struct Inner {
    schluessel: Schluessel,
    kontakt: String,
    client: reqwest::Client,
    dienste: &'static [&'static str],
}

impl std::fmt::Debug for WebPush {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("WebPush")
            .field("schluessel", &self.inner.schluessel)
            .field("kontakt", &self.inner.kontakt)
            .finish_non_exhaustive()
    }
}

impl WebPush {
    /// Richtet Web Push beim Start ein: Schlüssel laden oder erzeugen, Client bauen.
    pub async fn einrichten(pool: &SqlitePool, kontakt: String) -> anyhow::Result<Self> {
        let schluessel = repo::schluessel_laden_oder_erzeugen(pool).await?;
        Ok(Self::neu(schluessel, kontakt, client(true)?, PUSH_DIENSTE))
    }

    /// Nur für Tests: mit eigener Liste von Push-Diensten und, wenn `nur_https` aus ist, auch
    /// an `http`-Endpunkte (ein lokaler Test-Push-Dienst). Der Server nutzt [`Self::einrichten`].
    pub async fn einrichten_fuer_test(
        pool: &SqlitePool,
        dienste: &'static [&'static str],
        nur_https: bool,
    ) -> anyhow::Result<Self> {
        let schluessel = repo::schluessel_laden_oder_erzeugen(pool).await?;
        Ok(Self::neu(
            schluessel,
            "mailto:test@example.org".into(),
            client(nur_https)?,
            dienste,
        ))
    }

    fn neu(
        schluessel: Schluessel,
        kontakt: String,
        client: reqwest::Client,
        dienste: &'static [&'static str],
    ) -> Self {
        Self {
            inner: Arc::new(Inner {
                schluessel,
                kontakt,
                client,
                dienste,
            }),
        }
    }

    /// Öffentlicher Schlüssel für `applicationServerKey`, Base64url.
    pub fn oeffentlicher_schluessel(&self) -> String {
        krypto::b64(self.inner.schluessel.oeffentlich())
    }

    /// Die erlaubten Push-Dienste (Tests setzen eigene).
    pub fn dienste(&self) -> &'static [&'static str] {
        self.inner.dienste
    }

    /// Versendet die Sendungen an alle Abos ihrer Nutzer, in einem eigenen Task: der Aufrufer
    /// (eine Route nach dem Commit, der Scheduler) wartet nie auf einen Push-Dienst.
    pub fn versenden(
        &self,
        pool: &SqlitePool,
        sendungen: Vec<Sendung>,
    ) -> tokio::task::JoinHandle<()> {
        let wp = self.clone();
        let pool = pool.clone();
        tokio::spawn(async move { wp.versenden_jetzt(&pool, sendungen).await })
    }

    /// Kern von [`Self::versenden`], im aufrufenden Task.
    pub async fn versenden_jetzt(&self, pool: &SqlitePool, sendungen: Vec<Sendung>) {
        if sendungen.is_empty() {
            return;
        }
        let ids: Vec<i64> = sendungen.iter().map(|s| s.benutzer_id).collect();
        let abos = match repo::abos_von(pool, &ids).await {
            Ok(a) => a,
            Err(e) => {
                tracing::warn!(fehler = %e, "Web-Push-Abos nicht lesbar");
                return;
            }
        };
        let auftraege: Vec<(repo::Abo, &Sendung)> = abos
            .into_iter()
            .filter_map(|abo| {
                let s = sendungen
                    .iter()
                    .find(|s| s.benutzer_id == abo.benutzer_id)?;
                Some((abo, s))
            })
            .collect();
        futures::stream::iter(auftraege)
            .for_each_concurrent(GLEICHZEITIG, |(abo, s)| async move {
                self.an_abo(pool, abo, s).await;
            })
            .await;
    }

    async fn an_abo(&self, pool: &SqlitePool, abo: repo::Abo, s: &Sendung) {
        static FEHLER: Sammelzeile = Sammelzeile::neu();
        let host = Url::parse(&abo.endpoint)
            .ok()
            .and_then(|u| u.host_str().map(str::to_owned))
            .unwrap_or_default();
        match self.senden(&abo, s).await {
            Ok(status) if status.is_success() => {}
            Ok(status) if status.as_u16() == 404 || status.as_u16() == 410 => {
                if let Err(e) = repo::erloschen(pool, abo.id, &abo.endpoint).await {
                    tracing::warn!(fehler = %e, "Erloschenes Web-Push-Abo nicht gelöscht");
                }
            }
            // Nie den Endpunkt loggen: er ist eine Gerätekennung. Der Host reicht zur Diagnose.
            Ok(status) => {
                if let Some(f) = FEHLER.zaehlen() {
                    tracing::warn!(
                        host,
                        status = status.as_u16(),
                        anzahl = f.anzahl,
                        seit_s = f.seit_s,
                        "Push-Dienst lehnt Web Push ab, Sammelzeile"
                    );
                }
            }
            Err(fehler) => {
                if let Some(f) = FEHLER.zaehlen() {
                    tracing::warn!(
                        host,
                        fehler,
                        anzahl = f.anzahl,
                        seit_s = f.seit_s,
                        "Web Push nicht zugestellt, Sammelzeile"
                    );
                }
            }
        }
    }

    async fn senden(&self, abo: &repo::Abo, s: &Sendung) -> Result<reqwest::StatusCode, String> {
        let url = Url::parse(&abo.endpoint).map_err(|_| "Endpunkt keine URL".to_owned())?;
        let p256dh = b64_lesen(&abo.p256dh).ok_or("p256dh kein Base64")?;
        let auth = b64_lesen(&abo.auth).ok_or("auth kein Base64")?;
        let rumpf = krypto::verschluesseln(s.nutzlast.as_bytes(), &p256dh, &auth)
            .map_err(|e| e.to_string())?;
        let aud = url.origin().ascii_serialization();
        let exp = chrono::Utc::now().timestamp() + VAPID_GUELTIG_SEKUNDEN;
        let vapid = self
            .inner
            .schluessel
            .vapid_kopf(&aud, exp, &self.inner.kontakt)
            .map_err(|e| e.to_string())?;
        let antwort = self
            .inner
            .client
            .post(url)
            .header("TTL", TTL_SEKUNDEN.to_string())
            .header("Urgency", if s.alarm { "high" } else { "normal" })
            .header("Content-Encoding", "aes128gcm")
            .header("Content-Type", "application/octet-stream")
            .header("Authorization", vapid)
            .body(rumpf)
            .send()
            .await
            // Ohne URL: reqwest hängt sie sonst an die Meldung.
            .map_err(|e| e.without_url().to_string())?;
        Ok(antwort.status())
    }
}

/// HTTP-Client der Push-Versände: Zeitlimit, keine Weiterleitung (eine Weiterleitung führte am
/// geprüften Host vorbei), auf Wunsch nur https.
fn client(nur_https: bool) -> anyhow::Result<reqwest::Client> {
    Ok(reqwest::Client::builder()
        .timeout(ZEITLIMIT)
        .connect_timeout(Duration::from_secs(5))
        .redirect(reqwest::redirect::Policy::none())
        .https_only(nur_https)
        .no_gzip()
        .build()?)
}

/// Prüft den Kontakt für das VAPID-Token (design.md D1): `mailto:` mit Adresse oder `https://`
/// mit Host.
pub fn kontakt_pruefen(kontakt: &str) -> Result<(), String> {
    let gueltig = match kontakt.split_once(':') {
        Some(("mailto", adresse)) => {
            adresse.contains('@') && !adresse.contains(char::is_whitespace)
        }
        Some(("https", _)) => Url::parse(kontakt).is_ok_and(|u| u.host_str().is_some()),
        _ => false,
    };
    if gueltig {
        Ok(())
    } else {
        Err(format!(
            "--web-push-kontakt muss mit mailto: oder https:// beginnen, nicht „{kontakt}“"
        ))
    }
}
