//! HTTP-Routen der Benachrichtigungen (LLH-1207, design.md D2).
//!
//! GET  /api/benachrichtigungen                    — eigene der letzten 12 h (`?offen=true`:
//!                                                    nur unquittierte, `?einsatz_id=`)
//! GET  /api/benachrichtigungen/{id}               — eine eigene samt Text
//! POST /api/benachrichtigungen/{id}/quittieren    — quittieren, Ereignis an die eigenen Tabs
//! GET  /api/einsaetze/{id}/benachrichtigungen     — Verlauf samt Zahl der ungelesenen Eingänge
//!                                                    (LLH-1143, design.md D3)
//! POST /api/einsaetze/{id}/benachrichtigungen/gelesen — „alle gelesen“ bis `bis_id` (D4)
//!
//! **Berechtigung ist die Empfängerzeile:** die `benutzer_id` stammt aus der Sitzung; eine
//! fremde oder unbekannte Benachrichtigung ist 404, nie 403 (kein Hinweis, dass es sie gibt).
//! Beim Lesen gilt das Recht am Einsatz und am Modul des Bezugs erneut
//! ([`aufloesung::Leserecht`]): wer es seit dem Melden verloren hat, bekommt 404 bzw. sieht sie
//! nicht in der Liste. Gekoppelte Geräte erreichen die Routen nicht (keine Routenliste).

use crate::app::AppState;
use crate::auth::session::CurrentUser;
use crate::auth::Benutzer;
use crate::benachrichtigung::aufloesung::Leserecht;
use crate::benachrichtigung::repo::{self, Zeile};
use crate::benachrichtigung::{
    text, BenachrichtigungAnzeige, BenachrichtigungEreignis, BenachrichtigungStufe,
    BenachrichtigungVerlauf, Bezug,
};
use crate::einsatz::kontext::EinsatzLesezugriff;
use crate::error::AppError;
use crate::extract::{JsonBody, PfadParam};
use axum::extract::{Query, State};
use axum::http::StatusCode;
use axum::Json;
use serde::Deserialize;
use sqlx::SqlitePool;
use std::collections::HashMap;
use utoipa::ToSchema;

/// Filter der Liste.
#[derive(Debug, Deserialize)]
pub struct ListeParams {
    /// `true`: nur unquittierte (das Nachreichen nach `lagged` und beim Öffnen eines Einsatzes).
    #[serde(default)]
    pub offen: bool,
    /// Nur die Benachrichtigungen dieses Einsatzes.
    pub einsatz_id: Option<i64>,
}

/// Macht aus einer eigenen Zeile die Anzeige, wenn `benutzer` Einsatz und Bezugsmodul (noch)
/// lesen darf; sonst `None`.
async fn anzeige(
    pool: &SqlitePool,
    recht: &Leserecht,
    benutzer: &Benutzer,
    z: Zeile,
) -> Result<Option<BenachrichtigungAnzeige>, AppError> {
    if !recht.darf(benutzer, z.bezug_typ.modul()) {
        return Ok(None);
    }
    let t = text::bilden(
        pool,
        z.einsatz_id,
        z.art,
        Bezug::neu(z.bezug_typ, z.bezug_id),
    )
    .await?;
    Ok(Some(BenachrichtigungAnzeige {
        id: z.id,
        einsatz_id: z.einsatz_id,
        art: z.art,
        stufe: z.stufe,
        bezug_typ: z.bezug_typ,
        bezug_id: z.bezug_id,
        erstellt_at: z.erstellt_at,
        quittiert_at: z.quittiert_at,
        titel: t.titel,
        detail: t.detail,
        pfad: t.pfad,
    }))
}

/// Die Rechte eines Einsatzes; ein verschwundener Einsatz zählt als nicht lesbar.
async fn leserecht(pool: &SqlitePool, einsatz_id: i64) -> Result<Option<Leserecht>, AppError> {
    match Leserecht::laden(pool, einsatz_id).await {
        Ok(r) => Ok(Some(r)),
        Err(AppError::NotFound) => Ok(None),
        Err(e) => Err(e),
    }
}

/// GET /api/benachrichtigungen — die eigenen Benachrichtigungen der letzten 12 h, jüngste
/// zuerst, mit Text; ohne die, deren Einsatz oder Modul der Nutzer nicht (mehr) lesen darf.
pub async fn liste(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Query(params): Query<ListeParams>,
) -> Result<Json<Vec<BenachrichtigungAnzeige>>, AppError> {
    let zeilen = repo::liste(
        &state.pool,
        benutzer.id,
        params.offen,
        params.einsatz_id,
        chrono::Utc::now(),
    )
    .await?;
    let mut rechte: HashMap<i64, Option<Leserecht>> = HashMap::new();
    let mut aus = Vec::with_capacity(zeilen.len());
    for z in zeilen {
        if !rechte.contains_key(&z.einsatz_id) {
            rechte.insert(z.einsatz_id, leserecht(&state.pool, z.einsatz_id).await?);
        }
        let Some(Some(recht)) = rechte.get(&z.einsatz_id) else {
            continue;
        };
        if let Some(a) = anzeige(&state.pool, recht, &benutzer, z).await? {
            aus.push(a);
        }
    }
    Ok(Json(aus))
}

/// GET /api/benachrichtigungen/{id} — eine eigene Benachrichtigung samt Text. Fremd, unbekannt
/// oder ohne Recht am Einsatz bzw. am Modul des Bezugs: 404.
pub async fn lesen(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    PfadParam(id): PfadParam<i64>,
) -> Result<Json<BenachrichtigungAnzeige>, AppError> {
    let z = repo::laden_eigene(&state.pool, id, benutzer.id)
        .await?
        .ok_or(AppError::NotFound)?;
    let recht = leserecht(&state.pool, z.einsatz_id)
        .await?
        .ok_or(AppError::NotFound)?;
    anzeige(&state.pool, &recht, &benutzer, z)
        .await?
        .map(Json)
        .ok_or(AppError::NotFound)
}

/// POST /api/benachrichtigungen/{id}/quittieren — quittiert eine eigene Benachrichtigung
/// (idempotent, 204). Beim ersten Quittieren geht dasselbe Ereignis mit `quittiert: true` an
/// alle Verbindungen des Nutzers, damit der Toast überall verschwindet. Fremd: 404.
pub async fn quittieren(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    PfadParam(id): PfadParam<i64>,
) -> Result<StatusCode, AppError> {
    let jetzt_quittiert = repo::quittieren(&state.pool, id, benutzer.id)
        .await?
        .ok_or(AppError::NotFound)?;
    if jetzt_quittiert {
        if let Some(z) = repo::laden_eigene(&state.pool, id, benutzer.id).await? {
            let org_id: Option<i64> = sqlx::query_scalar("SELECT org_id FROM einsatz WHERE id = ?")
                .bind(z.einsatz_id)
                .fetch_optional(&state.pool)
                .await?;
            if let Some(org_id) = org_id {
                crate::benachrichtigung::zustellen(
                    &state.live,
                    org_id,
                    z.einsatz_id,
                    z.art,
                    &[(
                        benutzer.id,
                        BenachrichtigungEreignis {
                            einsatz_id: z.einsatz_id,
                            benachrichtigung_id: z.id,
                            art: z.art,
                            stufe: z.stufe,
                            bezug_typ: z.bezug_typ,
                            bezug_id: z.bezug_id,
                            quittiert: true,
                            gelesen_bis: None,
                        },
                    )],
                );
            }
        }
    }
    Ok(StatusCode::NO_CONTENT)
}

/// GET /api/einsaetze/{id}/benachrichtigungen — der Verlauf des Nutzers in diesem Einsatz
/// (LLH-1143, design.md D3): seine jüngsten Benachrichtigungen samt Text und die Zahl der
/// ungelesenen Eingänge darunter. Nur wer den Einsatz lesen darf (sonst 404); ein Eintrag, dessen
/// Modul der Nutzer nicht (mehr) lesen darf, fehlt und zählt nicht.
pub async fn verlauf(
    State(state): State<AppState>,
    ctx: EinsatzLesezugriff,
) -> Result<Json<BenachrichtigungVerlauf>, AppError> {
    let ctx = ctx.0;
    let zeilen = repo::verlauf(&state.pool, ctx.benutzer.id, ctx.einsatz.id).await?;
    let mut eintraege = Vec::with_capacity(zeilen.len());
    if !zeilen.is_empty() {
        let recht = Leserecht::laden(&state.pool, ctx.einsatz.id).await?;
        for z in zeilen {
            if let Some(a) = anzeige(&state.pool, &recht, &ctx.benutzer, z).await? {
                eintraege.push(a);
            }
        }
    }
    let ungelesen = eintraege
        .iter()
        .filter(|a| a.stufe == BenachrichtigungStufe::Hinweis && a.quittiert_at.is_none())
        .count() as i64;
    Ok(Json(BenachrichtigungVerlauf {
        eintraege,
        ungelesen,
    }))
}

/// Body von `POST …/benachrichtigungen/gelesen`.
#[derive(Debug, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct GelesenEingabe {
    /// Die jüngste gelesene Benachrichtigung: alles bis einschließlich ihr gilt als gelesen.
    pub bis_id: i64,
}

/// POST /api/einsaetze/{id}/benachrichtigungen/gelesen — „alle gelesen“ (LLH-1143, design.md
/// D4): quittiert die eigenen Eingänge (und Stilles) dieses Einsatzes bis `bis_id`, nie einen
/// Alarm, und meldet es den eigenen Verbindungen mit einem Ereignis. Idempotent, 204. Ein
/// persönlicher Lesestand, deshalb Lese- statt Schreibrecht und auch am abgeschlossenen Einsatz.
pub async fn gelesen(
    State(state): State<AppState>,
    ctx: EinsatzLesezugriff,
    JsonBody(eingabe): JsonBody<GelesenEingabe>,
) -> Result<StatusCode, AppError> {
    let ctx = ctx.0;
    crate::benachrichtigung::gelesen_bis(
        &state.pool,
        &state.live,
        ctx.einsatz.org_id,
        ctx.einsatz.id,
        ctx.benutzer.id,
        eingabe.bis_id,
    )
    .await?;
    Ok(StatusCode::NO_CONTENT)
}
