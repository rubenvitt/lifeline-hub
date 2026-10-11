//! GET /api/einsaetze/:id/karte/ort-suche?q=
//!
//! Adresssuche der Lagekarte (LFH-638, Spec `lagekarte-ortssuche`): Suchtext → bis zu fünf
//! Treffer über den Geocoder der Organisation (Default Nominatim). Mit verortetem Einsatzort
//! bevorzugt die Suche dessen Umgebung (`viewbox`, `bounded=0`). Kern, Zustände und Grenzen in
//! [`crate::routes::ort_suche`]. Am Modul Lagekarte gegatet (Präfix `/karte`).

use crate::app::AppState;
use crate::einsatz::kontext::EinsatzLesezugriff;
use crate::einsatz::modul::Lagekarte;
use crate::error::AppError;
use crate::routes::ort_suche::{ausschnitt_um, suchen, OrtSucheAntwort, OrtSucheParams};
use axum::extract::{Query, State};
use axum::Json;

pub async fn ort_suche(
    State(state): State<AppState>,
    ctx: EinsatzLesezugriff<Lagekarte>,
    Query(params): Query<OrtSucheParams>,
) -> Result<Json<OrtSucheAntwort>, AppError> {
    let ausschnitt = ausschnitt_um(ctx.einsatz.einsatzort_lat, ctx.einsatz.einsatzort_lon);
    Ok(Json(
        suchen(&state.pool, ctx.einsatz.org_id, params.q, ausschnitt).await?,
    ))
}
