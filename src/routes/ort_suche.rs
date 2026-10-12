//! Gemeinsamer Kern der Ortssuche (LFH-638, LFH-1175): Suchtext prüfen, Geocoder der
//! Organisation fragen, Antwort bauen. Drei Einstiege teilen ihn (Spec `lagekarte-ortssuche`,
//! „Adresssuche über den Server mit Grenzen“; Spec `ortsfeld`):
//!
//! - `GET /api/einsaetze/:id/karte/ort-suche` — Lagekarte, am Modul gegatet
//!   (`routes::karte_ort_suche`);
//! - `GET /api/einsaetze/:id/ort-suche` — Ortsfeld im Einsatz, Recht der Einsatzdaten
//!   ([`im_einsatz`]);
//! - `GET /api/ort-suche` — Ortsfeld ohne Einsatz, wer Einsätze anlegen darf ([`in_org`]).
//!
//! Ein Ausfall oder das erschöpfte Rate-Limit kommen als `zustand` mit 200, nie als Fehlerstatus.
//! 400 gibt es nur für den Suchtext selbst (`src/AGENTS.md`, Statuscode-Konvention). Takt und
//! Cache sind prozessweit und gelten für alle Einstiege zusammen (`geocoding::suche`).

use crate::app::AppState;
use crate::auth::session::CurrentUser;
use crate::einsatz::kontext::EinsatzVerwaltungszugriff;
use crate::error::AppError;
use crate::geocoding::{self, suche};
use crate::org::einstellungen as org_einst;
use crate::wire_enum::wire_enum;
use axum::extract::{Query, State};
use axum::Json;
use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;
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
    /// Kurzadresse „Straße Nr, PLZ Ort“, wenn der Geocoder die Teile liefert (LFH-1175).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub kurz: Option<String>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct OrtSucheAntwort {
    pub zustand: OrtSucheZustand,
    pub treffer: Vec<OrtTreffer>,
}

/// Getrimmter Suchtext oder 400.
pub(crate) fn pruefe_suchtext(q: Option<String>) -> Result<String, AppError> {
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

/// Sucht `q` (ungeprüft) beim Geocoder der Organisation `org_id`, mit bevorzugtem Ausschnitt.
pub(crate) async fn suchen(
    pool: &SqlitePool,
    org_id: i64,
    q: Option<String>,
    ausschnitt: Option<suche::Ausschnitt>,
) -> Result<OrtSucheAntwort, AppError> {
    let q = pruefe_suchtext(q)?;
    let org = org_einst::laden_oder_default(pool, org_id).await?;
    let base = org
        .geocoder_url
        .as_deref()
        .unwrap_or(geocoding::NOMINATIM_DEFAULT);
    Ok(antwort_aus(geocoding::suche(base, &q, ausschnitt).await))
}

/// Ausschnitt um den Einsatzort, falls verortet. Nur der Einsatzort, kein weiteres Objekt: mehr
/// Einsatzdaten verlassen den Server nicht (Spec `lagekarte-ortssuche`, Datenschutz).
pub(crate) fn ausschnitt_um(lat: Option<f64>, lon: Option<f64>) -> Option<suche::Ausschnitt> {
    match (lat, lon) {
        (Some(lat), Some(lon)) => Some(suche::Ausschnitt::um(lat, lon)),
        _ => None,
    }
}

/// GET /api/einsaetze/:id/ort-suche?q= — Ortsfeld im Einsatz (LFH-1175). Dasselbe Recht wie der
/// PATCH der Kopfdaten, für den die Suche da ist; kein Modul-Gate. Bevorzugt die Umgebung des
/// Einsatzorts.
pub async fn im_einsatz(
    State(state): State<AppState>,
    ctx: EinsatzVerwaltungszugriff,
    Query(params): Query<OrtSucheParams>,
) -> Result<Json<OrtSucheAntwort>, AppError> {
    let ausschnitt = ausschnitt_um(ctx.einsatz.einsatzort_lat, ctx.einsatz.einsatzort_lon);
    Ok(Json(
        suchen(&state.pool, ctx.einsatz.org_id, params.q, ausschnitt).await?,
    ))
}

/// GET /api/ort-suche?q= — Ortsfeld ohne Einsatz, etwa beim Anlegen (LFH-1175). Nur wer Einsätze
/// anlegen darf; Geocoder der eigenen Organisation, ohne bevorzugte Umgebung (die Organisation
/// hat keinen Standort). Das Recht wird vor dem Suchtext geprüft: ohne Recht 403, nie 400.
pub async fn in_org(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Query(params): Query<OrtSucheParams>,
) -> Result<Json<OrtSucheAntwort>, AppError> {
    if !benutzer.darf_einsatz_anlegen() {
        return Err(AppError::Forbidden);
    }
    Ok(Json(
        suchen(&state.pool, benutzer.org_id, params.q, None).await?,
    ))
}

/// Ergebnis des Geocoders → Antwort. Rein und ohne `Result`: kein Ausgang des Geocoders wird zum
/// Fehlerstatus, das schließt schon der Typ aus.
fn antwort_aus(ergebnis: suche::SuchErgebnis) -> OrtSucheAntwort {
    match ergebnis {
        suche::SuchErgebnis::Ok(treffer) => OrtSucheAntwort {
            zustand: OrtSucheZustand::Ok,
            treffer: treffer
                .into_iter()
                .map(|t| OrtTreffer {
                    lat: t.lat,
                    lon: t.lon,
                    name: t.name,
                    kurz: t.kurz,
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
    }
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

    #[test]
    fn jeder_ausgang_des_geocoders_wird_ein_zustand() {
        let ok = antwort_aus(suche::SuchErgebnis::Ok(vec![suche::OrtTreffer {
            lat: 51.0,
            lon: 10.0,
            name: "Rathaus".into(),
            kurz: None,
        }]));
        assert_eq!(ok.zustand, OrtSucheZustand::Ok);
        assert_eq!(ok.treffer.len(), 1);
        assert_eq!(
            (
                ok.treffer[0].lat,
                ok.treffer[0].lon,
                ok.treffer[0].name.as_str()
            ),
            (51.0, 10.0, "Rathaus")
        );

        let leer = antwort_aus(suche::SuchErgebnis::Ok(vec![]));
        assert_eq!((leer.zustand, leer.treffer.len()), (OrtSucheZustand::Ok, 0));

        let ausgelastet = antwort_aus(suche::SuchErgebnis::Ausgelastet);
        assert_eq!(
            (ausgelastet.zustand, ausgelastet.treffer.len()),
            (OrtSucheZustand::Ausgelastet, 0)
        );

        let tot = antwort_aus(suche::SuchErgebnis::NichtErreichbar);
        assert_eq!(
            (tot.zustand, tot.treffer.len()),
            (OrtSucheZustand::NichtErreichbar, 0)
        );
    }
}
