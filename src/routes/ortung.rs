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
use crate::ortung::kopplung::{self, Kandidat, Kopplung};
use crate::ortung::uebernahme::apply_position_tx;
use crate::public_api::einwurf::ablage::POSITION_KENNUNG_MAX;
use axum::extract::State;
use axum::http::StatusCode;
use axum::Json;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

/// Wert von `grund` im 422, wenn die Besatzung ehrenamtlich bestätigt werden muss.
pub const GRUND_EHRENAMT_ERFORDERLICH: &str = "volunteer_crew_required";

/// Die Kopplung eines Fahrzeugs an eine Ortungs-Kennung.
#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct TrackingResponse {
    pub access_id: String,
    pub access_name: String,
    pub device_id: String,
    pub coupled_at: String,
    pub volunteer_crew_confirmed: bool,
}

impl From<Kopplung> for TrackingResponse {
    fn from(k: Kopplung) -> Self {
        Self {
            access_id: k.zugang_id,
            access_name: k.zugang_name,
            device_id: k.kennung,
            coupled_at: k.gekoppelt_at,
            volunteer_crew_confirmed: k.ehrenamt_bestaetigt,
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
}

impl From<Kandidat> for TrackingCandidate {
    fn from(k: Kandidat) -> Self {
        Self {
            access_id: k.zugang_id,
            access_name: k.zugang_name,
            device_id: k.kennung,
            received_at: k.empfangen_at,
            coupled: k.gekoppelt,
        }
    }
}

/// Body von `PUT …/tracking`.
#[derive(Debug, Deserialize)]
pub struct TrackingRequest {
    pub access_id: String,
    pub device_id: String,
    #[serde(default)]
    pub volunteer_crew_confirmed: bool,
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

/// GET /api/incidents/{id}/vehicles/{ef_id}/tracking/candidates — Kennungen der letzten 24 h.
pub async fn candidates(
    State(state): State<AppState>,
    ctx: EinsatzSchreibzugriff<Fahrzeuge>,
    PfadParam((_eid, _ef_id)): PfadParam<(i64, i64)>,
) -> Result<Json<Vec<TrackingCandidate>>, AppError> {
    let liste =
        kopplung::list_kandidaten(&state.pool, ctx.einsatz.org_id, &crate::zeit::jetzt()).await?;
    Ok(Json(liste.into_iter().map(Into::into).collect()))
}

/// PUT /api/incidents/{id}/vehicles/{ef_id}/tracking — Fahrzeug an eine Kennung koppeln, die
/// vorhandene Position übernehmen, ETB-Eintrag. Ein erneutes PUT ersetzt die Kopplung.
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
    let einstellungen =
        crate::org::einstellungen::laden_oder_default(&state.pool, ctx.einsatz.org_id).await?;
    if !kopplung::is_ehrenamt_ok(
        einstellungen.is_ortung_hauptamt(),
        body.volunteer_crew_confirmed,
    ) {
        return Err(AppError::UnprocessableGrund {
            meldung: "Die ehrenamtliche Besatzung muss bestätigt werden".into(),
            grund: GRUND_EHRENAMT_ERFORDERLICH,
        });
    }
    let startwert = etb_startwert(&state.pool, einsatz_id).await?;
    let jetzt = crate::zeit::jetzt();
    let (anzeige, etb_id) = crate::write_retry!(&state.pool, |conn| {
        let k = kopplung::create_kopplung_tx(
            conn,
            einsatz_id,
            ef_id,
            &body.access_id,
            &body.device_id,
            body.volunteer_crew_confirmed,
            ctx.benutzer.id,
            &jetzt,
        )
        .await?;
        // Die vorhandene Position der Kennung gleich übernehmen; ein gedrosseltes Ergebnis
        // holt der nächste Fix nach.
        apply_position_tx(conn, &k.zugang_id, &k.kennung, &jetzt).await?;
        let anzeige = disposition_repo::load_anzeige_tx(conn, einsatz_id, ef_id, true).await?;
        let text = crate::fahrzeug::etb_text_gekoppelt(
            &anzeige.funkrufname,
            &k.zugang_name,
            &k.kennung,
            k.ehrenamt_bestaetigt,
        );
        let etb_id =
            crate::etb::system_audit_tx(conn, einsatz_id, ctx.benutzer.id, startwert, &text)
                .await?;
        Ok((anzeige, etb_id))
    })?;
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
