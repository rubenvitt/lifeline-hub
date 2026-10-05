//! Routen des UHS-Plans (LFH-999, Spec `uhs-plan`, design.md D4/D6). Der Plan ist kein Anhang:
//! eigene, bereinigte Bytes in `uhs_plan`, höchstens einer je UHS.
//!
//! - **Rechte:** Lesen über `EinsatzLesezugriff<Unfallhilfsstellen>` (auch Beobachter und an
//!   einer stornierten UHS), Schreiben über `EinsatzSchreibzugriff<Unfallhilfsstellen>`. Geräte
//!   bindet `stelle::fordere_uhs` an die eigene UHS; welches Gerät schreiben darf, steht in den
//!   Routenlisten (`src/geraet/mod.rs`: das UHS-Tablet sieht, der UHS-Laptop ändert).
//! - **Kein Lese-Audit, kein ETB** beim Abruf des Bildes ([`bild`]). Nur die Übernahme aus
//!   einem UHS-Anhang ([`uebernehmen`]) ist ein Abruf dieser Datei und schreibt genau eine Zeile
//!   ins Lese-Audit, VOR dem Lesen der Bytes (fail-closed).
//! - **ETB** beim Hinterlegen und Entfernen („UHS BHP 50: Plan hinterlegt“), ohne Dateinamen,
//!   in derselben Transaktion; Lage und Darstellung ([`aendern`]) schreiben keinen Eintrag.

use axum::extract::{Multipart, State};
use axum::http::{header, HeaderMap, HeaderValue, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde::Deserialize;

use crate::anhang;
use crate::anhang::audit_repo::{self, ZugriffFassung};
use crate::app::AppState;
use crate::einsatz::einstellungen::etb_startwert;
use crate::einsatz::kontext::{EinsatzLesezugriff, EinsatzSchreibzugriff};
use crate::einsatz::modul::Unfallhilfsstellen;
use crate::error::AppError;
use crate::extract::{JsonBody, PfadParam};
use crate::geraet::stelle;
use crate::uhs::anhang::{self as uhs_anhang, UHS_ABLAGE};
use crate::uhs::plan::repo::{self as plan_repo, PlanPatch};
use crate::uhs::plan::{self, Abgelehnt, GeprueftesBild, UhsPlanAnzeige, NUR_BILDER};
use crate::uhs::repo as uhs_repo;

use super::einsatz_uhs::sse_uhs;
use super::support::{
    anhang_bereinigt_kopieren, etag_von, genau_eine_datei, if_none_match_matcht, ANHANG_CSP,
    ASSET_CACHE_CONTROL,
};

/// Ein abgelehntes Bild als Antwort. Das Format ist beim Upload ein Feldfehler (400), bei der
/// Übernahme der Zusammenhang „dieser Anhang ist kein Bild“ (422, `src/AGENTS.md`).
fn abgelehnt(a: Abgelehnt, format_als_feld: bool) -> AppError {
    match a {
        Abgelehnt::Groesse(m) => AppError::Validation(m),
        Abgelehnt::Format if format_als_feld => AppError::Validation(NUR_BILDER.into()),
        Abgelehnt::Format => AppError::UnprocessableEntity(NUR_BILDER.into()),
        Abgelehnt::Inhalt(m) => AppError::UnprocessableEntity(m),
    }
}

/// UHS im Einsatz (404) und nicht storniert (409) — vor jedem Schreiben, in der Route und
/// (gegen das Rennen) erneut in der Transaktion.
async fn fordere_schreibbar(
    conn: &mut sqlx::SqliteConnection,
    einsatz_id: i64,
    uhs_id: i64,
) -> Result<String, AppError> {
    let uhs = uhs_repo::laden_tx(conn, einsatz_id, uhs_id).await?;
    if uhs.storniert_at.is_some() {
        return Err(AppError::Conflict(UHS_ABLAGE.storniert_meldung.into()));
    }
    Ok(uhs_anhang::ablage_name(&uhs.bezeichnung))
}

/// Plan, ETB-Nachweis „Plan hinterlegt“ in EINER Transaktion; danach Live.
async fn hinterlegen_und_melden(
    state: &AppState,
    einsatz_id: i64,
    uhs_id: i64,
    benutzer_id: i64,
    bild: &GeprueftesBild,
) -> Result<UhsPlanAnzeige, AppError> {
    let startwert = etb_startwert(&state.pool, einsatz_id).await?;
    let (anzeige, etb_id) = crate::write_retry!(&state.pool, |conn| {
        let name = fordere_schreibbar(conn, einsatz_id, uhs_id).await?;
        let anzeige =
            plan_repo::hinterlegen_tx(conn, einsatz_id, uhs_id, benutzer_id, bild).await?;
        let etb_id = crate::etb::system_audit_tx(
            conn,
            einsatz_id,
            benutzer_id,
            startwert,
            &format!("{name}: Plan hinterlegt"),
        )
        .await?;
        Ok::<_, AppError>((anzeige, etb_id))
    })?;
    state.live.publiziere(einsatz_id, etb_id);
    sse_uhs(state, einsatz_id, uhs_id);
    Ok(anzeige)
}

/// PUT /api/einsaetze/{id}/uhs/{uid}/plan — Bild hochladen (Multipart, Feld `datei`), ersetzt
/// einen vorhandenen Plan. Reihenfolge: Gate → UHS im Einsatz (404) → storniert (409) → Datei
/// (400) → Größe und Format (400) → Scan (422/503) → Bereinigung und Maße (422) → Transaktion.
pub async fn hinterlegen(
    State(state): State<AppState>,
    ctx: EinsatzSchreibzugriff<Unfallhilfsstellen>,
    PfadParam((_einsatz_id, uhs_id)): PfadParam<(i64, i64)>,
    mut multipart: Multipart,
) -> Result<Json<UhsPlanAnzeige>, AppError> {
    stelle::fordere_uhs(ctx.geraet.as_ref(), uhs_id)?;
    let einsatz_id = ctx.einsatz.id;
    fordere_schreibbar(&mut *state.pool.acquire().await?, einsatz_id, uhs_id).await?;
    let (_dateiname, daten) = genau_eine_datei(&mut multipart).await?;
    plan::vorpruefung(&daten).map_err(|a| abgelehnt(a, true))?;
    anhang::scan(anhang::scan_config(), &daten).await?;
    let bild = plan::pruefe_bild(&daten).map_err(|a| abgelehnt(a, true))?;
    Ok(Json(
        hinterlegen_und_melden(&state, einsatz_id, uhs_id, ctx.benutzer.id, &bild).await?,
    ))
}

#[derive(Debug, Deserialize)]
pub struct UebernahmeBody {
    /// Linker-id des UHS-Anhangs (`uhs_anhang.id`), wie in der Liste der Dateien.
    pub anhang_id: i64,
}

/// POST /api/einsaetze/{id}/uhs/{uid}/plan/aus-anhang — einen Bild-Anhang DIESER UHS als Plan
/// kopieren (design.md D4). Reihenfolge: Gate → UHS (404/409) → Linker-Lookup (fremd oder
/// entfernt 404) → Typ des Anhangs (kein Bild 422, ohne Protokoll) → **Lese-Audit** (scheitert
/// es, kein Plan) → bereinigte Bytes → Annahme → Transaktion. Der Anhang bleibt unverändert.
pub async fn uebernehmen(
    State(state): State<AppState>,
    ctx: EinsatzSchreibzugriff<Unfallhilfsstellen>,
    PfadParam((_einsatz_id, uhs_id)): PfadParam<(i64, i64)>,
    JsonBody(body): JsonBody<UebernahmeBody>,
) -> Result<Json<UhsPlanAnzeige>, AppError> {
    stelle::fordere_uhs(ctx.geraet.as_ref(), uhs_id)?;
    let einsatz_id = ctx.einsatz.id;
    let ablage = fordere_schreibbar(&mut *state.pool.acquire().await?, einsatz_id, uhs_id).await?;
    let anhang_id =
        uhs_anhang::anhang_id_fuer_download(&state.pool, einsatz_id, uhs_id, body.anhang_id)
            .await?;
    let (_, mime, _) = anhang::repo::meta_fuer_download(&state.pool, anhang_id).await?;
    if !plan::ist_plan_mime(&mime) {
        return Err(AppError::UnprocessableEntity(NUR_BILDER.into()));
    }
    audit_repo::anlegen(
        &state.pool,
        einsatz_id,
        anhang_id,
        &ablage,
        ctx.benutzer.id,
        ZugriffFassung::Bereinigt,
    )
    .await?;
    let (_, daten) = anhang_bereinigt_kopieren(&state.pool, anhang_id).await?;
    let bild = plan::pruefe_bild(&daten).map_err(|a| abgelehnt(a, false))?;
    Ok(Json(
        hinterlegen_und_melden(&state, einsatz_id, uhs_id, ctx.benutzer.id, &bild).await?,
    ))
}

#[derive(Debug, Default, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PlanPatchBody {
    pub x: Option<i64>,
    pub y: Option<i64>,
    pub breite: Option<i64>,
    pub helligkeit: Option<i64>,
    pub kontrast: Option<i64>,
    pub nacht_umkehren: Option<bool>,
}

/// PATCH /api/einsaetze/{id}/uhs/{uid}/plan — Lage und Darstellung. Versatz und Breite rasten
/// auf 10 px ein; Werte außerhalb der Grenzen 400. KEIN ETB (wie das Verschieben von Plätzen).
pub async fn aendern(
    State(state): State<AppState>,
    ctx: EinsatzSchreibzugriff<Unfallhilfsstellen>,
    PfadParam((_einsatz_id, uhs_id)): PfadParam<(i64, i64)>,
    JsonBody(body): JsonBody<PlanPatchBody>,
) -> Result<Json<UhsPlanAnzeige>, AppError> {
    stelle::fordere_uhs(ctx.geraet.as_ref(), uhs_id)?;
    let einsatz_id = ctx.einsatz.id;
    let patch = PlanPatch {
        x: body.x,
        y: body.y,
        breite: body.breite,
        helligkeit: body.helligkeit,
        kontrast: body.kontrast,
        nacht_umkehren: body.nacht_umkehren,
    }
    .eingerastet()?;
    let anzeige = crate::write_retry!(&state.pool, |conn| {
        fordere_schreibbar(conn, einsatz_id, uhs_id).await?;
        plan_repo::aendern_tx(conn, einsatz_id, uhs_id, patch).await
    })?;
    sse_uhs(&state, einsatz_id, uhs_id);
    Ok(Json(anzeige))
}

/// DELETE /api/einsaetze/{id}/uhs/{uid}/plan — Plan entfernen, mit ETB „Plan entfernt“ in
/// derselben Transaktion. Ohne Plan 404, storniert 409.
pub async fn entfernen(
    State(state): State<AppState>,
    ctx: EinsatzSchreibzugriff<Unfallhilfsstellen>,
    PfadParam((_einsatz_id, uhs_id)): PfadParam<(i64, i64)>,
) -> Result<StatusCode, AppError> {
    stelle::fordere_uhs(ctx.geraet.as_ref(), uhs_id)?;
    let einsatz_id = ctx.einsatz.id;
    let benutzer_id = ctx.benutzer.id;
    let startwert = etb_startwert(&state.pool, einsatz_id).await?;
    let etb_id = crate::write_retry!(&state.pool, |conn| {
        let name = fordere_schreibbar(conn, einsatz_id, uhs_id).await?;
        plan_repo::entfernen_tx(conn, einsatz_id, uhs_id).await?;
        crate::etb::system_audit_tx(
            conn,
            einsatz_id,
            benutzer_id,
            startwert,
            &format!("{name}: Plan entfernt"),
        )
        .await
    })?;
    state.live.publiziere(einsatz_id, etb_id);
    sse_uhs(&state, einsatz_id, uhs_id);
    Ok(StatusCode::NO_CONTENT)
}

/// GET /api/einsaetze/{id}/uhs/{uid}/plan/bild — das Bild zur Anzeige. ETag aus sha256,
/// 304-Kurzschluss ohne BLOB. **Kein Lese-Audit und kein ETB** (Spec „Anzeige ohne
/// Protokoll“): der Plan ist kein Anhang. `inline`, `nosniff` und [`ANHANG_CSP`] wie bei
/// Anhang-Antworten.
pub async fn bild(
    State(state): State<AppState>,
    ctx: EinsatzLesezugriff<Unfallhilfsstellen>,
    PfadParam((_einsatz_id, uhs_id)): PfadParam<(i64, i64)>,
    req_headers: HeaderMap,
) -> Result<Response, AppError> {
    stelle::fordere_uhs(ctx.geraet.as_ref(), uhs_id)?;
    let einsatz_id = ctx.einsatz.id;
    let (mime, sha256) = plan_repo::bild_meta(&state.pool, einsatz_id, uhs_id).await?;
    let etag = etag_von(&sha256);
    let mut headers = HeaderMap::new();
    headers.insert(
        header::ETAG,
        HeaderValue::from_str(&etag)
            .map_err(|e| AppError::Internal(format!("Ungültiger ETag: {e}")))?,
    );
    // Inhaltsadressiert: ein neuer Plan hat eine neue Prüfsumme, und der Client hängt sie an die
    // Adresse (`?v=`), also darf der Browser die Antwort behalten.
    headers.insert(
        header::CACHE_CONTROL,
        HeaderValue::from_static(ASSET_CACHE_CONTROL),
    );
    headers.insert(
        header::X_CONTENT_TYPE_OPTIONS,
        HeaderValue::from_static("nosniff"),
    );
    headers.insert(
        header::CONTENT_SECURITY_POLICY,
        HeaderValue::from_static(ANHANG_CSP),
    );
    if if_none_match_matcht(&req_headers, &etag) {
        return Ok((StatusCode::NOT_MODIFIED, headers).into_response());
    }
    headers.insert(
        header::CONTENT_TYPE,
        HeaderValue::from_str(&mime)
            .unwrap_or(HeaderValue::from_static("application/octet-stream")),
    );
    headers.insert(
        header::CONTENT_DISPOSITION,
        HeaderValue::from_static("inline; filename=\"plan\""),
    );
    let daten = plan_repo::bild_bytes(&state.pool, einsatz_id, uhs_id).await?;
    Ok((headers, daten).into_response())
}
