use crate::app::AppState;
use crate::auth::session::CurrentUser;
use crate::einsatz::berechtigung::{fordere_modul_zugriff, fordere_aktiv, fordere_lesezugriff, fordere_schreibrecht};
use crate::einsatz::repo as einsatz_repo;
use crate::einsatz::modul_override;

/// Modul-Key dieses Route-Moduls (LFH-132).
const MODUL_KEY: &str = "gefahrenzonen";
use crate::error::AppError;
use crate::etb::{self, repo as etb_repo};
use crate::gefahr::repo::{self as gefahr_repo, BewertungDaten};
use crate::gefahr::{self, GefahrBewertungAnzeige, GefahrengebietAnzeige};
use axum::extract::{Path, State};
use axum::Json;
use serde::Deserialize;

/// SSE-Notify: die Gefahrenmatrix eines Gebiets hat sich geändert. Event-Tag `gefahr`.
fn sse_gefahr(state: &AppState, einsatz_id: i64, gefahrengebiet_id: i64) {
    let data =
        serde_json::json!({ "einsatz_id": einsatz_id, "gefahrengebiet_id": gefahrengebiet_id })
            .to_string();
    state.live.publiziere_event(einsatz_id, "gefahr", data);
}

/// Schreibt einen System-ETB-Eintrag und publiziert ihn live (Muster wie lage_zone).
async fn etb_system(
    state: &AppState,
    einsatz_id: i64,
    benutzer_id: i64,
    inhalt: &str,
) -> Result<(), AppError> {
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

fn trimme(s: Option<String>) -> Option<String> {
    s.map(|s| s.trim().to_string()).filter(|s| !s.is_empty())
}

/// GET /api/einsaetze/{id}/gefahrengebiete — alle Gefahrengebiete (Übersicht/Karten-Styling).
pub async fn gebiete(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Path(einsatz_id): Path<i64>,
) -> Result<Json<Vec<GefahrengebietAnzeige>>, AppError> {
    let einsatz = einsatz_repo::laden(&state.pool, einsatz_id).await?;
    let rolle = einsatz_repo::rolle_von(&state.pool, einsatz_id, benutzer.id).await?;
    fordere_lesezugriff(&benutzer, &einsatz, rolle)?;
    let overrides = modul_override::laden_alle(&state.pool, einsatz_id).await?;
    fordere_modul_zugriff(&overrides, MODUL_KEY, &benutzer)?;
    Ok(Json(
        gefahr_repo::gebiete_liste(&state.pool, einsatz_id).await?,
    ))
}

/// GET /api/einsaetze/{id}/gefahrengebiete/{gid}/matrix — gesetzte Zellen eines Gebiets.
pub async fn matrix(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Path((einsatz_id, gid)): Path<(i64, i64)>,
) -> Result<Json<Vec<GefahrBewertungAnzeige>>, AppError> {
    let einsatz = einsatz_repo::laden(&state.pool, einsatz_id).await?;
    let rolle = einsatz_repo::rolle_von(&state.pool, einsatz_id, benutzer.id).await?;
    fordere_lesezugriff(&benutzer, &einsatz, rolle)?;
    let overrides = modul_override::laden_alle(&state.pool, einsatz_id).await?;
    fordere_modul_zugriff(&overrides, MODUL_KEY, &benutzer)?;
    // Ownership-Gate: Gebiet muss zum Einsatz gehören (sonst NotFound).
    gefahr_repo::gebiet_laden(&state.pool, einsatz_id, gid).await?;
    Ok(Json(gefahr_repo::liste(&state.pool, gid).await?))
}

#[derive(Debug, Deserialize)]
pub struct BewertungBody {
    pub gefahrentyp: String,
    pub schutzobjekt: String,
    pub warnstufe: String,
    pub beschreibung: Option<String>,
    pub gemeldet_von: Option<String>,
}

/// PUT /api/einsaetze/{id}/gefahrengebiete/{gid}/matrix/bewertung — Zelle setzen (UPSERT).
pub async fn bewerten(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Path((einsatz_id, gid)): Path<(i64, i64)>,
    Json(body): Json<BewertungBody>,
) -> Result<Json<GefahrBewertungAnzeige>, AppError> {
    let einsatz = einsatz_repo::laden(&state.pool, einsatz_id).await?;
    let rolle = einsatz_repo::rolle_von(&state.pool, einsatz_id, benutzer.id).await?;
    fordere_schreibrecht(rolle)?;
    let overrides = modul_override::laden_alle(&state.pool, einsatz_id).await?;
    fordere_modul_zugriff(&overrides, MODUL_KEY, &benutzer)?;
    fordere_aktiv(&einsatz)?;
    let gebiet = gefahr_repo::gebiet_laden(&state.pool, einsatz_id, gid).await?; // Ownership-Gate

    if !gefahr::GEFAHRENTYPEN.contains(&body.gefahrentyp.as_str()) {
        return Err(AppError::UnprocessableEntity(format!(
            "Unbekannter Gefahrentyp: {}",
            body.gefahrentyp
        )));
    }
    if !gefahr::SCHUTZOBJEKTE.contains(&body.schutzobjekt.as_str()) {
        return Err(AppError::UnprocessableEntity(format!(
            "Unbekanntes Schutzobjekt: {}",
            body.schutzobjekt
        )));
    }
    if !gefahr::WARNSTUFEN.contains(&body.warnstufe.as_str()) {
        return Err(AppError::UnprocessableEntity(format!(
            "Unbekannte Warnstufe: {}",
            body.warnstufe
        )));
    }
    if !gefahr::kombination_gueltig(&body.gefahrentyp, &body.schutzobjekt) {
        return Err(AppError::UnprocessableEntity(format!(
            "Kombination {} × {} ist nicht zulässig",
            body.gefahrentyp, body.schutzobjekt
        )));
    }

    let alt =
        gefahr_repo::aktuelle_warnstufe(&state.pool, gid, &body.gefahrentyp, &body.schutzobjekt)
            .await?
            .unwrap_or_else(|| "keine".to_string());

    let beschreibung = trimme(body.beschreibung.clone());
    let gemeldet_von = trimme(body.gemeldet_von.clone());
    let z = gefahr_repo::upsert_bewertung(
        &state.pool,
        gid,
        BewertungDaten {
            gefahrentyp: &body.gefahrentyp,
            schutzobjekt: &body.schutzobjekt,
            warnstufe: &body.warnstufe,
            beschreibung: beschreibung.as_deref(),
            gemeldet_von: gemeldet_von.as_deref(),
            aktualisiert_von: benutzer.id,
        },
    )
    .await?;

    if z.warnstufe != alt {
        let g = gefahr::gefahrentyp_label(&z.gefahrentyp);
        let o = gefahr::schutzobjekt_label(&z.schutzobjekt);
        let gname = gebiet
            .label
            .clone()
            .unwrap_or_else(|| format!("Gefahrengebiet #{gid}"));
        let text = if z.warnstufe == "keine" {
            format!("Gefahr «{g}» für «{o}» in «{gname}» aufgehoben.")
        } else {
            format!(
                "Gefahr «{g}» für «{o}» in «{gname}» auf Warnstufe «{}» gesetzt.",
                z.warnstufe
            )
        };
        etb_system(&state, einsatz_id, benutzer.id, &text).await?;
    }
    sse_gefahr(&state, einsatz_id, gid);
    Ok(Json(z))
}

#[derive(Debug, Deserialize)]
pub struct UmbenennenBody {
    pub label: Option<String>,
}

/// PATCH /api/einsaetze/{id}/gefahrengebiete/{gid} — Label des Gefahrengebiets ändern.
pub async fn umbenennen(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Path((einsatz_id, gid)): Path<(i64, i64)>,
    Json(body): Json<UmbenennenBody>,
) -> Result<Json<GefahrengebietAnzeige>, AppError> {
    let einsatz = einsatz_repo::laden(&state.pool, einsatz_id).await?;
    let rolle = einsatz_repo::rolle_von(&state.pool, einsatz_id, benutzer.id).await?;
    fordere_schreibrecht(rolle)?;
    let overrides = modul_override::laden_alle(&state.pool, einsatz_id).await?;
    fordere_modul_zugriff(&overrides, MODUL_KEY, &benutzer)?;
    fordere_aktiv(&einsatz)?;
    gefahr_repo::gebiet_laden(&state.pool, einsatz_id, gid).await?; // Ownership-Gate
    let label = trimme(body.label);
    let g = gefahr_repo::gebiet_umbenennen(&state.pool, einsatz_id, gid, label.as_deref()).await?;
    sse_gefahr(&state, einsatz_id, gid);
    Ok(Json(g))
}
