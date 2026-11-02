//! Richtwerte des Unterkunfts- und Zeltrechners (LLH-1520, design.md D2).
//!
//! GET /api/unterkunft-richtwerte — Basis und Org-Werte der eigenen Org, jeder Angemeldete.
//! PUT /api/org-unterkunft-richtwerte/{schluessel} — Org-Wert setzen, `null` = Vorgabe, nur Admin.
//!     Live über `stammdaten` (Präfix in `STAMMDATEN_PFADE`).
//! GET /api/einsaetze/{id}/unterkunft-richtwerte — alle Ebenen im Einsatz, Lesezugriff.
//! PUT /api/einsaetze/{id}/unterkunft-richtwerte/{schluessel} — Einsatz-Wert setzen, `null` =
//!     erbt, Verwaltungszugriff (wie die übrigen Einsatz-Einstellungen).
//!
//! `org_id` stammt stets aus dem Benutzer bzw. dem Einsatz, nie aus dem Body (Org-Isolation).

use axum::extract::State;
use axum::Json;
use serde::Deserialize;

use crate::app::AppState;
use crate::auth::session::{AdminUser, CurrentUser};
use crate::einsatz::kontext::{EinsatzLesezugriff, EinsatzVerwaltungszugriff};
use crate::error::AppError;
use crate::extract::{JsonBody, PfadParam};
use crate::unterkunft::{self, repo, UnterkunftRichtwerte};

/// Body der beiden PUT-Routen.
#[derive(Debug, Deserialize)]
pub struct RichtwertSetzen {
    /// Neuer Wert; `null` oder fehlend = zurück zur Vorgabe der Ebene darunter.
    #[serde(default)]
    pub wert: Option<f64>,
}

fn pruefe(schluessel: &str, wert: Option<f64>) -> Result<(), AppError> {
    match wert {
        Some(w) => unterkunft::pruefe(schluessel, w),
        None => unterkunft::pruefe_schluessel(schluessel),
    }
}

/// GET /api/unterkunft-richtwerte
pub async fn org_lesen(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
) -> Result<Json<UnterkunftRichtwerte>, AppError> {
    let mut conn = state.pool.acquire().await?;
    let org = repo::org_werte(&mut conn, benutzer.org_id).await?;
    Ok(Json(unterkunft::zusammenfuehren(&org, None)))
}

/// PUT /api/org-unterkunft-richtwerte/{schluessel} — liefert die neuen Werte der Org.
pub async fn org_setzen(
    State(state): State<AppState>,
    AdminUser(benutzer): AdminUser,
    PfadParam(schluessel): PfadParam<String>,
    JsonBody(req): JsonBody<RichtwertSetzen>,
) -> Result<Json<UnterkunftRichtwerte>, AppError> {
    pruefe(&schluessel, req.wert)?;
    let mut conn = state.pool.acquire().await?;
    repo::org_setzen(
        &mut conn,
        benutzer.org_id,
        &schluessel,
        req.wert,
        benutzer.id,
    )
    .await?;
    let org = repo::org_werte(&mut conn, benutzer.org_id).await?;
    Ok(Json(unterkunft::zusammenfuehren(&org, None)))
}

/// GET /api/einsaetze/{id}/unterkunft-richtwerte
pub async fn einsatz_lesen(
    State(state): State<AppState>,
    ctx: EinsatzLesezugriff,
) -> Result<Json<UnterkunftRichtwerte>, AppError> {
    let mut conn = state.pool.acquire().await?;
    Ok(Json(
        einsatz_stand(&mut conn, ctx.einsatz.org_id, ctx.einsatz.id).await?,
    ))
}

/// PUT /api/einsaetze/{id}/unterkunft-richtwerte/{schluessel} — liefert alle Ebenen im Einsatz.
pub async fn einsatz_setzen(
    State(state): State<AppState>,
    ctx: EinsatzVerwaltungszugriff,
    PfadParam((_eid, schluessel)): PfadParam<(i64, String)>,
    JsonBody(req): JsonBody<RichtwertSetzen>,
) -> Result<Json<UnterkunftRichtwerte>, AppError> {
    pruefe(&schluessel, req.wert)?;
    let mut conn = state.pool.acquire().await?;
    repo::einsatz_setzen(
        &mut conn,
        ctx.einsatz.id,
        &schluessel,
        req.wert,
        ctx.benutzer.id,
    )
    .await?;
    Ok(Json(
        einsatz_stand(&mut conn, ctx.einsatz.org_id, ctx.einsatz.id).await?,
    ))
}

async fn einsatz_stand(
    conn: &mut sqlx::SqliteConnection,
    org_id: i64,
    einsatz_id: i64,
) -> Result<UnterkunftRichtwerte, AppError> {
    let org = repo::org_werte(conn, org_id).await?;
    let einsatz = repo::einsatz_werte(conn, einsatz_id).await?;
    Ok(unterkunft::zusammenfuehren(&org, Some(&einsatz)))
}
