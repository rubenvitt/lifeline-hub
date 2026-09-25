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

/// Ein UNGEBUNDENER Anhang gehört vorerst der Person, die ihn hochgeladen hat (LFH-117,
/// Review C1, design.md D12): wem er gehören wird — dem Chat oder einem modulgebundenen Linker
/// aus `anhang::repo::MODUL_LINKER` —, steht erst mit dem Linker fest, und bis dahin kennt die modul-lose generische Route kein Modul-Gate.
/// Ein ETB-Foto, dessen Erfassen vorübergehend scheiterte, läge sonst bis zu 24 h für jede
/// lesende Person ladbar und für jede schreibende löschbar. Fremde bekommen 404 wie für einen
/// unbekannten Anhang — die Existenz bleibt verdeckt. Gebundene Anhänge sind nicht betroffen.
async fn fordere_hochladende_bei_ungebunden(
    pool: &sqlx::SqlitePool,
    linker: &anhang::repo::LinkerStand,
    anhang_id: i64,
    benutzer_id: i64,
) -> Result<(), AppError> {
    if linker.ist_ungebunden()
        && anhang::repo::hochgeladen_von(pool, anhang_id).await? != Some(benutzer_id)
    {
        return Err(AppError::NotFound);
    }
    Ok(())
}

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
/// (404) — der Direkt-Deeplink umgeht sonst die Frontend-Ausblendung; hängt er an einem
/// modulgebundenen Linker (Register `anhang::repo::MODUL_LINKER`: Dokumentenablage, ETB,
/// Schaden, …), ist er nur über die modul-gegatete Route seines Moduls ladbar (404) — auch
/// ein dort entfernter.
/// An einer lebenden Nachricht hängende Anhänge bleiben ladbar (n:m); ein ungebundener nur
/// für die hochladende Person (Review C1 zu LFH-117).
pub async fn herunterladen(
    State(state): State<AppState>,
    ctx: EinsatzLesezugriff,
    PfadParam((einsatz_id, anhang_id)): PfadParam<(i64, i64)>,
    req_headers: HeaderMap,
) -> Result<Response, AppError> {
    // fordere_lesezugriff erledigt der Extractor.
    if !anhang::repo::gehoert_anhang_zu_einsatz(&state.pool, anhang_id, einsatz_id).await? {
        return Err(AppError::NotFound);
    }
    // Aggregation über ALLE Linker. Gesperrt, wenn der Anhang an einem modulgebundenen
    // Linker hängt (Register, nur über die modul-gegatete Route ladbar) oder nur noch an
    // soft-gelöschten Chat-Nachrichten (Tombstone, LFH-116).
    let linker = anhang::repo::linker_stand(&state.pool, anhang_id).await?;
    if linker.generischer_download_gesperrt() {
        return Err(AppError::NotFound);
    }
    fordere_hochladende_bei_ungebunden(&state.pool, &linker, anhang_id, ctx.benutzer.id).await?;

    // Cache-Kurzschluss (LFH-258) + Header-Sequenz: geteilt mit dem Dokument-Download.
    anhang_antwort(&state.pool, anhang_id, &req_headers).await
}

/// DELETE /api/einsaetze/{id}/anhaenge/{aid} — Anhang hart löschen (Freigabepfad, LFH-250).
/// Schreibrecht + aktiver Einsatz; die Ownership erzwingt die einsatz-gescopte Query
/// (fremder Anhang → NotFound). Der `ON DELETE CASCADE`-FK räumt die
/// `chat_nachricht_anhang`-Verknüpfungen mit. Modulgebundene Anhänge (Dokument LFH-632, ETB
/// LFH-117, Schaden LFH-21) werden mit 422 abgewiesen, Wortlaut aus dem Linker-Register —
/// sie entfernt ihr Modul, ETB-Anhänge gehen nur mit der Schwärzung. Einen ungebundenen
/// Anhang verwirft nur, wer ihn hochgeladen hat (Review C1, sonst 404).
pub async fn loeschen(
    State(state): State<AppState>,
    ctx: EinsatzSchreibzugriff,
    PfadParam((einsatz_id, anhang_id)): PfadParam<(i64, i64)>,
) -> Result<StatusCode, AppError> {
    // Ownership zuerst (fremd/unbekannt → 404), dann die Linker-Frage.
    if !anhang::repo::gehoert_anhang_zu_einsatz(&state.pool, anhang_id, einsatz_id).await? {
        return Err(AppError::NotFound);
    }
    // Ein modulgebundener Anhang (Register `anhang::repo::MODUL_LINKER`) wird in seinem
    // Modul entfernt oder gar nicht: Dokumentenablage und Schaden mit Soft-Delete und
    // ETB-Nachweis (LFH-632, LFH-21), der ETB-Eintrag nie außer mit der Schwärzung
    // (LFH-117). Der generische Hard-Delete hätte das umgangen → der Zustand verbietet es.
    let linker = anhang::repo::linker_stand(&state.pool, anhang_id).await?;
    if let Some(modul) = linker.modul {
        return Err(AppError::UnprocessableEntity(modul.loesch_meldung.into()));
    }
    fordere_hochladende_bei_ungebunden(&state.pool, &linker, anhang_id, ctx.benutzer.id).await?;
    anhang::repo::loeschen(&state.pool, einsatz_id, anhang_id).await?;
    Ok(StatusCode::NO_CONTENT)
}
