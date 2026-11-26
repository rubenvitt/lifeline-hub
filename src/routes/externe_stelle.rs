//! Katalog „Externe Stellen“ (LFH-1194, design.md D4). Lesen: jeder Angemeldete der
//! Organisation; Schreiben: Admin. Kein DELETE — `aktiv` schaltet in beide Richtungen.
//! `stammdaten` meldet die Middleware `routes::live::stammdaten_live` (Präfix in
//! `STAMMDATEN_PFADE`).

use crate::app::AppState;
use crate::auth::session::{AdminUser, CurrentUser};
use crate::error::AppError;
use crate::externe_stelle::repo::{self, NeueStelle, StellePatch};
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
pub struct ListQuery {
    pub nur_aktive: Option<bool>,
}

/// GET /api/external-agencies — Stellen der eigenen Organisation; ohne `nur_aktive=false` nur die
/// aktiven.
pub async fn list(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Query(q): Query<ListQuery>,
) -> Result<Json<Vec<ExterneStelle>>, AppError> {
    let nur_aktive = q.nur_aktive.unwrap_or(true);
    Ok(Json(
        repo::list(&state.pool, benutzer.org_id, nur_aktive).await?,
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

/// POST /api/external-agencies — Admin. Neue Stelle (aktiv).
pub async fn create(
    State(state): State<AppState>,
    AdminUser(benutzer): AdminUser,
    JsonBody(body): JsonBody<StelleBody>,
) -> Result<(StatusCode, Json<ExterneStelle>), AppError> {
    let bezeichnung = pflicht_max(&body.bezeichnung, "Bezeichnung", BEZEICHNUNG_MAX)?;
    let art = parse_enum(ExterneStelleArt::parse, body.art.trim(), UNGUELTIGE_ART)?;
    let rufnummer = optional_max(body.rufnummer, "Rufnummer", KURZ_MAX)?;
    let funkrufname = optional_max(body.funkrufname, "Funkrufname", KURZ_MAX)?;
    let stelle = repo::create(
        &state.pool,
        benutzer.org_id,
        NeueStelle {
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
fn check_kurz_tri(
    wert: Option<Option<String>>,
    feld: &str,
) -> Result<Option<Option<String>>, AppError> {
    let wert = trimme_tri(wert);
    if let Some(Some(w)) = &wert {
        hoechstens(w, feld, KURZ_MAX)?;
    }
    Ok(wert)
}

/// PATCH /api/external-agencies/{id} — Admin, Teil-Patch. Fremde oder unbekannte id → 404;
/// unzulässige Markierung „zuständig“ → 422 (design.md D3).
pub async fn update(
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
    let rufnummer = check_kurz_tri(body.rufnummer, "Rufnummer")?;
    let funkrufname = check_kurz_tri(body.funkrufname, "Funkrufname")?;
    let stelle = repo::update(
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

// ---------------------------------------------------------------------------------------------
// Kanaladressen (LLH-2093). Lesen jeder der Organisation, Schreiben Admin; fremd → 404.
// ---------------------------------------------------------------------------------------------

use crate::externe_stelle::kanal::{self, KanalPatch};
use crate::externe_stelle::{ExterneStelleKanal, KanalArt, KanalMitStelle};

const UNGUELTIGER_KANAL: &str = "Ungültiger Kanal";
const KANAL_NICHT_FREIGESCHALTET: &str = "Dieser Kanal ist noch nicht freigeschaltet";

/// Nimmt nur freigeschaltete Kanäle an (E-Mail, Fax), alles andere ist 400.
fn parse_kanal(roh: &str) -> Result<KanalArt, AppError> {
    let kanal = parse_enum(KanalArt::parse, roh.trim(), UNGUELTIGER_KANAL)?;
    if !kanal.is_freigeschaltet() {
        return Err(AppError::Validation(KANAL_NICHT_FREIGESCHALTET.into()));
    }
    Ok(kanal)
}

/// Prüft eine Adresse je Kanal und bringt sie in Speicherform.
fn pruefe_adresse(kanal: KanalArt, roh: &str) -> Result<String, AppError> {
    match kanal {
        KanalArt::Email => kanal::normalize_email(roh).map_err(AppError::Validation),
        KanalArt::Fax => kanal::normalize_fax(roh).map_err(AppError::Validation),
        // `parse_kanal` lässt nur freigeschaltete Kanäle durch.
        _ => Err(AppError::Validation(KANAL_NICHT_FREIGESCHALTET.into())),
    }
}

/// GET /api/external-agencies/{id}/channels — Adressen einer Stelle der eigenen Organisation.
pub async fn kanal_list(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    PfadParam(id): PfadParam<i64>,
) -> Result<Json<Vec<ExterneStelleKanal>>, AppError> {
    Ok(Json(kanal::list(&state.pool, benutzer.org_id, id).await?))
}

#[derive(Debug, Deserialize)]
pub struct KanalQuery {
    pub channel: String,
}

/// GET /api/external-agencies/channels?channel=email|fax — alle Adressen eines Kanals der aktiven Stellen der
/// Organisation mit ihrer Stelle (Auswahl im Senden-Dialog).
pub async fn kanal_sammlung(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Query(q): Query<KanalQuery>,
) -> Result<Json<Vec<KanalMitStelle>>, AppError> {
    let art = parse_kanal(&q.channel)?;
    let zeilen = kanal::list_fuer_org(&state.pool, benutzer.org_id, art).await?;
    Ok(Json(
        zeilen
            .into_iter()
            .map(|(stelle, channel)| KanalMitStelle {
                channel,
                agency_id: stelle.id,
                agency_name: stelle.bezeichnung,
            })
            .collect(),
    ))
}

#[derive(Debug, Deserialize)]
pub struct KanalBody {
    pub channel: String,
    pub address: String,
    pub label: Option<String>,
}

/// POST /api/external-agencies/{id}/channels — Admin.
pub async fn kanal_create(
    State(state): State<AppState>,
    AdminUser(benutzer): AdminUser,
    PfadParam(id): PfadParam<i64>,
    JsonBody(body): JsonBody<KanalBody>,
) -> Result<(StatusCode, Json<ExterneStelleKanal>), AppError> {
    let art = parse_kanal(&body.channel)?;
    let adresse = pruefe_adresse(art, &body.address)?;
    let label = optional_max(body.label, "Bezeichnung", kanal::BEZEICHNUNG_MAX)?;
    let k = kanal::create(
        &state.pool,
        benutzer.org_id,
        id,
        art,
        &adresse,
        label.as_deref(),
    )
    .await?;
    Ok((StatusCode::CREATED, Json(k)))
}

/// PATCH-Body (Tri-State): absent = unverändert; `label` `null`/`""` leert die Bezeichnung. Der
/// Kanal einer Adresse ändert sich nicht.
#[derive(Debug, Deserialize)]
pub struct PatchKanal {
    pub address: Option<String>,
    #[serde(default, deserialize_with = "deserialize_optional_field")]
    pub label: Option<Option<String>>,
}

/// PATCH /api/external-agencies/{id}/channels/{kanal_id} — Admin.
pub async fn kanal_update(
    State(state): State<AppState>,
    AdminUser(benutzer): AdminUser,
    PfadParam((id, kanal_id)): PfadParam<(i64, i64)>,
    JsonBody(body): JsonBody<PatchKanal>,
) -> Result<Json<ExterneStelleKanal>, AppError> {
    let bisher = nur_diese_stelle(&state, benutzer.org_id, id, kanal_id).await?;
    let address = body
        .address
        .as_deref()
        .map(|a| pruefe_adresse(bisher.channel, a))
        .transpose()?;
    let label = trimme_tri(body.label);
    if let Some(Some(l)) = &label {
        hoechstens(l, "Bezeichnung", kanal::BEZEICHNUNG_MAX)?;
    }
    let k = kanal::update(
        &state.pool,
        benutzer.org_id,
        kanal_id,
        KanalPatch {
            address: address.as_deref(),
            label: label.as_ref().map(|v| v.as_deref()),
        },
    )
    .await?;
    Ok(Json(k))
}

/// DELETE /api/external-agencies/{id}/channels/{kanal_id} — Admin.
pub async fn kanal_delete(
    State(state): State<AppState>,
    AdminUser(benutzer): AdminUser,
    PfadParam((id, kanal_id)): PfadParam<(i64, i64)>,
) -> Result<StatusCode, AppError> {
    nur_diese_stelle(&state, benutzer.org_id, id, kanal_id).await?;
    kanal::delete(&state.pool, benutzer.org_id, kanal_id).await?;
    Ok(StatusCode::NO_CONTENT)
}

/// Die Adresse gehört zur Stelle des Pfads und zur Organisation, sonst 404.
async fn nur_diese_stelle(
    state: &AppState,
    org_id: i64,
    stelle_id: i64,
    kanal_id: i64,
) -> Result<ExterneStelleKanal, AppError> {
    let mut conn = state.pool.acquire().await?;
    let (_, k) = kanal::load_in_org(&mut conn, org_id, kanal_id).await?;
    if k.externe_stelle_id != stelle_id {
        return Err(AppError::NotFound);
    }
    Ok(k)
}
