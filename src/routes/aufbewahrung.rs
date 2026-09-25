//! Archiv-Namensraum der Aufbewahrung (LFH-23, design.md D2).
//!
//! | Methode | Pfad | Zweck |
//! |---|---|---|
//! | GET  | `/api/aufbewahrung` | Übersicht der eigenen Organisation |
//! | GET  | `/api/aufbewahrung/einsaetze/{id}` | Archivakte: Kopf, Zustand, Register |
//! | GET  | `/api/aufbewahrung/einsaetze/{id}/etb` | Archiv-ETB (`typ`, `before_lfd_nr`, `limit`) |
//! | POST | `/api/aufbewahrung/einsaetze/{id}/wiederherstellen` | Wiederherstellen |
//!
//! **Die Lesesperre der regulären Einsatz-Routen bleibt unberührt** — dieser Namensraum
//! steht daneben, statt eine Ausnahme in `darf_lesen` zu öffnen, die alle regulären Routen
//! (Personen mit Namen, Anhänge, Export) wieder freigäbe. Jeder Handler nimmt `AdminUser`,
//! und bis auf das Wiederherstellen ist jeder ein GET. Beides hält der Struktur-Guard
//! `archiv_namensraum_nur_lesend_und_admin` in `tests/aufbewahrung.rs` fest.

use crate::app::AppState;
use crate::aufbewahrung::repo::{self, ArchivEtbFilter, KopfZeile};
use crate::aufbewahrung::{
    fordere_archivzugriff, ArchivAkteAnzeige, ArchivEtbEintragAnzeige, AufbewahrungEintragAnzeige,
};
use crate::auth::session::AdminUser;
use crate::auth::Benutzer;
use crate::error::AppError;
use crate::etb::EtbTyp;
use crate::extract::{JsonBody, PfadParam};
use crate::routes::support::deserialize_optional_field;
use axum::extract::{Query, State};
use axum::Json;
use chrono::Utc;
use serde::Deserialize;

/// Lädt den Kopf und prüft den Archivzugriff: 404 unbekannt, 403 fremde Org, 409 aktiv.
async fn archivkopf(
    state: &AppState,
    benutzer: &Benutzer,
    einsatz_id: i64,
) -> Result<KopfZeile, AppError> {
    let kopf = repo::kopf_laden(&state.pool, einsatz_id)
        .await?
        .ok_or(AppError::NotFound)?;
    fordere_archivzugriff(benutzer, kopf.org_id, &kopf.status)?;
    Ok(kopf)
}

/// GET /api/aufbewahrung — alle abgeschlossenen Einsätze der eigenen Organisation mit
/// ihrem Aufbewahrungszustand. Die Organisation kommt aus dem Benutzer, nie aus der Anfrage.
pub async fn uebersicht(
    State(state): State<AppState>,
    AdminUser(benutzer): AdminUser,
) -> Result<Json<Vec<AufbewahrungEintragAnzeige>>, AppError> {
    Ok(Json(
        repo::uebersicht(&state.pool, benutzer.org_id, Utc::now()).await?,
    ))
}

/// GET /api/aufbewahrung/einsaetze/{id} — pseudonyme Archivakte (Retain-Projektion).
pub async fn akte(
    State(state): State<AppState>,
    AdminUser(benutzer): AdminUser,
    PfadParam(einsatz_id): PfadParam<i64>,
) -> Result<Json<ArchivAkteAnzeige>, AppError> {
    let kopf = archivkopf(&state, &benutzer, einsatz_id).await?;
    Ok(Json(repo::akte(&state.pool, &kopf, Utc::now()).await?))
}

#[derive(Debug, Deserialize)]
pub struct ArchivEtbParams {
    /// Eintragstyp-Filter; ein unbekannter Wert ist 400.
    pub typ: Option<String>,
    /// Cursor: nur Einträge mit `lfd_nr` kleiner als dieser Wert.
    pub before_lfd_nr: Option<i64>,
    /// Seitengröße (Vorgabe `etb::repo::STANDARD_LIMIT`, geklemmt auf `[1, MAX_LIMIT]`).
    pub limit: Option<i64>,
}

/// GET /api/aufbewahrung/einsaetze/{id}/etb — Archiv-ETB im Wortlaut, neueste zuerst.
pub async fn etb(
    State(state): State<AppState>,
    AdminUser(benutzer): AdminUser,
    PfadParam(einsatz_id): PfadParam<i64>,
    Query(params): Query<ArchivEtbParams>,
) -> Result<Json<Vec<ArchivEtbEintragAnzeige>>, AppError> {
    let kopf = archivkopf(&state, &benutzer, einsatz_id).await?;
    let typ = match params
        .typ
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
    {
        Some(t) => Some(
            EtbTyp::parse(t)
                .ok_or_else(|| AppError::Validation("Ungültiger Eintragstyp im Filter".into()))?,
        ),
        None => None,
    };
    let limit = params
        .limit
        .unwrap_or(crate::etb::repo::STANDARD_LIMIT)
        .clamp(1, crate::etb::repo::MAX_LIMIT);
    Ok(Json(
        repo::etb(
            &state.pool,
            kopf.id,
            ArchivEtbFilter {
                typ,
                before_lfd_nr: params.before_lfd_nr,
                limit,
            },
        )
        .await?,
    ))
}

#[derive(Debug, Deserialize)]
pub struct Wiederherstellen {
    /// Neue Aufbewahrungsfrist — **Pflichtfeld**: ein Zeitpunkt in der Zukunft oder
    /// ausdrücklich `null` für unbegrenzt. Fehlt das Feld, ist das 400: ohne neue Frist
    /// merkte der nächste Purge-Lauf den Einsatz sofort wieder vor.
    #[serde(default, deserialize_with = "deserialize_optional_field")]
    pub retention_bis: Option<Option<String>>,
}

/// POST /api/aufbewahrung/einsaetze/{id}/wiederherstellen — Löschvormerkung während der
/// Karenz aufheben und neue Frist setzen, mit ETB-Audit des Admins. 400 Feld fehlt oder
/// unlesbar, 422 Frist nicht in der Zukunft oder Einsatz nicht vorgemerkt, 409 Karenz
/// abgelaufen oder geschwärzt.
pub async fn wiederherstellen(
    State(state): State<AppState>,
    AdminUser(benutzer): AdminUser,
    PfadParam(einsatz_id): PfadParam<i64>,
    JsonBody(req): JsonBody<Wiederherstellen>,
) -> Result<Json<ArchivAkteAnzeige>, AppError> {
    archivkopf(&state, &benutzer, einsatz_id).await?;
    let Some(frist_roh) = req.retention_bis else {
        return Err(AppError::Validation(
            "retention_bis fehlt — eine neue Frist oder null (unbegrenzt) ist Pflicht".into(),
        ));
    };
    let neue_frist = match frist_roh.as_deref().map(str::trim) {
        None => None,
        Some("") => {
            return Err(AppError::Validation(
                "retention_bis ist leer — eine neue Frist oder null (unbegrenzt) ist Pflicht"
                    .into(),
            ))
        }
        Some(s) => Some(crate::etb::normalisiere_zeit(s)?),
    };
    let jetzt = Utc::now();
    if let Some(f) = neue_frist.as_deref() {
        if crate::einsatz::berechtigung::retention_abgelaufen(Some(f), jetzt) {
            return Err(AppError::UnprocessableEntity(
                "Die neue Aufbewahrungsfrist muss in der Zukunft liegen".into(),
            ));
        }
    }
    crate::einsatz::repo::wiederherstellen(
        &state.pool,
        einsatz_id,
        benutzer.id,
        neue_frist.as_deref(),
        jetzt,
    )
    .await?;
    let kopf = archivkopf(&state, &benutzer, einsatz_id).await?;
    Ok(Json(repo::akte(&state.pool, &kopf, Utc::now()).await?))
}
