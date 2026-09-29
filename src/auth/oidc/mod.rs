//! OIDC/SSO-Provider (LFH-41): Client-Aufbau mit lazy gecachter Discovery und SSRF-resistentem
//! HTTP-Client.
//!
//! `openidconnect` ist ohne HTTP-Features gepinnt: deren `reqwest`-Stack brächte den
//! `ring`-Provider mit, der neben dem Projekt-`reqwest` (`aws-lc-rs`) rustls die automatische
//! Wahl des `CryptoProvider` unmöglich macht (Kanarienvogel:
//! `tls::tests::rcgen_pem_ist_per_rustls_ladbar`). Stattdessen adaptiert ein Closure das
//! Projekt-`reqwest::Client` an `openidconnect::AsyncHttpClient` — `oauth2` implementiert den
//! Trait blanket für `Fn(HttpRequest) -> impl Future<…>`.
pub mod provisioning;
pub mod state;

use crate::config::{Config, GeheimesPasswort};
use crate::error::AppError;
use openidconnect::core::{CoreClient, CoreProviderMetadata, CoreTokenResponse};
use openidconnect::{
    AuthorizationCode, ClientId, ClientSecret, EndpointMaybeSet, EndpointNotSet, EndpointSet,
    HttpRequest, HttpResponse, IssuerUrl, PkceCodeVerifier, RedirectUrl,
};
use std::sync::OnceLock;
use std::time::{Duration, Instant};
use tokio::sync::RwLock;

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

/// Prozessweiter Discovery-Cache, lazy beim ersten erfolgreichen `oidc_client`-Aufruf befüllt,
/// nie beim Serverstart. Ein Issuer je Prozess. `None` heißt „noch nie“ oder „letzter Versuch
/// scheiterte“ — ein IdP-Ausfall wird nicht eingefroren.
///
/// `tokio::sync::RwLock`, weil der Schreib-Guard über den Discovery-`.await` gehalten wird; ein
/// `std`-Guard dort machte den axum-Handler `!Send` (s. Test `oidc_client_future_ist_send`).
static DISCOVERY: RwLock<Option<(CoreProviderMetadata, Instant)>> = RwLock::const_new(None);

/// True, solange `gespeichert` gegenüber `jetzt` innerhalb der [`DISCOVERY_TTL`] liegt.
fn cache_ist_frisch(gespeichert: Instant, jetzt: Instant) -> bool {
    jetzt.duration_since(gespeichert) < DISCOVERY_TTL
}

/// Baut den OIDC-Client aus gecachter Discovery und den `OidcSettings`. Fehlende Felder,
/// unerreichbarer IdP oder kaputte Metadaten liefern einen `AppError`, nie einen Panic; der Pfad
/// wird erst bei `/api/auth/oidc/start`/`callback` betreten.
pub async fn oidc_client(cfg: &OidcSettings) -> Result<OidcCoreClient, AppError> {
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

    let metadata = discovery(&issuer).await?;

    let client = OidcCoreClient::from_provider_metadata(
        metadata,
        ClientId::new(client_id),
        Some(ClientSecret::new(client_secret)),
    )
    .set_redirect_uri(redirect_url);

    Ok(client)
}

/// Tauscht den Authorization-Code gegen ein Token-Response. Der Aufrufer entnimmt den
/// State-Store-Eintrag vorher synchron (kein Guard über `.await`).
///
/// `exchange_code` liefert ein `Result`, weil der Token-Endpoint `EndpointMaybeSet` ist. Jeder
/// Fehler kommt als `AppError`; der Aufrufer leitet generisch auf die Login-Seite um, damit kein
/// IdP-/Token-Detail in der Antwort landet.
pub async fn tausche_code_gegen_token(
    client: &OidcCoreClient,
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

    let reqwest_client = ssrf_http_client()?;
    // Closure-Adapter statt `impl AsyncHttpClient`, s. Modul-Doku.
    let http_client = move |request: HttpRequest| {
        let reqwest_client = reqwest_client.clone();
        async move { fuehre_http_request_aus(&reqwest_client, request).await }
    };

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

/// Discovery mit TTL-Cache: nur der erste Aufruf (bzw. der erste nach Ablauf) holt
/// `.well-known/openid-configuration` und JWKS vom Issuer.
async fn discovery(issuer: &str) -> Result<CoreProviderMetadata, AppError> {
    let jetzt = Instant::now();

    // Fast-Path: frischen Eintrag unter Read-Lock klonen.
    {
        let read = DISCOVERY.read().await;
        if let Some((metadata, gespeichert)) = read.as_ref() {
            if cache_ist_frisch(*gespeichert, jetzt) {
                return Ok(metadata.clone());
            }
        }
    }

    // Slow-Path: Write-Lock mit Double-Check, sonst neu discovern. Der Guard hält über das
    // `.await`, daher `tokio::sync`.
    let mut write = DISCOVERY.write().await;
    let jetzt = Instant::now();
    if let Some((metadata, gespeichert)) = write.as_ref() {
        if cache_ist_frisch(*gespeichert, jetzt) {
            return Ok(metadata.clone());
        }
    }

    let issuer_url = IssuerUrl::new(issuer.to_string())
        .map_err(|e| AppError::Internal(format!("OIDC-Issuer-URL ungültig: {e}")))?;
    let client = ssrf_http_client()?;
    // Closure-Adapter, s. Modul-Doku.
    let http_client = move |request: HttpRequest| {
        let client = client.clone();
        async move { fuehre_http_request_aus(&client, request).await }
    };
    let metadata = CoreProviderMetadata::discover_async(issuer_url, &http_client)
        .await
        .map_err(|e| {
            // Kein `{e}` in der client-sichtbaren Meldung, nur ins Log (s.
            // `tausche_code_gegen_token`).
            tracing::warn!(error = %e, "OIDC-Discovery fehlgeschlagen");
            AppError::ServiceUnavailable("OIDC-Discovery fehlgeschlagen".into())
        })?;

    // Nur Erfolge cachen.
    *write = Some((metadata.clone(), Instant::now()));
    Ok(metadata)
}

/// Gesamt-Timeout je Discovery-/Token-Roundtrip: ein verbundener, aber stummer IdP darf den
/// Handler nicht unbegrenzt blockieren.
const OIDC_HTTP_TIMEOUT: Duration = Duration::from_secs(15);

/// Connect-Timeout: fängt tote Hosts schon beim TCP-Handshake ab.
const OIDC_HTTP_CONNECT_TIMEOUT: Duration = Duration::from_secs(8);

/// HTTP-Client für Discovery und Token-Exchange: folgt keinen Redirects (SSRF), bleibt auf dem
/// Projekt-TLS-Stack und trägt beide Timeouts.
fn ssrf_http_client() -> Result<reqwest::Client, AppError> {
    reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(OIDC_HTTP_TIMEOUT)
        .connect_timeout(OIDC_HTTP_CONNECT_TIMEOUT)
        .build()
        .map_err(|e| {
            AppError::Internal(format!("OIDC-HTTP-Client konnte nicht gebaut werden: {e}"))
        })
}

/// Führt einen von `oauth2` gebauten `HttpRequest` über das Projekt-`reqwest::Client` aus.
/// `http` ist im Baum einheitlich Version 1, die Typen passen ohne Konvertierung.
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
    let bytes = antwort.bytes().await?.to_vec();

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
    Antwort(String),
}

impl std::fmt::Display for HttpClientFehler {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            HttpClientFehler::Reqwest(e) => write!(f, "HTTP-Request fehlgeschlagen: {e}"),
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

    #[test]
    fn cache_frisch_nur_innerhalb_ttl() {
        let jetzt = Instant::now();
        // Eintrag „jetzt" gespeichert → frisch.
        assert!(cache_ist_frisch(jetzt, jetzt));
        // Eintrag älter als die TTL → veraltet. Die Referenzzeit wird nach vorn geschoben, weil
        // `Instant`-Subtraktion unterlaufen kann.
        let spaeter = jetzt + DISCOVERY_TTL + Duration::from_secs(1);
        assert!(!cache_ist_frisch(jetzt, spaeter));
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
    /// versucht es erneut.
    #[tokio::test]
    async fn wiederholter_aufruf_nach_fehlschlag_versucht_discovery_erneut() {
        let cfg = vollstaendige_config("http://127.0.0.1:1");

        let erster = oidc_client(&cfg).await;
        let zweiter = oidc_client(&cfg).await;

        assert!(erster.is_err());
        assert!(zweiter.is_err());
    }
}
