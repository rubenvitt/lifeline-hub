use crate::{apns::ApnsClient, senden, speicher};
use axum::{
    extract::{ConnectInfo, Extension, State},
    http::{HeaderMap, StatusCode},
    routing::{get, post},
    Json, Router,
};
use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;
use std::{
    collections::HashMap,
    net::{IpAddr, SocketAddr},
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};

const FENSTER: Duration = Duration::from_secs(3600);

/// Gemeinsamer Zustand der Routen.
#[derive(Clone)]
pub struct RelaisState {
    pub pool: SqlitePool,
    pub registrierungen_stunde: u32,
    pub hinter_proxy: bool,
    pub apns: Arc<ApnsClient>,
    /// Nachrichten je Server und Minute.
    pub limit_minute: u32,
    /// Nachrichten je Server: Beginn des Minutenfensters und Anzahl.
    minuten: Arc<Mutex<HashMap<String, (Instant, u32)>>>,
    /// Registrierungen je IP: Beginn des Stundenfensters und Anzahl.
    registrierungen: Arc<Mutex<HashMap<IpAddr, (Instant, u32)>>>,
}

impl RelaisState {
    pub fn neu(
        pool: SqlitePool,
        registrierungen_stunde: u32,
        hinter_proxy: bool,
        apns: ApnsClient,
        limit_minute: u32,
    ) -> Self {
        Self {
            pool,
            registrierungen_stunde,
            hinter_proxy,
            apns: Arc::new(apns),
            limit_minute,
            minuten: Arc::default(),
            registrierungen: Arc::default(),
        }
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

    /// Zählt eine Registrierung der IP; `false`, wenn das Stundenlimit erreicht ist.
    fn registrierung_zaehlen(&self, ip: IpAddr) -> bool {
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

pub fn router(state: RelaisState) -> Router {
    Router::new()
        .route("/v1/server", post(server_registrieren))
        .route("/v1/senden", post(senden::senden))
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

/// Client-IP: hinter Proxy der erste `X-Forwarded-For`-Eintrag, sonst die Peer-Adresse.
fn client_ip(state: &RelaisState, headers: &HeaderMap, peer: Option<SocketAddr>) -> IpAddr {
    if state.hinter_proxy {
        if let Some(ip) = headers
            .get("x-forwarded-for")
            .and_then(|v| v.to_str().ok())
            .and_then(|v| v.split(',').next())
            .and_then(|v| v.trim().parse::<IpAddr>().ok())
        {
            return ip;
        }
    }
    peer.map(|p| p.ip()).unwrap_or(IpAddr::from([0, 0, 0, 0]))
}

async fn server_registrieren(
    State(state): State<RelaisState>,
    peer: Option<Extension<ConnectInfo<SocketAddr>>>,
    headers: HeaderMap,
    Json(anfrage): Json<RegistrierungAnfrage>,
) -> Result<Json<RegistrierungAntwort>, StatusCode> {
    let ip = client_ip(&state, &headers, peer.map(|Extension(ConnectInfo(a))| a));
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
