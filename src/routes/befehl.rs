//! Routen der Befehle. Die Logik teilen sie mit den Lageberichten
//! ([`crate::routes::vorlagendokument`]).

use crate::app::AppState;
use crate::auth::session::CurrentUser;
use crate::befehl::repo::BefehlAnzeige;
use crate::befehl::{Abschnitt, Befehl};
use crate::error::AppError;
use crate::extract::JsonBody;
use crate::extract::PfadParam;
use crate::live::LiveEvent;
use crate::routes::vorlagendokument::{
    self as kern, AnlegenBody, DokumentRoute, FortschreibenBody, PatchBody,
};
use axum::extract::State;
use axum::http::StatusCode;
use axum::Json;

/// Modul-Key dieses Route-Moduls (LFH-132).
const MODUL_KEY: &str = "auftraege";

impl DokumentRoute for Befehl {
    const MODUL_KEY: &'static str = MODUL_KEY;
    /// Event-Tag `befehl`.
    const LIVE: LiveEvent = LiveEvent::Befehl;
    const LIVE_ID: &'static str = "befehl_id";
}

/// GET /api/einsaetze/{id}/befehle — Liste. Nur Lesezugriff (inkl. Beobachter).
pub async fn liste(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    PfadParam(einsatz_id): PfadParam<i64>,
) -> Result<Json<Vec<BefehlAnzeige>>, AppError> {
    kern::liste::<Befehl>(&state, &benutzer, einsatz_id).await
}

/// GET /api/einsaetze/{id}/befehle/{bid} — Detail. Nur Lesezugriff.
pub async fn detail(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    PfadParam((einsatz_id, bid)): PfadParam<(i64, i64)>,
) -> Result<Json<BefehlAnzeige>, AppError> {
    kern::detail::<Befehl>(&state, &benutzer, einsatz_id, bid).await
}

/// POST /api/einsaetze/{id}/befehle — Entwurf anlegen. Schreibrecht + aktiv.
pub async fn anlegen(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    PfadParam(einsatz_id): PfadParam<i64>,
    JsonBody(body): JsonBody<AnlegenBody<Abschnitt>>,
) -> Result<(StatusCode, Json<BefehlAnzeige>), AppError> {
    kern::anlegen::<Befehl>(&state, &benutzer, einsatz_id, body).await
}

/// PATCH /api/einsaetze/{id}/befehle/{bid} — nur solange Entwurf (sonst 422).
pub async fn aktualisieren(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    PfadParam((einsatz_id, bid)): PfadParam<(i64, i64)>,
    JsonBody(body): JsonBody<PatchBody<Abschnitt>>,
) -> Result<Json<BefehlAnzeige>, AppError> {
    kern::aktualisieren::<Befehl>(&state, &benutzer, einsatz_id, bid, body).await
}

/// POST /api/einsaetze/{id}/befehle/{bid}/freigeben — rendert + snapshottet ins ETB.
pub async fn freigeben(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    PfadParam((einsatz_id, bid)): PfadParam<(i64, i64)>,
) -> Result<Json<BefehlAnzeige>, AppError> {
    kern::freigeben::<Befehl>(&state, &benutzer, einsatz_id, bid).await
}

/// POST /api/einsaetze/{id}/befehle/{bid}/fortschreiben — neue Entwurfs-Version.
pub async fn fortschreiben(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    PfadParam((einsatz_id, bid)): PfadParam<(i64, i64)>,
    JsonBody(body): JsonBody<FortschreibenBody>,
) -> Result<(StatusCode, Json<BefehlAnzeige>), AppError> {
    kern::fortschreiben::<Befehl>(&state, &benutzer, einsatz_id, bid, body).await
}
