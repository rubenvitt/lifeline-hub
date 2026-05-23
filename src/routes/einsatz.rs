use crate::app::AppState;
use crate::auth::session::CurrentUser;
use crate::einsatz::berechtigung::{fordere_aktiv, fordere_einsatzleitung, fordere_mitglied};
use crate::einsatz::{repo, EinsatzAnzeige, EinsatzRolle, MitgliedAnzeige, EINSATZ_ROLLE_LEITUNG};
use crate::error::AppError;
use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::Json;
use serde::Deserialize;

#[derive(Debug, Deserialize)]
pub struct NeuerEinsatz {
    pub bezeichnung: String,
    pub stichwort: Option<String>,
}

/// POST /api/einsaetze — neuen Einsatz anlegen; Ersteller wird Einsatzleitung.
/// Erfordert Anlege-Berechtigung (System-Admin oder org-weite Führungskraft).
pub async fn anlegen(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Json(req): Json<NeuerEinsatz>,
) -> Result<(StatusCode, Json<EinsatzAnzeige>), AppError> {
    if !benutzer.darf_einsatz_anlegen() {
        return Err(AppError::Forbidden);
    }
    if req.bezeichnung.trim().is_empty() {
        return Err(AppError::Validation(
            "Bezeichnung darf nicht leer sein".into(),
        ));
    }
    let stichwort = req
        .stichwort
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty());

    let einsatz =
        repo::anlegen(&state.pool, req.bezeichnung.trim(), stichwort, benutzer.id).await?;
    Ok((
        StatusCode::CREATED,
        Json(einsatz.anzeige(Some(EINSATZ_ROLLE_LEITUNG.to_string()))),
    ))
}

/// GET /api/einsaetze — alle Einsätze mit der Rolle des Abfragenden (`meine_rolle`).
pub async fn liste(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
) -> Result<Json<Vec<EinsatzAnzeige>>, AppError> {
    Ok(Json(repo::liste_fuer(&state.pool, benutzer.id).await?))
}

/// GET /api/einsaetze/{id} — Einsatz-Detail; nur für Mitglieder.
pub async fn detail(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Path(id): Path<i64>,
) -> Result<Json<EinsatzAnzeige>, AppError> {
    let einsatz = repo::laden(&state.pool, id).await?;
    let rolle = repo::rolle_von(&state.pool, id, benutzer.id).await?;
    let rolle = fordere_mitglied(rolle)?;
    Ok(Json(einsatz.anzeige(Some(rolle.as_str().to_string()))))
}

/// POST /api/einsaetze/{id}/abschliessen — Einsatz abschließen (read-only).
/// Nur Einsatzleitung, nur wenn der Einsatz aktuell aktiv ist.
pub async fn abschliessen(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Path(id): Path<i64>,
) -> Result<Json<EinsatzAnzeige>, AppError> {
    let einsatz = repo::laden(&state.pool, id).await?;
    let rolle = repo::rolle_von(&state.pool, id, benutzer.id).await?;
    fordere_einsatzleitung(rolle)?;
    fordere_aktiv(&einsatz)?;

    let aktualisiert = repo::abschliessen(&state.pool, id, benutzer.id).await?;
    Ok(Json(
        aktualisiert.anzeige(rolle.map(|r| r.as_str().to_string())),
    ))
}

#[derive(Debug, Deserialize)]
pub struct MitgliedRolle {
    /// 'einsatzleitung' | 'fuehrungspersonal' | 'beobachter'.
    pub einsatz_rolle: String,
}

/// GET /api/einsaetze/{id}/mitglieder — Mitgliederliste; nur für Mitglieder.
pub async fn mitglieder(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Path(id): Path<i64>,
) -> Result<Json<Vec<MitgliedAnzeige>>, AppError> {
    repo::laden(&state.pool, id).await?; // 404, wenn der Einsatz nicht existiert
    let rolle = repo::rolle_von(&state.pool, id, benutzer.id).await?;
    fordere_mitglied(rolle)?;
    Ok(Json(repo::mitglieder(&state.pool, id).await?))
}

/// PUT /api/einsaetze/{id}/mitglieder/{benutzer_id} — Mitglied hinzufügen oder
/// dessen Rolle ändern. Nur Einsatzleitung, nur bei aktivem Einsatz.
/// Schützt die letzte Einsatzleitung vor Herabstufung.
pub async fn mitglied_setzen(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Path((id, ziel_id)): Path<(i64, i64)>,
    Json(req): Json<MitgliedRolle>,
) -> Result<Json<Vec<MitgliedAnzeige>>, AppError> {
    let einsatz = repo::laden(&state.pool, id).await?;
    let meine = repo::rolle_von(&state.pool, id, benutzer.id).await?;
    fordere_einsatzleitung(meine)?;
    fordere_aktiv(&einsatz)?;

    let neue_rolle = EinsatzRolle::parse(&req.einsatz_rolle)
        .ok_or_else(|| AppError::Validation("Ungültige einsatz_rolle".into()))?;

    // Ziel-Benutzer muss existieren und aktiv sein.
    let ziel_aktiv: Option<bool> = sqlx::query_scalar("SELECT aktiv FROM benutzer WHERE id = ?")
        .bind(ziel_id)
        .fetch_optional(&state.pool)
        .await?;
    match ziel_aktiv {
        None => return Err(AppError::NotFound),
        Some(false) => return Err(AppError::Validation("Benutzer ist deaktiviert".into())),
        Some(true) => {}
    }

    // Letzte Einsatzleitung nicht herabstufen.
    if neue_rolle != EinsatzRolle::Einsatzleitung {
        let aktuelle = repo::rolle_von(&state.pool, id, ziel_id).await?;
        if aktuelle == Some(EinsatzRolle::Einsatzleitung)
            && repo::zaehle_einsatzleitung(&state.pool, id).await? <= 1
        {
            return Err(AppError::Conflict(
                "Die letzte Einsatzleitung kann nicht herabgestuft werden".into(),
            ));
        }
    }

    repo::setze_rolle(&state.pool, id, ziel_id, neue_rolle).await?;
    Ok(Json(repo::mitglieder(&state.pool, id).await?))
}

/// DELETE /api/einsaetze/{id}/mitglieder/{benutzer_id} — Mitglied entfernen.
/// Nur Einsatzleitung, nur bei aktivem Einsatz.
/// Schützt die letzte Einsatzleitung vor Entfernung.
pub async fn mitglied_entfernen(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Path((id, ziel_id)): Path<(i64, i64)>,
) -> Result<Json<Vec<MitgliedAnzeige>>, AppError> {
    let einsatz = repo::laden(&state.pool, id).await?;
    let meine = repo::rolle_von(&state.pool, id, benutzer.id).await?;
    fordere_einsatzleitung(meine)?;
    fordere_aktiv(&einsatz)?;

    let ziel_rolle = repo::rolle_von(&state.pool, id, ziel_id)
        .await?
        .ok_or(AppError::NotFound)?;
    if ziel_rolle == EinsatzRolle::Einsatzleitung
        && repo::zaehle_einsatzleitung(&state.pool, id).await? <= 1
    {
        return Err(AppError::Conflict(
            "Die letzte Einsatzleitung kann nicht entfernt werden".into(),
        ));
    }

    repo::entferne(&state.pool, id, ziel_id).await?;
    Ok(Json(repo::mitglieder(&state.pool, id).await?))
}
