use crate::app::AppState;
use crate::auth::session::AdminUser;
use crate::backup;
use crate::error::AppError;
use axum::body::{Body, Bytes};
use axum::extract::State;
use axum::http::{header, HeaderMap, HeaderValue};
use axum::response::IntoResponse;
use chrono::Local;
use futures::Stream;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio::io::AsyncReadExt;
use tokio::sync::OwnedSemaphorePermit;
use tokio::time::Instant;

/// Lesepuffer je Stream-Chunk; die Sicherung (mit BLOB-Anhängen) darf nicht als Ganzes in den
/// RAM.
const CHUNK: usize = 64 * 1024;

/// So lange darf der Client zwischen zwei Chunks verstreichen lassen (LFH-926). Danach gibt der
/// Server Kopie und Sperre frei, statt sie für einen hängenden Client bis zum TCP-Timeout zu
/// halten. Großzügig: selbst bei 10 KB/s ist ein Chunk nach wenigen Sekunden durch.
const LEERLAUF_FRIST: Duration = Duration::from_secs(60);

/// GET /api/backup — konsistente Sicherung der Datenbank als Download. Admin-only.
///
/// Erzeugt per `VACUUM INTO` einen Snapshot in einem temporären Verzeichnis **neben der
/// Datenbank** und streamt ihn chunkweise als Datei-Download. Nicht im System-Temp: `/tmp` ist
/// auf Debian ein tmpfs, die Kopie läge in DB-Größe im RAM (LFH-926). Es läuft höchstens ein
/// Download zugleich; ein zweiter bekommt 503.
pub async fn download(
    State(state): State<AppState>,
    _admin: AdminUser,
) -> Result<impl IntoResponse, AppError> {
    let sperre = state.backup_download.belegen()?;

    let basis = backup::db_verzeichnis(&state.pool)
        .await?
        .unwrap_or_else(std::env::temp_dir);
    let dir = tempfile::Builder::new()
        .prefix(backup::DOWNLOAD_PRAEFIX)
        .tempdir_in(&basis)
        .map_err(|e| AppError::Internal(format!("Tempverzeichnis fehlgeschlagen: {e}")))?;
    let pfad = dir.path().join("lifeline-backup.sqlite");

    // Vom Request entkoppelt: bricht der Client während der Kopie ab, führt sqlx das laufende
    // `VACUUM INTO` trotzdem zu Ende. Sperre und Verzeichnis halten so lange, sonst begänne ein
    // erneuter Klick schon eine zweite Vollkopie.
    let pool = state.pool.clone();
    let ziel = pfad.clone();
    let (dir, sperre) = tokio::spawn(async move {
        backup::erzeuge_sicherung(&pool, &ziel)
            .await
            .map(|_| (dir, sperre))
    })
    .await
    .map_err(|e| AppError::Internal(format!("Sicherung abgebrochen: {e}")))??;

    let datei = tokio::fs::File::open(&pfad)
        .await
        .map_err(|e| AppError::Internal(format!("Sicherung öffnen fehlgeschlagen: {e}")))?;
    let groesse = datei
        .metadata()
        .await
        .map_err(|e| AppError::Internal(format!("Sicherung messen fehlgeschlagen: {e}")))?
        .len();

    let stream = chunk_stream(
        Lauf {
            datei,
            _dir: dir,
            _sperre: sperre,
        },
        LEERLAUF_FRIST,
    );

    let dateiname = format!(
        "lifeline-backup-{}.sqlite",
        Local::now().format("%Y%m%d-%H%M%S")
    );
    let mut headers = HeaderMap::new();
    headers.insert(
        header::CONTENT_TYPE,
        HeaderValue::from_static("application/octet-stream"),
    );
    // Ein gestreamter Body meldet keine Größe; ohne diesen Header fehlte dem Browser die
    // Fortschrittsanzeige.
    headers.insert(header::CONTENT_LENGTH, HeaderValue::from(groesse));
    headers.insert(
        header::CONTENT_DISPOSITION,
        HeaderValue::from_str(&format!("attachment; filename=\"{dateiname}\""))
            .map_err(|e| AppError::Internal(format!("Ungültiger Dateiname: {e}")))?,
    );

    Ok((headers, Body::from_stream(stream)))
}

/// Was ein laufender Download hält: die offene Kopie, ihr Verzeichnis (gelöscht beim Fallen)
/// und den Platz in der Download-Sperre.
struct Lauf {
    datei: tokio::fs::File,
    _dir: tempfile::TempDir,
    _sperre: OwnedSemaphorePermit,
}

/// Streamt die Kopie in [`CHUNK`]-Stücken und gibt den [`Lauf`] frei, sobald der letzte Chunk
/// gelesen ist, der Body fällt (Abbruch) oder der Client länger als `frist` keinen Chunk mehr
/// abnimmt.
///
/// Für den Leerlauf braucht es einen eigenen Wächter-Task: hyper fragt den Body erst nach dem
/// nächsten Chunk, wenn der Socket wieder schreibbar ist, ein hängender Client weckt den Stream
/// also nie. Der Wächter hält den Lauf nur schwach und endet mit dem Stream.
fn chunk_stream(lauf: Lauf, frist: Duration) -> impl Stream<Item = std::io::Result<Bytes>> {
    let lauf = Arc::new(tokio::sync::Mutex::new(Some(lauf)));
    let zuletzt = Arc::new(Mutex::new(Instant::now()));

    let schwach = Arc::downgrade(&lauf);
    let zuletzt_waechter = zuletzt.clone();
    let faellig = move || *zuletzt_waechter.lock().unwrap_or_else(|e| e.into_inner()) + frist;
    tokio::spawn(async move {
        loop {
            tokio::time::sleep_until(faellig()).await;
            let Some(lauf) = schwach.upgrade() else {
                return;
            };
            let mut lauf = lauf.lock().await;
            if lauf.is_none() {
                return;
            }
            if Instant::now() >= faellig() {
                *lauf = None;
                tracing::warn!(
                    frist_sekunden = frist.as_secs(),
                    "Sicherungs-Download abgebrochen: der Client nimmt keine Daten mehr ab"
                );
                return;
            }
        }
    });

    futures::stream::try_unfold((lauf, zuletzt), |(lauf, zuletzt)| async move {
        let mut wache = lauf.lock().await;
        let Some(aktiv) = wache.as_mut() else {
            return Err(std::io::Error::new(
                std::io::ErrorKind::TimedOut,
                "Sicherungs-Download nach Leerlauf abgebrochen",
            ));
        };
        let mut puffer = vec![0u8; CHUNK];
        let gelesen = aktiv.datei.read(&mut puffer).await?;
        if gelesen == 0 {
            // Fertig: Kopie und Sperre sofort freigeben, nicht erst mit dem Body.
            *wache = None;
            return Ok(None);
        }
        puffer.truncate(gelesen);
        *zuletzt.lock().unwrap_or_else(|e| e.into_inner()) = Instant::now();
        drop(wache);
        Ok(Some((Bytes::from(puffer), (lauf, zuletzt))))
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use futures::StreamExt;

    async fn lauf_mit(sperre: &backup::DownloadSperre, bytes: usize) -> (Lauf, std::path::PathBuf) {
        let dir = tempfile::tempdir().unwrap();
        let pfad = dir.path().join("kopie.sqlite");
        std::fs::write(&pfad, vec![7u8; bytes]).unwrap();
        let verzeichnis = dir.path().to_path_buf();
        let lauf = Lauf {
            datei: tokio::fs::File::open(&pfad).await.unwrap(),
            _dir: dir,
            _sperre: sperre.belegen().unwrap(),
        };
        (lauf, verzeichnis)
    }

    /// LFH-926: Nimmt der Client nach einem Chunk nichts mehr ab, gibt der Server nach der Frist
    /// Kopie und Sperre frei, ohne dass der Stream noch einmal abgefragt wird.
    #[tokio::test]
    async fn leerlauf_gibt_kopie_und_sperre_frei() {
        let sperre = backup::DownloadSperre::default();
        let (lauf, verzeichnis) = lauf_mit(&sperre, 3 * CHUNK).await;
        let mut stream = Box::pin(chunk_stream(lauf, Duration::from_millis(100)));

        let erster = stream.next().await.unwrap().unwrap();
        assert_eq!(erster.len(), CHUNK);
        assert!(
            sperre.clone().belegen().is_err(),
            "der Download hält die Sperre"
        );

        tokio::time::sleep(Duration::from_millis(400)).await;

        assert!(
            !verzeichnis.exists(),
            "nach dem Leerlauf ist die Kopie gelöscht"
        );
        assert!(sperre.belegen().is_ok(), "und die Sperre wieder frei");
        assert!(
            stream.next().await.unwrap().is_err(),
            "der Body endet mit einem Fehler statt mit einer still abgeschnittenen Datei"
        );
    }

    /// Ein zügiger Client bekommt die ganze Datei, und mit dem letzten Chunk ist alles frei.
    #[tokio::test]
    async fn zuegiger_download_liefert_alles_und_raeumt_auf() {
        let sperre = backup::DownloadSperre::default();
        let (lauf, verzeichnis) = lauf_mit(&sperre, 2 * CHUNK + 5).await;
        let mut stream = Box::pin(chunk_stream(lauf, Duration::from_secs(60)));

        let mut summe = 0;
        while let Some(chunk) = stream.next().await {
            summe += chunk.unwrap().len();
        }

        assert_eq!(summe, 2 * CHUNK + 5);
        assert!(!verzeichnis.exists());
        assert!(sperre.belegen().is_ok());
    }
}
