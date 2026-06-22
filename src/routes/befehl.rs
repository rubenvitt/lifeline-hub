use crate::app::AppState;
use crate::auth::session::CurrentUser;
use crate::einsatz::berechtigung::{fordere_modul_zugriff_laden, fordere_aktiv, fordere_lesezugriff, fordere_schreibrecht};
use crate::einsatz::repo as einsatz_repo;

/// Modul-Key dieses Route-Moduls (LFH-132).
const MODUL_KEY: &str = "auftraege";
use crate::error::AppError;
use crate::etb::normalisiere_zeit;
use crate::befehl::repo::{self as befehl_repo, BefehlAnzeige, BefehlPatch};
use crate::befehl::{self, render_snapshot, validiere_freigabe, vorlage, Abschnitt};
use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::Json;
use serde::Deserialize;

/// Aktuelle Server-Zeit im SQLite-Format (Default-Zeitstand).
fn jetzt() -> String {
    chrono::Utc::now().format("%Y-%m-%d %H:%M:%S").to_string()
}

/// SSE-Notify: Befehle des Einsatzes haben sich geändert. Event-Tag `befehl`.
fn sse_befehl(state: &AppState, einsatz_id: i64, befehl_id: i64) {
    let data = serde_json::json!({ "einsatz_id": einsatz_id, "befehl_id": befehl_id }).to_string();
    state.live.publiziere_event(einsatz_id, "befehl", data);
}

/// GET /api/einsaetze/{id}/befehle — Liste. Nur Lesezugriff (inkl. Beobachter).
pub async fn liste(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Path(einsatz_id): Path<i64>,
) -> Result<Json<Vec<BefehlAnzeige>>, AppError> {
    let einsatz = einsatz_repo::laden(&state.pool, einsatz_id).await?;
    let rolle = einsatz_repo::rolle_von(&state.pool, einsatz_id, benutzer.id).await?;
    fordere_lesezugriff(&benutzer, &einsatz, rolle)?;
    fordere_modul_zugriff_laden(&state.pool, einsatz_id, einsatz.org_id, MODUL_KEY, &benutzer).await?;
    Ok(Json(befehl_repo::liste(&state.pool, einsatz_id).await?))
}

/// GET /api/einsaetze/{id}/befehle/{bid} — Detail. Nur Lesezugriff.
pub async fn detail(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Path((einsatz_id, bid)): Path<(i64, i64)>,
) -> Result<Json<BefehlAnzeige>, AppError> {
    let einsatz = einsatz_repo::laden(&state.pool, einsatz_id).await?;
    let rolle = einsatz_repo::rolle_von(&state.pool, einsatz_id, benutzer.id).await?;
    fordere_lesezugriff(&benutzer, &einsatz, rolle)?;
    fordere_modul_zugriff_laden(&state.pool, einsatz_id, einsatz.org_id, MODUL_KEY, &benutzer).await?;
    Ok(Json(befehl_repo::laden(&state.pool, einsatz_id, bid).await?))
}

#[derive(Debug, Deserialize)]
pub struct AnlegenBody {
    pub vorlage: String,
    pub titel: String,
    pub zeitstand: Option<String>,
}

/// POST /api/einsaetze/{id}/befehle — Entwurf anlegen. Schreibrecht + aktiv.
pub async fn anlegen(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Path(einsatz_id): Path<i64>,
    Json(body): Json<AnlegenBody>,
) -> Result<(StatusCode, Json<BefehlAnzeige>), AppError> {
    let einsatz = einsatz_repo::laden(&state.pool, einsatz_id).await?;
    let rolle = einsatz_repo::rolle_von(&state.pool, einsatz_id, benutzer.id).await?;
    fordere_schreibrecht(rolle)?;
    fordere_modul_zugriff_laden(&state.pool, einsatz_id, einsatz.org_id, MODUL_KEY, &benutzer).await?;
    fordere_aktiv(&einsatz)?;

    if vorlage(&body.vorlage).is_none() {
        return Err(AppError::Validation("Unbekannte Vorlage".into()));
    }
    let titel = body.titel.trim().to_string();
    if titel.is_empty() {
        return Err(AppError::Validation("Titel darf nicht leer sein".into()));
    }
    let zeitstand = match body.zeitstand.as_deref() {
        Some(z) => normalisiere_zeit(z)?,
        None => jetzt(),
    };

    let anzeige =
        befehl_repo::anlegen(&state.pool, einsatz_id, &body.vorlage, &titel, &zeitstand, benutzer.id)
            .await?;
    sse_befehl(&state, einsatz_id, anzeige.id);
    Ok((StatusCode::CREATED, Json(anzeige)))
}

#[derive(Debug, Deserialize)]
pub struct PatchBody {
    pub titel: Option<String>,
    pub zeitstand: Option<String>,
    pub abschnitte: Option<Vec<Abschnitt>>,
}

/// PATCH /api/einsaetze/{id}/befehle/{bid} — nur solange Entwurf (sonst 422).
pub async fn aktualisieren(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Path((einsatz_id, bid)): Path<(i64, i64)>,
    Json(body): Json<PatchBody>,
) -> Result<Json<BefehlAnzeige>, AppError> {
    let einsatz = einsatz_repo::laden(&state.pool, einsatz_id).await?;
    let rolle = einsatz_repo::rolle_von(&state.pool, einsatz_id, benutzer.id).await?;
    fordere_schreibrecht(rolle)?;
    fordere_modul_zugriff_laden(&state.pool, einsatz_id, einsatz.org_id, MODUL_KEY, &benutzer).await?;
    fordere_aktiv(&einsatz)?;

    let vorher = befehl_repo::laden(&state.pool, einsatz_id, bid).await?;
    if vorher.status != befehl::STATUS_ENTWURF {
        return Err(AppError::UnprocessableEntity(
            "Nur Entwürfe können bearbeitet werden".into(),
        ));
    }

    let titel = body.titel.as_ref().map(|t| t.trim().to_string());
    if let Some(t) = &titel {
        if t.is_empty() {
            return Err(AppError::Validation("Titel darf nicht leer sein".into()));
        }
    }
    let zeitstand = match body.zeitstand.as_deref() {
        Some(z) => Some(normalisiere_zeit(z)?),
        None => None,
    };
    if let Some(abs) = &body.abschnitte {
        let v = vorlage(&vorher.vorlage).ok_or(AppError::Internal("Vorlage verschwunden".into()))?;
        for a in abs {
            if !v.abschnitte.iter().any(|d| d.schluessel == a.schluessel) {
                return Err(AppError::UnprocessableEntity(format!(
                    "Unbekannter Abschnitts-Schlüssel «{}»",
                    a.schluessel
                )));
            }
        }
    }

    let anzeige = befehl_repo::aktualisiere(
        &state.pool,
        einsatz_id,
        bid,
        BefehlPatch {
            titel: titel.as_deref(),
            zeitstand: zeitstand.as_deref(),
            abschnitte: body.abschnitte.as_deref(),
        },
    )
    .await?;
    sse_befehl(&state, einsatz_id, bid);
    Ok(Json(anzeige))
}

/// POST /api/einsaetze/{id}/befehle/{bid}/freigeben — rendert + snapshottet ins ETB.
pub async fn freigeben(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Path((einsatz_id, bid)): Path<(i64, i64)>,
) -> Result<Json<BefehlAnzeige>, AppError> {
    let einsatz = einsatz_repo::laden(&state.pool, einsatz_id).await?;
    let rolle = einsatz_repo::rolle_von(&state.pool, einsatz_id, benutzer.id).await?;
    fordere_schreibrecht(rolle)?;
    fordere_modul_zugriff_laden(&state.pool, einsatz_id, einsatz.org_id, MODUL_KEY, &benutzer).await?;
    fordere_aktiv(&einsatz)?;

    let befehl = befehl_repo::laden(&state.pool, einsatz_id, bid).await?;
    if befehl.status != befehl::STATUS_ENTWURF {
        return Err(AppError::UnprocessableEntity("Befehl ist bereits freigegeben".into()));
    }
    let v = vorlage(&befehl.vorlage).ok_or(AppError::Internal("Vorlage verschwunden".into()))?;
    validiere_freigabe(v, &befehl.abschnitte)?;
    let render = render_snapshot(v, &befehl.titel, &befehl.zeitstand, &befehl.abschnitte);

    let anzeige =
        befehl_repo::freigeben(&state.pool, einsatz_id, bid, benutzer.id, &render, &befehl.zeitstand)
            .await?;

    if let Some(etb_id) = anzeige.etb_eintrag_id {
        if let Ok(etb_anzeige) = crate::etb::repo::laden(&state.pool, etb_id).await {
            if let Ok(json) = serde_json::to_string(&etb_anzeige) {
                state.live.publiziere(einsatz_id, json);
            }
        }
    }
    sse_befehl(&state, einsatz_id, bid);
    Ok(Json(anzeige))
}

#[derive(Debug, Deserialize)]
pub struct FortschreibenBody {
    pub zeitstand: Option<String>,
}

/// POST /api/einsaetze/{id}/befehle/{bid}/fortschreiben — neue Entwurfs-Version.
pub async fn fortschreiben(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Path((einsatz_id, bid)): Path<(i64, i64)>,
    Json(body): Json<FortschreibenBody>,
) -> Result<(StatusCode, Json<BefehlAnzeige>), AppError> {
    let einsatz = einsatz_repo::laden(&state.pool, einsatz_id).await?;
    let rolle = einsatz_repo::rolle_von(&state.pool, einsatz_id, benutzer.id).await?;
    fordere_schreibrecht(rolle)?;
    fordere_modul_zugriff_laden(&state.pool, einsatz_id, einsatz.org_id, MODUL_KEY, &benutzer).await?;
    fordere_aktiv(&einsatz)?;

    let zeitstand = match body.zeitstand.as_deref() {
        Some(z) => normalisiere_zeit(z)?,
        None => jetzt(),
    };
    let anzeige =
        befehl_repo::fortschreiben(&state.pool, einsatz_id, bid, benutzer.id, &zeitstand).await?;
    sse_befehl(&state, einsatz_id, anzeige.id);
    Ok((StatusCode::CREATED, Json(anzeige)))
}
