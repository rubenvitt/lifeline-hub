//! Routen der Lageberichte. Die Logik teilen sie mit den Befehlen
//! ([`crate::routes::vorlagendokument`]).

use crate::app::AppState;
use crate::auth::session::CurrentUser;
use crate::error::AppError;
use crate::extract::JsonBody;
use crate::extract::PfadParam;
use crate::lagebericht::repo::LageberichtAnzeige;
use crate::lagebericht::{Abschnitt, Lagebericht};
use crate::live::LiveEvent;
use crate::routes::vorlagendokument::{
    self as kern, AnlegenBody, DokumentRoute, FortschreibenBody, PatchBody,
};
use axum::extract::State;
use axum::http::StatusCode;
use axum::Json;

/// Modul-Key dieses Route-Moduls (LFH-132).
const MODUL_KEY: &str = "lageberichte";

impl DokumentRoute for Lagebericht {
    const MODUL_KEY: &'static str = MODUL_KEY;
    /// Event-Tag `lagebericht`.
    const LIVE: LiveEvent = LiveEvent::Lagebericht;
    const LIVE_ID: &'static str = "lagebericht_id";
}

/// GET /api/einsaetze/{id}/lageberichte — Liste. Nur Lesezugriff (inkl. Beobachter).
pub async fn liste(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    PfadParam(einsatz_id): PfadParam<i64>,
) -> Result<Json<Vec<LageberichtAnzeige>>, AppError> {
    kern::liste::<Lagebericht>(&state, &benutzer, einsatz_id).await
}

/// GET /api/einsaetze/{id}/lageberichte/{lid} — Detail. Nur Lesezugriff.
pub async fn detail(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    PfadParam((einsatz_id, lid)): PfadParam<(i64, i64)>,
) -> Result<Json<LageberichtAnzeige>, AppError> {
    kern::detail::<Lagebericht>(&state, &benutzer, einsatz_id, lid).await
}

/// POST /api/einsaetze/{id}/lageberichte — Entwurf anlegen. Schreibrecht + aktiv.
pub async fn anlegen(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    PfadParam(einsatz_id): PfadParam<i64>,
    JsonBody(body): JsonBody<AnlegenBody<Abschnitt>>,
) -> Result<(StatusCode, Json<LageberichtAnzeige>), AppError> {
    kern::anlegen::<Lagebericht>(&state, &benutzer, einsatz_id, body).await
}

/// PATCH /api/einsaetze/{id}/lageberichte/{lid} — nur solange Entwurf (sonst 422).
pub async fn aktualisieren(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    PfadParam((einsatz_id, lid)): PfadParam<(i64, i64)>,
    JsonBody(body): JsonBody<PatchBody<Abschnitt>>,
) -> Result<Json<LageberichtAnzeige>, AppError> {
    kern::aktualisieren::<Lagebericht>(&state, &benutzer, einsatz_id, lid, body).await
}

/// POST /api/einsaetze/{id}/lageberichte/{lid}/freigeben — rendert + snapshottet ins ETB.
pub async fn freigeben(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    PfadParam((einsatz_id, lid)): PfadParam<(i64, i64)>,
) -> Result<Json<LageberichtAnzeige>, AppError> {
    kern::freigeben::<Lagebericht>(&state, &benutzer, einsatz_id, lid).await
}

/// POST /api/einsaetze/{id}/lageberichte/{lid}/fortschreiben — neue Entwurfs-Version.
pub async fn fortschreiben(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    PfadParam((einsatz_id, lid)): PfadParam<(i64, i64)>,
    JsonBody(body): JsonBody<FortschreibenBody>,
) -> Result<(StatusCode, Json<LageberichtAnzeige>), AppError> {
    kern::fortschreiben::<Lagebericht>(&state, &benutzer, einsatz_id, lid, body).await
}
