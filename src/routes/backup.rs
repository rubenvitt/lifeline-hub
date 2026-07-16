use crate::app::AppState;
use crate::auth::session::AdminUser;
use crate::backup;
use crate::error::AppError;
use axum::extract::State;
use axum::http::{header, HeaderMap, HeaderValue};
use axum::response::IntoResponse;
use chrono::Local;

/// GET /api/backup — konsistente Sicherung der Datenbank als Download. Admin-only.
///
/// Erzeugt per `VACUUM INTO` einen Snapshot in einer temporären Datei, liest ihn
/// vollständig ein und liefert ihn als Datei-Download. Das Tempverzeichnis wird
/// beim Verlassen der Funktion automatisch wieder entfernt.
pub async fn download(
    State(state): State<AppState>,
    _admin: AdminUser,
) -> Result<impl IntoResponse, AppError> {
    let dir = tempfile::tempdir()
        .map_err(|e| AppError::Internal(format!("Tempverzeichnis fehlgeschlagen: {e}")))?;
    let pfad = dir.path().join("lifeline-backup.sqlite");

    backup::erzeuge_sicherung(&state.pool, &pfad).await?;

    let bytes = std::fs::read(&pfad)
        .map_err(|e| AppError::Internal(format!("Sicherung lesen fehlgeschlagen: {e}")))?;

    let dateiname = format!(
        "lifeline-backup-{}.sqlite",
        Local::now().format("%Y%m%d-%H%M%S")
    );
    let mut headers = HeaderMap::new();
    headers.insert(
        header::CONTENT_TYPE,
        HeaderValue::from_static("application/octet-stream"),
    );
    headers.insert(
        header::CONTENT_DISPOSITION,
        HeaderValue::from_str(&format!("attachment; filename=\"{dateiname}\""))
            .map_err(|e| AppError::Internal(format!("Ungültiger Dateiname: {e}")))?,
    );

    Ok((headers, bytes))
}
