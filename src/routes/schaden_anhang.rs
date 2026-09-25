//! Routen der Schaden-Anhänge (LFH-21). Gates strukturell über die Extractor-Typen:
//! `EinsatzLesezugriff<Schaeden>` (alle Mitglieder inkl. Beobachter, Modul Schäden frei),
//! `EinsatzSchreibzugriff<Schaeden>` (Schreibrecht + aktiver Einsatz). Die übrigen
//! Schadensrouten (`routes::einsatz_schaden`) prüfen noch von Hand und stehen in
//! `DEFERRED_MODULE`; diese Datei nicht — der Struktur-Guard erzwingt hier Gate und Marker.
//!
//! `{aid}` ist die Linker-id (`einsatz_schaden_anhang.id`), nicht `anhang.id`.

use axum::extract::{Multipart, State};
use axum::http::{HeaderMap, StatusCode};
use axum::response::Response;
use axum::Json;

use crate::anhang;
use crate::app::AppState;
use crate::einsatz::kontext::{EinsatzLesezugriff, EinsatzSchreibzugriff};
use crate::einsatz::modul::Schaeden;
use crate::error::AppError;
use crate::extract::PfadParam;
use crate::schaden::anhang::{self as schaden_anhang, Ablage, SchadenAnhangAnzeige};
use crate::schaden::repo as schaden_repo;

use super::einsatz_schaden::sse_schaden;
use super::support::anhang_antwort;

/// GET /api/einsaetze/{id}/schaeden/{sid}/anhaenge — lebende Anhänge, neueste zuerst.
/// Ein stornierter Schaden bleibt lesbar; ein Schaden eines anderen Einsatzes ist 404.
pub async fn liste(
    State(state): State<AppState>,
    ctx: EinsatzLesezugriff<Schaeden>,
    PfadParam((_einsatz_id, schaden_id)): PfadParam<(i64, i64)>,
) -> Result<Json<Vec<SchadenAnhangAnzeige>>, AppError> {
    Ok(Json(
        schaden_anhang::liste(&state.pool, ctx.einsatz.id, schaden_id).await?,
    ))
}

/// Liest genau eine Datei aus dem Multipart: `(dateiname, bytes)`. Ein zweites Datei-Feld
/// ist 400 (eine Datei je Ablage, design.md D5), keines ebenfalls; Felder ohne Dateinamen
/// werden ignoriert. Der Typ wird vor dem Lesen der Bytes geprüft (wie
/// `anhang::hochladen_multipart`), damit ein verbotener Typ nicht erst gelesen wird.
async fn genau_eine_datei(multipart: &mut Multipart) -> Result<(String, Vec<u8>), AppError> {
    let mut datei: Option<(String, Vec<u8>)> = None;
    while let Some(feld) = multipart
        .next_field()
        .await
        .map_err(|e| AppError::Validation(format!("Multipart-Fehler: {e}")))?
    {
        let Some(dateiname) = feld.file_name().map(str::to_string) else {
            continue;
        };
        if datei.is_some() {
            return Err(AppError::Validation("Genau eine Datei je Ablage".into()));
        }
        anhang::ermittle_mime_aus(&dateiname, anhang::ERLAUBTE_MIME_ERFASSUNG)?;
        let daten = feld
            .bytes()
            .await
            .map_err(|e| AppError::Validation(format!("Datei lesen fehlgeschlagen: {e}")))?;
        datei = Some((dateiname, daten.to_vec()));
    }
    datei.ok_or_else(|| AppError::Validation("Keine Datei im Upload".into()))
}

/// POST /api/einsaetze/{id}/schaeden/{sid}/anhaenge — eine Datei ablegen (Multipart, Feld
/// `datei`). Reihenfolge (design.md D4): Gate (403/409) → Schaden im Einsatz (404) →
/// storniert (409) → Datei lesen (400) → Typ, Größe, Scan (400/422/503) → EINE Transaktion
/// aus Anhang, Linker und ETB-Nachweis (Storno dort erneut geprüft). Der Scan läuft vor der
/// Transaktion, damit kein Schreib-Lock über die Scandauer gehalten wird.
pub async fn ablegen(
    State(state): State<AppState>,
    ctx: EinsatzSchreibzugriff<Schaeden>,
    PfadParam((_einsatz_id, schaden_id)): PfadParam<(i64, i64)>,
    mut multipart: Multipart,
) -> Result<(StatusCode, Json<SchadenAnhangAnzeige>), AppError> {
    let einsatz_id = ctx.einsatz.id;
    let schaden = schaden_repo::laden(&state.pool, einsatz_id, schaden_id).await?;
    if schaden.storniert_at.is_some() {
        return Err(AppError::Conflict("Schaden ist storniert".into()));
    }
    let (dateiname, daten) = genau_eine_datei(&mut multipart).await?;
    let mime =
        anhang::pruefe_vor_persist(&dateiname, &daten, anhang::ERLAUBTE_MIME_ERFASSUNG).await?;
    let startwert = crate::einsatz::einstellungen::laden_oder_default(&state.pool, einsatz_id)
        .await?
        .etb_startwert();
    let (id, etb_id) = schaden_anhang::ablegen(
        &state.pool,
        einsatz_id,
        schaden_id,
        ctx.benutzer.id,
        startwert,
        &Ablage {
            dateiname: &dateiname,
            mime: &mime,
            daten: &daten,
        },
    )
    .await?;
    // Nach dem Commit: ETB (ID-only) und `schaden` (nur Kennungen, modulgefiltert).
    state.live.publiziere(einsatz_id, etb_id);
    sse_schaden(&state, einsatz_id, schaden_id);
    Ok((
        StatusCode::CREATED,
        Json(schaden_anhang::laden(&state.pool, einsatz_id, schaden_id, id).await?),
    ))
}

/// GET /api/einsaetze/{id}/schaeden/{sid}/anhaenge/{aid}/datei — Download (ETag/304). Der
/// Linker-Lookup IST die Zugriffsprüfung: fremder Einsatz, anderer Schaden, unbekannt oder
/// entfernt → 404.
pub async fn datei(
    State(state): State<AppState>,
    ctx: EinsatzLesezugriff<Schaeden>,
    PfadParam((_einsatz_id, schaden_id, id)): PfadParam<(i64, i64, i64)>,
    req_headers: HeaderMap,
) -> Result<Response, AppError> {
    let anhang_id =
        schaden_anhang::anhang_id_fuer_download(&state.pool, ctx.einsatz.id, schaden_id, id)
            .await?;
    anhang_antwort(&state.pool, anhang_id, &req_headers).await
}

/// DELETE /api/einsaetze/{id}/schaeden/{sid}/anhaenge/{aid} — Soft-Delete mit
/// ETB-Nachweis. Die Datei bleibt bis zur Schwärzung gespeichert.
pub async fn entfernen(
    State(state): State<AppState>,
    ctx: EinsatzSchreibzugriff<Schaeden>,
    PfadParam((_einsatz_id, schaden_id, id)): PfadParam<(i64, i64, i64)>,
) -> Result<StatusCode, AppError> {
    let einsatz_id = ctx.einsatz.id;
    let startwert = crate::einsatz::einstellungen::laden_oder_default(&state.pool, einsatz_id)
        .await?
        .etb_startwert();
    let etb_id = schaden_anhang::entfernen(
        &state.pool,
        einsatz_id,
        schaden_id,
        id,
        ctx.benutzer.id,
        startwert,
    )
    .await?;
    state.live.publiziere(einsatz_id, etb_id);
    sse_schaden(&state, einsatz_id, schaden_id);
    Ok(StatusCode::NO_CONTENT)
}
