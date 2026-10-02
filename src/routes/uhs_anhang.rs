//! Routen der UHS-Anhänge (LFH-758, Spec `uhs-anhaenge`). Gates strukturell über die
//! Extractor-Typen: `EinsatzLesezugriff<Unfallhilfsstellen>` (alle Mitglieder inkl. Beobachter,
//! Modul frei), `EinsatzSchreibzugriff<Unfallhilfsstellen>` (Schreibrecht + aktiver Einsatz).
//! Aufbau wie `routes::schaden_anhang`; Liste, Ablage und Soft-Delete im Kern
//! `anhang::erfassung`.
//!
//! **Lese-Audit:** jeder zugelassene Download schreibt VOR der Antwort eine Zeile in
//! `anhang_zugriff_audit` (auch bei 304), fail-closed; die Einsicht hat nur die Einsatzleitung
//! ([`zugriffe`], selbst nicht protokolliert). `{aid}` ist die Linker-id (`uhs_anhang.id`).

use axum::extract::{Multipart, State};
use axum::http::{HeaderMap, StatusCode};
use axum::response::Response;
use axum::Json;

use crate::anhang;
use crate::anhang::audit_repo::{self, AnhangZugriffAnzeige, ZugriffFassung};
use crate::anhang::erfassung::Ablage;
use crate::app::AppState;
use crate::einsatz::einstellungen::etb_startwert;
use crate::einsatz::kontext::{EinsatzLesezugriff, EinsatzSchreibzugriff};
use crate::einsatz::modul::Unfallhilfsstellen;
use crate::error::AppError;
use crate::extract::PfadParam;
use crate::uhs::anhang::{self as uhs_anhang, UhsAnhangAnzeige, UHS_ABLAGE};
use crate::uhs::repo as uhs_repo;

use super::einsatz_uhs::sse_uhs;
use super::support::{
    anhang_antwort, genau_eine_datei, original_freigeben, Fassung, FassungParam,
    KEINE_VORSCHAU_MELDUNG,
};

/// GET /api/einsaetze/{id}/uhs/{uid}/anhaenge — lebende Anhänge, neueste zuerst.
/// Eine stornierte UHS bleibt lesbar; eine UHS eines anderen Einsatzes ist 404.
pub async fn liste(
    State(state): State<AppState>,
    ctx: EinsatzLesezugriff<Unfallhilfsstellen>,
    PfadParam((_einsatz_id, uhs_id)): PfadParam<(i64, i64)>,
) -> Result<Json<Vec<UhsAnhangAnzeige>>, AppError> {
    Ok(Json(
        uhs_anhang::liste(&state.pool, ctx.einsatz.id, uhs_id).await?,
    ))
}

/// POST /api/einsaetze/{id}/uhs/{uid}/anhaenge — eine Datei ablegen (Multipart, Feld
/// `datei`). Reihenfolge wie bei Schäden: Gate (403/409) → UHS im Einsatz (404) → storniert
/// (409) → Datei lesen (400) → Typ, Größe, Scan (400/422/503) → EINE Transaktion aus Anhang,
/// Linker und ETB-Nachweis (Storno dort erneut geprüft).
pub async fn ablegen(
    State(state): State<AppState>,
    ctx: EinsatzSchreibzugriff<Unfallhilfsstellen>,
    PfadParam((_einsatz_id, uhs_id)): PfadParam<(i64, i64)>,
    mut multipart: Multipart,
) -> Result<(StatusCode, Json<UhsAnhangAnzeige>), AppError> {
    let einsatz_id = ctx.einsatz.id;
    let uhs = uhs_repo::laden(&state.pool, einsatz_id, uhs_id).await?;
    if uhs.storniert_at.is_some() {
        return Err(AppError::Conflict(UHS_ABLAGE.storniert_meldung.into()));
    }
    let (dateiname, daten) = genau_eine_datei(&mut multipart).await?;
    let mime =
        anhang::pruefe_vor_persist(&dateiname, &daten, anhang::ERLAUBTE_MIME_ERFASSUNG).await?;
    let startwert = etb_startwert(&state.pool, einsatz_id).await?;
    let (id, etb_id) = uhs_anhang::ablegen(
        &state.pool,
        einsatz_id,
        uhs_id,
        ctx.benutzer.id,
        startwert,
        &Ablage {
            dateiname: &dateiname,
            mime: &mime,
            daten: &daten,
        },
    )
    .await?;
    // Nach dem Commit: ETB (ID-only) und `uhs` (nur Kennungen, modulgefiltert).
    state.live.publiziere(einsatz_id, etb_id);
    sse_uhs(&state, einsatz_id, uhs_id);
    Ok((
        StatusCode::CREATED,
        Json(uhs_anhang::laden(&state.pool, einsatz_id, uhs_id, id).await?),
    ))
}

/// GET /api/einsaetze/{id}/uhs/{uid}/anhaenge/{aid}/datei — Download (ETag/304). Der
/// Linker-Lookup IST die Zugriffsprüfung: fremder Einsatz, andere UHS, unbekannt oder
/// entfernt → 404. Reihenfolge (design.md D5): Lookup → bei `Original` die Freigabe (403 oder
/// ETB-Vermerk) → **Lese-Audit** → Antwort. Scheitert das Audit, scheitert der Abruf; eine
/// abgewiesene Anfrage (400/403/404) protokolliert nichts.
pub async fn datei(
    State(state): State<AppState>,
    ctx: EinsatzLesezugriff<Unfallhilfsstellen>,
    PfadParam((_einsatz_id, uhs_id, id)): PfadParam<(i64, i64, i64)>,
    param: FassungParam,
    req_headers: HeaderMap,
) -> Result<Response, AppError> {
    let fassung = param.fassung()?;
    let anhang_id =
        uhs_anhang::anhang_id_fuer_download(&state.pool, ctx.einsatz.id, uhs_id, id).await?;
    let uhs = uhs_repo::laden(&state.pool, ctx.einsatz.id, uhs_id).await?;
    let zugriff = match fassung {
        Fassung::Bereinigt => ZugriffFassung::Bereinigt,
        Fassung::Original => ZugriffFassung::Original,
        // Vorschau und Großansicht (LFH-759) zeigen den Inhalt, liefen aber bei jedem
        // Listenaufbau ohne Handlung — an der UHS gibt es sie nicht, bis entschieden ist, ob und
        // wie sie ins Protokoll gehören. Abgewiesen vor Audit und Antwort: nichts protokolliert,
        // nichts ausgeliefert.
        Fassung::Vorschau | Fassung::Grossansicht => {
            return Err(AppError::UnprocessableEntity(KEINE_VORSCHAU_MELDUNG.into()));
        }
    };
    let ablage = uhs_anhang::ablage_name(&uhs.bezeichnung);
    if fassung == Fassung::Original {
        original_freigeben(&state, &ctx, anhang_id, &ablage).await?;
    }
    audit_repo::anlegen(
        &state.pool,
        ctx.einsatz.id,
        anhang_id,
        &ablage,
        ctx.benutzer.id,
        zugriff,
    )
    .await?;
    anhang_antwort(&state.pool, anhang_id, &req_headers, fassung).await
}

/// GET /api/einsaetze/{id}/uhs/{uid}/anhaenge/zugriffe — Lese-Audit der Dateien dieser UHS,
/// auch entfernter, neueste zuerst. Nur Einsatzleitung (sonst 403); fremde UHS → 404. Selbst
/// NICHT protokolliert.
pub async fn zugriffe(
    State(state): State<AppState>,
    ctx: EinsatzLesezugriff<Unfallhilfsstellen>,
    PfadParam((_einsatz_id, uhs_id)): PfadParam<(i64, i64)>,
) -> Result<Json<Vec<AnhangZugriffAnzeige>>, AppError> {
    ctx.fordere_einsatzleitung()?;
    uhs_repo::laden(&state.pool, ctx.einsatz.id, uhs_id).await?;
    Ok(Json(
        audit_repo::liste_je_besitzer(&state.pool, &UHS_ABLAGE, ctx.einsatz.id, uhs_id).await?,
    ))
}

/// DELETE /api/einsaetze/{id}/uhs/{uid}/anhaenge/{aid} — Soft-Delete mit ETB-Nachweis.
/// Die Datei bleibt bis zur Schwärzung gespeichert.
pub async fn entfernen(
    State(state): State<AppState>,
    ctx: EinsatzSchreibzugriff<Unfallhilfsstellen>,
    PfadParam((_einsatz_id, uhs_id, id)): PfadParam<(i64, i64, i64)>,
) -> Result<StatusCode, AppError> {
    let einsatz_id = ctx.einsatz.id;
    let startwert = etb_startwert(&state.pool, einsatz_id).await?;
    let etb_id = uhs_anhang::entfernen(
        &state.pool,
        einsatz_id,
        uhs_id,
        id,
        ctx.benutzer.id,
        startwert,
    )
    .await?;
    state.live.publiziere(einsatz_id, etb_id);
    sse_uhs(&state, einsatz_id, uhs_id);
    Ok(StatusCode::NO_CONTENT)
}
