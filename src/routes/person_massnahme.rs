//! Maßnahmen am Patienten (LLH-1324, Change `y18v58dt-pat-kern`, Spec `personen-massnahmen`,
//! design.md D1/D5–D7):
//! - `POST /api/einsaetze/{id}/personen/{pid}/massnahmen` — erfassen,
//! - `POST /api/einsaetze/{id}/personen/{pid}/massnahmen/{mid}/aufheben` — genau einmal aufheben.
//!
//! Beide schreiben **kein ETB** und melden nur das `person`-Ereignis (Einsatz und Person).

use crate::app::AppState;
use crate::einsatz::kontext::{EinsatzSchreibfreigabe, EinsatzSchreibzugriff};
use crate::einsatz::modul::Personen;
use crate::error::AppError;
use crate::extract::{JsonBody, PfadParam};
use crate::geraet::stelle;
use crate::person::massnahme_repo::{self, MassnahmeAnzeige, MassnahmeArt};
use crate::person::repo;
use crate::routes::einsatz_person::{fordere_angetroffen, replay_an_person, sse_person};
use crate::routes::support::parse_enum;
use axum::extract::State;
use axum::http::{HeaderMap, StatusCode};
use axum::Json;
use serde::Deserialize;

#[derive(Debug, Deserialize)]
pub struct MassnahmeBody {
    pub art: String,
    /// Durchführung; fehlt = Erfassung (jetzt). Offline vorgemerkt die Zeit am Gerät.
    #[serde(default)]
    pub zeitpunkt_at: Option<String>,
    /// Namentliche Bestätigung am Gerät (LFH-1046): Kennung in `einsatz_personal`.
    #[serde(default)]
    pub bestaetigt_personal_id: Option<i64>,
    /// Idempotenzschlüssel der Offline-Queue (LLH-1138).
    #[serde(default)]
    pub client_id: Option<String>,
}

/// Schreibberechtigt + aktiv, am UHS-Gerät nur an Personen der eigenen UHS (fremd 404). Ohne Netz
/// vormerkbar: ein Replay derselben `client_id` kommt vor dem Aktiv-Gate zurück (Muster
/// `einsatz_person::notiz`). Unbekannte Maßnahme 400, storniert 409, vermisst/abgemeldet 422.
pub async fn erfassen(
    State(state): State<AppState>,
    ctx: EinsatzSchreibfreigabe<Personen>,
    headers: HeaderMap,
    PfadParam((_eid, person_id)): PfadParam<(i64, i64)>,
    JsonBody(body): JsonBody<MassnahmeBody>,
) -> Result<(StatusCode, Json<MassnahmeAnzeige>), AppError> {
    let einsatz_id = ctx.einsatz.id;
    stelle::fordere_person(&state.pool, ctx.geraet.as_ref(), person_id).await?;
    crate::routes::support::fordere_offline_queue_benutzer(&headers, ctx.benutzer.id)?;
    let client_id = crate::routes::support::parse_client_id(body.client_id.as_deref())?;
    if let Some(cid) = client_id.as_deref() {
        if let Some(replay) = massnahme_repo::nach_client_id(&state.pool, einsatz_id, cid).await? {
            return Ok((
                StatusCode::CREATED,
                Json(replay_an_person(replay, person_id, |m| m.person_id)?),
            ));
        }
    }
    ctx.fordere_aktiv()?;
    let art = parse_enum(MassnahmeArt::parse, &body.art, "Unbekannte Maßnahme")?;
    let person = repo::laden(&state.pool, einsatz_id, person_id).await?;
    // Darf vor der Registrierung liegen (Tourniquet am Fundort), nicht vor dem Einsatzbeginn.
    let zeitpunkt_at = crate::routes::support::durchfuehrungszeitpunkt(
        body.zeitpunkt_at.as_deref(),
        chrono::Utc::now(),
        &ctx.einsatz.begonnen_at,
        &person.erfasst_at,
    )?;
    fordere_angetroffen(&person, "keine Maßnahme")?;
    // Zur Durchführung (D7): eine danach entlassene Kraft bestätigt weiter.
    let bestaetigung = crate::geraet::bestaetigung::aufloesen(
        &state.pool,
        ctx.geraet.as_ref(),
        einsatz_id,
        body.bestaetigt_personal_id,
        Some(&zeitpunkt_at),
    )
    .await?;
    let massnahme = massnahme_repo::anlegen(
        &state.pool,
        einsatz_id,
        person_id,
        &massnahme_repo::NeueMassnahme {
            art,
            zeitpunkt_at: &zeitpunkt_at,
            client_id: client_id.as_deref(),
            bestaetigung: bestaetigung.as_ref(),
        },
        ctx.benutzer.id,
    )
    .await?;
    // Ein gleichzeitiger Replay kam in der Transaktion zurück; er gilt nur an seiner Person.
    let massnahme = replay_an_person(massnahme, person_id, |m| m.person_id)?;
    // BEWUSST kein ETB (Spec `personen-massnahmen`, „Maßnahmen bleiben aus ETB und Live-Kanal
    // heraus“).
    sse_person(&state, einsatz_id, person_id);
    Ok((StatusCode::CREATED, Json(massnahme)))
}

/// Hebt eine Maßnahme genau einmal auf (D1): das bedingte UPDATE entscheidet, ein zweites, auch
/// ein gleichzeitiges Aufheben ist 409. Fremde oder unbekannte Maßnahme 404, storniert 409.
pub async fn aufheben(
    State(state): State<AppState>,
    ctx: EinsatzSchreibzugriff<Personen>,
    PfadParam((_eid, person_id, massnahme_id)): PfadParam<(i64, i64, i64)>,
) -> Result<Json<MassnahmeAnzeige>, AppError> {
    let einsatz_id = ctx.einsatz.id;
    stelle::fordere_person(&state.pool, ctx.geraet.as_ref(), person_id).await?;
    let person = repo::laden(&state.pool, einsatz_id, person_id).await?;
    if person.storniert_at.is_some() {
        return Err(AppError::Conflict(
            "An einer stornierten Person wird nichts aufgehoben".into(),
        ));
    }
    let massnahme = massnahme_repo::aufheben(
        &state.pool,
        einsatz_id,
        person_id,
        massnahme_id,
        ctx.benutzer.id,
    )
    .await?;
    sse_person(&state, einsatz_id, person_id);
    Ok(Json(massnahme))
}
