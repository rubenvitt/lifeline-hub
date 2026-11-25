//! Drohnenquellen je Einsatz (LLH-2105): auflisten, zuschalten, abschalten unter
//! `/api/incidents/{id}/drone/sources`. Die Zuschaltung steht in `adapter_einsatz`; der Store
//! (`AppState.drohne`) bekommt sie erst nach dem Commit (die Datenbank ist maßgeblich). Ein
//! Adapter ist in höchstens einem laufenden Einsatz zugeschaltet.

use axum::extract::State;
use axum::http::StatusCode;
use axum::Json;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use crate::adapter::repo as adapter_repo;
use crate::app::AppState;
use crate::drohne::is_drohnen_art;
use crate::drohne::repo::{self, Zuschaltung};
use crate::einsatz::einstellungen;
use crate::einsatz::kontext::{EinsatzLeitungszugriff, EinsatzLesezugriff};
use crate::einsatz::modul::Lagekarte;
use crate::error::AppError;
use crate::extract::{JsonBody, PfadParam};
use crate::zeit::jetzt;

/// Name des anderen Einsatzes, wenn die Person ihn nicht lesen darf.
const ANDERER_EINSATZ: &str = "anderer Einsatz";

/// Eine Drohnenquelle der Organisation, gesehen aus einem Einsatz.
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct DroneSourceView {
    pub adapter_id: String,
    pub label: String,
    /// In diesem Einsatz zugeschaltet.
    pub connected: bool,
    /// Name des anderen laufenden Einsatzes, der die Quelle hält (`anderer Einsatz`, wenn die
    /// Person ihn nicht lesen darf).
    pub held_by_other: Option<String>,
    /// Das Livebild geht auch an den Lagemonitor.
    pub lagemonitor: bool,
    /// Zustand des Adapters (`aktiv`, `angehalten`, …).
    pub state: String,
    pub mission_name: Option<String>,
    pub video_keys: Vec<String>,
}

#[derive(Debug, Clone, Deserialize, ToSchema)]
pub struct DroneSourceUpdate {
    pub lagemonitor: bool,
}

/// Der andere laufende Einsatz, der den Adapter hält, mit dem Namen für diese Person.
async fn halter_name(state: &AppState, benutzer_id: i64, halter: i64) -> Result<String, AppError> {
    let name: Option<String> = sqlx::query_scalar("SELECT bezeichnung FROM einsatz WHERE id = ?")
        .bind(halter)
        .fetch_optional(&state.pool)
        .await?;
    let darf = crate::einsatz::repo::rolle_von(&state.pool, halter, benutzer_id)
        .await?
        .is_some();
    Ok(match name {
        Some(n) if darf => n,
        _ => ANDERER_EINSATZ.to_string(),
    })
}

async fn sicht(
    state: &AppState,
    benutzer_id: i64,
    einsatz_id: i64,
    a: &adapter_repo::Adapter,
    zuschaltung: Option<&Zuschaltung>,
) -> Result<DroneSourceView, AppError> {
    let connected = zuschaltung.is_some();
    let held_by_other = if connected {
        None
    } else {
        let mut conn = state.pool.acquire().await?;
        match repo::find_active_holder(&mut conn, &a.id).await? {
            Some(h) if h != einsatz_id => {
                drop(conn);
                Some(halter_name(state, benutzer_id, h).await?)
            }
            _ => None,
        }
    };
    let stand = if connected {
        state.drohne.get(&a.id)
    } else {
        None
    };
    Ok(DroneSourceView {
        adapter_id: a.id.clone(),
        label: a.name.clone(),
        connected,
        held_by_other,
        lagemonitor: zuschaltung.is_some_and(|z| z.lagemonitor),
        state: a.zustand.clone(),
        mission_name: stand.as_ref().and_then(|s| s.lage.mission_name.clone()),
        video_keys: stand
            .map(|s| s.lage.videos.iter().map(|v| v.key.clone()).collect())
            .unwrap_or_default(),
    })
}

/// GET /api/incidents/{id}/drone/sources — die Drohnenquellen der Organisation.
pub async fn liste(
    State(state): State<AppState>,
    ctx: EinsatzLesezugriff<Lagekarte>,
) -> Result<Json<Vec<DroneSourceView>>, AppError> {
    let einsatz_id = ctx.einsatz.id;
    let (adapter, zuschaltungen) = {
        let mut conn = state.pool.acquire().await?;
        (
            adapter_repo::list_in_org(&mut conn, ctx.einsatz.org_id).await?,
            repo::load_for_einsatz(&mut conn, einsatz_id).await?,
        )
    };
    let mut aus = Vec::new();
    for a in adapter.iter().filter(|a| is_drohnen_art(&a.art)) {
        let z = zuschaltungen.iter().find(|z| z.adapter_id == a.id);
        aus.push(sicht(&state, ctx.benutzer.id, einsatz_id, a, z).await?);
    }
    Ok(Json(aus))
}

/// PUT /api/incidents/{id}/drone/sources/{aid} — zuschalten (oder die Lagemonitor-Wahl ändern).
pub async fn zuschalten(
    State(state): State<AppState>,
    ctx: EinsatzLeitungszugriff<Lagekarte>,
    PfadParam((_eid, adapter_id)): PfadParam<(i64, String)>,
    JsonBody(body): JsonBody<DroneSourceUpdate>,
) -> Result<Json<DroneSourceView>, AppError> {
    let einsatz_id = ctx.einsatz.id;
    let org_id = ctx.einsatz.org_id;
    let erfasser = ctx.benutzer.id;
    let startwert = einstellungen::etb_startwert(&state.pool, einsatz_id).await?;
    let now = jetzt();

    let (adapter, zuschaltung, etb_id) = crate::write_retry!(&state.pool, |conn| {
        let adapter = adapter_repo::load_in_org(conn, org_id, &adapter_id)
            .await?
            .ok_or(AppError::NotFound)?;
        if !is_drohnen_art(&adapter.art) {
            return Err(AppError::UnprocessableEntity(
                "Diese Quelle liefert kein Drohnenbild".into(),
            ));
        }
        // Prüfung und Schreiben in einer Transaktion: zwei gleichzeitige Zuschaltungen sehen
        // sich nicht vorbei (BEGIN IMMEDIATE).
        if let Some(halter) = repo::find_active_holder(conn, &adapter.id).await? {
            if halter != einsatz_id {
                return Err(AppError::Conflict(
                    "Die Drohnenquelle ist in einem anderen laufenden Einsatz zugeschaltet".into(),
                ));
            }
        }
        let vorher = repo::load_for_einsatz(conn, einsatz_id)
            .await?
            .into_iter()
            .find(|z| z.adapter_id == adapter.id);
        let z = Zuschaltung {
            adapter_id: adapter.id.clone(),
            einsatz_id,
            zugeschaltet_at: now.clone(),
            lagemonitor: body.lagemonitor,
        };
        repo::upsert(conn, &z).await?;
        let etb_id = if vorher.is_none() {
            Some(
                crate::etb::system_audit_tx(
                    conn,
                    einsatz_id,
                    erfasser,
                    startwert,
                    "Drohnenbild aus Suchlage zugeschaltet",
                )
                .await?,
            )
        } else {
            None
        };
        let z = vorher.map_or(z, |v| Zuschaltung {
            lagemonitor: body.lagemonitor,
            ..v
        });
        Ok((adapter, z, etb_id))
    })?;

    // Erst nach dem Commit: der Store ist nur das Abbild der Datenbank.
    state.drohne.set_zugeschaltet(&adapter.id, true);
    if let Some(id) = etb_id {
        state.live.publiziere(einsatz_id, id);
    }
    Ok(Json(
        sicht(&state, erfasser, einsatz_id, &adapter, Some(&zuschaltung)).await?,
    ))
}

/// DELETE /api/incidents/{id}/drone/sources/{aid} — abschalten.
pub async fn abschalten(
    State(state): State<AppState>,
    ctx: EinsatzLeitungszugriff<Lagekarte>,
    PfadParam((_eid, adapter_id)): PfadParam<(i64, String)>,
) -> Result<StatusCode, AppError> {
    let einsatz_id = ctx.einsatz.id;
    let org_id = ctx.einsatz.org_id;
    let erfasser = ctx.benutzer.id;
    let startwert = einstellungen::etb_startwert(&state.pool, einsatz_id).await?;

    let (etb_id, noch_gehalten) = crate::write_retry!(&state.pool, |conn| {
        let adapter = adapter_repo::load_in_org(conn, org_id, &adapter_id)
            .await?
            .ok_or(AppError::NotFound)?;
        let war = repo::delete(conn, &adapter.id, einsatz_id).await?;
        let etb_id = if war {
            Some(
                crate::etb::system_audit_tx(
                    conn,
                    einsatz_id,
                    erfasser,
                    startwert,
                    "Drohnenbild aus Suchlage abgeschaltet",
                )
                .await?,
            )
        } else {
            None
        };
        // Hält ein anderer laufender Einsatz die Quelle (etwa ein früher abgeschlossener
        // Einsatz hielt sie nicht), bleibt sie im Store an.
        let noch = repo::is_active(conn, &adapter.id).await?;
        Ok((etb_id, noch))
    })?;

    state.drohne.set_zugeschaltet(&adapter_id, noch_gehalten);
    if let Some(id) = etb_id {
        state.live.publiziere(einsatz_id, id);
    }
    Ok(StatusCode::NO_CONTENT)
}
