//! Zugriff auf Planungen (design.md D2): das Recht, Einsätze anzulegen (System-Admin oder
//! org-weite Führungskraft), in der eigenen Organisation. Ohne Recht 403, eine fremde oder
//! unbekannte Planung 404. Eine Gerätesitzung plant nicht (403).

use axum::extract::{FromRequestParts, Path};
use axum::http::request::Parts;
use std::collections::HashMap;

use crate::app::AppState;
use crate::auth::session::CurrentUser;
use crate::auth::Benutzer;
use crate::error::AppError;
use crate::geraet::GeraetKontext;

/// Ob der Benutzer Planungen lesen und schreiben darf.
pub fn darf_planen(benutzer: &Benutzer) -> bool {
    benutzer.darf_einsatz_anlegen()
}

/// Extractor für die Liste und das Anlegen: ein Benutzer, der planen darf (403 sonst).
pub struct Planer(pub Benutzer);

impl FromRequestParts<AppState> for Planer {
    type Rejection = AppError;

    async fn from_request_parts(parts: &mut Parts, state: &AppState) -> Result<Self, AppError> {
        let CurrentUser(benutzer) = CurrentUser::from_request_parts(parts, state).await?;
        if parts.extensions.get::<GeraetKontext>().is_some() || !darf_planen(&benutzer) {
            return Err(AppError::Forbidden);
        }
        Ok(Planer(benutzer))
    }
}

/// Extractor für jede Route unter `/api/planungen/{id}`: der Planer und die Kennung einer
/// Planung seiner Organisation. Erst das Recht (403), dann die Planung (404), damit ein
/// Benutzer ohne Recht nicht erfährt, welche Kennungen es gibt.
pub struct PlanungsZugriff {
    pub benutzer: Benutzer,
    pub planung_id: i64,
}

impl FromRequestParts<AppState> for PlanungsZugriff {
    type Rejection = AppError;

    async fn from_request_parts(parts: &mut Parts, state: &AppState) -> Result<Self, AppError> {
        let Planer(benutzer) = Planer::from_request_parts(parts, state).await?;
        let Path(params) = Path::<HashMap<String, String>>::from_request_parts(parts, state)
            .await
            .map_err(|_| AppError::NotFound)?;
        let planung_id: i64 = params
            .get("id")
            .and_then(|s| s.parse().ok())
            .ok_or(AppError::NotFound)?;
        let gehoert: bool =
            sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM planung WHERE id = ? AND org_id = ?)")
                .bind(planung_id)
                .bind(benutzer.org_id)
                .fetch_one(&state.pool)
                .await?;
        if !gehoert {
            return Err(AppError::NotFound);
        }
        Ok(PlanungsZugriff {
            benutzer,
            planung_id,
        })
    }
}
