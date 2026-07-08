//! GET /api/einsaetze/:id/ort-vorschau?lat=&lon=&exclude=typ:id
//!
//! Liefert `{peilung, ortsname}` für die Koordinaten-Plausibilitätsprüfung.
//! Die Peilung (nächster verorteter Marker) wird bedingungslos berechnet; `ortsname`
//! wird via Reverse-Geocoding gefüllt (org-konfigurierbarer Geocoder, Cache, Rate-Limit).
//! Auth/Scope wie andere /api/einsaetze/:id/*-Routen (Einsatz-Mitglied, Lesezugriff).

use crate::app::AppState;
use crate::auth::session::CurrentUser;
use crate::einsatz::berechtigung::fordere_lesezugriff;
use crate::einsatz::repo as einsatz_repo;
use crate::error::AppError;
use crate::geocoding::{self, marker, peilung};
use crate::org::einstellungen as org_einst;
use axum::extract::{Path, Query, State};
use axum::Json;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

#[derive(Debug, Deserialize)]
pub struct OrtVorschauParams {
    pub lat: f64,
    pub lon: f64,
    /// `typ:id` der gerade bearbeiteten Entität (Selbst-Ausschluss), z. B. `uhs:7`.
    pub exclude: Option<String>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct PeilungAntwort {
    pub distanz_m: f64,
    pub richtung: String,
    pub bezug_label: String,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct OrtVorschauAntwort {
    pub peilung: Option<PeilungAntwort>,
    pub ortsname: Option<String>,
}

/// `"uhs:7"` → `("uhs", 7)`; ungültiges Format → None (Selbst-Ausschluss entfällt dann).
fn parse_exclude(s: &str) -> Option<(String, i64)> {
    let (typ, id) = s.split_once(':')?;
    Some((typ.to_string(), id.parse().ok()?))
}

pub async fn vorschau(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Path(einsatz_id): Path<i64>,
    Query(params): Query<OrtVorschauParams>,
) -> Result<Json<OrtVorschauAntwort>, AppError> {
    // Auth/Scope: Einsatz existiert + Lesezugriff (Mitgliedschaft/Retention).
    let einsatz = einsatz_repo::laden(&state.pool, einsatz_id).await?;
    let rolle = einsatz_repo::rolle_von(&state.pool, einsatz_id, benutzer.id).await?;
    fordere_lesezugriff(&benutzer, &einsatz, rolle)?;

    // Koordinaten-Plausibilität (400 bei out-of-range).
    if !(-90.0..=90.0).contains(&params.lat) || !(-180.0..=180.0).contains(&params.lon) {
        return Err(AppError::Validation("lat/lon außerhalb des gültigen Bereichs".into()));
    }

    // Peilung: bedingungslos.
    let marker = marker::lade_marker(&state.pool, einsatz_id).await?;
    let exclude = params.exclude.as_deref().and_then(parse_exclude);
    let peilung = peilung::naechster(
        &marker,
        params.lat,
        params.lon,
        exclude.as_ref().map(|(t, i)| (t.as_str(), *i)),
    )
    .map(|p| PeilungAntwort {
        distanz_m: p.distanz_m,
        richtung: p.richtung,
        bezug_label: p.bezug_label,
    });

    // Org-Einstellungen laden (DB-Fehler hier = echter 500; das `?` ist KEIN Geocoder-Fehlerpfad).
    let org = org_einst::laden_oder_default(&state.pool, einsatz.org_id).await?;
    let base = org.geocoder_url.as_deref().unwrap_or(geocoding::NOMINATIM_DEFAULT);
    // Ortsname best-effort: reverse() liefert bei offline/Timeout/Rate-Limit None — die Peilung
    // steht trotzdem, der Request wird nie wegen eines Geocoder-Fehlers abgebrochen.
    let ortsname = geocoding::reverse(&state.pool, base, params.lat, params.lon).await;

    Ok(Json(OrtVorschauAntwort { peilung, ortsname }))
}
