use crate::app::AppState;
use crate::auth::session::{AdminUser, CurrentUser};
use crate::error::AppError;
use crate::etb::MeldeWeg;
use crate::etb_baustein::repo::{self, BausteinDaten};
use crate::etb_baustein::{BausteinTyp, EtbBaustein};
use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::Json;
use serde::Deserialize;

#[derive(Debug, Deserialize)]
pub struct BausteinBody {
    pub label: String,
    pub typ: String,
    pub inhalt: String,
    pub meldeweg: Option<String>,
    pub veranlassung: Option<String>,
    #[serde(default)]
    pub sortier: i64,
}

fn trimme(s: Option<String>) -> Option<String> {
    s.map(|s| s.trim().to_string()).filter(|s| !s.is_empty())
}

struct Normalisiert {
    label: String,
    typ: String,
    inhalt: String,
    meldeweg: Option<String>,
    veranlassung: Option<String>,
    sortier: i64,
}

impl Normalisiert {
    fn daten(&self) -> BausteinDaten<'_> {
        BausteinDaten {
            label: &self.label,
            typ: &self.typ,
            inhalt: &self.inhalt,
            meldeweg: self.meldeweg.as_deref(),
            veranlassung: self.veranlassung.as_deref(),
            sortier: self.sortier,
        }
    }
}

fn normalisiere(body: BausteinBody) -> Result<Normalisiert, AppError> {
    let label = body.label.trim().to_string();
    if label.is_empty() {
        return Err(AppError::Validation("Label darf nicht leer sein".into()));
    }
    let inhalt = body.inhalt.trim().to_string();
    if inhalt.is_empty() {
        return Err(AppError::Validation("Inhalt darf nicht leer sein".into()));
    }
    // Typ muss erfassbar (kein 'system') und keine 'berichtigung' sein.
    let typ = BausteinTyp::parse(&body.typ)
        .ok_or_else(|| AppError::Validation("Ungültiger Baustein-Typ".into()))?;

    let meldeweg = trimme(body.meldeweg);
    if let Some(w) = &meldeweg {
        if MeldeWeg::parse(w).is_none() {
            return Err(AppError::Validation("Ungültiger Meldeweg".into()));
        }
    }

    Ok(Normalisiert {
        label,
        typ: typ.as_str().to_string(),
        inhalt,
        meldeweg,
        veranlassung: trimme(body.veranlassung),
        sortier: body.sortier,
    })
}

/// GET /api/etb-bausteine — aktive Katalog-Einträge (eigene Org), für Schnellbausteine.
pub async fn liste(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
) -> Result<Json<Vec<EtbBaustein>>, AppError> {
    Ok(Json(repo::liste(&state.pool, benutzer.org_id).await?))
}

/// POST /api/etb-bausteine — Admin. Neuen Baustein anlegen.
pub async fn anlegen(
    State(state): State<AppState>,
    AdminUser(benutzer): AdminUser,
    Json(body): Json<BausteinBody>,
) -> Result<(StatusCode, Json<EtbBaustein>), AppError> {
    let n = normalisiere(body)?;
    let b = repo::anlegen(&state.pool, benutzer.org_id, n.daten()).await?;
    Ok((StatusCode::CREATED, Json(b)))
}

/// PATCH /api/etb-bausteine/{id} — Admin, Vollersatz.
pub async fn aktualisieren(
    State(state): State<AppState>,
    AdminUser(benutzer): AdminUser,
    Path(id): Path<i64>,
    Json(body): Json<BausteinBody>,
) -> Result<Json<EtbBaustein>, AppError> {
    let n = normalisiere(body)?;
    let b = repo::aktualisiere(&state.pool, benutzer.org_id, id, n.daten()).await?;
    Ok(Json(b))
}

/// POST /api/etb-bausteine/{id}/deaktivieren — Admin (Soft-Delete statt Löschen).
pub async fn deaktivieren(
    State(state): State<AppState>,
    AdminUser(benutzer): AdminUser,
    Path(id): Path<i64>,
) -> Result<StatusCode, AppError> {
    repo::deaktivieren(&state.pool, benutzer.org_id, id).await?;
    Ok(StatusCode::NO_CONTENT)
}
