use crate::anhang::{self, AnhangAnzeige};
use crate::app::AppState;
use crate::einsatz::kontext::{EinsatzLesezugriff, EinsatzSchreibzugriff};
use crate::error::AppError;
use crate::extract::PfadParam;
use axum::extract::{Multipart, State};
use axum::http::{HeaderMap, StatusCode};
use axum::response::Response;
use axum::Json;

use super::support::{anhang_antwort, original_freigeben, Fassung, FassungParam};

/// Ein UNGEBUNDENER Anhang gehört vorerst der Person, die ihn hochgeladen hat: wem er gehören
/// wird (Chat oder ein modulgebundener Linker aus `anhang::repo::MODUL_LINKER`), steht erst mit
/// dem Linker fest, und die generische Route kennt kein Modul-Gate. Sonst läge etwa ein
/// ETB-Foto, dessen Erfassen scheiterte, bis zu 24 h für alle Lesenden ladbar und für alle
/// Schreibenden löschbar. Fremde bekommen 404 wie für einen unbekannten Anhang.
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

/// POST /api/einsaetze/{id}/anhaenge — generischer Datei-Upload (multipart). Schreibrecht und
/// aktiver Einsatz. Jedes Datei-Feld wird geprüft (MIME aus Endung, Größe, AV-Scan) und als
/// BLOB gespeichert. Die Verknüpfung mit einer Chat-Nachricht entsteht beim Senden.
pub async fn hochladen(
    State(state): State<AppState>,
    ctx: EinsatzSchreibzugriff,
    mut multipart: Multipart,
) -> Result<(StatusCode, Json<Vec<AnhangAnzeige>>), AppError> {
    // fordere_schreibrecht + fordere_aktiv erledigt der Extractor.
    let einsatz_id = ctx.einsatz.id;

    // Geteilt mit dem ETB-Upload, hier mit der Chat-Allowlist.
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

/// GET /api/einsaetze/{id}/anhaenge/{aid} — Anhang herunterladen. Lesezugriff; ein Anhang aus
/// einem fremden Einsatz ist 404.
///
/// Gegatet über [`anhang::repo::linker_stand`] (alle Linker): hängt der Anhang nur noch an
/// soft-gelöschten Nachrichten, ist er gesperrt (404), sonst umginge ein Deeplink die
/// Ausblendung; hängt er an einem modulgebundenen Linker (`anhang::repo::MODUL_LINKER`), ist er
/// nur über die gegatete Route seines Moduls ladbar (404). An einer lebenden Nachricht bleibt er
/// ladbar (n:m); ein ungebundener nur für die hochladende Person.
pub async fn herunterladen(
    State(state): State<AppState>,
    ctx: EinsatzLesezugriff,
    PfadParam((einsatz_id, anhang_id)): PfadParam<(i64, i64)>,
    param: FassungParam,
    req_headers: HeaderMap,
) -> Result<Response, AppError> {
    let fassung = param.fassung()?;
    // fordere_lesezugriff erledigt der Extractor.
    if !anhang::repo::gehoert_anhang_zu_einsatz(&state.pool, anhang_id, einsatz_id).await? {
        return Err(AppError::NotFound);
    }
    // Aggregation über alle Linker (modulgebunden → nur über die Modul-Route; nur noch
    // soft-gelöschte Chat-Nachrichten → Tombstone).
    let linker = anhang::repo::linker_stand(&state.pool, anhang_id).await?;
    if linker.generischer_download_gesperrt() {
        return Err(AppError::NotFound);
    }
    fordere_hochladende_bei_ungebunden(&state.pool, &linker, anhang_id, ctx.benutzer.id).await?;
    if fassung == Fassung::Original {
        // Ein ungebundener Anhang ist noch an keiner Nachricht: so steht es auch im Vermerk.
        let ablage = if linker.ist_ungebunden() {
            "noch nicht versendeter Anhang"
        } else {
            "Chat"
        };
        original_freigeben(&state, &ctx, anhang_id, ablage).await?;
    }

    // Fassung, Cache-Kurzschluss und Header-Sequenz, geteilt mit den Modul-Downloads.
    anhang_antwort(&state.pool, anhang_id, &req_headers, fassung).await
}

/// DELETE /api/einsaetze/{id}/anhaenge/{aid} — Anhang hart löschen. Schreibrecht und aktiver
/// Einsatz; ein fremder Anhang ist 404. CASCADE räumt die `chat_nachricht_anhang`-Verknüpfungen.
/// Modulgebundene Anhänge werden mit 422 abgewiesen (Wortlaut aus dem Linker-Register) — sie
/// entfernt ihr Modul, ETB-Anhänge nur die Schwärzung. Einen ungebundenen Anhang verwirft nur,
/// wer ihn hochgeladen hat (sonst 404).
pub async fn loeschen(
    State(state): State<AppState>,
    ctx: EinsatzSchreibzugriff,
    PfadParam((einsatz_id, anhang_id)): PfadParam<(i64, i64)>,
) -> Result<StatusCode, AppError> {
    // Ownership zuerst (fremd/unbekannt → 404), dann die Linker-Frage.
    if !anhang::repo::gehoert_anhang_zu_einsatz(&state.pool, anhang_id, einsatz_id).await? {
        return Err(AppError::NotFound);
    }
    // Ein modulgebundener Anhang wird in seinem Modul entfernt (Soft-Delete mit ETB-Nachweis) oder
    // gar nicht (ETB: nur per Schwärzung). Der generische Hard-Delete umginge das → 422.
    let linker = anhang::repo::linker_stand(&state.pool, anhang_id).await?;
    if let Some(modul) = linker.modul {
        return Err(AppError::UnprocessableEntity(modul.loesch_meldung.into()));
    }
    fordere_hochladende_bei_ungebunden(&state.pool, &linker, anhang_id, ctx.benutzer.id).await?;
    anhang::repo::loeschen(&state.pool, einsatz_id, anhang_id).await?;
    Ok(StatusCode::NO_CONTENT)
}
