use crate::app::AppState;
use crate::auth::session::{AdminUser, CurrentUser};
use crate::error::AppError;
use crate::fahrzeug::status_repo::{self, StatusDaten};
use crate::fahrzeug::{FahrzeugStatus, StatusKategorie};
use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::Json;
use serde::Deserialize;

#[derive(Debug, Deserialize)]
pub struct StatusBody {
    pub label: String,
    pub kategorie: String,
    pub farbe: Option<String>,
    pub fms_anker: Option<i64>,
    #[serde(default)]
    pub sortier: i64,
}

fn trimme(s: Option<String>) -> Option<String> {
    s.map(|s| s.trim().to_string()).filter(|s| !s.is_empty())
}

struct Normalisiert {
    label: String,
    kategorie: String,
    farbe: Option<String>,
    fms_anker: Option<i64>,
    sortier: i64,
}

impl Normalisiert {
    fn daten(&self) -> StatusDaten<'_> {
        StatusDaten {
            label: &self.label,
            kategorie: &self.kategorie,
            farbe: self.farbe.as_deref(),
            fms_anker: self.fms_anker,
            sortier: self.sortier,
        }
    }
}

fn normalisiere(body: StatusBody) -> Result<Normalisiert, AppError> {
    let label = body.label.trim().to_string();
    if label.is_empty() {
        return Err(AppError::Validation("Label darf nicht leer sein".into()));
    }
    if StatusKategorie::parse(&body.kategorie).is_none() {
        return Err(AppError::Validation("Ungültige Kategorie".into()));
    }
    if let Some(f) = body.fms_anker {
        if !(0..=9).contains(&f) {
            return Err(AppError::Validation("FMS-Anker muss zwischen 0 und 9 liegen".into()));
        }
    }
    Ok(Normalisiert {
        label,
        kategorie: body.kategorie,
        farbe: trimme(body.farbe),
        fms_anker: body.fms_anker,
        sortier: body.sortier,
    })
}

/// GET /api/fahrzeug-status — aktive Katalog-Einträge (eigene Org), für Dropdowns.
pub async fn liste(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
) -> Result<Json<Vec<FahrzeugStatus>>, AppError> {
    Ok(Json(status_repo::liste(&state.pool, benutzer.org_id).await?))
}

/// POST /api/fahrzeug-status — Admin. Dublette label → Conflict.
pub async fn anlegen(
    State(state): State<AppState>,
    AdminUser(benutzer): AdminUser,
    Json(body): Json<StatusBody>,
) -> Result<(StatusCode, Json<FahrzeugStatus>), AppError> {
    let n = normalisiere(body)?;
    let s = status_repo::anlegen(&state.pool, benutzer.org_id, n.daten()).await?;
    Ok((StatusCode::CREATED, Json(s)))
}

/// PATCH /api/fahrzeug-status/{id} — Admin, Vollersatz.
pub async fn aktualisieren(
    State(state): State<AppState>,
    AdminUser(benutzer): AdminUser,
    Path(id): Path<i64>,
    Json(body): Json<StatusBody>,
) -> Result<Json<FahrzeugStatus>, AppError> {
    let n = normalisiere(body)?;
    let s = status_repo::aktualisiere(&state.pool, benutzer.org_id, id, n.daten()).await?;
    Ok(Json(s))
}

/// POST /api/fahrzeug-status/{id}/deaktivieren — Admin (Soft-Delete statt Löschen).
pub async fn deaktivieren(
    State(state): State<AppState>,
    AdminUser(benutzer): AdminUser,
    Path(id): Path<i64>,
) -> Result<StatusCode, AppError> {
    status_repo::deaktivieren(&state.pool, benutzer.org_id, id).await?;
    Ok(StatusCode::NO_CONTENT)
}
