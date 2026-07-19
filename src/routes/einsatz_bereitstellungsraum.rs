use crate::app::AppState;
use crate::auth::session::CurrentUser;
use crate::bereitstellungsraum::belegung_repo;
use crate::bereitstellungsraum::repo::{self as br_repo, NeueDaten, PatchDaten};
use crate::bereitstellungsraum::{BrAnzeige, BrBelegungAnzeige, BrStatus};
use crate::einsatz::berechtigung::{
    fordere_aktiv, fordere_lesezugriff, fordere_modul_zugriff_laden, fordere_schreibrecht,
};
use crate::einsatz::repo as einsatz_repo;
use crate::extract::JsonBody;
use crate::live::LiveEvent;

/// Modul-Key dieses Route-Moduls (LFH-132).
const MODUL_KEY: &str = "bereitstellungsraeume";
use crate::error::AppError;
use crate::routes::support::trimme;
use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::Json;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

/// Detail-Antwort: BR-Stamm + aktuell bereitgestellte Einheiten + Fahrzeuge.
#[derive(Debug, Serialize, ToSchema)]
pub struct BrDetail {
    #[serde(flatten)]
    pub br: BrAnzeige,
    pub einheiten: Vec<BrEinheitKurz>,
    pub fahrzeuge: Vec<BrFahrzeugKurz>,
}

/// Schlanke Einheiten-Info für den Detail-Response.
#[derive(Debug, Serialize, sqlx::FromRow, ToSchema)]
pub struct BrEinheitKurz {
    pub id: i64,
    pub name: String,
}

/// Schlanke Fahrzeug-Info für den Detail-Response.
#[derive(Debug, Serialize, sqlx::FromRow, ToSchema)]
pub struct BrFahrzeugKurz {
    pub id: i64,
    pub funkrufname: String,
}

// ---------- ETB-/SSE-Helfer ----------

fn sse_br(state: &AppState, einsatz_id: i64, br_id: i64) {
    let data = serde_json::json!({ "einsatz_id": einsatz_id, "br_id": br_id }).to_string();
    state
        .live
        .publiziere_event(einsatz_id, LiveEvent::Bereitstellungsraum, data);
}

// ---------- Detail-Helfer ----------

async fn lade_detail(state: &AppState, einsatz_id: i64, br_id: i64) -> Result<BrDetail, AppError> {
    let br = br_repo::laden(&state.pool, einsatz_id, br_id).await?;
    let einheiten = sqlx::query_as::<_, BrEinheitKurz>(
        "SELECT id, name FROM einsatz_einheit WHERE aktueller_br_id = ? AND einsatz_id = ?",
    )
    .bind(br_id)
    .bind(einsatz_id)
    .fetch_all(&state.pool)
    .await?;
    let fahrzeuge = sqlx::query_as::<_, BrFahrzeugKurz>(
        "SELECT id, snap_funkrufname AS funkrufname \
         FROM einsatz_fahrzeug WHERE aktueller_br_id = ? AND einsatz_id = ?",
    )
    .bind(br_id)
    .bind(einsatz_id)
    .fetch_all(&state.pool)
    .await?;
    Ok(BrDetail {
        br,
        einheiten,
        fahrzeuge,
    })
}

// ============================== Routen ==============================

#[derive(Debug, Deserialize)]
pub struct ListeParams {
    pub status: Option<String>,
    pub abschnitt_id: Option<i64>,
}

/// GET /api/einsaetze/{id}/bereitstellungsraeume
pub async fn liste(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Path(einsatz_id): Path<i64>,
    Query(params): Query<ListeParams>,
) -> Result<Json<Vec<BrAnzeige>>, AppError> {
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

    if let Some(s) = &params.status {
        if BrStatus::parse(s).is_none() {
            return Err(AppError::Validation(
                "Unbekannter BR-Status im Filter".into(),
            ));
        }
    }
    Ok(Json(
        br_repo::liste(
            &state.pool,
            einsatz_id,
            params.status.as_deref(),
            params.abschnitt_id,
        )
        .await?,
    ))
}

#[derive(Debug, Deserialize)]
pub struct AnlegenBody {
    pub bezeichnung: String,
    pub abschnitt_id: Option<i64>,
    pub standort: Option<String>,
    pub notiz: Option<String>,
}

/// POST /api/einsaetze/{id}/bereitstellungsraeume
/// KEIN ETB-Eintrag (erst Inbetriebnahme ist lagerelevant). SSE.
pub async fn anlegen(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Path(einsatz_id): Path<i64>,
    JsonBody(body): JsonBody<AnlegenBody>,
) -> Result<(StatusCode, Json<BrAnzeige>), AppError> {
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

    let bezeichnung = body.bezeichnung.trim().to_string();
    if bezeichnung.is_empty() {
        return Err(AppError::Validation(
            "Bezeichnung darf nicht leer sein".into(),
        ));
    }
    let standort = trimme(body.standort);
    let notiz = trimme(body.notiz);

    let br = br_repo::anlegen(
        &state.pool,
        einsatz_id,
        benutzer.id,
        NeueDaten {
            bezeichnung: &bezeichnung,
            abschnitt_id: body.abschnitt_id,
            standort: standort.as_deref(),
            notiz: notiz.as_deref(),
        },
    )
    .await?;
    sse_br(&state, einsatz_id, br.id);
    Ok((StatusCode::CREATED, Json(br)))
}

/// GET /api/einsaetze/{id}/bereitstellungsraeume/{bid}
pub async fn detail(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Path((einsatz_id, br_id)): Path<(i64, i64)>,
) -> Result<Json<BrDetail>, AppError> {
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

    Ok(Json(lade_detail(&state, einsatz_id, br_id).await?))
}

#[derive(Debug, Deserialize)]
pub struct PatchBody {
    pub bezeichnung: Option<String>,
    #[serde(
        default,
        deserialize_with = "crate::routes::support::deserialize_optional_field"
    )]
    pub abschnitt_id: Option<Option<i64>>,
    #[serde(
        default,
        deserialize_with = "crate::routes::support::deserialize_optional_field"
    )]
    pub standort: Option<Option<String>>,
    #[serde(
        default,
        deserialize_with = "crate::routes::support::deserialize_optional_field"
    )]
    pub notiz: Option<Option<String>>,
}

/// PATCH /api/einsaetze/{id}/bereitstellungsraeume/{bid}
/// KEIN ETB-Eintrag. SSE.
pub async fn aktualisieren(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Path((einsatz_id, br_id)): Path<(i64, i64)>,
    JsonBody(body): JsonBody<PatchBody>,
) -> Result<Json<BrAnzeige>, AppError> {
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

    let vorher = br_repo::laden(&state.pool, einsatz_id, br_id).await?;
    if vorher.storniert_at.is_some() {
        return Err(AppError::Conflict(
            "Stornierter BR kann nicht geändert werden".into(),
        ));
    }

    let bezeichnung = body
        .bezeichnung
        .as_deref()
        .map(str::trim)
        .map(str::to_string);
    if let Some(b) = &bezeichnung {
        if b.is_empty() {
            return Err(AppError::Validation(
                "Bezeichnung darf nicht leer sein".into(),
            ));
        }
    }
    let standort = body
        .standort
        .map(|opt| opt.map(|s| s.trim().to_string()).filter(|s| !s.is_empty()));
    let notiz = body
        .notiz
        .map(|opt| opt.map(|s| s.trim().to_string()).filter(|s| !s.is_empty()));

    let nachher = br_repo::aktualisiere(
        &state.pool,
        einsatz_id,
        br_id,
        benutzer.id,
        PatchDaten {
            bezeichnung: bezeichnung.as_deref(),
            abschnitt_id: body.abschnitt_id,
            standort: standort.as_ref().map(|o| o.as_deref()),
            notiz: notiz.as_ref().map(|o| o.as_deref()),
        },
    )
    .await?;
    sse_br(&state, einsatz_id, br_id);
    Ok(Json(nachher))
}

#[derive(Debug, Deserialize)]
pub struct StatusBody {
    pub status: String,
}

/// POST /api/einsaetze/{id}/bereitstellungsraeume/{bid}/status
/// ETB-Spur bei → aktiv und → aufgeloest. SSE.
pub async fn status_wechsel(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Path((einsatz_id, br_id)): Path<(i64, i64)>,
    JsonBody(body): JsonBody<StatusBody>,
) -> Result<Json<BrAnzeige>, AppError> {
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

    if BrStatus::parse(&body.status).is_none() {
        return Err(AppError::Validation("Unbekannter Status".into()));
    }
    let vorher = br_repo::laden(&state.pool, einsatz_id, br_id).await?;
    if vorher.storniert_at.is_some() {
        return Err(AppError::Conflict(
            "Stornierter BR kann nicht geändert werden".into(),
        ));
    }
    // F06/LFH-244 Tier-A: Status-UPDATE + System-ETB-Eintrag atomar in EINER Tx
    // (BEGIN IMMEDIATE + Retry). Der ETB-Text ist aus `vorher` berechenbar — die
    // Bezeichnung ändert sich beim Status-Wechsel nicht, daher kein In-Tx-Reload nötig.
    // darf_uebergehen/Belegungs-Vorbedingung prüft `setze_status_tx` in der Tx; SSE erst
    // nach dem Commit (Reinheits-Kontrakt).
    let etb_text = match body.status.as_str() {
        "aktiv" => Some(format!(
            "Bereitstellungsraum {} in Betrieb genommen",
            vorher.bezeichnung
        )),
        "aufgeloest" => Some(format!(
            "Bereitstellungsraum {} aufgelöst",
            vorher.bezeichnung
        )),
        _ => None,
    };
    let startwert = crate::einsatz::einstellungen::laden_oder_default(&state.pool, einsatz_id)
        .await?
        .etb_startwert();
    let nachher = crate::write_retry!(&state.pool, |conn| {
        let nachher =
            br_repo::setze_status_tx(conn, einsatz_id, br_id, &body.status, benutzer.id).await?;
        if let Some(text) = &etb_text {
            crate::etb::system_audit_tx(conn, einsatz_id, benutzer.id, startwert, text).await?;
        }
        Ok(nachher)
    })?;
    sse_br(&state, einsatz_id, br_id);
    Ok(Json(nachher))
}

/// DELETE /api/einsaetze/{id}/bereitstellungsraeume/{bid}
/// Soft-Delete. KEIN ETB. SSE.
pub async fn stornieren(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Path((einsatz_id, br_id)): Path<(i64, i64)>,
) -> Result<StatusCode, AppError> {
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

    br_repo::storniere(&state.pool, einsatz_id, br_id, benutzer.id).await?;
    sse_br(&state, einsatz_id, br_id);
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Debug, Deserialize)]
pub struct BelegungBody {
    pub objekt_typ: String,
    pub objekt_id: i64,
    pub art: String,
    pub notiz: Option<String>,
}

/// POST /api/einsaetze/{id}/bereitstellungsraeume/{bid}/belegung
/// ETB bei Eintritt/Austritt/Wechsel mit realen Namen. SSE.
pub async fn belegung(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Path((einsatz_id, br_id)): Path<(i64, i64)>,
    JsonBody(body): JsonBody<BelegungBody>,
) -> Result<(StatusCode, Json<BrBelegungAnzeige>), AppError> {
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

    let notiz = trimme(body.notiz);

    let event = belegung_repo::belege(
        &state.pool,
        einsatz_id,
        br_id,
        &body.objekt_typ,
        body.objekt_id,
        &body.art,
        notiz.as_deref(),
        benutzer.id,
    )
    .await?;

    // ETB-Spur (nicht pseudonym): Objektname laden und ETB schreiben.
    let br = br_repo::laden(&state.pool, einsatz_id, br_id).await?;
    if let Some(etb_text) =
        belegungs_etb_text(&state.pool, einsatz_id, &br.bezeichnung, &event).await?
    {
        super::etb_system_degradiert(&state, einsatz_id, benutzer.id, &etb_text).await?;
    }

    sse_br(&state, einsatz_id, br_id);
    // Kräfte-Ansichten (Einheiten/Fahrzeuge) live refetchen lassen: zusätzliches
    // objekt-typ-spezifisches SSE-Event (typisiert via `LiveEvent`, analog `person` in UHS).
    let objekt_event = match event.objekt_typ.as_str() {
        "einheit" => Some(LiveEvent::Einheit),
        "fahrzeug" => Some(LiveEvent::Fahrzeug),
        _ => None,
    };
    if let Some(ev) = objekt_event {
        let data = serde_json::json!({ "einsatz_id": einsatz_id, "objekt_id": event.objekt_id })
            .to_string();
        state.live.publiziere_event(einsatz_id, ev, data);
    }
    Ok((StatusCode::CREATED, Json(event)))
}

/// Erstellt den ETB-Text für ein Belegungs-Event mit realem Objektnamen.
async fn belegungs_etb_text(
    pool: &sqlx::SqlitePool,
    einsatz_id: i64,
    br_bezeichnung: &str,
    event: &BrBelegungAnzeige,
) -> Result<Option<String>, AppError> {
    // `belege()` hat die Objekt-Existenz bereits geprüft; ein fehlender Name
    // wäre ein inkonsistenter Zustand → NotFound statt leerer ETB-Text.
    let obj_name = match event.objekt_typ.as_str() {
        "einheit" => sqlx::query_scalar::<_, String>(
            "SELECT name FROM einsatz_einheit WHERE id = ? AND einsatz_id = ?",
        )
        .bind(event.objekt_id)
        .bind(einsatz_id)
        .fetch_optional(pool)
        .await?
        .ok_or(AppError::NotFound)?,
        "fahrzeug" => sqlx::query_scalar::<_, String>(
            "SELECT snap_funkrufname FROM einsatz_fahrzeug WHERE id = ? AND einsatz_id = ?",
        )
        .bind(event.objekt_id)
        .bind(einsatz_id)
        .fetch_optional(pool)
        .await?
        .ok_or(AppError::NotFound)?,
        _ => return Ok(None),
    };

    let text = match event.art.as_str() {
        "eintritt" => format!(
            "{} tritt in Bereitstellungsraum {} ein",
            obj_name, br_bezeichnung
        ),
        "wechsel" => format!(
            "{} wechselt zu Bereitstellungsraum {}",
            obj_name, br_bezeichnung
        ),
        "austritt" => format!(
            "{} verlässt Bereitstellungsraum {}",
            obj_name, br_bezeichnung
        ),
        _ => return Ok(None),
    };
    Ok(Some(text))
}
