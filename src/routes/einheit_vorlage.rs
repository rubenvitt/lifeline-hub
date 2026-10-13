//! Katalog „Einheiten-Vorlagen“ (LLH-1042, Spec `openspec/specs/einheit-vorlagen`). Lesen: jeder
//! Angemeldete der Organisation (LLH-1049 liest im Einsatz); Schreiben: Admin. Kein DELETE —
//! `aktiv` schaltet in beide Richtungen. Fahrzeuge und Stammbesetzung werden je als ganze Liste
//! ersetzt (PUT).
//! `stammdaten` meldet die Middleware `routes::live::stammdaten_live` (Präfix in
//! `STAMMDATEN_PFADE`).

use crate::app::AppState;
use crate::auth::session::{AdminUser, CurrentUser};
use crate::einheit_vorlage::repo::{self, NewVorlage, VorlagePatch};
use crate::einheit_vorlage::{
    normalize_fahrzeug_ids, normalize_personal, EinheitVorlage, PersonalEntry, BEMERKUNG_MAX,
    FUNKRUFNAME_MAX, NAME_MAX, TZ_MAX,
};
use crate::error::AppError;
use crate::extract::{JsonBody, PfadParam};
use crate::routes::support::{
    deserialize_optional_field, hoechstens, optional_max, parse_enum_opt, pflicht_max,
    pflicht_max_tri, trimme_tri,
};
use crate::staerke::{Staerke, StaerkePosition};
use axum::extract::{Query, State};
use axum::http::StatusCode;
use axum::Json;
use serde::Deserialize;

#[derive(Debug, Deserialize)]
pub struct ListQuery {
    pub nur_aktive: Option<bool>,
}

/// GET /api/einheit-vorlagen — Vorlagen der eigenen Organisation samt Fahrzeugen und
/// Stammbesetzung; ohne `nur_aktive=false` nur die aktiven.
pub async fn list(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Query(q): Query<ListQuery>,
) -> Result<Json<Vec<EinheitVorlage>>, AppError> {
    let nur_aktive = q.nur_aktive.unwrap_or(true);
    Ok(Json(
        repo::list(&state.pool, benutzer.org_id, nur_aktive).await?,
    ))
}

#[derive(Debug, Deserialize)]
pub struct VorlageBody {
    pub name: String,
    pub typ_id: i64,
    pub ueber_vorlage_id: Option<i64>,
    pub funkrufname: Option<String>,
    pub tz_fachaufgabe: Option<String>,
    pub tz_organisation: Option<String>,
    pub soll_fuehrer: Option<i64>,
    pub soll_unterfuehrer: Option<i64>,
    pub soll_mannschaft: Option<i64>,
    pub bemerkung: Option<String>,
    #[serde(default)]
    pub sortier: i64,
}

/// POST /api/einheit-vorlagen — Admin. Neue Vorlage (aktiv). Feldfehler 400 (leerer Name,
/// Grenzen, halbes Soll), fremder Typ oder fremde Unterstellung 422, Name doppelt 409.
pub async fn create(
    State(state): State<AppState>,
    AdminUser(benutzer): AdminUser,
    JsonBody(body): JsonBody<VorlageBody>,
) -> Result<(StatusCode, Json<EinheitVorlage>), AppError> {
    let name = pflicht_max(&body.name, "Name", NAME_MAX)?;
    let funkrufname = optional_max(body.funkrufname, "Funkrufname", FUNKRUFNAME_MAX)?;
    let tz_fachaufgabe = optional_max(body.tz_fachaufgabe, "Fachaufgabe", TZ_MAX)?;
    let tz_organisation = optional_max(body.tz_organisation, "Organisation", TZ_MAX)?;
    let bemerkung = optional_max(body.bemerkung, "Bemerkung", BEMERKUNG_MAX)?;
    let soll = Staerke::aus_optionen(
        body.soll_fuehrer,
        body.soll_unterfuehrer,
        body.soll_mannschaft,
    )
    .map_err(AppError::Validation)?;
    let vorlage = repo::create(
        &state.pool,
        benutzer.org_id,
        NewVorlage {
            name: &name,
            typ_id: body.typ_id,
            ueber_vorlage_id: body.ueber_vorlage_id,
            funkrufname: funkrufname.as_deref(),
            tz_fachaufgabe: tz_fachaufgabe.as_deref(),
            tz_organisation: tz_organisation.as_deref(),
            soll,
            bemerkung: bemerkung.as_deref(),
            sortier: body.sortier,
        },
    )
    .await?;
    Ok((StatusCode::CREATED, Json(vorlage)))
}

/// PATCH-Body (Tri-State): absent = unverändert; `null`/`""` bei den Freitexten = leeren, `null`
/// bei `ueber_vorlage_id` = Wurzel, `null` beim Soll = Spalte leeren (geprüft wird das Trio
/// nach dem Patch). Name und Typ dürfen fehlen, der Name aber nicht leer sein.
#[derive(Debug, Deserialize)]
pub struct PatchVorlage {
    pub name: Option<String>,
    pub typ_id: Option<i64>,
    #[serde(default, deserialize_with = "deserialize_optional_field")]
    pub ueber_vorlage_id: Option<Option<i64>>,
    #[serde(default, deserialize_with = "deserialize_optional_field")]
    pub funkrufname: Option<Option<String>>,
    #[serde(default, deserialize_with = "deserialize_optional_field")]
    pub tz_fachaufgabe: Option<Option<String>>,
    #[serde(default, deserialize_with = "deserialize_optional_field")]
    pub tz_organisation: Option<Option<String>>,
    #[serde(default, deserialize_with = "deserialize_optional_field")]
    pub soll_fuehrer: Option<Option<i64>>,
    #[serde(default, deserialize_with = "deserialize_optional_field")]
    pub soll_unterfuehrer: Option<Option<i64>>,
    #[serde(default, deserialize_with = "deserialize_optional_field")]
    pub soll_mannschaft: Option<Option<i64>>,
    #[serde(default, deserialize_with = "deserialize_optional_field")]
    pub bemerkung: Option<Option<String>>,
    pub sortier: Option<i64>,
    pub aktiv: Option<bool>,
}

/// Trimmt ein gesendetes Tri-State-Feld und prüft es gegen seine Grenze.
fn check_tri(
    wert: Option<Option<String>>,
    feld: &str,
    max: usize,
) -> Result<Option<Option<String>>, AppError> {
    let wert = trimme_tri(wert);
    if let Some(Some(w)) = &wert {
        hoechstens(w, feld, max)?;
    }
    Ok(wert)
}

/// PATCH /api/einheit-vorlagen/{id} — Admin, Teil-Patch. Fremde oder unbekannte id → 404;
/// Zyklus, fremder Typ, fremde Unterstellung oder ein Fahrzeug doppelt im neuen Baum → 422.
pub async fn update(
    State(state): State<AppState>,
    AdminUser(benutzer): AdminUser,
    PfadParam(id): PfadParam<i64>,
    JsonBody(body): JsonBody<PatchVorlage>,
) -> Result<Json<EinheitVorlage>, AppError> {
    let name = pflicht_max_tri(body.name.as_deref(), "Name", NAME_MAX)?;
    let funkrufname = check_tri(body.funkrufname, "Funkrufname", FUNKRUFNAME_MAX)?;
    let tz_fachaufgabe = check_tri(body.tz_fachaufgabe, "Fachaufgabe", TZ_MAX)?;
    let tz_organisation = check_tri(body.tz_organisation, "Organisation", TZ_MAX)?;
    let bemerkung = check_tri(body.bemerkung, "Bemerkung", BEMERKUNG_MAX)?;
    let vorlage = repo::update(
        &state.pool,
        benutzer.org_id,
        id,
        VorlagePatch {
            name: name.as_deref(),
            typ_id: body.typ_id,
            ueber_vorlage_id: body.ueber_vorlage_id,
            funkrufname: funkrufname.as_ref().map(|v| v.as_deref()),
            tz_fachaufgabe: tz_fachaufgabe.as_ref().map(|v| v.as_deref()),
            tz_organisation: tz_organisation.as_ref().map(|v| v.as_deref()),
            soll_fuehrer: body.soll_fuehrer,
            soll_unterfuehrer: body.soll_unterfuehrer,
            soll_mannschaft: body.soll_mannschaft,
            bemerkung: bemerkung.as_ref().map(|v| v.as_deref()),
            sortier: body.sortier,
            aktiv: body.aktiv,
        },
    )
    .await?;
    Ok(Json(vorlage))
}

#[derive(Debug, Deserialize)]
pub struct FahrzeugeBody {
    pub fahrzeug_ids: Vec<i64>,
}

/// PUT /api/einheit-vorlagen/{id}/fahrzeuge — Admin. Ersetzt die Stamm-Fahrzeuge durch genau
/// diese Liste (Reihenfolge = Anzeige). Zu lang → 400; fremd, neu außer Dienst oder schon im
/// selben Baum → 422; Personen auf einem entfernten Fahrzeug verlieren die Bindung.
pub async fn replace_fahrzeuge(
    State(state): State<AppState>,
    AdminUser(benutzer): AdminUser,
    PfadParam(id): PfadParam<i64>,
    JsonBody(body): JsonBody<FahrzeugeBody>,
) -> Result<Json<EinheitVorlage>, AppError> {
    let ids = normalize_fahrzeug_ids(body.fahrzeug_ids)?;
    Ok(Json(
        repo::replace_fahrzeuge(&state.pool, benutzer.org_id, id, &ids).await?,
    ))
}

#[derive(Debug, Deserialize)]
pub struct PersonalZeile {
    pub personal_id: i64,
    pub fahrzeug_id: Option<i64>,
    pub staerke_position: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct PersonalBody {
    pub personal: Vec<PersonalZeile>,
}

/// PUT /api/einheit-vorlagen/{id}/personal — Admin. Ersetzt die Stammbesetzung durch genau diese
/// Liste. Unbekannte Position oder zu lang → 400; fremde oder neu außer Dienst gestellte Person,
/// Fahrzeug außerhalb der Vorlage oder Person schon im selben Baum → 422.
pub async fn replace_personal(
    State(state): State<AppState>,
    AdminUser(benutzer): AdminUser,
    PfadParam(id): PfadParam<i64>,
    JsonBody(body): JsonBody<PersonalBody>,
) -> Result<Json<EinheitVorlage>, AppError> {
    let entries = body
        .personal
        .into_iter()
        .map(|z| {
            Ok(PersonalEntry {
                personal_id: z.personal_id,
                fahrzeug_id: z.fahrzeug_id,
                staerke_position: parse_enum_opt(
                    StaerkePosition::parse,
                    z.staerke_position.as_deref(),
                    "Ungültige Stärke-Position",
                )?,
            })
        })
        .collect::<Result<Vec<_>, AppError>>()?;
    let entries = normalize_personal(entries)?;
    Ok(Json(
        repo::replace_personal(&state.pool, benutzer.org_id, id, &entries).await?,
    ))
}
