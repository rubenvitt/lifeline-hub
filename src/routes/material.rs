use crate::app::AppState;
use crate::auth::session::{AdminUser, CurrentUser};
use crate::error::AppError;
use crate::material::repo::{self, MaterialDaten};
use crate::material::MaterialAnzeige;
use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::Json;
use serde::Deserialize;

/// Body für Anlegen + Vollersatz-PATCH (gleiche editierbaren Felder).
#[derive(Debug, Deserialize)]
pub struct MaterialBody {
    pub bezeichnung: String,
    pub kategorie: Option<String>,
    pub bestandsnummer: Option<String>,
    pub traegerorganisation: Option<String>,
    pub standort: Option<String>,
    pub bemerkung: Option<String>,
}

/// Trimmt einen optionalen String und verwirft ihn, wenn er leer ist.
fn trimme(s: Option<String>) -> Option<String> {
    s.map(|s| s.trim().to_string()).filter(|s| !s.is_empty())
}

/// Owned, validierte Felder; `MaterialDaten` borgt daraus.
struct Normalisiert {
    bezeichnung: String,
    kategorie: Option<String>,
    bestandsnummer: Option<String>,
    traegerorganisation: Option<String>,
    standort: Option<String>,
    bemerkung: Option<String>,
}

impl Normalisiert {
    fn daten(&self) -> MaterialDaten<'_> {
        MaterialDaten {
            bezeichnung: &self.bezeichnung,
            kategorie: self.kategorie.as_deref(),
            bestandsnummer: self.bestandsnummer.as_deref(),
            traegerorganisation: self.traegerorganisation.as_deref(),
            standort: self.standort.as_deref(),
            bemerkung: self.bemerkung.as_deref(),
        }
    }
}

fn normalisiere(body: MaterialBody) -> Result<Normalisiert, AppError> {
    let bezeichnung = body.bezeichnung.trim().to_string();
    if bezeichnung.is_empty() {
        return Err(AppError::Validation(
            "Bezeichnung darf nicht leer sein".into(),
        ));
    }
    Ok(Normalisiert {
        bezeichnung,
        kategorie: trimme(body.kategorie),
        bestandsnummer: trimme(body.bestandsnummer),
        traegerorganisation: trimme(body.traegerorganisation),
        standort: trimme(body.standort),
        bemerkung: trimme(body.bemerkung),
    })
}

#[derive(Debug, Deserialize)]
pub struct ListeParams {
    #[serde(default)]
    pub nur_im_dienst: bool,
}

/// GET /api/material — alle eingeloggten Nutzer (eigene Org).
pub async fn liste(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Query(params): Query<ListeParams>,
) -> Result<Json<Vec<MaterialAnzeige>>, AppError> {
    let material = repo::liste(&state.pool, benutzer.org_id, params.nur_im_dienst).await?;
    Ok(Json(material.iter().map(|m| m.anzeige()).collect()))
}

/// GET /api/material-kategorien — abgeleitete Kategorie-Vorschläge (eigene Org).
pub async fn kategorien(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
) -> Result<Json<Vec<String>>, AppError> {
    Ok(Json(repo::kategorien(&state.pool, benutzer.org_id).await?))
}

/// POST /api/material — Admin. Dublette Bestandsnummer → Conflict.
pub async fn anlegen(
    State(state): State<AppState>,
    AdminUser(benutzer): AdminUser,
    Json(body): Json<MaterialBody>,
) -> Result<(StatusCode, Json<MaterialAnzeige>), AppError> {
    let n = normalisiere(body)?;
    let m = repo::anlegen(&state.pool, benutzer.org_id, n.daten()).await?;
    Ok((StatusCode::CREATED, Json(m.anzeige())))
}

/// PATCH /api/material/{id} — Admin, Vollersatz. NotFound bei fremder/unbek. id.
pub async fn aktualisieren(
    State(state): State<AppState>,
    AdminUser(benutzer): AdminUser,
    Path(id): Path<i64>,
    Json(body): Json<MaterialBody>,
) -> Result<Json<MaterialAnzeige>, AppError> {
    let n = normalisiere(body)?;
    let m = repo::aktualisiere(&state.pool, benutzer.org_id, id, n.daten()).await?;
    Ok(Json(m.anzeige()))
}

/// POST /api/material/{id}/ausser-dienst — Admin (Soft-Delete).
pub async fn ausser_dienst(
    State(state): State<AppState>,
    AdminUser(benutzer): AdminUser,
    Path(id): Path<i64>,
) -> Result<Json<MaterialAnzeige>, AppError> {
    let m = repo::setze_dienststatus(&state.pool, benutzer.org_id, id, false).await?;
    Ok(Json(m.anzeige()))
}

/// POST /api/material/{id}/in-dienst — Admin (Reaktivierung; Conflict bei Nummernkollision).
pub async fn in_dienst(
    State(state): State<AppState>,
    AdminUser(benutzer): AdminUser,
    Path(id): Path<i64>,
) -> Result<Json<MaterialAnzeige>, AppError> {
    let m = repo::setze_dienststatus(&state.pool, benutzer.org_id, id, true).await?;
    Ok(Json(m.anzeige()))
}
