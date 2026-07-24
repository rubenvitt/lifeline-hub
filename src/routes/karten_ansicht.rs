use crate::app::AppState;
use crate::einsatz::einstellungen::ist_gueltiger_basemap_modus;
use crate::einsatz::kontext::{EinsatzLesezugriff, EinsatzSchreibzugriff};
use crate::einsatz::modul::Lagekarte;
use crate::error::AppError;
use crate::extract::JsonBody;
use crate::karten_ansicht::{ist_gueltiges_karten_theme, repo, KartenAnsichtAnzeige};
use crate::live::LiveEvent;
use axum::extract::{Path, State};
use axum::Json;

/// SSE-Notify (Lage-Karte): eine Kartenansicht hat sich geändert. Event-Tag
/// `karten_ansicht` — das Frontend filtert exakt darauf und invalidiert den
/// Ansichts-Cache des Einsatzes.
fn sse_ansicht(state: &AppState, einsatz_id: i64, ansicht_id: i64) {
    let data = serde_json::json!({ "einsatz_id": einsatz_id, "ansicht_id": ansicht_id }).to_string();
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

/// PATCH /api/einsaetze/{id}/karten-ansichten/{aid} — „Für den Einsatz speichern":
/// überschreibt die Konfiguration der Ansicht (Vollersatz, s. `repo::AnsichtPatch`).
/// Enum-Felder werden isoliert validiert → 400 (LFH-267); eine fremde Ansicht → 404.
pub async fn patch(
    State(state): State<AppState>,
    ctx: EinsatzSchreibzugriff<Lagekarte>,
    Path((_id, aid)): Path<(i64, i64)>,
    JsonBody(req): JsonBody<repo::AnsichtPatch>,
) -> Result<Json<KartenAnsichtAnzeige>, AppError> {
    if let Some(m) = req.basemap_modus.as_deref() {
        if !ist_gueltiger_basemap_modus(m) {
            return Err(AppError::Validation(format!(
                "Unbekannter basemap_modus: {m}"
            )));
        }
    }
    if let Some(t) = req.karten_theme.as_deref() {
        if !ist_gueltiges_karten_theme(t) {
            return Err(AppError::Validation(format!("Unbekanntes karten_theme: {t}")));
        }
    }
    let einsatz_id = ctx.einsatz.id;
    let ansicht = repo::patche(&state.pool, einsatz_id, aid, &req, ctx.benutzer.id)
        .await?
        .ok_or(AppError::NotFound)?;
    sse_ansicht(&state, einsatz_id, ansicht.id);
    Ok(Json(ansicht))
}
