//! Zugangsprotokoll der Verwaltung (LFH-1097): Anmelde- und Admin-Spur lesen.
//!
//! | Methode | Pfad | Zweck |
//! |---|---|---|
//! | GET | `/api/zugangsprotokoll/anmeldungen` | Anmeldespur (`auth_audit`) |
//! | GET | `/api/zugangsprotokoll/zugangsaenderungen` | Admin-Spur (`admin_audit`) |
//!
//! Filter: `von`, `bis` (ISO-8601, einschließlich), `konto` (Benutzername), `ereignis` bzw.
//! `aktion`; Cursor `vor_id`, Seitengröße `limit`. Nur System-Admin (`AdminUser`): die Spuren
//! sind Personen- und Beschäftigtendaten ohne Einsatzbezug. **Das Lesen schreibt keine Spur**
//! (wie die Einsicht ins Personen-Zugriffsprotokoll); Herleitung in
//! `/mnt/project-files/lfh-1097/design.md` (D1–D4).

use crate::app::AppState;
use crate::auth::admin_audit::{self, AdminAktion, ZugangsaenderungAnzeige};
use crate::auth::audit::{self, AnmeldeEintragAnzeige, Ereignis};
use crate::auth::benutzername;
use crate::auth::session::AdminUser;
use crate::auth::spur::{SpurFilter, MAX_LIMIT, STANDARD_LIMIT};
use crate::error::AppError;
use crate::etb::normalisiere_zeit;
use crate::routes::support::parse_enum_opt;
use axum::extract::{Query, State};
use axum::Json;
use serde::Deserialize;

/// Filter beider Spuren. Eine Struktur für beide Routen: `#[serde(flatten)]` bricht mit
/// `serde_urlencoded` die Zahlenfelder.
#[derive(Debug, Deserialize)]
pub struct SpurParams {
    pub von: Option<String>,
    pub bis: Option<String>,
    pub konto: Option<String>,
    /// Nur Anmeldespur.
    pub ereignis: Option<String>,
    /// Nur Admin-Spur.
    pub aktion: Option<String>,
    pub vor_id: Option<i64>,
    pub limit: Option<i64>,
}

/// Prüft die gemeinsamen Filter: jedes Feld für sich (400), dann den Zeitraum als
/// Zusammenhang (422, `src/AGENTS.md`, Statuscode-Konvention).
fn spur_filter(params: &SpurParams) -> Result<SpurFilter, AppError> {
    let von = leer_als_none(params.von.as_deref())
        .map(normalisiere_zeit)
        .transpose()?;
    let bis = leer_als_none(params.bis.as_deref())
        .map(normalisiere_zeit)
        .transpose()?;
    // Gekürzt wie beim Schreiben, sonst träfe ein langer Name nie seinen Eintrag.
    let konto = leer_als_none(params.konto.as_deref())
        .map(benutzername::normalisiere)
        .transpose()?
        .map(|name| benutzername::fuer_protokoll(&name).into_owned());
    if let (Some(von), Some(bis)) = (&von, &bis) {
        if bis < von {
            return Err(AppError::UnprocessableEntity("bis liegt vor von".into()));
        }
    }
    Ok(SpurFilter {
        von,
        bis,
        konto,
        vor_id: params.vor_id,
        limit: params.limit.unwrap_or(STANDARD_LIMIT).clamp(1, MAX_LIMIT),
    })
}

fn leer_als_none(wert: Option<&str>) -> Option<&str> {
    wert.filter(|w| !w.trim().is_empty())
}

/// GET /api/zugangsprotokoll/anmeldungen — Anmeldespur, neueste zuerst.
pub async fn anmeldungen(
    State(state): State<AppState>,
    _admin: AdminUser,
    Query(params): Query<SpurParams>,
) -> Result<Json<Vec<AnmeldeEintragAnzeige>>, AppError> {
    let ereignis = parse_enum_opt(
        Ereignis::parse,
        leer_als_none(params.ereignis.as_deref()),
        "Unbekanntes Ereignis im Filter",
    )?;
    let filter = spur_filter(&params)?;
    Ok(Json(audit::liste(&state.pool, &filter, ereignis).await?))
}

/// GET /api/zugangsprotokoll/zugangsaenderungen — Admin-Spur, neueste zuerst.
pub async fn zugangsaenderungen(
    State(state): State<AppState>,
    _admin: AdminUser,
    Query(params): Query<SpurParams>,
) -> Result<Json<Vec<ZugangsaenderungAnzeige>>, AppError> {
    let aktion = parse_enum_opt(
        AdminAktion::parse,
        leer_als_none(params.aktion.as_deref()),
        "Unbekannte Aktion im Filter",
    )?;
    let filter = spur_filter(&params)?;
    Ok(Json(
        admin_audit::liste(&state.pool, &filter, aktion).await?,
    ))
}
