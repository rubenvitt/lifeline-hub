use crate::app::AppState;
use crate::auth::session::CurrentUser;
use crate::einsatz::berechtigung::{
    fordere_aktiv, fordere_lesezugriff, fordere_modul_zugriff_laden, fordere_schreibrecht,
};
use crate::einsatz::repo as einsatz_repo;
use crate::live::LiveEvent;

/// Modul-Key dieses Route-Moduls (LFH-132).
const MODUL_KEY: &str = "lageberichte";
use crate::error::AppError;
use crate::etb::normalisiere_zeit;
use crate::lagebericht::repo::{self as lagebericht_repo, LageberichtAnzeige, LageberichtPatch};
use crate::lagebericht::{self, render_snapshot, validiere_freigabe, vorlage, Abschnitt};
use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::Json;
use serde::Deserialize;

/// Aktuelle Server-Zeit im SQLite-Format (Default-Zeitstand).
fn jetzt() -> String {
    chrono::Utc::now().format("%Y-%m-%d %H:%M:%S").to_string()
}

/// SSE-Notify: Lageberichte des Einsatzes haben sich geändert. Event-Tag `lagebericht`.
fn sse_lagebericht(state: &AppState, einsatz_id: i64, lb_id: i64) {
    let data = serde_json::json!({ "einsatz_id": einsatz_id, "lagebericht_id": lb_id }).to_string();
    state
        .live
        .publiziere_event(einsatz_id, LiveEvent::Lagebericht, data);
}

/// GET /api/einsaetze/{id}/lageberichte — Liste. Nur Lesezugriff (inkl. Beobachter).
pub async fn liste(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Path(einsatz_id): Path<i64>,
) -> Result<Json<Vec<LageberichtAnzeige>>, AppError> {
    let einsatz = einsatz_repo::laden(&state.pool, einsatz_id).await?;
    let rolle = einsatz_repo::rolle_von(&state.pool, einsatz_id, benutzer.id).await?;
    fordere_lesezugriff(&benutzer, &einsatz, rolle)?;
    fordere_modul_zugriff_laden(
        &state.pool,
        einsatz_id,
        einsatz.org_id,
        MODUL_KEY,
        &benutzer,
    )
    .await?;
    Ok(Json(
        lagebericht_repo::liste(&state.pool, einsatz_id).await?,
    ))
}

/// GET /api/einsaetze/{id}/lageberichte/{lid} — Detail. Nur Lesezugriff.
pub async fn detail(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Path((einsatz_id, lid)): Path<(i64, i64)>,
) -> Result<Json<LageberichtAnzeige>, AppError> {
    let einsatz = einsatz_repo::laden(&state.pool, einsatz_id).await?;
    let rolle = einsatz_repo::rolle_von(&state.pool, einsatz_id, benutzer.id).await?;
    fordere_lesezugriff(&benutzer, &einsatz, rolle)?;
    fordere_modul_zugriff_laden(
        &state.pool,
        einsatz_id,
        einsatz.org_id,
        MODUL_KEY,
        &benutzer,
    )
    .await?;
    Ok(Json(
        lagebericht_repo::laden(&state.pool, einsatz_id, lid).await?,
    ))
}

#[derive(Debug, Deserialize)]
pub struct AnlegenBody {
    pub vorlage: String,
    pub titel: String,
    pub zeitstand: Option<String>,
}

/// POST /api/einsaetze/{id}/lageberichte — Entwurf anlegen. Schreibrecht + aktiv.
pub async fn anlegen(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Path(einsatz_id): Path<i64>,
    Json(body): Json<AnlegenBody>,
) -> Result<(StatusCode, Json<LageberichtAnzeige>), AppError> {
    let einsatz = einsatz_repo::laden(&state.pool, einsatz_id).await?;
    let rolle = einsatz_repo::rolle_von(&state.pool, einsatz_id, benutzer.id).await?;
    fordere_schreibrecht(rolle)?;
    fordere_modul_zugriff_laden(
        &state.pool,
        einsatz_id,
        einsatz.org_id,
        MODUL_KEY,
        &benutzer,
    )
    .await?;
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

    let anzeige = lagebericht_repo::anlegen(
        &state.pool,
        einsatz_id,
        &body.vorlage,
        &titel,
        &zeitstand,
        benutzer.id,
    )
    .await?;
    sse_lagebericht(&state, einsatz_id, anzeige.id);
    Ok((StatusCode::CREATED, Json(anzeige)))
}

#[derive(Debug, Deserialize)]
pub struct PatchBody {
    pub titel: Option<String>,
    pub zeitstand: Option<String>,
    pub abschnitte: Option<Vec<Abschnitt>>,
}

/// PATCH /api/einsaetze/{id}/lageberichte/{lid} — nur solange Entwurf (sonst 422).
pub async fn aktualisieren(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Path((einsatz_id, lid)): Path<(i64, i64)>,
    Json(body): Json<PatchBody>,
) -> Result<Json<LageberichtAnzeige>, AppError> {
    let einsatz = einsatz_repo::laden(&state.pool, einsatz_id).await?;
    let rolle = einsatz_repo::rolle_von(&state.pool, einsatz_id, benutzer.id).await?;
    fordere_schreibrecht(rolle)?;
    fordere_modul_zugriff_laden(
        &state.pool,
        einsatz_id,
        einsatz.org_id,
        MODUL_KEY,
        &benutzer,
    )
    .await?;
    fordere_aktiv(&einsatz)?;

    let vorher = lagebericht_repo::laden(&state.pool, einsatz_id, lid).await?;
    if vorher.status != lagebericht::STATUS_ENTWURF {
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
        let v =
            vorlage(&vorher.vorlage).ok_or(AppError::Internal("Vorlage verschwunden".into()))?;
        for a in abs {
            if !v.abschnitte.iter().any(|d| d.schluessel == a.schluessel) {
                return Err(AppError::UnprocessableEntity(format!(
                    "Unbekannter Abschnitts-Schlüssel «{}»",
                    a.schluessel
                )));
            }
        }
    }

    let anzeige = lagebericht_repo::aktualisiere(
        &state.pool,
        einsatz_id,
        lid,
        LageberichtPatch {
            titel: titel.as_deref(),
            zeitstand: zeitstand.as_deref(),
            abschnitte: body.abschnitte.as_deref(),
        },
    )
    .await?;
    sse_lagebericht(&state, einsatz_id, lid);
    Ok(Json(anzeige))
}

/// POST /api/einsaetze/{id}/lageberichte/{lid}/freigeben — rendert + snapshottet ins ETB.
pub async fn freigeben(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Path((einsatz_id, lid)): Path<(i64, i64)>,
) -> Result<Json<LageberichtAnzeige>, AppError> {
    let einsatz = einsatz_repo::laden(&state.pool, einsatz_id).await?;
    let rolle = einsatz_repo::rolle_von(&state.pool, einsatz_id, benutzer.id).await?;
    fordere_schreibrecht(rolle)?;
    fordere_modul_zugriff_laden(
        &state.pool,
        einsatz_id,
        einsatz.org_id,
        MODUL_KEY,
        &benutzer,
    )
    .await?;
    fordere_aktiv(&einsatz)?;

    let bericht = lagebericht_repo::laden(&state.pool, einsatz_id, lid).await?;
    if bericht.status != lagebericht::STATUS_ENTWURF {
        return Err(AppError::UnprocessableEntity(
            "Bericht ist bereits freigegeben".into(),
        ));
    }
    let v = vorlage(&bericht.vorlage).ok_or(AppError::Internal("Vorlage verschwunden".into()))?;
    validiere_freigabe(v, &bericht.abschnitte)?;
    let render = render_snapshot(v, &bericht.titel, &bericht.zeitstand, &bericht.abschnitte);

    let anzeige = lagebericht_repo::freigeben(
        &state.pool,
        einsatz_id,
        lid,
        benutzer.id,
        &render,
        &bericht.zeitstand,
    )
    .await?;

    if let Some(etb_id) = anzeige.etb_eintrag_id {
        state.live.publiziere(einsatz_id, etb_id);
    }
    sse_lagebericht(&state, einsatz_id, lid);
    Ok(Json(anzeige))
}

#[derive(Debug, Deserialize)]
pub struct FortschreibenBody {
    pub zeitstand: Option<String>,
}

/// POST /api/einsaetze/{id}/lageberichte/{lid}/fortschreiben — neue Entwurfs-Version.
pub async fn fortschreiben(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Path((einsatz_id, lid)): Path<(i64, i64)>,
    Json(body): Json<FortschreibenBody>,
) -> Result<(StatusCode, Json<LageberichtAnzeige>), AppError> {
    let einsatz = einsatz_repo::laden(&state.pool, einsatz_id).await?;
    let rolle = einsatz_repo::rolle_von(&state.pool, einsatz_id, benutzer.id).await?;
    fordere_schreibrecht(rolle)?;
    fordere_modul_zugriff_laden(
        &state.pool,
        einsatz_id,
        einsatz.org_id,
        MODUL_KEY,
        &benutzer,
    )
    .await?;
    fordere_aktiv(&einsatz)?;

    let zeitstand = match body.zeitstand.as_deref() {
        Some(z) => normalisiere_zeit(z)?,
        None => jetzt(),
    };
    let anzeige =
        lagebericht_repo::fortschreiben(&state.pool, einsatz_id, lid, benutzer.id, &zeitstand)
            .await?;
    sse_lagebericht(&state, einsatz_id, anzeige.id);
    Ok((StatusCode::CREATED, Json(anzeige)))
}
