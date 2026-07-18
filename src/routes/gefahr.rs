use crate::app::AppState;
use crate::auth::session::CurrentUser;
use crate::einsatz::berechtigung::{
    fordere_aktiv, fordere_lesezugriff, fordere_modul_zugriff_laden, fordere_schreibrecht,
};
use crate::einsatz::repo as einsatz_repo;

/// Modul-Key dieses Route-Moduls (LFH-132).
const MODUL_KEY: &str = "gefahrenzonen";
use crate::error::AppError;
use crate::gefahr::repo::{self as gefahr_repo, BewertungDaten};
use crate::gefahr::{self, GefahrBewertungAnzeige, GefahrengebietAnzeige};
use crate::routes::support::trimme;
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

/// GET /api/einsaetze/{id}/gefahrengebiete — alle Gefahrengebiete (Übersicht/Karten-Styling).
pub async fn gebiete(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Path(einsatz_id): Path<i64>,
) -> Result<Json<Vec<GefahrengebietAnzeige>>, AppError> {
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
    fordere_modul_zugriff_laden(
        &state.pool,
        einsatz_id,
        einsatz.org_id,
        MODUL_KEY,
        &benutzer,
    )
    .await?;
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
    fordere_modul_zugriff_laden(
        &state.pool,
        einsatz_id,
        einsatz.org_id,
        MODUL_KEY,
        &benutzer,
    )
    .await?;
    fordere_aktiv(&einsatz)?;
    let gebiet = gefahr_repo::gebiet_laden(&state.pool, einsatz_id, gid).await?; // Ownership-Gate

    if gefahr::Gefahrentyp::parse(&body.gefahrentyp).is_none() {
        return Err(AppError::UnprocessableEntity(format!(
            "Unbekannter Gefahrentyp: {}",
            body.gefahrentyp
        )));
    }
    if gefahr::Schutzobjekt::parse(&body.schutzobjekt).is_none() {
        return Err(AppError::UnprocessableEntity(format!(
            "Unbekanntes Schutzobjekt: {}",
            body.schutzobjekt
        )));
    }
    if gefahr::Warnstufe::parse(&body.warnstufe).is_none() {
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

    // F06/LFH-244 Tier-A: UPSERT + System-ETB-Eintrag atomar in EINER Tx (BEGIN IMMEDIATE
    // + Retry). ETB-Entscheidung/-Text folgen exakt dem alten Pfad: nur bei
    // Warnstufen-Änderung, aus der frisch geschriebenen Zelle (`z`) berechnet (der
    // Read-Vergleich gegen `alt` bleibt bewusst VOR der Tx — nur das Schreibpaar ist atomar).
    // SSE erst nach dem Commit (Reinheits-Kontrakt).
    let startwert = crate::einsatz::einstellungen::laden_oder_default(&state.pool, einsatz_id)
        .await?
        .etb_startwert();
    let z = crate::write_retry!(&state.pool, |conn| {
        let z = gefahr_repo::upsert_bewertung_tx(
            conn,
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
        if z.warnstufe.as_str() != alt {
            let g = gefahr::gefahrentyp_label(z.gefahrentyp.as_str());
            let o = gefahr::schutzobjekt_label(z.schutzobjekt.as_str());
            let gname = gebiet
                .label
                .clone()
                .unwrap_or_else(|| format!("Gefahrengebiet #{gid}"));
            let text = if z.warnstufe == gefahr::Warnstufe::Keine {
                format!("Gefahr «{g}» für «{o}» in «{gname}» aufgehoben.")
            } else {
                format!(
                    "Gefahr «{g}» für «{o}» in «{gname}» auf Warnstufe «{}» gesetzt.",
                    z.warnstufe.as_str()
                )
            };
            crate::etb::system_audit_tx(conn, einsatz_id, benutzer.id, startwert, &text).await?;
        }
        Ok(z)
    })?;
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
    fordere_modul_zugriff_laden(
        &state.pool,
        einsatz_id,
        einsatz.org_id,
        MODUL_KEY,
        &benutzer,
    )
    .await?;
    fordere_aktiv(&einsatz)?;
    gefahr_repo::gebiet_laden(&state.pool, einsatz_id, gid).await?; // Ownership-Gate
    let label = trimme(body.label);
    let g = gefahr_repo::gebiet_umbenennen(&state.pool, einsatz_id, gid, label.as_deref()).await?;
    sse_gefahr(&state, einsatz_id, gid);
    Ok(Json(g))
}
