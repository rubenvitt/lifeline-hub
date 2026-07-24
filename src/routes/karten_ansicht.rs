use crate::app::AppState;
use crate::einsatz::einstellungen::ist_gueltiger_basemap_modus;
use crate::einsatz::kontext::{EinsatzLesezugriff, EinsatzSchreibzugriff};
use crate::einsatz::modul::Lagekarte;
use crate::error::AppError;
use crate::extract::{JsonBody, PfadParam};
use crate::karten_ansicht::{ist_gueltiges_karten_theme, repo, KartenAnsichtAnzeige};
use crate::live::LiveEvent;
use axum::extract::{Query, State};
use axum::http::StatusCode;
use axum::Json;
use serde::Deserialize;

/// SSE-Notify (Lage-Karte): eine Kartenansicht hat sich geändert. Event-Tag
/// `karten_ansicht` — das Frontend filtert exakt darauf und invalidiert den
/// Ansichts-Cache des Einsatzes.
fn sse_ansicht(state: &AppState, einsatz_id: i64, ansicht_id: i64) {
    let data =
        serde_json::json!({ "einsatz_id": einsatz_id, "ansicht_id": ansicht_id }).to_string();
    state
        .live
        .publiziere_event(einsatz_id, LiveEvent::KartenAnsicht, data);
}

/// GET /api/einsaetze/{id}/karten-ansichten — Liste der Ansichten des Einsatzes.
/// Legt lazy die Standardansicht an, falls noch keine existiert (Seed aus
/// `einsatz_einstellungen`). Läuft bewusst unter dem Lese-Gate — der Seed ist
/// race-fest und idempotent (s. `repo::standard_oder_saat`).
pub async fn liste(
    State(state): State<AppState>,
    ctx: EinsatzLesezugriff<Lagekarte>,
) -> Result<Json<Vec<KartenAnsichtAnzeige>>, AppError> {
    let einsatz_id = ctx.einsatz.id;
    repo::standard_oder_saat(&state.pool, einsatz_id).await?;
    let liste = repo::liste(&state.pool, einsatz_id).await?;
    Ok(Json(liste))
}

/// Isolierte Enum-Validierung (LFH-267: unbekannter Enum-Wert scheitert am Feld → 400).
fn validiere_enums(
    basemap_modus: Option<&str>,
    karten_theme: Option<&str>,
) -> Result<(), AppError> {
    if let Some(m) = basemap_modus {
        if !ist_gueltiger_basemap_modus(m) {
            return Err(AppError::Validation(format!(
                "Unbekannter basemap_modus: {m}"
            )));
        }
    }
    if let Some(t) = karten_theme {
        if !ist_gueltiges_karten_theme(t) {
            return Err(AppError::Validation(format!(
                "Unbekanntes karten_theme: {t}"
            )));
        }
    }
    Ok(())
}

/// POST /api/einsaetze/{id}/karten-ansichten — „Als neue Ansicht speichern": legt eine
/// weitere, benannte Ansicht an (nie Standard). Leerer Name scheitert am Feld → 400 (LFH-267),
/// unbekannter Enum-Wert → 400.
pub async fn anlegen(
    State(state): State<AppState>,
    ctx: EinsatzSchreibzugriff<Lagekarte>,
    PfadParam(_id): PfadParam<i64>,
    JsonBody(req): JsonBody<repo::AnsichtNeu>,
) -> Result<(StatusCode, Json<KartenAnsichtAnzeige>), AppError> {
    if req.name.trim().is_empty() {
        return Err(AppError::Validation(
            "Der Ansichts-Name darf nicht leer sein".into(),
        ));
    }
    validiere_enums(req.basemap_modus.as_deref(), req.karten_theme.as_deref())?;
    let einsatz_id = ctx.einsatz.id;
    let ansicht = repo::anlegen(&state.pool, einsatz_id, &req, ctx.benutzer.id).await?;
    sse_ansicht(&state, einsatz_id, ansicht.id);
    Ok((StatusCode::CREATED, Json(ansicht)))
}

/// PATCH /api/einsaetze/{id}/karten-ansichten/{aid} — vereint drei unabhängige Operationen
/// (LFH-320): „Für den Einsatz speichern" (Config-Vollersatz, NUR wenn Config-Felder im
/// Body — sonst würde ein reines Umbenennen die Config auf NULL wischen), Umbenennen und
/// Standard-Setzen. Enum-Felder isoliert validiert → 400; eine fremde Ansicht → 404.
pub async fn patch(
    State(state): State<AppState>,
    ctx: EinsatzSchreibzugriff<Lagekarte>,
    PfadParam((_id, aid)): PfadParam<(i64, i64)>,
    JsonBody(req): JsonBody<repo::AnsichtPatch>,
) -> Result<Json<KartenAnsichtAnzeige>, AppError> {
    validiere_enums(req.basemap_modus.as_deref(), req.karten_theme.as_deref())?;
    let einsatz_id = ctx.einsatz.id;
    let benutzer_id = ctx.benutzer.id;

    // Config-Vollersatz nur bei Config-Feldern (Advisor-Falle: sonst wischt ein Rename die
    // Config). Die Ownership-Prüfung (404) trägt der abschließende `laden`.
    if req.hat_config() {
        repo::patche(&state.pool, einsatz_id, aid, &req, benutzer_id).await?;
    }
    if let Some(name) = req.name.as_deref() {
        let name = name.trim();
        if name.is_empty() {
            return Err(AppError::Validation(
                "Der Ansichts-Name darf nicht leer sein".into(),
            ));
        }
        repo::benenne_um(&state.pool, einsatz_id, aid, name, benutzer_id).await?;
    }
    if req.ist_standard == Some(true) {
        repo::setze_standard(&state.pool, einsatz_id, aid, benutzer_id).await?;
    }

    let ansicht = repo::laden(&state.pool, einsatz_id, aid)
        .await?
        .ok_or(AppError::NotFound)?;
    sse_ansicht(&state, einsatz_id, ansicht.id);
    Ok(Json(ansicht))
}

/// Query-Param `?objekte=freigeben|loeschen` für den Ansichts-DELETE. Default: freigeben.
#[derive(Debug, Deserialize)]
pub struct LoeschParams {
    objekte: Option<String>,
}

/// DELETE /api/einsaetze/{id}/karten-ansichten/{aid} — löscht eine Ansicht. `?objekte=freigeben`
/// (Default) gibt die gebundenen Objekte auf „alle Ansichten" frei; `?objekte=loeschen` löscht
/// sie mit. Standardansicht/letzte Ansicht → 422; fremde Ansicht → 404; unbekannter
/// `objekte`-Wert scheitert am Feld → 400 (LFH-267).
pub async fn loeschen(
    State(state): State<AppState>,
    ctx: EinsatzSchreibzugriff<Lagekarte>,
    PfadParam((_id, aid)): PfadParam<(i64, i64)>,
    Query(params): Query<LoeschParams>,
) -> Result<StatusCode, AppError> {
    let behandlung = match params.objekte.as_deref() {
        None | Some("freigeben") => repo::ObjektBehandlung::Freigeben,
        Some("loeschen") => repo::ObjektBehandlung::Loeschen,
        Some(other) => {
            return Err(AppError::Validation(format!(
                "Unbekannter Wert für objekte: {other}"
            )));
        }
    };
    let einsatz_id = ctx.einsatz.id;
    repo::loesche(&state.pool, einsatz_id, aid, behandlung).await?;
    sse_ansicht(&state, einsatz_id, aid);
    Ok(StatusCode::NO_CONTENT)
}
