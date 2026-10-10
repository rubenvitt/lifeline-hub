//! Zustand des Server-Rechners für die Verwaltung. Nur für System-Admins ([`AdminUser`]: anonym
//! 401, jede andere Rolle 403): Org-Verwalter können am Rechner nichts ändern.

use crate::app::AppState;
use crate::auth::session::AdminUser;
use crate::datentraeger::DatentraegerStatus;
use axum::{extract::State, Json};

/// GET /api/system/datentraeger — letztes Ergebnis der Datenträgerprüfung (LFH-1100). 200.
pub async fn datentraeger(
    State(state): State<AppState>,
    _admin: AdminUser,
) -> Json<DatentraegerStatus> {
    let (ergebnis, extern_zugesichert) = state.datentraeger.lesen();
    Json(DatentraegerStatus::aus(
        ergebnis.as_ref(),
        extern_zugesichert,
    ))
}
