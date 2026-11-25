//! Helfer-App (Spec `docs/superpowers/specs/2026-11-24-vakwvkpg-helfer-app-design.md`, ADR-0098):
//! Routen der Leitung am Einsatz unter `/api/incidents/{id}/helpers…`.
//!
//! Recht wie beim Koppeln: [`EinsatzLeitungszugriff`] (Einsatzleitung, nur aktiver Einsatz). Der
//! Pfadparameter heißt `{id}`, weil `EinsatzKontext` den Einsatz unter diesem Namen liest.

use crate::app::AppState;
use crate::einsatz::kontext::EinsatzLeitungszugriff;
use crate::error::AppError;
use crate::extract::{JsonBody, PfadParam};
use crate::helfer::einladung::{self, HelferEinladungAnzeige};
use crate::helfer::{self, HelferAnzeige};
use axum::extract::State;
use axum::http::StatusCode;
use axum::Json;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

/// Helfer-Übersicht der Leitung: die gültige Einladung (ohne Code) und alle Helfer-Kopplungen.
#[derive(Debug, Serialize, ToSchema)]
pub struct HelferUebersicht {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub invitation: Option<HelferEinladungAnzeige>,
    pub helpers: Vec<HelferAnzeige>,
}

#[derive(Debug, Deserialize)]
pub struct NeueEinladungBody {
    /// Gültigkeit in Minuten; Vorgabe [`einladung::VORGABE_MINUTEN`].
    pub valid_minutes: Option<i64>,
}

/// Prüft „Ortung im Einsatz“ der Organisation (403, wenn aus).
async fn fordere_ortung(state: &AppState, org_id: i64) -> Result<(), AppError> {
    if crate::org::einstellungen::ortung_der_org(&state.pool, org_id)
        .await?
        .im_einsatz
    {
        Ok(())
    } else {
        Err(AppError::Forbidden)
    }
}

/// GET /api/incidents/{id}/helpers — gültige Einladung und Helfer des Einsatzes.
pub async fn uebersicht(
    State(state): State<AppState>,
    ctx: EinsatzLeitungszugriff,
) -> Result<Json<HelferUebersicht>, AppError> {
    let einsatz_id = ctx.einsatz.id;
    Ok(Json(HelferUebersicht {
        invitation: einladung::gueltige(&state.pool, einsatz_id).await?,
        helpers: helfer::liste(&state.pool, einsatz_id).await?,
    }))
}

/// POST /api/incidents/{id}/helpers/invitations — neue Einladung; ersetzt eine gültige alte.
/// 403, wenn die Ortung der Organisation aus ist; 422 bei einer Gültigkeit über 72 h.
pub async fn einladung_anlegen(
    State(state): State<AppState>,
    ctx: EinsatzLeitungszugriff,
    JsonBody(body): JsonBody<NeueEinladungBody>,
) -> Result<(StatusCode, Json<HelferEinladungAnzeige>), AppError> {
    fordere_ortung(&state, ctx.einsatz.org_id).await?;
    let minuten = einladung::pruefe_minuten(body.valid_minutes)?;
    let einsatz_id = ctx.einsatz.id;
    let von = ctx.benutzer.id;
    let anzeige = crate::write_retry!(&state.pool, |conn| {
        einladung::anlegen(conn, einsatz_id, minuten, von).await
    })?;
    Ok((StatusCode::CREATED, Json(anzeige)))
}

/// POST /api/incidents/{id}/helpers/invitations/{einladung_id}/revoke — Einladung widerrufen.
/// Angemeldete Helfer betrifft das nicht. Idempotent; fremde Einladung 404.
pub async fn einladung_widerrufen(
    State(state): State<AppState>,
    ctx: EinsatzLeitungszugriff,
    PfadParam((_eid, einladung_id)): PfadParam<(i64, i64)>,
) -> Result<StatusCode, AppError> {
    let einsatz_id = ctx.einsatz.id;
    crate::write_retry!(&state.pool, |conn| {
        einladung::widerrufen(conn, einsatz_id, einladung_id).await
    })?;
    Ok(StatusCode::NO_CONTENT)
}
