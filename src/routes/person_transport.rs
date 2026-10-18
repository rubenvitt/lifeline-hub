//! `POST /api/einsaetze/{id}/personen/{pid}/transport` — Transportstand festlegen (LLH-1325,
//! Change `y18v58dt-pat-kern`, Spec `personen-transport`, design.md D2/D5–D7).

use crate::app::AppState;
use crate::einsatz::einstellungen::etb_startwert;
use crate::einsatz::kontext::EinsatzSchreibfreigabe;
use crate::einsatz::modul::Personen;
use crate::error::AppError;
use crate::extract::{JsonBody, PfadParam};
use crate::geraet::stelle;
use crate::person::transport_repo::{
    self, Fachrichtung, TransportAnzeige, TransportArt, TransportPrioritaet,
};
use crate::person::{registrier_anzeige, repo};
use crate::routes::einsatz_person::{fordere_angetroffen, replay_an_person, sse_person};
use crate::routes::support::parse_enum_opt;
use axum::extract::State;
use axum::http::{HeaderMap, StatusCode};
use axum::Json;
use serde::Deserialize;

/// Ein voller Stand: jedes Feld einzeln leer, alle drei leer heben den Transport auf.
#[derive(Debug, Deserialize)]
pub struct TransportBody {
    #[serde(default)]
    pub prioritaet: Option<String>,
    #[serde(default)]
    pub art: Option<String>,
    #[serde(default)]
    pub fachrichtung: Option<String>,
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

/// ETB-Wortlaut eines Prioritätswechsels (Spec `personen-transport`, „Nur die Priorität steht im
/// ETB“): pseudonym, nur Registriernummer und Priorität. Art und Fachrichtung kennt er nicht.
pub fn etb_text(
    registrier_nr: i64,
    prioritaet: Option<TransportPrioritaet>,
    nachgetragen: bool,
) -> String {
    let wert = prioritaet.map_or("aufgehoben", |p| p.as_str());
    let text = format!(
        "Person {}: Transportpriorität {wert}",
        registrier_anzeige(registrier_nr)
    );
    if nachgetragen {
        format!("{text}, nachgetragen")
    } else {
        text
    }
}

/// Ausgang der Transport-Transaktion.
enum Festgelegt {
    /// Schon gespeichert (gleichzeitiger Replay derselben `client_id`).
    Replay(TransportAnzeige),
    Neu {
        transport: TransportAnzeige,
        etb_id: Option<i64>,
    },
}

/// Schreibberechtigt + aktiv, am UHS-Gerät nur an Personen der eigenen UHS (fremd 404). Ohne Netz
/// vormerkbar: ein Replay derselben `client_id` kommt vor dem Aktiv-Gate zurück (Muster
/// `einsatz_person::sichten`). Der Cache folgt der jüngsten Erfassungszeit. Ein ETB-Eintrag
/// entsteht nur, wenn sich die Priorität gegenüber dem zeitlich vorigen Stand ändert; ein
/// nachgereichter älterer Stand schreibt ihn zu seiner Erfassungszeit mit „nachgetragen“ und
/// behauptet nie den aktuellen Stand.
pub async fn festlegen(
    State(state): State<AppState>,
    ctx: EinsatzSchreibfreigabe<Personen>,
    headers: HeaderMap,
    PfadParam((_eid, person_id)): PfadParam<(i64, i64)>,
    JsonBody(body): JsonBody<TransportBody>,
) -> Result<(StatusCode, Json<TransportAnzeige>), AppError> {
    let einsatz_id = ctx.einsatz.id;
    stelle::fordere_person(&state.pool, ctx.geraet.as_ref(), person_id).await?;
    crate::routes::support::fordere_offline_queue_benutzer(&headers, ctx.benutzer.id)?;
    let client_id = crate::routes::support::parse_client_id(body.client_id.as_deref())?;
    if let Some(cid) = client_id.as_deref() {
        if let Some(replay) = transport_repo::nach_client_id(&state.pool, einsatz_id, cid).await? {
            return Ok((
                StatusCode::CREATED,
                Json(replay_an_person(replay, person_id, |t| t.person_id)?),
            ));
        }
    }
    ctx.fordere_aktiv()?;
    let prioritaet = parse_enum_opt(
        TransportPrioritaet::parse,
        body.prioritaet.as_deref(),
        "Unbekannte Transportpriorität",
    )?;
    let art = parse_enum_opt(
        TransportArt::parse,
        body.art.as_deref(),
        "Unbekannte Transportart",
    )?;
    let fachrichtung = parse_enum_opt(
        Fachrichtung::parse,
        body.fachrichtung.as_deref(),
        "Unbekannte Fachrichtung",
    )?;
    let person = repo::laden(&state.pool, einsatz_id, person_id).await?;
    let zeitpunkt_at = crate::routes::support::erfassungszeitpunkt(
        body.zeitpunkt_at.as_deref(),
        chrono::Utc::now(),
        &person.erfasst_at,
    )?;
    fordere_angetroffen(&person, "keinen Transport")?;
    // Zur Erfassungszeit (D7), wie bei der Sichtung.
    let bestaetigung = crate::geraet::bestaetigung::aufloesen(
        &state.pool,
        ctx.geraet.as_ref(),
        einsatz_id,
        body.bestaetigt_personal_id,
        Some(&zeitpunkt_at),
    )
    .await?;

    let startwert = etb_startwert(&state.pool, einsatz_id).await?;
    let neu = transport_repo::NeuerTransport {
        prioritaet,
        art,
        fachrichtung,
        zeitpunkt_at: &zeitpunkt_at,
        client_id: client_id.as_deref(),
        bestaetigung: bestaetigung.as_ref(),
    };
    let ergebnis = crate::write_retry!(&state.pool, |conn| {
        // Zwei gleichzeitige Übertragungen desselben Schlüssels: unter `BEGIN IMMEDIATE` sieht
        // die zweite die erste.
        if let Some(cid) = client_id.as_deref() {
            if let Some(replay) =
                transport_repo::nach_client_id(&mut *conn, einsatz_id, cid).await?
            {
                return Ok(Festgelegt::Replay(replay));
            }
        }
        let erfasst =
            transport_repo::erfassen_tx(conn, einsatz_id, person_id, &neu, ctx.benutzer.id).await?;
        let etb_id = match erfasst.prioritaetswechsel() {
            Some(neue) => {
                let text = etb_text(person.registrier_nr, neue, !erfasst.gewinnt);
                Some(
                    crate::etb::system_audit_zu_tx(
                        conn,
                        einsatz_id,
                        ctx.benutzer.id,
                        startwert,
                        &crate::person::etb_text_bestaetigt(text, bestaetigung.as_ref()),
                        &erfasst.transport.zeitpunkt_at,
                    )
                    .await?,
                )
            }
            None => None,
        };
        Ok(Festgelegt::Neu {
            transport: erfasst.transport,
            etb_id,
        })
    })?;
    let (transport, etb_id) = match ergebnis {
        Festgelegt::Replay(replay) => {
            return Ok((
                StatusCode::CREATED,
                Json(replay_an_person(replay, person_id, |t| t.person_id)?),
            ))
        }
        Festgelegt::Neu { transport, etb_id } => (transport, etb_id),
    };
    if let Some(etb_id) = etb_id {
        state.live.publiziere(einsatz_id, etb_id);
    }
    sse_person(&state, einsatz_id, person_id);
    Ok((StatusCode::CREATED, Json(transport)))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn etb_text_nennt_nur_nummer_und_prioritaet() {
        assert_eq!(
            etb_text(12, Some(TransportPrioritaet::Dringlich), false),
            "Person R-012: Transportpriorität dringlich"
        );
        assert_eq!(
            etb_text(12, None, false),
            "Person R-012: Transportpriorität aufgehoben"
        );
        assert_eq!(
            etb_text(12, Some(TransportPrioritaet::Normal), true),
            "Person R-012: Transportpriorität normal, nachgetragen"
        );
    }
}
