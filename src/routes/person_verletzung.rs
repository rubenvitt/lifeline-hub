//! Verletzungen am Körperschema (LLH-1113, Change `y18v58dt-pat-kern`, Spec
//! `personen-verletzungen`, design.md D1/D4–D7):
//! - `POST /api/einsaetze/{id}/personen/{pid}/verletzungen` — markieren,
//! - `POST /api/einsaetze/{id}/personen/{pid}/verletzungen/{vid}/aufheben` — genau einmal aufheben.
//!
//! Beide schreiben **kein ETB** und melden nur das `person`-Ereignis (Einsatz und Person): Region,
//! Art und Notiz stehen weder im ETB noch im Live-Kanal.

use crate::app::AppState;
use crate::einsatz::kontext::{EinsatzSchreibfreigabe, EinsatzSchreibzugriff};
use crate::einsatz::modul::Personen;
use crate::error::AppError;
use crate::extract::{JsonBody, PfadParam};
use crate::geraet::stelle;
use crate::person::verletzung_repo::{
    self, KoerperRegion, VerletzungAnsicht, VerletzungAnzeige, VerletzungArt, VerletzungSchwere,
};
use crate::person::{repo, VERLETZUNG_NOTIZ_MAX};
use crate::routes::einsatz_person::{fordere_angetroffen, replay_an_person, sse_person};
use crate::routes::support::{optional_max, parse_enum, parse_enum_opt};
use axum::extract::State;
use axum::http::{HeaderMap, StatusCode};
use axum::Json;
use serde::Deserialize;

#[derive(Debug, Deserialize)]
pub struct VerletzungBody {
    pub ansicht: String,
    pub region: String,
    pub art: String,
    #[serde(default)]
    pub schwere: Option<String>,
    /// Lage, je 0 bis 1 normiert auf die Ansicht; nur als Paar.
    #[serde(default)]
    pub x: Option<f64>,
    #[serde(default)]
    pub y: Option<f64>,
    #[serde(default)]
    pub notiz: Option<String>,
    /// Namentliche Bestätigung am Gerät (LFH-1046): Kennung in `einsatz_personal`.
    #[serde(default)]
    pub bestaetigt_personal_id: Option<i64>,
    /// Erfassungszeit, offline vorgemerkt (LLH-1138); fehlt = jetzt.
    #[serde(default)]
    pub zeitpunkt_at: Option<String>,
    /// Idempotenzschlüssel der Offline-Queue (LLH-1138).
    #[serde(default)]
    pub client_id: Option<String>,
}

/// Eine Koordinate der Lage für sich: außerhalb 0..1 (oder keine Zahl) ist 400.
fn pruefe_lagewert(wert: Option<f64>, feld: &str) -> Result<(), AppError> {
    match wert {
        Some(w) if !(0.0..=1.0).contains(&w) => Err(AppError::Validation(format!(
            "{feld} muss zwischen 0 und 1 liegen"
        ))),
        _ => Ok(()),
    }
}

/// Schreibberechtigt + aktiv, am UHS-Gerät nur an Personen der eigenen UHS (fremd 404). Erst das
/// Feld für sich (Katalog, Lage 0..1, Notizgrenze, Zukunft: 400), dann der Zusammenhang
/// (storniert 409, vermisst/abgemeldet 422, Region nicht in der Ansicht 422, halbe Lage 422). Ohne
/// Netz vormerkbar: ein Replay derselben `client_id` kommt vor dem Aktiv-Gate zurück.
pub async fn markieren(
    State(state): State<AppState>,
    ctx: EinsatzSchreibfreigabe<Personen>,
    headers: HeaderMap,
    PfadParam((_eid, person_id)): PfadParam<(i64, i64)>,
    JsonBody(body): JsonBody<VerletzungBody>,
) -> Result<(StatusCode, Json<VerletzungAnzeige>), AppError> {
    let einsatz_id = ctx.einsatz.id;
    stelle::fordere_person(&state.pool, ctx.geraet.as_ref(), person_id).await?;
    crate::routes::support::fordere_offline_queue_benutzer(&headers, ctx.benutzer.id)?;
    let client_id = crate::routes::support::parse_client_id(body.client_id.as_deref())?;
    if let Some(cid) = client_id.as_deref() {
        if let Some(replay) = verletzung_repo::nach_client_id(&state.pool, einsatz_id, cid).await? {
            return Ok((
                StatusCode::CREATED,
                Json(replay_an_person(replay, person_id, |v| v.person_id)?),
            ));
        }
    }
    ctx.fordere_aktiv()?;
    let ansicht = parse_enum(
        VerletzungAnsicht::parse,
        &body.ansicht,
        "Unbekannte Ansicht",
    )?;
    let region = parse_enum(
        KoerperRegion::parse,
        &body.region,
        "Unbekannte Körperregion",
    )?;
    let art = parse_enum(
        VerletzungArt::parse,
        &body.art,
        "Unbekannte Art der Verletzung",
    )?;
    let schwere = parse_enum_opt(
        VerletzungSchwere::parse,
        body.schwere.as_deref(),
        "Unbekannte Schwere",
    )?;
    pruefe_lagewert(body.x, "x")?;
    pruefe_lagewert(body.y, "y")?;
    let notiz = optional_max(body.notiz, "Notiz", VERLETZUNG_NOTIZ_MAX)?;
    let person = repo::laden(&state.pool, einsatz_id, person_id).await?;
    let zeitpunkt_at = crate::routes::support::erfassungszeitpunkt(
        body.zeitpunkt_at.as_deref(),
        chrono::Utc::now(),
        &person.erfasst_at,
    )?;
    fordere_angetroffen(&person, "keine Verletzung")?;
    if !region.gibt_es_in(ansicht) {
        return Err(AppError::UnprocessableEntity(format!(
            "Die Region {} gibt es in der Ansicht {} nicht",
            region.as_str(),
            ansicht.as_str()
        )));
    }
    let lage = match (body.x, body.y) {
        (Some(x), Some(y)) => Some((x, y)),
        (None, None) => None,
        _ => {
            return Err(AppError::UnprocessableEntity(
                "x und y müssen gemeinsam gesetzt oder gemeinsam leer sein".into(),
            ))
        }
    };
    // Zur Erfassungszeit (D7), wie bei der Sichtung.
    let bestaetigung = crate::geraet::bestaetigung::aufloesen(
        &state.pool,
        ctx.geraet.as_ref(),
        einsatz_id,
        body.bestaetigt_personal_id,
        Some(&zeitpunkt_at),
    )
    .await?;
    let verletzung = verletzung_repo::anlegen(
        &state.pool,
        einsatz_id,
        person_id,
        &verletzung_repo::NeueVerletzung {
            ansicht,
            region,
            art,
            schwere,
            lage,
            notiz: notiz.as_deref(),
            zeitpunkt_at: &zeitpunkt_at,
            client_id: client_id.as_deref(),
            bestaetigung: bestaetigung.as_ref(),
        },
        ctx.benutzer.id,
    )
    .await?;
    // Ein gleichzeitiger Replay kam in der Transaktion zurück; er gilt nur an seiner Person.
    let verletzung = replay_an_person(verletzung, person_id, |v| v.person_id)?;
    // BEWUSST kein ETB (Spec `personen-verletzungen`).
    sse_person(&state, einsatz_id, person_id);
    Ok((StatusCode::CREATED, Json(verletzung)))
}

/// Hebt eine Verletzung genau einmal auf (D1): das bedingte UPDATE entscheidet, ein zweites, auch
/// ein gleichzeitiges Aufheben ist 409. Fremde oder unbekannte Verletzung 404, storniert 409.
pub async fn aufheben(
    State(state): State<AppState>,
    ctx: EinsatzSchreibzugriff<Personen>,
    PfadParam((_eid, person_id, verletzung_id)): PfadParam<(i64, i64, i64)>,
) -> Result<Json<VerletzungAnzeige>, AppError> {
    let einsatz_id = ctx.einsatz.id;
    stelle::fordere_person(&state.pool, ctx.geraet.as_ref(), person_id).await?;
    let person = repo::laden(&state.pool, einsatz_id, person_id).await?;
    if person.storniert_at.is_some() {
        return Err(AppError::Conflict(
            "An einer stornierten Person wird nichts aufgehoben".into(),
        ));
    }
    let verletzung = verletzung_repo::aufheben(
        &state.pool,
        einsatz_id,
        person_id,
        verletzung_id,
        ctx.benutzer.id,
    )
    .await?;
    sse_person(&state, einsatz_id, person_id);
    Ok(Json(verletzung))
}
