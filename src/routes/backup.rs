use crate::app::AppState;
use crate::auth::session::AdminUser;
use crate::backup;
use crate::error::AppError;
use axum::body::{Body, Bytes};
use axum::extract::State;
use axum::http::{header, HeaderMap, HeaderValue};
use axum::response::IntoResponse;
use chrono::Local;
use tokio::io::AsyncReadExt;

/// Lesepuffer je Stream-Chunk. Die Sicherung wächst mit der Einsatzlage (BLOB-Anhänge
/// liegen in der Kern-DB, LFH-248) — sie darf nicht als Ganzes in den RAM.
const CHUNK: usize = 64 * 1024;

/// GET /api/backup — konsistente Sicherung der Datenbank als Download. Admin-only.
///
/// Erzeugt per `VACUUM INTO` einen Snapshot in einer temporären Datei und streamt ihn
/// chunkweise als Datei-Download.
pub async fn download(
    State(state): State<AppState>,
    _admin: AdminUser,
) -> Result<impl IntoResponse, AppError> {
    let dir = tempfile::tempdir()
        .map_err(|e| AppError::Internal(format!("Tempverzeichnis fehlgeschlagen: {e}")))?;
    let pfad = dir.path().join("lifeline-backup.sqlite");

    backup::erzeuge_sicherung(&state.pool, &pfad).await?;

    let datei = tokio::fs::File::open(&pfad)
        .await
        .map_err(|e| AppError::Internal(format!("Sicherung öffnen fehlgeschlagen: {e}")))?;
    let groesse = datei
        .metadata()
        .await
        .map_err(|e| AppError::Internal(format!("Sicherung messen fehlgeschlagen: {e}")))?
        .len();

    // Das TempDir-Handle wandert in den Stream-Zustand: das Verzeichnis wird damit erst
    // gelöscht, wenn der letzte Chunk gesendet ist — nicht schon beim Verlassen dieser
    // Funktion. Sonst hinge die Auslieferung an der Unlink-Semantik des Dateisystems.
    let stream = futures::stream::try_unfold((datei, dir), |(mut datei, dir)| async move {
        let mut puffer = vec![0u8; CHUNK];
        let gelesen = datei.read(&mut puffer).await?;
        if gelesen == 0 {
            return Ok::<_, std::io::Error>(None);
        }
        puffer.truncate(gelesen);
        Ok(Some((Bytes::from(puffer), (datei, dir))))
    });

    let dateiname = format!(
        "lifeline-backup-{}.sqlite",
        Local::now().format("%Y%m%d-%H%M%S")
    );
    let mut headers = HeaderMap::new();
    headers.insert(
        header::CONTENT_TYPE,
        HeaderValue::from_static("application/octet-stream"),
    );
    // Ein gestreamter Body ist per Default chunked und meldet keine Größe — ohne diesen
    // Header verlöre der Browser die Fortschrittsanzeige des Sicherungs-Downloads.
    headers.insert(header::CONTENT_LENGTH, HeaderValue::from(groesse));
    headers.insert(
        header::CONTENT_DISPOSITION,
        HeaderValue::from_str(&format!("attachment; filename=\"{dateiname}\""))
            .map_err(|e| AppError::Internal(format!("Ungültiger Dateiname: {e}")))?,
    );

    Ok((headers, Body::from_stream(stream)))
}
