//! OIDC/SSO-Provider (LFH-41): Client-Aufbau mit lazy gecachter Discovery und SSRF-resistentem
//! HTTP-Client.
//!
//! `openidconnect` ist ohne HTTP-Features gepinnt: deren `reqwest`-Stack brächte den
//! `ring`-Provider mit, der neben dem Projekt-`reqwest` (`aws-lc-rs`) rustls die automatische
//! Wahl des `CryptoProvider` unmöglich macht (Kanarienvogel:
//! `tls::tests::rcgen_pem_ist_per_rustls_ladbar`). Stattdessen adaptiert [`OidcHttp`] das
//! Projekt-`reqwest::Client` an `openidconnect::AsyncHttpClient`.
//!
//! **Ausgehende Abrufe (LFH-923):** Der HTTP-Client wird einmal je Prozess gebaut
//! ([`http_client_fuer`]), entpackt kein gzip und liest jede Antwort nur bis
//! [`DECKEL_OIDC`](crate::http_begrenzt::DECKEL_OIDC). Die Discovery läuft als ein gebündelter
//! Abruf neben der Anfrage ([`DiscoveryCache`]); ein IdP-Ausfall hält keine Anfrage länger als
//! [`DISCOVERY_WARTEN_MAX`] fest und wird [`DISCOVERY_NEGATIV_FENSTER`] lang ohne Netz
//! beantwortet. Designvorgabe: ein IdP-Ausfall darf die lokale Anmeldung nicht lahmlegen
//! (`docs/superpowers/specs/2026-07-14-auth-provider-system-design.md`, Offline-Resilienz).
pub mod provisioning;
pub mod state;

use crate::config::{Config, GeheimesPasswort};
use crate::error::AppError;
use openidconnect::core::{CoreClient, CoreProviderMetadata, CoreTokenResponse};
use openidconnect::{
    AuthorizationCode, ClientId, ClientSecret, EndpointMaybeSet, EndpointNotSet, EndpointSet,
    HttpRequest, HttpResponse, IssuerUrl, PkceCodeVerifier, RedirectUrl,
};
use std::sync::{LazyLock, Mutex, OnceLock};
use std::time::{Duration, Instant};
use tokio::sync::watch;

/// Aufgelöste OIDC-Einstellungen, prozessweit per `OnceLock` statt `AppState`-Feld (das bräche
/// die Inline-Test-Konstruktionen). `oidc_client` nimmt trotzdem eine explizite `&OidcSettings`,
/// damit Tests im selben Prozess verschiedene Konfigurationen prüfen können; die Handler lesen
/// über [`oidc_settings`].
#[derive(Debug, Clone, Default)]
pub struct OidcSettings {
    pub issuer: Option<String>,
    pub client_id: Option<String>,
    pub client_secret: Option<GeheimesPasswort>,
    pub redirect_url: Option<String>,
}

impl From<&Config> for OidcSettings {
    fn from(cfg: &Config) -> Self {
        Self {
            issuer: cfg.oidc_issuer.clone(),
            client_id: cfg.oidc_client_id.clone(),
            client_secret: cfg.oidc_client_secret.clone(),
            redirect_url: cfg.oidc_redirect_url.clone(),
        }
    }
}

static OIDC_SETTINGS: OnceLock<OidcSettings> = OnceLock::new();

/// Einmalig beim Serverstart setzen; Doppelsetzen wird ignoriert.
pub fn init_oidc_settings(cfg: OidcSettings) {
    let _ = OIDC_SETTINGS.set(cfg);
}

/// Liefert die prozessweiten OIDC-Einstellungen; ungesetzt sind alle Felder `None`, und
/// `oidc_client` antwortet mit `AppError::NotImplemented`.
pub fn oidc_settings() -> &'static OidcSettings {
    OIDC_SETTINGS.get_or_init(OidcSettings::default)
}

/// `CoreClient`-Typ nach `from_provider_metadata` + `set_redirect_uri`: Authorization-Endpoint
/// über Discovery immer gesetzt, Token- und UserInfo-Endpoint laut Spec optional, die übrigen
/// Endpoints nutzt dieser Client nicht.
pub type OidcCoreClient = CoreClient<
    EndpointSet,
    EndpointNotSet,
    EndpointNotSet,
    EndpointNotSet,
    EndpointMaybeSet,
    EndpointMaybeSet,
>;

/// Lebensdauer eines Discovery-Cache-Eintrags; fängt JWKS-Key-Rotation des IdP ohne Neustart ab
/// (LFH-277). TTL statt Refresh-bei-Verify-Fehler, damit ein Angreifer keinen JWKS-Refetch
/// auslösen kann.
const DISCOVERY_TTL: Duration = Duration::from_secs(60 * 60);

/// Nach einem gescheiterten Discovery-Abruf antwortet [`discovery`] so lange ohne Netz: mit dem
/// veralteten Eintrag, wenn es einen gibt, sonst mit dem Fehler (LFH-923). Danach startet die
/// nächste Anfrage genau einen neuen Abruf.
pub const DISCOVERY_NEGATIV_FENSTER: Duration = Duration::from_secs(30);

/// Höchstens so lange wartet eine Anfrage auf einen laufenden Discovery-Abruf; danach bekommt
/// sie den Fehler (beim Start: den Fehler-Redirect), der Abruf läuft weiter (LFH-923). Hält einen
/// der Zulassungsplätze (`zulassung.rs`) nur kurz statt bis zum Anfrage-Budget.
pub const DISCOVERY_WARTEN_MAX: Duration = Duration::from_secs(2);

/// Gesamtfrist eines Discovery-Abrufs (Konfiguration und JWKS nacheinander, je bis
/// [`OIDC_HTTP_TIMEOUT`]).
const DISCOVERY_ABRUF_FRIST: Duration = Duration::from_secs(20);

/// Prozessweiter Discovery-Cache, lazy beim ersten `oidc_client`-Aufruf befüllt, nie beim
/// Serverstart. Ein Issuer je Prozess.
static DISCOVERY: DiscoveryCache = DiscoveryCache::neu(
    DISCOVERY_TTL,
    DISCOVERY_NEGATIV_FENSTER,
    DISCOVERY_WARTEN_MAX,
    DISCOVERY_ABRUF_FRIST,
);

/// Ergebnis eines Discovery-Abrufs; der Fehler steht schon im Log.
type DiscoveryErgebnis = Result<CoreProviderMetadata, ()>;

/// Discovery-Cache mit Single-Flight, Negativ-Cache und Stale-while-revalidate (LFH-923).
///
/// - **Frisch** (jünger als `ttl`): sofort aus dem Cache.
/// - **Veraltet:** sofort der alte Eintrag; im Hintergrund läuft höchstens ein Abruf. Scheitert
///   er, bleibt der alte Eintrag und hält Anmeldungen am Laufen, bis ein Abruf gelingt.
/// - **Leer:** Die Anfrage startet einen Abruf oder hängt sich an den laufenden und wartet
///   höchstens `warten_max` darauf.
/// - **Nach einem Fehlschlag** antwortet der Cache `negativ_fenster` lang ohne Netz.
///
/// Der Abruf läuft als eigene Task, nicht unter einem Lock und nicht im Future der Anfrage: eine
/// abgebrochene oder ausgezeitete Anfrage nimmt ihn nicht mit, und eine Welle von Anfragen
/// gegen einen stummen IdP löst genau einen Netzversuch aus. Der `std`-Mutex hält nur kurze,
/// synchrone Abschnitte und nie über ein `.await` (s. Test `oidc_client_future_ist_send`).
struct DiscoveryCache {
    ttl: Duration,
    negativ_fenster: Duration,
    warten_max: Duration,
    abruf_frist: Duration,
    zustand: Mutex<DiscoveryZustand>,
}

struct DiscoveryZustand {
    eintrag: Option<DiscoveryEintrag>,
    /// Issuer und Zeitpunkt des letzten gescheiterten Abrufs.
    fehlschlag: Option<(String, Instant)>,
    /// Issuer und Ergebniskanal des laufenden Abrufs.
    laufend: Option<(String, watch::Receiver<Option<DiscoveryErgebnis>>)>,
}

struct DiscoveryEintrag {
    issuer: String,
    metadata: CoreProviderMetadata,
    geholt: Instant,
}

/// Fehler an den Aufrufer, ohne IdP-Detail (s. `tausche_code_gegen_token`).
fn discovery_fehler() -> AppError {
    AppError::ServiceUnavailable("OIDC-Discovery fehlgeschlagen".into())
}

impl DiscoveryCache {
    const fn neu(
        ttl: Duration,
        negativ_fenster: Duration,
        warten_max: Duration,
        abruf_frist: Duration,
    ) -> Self {
        Self {
            ttl,
            negativ_fenster,
            warten_max,
            abruf_frist,
            zustand: Mutex::new(DiscoveryZustand {
                eintrag: None,
                fehlschlag: None,
                laufend: None,
            }),
        }
    }

    fn zustand(&self) -> std::sync::MutexGuard<'_, DiscoveryZustand> {
        self.zustand.lock().unwrap_or_else(|e| e.into_inner())
    }

    /// Metadaten für `issuer` nach den Regeln im Typ-Kommentar.
    async fn hole(
        &'static self,
        issuer: &IssuerUrl,
        http: &'static reqwest::Client,
    ) -> Result<CoreProviderMetadata, AppError> {
        let schluessel = issuer.as_str();
        let (veraltet, mut ergebnis) = {
            let mut z = self.zustand();
            let jetzt = Instant::now();
            let veraltet = match z.eintrag.as_ref().filter(|e| e.issuer == schluessel) {
                Some(e) if jetzt.saturating_duration_since(e.geholt) < self.ttl => {
                    return Ok(e.metadata.clone());
                }
                Some(e) => Some(e.metadata.clone()),
                None => None,
            };
            let im_negativ_fenster = z.fehlschlag.as_ref().is_some_and(|(i, wann)| {
                i == schluessel && jetzt.saturating_duration_since(*wann) < self.negativ_fenster
            });
            if im_negativ_fenster {
                return veraltet.ok_or_else(discovery_fehler);
            }
            let ergebnis = match z.laufend.as_ref().filter(|(i, _)| i == schluessel) {
                Some((_, rx)) => rx.clone(),
                None => self.starte(&mut z, issuer.clone(), http),
            };
            (veraltet, ergebnis)
        };
        if let Some(metadata) = veraltet {
            return Ok(metadata);
        }
        let gewartet =
            tokio::time::timeout(self.warten_max, ergebnis.wait_for(Option::is_some)).await;
        let antwort = match gewartet {
            Ok(Ok(fertig)) => match fertig.as_ref() {
                Some(Ok(metadata)) => Ok(metadata.clone()),
                _ => Err(discovery_fehler()),
            },
            // Die Abruf-Task endete ohne Ergebnis (Panic); `FlugEnde` hat den Fehlschlag notiert.
            Ok(Err(_)) => Err(discovery_fehler()),
            Err(_) => {
                tracing::warn!(
                    "OIDC-Discovery: keine Antwort binnen {} s, Abruf läuft weiter",
                    self.warten_max.as_secs_f32()
                );
                Err(discovery_fehler())
            }
        };
        antwort
    }

    /// Startet den Abruf als eigene Task und trägt ihn als laufend ein.
    fn starte(
        &'static self,
        z: &mut DiscoveryZustand,
        issuer: IssuerUrl,
        http: &'static reqwest::Client,
    ) -> watch::Receiver<Option<DiscoveryErgebnis>> {
        let (tx, rx) = watch::channel(None);
        z.laufend = Some((issuer.as_str().to_string(), rx.clone()));
        // Vor dem Spawn gebaut: wird die Task nie gepollt (Runtime endet), räumt `Drop` trotzdem.
        let mut ende = FlugEnde {
            cache: self,
            issuer: issuer.as_str().to_string(),
            erledigt: false,
        };
        tokio::spawn(async move {
            let ergebnis =
                match tokio::time::timeout(self.abruf_frist, discover(issuer, http)).await {
                    Ok(ergebnis) => ergebnis,
                    Err(_) => {
                        tracing::warn!(
                            "OIDC-Discovery: Abruf nach {} s abgebrochen",
                            self.abruf_frist.as_secs()
                        );
                        Err(())
                    }
                };
            ende.abschliessen(&ergebnis);
            tx.send_replace(Some(ergebnis));
        });
        rx
    }
}

/// Schließt einen Discovery-Abruf im Cache ab; endet die Task ohne [`FlugEnde::abschliessen`]
/// (Panic), notiert `Drop` einen Fehlschlag, damit kein Abruf auf ewig als laufend gilt.
struct FlugEnde {
    cache: &'static DiscoveryCache,
    issuer: String,
    erledigt: bool,
}

impl FlugEnde {
    fn abschliessen(&mut self, ergebnis: &DiscoveryErgebnis) {
        let mut z = self.cache.zustand();
        match ergebnis {
            Ok(metadata) => {
                z.eintrag = Some(DiscoveryEintrag {
                    issuer: self.issuer.clone(),
                    metadata: metadata.clone(),
                    geholt: Instant::now(),
                });
                z.fehlschlag = None;
            }
            Err(()) => z.fehlschlag = Some((self.issuer.clone(), Instant::now())),
        }
        if z.laufend.as_ref().is_some_and(|(i, _)| *i == self.issuer) {
            z.laufend = None;
        }
        self.erledigt = true;
    }
}

impl Drop for FlugEnde {
    fn drop(&mut self) {
        if !self.erledigt {
            self.abschliessen(&Err(()));
        }
    }
}

/// Ein Discovery-Abruf: `.well-known/openid-configuration`, danach JWKS.
async fn discover(issuer: IssuerUrl, http: &'static reqwest::Client) -> DiscoveryErgebnis {
    CoreProviderMetadata::discover_async(issuer, &OidcHttp(http))
        .await
        .map_err(|e| {
            // Kein `{e}` in der client-sichtbaren Meldung, nur ins Log (s.
            // `tausche_code_gegen_token`).
            tracing::warn!(error = %e, "OIDC-Discovery fehlgeschlagen");
        })
}

/// Adapter des Projekt-`reqwest::Client` an `openidconnect::AsyncHttpClient` (s. Modul-Doku).
/// Ein benannter Typ statt eines Closures (LFH-923): das Future eines Closure-Adapters prüft
/// `tokio::spawn` über alle Lebensdauern, und das scheitert („implementation of
/// `AsyncHttpClient` is not general enough“).
struct OidcHttp(&'static reqwest::Client);

impl<'c> openidconnect::AsyncHttpClient<'c> for OidcHttp {
    type Error = HttpClientFehler;
    type Future = futures::future::BoxFuture<'c, Result<HttpResponse, HttpClientFehler>>;

    fn call(&'c self, request: HttpRequest) -> Self::Future {
        Box::pin(fuehre_http_request_aus(self.0, request))
    }
}

/// OIDC-Client samt dem HTTP-Client, der zu seinem Issuer passt ([`http_client_fuer`]). `Deref`
/// auf den `CoreClient`, damit die Aufrufer ihn wie bisher nutzen (`id_token_verifier`).
#[derive(Debug)]
pub struct OidcClient {
    core: OidcCoreClient,
    http: &'static reqwest::Client,
}

impl std::ops::Deref for OidcClient {
    type Target = OidcCoreClient;

    fn deref(&self) -> &OidcCoreClient {
        &self.core
    }
}

/// Baut den OIDC-Client aus gecachter Discovery und den `OidcSettings`. Fehlende Felder,
/// unerreichbarer IdP oder kaputte Metadaten liefern einen `AppError`, nie einen Panic; der Pfad
/// wird erst bei `/api/auth/oidc/start`/`callback` betreten.
pub async fn oidc_client(cfg: &OidcSettings) -> Result<OidcClient, AppError> {
    let issuer = oidc_konfigfeld(&cfg.issuer, "LIFELINE_OIDC_ISSUER")?;
    let client_id = oidc_konfigfeld(&cfg.client_id, "LIFELINE_OIDC_CLIENT_ID")?;
    let redirect_url = oidc_konfigfeld(&cfg.redirect_url, "LIFELINE_OIDC_REDIRECT_URL")?;
    let client_secret = cfg
        .client_secret
        .as_ref()
        .map(|s| s.als_str().to_string())
        .filter(|s| !s.is_empty())
        .ok_or_else(|| {
            AppError::NotImplemented(
                "OIDC ist nicht konfiguriert (LIFELINE_OIDC_CLIENT_SECRET fehlt)".into(),
            )
        })?;

    // Die Redirect-URL vor der Discovery prüfen, damit sie ohne IdP-Roundtrip scheitert.
    let redirect_url = RedirectUrl::new(redirect_url)
        .map_err(|e| AppError::Internal(format!("OIDC-Redirect-URL ungültig: {e}")))?;

    let issuer = IssuerUrl::new(issuer)
        .map_err(|e| AppError::Internal(format!("OIDC-Issuer-URL ungültig: {e}")))?;
    let Some(http) = http_client_fuer(&issuer) else {
        tracing::warn!(
            issuer = issuer.as_str(),
            "OIDC-Issuer ohne https: nur Loopback darf http nutzen (LIFELINE_OIDC_ISSUER)"
        );
        return Err(discovery_fehler());
    };

    let metadata = DISCOVERY.hole(&issuer, http).await?;

    let core = OidcCoreClient::from_provider_metadata(
        metadata,
        ClientId::new(client_id),
        Some(ClientSecret::new(client_secret)),
    )
    .set_redirect_uri(redirect_url);

    Ok(OidcClient { core, http })
}

/// Tauscht den Authorization-Code gegen ein Token-Response. Der Aufrufer entnimmt den
/// State-Store-Eintrag vorher synchron (kein Guard über `.await`).
///
/// `exchange_code` liefert ein `Result`, weil der Token-Endpoint `EndpointMaybeSet` ist. Jeder
/// Fehler kommt als `AppError`; der Aufrufer leitet generisch auf die Login-Seite um, damit kein
/// IdP-/Token-Detail in der Antwort landet.
pub async fn tausche_code_gegen_token(
    client: &OidcClient,
    code: String,
    pkce_verifier: String,
) -> Result<CoreTokenResponse, AppError> {
    // Kein `{e}` in der Meldung: `ServiceUnavailable` rendert seinen `Display` an den Client, das
    // rohe `oauth2`-Detail gehört nur ins Log.
    let token_request = client
        .exchange_code(AuthorizationCode::new(code))
        .map_err(|e| {
            tracing::warn!(error = %e, "OIDC-Token-Endpoint fehlt");
            AppError::ServiceUnavailable("OIDC-Token-Austausch fehlgeschlagen".into())
        })?
        .set_pkce_verifier(PkceCodeVerifier::new(pkce_verifier));

    let http_client = OidcHttp(client.http);

    token_request
        .request_async(&http_client)
        .await
        .map_err(|e| {
            tracing::warn!(error = %e, "OIDC-Token-Austausch fehlgeschlagen");
            AppError::ServiceUnavailable("OIDC-Token-Austausch fehlgeschlagen".into())
        })
}

/// Liest ein Pflicht-OIDC-Feld; fehlt es oder ist es leer → `AppError::NotImplemented` (501).
/// Rein aus der Konfiguration, ohne Netz.
fn oidc_konfigfeld(feld: &Option<String>, env_name: &str) -> Result<String, AppError> {
    feld.clone().filter(|s| !s.is_empty()).ok_or_else(|| {
        AppError::NotImplemented(format!("OIDC ist nicht konfiguriert ({env_name} fehlt)"))
    })
}

/// Gesamt-Timeout je Discovery-/Token-Roundtrip: ein verbundener, aber stummer IdP darf den
/// Handler nicht unbegrenzt blockieren.
const OIDC_HTTP_TIMEOUT: Duration = Duration::from_secs(15);

/// Connect-Timeout: fängt tote Hosts schon beim TCP-Handshake ab.
const OIDC_HTTP_CONNECT_TIMEOUT: Duration = Duration::from_secs(8);

/// HTTP-Client für Discovery und Token-Exchange: folgt keinen Redirects (SSRF), bleibt auf dem
/// Projekt-TLS-Stack und trägt beide Timeouts. Kein gzip (LFH-923): OIDC-Antworten sind klein,
/// und ohne Entpacken zählt der Deckel in [`fuehre_http_request_aus`] die Bytes der Leitung.
/// `https_pflicht` lehnt jeden `http://`-Abruf ab, auch einen `jwks_uri` oder Token-Endpoint aus
/// dem Discovery-Dokument.
fn baue_http_client(https_pflicht: bool) -> reqwest::Client {
    let builder = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(OIDC_HTTP_TIMEOUT)
        .connect_timeout(OIDC_HTTP_CONNECT_TIMEOUT)
        .no_gzip()
        .https_only(https_pflicht);
    // Loopback dient Entwicklung und Tests: dort teilen sich mehrere Tokio-Runtimes eines
    // Test-Binaries diesen prozessweiten Client. Eine Keep-alive-Verbindung, deren Task auf einer
    // schon beendeten Runtime lebte, scheiterte mit „runtime dropped the dispatch task“.
    let builder = if https_pflicht {
        builder
    } else {
        builder.pool_max_idle_per_host(0)
    };
    builder.build().expect("OIDC-HTTP-Client baubar")
}

/// Einmal je Prozess gebaut (LFH-923), mit Verbindungspool: vorher entstand je Discovery und je
/// Token-Tausch ein neuer Client samt TLS-Handshake.
static OIDC_HTTP: LazyLock<reqwest::Client> = LazyLock::new(|| baue_http_client(true));

/// Für einen Issuer auf Loopback (Entwicklung, Tests mit Fixture-IdP): erlaubt `http://`.
static OIDC_HTTP_LOOPBACK: LazyLock<reqwest::Client> = LazyLock::new(|| baue_http_client(false));

/// Der HTTP-Client für `issuer`: https-only, außer der Issuer liegt auf Loopback (`localhost`,
/// `127.0.0.0/8`, `::1`), dort ist auch `http://` erlaubt. `None` für einen `http://`-Issuer
/// außerhalb von Loopback: ohne TLS könnte ein Dritter im Netz Discovery, JWKS und Token
/// austauschen.
fn http_client_fuer(issuer: &IssuerUrl) -> Option<&'static reqwest::Client> {
    let url = issuer.url();
    let loopback = match url.host() {
        Some(openidconnect::url::Host::Domain(name)) => name.eq_ignore_ascii_case("localhost"),
        Some(openidconnect::url::Host::Ipv4(ip)) => ip.is_loopback(),
        Some(openidconnect::url::Host::Ipv6(ip)) => ip.is_loopback(),
        None => false,
    };
    if loopback {
        Some(&OIDC_HTTP_LOOPBACK)
    } else if url.scheme() == "https" {
        Some(&OIDC_HTTP)
    } else {
        None
    }
}

/// Führt einen von `oauth2` gebauten `HttpRequest` über das Projekt-`reqwest::Client` aus.
/// `http` ist im Baum einheitlich Version 1, die Typen passen ohne Konvertierung. Der Rumpf wird
/// nur bis [`DECKEL_OIDC`](crate::http_begrenzt::DECKEL_OIDC) gelesen (LFH-923).
async fn fuehre_http_request_aus(
    client: &reqwest::Client,
    request: HttpRequest,
) -> Result<HttpResponse, HttpClientFehler> {
    let method = request.method().clone();
    let uri = request.uri().to_string();
    let headers = request.headers().clone();
    let body = request.into_body();

    let antwort = client
        .request(method, uri)
        .headers(headers)
        .body(body)
        .send()
        .await?;

    let status = antwort.status();
    let headers = antwort.headers().clone();
    let bytes = crate::http_begrenzt::lies_begrenzt(antwort, crate::http_begrenzt::DECKEL_OIDC)
        .await
        .map_err(HttpClientFehler::Lesen)?;

    let mut builder = openidconnect::http::Response::builder().status(status);
    if let Some(header_map) = builder.headers_mut() {
        *header_map = headers;
    }
    builder
        .body(bytes)
        .map_err(|e| HttpClientFehler::Antwort(e.to_string()))
}

/// Fehler des HTTP-Adapters (Netzwerk oder Rekonstruktion der `http::Response`).
#[derive(Debug)]
enum HttpClientFehler {
    Reqwest(reqwest::Error),
    /// Rumpf über dem Deckel oder nicht lesbar.
    Lesen(crate::http_begrenzt::LeseFehler),
    Antwort(String),
}

impl std::fmt::Display for HttpClientFehler {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            HttpClientFehler::Reqwest(e) => write!(f, "HTTP-Request fehlgeschlagen: {e}"),
            HttpClientFehler::Lesen(e) => write!(f, "{e}"),
            HttpClientFehler::Antwort(m) => {
                write!(f, "Antwort konnte nicht aufgebaut werden: {m}")
            }
        }
    }
}

impl std::error::Error for HttpClientFehler {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            HttpClientFehler::Reqwest(e) => Some(e),
            HttpClientFehler::Lesen(e) => Some(e),
            HttpClientFehler::Antwort(_) => None,
        }
    }
}

impl From<reqwest::Error> for HttpClientFehler {
    fn from(e: reqwest::Error) -> Self {
        HttpClientFehler::Reqwest(e)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Vollständige `OidcSettings` für den übergebenen Issuer.
    fn vollstaendige_config(issuer: &str) -> OidcSettings {
        OidcSettings {
            issuer: Some(issuer.to_string()),
            client_id: Some("test-client-id".to_string()),
            client_secret: Some(GeheimesPasswort("test-client-secret".to_string())),
            redirect_url: Some("http://localhost:8080/api/auth/oidc/callback".to_string()),
        }
    }

    /// Kompilier-Check: das Future von `oidc_client` muss `Send` sein, sonst lässt es sich in
    /// keinem
    /// axum-Handler verwenden. Ein `#[tokio::test]` (current-thread) deckte `!Send` nicht auf.
    #[test]
    fn oidc_client_future_ist_send() {
        fn ist_send<T: Send>(_: &T) {}
        let cfg = OidcSettings::default();
        ist_send(&oidc_client(&cfg));
    }

    #[tokio::test]
    async fn ohne_oidc_config_liefert_appfehler_kein_panic() {
        // Fehlende Konfiguration degradiert sauber statt zu paniken.
        let cfg = OidcSettings::default();

        let ergebnis = oidc_client(&cfg).await;

        assert!(
            ergebnis.is_err(),
            "ohne OIDC-Config muss Err geliefert werden"
        );
    }

    /// Ein unerreichbarer IdP (`127.0.0.1:1`, lokal, kein echtes Netz) liefert `Err` statt zu
    /// paniken oder zu blockieren.
    #[tokio::test]
    async fn unerreichbarer_idp_liefert_err_statt_panic() {
        let cfg = vollstaendige_config("http://127.0.0.1:1");

        let ergebnis = oidc_client(&cfg).await;

        assert!(
            ergebnis.is_err(),
            "unerreichbarer IdP muss Err liefern, kein Panic/Hang"
        );
        match ergebnis {
            Err(AppError::ServiceUnavailable(_)) => {}
            andere => panic!("erwartete ServiceUnavailable (Discovery-Fehler), fand {andere:?}"),
        }
    }

    /// Ein gescheiterter Discovery-Versuch hinterlässt keinen Cache-Eintrag; der nächste Aufruf
    /// scheitert ebenso (im Negativfenster ohne Netz, s. LFH-923-Tests unten).
    #[tokio::test]
    async fn wiederholter_aufruf_nach_fehlschlag_versucht_discovery_erneut() {
        let cfg = vollstaendige_config("http://127.0.0.1:1");

        let erster = oidc_client(&cfg).await;
        let zweiter = oidc_client(&cfg).await;

        assert!(erster.is_err());
        assert!(zweiter.is_err());
    }

    // ------------------------------------------------------------ LFH-923: Discovery-Cache

    use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
    use std::sync::Arc;

    /// Eigener Cache je Test: der prozessweite [`DISCOVERY`] teilt sich alle Tests im Binary.
    fn testcache(ttl: Duration, negativ: Duration, warten: Duration) -> &'static DiscoveryCache {
        Box::leak(Box::new(DiscoveryCache::neu(
            ttl,
            negativ,
            warten,
            Duration::from_secs(10),
        )))
    }

    /// Ein IdP, der Verbindungen annimmt und nie antwortet. Zählt die angenommenen Verbindungen.
    async fn stummer_idp() -> (IssuerUrl, Arc<AtomicUsize>) {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let basis = format!("http://{}", listener.local_addr().unwrap());
        let verbindungen = Arc::new(AtomicUsize::new(0));
        let zaehler = verbindungen.clone();
        tokio::spawn(async move {
            let mut offen = Vec::new();
            while let Ok((sock, _)) = listener.accept().await {
                zaehler.fetch_add(1, Ordering::SeqCst);
                offen.push(sock);
            }
        });
        (IssuerUrl::new(basis).unwrap(), verbindungen)
    }

    /// Ein Fixture-IdP mit Discovery und leerem JWKS. Zählt die Discovery-Abrufe; solange
    /// `gestoert` gesetzt ist, antwortet er mit 500.
    async fn fixture_idp(gestoert: Arc<AtomicBool>) -> (IssuerUrl, Arc<AtomicUsize>) {
        use openidconnect::core::{
            CoreJsonWebKeySet, CoreJwsSigningAlgorithm, CoreResponseType, CoreSubjectIdentifierType,
        };
        use openidconnect::{
            AuthUrl, EmptyAdditionalProviderMetadata, JsonWebKeySetUrl, ResponseTypes,
        };

        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let basis = format!("http://{}", listener.local_addr().unwrap());
        let metadata = serde_json::to_value(CoreProviderMetadata::new(
            IssuerUrl::new(basis.clone()).unwrap(),
            AuthUrl::new(format!("{basis}/authorize")).unwrap(),
            JsonWebKeySetUrl::new(format!("{basis}/jwks")).unwrap(),
            vec![ResponseTypes::new(vec![CoreResponseType::Code])],
            vec![CoreSubjectIdentifierType::Public],
            vec![CoreJwsSigningAlgorithm::RsaSsaPkcs1V15Sha256],
            EmptyAdditionalProviderMetadata {},
        ))
        .unwrap();
        let jwks = serde_json::to_value(CoreJsonWebKeySet::new(vec![])).unwrap();
        let abrufe = Arc::new(AtomicUsize::new(0));
        let zaehler = abrufe.clone();
        let app = axum::Router::new()
            .route(
                "/.well-known/openid-configuration",
                axum::routing::get(move || {
                    let (metadata, zaehler, gestoert) =
                        (metadata.clone(), zaehler.clone(), gestoert.clone());
                    async move {
                        use axum::response::IntoResponse;
                        zaehler.fetch_add(1, Ordering::SeqCst);
                        if gestoert.load(Ordering::SeqCst) {
                            axum::http::StatusCode::INTERNAL_SERVER_ERROR.into_response()
                        } else {
                            axum::Json(metadata).into_response()
                        }
                    }
                }),
            )
            .route(
                "/jwks",
                axum::routing::get(move || async move { axum::Json(jwks) }),
            );
        tokio::spawn(async move {
            axum::serve(listener, app).await.ok();
        });
        (IssuerUrl::new(basis).unwrap(), abrufe)
    }

    /// Wartet, bis kein Abruf mehr läuft.
    async fn abruf_beendet(cache: &DiscoveryCache) {
        for _ in 0..200 {
            if cache.zustand().laufend.is_none() {
                return;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
        panic!("Discovery-Abruf endet nicht");
    }

    /// LFH-923: Eine Welle paralleler Anfragen gegen einen stummen IdP löst genau einen
    /// Netzversuch aus, und jede Anfrage kehrt nach der Wartegrenze mit dem Fehler zurück.
    #[tokio::test]
    async fn welle_gegen_stummen_idp_loest_einen_netzversuch_aus() {
        let (issuer, verbindungen) = stummer_idp().await;
        let warten = Duration::from_millis(300);
        let cache = testcache(DISCOVERY_TTL, DISCOVERY_NEGATIV_FENSTER, warten);

        let beginn = Instant::now();
        let ergebnisse =
            futures::future::join_all((0..50).map(|_| cache.hole(&issuer, &OIDC_HTTP_LOOPBACK)))
                .await;
        let dauer = beginn.elapsed();

        assert!(ergebnisse
            .iter()
            .all(|e| matches!(e, Err(AppError::ServiceUnavailable(_)))));
        assert!(dauer < warten + Duration::from_secs(1), "{dauer:?}");
        // Eine zweite Welle hängt sich an denselben, noch laufenden Abruf.
        let zweite = cache.hole(&issuer, &OIDC_HTTP_LOOPBACK).await;
        assert!(zweite.is_err());
        tokio::time::sleep(Duration::from_millis(100)).await;
        assert_eq!(verbindungen.load(Ordering::SeqCst), 1);
    }

    /// LFH-923: Im Negativfenster kein Netzzugriff, danach genau ein neuer Versuch.
    #[tokio::test]
    async fn negativfenster_ohne_netz_danach_genau_ein_versuch() {
        let (issuer, abrufe) = fixture_idp(Arc::new(AtomicBool::new(true))).await;
        // Großzügige Fenster: die Zeitschranken müssen auch unter CI-Last halten.
        let fenster = Duration::from_secs(1);
        let cache = testcache(DISCOVERY_TTL, fenster, Duration::from_secs(2));

        assert!(cache.hole(&issuer, &OIDC_HTTP_LOOPBACK).await.is_err());
        assert_eq!(abrufe.load(Ordering::SeqCst), 1);

        let beginn = Instant::now();
        for _ in 0..5 {
            assert!(cache.hole(&issuer, &OIDC_HTTP_LOOPBACK).await.is_err());
        }
        assert!(beginn.elapsed() < fenster / 2, "{:?}", beginn.elapsed());
        assert_eq!(abrufe.load(Ordering::SeqCst), 1, "kein Netz im Fenster");

        tokio::time::sleep(fenster + Duration::from_millis(50)).await;
        assert!(cache.hole(&issuer, &OIDC_HTTP_LOOPBACK).await.is_err());
        assert_eq!(abrufe.load(Ordering::SeqCst), 2, "genau ein neuer Versuch");
    }

    /// LFH-923: Ein abgelaufener Eintrag trägt weiter, solange der Refresh scheitert; ein
    /// gelungener Refresh ersetzt ihn.
    #[tokio::test]
    async fn veralteter_eintrag_traegt_bei_scheiterndem_refresh() {
        let gestoert = Arc::new(AtomicBool::new(false));
        let (issuer, abrufe) = fixture_idp(gestoert.clone()).await;
        // Großzügige Fenster: die Zeitschranken müssen auch unter CI-Last halten.
        let ttl = Duration::from_secs(1);
        let fenster = Duration::from_secs(1);
        let cache = testcache(ttl, fenster, Duration::from_secs(2));

        assert!(cache.hole(&issuer, &OIDC_HTTP_LOOPBACK).await.is_ok());
        assert_eq!(abrufe.load(Ordering::SeqCst), 1);

        // Frisch: kein Netz.
        assert!(cache.hole(&issuer, &OIDC_HTTP_LOOPBACK).await.is_ok());
        assert_eq!(abrufe.load(Ordering::SeqCst), 1);

        tokio::time::sleep(ttl + Duration::from_millis(20)).await;
        gestoert.store(true, Ordering::SeqCst);
        assert!(
            cache.hole(&issuer, &OIDC_HTTP_LOOPBACK).await.is_ok(),
            "veraltet, sofort"
        );
        abruf_beendet(cache).await;
        assert_eq!(abrufe.load(Ordering::SeqCst), 2, "Refresh im Hintergrund");
        assert!(cache.zustand().fehlschlag.is_some());

        // Im Negativfenster: weiter der alte Eintrag, ohne Netz.
        assert!(cache.hole(&issuer, &OIDC_HTTP_LOOPBACK).await.is_ok());
        assert_eq!(abrufe.load(Ordering::SeqCst), 2);

        // Nach dem Fenster: wieder ein Versuch, der IdP ist zurück.
        gestoert.store(false, Ordering::SeqCst);
        tokio::time::sleep(fenster + Duration::from_millis(20)).await;
        let vor_dem_versuch = Instant::now();
        assert!(cache.hole(&issuer, &OIDC_HTTP_LOOPBACK).await.is_ok());
        abruf_beendet(cache).await;
        assert_eq!(abrufe.load(Ordering::SeqCst), 3);
        let z = cache.zustand();
        assert!(z.fehlschlag.is_none());
        assert!(
            z.eintrag.as_ref().unwrap().geholt >= vor_dem_versuch,
            "frischer Eintrag"
        );
    }

    // ------------------------------------------------------------ LFH-923: HTTP-Adapter

    fn get_anfrage(url: &str) -> HttpRequest {
        openidconnect::http::Request::builder()
            .uri(url)
            .method(openidconnect::http::Method::GET)
            .body(Vec::new())
            .unwrap()
    }

    #[tokio::test]
    async fn adapter_lehnt_antwort_ueber_einem_mib_ab() {
        let basis = crate::http_begrenzt::fixture::bediene(axum::Router::new().route(
            "/",
            axum::routing::get(|| async {
                crate::http_begrenzt::fixture::strom_antwort(crate::http_begrenzt::DECKEL_OIDC + 1)
            }),
        ))
        .await;
        let fehler = fuehre_http_request_aus(&OIDC_HTTP_LOOPBACK, get_anfrage(&basis))
            .await
            .unwrap_err();
        assert!(
            matches!(
                fehler,
                HttpClientFehler::Lesen(crate::http_begrenzt::LeseFehler::ZuGross { .. })
            ),
            "{fehler}"
        );
    }

    /// Der OIDC-Client bietet kein gzip an und entpackt keins: eine gepackte Antwort kommt als
    /// gepackte Bytes an, und eine gzip-Bombe zählt mit ihrer Größe auf der Leitung.
    #[tokio::test]
    async fn adapter_entpackt_kein_gzip() {
        let gepackt = crate::http_begrenzt::fixture::gzip_nullen(8 * 1024 * 1024);
        let erwartet = gepackt.clone();
        let angeboten = Arc::new(Mutex::new(None::<String>));
        let mitschnitt = angeboten.clone();
        let basis = crate::http_begrenzt::fixture::bediene(axum::Router::new().route(
            "/",
            axum::routing::get(move |kopf: axum::http::HeaderMap| {
                let (g, m) = (gepackt.clone(), mitschnitt.clone());
                async move {
                    *m.lock().unwrap() = kopf
                        .get(axum::http::header::ACCEPT_ENCODING)
                        .map(|v| v.to_str().unwrap().to_string());
                    crate::http_begrenzt::fixture::gzip_antwort(g)
                }
            }),
        ))
        .await;
        let antwort = fuehre_http_request_aus(&OIDC_HTTP_LOOPBACK, get_anfrage(&basis))
            .await
            .unwrap();
        assert_eq!(antwort.body(), &erwartet);
        let angeboten = angeboten.lock().unwrap().clone();
        assert!(
            !angeboten.is_some_and(|a| a.contains("gzip")),
            "kein gzip angeboten"
        );
    }

    #[test]
    fn http_issuer_nur_auf_loopback() {
        let fuer = |u: &str| http_client_fuer(&IssuerUrl::new(u.to_string()).unwrap());
        assert!(fuer("http://idp.example").is_none());
        assert!(fuer("http://192.168.1.10:8080").is_none());
        for strikt in ["https://idp.example", "https://idp.example/realms/x"] {
            assert!(std::ptr::eq(fuer(strikt).unwrap(), &*OIDC_HTTP), "{strikt}");
        }
        for lokal in [
            "http://127.0.0.1:1",
            "http://localhost:8080",
            "http://[::1]:8080",
            "https://localhost",
        ] {
            assert!(
                std::ptr::eq(fuer(lokal).unwrap(), &*OIDC_HTTP_LOOPBACK),
                "{lokal}"
            );
        }
    }

    /// Der Client für Issuer außerhalb von Loopback lehnt `http://` ab, auch für eine
    /// `jwks_uri` oder einen Token-Endpoint aus dem Discovery-Dokument.
    #[tokio::test]
    async fn strikter_client_lehnt_http_ab() {
        let basis = crate::http_begrenzt::fixture::bediene(
            axum::Router::new().route("/", axum::routing::get(|| async { "{}" })),
        )
        .await;
        assert!(fuehre_http_request_aus(&OIDC_HTTP, get_anfrage(&basis))
            .await
            .is_err());
        assert!(
            fuehre_http_request_aus(&OIDC_HTTP_LOOPBACK, get_anfrage(&basis))
                .await
                .is_ok()
        );
    }

    #[tokio::test]
    async fn http_issuer_ausserhalb_loopback_ist_fehler_ohne_netz() {
        let cfg = vollstaendige_config("http://idp.invalid");
        assert!(matches!(
            oidc_client(&cfg).await,
            Err(AppError::ServiceUnavailable(_))
        ));
    }
}
