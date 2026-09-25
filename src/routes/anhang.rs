use crate::anhang::{self, AnhangAnzeige};
use crate::app::AppState;
use crate::einsatz::kontext::{EinsatzLesezugriff, EinsatzSchreibzugriff};
use crate::error::AppError;
use crate::extract::PfadParam;
use axum::extract::{Multipart, State};
use axum::http::{HeaderMap, StatusCode};
use axum::response::Response;
use axum::Json;

use super::support::anhang_antwort;

/// POST /api/einsaetze/{id}/anhaenge — generischer Datei-Upload (multipart).
/// Schreibrecht + aktiver Einsatz. Jedes Datei-Feld wird einzeln validiert
/// (Größe, MIME aus Endung), den AV-Scan-Seam (scan-vor-persist) durchlaufen und
/// als BLOB persistiert. Liefert die Metadaten der angelegten Anhänge; das
/// Verknüpfen mit einer Chat-Nachricht passiert separat beim Nachricht-Senden.
pub async fn hochladen(
    State(state): State<AppState>,
    ctx: EinsatzSchreibzugriff,
    mut multipart: Multipart,
) -> Result<(StatusCode, Json<Vec<AnhangAnzeige>>), AppError> {
    // fordere_schreibrecht + fordere_aktiv erledigt der Extractor.
    let einsatz_id = ctx.einsatz.id;

    // Schleife, Prüfungen und Persistieren: geteilt mit dem ETB-Upload (LFH-117), hier mit
    // der Chat-Allowlist.
    let angelegt = anhang::hochladen_multipart(
        &state.pool,
        einsatz_id,
        ctx.benutzer.id,
        &mut multipart,
        anhang::ERLAUBTE_MIME,
    )
    .await?;
    Ok((StatusCode::CREATED, Json(angelegt)))
}

/// GET /api/einsaetze/{id}/anhaenge/{aid} — Anhang herunterladen.
/// Lesezugriff (inkl. Beobachter) + Pflicht-Ownership-Guard gegen Cross-Einsatz-
/// Zugriff (fremder Einsatz → NotFound, kein ID-Raten).
///
/// Gatet zusätzlich über [`anhang::repo::linker_stand`] (Aggregation über ALLE Linker):
/// (LFH-116) hängt der Anhang NUR noch an soft-gelöschten Nachrichten, ist er gesperrt
/// (404) — der Direkt-Deeplink umgeht sonst die Frontend-Ausblendung; (LFH-632) gehört er
/// zur Dokumentenablage, ist er nur über die modul-gegatete Dokument-Route ladbar (404).
/// Verwaiste oder an einer lebenden Nachricht hängende Anhänge bleiben ladbar (n:m).
pub async fn herunterladen(
    State(state): State<AppState>,
    _ctx: EinsatzLesezugriff,
    PfadParam((einsatz_id, anhang_id)): PfadParam<(i64, i64)>,
    req_headers: HeaderMap,
) -> Result<Response, AppError> {
    // fordere_lesezugriff erledigt der Extractor.
    if !anhang::repo::gehoert_anhang_zu_einsatz(&state.pool, anhang_id, einsatz_id).await? {
        return Err(AppError::NotFound);
    }
    // LFH-116 + LFH-632: Aggregation über ALLE Linker. Gesperrt, wenn der Anhang zur
    // Dokumentenablage gehört (nur über die modul-gegatete Route ladbar) oder nur noch an
    // soft-gelöschten Chat-Nachrichten hängt (Tombstone).
    if anhang::repo::linker_stand(&state.pool, anhang_id)
        .await?
        .generischer_download_gesperrt()
    {
        return Err(AppError::NotFound);
    }

    // Cache-Kurzschluss (LFH-258) + Header-Sequenz: geteilt mit dem Dokument-Download.
    anhang_antwort(&state.pool, anhang_id, &req_headers).await
}

/// DELETE /api/einsaetze/{id}/anhaenge/{aid} — Anhang hart löschen (Freigabepfad, LFH-250).
/// Schreibrecht + aktiver Einsatz; die Ownership erzwingt die einsatz-gescopte Query
/// (fremder Anhang → NotFound). Der `ON DELETE CASCADE`-FK räumt die
/// `chat_nachricht_anhang`-Verknüpfungen mit. Dokument-gebundene Anhänge (LFH-632) werden
/// mit 422 abgewiesen — sie entfernt die Dokumentenablage (Soft-Delete mit ETB-Nachweis).
pub async fn loeschen(
    State(state): State<AppState>,
    _ctx: EinsatzSchreibzugriff,
    PfadParam((einsatz_id, anhang_id)): PfadParam<(i64, i64)>,
) -> Result<StatusCode, AppError> {
    // Ownership zuerst (fremd/unbekannt → 404), dann die Linker-Frage.
    if !anhang::repo::gehoert_anhang_zu_einsatz(&state.pool, anhang_id, einsatz_id).await? {
        return Err(AppError::NotFound);
    }
    // LFH-632: ein Dokument-Anhang wird über die Dokumentenablage entfernt (Soft-Delete mit
    // ETB-Nachweis). Der generische Hard-Delete hätte beides umgangen → Zustand verbietet es.
    if anhang::repo::linker_stand(&state.pool, anhang_id)
        .await?
        .ist_dokument()
    {
        return Err(AppError::UnprocessableEntity(
            "Anhang gehört zur Dokumentenablage und wird dort entfernt".into(),
        ));
    }
    anhang::repo::loeschen(&state.pool, einsatz_id, anhang_id).await?;
    Ok(StatusCode::NO_CONTENT)
}
