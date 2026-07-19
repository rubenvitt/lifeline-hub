use crate::app::AppState;
use crate::auth::session::{AdminUser, CurrentUser};
use crate::error::AppError;
use crate::extract::JsonBody;
use crate::personal::repo::{self, PersonalDaten};
use crate::personal::{PersonalAnzeige, PersonalVorschlaege};
use crate::routes::support::trimme;
use crate::staerke::StaerkePosition;
use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::Json;
use serde::Deserialize;

/// Body für Anlegen + Vollersatz-PATCH (gleiche editierbaren Felder).
#[derive(Debug, Deserialize)]
pub struct PersonalBody {
    pub name: String,
    pub benutzer_id: Option<i64>,
    pub personalnummer: Option<String>,
    pub traegerorganisation: Option<String>,
    pub telefon: Option<String>,
    pub staerke_position: Option<String>,
    pub bemerkung: Option<String>,
    #[serde(default)]
    pub qualifikation_ids: Vec<i64>,
}

/// Owned, validierte Felder; `PersonalDaten` borgt daraus.
struct Normalisiert {
    name: String,
    benutzer_id: Option<i64>,
    personalnummer: Option<String>,
    traegerorganisation: Option<String>,
    telefon: Option<String>,
    staerke_position: Option<String>,
    bemerkung: Option<String>,
    qualifikation_ids: Vec<i64>,
}

impl Normalisiert {
    fn daten(&self) -> PersonalDaten<'_> {
        PersonalDaten {
            name: &self.name,
            benutzer_id: self.benutzer_id,
            personalnummer: self.personalnummer.as_deref(),
            traegerorganisation: self.traegerorganisation.as_deref(),
            telefon: self.telefon.as_deref(),
            staerke_position: self.staerke_position.as_deref(),
            bemerkung: self.bemerkung.as_deref(),
        }
    }
}

fn normalisiere(body: PersonalBody) -> Result<Normalisiert, AppError> {
    let name = body.name.trim().to_string();
    if name.is_empty() {
        return Err(AppError::Validation("Name darf nicht leer sein".into()));
    }
    let staerke_position = match trimme(body.staerke_position) {
        Some(s) => {
            if StaerkePosition::parse(&s).is_none() {
                return Err(AppError::Validation("Ungültige Stärke-Position".into()));
            }
            Some(s)
        }
        None => None,
    };
    Ok(Normalisiert {
        name,
        benutzer_id: body.benutzer_id,
        personalnummer: trimme(body.personalnummer),
        traegerorganisation: trimme(body.traegerorganisation),
        telefon: trimme(body.telefon),
        staerke_position,
        bemerkung: trimme(body.bemerkung),
        qualifikation_ids: body.qualifikation_ids,
    })
}

#[derive(Debug, Deserialize)]
pub struct ListeParams {
    #[serde(default)]
    pub nur_im_dienst: bool,
}

/// GET /api/personal — alle eingeloggten Nutzer (eigene Org), inkl. Qualifikationen.
pub async fn liste(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Query(params): Query<ListeParams>,
) -> Result<Json<Vec<PersonalAnzeige>>, AppError> {
    Ok(Json(
        repo::liste_anzeige(&state.pool, benutzer.org_id, params.nur_im_dienst).await?,
    ))
}

/// GET /api/personal-vorschlaege — abgeleitete Trägerorganisations-Vorschläge (eigene Org).
pub async fn vorschlaege(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
) -> Result<Json<PersonalVorschlaege>, AppError> {
    Ok(Json(repo::vorschlaege(&state.pool, benutzer.org_id).await?))
}

/// POST /api/personal — Admin. Dublette Personalnummer → Conflict.
pub async fn anlegen(
    State(state): State<AppState>,
    AdminUser(benutzer): AdminUser,
    JsonBody(body): JsonBody<PersonalBody>,
) -> Result<(StatusCode, Json<PersonalAnzeige>), AppError> {
    let n = normalisiere(body)?;
    let p = repo::anlegen(
        &state.pool,
        benutzer.org_id,
        n.daten(),
        &n.qualifikation_ids,
    )
    .await?;
    let a = repo::laden_anzeige(&state.pool, benutzer.org_id, p.id).await?;
    Ok((StatusCode::CREATED, Json(a)))
}

/// PATCH /api/personal/{id} — Admin, Vollersatz. NotFound bei fremder/unbek. id.
pub async fn aktualisieren(
    State(state): State<AppState>,
    AdminUser(benutzer): AdminUser,
    Path(id): Path<i64>,
    JsonBody(body): JsonBody<PersonalBody>,
) -> Result<Json<PersonalAnzeige>, AppError> {
    let n = normalisiere(body)?;
    repo::aktualisiere(
        &state.pool,
        benutzer.org_id,
        id,
        n.daten(),
        &n.qualifikation_ids,
    )
    .await?;
    let a = repo::laden_anzeige(&state.pool, benutzer.org_id, id).await?;
    Ok(Json(a))
}

/// POST /api/personal/{id}/ausser-dienst — Admin (Soft-Delete).
pub async fn ausser_dienst(
    State(state): State<AppState>,
    AdminUser(benutzer): AdminUser,
    Path(id): Path<i64>,
) -> Result<Json<PersonalAnzeige>, AppError> {
    repo::setze_dienststatus(&state.pool, benutzer.org_id, id, false).await?;
    Ok(Json(
        repo::laden_anzeige(&state.pool, benutzer.org_id, id).await?,
    ))
}

/// POST /api/personal/{id}/in-dienst — Admin (Reaktivierung; Conflict bei Nummernkollision).
pub async fn in_dienst(
    State(state): State<AppState>,
    AdminUser(benutzer): AdminUser,
    Path(id): Path<i64>,
) -> Result<Json<PersonalAnzeige>, AppError> {
    repo::setze_dienststatus(&state.pool, benutzer.org_id, id, true).await?;
    Ok(Json(
        repo::laden_anzeige(&state.pool, benutzer.org_id, id).await?,
    ))
}
