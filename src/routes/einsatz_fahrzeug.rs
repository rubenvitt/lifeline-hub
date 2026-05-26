use crate::app::AppState;
use crate::auth::session::CurrentUser;
use crate::einsatz::berechtigung::{fordere_aktiv, fordere_lesezugriff, fordere_schreibrecht};
use crate::einsatz::repo as einsatz_repo;
use crate::error::AppError;
use crate::etb::{self, repo as etb_repo};
use crate::fahrzeug::disposition_repo::{self, AdhocDaten};
use crate::fahrzeug::status_repo;
use crate::fahrzeug::EinsatzFahrzeugAnzeige;
use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::Json;
use serde::Deserialize;

/// Schreibt einen automatischen System-ETB-Eintrag für die handelnde Person und
/// publiziert ihn live (wie `routes::etb::erfassen`). Bewusst sequentiell nach der
/// Disposition (Entscheidung 4 der Spec: ETB = zusätzliche, append-only Spur).
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

fn trimme(s: Option<String>) -> Option<String> {
    s.map(|s| s.trim().to_string()).filter(|s| !s.is_empty())
}

/// GET /api/einsaetze/{id}/fahrzeuge — disponierte Fahrzeuge (aufgelöst). Nur Mitglieder/höhere Berechtigung.
pub async fn liste(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Path(einsatz_id): Path<i64>,
) -> Result<Json<Vec<EinsatzFahrzeugAnzeige>>, AppError> {
    let einsatz = einsatz_repo::laden(&state.pool, einsatz_id).await?;
    let rolle = einsatz_repo::rolle_von(&state.pool, einsatz_id, benutzer.id).await?;
    fordere_lesezugriff(&benutzer, &einsatz, rolle)?;
    Ok(Json(
        disposition_repo::liste(&state.pool, einsatz_id, einsatz.ist_aktiv()).await?,
    ))
}

#[derive(Debug, Deserialize)]
pub struct AdhocBody {
    pub funkrufname: String,
    pub fahrzeugtyp: Option<String>,
    pub kennzeichen: Option<String>,
    pub opta: Option<String>,
    pub traegerorganisation: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct DisponierenBody {
    pub fahrzeug_id: Option<i64>,
    pub adhoc: Option<AdhocBody>,
}

/// POST /api/einsaetze/{id}/fahrzeuge — Stamm-Fahrzeug disponieren ODER Ad-hoc anlegen.
/// Schreibberechtigt + aktiver Einsatz. Schreibt ETB-Eintrag.
pub async fn disponieren(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Path(einsatz_id): Path<i64>,
    Json(body): Json<DisponierenBody>,
) -> Result<(StatusCode, Json<EinsatzFahrzeugAnzeige>), AppError> {
    let einsatz = einsatz_repo::laden(&state.pool, einsatz_id).await?;
    let rolle = einsatz_repo::rolle_von(&state.pool, einsatz_id, benutzer.id).await?;
    fordere_schreibrecht(rolle)?;
    fordere_aktiv(&einsatz)?;

    let ef_id = match (body.fahrzeug_id, body.adhoc) {
        (Some(fahrzeug_id), None) => {
            disposition_repo::disponiere_stamm(
                &state.pool, einsatz_id, einsatz.org_id, fahrzeug_id, benutzer.id,
            )
            .await?
        }
        (None, Some(adhoc)) => {
            let funkrufname = adhoc.funkrufname.trim().to_string();
            if funkrufname.is_empty() {
                return Err(AppError::Validation("Funkrufname darf nicht leer sein".into()));
            }
            let fahrzeugtyp = trimme(adhoc.fahrzeugtyp);
            let kennzeichen = trimme(adhoc.kennzeichen);
            let opta = trimme(adhoc.opta);
            let traeger = trimme(adhoc.traegerorganisation);
            disposition_repo::disponiere_adhoc(
                &state.pool,
                einsatz_id,
                einsatz.org_id,
                AdhocDaten {
                    funkrufname: &funkrufname,
                    fahrzeugtyp: fahrzeugtyp.as_deref(),
                    kennzeichen: kennzeichen.as_deref(),
                    opta: opta.as_deref(),
                    traegerorganisation: traeger.as_deref(),
                },
                benutzer.id,
            )
            .await?
        }
        _ => {
            return Err(AppError::Validation(
                "Entweder fahrzeug_id (Stamm) oder adhoc angeben, nicht beides".into(),
            ))
        }
    };

    let anzeige = disposition_repo::laden_anzeige(&state.pool, einsatz_id, ef_id, true).await?;
    etb_system(
        &state,
        einsatz_id,
        benutzer.id,
        &format!("Fahrzeug «{}» disponiert", anzeige.funkrufname),
    )
    .await?;
    Ok((StatusCode::CREATED, Json(anzeige)))
}

#[derive(Debug, Deserialize)]
pub struct DispoPatchBody {
    pub status_id: Option<i64>,
    pub bemerkung: Option<String>,
}

/// PATCH /api/einsaetze/{id}/fahrzeuge/{ef_id} — Status und/oder Bemerkung.
/// Status-Wechsel schreibt ETB-Eintrag.
pub async fn aktualisieren(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Path((einsatz_id, ef_id)): Path<(i64, i64)>,
    Json(body): Json<DispoPatchBody>,
) -> Result<Json<EinsatzFahrzeugAnzeige>, AppError> {
    let einsatz = einsatz_repo::laden(&state.pool, einsatz_id).await?;
    let rolle = einsatz_repo::rolle_von(&state.pool, einsatz_id, benutzer.id).await?;
    fordere_schreibrecht(rolle)?;
    fordere_aktiv(&einsatz)?;

    // Status muss (aktiv) zur Org gehören.
    if let Some(sid) = body.status_id {
        if !status_repo::ist_in_org(&state.pool, einsatz.org_id, sid).await? {
            return Err(AppError::Validation("Unbekannter Status".into()));
        }
    }

    let vorher = disposition_repo::laden_anzeige(&state.pool, einsatz_id, ef_id, true).await?;
    // Bemerkung im Body gesetzt (auch "") → setzen (leer = löschen); absent/null →
    // unverändert lassen (COALESCE im Repo). Daher NICHT über `trimme` zu None kollabieren,
    // sonst ließe sich eine Bemerkung nie löschen.
    let bemerkung = body.bemerkung.as_deref().map(str::trim);
    disposition_repo::aktualisiere(&state.pool, einsatz_id, ef_id, body.status_id, bemerkung)
        .await?;
    let nachher = disposition_repo::laden_anzeige(&state.pool, einsatz_id, ef_id, true).await?;

    if vorher.status_id != nachher.status_id {
        let alt = vorher.status_label.as_deref().unwrap_or("—");
        let neu = nachher.status_label.as_deref().unwrap_or("—");
        etb_system(
            &state,
            einsatz_id,
            benutzer.id,
            &format!("Fahrzeug «{}»: Status «{}» → «{}»", nachher.funkrufname, alt, neu),
        )
        .await?;
    }
    Ok(Json(nachher))
}

/// DELETE /api/einsaetze/{id}/fahrzeuge/{ef_id} — aus dem Einsatz entfernen. Schreibt ETB-Eintrag.
pub async fn entfernen(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Path((einsatz_id, ef_id)): Path<(i64, i64)>,
) -> Result<StatusCode, AppError> {
    let einsatz = einsatz_repo::laden(&state.pool, einsatz_id).await?;
    let rolle = einsatz_repo::rolle_von(&state.pool, einsatz_id, benutzer.id).await?;
    fordere_schreibrecht(rolle)?;
    fordere_aktiv(&einsatz)?;

    let anzeige = disposition_repo::laden_anzeige(&state.pool, einsatz_id, ef_id, true).await?;
    disposition_repo::entferne(&state.pool, einsatz_id, ef_id).await?;
    etb_system(
        &state,
        einsatz_id,
        benutzer.id,
        &format!("Fahrzeug «{}» aus dem Einsatz entfernt", anzeige.funkrufname),
    )
    .await?;
    Ok(StatusCode::NO_CONTENT)
}
