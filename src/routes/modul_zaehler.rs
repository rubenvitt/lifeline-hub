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
    let mut erlaubt =
        erlaubte_module(&state.pool, einsatz_id, ctx.einsatz.org_id, &ctx.benutzer).await?;
    // Ein Gerät (LFH-892) zählt nur die Module seiner Ansicht.
    if let Some(g) = &ctx.geraet {
        erlaubt = g.schneide_module(erlaubt);
        // Personen und Meldungen zählen den ganzen Einsatz; ein UHS-Gerät sieht nur seine
        // Stelle (Stellenbindung) und bekommt diese Zähler deshalb nicht.
        if crate::geraet::stelle::stelle(Some(g)).is_some() {
            erlaubt.remove("personen");
            erlaubt.remove("meldungen");
        }
    }
    let jetzt = crate::zeit::jetzt();
    Ok(Json(
        zaehler::berechne(&state.pool, einsatz_id, &ctx.benutzer, &erlaubt, &jetzt).await?,
    ))
}
