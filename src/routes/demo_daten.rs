//! Demo-Daten zur Laufzeit (LFH-690). Die Routen werden nur mit `--demo-daten` registriert
//! (`app::RouterOptionen`), die Handler sehen den Schalter deshalb nie: existiert die Route,
//! ist er an. Alle Endpunkte stehen hinter [`AdminUser`] (anonym 401, jede andere Rolle 403).
//!
//! Stand Block 1: Der Status meldet „nicht importiert“; Import, Neu-Import und Entfernen sind
//! Platzhalter mit 422, damit kein Rumpf still einen Erfolg meldet. Die echten Rümpfe folgen
//! mit dem Import (design.md D3).

use crate::auth::session::AdminUser;
use crate::demo::DemoDatenStatus;
use crate::error::AppError;
use axum::Json;

/// Meldung der Platzhalter, bis der Import gebaut ist.
const NOCH_NICHT_VERFUEGBAR: &str = "Demo-Import noch nicht verfügbar";

/// GET /api/demo-daten — Stand der Demo-Daten der eigenen Organisation.
pub async fn status(_admin: AdminUser) -> Result<Json<DemoDatenStatus>, AppError> {
    Ok(Json(DemoDatenStatus {
        importiert: false,
        import: None,
        bericht: None,
    }))
}

/// POST /api/demo-daten — Demo-Daten importieren (Platzhalter).
pub async fn importieren(_admin: AdminUser) -> Result<Json<DemoDatenStatus>, AppError> {
    Err(AppError::UnprocessableEntity(NOCH_NICHT_VERFUEGBAR.into()))
}

/// POST /api/demo-daten/neu — Demo-Daten entfernen und neu importieren (Platzhalter).
pub async fn neu_importieren(_admin: AdminUser) -> Result<Json<DemoDatenStatus>, AppError> {
    Err(AppError::UnprocessableEntity(NOCH_NICHT_VERFUEGBAR.into()))
}

/// DELETE /api/demo-daten — Demo-Daten entfernen (Platzhalter).
pub async fn entfernen(_admin: AdminUser) -> Result<Json<DemoDatenStatus>, AppError> {
    Err(AppError::UnprocessableEntity(NOCH_NICHT_VERFUEGBAR.into()))
}
