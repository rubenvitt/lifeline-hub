//! Fahrzeugortung im Einsatz: Koppeln, Trennen, Kandidaten (LLH-2091, Entwurf „Koppeln und
//! Trennen“). Die Routen liegen unter `/api/incidents/{id}/vehicles/{ef_id}/tracking` (ADR-0097).
//! Hier steht weder Kennung noch Koordinate in einer Logzeile (ADR-0023).

use super::einsatz_fahrzeug::sse_fahrzeug;
use crate::app::AppState;
use crate::einsatz::einstellungen::etb_startwert;
use crate::einsatz::kontext::EinsatzSchreibzugriff;
use crate::einsatz::modul::Fahrzeuge;
use crate::error::AppError;
use crate::extract::{JsonBody, PfadParam};
use crate::fahrzeug::disposition_repo;
use crate::fahrzeug::EinsatzFahrzeugAnzeige;
use crate::instanz::spiegel::paket::RemoteTrackingCandidates;
use crate::ortung::fern;
use crate::ortung::kopplung::{self, Kandidat, Kopplung};
use crate::ortung::uebernahme::apply_position_tx;
use crate::public_api::einwurf::ablage::POSITION_KENNUNG_MAX;
use crate::public_api::zugang;
use axum::extract::State;
use axum::http::StatusCode;
use axum::Json;
use serde::{Deserialize, Serialize};
use std::time::Duration;
use utoipa::ToSchema;

/// Die Kopplung eines Fahrzeugs an eine Ortungs-Kennung.
#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct TrackingResponse {
    pub access_id: String,
    pub access_name: String,
    pub device_id: String,
    pub coupled_at: String,
}

impl From<Kopplung> for TrackingResponse {
    fn from(k: Kopplung) -> Self {
        Self {
            access_id: k.access_id().to_string(),
            access_name: k.zugang_name,
            device_id: k.kennung,
            coupled_at: k.gekoppelt_at,
        }
    }
}

/// Eine Kennung der letzten 24 Stunden, ohne Koordinaten.
#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct TrackingCandidate {
    pub access_id: String,
    pub access_name: String,
    pub device_id: String,
    pub received_at: String,
    /// Hängt die Kennung schon an einem Fahrzeug (irgendeines Einsatzes)?
    pub coupled: bool,
    /// Kommt die Kennung vom Hub (gespiegelte Org) statt aus der eigenen Ablage?
    pub via_hub: bool,
}

impl From<Kandidat> for TrackingCandidate {
    fn from(k: Kandidat) -> Self {
        Self {
            access_id: k.zugang_id,
            access_name: k.zugang_name,
            device_id: k.kennung,
            received_at: k.empfangen_at,
            coupled: k.gekoppelt,
            via_hub: false,
        }
    }
}

/// Antwort der Kandidatenliste: die Kennungen und ob der Org-Schalter „Ortung im Einsatz“
/// (ADR-0101) an ist. Der Dialog liest so den Schalter, ohne die Org-Einstellungen lesen zu
/// dürfen, und erklärt, warum Koppeln gesperrt ist.
#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct TrackingCandidates {
    /// Org-Schalter „Ortung im Einsatz“; aus = Koppeln antwortet 422, nichts wird übernommen.
    pub tracking_enabled: bool,
    pub candidates: Vec<TrackingCandidate>,
    /// Die Liste des Hubs ist angefragt, aber noch nicht (frisch) da; der Dialog fragt erneut.
    pub pending: bool,
}

/// Body von `PUT …/tracking`.
#[derive(Debug, Deserialize)]
pub struct TrackingRequest {
    pub access_id: String,
    pub device_id: String,
}

/// GET /api/incidents/{id}/vehicles/{ef_id}/tracking — die Kopplung des Fahrzeugs oder 404.
pub async fn load(
    State(state): State<AppState>,
    ctx: EinsatzSchreibzugriff<Fahrzeuge>,
    PfadParam((_eid, ef_id)): PfadParam<(i64, i64)>,
) -> Result<Json<TrackingResponse>, AppError> {
    let mut conn = state.pool.acquire().await?;
    let k = kopplung::load_kopplung_tx(&mut conn, ctx.einsatz.id, ef_id)
        .await?
        .ok_or(AppError::NotFound)?;
    Ok(Json(k.into()))
}

/// So alt darf die Kandidatenliste des Hubs sein, bevor die Oberfläche „wird geladen“ zeigt und
/// eine frische angefragt wird.
const PUFFER_FRISCH: Duration = Duration::from_secs(10);
/// Ältere Listen gelten als fehlend (der Wunsch läuft nach 60 s ab).
const PUFFER_VERFALL: Duration = Duration::from_secs(60);

/// Die Liste des Hubs aus dem Puffer, wenn sie noch nicht verfallen ist, mit ihrem Alter.
fn puffer_liste(
    pool: &sqlx::SqlitePool,
    instanz_kopplung_id: i64,
    org_id: i64,
) -> Option<(Duration, RemoteTrackingCandidates)> {
    fern::cached_candidates(pool, instanz_kopplung_id, org_id)
        .map(|(t, k)| (t.elapsed(), k))
        .filter(|(alter, _)| *alter <= PUFFER_VERFALL)
}

/// GET /api/incidents/{id}/vehicles/{ef_id}/tracking/candidates — Kennungen der letzten 24 h.
/// Meldet sich die Org bei einem Hub, kommen die Kennungen vom Hub (Puffer, `pending` bis die
/// Liste frisch ist); sonst aus der eigenen Ablage.
pub async fn candidates(
    State(state): State<AppState>,
    ctx: EinsatzSchreibzugriff<Fahrzeuge>,
    PfadParam((_eid, _ef_id)): PfadParam<(i64, i64)>,
) -> Result<Json<TrackingCandidates>, AppError> {
    let org_id = ctx.einsatz.org_id;
    let freigabe = crate::org::einstellungen::ortung_der_org(&state.pool, org_id).await?;
    let hub = {
        let mut conn = state.pool.acquire().await?;
        zugang::hub_kopplung_fuer_org(&mut conn, org_id).await?
    };
    let Some((instanz_kopplung_id, _)) = hub else {
        let liste = kopplung::list_kandidaten(&state.pool, org_id, &crate::zeit::jetzt()).await?;
        return Ok(Json(TrackingCandidates {
            tracking_enabled: freigabe.im_einsatz,
            candidates: liste.into_iter().map(Into::into).collect(),
            pending: false,
        }));
    };
    let liste = puffer_liste(&state.pool, instanz_kopplung_id, org_id);
    let frisch = liste
        .as_ref()
        .is_some_and(|(alter, _)| *alter <= PUFFER_FRISCH);
    if !frisch {
        fern::wish_candidates(&state.pool, instanz_kopplung_id, org_id);
        crate::instanz::spiegel::takt::wecken();
    }
    let gekoppelt: Vec<(String, String)> = sqlx::query_as(
        "SELECT fremder_zugang_id, kennung FROM ortung_kopplung \
         WHERE instanz_kopplung_id = ? AND org_id = ?",
    )
    .bind(instanz_kopplung_id)
    .bind(org_id)
    .fetch_all(&state.pool)
    .await?;
    let (hub_an, items) = match liste {
        Some((_, k)) => (k.tracking_enabled, k.items),
        None => (true, Vec::new()),
    };
    let candidates = items
        .into_iter()
        .map(|i| TrackingCandidate {
            coupled: gekoppelt.contains(&(i.access_id.clone(), i.device_id.clone())),
            access_id: i.access_id,
            access_name: i.access_name,
            device_id: i.device_id,
            received_at: i.received_at,
            via_hub: true,
        })
        .collect();
    Ok(Json(TrackingCandidates {
        tracking_enabled: hub_an && freigabe.im_einsatz,
        candidates,
        pending: !frisch,
    }))
}

/// PUT /api/incidents/{id}/vehicles/{ef_id}/tracking — Fahrzeug an eine Kennung koppeln, die
/// vorhandene Position übernehmen, ETB-Eintrag. Ein erneutes PUT ersetzt die Kopplung. Mit
/// ausgeschaltetem Org-Schalter „Ortung im Einsatz“ 422.
pub async fn couple(
    State(state): State<AppState>,
    ctx: EinsatzSchreibzugriff<Fahrzeuge>,
    PfadParam((_eid, ef_id)): PfadParam<(i64, i64)>,
    JsonBody(body): JsonBody<TrackingRequest>,
) -> Result<Json<EinsatzFahrzeugAnzeige>, AppError> {
    let einsatz_id = ctx.einsatz.id;
    if body.device_id.is_empty() || body.device_id.chars().count() > POSITION_KENNUNG_MAX {
        return Err(AppError::Validation(format!(
            "device_id: 1 bis {POSITION_KENNUNG_MAX} Zeichen"
        )));
    }
    let hub = {
        let mut conn = state.pool.acquire().await?;
        zugang::hub_kopplung_fuer_org(&mut conn, ctx.einsatz.org_id).await?
    };
    // Über den Hub: die Kennung muss in der Liste des Hubs stehen; der Zugangsname kommt von dort.
    let hub_ziel = match hub {
        Some((instanz_kopplung_id, _)) => {
            let item = puffer_liste(&state.pool, instanz_kopplung_id, ctx.einsatz.org_id)
                .and_then(|(_, k)| {
                    k.items
                        .into_iter()
                        .find(|i| i.access_id == body.access_id && i.device_id == body.device_id)
                })
                .ok_or_else(|| {
                    AppError::UnprocessableEntity("Kennung nicht mehr verfügbar".into())
                })?;
            Some((instanz_kopplung_id, item.access_name))
        }
        None => None,
    };
    let startwert = etb_startwert(&state.pool, einsatz_id).await?;
    let jetzt = crate::zeit::jetzt();
    let (anzeige, etb_id) = crate::write_retry!(&state.pool, |conn| {
        let k = match &hub_ziel {
            Some((instanz_kopplung_id, name)) => {
                // Die Position kommt mit dem nächsten Abgleich vom Hub.
                kopplung::create_hub_kopplung_tx(
                    conn,
                    einsatz_id,
                    ef_id,
                    *instanz_kopplung_id,
                    &body.access_id,
                    name,
                    &body.device_id,
                    ctx.benutzer.id,
                    &jetzt,
                )
                .await?
            }
            None => {
                let k = kopplung::create_kopplung_tx(
                    conn,
                    einsatz_id,
                    ef_id,
                    &body.access_id,
                    &body.device_id,
                    ctx.benutzer.id,
                    &jetzt,
                )
                .await?;
                // Die vorhandene Position der Kennung gleich übernehmen; ein gedrosseltes
                // Ergebnis holt der nächste Fix nach.
                apply_position_tx(conn, k.access_id(), &k.kennung, &jetzt).await?;
                k
            }
        };
        let anzeige = disposition_repo::load_anzeige_tx(conn, einsatz_id, ef_id, true).await?;
        let text =
            crate::fahrzeug::etb_text_gekoppelt(&anzeige.funkrufname, &k.zugang_name, &k.kennung);
        let etb_id =
            crate::etb::system_audit_tx(conn, einsatz_id, ctx.benutzer.id, startwert, &text)
                .await?;
        Ok((anzeige, etb_id))
    })?;
    if hub_ziel.is_some() {
        crate::instanz::spiegel::takt::wecken();
    }
    state.live.publiziere(einsatz_id, etb_id);
    sse_fahrzeug(&state, einsatz_id, ef_id);
    Ok(Json(anzeige))
}

/// DELETE /api/incidents/{id}/vehicles/{ef_id}/tracking — Kopplung lösen, ETB-Eintrag. Die
/// Position bleibt als letzter Stand stehen. Ohne Kopplung 404.
pub async fn decouple(
    State(state): State<AppState>,
    ctx: EinsatzSchreibzugriff<Fahrzeuge>,
    PfadParam((_eid, ef_id)): PfadParam<(i64, i64)>,
) -> Result<StatusCode, AppError> {
    let einsatz_id = ctx.einsatz.id;
    let startwert = etb_startwert(&state.pool, einsatz_id).await?;
    let etb_id = crate::write_retry!(&state.pool, |conn| {
        kopplung::delete_kopplung_tx(conn, einsatz_id, ef_id)
            .await?
            .ok_or(AppError::NotFound)?;
        let anzeige = disposition_repo::load_anzeige_tx(conn, einsatz_id, ef_id, true).await?;
        crate::etb::system_audit_tx(
            conn,
            einsatz_id,
            ctx.benutzer.id,
            startwert,
            &crate::fahrzeug::etb_text_getrennt(&anzeige.funkrufname),
        )
        .await
    })?;
    state.live.publiziere(einsatz_id, etb_id);
    sse_fahrzeug(&state, einsatz_id, ef_id);
    Ok(StatusCode::NO_CONTENT)
}
