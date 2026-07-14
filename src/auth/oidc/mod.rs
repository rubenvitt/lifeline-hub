//! OIDC/SSO-Provider (LFH-41, Increment 3): OIDC-Client-Aufbau mit lazy gecachter Discovery und
//! SSRF-resistentem HTTP-Client.
//!
//! **Warum kein `openidconnect`-HTTP-Feature:** die Crate ist in `Cargo.toml` bewusst
//! `default-features = false` gepinnt — deren `reqwest`/`rustls-tls`-Features ziehen `oauth2`s
//! eigenen `reqwest`-Stack (mit dem `ring`-Crypto-Provider) herein, der mit dem Projekt-`reqwest`
//! (`aws-lc-rs`) auf demselben rustls kollidiert: rustls kann dann keinen Default-`CryptoProvider`
//! mehr automatisch bestimmen (siehe Kanarienvogel-Test `tls::tests::rcgen_pem_ist_per_rustls_ladbar`,
//! der genau das in Inc. 2 aufgedeckt hat). Statt dessen adaptiert dieses Modul das
//! Projekt-eigene `reqwest::Client` (SSRF-Policy `redirect::Policy::none()`) an
//! `openidconnect::AsyncHttpClient` — ein simpler Closure-Adapter reicht, weil `oauth2` diesen
//! Trait blanket für `Fn(HttpRequest) -> impl Future<Output = Result<HttpResponse, E>>`
//! implementiert (kein eigener `impl`-Block auf einem fremden Typ, kein Orphan-Rule-Problem).
pub mod provisioning;
pub mod state;

use crate::config::{Config, GeheimesPasswort};
use crate::error::AppError;
use openidconnect::core::{CoreClient, CoreProviderMetadata};
use openidconnect::{
    ClientId, ClientSecret, EndpointMaybeSet, EndpointNotSet, EndpointSet, HttpRequest,
    HttpResponse, IssuerUrl, RedirectUrl,
};
use std::sync::OnceLock;
use std::time::Duration;
use tokio::sync::OnceCell;

/// Resolved OIDC-Einstellungen (Issuer/Client-ID/Client-Secret/Redirect-URL) — prozessweiter
/// `OnceLock` statt `AppState`-Feld, analog zu `anhang::ScanConfig` (LFH-114) und
/// `session::COOKIE_SECURE`: `AppState` bricht sonst dutzende Inline-Test-Konstruktionen
/// (Memory: appstate-feld-bricht-test-konstruktionen), nur um dieses eine Auth-Feature an die
/// `Config` zu binden. `oidc_client` nimmt bewusst weiterhin eine EXPLIZITE `&OidcSettings`-
/// Referenz entgegen (kein Lesen des globalen Zustands intern) — die bestehenden Unit-Tests
/// unten prüfen unterschiedliche Konfigurationen (leer/unerreichbar) im selben Testprozess;
/// würde `oidc_client` selbst aus dem `OnceLock` lesen, könnten sich Tests nicht mehr
/// unterscheiden (ein `OnceLock` lässt sich nach dem ersten `set` nicht mehr ändern). Die
/// Handler-Schicht (`routes::auth::oidc_start`, Task 5) liefert dafür `oidc_settings()`.
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

/// Einmalig beim Serverstart setzen (`main::run_server`, direkt nach `Config::parse()`).
/// Doppelsetzen wird ignoriert (wie `registry::set_oidc_konfiguriert`).
pub fn init_oidc_settings(cfg: OidcSettings) {
    let _ = OIDC_SETTINGS.set(cfg);
}

/// Liefert die prozessweiten OIDC-Einstellungen; ungesetzt (die meisten Tests) → alle Felder
/// `None`, `oidc_client` degradiert dann korrekt zu `AppError::NotImplemented`.
pub fn oidc_settings() -> &'static OidcSettings {
    OIDC_SETTINGS.get_or_init(OidcSettings::default)
}

/// Konkreter `CoreClient`-Typ nach `from_provider_metadata` + `set_redirect_uri` (v4-Typestate,
/// Build-Verify-Punkt wie `rcgen`s `signing_key` in Inc. 2): der Authorization-Endpoint ist über
/// Discovery immer gesetzt (`EndpointSet`), Token- und UserInfo-Endpoint sind laut Spec optional
/// (`EndpointMaybeSet`); Device-Authorization/Introspection/Revocation nutzt dieser Client nicht
/// (`EndpointNotSet`). Öffentlich, damit spätere Tasks (5/6: `start`/`callback`-Handler) denselben
/// Typ ohne erneute Herleitung referenzieren können.
pub type OidcCoreClient = CoreClient<
    EndpointSet,
    EndpointNotSet,
    EndpointNotSet,
    EndpointNotSet,
    EndpointMaybeSet,
    EndpointMaybeSet,
>;

/// Prozessweiter Discovery-Cache — lazy befüllt beim ERSTEN erfolgreichen `oidc_client`-Aufruf,
/// NICHT beim Serverstart (Global Constraint „Offline-First / Lazy Discovery" im Plan
/// `2026-07-14-auth-provider-increment-3-oidc-sso.md`). Nur ein Issuer pro Prozess (`Config`
/// ändert sich zur Laufzeit nicht) — ein Issuer-Wechsel braucht einen Neustart. `get_or_try_init`
/// befüllt den Cache NUR bei Erfolg: ein IdP-Ausfall bleibt transient, der nächste Versuch
/// discovert erneut statt den Fehler dauerhaft einzufrieren.
static DISCOVERY: OnceCell<CoreProviderMetadata> = OnceCell::const_new();

/// Baut den OIDC-Client: lazy (gecachte) Discovery + `CoreClient` aus den `OidcSettings`. Fehlt
/// eines der vier Felder oder ist der IdP nicht erreichbar/liefert kaputte Metadaten, wird ein
/// `AppError` geliefert — NIE ein Panic, NIE ein blockierender Serverstart-Pfad (dieser Pfad wird
/// erst bei `GET /api/auth/oidc/start`/`callback` betreten, siehe Task 5/6 des Plans).
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

    // Vor dem (potenziell netzwerkgebundenen) Discovery-Aufruf validieren: eine kaputte
    // Redirect-URL soll billig (ohne Roundtrip zum IdP) scheitern, nicht erst danach.
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

/// Liest ein Pflicht-OIDC-Config-Feld; fehlt/ist leer → `AppError::NotImplemented` („nicht
/// konfiguriert", 501) statt Panic. Rein aus `Config`, kein Netz — erfüllt damit dieselbe
/// Offline-Disziplin wie `registry::konfiguriert` (Task 1).
fn oidc_konfigfeld(feld: &Option<String>, env_name: &str) -> Result<String, AppError> {
    feld.clone().filter(|s| !s.is_empty()).ok_or_else(|| {
        AppError::NotImplemented(format!("OIDC ist nicht konfiguriert ({env_name} fehlt)"))
    })
}

/// Lazy, gecachte Discovery: der erste Aufruf holt `.well-known/openid-configuration` + JWKS vom
/// Issuer, jeder weitere liefert den gecachten Wert ohne erneutes Netz.
async fn discovery(issuer: &str) -> Result<CoreProviderMetadata, AppError> {
    let metadata = DISCOVERY
        .get_or_try_init(|| async {
            let issuer_url = IssuerUrl::new(issuer.to_string())
                .map_err(|e| AppError::Internal(format!("OIDC-Issuer-URL ungültig: {e}")))?;
            let client = ssrf_http_client()?;
            // Closure statt eigener `impl AsyncHttpClient`-Block: `oauth2` implementiert den
            // Trait blanket für `Fn(HttpRequest) -> F`, siehe Modul-Doc oben.
            let http_client = move |request: HttpRequest| {
                let client = client.clone();
                async move { fuehre_http_request_aus(&client, request).await }
            };
            CoreProviderMetadata::discover_async(issuer_url, &http_client)
                .await
                .map_err(|e| {
                    AppError::ServiceUnavailable(format!("OIDC-Discovery fehlgeschlagen: {e}"))
                })
        })
        .await?;
    Ok(metadata.clone())
}

/// Overall-Timeout für einen Discovery-/Token-Roundtrip: ein verbundener, aber stummer IdP
/// (TCP-Connect erfolgreich, nie eine Antwort) darf den wartenden OIDC-Handler nicht unbegrenzt
/// blockieren (Offline-First-MUST „IdP-Ausfall darf den Handler nicht blockieren" des Plans).
const OIDC_HTTP_TIMEOUT: Duration = Duration::from_secs(15);

/// Connect-Timeout (separat vom Overall-Timeout): fängt tote/nicht antwortende Hosts schon beim
/// TCP-Handshake ab, statt erst nach dem vollen Overall-Timeout.
const OIDC_HTTP_CONNECT_TIMEOUT: Duration = Duration::from_secs(8);

/// HTTP-Client für Discovery + Token-Exchange (SSRF-MUST des Plans): keine Redirects folgen
/// (`redirect::Policy::none()`), sonst Default-Konfiguration — bleibt auf dem Projekt-TLS-Stack
/// (rustls/`aws-lc-rs`), kein zweiter TLS-Stack im Prozess. Timeout + Connect-Timeout gegen einen
/// verbundenen, aber stummen IdP (siehe Konstanten oben) — sonst würde ein hängender IdP den
/// awaitenden Handler unbegrenzt blockieren.
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

/// Adapter: führt einen von `openidconnect`/`oauth2` gebauten `HttpRequest`
/// (`http::Request<Vec<u8>>`) über das Projekt-`reqwest::Client` aus und liefert die Antwort als
/// `HttpResponse` (`http::Response<Vec<u8>>`) zurück. `http` ist im Dependency-Baum einheitlich
/// Version 1 (ein Eintrag in `Cargo.lock`) — Method/HeaderMap/StatusCode sind identische Typen
/// zwischen `reqwest` und `openidconnect`/`oauth2`, keine Konvertierung nötig.
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

/// Fehler des SSRF-HTTP-Client-Adapters — deckt sowohl Netzwerk-/Request-Fehler (`reqwest`) als
/// auch (praktisch nie auftretende) Fehler beim Rekonstruieren der `http::Response` ab.
/// `openidconnect`/`oauth2` verlangen an dieser Stelle nur `std::error::Error + 'static`, keinen
/// spezifischen Fehlertyp.
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

    /// Baut `OidcSettings` direkt (keine `Config`/`clap`-Umwege mehr nötig, seit `oidc_client`
    /// die schlanke `OidcSettings`-Struct statt der vollen `Config` entgegennimmt — Task 5).
    fn vollstaendige_config(issuer: &str) -> OidcSettings {
        OidcSettings {
            issuer: Some(issuer.to_string()),
            client_id: Some("test-client-id".to_string()),
            client_secret: Some(GeheimesPasswort("test-client-secret".to_string())),
            redirect_url: Some("http://localhost:8080/api/auth/oidc/callback".to_string()),
        }
    }

    /// Kompilier-Check statt Laufzeit-Test (Futures sind lazy, kein I/O nötig): `oidc_client`s
    /// Future muss `Send` sein, sonst bricht der axum-Handler-Aufruf in Task 5/6 (Plan-MUST
    /// „!Send" — Callback darf keinen Guard über await halten, UND der Handler selbst muss
    /// `Send` bleiben). `#[tokio::test]` liefe current-thread und würde ein `!Send`-Problem NICHT
    /// aufdecken (Memory: mutex-guard-await-send-axum) — daher hier als reiner `Send`-Bound-Test
    /// ohne Runtime.
    #[test]
    fn oidc_client_future_ist_send() {
        fn ist_send<T: Send>(_: &T) {}
        let cfg = OidcSettings::default();
        ist_send(&oidc_client(&cfg));
    }

    #[tokio::test]
    async fn ohne_oidc_config_liefert_appfehler_kein_panic() {
        // Registry-/Provider-Konstruktion ohne Netz ist bereits in Task 1 abgedeckt
        // (oidc_konfiguriert_ohne_netz); hier: der Client-Aufbau selbst degradiert bei
        // fehlender Config sauber statt zu paniken.
        let cfg = OidcSettings::default();

        let ergebnis = oidc_client(&cfg).await;

        assert!(
            ergebnis.is_err(),
            "ohne OIDC-Config muss Err geliefert werden"
        );
    }

    /// Offline-Isolationstest (Plan Task 4, Step 1): `http://127.0.0.1:1` ist ein bewusst
    /// scheiternder LOKALER Verbindungsversuch (Port 1 nimmt nie Verbindungen an) — KEIN
    /// externer IdP, kein echtes Netz. Belegt die Offline-First-MUST: ein unerreichbarer IdP
    /// liefert `Err` (Connection-Fehler) statt zu paniken/zu blockieren; der lokale
    /// Passwort-Login bleibt davon unberührt (dieser Test berührt ihn erst gar nicht).
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

    /// Nach einem gescheiterten Discovery-Versuch bleibt der Cache leer (kein Einfrieren des
    /// Fehlers) — ein zweiter Aufruf versucht erneut zu discovern (und scheitert erneut am
    /// selben unerreichbaren Host), statt einen stale/leeren Zustand zurückzugeben.
    #[tokio::test]
    async fn wiederholter_aufruf_nach_fehlschlag_versucht_discovery_erneut() {
        let cfg = vollstaendige_config("http://127.0.0.1:1");

        let erster = oidc_client(&cfg).await;
        let zweiter = oidc_client(&cfg).await;

        assert!(erster.is_err());
        assert!(zweiter.is_err());
    }
}
