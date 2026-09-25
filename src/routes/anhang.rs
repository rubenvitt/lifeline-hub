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
/// Review C1, design.md D12): wem er gehören wird — Chat, ETB, Dokumentenablage —, steht erst
/// mit dem Linker fest, und bis dahin kennt die modul-lose generische Route kein Modul-Gate.
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
/// (404) — der Direkt-Deeplink umgeht sonst die Frontend-Ausblendung; (LFH-632) gehört er
/// zur Dokumentenablage, ist er nur über die modul-gegatete Dokument-Route ladbar (404);
/// (LFH-117) hängt er an einem ETB-Eintrag, nur über die ETB-Route (404).
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
    // LFH-116 + LFH-632: Aggregation über ALLE Linker. Gesperrt, wenn der Anhang zur
    // Dokumentenablage gehört (nur über die modul-gegatete Route ladbar) oder nur noch an
    // soft-gelöschten Chat-Nachrichten hängt (Tombstone).
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
/// `chat_nachricht_anhang`-Verknüpfungen mit. Dokument-gebundene Anhänge (LFH-632) werden
/// mit 422 abgewiesen — sie entfernt die Dokumentenablage (Soft-Delete mit ETB-Nachweis).
/// ETB-gebundene (LFH-117) ebenso — sie gehen nur mit der Schwärzung. Einen ungebundenen
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
    // LFH-632: ein Dokument-Anhang wird über die Dokumentenablage entfernt (Soft-Delete mit
    // ETB-Nachweis). Der generische Hard-Delete hätte beides umgangen → Zustand verbietet es.
    // LFH-117: ein ETB-Anhang ist unveränderlich wie sein Eintrag; es gibt keinen Löschweg
    // außer der Schwärzung des Einsatzes.
    let linker = anhang::repo::linker_stand(&state.pool, anhang_id).await?;
    if linker.ist_dokument() {
        return Err(AppError::UnprocessableEntity(
            "Anhang gehört zur Dokumentenablage und wird dort entfernt".into(),
        ));
    }
    if linker.ist_etb() {
        return Err(AppError::UnprocessableEntity(
            "Anhang gehört zu einem ETB-Eintrag und ist unveränderlich".into(),
        ));
    }
    fordere_hochladende_bei_ungebunden(&state.pool, &linker, anhang_id, ctx.benutzer.id).await?;
    anhang::repo::loeschen(&state.pool, einsatz_id, anhang_id).await?;
    Ok(StatusCode::NO_CONTENT)
}
