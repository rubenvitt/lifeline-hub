//! Katalog „Externe Stellen“ (LFH-1194, design.md D4). Lesen: jeder Angemeldete der
//! Organisation; Schreiben: Admin. Kein DELETE — `aktiv` schaltet in beide Richtungen.
//! `stammdaten` meldet die Middleware `routes::live::stammdaten_live` (Präfix in
//! `STAMMDATEN_PFADE`).

use crate::app::AppState;
use crate::auth::session::{AdminUser, CurrentUser};
use crate::error::AppError;
use crate::externe_stelle::repo::{self, StelleDaten, StellePatch};
use crate::externe_stelle::{ExterneStelle, ExterneStelleArt, BEZEICHNUNG_MAX, KURZ_MAX};
use crate::extract::{JsonBody, PfadParam};
use crate::routes::support::{
    deserialize_optional_field, hoechstens, optional_max, parse_enum, pflicht_max, pflicht_max_tri,
    trimme_tri,
};
use axum::extract::{Query, State};
use axum::http::StatusCode;
use axum::Json;
use serde::Deserialize;

const UNGUELTIGE_ART: &str = "Ungültige Art einer externen Stelle";

#[derive(Debug, Deserialize)]
pub struct ListeQuery {
    pub nur_aktive: Option<bool>,
}

/// GET /api/externe-stellen — Stellen der eigenen Organisation; ohne `nur_aktive=false` nur die
/// aktiven.
pub async fn liste(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Query(q): Query<ListeQuery>,
) -> Result<Json<Vec<ExterneStelle>>, AppError> {
    let nur_aktive = q.nur_aktive.unwrap_or(true);
    Ok(Json(
        repo::liste(&state.pool, benutzer.org_id, nur_aktive).await?,
    ))
}

#[derive(Debug, Deserialize)]
pub struct StelleBody {
    pub bezeichnung: String,
    pub art: String,
    pub rufnummer: Option<String>,
    pub funkrufname: Option<String>,
    #[serde(default)]
    pub zustaendig: bool,
}

/// POST /api/externe-stellen — Admin. Neue Stelle (aktiv).
pub async fn anlegen(
    State(state): State<AppState>,
    AdminUser(benutzer): AdminUser,
    JsonBody(body): JsonBody<StelleBody>,
) -> Result<(StatusCode, Json<ExterneStelle>), AppError> {
    let bezeichnung = pflicht_max(&body.bezeichnung, "Bezeichnung", BEZEICHNUNG_MAX)?;
    let art = parse_enum(ExterneStelleArt::parse, body.art.trim(), UNGUELTIGE_ART)?;
    let rufnummer = optional_max(body.rufnummer, "Rufnummer", KURZ_MAX)?;
    let funkrufname = optional_max(body.funkrufname, "Funkrufname", KURZ_MAX)?;
    let stelle = repo::anlegen(
        &state.pool,
        benutzer.org_id,
        StelleDaten {
            bezeichnung: &bezeichnung,
            art,
            rufnummer: rufnummer.as_deref(),
            funkrufname: funkrufname.as_deref(),
            zustaendig: body.zustaendig,
        },
    )
    .await?;
    Ok((StatusCode::CREATED, Json(stelle)))
}

/// PATCH-Body (Tri-State): absent = unverändert; `null`/`""` bei Rufnummer und Funkrufname =
/// leeren. Bezeichnung und Art dürfen fehlen, aber nicht leer sein.
#[derive(Debug, Deserialize)]
pub struct PatchStelle {
    pub bezeichnung: Option<String>,
    pub art: Option<String>,
    #[serde(default, deserialize_with = "deserialize_optional_field")]
    pub rufnummer: Option<Option<String>>,
    #[serde(default, deserialize_with = "deserialize_optional_field")]
    pub funkrufname: Option<Option<String>>,
    pub aktiv: Option<bool>,
    pub zustaendig: Option<bool>,
}

/// Prüft ein gesendetes, nicht geleertes Tri-State-Feld gegen seine Grenze.
fn kurz_tri(wert: Option<Option<String>>, feld: &str) -> Result<Option<Option<String>>, AppError> {
    let wert = trimme_tri(wert);
    if let Some(Some(w)) = &wert {
        hoechstens(w, feld, KURZ_MAX)?;
    }
    Ok(wert)
}

/// PATCH /api/externe-stellen/{id} — Admin, Teil-Patch. Fremde oder unbekannte id → 404;
/// unzulässige Markierung „zuständig“ → 422 (design.md D3).
pub async fn aktualisieren(
    State(state): State<AppState>,
    AdminUser(benutzer): AdminUser,
    PfadParam(id): PfadParam<i64>,
    JsonBody(body): JsonBody<PatchStelle>,
) -> Result<Json<ExterneStelle>, AppError> {
    let bezeichnung = pflicht_max_tri(body.bezeichnung.as_deref(), "Bezeichnung", BEZEICHNUNG_MAX)?;
    let art = body
        .art
        .map(|a| parse_enum(ExterneStelleArt::parse, a.trim(), UNGUELTIGE_ART))
        .transpose()?;
    let rufnummer = kurz_tri(body.rufnummer, "Rufnummer")?;
    let funkrufname = kurz_tri(body.funkrufname, "Funkrufname")?;
    let stelle = repo::patche(
        &state.pool,
        benutzer.org_id,
        id,
        StellePatch {
            bezeichnung: bezeichnung.as_deref(),
            art,
            rufnummer: rufnummer.as_ref().map(|v| v.as_deref()),
            funkrufname: funkrufname.as_ref().map(|v| v.as_deref()),
            aktiv: body.aktiv,
            zustaendig: body.zustaendig,
        },
    )
    .await?;
    Ok(Json(stelle))
}
