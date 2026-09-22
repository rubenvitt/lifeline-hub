//! Modulzähler des Einsatz-Navigationsrahmens (LFH-612). Fachlogik und Bedeutung je Modul:
//! [`crate::einsatz::zaehler`].

use crate::app::AppState;
use crate::einsatz::berechtigung::erlaubte_module;
use crate::einsatz::kontext::EinsatzLesezugriff;
use crate::einsatz::zaehler::{self, ModulZaehlerAnzeige};
use crate::error::AppError;
use axum::extract::State;
use axum::Json;

/// GET /api/einsaetze/{id}/modul-zaehler — ein Zähler je erlaubtem Modul.
///
/// `EinsatzLesezugriff<OhneModul>`: Org-Floor + Lesezugriff, **kein** Modul-Gate — die Route
/// gehört keinem Modul (wie `/live`). Die Modulrechte wirken als Filter über die Felder: ein
/// nicht erlaubtes Modul fehlt in der Antwort, statt dass die ganze Antwort 403 wäre.
pub async fn liste(
    State(state): State<AppState>,
    ctx: EinsatzLesezugriff,
) -> Result<Json<ModulZaehlerAnzeige>, AppError> {
    let einsatz_id = ctx.einsatz.id;
    let erlaubt =
        erlaubte_module(&state.pool, einsatz_id, ctx.einsatz.org_id, &ctx.benutzer).await?;
    let jetzt = chrono::Utc::now().format("%Y-%m-%d %H:%M:%S").to_string();
    Ok(Json(
        zaehler::berechne(&state.pool, einsatz_id, &ctx.benutzer, &erlaubt, &jetzt).await?,
    ))
}
