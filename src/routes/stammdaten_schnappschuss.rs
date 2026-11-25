//! Schnappschüsse des Stammdaten-Abrufs prüfen und übernehmen (LLH-1194).
//!
//! Ein Adapter „Stammdaten-Abruf“ legt abgeholte Daten als Schnappschuss ab; hier sieht ein Admin
//! die offenen, rechnet die Vorschau des Stammdaten-Eingangs (LLH-1633) auf genau diesem Stand und
//! übernimmt. Rechte wie beim Anlegen von Personal (`AdminUser`). Meldet sich die Org bei einem Hub,
//! werden Stammdaten dort gepflegt: 409.

use axum::extract::State;
use axum::http::StatusCode;
use axum::Json;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use crate::app::AppState;
use crate::auth::session::AdminUser;
use crate::error::AppError;
use crate::extract::{JsonBody, PfadParam};
use crate::public_api::zugang::hub_fuer_org;
use crate::stammdaten_eingang::repo::{Entscheidungen, StammdatenErgebnis, StammdatenVorschau};
use crate::stammdaten_eingang::schnappschuss::{self, SchnappschussInfo};

/// Körper von Vorschau und Übernehmen: die Entscheidungen der Vorschau.
#[derive(Debug, Default, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct SchnappschussEntscheidungen {
    #[serde(default)]
    pub entscheidungen: Entscheidungen,
}

/// Antwort der Liste: die offenen Schnappschüsse der Org.
#[derive(Debug, Serialize, ToSchema)]
pub struct SchnappschussListe {
    pub schnappschuesse: Vec<SchnappschussInfo>,
}

async fn nicht_am_elw(state: &AppState, org_id: i64) -> Result<(), AppError> {
    let mut conn = state.pool.acquire().await?;
    if hub_fuer_org(&mut conn, org_id).await?.is_some() {
        return Err(AppError::Conflict(
            "Diese Instanz meldet sich bei einem Hub; Stammdaten werden dort gepflegt.".into(),
        ));
    }
    Ok(())
}

/// GET /api/master-data/import/snapshots
pub async fn list(
    State(state): State<AppState>,
    AdminUser(admin): AdminUser,
) -> Result<Json<SchnappschussListe>, AppError> {
    Ok(Json(SchnappschussListe {
        schnappschuesse: schnappschuss::liste_offen(&state.pool, admin.org_id).await?,
    }))
}

/// POST /api/master-data/import/snapshots/{id}/preview — schreibt nichts.
pub async fn preview(
    State(state): State<AppState>,
    AdminUser(admin): AdminUser,
    PfadParam(id): PfadParam<String>,
    JsonBody(body): JsonBody<SchnappschussEntscheidungen>,
) -> Result<Json<StammdatenVorschau>, AppError> {
    nicht_am_elw(&state, admin.org_id).await?;
    Ok(Json(
        schnappschuss::vorschau(&state.pool, admin.org_id, &id, &body.entscheidungen).await?,
    ))
}

/// POST /api/master-data/import/snapshots/{id} — übernimmt in einer Transaktion; 409, wenn der
/// Schnappschuss inzwischen ersetzt oder übernommen ist; 422, solange Entscheidungen fehlen.
pub async fn apply(
    State(state): State<AppState>,
    AdminUser(admin): AdminUser,
    PfadParam(id): PfadParam<String>,
    JsonBody(body): JsonBody<SchnappschussEntscheidungen>,
) -> Result<Json<StammdatenErgebnis>, AppError> {
    nicht_am_elw(&state, admin.org_id).await?;
    let (ergebnis, fahrzeug_ids) = schnappschuss::uebernehmen(
        &state.pool,
        admin.org_id,
        &id,
        admin.id,
        &body.entscheidungen,
    )
    .await?;
    // Wie der Dateiweg (`routes::stammdaten_eingang`): disponierte Fahrzeuge erfahren die Änderung.
    for fz in fahrzeug_ids {
        super::fahrzeug::stamm_geaendert_melden(&state, admin.org_id, fz).await;
    }
    Ok(Json(ergebnis))
}

/// POST /api/admin/adapter/{id}/resubmit — „Erneut vorlegen“: der nächste Lauf legt in jedem Fall
/// einen Schnappschuss an.
pub async fn resubmit(
    State(state): State<AppState>,
    AdminUser(admin): AdminUser,
    PfadParam(id): PfadParam<String>,
) -> Result<StatusCode, AppError> {
    schnappschuss::erneut_vorlegen(&state.pool, admin.org_id, &id).await?;
    Ok(StatusCode::NO_CONTENT)
}
