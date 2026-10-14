//! HTTP-Routen der Benachrichtigungen (LLH-1207, design.md D2).
//!
//! GET  /api/benachrichtigungen                    — eigene der letzten 12 h (`?offen=true`:
//!                                                    nur unquittierte, `?einsatz_id=`)
//! GET  /api/benachrichtigungen/{id}               — eine eigene samt Text
//! POST /api/benachrichtigungen/{id}/quittieren    — quittieren, Ereignis an die eigenen Tabs
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
use crate::benachrichtigung::{text, BenachrichtigungAnzeige, BenachrichtigungEreignis, Bezug};
use crate::error::AppError;
use crate::extract::PfadParam;
use axum::extract::{Query, State};
use axum::http::StatusCode;
use axum::Json;
use serde::Deserialize;
use sqlx::SqlitePool;
use std::collections::HashMap;

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
                        },
                    )],
                );
            }
        }
    }
    Ok(StatusCode::NO_CONTENT)
}
