//! Routen der Kräfte-Zeitachse (LFH-552): Perioden je Einheit/Person (Listen fürs Meldebild und
//! die Personal-Seite), Zeitachse einer Kraft, Nachtrag und Streichung.
//!
//! Alle Pfade liegen unter den Präfixen der Module Einheiten bzw. Personal und erben deren
//! Gate strukturell (`EinsatzLesezugriff`/`EinsatzSchreibzugriff`, design.md D6). Zeiten werden
//! hier normalisiert (`etb::normalisiere_zeit`, 400 bei Unparsbarem), nie im Repo.
//!
//! Statuscodes (LFH-267): Art fehlt/unbekannt/`abloesung`, Zeitpunkt fehlt, leerer Grund → 400;
//! Zukunft, Perioden-Verstoß, doppelte Streichung, Streichen eines Ablösungsereignisses → 422;
//! fremde Kraft oder fremdes Ereignis → 404.

use axum::extract::State;
use axum::http::StatusCode;
use axum::Json;
use serde::Deserialize;

use crate::app::AppState;
use crate::einsatz::einstellungen::etb_startwert;
use crate::einsatz::kontext::{EinsatzLesezugriff, EinsatzSchreibzugriff};
use crate::einsatz::modul::{Einheiten, Personal};
use crate::error::AppError;
use crate::extract::{JsonBody, PfadParam};
use crate::live::LiveEvent;
use crate::zeitachse::repo::{self, Beruehrt, Kraft, Neu, Schreibergebnis};
use crate::zeitachse::{
    EinheitPerioden, PersonPerioden, ZeitachseAnzeige, ZeitachseArt, ZeitachseQuelle,
};

/// Ein Nachtrag darf so weit vor der Serveruhr liegen, ohne als „Zukunft" zu gelten: die Uhr
/// des Geräts im Fahrzeug geht selten sekundengenau.
const UHRENTOLERANZ_MINUTEN: i64 = 2;

#[derive(Debug, Deserialize)]
pub struct NachtragBody {
    art: String,
    zeitpunkt_at: String,
    #[serde(default)]
    notiz: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct StreichenBody {
    grund: String,
}

/// Art eines Nachtrags: Pflicht, bekannt, nie `abloesung` (die entsteht nur aus dem Vollzug).
fn nachtrag_art(roh: &str) -> Result<ZeitachseArt, AppError> {
    match ZeitachseArt::parse(roh.trim()) {
        Some(ZeitachseArt::Abloesung) => Err(AppError::Validation(
            "Eine Ablösung entsteht nur aus dem Vollzug im Modul Ablösung".into(),
        )),
        Some(a) => Ok(a),
        None => Err(AppError::Validation(format!(
            "Unbekannte Art '{roh}' (erlaubt: alarmierung, eintreffen, entlassung)"
        ))),
    }
}

fn nachtrag_zeit(roh: &str, jetzt: &str) -> Result<String, AppError> {
    let roh = roh.trim();
    if roh.is_empty() {
        return Err(AppError::Validation("zeitpunkt_at fehlt".into()));
    }
    let zeit = crate::etb::normalisiere_zeit(roh)?;
    let grenze = crate::zeit::plus_minuten(jetzt, UHRENTOLERANZ_MINUTEN)
        .unwrap_or_else(|| jetzt.to_string());
    if zeit > grenze {
        return Err(AppError::UnprocessableEntity(
            "Der Zeitpunkt liegt in der Zukunft".into(),
        ));
    }
    Ok(zeit)
}

fn notiz(roh: Option<String>) -> Option<String> {
    roh.map(|s| s.trim().to_string()).filter(|s| !s.is_empty())
}

/// Nach dem Commit: ETB-Kurzruf, die Kraft selbst und jede per Fan-out berührte Person.
fn publiziere(state: &AppState, einsatz_id: i64, etb_id: i64, kraft: Kraft, beruehrt: &Beruehrt) {
    state.live.publiziere(einsatz_id, etb_id);
    match kraft {
        Kraft::Einheit(id) => {
            state
                .live
                .publiziere_objekt(einsatz_id, LiveEvent::Einheit, "einheit_id", id)
        }
        Kraft::Person(id) => {
            super::einsatz_personal::sse_personal(state, einsatz_id, id);
        }
    }
    for p in &beruehrt.personen {
        super::einsatz_personal::sse_personal(state, einsatz_id, *p);
    }
}

async fn nachtragen(
    state: &AppState,
    einsatz_id: i64,
    benutzer_id: i64,
    kraft: Kraft,
    body: NachtragBody,
) -> Result<ZeitachseAnzeige, AppError> {
    let jetzt = crate::zeit::jetzt();
    let art = nachtrag_art(&body.art)?;
    let zeitpunkt = nachtrag_zeit(&body.zeitpunkt_at, &jetzt)?;
    let notiz = notiz(body.notiz);
    let startwert = etb_startwert(&state.pool, einsatz_id).await?;
    let tz = crate::verpflegung::repo::zeitzone(&state.pool, einsatz_id).await?;
    let (etb_id, beruehrt) = crate::write_retry!(&state.pool, |conn| {
        let name = repo::kraft_name_tx(conn, einsatz_id, kraft).await?;
        let (ergebnis, beruehrt) = repo::schreibe_tx(
            conn,
            einsatz_id,
            benutzer_id,
            kraft,
            Neu {
                art,
                zeitpunkt_at: &zeitpunkt,
                quelle: ZeitachseQuelle::Nachtrag,
                notiz: notiz.as_deref(),
            },
        )
        .await?;
        if let Schreibergebnis::Ausgelassen(v) = ergebnis {
            return Err(AppError::UnprocessableEntity(v.to_string()));
        }
        let etb_id = crate::etb::system_audit_tx(
            conn,
            einsatz_id,
            benutzer_id,
            startwert,
            &repo::etb_text_nachtrag(kraft, &name, art, &zeitpunkt, tz),
        )
        .await?;
        Ok((etb_id, beruehrt))
    })?;
    publiziere(state, einsatz_id, etb_id, kraft, &beruehrt);
    repo::laden(&state.pool, einsatz_id, kraft).await
}

async fn streichen(
    state: &AppState,
    einsatz_id: i64,
    benutzer_id: i64,
    kraft: Kraft,
    zid: i64,
    body: StreichenBody,
) -> Result<ZeitachseAnzeige, AppError> {
    let grund = body.grund.trim().to_string();
    if grund.is_empty() {
        return Err(AppError::Validation("Grund fehlt".into()));
    }
    let startwert = etb_startwert(&state.pool, einsatz_id).await?;
    let tz = crate::verpflegung::repo::zeitzone(&state.pool, einsatz_id).await?;
    let (etb_id, beruehrt) = crate::write_retry!(&state.pool, |conn| {
        let name = repo::kraft_name_tx(conn, einsatz_id, kraft).await?;
        let g = repo::streiche_tx(conn, einsatz_id, benutzer_id, kraft, zid, &grund, false).await?;
        let etb_id = crate::etb::system_audit_tx(
            conn,
            einsatz_id,
            benutzer_id,
            startwert,
            &repo::etb_text_streichung(kraft, &name, g.art, &g.zeitpunkt_at, &grund, tz),
        )
        .await?;
        Ok((etb_id, g.beruehrt))
    })?;
    publiziere(state, einsatz_id, etb_id, kraft, &beruehrt);
    repo::laden(&state.pool, einsatz_id, kraft).await
}

// ── Einheiten ───────────────────────────────────────────────────────────────────────────────

/// GET /api/einsaetze/{id}/einheiten/zeitachse — Perioden je Einheit (Meldebild).
pub async fn einheiten_perioden(
    State(state): State<AppState>,
    ctx: EinsatzLesezugriff<Einheiten>,
) -> Result<Json<Vec<EinheitPerioden>>, AppError> {
    Ok(Json(
        repo::perioden_einheiten(&state.pool, ctx.einsatz.id).await?,
    ))
}

/// GET /api/einsaetze/{id}/einheiten/{eid}/zeitachse
pub async fn einheit_laden(
    State(state): State<AppState>,
    ctx: EinsatzLesezugriff<Einheiten>,
    PfadParam((_id, eid)): PfadParam<(i64, i64)>,
) -> Result<Json<ZeitachseAnzeige>, AppError> {
    Ok(Json(
        repo::laden(&state.pool, ctx.einsatz.id, Kraft::Einheit(eid)).await?,
    ))
}

/// POST /api/einsaetze/{id}/einheiten/{eid}/zeitachse — Nachtrag (mit Fan-out).
pub async fn einheit_nachtragen(
    State(state): State<AppState>,
    ctx: EinsatzSchreibzugriff<Einheiten>,
    PfadParam((_id, eid)): PfadParam<(i64, i64)>,
    JsonBody(body): JsonBody<NachtragBody>,
) -> Result<(StatusCode, Json<ZeitachseAnzeige>), AppError> {
    let z = nachtragen(
        &state,
        ctx.einsatz.id,
        ctx.benutzer.id,
        Kraft::Einheit(eid),
        body,
    )
    .await?;
    Ok((StatusCode::CREATED, Json(z)))
}

/// POST /api/einsaetze/{id}/einheiten/{eid}/zeitachse/{zid}/streichen
pub async fn einheit_streichen(
    State(state): State<AppState>,
    ctx: EinsatzSchreibzugriff<Einheiten>,
    PfadParam((_id, eid, zid)): PfadParam<(i64, i64, i64)>,
    JsonBody(body): JsonBody<StreichenBody>,
) -> Result<Json<ZeitachseAnzeige>, AppError> {
    Ok(Json(
        streichen(
            &state,
            ctx.einsatz.id,
            ctx.benutzer.id,
            Kraft::Einheit(eid),
            zid,
            body,
        )
        .await?,
    ))
}

// ── Personal ────────────────────────────────────────────────────────────────────────────────

/// GET /api/einsaetze/{id}/personal/zeitachse — Perioden je Person (Personal-Seite).
pub async fn personal_perioden(
    State(state): State<AppState>,
    ctx: EinsatzLesezugriff<Personal>,
) -> Result<Json<Vec<PersonPerioden>>, AppError> {
    Ok(Json(
        repo::perioden_personal(&state.pool, ctx.einsatz.id).await?,
    ))
}

/// GET /api/einsaetze/{id}/personal/{ep_id}/zeitachse
pub async fn person_laden(
    State(state): State<AppState>,
    ctx: EinsatzLesezugriff<Personal>,
    PfadParam((_id, ep_id)): PfadParam<(i64, i64)>,
) -> Result<Json<ZeitachseAnzeige>, AppError> {
    Ok(Json(
        repo::laden(&state.pool, ctx.einsatz.id, Kraft::Person(ep_id)).await?,
    ))
}

/// POST /api/einsaetze/{id}/personal/{ep_id}/zeitachse — Nachtrag.
pub async fn person_nachtragen(
    State(state): State<AppState>,
    ctx: EinsatzSchreibzugriff<Personal>,
    PfadParam((_id, ep_id)): PfadParam<(i64, i64)>,
    JsonBody(body): JsonBody<NachtragBody>,
) -> Result<(StatusCode, Json<ZeitachseAnzeige>), AppError> {
    let z = nachtragen(
        &state,
        ctx.einsatz.id,
        ctx.benutzer.id,
        Kraft::Person(ep_id),
        body,
    )
    .await?;
    Ok((StatusCode::CREATED, Json(z)))
}

/// POST /api/einsaetze/{id}/personal/{ep_id}/zeitachse/{zid}/streichen
pub async fn person_streichen(
    State(state): State<AppState>,
    ctx: EinsatzSchreibzugriff<Personal>,
    PfadParam((_id, ep_id, zid)): PfadParam<(i64, i64, i64)>,
    JsonBody(body): JsonBody<StreichenBody>,
) -> Result<Json<ZeitachseAnzeige>, AppError> {
    Ok(Json(
        streichen(
            &state,
            ctx.einsatz.id,
            ctx.benutzer.id,
            Kraft::Person(ep_id),
            zid,
            body,
        )
        .await?,
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn nachtrag_art_regeln() {
        assert_eq!(
            nachtrag_art("eintreffen").unwrap(),
            ZeitachseArt::Eintreffen
        );
        assert!(matches!(
            nachtrag_art("abloesung"),
            Err(AppError::Validation(_))
        ));
        assert!(matches!(nachtrag_art(""), Err(AppError::Validation(_))));
        assert!(matches!(
            nachtrag_art("pause"),
            Err(AppError::Validation(_))
        ));
    }

    #[test]
    fn nachtrag_zeit_regeln() {
        let jetzt = "2026-09-30 09:00:00";
        assert_eq!(
            nachtrag_zeit("2026-09-30 06:40:00", jetzt).unwrap(),
            "2026-09-30 06:40:00"
        );
        assert!(
            nachtrag_zeit("2026-09-30 09:01:00", jetzt).is_ok(),
            "Uhrentoleranz"
        );
        assert!(matches!(
            nachtrag_zeit("2026-09-30 10:00:00", jetzt),
            Err(AppError::UnprocessableEntity(_))
        ));
        assert!(matches!(
            nachtrag_zeit("", jetzt),
            Err(AppError::Validation(_))
        ));
        assert!(matches!(
            nachtrag_zeit("gestern", jetzt),
            Err(AppError::Validation(_))
        ));
    }
}
