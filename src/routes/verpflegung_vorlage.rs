//! Katalog „Verpflegungsplan“ (LLH-1058, Spec `openspec/specs/kraefte-verpflegung/spec.md`,
//! „Verpflegungsplan der Organisation“). Lesen: jeder Angemeldete der Organisation (die Seite
//! „Tag aus Vorlage anlegen“ liest im Einsatz); Schreiben: Admin. Kein DELETE — `aktiv` schaltet
//! in beide Richtungen.
//!
//! Statuscodes (`src/AGENTS.md`, „Statuscode-Konvention“): 400 für das Feld allein (leere oder
//! zu lange Bezeichnung, unlesbare Uhrzeit, unbekannte Verpflegungsart), vor dem Repo; 422 für
//! Ende gleich Beginn, 409 für einen gleichen aktiven Namen, 404 für eine fremde Mahlzeit (Repo
//! `verpflegung::vorlage`). `stammdaten` meldet die Middleware `routes::live::stammdaten_live`
//! (Präfix in `STAMMDATEN_PFADE`).

use axum::extract::{Query, State};
use axum::http::StatusCode;
use axum::Json;
use serde::Deserialize;

use crate::app::AppState;
use crate::auth::session::{AdminUser, CurrentUser};
use crate::error::AppError;
use crate::extract::{JsonBody, PfadParam};
use crate::routes::support::{
    deserialize_optional_field, parse_enum_opt, pflicht_max, pflicht_max_tri,
};
use crate::uhrzeit::Uhrzeit;
use crate::verpflegung::vorlage::{self, NewVorlage, VerpflegungVorlage, VorlagePatch};
use crate::verpflegung::Verpflegungsart;

#[derive(Debug, Deserialize)]
pub struct ListQuery {
    pub nur_aktive: Option<bool>,
}

/// GET /api/verpflegung-vorlagen — der Plan der eigenen Organisation nach Beginn; ohne
/// `nur_aktive=false` nur die aktiven Mahlzeiten.
pub async fn list(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Query(q): Query<ListQuery>,
) -> Result<Json<Vec<VerpflegungVorlage>>, AppError> {
    Ok(Json(
        vorlage::list(&state.pool, benutzer.org_id, q.nur_aktive.unwrap_or(true)).await?,
    ))
}

/// Verpflegungsart von außen; unbekannt → 400.
fn parse_art(s: Option<&str>) -> Result<Option<Verpflegungsart>, AppError> {
    parse_enum_opt(
        Verpflegungsart::parse,
        s,
        "Unbekannte Verpflegungsart (erlaubt: warm, kalt, getraenke)",
    )
}

#[derive(Debug, Deserialize)]
pub struct VorlageBody {
    pub bezeichnung: String,
    /// `HH:MM` oder `HHMM`.
    pub beginn: String,
    pub ende: String,
    #[serde(default)]
    pub verpflegungsart: Option<String>,
}

/// POST /api/verpflegung-vorlagen — Admin. Neue aktive Mahlzeit; 400 Feld, 422 Ende gleich
/// Beginn, 409 Name schon aktiv vergeben.
pub async fn create(
    State(state): State<AppState>,
    AdminUser(benutzer): AdminUser,
    JsonBody(body): JsonBody<VorlageBody>,
) -> Result<(StatusCode, Json<VerpflegungVorlage>), AppError> {
    let neu = NewVorlage {
        bezeichnung: pflicht_max(&body.bezeichnung, "bezeichnung", vorlage::BEZEICHNUNG_MAX)?,
        beginn: Uhrzeit::parse("beginn", &body.beginn)?,
        ende: Uhrzeit::parse("ende", &body.ende)?,
        verpflegungsart: parse_art(body.verpflegungsart.as_deref())?,
    };
    Ok((
        StatusCode::CREATED,
        Json(vorlage::create(&state.pool, benutzer.org_id, &neu).await?),
    ))
}

/// PATCH-Body: fehlt = unverändert; `verpflegungsart: null` leert die Art.
#[derive(Debug, Deserialize)]
pub struct PatchVorlage {
    #[serde(default)]
    pub bezeichnung: Option<String>,
    #[serde(default)]
    pub beginn: Option<String>,
    #[serde(default)]
    pub ende: Option<String>,
    #[serde(default, deserialize_with = "deserialize_optional_field")]
    pub verpflegungsart: Option<Option<String>>,
    #[serde(default)]
    pub aktiv: Option<bool>,
}

/// PATCH /api/verpflegung-vorlagen/{vid} — Admin, Teiländerung, auch Deaktivieren und
/// Aktivieren. Fremd oder unbekannt 404; Ende gleich Beginn im Effektivzustand 422; danach aktiv
/// mit einem Namen, den eine andere aktive Mahlzeit trägt, 409.
pub async fn update(
    State(state): State<AppState>,
    AdminUser(benutzer): AdminUser,
    PfadParam(id): PfadParam<i64>,
    JsonBody(body): JsonBody<PatchVorlage>,
) -> Result<Json<VerpflegungVorlage>, AppError> {
    let patch = VorlagePatch {
        bezeichnung: pflicht_max_tri(
            body.bezeichnung.as_deref(),
            "bezeichnung",
            vorlage::BEZEICHNUNG_MAX,
        )?,
        beginn: body
            .beginn
            .as_deref()
            .map(|s| Uhrzeit::parse("beginn", s))
            .transpose()?,
        ende: body
            .ende
            .as_deref()
            .map(|s| Uhrzeit::parse("ende", s))
            .transpose()?,
        verpflegungsart: body
            .verpflegungsart
            .map(|a| parse_art(a.as_deref()))
            .transpose()?,
        aktiv: body.aktiv,
    };
    Ok(Json(
        vorlage::update(&state.pool, benutzer.org_id, id, &patch).await?,
    ))
}
