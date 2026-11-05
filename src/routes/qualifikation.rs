use crate::app::AppState;
use crate::auth::session::{AdminUser, CurrentUser};
use crate::error::AppError;
use crate::extract::JsonBody;
use crate::extract::PfadParam;
use crate::personal::qualifikation_repo as repo;
use crate::personal::Qualifikation;
use crate::routes::support::{deserialize_optional_field, pflicht};
use axum::extract::State;
use axum::http::StatusCode;
use axum::Json;
use serde::Deserialize;

#[derive(Debug, Deserialize)]
pub struct QualifikationBody {
    pub label: String,
    #[serde(default)]
    pub sortier: i64,
    /// Die Qualifikation, die diese einschließt (LLH-1553); fehlt = keine.
    #[serde(default)]
    pub schliesst_ein_id: Option<i64>,
}

fn normalisiere_label(label: &str) -> Result<String, AppError> {
    let l = pflicht(&label, "Label")?;
    Ok(l)
}

/// PATCH-Body (LFH-306): **jedes** Feld ist optional — absent = unverändert. Bewusst
/// getrennt von [`QualifikationBody`]: der POST muss `label` weiterhin strukturell
/// erzwingen (fehlendes Feld → 400 schon im Extractor).
///
/// Tri-State hat nur `schliesst_ein_id` (LLH-1553). Der Gewinn für `sortier` steckt im
/// fehlenden `#[serde(default)]`: unter dem alten Vollersatz-Body setzte ein PATCH ohne
/// `sortier` die NOT-NULL-Spalte still auf 0 und verschob den Eintrag in der Katalogliste.
/// Belegt von `patch_ohne_sortier_laesst_sortier_stehen`.
#[derive(Debug, Deserialize)]
pub struct PatchQualifikation {
    pub label: Option<String>,
    pub sortier: Option<i64>,
    /// Tri-State (LLH-1553): fehlt = unverändert, `null` = kein Einschluss mehr.
    #[serde(default, deserialize_with = "deserialize_optional_field")]
    pub schliesst_ein_id: Option<Option<i64>>,
}

/// GET /api/qualifikationen — aktive Katalog-Einträge (eigene Org), für die Auswahl.
pub async fn liste(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
) -> Result<Json<Vec<Qualifikation>>, AppError> {
    Ok(Json(repo::liste(&state.pool, benutzer.org_id).await?))
}

/// POST /api/qualifikationen — Admin. Dublette label → Conflict, ungültiger Einschluss 422.
pub async fn anlegen(
    State(state): State<AppState>,
    AdminUser(benutzer): AdminUser,
    JsonBody(body): JsonBody<QualifikationBody>,
) -> Result<(StatusCode, Json<Qualifikation>), AppError> {
    let label = normalisiere_label(&body.label)?;
    let q = repo::anlegen_mit(
        &state.pool,
        benutzer.org_id,
        &label,
        body.sortier,
        body.schliesst_ein_id,
    )
    .await?;
    Ok((StatusCode::CREATED, Json(q)))
}

/// PATCH /api/qualifikationen/{id} — Admin, echter Teil-Patch (LFH-306):
/// Feld absent = unverändert. Ein vorhandenes, aber leeres `label` ist 400.
pub async fn aktualisieren(
    State(state): State<AppState>,
    AdminUser(benutzer): AdminUser,
    PfadParam(id): PfadParam<i64>,
    JsonBody(body): JsonBody<PatchQualifikation>,
) -> Result<Json<Qualifikation>, AppError> {
    // Nur das gesendete Feld prüfen — die Leer-Prüfung darf nicht auf den Absent-Zweig
    // durchschlagen, sonst wäre jeder Teil-Patch abgelehnt.
    let label = match body.label {
        Some(l) => Some(normalisiere_label(&l)?),
        None => None,
    };
    let q = repo::patche(
        &state.pool,
        benutzer.org_id,
        id,
        repo::QualifikationPatch {
            label: label.as_deref(),
            sortier: body.sortier,
            schliesst_ein_id: body.schliesst_ein_id,
        },
    )
    .await?;
    Ok(Json(q))
}

/// POST /api/qualifikationen/{id}/deaktivieren — Admin (Soft-Delete statt Löschen).
pub async fn deaktivieren(
    State(state): State<AppState>,
    AdminUser(benutzer): AdminUser,
    PfadParam(id): PfadParam<i64>,
) -> Result<StatusCode, AppError> {
    repo::deaktivieren(&state.pool, benutzer.org_id, id).await?;
    Ok(StatusCode::NO_CONTENT)
}
