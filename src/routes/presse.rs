//! Routen der Presse- und Medienarbeit S5 (LFH-554): Presse-Log und Pressemitteilungen unter
//! `/api/einsaetze/{id}/stab/…`.
//!
//! Gates strukturell über die Extractor-Typen mit dem Marker `Stab`: Lesen
//! `EinsatzLesezugriff<Stab>` (alle Einsatzmitglieder inkl. Beobachter), Schreiben
//! `EinsatzSchreibzugriff<Stab>` (Schreibrecht, Modul, aktiver Einsatz), die Freigabe einer
//! Pressemitteilung `EinsatzLeitungszugriff<Stab>` (nur die Einsatzleitung; Führungspersonal
//! bekommt 403, auch an einem abgeschlossenen Einsatz). Das Sachgebiet selbst verleiht kein
//! Recht (LFH-46, Entscheidung 12).
//!
//! Die Pressemitteilung teilt Anlegen, Bearbeiten, Freigabe und Fortschreiben mit Lagebericht
//! und Befehl ([`crate::routes::vorlagendokument`]); der Kern prüft Rechte und Modul für sich
//! noch einmal über `MODUL_KEY = "stab"`.
//!
//! **Live:** Medienkontakte und Pressemitteilungen publizieren `LiveEvent::Presse`, nur mit
//! Kennungen. Die Freigabe publiziert zusätzlich die ETB-id des Snapshots.

use axum::extract::State;
use axum::http::StatusCode;
use axum::Json;
use serde::Deserialize;

use crate::app::AppState;
use crate::einsatz::kontext::{EinsatzLeitungszugriff, EinsatzLesezugriff, EinsatzSchreibzugriff};
use crate::einsatz::modul::Stab;
use crate::error::AppError;
use crate::extract::{JsonBody, PfadParam};
use crate::live::LiveEvent;
use crate::presse::mitteilung::{Abschnitt, Pressemitteilung, PressemitteilungAnzeige};
use crate::presse::repo::{self, KontaktAenderung, KontaktEingabe, StatusWechsel};
use crate::presse::{MedienkontaktAnzeige, MedienkontaktArt, MedienkontaktStatus};
use crate::routes::support;
use crate::routes::vorlagendokument::{
    self as kern, AnlegenBody, DokumentRoute, FortschreibenBody, PatchBody,
};

impl DokumentRoute for Pressemitteilung {
    const MODUL_KEY: &'static str = "stab";
    const LIVE: LiveEvent = LiveEvent::Presse;
    const LIVE_ID: &'static str = "pressemitteilung_id";
}

fn sse_kontakt(state: &AppState, einsatz_id: i64, id: i64) {
    state
        .live
        .publiziere_objekt(einsatz_id, LiveEvent::Presse, "medienkontakt_id", id);
}

/// Normalisiert einen übergebenen Zeitpunkt (UTC). Unlesbar → 400; fehlt → jetzt.
fn zeit_oder_jetzt(s: Option<&str>) -> Result<String, AppError> {
    match s.map(str::trim).filter(|t| !t.is_empty()) {
        Some(t) => crate::etb::normalisiere_zeit(t),
        None => Ok(crate::zeit::jetzt()),
    }
}

fn art(roh: &str) -> Result<MedienkontaktArt, AppError> {
    MedienkontaktArt::parse(roh).ok_or_else(|| {
        AppError::Validation(format!(
            "Unbekannte Art '{roh}' (erlaubt: anfrage, abstimmung, termin)"
        ))
    })
}

fn status(roh: &str) -> Result<MedienkontaktStatus, AppError> {
    MedienkontaktStatus::parse(roh).ok_or_else(|| {
        AppError::Validation(format!(
            "Unbekannter Status '{roh}' (erlaubt: offen, beantwortet, abgelehnt, erledigt)"
        ))
    })
}

// ── Presse-Log ──────────────────────────────────────────────────────────────────────────────

/// GET /api/einsaetze/{id}/stab/medienkontakte — offene zuerst, dann jüngster Eingang.
pub async fn medienkontakte_liste(
    State(state): State<AppState>,
    ctx: EinsatzLesezugriff<Stab>,
) -> Result<Json<Vec<MedienkontaktAnzeige>>, AppError> {
    Ok(Json(repo::liste(&state.pool, ctx.einsatz.id).await?))
}

#[derive(Debug, Deserialize)]
pub struct KontaktAnlegen {
    /// Als `String`, damit ein unbekannter Wert eine benannte 400 liefert.
    art: String,
    medium: String,
    thema: String,
    #[serde(default)]
    kontakt_name: Option<String>,
    #[serde(default)]
    kontakt_erreichbarkeit: Option<String>,
    /// Fehlt = jetzt.
    #[serde(default)]
    eingang_at: Option<String>,
}

/// POST /api/einsaetze/{id}/stab/medienkontakte
pub async fn medienkontakt_anlegen(
    State(state): State<AppState>,
    ctx: EinsatzSchreibzugriff<Stab>,
    JsonBody(req): JsonBody<KontaktAnlegen>,
) -> Result<(StatusCode, Json<MedienkontaktAnzeige>), AppError> {
    let einsatz_id = ctx.einsatz.id;
    let eingabe = KontaktEingabe {
        art: art(&req.art)?,
        medium: req.medium,
        thema: req.thema,
        kontakt_name: req.kontakt_name,
        kontakt_erreichbarkeit: req.kontakt_erreichbarkeit,
        eingang_at: zeit_oder_jetzt(req.eingang_at.as_deref())?,
    };
    let benutzer_id = ctx.benutzer.id;
    let id = crate::write_retry!(&state.pool, |conn| {
        repo::anlegen_tx(conn, einsatz_id, benutzer_id, &eingabe).await
    })?;
    sse_kontakt(&state, einsatz_id, id);
    Ok((
        StatusCode::CREATED,
        Json(repo::laden(&state.pool, einsatz_id, id).await?),
    ))
}

/// Teiländerung der Stammangaben; fehlt = unverändert, bei den Kontaktangaben leert `null`.
#[derive(Debug, Deserialize)]
pub struct KontaktAendern {
    #[serde(default)]
    medium: Option<String>,
    #[serde(default)]
    thema: Option<String>,
    #[serde(default, deserialize_with = "support::deserialize_optional_field")]
    kontakt_name: Option<Option<String>>,
    #[serde(default, deserialize_with = "support::deserialize_optional_field")]
    kontakt_erreichbarkeit: Option<Option<String>>,
    #[serde(default)]
    eingang_at: Option<String>,
}

/// PATCH /api/einsaetze/{id}/stab/medienkontakte/{kid}
pub async fn medienkontakt_aendern(
    State(state): State<AppState>,
    ctx: EinsatzSchreibzugriff<Stab>,
    PfadParam((_eid, kid)): PfadParam<(i64, i64)>,
    JsonBody(req): JsonBody<KontaktAendern>,
) -> Result<Json<MedienkontaktAnzeige>, AppError> {
    let einsatz_id = ctx.einsatz.id;
    let aenderung = KontaktAenderung {
        medium: req.medium,
        thema: req.thema,
        kontakt_name: req.kontakt_name,
        kontakt_erreichbarkeit: req.kontakt_erreichbarkeit,
        eingang_at: req
            .eingang_at
            .as_deref()
            .map(|z| crate::etb::normalisiere_zeit(z.trim()))
            .transpose()?,
    };
    crate::write_retry!(&state.pool, |conn| {
        repo::aendern_tx(conn, einsatz_id, kid, &aenderung).await
    })?;
    sse_kontakt(&state, einsatz_id, kid);
    Ok(Json(repo::laden(&state.pool, einsatz_id, kid).await?))
}

#[derive(Debug, Deserialize)]
pub struct KontaktStatusSetzen {
    status: String,
    #[serde(default)]
    antwort: Option<String>,
    #[serde(default)]
    freigabe_durch: Option<String>,
    #[serde(default)]
    pressemitteilung_id: Option<i64>,
}

/// POST /api/einsaetze/{id}/stab/medienkontakte/{kid}/status
pub async fn medienkontakt_status(
    State(state): State<AppState>,
    ctx: EinsatzSchreibzugriff<Stab>,
    PfadParam((_eid, kid)): PfadParam<(i64, i64)>,
    JsonBody(req): JsonBody<KontaktStatusSetzen>,
) -> Result<Json<MedienkontaktAnzeige>, AppError> {
    let einsatz_id = ctx.einsatz.id;
    let wechsel = StatusWechsel {
        ziel: status(&req.status)?,
        antwort: req.antwort,
        freigabe_durch: req.freigabe_durch,
        pressemitteilung_id: req.pressemitteilung_id,
    };
    let benutzer_id = ctx.benutzer.id;
    crate::write_retry!(&state.pool, |conn| {
        repo::status_tx(conn, einsatz_id, kid, benutzer_id, &wechsel).await
    })?;
    sse_kontakt(&state, einsatz_id, kid);
    Ok(Json(repo::laden(&state.pool, einsatz_id, kid).await?))
}

// ── Pressemitteilungen ──────────────────────────────────────────────────────────────────────

/// GET /api/einsaetze/{id}/stab/pressemitteilungen
pub async fn pressemitteilungen_liste(
    State(state): State<AppState>,
    ctx: EinsatzLesezugriff<Stab>,
) -> Result<Json<Vec<PressemitteilungAnzeige>>, AppError> {
    kern::liste::<Pressemitteilung>(&state, &ctx.benutzer, ctx.einsatz.id).await
}

/// GET /api/einsaetze/{id}/stab/pressemitteilungen/{mid}
pub async fn pressemitteilung_detail(
    State(state): State<AppState>,
    ctx: EinsatzLesezugriff<Stab>,
    PfadParam((_eid, mid)): PfadParam<(i64, i64)>,
) -> Result<Json<PressemitteilungAnzeige>, AppError> {
    kern::detail::<Pressemitteilung>(&state, &ctx.benutzer, ctx.einsatz.id, mid).await
}

/// POST /api/einsaetze/{id}/stab/pressemitteilungen — Entwurf anlegen.
pub async fn pressemitteilung_anlegen(
    State(state): State<AppState>,
    ctx: EinsatzSchreibzugriff<Stab>,
    JsonBody(body): JsonBody<AnlegenBody<Abschnitt>>,
) -> Result<(StatusCode, Json<PressemitteilungAnzeige>), AppError> {
    kern::anlegen::<Pressemitteilung>(&state, &ctx.benutzer, ctx.einsatz.id, body).await
}

/// PATCH /api/einsaetze/{id}/stab/pressemitteilungen/{mid} — nur solange Entwurf (sonst 422).
pub async fn pressemitteilung_aktualisieren(
    State(state): State<AppState>,
    ctx: EinsatzSchreibzugriff<Stab>,
    PfadParam((_eid, mid)): PfadParam<(i64, i64)>,
    JsonBody(body): JsonBody<PatchBody<Abschnitt>>,
) -> Result<Json<PressemitteilungAnzeige>, AppError> {
    kern::aktualisieren::<Pressemitteilung>(&state, &ctx.benutzer, ctx.einsatz.id, mid, body).await
}

/// POST /api/einsaetze/{id}/stab/pressemitteilungen/{mid}/freigeben — nur die Einsatzleitung.
pub async fn pressemitteilung_freigeben(
    State(state): State<AppState>,
    ctx: EinsatzLeitungszugriff<Stab>,
    PfadParam((_eid, mid)): PfadParam<(i64, i64)>,
) -> Result<Json<PressemitteilungAnzeige>, AppError> {
    kern::freigeben::<Pressemitteilung>(&state, &ctx.benutzer, ctx.einsatz.id, mid).await
}

/// POST /api/einsaetze/{id}/stab/pressemitteilungen/{mid}/fortschreiben — Folgemeldung.
pub async fn pressemitteilung_fortschreiben(
    State(state): State<AppState>,
    ctx: EinsatzSchreibzugriff<Stab>,
    PfadParam((_eid, mid)): PfadParam<(i64, i64)>,
    JsonBody(body): JsonBody<FortschreibenBody>,
) -> Result<(StatusCode, Json<PressemitteilungAnzeige>), AppError> {
    kern::fortschreiben::<Pressemitteilung>(&state, &ctx.benutzer, ctx.einsatz.id, mid, body).await
}
