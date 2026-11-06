//! `POST /api/einsaetze/{id}/personen/{pid}/anlass` — Anlass der Hilfeleistung festlegen
//! (LLH-1566, Konzept LLH-1562 Abschnitt 5.1; Muster `person_transport`).

use crate::app::AppState;
use crate::einsatz::kontext::EinsatzSchreibfreigabe;
use crate::einsatz::modul::Personen;
use crate::error::AppError;
use crate::extract::{JsonBody, PfadParam};
use crate::geraet::stelle;
use crate::person::anlass_repo::{self, AnlassAnzeige, PersonAnlass};
use crate::person::repo;
use crate::routes::einsatz_person::{fordere_angetroffen, replay_an_person, sse_person};
use crate::routes::support::parse_enum_opt;
use axum::extract::State;
use axum::http::{HeaderMap, StatusCode};
use axum::Json;
use serde::Deserialize;

/// Ein voller Stand: ein Anlass aus dem Katalog, leer hebt ihn auf.
#[derive(Debug, Deserialize)]
pub struct AnlassBody {
    #[serde(default)]
    pub anlass: Option<String>,
    /// Erfassungszeit, offline vorgemerkt; fehlt = jetzt.
    #[serde(default)]
    pub zeitpunkt_at: Option<String>,
    /// Idempotenzschlüssel der Offline-Queue.
    #[serde(default)]
    pub client_id: Option<String>,
}

/// Ausgang der Anlass-Transaktion.
enum Festgelegt {
    /// Schon gespeichert (gleichzeitiger Replay derselben `client_id`).
    Replay(AnlassAnzeige),
    Neu(AnlassAnzeige),
}

/// Schreibberechtigt + aktiv, am UHS-Gerät nur an Personen der eigenen UHS (fremd 404). Ohne Netz
/// vormerkbar: ein Replay derselben `client_id` kommt vor dem Aktiv-Gate zurück. Der Cache folgt
/// der jüngsten Erfassungszeit. **Kein ETB-Eintrag** (LLH-1109): das Live-Ereignis nennt nur
/// Einsatz und Person.
pub async fn festlegen(
    State(state): State<AppState>,
    ctx: EinsatzSchreibfreigabe<Personen>,
    headers: HeaderMap,
    PfadParam((_eid, person_id)): PfadParam<(i64, i64)>,
    JsonBody(body): JsonBody<AnlassBody>,
) -> Result<(StatusCode, Json<AnlassAnzeige>), AppError> {
    let einsatz_id = ctx.einsatz.id;
    stelle::fordere_person(&state.pool, ctx.geraet.as_ref(), person_id).await?;
    crate::routes::support::fordere_offline_queue_benutzer(&headers, ctx.benutzer.id)?;
    let client_id = crate::routes::support::parse_client_id(body.client_id.as_deref())?;
    if let Some(cid) = client_id.as_deref() {
        if let Some(replay) = anlass_repo::nach_client_id(&state.pool, einsatz_id, cid).await? {
            return Ok((
                StatusCode::CREATED,
                Json(replay_an_person(replay, person_id, |a| a.person_id)?),
            ));
        }
    }
    ctx.fordere_aktiv()?;
    let anlass = parse_enum_opt(
        PersonAnlass::parse,
        body.anlass.as_deref(),
        "Unbekannter Anlass",
    )?;
    let person = repo::laden(&state.pool, einsatz_id, person_id).await?;
    let zeitpunkt_at = crate::routes::support::erfassungszeitpunkt(
        body.zeitpunkt_at.as_deref(),
        chrono::Utc::now(),
        &person.erfasst_at,
    )?;
    fordere_angetroffen(&person, "keinen Anlass")?;

    let neu = anlass_repo::NeuerAnlass {
        anlass,
        zeitpunkt_at: &zeitpunkt_at,
        client_id: client_id.as_deref(),
    };
    let ergebnis = crate::write_retry!(&state.pool, |conn| {
        // Zwei gleichzeitige Übertragungen desselben Schlüssels: unter `BEGIN IMMEDIATE` sieht
        // die zweite die erste.
        if let Some(cid) = client_id.as_deref() {
            if let Some(replay) = anlass_repo::nach_client_id(&mut *conn, einsatz_id, cid).await? {
                return Ok(Festgelegt::Replay(replay));
            }
        }
        Ok(Festgelegt::Neu(
            anlass_repo::erfassen_tx(conn, einsatz_id, person_id, &neu, ctx.benutzer.id).await?,
        ))
    })?;
    match ergebnis {
        Festgelegt::Replay(replay) => Ok((
            StatusCode::CREATED,
            Json(replay_an_person(replay, person_id, |a| a.person_id)?),
        )),
        Festgelegt::Neu(stand) => {
            sse_person(&state, einsatz_id, person_id);
            Ok((StatusCode::CREATED, Json(stand)))
        }
    }
}
