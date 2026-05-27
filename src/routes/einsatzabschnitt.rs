use crate::app::AppState;
use crate::auth::session::CurrentUser;
use crate::einsatz::berechtigung::{fordere_aktiv, fordere_lesezugriff, fordere_schreibrecht};
use crate::einsatz::repo as einsatz_repo;
use crate::einsatzabschnitt::repo::{self as abschnitt_repo, AbschnittDaten};
use crate::einsatzabschnitt::EinsatzabschnittAnzeige;
use crate::error::AppError;
use crate::etb::{self, repo as etb_repo};
use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::Json;
use serde::Deserialize;

/// Schreibt einen System-ETB-Eintrag und publiziert ihn live (Muster wie
/// `routes::einsatz_personal::etb_system`).
async fn etb_system(state: &AppState, einsatz_id: i64, benutzer_id: i64, inhalt: &str) -> Result<(), AppError> {
    let anzeige = etb_repo::anlegen(
        &state.pool, einsatz_id, benutzer_id,
        etb_repo::EintragDaten {
            typ: etb::TYP_SYSTEM, inhalt, von: None, an: None, meldeweg: None,
            veranlassung: None, ereigniszeit: None, erfasst_lokal_at: None, berichtigt_eintrag_id: None,
        },
    ).await?;
    if let Ok(json) = serde_json::to_string(&anzeige) {
        state.live.publiziere(einsatz_id, json);
    }
    Ok(())
}

fn trimme(s: Option<String>) -> Option<String> {
    s.map(|s| s.trim().to_string()).filter(|s| !s.is_empty())
}

/// GET /api/einsaetze/{id}/abschnitte — flache Liste (Baum baut das FE). Nur Lesezugriff.
pub async fn liste(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Path(einsatz_id): Path<i64>,
) -> Result<Json<Vec<EinsatzabschnittAnzeige>>, AppError> {
    let einsatz = einsatz_repo::laden(&state.pool, einsatz_id).await?;
    let rolle = einsatz_repo::rolle_von(&state.pool, einsatz_id, benutzer.id).await?;
    fordere_lesezugriff(&benutzer, &einsatz, rolle)?;
    Ok(Json(abschnitt_repo::liste(&state.pool, einsatz_id).await?))
}

#[derive(Debug, Deserialize)]
pub struct AbschnittBody {
    pub name: String,
    pub ueber_abschnitt_id: Option<i64>,
    pub leiter_id: Option<i64>,
    pub bemerkung: Option<String>,
    #[serde(default)]
    pub sortier: i64,
}

/// POST /api/einsaetze/{id}/abschnitte — anlegen. Schreibrecht + aktiv. ETB-Eintrag.
pub async fn anlegen(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Path(einsatz_id): Path<i64>,
    Json(body): Json<AbschnittBody>,
) -> Result<(StatusCode, Json<EinsatzabschnittAnzeige>), AppError> {
    let einsatz = einsatz_repo::laden(&state.pool, einsatz_id).await?;
    let rolle = einsatz_repo::rolle_von(&state.pool, einsatz_id, benutzer.id).await?;
    fordere_schreibrecht(rolle)?;
    fordere_aktiv(&einsatz)?;

    let name = body.name.trim().to_string();
    if name.is_empty() {
        return Err(AppError::Validation("Name darf nicht leer sein".into()));
    }
    let bemerkung = trimme(body.bemerkung);
    let anzeige = abschnitt_repo::anlegen(
        &state.pool, einsatz_id,
        AbschnittDaten {
            name: &name, ueber_abschnitt_id: body.ueber_abschnitt_id,
            leiter_id: body.leiter_id, bemerkung: bemerkung.as_deref(), sortier: body.sortier,
        },
    ).await?;
    etb_system(&state, einsatz_id, benutzer.id, &format!("Abschnitt «{}» angelegt", anzeige.name)).await?;
    Ok((StatusCode::CREATED, Json(anzeige)))
}

/// PATCH /api/einsaetze/{id}/abschnitte/{aid} — name/parent/leiter/bemerkung/sortier.
/// Kein ETB-Eintrag (reine Korrektur; Auflösen ist die sinntragende Aktion).
pub async fn aktualisieren(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Path((einsatz_id, aid)): Path<(i64, i64)>,
    Json(body): Json<AbschnittBody>,
) -> Result<Json<EinsatzabschnittAnzeige>, AppError> {
    let einsatz = einsatz_repo::laden(&state.pool, einsatz_id).await?;
    let rolle = einsatz_repo::rolle_von(&state.pool, einsatz_id, benutzer.id).await?;
    fordere_schreibrecht(rolle)?;
    fordere_aktiv(&einsatz)?;

    let name = body.name.trim().to_string();
    if name.is_empty() {
        return Err(AppError::Validation("Name darf nicht leer sein".into()));
    }
    let bemerkung = trimme(body.bemerkung);
    let anzeige = abschnitt_repo::aktualisiere(
        &state.pool, einsatz_id, aid,
        AbschnittDaten {
            name: &name, ueber_abschnitt_id: body.ueber_abschnitt_id,
            leiter_id: body.leiter_id, bemerkung: bemerkung.as_deref(), sortier: body.sortier,
        },
    ).await?;
    Ok(Json(anzeige))
}

/// DELETE /api/einsaetze/{id}/abschnitte/{aid} — auflösen (Reparenting). ETB-Eintrag.
pub async fn aufloesen(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Path((einsatz_id, aid)): Path<(i64, i64)>,
) -> Result<StatusCode, AppError> {
    let einsatz = einsatz_repo::laden(&state.pool, einsatz_id).await?;
    let rolle = einsatz_repo::rolle_von(&state.pool, einsatz_id, benutzer.id).await?;
    fordere_schreibrecht(rolle)?;
    fordere_aktiv(&einsatz)?;

    let vorher = abschnitt_repo::laden(&state.pool, einsatz_id, aid).await?;
    abschnitt_repo::loese_auf(&state.pool, einsatz_id, aid).await?;
    etb_system(&state, einsatz_id, benutzer.id, &format!("Abschnitt «{}» aufgelöst", vorher.name)).await?;
    Ok(StatusCode::NO_CONTENT)
}
