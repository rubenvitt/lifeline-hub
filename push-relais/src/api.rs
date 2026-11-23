use crate::{
    apns::ApnsClient,
    client_ip::{client_ip, ClientIpSource},
    senden, speicher,
};
use axum::{
    extract::{ConnectInfo, DefaultBodyLimit, Extension, State},
    http::{HeaderMap, StatusCode},
    routing::{get, post},
    Json, Router,
};
use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;
use std::{
    collections::HashMap,
    net::{IpAddr, Ipv6Addr, SocketAddr},
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};

const FENSTER: Duration = Duration::from_secs(3600);
/// Körper von `POST /v1/server`: Version und Kontakt passen weit darunter. Mehr lehnt axum mit
/// 413 ab, bevor etwas gelesen ist.
const REGISTRIERUNG_KOERPER_MAX: usize = 4 * 1024;
/// Höchstlänge des Kontakts in Zeichen (wie `--betreiber-kontakt` am Lifeline-Server).
const KONTAKT_MAX: usize = 200;
/// Höchstlänge der Version in Zeichen.
const VERSION_MAX: usize = 64;

/// Gemeinsamer Zustand der Routen.
#[derive(Clone)]
pub struct RelaisState {
    pub pool: SqlitePool,
    pub registrierungen_stunde: u32,
    /// Woher die Client-Adresse der Registrierungsgrenze kommt.
    pub client_ip: ClientIpSource,
    pub apns: Arc<ApnsClient>,
    /// Nachrichten je Server und Minute.
    pub limit_minute: u32,
    /// Nachrichten je Server: Beginn des Minutenfensters und Anzahl.
    minuten: Arc<Mutex<HashMap<String, (Instant, u32)>>>,
    /// Registrierungen je IP: Beginn des Stundenfensters und Anzahl.
    registrierungen: Arc<Mutex<HashMap<IpAddr, (Instant, u32)>>>,
    /// Gesamtfrist eines `senden`-Aufrufs ([`senden::GESAMTFRIST`]).
    pub(crate) gesamtfrist: Duration,
}

impl RelaisState {
    pub fn neu(
        pool: SqlitePool,
        registrierungen_stunde: u32,
        client_ip: ClientIpSource,
        apns: ApnsClient,
        limit_minute: u32,
    ) -> Self {
        Self {
            pool,
            registrierungen_stunde,
            client_ip,
            apns: Arc::new(apns),
            limit_minute,
            minuten: Arc::default(),
            registrierungen: Arc::default(),
            gesamtfrist: senden::GESAMTFRIST,
        }
    }

    /// Andere Gesamtfrist je `senden`-Aufruf (Tests).
    pub fn mit_gesamtfrist(mut self, frist: Duration) -> Self {
        self.gesamtfrist = frist;
        self
    }

    /// Zählt `anzahl` Nachrichten des Servers; `false`, wenn das Minutenlimit überschritten
    /// würde (dann wird nichts gezählt).
    pub(crate) fn minute_zaehlen(&self, server_id: &str, anzahl: u32) -> bool {
        let jetzt = Instant::now();
        let mut karte = self.minuten.lock().unwrap_or_else(|e| e.into_inner());
        karte.retain(|_, (start, _)| jetzt.duration_since(*start) < Duration::from_secs(60));
        let eintrag = karte.entry(server_id.to_string()).or_insert((jetzt, 0));
        if eintrag.1.saturating_add(anzahl) > self.limit_minute {
            return false;
        }
        eintrag.1 += anzahl;
        true
    }

    /// Zählt eine Registrierung der IP ([`zaehladresse`]); `false`, wenn das Stundenlimit
    /// erreicht ist.
    fn registrierung_zaehlen(&self, ip: IpAddr) -> bool {
        let ip = zaehladresse(ip);
        let jetzt = Instant::now();
        let mut karte = self
            .registrierungen
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        // Abgelaufene Fenster aufräumen, damit die Karte nicht unbegrenzt wächst.
        karte.retain(|_, (start, _)| jetzt.duration_since(*start) < FENSTER);
        let eintrag = karte.entry(ip).or_insert((jetzt, 0));
        if eintrag.1 >= self.registrierungen_stunde {
            return false;
        }
        eintrag.1 += 1;
        true
    }
}

/// Unter welcher Adresse eine Registrierung zählt: IPv4 je Adresse, IPv6 je /64. Ein /64 hat
/// jeder Anschluss und jeder VPS; je Adresse gezählt, wäre die Grenze dort keine.
fn zaehladresse(ip: IpAddr) -> IpAddr {
    match ip {
        IpAddr::V4(_) => ip,
        IpAddr::V6(v6) => match v6.to_ipv4_mapped() {
            Some(v4) => IpAddr::V4(v4),
            None => {
                let s = v6.segments();
                IpAddr::V6(Ipv6Addr::new(s[0], s[1], s[2], s[3], 0, 0, 0, 0))
            }
        },
    }
}

pub fn router(state: RelaisState) -> Router {
    Router::new()
        .route(
            "/v1/server",
            post(server_registrieren).layer(DefaultBodyLimit::max(REGISTRIERUNG_KOERPER_MAX)),
        )
        .route(
            "/v1/senden",
            post(senden::senden).layer(DefaultBodyLimit::max(senden::KOERPER_MAX)),
        )
        .route("/v1/status", get(status))
        .with_state(state)
}

#[derive(Deserialize)]
struct RegistrierungAnfrage {
    version: String,
    kontakt: Option<String>,
}

#[derive(Serialize)]
struct RegistrierungAntwort {
    server_id: String,
    geheimnis: String,
}

/// Version: nicht leer, höchstens [`VERSION_MAX`] sichtbare ASCII-Zeichen. Kontakt: höchstens
/// [`KONTAKT_MAX`] Zeichen ohne Steuerzeichen.
fn felder_gueltig(anfrage: &RegistrierungAnfrage) -> bool {
    let version = &anfrage.version;
    let version_ok = !version.is_empty()
        && version.len() <= VERSION_MAX
        && version.bytes().all(|b| b.is_ascii_graphic());
    let kontakt_ok = anfrage
        .kontakt
        .as_deref()
        .is_none_or(|k| k.chars().count() <= KONTAKT_MAX && !k.chars().any(char::is_control));
    version_ok && kontakt_ok
}

async fn server_registrieren(
    State(state): State<RelaisState>,
    peer: Option<Extension<ConnectInfo<SocketAddr>>>,
    headers: HeaderMap,
    Json(anfrage): Json<RegistrierungAnfrage>,
) -> Result<Json<RegistrierungAntwort>, StatusCode> {
    if !felder_gueltig(&anfrage) {
        return Err(StatusCode::BAD_REQUEST);
    }
    let ip = client_ip(
        &state.client_ip,
        &headers,
        peer.map(|Extension(ConnectInfo(a))| a),
    );
    if !state.registrierung_zaehlen(ip) {
        return Err(StatusCode::TOO_MANY_REQUESTS);
    }
    let zugang = speicher::registrieren(&state.pool, anfrage.kontakt.as_deref(), &anfrage.version)
        .await
        .map_err(|e| {
            tracing::error!(fehler = %e, "Registrierung fehlgeschlagen");
            StatusCode::INTERNAL_SERVER_ERROR
        })?;
    Ok(Json(RegistrierungAntwort {
        server_id: zugang.server_id,
        geheimnis: zugang.geheimnis,
    }))
}

async fn status() -> Json<serde_json::Value> {
    Json(serde_json::json!({ "version": env!("CARGO_PKG_VERSION") }))
}
