use crate::app::AppState;
use crate::auth::session::CurrentUser;
use crate::einsatz::berechtigung::{fordere_aktiv, fordere_lesezugriff, fordere_schreibrecht};
use crate::einsatz::repo as einsatz_repo;
use crate::error::AppError;
use crate::etb::{self, repo as etb_repo};
use crate::personal::disposition_repo::{self, AdhocDaten};
use crate::personal::status_repo;
use crate::personal::EinsatzPersonalAnzeige;
use crate::staerke::StaerkePosition;
use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::Json;
use serde::Deserialize;

/// Schreibt einen automatischen System-ETB-Eintrag und publiziert ihn live
/// (wie `routes::einsatz_fahrzeug::etb_system`).
async fn etb_system(state: &AppState, einsatz_id: i64, benutzer_id: i64, inhalt: &str) -> Result<(), AppError> {
    let anzeige = etb_repo::anlegen(
        &state.pool,
        einsatz_id,
        benutzer_id,
        etb_repo::EintragDaten {
            typ: etb::TYP_SYSTEM,
            inhalt,
            von: None,
            an: None,
            meldeweg: None,
            veranlassung: None,
            ereigniszeit: None,
            erfasst_lokal_at: None,
            berichtigt_eintrag_id: None,
        },
    )
    .await?;
    if let Ok(json) = serde_json::to_string(&anzeige) {
        state.live.publiziere(einsatz_id, json);
    }
    Ok(())
}

/// Personen-Bezeichnung für ETB-Texte: Name, optional mit Funktion in Klammern.
fn person_bezeichnung(a: &EinsatzPersonalAnzeige) -> String {
    match a.funktion.as_deref() {
        Some(f) if !f.is_empty() => format!("{} ({})", a.name, f),
        _ => a.name.clone(),
    }
}

fn trimme(s: Option<String>) -> Option<String> {
    s.map(|s| s.trim().to_string()).filter(|s| !s.is_empty())
}

/// Validiert eine optionale Stärke-Position gegen das Enum (leer/None erlaubt).
fn pruefe_position(p: &Option<String>) -> Result<(), AppError> {
    if let Some(s) = p.as_deref() {
        if StaerkePosition::parse(s).is_none() {
            return Err(AppError::Validation("Ungültige Stärke-Position".into()));
        }
    }
    Ok(())
}

/// GET /api/einsaetze/{id}/personal — disponiertes Personal (aufgelöst). Nur Lesezugriff.
pub async fn liste(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Path(einsatz_id): Path<i64>,
) -> Result<Json<Vec<EinsatzPersonalAnzeige>>, AppError> {
    let einsatz = einsatz_repo::laden(&state.pool, einsatz_id).await?;
    let rolle = einsatz_repo::rolle_von(&state.pool, einsatz_id, benutzer.id).await?;
    fordere_lesezugriff(&benutzer, &einsatz, rolle)?;
    Ok(Json(
        disposition_repo::liste(&state.pool, einsatz_id, einsatz.ist_aktiv()).await?,
    ))
}

#[derive(Debug, Deserialize)]
pub struct AdhocBody {
    pub name: String,
    pub funktion: Option<String>,
    pub traegerorganisation: Option<String>,
    pub staerke_position: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct DisponierenBody {
    pub personal_id: Option<i64>,
    pub staerke_position: Option<String>,
    pub adhoc: Option<AdhocBody>,
}

/// POST /api/einsaetze/{id}/personal — Stamm-Person disponieren ODER Ad-hoc anlegen.
/// Schreibberechtigt + aktiver Einsatz. Schreibt ETB-Eintrag.
pub async fn disponieren(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Path(einsatz_id): Path<i64>,
    Json(body): Json<DisponierenBody>,
) -> Result<(StatusCode, Json<EinsatzPersonalAnzeige>), AppError> {
    let einsatz = einsatz_repo::laden(&state.pool, einsatz_id).await?;
    let rolle = einsatz_repo::rolle_von(&state.pool, einsatz_id, benutzer.id).await?;
    fordere_schreibrecht(rolle)?;
    fordere_aktiv(&einsatz)?;

    let ep_id = match (body.personal_id, body.adhoc) {
        (Some(personal_id), None) => {
            pruefe_position(&body.staerke_position)?;
            disposition_repo::disponiere_stamm(
                &state.pool,
                einsatz_id,
                einsatz.org_id,
                personal_id,
                body.staerke_position.as_deref(),
                benutzer.id,
            )
            .await?
        }
        (None, Some(adhoc)) => {
            let name = adhoc.name.trim().to_string();
            if name.is_empty() {
                return Err(AppError::Validation("Name darf nicht leer sein".into()));
            }
            pruefe_position(&adhoc.staerke_position)?;
            let funktion = trimme(adhoc.funktion);
            let traeger = trimme(adhoc.traegerorganisation);
            let position = trimme(adhoc.staerke_position);
            disposition_repo::disponiere_adhoc(
                &state.pool,
                einsatz_id,
                einsatz.org_id,
                AdhocDaten {
                    name: &name,
                    funktion: funktion.as_deref(),
                    traegerorganisation: traeger.as_deref(),
                    staerke_position: position.as_deref(),
                },
                benutzer.id,
            )
            .await?
        }
        _ => {
            return Err(AppError::Validation(
                "Entweder personal_id (Stamm) oder adhoc angeben, nicht beides".into(),
            ))
        }
    };

    let anzeige = disposition_repo::laden_anzeige(&state.pool, einsatz_id, ep_id, true).await?;
    etb_system(
        &state,
        einsatz_id,
        benutzer.id,
        &format!("Person «{}» disponiert", person_bezeichnung(&anzeige)),
    )
    .await?;
    Ok((StatusCode::CREATED, Json(anzeige)))
}

#[derive(Debug, Deserialize)]
pub struct DispoPatchBody {
    pub status_id: Option<i64>,
    pub staerke_position: Option<String>,
    pub bemerkung: Option<String>,
}

/// PATCH /api/einsaetze/{id}/personal/{ep_id} — Status, Stärke-Position und/oder Bemerkung.
/// Status-Wechsel schreibt ETB-Eintrag.
pub async fn aktualisieren(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Path((einsatz_id, ep_id)): Path<(i64, i64)>,
    Json(body): Json<DispoPatchBody>,
) -> Result<Json<EinsatzPersonalAnzeige>, AppError> {
    let einsatz = einsatz_repo::laden(&state.pool, einsatz_id).await?;
    let rolle = einsatz_repo::rolle_von(&state.pool, einsatz_id, benutzer.id).await?;
    fordere_schreibrecht(rolle)?;
    fordere_aktiv(&einsatz)?;

    if let Some(sid) = body.status_id {
        if !status_repo::ist_in_org(&state.pool, einsatz.org_id, sid).await? {
            return Err(AppError::Validation("Unbekannter Status".into()));
        }
    }
    pruefe_position(&body.staerke_position)?;

    let vorher = disposition_repo::laden_anzeige(&state.pool, einsatz_id, ep_id, true).await?;
    // Bemerkung: gesetzt (auch "") → setzen; absent/null → unverändert (COALESCE).
    let bemerkung = body.bemerkung.as_deref().map(str::trim);
    disposition_repo::aktualisiere(
        &state.pool,
        einsatz_id,
        ep_id,
        body.status_id,
        body.staerke_position.as_deref(),
        bemerkung,
    )
    .await?;
    let nachher = disposition_repo::laden_anzeige(&state.pool, einsatz_id, ep_id, true).await?;

    if vorher.status_id != nachher.status_id {
        let alt = vorher.status_label.as_deref().unwrap_or("—");
        let neu = nachher.status_label.as_deref().unwrap_or("—");
        etb_system(
            &state,
            einsatz_id,
            benutzer.id,
            &format!("Person «{}»: Status «{}» → «{}»", nachher.name, alt, neu),
        )
        .await?;
    }
    Ok(Json(nachher))
}

/// DELETE /api/einsaetze/{id}/personal/{ep_id} — aus dem Einsatz entfernen. Schreibt ETB-Eintrag.
pub async fn entfernen(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Path((einsatz_id, ep_id)): Path<(i64, i64)>,
) -> Result<StatusCode, AppError> {
    let einsatz = einsatz_repo::laden(&state.pool, einsatz_id).await?;
    let rolle = einsatz_repo::rolle_von(&state.pool, einsatz_id, benutzer.id).await?;
    fordere_schreibrecht(rolle)?;
    fordere_aktiv(&einsatz)?;

    let anzeige = disposition_repo::laden_anzeige(&state.pool, einsatz_id, ep_id, true).await?;
    disposition_repo::entferne(&state.pool, einsatz_id, ep_id).await?;
    etb_system(
        &state,
        einsatz_id,
        benutzer.id,
        &format!("Person «{}» aus dem Einsatz entfernt", person_bezeichnung(&anzeige)),
    )
    .await?;
    Ok(StatusCode::NO_CONTENT)
}
