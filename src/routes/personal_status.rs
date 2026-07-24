use crate::app::AppState;
use crate::auth::session::{AdminUser, CurrentUser};
use crate::error::AppError;
use crate::extract::JsonBody;
use crate::extract::PfadParam;
use crate::katalog::StatusKategorie;
use crate::personal::status_repo::{self, StatusDaten, StatusPatch};
use crate::personal::PersonalStatus;
use crate::routes::support::{deserialize_optional_field, trimme, trimme_tri};
use axum::extract::State;
use axum::http::StatusCode;
use axum::Json;
use serde::Deserialize;

#[derive(Debug, Deserialize)]
pub struct StatusBody {
    pub label: String,
    pub kategorie: String,
    pub farbe: Option<String>,
    #[serde(default)]
    pub sortier: i64,
}

struct Normalisiert {
    label: String,
    kategorie: String,
    farbe: Option<String>,
    sortier: i64,
}

impl Normalisiert {
    fn daten(&self) -> StatusDaten<'_> {
        StatusDaten {
            label: &self.label,
            kategorie: &self.kategorie,
            farbe: self.farbe.as_deref(),
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
    Ok(Normalisiert {
        label,
        kategorie: body.kategorie,
        farbe: trimme(body.farbe),
        sortier: body.sortier,
    })
}

/// PATCH-Body (LFH-306, Tri-State): **jedes** Feld ist optional — absent = unverändert.
/// Bewusst getrennt von [`StatusBody`]: der POST muss seine Pflichtfelder weiterhin
/// strukturell erzwingen (fehlendes `label` → 400 schon im Extractor).
///
/// **Kein `#[serde(default)]` an `sortier`** — das ist hier kein Stilfrage: ein `default`
/// auf einem NOT-NULL-Feld macht aus „nicht gesendet" ein „auf 0 setzen" und ist genau der
/// stille Spalten-Reset, den LFH-306 beseitigt. `Option<T>` deserialisiert absent ohnehin
/// zu `None`; `default` braucht nur der Tri-State-Deserializer.
#[derive(Debug, Deserialize)]
pub struct PatchStatus {
    pub label: Option<String>,
    pub kategorie: Option<String>,
    #[serde(default, deserialize_with = "deserialize_optional_field")]
    pub farbe: Option<Option<String>>,
    pub sortier: Option<i64>,
}

struct PatchNormalisiert {
    label: Option<String>,
    kategorie: Option<String>,
    farbe: Option<Option<String>>,
    sortier: Option<i64>,
}

impl PatchNormalisiert {
    fn patch(&self) -> StatusPatch<'_> {
        StatusPatch {
            label: self.label.as_deref(),
            kategorie: self.kategorie.as_deref(),
            farbe: self.farbe.as_ref().map(|v| v.as_deref()),
            sortier: self.sortier,
        }
    }
}

/// Prüft nur die **gesendeten** Felder. Ein vorhandenes, aber leeres Pflichtfeld ist 400
/// (Statuscode-Konvention), ein absentes ist schlicht kein Wunsch — die Prüfung darf nicht
/// auf den Absent-Zweig durchschlagen, sonst wäre jeder Teil-Patch abgelehnt.
fn normalisiere_patch(body: PatchStatus) -> Result<PatchNormalisiert, AppError> {
    let label = match body.label {
        Some(l) => {
            let l = l.trim().to_string();
            if l.is_empty() {
                return Err(AppError::Validation("Label darf nicht leer sein".into()));
            }
            Some(l)
        }
        None => None,
    };
    if let Some(k) = &body.kategorie {
        if StatusKategorie::parse(k).is_none() {
            return Err(AppError::Validation("Ungültige Kategorie".into()));
        }
    }
    Ok(PatchNormalisiert {
        label,
        kategorie: body.kategorie,
        farbe: trimme_tri(body.farbe),
        sortier: body.sortier,
    })
}

/// GET /api/personal-status — aktive Katalog-Einträge (eigene Org), für Dropdowns.
pub async fn liste(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
) -> Result<Json<Vec<PersonalStatus>>, AppError> {
    Ok(Json(
        status_repo::liste(&state.pool, benutzer.org_id).await?,
    ))
}

/// POST /api/personal-status — Admin. Dublette label → Conflict.
pub async fn anlegen(
    State(state): State<AppState>,
    AdminUser(benutzer): AdminUser,
    JsonBody(body): JsonBody<StatusBody>,
) -> Result<(StatusCode, Json<PersonalStatus>), AppError> {
    let n = normalisiere(body)?;
    let s = status_repo::anlegen(&state.pool, benutzer.org_id, n.daten()).await?;
    Ok((StatusCode::CREATED, Json(s)))
}

/// PATCH /api/personal-status/{id} — Admin, echter Teil-Patch (LFH-306):
/// Feld absent = unverändert, `null`/`""` bei `farbe` = leeren.
pub async fn aktualisieren(
    State(state): State<AppState>,
    AdminUser(benutzer): AdminUser,
    PfadParam(id): PfadParam<i64>,
    JsonBody(body): JsonBody<PatchStatus>,
) -> Result<Json<PersonalStatus>, AppError> {
    let n = normalisiere_patch(body)?;
    let s = status_repo::patche(&state.pool, benutzer.org_id, id, n.patch()).await?;
    Ok(Json(s))
}

/// POST /api/personal-status/{id}/deaktivieren — Admin (Soft-Delete statt Löschen).
pub async fn deaktivieren(
    State(state): State<AppState>,
    AdminUser(benutzer): AdminUser,
    PfadParam(id): PfadParam<i64>,
) -> Result<StatusCode, AppError> {
    status_repo::deaktivieren(&state.pool, benutzer.org_id, id).await?;
    Ok(StatusCode::NO_CONTENT)
}
