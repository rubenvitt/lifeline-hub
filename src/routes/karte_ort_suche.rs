//! GET /api/einsaetze/:id/karte/ort-suche?q=
//!
//! Adresssuche der Lagekarte (LFH-638, Spec `lagekarte-ortssuche`): Suchtext → bis zu fünf
//! Treffer über den Geocoder der Organisation (Default Nominatim). Mit verortetem Einsatzort
//! bevorzugt die Suche dessen Umgebung (`viewbox`, `bounded=0`).
//!
//! Wie die Ort-Vorschau ist der Geocoder Beiwerk: ein Ausfall oder das erschöpfte Rate-Limit
//! kommen als `zustand` mit 200, nie als Fehlerstatus. 400 gibt es nur für den Suchtext selbst
//! (`src/AGENTS.md`, Statuscode-Konvention). Am Modul Lagekarte gegatet (Präfix `/karte`).

use crate::app::AppState;
use crate::einsatz::kontext::EinsatzLesezugriff;
use crate::einsatz::modul::Lagekarte;
use crate::error::AppError;
use crate::geocoding::{self, suche};
use crate::org::einstellungen as org_einst;
use crate::wire_enum::wire_enum;
use axum::extract::{Query, State};
use axum::Json;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

/// Länge des getrimmten Suchtexts in Zeichen.
const Q_MIN: usize = 3;
const Q_MAX: usize = 200;

#[derive(Debug, Deserialize)]
pub struct OrtSucheParams {
    /// `Option`, damit ein fehlender Parameter im `{error}`-Format als 400 ankommt.
    pub q: Option<String>,
}

wire_enum! {
    /// Ausgang der Adresssuche. `ok` ohne Treffer heißt „nichts gefunden“.
    #[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]
    pub enum OrtSucheZustand {
        Ok => "ok",
        /// Rate-Limit des Geocoders erschöpft; gleich erneut versuchen.
        Ausgelastet => "ausgelastet",
        /// Geocoder nicht erreichbar, Zeitüberschreitung oder unlesbare Antwort.
        NichtErreichbar => "nicht_erreichbar",
    }
}

#[derive(Debug, Serialize, ToSchema)]
pub struct OrtTreffer {
    pub lat: f64,
    pub lon: f64,
    /// Anzeigename des Geocoders (bei Nominatim `display_name`).
    pub name: String,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct OrtSucheAntwort {
    pub zustand: OrtSucheZustand,
    pub treffer: Vec<OrtTreffer>,
}

/// Getrimmter Suchtext oder 400.
fn pruefe_suchtext(q: Option<String>) -> Result<String, AppError> {
    let q = q.unwrap_or_default();
    let q = q.trim();
    let n = q.chars().count();
    if !(Q_MIN..=Q_MAX).contains(&n) {
        return Err(AppError::Validation(format!(
            "Suchtext muss {Q_MIN} bis {Q_MAX} Zeichen haben"
        )));
    }
    Ok(q.to_string())
}

pub async fn ort_suche(
    State(state): State<AppState>,
    ctx: EinsatzLesezugriff<Lagekarte>,
    Query(params): Query<OrtSucheParams>,
) -> Result<Json<OrtSucheAntwort>, AppError> {
    let q = pruefe_suchtext(params.q)?;

    // Bevorzugter Ausschnitt um den Einsatzort, falls verortet. Nur der Einsatzort, kein
    // weiteres Objekt: mehr Einsatzdaten verlassen den Server nicht (Spec, Datenschutz).
    let ausschnitt = match (ctx.einsatz.einsatzort_lat, ctx.einsatz.einsatzort_lon) {
        (Some(lat), Some(lon)) => Some(suche::Ausschnitt::um(lat, lon)),
        _ => None,
    };

    let org = org_einst::laden_oder_default(&state.pool, ctx.einsatz.org_id).await?;
    let base = org
        .geocoder_url
        .as_deref()
        .unwrap_or(geocoding::NOMINATIM_DEFAULT);

    let antwort = match geocoding::suche(base, &q, ausschnitt).await {
        suche::SuchErgebnis::Ok(treffer) => OrtSucheAntwort {
            zustand: OrtSucheZustand::Ok,
            treffer: treffer
                .into_iter()
                .map(|t| OrtTreffer {
                    lat: t.lat,
                    lon: t.lon,
                    name: t.name,
                })
                .collect(),
        },
        suche::SuchErgebnis::Ausgelastet => OrtSucheAntwort {
            zustand: OrtSucheZustand::Ausgelastet,
            treffer: vec![],
        },
        suche::SuchErgebnis::NichtErreichbar => OrtSucheAntwort {
            zustand: OrtSucheZustand::NichtErreichbar,
            treffer: vec![],
        },
    };
    Ok(Json(antwort))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn suchtext_grenzen() {
        assert!(pruefe_suchtext(None).is_err());
        assert!(pruefe_suchtext(Some("  ab  ".into())).is_err());
        assert_eq!(pruefe_suchtext(Some("  abc ".into())).unwrap(), "abc");
        // Zeichen, nicht Bytes: „ä“ zählt einmal.
        assert!(pruefe_suchtext(Some("äöü".into())).is_ok());
        assert!(pruefe_suchtext(Some("x".repeat(200))).is_ok());
        assert!(pruefe_suchtext(Some("x".repeat(201))).is_err());
    }
}
